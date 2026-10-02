import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  EVICTING_POLICIES,
  QUEUE_MAXMEMORY_POLICY,
  readMaxMemoryPolicy,
  startThreeContainers,
  type ThreeContainers,
} from '../../../../tooling/containers.js';
import { RedisConfigSchema } from '../config/redis.schema.js';
import {
  buildRedisOptions,
  createRedisClient,
  PRODUCER_MAX_RETRIES_PER_REQUEST,
} from './redis.provider.js';

/**
 * The two-Redis split, proven against live containers (D-07, D-12, D-13, D-14).
 *
 * Everything asserted here is a property the deployment depends on and that
 * **cannot** be observed from a single Redis. `maxmemory-policy` is
 * instance-wide: one container serving both roles would report one policy, one
 * `/0` vs `/1` logical split would still be one instance, and the failure mode
 * is silent — BullMQ's keys would start being evicted under cache pressure,
 * and the jobs would simply be gone. So the topology is asserted directly,
 * against two servers, and every other plan may rely on it.
 */
describe('cache / queue Redis split (D-07, D-12)', () => {
  let containers: ThreeContainers;
  const clients: Array<{ quit(): Promise<unknown> }> = [];

  beforeAll(async () => {
    containers = await startThreeContainers();
  }, 300_000);

  afterAll(async () => {
    await Promise.allSettled(clients.map((client) => client.quit()));
    await containers?.stop();
  });

  const client = (url: string, profile: 'producer' | 'blocking') => {
    const created = createRedisClient({ url, profile });
    clients.push(created);
    return created;
  };

  it('runs the queue deployment with noeviction and the cache deployment with an evicting policy', async () => {
    const queuePolicy = await readMaxMemoryPolicy(containers.queue);
    const cachePolicy = await readMaxMemoryPolicy(containers.cache);

    expect(queuePolicy).toBe(QUEUE_MAXMEMORY_POLICY);
    expect(EVICTING_POLICIES).toContain(cachePolicy);
    // Belt and braces: the two answers must actually differ. Two containers
    // reporting the same policy would satisfy both assertions above in a
    // harness that silently started the same image twice.
    expect(cachePolicy).not.toBe(queuePolicy);
  }, 60_000);

  it('binds the two URLs to two distinct host:port deployments', async () => {
    const cacheHost = new URL(containers.urls.cache).host;
    const queueHost = new URL(containers.urls.queue).host;

    expect(cacheHost).not.toBe(queueHost);

    // The same comparison the boot guard makes, run against the topology the
    // harness actually produced. If this ever disagreed with
    // `refineRedisInstancesDistinct`, the unit test would be asserting a
    // fiction and a real deployment would boot into a split that does not
    // exist.
    const parsed = RedisConfigSchema.safeParse({
      REDIS_CACHE_URL: containers.urls.cache,
      REDIS_QUEUE_URL: containers.urls.queue,
    });

    expect(parsed.success).toBe(true);
  });

  it('keeps the two deployments from sharing state', async () => {
    const cacheClient = client(containers.urls.cache, 'producer');
    const queueClient = client(containers.urls.queue, 'producer');

    await cacheClient.set('ak:pv:split-probe', 'cache-value');

    // A key written through the cache client is invisible through the queue
    // client. This is the empirical form of "two instances": a single server
    // (or a /0 vs /1 logical split) would answer here and the whole readiness
    // story about which deployment is down would be a fiction.
    expect(await cacheClient.get('ak:pv:split-probe')).toBe('cache-value');
    expect(await queueClient.get('ak:pv:split-probe')).toBeNull();

    expect(await cacheClient.ping()).toBe('PONG');
    expect(await queueClient.ping()).toBe('PONG');
  }, 60_000);

  it('gives the request-path clients a finite retry budget and the blocking client none (D-14)', () => {
    expect(buildRedisOptions('producer').maxRetriesPerRequest).toBe(
      PRODUCER_MAX_RETRIES_PER_REQUEST,
    );
    expect(buildRedisOptions('blocking').maxRetriesPerRequest).toBeNull();

    // `keyPrefix` is asserted on the pure factory, never on a constructed
    // client: ioredis normalises `keyPrefix: ""` into `client.options`
    // regardless of input, so a client-side assertion passes vacuously.
    expect(Object.keys(buildRedisOptions('producer'))).not.toContain('keyPrefix');
    expect(Object.keys(buildRedisOptions('blocking'))).not.toContain('keyPrefix');
  });

  it('builds two distinct client instances, one per deployment', () => {
    const cacheClient = client(containers.urls.cache, 'producer');
    const queueClient = client(containers.urls.queue, 'producer');
    const blockingClient = client(containers.urls.queue, 'blocking');

    expect(cacheClient).not.toBe(queueClient);
    expect(blockingClient).not.toBe(queueClient);
  });
});
