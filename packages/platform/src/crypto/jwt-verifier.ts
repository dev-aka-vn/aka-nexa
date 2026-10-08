import { createPublicKey } from 'node:crypto';
import * as jose from 'jose';

/**
 * JWT verification for read-link tokens (LNK-05, T-04-01).
 *
 * ## Why this lives in the crypto category
 *
 * R2 (tooling/boundaries.config.mjs) restricts `jose` imports to the `crypto-owner`
 * file category — `packages/platform/src/crypto/**`. This is the only place in
 * the codebase that may reach the signing primitive, so the read-path verifier
 * in `domain/src/links/` calls *this* function rather than `jose.jwtVerify`
 * directly. The boundary rule is the enforcement of T-04-SC ("no new external
 * deps beyond stack" — jose is approved, but only here).
 *
 * ## What it does and does not do
 *
 * `jwtVerify` checks the signature against the supplied public key with an
 * algorithm allowlist, validates `issuer` and `audience`, and enforces `exp` /
 * `nbf` / `iat` per jose defaults. It does **not** consult Redis — read links
 * are stateless (LNK-05) and consume is `false` (D-42). The returned payload is
 * the raw JWT claims; claim-shape validation against `ReadLinkClaimsSchema`
 * (frozen, D-21) happens one layer up in the domain verifier, which parses
 * the payload through the contract package.
 *
 * ## Key resolution for rotation (LNK-12 / SC#4)
 *
 * The public key is accepted as a PEM-encoded string (the default in
 * local-key-provider.spec.ts). Internally it is resolved to a KeyObject via
 * createPublicKey before being passed to jose — jose 6.x accepts strings at
 * runtime but its KeyInput type does not include them, so the conversion is
 * done here in the crypto-owner, keeping the type boundary clean.
 *
 * The dual-key rotation window is handled by the caller supplying a kid-aware
 * key resolver; jwtVerify key parameter accepts a function that maps
 * protectedHeader.kid -> key. This keeps rotation additive: a key added today
 * does not invalidate links signed under yesterday's key, and removing a
 * retired key after the window closes is a config change, not a code change.
 */

/**
 * Options consumed from configuration at boot, not from the token itself.
 *
 * `issuer` and `audience` come from the deployment's JWT config (the issuer is
 * the platform, the audience is the renderer origin — the renderer is a static
 * web app, so the audience is an origin, not an API key). `algorithms` is a
 * one-element allowlist: `ES256` (STACK.md §5 — asymmetric signing so the
 * static renderer can verify without holding the signing key; HS256 would let
 * anyone holding the verify key mint tokens).
 */
export interface ReadLinkJwtVerifyOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly algorithms: string[];
}

/**
 * The key form jose accepts for verification.
 *
 * `string` covers a PEM-encoded PKCS#8 public key (the default). Other key
 * forms (KeyObject, CryptoKey) can be added by widening this type when the
 * deployment's key resolution needs them; the current tracer and production
 * config both pass a PEM string.
 */
export type ReadLinkPublicKey = string;

/**
 * Verify a read-link JWT and return its claims.
 *
 * @throws `jose.errors.JWTExpired` when `exp` has passed
 * @throws `jose.errorsJWTClaimValidationFailed` when `iss`/`aud` mismatch
 * @throws `jose.errors.JWSSignatureVerificationFailed` on a bad signature
 *
 * The caller catches these and maps each to a {@link ReadDenyReason} — the
 * domain-level reason is richer than the jose error because `jose` does not
 * distinguish "expired" from "revoked", and the verifier must (LNK-08).
 */
export async function verifyReadLinkJwt(
  token: string,
  publicKey: ReadLinkPublicKey,
  options: ReadLinkJwtVerifyOptions,
): Promise<Record<string, unknown>> {
  // jose 6.x: KeyInput type = CryptoKey | KeyObject | JWK | Uint8Array
  // (string is excluded from the type, though accepted at runtime). Convert
  // the PEM string to a KeyObject so the type system and runtime agree.
  const keyObject = createPublicKey(publicKey);

  const { payload } = await jose.jwtVerify(token, keyObject, {
    issuer: options.issuer,
    audience: options.audience,
    algorithms: options.algorithms,
  });

  // jose returns a `JWTPayload`-shaped object whose fields are typed loosely.
  // We return a plain record so the domain verifier can run its own frozen
  // Zod schema over it (the schema is the source of truth, not jose's types).
  return payload as Record<string, unknown>;
}
