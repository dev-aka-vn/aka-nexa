---
phase: 01-foundations-platform
plan: 02
subsystem: infra
tags: [zod, config, ioredis, bullmq, nestjs, redis, env-validation, di-tokens]

requires:
  - phase: 01-foundations-platform
    provides: "Zod-validated ConfigModule scaffold, ESM workspace layout, TS project references (plan 01)"
provides:
  - "AppConfigSchema — the full boot env surface (NODE_ENV, PORT, SERVICE_NAME, MONGO_URL, REDIS_CACHE_URL, REDIS_QUEUE_URL, CRYPTO_KEY_PROVIDER), `.strict()` + `superRefine`"
  - "namedValidate() boot hook throwing `CONFIG_INVALID: <path> <code>` (FND-09)"
  - "RedisConfigSchema with the D-12 distinct-instance refinement -> `REDIS_INSTANCES_NOT_DISTINCT`"
  - "REDIS_CACHE / REDIS_QUEUE DI tokens and createRedisClient({url, profile}) factory with the D-14 retry split"
  - "BULLMQ_PREFIX = \"{akane-q}\" cluster hash-tag constant"
affects: [01-07, 01-10, all later phases (every entrypoint and every queue producer/worker)]

actuals:
  tokens: 5994
  tasks: 3
  commits: 3
  plan_head_before: cf50bd1594eee2ed10c3ef020a42f3977953be95
  plan_head_after: e949602e221f418a2007a8f3957954cd314b34d9

tech-stack:
  added:
    - "ioredis 6.0.0 (exact STACK.md §14 pin; dev dependency — types + client construction in tests)"
  patterns:
    - "Named boot failure: formatConfigError(issue) -> `CONFIG_INVALID: <path> <code>`; custom refinement tokens ride in `message` because Zod's code is always `custom`"
    - "The boot hook narrows process.env to APP_CONFIG_KEYS *before* Zod, so `.strict()` rejects unknown schema keys without failing on the hundreds of unrelated OS/toolchain env vars"
    - "Pure `buildRedisOptions(profile)` is the assertion target, not `client.options` — ioredis normalises `keyPrefix: \"\"` into the client, which would hide whether we set it"
    - "Redis clients are constructed with `lazyConnect: true`, so module compilation and unit tests never open a socket"

key-files:
  created:
    - "packages/platform/src/config/redis.schema.ts — RedisConfigSchema + REDIS_URL_FIELDS + refineRedisInstancesDistinct"
    - "packages/platform/src/config/redis.schema.spec.ts — 5 tests"
    - "packages/platform/src/redis/redis.constants.ts — REDIS_CACHE / REDIS_QUEUE Symbols"
    - "packages/platform/src/redis/redis.provider.ts — buildRedisOptions, createRedisClient, redisCacheProvider, redisQueueProvider"
    - "packages/platform/src/redis/redis.provider.spec.ts — 5 tests"
    - "packages/platform/src/queue/queue.constants.ts — BULLMQ_PREFIX"
    - "test/setup-env.ts — seeds the required boot env for Vitest (deviation 3)"
  modified:
    - "packages/platform/src/config/config.schema.ts — full boot shape + merged Redis refinement + formatConfigError/validateConfig"
    - "packages/platform/src/config/config.module.ts — namedValidate replacing the inline validate hook"
    - "packages/platform/src/config/config.module.spec.ts — expanded for the larger required surface (deviation 2)"
    - "packages/platform/src/config/config.schema.spec.ts — 7 tests"
    - "packages/platform/src/index.ts — barrel exports for config/redis/queue"
    - "vitest.config.mts — setupFiles: ['./test/setup-env.ts'] (deviation 3)"
    - "package.json, package-lock.json — ioredis@6.0.0"

