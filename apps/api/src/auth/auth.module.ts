/**
 * The builder auth module (BLD-12).
 *
 * Composed in the `read.module.ts` factory-provider
 * shape: the OIDC config is read from the live
 * environment at module init (a missing var fails
 * boot with `OIDC_CONFIG_INVALID` naming it), the
 * openid-client discovery is cached once at module
 * init (T-06-09), and the session store rides the
 * existing Redis cache connection — one client
 * across BullMQ and sessions halves the connection
 * surface (STACK §4.4).
 *
 * ## What this module deliberately does **not** have
 *
 * No `MongoModule` — the D-104 provisioner works
 * over the in-memory identity repositories, exactly
 * as the worker module composes them today; a
 * Mongo-backed identity store is a later plan's
 * replacement, not this module's concern.
 */

import {
  MiddlewareConsumer,
  Module,
  RequestMethod,
} from '@nestjs/common';
import * as oidcClient from 'openid-client';

import {
  IdentityMappingRepository,
  OidcProvisionService,
  ProfileRepository,
} from '@akane/domain';
import { redisCacheProvider } from '@akane/platform';

import { AuthController } from './auth.controller.js';
import { SessionMiddleware } from './session.middleware.js';
import {
  BuilderSessionStore,
  discoverOidcClient,
  OIDC_CLIENT,
  OidcService,
  readOidcConfig,
  type OidcConfig,
} from './oidc.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    redisCacheProvider,
    IdentityMappingRepository,
    ProfileRepository,
    {
      provide: 'OIDC_CONFIG',
      useFactory: (): OidcConfig => readOidcConfig(),
    },
    {
      provide: OIDC_CLIENT,
      useFactory: (config: OidcConfig): Promise<oidcClient.Configuration> =>
        discoverOidcClient(config),
      inject: ['OIDC_CONFIG'],
    },
    BuilderSessionStore,
    OidcProvisionService,
    {
      provide: OidcService,
      useFactory: (
        config: OidcConfig,
        client: oidcClient.Configuration,
        sessions: BuilderSessionStore,
        provision: OidcProvisionService,
      ): OidcService => new OidcService(config, client, sessions, provision),
      inject: ['OIDC_CONFIG', OIDC_CLIENT, BuilderSessionStore, OidcProvisionService],
    },
  ],
})
export class AuthModule {
  /**
   * Guard every builder-facing route with the session
   * middleware (T-06-04, D-103). The two OIDC login
   * routes are excluded — they *create* the session,
   * so guarding them would deadlock the login flow
   * itself; the callback's own fail-closed checks
   * (state, PKCE, MFA gate) cover them.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(SessionMiddleware)
      .exclude(
        { path: 'auth/oidc/begin', method: RequestMethod.GET },
        { path: 'auth/oidc/callback', method: RequestMethod.GET },
      )
      .forRoutes('*');
  }
}
