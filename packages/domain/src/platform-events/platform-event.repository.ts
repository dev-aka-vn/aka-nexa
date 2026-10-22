import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoClient, type Collection } from 'mongodb';

/**
 * D-39 + CONTEXT "Ack path & the platform-event ledger".
 *
 * The dedupe write is the one storage operation that stays on the inbound ack
 * path (OUT-10): verify → validate → dedupe write → enqueue → 200. The whole
 * budget is 200 ms, and these are the only Mongo timeouts the ledger is allowed
 * to spend, so they are deliberately **below 50 ms** — a Mongo outage must
 * surface as a fast failure (the receiver answers 503) rather than hold the
 * socket open past the platform's retry window (`Teams`' 429/502 retry-with-
 * jitter and `Slack`'s 3-second ack both turn a slow ack into a duplicate
 * delivery).
 *
 * CONTEXT names this explicitly: "500ms ledger timeout is wrong for 200ms
 * budget — tighten to <50ms". These values are shared by every platform, which
 * is why they live here and not in an adapter.
 */
export const PLATFORM_EVENT_REPOSITORY_SERVER_SELECTION_TIMEOUT_MS = 40;
export const PLATFORM_EVENT_REPOSITORY_CONNECT_TIMEOUT_MS = 40;
export const PLATFORM_EVENT_REPOSITORY_SOCKET_TIMEOUT_MS = 40;

/**
 * The per-timeout overrides, mirroring `MongoService`'s `MongoServiceOptions`.
 *
 * ## Why this exists, and why it does not weaken the budget
 *
 * Every composition root leaves these at the defaults above, which is the
 * <50 ms constraint the ack path depends on. The overrides exist for
 * **integration tests against a freshly mapped container**, where a single
 * TCP connect plus DNS resolve routinely costs more than 40 ms and the
 * repository's own budget would make the first operation always time out —
 * an un-testable seam that cannot be proven to work at all.
 *
 * A wider value in a test proves the seam's sequencing; it does not prove the
 * production budget. That stays the default, deliberately.
 */
export interface PlatformEventRepositoryOptions {
  readonly serverSelectionTimeoutMS?: number;
  readonly connectTimeoutMS?: number;
  readonly socketTimeoutMS?: number;
}

/** OUT-11: entries older than this are swept by the retention job. */
export const PLATFORM_EVENT_RETENTION_DAYS = 30;

/** One collection, one ledger, every platform — the dedupe index is composite. */
export const PLATFORM_EVENT_COLLECTION = 'platform_events';

/**
 * The ledger state machine (OUT-09). A row is written `pending` by the receiver
 * and flipped `dispatched` by the outbound delivery path; the reconciler reads
 * `pending` rows and re-drives them, which is what makes a crash between the
 * ack and the delivery recoverable.
 */
export const PLATFORM_EVENT_STATES = ['pending', 'dispatched'] as const;
export type PlatformEventState = (typeof PLATFORM_EVENT_STATES)[number];

export interface PlatformEventDocument {
  /** Slack | teams | telegram | zalo — the wire `platform`, never an adapter id. */
  readonly platform: string;
  /**
   * The platform's own event/message id (Slack `ts`/event id, Teams activity
   * id, Telegram `update_id`+`message_id`, Zalo `msg_id`). Unique *per
   * platform*, never globally — two platforms may legitimately emit the same
   * opaque id, which is why the index is composite (OUT-09).
   */
  readonly platform_event_id: string;
  readonly state: PlatformEventState;
  readonly payload: unknown;
  readonly createdAt: Date;
  /** `null` until `markDispatched` runs — never derived from two writes. */
  readonly dispatchedAt: Date | null;
}

export interface PlatformEventInput {
  readonly platform: string;
  readonly platformEventId: string;
  readonly payload: unknown;
}

export type PlatformEventInsertResult = 'inserted' | 'duplicate';

/**
 * The neutral platform-event ledger (OUT-09, OUT-10, OUT-11).
 *
 * Generalized from `TeamsEventRepository`, which was Teams-shaped in three ways
 * that matter: a `'teams'` literal in the document type, a unique index on
 * `platform_event_id` alone (so a Slack `ts` and a Teams activity id could
 * collide), and no state at all (so "did we deliver this?" was unanswerable).
 *
 * ## Why a dedicated client
 *
 * The shared `MongoService` is tuned for request-path reads, not for a <200 ms
 * ack budget. A dedicated client lets the ledger fail closed on its own
 * timeouts without tightening every other query in the process — and lets the
 * ledger be registered for a shutdown hook on its own.
 *
 * ## Why the writes are idempotent, not merely unique
 *
 * `record()` treats a duplicate-key error as a *successful* outcome meaning
 * "already seen". That is what turns the unique index into the dedupe contract
 * the receivers rely on: a platform retry re-POSTs the same event, the insert
 * loses the race, the receiver answers 200 and enqueues nothing.
 */
@Injectable()
export class PlatformEventRepository {
  private readonly client: MongoClient;
  private readonly dbName: string;
  private indexPromise: Promise<void> | undefined;