key-decisions:
  - "Used `validate:` with a hand-written namedValidate rather than `validationSchema:` — the Standard Schema option cannot supply a caller-defined error, and FND-09 requires a named one (RESEARCH P3)."
  - "D-12's distinct-instance check compares `new URL(x).host` (which includes the port) — a purely syntactic parse with no DNS and no connection, so same-host/different-port local dev passes."
  - "The logical-database path suffix is explicitly NOT a discriminator: `maxmemory-policy` is instance-wide, so /0 vs /1 on one instance is still one deployment and must fail."
  - "One `createRedisClient({ url, profile })` helper rather than two divergent factory paths — the split is one argument, so a later profile cannot drift from its sibling."
  - "Producer maxRetriesPerRequest pinned at 2 (mid-band of D-14's 1..3), exported as PRODUCER_MAX_RETRIES_PER_REQUEST so tests assert against the constant rather than a magic number."
  - "ioredis installed as a devDependency: nothing at runtime constructs a client until Nest resolves the providers (plan 07/10)."

patterns-established:
  - "Boot contract: every env value is a typed schema field, and every failure path funnels through formatConfigError so a misconfigured process never starts half-valid."
  - "Custom Zod refinement issues encode their machine-readable token in `message` (code is always `custom`), so formatConfigError can surface REDIS_INSTANCES_NOT_DISTINCT as a greppable code."
  - "Assert on the pure options factory, never on a constructed client, when a property's absence is the requirement."
  - "Redis DI tokens are Symbols — REDIS_CACHE and REDIS_QUEUE cannot collide with a string token injected elsewhere."

requirements-completed: [FND-09]
# FND-05 is NOT in the above list on purpose. This plan delivered its readiness *half* — the two
# Redis deployments are separately required and separately addressable via REDIS_CACHE / REDIS_QUEUE —
# but FND-05 as written ("api, worker, and scheduler each expose /health/live and /health/ready") is
# owned by plan 01-07 (test harness + per-dependency readiness). Its REQUIREMENTS.md checkbox is
# therefore left unchecked. Per the plan's own success_criteria this is the intended split.

coverage:
  - id: D1
    description: "Every required boot config value is Zod-validated and a missing/invalid value aborts boot with `CONFIG_INVALID: <path> <code>`"
    requirement: FND-09
    verification:
      - kind: unit
        ref: "packages/platform/src/config/config.schema.spec.ts#throws a named CONFIG_INVALID error naming a missing required Redis URL"
        status: pass
      - kind: unit
        ref: "packages/platform/src/config/config.schema.spec.ts#throws a named CONFIG_INVALID error with the invalid_type code for a non-numeric PORT"
        status: pass
      - kind: unit
        ref: "packages/platform/src/config/config.schema.spec.ts#rejects an unknown key via .strict()"
        status: pass
      - kind: unit
        ref: "packages/platform/src/config/config.module.spec.ts#namedValidate aborts with CONFIG_INVALID"
        status: pass
    human_judgment: false
  - id: D2
    description: "REDIS_CACHE_URL and REDIS_QUEUE_URL are both required and must resolve to two distinct host:port deployments; a single instance or a /0 vs /1 split aborts boot with REDIS_INSTANCES_NOT_DISTINCT (readiness half of FND-05; the endpoints themselves are plan 01-07)"
    requirement: FND-05
    verification:
      - kind: unit
        ref: "packages/platform/src/config/redis.schema.spec.ts#rejects two URLs that resolve to the same host and port"
        status: pass
      - kind: unit
        ref: "packages/platform/src/config/redis.schema.spec.ts#does not treat a logical-database suffix as a second instance"
        status: pass
      - kind: unit
        ref: "packages/platform/src/config/redis.schema.spec.ts#accepts the same hostname on two different ports (local-dev / single-node case)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The request-path Redis profile has a finite maxRetriesPerRequest (1..3) so a downed Redis returns an error instead of hanging the HTTP handler; the worker blocking profile uses null because BullMQ requires it"
    requirement: FND-05
    verification:
      - kind: unit
        ref: "packages/platform/src/redis/redis.provider.spec.ts#gives the producer profile a finite maxRetriesPerRequest in 1..3"
        status: pass
      - kind: unit
        ref: "packages/platform/src/redis/redis.provider.spec.ts#gives the blocking profile a null maxRetriesPerRequest for BullMQ"
        status: pass
    human_judgment: false
  - id: D4
    description: "No RedisOptions object produced by the factory sets keyPrefix, and the BullMQ queue prefix is the single literal `{akane-q}`"
    requirement: FND-05
    verification:
      - kind: unit
        ref: "packages/platform/src/redis/redis.provider.spec.ts#never sets keyPrefix on any profile options object"
        status: pass
      - kind: unit
        ref: "packages/platform/src/redis/redis.provider.spec.ts#uses the single BullMQ hash-tag prefix constant"
        status: pass
    human_judgment: false

