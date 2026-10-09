/**
 * Read-only view renderer utilities (D-68, D-70).
 */

import { ReadDenyReason } from '@akane/contract';

export interface ReadLinkParams {
  readonly jti?: string;
  readonly token?: string;
  readonly reason?: string;
}

/**
 * Maps denial reasons to user-facing copy (D-70).
 */
export const DENY_REASON_COPY: Record<ReadDenyReason, string> = {
  [ReadDenyReason.expired]:
    'This link has expired. Please request a new one via IM.',
  [ReadDenyReason.consumed]:
    'This link has already been used. Please request a new one via IM.',
  [ReadDenyReason.revoked]:
    'This link has been revoked. Please request a new one via IM.',
  [ReadDenyReason.wrong_app]:
    'This link cannot be used for this app. Please request a new one via IM.',
  [ReadDenyReason.wrong_version]:
    'This link is for an older version. Please request a new one via IM.',
  [ReadDenyReason.bad_signature]:
    'This link is invalid or has been tampered with. Please request a new one via IM.',
  [ReadDenyReason.deactivated_user]:
    'Your account is deactivated. Please contact your administrator.',
  [ReadDenyReason.not_found]:
    'The requested submission could not be found.',
  [ReadDenyReason.not_owned]:
    'You do not have permission to view this submission.',
  [ReadDenyReason.denied]:
    'You do not have permission to view this link.',
  [ReadDenyReason.invalid_action]:
    'This link type is not supported for read access.',
};

export function getDenyReasonCopy(reason: ReadDenyReason): string {
  if (reason in DENY_REASON_COPY) {
    return DENY_REASON_COPY[reason];
  }
  return DENY_REASON_COPY[ReadDenyReason.bad_signature];
}

/**
 * Parses a read-link URL, extracting jti, token, and reason.
 * Accepts either query params or path patterns.
 */
export function parseReadLinkUrl(url: string): ReadLinkParams | null {
  try {
    // Use URL with fallback base for relative URLs
    const parsed = new URL(url, 'https://render.example');
    const token = parsed.searchParams.get('token');
    const jtiParam = parsed.searchParams.get('jti');
    const reason = parsed.searchParams.get('reason');

    let jti = jtiParam;

    if (!jti && parsed.pathname.includes('/l/view/')) {
      const parts = parsed.pathname.split('/l/view/');
      if (parts.length > 1 && parts[1]) {
        jti = parts[1].split('?')[0].split('#')[0];
      }
    }

    if (!jti && !token && !reason) {
      return {
        jti: undefined,
        token: undefined,
        reason: undefined,
      };
    }

    return {
      jti: jti ?? undefined,
      token: token ?? undefined,
      reason: reason ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Detects if the page represents a dead link.
 */
export function isDeadLink(params: ReadLinkParams | string | null | undefined): boolean {
  if (typeof params === 'string') {
    return params.length > 0;
  }
  if (!params) {
    return false;
  }
  return typeof params.reason === 'string' && params.reason.length > 0;
}
