/**
 * The connector-request store (BLD-10, D-98, T-06-24).
 *
 * ## The one-pending invariant (T-06-24)
 *
 * Enforced **structurally** by a partial unique index on
 * `{ app_id, connector_id }` with
 * `partialFilterExpression: { state: 'pending' }` —
 * created idempotently on first use (the
 * `AppDefinitionRepository` pattern), so a boot storm
 * cannot race index creation. The index covers pending
 * rows **only**: a provisioned or rejected request for
 * the pair never blocks a fresh request, which is what
 * makes the retry flow (a fresh `request_id` after a
 * terminal state) expressible at the data layer.
 *
 * The driver's `11000` duplicate-key failure is mapped
 * to the named {@link ConnectorRequestPendingExistsError}
 * refusal — the same discipline the `apps` collection's
 * unique `app_id` index uses. The service-level check is
 * the second half of the invariant: a read-then-refuse
 * that names the existing pending `request_id` in the
 * message, so the admin sees *which* request blocks
 * theirs even when the two requests did not race.
 *
 * ## What this repository never holds
 *
 * A credential. The document carries the definition
 * **minus the secret** (D-99); the only secret-adjacent
 * field is the operator-set `credential_ref` opaque
 * handle, and there is no code path here — or anywhere
 * on a builder surface — that can write a value or an
 * envelope into one.
 */

import { MongoService } from '@akane/platform';

import {
  ConnectorRequestPendingExistsError,
} from './connector-request.errors.js';
import type { ConnectorRequestDocument } from './connector-request.document.js';

/** Options for leaving the `pending` state. */
export interface ConnectorRequestTransitionOptions {
  /** The refusal/cancel reason (a `rejected` transition). */
  readonly reason?: string;
  /** The opaque credential handle the operator set (a `provisioned` transition). */
  readonly credentialRef?: string;
}

export class ConnectorRequestRepository {
  constructor(private readonly mongo: MongoService) {}

  private get collection() {
    return this.mongo
      .db()
      .collection<ConnectorRequestDocument>('connector_requests');
  }

  private ensureIndexPromise: Promise<void> | null = null;

  /**
   * The one-pending partial unique index (T-06-24) —
   * unique over `(app_id, connector_id)`, covering
   * `state = 'pending'` rows only. Idempotent and
   * memoised, so a second call reuses the first
   * promise.
   */
  private ensureIndex(): Promise<void> {
    if (this.ensureIndexPromise === null) {
      this.ensureIndexPromise = this.collection
        .createIndex(
          { app_id: 1, connector_id: 1 },
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
   * Persist a new request. The document is constructed
   * by the service (identity, actor, `pending` state,
   * `requestedAt`) — this method owns the write and the
   * duplicate-key mapping.
   */
  async create(
    document: ConnectorRequestDocument,
  ): Promise<ConnectorRequestDocument> {
    await this.ensureIndex();
    const { _id, ...withoutId } = document;
    try {
      await this.collection.insertOne(
        withoutId as ConnectorRequestDocument,
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConnectorRequestPendingExistsError(
          document.app_id,
          document.connector_id,
          document.request_id,
        );
      }
      throw error;
    }
    return document;
  }

  /** The pending request for the pair, or `null`. */
  async findPending(
    appId: string,
    connectorId: string,
  ): Promise<ConnectorRequestDocument | null> {
    return this.collection.findOne({
      app_id: appId,
      connector_id: connectorId,
      state: 'pending',
    });
  }

  /** One request by its immutable identity. */
  async findByRequestId(
    requestId: string,
  ): Promise<ConnectorRequestDocument | null> {
    return this.collection.findOne({ request_id: requestId });
  }

  /** Every request for the app, newest first. */
  async listByApp(
    appId: string,
  ): Promise<ConnectorRequestDocument[]> {
    return this.collection
      .find({ app_id: appId })
      .sort({ requestedAt: -1 })
      .toArray();
  }

  /**
   * Every pending request across every app — the
   * operator's queue (the CLI provision step's read).
   */
  async listPending(): Promise<ConnectorRequestDocument[]> {
    return this.collection
      .find({ state: 'pending' })
      .sort({ requestedAt: 1 })
      .toArray();
  }

  /**
   * Move a request to a terminal state (or back
   * through one), stamping `resolvedAt` and carrying
   * the reason and/or the credential handle. Returns
   * the updated document, or `null` when no request
   * carries the `request_id`.
   */
  async transition(
    requestId: string,
    to: ConnectorRequestDocument['state'],
    options: ConnectorRequestTransitionOptions = {},
  ): Promise<ConnectorRequestDocument | null> {
    const current = await this.collection.findOne({
      request_id: requestId,
    });
    if (current === null) {
      return null;
    }

    const updated: ConnectorRequestDocument = {
      ...current,
      state: to,
      resolvedAt: new Date(),
      ...(options.reason === undefined
        ? {}
        : { reason: options.reason }),
      ...(options.credentialRef === undefined
        ? {}
        : { credential_ref: options.credentialRef }),
    };
    const { _id, ...withoutId } = updated;
    return this.collection.findOneAndUpdate(
      { request_id: requestId },
      { $set: { ...withoutId } },
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
