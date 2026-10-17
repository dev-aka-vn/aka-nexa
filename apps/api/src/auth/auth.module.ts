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
 * No `MongoModule`, and no identity repositories of
 * its own — the D-104 provisioner works over the
 * `IdentityModule`'s shared stores, which the users
 * module (IDN-08) also composes: the auto-provisioned
 * `real_user` and the admin's mapping check must see
 * the same directory. A Mongo-backed identity store is
 * a later plan's replacement, not this module's
 * concern.
 */

import {
  MiddlewareConsumer,
  Module,
  RequestMethod,
} from '@nestjs/common';
import * as oidcClient from 'openid-client';

import { OidcProvisionService } from '@akane/domain';
import { redisCacheProvider } from '@akane/platform';

import { AuthController } from './auth.controller.js';
import { SessionMiddleware } from './session.middleware.js';
import { IdentityModule } from '../identity/identity.module.js';
import {
  BuilderSessionStore,
  discoverOidcClient,
  OIDC_CLIENT,
  OidcService,
  readOidcConfig,
  type OidcConfig,
} from './oidc.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [AuthController],
  providers: [
    redisCacheProvider,
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
   * middleware (T-06-04, D-103). The posture is fail
   * closed: `forRoutes('*')` first, so a route the
   * session does not cover is a named exclusion, never
   * an unguarded default. Three surfaces carry no
   * session, by design:
   *
   * - The two OIDC login routes — they *create* the
   *   session, so guarding them would deadlock the
   *   login flow itself; the callback's own fail-closed
   *   checks (state, PKCE, MFA gate) cover them.
   * - The infrastructure surface — `/health/live` is a
   *   fixed literal that reads nothing (D-10, T-1-17)
   *   and `/health/ready` plus `/metrics` are the
   *   orchestrator's probes; a probe holds no session.
   * - The read-link surface (`/l/*`) — the recipient
   *   follows a link from chat and holds no session;
   *   the signed, single-use token *is* the credential
   *   (LNK-05: "no Redis, no session"). Every method
   *   the controller mounts is excluded by name, so a
   *   new `/l` route fails closed (401) until it is
   *   added here.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(SessionMiddleware)
      .exclude(
        { path: 'auth/oidc/begin', method: RequestMethod.GET },
        { path: 'auth/oidc/callback', method: RequestMethod.GET },
        { path: 'health/live', method: RequestMethod.GET },
        { path: 'health/ready', method: RequestMethod.GET },
        { path: 'metrics', method: RequestMethod.GET },
        { path: 'l/view/:jti', method: RequestMethod.GET },
        { path: 'l/query/:jti', method: RequestMethod.GET },
        { path: 'l/edit/:jti', method: RequestMethod.GET },
        { path: 'l/edit/:jti', method: RequestMethod.POST },
      )
      .forRoutes('*');
  }
}
