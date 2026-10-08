/**
 * The crypto surface (FND-10, D-26/D-27).
 *
 * A separate barrel rather than a line in `packages/platform/src/index.ts`,
 * for the same reason `logging/index.ts` is one: R2 makes
 * `packages/platform/src/crypto/**` the only place that may reach KMS or signing
 * primitives, so a consumer that wants `KeyProvider` and the envelope should not
 * have to import the platform root to get them.
 *
 * ## What a consumer gets, and what it deliberately does not
 *
 * `KeyProvider`, `LocalKeyProvider`, the envelope functions, the production
 * guard and `CryptoModule` are all exported. **No KMS adapter is exported,
 * because none exists** — D-27 names the vendor as an open blocker and guessing
 * one here would be the mistake the decision exists to prevent.
 */

export { CRYPTO_KEY_PROVIDER, DEK_LENGTH_BYTES, assertDekLength, unwrapDekChecked, wrapDekChecked } from './key-provider.js';
export type { KeyProvider } from './key-provider.js';

export { LocalKeyProvider } from './local-key-provider.js';
export type { LocalKeyProviderOptions } from './local-key-provider.js';

export {
  AUTH_TAG_LENGTH_BYTES,
  ENVELOPE_ALG,
  ENVELOPE_VERSION,
  IV_LENGTH_BYTES,
  decryptSecret,
  encryptSecret,
} from './envelope.js';
export type { SecretEnvelope } from './envelope.js';

export { assertKeyProviderAllowed } from './production-guard.js';
export type { KeyProviderGuardConfig } from './production-guard.js';

export { CryptoModule, createKeyProvider } from './crypto.module.js';
export type { KeyProviderConfig, KeyProviderName } from './crypto.module.js';

export {
  verifyReadLinkJwt,
  type ReadLinkJwtVerifyOptions,
  type ReadLinkPublicKey,
} from './jwt-verifier.js';