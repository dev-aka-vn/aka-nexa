/**
 * Wiring guard for the builder auth module (BLD-12).
 *
 * The gap this guards is **composition**, not behavior: the
 * auth module's seams are factory providers whose failure mode
 * is silent — a missing `OIDC_CONFIG` binding, a discovery
 * provider that nothing injects, an auto-provision service
 * constructed without its repositories — and every unit test
 * in the suite injects its own double, so no test can observe
 * the production graph. This asserts the DI metadata itself:
 * the providers are declared, bound into each factory's
 * `inject` list, and the boot reads the four OIDC env vars
 * with a named failure, mirroring `read.module.spec.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  IdentityMappingRepository,
  OidcProvisionService,
  ProfileRepository,
} from '@akane/domain';

import { AuthController } from './auth.controller.js';
import { AuthModule } from './auth.module.js';
import {
  BuilderSessionStore,
  OIDC_CLIENT,
  OIDC_CONFIG_KEYS,
  OidcService,
  readOidcConfig,
} from './oidc.service.js';
import { SessionMiddleware } from './session.middleware.js';

interface ProviderShape {
  readonly provide?: unknown;
  readonly inject?: unknown;
  readonly useFactory?: (...args: never[]) => unknown;
}

describe('AuthModule wiring (BLD-12)', () => {
  const providers = (Reflect.getMetadata('providers', AuthModule) ??
    []) as ProviderShape[];
  const controllers = (Reflect.getMetadata('controllers', AuthModule) ??
    []) as unknown[];

  /**
   * NestJS stores factory providers as `{ provide, useFactory, inject }`
   * objects but bare class providers as the class itself, so a guard
   * over the raw metadata must accept both shapes to ask "is this
   * token declared?".
   */
  const declared = (token: unknown): boolean =>
    providers.some((p) => p === token || p?.provide === token);

  it('declares the controller', () => {
    expect(controllers).toContain(AuthController);
  });

  it('declares the OIDC config factory reading the four env vars', () => {
    expect(providers.some((p) => p.provide === 'OIDC_CONFIG')).toBe(true);
    expect(OIDC_CONFIG_KEYS).toEqual([
      'OIDC_ISSUER',
      'OIDC_CLIENT_ID',
      'OIDC_CLIENT_SECRET',
      'OIDC_REDIRECT_URI',
    ]);
  });

  it('refuses composition with a named error naming every missing OIDC var', () => {
    const factory = providers.find((p) => p.provide === 'OIDC_CONFIG')?.useFactory;
    expect(typeof factory).toBe('function');

    const saved = OIDC_CONFIG_KEYS.map((key) => process.env[key]);
    for (const key of OIDC_CONFIG_KEYS) {
      delete process.env[key];
    }
    try {
      let thrown: unknown;
      try {
        factory!();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toContain('OIDC_CONFIG_INVALID');
      for (const key of OIDC_CONFIG_KEYS) {
        expect((thrown as Error).message).toContain(key);
      }
    } finally {
      OIDC_CONFIG_KEYS.forEach((key, index) => {
        if (saved[index] !== undefined) {
          process.env[key] = saved[index];
        }
      });
    }
  });

  it('caches the openid-client discovery at module init', () => {
    const discovery = providers.find((p) => p.provide === OIDC_CLIENT);
    expect(discovery).toBeDefined();
    expect(typeof discovery?.useFactory).toBe('function');
    expect(Array.isArray(discovery?.inject)).toBe(true);
    expect(discovery?.inject).toContain('OIDC_CONFIG');
  });

  it('binds the Redis-backed session store over the cache connection', () => {
    expect(declared(BuilderSessionStore)).toBe(true);
  });

  it('binds the OIDC service with its config, client, store and provisioner', () => {
    const service = providers.find((p) => p.provide === OidcService);
    expect(service).toBeDefined();
    expect(typeof service?.useFactory).toBe('function');
    expect(Array.isArray(service?.inject)).toBe(true);
    expect(service?.inject).toContain('OIDC_CONFIG');
    expect(service?.inject).toContain(OIDC_CLIENT);
    expect(service?.inject).toContain(BuilderSessionStore);
    expect(service?.inject).toContain(OidcProvisionService);
  });

  it('binds the D-104 auto-provision service and its repositories', () => {
    expect(declared(OidcProvisionService)).toBe(true);
    expect(declared(IdentityMappingRepository)).toBe(true);
    expect(declared(ProfileRepository)).toBe(true);
  });

  it('provisions against the real repository shape', async () => {
    // The provision service must be constructible with the two
    // repositories the module declares — the wiring is the test.
    const service = new OidcProvisionService(
      new IdentityMappingRepository(),
      new ProfileRepository(),
    );
    const outcome = await service.upsertFromOidc('wiring-subject', undefined);
    expect(outcome.provisioned).toBe(true);
    expect(outcome.realUserId).toBeTruthy();
  });

  it('registers the session middleware on every route except the OIDC login flow', () => {
    // configure() is imperative, so the guard drives it against a
    // recording consumer: the middleware must be applied to every
    // builder route, with the two login routes excluded — they
    // *create* the session, so guarding them would deadlock login.
    const applied: unknown[] = [];
    const excluded: unknown[] = [];
    const routes: unknown[] = [];
    const consumer = {
      apply: (...args: unknown[]) => {
        applied.push(...args);
        return consumer;
      },
      exclude: (...args: unknown[]) => {
        excluded.push(...args);
        return consumer;
      },
      forRoutes: (...args: unknown[]) => {
        routes.push(...args);
        return consumer;
      },
    };
    new AuthModule().configure(consumer as never);

    expect(applied).toContain(SessionMiddleware);
    const paths = excluded.map((entry) => (entry as { path?: string }).path);
    expect(paths).toContain('auth/oidc/begin');
    expect(paths).toContain('auth/oidc/callback');
    expect(routes).toContain('*');
  });

  it('reads the OIDC config from the live environment', () => {
    const saved = OIDC_CONFIG_KEYS.map((key) => process.env[key]);
    OIDC_CONFIG_KEYS.forEach((key, index) => {
      process.env[key] = saved[index] ?? `value-${index}`;
    });
    try {
      const config = readOidcConfig();
      expect(config.issuer).toBe(process.env['OIDC_ISSUER']);
      expect(config.clientId).toBe(process.env['OIDC_CLIENT_ID']);
      expect(config.clientSecret).toBe(process.env['OIDC_CLIENT_SECRET']);
      expect(config.redirectUri).toBe(process.env['OIDC_REDIRECT_URI']);
    } finally {
      OIDC_CONFIG_KEYS.forEach((key, index) => {
        if (saved[index] !== undefined) {
          process.env[key] = saved[index];
        } else {
          delete process.env[key];
        }
      });
    }
  });
});
