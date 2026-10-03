---
phase: 01-foundations-platform
verified: 2026-10-03T20:35:17Z
status: passed
score: 15/15 ROADMAP success criteria + contract truths verified
covered_files:
  - .planning/phases/01-foundations-platform/01-VERIFICATION.md
  - .planning/phases/01-foundations-platform/01-REVIEW.md
  - .planning/phases/01-foundations-platform/01-REVIEW-DISPOSITION.md
  - .planning/phases/01-foundations-platform/01-01-PLAN.md
  - .planning/phases/01-foundations-platform/01-01-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-02-PLAN.md
  - .planning/phases/01-foundations-platform/01-02-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-03-PLAN.md
  - .planning/phases/01-foundations-platform/01-03-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-04-PLAN.md
  - .planning/phases/01-foundations-platform/01-04-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-05-PLAN.md
  - .planning/phases/01-foundations-platform/01-05-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-06-PLAN.md
  - .planning/phases/01-foundations-platform/01-06-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-07-PLAN.md
  - .planning/phases/01-foundations-platform/01-07-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-08-PLAN.md
  - .planning/phases/01-foundations-platform/01-08-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-09-PLAN.md
  - .planning/phases/01-foundations-platform/01-09-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-10-PLAN.md
  - .planning/phases/01-foundations-platform/01-10-SUMMARY.md
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/STATE.md
  - .planning/WINDOWS.md
  - package.json
  - package-lock.json
  - .nvmrc
  - .github/workflows/ci.yml
  - eslint.config.mjs
  - tooling/boundaries.config.mjs
  - tooling/import-resolver.cjs
  - tooling/boundaries.fixture.spec.ts
  - tooling/entrypoint-drift.spec.ts
  - tooling/deployment-shape.spec.ts
  - test/setup-env.ts
  - packages/platform/src/crypto/crypto.module.ts
  - packages/platform/src/crypto/production-guard.ts
  - packages/platform/src/crypto/local-key-provider.ts
  - packages/platform/src/crypto/key-provider.ts
  - packages/platform/src/crypto/envelope.ts
  - packages/platform/src/config/config.schema.ts
  - packages/contract/src/index.ts
  - packages/contract/src/jev/jev-v1.frozen.spec.ts
  - packages/contract/src/links/read-link-claims.frozen.spec.ts
  - packages/contract/src/links/rate-limit-key.spec.ts
  - packages/contract/src/connector/connector.spec.ts
  - packages/platform/src/logging/log-allowlist.formatter.spec.ts
  - packages/platform/src/logging/pino.config.spec.ts
  - packages/platform/src/otel/allowlist-span-exporter.spec.ts
  - packages/platform/src/otel/span-attribute-allowlist.spec.ts
  - apps/api/src/app.module.ts
  - apps/api/otel.mjs
  - apps/worker/src/app.module.ts
  - apps/worker/otel.mjs
  - apps/scheduler/src/app.module.ts
  - apps/scheduler/otel.mjs
covered_digest: "v2:sha256:76608334d184e723eb5049572b28117c6649fa5a2c5f581708ca7bd7489c0fc6"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 14/15
  gaps_closed:
    - "SC3 (first clause) — a module that imports across a declared component boundary fails the build (G-1): independently re-verified by planting the violation against both the pre-fix and post-fix resolver and observing the build fail only on the fixed one."
    - "Advisory (security) — CryptoModule not composed by any entrypoint, so the FND-10 production guard was unreachable from a real boot: closed by f813f64 and confirmed on three real booted processes."
  gaps_remaining: []
  regressions: []
  method: "Re-verified by planting, not by reading the fix. Two before/after negative controls (the planted boundary violation and the planted `Worker` import), one reverted-resolver test-load run, one reverted-composition test-load run, a 15-case independent discrimination matrix of the boundary rule, a 21-case boot matrix across all three entrypoints, and a live three-process concurrent boot with a Redis blip."
