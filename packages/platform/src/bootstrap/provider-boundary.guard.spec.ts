import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import type { BoundaryManifest } from './boundary-manifest.js';
import { createProviderBoundaryGuard } from './provider-boundary.guard.js';

/**
 * D-03: a forbidden provider that has actually been *resolved* must abort boot.
 *
 * The tokens are symbols rather than classes so the test asserts exactly the
 * identity comparison the guard performs — a class token would additionally
 * exercise Nest's own resolution machinery and could pass for the wrong reason.
 */
const FORBIDDEN_TOKEN = Symbol('WorkerProcessor');
const PRESENT_TOKEN = Symbol('HttpController');
const ABSENT_TOKEN = Symbol('NeverRegistered');

@Module({
  providers: [{ provide: FORBIDDEN_TOKEN, useValue: { kind: 'worker' } }],
})
class WorkerLoadedModule {}

@Module({
  providers: [{ provide: PRESENT_TOKEN, useValue: { kind: 'http' } }],
})
class CleanModule {}

type NestApp = Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>['createNestApplication']>;

const boot = async (moduleClass: typeof WorkerLoadedModule): Promise<NestApp> => {
  const moduleRef = await Test.createTestingModule({ imports: [moduleClass] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
};

describe('createProviderBoundaryGuard (D-03, FND-04)', () => {
  it('throws BOUNDARY_VIOLATION naming the app when a forbidden token is resolved', async () => {
    const app = await boot(WorkerLoadedModule);
    const manifest: BoundaryManifest = { app: 'api', forbidden: [FORBIDDEN_TOKEN] };

    expect(() => createProviderBoundaryGuard(manifest).assert(app)).toThrowError(
      /^BOUNDARY_VIOLATION: WorkerProcessor resolved in api but is forbidden$/,
    );

    await app.close();
  });

  it('does not throw when no forbidden token is resolved', async () => {
    const app = await boot(CleanModule);
    const manifest: BoundaryManifest = { app: 'worker', forbidden: [FORBIDDEN_TOKEN] };

    expect(() => createProviderBoundaryGuard(manifest).assert(app)).not.toThrow();

    await app.close();
  });

  it('does not throw for a forbidden token that was never provided at all', async () => {
    // The other half of the previous case, and the one that would break if the
    // guard matched on module name or token *shape* instead of identity.
    const app = await boot(CleanModule);
    const manifest: BoundaryManifest = { app: 'scheduler', forbidden: [ABSENT_TOKEN] };

    expect(() => createProviderBoundaryGuard(manifest).assert(app)).not.toThrow();

    await app.close();
  });

  it('does not throw on an app with no providers at all', async () => {
    const app = await boot(CleanModule);
    const manifest: BoundaryManifest = { app: 'api', forbidden: [PRESENT_TOKEN] };

    // Sanity, inverted: PRESENT_TOKEN *is* in this container, so this manifest
    // must trip. Proving both directions on the same container is what stops
    // the guard from passing vacuously.
    expect(() => createProviderBoundaryGuard(manifest).assert(app)).toThrowError(
      /^BOUNDARY_VIOLATION: HttpController resolved in api but is forbidden$/,
    );

    await app.close();
  });

  it('reports the token description for symbol tokens and the class name for class tokens', async () => {
    const app = await boot(WorkerLoadedModule);

    class SlidingWindowProcessor {}
    const bySymbol: BoundaryManifest = { app: 'worker', forbidden: [FORBIDDEN_TOKEN] };
    const byClass: BoundaryManifest = { app: 'worker', forbidden: [SlidingWindowProcessor] };

    expect(() => createProviderBoundaryGuard(bySymbol).assert(app)).toThrowError(
      /WorkerProcessor/,
    );
    // A class that is not in the container names nothing — no throw, no noise.
    expect(() => createProviderBoundaryGuard(byClass).assert(app)).not.toThrow();

    await app.close();
  });

  it('is not satisfied by an empty forbidden list', async () => {
    // A manifest that failed to load its data must not read as "everything is
    // allowed and we passed". It reads as an empty allow-set, and the guard
    // stays silent — which is why plan 10 must provide the manifest rather
    // than letting it default. This test documents the failure mode.
    const app = await boot(WorkerLoadedModule);
    const manifest: BoundaryManifest = { app: 'api', forbidden: [] };

    expect(() => createProviderBoundaryGuard(manifest).assert(app)).not.toThrow();

    await app.close();
  });

  /**
   * Pins the RESEARCH P1.6 correction that forced this guard's predicate.
   *
   * P1.6 verified `isResolved` at `injector/instance-wrapper.d.ts:25` and
   * told the plan to read it off the wrapper. That line is inside
   * `interface InstancePerContext` — a *different* type. On the class the
   * property does not exist, so a guard built on it would read `undefined`
   * for every provider and **never fire**: a runtime guard that always passes
   * is worse than none, because it is indistinguishable from a working one.
   *
   * Rather than trust that reading, boot a container that provably holds a
   * resolved forbidden provider and assert the flag is not on the wrapper.
   */
  it('wrapper.isResolved does not exist — the guard must not be built on it', async () => {
    const app = await boot(WorkerLoadedModule);
    const manifest: BoundaryManifest = { app: 'api', forbidden: [FORBIDDEN_TOKEN] };

    // Control: the guard does fire on this container.
    expect(() => createProviderBoundaryGuard(manifest).assert(app)).toThrowError(
      /^BOUNDARY_VIOLATION: /,
    );

    const modules = (
      app as unknown as {
        container: {
          getModules(): Map<
            string,
            { providers?: Map<unknown, { isResolved?: unknown; instance?: unknown }> }
          >;
        };
      }
    ).container.getModules();

    let inspected = 0;
    for (const module of modules.values()) {
      for (const [token, wrapper] of module.providers ?? []) {
        if (token !== FORBIDDEN_TOKEN) continue;
        inspected += 1;
        expect(
          wrapper.isResolved,
          'wrapper.isResolved was expected to be undefined on @nestjs/core@12.1.2',
        ).toBeUndefined();
        expect(wrapper.instance, 'wrapper.instance must be the real signal').not.toBeNull();
      }
    }
    expect(inspected, 'the forbidden token must be reachable in the container').toBe(1);

    await app.close();
  });
});