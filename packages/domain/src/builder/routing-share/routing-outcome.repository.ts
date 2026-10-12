import type { MongoService } from '@akane/platform';

/**
 * The routing-outcome store (OBS-05, APP-07 substrate).
 *
 * Every **applied** routing decision is recorded here as
 * `{ routing_id, intent_label, app_id, decidedAt }` — the
 * record both the publish gate's dry-run baseline and the
 * `routing_share{app_id}` gauge read. The record carries the
 * intent label the routing matched, never the raw question
 * text: the share is a distribution over the labelled intent
 * set (Pitfall 9), so the label is the record's identity.
 *
 * The repository is the only writer; the dry-run and the
 * metric are readers. The window is applied at read time, so
 * the same record serves both consumers at any age — the
 * rolling window the computer's `ROUTING_SHARE_WINDOW_MS`
 * names.
 */

/** The sentinel label for a routing whose question matched no declared label. */
export const UNLABELLED_INTENT_LABEL = 'unlabelled';

/** One applied routing decision, as recorded at the routing execution point. */
export interface RoutingOutcomeRecord {
  readonly routing_id: string;
  readonly intent_label: string;
  readonly app_id: string;
  readonly decidedAt: Date;
}

/** The write shape: `decidedAt` defaults to now (the application instant). */
export interface RoutingOutcomeInput {
  readonly routing_id: string;
  readonly intent_label: string;
  readonly app_id: string;
  readonly decidedAt?: Date;
}

/**
 * The outcome-store seam both consumers read through.
 * Structural — the Mongo repository implements it, and
 * the share computer, the publish gate and the tests'
 * in-memory doubles all speak it, so the dry-run's
 * baseline and the gauge's observation can never drift
 * onto two different read shapes.
 */
export interface RoutingOutcomeStore {
  record(outcome: RoutingOutcomeInput): Promise<void>;
  outcomesForIntent(
    intentLabel: string,
    windowMs: number,
  ): Promise<RoutingOutcomeRecord[]>;
  outcomesForApp(
    appId: string,
    windowMs: number,
  ): Promise<RoutingOutcomeRecord[]>;
}

export class RoutingOutcomeRepository implements RoutingOutcomeStore {
  constructor(private readonly mongo: MongoService) {}

  private get collection() {
    return this.mongo.db().collection<RoutingOutcomeRecord>('routing_outcomes');
  }

  private ensureIndexPromise: Promise<void> | null = null;

  /**
   * The lookup indexes — one per read shape (label window,
   * app window). Idempotent and memoised: a second call
   * reuses the first promise, so a boot storm cannot race
   * index creation.
   */
  private ensureIndex(): Promise<void> {
    if (this.ensureIndexPromise === null) {
      this.ensureIndexPromise = this.collection
        .createIndex({ intent_label: 1, decidedAt: 1 }, { background: true })
        .then(() =>
          this.collection.createIndex(
            { app_id: 1, decidedAt: 1 },
            { background: true },
          ),
        )
        .then(() => undefined)
        .catch(() => undefined);
    }
    return this.ensureIndexPromise;
  }

  /** Record one applied routing decision. */
  async record(outcome: RoutingOutcomeInput): Promise<void> {
    await this.ensureIndex();
    await this.collection.insertOne({
      routing_id: outcome.routing_id,
      intent_label: outcome.intent_label,
      app_id: outcome.app_id,
      decidedAt: outcome.decidedAt ?? new Date(),
    });
  }

  /** Every in-window record that matched one intent label. */
  async outcomesForIntent(
    intentLabel: string,
    windowMs: number,
  ): Promise<RoutingOutcomeRecord[]> {
    return this.collection
      .find({
        intent_label: intentLabel,
        decidedAt: { $gte: new Date(Date.now() - windowMs) },
      })
      .toArray();
  }

  /** Every in-window record that routed to one app. */
  async outcomesForApp(
    appId: string,
    windowMs: number,
  ): Promise<RoutingOutcomeRecord[]> {
    return this.collection
      .find({
        app_id: appId,
        decidedAt: { $gte: new Date(Date.now() - windowMs) },
      })
      .toArray();
  }
}