advisory:
  - finding: "WINDOWS #16 — `apps/{api,worker,scheduler}/otel.mjs` is outside BOTH boundary controls. Sharpened beyond the recorded evidence: `no-restricted-imports` (R1's named-binding half, the rule that forbids a BullMQ `Worker` outside `apps/worker`) is scoped `files: ['apps/api/src/**/*.ts', 'apps/scheduler/src/**/*.ts']` — path-scoped to `src/**` — so it never reached the loader either. Two controls are missing the loader, not one."
    category: architectural
    reason: >-
      Measured: `import { Worker } from 'bullmq'` planted in `apps/api/otel.mjs` produces 0
      `boundaries/dependencies` and 0 `no-restricted-imports`; the identical import in
      `apps/api/src/main.ts` fires `no-restricted-imports`. Not a new gap in SC#3 and not
      a regression from this pass: pre-existing, already recorded as WR-02 (WARNING, deferred)
      in 01-REVIEW-DISPOSITION.md and now as WINDOWS entry 16 with three-way measurements.
      Bounded to 3 files, each a single-import loader adapter whose only import
      (`@akane/platform/otel` from an app element) is an ALLOWED edge, so no latent violation
      sits in them; and the three are byte-identical by design. Closing it is a D-02 element-graph
      scoping decision. The record correctly warns that widening the rule's `files` to `**/*.mjs`
      looks like a fix and produces zero diagnostics. `WINDOWS.md` `open_count: 6` blocks
      `/gsd-ship` while it stands.
    evidence_status: "reproduced live (planted import; `.mjs` vs `.ts` sibling control)"
  - finding: "`test/setup-env.ts` seeds `CRYPTO_KEY_PROVIDER: 'local'` but not `CRYPTO_LOCAL_KEY_FILE`, so any future spec that COMPILES an app module will hit `LOCAL_KEY_FILE_MISSING`."
    category: other
    reason: >-
      Today this is a forward trap, not a present defect: the full suite is green (35 files /
      330 tests) because `entrypoint-drift.spec.ts` reads `Reflect.getMetadata('imports', …)`
      rather than compiling a Nest container. The first spec that does
      `Test.createTestingModule({ imports: [AppModule] })` will fail for an environmental reason
      rather than an assertion reason. STATE.md records this precisely. The cheap fix, when the
      first such spec is written, is to seed a generated 32-byte temp key in `setup-env.ts` rather
      than to make the provider lazy.
    evidence_status: "none needed — read from test/setup-env.ts and confirmed by the green suite"
  - finding: "Degraded-readiness latency differs sharply between processes; a restored Redis is not visible to worker/scheduler within ~5 s."
    category: other
    reason: >-
      Carried forward from the prior report and reproduced: with the cache Redis stopped, all
      three return ready 503 naming `redis_cache: down` with zero restarts (correct); after the
      container is restarted, api returns 200 within the 5 s sample while worker and scheduler are
      still 503. The worker's extra `bullmq_workers` indicator serialises behind the retrying ioredis
      profile (previously measured at 8.22 s). A K8s `failureThreshold` / `timeoutSeconds` budget
      should sit above ~10 s or a Redis blip restarts the worker rather than merely taking it out of
      rotation — which is the outcome FND-05 exists to prevent. Runbook owner's decision.
    evidence_status: "reproduced live (curl timings in Behavioral Spot-Checks row 12)"
  - finding: "`docker pause`d Redis makes `/health/ready` hang rather than return 503."
    category: other
    reason: >-
      Carried forward unchanged. ioredis `ping()` on a blackholed TCP connection has no
      `commandTimeout` and `enableOfflineQueue` is on, so the command queues instead of rejecting.
      Probe timeouts must exceed the ioredis backoff. Not a P1 gap; recorded so the runbook author
      knows before writing the probe budget.
    evidence_status: "carried forward — not re-measured this pass"
  - finding: "CONTEXT.md decision text still drifts from what shipped (D-15 `formatters.log` vs 'destination stream'; D-01/D-02 '12 domain modules' vs 13 shipped)."
    category: other
    reason: >-
      Unchanged from the prior report. Both resolutions are honestly recorded in STATE.md and
      01-ASSUMPTIONS.md; only CONTEXT.md is stale. Documentation-only.
    evidence_status: "none needed — documentation drift, resolutions already recorded"
---

# Phase 1: Foundations & Platform — Re-verification Report

**Phase goal:** A clean checkout builds three independently runnable processes on the pinned stack, and every irreversible design commitment plus all three requirement-conflict rulings exist in code before a single feature is written.
**Verified:** 2026-10-03T20:35:17Z
**Status:** `passed`
**Re-verification:** Yes — after gap closure (`44b0619`, `f813f64`, `67a5208`), against a prior `gaps_found` at 14/15.

**Method.** The prior gap was found by planting a violation and running the real commands, so it was re-verified the same way — not by reading the fix. Specifically: the G-1 violation was planted twice, once against the pre-fix resolver and once against the shipped one, and `npm run build` was run for each; the four new regression tests were run against a reverted resolver to prove they go red; the `CryptoModule` composition test was run against a reverted composition to prove it goes red; a **15-case discrimination matrix** written independently of the fixture spec confirms the rule separates allowed from disallowed rather than simply complaining more; a **21-case boot matrix** across all three entrypoints establishes the FND-10 guard's reachability and the effect of the new `CRYPTO_LOCAL_KEY_FILE` contract; and the three processes were booted concurrently and blipped live. The full suite was run (35 files / 330 tests, 837 s). The working tree was restored to `HEAD` after every planted violation — `tooling/`, `packages/` and `apps/` verified byte-identical to `67a5208` at the end.

---

## Gap G-1 — independently confirmed CLOSED

### The negative control, run both ways

The exact prior reproduction, planted by this verifier into `packages/contract/src/index.ts` (whose `ALLOWED_EDGES.contract` is `['kernel']` only):

```
import { encryptSecret } from '@akane/platform/crypto';
```

| Resolver in the tree | `npx eslint` | `npx tsc -b` | `npm run build` |
|---|---|---|---|
| **pre-fix** `5266acb:tooling/import-resolver.cjs` | exit 0 | exit 0 | **exit 0** ← G-1, reproduced exactly |
| **shipped** `44b0619` | **exit 1** | — | **exit 1** |

The shipped resolver's diagnostic is a real element-graph evaluation, not a syntax error:

