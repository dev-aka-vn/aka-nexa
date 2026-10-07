import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Redis as IORedis } from 'ioredis';

import {
  CACHE_MAXMEMORY_POLICY,
  REDIS_IMAGE,
} from '../../../../tooling/containers.js';
import {
  canonicalSameThreadText,
  DecisionCacheService,
} from './decision-cache.service.js';

/**
 * RTE-09 against a real Redis (cache deployment, evicting policy, no keyPrefix).
 * TTL expiry, cross-context isolation, and stale-epoch invalidation are each
 * pinned here; the cache can never bypass fresh RBAC on hit (Pitfall 1).
 */
describe('DecisionCacheService (RTE-09)', () => {
  let container: StartedRedisContainer;
  let redis: IORedis;

  const base = {
    realUserId: 'u1',
    conversationId: 'c1',
    permEpoch: 'e1',
    pubThresholdVersion: 'v1',
    toolIds: ['leave-request', 'laptop-support'],
    locale: 'en',
  };

  beforeAll(async () => {
    // Only the cache deployment is needed; the three-container harness is
    // MongoDB-bound, and mongo:8.0 does not boot on this kernel (6.19+).
    container = await new RedisContainer(REDIS_IMAGE)
      .withCommand(['redis-server', '--maxmemory-policy', CACHE_MAXMEMORY_POLICY])
      .start();
    redis = new IORedis(container.getConnectionUrl(), { lazyConnect: true, maxRetriesPerRequest: 2 });
    await redis.connect();
  }, 300_000);

  afterAll(async () => {
    await redis?.quit().catch(() => {});
    await container?.stop();
  }, 300_000);

  it('key shape namespaces user, conversation, permission epoch, and publication/threshold version', async () => {
    const cache = new DecisionCacheService(redis, 60);
    const key = cache.keyFor({
      ...base,
      canonicalText: canonicalSameThreadText('I need leave', []),
    });
    const segments = key.split(':');
    // jev : decision : user : conversation : epoch : pubVersion : sha256
    expect(segments[0]).toBe('jev');
    expect(segments[1]).toBe('decision');
    expect(segments[2]).toBe('u1');
    expect(segments[3]).toBe('c1');
    expect(segments[4]).toBe('e1');
    expect(segments[5]).toBe('v1');
    expect(segments[6]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('round-trips a decision JSON with a configurable TTL', async () => {
    const cache = new DecisionCacheService(redis, 2);
    const input = { ...base, canonicalText: canonicalSameThreadText('round trip', []) };
    await cache.set(input, '{"ok":true}');
    expect(await cache.get(input)).toBe('{"ok":true}');
    const ttl = await redis.ttl(cache.keyFor(input));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(2);
  });

  it('expires entries after the TTL', async () => {
    const cache = new DecisionCacheService(redis, 1);
    const input = { ...base, canonicalText: canonicalSameThreadText('expires soon', []) };
    await cache.set(input, '{"ok":true}');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await cache.get(input)).toBeNull();
  }, 10_000);

  it('a single-turn entry never satisfies a multi-turn follow-up', async () => {
    const cache = new DecisionCacheService(redis, 60);
    const turn1 = canonicalSameThreadText('I need leave', []);
    await cache.set({ ...base, canonicalText: turn1 }, '{"choice":"leave"}');
    const followUp = canonicalSameThreadText('I need leave', ['Which one?', 'the IT one']);
    expect(await cache.get({ ...base, canonicalText: followUp })).toBeNull();
  });

  it('the same reply text in a different user/thread/epoch/locale/toolset misses', async () => {
    const cache = new DecisionCacheService(redis, 60);
    const text = canonicalSameThreadText('same reply everywhere', []);
    await cache.set({ ...base, canonicalText: text }, '{"choice":"leave"}');

    expect(await cache.get({ ...base, realUserId: 'u2', canonicalText: text })).toBeNull();
    expect(await cache.get({ ...base, conversationId: 'c2', canonicalText: text })).toBeNull();
    expect(await cache.get({ ...base, permEpoch: 'e2', canonicalText: text })).toBeNull();
    expect(await cache.get({ ...base, pubThresholdVersion: 'v2', canonicalText: text })).toBeNull();
    expect(await cache.get({ ...base, locale: 'vi', canonicalText: text })).toBeNull();
    expect(await cache.get({ ...base, toolIds: ['leave-request'], canonicalText: text })).toBeNull();
    // ...and the exact same context still hits.
    expect(await cache.get({ ...base, canonicalText: text })).toBe('{"choice":"leave"}');
  });

  it('tool-id ordering does not change the key', async () => {
    const cache = new DecisionCacheService(redis, 60);
    const a = cache.keyFor({ ...base, toolIds: ['b', 'a'], canonicalText: 'x' });
    const b = cache.keyFor({ ...base, toolIds: ['a', 'b'], canonicalText: 'x' });
    expect(a).toBe(b);
  });

  it('a stale permission epoch invalidates reuse', async () => {
    const cache = new DecisionCacheService(redis, 60);
    const text = canonicalSameThreadText('epoch check', []);
    await cache.set({ ...base, permEpoch: 'e1', canonicalText: text }, '{"choice":"leave"}');
    // Permission epoch bumped (ACL revision): the e1 entry is unreachable.
    expect(await cache.get({ ...base, permEpoch: 'e2', canonicalText: text })).toBeNull();
    await cache.invalidate({ ...base, permEpoch: 'e1', canonicalText: text });
    expect(await cache.get({ ...base, permEpoch: 'e1', canonicalText: text })).toBeNull();
  });
});
