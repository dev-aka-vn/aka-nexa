/**
 * The connector-request document (BLD-10, D-98).
 *
 * The **full connector definition minus the secret** (D-99):
 * every field of the `ConnectorSeed` interface the operator's
 * provision step consumes, except the credential value — which
 * never exists on this document in any form. The credential
 * enters the system only through the operator's
 * `ConnectorCredentialsRepository.upsert` write (D-100), and
 * the document carries nothing but the opaque `credential_ref`
 * handle that write produces.
 *
 * ## The lifecycle (D-98)
 *
 * `pending → provisioned | rejected` — and a rejected request
 * may be re-issued as a **fresh** request (a new `request_id`),
 * because the one-pending-per-`(app_id, connector_id)`
 * invariant (T-06-24) is scoped to `pending` alone.
 */

/** The request lifecycle (D-98). */
export type ConnectorRequestState = 'pending' | 'provisioned' | 'rejected';

/**
 * One connector request in the `connector_requests` collection.
 *
 * `request_id` is a `crypto.randomUUID()` — the Node stdlib
 * UUID, no dependency (the PRD's IDs are UUID-shaped).
 */
export interface ConnectorRequestDocument {
  readonly _id?: string;
  /** The immutable request identity — a stdlib randomUUID. */
  readonly request_id: string;
  /** The app the request belongs to (the builder's `app_id`). */
  readonly app_id: string;
  /** The requesting admin — the session's `real_user_id`. */
  readonly requested_by: string;
  /** The connector type being requested (the seed's identity). */
  readonly connector_id: string;
  /** Display name for the Connectors page. */
  readonly name: string;
  /** The external system's base URL. */
  readonly base_url: string;
  readonly timeout_ms?: number;
  readonly retries?: number;
  readonly rate_limit?: Record<string, unknown>;
  readonly mapping?: Record<string, unknown>;
  readonly taxonomy?: Record<string, unknown>;
  readonly state: ConnectorRequestState;
  /** The refusal/cancel reason, served on the status badge. */
  readonly reason?: string;
  /**
   * The opaque credential handle the operator sets on
   * provision — a `connector_credentials` `_id`, never a
   * value, never an envelope (D-99, T-06-23).
   */
  readonly credential_ref?: string;
  readonly requestedAt: Date;
  /** Set when the request leaves `pending`. */
  readonly resolvedAt?: Date;
}