```
packages/contract/src/index.ts
  104:31  error  There is no policy allowing dependencies from elements of type "contract"
                 to file of category "crypto-owner" belonging to elements of type "platform"
                 boundaries/dependencies
```

`crypto-owner` is a declared file category, so the dependency resolved to a real local `platform` element and the policies were reached. **G-1 is closed.**

### The converse: the rule discriminates (independent matrix)

An "allowed" edge and an "unexamined" edge produce the identical observation — zero diagnostics — so the compliant direction has to be tested for *evaluation*, not merely for silence. This matrix was written for this re-verification and shares no case with `tooling/boundaries.fixture.spec.ts`. Each case plants one import into a scratch file, exports the binding so `no-unused-vars` cannot mask the result, lints exactly that file, and reports the **rule ID**.

| # | From → To | Specifier form | Expected | Result |
|---|---|---|---|---|
| D1 | `platform` → `contract` (disallowed) | file subpath `.js` | report | ✓ `boundaries/dependencies` |
| D2 | `kernel` → `platform` (disallowed) | barrel subpath | report | ✓ `boundaries/dependencies` |
| D3 | `identity` → `contract` (disallowed) | file subpath | report | ✓ `boundaries/dependencies` |
| D4 | `identity` → `contract` (disallowed) | 2nd file subpath | report | ✓ `boundaries/dependencies` |
| D8 | `contract` → `platform` (disallowed) | barrel subpath + `/.js` | report | ✓ `boundaries/dependencies` |
| D5 | `platform` → `platform` (internal) | barrel subpath | allow | ✓ 0 diagnostics |
| **D6** | **`identity` → `platform` (ALLOWED)** | **barrel subpath** | **allow** | **✓ 0 diagnostics** |
| **D7** | **`identity` → `platform` (ALLOWED)** | **barrel subpath, 2nd symbol** | **allow** | **✓ 0 diagnostics** |
| D9 | `app-api` → `platform` (allowed) | barrel subpath | allow | ✓ 0 diagnostics |
| D10 | `contract` → `kernel` (allowed) | trailing-slash bare | allow | ✓ 0 diagnostics |
| C1 | `contract` → `kernel` (allowed) | bare | allow | ✓ 0 diagnostics |
| C5 | `kernel` → `contract` (disallowed) | bare | report | ✓ `boundaries/dependencies` |
| C12 | `app-api` → `platform` (allowed) | barrel subpath | allow | ✓ 0 diagnostics |
| C16 | → `@nestjs/common` | third-party | allow (external) | ✓ 0 diagnostics |
| **10 / 10 correct on valid specifiers** | | | | |

**D6/D7 are the load-bearing rows.** A fix that achieved its result by making the rule complain about everything would fail them. The rule is discriminating.

A first, methodologically flawed 16-case pass also produced five apparent misses; all five were traced to **my own invalid specifiers** (`@akane/platform/redis` and `@akane/contract/links` — neither names a barrel nor has a `package.json#exports` entry), and a follow-up confirmed every one is a `tsc` error, so none can be committed and passed. The declined shapes behave exactly as the resolver's docblock states: `@akane/platform/does-not-exist`, `@akane/platform/../kernel`, `@akane/nosuchpkg` all return `found: false`, which the plugin reads as external, which policy 0 allows — and `tsc` rejects all three.

### The regression tests are load-bearing

`tooling/import-resolver.cjs` was reverted in-tree to its `5266acb` content and `boundaries.fixture.spec.ts` re-run:

**9 tests → 4 failed / 5 passed.** The four that go red are exactly the G-1 guards:

1. `enforces the cross-workspace element graph on real repo paths` — `expected [] to include 'boundaries/dependencies'`
2. `maps @akane/<pkg>/<subpath> onto the workspace source, not onto dist/` — `expected '…/dist/otel/index.js' to be '…/src/otel/index.ts'`
3. `every violating subpath case is invisible without the subpath mapping`
4. `a compliant subpath edge is evaluated, not silently skipped`

With the shipped resolver: **9/9 pass.** The tests bind to the fix, not to the fixture.

---

## The `CryptoModule` advisory — closed, and it was a real fail-open

`assertKeyProviderAllowed` runs inside `CryptoModule`'s provider factory, so an uncomposed module is a guard no process can trip. `f813f64` composes it into all three roots (`apps/api/src/app.module.ts:64`, `apps/worker/src/app.module.ts:64`, `apps/scheduler/src/app.module.ts:67`) and adds a drift-spec assertion that reads `Reflect.getMetadata('imports', …)`.

### The prior advisory was worse than "unwired"

Measured on the real pre-change tree (`f813f64^`), `NODE_ENV=production`, `CRYPTO_KEY_PROVIDER=local`, no key file: **the process booted and served `/health/live` 200 `{"status":"ok"}`.** A production process ran with a plaintext key posture and nothing refusing it. That is now impossible.

### Boot matrix — real processes, port polled to disambiguate exit from listen

Each case: `node --import ./apps/<app>/otel.mjs ./apps/<app>/dist/main.js` with a real Mongo 8.0 and two real Redis 8.x containers, polling `/health/live` so "still starting" cannot be mistaken for "running".

