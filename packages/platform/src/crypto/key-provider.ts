/**
 * `KeyProvider` — the interface that must not change when the cloud is named.
 *
 * D-27 names the KMS vendor as a **blocker, not a guess**: no deployment cloud
 * has been chosen, so the interface and its failure modes ship in Phase 1 and
 * the adapter does not. RESEARCH B-3 records the shape and, more importantly,
 * the two adapter-level failure modes that have to be baked in *now* because
 * every stored secret from Phase 4 onward depends on them.
 *
 * ## The two failure modes this interface encodes (B-3)
 *
 * 1. **A wrong-length DEK must throw, not truncate or pad.** An adapter that
 *    returns 16 or 64 bytes is a bug; silently truncating produces a key that
 *    *looks* right and encrypts nothing recoverable, and padding produces a key
 *    whose strength is a lie. {@link assertDekLength} is the single gate, and
 *    {@link unwrapDekChecked} / {@link wrapDekChecked} apply it on both sides of
 *    every adapter boundary — so a *new* adapter is protected by construction
 *    rather than by remembering to call the check.
 *
 * 2. **`wrapped` is a `Buffer`, and a text-shaped value is a valid `Buffer`.**
 *    Vault transit returns `vault:v1:<base64>` as a **string**; AWS and GCP KMS
 *    return **bytes**. A `wrappedIsText: boolean` discriminator would leak the
 *    vendor into the interface — the exact thing D-27 forbids — so the
 *    interface carries no discriminator and every adapter UTF-8-encodes text
 *    ciphertext into the `Buffer`. PD-4 in `01-ASSUMPTIONS.md` records the
 *    resolution. `LocalKeyProvider` deliberately emits its own wrapping in that
 *    text shape so the path is exercised by production code, not only by a stub.
 *
 * ## What is deliberately absent
 *
 * - **No vendor SDK, no vendor import.** T-1-SC: AES-256-GCM is Node stdlib and
 *   the KMS is unbuilt. Adding a cloud package here would pre-empt D-27.
 * - **No way to obtain a master key.** The interface hands out *key material
 *   only*. There is deliberately no `dek()`/`masterKey()` accessor, so no call
 *   site can hold the long-lived key that belongs inside a KMS.
 */

/** DI token for the selected `KeyProvider`. */
export const CRYPTO_KEY_PROVIDER = Symbol('CRYPTO_KEY_PROVIDER');

/**
 * AES-256 is 32 bytes. The length is named once so the interface, the envelope
 * and both adapters cannot disagree about it.
 */
export const DEK_LENGTH_BYTES = 32;

/**
 * A KMS-shaped source of data-encryption keys.
 *
 * Every method returns **key material only** — never a plaintext secret. A
 * provider that could hand back the master key would be a provider that
 * eventually ships one in a log line or a heap dump.
 */
export interface KeyProvider {
  /**
   * Stable identifier recorded in the envelope's `kid` (D-25). Present from
   * `v: 1` so a rotation is additive: a secret encrypted under a retired key is
   * **re-wrapped**, never re-encrypted from plaintext the system will not have.
   *
   * Must expose no key bytes — a short hash prefix, a key ARN, a Vault key name.
   */
  keyId(): Promise<string>;

  /**
   * Wrap a 32-byte data-encryption key (DEK) under the provider's master key.
   *
   * Returns key material only. `wrapped` is a `Buffer` that MAY hold UTF-8 text
   * (failure mode 2 above).
   *
   * @throws when `dek` is not {@link DEK_LENGTH_BYTES} bytes.
   */
  wrapDek(dek: Buffer): Promise<{ wrapped: Buffer; kid: string }>;

  /**
   * Unwrap a DEK previously produced by {@link wrapDek}.
   *
   * @param wrapped the wrapped bytes, exactly as `wrapDek` returned them
   * @param kid the key that must be able to unwrap them; an adapter MUST NOT
   *   silently unwrap under a different key
   * @returns exactly {@link DEK_LENGTH_BYTES} bytes
   * @throws on authentication failure, on a `kid` mismatch, and on any result
   *   whose length is not {@link DEK_LENGTH_BYTES}. Never truncate or pad.
   */
  unwrapDek(wrapped: Buffer, kid: string): Promise<Buffer>;
}

/**
 * The single length gate for DEK material (B-3 failure mode 1).
 *
 * Truncating or padding a wrong-length key produces a key that *appears* valid
 * and silently breaks every secret encrypted under it, so this throws.
 *
 * @param dek candidate DEK material
 * @param operation the call being guarded, named in the error for greppability
 * @returns `dek`, so it can wrap the call site of an adapter
 * @throws `KEY_LENGTH_INVALID` when `dek.length !== DEK_LENGTH_BYTES`
 */
export function assertDekLength(dek: Buffer, operation: string): Buffer {
  if (!Buffer.isBuffer(dek)) {
    throw new Error(
      `KEY_LENGTH_INVALID: ${operation} expected a Buffer, got ${typeof dek}`,
    );
  }
  if (dek.length !== DEK_LENGTH_BYTES) {
    throw new Error(
      `KEY_LENGTH_INVALID: ${operation} expected ${DEK_LENGTH_BYTES} bytes, got ${dek.length}`,
    );
  }
  return dek;
}

/**
 * Wrap a DEK through an arbitrary adapter with the length gate applied.
 *
 * Exists so the gate is *structural*: `envelope.ts` calls this rather than
 * `provider.wrapDek`, and a new adapter cannot skip the check by forgetting to
 * call it.
 */
export async function wrapDekChecked(
  provider: KeyProvider,
  dek: Buffer,
): Promise<{ wrapped: Buffer; kid: string }> {
  assertDekLength(dek, 'wrapDek');
  const result = await provider.wrapDek(dek);
  if (!Buffer.isBuffer(result?.wrapped)) {
    throw new Error(
      'KEY_LENGTH_INVALID: wrapDek returned no Buffer for `wrapped` (a text ciphertext must be UTF-8 encoded)',
    );
  }
  return result;
}

/**
 * Unwrap a DEK through an arbitrary adapter with the length gate applied.
 *
 * This is the boundary RESEARCH B-3 says must fail loudly. It is the only
 * unwrap path the envelope uses, so a broken adapter — including the 16-byte
 * stub in `key-provider.contract.spec.ts` — fails at the seam instead of
 * producing a key that encrypts nothing recoverable.
 */
export async function unwrapDekChecked(
  provider: KeyProvider,
  wrapped: Buffer,
  kid: string,
): Promise<Buffer> {
  const dek = await provider.unwrapDek(wrapped, kid);
  return assertDekLength(dek, 'unwrapDek');
}