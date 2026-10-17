/**
 * The transfer-request document (ACL-05) —
 * the `transfer_requests` collection's own
 * shape.
 *
 * The owner requests (ACL-10); a global
 * admin approves or rejects; a pending
 * record past its 7-day `expiresAt` is
 * auto-cancelled by the hourly job. The
 * `resolvedAt` stamp appears only once the
 * record reached a terminal state.
 */

/** The transfer lifecycle (ACL-05). */
export type TransferState =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'auto-cancelled';

/** One ownership-transfer request. */
export interface TransferRequestDocument {
  /** MongoDB document `_id` — present on read, absent on write. */
  readonly _id?: string;
  /** The transfer's immutable identity. */
  readonly transfer_id: string;
  /** The app whose ownership is requested. */
  readonly app_id: string;
  /** The requesting (current) owner. */
  readonly from_user_id: string;
  /** The requested target owner. */
  readonly to_user_id: string;
  readonly state: TransferState;
  /** When the owner requested the transfer. */
  readonly requestedAt: Date;
  /** The 7-day TTL — requestedAt + 7 days. */
  readonly expiresAt: Date;
  /** Set when the record reached a terminal state. */
  readonly resolvedAt?: Date;
}
