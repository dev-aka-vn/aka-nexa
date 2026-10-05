import { z } from 'zod';

/**
 * The rate-limit key shape (AUD-10).
 *
 * AUD-10 reads: *rate limiting is applied per user and per link `jti`, never
 * per IP, and blocks only on signature failure*. This file is the first half
 * of that rule, expressed as a type rather than as a convention.
 *
 * ## Why "never per IP" needs a type
 *
 * Per-IP limiting is not wrong in general — it is wrong *here*, and quietly so.
 * The platform's users sit behind corporate NATs and VPN concentrators, so one
 * address is frequently an entire office. A per-IP limiter therefore does not
 * protect the platform, it throttles a department, and the symptom presents as
 * "HR users report the bot is down" with nothing in the logs to explain it.
 *
 * A throttler key that *admits* an address scope is one refactor away from that
 * outcome, so the address is not a member of the union at all. There is no
 * `ip`, no `address`, no `cidr` and no `remote_addr` — the failure is not
 * discouraged, it is unexpressible.
 *
 * The second half of AUD-10 (block only on signature failure) belongs to the
 * link-verification path, not here.
 */
export const RateLimitScopeSchema = z.enum(['user', 'link']);

export type RateLimitScope = z.infer<typeof RateLimitScopeSchema>;

export const RateLimitKeySchema = z
  .object({
    /** `user` → `id` is `real_user_id`; `link` → `id` is the token's `jti`. */
    scope: RateLimitScopeSchema,
    /** Opaque, never empty: an empty id would key one bucket for every caller. */
    id: z.string().min(1),
  })
  .strict();

export type RateLimitKey = z.infer<typeof RateLimitKeySchema>;
