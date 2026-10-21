import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import { REDIS_CACHE, redisCacheProvider } from '@akane/platform';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

/**
 * Three named throttler tiers (NFR-SEC-6), backed by the hand-written Redis
 * storage over the cache connection (D-19, OBS-08).
 *
 *   - `perUser`      — 10 / minute, keyed on the user identifier (never IP).
 *   - `perApp`       — 100 / minute, keyed on the app identifier.
 *   - `perConnector` — per config, keyed on the connector reference.
 *
 * The guard is registered globally so every request path is covered; the
 * `getTracker` overrides below ensure no tier ever keys on a client address,
 * which is both spoofable behind a proxy and incorrect behind a corporate NAT.
 */
@Module({ providers: [redisCacheProvider], exports: [REDIS_CACHE] })
class ThrottlerRedisModule {}

export class ThrottlerAppModule {
  static forRoot(): DynamicModule {
    return {
      module: ThrottlerAppModule,
      imports: [
        ThrottlerModule.forRootAsync({
          imports: [ThrottlerRedisModule],
          inject: [ConfigService, REDIS_CACHE],
          useFactory: (config: ConfigService, redis: unknown) => ({
            storage: new RedisThrottlerStorage(redis as never),
            throttlers: [
              {
                name: 'perUser',
                ttl: 60_000,
                limit: 10,
                getTracker: (req: Record<string, unknown>) =>
                  String(
                    (req?.params as Record<string, unknown> | undefined)?.jti ??
                      (req?.user as Record<string, unknown> | undefined)?.id ??
                      (req?.headers as Record<string, unknown> | undefined)?.['x-user-id'] ??
                      'anonymous',
                  ),
              },
              {
                name: 'perApp',
                ttl: 60_000,
                limit: 100,
                getTracker: (req: Record<string, unknown>) =>
                  String(
                    (req?.params as Record<string, unknown> | undefined)?.appId ??
                      (req?.body as Record<string, unknown> | undefined)?.appId ??
                      (req?.headers as Record<string, unknown> | undefined)?.['x-app-id'] ??
                      'default',
                  ),
              },
              {
                name: 'perConnector',
                ttl: 60_000,
                limit: config.get<number>('THROTTLE_PER_CONNECTOR_LIMIT', 60),
                getTracker: (req: Record<string, unknown>) =>
                  String(
                    (req?.params as Record<string, unknown> | undefined)?.connectorRef ??
                      (req?.body as Record<string, unknown> | undefined)?.connectorRef ??
                      (req?.headers as Record<string, unknown> | undefined)?.['x-connector-ref'] ??
                      'default',
                  ),
              },
            ],
          }),
        }),
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
      exports: [ThrottlerModule],
    };
  }
}