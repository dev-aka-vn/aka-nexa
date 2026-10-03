---
phase: 01-foundations-platform
verified: 2026-10-03T16:21:30Z
status: gaps_found
score: 14/15 ROADMAP+contract truths verified
covered_files:
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
  - package.json
  - package-lock.json
  - .nvmrc
  - .github/workflows/ci.yml
  - eslint.config.mjs
  - tooling/boundaries.config.mjs
  - tooling/import-resolver.cjs
  - tooling/containers.ts
  - tooling/entrypoint-drift.spec.ts
  - tooling/deployment-shape.spec.ts
  - packages/kernel/src/index.ts
  - packages/platform/src/index.ts
  - packages/platform/src/config/config.schema.ts
  - packages/platform/src/config/config.module.ts
  - packages/platform/src/config/redis.schema.ts
  - packages/platform/src/crypto/key-provider.ts
  - packages/platform/src/crypto/local-key-provider.ts
  - packages/platform/src/crypto/envelope.ts
  - packages/platform/src/crypto/production-guard.ts
  - packages/platform/src/crypto/crypto.module.ts
  - packages/platform/src/crypto/index.ts
  - packages/platform/src/logging/log-allowlist.ts
  - packages/platform/src/logging/log-allowlist.formatter.ts
  - packages/platform/src/logging/pino.config.ts
  - packages/platform/src/logging/logger.port.ts
  - packages/platform/src/logging/error-codes.ts
  - packages/platform/src/otel/span-attribute-allowlist.ts
  - packages/platform/src/otel/allowlist-span-exporter.ts
  - packages/platform/src/otel/otel.bootstrap.ts
  - packages/platform/src/otel/otel.constants.ts
  - packages/platform/src/health/health.controller.ts
  - packages/platform/src/health/mongo.indicator.ts
  - packages/platform/src/health/redis.indicator.ts
  - packages/platform/src/health/index.ts
  - packages/platform/src/mongo/mongo.service.ts
  - packages/platform/src/mongo/mongo.module.ts
  - packages/platform/src/redis/redis.provider.ts
  - packages/platform/src/redis/redis.constants.ts
  - packages/platform/src/queue/queue.provider.ts
  - packages/platform/src/queue/queue.module.ts
  - packages/platform/src/queue/job-scheduler.ts
  - packages/platform/src/queue/platform-heartbeat.job.ts
  - packages/platform/src/queue/queue-indicators.ts
  - packages/platform/src/queue/queue.constants.ts
  - packages/platform/src/queue/index.ts
  - packages/platform/src/metrics/metrics.controller.ts
  - packages/platform/src/metrics/metrics.module.ts
  - packages/platform/src/metrics/business-metrics.ts
  - packages/platform/src/metrics/index.ts
  - packages/platform/src/bootstrap/provider-boundary.guard.ts
  - packages/platform/src/bootstrap/provider-boundary.runner.ts
  - packages/platform/src/bootstrap/boundary-manifest.ts
  - packages/platform/src/bootstrap/process-capabilities.ts
  - packages/contract/src/index.ts
  - packages/contract/src/jev/v1/jev-request.ts
  - packages/contract/src/jev/v1/jev-response.ts
  - packages/contract/src/jev/v1/index.ts
  - packages/contract/src/jev/jev-provider.ts
  - packages/contract/src/links/read-link-claims.ts
  - packages/contract/src/links/token-classes.ts
  - packages/contract/src/links/rate-limit-key.ts
  - packages/contract/src/connector/connector.ts
  - packages/contract/src/events/inbound-event.ts
  - packages/contract/src/events/outbound-message.ts
  - apps/api/src/main.ts
  - apps/api/src/app.module.ts
  - apps/api/src/bootstrap/boundary-manifest.ts
  - apps/api/otel.mjs
  - apps/api/package.json
  - apps/worker/src/main.ts
  - apps/worker/src/app.module.ts
  - apps/worker/src/bootstrap/boundary-manifest.ts
  - apps/worker/src/processors/platform-heartbeat.processor.ts
  - apps/worker/otel.mjs
  - apps/worker/package.json
  - apps/scheduler/src/main.ts
  - apps/scheduler/src/app.module.ts
  - apps/scheduler/src/bootstrap/boundary-manifest.ts
  - apps/scheduler/otel.mjs
  - apps/scheduler/package.json
covered_digest: "v2:sha256:73f75c717f8891e3812195914258faf42e828303fa602763c9856c68735a7465"
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "SC3 (first clause) — a module that imports across a declared component boundary fails the build"
    status: failed
    reason: >-
      Reproducible counterexample: `tooling/import-resolver.cjs` maps only the BARE
      `@akane/<pkg>` specifier to `<workspace>/src/index.ts`. A subpath specifier
      (`@akane/platform/crypto`, `@akane/platform/otel`) falls through to Node's
      `exports` map, resolves into `node_modules/<pkg>/dist/...`, is classified
      `external` by eslint-plugin-boundaries, and is therefore allowed by policy 0.
      Planted `import { encryptSecret } from '@akane/platform/crypto'` in
      packages/contract/src/index.ts (allowed edges: ['kernel'] only): `npx eslint`
      exit 0 AND `npx tsc -b` exit 0, so `npm run build` passes.
    artifacts:
      - path: "tooling/import-resolver.cjs"
        issue: "resolveWorkspacePackage() joins the subpath onto node_modules/@akane and realpathSync() fails; the fallback requireFromFile.resolve() lands in dist/ and classifies the edge as external."
      - path: "tooling/boundaries.config.mjs"
        issue: "policy 0 `allow: { to: { module: { origin: ['external','core'] } } }` is what makes the misclassification invisible."
      - path: "tooling/boundaries.fixture.spec.ts"
        issue: "WORKSPACE_CASES covers only the bare `@akane/platform` form; no case exercises a subpath, so the regression test cannot see it."
    missing:
      - "Extend resolveWorkspacePackage() to map `@akane/<pkg>/<subpath>` to `<workspace>/src/<subpath>/index.ts` (falling back to `<workspace>/src/<subpath>.ts`)."
      - "Add a WORKSPACE_CASES entry pinning the subpath form as rejected for kernel/contract and allowed for app-api, so the regression test covers the form the three entrypoints actually use."
      - "Re-run the negative control: `packages/contract` importing `@akane/platform/crypto` must make `npm run build` exit non-zero."
