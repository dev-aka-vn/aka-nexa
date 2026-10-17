/**
 * Wiring guard for the users module (D-110).
 *
 * The same composition gap the auth module's guard
 * (BLD-12) watches for: the users module's seams
 * are the shared identity stores and the SSO
 * mapping service, and every unit test injects
 * its own double — so no unit test can observe
 * whether the production graph actually composes
 * them. This asserts the DI metadata itself.
 */

import { describe, expect, it } from 'vitest';

import { IdentityModule } from '../identity/identity.module.js';

import { SsoMappingService } from '@akane/domain';

import { UsersController } from './users.controller.js';
import { UsersModule } from './users.module.js';

interface ProviderShape {
  readonly provide?: unknown;
}

describe('UsersModule wiring (D-110)', () => {
  const providers = (Reflect.getMetadata('providers', UsersModule) ??
    []) as ProviderShape[];
  const controllers = (Reflect.getMetadata('controllers', UsersModule) ??
    []) as unknown[];
  const imports = (Reflect.getMetadata('imports', UsersModule) ??
    []) as unknown[];

  /**
   * NestJS stores factory providers as
   * `{ provide, useFactory }` objects but bare
   * class providers as the class itself.
   */
  const declared = (token: unknown): boolean =>
    providers.some((p) => p === token || p?.provide === token);

  it('declares the controller', () => {
    expect(controllers).toContain(UsersController);
  });

  it('composes the SSO mapping service', () => {
    expect(declared(SsoMappingService)).toBe(true);
  });

  it('shares the identity stores with the auth module', () => {
    // The realUserId existence check (IDN-08) must see
    // the real_users the D-104 auto-provisioner creates
    // at login — the repositories are shared through the
    // identity module, not re-instantiated per module.
    expect(imports).toContain(IdentityModule);
  });
});
