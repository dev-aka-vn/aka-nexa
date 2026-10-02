---
phase: 01-foundations-platform
plan: 05
subsystem: security
tags: [aes-256-gcm, kms, key-provider, envelope-encryption, node-stdlib-crypto, boot-guard, fnd-10]

requires:
  - phase: 01-foundations-platform
    provides:
      - "01-02: `CRYPTO_KEY_PROVIDER` declared in `AppConfigSchema`, with `namedValidate` as the named boot failure and the production-KMS rule deliberately deferred to this plan"
      - "01-04: the frozen log allowlist and the `formatters.log` rebuild hook, reused to prove no key material or plaintext reaches a serialised record"
      - "01-03: the `crypto-owner` file category (`packages/platform/src/crypto/**`) that R2 already scoped for this package"
provides:
  - "`KeyProvider` interface (`keyId` / `wrapDek` / `unwrapDek`) plus `CRYPTO_KEY_PROVIDER` DI token"
  - "`assertDekLength` / `wrapDekChecked` / `unwrapDekChecked` — the two B-3 adapter failure modes as a structural gate"
  - "`LocalKeyProvider` — dev-only, refuses `NODE_ENV=production` in its constructor, emits a Vault-shaped text wrapping"
  - "`encryptSecret` / `decryptSecret` over the frozen `{ v, alg, kid, iv, tag, ct }` envelope, Node stdlib only"
  - "`assertKeyProviderAllowed(config)` — the production ⇒ `kms` boot guard, in `crypto/**` not the config schema"
  - "`CryptoModule` + `createKeyProvider` — `kms` throws `KMS_PROVIDER_BLOCKED:` naming B-3"
  - "`@akane/platform/crypto` cross-package export"
affects: [01-07, 01-08, 01-09, 01-10, phase-05-integrations, phase-04-read-path, security-audit]

actuals:
  tokens: 61000
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Node stdlib `crypto` only for secret material — AES-256-GCM needs no package and T-1-SC's mitigation is *no new package*"
    - "An adapter boundary that must fail loudly is a checked *function* (`unwrapDekChecked`), not a rule a new adapter has to remember"
    - "A crypto field shape is frozen and asserted on its literal key set, and `v`/`alg` are refused rather than inferred"
    - "Boot refusal order: policy guard first, key material second — a refused process must never have opened a key file"
    - "Two independent refusals (guard + constructor) so a forgotten call site cannot reach a local key"

key-files:
  created:
    - "packages/platform/src/crypto/key-provider.ts — `KeyProvider`, `CRYPTO_KEY_PROVIDER`, `DEK_LENGTH_BYTES`, `assertDekLength`, `wrapDekChecked`, `unwrapDekChecked`"
    - "packages/platform/src/crypto/local-key-provider.ts — dev-only provider; `LOCAL_KEY_PROVIDER_FORBIDDEN:`; text-shaped `local:v1:` wrapping"
    - "packages/platform/src/crypto/envelope.ts — `encryptSecret` / `decryptSecret`, the frozen five-field envelope"
    - "packages/platform/src/crypto/production-guard.ts — `assertKeyProviderAllowed`"
    - "packages/platform/src/crypto/crypto.module.ts — `createKeyProvider`, `readKeyProviderEnv`, `CryptoModule`"
    - "packages/platform/src/crypto/index.ts — the crypto barrel"
    - "packages/platform/src/crypto/key-provider.contract.spec.ts — the interface contract, proven against deliberately broken stubs"
    - "packages/platform/src/crypto/local-key-provider.spec.ts"
    - "packages/platform/src/crypto/envelope.spec.ts"
    - "packages/platform/src/crypto/production-guard.spec.ts"
  modified:
    - "packages/platform/package.json — added the `./crypto` exports entry"
    - ".planning/phases/01-foundations-platform/01-ASSUMPTIONS.md — §6.1–6.4"
    - ".planning/WINDOWS.md — entries 6 and 7"
    - ".planning/STATE.md, .planning/ROADMAP.md"