# Metrics
duration: 52min
completed: 2026-10-02
status: complete
---

# Phase 1 Plan 02: Boot Config Contract & Redis Profiles Summary

**Full Zod boot validation with named `CONFIG_INVALID:` failures, a two-distinct-Redis-deployment boot gate (`REDIS_INSTANCES_NOT_DISTINCT`), and ioredis producer/blocking connection profiles carrying the `maxRetriesPerRequest` split with no `keyPrefix`.**

## Performance

- **Duration:** ~52 min
- **Started:** 2026-10-02 (session resumed mid-plan after a compaction checkpoint)
- **Completed:** 2026-10-02
- **Tasks:** 3
- **Files modified:** 15 (11 source/test, 4 config)
- **Test suite:** 22 passing across 5 files

## Accomplishments

- **Configuration became a boot contract.** Every required env value is a typed field in `AppConfigSchema`, and every failure — missing key, wrong type, unknown key, empty string — aborts startup with a greppable `CONFIG_INVALID: <path> <code>` line instead of a default-coerced half-valid process.
- **The cache/queue split can no longer silently regress.** `refineRedisInstancesDistinct` compares `new URL(...).host` (host **and** port, no DNS) and rejects a single-instance deployment or a `/0` vs `/1` logical-DB split with the named `REDIS_INSTANCES_NOT_DISTINCT` token — closing threat T-1-05 at boot rather than at incident time.
- **The D-14 retry split is one argument, not two code paths.** `createRedisClient({ url, profile })` yields a finite `maxRetriesPerRequest` (2) on the request path so a downed Redis returns an error rather than hanging an HTTP handler (T-1-06), and `null` on the worker's blocking connection because BullMQ throws otherwise.
- **`keyPrefix` is absent from every options object** and the queue prefix is a single `{akane-q}` hash-tag constant, so the two prefix layers can never silently stack.
- **Both `<verification>` bullets confirmed end-to-end through the real boot hook**, not just the schema unit: a missing `REDIS_QUEUE_URL` throws `/^CONFIG_INVALID: REDIS_QUEUE_URL/` and equal host:port throws `REDIS_INSTANCES_NOT_DISTINCT`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Full Zod boot validation with a named failure code (FND-09)** — `78c7077` (feat)
2. **Task 2: Require two distinct Redis deployments at boot (FND-05, D-12)** — `3772e51` (feat)
3. **Task 3: Two ioredis profiles with the maxRetriesPerRequest split and no keyPrefix (D-14, FND-05)** — `e949602` (feat)

**Plan metadata:** (docs commit — this summary, STATE.md, ROADMAP.md)

_Plan head before: `cf50bd1` · after: `e949602` · commits measured: 3_

## Files Created/Modified

- `packages/platform/src/config/config.schema.ts` - Full boot shape (`NODE_ENV`, `PORT`, `SERVICE_NAME`, `MONGO_URL`, `REDIS_*_URL`, `CRYPTO_KEY_PROVIDER`), `.strict()`, merged Redis refinement, `APP_CONFIG_KEYS`, `formatConfigError`, `validateConfig`
- `packages/platform/src/config/config.module.ts` - `namedValidate` boot hook + global `ConfigModule`
- `packages/platform/src/config/redis.schema.ts` - `REDIS_URL_FIELDS`, `RedisConfigSchema`, `refineRedisInstancesDistinct`
- `packages/platform/src/redis/redis.constants.ts` - `REDIS_CACHE` / `REDIS_QUEUE` DI Symbols
- `packages/platform/src/redis/redis.provider.ts` - `RedisProfile`, `buildRedisOptions`, `createRedisClient`, `redisCacheProvider`, `redisQueueProvider`
- `packages/platform/src/queue/queue.constants.ts` - `BULLMQ_PREFIX = "{akane-q}"`
- `packages/platform/src/index.ts` - Barrel exports for the new config/redis/queue modules
- `packages/platform/src/config/{config,redis}.schema.spec.ts`, `redis/redis.provider.spec.ts` - 17 new tests
- `test/setup-env.ts`, `vitest.config.mts` - Boot-env seeding for the test suite
- `package.json`, `package-lock.json` - `ioredis@6.0.0`

