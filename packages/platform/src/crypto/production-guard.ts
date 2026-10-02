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
 * refuses `NODE_ENV=production`. This one is the cheap, early abort; the other is
 * the backstop that holds even if this file is bypassed.
 */

/**
 * The two fields this guard reads, and nothing else.
 *
 * Narrower than the full config so it cannot be handed a half-built config and
 * so the call site stays a one-liner.
 */
export interface KeyProviderGuardConfig {
  readonly NODE_ENV: string;
  readonly CRYPTO_KEY_PROVIDER: string;
}

/**
 * Abort boot when a production process would use anything but the KMS provider.
 *
 * @throws `CRYPTO_KEY_PROVIDER_REQUIRED` when `NODE_ENV === "production"` and
 *   `CRYPTO_KEY_PROVIDER !== "kms"`
 */
export function assertKeyProviderAllowed(config: KeyProviderGuardConfig): void {
  if (config.NODE_ENV === 'production' && config.CRYPTO_KEY_PROVIDER !== 'kms') {
    throw new Error(
      `CRYPTO_KEY_PROVIDER_REQUIRED: production requires kms, got ${config.CRYPTO_KEY_PROVIDER}`,
    );
  }
}