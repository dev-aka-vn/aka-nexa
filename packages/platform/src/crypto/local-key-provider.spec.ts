import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEK_LENGTH_BYTES } from './key-provider.js';
import { LocalKeyProvider } from './local-key-provider.js';

/**
 * `LocalKeyProvider` — the production refusal and the wrap/unwrap round-trip.
 *
 * The key file is written into a per-run temp directory, never committed and
 * never read from an env var (NFR-SEC-3). Phase 1 stores no real secret
 * (D-28): what is exercised here is the mechanism, over key material generated
 * per run and discarded with the directory.
 */

let dir: string;
let keyFilePath: string;
const MASTER_KEY = randomBytes(DEK_LENGTH_BYTES);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'akane-local-key-'));
  keyFilePath = join(dir, 'master.key');
  writeFileSync(keyFilePath, MASTER_KEY, { mode: 0o600 });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('LocalKeyProvider — refuses to exist in production (D-26, T-1-11)', () => {
  it('throws a named LOCAL_KEY_PROVIDER_FORBIDDEN error under NODE_ENV=production', () => {
    expect(() => new LocalKeyProvider({ keyFilePath, nodeEnv: 'production' })).toThrowError(
      /^LOCAL_KEY_PROVIDER_FORBIDDEN: /,
    );
  });

  it('refuses before it reads the key file, so a missing file cannot mask the refusal', () => {
    expect(
      () => new LocalKeyProvider({ keyFilePath: join(dir, 'absent.key'), nodeEnv: 'production' }),
    ).toThrowError(/^LOCAL_KEY_PROVIDER_FORBIDDEN: /);
  });

  it('constructs under development, test, and an unset NODE_ENV', () => {
    for (const nodeEnv of ['development', 'test', undefined]) {
      expect(() => new LocalKeyProvider({ keyFilePath, nodeEnv })).not.toThrow();
    }
  });

  it('rejects a key file that is not exactly 32 bytes', () => {
    const shortFile = join(dir, 'short.key');
    writeFileSync(shortFile, randomBytes(16));
    expect(() => new LocalKeyProvider({ keyFilePath: shortFile, nodeEnv: 'test' })).toThrowError(
      /^LOCAL_KEY_FILE_INVALID: expected 32 bytes/,
    );
  });
});

describe('LocalKeyProvider — key identity', () => {
  it('keyId() is stable across instances over the same key file and exposes no key bytes', async () => {
    const a = new LocalKeyProvider({ keyFilePath, nodeEnv: 'test' });
    const b = new LocalKeyProvider({ keyFilePath, nodeEnv: 'test' });
    const kid = await a.keyId();

    expect(kid).toBe(await b.keyId());
    expect(kid).toMatch(/^local-[0-9a-f]{16}$/);
    expect(kid).not.toContain(MASTER_KEY.toString('hex'));
    expect(kid).not.toContain(MASTER_KEY.toString('base64url'));
  });

  it('a different key file yields a different kid, so rotation is distinguishable', async () => {
    const otherFile = join(dir, 'other.key');
    writeFileSync(otherFile, randomBytes(DEK_LENGTH_BYTES));

    expect(await new LocalKeyProvider({ keyFilePath: otherFile, nodeEnv: 'test' }).keyId()).not.toBe(
      await new LocalKeyProvider({ keyFilePath, nodeEnv: 'test' }).keyId(),
    );
  });
});