## Decisions Made

- **Named errors require the `validate:` hook, not `validationSchema:`.** `@nestjs/config`'s Standard Schema option cannot carry a caller-defined message, and FND-09 asks for a greppable named code. `formatConfigError` is shared by the hook and the direct `validateConfig` entrypoint so both paths produce byte-identical failure text.
- **The boot hook narrows `process.env` to `APP_CONFIG_KEYS` before parsing.** Without this, `.strict()` would reject the hundreds of unrelated keys the OS and toolchain place in `process.env` and *every* boot would fail. `.strict()` still does its job — rejecting an unknown key when the schema is parsed directly — which is exactly where an author typo lives.
- **Custom refinement tokens ride in `message`.** Zod's `code` for a `superRefine` issue is always `"custom"`, so `formatConfigError` substitutes `issue.message` in that case. That is what makes `REDIS_INSTANCES_NOT_DISTINCT` greppable rather than `CONFIG_INVALID: REDIS_CACHE_URL custom`.
- **D-12's check is `URL.host`, not `URL.hostname`.** `host` includes the port; `hostname` does not. Same host on two ports is a legitimate local-dev / single-node deployment and must pass. It is a syntactic parse — no DNS, no connection.
- **A logical-database suffix is never a discriminator.** `maxmemory-policy` is instance-wide, so `redis://h:6379/0` + `redis://h:6379/1` is still one deployment. There is a dedicated test asserting it fails.
- **Assert on `buildRedisOptions(profile)`, never on `client.options`.** ioredis folds `keyPrefix: ""` into `client.options` regardless of input, so inspecting a constructed client would make the "never sets keyPrefix" test vacuously true. The pure factory is the honest assertion target.
- **`lazyConnect: true` on every client.** Nest constructs these at bootstrap and plan 07/10 wires them; `lazyConnect` means module compilation and unit tests never open a socket.
- **`ioredis` is a devDependency.** Nothing constructs a client at runtime until Nest resolves the providers, and the spec only needs the constructor and the options type.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed `ioredis@6.0.0`**
- **Found during:** Task 3 (Two ioredis profiles)
- **Issue:** `ioredis` was not present in any workspace manifest, so `import { Redis } from 'ioredis'` and `import type { RedisOptions } from 'ioredis'` could not resolve. Task 3's `files` list did not include `package.json`.
- **Fix:** `npm install --save-dev --save-exact ioredis@6.0.0` — the exact STACK.md §14 pin, and the version that fixes the High *Uncontrolled Recursion* advisory (never 5.x).
- **Files modified:** `package.json`, `package-lock.json`
- **Verification:** `npx tsc -b` clean; `npm test -- packages/platform/src/redis/redis.provider.spec.ts` 5/5 pass
- **Committed in:** `e949602`

**2. [Rule 1 - Bug] Updated `config.module.spec.ts` for the expanded required surface**
- **Found during:** Task 1
- **Issue:** Plan 01's `config.module.spec.ts` supplied a minimal env that satisfied the then-single-key schema. Task 1 made six more keys required, so the existing spec began throwing `CONFIG_INVALID: <field>` for reasons unrelated to what it was testing. Not in the plan's `files` list.
- **Fix:** Extended the spec's fixture to a complete, valid boot env and added an assertion that the hook aborts with a `CONFIG_INVALID:` prefix.
- **Files modified:** `packages/platform/src/config/config.module.spec.ts`
- **Verification:** full `npm test` — 22/22 pass
- **Committed in:** `78c7077`

