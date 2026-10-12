/**
 * The session client (BLD-12, D-101).
 *
 * `GET /auth/me` is the only surface that reveals
 * the session's owner, and it reveals exactly the
 * opaque `real_user_id` and the MFA timestamp —
 * never a token, never the OIDC subject, never
 * PII (the PII-in-JWT constraint).
 *
 * The call rides the api client, so it carries
 * `credentials: 'same-origin'` (the httpOnly
 * `__Host-` cookie attaches) and no Authorization
 * header: the SPA holds no token anywhere. A 401
 * fires the client's redirect hook — the SPA
 * never reads the cookie to decide this.
 */

import {
  SessionMeResponseSchema,
  type SessionMeResponse,
} from '@akane/contract';

import type { ApiClient } from '../api/client.js';

/**
 * The session's own view of its owner. Rejects
 * with a {@link SessionAuthError} when the
 * session is missing or expired (the redirect
 * hook has already fired by then).
 */
export async function fetchSessionUser(
  client: ApiClient,
): Promise<SessionMeResponse> {
  return client.get('/auth/me', SessionMeResponseSchema);
}
