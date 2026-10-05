import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import {
  unwrapDekChecked,
  wrapDekChecked,
  type KeyProvider,
} from './key-provider.js';

/**
 * The versioned AES-256-GCM secret envelope (D-25, D-26, T-1-12).
 *
 * Node's stdlib `crypto`, and nothing else. STACK.md §11 says so explicitly:
 * AES-256-GCM needs no package, and T-1-SC's mitigation is *no new package*, so
 * adding a crypto dependency here would be the threat, not the mitigation.
 *
 * ## Shape
 *
 * `{ v: 1, alg: "A256GCM", kid, iv, tag, ct }` — `v`, `alg` and `kid` are
 * plaintext, `iv`/`tag`/`ct` are base64url. `kid` is present from `v: 1`
 * precisely so rotation is **additive**: a secret written under a retired key
 * is re-wrapped by the KMS, never re-encrypted from plaintext the system will
 * not have. That property is why `v` and `alg` are explicit rather than
 * inferred — a future `alg` must be *refused*, not best-guessed.
 *
 * ## The three properties that are the whole security argument
 *
 * 1. **The auth tag is stored AND verified.** `getAuthTag()` writes 16 bytes
 *    into the envelope and `setAuthTag()` puts them back before `final()`,
 *    which is where AES-GCM authenticates. A corrupted `tag` or `ct` throws.
 *    Losing the tag must never degrade into "return unauthenticated bytes".
 * 2. **A fresh random 12-byte `iv` per encryption.** 96-bit GCM nonces are
 *    catastrophic on reuse under one key, so the nonce is drawn from
 *    `randomBytes`, never a counter, never derived, and `envelope.spec.ts`
 *    asserts two encryptions of the same plaintext differ in both `iv` and
 *    `ct`. (D-25 permits a counter *or* a random 12; random is what ships.)
 * 3. **The plaintext and the key never reach a log.** The functions below do no
 *    logging at all, and the spec proves the guarantee end-to-end through a real
 *    pino instance rather than asserting a property of code that has none.
 *
 * ## Where the DEK comes from, and the one Phase-1 limitation
 *
 * Real envelope encryption wraps a **random per-secret DEK** and stores that
 * wrapping beside the ciphertext. Phase 1 cannot do that: D-25 freezes the
 * envelope at five fields with no room for a wrapped DEK, and D-28 stores no
 * secret at all. So the DEK is derived from the provider's own key material
 * through the interface — `wrapDek` of a fixed 32-byte derivation label,
 * immediately unwrapped again — which is stable for a given key and is
 * **deterministic in the DEK, never in the nonce**.
 *
 * The consequence is recorded rather than hidden: rotating `kid` makes
 * previously sealed envelopes undecryptable until the store lands and a per-secret
 * wrapped DEK can be persisted, at which point `encryptSecret` grows a sibling
 * field and the envelope's five fields do not change. That upgrade is additive,
 * which is the entire reason `kid` is in v1.
 */

/** GCM's `iv` is 96 bits. Never change this without changing `v`. */
export const IV_LENGTH_BYTES = 12;
/** GCM's authentication tag is 128 bits and is stored in full. */
export const AUTH_TAG_LENGTH_BYTES = 16;

/** The only envelope version this build reads or writes. */
export const ENVELOPE_VERSION = 1;
/** The only algorithm this build reads or writes (JWA `A256GCM`). */
export const ENVELOPE_ALG = 'A256GCM';

const CIPHER = 'aes-256-gcm';

/**
 * The fixed input wrapped to derive the data-encryption key.
 *
 * Exactly 32 bytes so it satisfies the same length gate a real DEK does. It is
 * a **label, not a secret** — it is public, fixed, and only ever wrapped under
 * the provider's master key. Changing it changes every derived DEK, so it
 * carries a version marker in its own text.
 */
const DEK_DERIVATION_LABEL = Buffer.from('akane.dek.v1.envelope-derivation', 'utf8');

/** The frozen stored shape (D-25). Five fields, no more, no fewer. */
export interface SecretEnvelope {
  /** Envelope version. Refused unless it is exactly `1`. */
  readonly v: typeof ENVELOPE_VERSION;
  /** Algorithm identifier. Refused unless it is exactly `A256GCM`. */
  readonly alg: typeof ENVELOPE_ALG;
  /** The provider key that can unwrap this secret's DEK (D-25 rotation). */
  readonly kid: string;
  /** 12 random bytes, base64url. Never reused under one key. */
  readonly iv: string;
  /** 16 bytes, base64url. Verified on every decrypt; losing it fails loudly. */
  readonly tag: string;
  /** Ciphertext, base64url. */
  readonly ct: string;
}

/**
 * Derive the data-encryption key for `kid` from the provider's key material.
 *
 * Deterministic in the DEK (the wrapping's random nonce does not affect the
 * unwrapped value) and identical on the encrypt and decrypt path, which is what
 * lets `decryptSecret(envelope)` reconstruct the key from the envelope alone.
 */
async function deriveDek(
  keyProvider: KeyProvider,
): Promise<{ dek: Buffer; kid: string }> {
  const { wrapped, kid } = await wrapDekChecked(keyProvider, DEK_DERIVATION_LABEL);
  const dek = await unwrapDekChecked(keyProvider, wrapped, kid);
  return { dek, kid };
}

