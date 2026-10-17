import { Inject, Injectable } from '@nestjs/common';

import { RateLimitKeySchema, type RateLimitKey } from '@akane/contract';
import {
  REDIS_CACHE,
  incrementFixedWindow,
  type RedisEvalSeam,
} from '@akane/platform';

/**
 * AUD-10 — the second half: *rate limiting … blocks only on signature failure*,
 * applied per user and per link `jti`, never per IP.
 *
 * The first half is the frozen key contract (`packages/contract/src/links/
 * rate-limit-key.ts`): the address scope is unexpressible, so a per-IP limiter
 * cannot be written by accident. This file is the mechanic — a fixed-window
 * counter over the shared cache connection, keyed by {@link RateLimitKey}.
 *
 * ## "Blocks only on signature failure", precisely
 *
 * {@link recordSignatureFailure} is called **only** for a denial whose reason is
 * `bad_signature` — a presented token that did not verify (a bad signature, or a
 * signature-valid but structurally invalid claim set, which the verifier also
 * collapses to `bad_signature`). A denial for `expired`, `consumed`,
 * `wrong_version`, `deactivated_user`, `denied`, `not_found` or `not_owned` is a
 * *benign* outcome — a real user with a real link in a real state — and must
 * never count. If it did, a link that merely aged out would lock out the person
 * it was sent to, which is the per-IP failure mode wearing a different name.
 *
 * The counter therefore **is** the "signature_invalid" series in the alert rule
 * `block > 0 ∧ signature_invalid ≈ 0` (PITFALLS): if a block ever fires without a
 * signature failure behind it, the alert says the limiter is miscounting.
 *
 * ## The window is anchored on the first failure
 *
 * Budget: {@link SIGNATURE_FAILURE_MAX} failures per {@link SIGNATURE_FAILURE_WINDOW_MS},
 * per key. The number is not new policy — it is NFR-SEC-10's original
 * *"max 5 failed link validations per 10 minutes"*, with the scope changed from
 * **per IP** to **per user and per `jti`** by the AUD-10 ruling. The *fifth*
 * failure in a window is the one answered with a block; failures one through four
 * get the ordinary dead-link page.
 *
 * ## Why the read path can only supply the `link` key
 *
 * `ReadVerifyFailure` carries a `reason` and nothing else: on a crypto failure
 * there is no payload, and on a claim-shape failure the claims are, by
 * definition, not trustworthy. The read path therefore supplies the `link` key
 * (the `:jti` route segment, which matches the token's `jti` for logging).
 *
 * A `user` key is deliberately *not* derived from the unverified token's `sub`.
 * That would let anyone who can reach the endpoint forge a token bearing a
 * chosen victim's `sub` and drive that victim's counter to the block threshold —
 * a denial of service with the victim's own identity as the weapon. The contract
 * still admits a `user` key; it belongs to a caller that has a *verified*
 * identity, which this failure path by construction does not.
 */

/** Failures tolerated in one window before the next is blocked (NFR-SEC-10). */
export const SIGNATURE_FAILURE_MAX = 5;

/** The window NFR-SEC-10 specifies for the failure budget. */
export const SIGNATURE_FAILURE_WINDOW_MS = 600_000;

/** Fixed key prefix, so a signature-failure key can never collide with a token key. */
export const SIGNATURE_FAILURE_PREFIX = 'ak:rl:sigfail:';

export interface SignatureFailureDecision {
  /** `true` when this failure exhausted the budget — the caller must block. */
  readonly blocked: boolean;
  /** The keys this failure was recorded under, in the order supplied. */
  readonly keys: readonly RateLimitKey[];
  /** The highest observed count across the keys (the binding one). */
  readonly count: number;
  /** Milliseconds until the binding key's window resets. */
  readonly retryAfterMs: number;
}

function keyString(key: RateLimitKey): string {
  return `${SIGNATURE_FAILURE_PREFIX}${key.scope}:${key.id}`;
}

@Injectable()
export class SignatureFailureLimiter {
  constructor(@Inject(REDIS_CACHE) private readonly redis: RedisEvalSeam) {}

  /**
   * Record one signature failure under each key and report whether it blocked.
   *
   * Every key is incremented — including when one already blocks — so a client
   * that keeps hammering an exhausted key extends its own block rather than
   * letting the window lapse while it is still trying.
   *
   * The keys are validated against the frozen {@link RateLimitKeySchema} first:
   * `.strict()` rejects an unknown scope, `id` is `min(1)`, and an empty id
   * (which would key one bucket for every caller) is a programming error that
   * must throw rather than silently coalesce.
   */
  async recordSignatureFailure(
    keys: readonly RateLimitKey[],
  ): Promise<SignatureFailureDecision> {
    if (keys.length === 0) {
      throw new Error('recordSignatureFailure: at least one key is required');
    }
    const valid = keys.map((key) => RateLimitKeySchema.parse(key));

    const increments = await Promise.all(
      valid.map((key) =>
        incrementFixedWindow(this.redis, keyString(key), SIGNATURE_FAILURE_WINDOW_MS),
      ),
    );

    let count = 0;
    let retryAfterMs = 0;
    for (const increment of increments) {
      if (increment.count > count) {
        count = increment.count;
      }
      // The binding key is whichever blocks with the longest remaining window —
      // telling a caller to retry sooner than its longest block is a lie.
      if (increment.count >= SIGNATURE_FAILURE_MAX && increment.resetInMs > retryAfterMs) {
        retryAfterMs = increment.resetInMs;
      }
    }

    return {
      blocked: count >= SIGNATURE_FAILURE_MAX,
      keys: valid,
      count,
      retryAfterMs: retryAfterMs > 0 ? retryAfterMs : SIGNATURE_FAILURE_WINDOW_MS,
    };
  }
}
