import { HealthIndicatorService } from '@nestjs/terminus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MongoService } from '../mongo/mongo.service.js';
import { MongoIndicator } from './mongo.indicator.js';
import { RedisIndicator } from './redis.indicator.js';

/**
 * Indicator units (FND-05, T-1-18).
 *
 * Two properties are under test, and the second is the one a test written
 * only for "up/down" would miss:
 *
 *  1. Each indicator reports up or down for the *right* reason.
 *  2. Neither ever puts the failure's message in the result — a
 *     `MongoServerSelectionError` or an ioredis `ReplyError` both embed the
 *     host, the port, and sometimes credentials, and the readiness body is
 *     readable by anyone who can reach the port. A "down" that carried the
 *     driver message would be an information disclosure on an endpoint with no
 *     authentication.
 */
describe('dependency health indicators (FND-05)', () => {
  let healthIndicator: HealthIndicatorService;

  beforeEach(() => {
    healthIndicator = new HealthIndicatorService();
  });

  const mongoDouble = (ping: () => Promise<void>): MongoService =>
    ({ ping }) as unknown as MongoService;

  describe('MongoIndicator', () => {
    it('reports up when ping() resolves', async () => {
      const indicator = new MongoIndicator(mongoDouble(async () => {}), healthIndicator);

      await expect(indicator.check()).resolves.toEqual({ mongo: { status: 'up' } });
    });

    it('reports down when ping() rejects, without carrying the driver message', async () => {
      const indicator = new MongoIndicator(
        mongoDouble(() =>
          Promise.reject(
            new Error('connection to mongodb://user:hunter2@db.internal:27017 failed'),
          ),
        ),
        healthIndicator,
      );

      const result = await indicator.check();

      expect(result).toEqual({ mongo: { status: 'down' } });
      expect(JSON.stringify(result)).not.toContain('hunter2');
      expect(JSON.stringify(result)).not.toContain('mongodb://');
    });

    it('uses the key it is given so a caller can distinguish instances', async () => {
      const indicator = new MongoIndicator(mongoDouble(async () => {}), healthIndicator);

      await expect(indicator.check('mongo_replica')).resolves.toEqual({
        mongo_replica: { status: 'up' },
      });
    });
  });

  describe('RedisIndicator', () => {
    const pong = { ping: vi.fn(async () => 'PONG') };
    const boom = { ping: vi.fn(() => Promise.reject(new Error('READONLY redis://cache:6379'))) };

    it('defaults its key to the deployment name it was constructed with', async () => {
      const indicator = new RedisIndicator('redis_queue', pong, healthIndicator);

      await expect(indicator.check()).resolves.toEqual({ redis_queue: { status: 'up' } });
    });

    it('reports up only when PING answers PONG', async () => {
      const indicator = new RedisIndicator('redis_cache', pong, healthIndicator);

      await expect(indicator.check()).resolves.toEqual({ redis_cache: { status: 'up' } });
    });

    it('reports down when PING answers something else', async () => {
      const indicator = new RedisIndicator(
        'redis_cache',
        { ping: async () => 'NOT-PONG' },
        healthIndicator,
      );

      await expect(indicator.check()).resolves.toEqual({ redis_cache: { status: 'down' } });
    });

    it('reports down without carrying the connection URL when PING rejects', async () => {
      const indicator = new RedisIndicator('redis_cache', boom, healthIndicator);

      const result = await indicator.check();

      expect(result).toEqual({ redis_cache: { status: 'down' } });
      expect(JSON.stringify(result)).not.toContain('redis://');
    });
  });
});
