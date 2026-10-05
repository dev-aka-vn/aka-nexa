import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { BULLMQ_PREFIX } from '../queue/queue.constants.js';
import {
  PRODUCER_MAX_RETRIES_PER_REQUEST,
  buildRedisOptions,
  createRedisClient,
  redisShutdownProvider,
} from './redis.provider.js';
import { REDIS_CACHE, REDIS_QUEUE } from './redis.constants.js';

describe('ioredis connection profiles (D-14, FND-05)', () => {
  it('gives the producer profile a finite maxRetriesPerRequest in 1..3', () => {
    const options = buildRedisOptions('producer');

    expect(typeof options.maxRetriesPerRequest).toBe('number');
    expect(options.maxRetriesPerRequest).toBe(PRODUCER_MAX_RETRIES_PER_REQUEST);
    expect(options.maxRetriesPerRequest).toBeGreaterThanOrEqual(1);
    expect(options.maxRetriesPerRequest).toBeLessThanOrEqual(3);
  });

  it('gives the blocking profile a null maxRetriesPerRequest for BullMQ', () => {
    expect(buildRedisOptions('blocking').maxRetriesPerRequest).toBeNull();
  });

  it('never sets keyPrefix on any profile options object', () => {
    expect('keyPrefix' in buildRedisOptions('producer')).toBe(false);
    expect('keyPrefix' in buildRedisOptions('blocking')).toBe(false);
  });

  it('constructs a lazy client that carries the profile retry semantics', () => {
    const client = createRedisClient({
      url: 'redis://127.0.0.1:6399',
      profile: 'producer',
    });

    try {
      // lazyConnect: no socket is opened, so this is safe without a server.
      expect(client.options.lazyConnect).toBe(true);
      expect(client.options.maxRetriesPerRequest).toBe(
        PRODUCER_MAX_RETRIES_PER_REQUEST,
      );
    } finally {
      client.disconnect();
    }
  });

  it('uses the single BullMQ hash-tag prefix constant', () => {
    expect(BULLMQ_PREFIX).toBe('{akane-q}');
  });
});

/**
 * CR-02 — both connections drain on shutdown.
 *
 * This is the test whose absence is why the leak survived Phase 1 review: the
 * two clients were built by `useFactory` providers, and a factory has no
 * teardown hook, so nothing in the tree ever closed them. `app.close()` ran, the
 * Mongo hook ran, OTel flushed, and both Redis sockets were simply dropped as
 * the process exited — silently, and with a zero exit code.
 *
 * `close()` is the same path `enableShutdownHooks()` drives on SIGTERM, so this
 * asserts the deployed behaviour rather than a helper called in isolation.
 */
