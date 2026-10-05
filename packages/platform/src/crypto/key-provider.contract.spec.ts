import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  CRYPTO_KEY_PROVIDER,
  DEK_LENGTH_BYTES,
  assertDekLength,
  unwrapDekChecked,
  wrapDekChecked,
  type KeyProvider,
} from './key-provider.js';

/**
 * The `KeyProvider` **contract** — what every future KMS adapter inherits.
 *
 * RESEARCH B-3 says two adapter-level failure modes have to be baked in now,
 * because no vendor is named (D-27) and every stored secret from Phase 4 onward
 * depends on this shape. This spec proves both hold against a **stub** provider
 * — deliberately not `LocalKeyProvider`, which already satisfies them. A stub
 * is what lets the contract be violated: it is the only way to assert that a
 * *broken* adapter fails loudly rather than quietly producing a key that
 * encrypts nothing recoverable.
 *
 * What this spec is protecting against:
 *
 * 1. **A wrong-length unwrap result is padded or truncated instead of thrown.**
 * 2. **A text-shaped `wrapped` value is rejected** because the adapter assumed
 *    bytes — the Vault transit failure mode (PD-4).
 */

/** A correct stub: text-shaped, like Vault transit. */
const textShapedStub: KeyProvider = {
  keyId: async () => 'stub-text-1',
  wrapDek: async (dek) => ({
    wrapped: Buffer.from(`vault:v1:${dek.toString('base64url')}`, 'utf8'),
    kid: 'stub-text-1',
  }),
  unwrapDek: async (wrapped) =>
    Buffer.from(wrapped.toString('utf8').slice('vault:v1:'.length), 'base64url'),
};

/** A broken stub: returns 16 bytes and pads nothing — exactly the bug B-3 names. */
const wrongLengthStub: KeyProvider = {
  keyId: async () => 'stub-short-1',
  wrapDek: async () => ({ wrapped: Buffer.from('stub-short-1'), kid: 'stub-short-1' }),
  unwrapDek: async () => randomBytes(16),
};

/** A broken stub: returns the key material plus a `Buffer` concatenation. */
const overLengthStub: KeyProvider = {
  keyId: async () => 'stub-long-1',
  wrapDek: async () => ({ wrapped: Buffer.from('stub-long-1'), kid: 'stub-long-1' }),
  unwrapDek: async () => randomBytes(DEK_LENGTH_BYTES + 8),
};

describe('KeyProvider — interface shape (D-27)', () => {
  it('exposes exactly keyId, wrapDek and unwrapDek, and no master-key accessor', () => {
    const surface = Object.keys(textShapedStub).sort();
    expect(surface).toEqual(['keyId', 'unwrapDek', 'wrapDek']);
    // The whole point of the interface is that no call site can hold the master
    // key. A `dek()` / `masterKey()` / `getKey()` accessor would defeat it.
    expect(surface.some((name) => /key$/i.test(name) && name !== 'keyId')).toBe(false);
  });

  it('CRYPTO_KEY_PROVIDER is a symbol, so a provider token cannot collide with a string key', () => {
    expect(typeof CRYPTO_KEY_PROVIDER).toBe('symbol');
    expect(CRYPTO_KEY_PROVIDER.toString()).toBe('Symbol(CRYPTO_KEY_PROVIDER)');
  });
});

describe('KeyProvider — B-3 failure mode 1: a wrong-length DEK throws', () => {
  it('assertDekLength returns a 32-byte buffer unchanged', () => {
    const dek = randomBytes(DEK_LENGTH_BYTES);
    expect(assertDekLength(dek, 'wrapDek')).toBe(dek);
  });

  it('assertDekLength throws on 16 bytes and names the operation and both lengths', () => {
    expect(() => assertDekLength(randomBytes(16), 'unwrapDek')).toThrowError(
      /^KEY_LENGTH_INVALID: unwrapDek expected 32 bytes, got 16$/,
    );
  });

  it('assertDekLength throws on an over-long key rather than truncating it', () => {
    expect(() => assertDekLength(randomBytes(64), 'unwrapDek')).toThrowError(
      /^KEY_LENGTH_INVALID: unwrapDek expected 32 bytes, got 64$/,
    );
  });

  it('unwrapDekChecked rejects a stub adapter that returns a short key', async () => {
    await expect(unwrapDekChecked(wrongLengthStub, Buffer.from('x'), 'stub-short-1')).rejects.toThrowError(
      /^KEY_LENGTH_INVALID: unwrapDek expected 32 bytes, got 16$/,
    );
  });

  it('unwrapDekChecked rejects a stub adapter that returns a long key', async () => {
    await expect(unwrapDekChecked(overLengthStub, Buffer.from('x'), 'stub-long-1')).rejects.toThrowError(
      /^KEY_LENGTH_INVALID: unwrapDek expected 32 bytes, got 40$/,
    );
  });

  it('wrapDekChecked rejects a short DEK before it ever reaches the adapter', async () => {
    await expect(wrapDekChecked(textShapedStub, randomBytes(24))).rejects.toThrowError(
      /^KEY_LENGTH_INVALID: wrapDek expected 32 bytes, got 24$/,
    );
  });

  it('wrapDekChecked rejects an adapter that returns a non-Buffer `wrapped`', async () => {
    const stringlyStub: KeyProvider = {
      keyId: async () => 'stub-str-1',
      wrapDek: async () => ({ wrapped: 'vault:v1:abc' as unknown as Buffer, kid: 'stub-str-1' }),
      unwrapDek: async () => randomBytes(DEK_LENGTH_BYTES),
    };

    await expect(wrapDekChecked(stringlyStub, randomBytes(DEK_LENGTH_BYTES))).rejects.toThrowError(
      /^KEY_LENGTH_INVALID: wrapDek returned no Buffer for `wrapped`/,
    );
  });
});

describe('KeyProvider — B-3 failure mode 2: a text-shaped wrapped value round-trips', () => {
  it('the stub round-trips through the Vault-shaped `vault:v1:` text form', async () => {
    const dek = randomBytes(DEK_LENGTH_BYTES);
    const { wrapped, kid } = await wrapDekChecked(textShapedStub, dek);

    // The value is a text ciphertext carried as a UTF-8 Buffer — not bytes.
    expect(wrapped.toString('utf8')).toMatch(/^vault:v1:/);
    expect(await unwrapDekChecked(textShapedStub, wrapped, kid)).toEqual(dek);
  });

  it('the checked path never sniffs the wrapped bytes — a non-UTF-8 body passes through untouched', async () => {
    // The opposite failure mode to the one above: an adapter that *rejects*
    // anything not shaped like text. Bytes a UTF-8 decode would mangle must
    // reach `unwrapDek` byte-identical, or a binary-returning KMS is
    // unsupportable.
    const binaryBody = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x00, 0x7f]);
    let received: Buffer | undefined;

    const binaryStub: KeyProvider = {
      keyId: async () => 'stub-binary-1',
      wrapDek: async () => ({ wrapped: binaryBody, kid: 'stub-binary-1' }),
      unwrapDek: async (wrapped) => {
        received = wrapped;
        return randomBytes(DEK_LENGTH_BYTES);
      },
    };

    const dek = await unwrapDekChecked(binaryStub, binaryBody, 'stub-binary-1');

    expect(received).toEqual(binaryBody);
    expect(dek).toHaveLength(DEK_LENGTH_BYTES);
  });
});