describe('LocalKeyProvider — wrap/unwrap round-trip', () => {
  it('round-trips a 32-byte DEK', async () => {
    const provider = new LocalKeyProvider({ keyFilePath, nodeEnv: 'test' });
    const dek = randomBytes(DEK_LENGTH_BYTES);

    const { wrapped, kid } = await provider.wrapDek(dek);

    expect(await provider.unwrapDek(wrapped, kid)).toEqual(dek);
  });

  it('round-trips DEKs that are all-zero and all-0xff — value must not matter', async () => {
    const provider = new LocalKeyProvider({ keyFilePath, nodeEnv: 'test' });
    for (const dek of [Buffer.alloc(DEK_LENGTH_BYTES), Buffer.alloc(DEK_LENGTH_BYTES, 0xff)]) {
      const { wrapped, kid } = await provider.wrapDek(dek);
      expect(await provider.unwrapDek(wrapped, kid)).toEqual(dek);
    }
  });

  it('emits a TEXT-shaped wrapping (B-3 failure mode 2 / PD-4), not raw bytes', async () => {
    const provider = new LocalKeyProvider({ keyFilePath, nodeEnv: 'test' });
    const { wrapped, kid } = await provider.wrapDek(randomBytes(DEK_LENGTH_BYTES));
    const text = wrapped.toString('utf8');

    // A Vault transit ciphertext is `vault:v1:<base64>` — a *string*. This is the
    // same shape, so the one provider that actually runs proves the `Buffer`
    // contract tolerates text rather than only proving it in a stub.
    expect(text.startsWith('local:v1:')).toBe(true);
    // Six fields, not five: the `scheme:version:` prefix is itself two
    // separator-delimited fields, which is Vault's parsing hazard reproduced.
    expect(text.split(':')).toHaveLength(6);
    expect(text.split(':')[1]).toBe('v1');
    expect(text).toContain(kid);
    // …and the round-trip still works through the text form.
    expect(await provider.unwrapDek(wrapped, kid)).toHaveLength(DEK_LENGTH_BYTES);
  });

  it('rejects a wrong-length DEK on wrap rather than padding it', async () => {
    const provider = new LocalKeyProvider({ keyFilePath, nodeEnv: 'test' });
    await expect(provider.wrapDek(randomBytes(16))).rejects.toThrowError(
      /^KEY_LENGTH_INVALID: LocalKeyProvider\.wrapDek expected 32 bytes, got 16$/,
    );
  });

  it('throws on a wrong-length wrapped input rather than guessing', async () => {
    const provider = new LocalKeyProvider({ keyFilePath, nodeEnv: 'test' });
    const kid = await provider.keyId();

    // A truncated wrapping, raw bytes, and an empty buffer are the three shapes
    // a caller can realistically pass by mistake.
    const { wrapped } = await provider.wrapDek(randomBytes(DEK_LENGTH_BYTES));

    for (const bad of [
      Buffer.alloc(4),
      Buffer.from('not-a-wrapping', 'utf8'),
      wrapped.subarray(0, 10),
      Buffer.alloc(0),
    ]) {
      await expect(provider.unwrapDek(bad, kid)).rejects.toThrowError(
        /^LOCAL_KEY_UNWRAP_FAILED: /,
      );
    }
  });

  it('refuses to unwrap under a kid it was not asked for', async () => {
    const provider = new LocalKeyProvider({ keyFilePath, nodeEnv: 'test' });
    const { wrapped } = await provider.wrapDek(randomBytes(DEK_LENGTH_BYTES));

    await expect(provider.unwrapDek(wrapped, 'local-0000000000000000')).rejects.toThrowError(
      /^LOCAL_KEY_UNWRAP_FAILED: kid local-0000000000000000 cannot unwrap /,
    );
  });

  it('fails authentication on a one-byte corruption of the wrapping', async () => {
    const provider = new LocalKeyProvider({ keyFilePath, nodeEnv: 'test' });
    const dek = randomBytes(DEK_LENGTH_BYTES);
    const { wrapped, kid } = await provider.wrapDek(dek);

    const text = wrapped.toString('utf8');
    const fields = text.split(':');
    const ct = Buffer.from(fields[5] as string, 'base64url');
    ct[0] = (ct[0] as number) ^ 0xff;
    fields[5] = ct.toString('base64url');

    await expect(
      provider.unwrapDek(Buffer.from(fields.join(':'), 'utf8'), kid),
    ).rejects.toThrowError(/^LOCAL_KEY_UNWRAP_FAILED: authentication failed$/);
  });

  it('uses a fresh nonce per wrap, so the same DEK never produces the same wrapping twice', async () => {
    const provider = new LocalKeyProvider({ keyFilePath, nodeEnv: 'test' });
    const dek = randomBytes(DEK_LENGTH_BYTES);

    const first = await provider.wrapDek(dek);
    const second = await provider.wrapDek(dek);

    expect(first.wrapped.toString('utf8')).not.toBe(second.wrapped.toString('utf8'));
    expect(await provider.unwrapDek(first.wrapped, first.kid)).toEqual(dek);
    expect(await provider.unwrapDek(second.wrapped, second.kid)).toEqual(dek);
  });
});