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
  readonly previousPublicKey?: string | null;
  readonly currentPublicKey?: string | null;
  readonly publicKeys?: readonly string[] | readonly Array<{ kid?: string; key: string }>;
  readonly keyId?: string | null;
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
 * @throws `jose.errors.JWTClaimValidationFailed` when `iss`/`aud` mismatch
 * @throws `jose.errors.JWSSignatureVerificationFailed` on a bad signature
 *
 * The caller catches these and maps each to a {@link ReadDenyReason} — the
 * domain-level reason is richer than the jose error because `jose` does not
 * distinguish "expired" from "revoked", and the verifier must (LNK-08).
 */
export async function verifyReadLinkJwt(
  token: string,
  publicKey: ReadLinkPublicKey | readonly ReadLinkPublicKey[],
  options: ReadLinkJwtVerifyOptions,
): Promise<Record<string, unknown>> {
  const keys: readonly string[] = Array.isArray(publicKey)
    ? publicKey
    : [publicKey];

  // Build key set with metadata
  const keyEntries: Array<{ kid?: string; key: string }> = [];
  // Add initial keys
  for (const k of keys) {
    keyEntries.push({ key: k });
  }
  if (options.currentPublicKey) {
    keyEntries.push({ key: options.currentPublicKey });
  }
  if (options.previousPublicKey) {
    keyEntries.push({ key: options.previousPublicKey });
  }
  if (options.publicKeys) {
    for (const k of options.publicKeys) {
      if (typeof k === 'string') {
        keyEntries.push({ key: k });
      } else {
        keyEntries.push({ kid: k.kid, key: k.key });
      }
    }
  }

  // Deduplicate by key string
  const seen = new Set<string>();
  const uniqueKeys = keyEntries.filter((e) => {
    if (seen.has(e.key)) return false;
    seen.add(e.key);
    return true;
  });

  if (uniqueKeys.length === 0) {
    throw new jose.errors.JWSSignatureVerificationFailed();
  }

  // Build key resolver for kid-based lookup with fallback to all keys
  const keyResolver: jose.JWTVerifyGetKey = async (protectedHeader) => {
    const kid = protectedHeader.kid;
    if (kid) {
      // Try to find key with matching kid
      const match = uniqueKeys.find((e) => e.kid === kid);
      if (match) {
        return createPublicKey(match.key);
      }
      // If kid specified but no match found, do NOT return a default key
      // Let verification fail - this prevents accepting tokens with unknown kids
      throw new jose.errors.JWSSignatureVerificationFailed();
    }
    // No kid in header - try all keys (backward compat)
    // Return the first key; jose will try multiple keys if we pass array,
    // but with keyResolver returning single key, better approach is to pass array
    return createPublicKey(uniqueKeys[0].key);
  };

  // For kid-agnostic fallback when no kid present, pass array of keys
  const keyObjects = uniqueKeys.map((e) => createPublicKey(e.key));

  try {
    // Decode header to check for kid
    let hasKid = false;
    try {
      const [headerPart] = token.split('.');
      if (headerPart) {
        const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString());
        hasKid = Boolean(header.kid);
      }
    } catch {
      // ignore
    }

    if (hasKid) {
      const { payload } = await jose.jwtVerify(token, keyResolver, {
        issuer: options.issuer,
        audience: options.audience,
        algorithms: options.algorithms,
      });
      return payload as Record<string, unknown>;
    } else {
      const { payload } = await jose.jwtVerify(token, keyObjects, {
        issuer: options.issuer,
        audience: options.audience,
        algorithms: options.algorithms,
      });
      return payload as Record<string, unknown>;
    }
  } catch (err) {
    throw err;
  }
}
}