| `NODE_ENV` | provider | key file | api | worker | scheduler |
|---|---|---|---|---|---|
| `production` | `local` | — | EXIT `CRYPTO_KEY_PROVIDER_REQUIRED: production requires kms, got local` | same | same |
| `production` | `kms` | — | EXIT `KMS_PROVIDER_BLOCKED: no deployment cloud named (B-3); …not built` | same | same |
| `development` | `local` | absent | EXIT `LOCAL_KEY_FILE_MISSING: …` | same | same |
| `development` | `local` | present | **LISTENING** — live 200, ready 200, `/metrics` | **LISTENING** | **LISTENING** |
| omitted | `local` | present | EXIT `CONFIG_INVALID: NODE_ENV invalid_value` (CR-01 still fail-closed) | — | — |

The guard runs **before** any key file is opened — the production refusal fires with no `CRYPTO_LOCAL_KEY_FILE` in the environment at all. **The advisory is closed and FND-10 remains honestly Pending.**

### The drift assertion is load-bearing

`apps/worker/src/app.module.ts` was reverted to its pre-composition content and `entrypoint-drift.spec.ts` re-run: **18 tests → 1 failed** — `every app module composes CryptoModule, so the production key guard is reachable`. With the shipped composition: **18/18 pass.** It reads Nest's `imports` metadata rather than grepping or inspecting bindings, so the one-clause platform barrel cannot satisfy it by accident.

---

## Is requiring `CRYPTO_LOCAL_KEY_FILE` at boot sound, or a defect?

**Sound fail-closed behaviour.** The decisive evidence is the before/after on identical workloads:

| Tree | `NODE_ENV` | key file | Outcome |
|---|---|---|---|
| `f813f64^` | `development` | absent | **BOOTS** — live 200, ready 200, mongo + both Redis green |
| `f813f64^` | **`production`** | absent | **BOOTS** — live 200 `{"status":"ok"}` |
| HEAD | `development` | absent | REFUSES `LOCAL_KEY_FILE_MISSING` |
| HEAD | `production` | absent | REFUSES `CRYPTO_KEY_PROVIDER_REQUIRED` |
| HEAD | `production`, `kms` | — | REFUSES `KMS_PROVIDER_BLOCKED` |

The only thing that stopped booting is a process that declares a crypto posture and supplies no key material — and **every such configuration today is exactly the one B-3 makes impossible to satisfy honestly**, because `kms` is a named blocker. There is no configuration that *should* boot and no longer does; the one configuration that used to boot and shouldn't have (production on a local key) now refuses. The refusal names the missing variable and what it must contain, and it is not silent.

It is also the *less* surprising of the two available designs. The alternative — lazy provider construction — would restore "boots, and nothing ever checks the crypto posture", which is precisely the shape of the hole just closed. `apps/api/src/app.module.ts:56-59` states the correct trigger for revisiting it: a process that genuinely holds no secret, at which point a lazy provider is the answer — not dropping the guard from the composition root.

**No tooling regression.** No CI job boots a process (build + test only, both jobs). No README run documentation exists to go stale (README is 2 lines). The three `start:*` scripts pass the environment through unchanged. The contract is documented where it is defined — `crypto.module.ts:169-184`, all three app modules, and `STATE.md`.

One forward trap, recorded honestly by the executor and confirmed here: `test/setup-env.ts:26` seeds `CRYPTO_KEY_PROVIDER: 'local'` but **not** `CRYPTO_LOCAL_KEY_FILE`, so the first spec that *compiles* an app module (as opposed to reading its metadata, which is all the drift spec does) will fail for an environmental reason. Green today; advisory, not a defect.

---

## WINDOWS #16 — acceptable recorded residual, not a new gap in SC#3

**My assessment: acceptable recorded residual.** Grounds, with one sharpening of the recorded evidence:

