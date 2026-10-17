/**
 * Wiring guard for G-11.
 *
 * The gap was **not** a missing feature — it was composition. `verifyQuery`
 * fails closed to `wrong_version` when the D-73 `savedQueries` seam is absent,
 * and `read.module.ts` passed `undefined` for it, so every `query` read link
 * (the status page's "My submissions" list) was denied in production while the
 * verifier's own suite stayed green: every test there injects an in-memory
 * double, so no test could observe the production wiring.
 *
 * This spec asserts the **DI graph itself** — that the store is declared, that
 * it is bound into the verifier factory's inject list, and that invoking that
 * factory places it in the `savedQueries` position. Booting `ReadModule` for
 * real would need Mongo, Redis and four boot secrets; the failure mode being
 * guarded is purely structural, so the structure is what is asserted.
 */

import { describe, expect, it } from 'vitest';

import {
  ReadVerifierService,
  RepositorySavedQueryLookup,
} from '@akane/domain';

import { ReadModule } from './read.module.js';

interface ProviderShape {
  readonly provide?: unknown;
  readonly inject?: unknown;
  readonly useFactory?: (...args: never[]) => unknown;
}

describe('ReadModule wiring (G-11)', () => {
  const providers = (Reflect.getMetadata('providers', ReadModule) ?? []) as ProviderShape[];
  const verifier = providers.find((p) => p.provide === ReadVerifierService);

  it('declares the production saved-query store', () => {
    expect(
      providers.some((p) => p.provide === RepositorySavedQueryLookup),
    ).toBe(true);
  });

  it('binds the store into the ReadVerifierService inject list', () => {
    expect(verifier).toBeDefined();
    expect(Array.isArray(verifier?.inject)).toBe(true);
    expect(verifier?.inject).toContain(RepositorySavedQueryLookup);
  });

  it('places the store in the savedQueries position when the factory runs', () => {
    expect(typeof verifier?.useFactory).toBe('function');

    // The repository-backed store is the G-11 replacement: the
    // constructor takes the MongoService, which the factory's
    // explicit inject list binds by token. The stand-in carries
    // no behavior here — the positions are the assertion.
    const store = new RepositorySavedQueryLookup(
      undefined as never,
    );
    const service = verifier!.useFactory!(
      {} as never,
      {} as never,
      {} as never,
      store as never,
      {} as never,
      {} as never,
      {} as never,
    );

    expect(service).toBeInstanceOf(ReadVerifierService);
    // Read directly: `undefined` here *is* G-11, so the guard is about identity.
    expect((service as unknown as { savedQueries?: unknown }).savedQueries).toBe(store);
  });
});