advisory:
  - finding: "CryptoModule — and therefore the FND-10 production key guard — is not registered by any of the three entrypoints."
    category: security
    reason: >-
      `grep -rn CryptoModule apps/` returns nothing; the guard is reachable only
      through `Test.createTestingModule({ imports: [CryptoModule] })`. The guard
      logic itself is correct and proven (21 assertions in production-guard.spec.ts,
      incl. CR-01's boot-path test with NODE_ENV deleted), so nothing insecure
      happens today — Phase 1 stores no secret. But 01-05-SUMMARY.md line 268
      records the hand-off "CryptoModule can be imported by all three entrypoints
      in plan 10", plan 10 did not do it, and no WINDOWS entry records the omission.
      Resolve by importing CryptoModule into the three app modules (it then also
      needs CRYPTO_LOCAL_KEY_FILE, which is deliberately not a schema field), or by
      recording the wiring as an explicit owner for the first phase that stores a secret.
    evidence_status: "none provided"
  - finding: "Degraded-readiness latency differs sharply between processes."
    category: other
    reason: >-
      Measured against live containers: with the cache Redis stopped, `/health/ready`
      returned 503 in 0.21 s (scheduler), 0.90 s (api) and 8.22 s (worker). The worker's
      extra `bullmq_workers` indicator serialises behind the retrying ioredis profile.
      Not a failure — but a K8s `failureThreshold`/`timeoutSeconds` budget should be set
      above ~10 s or the worker will be restarted for a Redis blip rather than merely
      taken out of rotation, which is the exact outcome FND-05 exists to prevent.
    evidence_status: "reproduced live (curl timings recorded in the Behavioral Spot-Checks table)"
  - finding: "A `docker pause`d Redis makes `/health/ready` hang past 20 s rather than return 503."
    category: other
    reason: >-
      ioredis `ping()` on a blackholed TCP connection has no `commandTimeout`, and
      `enableOfflineQueue` is on, so the command queues instead of rejecting. Measured
      on all three processes. Same fix shape as the item above: probe timeouts must
      exceed the ioredis backoff. Not a P1 gap; recorded so the runbook author knows.
    evidence_status: "reproduced live"
  - finding: "CONTEXT.md decision text drifts from what shipped."
    category: other
    reason: >-
      D-15 still says "a pino custom destination stream"; the implementation uses
      `formatters.log` because a destination consumes already-serialised bytes. D-01/D-02
      say "12 domain modules / subdirectories"; 13 ship (`audit` included). Both amendments
      are recorded honestly in STATE.md and 01-ASSUMPTIONS.md — only CONTEXT.md is stale.
    evidence_status: "none needed — documentation drift, both resolutions already recorded"
---

# Phase 1: Foundations & Platform — Verification Report

**Phase goal:** A clean checkout builds three independently runnable processes on the pinned stack, and every irreversible design commitment plus all three requirement-conflict rulings exist in code before a single feature is written.
**Verified:** 2026-10-03T16:21:30Z
**Status:** `gaps_found` — 1 BLOCKER, 4 advisory
**Re-verification:** No — initial verification

**Method.** Every claim below was checked against the working tree, not against the summaries. The three entrypoints were **booted** from their own `dist/main.js` through their own `otel.mjs` loaders against real MongoDB 8.0 + two real Redis deployments, and probed. `npm run build` (`eslint . && tsc -b`) was run twice, including once with planted boundary violations as negative controls. 31 spec files / 268 assertions-bearing tests were executed in two targeted batches (exit 0 both times). The working tree was restored clean after every planted violation.

---

## Goal Achievement

### The five ROADMAP success criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | `npm ci` clean, `.nvmrc` + committed lockfile pin Node 24 / TS 6.0.3 | ✓ VERIFIED | `.nvmrc` = `24`; root `engines.node = ">=24 <25"`; `devDependencies.typescript = "6.0.3"` (exact, not a range); `package-lock.json` committed in `f1dd373`, the first code commit; both CI jobs use `node-version-file: .nvmrc`. `npm run build` → exit 0. |
| 2 | Three processes; `/health/live` reads nothing; `/health/ready` = Mongo + **both** Redis; a Redis blip fails readiness without restarting | ✓ VERIFIED **(by boot, not by inspection)** | See Behavioral Spot-Checks rows 1–5. `docker stop` on the cache Redis: live stayed 200 on all three, **zero processes restarted**, ready → 503 naming `redis_cache: down`; container restored → 200. |
| 3 | A cross-boundary import fails the build; a compliant tree passes; the three entrypoints cannot drift | ✗ **FAILED** | Bare form verified (`exit 1`, `boundaries/dependencies`). **Subpath form verified failing:** `packages/contract` → `@akane/platform/crypto` gives `eslint` exit 0 **and** `tsc -b` exit 0. Drift controls (3 of 3) verified. → gap **G-1**. |
| 4 | A log line carrying a user email is dropped by the serialiser; no `submission_id` recoverable from the trace ID — both by test | ✓ VERIFIED | `log-allowlist.formatter.spec.ts` (16 tests) — three-level email proof; `pino.config.spec.ts` (14) — end-to-end serialisation; `allowlist-span-exporter.spec.ts` (12, incl. *"leaves the span context untouched, so a trace id is not derived from the attribute set"*); `span-attribute-allowlist.spec.ts` (13, frozen literal + forbidden-name tripwire). |
| 5 | Read-link JWT claim shape + decision wire contract published as versioned schemas with a frozen-field test | ✓ VERIFIED | `read-link-claims.frozen.spec.ts` (11) and `jev-v1.frozen.spec.ts` (8) — both assert the exact sorted top-level key set against a version-named literal **and** `.strict()` rejection of an added key. `toJsonSchema()` stamps `$id: urn:akane:contract:jev:1.0:{request,response}` from `z.toJSONSchema()` output, not a hand-written second schema. |

### The four irreversible Phase 1 contracts — present **and enforced**

| Contract | Present | Enforced by | Verdict |
|---|---|---|---|
| (a) log field-allowlist applied **before** serialisation | `log-allowlist.ts` (frozen 21), `log-allowlist.formatter.ts` (rebuild), `pino.config.ts` (`formatters.log` + `formatters.level` + `base: null` + custom `TimeFn` for `ts`) | `formatters.log`'s return value is the object pino serialises (`_asJson`, `lib/tools.js`); `LoggerPort` types the call site; `createChildLogger` pre-rebuilds bindings because `child()` discards `formatters.bindings`. Absence of `redact` and of a multistream is *asserted* in the spec. | ✓ VERIFIED + ENFORCED |
| (b) decoupled trace ID | `span-attribute-allowlist.ts` (frozen list + `FORBIDDEN_SPAN_ATTRIBUTES` tripwire + 14 named URL/address exclusions), `allowlist-span-exporter.ts` (filter at the export boundary, prototype-preserving copy) | `AllowlistSpanExporter` wrapping `OTLPTraceExporter` in `buildOtelSdk`; `otel.bootstrap.spec.ts` asserts the exporter is never wired bare. | ✓ VERIFIED + ENFORCED |
| (c) read-link JWT claim shape | `read-link-claims.ts` — 15 claims, `.strict()`, `READ_LINK_CLAIMS_VERSION = '1.0'`, 90-day TTL ceiling refinement, `READ_LINK_TARGET_RULES` as data | `read-link-claims.frozen.spec.ts` (11) + `TOKENCASSES` keyed by the action union with `satisfies` | ✓ VERIFIED + ENFORCED |
| (d) JEV wire contract | `jev-request.ts` / `jev-response.ts` — `.strict()`, `spec_version: "1.0"`, `choice` **required**, `choice.verified: boolean \| null`, `state.force_clarification`, two named abstention tokens | `jev-v1.frozen.spec.ts` (8) + `refineAbstentionIsTotal` superRefine | ✓ VERIFIED + ENFORCED |

### The three ruled requirement conflicts — present in code

| Ruling | Code evidence | Verdict |
|---|---|---|
| **1. Per-IP rate cap loses to availability** (NFR-SEC-6 vs NFR-S-1) | `packages/contract/src/links/rate-limit-key.ts` — `RateLimitScopeSchema = z.enum(['user','link'])`. There is no `ip`, `address`, `cidr` or `remote_addr` member: an address scope is **unexpressible**, not discouraged. | ✓ VERIFIED (contract half). Second half — "blocks only on signature failure" — is the link-verification path, Phase 3/4. Left Pending in REQUIREMENTS.md; the deferral is stated in `01-06-SUMMARY.md` lines 84–92. |
| **2. `trace_id = submission_id` loses to the erasure contract** | `SPAN_ATTRIBUTE_ALLOWLIST` carries neither `submission_id` nor any URL/address attribute; `AllowlistSpanExporter` filters at export; no code path seeds a trace context. `FORBIDDEN_SPAN_ATTRIBUTES` is a second tripwire so a future allowlist addition still fails the spec. | ✓ VERIFIED + ENFORCED |
| **3. 3-year audit retention wins; §15.4 erasure narrowed** | The narrowing is the log allowlist itself (PII excluded before serialisation) + `actor_ref` tombstonability (AUD-04, Phase 8) + defined purge windows (AUD-08, Phase 8). `FR-D-12` amended via `ConnectorDescriptorSchema.supports_idempotency_key: z.boolean()` **required** + `ConnectorExecuteInput.idempotencyKey: string \| null`. | ✓ VERIFIED (contract half). App-Builder surfacing is Phase 6. Left Pending in REQUIREMENTS.md; deferral stated in the same SUMMARY block. |

---

## Observable Truths (per-plan must_haves, consolidated)

Every truth below was read in the source and, where behaviour-dependent, exercised.

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | `npm ci` install, TS resolves to exactly 6.0.3 | ✓ VERIFIED | `typescript: "6.0.3"` exact; `tooling/deployment-shape.spec.ts` pins the runtime/dev split and the lockfile's `dev` flags |
| 2 | `.nvmrc` = `24`, Node 24 engine floor declared | ✓ VERIFIED | both files read |
| 3 | Lockfile committed with the workspace topology | ✓ VERIFIED | `f1dd373` contains `package.json` + `package-lock.json` + `.nvmrc` together. **Reading:** REQUIREMENTS.md's literal "in its first commit" — the repo's `Initial commit 9f14da1` carries only `README.md` and `.gitignore`, no manifest exists to lock. The intent (lockfile committed, not ignored) holds. |
| 4 | `api` boots in-process and answers `/health/live` 200 `{"status":"ok"}` | ✓ VERIFIED | booted and probed |
| 5 | `npm run build` runs lint first | ✓ VERIFIED | `package.json` `"build": "npm run lint && tsc -b"`; run twice → exit 0 |
| 6 | CI install-guard deletes the lockfile and installs lockfile-free | ✓ VERIFIED (config) | `.github/workflows/ci.yml` job `install-guard`. ⚠️ Cannot be executed here (no Actions runtime); see WR-10 in the disposition ledger — the job's comment promises a TS-version assertion the workflow does not implement. |
| 7 | Four packages + three app workspaces with the exact names | ✓ VERIFIED | tree walk |
| 8 | Three concurrent boots → three independent OS processes, no shared singleton | ✓ VERIFIED **(behavioural, by observation)** | `ss -ltnp` showed 3 distinct PIDs on 3 ports simultaneously |
| 9 | Invalid/missing config aborts boot with `CONFIG_INVALID: <key> <code>` | ✓ VERIFIED | `formatConfigError`; `config.schema.spec.ts` (11 tests) |
| 10 | Both Redis URLs required; identical host:port aborts `REDIS_INSTANCES_NOT_DISTINCT` | ✓ VERIFIED | `redis.schema.spec.ts` (5 tests) |
| 11 | Producer `maxRetriesPerRequest` 1..3, blocking `null`; no `keyPrefix`; `{akane-q}` prefix | ✓ VERIFIED | `buildRedisOptions`; `queue.constants.ts`; `redis.provider.spec.ts`, `queue.spec.ts`, `redis.integration.spec.ts` all assert the `keyPrefix` absence |
| 12 | Boundary config declares 13 domain element types + 3 app types, `partialMatch: false`, `default: "disallow"` | ✓ VERIFIED | `tooling/boundaries.config.mjs` read in full |
| 13 | A cross-boundary element import is reported | ✗ **FAILED** (subpath form) | **G-1** |
| 14 | `no-restricted-imports` names `Worker` from `bullmq`, scoped to api + scheduler | ✓ VERIFIED | `eslint.config.mjs`; the drift spec pins that only `apps/worker/.../platform-heartbeat.processor.ts` binds `Worker` |
| 15 | Runtime provider guard aborts with `BOUNDARY_VIOLATION:` on a resolved forbidden token | ✓ VERIFIED | `provider-boundary.guard.ts` + spec; all three manifests wired via `ProviderBoundaryGuardRunner` |
| 16 | Log formatter rebuilds from the frozen 21-field allowlist; email dropped at 3 levels; `err` → closed-enum `error_code` | ✓ VERIFIED | `log-allowlist.formatter.spec.ts` (16 tests) |
| 17 | The allowlist is applied in `formatters.log`, not a destination stream; no `redact`, no multistream | ✓ VERIFIED | `pino.config.ts`; both absences asserted in `pino.config.spec.ts` |
| 18 | `LoggerPort` rejects an unlisted field at compile time | ✓ VERIFIED | `CallerLogField = Exclude<AllowlistedField, 'service'\|'env'\|'pid'>`; ten `@ts-expect-error` directives, `tsc` fails on an unused one |
| 19 | `KeyProvider` = `keyId`/`wrapDek`/`unwrapDek`; `LocalKeyProvider` refuses production; wrong-length DEK throws | ✓ VERIFIED | `key-provider.ts`, `local-key-provider.ts` |
| 20 | Envelope = `{v:1, alg:"A256GCM", kid, iv, tag, ct}`; round-trip; corrupted tag throws; fresh `iv` per encryption | ✓ VERIFIED | `envelope.ts`; `envelope.spec.ts` |
| 21 | Production without KMS aborts with a named error | ✓ VERIFIED **at module level** | `production-guard.spec.ts` (21 tests) incl. the CR-01 boot-path test with `NODE_ENV` deleted. See advisory on wiring. |
| 22 | JEV v1 request/response key sets frozen; `choice.verified` + `state.force_clarification`; abstention refinement | ✓ VERIFIED | `jev-v1.frozen.spec.ts` (8) |
| 23 | Read-link claim key set frozen (15 claims); unlisted key fails `.strict()` | ✓ VERIFIED | `read-link-claims.frozen.spec.ts` (11) |
| 24 | `RateLimitKeySchema` admits only `user` \| `link` | ✓ VERIFIED | `rate-limit-key.spec.ts` (5) |
| 25 | `supports_idempotency_key` is a **required** descriptor field | ✓ VERIFIED | `connector.ts`; `connector.spec.ts` |
| 26 | `TOKEN_CLASSES` enumerates all six actions; `draft` reserved, not emitted | ✓ VERIFIED | `token-classes.ts`; `isEmittableInV1()` gate |
| 27 | `MongoService.ping()`; readiness always runs mongo + both Redis; live reads nothing; ready 503 names the failing dependency | ✓ VERIFIED **(by boot)** | `CORE_HEALTH_INDICATOR_KEYS` frozen; live body is a fixed literal; measured 503 naming `redis_cache` |
| 28 | No health payload carries a connection string, credential or URL | ✓ VERIFIED | indicators drop `ReplyError`/`RedisClosedError` details; live body is a literal |
| 29 | Cache Redis evicting / queue Redis `noeviction`, read back with `CONFIG GET` | ✓ VERIFIED | `redis.integration.spec.ts` (real containers) |
| 30 | `registerJobScheduler` is idempotent `upsertJobScheduler`; scheduler probe reads it back out of Redis | ✓ VERIFIED | `queue.integration.spec.ts`; measured live: `job_schedulers: {scheduler: "platform-heartbeat", status: "up"}` |
| 31 | Business instruments on the OTel meter; no `prom-client` anywhere | ✓ VERIFIED | `business-metrics.spec.ts` scans every source + every manifest |
| 32 | Frozen `SPAN_ATTRIBUTE_ALLOWLIST`; `submission_id` stripped by the exporter, never reaching the delegate | ✓ VERIFIED | `allowlist-span-exporter.spec.ts` (12) |
| 33 | `startOtel()` = one `NodeSDK`, idempotent (memoised handle **and** promise) | ✓ VERIFIED | `otel.bootstrap.ts`; `otel.bootstrap.spec.ts` |
| 34 | Prometheus exporter always `preventServerStart: true`; first-write-wins singleton; `OTEL_NOT_STARTED` refusal | ✓ VERIFIED | `otel.constants.ts`, `metrics.module.ts` |
| 35 | `/metrics` served from the single exporter, on all three processes, each its own registry | ✓ VERIFIED **(by boot)** | measured `target_info{service_name="api"\|"worker"\|"scheduler"}` on three distinct PIDs |
| 36 | Three entrypoints `NestFactory.create()` on config-derived ports; `enableShutdownHooks()`; `otel.mjs` + dynamic `app.module.js` import | ✓ VERIFIED | three `main.ts` byte-identical apart from the docblock; `DEFAULT_PORT_BY_SERVICE` |
| 37 | Only `apps/worker` constructs a `Worker`; only `apps/scheduler` registers the Job Scheduler | ✓ VERIFIED | three independent controls; `entrypoint-drift.spec.ts` (17 tests) with non-vacuity assertions first |
| 38 | Per-app `BoundaryManifest` + import-closure drift test | ✓ VERIFIED | `entrypoint-drift.spec.ts` |
| 39 | **CR-01 fix is real**: `NODE_ENV` required with no default; local key only in `development`/`test` or explicit `CRYPTO_LOCAL_KEY_ALLOWED=true`; `production` is kms-only and the opt-in cannot relax it | ✓ VERIFIED | `config.schema.ts` (`z.enum` with **no** `.default()`), `production-guard.ts` (`localKeyProviderAllowed` fails closed), `local-key-provider.ts` (constructor reads live `NODE_ENV` with no `?? 'development'`), `readKeyProviderEnv()` returns `NODE_ENV: string \| undefined`. Commit `4732c30` present. |
| 40 | **CR-02 fix is real**: both Redis clients `QUIT` in `onModuleDestroy` via `allSettled`; registered in all three entrypoints | ✓ VERIFIED | `redis.provider.ts`; `redis.provider.spec.ts` incl. "drains the other connection even when one quit rejects"; commit `a458258` present |

**Score: 39/40 plan truths verified.** SC/contract score: **14/15**.

---

## Required Artifacts

| Artifact | Status | Detail |
|---|---|---|
| `package.json`, `.nvmrc`, `package-lock.json` | ✓ VERIFIED | exact pins; lockfile tracked |
| `eslint.config.mjs`, `tooling/boundaries.config.mjs`, `tooling/import-resolver.cjs` | ⚠️ PRESENT, one gap | exists, substantive, wired — **G-1** in the resolver |
| `packages/platform/src/{config,logging,otel,health,mongo,redis,queue,metrics,crypto,bootstrap}/` | ✓ VERIFIED | all barrels exist; `crypto/index.ts` and `otel/index.ts` exported; every deep barrel has an `exports` entry except the ones the drift spec reaches by source |
| `packages/contract/src/{jev/v1,links,connector,events}/` | ✓ VERIFIED | all four frozen/`.strict()` |
| `apps/{api,worker,scheduler}/{src/main.ts,src/app.module.ts,src/bootstrap/boundary-manifest.ts,otel.mjs}` | ✓ VERIFIED | 3 × 4, all present and wired |
| `tooling/entrypoint-drift.spec.ts` | ✓ VERIFIED | 17 tests, non-vacuity + negative controls |
| `tooling/deployment-shape.spec.ts` | ✓ VERIFIED | 7 tests pinning the runtime/dev dependency split |
| `.github/workflows/ci.yml` | ✓ VERIFIED | `build` + `install-guard` |

No stubs. No orphan sources. `apps/api/src/health/*` (plan 01's tracer controller) is **deleted** — exactly one definition of each health route exists in the tree.

---

## Key Link Verification

| From → To | Via | Status | Detail |
|---|---|---|---|
| `pino.config.ts` → `log-allowlist.formatter.ts` | `formatters.log` | ✓ WIRED | rebuild hook is the serialised value |
| `LoggerPort` → the allowlist | `CallerLogField` derived from the frozen list | ✓ WIRED | |
| `startOtel` → `AllowlistSpanExporter(OTLPTraceExporter)` | exporter wrap | ✓ WIRED | pinned by spec |
| `startOtel` → `PrometheusExporter` → `MetricsController` | first-write-wins singleton → DI token | ✓ WIRED | `OTEL_NOT_STARTED` refuses rather than substituting |
| `plan-08 instruments` → OTel meter → Prometheus → `/metrics` | `business-metrics.ts` | ✓ WIRED | measured `target_info` on all three |
| `registerJobScheduler` → `Queue.upsertJobScheduler` | idempotent | ✓ WIRED | measured live |
| `boundary-manifest` (per app) → `BOUNDARY_MANIFEST` → `ProviderBoundaryGuardRunner` | boot-time container walk | ✓ WIRED | all three app modules |
| `otel.mjs --import` → `startOtel()` → `main.ts` dynamic `import('./app.module.js')` | ordering | ✓ WIRED | verified by boot + by reading all three |
| **`resolver` → `boundaries/dependencies` element graph** | `@akane/<pkg>` → workspace `src` | ✗ **NOT WIRED for subpaths** | **G-1** — bare only |
| `CryptoModule` → an entrypoint | `imports: [...]` | ✗ **NOT WIRED** | advisory — no app imports it |

---

## Behavioral Spot-Checks (all run by this verifier)

| # | Behaviour | Command | Result |
|---|---|---|---|
| 1 | All three processes boot independently | `node --import ./apps/{api,worker,scheduler}/otel.mjs ./apps/{…}/dist/main.js` with a real env | ✓ 3 PIDs, 3 ports (`ss -ltnp`) |
| 2 | `/health/live` on all three | `curl /health/live` ×3 | ✓ 200 `{"status":"ok"}` on 13000 / 3001 / 3002 |
| 3 | `/health/ready` green | `curl /health/ready` ×3 | ✓ 200 · `mongo:up, redis_cache:up, redis_queue:up` on all three, **plus** `bullmq_workers:{workers:1,up}` on worker and `job_schedulers:{scheduler:"platform-heartbeat",up}` on scheduler |
| 4 | `/metrics` on all three | `curl /metrics` ×3 | ✓ 200 · `target_info{service_name="api"\|"worker"\|"scheduler"}`, three distinct `process_pid` — three registries, not three views of one |
| 5 | Redis blip fails readiness, not liveness | `docker stop api-cache`, then re-probe | ✓ live 200 on all three; **0 processes restarted**; ready → 503 naming `redis_cache: down` (latency 0.21 s / 0.90 s / 8.22 s — see advisory). Container restored → 200 on all three. |
| 6 | Boundary violation fails the build — **bare form** | plant `import { DEFAULT_PORT_BY_SERVICE } from '@akane/platform'` in `packages/kernel/src/index.ts` | ✓ `eslint` exit 1, `There is no policy allowing dependencies from elements of type "kernel" to elements of type "platform"` |
| 7 | Boundary violation fails the build — **subpath form** | plant `import { encryptSecret } from '@akane/platform/crypto'` in `packages/contract/src/index.ts` | ✗ `eslint` exit 0 **and** `tsc -b` exit 0 → **G-1** |
| 8 | Compliant tree passes | `npx eslint .` | ✓ exit 0 |
| 9 | `npm run build` on a clean tree | `npm run build` | ✓ exit 0 (run twice: once dirty, once after restore) |
| 10 | Targeted suites (logging, contract, otel, metrics, bootstrap, redis, config, crypto guard, boundary fixtures, drift) | `npx vitest run …` | ✓ **25 files / 217 tests**, exit 0, 337.9 s |
| 11 | Container-backed suites (mongo, health, queue, deployment shape) | `npx vitest run …` | ✓ **6 files / 51 tests**, exit 0, 202.0 s |
| 12 | Boundary fixture smoke test — non-inertness | `boundaries.fixture.spec.ts` | ✓ 6 tests, incl. *"checkAllOrigins is set, and stripping it silently disables R2 and R3"* and *"the custom import resolver is load-bearing for every relative import"* |

**Working tree restored to `git status --porcelain` clean** (only the three pre-existing untracked `.planning/` artifacts remain) after every planted violation.

---

## Probe Execution

None declared. Phase 1 ships no `scripts/**/tests/probe-*.sh`.

---

## Requirements Coverage — all 15 IDs accounted for

| ID | Source plan | Status | Evidence |
|---|---|---|---|
| **FND-01** | 01-01 | ✅ Complete | `.nvmrc`, `engines.node`, exact TS pin, lockfile, `npm run build` exit 0 |
| **FND-02** | 01-01 | ✅ Complete | lockfile committed (`f1dd373`) with the topology; `.nvmrc` = 24; both CI jobs consume it. *Reading noted on "first commit" above — intent met.* |
| **FND-03** | 01-01, 01-03, 01-10 | ✅ Complete | three processes booted concurrently on three ports; three independent controls, all wired and covered |
| **FND-04** | 01-03, 01-10 | ⚠️ **One gap** | bare form fails the build (verified); compliant tree passes (verified); **subpath form does not** → **G-1** |
| **FND-05** | 01-02, 01-07, 01-10 | ✅ Complete | measured live on all three, degraded and restored |
| **FND-06** | 01-04 | ✅ Complete | 30 tests across two specs; allowlist applied pre-serialisation |
| **FND-07** | 01-09 | ✅ Complete | exporter-boundary enforcement; 25 tests |
| **FND-08** | 01-08, 01-10 | ✅ Complete | scheduler registered and read back out of Redis while running; worker is the sole `Worker` |
| **FND-09** | 01-02 | ✅ Complete | `CONFIG_INVALID:` named errors; `ConfigModule` validates at DI time, not import time |
| **FND-10** | 01-05 | ⏸ **Pending by design (D-27 / B-3)** | Interface, envelope, guard all real and proven; **no KMS adapter, no KMS-backed key** — exactly as decided. CR-01's fail-open fix confirmed real. ⚠️ One advisory: the guard is not composed into any process. |
| **LNK-07** | 01-06 | ✅ Complete | 15-claim set frozen and version-stamped; 11 tests |
| **RTE-10** | 01-06 | ✅ Complete | JEV v1 frozen with both D-23 additions; 8 tests; published as `z.toJSONSchema()` output |
| **AUD-10** | 01-06 | ⏸ **Pending by design (contract half)** | `user` \| `link` scopes shipped; "blocks only on signature failure" is Phase 3/4. Deferral stated in `01-06-SUMMARY.md` §84–92 and left unchecked in REQUIREMENTS.md — honest. |
| **DAT-13** | 01-06 | ⏸ **Pending by design (contract half)** | `supports_idempotency_key` required + `idempotencyKey` on the execute input; App-Builder surfacing is Phase 6. Same deferral note. |
| **OBS-01** | 01-08, 01-09, 01-10 | ✅ Complete | one OTel meter → one `preventServerStart` Prometheus exporter → `/metrics` on all three; no `prom-client` (asserted by scan); `OTEL_NOT_STARTED` refusal |

**Orphaned requirements:** none. All 15 IDs in the ROADMAP/PLAN set appear in REQUIREMENTS.md's Phase 1 traceability table, and no Phase 1 requirement is unclaimed.

---

## Known-deliberate-state items — checked for honesty, not re-litigated

| # | Item | Verdict |
|---|---|---|
| 1 | **FND-10 pending by design.** CR-01's guard was defeatable by omitting `NODE_ENV`; fixed in `4732c30`. | ✅ **Honest and the fix is real.** `NODE_ENV` is now a required enum with **no** `.default()`; `localKeyProviderAllowed` **fails closed** — the local key is permitted only in `development`/`test` or on an explicit `CRYPTO_LOCAL_KEY_ALLOWED=true`; `production` is kms-only and the opt-in cannot relax it; `LocalKeyProvider`'s constructor reads the live `NODE_ENV` with **no** `?? 'development'` fallback. Both refusal sites share one exported predicate so they cannot drift. The commit exists and the code matches it. FND-10 correctly stays unchecked; the "no KMS-backed key" state is stated plainly in REQUIREMENTS.md rather than papered over. ⚠️ One genuine addition: the guard is not wired into any process (advisory). |
| 2 | **AUD-10 / DAT-13 pending by design.** | ✅ **Honest.** The contract halves are real and tested; the missing halves are named precisely ("blocks only on signature failure" → Phase 3/4; "surfaced in the App Builder at publish time" → Phase 6) in `01-06-SUMMARY.md` and mirrored in REQUIREMENTS.md's unchecked boxes. No over-claim found. |
| 3 | **21 WARNING/INFO findings deferred with owners.** | ✅ **Honest.** `01-REVIEW-DISPOSITION.md` accounts for all 23 findings: 2 BLOCKERs (`blockers_fixed: 2`, commits `4732c30` / `a458258`, both present and both re-verified in code) + 12 WARNINGs + 9 INFOs, each with a one-line owner. **No BLOCKER-severity finding is standing.** Spot-checked the deferrals that touch this report's scope: WR-05 (kernel zero-dep unenforced) is real and correctly WARNING; WR-10 (install-guard promises an assertion) is real; WR-02 (`.mjs` loaders escape the R1 controls) is real — I confirmed all three `otel.mjs` files sit outside every control's glob. |
| 4 | **WINDOWS #5 and #7 open on purpose.** | ✅ **Recorded, not silently dropped.** #5 (`msg` is the one channel the allowlist cannot filter) is `open`, and the fact is stated in `pino.config.ts`'s own docblock rather than claimed as covered — a claim that the allowlist covers `msg` would have been false, and the code says so. #7 (the envelope derives its DEK from the provider, so rotating `kid` breaks prior envelopes) is `open`, named as Phase 4 work, and `envelope.ts` carries the same warning inline. Both need a human ruling / later phase respectively — correctly not closed. |

---

## Test Quality Audit

| Linked req | Test file(s) | Active | Skipped | Circular | Assertion level | Verdict |
|---|---|---|---|---|---|---|
| FND-04 | `tooling/boundaries.fixture.spec.ts`, `tooling/entrypoint-drift.spec.ts` | 23 | 0 | none | **behavioural** (lint on fixtures + planted violations; import-closure walk) | ⚠️ Non-vacuity pinned, but the **subpath form is not covered** → G-1 |
| FND-05/08 | `health.controller.spec.ts`, `health.indicators.spec.ts`, `queue.integration.spec.ts`, `redis.integration.spec.ts` | real containers | 0 | none | **behavioural** (`CONFIG GET maxmemory-policy` readback; `upsertJobScheduler` ×N → 1) | ✓ |
| FND-06 | `log-allowlist.formatter.spec.ts`, `pino.config.spec.ts` | 30 | 0 | none | **behavioural** (serialised output inspected, three nesting levels) | ✓ |
| FND-07 | `allowlist-span-exporter.spec.ts`, `span-attribute-allowlist.spec.ts`, `otel.bootstrap.spec.ts` | 25 | 0 | none | **behavioural** (real `TracerProvider`, five spans → five distinct trace ids) | ✓ |
| FND-10 | `production-guard.spec.ts`, `local-key-provider.spec.ts`, `envelope.spec.ts`, `key-provider.contract.spec.ts` | — | 0 | **no** — `writeFileSync` only writes *key fixtures* (inputs), never expected values | **behavioural** (boot-path compile, tag corruption, rotation) | ✓ |
| LNK-07/RTE-10 | `read-link-claims.frozen.spec.ts`, `jev-v1.frozen.spec.ts` | 19 | 0 | none | **value** (exact key-set arrays) | ✓ |

- **Disabled tests on requirements:** 0 (repo-wide scan for `it.skip` / `describe.skip` / `xit` / `test.todo` / `.only` → no hits).
- **Circular patterns:** 0.
- **Insufficient assertions:** 0 — every requirement-linked spec asserts values or behaviour, none stops at existence/type.
- **Negative controls present and effective:** `checkAllOrigins` stripping turns 4 R2/R3 cases red; substituting a fresh Prometheus exporter turns 3 of 5 red; the closure-walk non-vacuity test runs *first* precisely because every other assertion is a `not.toContain`.

---

## Anti-Patterns Found

| Pattern | Severity | Result |
|---|---|---|
| Debt markers (`TBD`/`FIXME`/`XXX`) in phase-touched sources | — | **0** (repo-wide scan) |
| `TODO`/`HACK`/`PLACEHOLDER`/`not yet implemented` | — | **0** |
| `return null` / `return {}` / `return []` stubs | — | **0** |
| Hardcoded empty props / disconnected data | — | **0** — no UI in this phase; every returned value traces to a real query (container readback, `getJobScheduler`, exporter collect) |
| `console.log`-only implementations | — | **0** |
| `NOT_IMPLEMENTED` entrypoint shells | — | **0** — both worker and scheduler shells replaced; WINDOWS #2/#3 `fixed` |

---

## Decision Coverage (non-blocking)

`01-CONTEXT.md` declares 33 decisions (D-01…D-33). All load-bearing ones were traced to code: D-05/D-06 (`build` chains `lint`; dedicated `install-guard` job), D-09 (`NestFactory.create()` + `enableShutdownHooks()` on all three), D-10 (per-dependency readiness, liveness reads nothing), D-12/D-13/D-14 (both URLs required + distinct; two connection profiles; `{akane-q}`, no `keyPrefix`), D-15/D-16/D-17 (allowlist + `formatters.log` + three-level email test), D-18/D-19 (export-boundary span allowlist + the logs↔traces asymmetry), D-20 (SDK first, dynamic `app.module.js` import), D-21/D-22/D-23/D-24 (frozen claims, reserved `draft`, JEV v1, mechanical freeze), D-25/D-26/D-27/D-28 (envelope, `KeyProvider`, named blocker, no secret stored), D-29/D-30/D-31/D-32/D-33 (scope decisions, recorded).

Two decisions have **documented deviations**, both honestly recorded outside CONTEXT.md:
- **D-15** — CONTEXT says "pino custom destination stream"; the implementation uses `formatters.log` because a destination receives already-serialised bytes. Amendment recorded in `STATE.md` and `01-04-SUMMARY.md`. (advisory)
- **D-01/D-02** — CONTEXT says "12 domain modules"; 13 ship (`audit`). Recorded in `01-ASSUMPTIONS.md`.

One decision was **deliberately overturned by the executor with the reasoning quoted in source**: 01-03's prohibition `MUST NOT enable checkAllOrigins`. `tooling/boundaries.config.mjs` documents the reversal against the installed plugin source and pins it with an executable assertion. That is a well-founded, reviewable deviation, not drift.

---

## Human Verification

**N/A — Infrastructure/foundation phase with no user-facing elements.** All five ROADMAP success criteria are technical and were settled programmatically (specs, `npm run build`, negative controls, and a live boot of all three processes). No `⚠️ PRESENT_BEHAVIOR_UNVERIFIED` truths remain and no `verification: backstop` truth abstained, so no behaviour-evidence item is carried forward.

The one thing this verifier **could not** execute is the GitHub Actions `install-guard` job — there is no Actions runtime here. Its shape was verified by reading `.github/workflows/ci.yml`, and WR-10 already records that its comment promises an assertion the workflow does not implement. That is a deferred review finding with an owner, not a gap.

---

## Gaps Summary

**One BLOCKER.**

**G-1 — the build-failing boundary lint rule has a silent blind spot for every workspace subpath import.**

`FND-04` requires that "a lint rule fails the build when a module imports across a declared component boundary." It does for the bare form and not for the subpath form. `tooling/import-resolver.cjs`'s `resolveWorkspacePackage()` builds `node_modules/@akane/<pkg>/<subpath>` and calls `realpathSync()` on it, which throws for any subpath; the code then falls through to `requireFromFile.resolve()`, which resolves through the package `exports` map into `node_modules/<pkg>/dist/...`. `eslint-plugin-boundaries` classifies that as origin `external`, and policy 0 — `allow: { to: { module: { origin: ['external', 'core'] } } }` — permits it. The element graph is never consulted.

Reproduced twice, by this verifier, in the real tree:

```
# packages/contract/src/index.ts — ALLOWED_EDGES.contract === ['kernel'] only
import { encryptSecret } from '@akane/platform/crypto';
$ npx eslint packages/contract/src/index.ts   → exit 0
$ npx tsc -b                                  → exit 0
```

The same package with the **bare** specifier fails immediately and correctly (`exit 1`, *"There is no policy allowing dependencies from elements of type … "*) — so the mechanism works and this is a resolver gap, not a broken rule.

Why this is a gap rather than a note: the subpath form is not hypothetical. All three entrypoints import `@akane/platform/otel` today, and `@akane/platform/crypto` is exported, so `@akane/platform/<subpath>` is the *habitual* way to import across a workspace in this repository. The day someone writes `@akane/platform/crypto` from `packages/domain/src/authz/…` or `@akane/platform/otel` from `packages/kernel/…`, `npm run build` goes green on a real element-graph violation — in the one control the phase named as irreversible. `tooling/boundaries.fixture.spec.ts` cannot catch it: its `WORKSPACE_CASES` exercise only the bare form, so the regression test mirrors the blind spot.

No violation of this kind exists in the tree today, and `tooling/entrypoint-drift.spec.ts` — which *does* resolve subpaths into source — partially compensates for the app-scoped cases. But it enforces the entrypoint drift vocabulary, not the element graph, and does not reach `packages/**` at all.

Fix: extend `resolveWorkspacePackage()` to map `@akane/<pkg>/<subpath>` to `<workspace>/src/<subpath>/index.ts` (falling back to `<workspace>/src/<subpath>.ts`), add a `WORKSPACE_CASES` entry pinning the subpath form as rejected for `kernel`/`contract` and allowed for `app-api`, then re-run the negative control above and require `npm run build` to exit non-zero.

**Four advisories** are recorded in the frontmatter: the unwired `CryptoModule` (security category — the guard logic is correct and proven, it is simply not composed into any process, and no window records the omission); the 8.2 s vs 0.2 s degraded-readiness latency spread across processes; `docker pause` making readiness hang past 20 s rather than return 503; and CONTEXT.md drift on D-15 / D-01 / D-02.

---

_Verified: 2026-10-03T16:21:30Z_
_Verifier: the agent (gsd-verifier)_