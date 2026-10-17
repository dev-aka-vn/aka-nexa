/**
 * The transfer-request store (ACL-05, ACL-10,
 * T-06-31).
 *
 * ## The one-pending-transfer-per-app invariant
 *
 * Enforced **structurally** by a partial unique
 * index on `{ app_id }` with
 * `partialFilterExpression: { state: 'pending' }`
 * — created idempotently on first use (the
 * `ConnectorRequestRepository` pattern), so a
 * boot storm cannot race index creation. The
 * index covers pending rows **only**: an
 * approved, rejected, or auto-cancelled
 * transfer for the app never blocks a fresh
 * request, which is what makes the re-request
 * flow (after a rejection, or after the 7-day
 * TTL auto-cancels) expressible at the data
 * layer.
 *
 * The driver's `11000` duplicate-key failure is
 * mapped to the named
 * {@link TransferPendingExistsError} refusal.
 *
 * ## The expiry read
 *
 * `listExpired` reads the pending queue and
 * applies the TTL predicate in the repository,
 * not in a Mongo operator: the pending set is
 * bounded by one row per app (the partial
 * unique index), so the explicit
 * `expiresAt <= now` comparison is the honest
 * shape of the rule the hourly job enforces —
 * and it is the rule the caller can see, not a
 * query string.
 */

import { MongoService } from '@akane/platform';

import { TransferPendingExistsError } from './transfer-request.errors.js';
import type { TransferRequestDocument } from './transfer-request.document.js';

export class TransferRequestRepository {
  constructor(private readonly mongo: MongoService) {}

  private get collection() {
    return this.mongo
      .db()
      .collection<TransferRequestDocument>('transfer_requests');
  }

  private ensureIndexPromise: Promise<void> | null = null;

  /**
   * The one-pending partial unique index
   * (ACL-05) — unique over `app_id`, covering
   * `state = 'pending'` rows only. Idempotent
   * and memoised, so a second call reuses the
   * first promise.
   */
  private ensureIndex(): Promise<void> {
    if (this.ensureIndexPromise === null) {
      this.ensureIndexPromise = this.collection
        .createIndex(
          { app_id: 1 },
          {
            unique: true,
            partialFilterExpression: { state: 'pending' },
          },
        )
        .then(() => undefined)
        .catch(() => undefined);
    }
    return this.ensureIndexPromise;
  }

  /**
   * Persist a new request. The document is
   * constructed by the service (identity, actor,
   * `pending` state, the 7-day `expiresAt`) —
   * this method owns the write and the
   * duplicate-key mapping.
   */
  async create(
    document: TransferRequestDocument,
  ): Promise<TransferRequestDocument> {
    await this.ensureIndex();
    const { _id, ...withoutId } = document;
    try {
      await this.collection.insertOne(
        withoutId as TransferRequestDocument,
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new TransferPendingExistsError(
          document.app_id,
          document.transfer_id,
        );
      }
      throw error;
    }
    return document;
  }

  /** One transfer by its immutable identity. */
  async findByTransferId(
    transferId: string,
  ): Promise<TransferRequestDocument | null> {
    return this.collection.findOne({ transfer_id: transferId });
  }

  /**
   * The global admin's approval queue — every
   * pending transfer across every app, newest
   * first.
   */
  async listPending(): Promise<TransferRequestDocument[]> {
    const cursor = await this.collection.find({
      state: 'pending',
    });
    return cursor.sort({ requestedAt: -1 }).toArray();
  }

  /**
   * The pending requests whose 7-day TTL has
   * lapsed at `now` — the hourly auto-cancel
   * job's read. The TTL predicate is applied
   * here, over the bounded pending set, so the
   * expiry rule is one explicit comparison.
   */
  async listExpired(
    now: Date,
  ): Promise<TransferRequestDocument[]> {
    const pending = await this.listPending();
    return pending.filter(
      (request) => request.expiresAt.getTime() <= now.getTime(),
    );
  }

  /**
   * Move a transfer to a terminal state,
   * stamping `resolvedAt`. Returns the updated
   * document, or `null` when no transfer
   * carries the `transfer_id`.
   */
  async transition(
    transferId: string,
    to: TransferRequestDocument['state'],
    options: { resolvedAt?: Date } = {},
  ): Promise<TransferRequestDocument | null> {
    return this.collection.findOneAndUpdate(
      { transfer_id: transferId },
      {
        $set: {
          state: to,
          resolvedAt: options.resolvedAt ?? new Date(),
        },
      },
      { returnDocument: 'after' },
    );
  }
}

/** The driver's duplicate-key failure — the partial unique index firing. */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}
