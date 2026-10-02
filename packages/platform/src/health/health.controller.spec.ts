import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TerminusModule, type HealthIndicatorResult } from '@nestjs/terminus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigModule } from '../config/config.module.js';
import { mongoServiceProvider, MONGO_CLIENT } from '../mongo/index.js';
import { MongoService } from '../mongo/mongo.service.js';
import { REDIS_CACHE, REDIS_QUEUE } from '../redis/redis.constants.js';
import {
  redisCacheProvider,
  redisQueueProvider,
} from '../redis/redis.provider.js';
import {
  CORE_HEALTH_INDICATOR_KEYS,
  EXTRA_HEALTH_INDICATORS,
  HealthController,
} from './health.controller.js';

/**
 * The live/ready surface over HTTP (FND-05, D-10, T-1-17, T-1-18).
 *
 * The doubles are wired by overriding the *real* provider graph rather than by
 * declaring a parallel one, so the test also proves that `MONGO_CLIENT`,
 * `REDIS_CACHE`, and `REDIS_QUEUE` are the tokens the controller actually
 * injects and that plan 02's providers can satisfy them. Constructing them is
 * side-effect free: `MongoService` connects on first operation and both ioredis
 * clients are `lazyConnect`, so no socket is opened here.
 */
const MONGO_URL_LEAK = 'mongodb://akane:hunter2@mongo.internal:27017/akane';
const REDIS_URL_LEAK = 'redis://:hunter2@cache.internal:6379';

const workingMongo = { ping: async () => {} } as unknown as MongoService;
const deadMongo = {
  ping: () => Promise.reject(new Error(MONGO_URL_LEAK)),
} as unknown as MongoService;

const workingRedis = { ping: async () => 'PONG' };
const deadRedis = { ping: () => Promise.reject(new Error(REDIS_URL_LEAK)) };

function build(mongo: MongoService, cache: unknown, queue: unknown, extra?: () => Promise<HealthIndicatorResult>) {
  const builder = Test.createTestingModule({
    imports: [ConfigModule, TerminusModule.forRoot({ logger: false })],
    controllers: [HealthController],
    providers: [
      mongoServiceProvider,
      redisCacheProvider,
      redisQueueProvider,
      { provide: MONGO_CLIENT, useExisting: MongoService },
    ],
  })
    .overrideProvider(MONGO_CLIENT).useValue(mongo)
    .overrideProvider(REDIS_CACHE).useValue(cache)
    .overrideProvider(REDIS_QUEUE).useValue(queue);

  if (extra !== undefined) {
    builder
      .overrideProvider(EXTRA_HEALTH_INDICATORS)
      .useValue([extra] as const);
  }

  return builder.compile();
}

async function listen(moduleRef: Awaited<ReturnType<typeof build>>): Promise<{
  app: INestApplication;
  baseUrl: string;
}> {
  const app = moduleRef.createNestApplication();
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'string' ? 0 : address.port;
  return { app, baseUrl: `http://127.0.0.1:${port}` };
}

describe('GET /health/ready (FND-05, D-10)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await listen(await build(workingMongo, workingRedis, workingRedis)));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('always checks exactly the three core dependencies', async () => {
    expect([...CORE_HEALTH_INDICATOR_KEYS]).toEqual(['mongo', 'redis_cache', 'redis_queue']);
  });

  it('returns 200 with every dependency up', async () => {
    const response = await fetch(`${baseUrl}/health/ready`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      details: {
        mongo: { status: 'up' },
        redis_cache: { status: 'up' },
        redis_queue: { status: 'up' },
      },
    });
  });

  it('returns 503 naming redis_queue when only the queue deployment is down', async () => {
    const moduleRef = await build(workingMongo, workingRedis, deadRedis);
    const down = await listen(moduleRef);

    try {
      const response = await fetch(`${down.baseUrl}/health/ready`);

      expect(response.status).toBe(503);
      const body = (await response.json()) as {
        status: string;
        error: Record<string, { status: string }>;
        details: Record<string, { status: string }>;
      };
      expect(body.status).toBe('error');
      // The whole point of per-dependency readiness: the operator is told which
      // deployment is unhealthy, not merely that "something" is.
      expect(Object.keys(body.error)).toEqual(['redis_queue']);
      expect(body.details['redis_queue']).toEqual({ status: 'down' });
      expect(body.details['mongo']).toEqual({ status: 'up' });
      expect(body.details['redis_cache']).toEqual({ status: 'up' });
    } finally {
      await down.app.close();
    }
  }, 60_000);

  it('never puts a connection string, credential, or URL in the body (T-1-18)', async () => {
    const moduleRef = await build(deadMongo, deadRedis, deadRedis);
    const down = await listen(moduleRef);

    try {
      const response = await fetch(`${down.baseUrl}/health/ready`);
      const raw = await response.text();

      expect(response.status).toBe(503);
      expect(raw).not.toContain('mongodb://');
      expect(raw).not.toContain('redis://');
      expect(raw).not.toContain(':password@');
      expect(raw).not.toContain('hunter2');
      expect(raw).not.toContain('mongo.internal');
      expect(raw).not.toContain('cache.internal');
    } finally {
      await down.app.close();
    }
  }, 60_000);

  it('runs an injected extra indicator alongside the core three', async () => {
    const moduleRef = await build(workingMongo, workingRedis, workingRedis, async () => ({
      bullmq_workers: { status: 'up' as const },
    }));
    const extended = await listen(moduleRef);

    try {
      const response = await fetch(`${extended.baseUrl}/health/ready`);
      const body = (await response.json()) as {
        details: Record<string, { status: string }>;
      };

      expect(response.status).toBe(200);
      expect(Object.keys(body.details).sort()).toEqual([
        'bullmq_workers',
        'mongo',
        'redis_cache',
        'redis_queue',
      ]);
    } finally {
      await extended.app.close();
    }
  }, 60_000);
});

describe('GET /health/live (FND-05, D-10, T-1-17)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await listen(await build(deadMongo, deadRedis, deadRedis)));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('returns 200 with { status: "ok" } while every dependency is failing', async () => {
    const response = await fetch(`${baseUrl}/health/live`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('reads no dependency at all', async () => {
    const calls = { mongo: 0, cache: 0, queue: 0 };
    const countingMongo = {
      ping: async () => { calls.mongo += 1; },
    } as unknown as MongoService;
    const countingRedis = (which: 'cache' | 'queue') => ({
      ping: async () => { calls[which] += 1; return 'PONG'; },
    });
    const moduleRef = await build(countingMongo, countingRedis('cache'), countingRedis('queue'));
    const counting = await listen(moduleRef);

    try {
      await fetch(`${counting.baseUrl}/health/live`);
      await fetch(`${counting.baseUrl}/health/live`);

      expect(calls).toEqual({ mongo: 0, cache: 0, queue: 0 });
    } finally {
      await counting.app.close();
    }
  }, 60_000);
});