key-decisions:
  - "PD-4 (B-3 failure mode 2) is proven by construction: `LocalKeyProvider` emits a Vault-shaped text wrapping, so the text-versus-bytes resolution is exercised by the provider that actually runs rather than only by a stub"
  - "The DEK is derived from the provider (wrap a fixed 32-byte label, unwrap it again) because D-25's frozen envelope has nowhere to persist a per-secret wrapped DEK and D-28 stores no secret — rotation therefore cannot survive yet, and that limit is recorded rather than hidden"
  - "Adding a `dek` envelope field and adding a fourth `KeyProvider` method were both rejected: each breaks an acceptance criterion D-25 / B-3 states is costly to change"
  - "`CryptoModule`'s factory reads the **live** environment instead of `ConfigService`, which serves an import-time snapshot; a security guard must never be handed a possibly-stale `NODE_ENV`"
  - "The production refusal exists twice — `assertKeyProviderAllowed` (early, before any key file is opened) and the `LocalKeyProvider` constructor (backstop)"
  - "A missing auth tag is a **length** failure; an empty plaintext is legal, so `decodeField` checks the type only"

patterns-established:
  - "Named, greppable crypto failures: `LOCAL_KEY_PROVIDER_FORBIDDEN:`, `KEY_LENGTH_INVALID:`, `LOCAL_KEY_UNWRAP_FAILED:`, `ENVELOPE_DECRYPT_FAILED:`, `CRYPTO_KEY_PROVIDER_REQUIRED:`, `KMS_PROVIDER_BLOCKED:`, `KEY_ID_MISMATCH:`"
  - "Fail loudly, never degrade: a wrong-length DEK, a truncated tag, an unknown `v` or `alg`, and a `kid` mismatch all throw; none has a fallback branch"
  - "Test the *wrong* adapter, not just the right one: the contract spec drives stub providers that return 16 bytes, 40 bytes, a non-Buffer, and a non-UTF-8 body"
  - "Prove a logging property through a real `pino` instance writing to an in-memory destination and asserting on the serialised bytes"

requirements-completed: []

coverage:
  - id: D1
    description: "`KeyProvider` exposes exactly `keyId` / `wrapDek` / `unwrapDek`, hands out key material only, and never exposes a master key"
    requirement: FND-10
    verification:
      - kind: unit
        ref: "packages/platform/src/crypto/key-provider.contract.spec.ts#KeyProvider — interface shape (D-27)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A wrong-length unwrap result throws rather than being truncated or padded; a text-shaped `Buffer` round-trips (B-3's two adapter failure modes)"
    requirement: FND-10
    verification:
      - kind: unit
        ref: "packages/platform/src/crypto/key-provider.contract.spec.ts#KeyProvider — B-3 failure mode 1 / failure mode 2"
        status: pass
    human_judgment: false
  - id: D3
    description: "`LocalKeyProvider` throws `LOCAL_KEY_PROVIDER_FORBIDDEN:` under `NODE_ENV=production`, works in development, and round-trips a 32-byte DEK"
    requirement: FND-10
    verification:
      - kind: unit
        ref: "packages/platform/src/crypto/local-key-provider.spec.ts#LocalKeyProvider — refuses to exist in production (D-26, T-1-11)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The envelope is exactly `{ v: 1, alg: 'A256GCM', kid, iv, tag, ct }` with base64url `iv`/`tag`/`ct`, and a round-trip returns the original plaintext"
    requirement: FND-10
    verification:
      - kind: unit
        ref: "packages/platform/src/crypto/envelope.spec.ts#decryptSecret — round-trip"
        status: pass
    human_judgment: false
  - id: D5
    description: "The auth tag is stored in full and verified on every open; a one-byte corruption of `tag`, `ct`, or `iv` throws, and a missing tag is a length failure rather than a zeros default"
    requirement: FND-10
    verification:
      - kind: unit
        ref: "packages/platform/src/crypto/envelope.spec.ts#decryptSecret — tampering fails loudly (T-1-12)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Nonce reuse under one key is structurally impossible: 64 encryptions of the same plaintext yield 64 distinct `iv` and 64 distinct `ct` values"
    requirement: FND-10
    verification:
      - kind: unit
        ref: "packages/platform/src/crypto/envelope.spec.ts#decryptSecret — nonce discipline (D-25, T-1-12)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Neither key material nor the plaintext appears in any serialised log record produced during a round-trip — proven through a real pino instance"
    requirement: FND-10
    verification:
      - kind: unit
        ref: "packages/platform/src/crypto/envelope.spec.ts#envelope — the key material and the plaintext never reach a log record (D-26)"
        status: pass
    human_judgment: false
  - id: D8
    description: "`NODE_ENV=production` without `CRYPTO_KEY_PROVIDER=kms` aborts boot with `CRYPTO_KEY_PROVIDER_REQUIRED:`, before any key file is opened"
    requirement: FND-10
    verification:
      - kind: unit
        ref: "packages/platform/src/crypto/production-guard.spec.ts#createKeyProvider — selection order (D-27, T-1-13)"
        status: pass
    human_judgment: false
  - id: D9
    description: "Selecting `kms` fails with `KMS_PROVIDER_BLOCKED:` naming blocker B-3, in every environment, instead of silently falling back to a local key"
    requirement: FND-10
    verification:
      - kind: unit
        ref: "packages/platform/src/crypto/production-guard.spec.ts#createKeyProvider — selection order (D-27, T-1-13)"
        status: pass
    human_judgment: false
  - id: D10
    description: "The guard reads the LIVE environment, so a production boot in the same process as a development boot is still refused (regression against the `ConfigService` import-time snapshot)"
    requirement: FND-10
    verification:
      - kind: unit
        ref: "packages/platform/src/crypto/production-guard.spec.ts#the guard reads the LIVE environment, not the ConfigService snapshot"
        status: pass
    human_judgment: false
  - id: D11
    description: "FND-10 as written — AES-256-GCM under a **KMS-backed** master key — is NOT satisfied, because no deployment cloud has been named and no KMS adapter exists"
    requirement: FND-10
    verification: []
    human_judgment: true
    rationale: "This is blocker B-3 / D-27 and it is not a verification question at all. No automated test can prove a vendor adapter that has deliberately not been written; resolving it requires naming the deployment cloud, which is a customer/decision input rather than engineering work. FND-10 must stay Pending."