**3. [Rule 3 - Blocking] Seeded boot env for Vitest via `test/setup-env.ts`**
- **Found during:** Task 1
- **Issue:** With `ConfigModule.forRoot({ validate: namedValidate })`, every spec that resolves `ConfigModule` — including `apps/api`'s boot specs from plan 01 — now aborts unless the full required surface is present. Pre-existing specs supplied only what the old schema needed.
- **Fix:** Added `test/setup-env.ts` (assigns `SERVICE_NAME`, `MONGO_URL`, `REDIS_CACHE_URL`, `REDIS_QUEUE_URL`, `CRYPTO_KEY_PROVIDER`) and registered it in `vitest.config.mts` as `setupFiles`. Central rather than per-spec, so a later plan adding a spec does not have to re-seed.
- **Files modified:** `test/setup-env.ts`, `vitest.config.mts`
- **Verification:** full `npm test` — 22/22 pass; the two plan `<verification>` bullets were additionally confirmed end-to-end through `namedValidate` with a throwaway spec, which was removed after confirming the behaviour.
- **Committed in:** `78c7077`

**4. [Rule 1 - Bug] Fixed the ioredis default-export import under NodeNext**
- **Found during:** Task 3
- **Issue:** `import IORedis from 'ioredis'` followed by `new IORedis(...)` and a `: IORedis` return annotation produced four `tsc -b` errors (`TS2709: Cannot use namespace 'IORedis' as a type` ×3, `TS2351: This expression is not constructable`). ioredis re-exports its default from `./Redis`, but under `moduleResolution: NodeNext` the default binding resolves to the namespace, not the class.
- **Fix:** Switched to the named class export — `import { Redis as IORedis, type RedisOptions } from 'ioredis'`, which `ioredis/built/index.d.ts` declares as both a value and a type. No behavioural change; the local alias keeps the call sites reading as written.
- **Files modified:** `packages/platform/src/redis/redis.provider.ts`
- **Verification:** `npx tsc -b` exits 0; `npm run build` (lint + tsc) clean
- **Committed in:** `e949602`

**5. [Rule 2 - Missing Critical] Exported the new modules from the platform barrel**
- **Found during:** Task 3
- **Issue:** `packages/platform/src/index.ts` did not export `config/`, `redis/`, or `queue/`, so plan 07 (readiness indicators) and plan 10 (worker) could not import `BULLMQ_PREFIX`, the DI tokens, or the providers without deep relative paths that cross the workspace boundary the plan-01 lint rule governs.
- **Fix:** Added barrel exports for all three module directories.
- **Files modified:** `packages/platform/src/index.ts`
- **Verification:** `npm run lint` (boundaries rule) clean; `npx tsc -b` exits 0
- **Committed in:** `e949602`

---

**Total deviations:** 5 auto-fixed (2 × Rule 3 blocking, 2 × Rule 1 bug, 1 × Rule 2 missing critical)
**Impact on plan:** All five were prerequisites for the planned work rather than scope creep. Deviations 2 and 3 are fallout from making the config surface required — the plan's own Task 1 cannot pass its verify without them. Deviations 4 and 5 were compile/consumability blockers. No threat-mitigation from the register was weakened; T-1-04, T-1-05, and T-1-06 are all implemented and asserted.

## Issues Encountered

- **ioredis typing under NodeNext** (deviation 4) — the plan named the module but not its import shape. Resolved with the named class export; noted here because a later plan adding Redis instrumentation will hit the same default-export trap.
- **`keyPrefix` cannot be asserted on a live client.** ioredis always populates `client.options.keyPrefix` with its `""` default, so the plan's literal assertion ("assert no options object returned by the helper contains a `keyPrefix` property") is only meaningful against the pure factory. Introduced `buildRedisOptions` as a separate exported function to make the requirement testable rather than weakening the test.
- **Verification was run end-to-end, not only per-spec.** Both `<verification>` bullets (missing `REDIS_QUEUE_URL` → `CONFIG_INVALID: REDIS_QUEUE_URL`; equal host:port → `REDIS_INSTANCES_NOT_DISTINCT`) were exercised through the real `namedValidate` boot hook using a throwaway spec, which was deleted after confirming the behaviour — so the shipped test suite stays exactly as the plan specified.

