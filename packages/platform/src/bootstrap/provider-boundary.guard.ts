import type { INestApplication, InjectionToken } from '@nestjs/common';

import type { BoundaryManifest } from './boundary-manifest.js';

export interface ProviderBoundaryGuard {
  /**
   * Abort boot if a forbidden provider has actually been resolved.
   *
   * Called from `OnApplicationBootstrap`, i.e. *after* Nest has instantiated
   * every non-lazy provider — which is the only point at which "has this been
   * constructed?" is a meaningful question.
   */
  assert(app: INestApplication): void;
}

/**
 * The minimal shape this guard needs out of Nest's internals.
 *
 * `INestApplication` exposes no public accessor for the injector, so the reach
 * has to be a cast. The cast is declared *here*, in the only file in Phase 1
 * allowed to touch `app.container`, which is what keeps a Nest minor bump — the
 * one that would break this line — a one-file fix instead of a repo-wide change.
 * Everything else in the codebase takes `INestApplication` at face value.
 *
 * Mirrors, from `@nestjs/core@12.1.2`:
 *   `NestContainer.getModules(): ModulesContainer`      — injector/container.d.ts
 *   `ModulesContainer extends Map<string, Module>`
 *   `Module.providers: Map<InjectionToken, InstanceWrapper>`
 *   `InstanceWrapper.instance`                          — injector/instance-wrapper.d.ts
 */
interface ContainerInternals {
  readonly container: {
    getModules(): Map<
      string,
      {
        readonly providers?: Map<
          InjectionToken,
          { readonly instance?: unknown }
        >;
      }
    >;
  };
}

/**
 * Human-readable name for an `InjectionToken`, used in the failure message.
 *
 * An `InjectionToken` is `string | symbol | Type<any> | Abstract<any>`. `name`
 * is the token itself for a class, `description` is the closest thing a symbol
 * has, and a string token prints verbatim. An unnamed class falls back to
 * `"<unnamed provider>"` rather than `String(fn)`, which would dump the whole
 * transpiled source into the boot log.
 */
const describeToken = (token: InjectionToken): string => {
  if (typeof token === 'string') return token;
  if (typeof token === 'symbol') return token.description ?? token.toString();
  if (typeof token === 'function') return token.name || '<unnamed provider>';
  return '<unknown provider>';
};

/**
 * D-03's boot-time assertion — the runtime half of the "belt and braces" pair.
 *
 * ## Why not `ModuleRef`
 *
 * Both obvious Nest APIs are wrong for this check, and both are traps:
 *
 *   - `ModuleRef.get(token, { strict: false })` **instantiates on demand**.
 *     Probing for a forbidden provider with it would construct the very thing
 *     being checked for and then report it. The check would always pass and
 *     would have side effects doing it.
 *   - `ModuleRef.introspect(token)` returns `{ scope }` and nothing else —
 *     `@nestjs/core@12.1.2` `injector/module-ref.js` is literally
 *     `return { scope };`. It carries no instantiation state.
 *
 * ## Why not `InstanceWrapper.isResolved`
 *
 * RESEARCH P1.6 verified `isResolved` at `injector/instance-wrapper.d.ts:25`
 * and recommended reading it off the wrapper. **That line belongs to
 * `interface InstancePerContext`, not to `class InstanceWrapper`** — and the
 * distinction is the whole ballgame:
 *
 *   - `wrapper.isResolved` does not exist on the class. It reads `undefined`
 *     for every provider, resolved or not, so a predicate built on it makes the
 *     guard permanently silent.
 *   - `wrapper.getInstanceByContextId(STATIC_CONTEXT).isResolved` is not a
 *     signal either: when no value has been recorded for the static context,
 *     `getInstanceByContextId` *synthesises* a fallback record
 *     `{ instance: null, isResolved: true }`. It answers `true` for providers
 *     Nest never touched.
 *
 * `wrapper.instance` is the getter that survives: it reads the static-context
 * record's `instance` field, which is `null` until Nest has actually produced
 * something for that token, and it is a public accessor rather than a private
 * reach. Both facts are pinned by `provider-boundary.guard.spec.ts`, and the
 * correction is recorded as a Rule 1 deviation in `01-03-SUMMARY.md`.
 *
 * Note the predicate is deliberately "this forbidden token has an instance in
 * this app's container", not "a constructor was invoked". Nest materialises a
 * prototype object for request-scoped providers too, so the two are not
 * separable from the outside — and for D-03's purpose the broader reading is
 * the safer one: a forbidden token wired into the api container is a violation
 * whether or not anything has called it yet.
 */
export function createProviderBoundaryGuard(
  manifest: BoundaryManifest,
): ProviderBoundaryGuard {
  return {
    assert(app: INestApplication): void {
      const modules = (app as unknown as ContainerInternals).container.getModules();

      for (const moduleKey of modules.keys()) {
        const providers = modules.get(moduleKey)?.providers;
        if (!providers) continue;

        for (const [token, wrapper] of providers) {
          if (wrapper.instance === null || wrapper.instance === undefined) continue;
          if (!manifest.forbidden.includes(token)) continue;

          throw new Error(
            `BOUNDARY_VIOLATION: ${describeToken(token)} resolved in ${manifest.app} but is forbidden`,
          );
        }
      }
    },
  };
}