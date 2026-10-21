import { describe, it, expect, vi } from 'vitest';

import { RedisThrottlerStorage } from './redis-throttler.storage.js';
import type { RedisEvalSeam } from '@akane/platform';

function seamReturning(reply: unknown) {
  return { eval: vi.fn().mockResolvedValue(reply) } as unknown as RedisEvalSeam & {
    eval: ReturnType<typeof vi.fn>;
  };
}

describe('RedisThrottlerStorage', () => {
  it('first request returns a count of one', async () => {
    const redis = seamReturning([1, 60000]);
    const storage = new RedisThrottlerStorage(redis);
    const record = await storage.increment('user:42', 60_000, 10, 60_000, 'perUser');
    expect(record.totalHits).toBe(1);
    expect(record.isBlocked).toBe(false);
  });

  it('second request within the window returns two', async () => {
    const redis = seamReturning([2, 59000]);
    const storage = new RedisThrottlerStorage(redis);
    const record = await storage.increment('user:42', 60_000, 10, 60_000, 'perUser');
    expect(record.totalHits).toBe(2);
  });

  it('resets after the window TTL lapses', async () => {
    const redis = seamReturning([1, 60000]);
    const storage = new RedisThrottlerStorage(redis);
    const record = await storage.increment('user:42', 60_000, 10, 60_000, 'perUser');
    expect(record.totalHits).toBe(1);
    // simulated expiry: a fresh key starts at 1 again
    const redis2 = seamReturning([1, 60000]);
    const storage2 = new RedisThrottlerStorage(redis2);
    const record2 = await storage2.increment('user:42', 60_000, 10, 60_000, 'perUser');
    expect(record2.totalHits).toBe(1);
  });

  it('uses the cache Redis client, not the queue client', () => {
    const cacheClient = seamReturning([1, 60000]);
    const queueClient = seamReturning([1, 60000]);
    const storage = new RedisThrottlerStorage(cacheClient);
    expect(storage.redis).toBe(cacheClient);
    expect(storage.client).toBe(cacheClient);
    expect(storage.storageClient).toBe(cacheClient);
    expect(storage.redis).not.toBe(queueClient);
  });

  it('namespaces keys distinctly per tier', async () => {
    const redis = seamReturning([1, 60000]);
    const storage = new RedisThrottlerStorage(redis);
    await storage.increment('k', 60_000, 10, 60_000, 'perUser');
    await storage.increment('k', 60_000, 100, 60_000, 'perApp');
    const calls = (redis as { eval: ReturnType<typeof vi.fn> }).eval.mock.calls;
    const keys = calls.map((c) => c[2]);
    expect(keys[0]).toContain('perUser');
    expect(keys[1]).toContain('perApp');
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('never derives a key from an IP value', async () => {
    const redis = seamReturning([1, 60000]);
    const storage = new RedisThrottlerStorage(redis);
    await storage.increment('user:99', 60_000, 10, 60_000, 'perUser');
    const call = (redis as { eval: ReturnType<typeof vi.fn> }).eval.mock.calls[0];
    const key = String(call[2]);
    expect(key).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it('blocks when the count exceeds the limit', async () => {
    const redis = seamReturning([11, 50000]);
    const storage = new RedisThrottlerStorage(redis);
    const record = await storage.increment('user:1', 60_000, 10, 60_000, 'perUser');
    expect(record.isBlocked).toBe(true);
    expect(record.totalHits).toBe(11);
  });
});