import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

import { REDIS_CACHE } from '@akane/platform';

export interface ThrottlerStorage {
  increment(key: string, ttl: number): Promise<{ totalHits: number; timeToExpire: number }>;
}

@Injectable()
export class ThrottlerStorageRedis implements ThrottlerStorage {
  constructor(@Inject(REDIS_CACHE) private readonly redis: Redis) {}

  async increment(key: string, ttl: number): Promise<{ totalHits: number; timeToExpire: number }> {
    const ttlMs = ttl * 1000;

    const lua = `
      local current = redis.call('INCR', KEYS[1])
      if current == 1 then
        redis.call('PEXPIRE', KEYS[1], ARGV[1])
        return {current, ARGV[1]}
      end
      local ttl = redis.call('PTTL', KEYS[1])
      if ttl < 0 then
        redis.call('PEXPIRE', KEYS[1], ARGV[1])
        ttl = ARGV[1]
      end
      return {current, ttl}
    `;
    const result = (await this.redis.eval(lua, 1, key, String(ttlMs))) as [number, number];
    const totalHits = result[0];
    const timeToExpireMs = result[1] < 0 ? ttlMs : result[1];
    const timeToExpire = Math.ceil(timeToExpireMs / 1000);
    return { totalHits, timeToExpire };
  }
}