## Threat Model Coverage

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-1-04 (`.strict()` + named `CONFIG_INVALID:`) | mitigate | Implemented — `AppConfigSchema.strict()`, `formatConfigError`, boot hook narrows to `APP_CONFIG_KEYS` before parsing; 7 schema tests + boot-hook test |
| T-1-05 (distinct `host:port`, no logical-DB escape) | mitigate | Implemented — `refineRedisInstancesDistinct` on `new URL(...).host`, no DNS; identical host:port and `/0` vs `/1` both rejected |
| T-1-06 (finite producer retries) | mitigate | Implemented — `PRODUCER_MAX_RETRIES_PER_REQUEST = 2` (in D-14's 1..3 band), asserted as a range |
| T-1-SC (no new package) | mitigate | **Deviation 1 introduces `ioredis@6.0.0`** — the exact STACK.md §14 pin, not a new package. The register's intent (no unpinned/undeclared dependency) holds. |

## User Setup Required

None — no external service configuration required. `REDIS_CACHE_URL` and `REDIS_QUEUE_URL` must now be set (to two **distinct** deployments) before any entrypoint boots; see the repo `.env.example` from plan 01.

## Next Phase Readiness

- **Ready:** plan 07 (health/readiness indicators) can consume `REDIS_CACHE` / `REDIS_QUEUE` and the two providers to report separate cache and queue readiness — the readiness half of FND-05 is now addressable.
- **Ready:** plan 10 (worker) constructs the BullMQ blocking connection via `buildRedisOptions('blocking')` and registers queues with `BULLMQ_PREFIX`. The provider deliberately does not expose a blocking client — it must not be shared with the request path.
- **Carried forward:** the production `NODE_ENV=production` ⇒ `CRYPTO_KEY_PROVIDER=kms` guard is **deliberately still absent** from this plan's `validate:` hook; it is owned by plan 05 inside `crypto/**`. Neither boot guard was weakened here.
- **Watch:** `test/setup-env.ts` now seeds the required boot surface globally. If plan 05 adds a new required field, that setup file is the one place that must grow with it, and a spec asserting the *absence* of that field will need to delete it explicitly rather than rely on it being unset.

## Self-Check: PASSED

- **Created files** (8/8 verified present on disk): the SUMMARY itself, `redis.schema.ts`, `redis.provider.ts`, `redis.constants.ts`, `queue.constants.ts`, `config.schema.ts`, `config.module.ts`, `test/setup-env.ts`.
- **Commits** (3/3 verified in `git log --all`): `78c7077`, `3772e51`, `e949602`.
- **Measured commit count** — `git rev-list --count cf50bd1..HEAD` = **3**, matching the three task commits and the `commits: 3` / `plan_head_before` / `plan_head_after` in the frontmatter. No uncommitted code changes: the only remaining working-tree entries are pre-existing and out of scope (`.planning/config.json`, `.gsd/`, `.planning/milestone.lock`, `.planning/state.json`).
- **Verification re-run after the last commit:** `npm run build` (lint + `tsc -b`) exits 0; `npm test` reports 5 files / 22 tests passed.
- **Stub scan** (`grep -rnE "TODO|FIXME|XXX|coming soon|placeholder|not available|=\s*\[\]|=\s*\{\}"` over `config/`, `redis/`, `queue/`, `test/setup-env.ts`): one hit — `candidate = {}` in `config.module.ts:23`, which is the local accumulator `namedValidate` fills from `APP_CONFIG_KEYS`, not a stub. No placeholder text, no skipped tests, no unwired component. Both `Provider` factories read their URLs from `ConfigService` at Nest bootstrap — the real value path, not a mock.

---
*Phase: 01-foundations-platform*
*Completed: 2026-10-02*