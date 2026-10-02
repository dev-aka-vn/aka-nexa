import { Module } from '@nestjs/common';

import { CRYPTO_KEY_PROVIDER, type KeyProvider } from './key-provider.js';
import { LocalKeyProvider } from './local-key-provider.js';
import { assertKeyProviderAllowed } from './production-guard.js';

/**
 * `CryptoModule` — provider selection, and nothing else (D-27).
 *
 * ## The selection order is the security property
 *
 * `assertKeyProviderAllowed` runs **before** any provider is constructed, so a
 * production process configured with `local` never reaches a key file. Doing it
 * in the other order would mean the key was read from disk into a production
 * process before anything objected — the refusal would still be loud, but the
 * secret would already have been loaded.
 *
 * ## `kms` is a named failure, not a stub
 *
 * Selecting `kms` throws `KMS_PROVIDER_BLOCKED:`. That is the point, not an
 * oversight: no deployment cloud has been named (D-27), so a production boot
 * today must **fail loudly at the KMS boundary** rather than quietly fall back
 * to the local key. The moment a vendor is chosen this is the single function
 * that gains an adapter — the `KeyProvider` interface, the envelope, and every
 * caller stay exactly as they are.
 *
 * ## Why the factory reads `process.env` directly instead of `ConfigService`
 *
 * `ConfigModule.forRoot()` in `@nestjs/config@12` is **`async`**, and
 * `packages/platform/src/config/config.module.ts` calls it at module scope
 * without awaiting. The validated configuration is therefore a snapshot taken
 * when `config.module.js` is **imported**, and `ConfigService.get()` serves
 * that snapshot in preference to the live environment.
 *
 * Measured here, not assumed: with `process.env.NODE_ENV = "production"` set
 * before `Test.createTestingModule(...).compile()`, `ConfigService.get('NODE_ENV')`
 * returned `"test"` — the value present at import time.
 *
 * For a deployment that exports `NODE_ENV=production` before the process starts
 * the snapshot happens to be correct, so the bug is invisible in production and
 * appears the moment anything sets the environment later (tests, a `.env` the
 * config loader applies, a programmatic boot). **A security guard that reads a
 * possibly-stale `NODE_ENV` is exactly the guard that is wrong when it matters**,
 * so this factory reads the live environment at the moment the provider is
 * constructed — which is also the moment the guard runs.
 *
 * `namedValidate` still validates the *shape* of both keys at import time; this
 * is only about which copy of the value the policy check is given.
 *
 * ## Why `CRYPTO_LOCAL_KEY_FILE` is not a schema field
 *
 * `config.schema.ts` is not in this plan's `files_modified`, and D-27's guard is
 * deliberately kept out of it (see `production-guard.ts`). The key-file path is a
 * **path**, not a secret, so NFR-SEC-3 permits it in configuration. Declaring it
 * as an `AppConfig` field is a plan-10 change alongside the entrypoint bootstrap;
 * reading it here keeps this plan from editing a file three completed plans
 * already depend on.
 */

/** The `CRYPTO_KEY_PROVIDER` values the boot schema admits. */
export type KeyProviderName = 'local' | 'kms';

export interface KeyProviderConfig {
  readonly NODE_ENV: string;
  readonly CRYPTO_KEY_PROVIDER: string;
  /**
   * Path to a file holding 32 raw bytes of key material. A path, never the key
   * itself — a key in an env var is a key in the process table, in the crash
   * dump, and in every CI log that echoes its environment.
   */
  readonly CRYPTO_LOCAL_KEY_FILE?: string;
}

/**
 * Build the configured `KeyProvider`, or refuse to.
 *
 * Pure and synchronous so the selection rules are testable without a Nest
 * container, and so the refusal order is visible in one function rather than
 * spread across provider factories.
 *
 * @throws `CRYPTO_KEY_PROVIDER_REQUIRED` (production without `kms`),
 *   `KMS_PROVIDER_BLOCKED` (`kms` selected), `CRYPTO_KEY_PROVIDER_UNKNOWN`
 *   (a value the boot schema should already have refused), or
 *   `LOCAL_KEY_FILE_MISSING`.
 */
export function createKeyProvider(config: KeyProviderConfig): KeyProvider {
  // First. A production process refused on policy must not have read a key file.
  assertKeyProviderAllowed(config);

  switch (config.CRYPTO_KEY_PROVIDER) {
    case 'kms':
      // B-3. Named, loud, and unbuilt on purpose — see the module docblock.
      throw new Error(
        'KMS_PROVIDER_BLOCKED: no deployment cloud named (B-3); the KMS KeyProvider adapter is not built',
      );
    case 'local':
      return new LocalKeyProvider({
        keyFilePath: resolveLocalKeyFilePath(config),
        nodeEnv: config.NODE_ENV,
      });
    default:
      throw new Error(`CRYPTO_KEY_PROVIDER_UNKNOWN: expected local or kms, got ${String(config.CRYPTO_KEY_PROVIDER)}`);
  }
}

/**
 * A declared config value wins; the process environment is the fallback so the
 * factory works when it is called outside the Nest container (tests, tooling).
 */
function resolveLocalKeyFilePath(config: KeyProviderConfig): string {
  const fromConfig = config.CRYPTO_LOCAL_KEY_FILE ?? process.env['CRYPTO_LOCAL_KEY_FILE'];
  if (typeof fromConfig !== 'string' || fromConfig === '') {
    throw new Error(
      'LOCAL_KEY_FILE_MISSING: CRYPTO_LOCAL_KEY_FILE must name a file holding 32 bytes of key material (the path, never the key)',
    );
  }
  return fromConfig;
}

/**
 * Read the two guarded values from the **live** process environment.
 *
 * See the module docblock for why this is not `ConfigService`. Exported so the
 * regression test can assert the live read rather than the snapshot.
 */
export function readKeyProviderEnv(
  env: NodeJS.ProcessEnv = process.env,
): KeyProviderConfig {
  return {
    NODE_ENV: env['NODE_ENV'] ?? 'development',
    CRYPTO_KEY_PROVIDER: env['CRYPTO_KEY_PROVIDER'] ?? 'local',
    CRYPTO_LOCAL_KEY_FILE: env['CRYPTO_LOCAL_KEY_FILE'],
  };
}

/**
 * Registers the selected provider under {@link CRYPTO_KEY_PROVIDER}.
 *
 * Imported by the three entrypoints in plan 10, which is also where the
 * `BOUNDARY_MANIFEST` provider-boundary guard from plan 03 has to be applied.
 */
@Module({
  providers: [
    {
      provide: CRYPTO_KEY_PROVIDER,
      useFactory: (): KeyProvider => createKeyProvider(readKeyProviderEnv()),
    },
  ],
  exports: [CRYPTO_KEY_PROVIDER],
})
export class CryptoModule {}