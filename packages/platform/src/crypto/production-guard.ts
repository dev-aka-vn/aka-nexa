/**
 * The production guard: production may not run on a local key (D-27, T-1-13).
 *
 * ## Why this is its own file and not a `superRefine` in the config schema
 *
 * 01-02 built `AppConfigSchema` with one named boot failure, `CONFIG_INVALID:`,
 * and deliberately left the production-KMS rule to this plan. Two reasons it
 * does not belong there:
 *
 * 1. **A different failure vocabulary.** A missing or malformed config value is
 *    `CONFIG_INVALID: <path> <code>`. A well-formed config that is *refused by
 *    policy* is `CRYPTO_KEY_PROVIDER_REQUIRED:`. Collapsing the second into the
 *    first would make an operator grep for a typo when the deployment is fine
 *    and the *policy* is the problem.
 * 2. **The schema must not decide this.** `CRYPTO_KEY_PROVIDER` is an ordinary
 *    enum in the schema; whether `local` is *allowed* depends on `NODE_ENV`,
 *    and encoding "production forbids local" there would put a security policy
 *    inside a shape validator that also has to run under `vitest` and in
 *    tooling. The guard belongs to the crypto owner.
 *
 * The guard is **not** the only control: `LocalKeyProvider`'s constructor also
 * refuses. This one is the cheap, early abort; the other is the backstop that
 * holds even if this file is bypassed.
 */

/**
 * The fields this guard reads, and nothing else.
 *
 * Narrower than the full config so it cannot be handed a half-built config and
 * so the call site stays a one-liner.
 *
 * `NODE_ENV` is `string | undefined` because **an absent value is a state this
 * guard has to refuse, not one it may assume away** (CR-01). The previous shape
 * typed it `string` and every caller therefore supplied `?? 'development'`, which
 * made "this process never declared its environment" and "this is a developer
 * laptop" the same value — so a production container that omitted `NODE_ENV`
 * booted on a plaintext key file with no refusal anywhere.
 */
export interface KeyProviderGuardConfig {
  readonly NODE_ENV: string | undefined;
  readonly CRYPTO_KEY_PROVIDER: string;
  /**
   * The explicit operator opt-in, read as the raw string the environment
   * carries. Only the exact value `'true'` opens the door — a typo, a capital
   * `TRUE`, or a value set by accident is a closed door, because the failure
   * mode of guessing "probably meant true" is a plaintext key in production.
   */
  readonly CRYPTO_LOCAL_KEY_ALLOWED?: string | undefined;
}

/**
 * The environments where a plaintext master key on disk is the *expected* shape.
 *
 * A closed list, not an open one: `staging`, `prod`, `Production`, `''` and an
 * unset value are all refused, so a deployment whose environment is misspelled
 * cannot silently inherit developer behaviour.
 */
const LOCAL_KEY_ENVS: ReadonlySet<string> = new Set(['development', 'test']);

/**
 * Whether the local key provider is permitted for this process.
 *
 * **Fail closed.** The local key is available where a developer expects it, or
 * where an operator has explicitly said so with `CRYPTO_LOCAL_KEY_ALLOWED=true`
 * — never merely because nothing objected. That inversion is the whole of CR-01:
 * the previous rule keyed the refusal on the *absence* of a production marker,
 * which an operator can forget, and the safe default was the one that required
 * remembering something.
 *
 * `NODE_ENV=production` is **not** covered by the opt-in — see
 * {@link assertKeyProviderAllowed}, which refuses production before this
 * predicate is consulted. The opt-in exists for a non-production deployment
 * that is not named `development`/`test` (a staging box, an ephemeral preview
 * environment); it is not a way to run production on a local key.
 */
export function localKeyProviderAllowed(config: KeyProviderGuardConfig): boolean {
  if (config.CRYPTO_KEY_PROVIDER !== 'local') return true;
  // D-27/NFR-SEC-3, and not relaxable: the opt-in below is for a non-production
  // deployment that is not named development or test. Stated here as well as in
  // `assertKeyProviderAllowed` because this predicate is the *backstop* — it is
  // the rule the `LocalKeyProvider` constructor applies on its own, and a
  // backstop that the opt-in could switch off would not be one.
  if (config.NODE_ENV === 'production') return false;
  if (config.NODE_ENV !== undefined && LOCAL_KEY_ENVS.has(config.NODE_ENV)) return true;
  return config.CRYPTO_LOCAL_KEY_ALLOWED === 'true';
}

/**
 * Abort boot when a process would run on a local key it has not been given
 * explicit permission to use.
 *
 * @throws `CRYPTO_KEY_PROVIDER_REQUIRED` when `NODE_ENV === "production"` and
 *   `CRYPTO_KEY_PROVIDER !== "kms"`, or when the local key is selected anywhere
 *   outside `development`/`test` without `CRYPTO_LOCAL_KEY_ALLOWED=true`
 */
export function assertKeyProviderAllowed(config: KeyProviderGuardConfig): void {
  // First, and not relaxed by anything below: production is kms-only (D-27,
  // NFR-SEC-3). `kms` itself is blocked until a vendor is named, so today's
  // production boot fails here or at `KMS_PROVIDER_BLOCKED:` — never on a local
  // key, which is the entire point of shipping the guard before the vendor.
  if (config.NODE_ENV === 'production' && config.CRYPTO_KEY_PROVIDER !== 'kms') {
    throw new Error(
      `CRYPTO_KEY_PROVIDER_REQUIRED: production requires kms, got ${config.CRYPTO_KEY_PROVIDER}`,
    );
  }

  if (!localKeyProviderAllowed(config)) {
    throw new Error(
      `CRYPTO_KEY_PROVIDER_REQUIRED: the local key provider requires NODE_ENV=development or test, or CRYPTO_LOCAL_KEY_ALLOWED=true; got NODE_ENV=${config.NODE_ENV ?? '(unset)'}`,
    );
  }
}