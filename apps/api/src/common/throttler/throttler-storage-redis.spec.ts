import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { ThrottlerStorageRedis } from './throttler-storage-redis.js';
import { startThreeContainers, type ThreeContainers } from '../../../../../tooling/containers.js';

describe('ThrottlerStorageRedis (CON-05)', () => {
  let containers: ThreeContainers;
  let redis1: Redis;
  let redis2: Redis;

  beforeAll(async () => {
    containers = await startThreeContainers();
    redis1 = new Redis(containers.urls.cache);
    redis2 = new Redis(containers.urls.cache);
    await redis1.flushall();
  }, 120000);

  afterAll(async () => {
    await redis1.quit();
    await redis2.quit();
    await containers.stop();
  });

  it('uses Redis (not in-memory Map) - second instance shares same state', async () => {
    const storage1 = new ThrottlerStorageRedis(redis1);
    const storage2 = new ThrottlerStorageRedis(redis2);

    const res1 = await storage1.increment('conn:connector1', 60);
    expect(res1.totalHits).toBe(1);
    expect(res1.timeToExpire).toBeGreaterThan(0);

    const res2 = await storage2.increment('conn:connector1', 60);
    expect(res2.totalHits).toBe(2); // shares state across instances
  });

  it('returns atomic increments with expiry in seconds', async () => {
    const key = 'conn:connector2';
    const storage = new ThrottlerStorageRedis(redis1);
    await redis1.del(key);

    const r1 = await storage.increment(key, 10);
    expect(r1.totalHits).toBe(1);
    expect(r1.timeToExpire).toBe(10);

    const r2 = await storage.increment(key, 10);
    expect(r2.totalHits).toBe(2);
    expect(r2.timeToExpire).toBe(10);
  });
});
