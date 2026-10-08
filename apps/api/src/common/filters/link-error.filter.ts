import type { ReadDenyReason } from '@akane/contract';

export enum LinkErrorCode {
  EXPIRED = 'EXPIRED',
  INVALID = 'INVALID',
  USED = 'USED',
  DENIED = 'DENIED',
  RATE_LIMITED = 'RATE_LIMITED',
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
}

export interface LinkError {
  code: LinkErrorCode;
  message: string;
  actionable: boolean;
}

/**
 * Actionable read-deny reasons — the user can self-serve by requesting a
 * fresh link through chat. Non-actionable reasons (deactivated_user,
 * not_found, not_owned, denied, invalid_action) are server/account-side
 * conditions where a new link would not help; the copy reflects that.
 */
const ACTIONABLE_READ_DENY_REASONS: ReadonlySet<ReadDenyReason> = new Set([
  'expired',
  'consumed',
  'revoked',
  'wrong_app',
  'wrong_version',
  'bad_signature',
] as ReadDenyReason[]);

/**
 * Maps every `ReadDenyReason` to user-facing copy (D-70).
 *
 * The mapping is exhaustive over the enum — the renderer's `DENY_REASON_COPY`
 * (in `apps/renderer/src/read/view.ts`) is the contract for the browser; this
 * table is the contract for the API's `LinkErrorFilter`. Both must agree on
 * the actionable set and the IM affordance wording, so they share the same
 * source of truth: the `ReadDenyReason` enum and the `ACTIONABLE_READ_DENY_REASONS`
 * set above.
 */
const READ_DENY_REASON_COPY: Record<ReadDenyReason, string> = {
  expired: 'This link has expired. Please request a new one via IM.',
  consumed: 'This link has already been used. Please request a new one via IM.',
  revoked: 'This link has been revoked. Please request a new one via IM.',
  wrong_app: 'This link cannot be used for this app. Please request a new one via IM.',
  wrong_version: 'This link is for an older version. Please request a new one via IM.',
  bad_signature: 'This link is invalid or has been tampered with. Please request a new one via IM.',
  deactivated_user: 'Your account is deactivated. Please contact your administrator.',
  not_found: 'The requested submission could not be found.',
  not_owned: 'You do not have permission to view this submission.',
  denied: 'You do not have permission to view this link.',
  invalid_action: 'This link type is not supported for read access.',
};

export class LinkErrorFilter {
  static getErrorMessage(code: LinkErrorCode): string {
    switch (code) {
      case LinkErrorCode.EXPIRED:
        return 'This link has expired. Please request a new one via IM.';
      case LinkErrorCode.INVALID:
        return 'This link is invalid. Please request a new one via IM.';
      case LinkErrorCode.USED:
        return 'This link has already been used. Please request a new one via IM.';
      case LinkErrorCode.DENIED:
        return 'Access denied. Please check your permissions or request access via IM.';
      case LinkErrorCode.RATE_LIMITED:
        return 'Too many requests. Please wait a moment and try again.';
      case LinkErrorCode.SUCCESS:
        return 'Your submission was successful.';
      case LinkErrorCode.FAILURE:
        return 'Your submission failed. Please try again or contact support via IM.';
      default:
        return 'An error occurred. Please try again.';
    }
  }

  static createError(code: LinkErrorCode): LinkError {
    return {
      code,
      message: this.getErrorMessage(code),
      actionable: code !== LinkErrorCode.SUCCESS && code !== LinkErrorCode.FAILURE,
    };
  }

  // ── Read-deny mapping (D-70) ──────────────────────────────────────────

  /**
   * Whether the user can self-serve by requesting a fresh link.
   *
   * `consumed` is structurally unreachable for read links (D-42: view/query
   * tokens set `consume: false`) but is included here so the reason set is
   * exhaustive and a stale issuer producing one gets the generic actionable
   * copy rather than an unhandled case.
   */
  static isActionableReadDenyReason(reason: ReadDenyReason): boolean {
    return ACTIONABLE_READ_DENY_REASONS.has(reason);
  }

  /**
   * User-facing copy for a read-deny reason (D-70).
   *
   * Falls back to `bad_signature` copy for an unknown reason — the same
   * fallback the renderer uses, so the API and browser agree on the
   * worst-case message.
   */
  static getReadDenyReasonCopy(reason: ReadDenyReason): string {
    if (reason in READ_DENY_REASON_COPY) {
      return READ_DENY_REASON_COPY[reason as ReadDenyReason];
    }
    return READ_DENY_REASON_COPY['bad_signature' as ReadDenyReason];
  }

  /**
   * Build a `LinkError` from a read-deny reason.
   *
   * `actionable` is true for reasons where the user can get a working link
   * again (expired, revoked, wrong_app, wrong_version, bad_signature, and
   * defensively `consumed`). Non-actionable reasons (deactivated_user,
   * not_found, not_owned, denied, invalid_action) carry `actionable: false`
   * because a new link would not resolve the underlying condition.
   */
  static fromReadDenyReason(reason: ReadDenyReason): LinkError {
    return {
      code: LinkErrorCode.DENIED,
      message: this.getReadDenyReasonCopy(reason),
      actionable: this.isActionableReadDenyReason(reason),
    };
  }
}
