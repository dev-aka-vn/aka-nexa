/**
 * Builder auth contracts (BLD-12, D-101, D-110/IDN-08).
 *
 * These are the wire shapes the builder's auth surface exchanges.
 * They live beside the frozen contracts rather than modifying
 * them: `links/` (D-21) and `jev/` (D-23) stay untouched.
 *
 * ## What deliberately does **not** exist here
 *
 * No token, no OIDC claim, no session token. D-101's session is
 * an opaque Redis key delivered as an httpOnly `__Host-` cookie;
 * the only value this surface ever hands the browser is the
 * session's own `real_user_id` — an opaque id, never the OIDC
 * subject and never PII (the project's PII-in-JWT constraint
 * applied to the session surface).
 */

import { z } from 'zod';

/**
 * `GET /auth/me` — what the session reveals about its owner.
 *
 * `real_user_id` is the opaque identity the session middleware
 * resolves; `mfa_at` records when the D-102 gate last passed, so
 * the SPA can show "signed in with MFA" without ever seeing a
 * token.
 */
export const SessionMeResponseSchema = z
  .object({
    real_user_id: z.string().min(1),
    mfa_at: z.string().datetime(),
  })
  .strict();
export type SessionMeResponse = z.infer<typeof SessionMeResponseSchema>;

/**
 * `POST /users/sso-mappings` — the IDN-08 admin mapping payload.
 *
 * The global admin maps an SSO identity to an existing
 * `real_user_id` with no user OTP — the admin path IDN-08
 * defines, deliberately separate from the employee OTP
 * self-onboarding route (IDN-05).
 */
export const SsoMappingCreateSchema = z
  .object({
    oidcSub: z.string().min(1),
    realUserId: z.string().min(1),
  })
  .strict();
export type SsoMappingCreate = z.infer<typeof SsoMappingCreateSchema>;

/**
 * One SSO identity mapping — the IDN-08 record as the Users
 * page lists it. `platform` is always `oidc` here: the SSO
 * mapping surface only ever maps OIDC subjects.
 */
export const SsoMappingSchema = z
  .object({
    platform: z.literal('oidc'),
    oidc_sub: z.string().min(1),
    real_user_id: z.string().min(1),
    email: z.string().email().optional(),
  })
  .strict();
export type SsoMapping = z.infer<typeof SsoMappingSchema>;

/**
 * The inline, field-naming error every users-surface failure
 * returns (BLD-07: specific, actionable, never generic). A
 * mapping to an unknown `real_user_id` names the offending
 * field rather than answering "bad request".
 */
export const SsoMappingErrorSchema = z
  .object({
    error: z.string().min(1),
    field: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();
export type SsoMappingError = z.infer<typeof SsoMappingErrorSchema>;
