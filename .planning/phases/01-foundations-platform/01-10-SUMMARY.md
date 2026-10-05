---
phase: 01-foundations-platform
plan: 10
subsystem: infra
tags: [nestjs, opentelemetry, bullmq, health-checks, module-boundaries, deployment-shape, vitest]

requires:
  - phase: 01-foundations-platform
    provides: "01-01 workspaces + TS 6.0.3 + Zod ConfigModule; 01-03 boundaries lint + ProviderBoundaryGuard; 01-04 LoggerPort allowlist; 01-05 KeyProvider + AES-256-GCM; 01-07 HealthController + indicators; 01-08 BullMQ queue module, {akane-q} prefix, heartbeat + extra indicators; 01-09 startOtel + span allowlist + MetricsController"
provides:
  - "Three independently bootable ESM processes (api/worker/scheduler) on config-derived ports 3000/3001/3002"
  - "One OTel-first bootstrap shape, textually identical across the three main.ts files"
  - "Shared HealthController + MetricsController mounted on all three; exactly one definition of each route"
  - "The one BullMQ Worker in the repository, with its prefix pinned by test"
  - "Three per-app BoundaryManifests wired through the shared ProviderBoundaryGuardRunner"
  - "tooling/entrypoint-drift.spec.ts — per-app import-closure negative test"
  - "tooling/deployment-shape.spec.ts — the root manifest split that makes `npm ci --omit=dev` bootable"
  - "FND-03, FND-04, FND-05, FND-08 and OBS-01 closed against running processes"
affects: [phase-02, phase-04, phase-05, phase-08, all-http-consumers, deployment]

actuals:
  tokens: 31500
  tasks: 3
  commits: 7

tech-stack:
  added: []
  patterns:
    - "OTel-first bootstrap: `apps/*/otel.mjs` loader entry + a defensive `startOtel()` at the top of `main.ts`, then a *dynamic* `import('./app.module.js')`"
    - "Config-derived ports: `DEFAULT_PORT_BY_SERVICE[SERVICE_NAME]` in the boot schema, never a literal beside `listen()`"
    - "Platform-owned process-capability DI tokens (`WORKER_CONSUMERS`, `JOB_SCHEDULER_REGISTRATIONS`, `INBOUND_ADAPTER_REGISTRATIONS`) so a per-app `BoundaryManifest` can name what must never resolve"
    - "Root `dependencies` = what the built runtime can reach; `devDependencies` = build/test only"
    - "Extract-the-options-and-assert-the-value, so a two-field DI object is one testable unit"

key-files:
  created:
    - "apps/{api,worker,scheduler}/otel.mjs — OTel loader entries"
    - "apps/{api,worker,scheduler}/src/bootstrap/boundary-manifest.ts — per-app forbidden provider sets"
    - "apps/worker/src/processors/platform-heartbeat.processor.ts — the one BullMQ Worker"
    - "apps/worker/src/processors/platform-heartbeat.processor.spec.ts — prefix + readiness-slice contracts"
    - "apps/{api,worker,scheduler}/src/app.module.ts — the three composition roots"
    - "packages/platform/src/bootstrap/process-capabilities.ts — the capability vocabulary the manifests name"
    - "tooling/entrypoint-drift.spec.ts — import-closure walk from each main.ts"
    - "tooling/deployment-shape.spec.ts — runtime/dev split guard"
  modified:
    - "apps/{api,worker,scheduler}/src/main.ts — the one bootstrap shape"
    - "packages/platform/src/index.ts — the composed platform barrel"
    - "packages/platform/src/queue/queue.module.ts — re-export the registered queue"
    - "packages/platform/src/config/{config.module,config.schema}.ts — DI-time validation, per-process port, OTLP endpoint"
    - "package.json, package-lock.json — the dependency split"

key-decisions:
  - "The port default is derived from SERVICE_NAME in the boot schema, not written beside listen(). Three processes that all default to 3000 are one process with three names."
  - "Exactly ONE deep subpath was added to packages/platform's exports map — `./otel` — because that is the only surface that must load before anything instrumented. Every composition root imports the root barrel instead."
  - "The three BoundaryManifests forbid platform-owned capability tokens rather than app-local ones, because an app cannot name another app's token without importing its source, which is the boundary violation the manifest exists to catch."
  - "`nestjs-pino` is deliberately NOT wired in Phase 1 (no HTTP request-logging surface exists); the residual is waived with a handoff rather than closed."
  - "The root manifest is split once, with the rule 'what the built runtime can reach is a dependency', rather than per-workspace manifests that would restate 20 pins in four files."