- **Pre-existing, not a regression from this pass.** Already recorded as WR-02 (WARNING, deferred) in `01-REVIEW-DISPOSITION.md` before the gap-closure work began.
- **Narrow and bounded.** Exactly three `.mjs` *module* files exist in the repository (`apps/{api,worker,scheduler}/otel.mjs`); the other two `.mjs` files are tooling config. Each is a loader adapter with **one** import clause, and that import — `@akane/platform/otel` from an app element — is an **allowed** edge. No latent violation sits in them today, and the three are byte-identical by design.
- **Sharpened: two controls are missing the loader, not one.** `eslint.config.mjs:80` scopes `no-restricted-imports` to `files: ['apps/api/src/**/*.ts', 'apps/scheduler/src/**/*.ts']` — path-scoped to `src/**`. I planted `import { Worker } from 'bullmq'` (an R1 violation: the BullMQ `Worker` may only be constructed in `apps/worker`, D-13's <200 ms ack budget) into `apps/api/otel.mjs`: **0 `boundaries/dependencies`, 0 `no-restricted-imports`.** The identical import in `apps/api/src/main.ts`: `no-restricted-imports` fires. The plugin misses it because the file matches no element descriptor and `Rules/Dependencies.js` gates on `!from.file.isIgnored`; core ESLint misses it because of its own path scope.
- **Correctly diagnosed and correctly anti-fixed.** The record measures it three ways and explicitly warns that widening the rule's `files` to `**/*.mjs` "looks like it works and does nothing" — because the plugin gates on unknown *origin* while `checkUnknownLocals` governs unknown *target*. It names the real question as a D-02 scoping decision.
- **Cannot be forgotten.** `WINDOWS.md` `open_count: 6`; `/gsd-ship` blocks while it is above zero.

SC#3's operative clause — "a module that imports across a declared component boundary fails the build" — holds for all 16 declared element types and every `.ts`/`.mts`/`.cts` file, which is every file that is a member of an element. The three loader files are not element members at all; the plugin cannot evaluate them by construction. Failing SC#3 over three single-import files whose only import is compliant would be a false negative on the criterion the phase actually had to satisfy.

---

## The five ROADMAP success criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | `npm ci` clean; `.nvmrc` + committed lockfile pin Node 24 / TS 6.0.3 | ✓ VERIFIED | `.nvmrc` = `24`; `engines.node = ">=24 <25"`; `devDependencies.typescript = "6.0.3"` exact; `package-lock.json` tracked; added with the scaffold in `f1dd373`, the first commit containing any manifest; both CI jobs use `node-version-file: .nvmrc`. `npm run build` exit 0. |
| 2 | Three processes; `/health/live` reads nothing; `/health/ready` = Mongo + **both** Redis; a Redis blip fails readiness without restarting | ✓ VERIFIED **(by boot)** | Spot-Checks 9–13. Three distinct PIDs concurrently; live 200 on all three; ready 200 with `bullmq_workers` on worker and `job_schedulers` on scheduler; `/metrics` shows three distinct `service_name` **and** three distinct `process_pid` (three registries, not three views). Redis blip: live stays 200, ready → 503 naming `redis_cache: down`, **all three same PID — zero restarts**. |
| 3 | A cross-boundary import fails the build; a compliant tree passes; the three entrypoints cannot drift | ✓ VERIFIED | G-1 closed (two before/after controls above). 15-case discrimination matrix, 10/10 on valid specifiers with D6/D7 proving evaluation rather than blanket strictness. Clean `npx eslint .` exit 0 with the three real `@akane/platform/otel` subpath imports present. Drift controls: `entrypoint-drift.spec.ts` 18/18. |
| 4 | A log line carrying a user email is dropped by the serialiser; no `submission_id` recoverable from the trace ID — both by test | ✓ VERIFIED | 53 tests across `log-allowlist.formatter.spec.ts`, `pino.config.spec.ts`, `allowlist-span-exporter.spec.ts`, `span-attribute-allowlist.spec.ts` — all green. |
| 5 | Read-link JWT claim shape + decision wire contract published as versioned schemas with a frozen-field test | ✓ VERIFIED | `read-link-claims.frozen.spec.ts` (11) and `jev-v1.frozen.spec.ts` (8) — both assert the exact sorted top-level key set against a version-named literal and `.strict()` rejection of an added key; `toJsonSchema()` stamps `$id: urn:akane:contract:jev:1.0:{request,response}` from `z.toJSONSchema()` output. Re-run this pass: 8/8 and 11/11. |

---

## The four irreversible contracts — present **and enforced**

| Contract | Present | Enforced by | Verdict |
|---|---|---|---|
| (a) log field-allowlist applied **before** serialisation | `log-allowlist.ts` (frozen 21), `log-allowlist.formatter.ts` (rebuild), `pino.config.ts` (`formatters.log`, `base: null`, custom `TimeFn`) | `formatters.log`'s return value is what pino serialises; `LoggerPort` types the call site; `createChildLogger` pre-rebuilds bindings because `child()` discards `formatters.bindings`. Absence of `redact` and of a multistream is asserted. | ✓ VERIFIED + ENFORCED |
| (b) decoupled trace ID | `span-attribute-allowlist.ts` (frozen list + `FORBIDDEN_SPAN_ATTRIBUTES` tripwire + URL/address exclusions), `allowlist-span-exporter.ts` (filters at the export boundary, prototype-preserving copy) | `AllowlistSpanExporter` wrapping `OTLPTraceExporter` in `buildOtelSdk`; `otel.bootstrap.spec.ts` asserts the exporter is never wired bare. | ✓ VERIFIED + ENFORCED |
| (c) read-link JWT claim shape | `read-link-claims.ts` — 15 claims, `.strict()`, `READ_LINK_CLAIMS_VERSION = '1.0'`, 90-day TTL ceiling, `READ_LINK_TARGET_RULES` as data | `read-link-claims.frozen.spec.ts` (11) + `TOKEN_CLASSES` keyed by the action union with `satisfies` | ✓ VERIFIED + ENFORCED |
| (d) JEV wire contract | `jev-request.ts` / `jev-response.ts` — `.strict()`, `spec_version: "1.0"`, `choice` **required**, `choice.verified: boolean \| null`, `state.force_clarification`, two named abstention tokens | `jev-v1.frozen.spec.ts` (8) + `refineAbstentionIsTotal` superRefine | ✓ VERIFIED + ENFORCED |

---

## The three ruled requirement conflicts — present in code

| Ruling | Code evidence | Verdict |
|---|---|---|
| **1. Per-IP rate cap loses to availability** (NFR-SEC-6 vs NFR-S-1) | `packages/contract/src/links/rate-limit-key.ts` — `RateLimitScopeSchema = z.enum(['user','link'])`. No `ip`/`address`/`cidr`/`remote_addr` member: an address scope is **unexpressible**, not discouraged. `rate-limit-key.spec.ts` (5) asserts *"rejects a third scope — the union has exactly two members"* — re-run green. | ✓ VERIFIED (contract half). "Blocks only on signature failure" is the link-verification path, Phase 3/4. Left Pending in REQUIREMENTS.md; deferral stated in `01-06-SUMMARY.md`. |
| **2. `trace_id = submission_id` loses to the erasure contract** | `SPAN_ATTRIBUTE_ALLOWLIST` carries neither `submission_id` nor any URL/address attribute; `AllowlistSpanExporter` filters at export; no code path seeds a trace context. `FORBIDDEN_SPAN_ATTRIBUTES` is a second tripwire. | ✓ VERIFIED + ENFORCED |
| **3. 3-year audit retention wins; §15.4 erasure narrowed** | The narrowing is the log allowlist (PII excluded before serialisation) + `actor_ref` tombstonability (AUD-04, Phase 8) + defined purge windows (AUD-08, Phase 8). `FR-D-12` amended via `ConnectorDescriptorSchema.supports_idempotency_key: z.boolean()` **required** + `ConnectorExecuteInput.idempotencyKey: string \| null`; `connector.spec.ts` (4) asserts it is required and that a `"false"` **string** cannot read as truthy. | ✓ VERIFIED (contract half). App-Builder surfacing is Phase 6. Left Pending; deferral stated in the same SUMMARY block. |

---

## Requirements Coverage — all 15 IDs accounted for

| ID | Source plan | Status | Evidence |
|---|---|---|---|
| **FND-01** | 01-01 | ✅ Complete | `.nvmrc`, `engines.node`, exact TS pin, tracked lockfile, `npm run build` exit 0 |
| **FND-02** | 01-01 | ✅ Complete | Lockfile committed with the topology; both CI jobs consume `.nvmrc`. *Reading:* REQUIREMENTS.md's literal "in its first commit" — the repo's `Initial commit 9f14da1` carries only `README.md` and `.gitignore`, so no manifest exists to lock. The intent (committed, not ignored) holds. |
| **FND-03** | 01-01, 01-03, 01-10 | ✅ Complete | Three distinct PIDs booted concurrently; three independent controls, all wired; `entrypoint-drift.spec.ts` 18/18 |
| **FND-04** | 01-03, 01-10 | ✅ **Complete — G-1 closed** | Bare form and **subpath form** (barrel, file, `.js`, trailing-slash) all fail the build on disallowed edges; all allowed edges pass; 15-case independent matrix; 4 new regression tests proven load-bearing against a reverted resolver |
| **FND-05** | 01-02, 01-07, 01-10 | ✅ Complete | Measured live on all three, degraded and restored; zero restarts under a Redis blip |
| **FND-06** | 01-04 | ✅ Complete | 53 tests across the logging and span specs; allowlist applied pre-serialisation |
| **FND-07** | 01-09 | ✅ Complete | Exporter-boundary enforcement |
| **FND-08** | 01-08, 01-10 | ✅ Complete | `job_schedulers:{scheduler:"platform-heartbeat",status:"up"}` read back while running; worker is the sole `Worker` |
| **FND-09** | 01-02 | ✅ Complete | `CONFIG_INVALID: <key> <code>` observed live, including `CONFIG_INVALID: NODE_ENV` with `NODE_ENV` omitted |
| **FND-10** | 01-05 | ⏸ **Pending by design (B-3 / D-27)** | Interface, envelope, and guard all real; **composed into all three entrypoints and proven reachable on real boots**; **still no KMS adapter and no KMS-backed key**, exactly as decided. `CRYPTO_KEY_PROVIDER=kms` refuses with `KMS_PROVIDER_BLOCKED:` on all three processes. |
| **LNK-07** | 01-06 | ✅ Complete | 15-claim set frozen and version-stamped; 11 tests re-run green |
| **RTE-10** | 01-06 | ✅ Complete | JEV v1 frozen with both D-23 additions; 8 tests re-run green; published as `z.toJSONSchema()` output |
| **AUD-10** | 01-06 | ⏸ **Pending by design (contract half)** | `user` \| `link` scopes shipped and tested; "blocks only on signature failure" is Phase 3/4. Deferral stated in `01-06-SUMMARY.md` and left unchecked in REQUIREMENTS.md — honest. |
| **DAT-13** | 01-06 | ⏸ **Pending by design (contract half)** | `supports_idempotency_key` required + `idempotencyKey` on the execute input; App-Builder surfacing is Phase 6. Same deferral note. |
| **OBS-01** | 01-08, 01-09, 01-10 | ✅ Complete | One OTel meter → one `preventServerStart` Prometheus exporter → `/metrics` on all three, three distinct registries; no `prom-client`; `OTEL_NOT_STARTED` refusal |

**Orphaned requirements:** none. All 15 IDs appear in REQUIREMENTS.md's Phase 1 traceability table, and no Phase 1 requirement is unclaimed. `FND-04`'s row additionally records the honest history — that the requirement did not hold for the subpath form between 01-03 and `44b0619`.

---

## Known-deliberate state — checked for honesty, not re-litigated

| # | Item | Verdict |
|---|---|---|
| 1 | **FND-10 pending by design.** Composing `CryptoModule` makes the guard reachable; it does **not** produce a KMS-backed key. | ✅ **Honest.** REQUIREMENTS.md leaves `[ ] FND-10` unchecked and marks it `Pending`; ROADMAP.md's verification line repeats it verbatim; STATE.md says it explicitly. I confirmed on real boots that `kms` refuses with the B-3 blocker and that no KMS adapter exists. The `production-guard.spec.ts` coverage (21 assertions, including CR-01's boot-path test with `NODE_ENV` deleted) is intact, and CR-01 still fails closed: a live boot with `NODE_ENV` omitted aborts with `CONFIG_INVALID: NODE_ENV`. |
| 2 | **AUD-10 / DAT-13 pending by design.** | ✅ **Honest.** The contract halves are real and tested; the missing halves are named precisely in `01-06-SUMMARY.md` and mirrored in REQUIREMENTS.md's unchecked boxes. No over-claim. |
| 3 | **21 WARNING/INFO findings deferred; no BLOCKER standing.** | ✅ **Honest.** `01-REVIEW-DISPOSITION.md` accounts for all 23: 2 BLOCKERs (`blockers_fixed: 2`, `4732c30` / `a458258`, both present and both re-verified in code) + 12 WARNINGs + 9 INFOs, each with a one-line owner. **No BLOCKER-severity finding is standing.** Spot-checked the deferrals touching this report's scope: WR-02 (`.mjs` loaders escape R1) — confirmed and now sharpened below; WR-05 (kernel zero-dep unenforced) real; WR-10 (install-guard comment promises an assertion) real. |
| 4 | **WINDOWS #5 and #7 open on purpose.** | ✅ **Recorded, not silently dropped.** #5 (`msg` is the one channel the allowlist cannot filter) is `open`, and `pino.config.ts`'s own docblock says so rather than claiming coverage — a claim that the allowlist covers `msg` would have been false. #7 (the envelope derives its DEK from the provider, so rotating `kid` breaks prior envelopes) is `open`, named as Phase 4 work, with the same warning inline in `envelope.ts`. Both correctly not closed. |
| 5 | **WINDOWS #16 — `.mjs` loaders invisible to the boundary gate.** | ✅ **Acceptable recorded residual.** Assessed in full above. Pre-existing (WR-02), bounded to 3 single-import files whose only import is compliant, correctly diagnosed with an explicit anti-fix warning, blocking `/gsd-ship` via `open_count: 6`. Recorded here as an advisory with one sharpening: `no-restricted-imports` is path-scoped to `apps/*/src/**`, so R1's `Worker` ban misses the loader as well — two controls, not one. |

