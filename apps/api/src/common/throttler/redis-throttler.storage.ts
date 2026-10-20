import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface.js';
import {
  incrementFixedWindow,
  type RedisEvalSeam,
} from '@akane/platform';

/**
 * Hand-written `ThrottlerStorage` over the shared cache Redis connection
 * (OBS-08, D-19). Reuses the atomic fixed-window primitive in
 * `packages/platform/src/redis/redis-rate-counter.ts` rather than a second
 * Lua script, so the throttler and the existing per-connector / per-link
 * limiters share one atomicity implementation.
 *
 * ## Why the cache connection, never the queue connection
 *
 * The cache deployment is evictable (`allkeys-lru`) and the queue deployment
 * is `noeviction`. Limiter traffic must stay on the former: putting
 * evictable counter keys on a `noeviction` instance is how a queue stalls
 * under load. The constructor receives the cache client and stores it; the
 * spec asserts identity so a wiring mistake that swaps the two connections
 * fails loudly.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(public readonly redis: RedisEvalSeam) {}

  /** Alias so callers/tests can refer to the client by either name. */
  get client(): RedisEvalSeam {
    return this.redis;
  }

  /** Alias matching the plan's verification wording. */
  get storageClient(): RedisEvalSeam {
    return this.redis;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const windowMs = Number.isFinite(ttl) && ttl > 0 ? ttl : 60_000;
    const storageKey = `throttle:${throttlerName}:${key}`;
    const { count, resetInMs } = await incrementFixedWindow(
      this.redis,
      storageKey,
      windowMs,
    );

    const timeToExpire = Math.max(0, Math.ceil(resetInMs / 1000));
    const isBlocked = count > limit;
    const effectiveBlock = Number.isFinite(blockDuration) && blockDuration > 0
      ? blockDuration
      : windowMs;
    return {
      totalHits: count,
      timeToExpire,
      isBlocked,
      timeToBlockExpire: isBlocked
        ? Math.max(1, Math.ceil(effectiveBlock / 1000))
        : 0,
    };
  }
}