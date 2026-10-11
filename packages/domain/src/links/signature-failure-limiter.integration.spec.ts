import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createRedisClient } from '@akane/platform';

import {
  SIGNATURE_FAILURE_MAX,
  SIGNATURE_FAILURE_WINDOW_MS,
  SignatureFailureLimiter,
} from './signature-failure-limiter.js';
import { startThreeContainers, type ThreeContainers } from '../../../../tooling/containers.js';

/**
 * AUD-10 — the signature-failure limiter, over a real Redis.
 *
 * The load-bearing assertions are the two halves of the ruling:
 *
 *  1. *per user and per link `jti`* — two keys are independent, and a key is a
 *     key regardless of where the request came from. There is no address in the
 *     key space at all — the frozen contract makes one unexpressible — so a
 *     second `rate-limit-key` test (in `@akane/contract`) covers that half.
 *  2. *blocks only on signature failure* — the limiter has no notion of a
 *     reason; it counts what it is told. The controller is what decides, and it
 *     tells the limiter only for `bad_signature` (see
 *     `apps/api/src/read/read.controller.spec.ts`, "five benign failures are
 *     never counted and never block").
 */
describe('SignatureFailureLimiter (AUD-10)', () => {
  let containers: ThreeContainers;
  let redis: ReturnType<typeof createRedisClient>;

  beforeAll(async () => {
    containers = await startThreeContainers();
    redis = createRedisClient({ url: containers.urls.cache, profile: 'producer' });
    await redis.connect();
    await redis.flushall();
  }, 120000);

  afterAll(async () => {
    await redis?.quit();
    await containers?.stop();
  });

  it('blocks on the fifth signature failure in the window — not the fourth', async () => {
    const limiter = new SignatureFailureLimiter(redis);
    const key = { scope: 'link' as const, id: 'jti-fails' };

    for (let i = 1; i < SIGNATURE_FAILURE_MAX; i += 1) {
      const decision = await limiter.recordSignatureFailure([key]);
      expect(decision.count).toBe(i);
      expect(decision.blocked).toBe(false);
    }

    const fifth = await limiter.recordSignatureFailure([key]);
    expect(fifth.count).toBe(SIGNATURE_FAILURE_MAX);
    expect(fifth.blocked).toBe(true);
    // A caller is told to retry after the window it is inside, not before.
    expect(fifth.retryAfterMs).toBeGreaterThan(0);
    expect(fifth.retryAfterMs).toBeLessThanOrEqual(SIGNATURE_FAILURE_WINDOW_MS);
  });

  it('keys per link jti and per user independently — one link blocking does not block another', async () => {
    const limiter = new SignatureFailureLimiter(redis);

    // Exhaust one link key.
    for (let i = 0; i < SIGNATURE_FAILURE_MAX; i += 1) {
      await limiter.recordSignatureFailure([{ scope: 'link', id: 'jti-a' }]);
    }
    const blockedA = await limiter.recordSignatureFailure([{ scope: 'link', id: 'jti-a' }]);
    expect(blockedA.blocked).toBe(true);

    // A different jti is untouched — a block on one link is not a block on all.
    const freshLink = await limiter.recordSignatureFailure([{ scope: 'link', id: 'jti-b' }]);
    expect(freshLink.count).toBe(1);
    expect(freshLink.blocked).toBe(false);

    // And the user scope is a distinct key space from the link scope.
    const userKey = await limiter.recordSignatureFailure([{ scope: 'user', id: 'u_1' }]);
    expect(userKey.count).toBe(1);
    expect(userKey.blocked).toBe(false);
  });

  it('blocks when ANY supplied key is over budget (per user AND per link jti)', async () => {
    const limiter = new SignatureFailureLimiter(redis);

    await limiter.recordSignatureFailure([{ scope: 'link', id: 'jti-multi' }]);

    // Drive the user key to the limit.
    for (let i = 1; i < SIGNATURE_FAILURE_MAX; i += 1) {
      await limiter.recordSignatureFailure([{ scope: 'user', id: 'u_multi' }]);
    }

    // Presenting both: the exhausted user key blocks even though the link key
    // is only on its second failure.
    const decision = await limiter.recordSignatureFailure([
      { scope: 'link', id: 'jti-multi' },
      { scope: 'user', id: 'u_multi' },
    ]);
    expect(decision.count).toBe(SIGNATURE_FAILURE_MAX);
    expect(decision.blocked).toBe(true);
    expect(decision.keys).toEqual([
      { scope: 'link', id: 'jti-multi' },
      { scope: 'user', id: 'u_multi' },
    ]);
  });

  it('rejects an invalid key rather than coalescing every caller into one bucket', async () => {
    const limiter = new SignatureFailureLimiter(redis);

    await expect(limiter.recordSignatureFailure([])).rejects.toThrow(/at least one key/);
    // An empty id would key one bucket for every caller; the frozen schema
    // rejects it (min(1)).
    await expect(
      limiter.recordSignatureFailure([{ scope: 'link', id: '' }]),
    ).rejects.toThrow();
  });
});
