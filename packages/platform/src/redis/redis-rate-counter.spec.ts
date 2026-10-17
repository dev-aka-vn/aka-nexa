import { describe, it, expect, vi } from 'vitest';

import {
  FIXED_WINDOW_SCRIPT,
  incrementFixedWindow,
  type RedisEvalSeam,
} from './redis-rate-counter.js';

/**
 * Unit coverage for the shared fixed-window primitive (CON-05, AUD-10).
 *
 * The live-Redis behaviour (atomicity across processes) is proven by
 * `packages/domain/src/connectors/rate-limit.integration.spec.ts`; this file
 * pins the contract the two domain callers depend on — what is sent to Redis,
 * and how the reply is normalised — without an ioredis dependency.
 */
function seamReturning(reply: unknown): RedisEvalSeam & { eval: ReturnType<typeof vi.fn> } {
  return { eval: vi.fn().mockResolvedValue(reply) } as never;
}

describe('incrementFixedWindow', () => {
  it('passes the key and window as KEYS[1] / ARGV[1] to the single-key script', async () => {
    const redis = seamReturning([1, 60000]);

    const result = await incrementFixedWindow(redis, 'ak:rl:connector:redmine-dev', 60_000);

    expect(result).toEqual({ count: 1, resetInMs: 60000 });
    expect(redis.eval).toHaveBeenCalledWith(
      FIXED_WINDOW_SCRIPT,
      1,
      'ak:rl:connector:redmine-dev',
      '60000',
    );
  });

  it('reports the remaining TTL on a subsequent hit', async () => {
    const redis = seamReturning([3, 42000]);
    await expect(incrementFixedWindow(redis, 'k', 60_000)).resolves.toEqual({
      count: 3,
      resetInMs: 42000,
    });
  });

  it('repairs a lost expiry by falling back to the full window', async () => {
    // The Lua `PTTL < 0` branch means "the key had no expiry"; the primitive
    // must not surface a negative reset time to a caller computing retry-after.
    const redis = seamReturning([2, -1]);
    await expect(incrementFixedWindow(redis, 'k', 30_000)).resolves.toEqual({
      count: 2,
      resetInMs: 30000,
    });
  });

  it('rejects a non-positive or non-integer window before touching Redis', async () => {
    const redis = seamReturning([1, 1]);
    await expect(incrementFixedWindow(redis, 'k', 0)).rejects.toThrow(/windowMs/);
    await expect(incrementFixedWindow(redis, 'k', -5)).rejects.toThrow(/windowMs/);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('fails loudly on an unexpected Redis reply', async () => {
    await expect(incrementFixedWindow(seamReturning(null), 'k', 1000)).rejects.toThrow(
      /unexpected Redis reply/,
    );
    await expect(incrementFixedWindow(seamReturning('OK'), 'k', 1000)).rejects.toThrow(
      /unexpected Redis reply/,
    );
    await expect(incrementFixedWindow(seamReturning(['x', 'y']), 'k', 1000)).rejects.toThrow(
      /non-numeric Redis reply/,
    );
  });
});