/**
 * Seal a secret.
 *
 * @param plaintext the secret. A `string` is UTF-8 encoded; `Buffer` is taken as-is.
 * @param keyProvider supplies the key material and the `kid` recorded in the envelope
 * @returns the frozen {@link SecretEnvelope}
 * @throws `KEY_LENGTH_INVALID` from the provider gate, and any provider error
 */
export async function encryptSecret(
  plaintext: Buffer | string,
  keyProvider: KeyProvider,
): Promise<SecretEnvelope> {
  const bytes = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  if (!Buffer.isBuffer(bytes)) {
    throw new Error('ENVELOPE_PLAINTEXT_INVALID: expected a Buffer or string');
  }

  const { dek, kid } = await deriveDek(keyProvider);
  try {
    // Fresh per encryption. Never a counter, never derived from the plaintext —
    // a 96-bit nonce reused under one key breaks GCM outright.
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(CIPHER, dek, iv);
    const ct = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const tag = cipher.getAuthTag();

    if (tag.length !== AUTH_TAG_LENGTH_BYTES) {
      // Cannot happen with `createCipheriv`, and if it ever did the tag would be
      // silently stored wrong. Fail here rather than persist an unauthenticable
      // envelope.
      throw new Error(
        `ENVELOPE_AUTH_TAG_INVALID: expected ${AUTH_TAG_LENGTH_BYTES} bytes, got ${tag.length}`,
      );
    }

    return {
      v: ENVELOPE_VERSION,
      alg: ENVELOPE_ALG,
      kid,
      iv: iv.toString('base64url'),
      tag: tag.toString('base64url'),
      ct: ct.toString('base64url'),
    };
  } finally {
    // Best-effort: the DEK should not outlive the call that needed it.
    dek.fill(0);
  }
}

/**
 * Open a sealed secret.
 *
 * Fails loudly on every failure mode — unsupported version, unsupported
 * algorithm, malformed field, `kid` the current provider cannot unwrap, a
 * corrupted auth tag, a corrupted ciphertext. There is no path that returns
 * unauthenticated bytes.
 *
 * @returns the plaintext as a `Buffer` (round-trip a `string` with `.toString('utf8')`)
 */
export async function decryptSecret(
  envelope: SecretEnvelope,
  keyProvider: KeyProvider,
): Promise<Buffer> {
  // The version and the algorithm are refused, never inferred. A future
  // `A192GCM` envelope must fail rather than be opened with the wrong cipher.
  if (envelope?.v !== ENVELOPE_VERSION) {
    throw new Error(`ENVELOPE_VERSION_UNSUPPORTED: expected ${ENVELOPE_VERSION}, got ${String(envelope?.v)}`);
  }
  if (envelope.alg !== ENVELOPE_ALG) {
    throw new Error(`ENVELOPE_ALG_UNSUPPORTED: expected ${ENVELOPE_ALG}, got ${String(envelope.alg)}`);
  }
  if (typeof envelope.kid !== 'string' || envelope.kid === '') {
    throw new Error('ENVELOPE_KID_INVALID: kid must be a non-empty string');
  }

  const iv = decodeField(envelope.iv, 'iv');
  const tag = decodeField(envelope.tag, 'tag');
  const ct = decodeField(envelope.ct, 'ct');

  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error(`ENVELOPE_IV_INVALID: expected ${IV_LENGTH_BYTES} bytes, got ${iv.length}`);
  }
  if (tag.length !== AUTH_TAG_LENGTH_BYTES) {
    // This is the "losing the auth tag must fail loudly" rule. A missing or
    // truncated tag is a hard error, not a default of zeros.
    throw new Error(
      `ENVELOPE_AUTH_TAG_INVALID: expected ${AUTH_TAG_LENGTH_BYTES} bytes, got ${tag.length}`,
    );
  }

  const { dek, kid } = await deriveDek(keyProvider);
  if (envelope.kid !== kid) {
    // Rotation guard: a provider holding one key cannot open an envelope sealed
    // under another. Refusing is what makes `kid` meaningful.
    dek.fill(0);
    throw new Error(`KEY_ID_MISMATCH: envelope was sealed under ${envelope.kid}, provider is ${kid}`);
  }

  try {
    const decipher = createDecipheriv(CIPHER, dek, iv);
    decipher.setAuthTag(tag);
    // `final()` is the authentication check. It throws on a corrupted tag or
    // ciphertext; there is no branch that returns unauthenticated plaintext.
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch (cause) {
    throw new Error('ENVELOPE_DECRYPT_FAILED: authentication failed', { cause });
  } finally {
    dek.fill(0);
  }
}

/**
 * Decode one base64url field.
 *
 * Only the *type* is checked here. Emptiness is deliberately allowed, because
 * an empty plaintext legitimately produces an empty `ct` — refusing it here
 * would make an empty credential unround-trippable. The fields that must be
 * non-empty carry a length assertion at the call site (`iv` 12 bytes, `tag` 16),
 * which is the stronger check anyway.
 */
function decodeField(value: string, field: string): Buffer {
  if (typeof value !== 'string') {
    throw new Error(`ENVELOPE_FIELD_INVALID: ${field} must be a base64url string`);
  }
  return Buffer.from(value, 'base64url');
}