duration: 49min
completed: 2026-10-02
status: complete
---

# Phase 1 Plan 05: KeyProvider, AES-256-GCM envelope, and the production key guard

**The KMS-shaped mechanism and the boot refusal ship; the KMS vendor does not — and FND-10 stays Pending because of it.**

## Performance

- **Duration:** 49 min
- **Started:** 2026-10-02T14:09Z
- **Completed:** 2026-10-02T14:58Z
- **Tasks:** 3 (all complete)
- **Files created:** 10 · **Files modified:** 6

## Accomplishments

- **`KeyProvider` is now the interface that must not change later.** Exactly `keyId` / `wrapDek` / `unwrapDek`, key material only, and deliberately **no master-key accessor** so no call site can hold the long-lived key that belongs inside a KMS. RESEARCH B-3's two adapter failure modes are encoded as a *structural* gate (`unwrapDekChecked` / `wrapDekChecked` + `assertDekLength`) rather than a rule each future adapter has to remember: a stub returning 16 or 40 bytes fails at the seam instead of producing a key that encrypts nothing recoverable.
- **PD-4 is proven by construction.** `LocalKeyProvider` emits its wrapping in Vault transit's shape — `local:v1:<kid>:<iv>:<tag>:<ct>` as a UTF-8 `Buffer` — including the `scheme:version:` parsing hazard. The one provider that actually runs is now the reference implementation for a text-returning adapter, so the "does the interface tolerate text or only bytes?" question has an answer that is exercised in production code rather than in a stub.
- **The envelope is versioned, rotation-shaped, and fails loudly.** `{ v: 1, alg: "A256GCM", kid, iv, tag, ct }`, Node stdlib `crypto` and no package at all. `decipher.final()` is the authentication check, so a corrupted `tag`, `ct`, or `iv` throws; an absent tag is a *length* failure rather than a zeros default; `v` and `alg` are refused, never inferred; a `kid` the provider cannot unwrap is refused rather than guessed. 64 encryptions of the same plaintext produce 64 distinct `iv` and 64 distinct `ct` values, so nonce reuse is structurally impossible.
- **No secret and no key material reaches a log.** Proven through a real `pino@10.3.1` instance writing to an in-memory destination and asserting on the serialised bytes — including a case where a caller deliberately spreads the plaintext and the hex key into the log call, where only the seven allowlisted keys survive.
- **Production can never silently fall back to a local key, and the missing vendor is visible.** `NODE_ENV=production` + `CRYPTO_KEY_PROVIDER=local` aborts during `compile()` with `CRYPTO_KEY_PROVIDER_REQUIRED:` **before any key file is opened** (proven by supplying no key file at all and demanding the guard's error). Selecting `kms` aborts with `KMS_PROVIDER_BLOCKED: no deployment cloud named (B-3)` in every environment, so the unbuilt adapter is a visible boot failure rather than a quiet no-op.
- **The KMS blocker is recorded, not resolved.** No vendor is named, no cloud SDK is imported anywhere in `crypto/**`, and no secret store exists (D-28). FND-10 is deliberately **not** marked complete.

## Task Commits

Each task was committed atomically:

1. **Task 1: `KeyProvider` interface and the dev-only `LocalKeyProvider`** — `8979a6c` (feat)
2. **Task 2: AES-256-GCM versioned envelope, stdlib only** — `ab70de1` (feat)
3. **Task 3: Boot assertion — production requires the KMS provider** — `9d990b4` (feat)

**Supporting commit:** `41f19d3` (docs) — `WINDOWS.md` entries 6 and 7, `01-ASSUMPTIONS.md` §6.1–6.4, the `packages/platform/package.json` `./crypto` export.
**Plan metadata:** see the final `docs(01-05)` commit.

## Files Created/Modified

- `packages/platform/src/crypto/key-provider.ts` — `KeyProvider`, `CRYPTO_KEY_PROVIDER`, `DEK_LENGTH_BYTES`, `assertDekLength`, `wrapDekChecked`, `unwrapDekChecked`
- `packages/platform/src/crypto/local-key-provider.ts` — dev-only provider; `LOCAL_KEY_PROVIDER_FORBIDDEN:` in the constructor; AES-256-GCM wrap over a key file, emitted as text
- `packages/platform/src/crypto/envelope.ts` — `encryptSecret` / `decryptSecret` over the frozen five-field envelope
- `packages/platform/src/crypto/production-guard.ts` — `assertKeyProviderAllowed`, the `CRYPTO_KEY_PROVIDER_REQUIRED:` guard
- `packages/platform/src/crypto/crypto.module.ts` — `createKeyProvider`, `readKeyProviderEnv`, `CryptoModule`; `KMS_PROVIDER_BLOCKED:`
- `packages/platform/src/crypto/index.ts` — the crypto barrel (a separate one, so plan 10 needs not edit the platform index)
- `packages/platform/src/crypto/key-provider.contract.spec.ts` — 11 tests driving deliberately broken stub providers
- `packages/platform/src/crypto/local-key-provider.spec.ts` — 14 tests
- `packages/platform/src/crypto/envelope.spec.ts` — 22 tests
- `packages/platform/src/crypto/production-guard.spec.ts` — 15 tests
- `packages/platform/package.json` — `"./crypto"` exports entry (deviation 4)
- `.planning/phases/01-foundations-platform/01-ASSUMPTIONS.md` — §6.1–6.4
- `.planning/WINDOWS.md` — entries 6 (`ConfigService` snapshot) and 7 (unpersisted wrapped DEK)

**Suite:** 20 files / 171 tests green (was 16 / 109). `npm run build` (`npm run lint && tsc -b`) green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The production guard did not fire — `ConfigService` served an import-time snapshot**
- **Found during:** Task 3, by running the boot path end to end rather than by reading the code
- **Issue:** `ConfigModule.forRoot()` is `async` in `@nestjs/config@12`, and `config.module.ts` calls it at module scope without `await`. The validated configuration is therefore a snapshot taken when `config.module.js` is **imported**, and `ConfigService.get()` prefers it over the live environment. The first `CryptoModule` draft injected `ConfigService`, so with `process.env.NODE_ENV = "production"` set before `compile()`, `ConfigService.get('NODE_ENV')` returned `"test"` — the guard passed, and a production boot with `CRYPTO_KEY_PROVIDER=local` reached the key-file read. Measured, not inferred.
- **Fix:** `CryptoModule`'s provider factory reads the live environment through a new `readKeyProviderEnv()`. `namedValidate` still validates the *shape* of both keys at import time; only the copy the policy check is given changed. A regression test boots under development and asserts the very next boot in the same process refuses with `CRYPTO_KEY_PROVIDER_REQUIRED:`.
- **Files modified:** `crypto.module.ts`, `production-guard.spec.ts`
- **Verification:** `production-guard.spec.ts` (15 tests); the failing behaviour was reproduced before the fix
- **Committed in:** `9d990b4`
- **Left open:** the boot module itself is unchanged, so every future `ConfigService` consumer still inherits the snapshot. Recorded as `WINDOWS.md` entry 6 and owned by plan 10 — **fixing it was outside this plan's `files_modified` and would have meant editing a file three completed plans depend on.**

**2. [Rule 1 - Bug] An empty secret could not be decrypted**
- **Found during:** Task 2
- **Issue:** `decodeField` required every base64url field to be non-empty. An empty plaintext legitimately produces an empty `ct`, so an empty credential — an unset password field is a real credential shape — was unround-trippable.
- **Fix:** `decodeField` checks the *type* only. `iv` (12 bytes) and `tag` (16 bytes) carry length assertions at the call site, which is the stronger check; `ct` is allowed to be empty because that is correct.
- **Files modified:** `envelope.ts`, `envelope.spec.ts`
- **Verification:** `envelope.spec.ts#round-trips an empty string, which is a real credential shape`
- **Committed in:** `ab70de1`

**3. [Rule 3 - Blocking] `CryptoModule` could not resolve `ConfigService` in isolation**
- **Found during:** Task 3
- **Issue:** injecting the global `ConfigService` without importing `ConfigModule` compiles in the composed app but fails in an isolated `TestingModule` — the module was untestable.
- **Fix:** superseded by deviation 1 (the factory no longer injects `ConfigService` at all). Recorded rather than reverted to `imports: [ConfigModule]`, which would have kept the stale-snapshot defect and merely hidden it.
- **Files modified:** `crypto.module.ts`
- **Committed in:** `9d990b4`

**4. [Rule 3 - Blocking] `packages/platform/package.json` gained a `"./crypto"` exports entry**
- **Found during:** Task 3
- **Issue:** the plan created `crypto/index.ts` "so plan 10 imports it without editing the top-level package barrel", but the `exports` map declared only `"."` — so `@akane/platform/crypto` did not resolve cross-package. 01-04 had already recorded the identical latent blocker for `@akane/platform/logging`.
- **Fix:** one `exports` entry. Verified with a real `import('@akane/platform/crypto')` resolving all 15 exports.
- **Files modified:** `packages/platform/package.json`
- **Committed in:** `41f19d3`
- **Scope note:** `./logging` was **not** added — it is plan 10's, and adding it here would be scope creep on another plan's file.

---

**Total deviations:** 4 auto-fixed (3 × Rule 1/3 bug or blocking, 1 × Rule 3 blocking config)
**Impact on plan:** Deviations 1 and 2 fixed real defects the plan's own verification would not have surfaced (the plan's verify commands are scoped to `createKeyProvider`, which was always correct). **Deviation 1 is the most important result in this plan** — without running the boot path, the production guard would have shipped reading a stale `NODE_ENV`. No scope creep; the one file outside `files_modified` is `package.json`, and it unblocks a named hand-off.

