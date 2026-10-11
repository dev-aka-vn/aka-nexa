import { Inject, Injectable } from '@nestjs/common';

import {
  REDIS_CACHE,
  incrementFixedWindow,
  type RedisEvalSeam,
} from '@akane/platform';

/**
 * CON-05 — rate limits are enforced per connector **instance**, shared across
 * every app that references it.
 *
 * ## Why the key is the connector instance and nothing else
 *
 * "Shared across every app referencing it" is the whole requirement: if the key
 * carried `app_id`, a noisy app would get its own private budget and the
 * downstream system would still see the sum of every app's traffic — the exact
 * failure CON-05 exists to prevent. Keying on the user would be worse still (an
 * office behind one NAT), and is already ruled out for the link path (AUD-10).
 * The connector instance is the *only* thing the downstream system actually
 * experiences, so it is the only thing that can be budgeted.
 *
 * ## Placement
 *
 * The consumer is the worker's delivery processor (`apps/worker`), which cannot
 * import `apps/api`. So the limiter lives in the `connectors` domain element,
 * where both the worker and any future process can reach it through
 * `@akane/domain`. It reuses the shared cache connection (`REDIS_CACHE`) via
 * `incrementFixedWindow` — one atomic implementation, not two.
 *
 * ## Fail-closed, never unlimited
 *
 * An **unknown** `connector_ref` never reaches this class: the registry throws
 * `ConnectorNotFoundError` first (see `ConnectorRegistry.limiterConfig`), so the
 * limiter only ever sees a connector that exists. A connector that exists but
 * declares **no** limiter config receives {@link DEFAULT_CONNECTOR_LIMIT} — the
 * conservative default — so "no config" can never be read as "no limit".
 */

/** A connector's budget: at most `max` calls per `windowMs`. */
export interface ConnectorLimitConfig {
  readonly max: number;
  readonly windowMs: number;
}

/**
 * The conservative default, applied whenever a connector declares no limit.
 *
 * 60/minute (1 rps) is deliberately close to the ceiling a single Redmine
 * instance is comfortable with; the seed's own `rate_limit.requests_per_minute`
 * is the intended override. Choosing a number here is not inventing product
 * policy — CON-05 requires a limit, and the alternative branch (unlimited) is
 * the failure mode the requirement names.
 */
export const DEFAULT_CONNECTOR_LIMIT: ConnectorLimitConfig = Object.freeze({
  max: 60,
  windowMs: 60_000,
});

/** Fixed key prefix, so the limiter can never collide with a token or outcome key. */
export const CONNECTOR_RATE_LIMIT_PREFIX = 'ak:rl:connector:';

export interface ConnectorLimitDecision {
  /** `false` means this call is the (max + 1)th in the current window. */
  readonly allowed: boolean;
  readonly count: number;
  readonly max: number;
  /** Milliseconds until the window resets. */
  readonly resetInMs: number;
}

/**
 * Thrown by the delivery processor when a call is over budget.
 *
 * It is a *transient* condition by construction — the next window will admit the
 * call — so the processor must let BullMQ's backoff retry it rather than mark
 * the submission permanently failed. Nothing in `sent_unconfirmed` is ever
 * auto-resent by reconciliation (DAT-07), so a throttled revision relies on the
 * queue retry to make progress.
 */
export class ConnectorRateLimitedError extends Error {
  constructor(
    readonly connectorRef: string,
    readonly resetInMs: number,
  ) {
    super(
      `Connector ${connectorRef} is over its rate limit; retry after ${resetInMs}ms`,
    );
    this.name = 'ConnectorRateLimitedError';
  }
}

/**
 * Validate a connector seed's `rate_limit` object.
 *
 * The seed shape (`config/connectors/*.json`) is `{ "requests_per_minute": n }`.
 * Anything absent, non-numeric, or below 1 is treated as **unconfigured** and
 * the caller applies {@link DEFAULT_CONNECTOR_LIMIT} — an invalid config is not
 * permission to be unlimited, and `requests_per_minute: 0` would mean "block
 * everything", which is more likely a mistake than an intent.
 */
export function parseConnectorLimit(raw: unknown): ConnectorLimitConfig | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const rpm = (raw as Record<string, unknown>)['requests_per_minute'];
  if (typeof rpm !== 'number' || !Number.isFinite(rpm) || rpm < 1) {
    return undefined;
  }
  return { max: Math.floor(rpm), windowMs: 60_000 };
}

@Injectable()
export class ConnectorRateLimiter {
  constructor(@Inject(REDIS_CACHE) private readonly redis: RedisEvalSeam) {}

  /**
   * Count one attempt against `connectorRef` and report whether it is admitted.
   *
   * The increment happens **before** the decision, including for the rejected
   * call: a caller that kept hammering an over-budget connector would otherwise
   * never advance the counter, and the window would expire with the attacker
   * having been rejected on every attempt but never extending the block.
   */
  async consume(
    connectorRef: string,
    config: ConnectorLimitConfig = DEFAULT_CONNECTOR_LIMIT,
  ): Promise<ConnectorLimitDecision> {
    const { count, resetInMs } = await incrementFixedWindow(
      this.redis,
      `${CONNECTOR_RATE_LIMIT_PREFIX}${connectorRef}`,
      config.windowMs,
    );

    return {
      allowed: count <= config.max,
      count,
      max: config.max,
      resetInMs,
    };
  }
}
