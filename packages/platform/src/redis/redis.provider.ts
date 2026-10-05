import { Inject, type OnModuleDestroy, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis as IORedis, type RedisOptions } from 'ioredis';
import { REDIS_CACHE, REDIS_QUEUE } from './redis.constants.js';

/**
 * The two ioredis connection profiles (D-14).
 *
 * `producer` is any request-path or cache connection: it must fail fast rather
 * than hang an HTTP handler when Redis is down, so its retry count is finite.
 * `blocking` is the worker's BullMQ blocking connection: BullMQ throws when
 * `maxRetriesPerRequest` is not `null`, because a blocking command legitimately
 * waits indefinitely.
 */
export type RedisProfile = 'producer' | 'blocking';

export interface RedisClientConfig {
  readonly url: string;
  readonly profile: RedisProfile;
}

/** Within the 1..3 band D-14 requires for request-path clients. */
export const PRODUCER_MAX_RETRIES_PER_REQUEST = 2;

/**
 * The complete, deliberate options object for a profile.
 *
 * `keyPrefix` is never set anywhere in this module (D-14): BullMQ owns its own
 * `prefix` ({akane-q}), and a second prefix layer silently corrupts key
 * placement. This is the one object the unit tests assert against, because
 * ioredis normalises `keyPrefix: ""` into `client.options` regardless of input
 * and inspecting the client would hide whether we set it.
 */
export function buildRedisOptions(profile: RedisProfile): RedisOptions {
  return {
    maxRetriesPerRequest:
      profile === 'blocking' ? null : PRODUCER_MAX_RETRIES_PER_REQUEST,
  };
}

/**
 * Construct a Redis client for a profile. Never called at module load — the
 * providers below are factories Nest resolves at bootstrap, and `lazyConnect`
 * keeps the socket closed until the first command so module compilation never
 * opens a Redis connection.
 */
export function createRedisClient({ url, profile }: RedisClientConfig): IORedis {
  return new IORedis(url, {
    ...buildRedisOptions(profile),
    lazyConnect: true,
  });
}

/** Cache deployment connection (evicting policy, D-13). */
export const redisCacheProvider: Provider = {
  provide: REDIS_CACHE,
  inject: [ConfigService],
  useFactory: (config: ConfigService): IORedis =>
    createRedisClient({
      url: config.getOrThrow<string>('REDIS_CACHE_URL'),
      profile: 'producer',
    }),
};

/**
 * Queue deployment connection for request-path producers. The worker blocking
 * connection is created by BullMQ's `Worker` (plans 07/10) using
 * `buildRedisOptions('blocking')`; it is intentionally not a provider here,
 * because it must not be shared with the request path.
 */
export const redisQueueProvider: Provider = {
  provide: REDIS_QUEUE,
  inject: [ConfigService],
  useFactory: (config: ConfigService): IORedis =>
    createRedisClient({
      url: config.getOrThrow<string>('REDIS_QUEUE_URL'),
      profile: 'producer',
    }),
};

/**
 * The owner of both Redis connections' lifetime (D-09, CR-02).
 *
 * ## Why this class exists at all
 *
 * `createRedisClient` returns a bare `IORedis`, and nothing else in the tree
 * holds a reference to it. A `useFactory` has no teardown hook, so the socket
 * lived until the process died — while every composition root already called
 * `app.enableShutdownHooks()`. That made D-09's contract ("a zero-downtime
 * rolling deploy should drain connections, not have them severed") true for
 * Mongo and false for both Redis deployments, **silently**: nothing logged,
 * nothing errored, and the process exited successfully having dropped rate-limit
 * counters and in-flight producer commands.
 *
 * This is the same shape as `MongoService.onModuleDestroy`, applied to the two
 * clients that had no owner.
 */
export class RedisShutdown implements OnModuleDestroy {
  readonly #clients: readonly IORedis[];

  constructor(
    @Inject(REDIS_CACHE) cache: IORedis,
    @Inject(REDIS_QUEUE) queue: IORedis,
  ) {
    this.#clients = [cache, queue];
  }

  /**
   * `QUIT` both connections and wait for the server to acknowledge.
   *
   * `allSettled`, not `all`: one connection that is already gone, or a server
   * that stopped responding mid-deploy, must not prevent the other from being
   * drained — and a shutdown that throws would abort the remaining
   * `onModuleDestroy` hooks, taking Mongo and the OTel flush down with it.
   */
  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(this.#clients.map((client) => client.quit()));
  }
}

/**
 * Registers {@link RedisShutdown}.
 *
 * **Must be listed alongside {@link redisCacheProvider} and
 * {@link redisQueueProvider}** in every composition root that registers either
 * client — the three entrypoints do. `tooling/entrypoint-drift.spec.ts` asserts
 * that pairing, because the failure mode of omitting it is precisely the one
 * that cannot announce itself: a provider that constructs fine, never closes.
 */
export const redisShutdownProvider: Provider = {
  provide: RedisShutdown,
  useClass: RedisShutdown,
};