---

## Behavioral Spot-Checks (all run by this verifier)

| # | Behaviour | Command | Result |
|---|---|---|---|
| 1 | **G-1 reproduction, pre-fix resolver** | plant `contract` → `@akane/platform/crypto`; `npm run build` | ✓ `exit 0` / `tsc -b exit 0` — G-1 reproduced exactly |
| 2 | **G-1 fixed, same plant** | same plant, shipped resolver | ✓ `eslint exit 1` (`boundaries/dependencies`), `npm run build exit 1` |
| 3 | **Regression tests load-bearing** | revert resolver to `5266acb`, run `boundaries.fixture.spec.ts` | ✓ **4 red / 5 green**; all four are the G-1 guards |
| 4 | Regression tests green | `npx vitest run tooling/boundaries.fixture.spec.ts` | ✓ 9/9 |
| 5 | **Discrimination matrix (15 valid cases)** | plant one import per case, lint, report rule ID | ✓ 10/10 authoritative cases correct; D6/D7 prove allowed subpath edges are *evaluated*, not skipped |
| 6 | Invalid subpaths unreachable | `tsc -b` on each declined shape | ✓ 5/5 rejected by `tsc` — none can ship |
| 7 | Compliant tree passes | `npx eslint .` | ✓ exit 0, with three real `@akane/platform/otel` subpath imports present |
| 8 | **CryptoModule drift test load-bearing** | revert `apps/worker/src/app.module.ts`, run drift spec | ✓ **1 red / 17 green** on the exact new assertion |
| 9 | Drift spec green | `npx vitest run tooling/entrypoint-drift.spec.ts` | ✓ 18/18 |
| 10 | **Three processes, concurrent** | launch all three on 14000/14001/14002 | ✓ 3 distinct PIDs, all up |
| 11 | `/health/live` | curl ×3 | ✓ 200 `{"status":"ok"}` on all three |
| 12 | `/health/ready` | curl ×3 | ✓ 200 · `mongo:up, redis_cache:up, redis_queue:up`, plus `bullmq_workers:{workers:1,up}` on worker and `job_schedulers:{scheduler:"platform-heartbeat",up}` on scheduler |
| 13 | `/metrics` | curl ×3 | ✓ three distinct `service_name` **and** three distinct `process_pid` — three registries |
| 14 | **Redis blip** | `docker stop` the cache Redis | ✓ live 200 on all three; ready → 503 naming `redis_cache: down`; **all three same PID — zero restarts** |
| 15 | **FND-10 guard, real boots (21 cases)** | `NODE_ENV` × provider × key-file across all three apps | ✓ see Boot matrix above — every refusal and every listen is as required |
| 16 | **Pre-change tree, production** | `f813f64^`, `NODE_ENV=production`, local provider, no key file | ✓ **BOOTED**, live 200 — the advisory was a genuine production fail-open |
| 17 | **Pre-change tree, development** | `f813f64^`, `NODE_ENV=development`, no key file | ✓ **BOOTED**, ready 200 all green — the only posture that lost the ability to boot |
| 18 | Contract suites | `read-link-claims.frozen` + `jev-v1.frozen` + `rate-limit-key` + `connector` | ✓ 20 tests green; the two frozen specs re-run individually (11 and 8) |
| 19 | Logging + OTel span suites | 4 spec files | ✓ 53 tests green |
| 20 | **Full suite** | `npm test` | ✓ **35 files / 330 tests, exit 0**, 837.3 s |
| 21 | `npm run build` | `npm run lint && tsc -b` | ✓ exit 0 |

