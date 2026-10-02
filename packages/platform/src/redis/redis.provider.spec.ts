import { describe, expect, it } from 'vitest';
import { BULLMQ_PREFIX } from '../queue/queue.constants.js';
import {
  PRODUCER_MAX_RETRIES_PER_REQUEST,
  buildRedisOptions,
  createRedisClient,
} from './redis.provider.js';

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
