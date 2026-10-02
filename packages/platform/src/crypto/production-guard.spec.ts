import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEK_LENGTH_BYTES, CRYPTO_KEY_PROVIDER } from './key-provider.js';
import { CryptoModule, createKeyProvider, readKeyProviderEnv } from './crypto.module.js';
import { assertKeyProviderAllowed } from './production-guard.js';

/**
 * The boot guard (D-27, T-1-13).
 *
 * The three assertions below are the phase's answer to "production can never
 * silently fall back to a local key". The fourth one matters just as much: a
 * *selected* `kms` provider fails with `KMS_PROVIDER_BLOCKED:` naming blocker
 * B-3, so the missing adapter is visible as a boot failure instead of as a
 * quiet no-op that reads like a working integration.
 */

let dir: string;
let keyFilePath: string;
let previousKeyFileEnv: string | undefined;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'akane-guard-'));
  keyFilePath = join(dir, 'master.key');
  writeFileSync(keyFilePath, randomBytes(DEK_LENGTH_BYTES), { mode: 0o600 });
  // Set once for the whole file rather than per test: `createKeyProvider` reads
  // the path from the environment, and a helper that restored it around an
  // async callback would restore it before Nest's async factory had resolved.
  // The one test that needs the value *absent* deletes it explicitly.
  previousKeyFileEnv = process.env['CRYPTO_LOCAL_KEY_FILE'];
  process.env['CRYPTO_LOCAL_KEY_FILE'] = keyFilePath;
});

afterAll(() => {
  if (previousKeyFileEnv === undefined) delete process.env['CRYPTO_LOCAL_KEY_FILE'];
  else process.env['CRYPTO_LOCAL_KEY_FILE'] = previousKeyFileEnv;
  rmSync(dir, { recursive: true, force: true });
});

describe('assertKeyProviderAllowed — production requires kms (D-27)', () => {
  it('aborts boot for production with the local provider', () => {
    expect(() =>
      assertKeyProviderAllowed({ NODE_ENV: 'production', CRYPTO_KEY_PROVIDER: 'local' }),
    ).toThrowError(/^CRYPTO_KEY_PROVIDER_REQUIRED: production requires kms, got local$/);
  });

  it('aborts for production with an unrecognised provider, naming what it got', () => {
    expect(() =>
      assertKeyProviderAllowed({ NODE_ENV: 'production', CRYPTO_KEY_PROVIDER: 'vault' }),
    ).toThrowError(/^CRYPTO_KEY_PROVIDER_REQUIRED: production requires kms, got vault$/);
  });

  it('allows production with kms — the guard polices the fallback, not the KMS', () => {
    expect(() =>
      assertKeyProviderAllowed({ NODE_ENV: 'production', CRYPTO_KEY_PROVIDER: 'kms' }),
    ).not.toThrow();
  });

  it('allows local outside production without inspecting anything else', () => {
    for (const nodeEnv of ['development', 'test', '']) {
      expect(() =>
        assertKeyProviderAllowed({ NODE_ENV: nodeEnv, CRYPTO_KEY_PROVIDER: 'local' }),
      ).not.toThrow();
    }
  });
});

