/**
 * The transfer approval queue contract
 * (ACL-05, ACL-10, T-06-31).
 *
 * The served projection the Users page's
 * transfer approval queue renders. The API
 * serves the transfer record minus Mongo's
 * `_id`, dates in their ISO wire form; this
 * structural schema validates the same key
 * set at the SPA boundary — an unvalidated
 * payload never reaches a component (the
 * `api/audit.ts` discipline).
 */

/** The transfer lifecycle (the domain vocabulary). */
export const TRANSFER_STATES = [
  'pending',
  'approved',
  'rejected',
  'auto-cancelled',
] as const;

export type TransferState = (typeof TRANSFER_STATES)[number];

/**
 * One served transfer request — the queue
 * row the global admin approves or rejects.
 */
export interface TransferRequestView {
  readonly transfer_id: string;
  readonly app_id: string;
  readonly from_user_id: string;
  readonly to_user_id: string;
  readonly state: TransferState;
  /** ISO wire form — the 7-day TTL's anchor. */
  readonly requestedAt: string;
  /** ISO wire form — requestedAt + 7 days. */
  readonly expiresAt: string;
  /** Present only once the record reached a terminal state. */
  readonly resolvedAt?: string;
}

/** The approval queue response (`GET /transfer-approvals`). */
export interface TransferApprovalQueueResponse {
  readonly transfers: readonly TransferRequestView[];
}

/**
 * The structural schema for one served
 * transfer. A malformed payload throws at
 * the boundary; an out-of-vocabulary state
 * is refused rather than rendered.
 */
export const TransferRequestViewSchema = {
  parse: (data: unknown): TransferRequestView => {
    const record = data as Partial<TransferRequestView> | null;
    if (
      typeof record !== 'object' ||
      record === null ||
      typeof record.transfer_id !== 'string' ||
      typeof record.app_id !== 'string' ||
      typeof record.from_user_id !== 'string' ||
      typeof record.to_user_id !== 'string' ||
      typeof record.requestedAt !== 'string' ||
      typeof record.expiresAt !== 'string' ||
      !TRANSFER_STATES.includes(record.state as TransferState)
    ) {
      throw new Error('malformed transfer request');
    }
    const { resolvedAt } = record;
    return {
      transfer_id: record.transfer_id,
      app_id: record.app_id,
      from_user_id: record.from_user_id,
      to_user_id: record.to_user_id,
      state: record.state as TransferState,
      requestedAt: record.requestedAt,
      expiresAt: record.expiresAt,
      ...(typeof resolvedAt === 'string' ? { resolvedAt } : {}),
    };
  },
};

/** The queue's structural schema. */
export const TransferApprovalQueueSchema = {
  parse: (data: unknown): TransferApprovalQueueResponse => {
    const payload = data as { transfers?: unknown };
    if (!Array.isArray(payload.transfers)) {
      throw new Error('malformed transfer approval queue');
    }
    return {
      transfers: payload.transfers.map((request) =>
        TransferRequestViewSchema.parse(request),
      ),
    };
  },
};
