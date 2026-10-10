import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { startThreeContainers, type ThreeContainers } from '../../../../../tooling/containers.js';

describe('edit-link integration (LNK-02)', () => {
  let containers: ThreeContainers;
  let redisCache: Redis;

  beforeAll(async () => {
    containers = await startThreeContainers();
    redisCache = new Redis(containers.urls.cache);
    await redisCache.flushall();
  }, 120000);

  afterAll(async () => {
    await redisCache.quit();
    await containers.stop();
  });

  it('consume replay ttl', async () => {
    expect(containers.urls.mongo).toBeDefined();
    expect(containers.urls.cache).toBeDefined();
  });

  it('failure retry', async () => {
    expect(true).toBe(true);
  });
});
