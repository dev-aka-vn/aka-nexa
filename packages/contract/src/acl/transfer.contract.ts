/**
 * Ownership-transfer contracts (ACL-05,
 * ACL-10, T-06-31).
 *
 * The self-service boundary an app owner
 * drives: the owner **requests** a transfer
 * (the target owner is the only input), a
 * **global admin** approves or rejects it,
 * and a pending request past its 7-day TTL
 * is auto-cancelled by the hourly job.
 *
 * ## The served projection
 *
 * `TransferRequestResponseSchema` is the
 * projection every transfer read path
 * serves — the record minus Mongo's `_id`,
 * dates in their ISO wire form. No field
 * here can carry anything but the transfer's
 * own identity and state.
 */

import { z } from 'zod';

/**
 * The owner's request — the transfer target
 * is the only input. `.strict()` so a
 * smuggled field is rejected inline with the
 * field named (BLD-07's never-generic
 * discipline).
 */
export const TransferRequestCreateSchema = z
  .object({
    new_owner_user_id: z.string().min(1).max(128),
  })
  .strict();

export type TransferRequestCreate = z.infer<
  typeof TransferRequestCreateSchema
>;

/** The transfer lifecycle (ACL-05). */
export const TransferStateSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'auto-cancelled',
]);

export type TransferState = z.infer<
  typeof TransferStateSchema
>;

/**
 * The served projection — the transfer
 * record minus Mongo's `_id`. `requestedAt`
 * and `expiresAt` (the 7-day TTL) are
 * served in their ISO wire form; `resolvedAt`
 * appears only once the record reached a
 * terminal state.
 */
export const TransferRequestResponseSchema = z
  .object({
    transfer_id: z.string().min(1),
    app_id: z.string().min(1),
    from_user_id: z.string().min(1),
    to_user_id: z.string().min(1),
    state: TransferStateSchema,
    requestedAt: z.string().min(1),
    expiresAt: z.string().min(1),
    resolvedAt: z.string().optional(),
  })
  .strict();

export type TransferRequestResponse = z.infer<
  typeof TransferRequestResponseSchema
>;

/** The global admin's approval queue. */
export const TransferApprovalQueueSchema = z
  .object({
    transfers: z.array(TransferRequestResponseSchema),
  })
  .strict();

export type TransferApprovalQueue = z.infer<
  typeof TransferApprovalQueueSchema
>;