patterns-established:
  - "Config at DI time, not at import time: `ConfigModule.forRoot()` is async and every decorator-argument call site evaluates at import; run the same `namedValidate` inside a `useFactory` instead."
  - "A boot assertion belongs in `OnApplicationBootstrap`, not after `NestFactory.create()`: it is the documented instant at which every non-lazy provider has been instantiated, and it fires inside `listen()` — before the socket binds."
  - "Import-closure walks must strip block comments. This codebase is ~80% prose and the prose quotes import lines."
  - "Prove a boot claim by booting it. Two of this plan's three defects were invisible to every spec that touched the affected file."

requirements-completed: [FND-03, FND-05, FND-08, OBS-01]

coverage:
  - id: D1
    description: "api, worker and scheduler each boot through NestFactory.create() on config-driven ports and answer /health/live, /health/ready and /metrics"
    requirement: FND-05
    verification:
      - kind: other
        ref: "booted all three dist entrypoints through their own otel.mjs loaders; curl-equivalent fetch on each port (see SUMMARY 'The skeleton actually runs')"
        status: pass
      - kind: unit
        ref: "packages/platform/src/health/health.controller.spec.ts (7 passed)"
        status: pass
    human_judgment: false
  - id: D2
    description: "SIGTERM drains in-flight work before exit (enableShutdownHooks + OTel flush + worker close)"
    requirement: FND-03
    verification:
      - kind: other
        ref: "SIGTERM to a booted worker: 9915 ms to exit vs 92 ms for a control process without shutdown hooks; port then refuses connections"
        status: pass
    human_judgment: false
  - id: D3
    description: "The platform-heartbeat Job Scheduler is registered on every replica and the job actually runs on every replica"
    requirement: FND-08
    verification:
      - kind: other
        ref: "booted worker+scheduler for 75 s: worker /metrics served platform_heartbeat_total{otel_scope_name=\"akane\"} 2; Redis held {akane-q}:platform-heartbeat:completed; scheduler /health/ready read job_schedulers back out of Redis"
        status: pass
      - kind: unit
        ref: "apps/worker/src/processors/platform-heartbeat.processor.spec.ts (7 passed)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Each app has a BoundaryManifest wired through the shared ProviderBoundaryGuard, and the import closure of no app reaches another's source or a worker-only specifier"
    requirement: FND-03
    verification:
      - kind: unit
        ref: "tooling/entrypoint-drift.spec.ts (17 passed); negative controls: planting a Worker binding and a QueueModule import in apps/api turns exactly 2 tests red"
        status: pass
    human_judgment: false
  - id: D5
    description: "One metric path: the OTel metrics API with the single Prometheus exporter, served by all three processes"
    requirement: OBS-01
    verification:
      - kind: other
        ref: "GET /metrics 200 on all three ports, each reporting its own target_info{service_name=…}"
        status: pass
      - kind: unit
        ref: "packages/platform/src/metrics/metrics.controller.spec.ts, packages/platform/src/metrics/business-metrics.spec.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "A lint rule fails the build when a module imports across a declared component boundary"
    requirement: FND-04
    verification:
      - kind: other
        ref: "planted a mongodb import in apps/api (R3 fires) and a Worker binding (no-restricted-imports fires); `npm run build` exited 1 both times"
        status: pass
      - kind: unit
        ref: "tooling/boundaries.fixture.spec.ts"
        status: pass
    human_judgment: false
  - id: D7
    description: "`npm ci --omit=dev` produces a tree the three processes can boot from"
    verification:
      - kind: other
        ref: "scratch tree at /tmp/opencode/prod-tree: npm ci --omit=dev (typescript + vitest absent; mongodb, ioredis, bullmq present), then all three processes booted and answered live/ready/metrics"
        status: pass
      - kind: unit
        ref: "tooling/deployment-shape.spec.ts (6 passed)"
        status: pass
    human_judgment: false
  - id: D8
    description: "D-09's health topology contradicts a research recommendation, and D-27's KMS vendor is still unnamed — both need a human to confirm or unblock"
    verification: []
    human_judgment: true
    rationale: "D-09 deliberately overrides ARCHITECTURE.md's `createApplicationContext()` recommendation for worker/scheduler; a reviewer may overturn it with one line, which amends FND-05. D-27 blocks FND-10 permanently until the deployment cloud is named, and no code in this phase can resolve it."