**Working tree restored.** `git diff --quiet tooling/ packages/ apps/` → clean; all three match `67a5208` byte-for-byte. `dist/` rebuilt with no planted artifact. Only the three pre-existing untracked `.planning/` artifacts and the pre-existing `.planning/config.json` modification remain.

---

## Anti-Patterns Found

| Pattern | Severity | Result |
|---|---|---|
| Debt markers (`TBD`/`FIXME`/`XXX`) in files touched by the three commits | — | **0 in implementation files.** The only hits are `.planning/ROADMAP.md`'s `**Plans**: TBD` placeholders for *unplanned future phases*, and historical narrative in `STATE.md`/`WINDOWS.md` describing shells that were since resolved. |
| `TODO`/`HACK`/`PLACEHOLDER`/`not yet implemented`/`NOT_IMPLEMENTED` | — | **0** in the seven changed implementation files |
| `return {}` / `=> {}` / `NOT_IMPLEMENTED` stubs | — | **0** |
| Hardcoded empty data / disconnected values | — | **0** — no UI; every returned value traces to a real query (container readback, `getJobScheduler`, exporter collect) |
| Orphaned sources | — | **0** — the resolver's new branch is exercised by both an assertion and a live lint |
| Widened-rule anti-pattern | 🛑 avoided | The executor did **not** widen the rule's `files` to reach `.mjs`. That would have looked like a fix and produced zero diagnostics — the exact trap WINDOWS #16 warns about. |

