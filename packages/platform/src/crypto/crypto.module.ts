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
 *
 * `CRYPTO_LOCAL_KEY_ALLOWED` is read the same way for the same reason, and is
 * additionally **not** a schema field on purpose: it is a deliberate override of
 * a security control rather than a value that describes the process, so it
 * belongs to the crypto owner and is never defaulted, validated, or echoed into
 * the configuration object (CR-01).
 */

/** The `CRYPTO_KEY_PROVIDER` values the boot schema admits. */
export type KeyProviderName = 'local' | 'kms';

export interface KeyProviderConfig {
  readonly NODE_ENV: string | undefined;
  readonly CRYPTO_KEY_PROVIDER: string;
  /**
   * Path to a file holding 32 raw bytes of key material. A path, never the key
   * itself — a key in an env var is a key in the process table, in the crash
   * dump, and in every CI log that echoes its environment.
   */
  readonly CRYPTO_LOCAL_KEY_FILE?: string;
  /**
   * The explicit operator opt-in that lets the local key run outside
   * `development`/`test`. Only the exact string `'true'` counts, and it never
   * relaxes `NODE_ENV=production` (CR-01) — see `production-guard.ts`.
   */
  readonly CRYPTO_LOCAL_KEY_ALLOWED?: string | undefined;
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
 * Read the guarded values from the **live** process environment.
 *
 * See the module docblock for why this is not `ConfigService`. Exported so the
 * regression test can assert the live read rather than the snapshot.
 *
 * `NODE_ENV` is read **without a default** (CR-01). Substituting `'development'`
 * for an absent value is what made a production container that never declared
 * its environment indistinguishable from a laptop, and it did so at exactly the
 * point where the security decision is made. `config.schema.ts` now requires
 * `NODE_ENV`, so a real boot aborts with `CONFIG_INVALID: NODE_ENV` before this
 * ever sees an absent value — and if this function is reached with one anyway,
 * the guard refuses it.
 */
export function readKeyProviderEnv(
  env: NodeJS.ProcessEnv = process.env,
): KeyProviderConfig {
  return {
    NODE_ENV: env['NODE_ENV'],
    CRYPTO_KEY_PROVIDER: env['CRYPTO_KEY_PROVIDER'] ?? 'local',
    CRYPTO_LOCAL_KEY_FILE: env['CRYPTO_LOCAL_KEY_FILE'],
    CRYPTO_LOCAL_KEY_ALLOWED: env['CRYPTO_LOCAL_KEY_ALLOWED'],
  };
}

/**
 * Registers the selected provider under {@link CRYPTO_KEY_PROVIDER}.
 *
 * Composed into all three composition roots (`apps/{api,worker,scheduler}`),
 * which is what makes the FND-10 guard reachable from a **real boot**: the
 * factory below runs while Nest instantiates instances, so a
 * `NODE_ENV=production` process refuses to start on a local key even though
 * nothing in Phase 1 injects the token yet. Until the gap-closure pass this
 * module was reachable only from
 * `Test.createTestingModule({ imports: [CryptoModule] })` — a guard that was
 * provable and unreachable, i.e. a security control nothing could trip.
 *
 * ## The boot-time contract this creates, stated rather than discovered
 *
 * Because the provider is constructed eagerly, a process that selects `local`
 * must also name its key file. On a developer machine:
 *
 * ```sh
 * head -c 32 /dev/urandom > .dev-local-key   # 32 raw bytes; the PATH, never the key
 * export CRYPTO_LOCAL_KEY_FILE="$PWD/.dev-local-key"
 * ```
 *
 * `NODE_ENV=production` refuses with `CRYPTO_KEY_PROVIDER_REQUIRED:` **before**
 * any of that — the guard runs first, so a production container never reads a key
 * file it was about to be refused for holding. And `CRYPTO_KEY_PROVIDER=kms`
 * refuses with `KMS_PROVIDER_BLOCKED:`, so today *every* boot needs the local
 * key file; the day B-3 names a vendor, that stops being true and this paragraph
 * goes with it.
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