duration: 155min
completed: 2026-10-03
commits: 7
plan_head_before: 3e8c9e604b63714d94e83e70a39b66ecf97e01e0
plan_head_after: 65064b8
status: complete
---

# Phase 1 Plan 10: Entry Points, Boundary Manifests, and the Skeleton That Actually Runs

**Three independently bootable ESM processes on config-derived ports 3000/3001/3002, each serving
`/health/live`, `/health/ready` and `/metrics`, held apart by a lint gate, a boot-time provider guard
and an import-closure test — proved by booting them, and three of the five "done" claims were false
until it did.**

## Performance

- **Duration:** 155 min (this session; a prior attempt at this plan was killed mid-flight after
  leaving `25b9357` and an untrusted draft in the tree)
- **Started:** 2026-10-03T09:15Z (approximately — reading the plan and auditing the draft)
- **Completed:** 2026-10-03T11:53Z
- **Tasks:** 3 of 3
- **Files modified:** 31 source files (+2,383 / −128 lines)

## The skeleton actually runs

Everything below was produced by launching the **real** `dist/main.js` of each process through its
**real** `otel.mjs` loader against a real MongoDB 8.0 and two real Redis 8.10 deployments
(cache = `allkeys-lru`, queue = `noeviction`), then probing them. `api` ran on `PORT=3100` because
port 3000 on this host is already bound by an unrelated Redmine container; `worker` and `scheduler`
ran on their **derived defaults** 3001 and 3002 with no `PORT` set, which is the derivation the plan
asked to be config-driven rather than hardcoded.

| Process | Port | `/health/live` | `/health/ready` | `/metrics` |
|---|---|---|---|---|
| `api` | 3100 (`PORT` override) | 200 `{"status":"ok"}` | 200 · `mongo: up`, `redis_cache: up`, `redis_queue: up` | 200 · `target_info{service_name="api"}` |
| `worker` | **3001 (derived)** | 200 `{"status":"ok"}` | 200 · the three above **+** `bullmq_workers: {workers: 1, status: "up"}` | 200 · `target_info{service_name="worker"}` |
| `scheduler` | **3002 (derived)** | 200 `{"status":"ok"}` | 200 · the three above **+** `job_schedulers: {scheduler: "platform-heartbeat", status: "up"}` | 200 · `target_info{service_name="scheduler"}` |

Three separate `target_info` values across three ports is the direct evidence for OBS-01's shape:
these are three registries in three processes, not three views of one, so all three have to serve
the endpoint or an operator silently misses whichever process emitted the series they are querying.

**FND-08 end-to-end.** With `worker` and `scheduler` left up for 75 s (the heartbeat interval is
60 s), the worker's own `/metrics` served:

```
# HELP platform_heartbeat_total Ticks of the platform heartbeat job scheduler.
# TYPE platform_heartbeat_total counter
platform_heartbeat_total{otel_scope_name="akane"} 2
```

and Redis held `{akane-q}:platform-heartbeat:completed`. That is the plan-08 instrument, on the plan-08
OTel meter, moved by a job a plan-10 process scheduled and a plan-10 process consumed.

**SIGTERM drains (D-09 / T-1-24).** `SIGTERM` to the booted worker: **9,915 ms** to exit, then the
port refuses connections. A control `http.createServer(...).listen(3003)` with no shutdown hooks,
given the same signal on the same host: **92 ms**. Nest re-raises the signal after `app.close()`, so
`code: null, signal: "SIGTERM"` *is* the drained path — the 108× latency is the drain.