  constructor(
    config: ConfigService,
    options: PlatformEventRepositoryOptions = {},
  ) {
    const url = config.getOrThrow<string>('MONGO_URL');
    this.client = new MongoClient(url, {
      serverSelectionTimeoutMS:
        options.serverSelectionTimeoutMS ??
        PLATFORM_EVENT_REPOSITORY_SERVER_SELECTION_TIMEOUT_MS,
      connectTimeoutMS:
        options.connectTimeoutMS ??
        PLATFORM_EVENT_REPOSITORY_CONNECT_TIMEOUT_MS,
      socketTimeoutMS:
        options.socketTimeoutMS ??
        PLATFORM_EVENT_REPOSITORY_SOCKET_TIMEOUT_MS,
    });
    this.dbName = new URL(url).pathname.replace(/^\//, '') || 'akane';
  }

  private get collection(): Collection<PlatformEventDocument> {
    return this.client
      .db(this.dbName)
      .collection<PlatformEventDocument>(PLATFORM_EVENT_COLLECTION);
  }

  /**
   * Index setup, memoised so the ack path pays for it once per process.
   *
   * Two indexes:
   *  - `(platform, platform_event_id)` UNIQUE — the OUT-09 dedupe contract.
   *  - `(state, createdAt)` — without it `findPending()` (the reconciler's
   *    query, run every tick) is a collection scan on a table that OUT-11 lets
   *    grow for 30 days, and `sweepOlderThan` sorts on `createdAt`.
   */
  private ensureIndex(): Promise<void> {
    if (!this.indexPromise) {
      this.indexPromise = Promise.all([
        this.collection.createIndex(
          { platform: 1, platform_event_id: 1 } as unknown as Record<string, 1>,
          { unique: true, name: 'platform_event_identity' },
        ),
        this.collection.createIndex(
          { state: 1, createdAt: 1 } as unknown as Record<string, 1>,
          { name: 'platform_event_state_created' },
        ),
      ])
        .then(() => undefined)
        .catch((err: unknown) => {
          // Index may already exist with the same spec (or an equivalent one
          // under a different name, from a rolling deploy). Ignore only that.
          const msg = err instanceof Error ? err.message : String(err);
          if (!/already exists|Index with name|IndexOptionsConflict/i.test(msg)) {
            throw err;
          }
        });
    }
    return this.indexPromise;
  }

  /**
   * Record an inbound platform event as `pending`.
   *
   * Returns `'duplicate'` — not an error — when `(platform, platform_event_id)`
   * already exists, which is the dedupe contract the receivers branch on.
   */
  async record(input: PlatformEventInput): Promise<PlatformEventInsertResult> {
    await this.ensureIndex();
    try {
      await this.collection.insertOne({
        platform: input.platform,
        platform_event_id: input.platformEventId,
        state: 'pending',
        payload: input.payload,
        createdAt: new Date(),
        dispatchedAt: null,
      } as unknown as PlatformEventDocument);
      return 'inserted';
    } catch (err: unknown) {
      if (isDuplicateKeyError(err)) {
        return 'duplicate';
      }
      throw err;
    }
  }

  /**
   * Flip a `pending` event to `dispatched` (OUT-09's state transition).
   *
   * The filter carries `state: 'pending'` on purpose: the transition is applied
   * exactly once, so a reconciler racing the live delivery path cannot re-mark
   * an already-dispatched row and cannot resurrect one. The boolean is
   * "this call performed the transition", not "the row exists" — a caller that
   * receives `false` knows someone else already delivered it.
   */
  async markDispatched(platformEventId: string, platform: string): Promise<boolean> {
    await this.ensureIndex();
    const result = await this.collection.updateOne(
      { platform, platform_event_id: platformEventId, state: 'pending' },
      { $set: { state: 'dispatched', dispatchedAt: new Date() } },
    );
    return result.matchedCount > 0;
  }

  /**
   * Reconciliation read (OUT-09): the entries a crash left undelivered, oldest
   * first so the reconciler drains in arrival order.
   */
  async findPending(limit = 100): Promise<readonly PlatformEventDocument[]> {
    await this.ensureIndex();
    return this.collection
      .find({ state: 'pending' })
      .sort({ createdAt: 1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Retention sweep (OUT-11): delete entries older than `days` (default 30).
   *
   * Deliberately not state-filtered. A `pending` row older than the retention
   * window is past any reconciliation horizon — keeping it would mean the
   * ledger grows without bound, and re-driving a 30-day-old message would be
   * worse for the user than dropping it. Called by the scheduler, not the ack
   * path.
   *
   * ## The fate of the pre-Phase-10 `teams_events` collection
   *
   * Before this ledger, Teams dedupe rows lived in a Teams-only collection keyed
   * on `teamsEventId`. Phase 10 generalized that onto `platform_events` and
   * nothing in the codebase writes or reads the old collection any more.
   *
   * **Decision: age out, no migration.** The rows' only job was suppressing a
   * redelivery, so their value expires on the same 30-day schedule this sweep
   * runs. A backfill would add new code, new test surface and new failure modes
   * to preserve a bounded dedupe window across a deploy — work that buys
   * nothing once the window has passed. Operators who want it gone immediately
   * may drop the collection by hand after deploy; the sweep makes it a cleanup,
   * not a prerequisite.
   */
  async sweepOlderThan(days = PLATFORM_EVENT_RETENTION_DAYS): Promise<number> {
    await this.ensureIndex();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await this.collection.deleteMany({ createdAt: { $lt: cutoff } });
    return result.deletedCount;
  }

  /** Shutdown hook target — the ledger owns its own client. */
  async close(): Promise<void> {
    await this.client.close();
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === 11000) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /E11000 duplicate key/i.test(msg);
}
