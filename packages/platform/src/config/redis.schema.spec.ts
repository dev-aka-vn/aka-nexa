import { describe, expect, it } from 'vitest';
import {
  REDIS_INSTANCES_NOT_DISTINCT,
  RedisConfigSchema,
} from './redis.schema.js';
import { validateConfig } from './config.schema.js';

const COMPLETE_CONFIG: Record<string, unknown> = {
  NODE_ENV: 'test',
  PORT: '3000',
  SERVICE_NAME: 'api',
  MONGO_URL: 'mongodb://127.0.0.1:27017/akane',
  REDIS_CACHE_URL: 'redis://cache.internal:6379',
  REDIS_QUEUE_URL: 'redis://queue.internal:6379',
  CRYPTO_KEY_PROVIDER: 'local',
};

describe('RedisConfigSchema — two distinct Redis deployments (FND-05, D-12)', () => {
  it('rejects two URLs that resolve to the same host and port', () => {
    const result = RedisConfigSchema.safeParse({
      REDIS_CACHE_URL: 'redis://same.internal:6379',
      REDIS_QUEUE_URL: 'redis://same.internal:6379',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(REDIS_INSTANCES_NOT_DISTINCT);
    }
  });

  it('accepts the same hostname on two different ports (local-dev / single-node case)', () => {
    const result = RedisConfigSchema.safeParse({
      REDIS_CACHE_URL: 'redis://localhost:6379',
      REDIS_QUEUE_URL: 'redis://localhost:6380',
    });

    expect(result.success).toBe(true);
  });

  it('accepts two different hosts on the same port', () => {
    const result = RedisConfigSchema.safeParse({
      REDIS_CACHE_URL: 'redis://cache.internal:6379',
      REDIS_QUEUE_URL: 'redis://queue.internal:6379',
    });

    expect(result.success).toBe(true);
  });

  it('does not treat a logical-database suffix as a second instance', () => {
    const result = RedisConfigSchema.safeParse({
      REDIS_CACHE_URL: 'redis://localhost:6379/0',
      REDIS_QUEUE_URL: 'redis://localhost:6379/1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(REDIS_INSTANCES_NOT_DISTINCT);
    }
  });

  it('aborts boot through the merged schema with the named issue token', () => {
    expect(() =>
      validateConfig({
        ...COMPLETE_CONFIG,
        REDIS_CACHE_URL: 'redis://localhost:6379',
        REDIS_QUEUE_URL: 'redis://localhost:6379',
      }),
    ).toThrowError(/^CONFIG_INVALID: <root> REDIS_INSTANCES_NOT_DISTINCT$/);
  });
});
