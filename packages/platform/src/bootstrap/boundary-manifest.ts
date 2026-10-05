import type { InjectionToken } from '@nestjs/common';

/**
 * D-03's runtime half: the per-app declaration of what must never be
 * instantiated in that process.
 *
 * The lint gate (`tooling/boundaries.config.mjs`) is the *static* control — it
 * proves no module imports a file it should not. This manifest is the *dynamic*
 * half, for the escapes static analysis cannot see:
 *
 *   - a provider resolved through `ModuleRef.get(token, { strict: false })`
 *     from an unrelated module;
 *   - a `forwardRef` or dynamic module that pulls a foreign provider into the
 *     graph at wiring time;
 *   - a third-party SDK that self-registers into the container.
 *
 * Nest resolves providers lazily, so an import the module never *uses* may
 * never instantiate. That is the whole reason this exists: the failure it
 * catches is invisible in code review and only shows up under production
 * traffic.
 *
 * Plan 10 owns the concrete per-app manifests and provides the guard in each
 * `app.module.ts` so the assertion runs in `OnApplicationBootstrap`. This file
 * only defines the shape and the DI token.
 */
export interface BoundaryManifest {
  /** Which composition root this manifest describes. Named in the failure message. */
  readonly app: 'api' | 'worker' | 'scheduler';
  /**
   * Tokens that must never be resolved in this app's process. Plan 10 seeds
   * these per app — e.g. `api` forbids the BullMQ `WorkerProcessor` tokens,
   * `worker` forbids HTTP controllers.
   *
   * `InjectionToken` is `string | symbol | Type<any> | Abstract<any>`, so a
   * symbol token matches by identity and a class token matches by reference.
   */
  readonly forbidden: ReadonlyArray<InjectionToken>;
}

/**
 * DI token for a `BoundaryManifest`.
 *
 * A symbol rather than a string: it cannot collide with a provider class, and
 * `ProviderBoundaryGuard` fails loudly at boot if it is missing rather than
 * silently defaulting to an empty forbidden set — a guard that allows everything
 * because nobody registered its input is worse than no guard, because it looks
 * like enforcement.
 */
export const BOUNDARY_MANIFEST = Symbol('BOUNDARY_MANIFEST');