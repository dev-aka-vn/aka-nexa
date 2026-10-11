/**
 * A single atomic fixed-window counter over Redis (CON-05, AUD-10).
 *
 * ## Why this is here and not in a domain module
 *
 * Two different rules need the *same* increment-and-expire primitive over the
 * **shared cache connection**: the per-connector-instance limiter (CON-05, owned
 * by `connectors`) and the read-link signature-failure limiter (AUD-10, owned by
 * `links`). The boundary graph does not let either domain element import the
 * other (`tooling/boundaries.config.mjs` ALLOWED_EDGES), and `platform` is the
 * one element both may reach — so the primitive lives here and each domain owns
 * its own key shape and thresholds. Two copies of the Lua below would be two
 * atomicity implementations that could drift; there is one.
 *
 * ## Why `INCR` + `PEXPIRE` in one script, and not `MULTI`
 *
 * `INCR` and `PEXPIRE` must be observed together: a concurrent caller that saw
 * the incremented value but not the expiry would read a key that never resets.
 * `eval` runs the whole body on the server, so the two commands cannot be
 * interleaved. Redis chooses the Lua branch atomically, so the "first hit sets
 * the window" rule survives N concurrent first hits — exactly one of them sets
 * the TTL and the rest read the TTL that was set.
 *
 * ## Never a second Redis client
 *
 * The caller passes the connection it already owns (`REDIS_CACHE`). BullMQ's
 * requirement that its own instance be `noeviction` is the reason the two
 * deployments exist at all (D-13); a limiter that reached for the queue
 * connection would put evicting cache traffic on the not-to-be-evicted
 * instance. `RedisEvalSeam` is the minimum shape needed, so a unit test can
 * inject a fake without an ioredis dependency.
 */

/** The minimum ioredis surface this module needs. */
export interface RedisEvalSeam {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

export interface FixedWindowIncrement {
  /** Total hits observed in the current window, including this one. */
  readonly count: number;
  /** Milliseconds until the window resets (the key's remaining TTL). */
  readonly resetInMs: number;
}

/**
 * `INCR`, then set the window only when this call created the key.
 *
 * Returns `{count, ttlMs}`. The `PTTL < 0` repair branch covers a key that had
 * its expiry lost (a `DEL`-then-`INCR` race, a manual flush): without it the
 * counter would increment forever and never reset, which is a permanent block
 * rather than a rate limit.
 */
export const FIXED_WINDOW_SCRIPT = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
    return {current, tonumber(ARGV[1])}
  end
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
  end
  return {current, ttl}
`;

/**
 * Increment `key` within a `windowMs` fixed window and report the count.
 *
 * The window is anchored on the first hit, not on a wall-clock boundary, so a
 * caller cannot race a reset at a minute edge into 2× the budget.
 */
export async function incrementFixedWindow(
  redis: RedisEvalSeam,
  key: string,
  windowMs: number,
): Promise<FixedWindowIncrement> {
  if (!Number.isInteger(windowMs) || windowMs <= 0) {
    throw new Error(`incrementFixedWindow: windowMs must be a positive integer, got ${windowMs}`);
  }

  const result = await redis.eval(FIXED_WINDOW_SCRIPT, 1, key, String(windowMs));
  if (!Array.isArray(result) || result.length < 2) {
    throw new Error('incrementFixedWindow: unexpected Redis reply');
  }

  const count = Number(result[0]);
  const resetInMs = Number(result[1]);
  if (!Number.isFinite(count) || !Number.isFinite(resetInMs)) {
    throw new Error('incrementFixedWindow: non-numeric Redis reply');
  }

  return { count, resetInMs: resetInMs < 0 ? windowMs : resetInMs };
}