---

## Human Verification

**N/A — infrastructure/foundation phase with no user-facing elements.** All five ROADMAP success criteria are technical and were settled programmatically: the boundary rule by planting violations and reading the real exit codes, the guard by booting real processes and reading the real refusals, the contracts by running the real specs. No `⚠️ PRESENT_BEHAVIOR_UNVERIFIED` truth remains and no `verification: backstop` truth abstained, so no behaviour-evidence item is carried forward.

The one thing this verifier could not execute is the GitHub Actions `install-guard` job — there is no Actions runtime here. Its shape was verified by reading `.github/workflows/ci.yml`, and WR-10 already records that its comment promises an assertion the workflow does not implement. That is a deferred review finding with an owner, not a gap in this phase.

---

## Gaps Summary

**No gaps.** Zero must-have truth is FAILED, zero artifact is missing or stubbed, zero key link is unwired, and no blocking anti-pattern was found.

**G-1 is closed**, established independently of the fix by planting the violation against both the pre-fix and post-fix resolvers and observing `npm run build` go from exit 0 to exit 1 — and by a 15-case discrimination matrix establishing that the fix discriminates rather than merely tightens.

**The `CryptoModule` advisory is closed and understated the problem**: the pre-change tree booted a `NODE_ENV=production` process with a plaintext key posture and nothing refusing it. All three entrypoints now refuse on a real boot, and the drift assertion is proven load-bearing.

**The `CRYPTO_LOCAL_KEY_FILE` boot requirement is a sound fail-closed default, not a defect.** The only posture that lost the ability to boot is the one that had no key material, and B-3 makes every such configuration impossible to satisfy honestly today. The correct future fix — a lazy provider, for a process that genuinely holds no secret — is already stated in the source.

**Five advisories** are recorded in the frontmatter: WINDOWS #16 (sharpened — `no-restricted-imports` is also path-scoped away from the loader, so two controls miss it); the `test/setup-env.ts` trap for future app-module-compiling specs; the degraded-readiness latency spread and the `docker pause` hang (both carried forward, runbook owner's budget decision); and CONTEXT.md's documentation drift.

**Phase 1 goal achieved.** Ready to proceed to Phase 2.

---

_Verified: 2026-10-03T20:35:17Z_
_Verifier: the agent (gsd-verifier)_
_Not committed — the orchestrator handles that._