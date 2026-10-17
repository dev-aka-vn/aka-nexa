/**
 * Wiring guard for the app-builder module (BLD-02).
 *
 * The gap this guards is **composition**, exactly the one
 * `read.module.spec.ts` guards for the read path: the
 * builder's service is a factory provider, and every unit
 * test in the domain injects its own repository double, so
 * no test can observe the production graph. This asserts the
 * DI metadata itself — the module imports `MongoModule`,
 * declares the controller, and binds the repository and the
 * audit log into the `AppDefinitionService` factory's
 * `inject` list, in the right positions.
 */

import { describe, expect, it } from 'vitest';

import {
  AppDefinitionRepository,
  AppDefinitionService,
  AuditRepository,
  TemplateSeed,
} from '@akane/domain';
import { MongoModule, MongoService } from '@akane/platform';

import { AppBuilderController } from './app-builder.controller.js';
import { AppBuilderModule } from './app-builder.module.js';

interface ProviderShape {
  readonly provide?: unknown;
  readonly inject?: unknown;
  readonly useFactory?: (...args: never[]) => unknown;
}

describe('AppBuilderModule wiring (BLD-02)', () => {
  const providers = (Reflect.getMetadata('providers', AppBuilderModule) ??
    []) as ProviderShape[];
  const controllers = (Reflect.getMetadata('controllers', AppBuilderModule) ??
    []) as unknown[];
  const imports = (Reflect.getMetadata('imports', AppBuilderModule) ??
    []) as unknown[];

  const declared = (token: unknown): boolean =>
    providers.some((p) => p === token || p?.provide === token);

  it('declares the controller', () => {
    expect(controllers).toContain(AppBuilderController);
  });

  it('imports MongoModule so the repositories share the connection', () => {
    expect(imports).toContain(MongoModule);
  });

  it('declares the definition repository and the audit log', () => {
    expect(declared(AppDefinitionRepository)).toBe(true);
    expect(declared(AuditRepository)).toBe(true);
  });

  it('binds the definition service as a factory over the repository and audit log', () => {
    const service = providers.find((p) => p.provide === AppDefinitionService);
    expect(service).toBeDefined();
    expect(typeof service?.useFactory).toBe('function');
    expect(Array.isArray(service?.inject)).toBe(true);
    expect(service?.inject).toContain(AppDefinitionRepository);
    expect(service?.inject).toContain(AuditRepository);
  });

  it('binds the template gallery as a factory over the connection, repository and audit log', () => {
    const seed = providers.find((p) => p.provide === TemplateSeed);
    expect(seed).toBeDefined();
    expect(typeof seed?.useFactory).toBe('function');
    expect(Array.isArray(seed?.inject)).toBe(true);
    expect(seed?.inject).toContain(MongoService);
    expect(seed?.inject).toContain(AppDefinitionRepository);
    expect(seed?.inject).toContain(AuditRepository);
  });

  it('places the repository and audit log in the factory positions', () => {
    const factory = providers.find(
      (p) => p.provide === AppDefinitionService,
    )?.useFactory;
    expect(typeof factory).toBe('function');

    // The factory only forwards to the constructor; the stand-ins
    // carry no behavior, the positions are the assertion.
    const repository = {} as AppDefinitionRepository;
    const audit = {} as AuditRepository;
    const service = factory!(repository as never, audit as never);
    expect(service).toBeInstanceOf(AppDefinitionService);
    expect(
      (service as unknown as { repository?: unknown }).repository,
    ).toBe(repository);
    expect((service as unknown as { audit?: unknown }).audit).toBe(audit);
  });
});