## Issues Encountered

- **`ConfigModule.forRoot()` returns a Promise that nothing awaits.** `config.module.ts` assigns it to a `Module.forRoot(...)` export, which Nest 12 flattens, so it happens to work — but the timing consequence (an import-time snapshot) is invisible at the call site. Fixing it properly belongs to the entrypoint bootstrap, which is plan 10's.
- **`local:v1:` is two separator-delimited fields, not one.** The first implementation split on `:` and expected five fields, so every unwrap failed. Vault's ciphertext has the same trap; reproducing it deliberately (`scheme` and `version` validated separately, six parts) is the useful outcome.

## User Setup Required

None for this plan. **One decision is required from outside engineering, and it is not a setup step:** naming the deployment cloud (B-3 / D-27). Until that is answered, FND-10 stays Pending and no real credential may be stored.

## Next Phase Readiness

**Ready:**
- The `KeyProvider` interface is frozen and importable cross-package as `@akane/platform/crypto`; a vendor adapter is a new file in `crypto/**` and nothing else changes.
- `CryptoModule` can be imported by all three entrypoints in plan 10.
- `createPinoOptions` is now reachable from a crypto spec, which is the first cross-package use of the logging surface.

**Blockers and concerns carried forward:**
1. **B-3 / D-27 — the KMS vendor is unnamed.** `kms` throws `KMS_PROVIDER_BLOCKED:` in every environment. FND-10 stays Pending. This must be answered before Phase 5 stores the first connector credential (D-28).
2. **The envelope cannot survive a `kid` rotation yet.** D-25's frozen five fields leave nowhere to persist a wrapped DEK, so the DEK is derived from the provider instead. The Phase 4 secret store fix is additive and **not done** (`WINDOWS.md` entry 7). No real credential may be stored before it is.
3. **`ConfigService` is still an import-time snapshot** for every consumer other than the crypto factory (`WINDOWS.md` entry 6). Plan 10 owns it.
4. **`CRYPTO_LOCAL_KEY_FILE` has no schema field.** Read from the environment by `createKeyProvider`; declaring it in `AppConfig` is plan 10's.
5. **`@akane/platform/logging` still does not resolve** cross-package; plan 10 adds the `exports` entry when it wires `nestjs-pino`.

---
*Phase: 01-foundations-platform*
*Plan: 05*
*Completed: 2026-10-02*