describe('createKeyProvider — selection order (D-27, T-1-13)', () => {
  it('production + local throws CRYPTO_KEY_PROVIDER_REQUIRED:', () => {
    expect(() =>
      createKeyProvider({ NODE_ENV: 'production', CRYPTO_KEY_PROVIDER: 'local' }),
    ).toThrowError(/^CRYPTO_KEY_PROVIDER_REQUIRED: /);
  });

  it('production + local is refused BEFORE the key file is read', () => {
    // No key file is supplied at all. If the guard ran after construction this
    // would fail with LOCAL_KEY_FILE_MISSING — a leak of the wrong failure, and
    // evidence that a key file would have been opened first.
    expect(() =>
      createKeyProvider({ NODE_ENV: 'production', CRYPTO_KEY_PROVIDER: 'local' }),
    ).toThrowError(/^CRYPTO_KEY_PROVIDER_REQUIRED: /);
  });

  it('production + kms reaches KMS_PROVIDER_BLOCKED: rather than falling back', () => {
    expect(() => createKeyProvider({ NODE_ENV: 'production', CRYPTO_KEY_PROVIDER: 'kms' })).toThrowError(
      /^KMS_PROVIDER_BLOCKED: no deployment cloud named \(B-3\)/,
    );
  });

  it('kms is blocked in every environment — the vendor adapter does not exist anywhere', () => {
    for (const nodeEnv of ['development', 'test', 'production']) {
      expect(() => createKeyProvider({ NODE_ENV: nodeEnv, CRYPTO_KEY_PROVIDER: 'kms' })).toThrowError(
        /^KMS_PROVIDER_BLOCKED: /,
      );
    }
  });

  it('development + local constructs a working provider', async () => {
    const provider = createKeyProvider({ NODE_ENV: 'development', CRYPTO_KEY_PROVIDER: 'local' });

    expect(await provider.keyId()).toMatch(/^local-[0-9a-f]{16}$/);
  });

  it('refuses an unrecognised provider rather than defaulting to local', () => {
    expect(() =>
      createKeyProvider({ NODE_ENV: 'development', CRYPTO_KEY_PROVIDER: 'vault' }),
    ).toThrowError(/^CRYPTO_KEY_PROVIDER_UNKNOWN: expected local or kms, got vault$/);
  });

  it('refuses a missing key-file path instead of guessing a default location', () => {
    const previous = process.env['CRYPTO_LOCAL_KEY_FILE'];
    delete process.env['CRYPTO_LOCAL_KEY_FILE'];
    try {
      expect(() =>
        createKeyProvider({ NODE_ENV: 'development', CRYPTO_KEY_PROVIDER: 'local' }),
      ).toThrowError(/^LOCAL_KEY_FILE_MISSING: CRYPTO_LOCAL_KEY_FILE/);
    } finally {
      process.env['CRYPTO_LOCAL_KEY_FILE'] = previous;
    }
  });

  it('a provider built under development still refuses to exist under production', () => {
    // The constructor backstop, independent of the guard. If someone ever
    // removes `assertKeyProviderAllowed` from the factory, this still holds.
    expect(() =>
      createKeyProvider({
        NODE_ENV: 'production',
        CRYPTO_KEY_PROVIDER: 'kms',
        CRYPTO_LOCAL_KEY_FILE: keyFilePath,
      }),
    ).toThrowError(/^KMS_PROVIDER_BLOCKED: /);
  });
});

describe('CryptoModule — DI wiring', () => {
  it('resolves the selected provider under the CRYPTO_KEY_PROVIDER token', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [CryptoModule] }).compile();

    const provider = moduleRef.get<{ keyId(): Promise<string> }>(CRYPTO_KEY_PROVIDER);
    expect(await provider.keyId()).toMatch(/^local-[0-9a-f]{16}$/);

    await moduleRef.close();
  });

  // ---------------------------------------------------------------------
  // Regression: `ConfigModule.forRoot()` is `async` in @nestjs/config@12 and
  // `config.module.ts` calls it at module scope, so `ConfigService` serves a
  // snapshot taken at IMPORT time. A factory that injected `ConfigService`
  // therefore read `NODE_ENV: "test"` even with `process.env.NODE_ENV` already
  // set to `"production"` — found by running the boot path, not by inspection.
  // These three tests pin the live read that replaced it.
  // ---------------------------------------------------------------------
  describe('the guard reads the LIVE environment, not the ConfigService snapshot', () => {
    it('refuses to boot when NODE_ENV becomes production after module import', async () => {
      const previousNodeEnv = process.env['NODE_ENV'];
      const previousProvider = process.env['CRYPTO_KEY_PROVIDER'];
      process.env['NODE_ENV'] = 'development';
      process.env['CRYPTO_KEY_PROVIDER'] = 'local';

      try {
        const moduleRef = await Test.createTestingModule({ imports: [CryptoModule] }).compile();
        // Boot succeeded under development…
        expect(await moduleRef.get<{ keyId(): Promise<string> }>(CRYPTO_KEY_PROVIDER).keyId()).toMatch(
          /^local-[0-9a-f]{16}$/,
        );
        await moduleRef.close();

        // …and the very next boot in the same process refuses. The refusal
        // happens during `compile()`, not on first use: the provider factory
        // runs while the container is being built, so nothing can be resolved
        // against a production process that is holding a local key.
        process.env['NODE_ENV'] = 'production';
        await expect(
          Test.createTestingModule({ imports: [CryptoModule] }).compile(),
        ).rejects.toThrowError(/^CRYPTO_KEY_PROVIDER_REQUIRED: production requires kms, got local$/);
      } finally {
        if (previousNodeEnv === undefined) delete process.env['NODE_ENV'];
        else process.env['NODE_ENV'] = previousNodeEnv;
        if (previousProvider === undefined) delete process.env['CRYPTO_KEY_PROVIDER'];
        else process.env['CRYPTO_KEY_PROVIDER'] = previousProvider;
      }
    });

    it('readKeyProviderEnv reads the object it is handed, not a cached snapshot', () => {
      expect(readKeyProviderEnv({ NODE_ENV: 'production', CRYPTO_KEY_PROVIDER: 'local' })).toMatchObject({
        NODE_ENV: 'production',
        CRYPTO_KEY_PROVIDER: 'local',
      });
      expect(readKeyProviderEnv({})).toMatchObject({
        NODE_ENV: 'development',
        CRYPTO_KEY_PROVIDER: 'local',
      });
    });
  });
});