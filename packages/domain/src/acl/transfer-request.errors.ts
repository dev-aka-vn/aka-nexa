/**
 * The transfer-request refusals (ACL-05,
 * ACL-10, T-06-31, BLD-07).
 *
 * Every refusal is **inline and specific**: a
 * `BuilderError` carrying a `code` and a
 * message that names the rule, which the
 * `BuilderExceptionFilter` maps to a status
 * and renders as `{error: {code, message}}` —
 * never a generic "something went wrong".
 */

import { z } from 'zod';

import { BuilderError } from '../builder/app-lifecycle.js';

/**
 * A pending transfer request already exists
 * for the app — the partial unique index's
 * named refusal. The message names the
 * pending `transfer_id`, so the owner's next
 * step is visible: wait for the global
 * admin, or let the 7-day TTL auto-cancel
 * it.
 */
export class TransferPendingExistsError extends BuilderError {
  constructor(appId: string, transferId: string) {
    super(
      'TRANSFER_PENDING_EXISTS',
      `a pending transfer request already exists for ${appId}: ${transferId}`,
    );
  }
}

/** No transfer carries that `transfer_id`. */
export class TransferNotFoundError extends BuilderError {
  constructor(transferId: string) {
    super(
      'TRANSFER_NOT_FOUND',
      `transfer request not found: ${transferId}`,
    );
  }
}

/**
 * The transfer is not in a state the
 * transition may leave: approve and reject
 * operate on `pending` only — an approved,
 * rejected, or auto-cancelled record (an
 * auto-cancelled one included, T-06-31) is
 * refused.
 */
export class TransferTransitionError extends BuilderError {
  constructor(
    transferId: string,
    from: string,
    rule: string,
  ) {
    super(
      'TRANSFER_ILLEGAL_TRANSITION',
      `transfer request ${transferId} is ${from}: ${rule}`,
    );
  }
}

/**
 * The actor is not a global admin (ACL-05).
 * The approval is a global-admin action —
 * the role check is a **service-level
 * guard**, so the refusal fires even when
 * the call reaches the service directly,
 * not just through the route.
 */
export class GlobalAdminRequiredError extends BuilderError {
  constructor() {
    super(
      'GLOBAL_ADMIN_REQUIRED',
      'global-admin session required',
    );
  }
}

/**
 * The transfer request payload failed
 * validation — the offending field is named
 * in the message (BLD-07). A `BuilderError`
 * so the `BuilderExceptionFilter` renders it
 * inline as a 400, never a generic 500.
 */
export class TransferValidationError extends BuilderError {
  constructor(
    public readonly issues: readonly z.core.$ZodIssue[],
  ) {
    super(
      'TRANSFER_VALIDATION',
      issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; '),
    );
  }
}
