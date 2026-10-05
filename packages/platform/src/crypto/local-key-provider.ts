import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  DEK_LENGTH_BYTES,
  assertDekLength,
  type KeyProvider,
} from './key-provider.js';
import { localKeyProviderAllowed } from './production-guard.js';

/**
 * `LocalKeyProvider` — a **development-only** `KeyProvider` backed by a key file.
 *
 * ## What this is not
 *
 * It is **not** a KMS and it is not a stand-in for one. The key file is a
 * plaintext master key on a developer disk, which is exactly the property NFR-SEC-3
 * forbids in any deployment that matters. The class exists so the envelope, the
 * `KeyProvider` contract and the DI wiring can be exercised end-to-end in
 * development and in CI without naming a cloud first (D-27).
 *
 * ## The refusal is in the constructor, not at the call site
 *
 * `new LocalKeyProvider(...)` throws `LOCAL_KEY_PROVIDER_FORBIDDEN:` unless the
 * process is in an environment where a local key is expected, or an operator
 * has set `CRYPTO_LOCAL_KEY_ALLOWED=true`. Placing the check here rather than in
 * `CryptoModule` means the provider is unconstructable outside development and
 * test **no matter who builds it** — a second call site, a test helper, or a
 * future app module cannot reach a local key by forgetting the guard.
 * `assertKeyProviderAllowed` (`production-guard.ts`) is the earlier, cheaper
 * gate; this one is the backstop that makes the earlier one optional to get
 * right. Both call the same `localKeyProviderAllowed` predicate, so the two
 * cannot drift apart and disagree about what is permitted.
 *
 * ## An unset `NODE_ENV` is a refusal, not a default (CR-01)
 *
 * The parameter defaults to the live `NODE_ENV` with **no** fallback. The
 * previous `?? 'development'` meant the one process that had not declared its
 * environment at all was treated as the one environment in which a plaintext key
 * file is acceptable — the exact state CR-01 exists to make unreachable.
 *
 * ## The wrapping is text-shaped on purpose
 *
 * `wrapDek` emits `local:v1:<kid>:<iv>:<tag>:<ct>` as a **UTF-8 `Buffer`**,
 * which is the same shape Vault transit returns (`vault:v1:…` is a string, not
 * bytes). That is deliberate: PD-4 resolved B-3's text-versus-bytes failure mode
 * by making `wrapped: Buffer` tolerate a UTF-8 encoding, and a resolution only
 * proven by a stub is a resolution the next adapter can quietly get wrong.
 * Exercising it in the one provider that actually runs means `LocalKeyProvider`
 * doubles as the reference for how a text-returning adapter is written.
 *
 * The wrapping is real AES-256-GCM with a fresh random 12-byte nonce — not a
 * mask, not an XOR. NFR-SEC-3 forbids ad-hoc crypto even in a dev provider,
 * because a dev provider that is crypto-shaped but not crypto-correct trains the
 * wrong reflex and hides the failure that matters.
 */

/**
 * `local:v1:` — byte-for-byte the same `scheme:version:` shape Vault transit
 * returns. The scheme and the version are two separate fields precisely because
 * the prefix itself contains a separator, which is the one parsing hazard a
 * hand-rolled adapter inherits from that format.
 */
const WRAP_SCHEME = 'local';
const WRAP_VERSION = 'v1';
const WRAP_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
/** Separates the six colon-delimited fields of the text wrapping. */
const FIELD_SEPARATOR = ':';

export interface LocalKeyProviderOptions {
  /**
   * Path to a file holding exactly 32 raw bytes of key material.
   *
   * This is a **path**, not a secret, so it is the one crypto value that may
   * come from configuration. The key itself never appears in a config file or
   * an env var (NFR-SEC-3).
   */
  readonly keyFilePath: string;
  /**
   * Overridable so a test can exercise the refusal without mutating
   * `process.env`. Defaults to the real `NODE_ENV`, **unsubstituted** — an
   * absent value is refused, not defaulted (CR-01).
   */
  readonly nodeEnv?: string | undefined;
  /**
   * Overridable for the same reason as `nodeEnv`; defaults to the real
   * `CRYPTO_LOCAL_KEY_ALLOWED`. Only the exact string `'true'` is an opt-in.
   */
  readonly localKeyAllowed?: string | undefined;
}

export class LocalKeyProvider implements KeyProvider {
  readonly #masterKey: Buffer;
  readonly #kid: string;