**From a production-shaped tree (WINDOWS #8).** The repo was copied without `node_modules`,
`npm ci --omit=dev` was run in the copy (347 packages; `typescript` and `vitest` absent,
`mongodb`, `ioredis` and `bullmq` present), and all three processes booted from that tree and answered
`live` / `ready` / `metrics` — `api` 42.9 s to first probe, `worker` 2.3 s, `scheduler` 0.6 s.

## Accomplishments

- Three ESM entrypoints that boot, listen on their own port, serve both health endpoints plus
  `/metrics`, and flush on SIGTERM — with the three `main.ts` files textually identical apart from
  their module.
- The `ConfigModule` import-time snapshot defect (WINDOWS #6) fixed properly and regression-tested;
  the port is now derived from `SERVICE_NAME` in the boot schema; `OTEL_EXPORTER_OTLP_ENDPOINT` is
  in the Zod boot schema (WINDOWS #12).
- Three per-app `BoundaryManifest`s wired through the shared `ProviderBoundaryGuardRunner`, plus a
  platform-owned capability vocabulary so the manifests have tokens they can actually name.
- `tooling/entrypoint-drift.spec.ts`: 17 tests walking the real import closure from each `main.ts`,
  including the dynamic `import('./app.module.js')` and the hop through `@akane/platform` into the
  platform's own sources.
- Root `package.json` split into runtime and build tooling, proven by a `npm ci --omit=dev` boot and
  guarded by `tooling/deployment-shape.spec.ts`.
- Requirements closed honestly: **FND-03, FND-04, FND-05, FND-08, OBS-01**. **FND-10 stays pending**,
  with the reason written into the requirement.

## Task Commits

1. **Task 1 (tracer): one bootstrap shape across all three apps** — `7c5b0b7` (feat)
2. **Task 2: compose the app modules, the worker processor, delete the tracer controller** — `ad9f2dc` (feat)
3. **Task 3: boundary manifests, capability tokens, drift test** — `679751d` (feat)

Plus, from the same plan's work: `25b9357` (recovered from the killed attempt — DI-time config
validation, derived port, OTLP endpoint in the schema, `shutdownOtel`, the platform barrel, the
`./otel` export), `89906a8` (the dependency split), `3af7d66` (the OTel pin assertions following it),
and this plan's metadata commit.

**Plan metadata commit:** see `git log` for the `docs(01-10)` commit.

_Note: the two `files_deleted` entries (`apps/api/src/health/health.controller.ts` and its spec) were
staged by `git rm` before task 1 and therefore went in with `7c5b0b7` rather than with task 2's
commit. The end state is correct and each commit is coherent on its own; task 2's message says where
the deletion actually landed._

## Files Created/Modified

- `apps/{api,worker,scheduler}/otel.mjs` — loader entries that start the SDK before anything instrumented
- `apps/{api,worker,scheduler}/src/main.ts` — `startOtel` → dynamic app-module import → `NestFactory.create` → `enableShutdownHooks` → `listen`
- `apps/{api,worker,scheduler}/src/app.module.ts` — the three composition roots
- `apps/{api,worker,scheduler}/src/bootstrap/boundary-manifest.ts` — per-app forbidden provider sets
- `apps/worker/src/processors/platform-heartbeat.processor.ts` — the one `Worker`, and `platformHeartbeatWorkerOptions()`
- `apps/worker/src/processors/platform-heartbeat.processor.spec.ts` — prefix and readiness-slice contracts
- `packages/platform/src/bootstrap/process-capabilities.ts` — `WORKER_CONSUMERS`, `JOB_SCHEDULER_REGISTRATIONS`, `INBOUND_ADAPTER_REGISTRATIONS`
- `packages/platform/src/queue/queue.module.ts` — re-exports the registered queue
- `packages/platform/src/index.ts` — the composed barrel
- `tooling/entrypoint-drift.spec.ts`, `tooling/deployment-shape.spec.ts`
- `package.json`, `package-lock.json`

## Decisions Made

1. **Ports are derived, not written.** `DEFAULT_PORT_BY_SERVICE[SERVICE_NAME]` lives in the boot
   schema, so the port is validated, overridable with one env var, and assertable by
   `validateConfig` — none of which is true of a literal beside `listen()`. It also makes a
   same-host three-process run possible, which is the only way an operator can see the topology
   behave like a topology before it is deployed.
2. **One deep export, on purpose.** Only `./otel` was added to the package's `exports` map — the
   only surface that must load before anything instrumented. Every composition root imports the root
   barrel, which now re-exports all ten subfolder surfaces. `api` *does* transitively reach `bullmq`
   through that barrel; the drift test asserts the **binding** and the **DI registration**, not the
   specifier, and says why.
3. **Manifests name platform-owned capability tokens.** A forbidden set needs tokens every process can
   reach, and Phase 1's process-specific surfaces were all app-local or unwritten — so the manifests
   would have had almost nothing expressible to forbid, which is the "guard that looks like
   enforcement and enforces nothing" failure by name.
4. **`nestjs-pino` is deliberately not wired.** See deviation 5.
5. **The deployment shape was decided once, at the root.** See deviation 6.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The draft BullMQ `Worker` had no `prefix`, so it consumed nothing**
- **Found during:** Task 2, in the tracer feedback gate — the heartbeat counter stayed at zero
- **Issue:** `new Worker(PLATFORM_HEARTBEAT_ID, …, { connection })` with no `prefix` listens on
  BullMQ's **default** namespace (`bull:platform-heartbeat`), while `BullModule.forRootAsync` puts
  D-14's `{akane-q}` on the producer `Queue`. The consumer parked on a queue nothing produces to.
  `/health/ready` reported `bullmq_workers: {workers: 1, status: "up"}` throughout, because
  `Worker.isRunning()` asks only whether the blocking loop is alive. Isolated to a bare BullMQ probe:
  a `Queue` with `prefix` and a `Worker` without one are two different queues, and neither a
  delayed job nor an immediate one moves.
- **Fix:** extracted `platformHeartbeatWorkerOptions(queueUrl)` so the whole option set is one
  assertable value, and it now carries `prefix: BULLMQ_PREFIX`
- **Files modified:** `apps/worker/src/processors/platform-heartbeat.processor.ts`, `…spec.ts` (new)
- **Verification:** the spec asserts the prefix equals `queueRootOptions(url).prefix` — a literal
  would have passed with two different literals. Removing the line turns exactly 1 of 7 tests red
  (recorded). After the fix: `platform_heartbeat_total 2` and `{akane-q}:platform-heartbeat:completed`.
- **Committed in:** `ad9f2dc`

**2. [Rule 1 - Bug] `QueueModule` registered the heartbeat queue but never exported it**
- **Found during:** Task 2, first boot of `apps/scheduler`
- **Issue:** `UnknownDependenciesException: Nest can't resolve dependencies of the AppModule (?) …
  "BullQueue_platform-heartbeat"`. Nest's `exports` re-exports a module *class*, not a dynamic
  module's providers, and calling `BullModule.registerQueue(...)` a second time for the export
  produces a different token from the one in `imports`.
- **Fix:** build the dynamic module once into a named const, use the same object in `imports` and
  `exports`
- **Files modified:** `packages/platform/src/queue/queue.module.ts`
- **Verification:** `apps/scheduler` boots and its `/health/ready` reads the scheduler back out of Redis
- **Committed in:** `ad9f2dc`

**3. [Rule 1 - Bug] The OTel pin spec still read `devDependencies` after the manifest split**
- **Found during:** the first full `npm test` after the WINDOWS #8 split
- **Issue:** 01-09's `otel.bootstrap.spec.ts` asserts every directly-imported `@opentelemetry/*`
  package is declared at a pinned version — in the **dev** half. The split moved all nine into
  `dependencies`, so 1 of 306 tests failed.
- **Fix:** the spec reads `dependencies` now, plus two new guards: a non-vacuity assertion on the
  scan, and a check that nothing observable is left behind in `devDependencies`
- **Files modified:** `packages/platform/src/otel/otel.bootstrap.spec.ts`
- **Verification:** 15/15 in isolation and green in the second full run
- **Committed in:** `3af7d66`

**4. [Rule 3 - Blocking] The WINDOWS ledger table and its fenced JSON disagreed, refusing every write**
- **Found during:** the ledger update after task 3
- **Issue:** rows 10–15 (01-09's entries) were added to the fenced JSON without regenerating the
  rendered table, so every `windows fixed` call returned `windows_ledger_table_drift`
- **Fix:** re-rendered the table byte-exactly with the tool's own `renderTable` + `extractTableRegion`,
  rather than hand-editing it (the tool's own guidance — the fenced JSON is the source of truth)
- **Files modified:** `.planning/WINDOWS.md`
- **Verification:** all 10 subsequent `windows` writes succeeded; frontmatter now reads
  `open_count: 5, waived_count: 1, fixed_count: 9`
- **Committed in:** `65064b8`

**5. [Rule 1 - Scope decision] `nestjs-pino` is deliberately NOT wired, and the WINDOWS #4 residual is waived not closed**
- **Found during:** the window review
- **Issue:** WINDOWS #4 said "Plan 10 wires `nestjs-pino`, which creates child loggers for requests,
  and MUST route them through `createChildLogger` or wrap the instance in a `LoggerPort` adapter".
  Phase 1 has no HTTP request-logging surface — `api` serves only `/health` and `/metrics` — and no
  error-reporting surface, so wiring it would be scope creep that immediately forces a Phase-2
  decision to be made for a Phase-1 need.
- **Fix:** nothing wired; the window is **waived** with a full handoff rather than marked fixed,
  because the underlying bypass (`logger.child()` discards `formatters.bindings`) is permanent and
  still reachable by a future direct pino call
- **Files modified:** `.planning/WINDOWS.md` only
- **Committed in:** `65064b8`

**6. [Rule 2 - Missing critical] The runtime/dev dependency split, and a guard for it**
- **Found during:** the window review (WINDOWS #8, assigned to this plan)
- **Issue:** every pin, including `ioredis` and `mongodb`, sat in root `devDependencies` while being
  imported by code that compiles into `dist/` and loads at boot. `npm ci --omit=dev` produced a tree
  with TypeScript, ESLint and Vitest and **no database driver**.
- **Fix:** the rule is *a package the built runtime can reach is a `dependency`; everything else is a
  `devDependency`*, applied at the root because this is a single-hoisting npm-workspaces repo whose
  workspaces deliberately declare no dependencies of their own (D-01 gives `packages/kernel` a
  zero-dependencies rule). `package-lock.json` regenerated in the same commit, because
  `npm ci --omit=dev` honours the **lockfile's** dev markers — a split manifest with a stale lockfile
  prunes identically.
- **Files modified:** `package.json`, `package-lock.json`, `tooling/deployment-shape.spec.ts` (new)
- **Verification:** `tooling/deployment-shape.spec.ts` re-derives the runtime import set from source on
  every commit and checks the lockfile's dev markers; and the split was proven by a
  `npm ci --omit=dev` install in a scratch tree followed by booting all three processes from it
- **Committed in:** `89906a8`

**7. [Rule 1 - Defect from the recovered draft] Audit of `25b9357` and the salvaged draft**
- **Found during:** Task 1, before the tracer gate
- **Issue:** the aborted attempt left `25b9357` plus uncommitted drafts. Audit found
  `25b9357` correct and worth building on — it does close WINDOWS #6 properly (the async
  `ConfigModule.forRoot()` snapshot is replaced by the same `namedValidate` inside a `useFactory`,
  with a regression test that sets `NODE_ENV` after the module's imports have run), plus #12, the
  derived port, `shutdownOtel`, the barrel and the `./otel` export. Two draft files were wrong and
  are deviations 1 and 2 above; two draft comments were wrong and were corrected (the worker
  processor claimed `apps/worker` "registers the heartbeat queue" without saying that `api` reaching
  the queue module through the barrel is harmless, and both health manifests' docblocks described a
  `forbidden`/`allowedTokens` shape the plan named but plan 03's interface does not have).
- **Fix:** corrected in place; nothing was reverted
- **Committed in:** `7c5b0b7`, `ad9f2dc`, `679751d`

**Total deviations:** 7 auto-fixed (4 Rule 1 bugs, 1 Rule 3 blocking, 1 Rule 2 missing critical,
1 scope decision recorded as a waiver)
**Impact on plan:** All seven were necessary for the plan's own success criteria — three of them were
found only because the tracer feedback gate booted real processes, which is precisely what the plan's
`<verify>` list could not do. No scope creep beyond the two spec files the guards required.

### Files created outside `files_modified` (recorded deviations)

- `apps/worker/src/processors/platform-heartbeat.processor.spec.ts` — the prefix regression test
  (deviation 1 has no other durable home; the processor file is listed, the spec is not)
- `tooling/deployment-shape.spec.ts` — the guard for deviation 6

---

## The Walking Skeleton, closed out

`SKELETON.md` promises an operator who starts any of the three processes and gets both health
endpoints over Zod-validated configuration, from a tree whose build fails on a boundary violation.
Every row of that promise is now demonstrated against running processes rather than asserted:

| SKELETON row | Evidence |
|---|---|
| npm workspaces, pinned toolchain, committed lockfile | `npm run build` green; `npm ci --omit=dev` boots (deviation 6) |
| "at least one real route on all three apps, ports 3000/3001/3002" | the boot table above; 3001 and 3002 on derived defaults |
| real connection pool, `ping()` against real Mongo 8.0 and two real Redis containers | `/health/ready` reporting `mongo: up`, `redis_cache: up`, `redis_queue: up` on all three |
| deployment: documented local full-stack run, no dev-environment deploy (D-11) | `npm run start:api|worker|scheduler`; **no Kubernetes manifests were written**, as the plan requires |
| UI | none — Phase 1 has none, as the skeleton says |

## Verification re-run after the last commit

- `npm run build` (`eslint .` && `tsc -b`) — exit 0
- **Full `npm test`: 35 files / 306 tests passed, 552.89 s, exit 0**
- Plan `<automated>` commands, all green:
  - `npm run build && node -e … BOOTSTRAP_SHAPE_OK` → `BOOTSTRAP_SHAPE_OK`
  - `node -e … OTEL_ENTRIES_OK` → `OTEL_ENTRIES_OK`
  - `node -e … COMPOSITION_OK` → `COMPOSITION_OK` (this also asserts the tracer's health controller is
    gone and that neither `api` nor `scheduler` constructs a `Worker`)
  - `npm test -- packages/platform/src/health/health.controller.spec.ts` → 7/7
  - `npm test -- tooling/entrypoint-drift.spec.ts` → 17/17
  - `node -e … MANIFESTS_OK` → `MANIFESTS_OK`
- Negative controls, each recorded with the count of tests it turned red:
  - `Worker` binding + `QueueModule` import planted in `apps/api` → exactly 2 drift tests red
  - `prefix` removed from `platformHeartbeatWorkerOptions` → exactly 1 processor test red
  - `mongodb` import planted in `apps/api` → `npm run build` exits 1 (`boundaries/dependencies`, R3)
  - `Worker` binding planted in `apps/api` → `npm run lint` exits 1 (`no-restricted-imports`, R1)
  - `import { Worker } from 'bullmq'` with `Queue` prefixed and `Worker` unprefixed in a bare BullMQ
    probe → neither an immediate nor a delayed job moved; with `prefix` on both, 7 jobs in 20 s

## Windows Ledger

`.planning/WINDOWS.md`: **9 fixed, 1 waived, 5 left open on purpose** (was 15 open).

| # | Outcome |
|---|---|
| 1, 2, 3 | fixed — the `export {}` skeleton is filled; `worker` and `scheduler` `main.ts` are real bootstraps |
| 4 | **waived with a handoff** — `nestjs-pino` deliberately not wired in Phase 1 (deviation 5); `createChildLogger` remains the only supported child path and no child logger exists in the tree |
| 5 | **open, as instructed** — `msg` is emitted outside the rebuild hook; needs a human ruling plus probably a lint rule against interpolating values into a log call |
| 6 | fixed — `ConfigModule` validates at DI time, with a regression test in the exact window the old implementation failed |
| 7 | **open, as instructed** — the envelope DEK is provider-derived and a rotating `kid` breaks prior envelopes until the Phase 4 secret store persists the wrapping; no real credential may be stored before then |
| 8 | fixed — the split, proven by a `npm ci --omit=dev` boot |
| 9, 10 | fixed — FND-05 and FND-08/OBS-01, against running processes |
| 11 | fixed deliberately — exactly one deep subpath (`./otel`), for the reason recorded in `index.ts` |
| 12 | fixed — `OTEL_EXPORTER_OTLP_ENDPOINT` is in the boot schema and validated through the same `AppConfigSchema` |
| 13, 14, 15 | **open by design** — 13 is an observability-policy decision owned by the tracing-cost phase; 14 and 15 are the ordering counterfactual and suite-shape trade-off, both 01-09's |

## Requirements closure

| Requirement | Outcome | Why |
|---|---|---|
| **FND-03** | **closed** | Three processes booted on three ports; three independent controls hold them apart, each negatively controlled |
| **FND-04** | **closed** (01-03, re-verified here) | `npm run build` exits 1 for a planted cross-boundary import and for a planted `Worker` binding |
| **FND-05** | **closed** | `/health/live` and `/health/ready` on all three, liveness reading no dependency by construction, tracer controller deleted |
| **FND-08** | **closed** | Registered on every replica, idempotently; the job **ran** — `platform_heartbeat_total 2`, `{akane-q}:platform-heartbeat:completed` |
| **OBS-01** | **closed** (01-09, mounted here) | All three serve `/metrics` from the single exporter, each with its own registry |
| **FND-10** | **stays pending** | The KMS vendor is still unnamed (D-27 / B-3). The envelope, the `KeyProvider` interface and the production guard exist; a KMS-backed master key does not. Phase 1 stores no secret (D-28) |
| AUD-10, DAT-13 | untouched | Contract-half only; the rest is Phase 3/4/6 |

## Issues Encountered

- **The aborted attempt's draft was wrong twice.** Treated as untrusted input and audited against the
  plan; `25b9357` was kept, two draft files were fixed (deviations 1 and 2).
- **`mongo.service.spec.ts` failed once under full-suite load** ("rejects `ping()` within the selection
  timeout once the server is gone", 60 s) and passed in isolation (4/4, 219 s). That file is untouched by
  this plan; the failure is contention across 35 parallel workers each starting containers, and it is
  consistent with 01-07's recorded `connectTimeoutMS` flake. It did not recur once the ad-hoc smoke
  containers were stopped. **Not recorded as a ledger entry** — it is a pre-existing intermittent, and
  logging it would misrepresent an out-of-scope observation as a Phase 1 defect; it is recorded here
  instead.
- **Boot time on this filesystem is 1–70 s** (`api` took 70 s to first probe once, 1 s the next) because
  `auto-instrumentations-node` and the Nest graph load from a slow disk. Worth watching: it is a
  deployment start-up-probe concern, not a correctness one, and no ledger entry was raised for it.
- **The WINDOWS ledger refused every write** until its rendered table was regenerated from the fenced
  JSON (deviation 4). Worth knowing for the next plan: an executor arriving at a drifted ledger will
  find `windows fixed` silently failing with `windows_ledger_table_drift`.

## User Setup Required

None. Docker is required by this plan's *verification* (MongoDB 8.0 + two Redis 8.10 containers) but
the plan adds no `user_setup` step and no external service configuration.

## Next Phase Readiness

- **Phase 2 can start on the platform.** The three-process skeleton runs; identity, RBAC and the
  inbound adapter have a place to land (`apps/api`, which is the only app whose manifest permits
  `INBOUND_ADAPTER_REGISTRATIONS`, already declared so the manifest is correct when the first receiver
  is wired).
- **`api` currently has no routes beyond `/health` and `/metrics`,** which is correct for Phase 1 and
  means no HTTP request logging exists yet — the WINDOWS #4 handoff applies to whichever phase adds
  the first one.
- **No logging pipeline is installed.** `createPinoOptions` and `createChildLogger` exist and are
  tested, but no composition root builds a logger, so nothing in the tree emits a log line. That is
  deliberate and is what makes WINDOWS #4's residual a handoff rather than a live leak.
- **FND-10 / D-27 remains the phase's one named blocker.** Phase 1 ships the interface and the guard;
  the KMS vendor adapter is budgeted separately and needs the deployment cloud named.
- **The `platform-heartbeat` consumer's error message is not surfaced anywhere.** `PlatformHeartbeatProcessor`
  records the last `Worker` error and reports `bullmq_workers: down`, but the message itself needs the
  typed `LoggerPort`, which no composition root installs yet. A consumer that dies says *that* it died,
  not *why* — the honest Phase 2 starting point.

## Self-Check: PASSED

- **Created files** (10/10 verified present on disk): the three `otel.mjs`, the three
  `app.module.ts`, the three `boundary-manifest.ts`, `platform-heartbeat.processor.ts` and its spec,
  `process-capabilities.ts`, `tooling/entrypoint-drift.spec.ts`,
  `tooling/deployment-shape.spec.ts`, plus this SUMMARY.
- **Deleted files** verified absent: `apps/api/src/health/health.controller.ts` and its spec.
- **Commits** (7/7 verified in `git log`): `25b9357`, `7c5b0b7`, `ad9f2dc`, `679751d`, `89906a8`,
  `3af7d66`, `65064b8`.
- **Measured commit count** — `git rev-list --count 3e8c9e6..65064b8` = **7**, matching `commits: 7` /
  `plan_head_before: 3e8c9e6` in the frontmatter. This SUMMARY's own metadata commit is a separate
  8th and is deliberately not counted, matching how 01-01 through 01-09 recorded their own.
- **Stub scan** over every file this plan created: no `TODO`, `FIXME`, `XXX`, `coming soon`,
  `placeholder`, `not implemented` or `NOT_IMPLEMENTED` survives. Every entrypoint, manifest and
  processor is a real implementation.

---
*Phase: 01-foundations-platform*
*Completed: 2026-10-03*
