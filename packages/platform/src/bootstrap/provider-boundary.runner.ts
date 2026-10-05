import { Inject, Injectable, type INestApplication, type OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { BOUNDARY_MANIFEST, type BoundaryManifest } from './boundary-manifest.js';
import { createProviderBoundaryGuard } from './provider-boundary.guard.js';

/**
 * Runs the per-app `BoundaryManifest` against the live container at boot
 * (D-03, FND-03, T-1-23).
 *
 * ## Why the guard runs here and not in `main.ts`
 *
 * The check has one precondition: Nest must already have instantiated every
 * non-lazy provider, because "has this been constructed?" is otherwise not a
 * question with an answer. `onApplicationBootstrap` is that instant, and it
 * fires inside `app.listen()` — before the HTTP server binds, so a violation
 * aborts a process that never accepted a request. Calling `assert(app)` from
 * `main.ts` after `NestFactory.create()` would work too, but only by a fact
 * (`create()` finished instantiating) that is an implementation detail rather
 * than a documented phase; the lifecycle hook is the contract.
 *
 * ## Why `ModuleRef` and not `INestApplication`
 *
 * Nest has no provider token for the application itself, and the two obvious
 * ways to reach the container from inside the graph are both traps — plan 03
 * documents them at length, and `ModuleRef.get()` is worse than useless here
 * because it **instantiates on demand**: probing for a forbidden provider with
 * it would construct the very thing being checked for and then report it.
 *
 * `ModuleRef` is constructed with the same `NestContainer` the application uses,
 * so `createProviderBoundaryGuard(...).assert(ref)` reaches the identical set of
 * modules. The `unknown` cast is the *type* seam only; the actual reach into
 * `container.getModules()` stays inside `provider-boundary.guard.ts`, which is
 * the one file allowed to do it — a Nest bump that moves that API is a
 * one-file fix, and this file does not change when it happens.
 */
@Injectable()
export class ProviderBoundaryGuardRunner implements OnApplicationBootstrap {
  constructor(
    @Inject(BOUNDARY_MANIFEST) private readonly manifest: BoundaryManifest,
    private readonly moduleRef: ModuleRef,
  ) {}

  onApplicationBootstrap(): void {
    createProviderBoundaryGuard(this.manifest).assert(
      this.moduleRef as unknown as INestApplication,
    );
  }
}