  constructor({
    keyFilePath,
    nodeEnv = process.env['NODE_ENV'],
    localKeyAllowed = process.env['CRYPTO_LOCAL_KEY_ALLOWED'],
  }: LocalKeyProviderOptions) {
    // The backstop, on the same predicate as the early guard.
    if (!localKeyProviderAllowed({ NODE_ENV: nodeEnv, CRYPTO_KEY_PROVIDER: 'local', CRYPTO_LOCAL_KEY_ALLOWED: localKeyAllowed })) {
      throw new Error(
        `LOCAL_KEY_PROVIDER_FORBIDDEN: the local key provider requires NODE_ENV=development or test, or CRYPTO_LOCAL_KEY_ALLOWED=true; got NODE_ENV=${nodeEnv ?? '(unset)'}`,
      );
    }

    const key = readFileSync(keyFilePath);
    if (key.length !== DEK_LENGTH_BYTES) {
      throw new Error(
        `LOCAL_KEY_FILE_INVALID: expected ${DEK_LENGTH_BYTES} bytes in the local key file, got ${key.length}`,
      );
    }
    this.#masterKey = key;

    // A short digest prefix is a stable identifier with no key bytes in it, and
    // no length-extension or padding-oracle surface: it is never an input to
    // anything but the `kid` equality check.
    this.#kid = `local-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
  }

  /** Stable across processes for a given key file; exposes no key material. */
  async keyId(): Promise<string> {
    return this.#kid;
  }

  async wrapDek(dek: Buffer): Promise<{ wrapped: Buffer; kid: string }> {
    assertDekLength(dek, 'LocalKeyProvider.wrapDek');
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(WRAP_ALGORITHM, this.#masterKey, iv);
    const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
    const tag = cipher.getAuthTag();
    assertTag(tag);

    const text = [
      WRAP_SCHEME,
      WRAP_VERSION,
      this.#kid,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ct.toString('base64url'),
    ].join(FIELD_SEPARATOR);

    // UTF-8, not bytes: see "The wrapping is text-shaped on purpose" above.
    return { wrapped: Buffer.from(text, 'utf8'), kid: this.#kid };
  }

  async unwrapDek(wrapped: Buffer, kid: string): Promise<Buffer> {
    // `wrapped` is typed `Buffer`; the `else` arm is runtime tolerance for the
    // one thing the type cannot forbid — a text-shaped value handed over by a
    // Vault-style adapter (B-3 failure mode 2). It costs one line and turns a
    // silent wrong-unwrapping into the UTF-8 decode the contract promises.
    const bytes = Buffer.isBuffer(wrapped) ? wrapped : Buffer.from(String(wrapped), 'utf8');
    const fields = bytes.toString('utf8').split(FIELD_SEPARATOR);

    if (fields.length !== 6 || fields[0] !== WRAP_SCHEME || fields[1] !== WRAP_VERSION) {
      throw new Error('LOCAL_KEY_UNWRAP_FAILED: not a local:v1 wrapping');
    }
    const [, , wrappedKid, ivPart, tagPart, ctPart] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];

    // An adapter must not unwrap under a different key: a mismatch means the
    // caller asked for the wrong `kid`, and answering anyway would hide a
    // rotation bug (D-25's additive-rotation property depends on this check).
    if (wrappedKid !== kid) {
      throw new Error(`LOCAL_KEY_UNWRAP_FAILED: kid ${kid} cannot unwrap ${wrappedKid}`);
    }

    const iv = decode(ivPart, 'iv');
    const tag = decode(tagPart, 'tag');
    const ct = decode(ctPart, 'ct');
    if (iv.length !== IV_LENGTH_BYTES) {
      throw new Error(`LOCAL_KEY_UNWRAP_FAILED: iv must be ${IV_LENGTH_BYTES} bytes`);
    }
    assertTag(tag);

    const decipher = createDecipheriv(WRAP_ALGORITHM, this.#masterKey, iv);
    decipher.setAuthTag(tag);
    try {
      // `final()` is where AES-GCM verifies the auth tag. It throws on a
      // corrupted tag or ciphertext — it never returns unauthenticated bytes.
      return Buffer.concat([decipher.update(ct), decipher.final()]);
    } catch (cause) {
      throw new Error('LOCAL_KEY_UNWRAP_FAILED: authentication failed', { cause });
    }
  }
}

/** Node refuses an auth tag of the wrong length, so say so in our own words. */
function assertTag(tag: Buffer): void {
  if (tag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error(
      `LOCAL_KEY_AUTH_TAG_INVALID: expected ${AUTH_TAG_LENGTH_BYTES} bytes, got ${tag.length}`,
    );
  }
}

function decode(part: string, field: string): Buffer {
  if (part === undefined || part === '') {
    throw new Error(`LOCAL_KEY_UNWRAP_FAILED: missing ${field}`);
  }
  return Buffer.from(part, 'base64url');
}