describe('RedisShutdown — D-09 requires the clients to drain, not be severed', () => {
  /**
   * `lazyConnect: true` means these clients never opened a socket, and the ports
   * are closed, so a real `QUIT` would attempt a connection and its promise
   * would never settle. The lifecycle *wiring* is therefore asserted through
   * `quit` spies here — and the real drain is asserted against live containers in
   * `redis.integration.spec.ts`. Spying is honest about what it checks: the
   * hook drives both clients, rather than the hook changes the clients.
   */
  const moduleWith = (providers: unknown[]) =>
    Test.createTestingModule({ providers: providers as never[] }).compile();

  it('QUITs both connections when the Nest container is closed', async () => {
    const cache = createRedisClient({ url: 'redis://127.0.0.1:6397', profile: 'producer' });
    const queue = createRedisClient({ url: 'redis://127.0.0.1:6398', profile: 'producer' });
    const cacheQuit = vi.spyOn(cache, 'quit');
    const queueQuit = vi.spyOn(queue, 'quit');

    const moduleRef = await moduleWith([
      { provide: REDIS_CACHE, useValue: cache },
      { provide: REDIS_QUEUE, useValue: queue },
      redisShutdownProvider,
    ]);

    expect(cacheQuit).not.toHaveBeenCalled();
    expect(queueQuit).not.toHaveBeenCalled();

    await moduleRef.close();

    expect(cacheQuit, 'the cache connection must be drained').toHaveBeenCalledTimes(1);
    expect(queueQuit, 'the queue connection must be drained').toHaveBeenCalledTimes(1);
  });

  it('leaves the clients open when the owner is not registered — the counterfactual', async () => {
    const cache = createRedisClient({ url: 'redis://127.0.0.1:6397', profile: 'producer' });
    const queue = createRedisClient({ url: 'redis://127.0.0.1:6398', profile: 'producer' });
    const cacheQuit = vi.spyOn(cache, 'quit');
    const queueQuit = vi.spyOn(queue, 'quit');

    // The exact wiring Phase 1 shipped: two factories, no owner. Without this
    // case the test above could pass for a `quit` that nothing asked for.
    const moduleRef = await moduleWith([
      { provide: REDIS_CACHE, useValue: cache },
      { provide: REDIS_QUEUE, useValue: queue },
    ]);
    await moduleRef.close();

    expect(cacheQuit).not.toHaveBeenCalled();
    expect(queueQuit).not.toHaveBeenCalled();
  });

  it('drains the other connection even when one quit rejects', async () => {
    const cache = createRedisClient({ url: 'redis://127.0.0.1:6397', profile: 'producer' });
    const queue = createRedisClient({ url: 'redis://127.0.0.1:6398', profile: 'producer' });
    const cacheQuit = vi.spyOn(cache, 'quit').mockRejectedValue(new Error('already gone'));
    const queueQuit = vi.spyOn(queue, 'quit').mockResolvedValue('OK' as never);

    const moduleRef = await moduleWith([
      { provide: REDIS_CACHE, useValue: cache },
      { provide: REDIS_QUEUE, useValue: queue },
      redisShutdownProvider,
    ]);

    // A shutdown hook that throws would abort the remaining `onModuleDestroy`
    // hooks in the process — Mongo and the OTel flush run after this one, so a
    // Redis server that vanished mid-deploy would take telemetry down with it.
    await expect(moduleRef.close()).resolves.toBeUndefined();
    expect(cacheQuit).toHaveBeenCalledTimes(1);
    expect(queueQuit, 'one failure must not skip the second connection').toHaveBeenCalledTimes(1);
  });
});

/**
 * The wiring half. `RedisShutdown` is only useful if the composition roots that
 * register a client also register the owner, and omitting it fails in the one
 * way that cannot announce itself: every assertion about booting still passes.
 * The three entrypoints are asserted by source text for the same reason
 * `BOUNDARY_MANIFEST` is — that is the DI-level question a closure walk cannot
 * answer.
 */
describe('RedisShutdown — registration in every composition root', () => {
  const APP_MODULES = ['api', 'worker', 'scheduler'] as const;

  for (const app of APP_MODULES) {
    it(`${app} registers the drain alongside both clients`, () => {
      const source = readFileSync(
        fileURLToPath(new URL(`../../../../apps/${app}/src/app.module.ts`, import.meta.url)),
        'utf8',
      );

      expect(source, `${app} must register redisCacheProvider`).toContain('redisCacheProvider');
      expect(source, `${app} must register redisQueueProvider`).toContain('redisQueueProvider');
      expect(
        source,
        `${app} registers a Redis client, so it must register redisShutdownProvider — D-09`,
      ).toContain('redisShutdownProvider');
    });
  }

  it('finds the three app modules it means to inspect', () => {
    // Non-vacuity: a bad path makes every assertion above pass vacuously,
    // exactly as the reachability tests in `entrypoint-drift.spec.ts` guard
    // against for the import closure.
    for (const app of APP_MODULES) {
      const source = readFileSync(
        fileURLToPath(new URL(`../../../../apps/${app}/src/app.module.ts`, import.meta.url)),
        'utf8',
      );
      expect(source).toContain('@Module(');
    }
  });
});
