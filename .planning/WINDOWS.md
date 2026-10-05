---
schema_version: 1
open_count: 8
waived_count: 1
fixed_count: 9
total_count: 18
last_updated: 2026-10-05T05:52:40.336Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | stub | packages/contract/src/index.ts |  | Intentional `export {}` skeleton barrel; filled by plans 02+ | fixed |  | 2026-10-02T07:43:17.730Z | 2026-10-03T11:13:54.938Z |
| 2 | 01 | stub | apps/worker/src/main.ts |  | Intentional NOT_IMPLEMENTED shell. **Corrected by 01-07:** the original text said "completed in plan 07", but 01-07 is the health/readiness plan; the BullMQ consumer lands in **plan 08**, and the HTTP bootstrap lands in plan 10 (D-09 requires `NestFactory.create()` on all three entrypoints) | fixed |  | 2026-10-02T07:43:20.539Z | 2026-10-03T11:14:01.741Z |
| 3 | 01 | stub | apps/scheduler/src/main.ts |  | Intentional NOT_IMPLEMENTED shell; completed in plan 10 | fixed |  | 2026-10-02T07:43:25.045Z | 2026-10-03T11:14:05.840Z |
| 4 | 01 | deviation | packages/platform/src/logging/pino.config.ts |  | `logger.child(bindings)` bypasses the allowlist: pino's child fast path discards `formatters.bindings` (verified in lib/proto.js). Plan 10 wires `nestjs-pino`, which creates child loggers for requests, and MUST route them through `createChildLogger` or wrap the instance in a `LoggerPort` adapter that exposes no `child()` | waived | Not waived as unimportant — the Phase-1 action item is discharged, the residual is permanent. Plan 10's assignment was conditional on wiring nestjs-pino and this plan deliberately does NOT wire it: Phase 1 has no HTTP request-logging surface (api serves only /health and /metrics), no error-reporting surface, and nestjs-pino is not in STACK.md's verified ledger as installed. Introducing one would be scope creep and would immediately require either a child logger the allowlist cannot gate or a LoggerPort adapter — a Phase-2 decision made for a Phase-1 need. What IS now true: no child logger is created anywhere in the tree, createChildLogger remains the only supported construction path (documented in pino.config.ts with the verified lib/proto.js fast path quoted), and the allowlist is total for every record the code emits. Residual, for whichever phase first wires HTTP logging: pino's child() discards formatters.bindings, so a bare logger.child({ user_email }) emits it — route every child through createChildLogger, or wrap the instance in a LoggerPort adapter that exposes no child(). | 2026-10-02T15:10:00.000Z | 2026-10-03T11:15:22.622Z |
| 5 | 01 | unmet-truth | packages/platform/src/logging/pino.config.ts |  | `msg` is emitted verbatim by pino *after* `formatters.log` runs, so the log message is the one channel the allowlist cannot filter. `LoggerPort` fixes the message as a first argument, but no automated test can catch an interpolation. Needs a human ruling plus (likely) a lint rule against interpolating values into a log call | open |  | 2026-10-02T15:10:00.000Z |  |
| 6 | 01 | unmet-truth | packages/platform/src/config/config.module.ts | 13 | `ConfigModule.forRoot()` is `async` in `@nestjs/config@12` and is called at module scope without `await`, so `ConfigService` serves a configuration snapshot taken at **import time**. Measured: with `process.env.NODE_ENV = "production"` set before `compile()`, `ConfigService.get('NODE_ENV')` returned `"test"`. Plan 05's crypto factory reads the live environment as the workaround; the boot module itself still needs `forRoot()` awaited (or config loaded at bootstrap) in plan 10, or every future `ConfigService` consumer inherits a stale value | fixed |  | 2026-10-02T17:00:00.000Z | 2026-10-03T11:14:08.444Z |
| 7 | 01 | deviation | packages/platform/src/crypto/envelope.ts | 88 | The envelope derives its DEK from the provider by wrapping a fixed 32-byte label, because D-25 freezes the envelope at five fields with nowhere to persist a per-secret wrapped DEK and D-28 stores no secret. Consequence: rotating `kid` makes previously sealed envelopes undecryptable until the Phase 4 secret store persists the wrapping beside the envelope. The upgrade is additive (the five envelope fields do not change); it is NOT DONE and no real credential may be stored before it is | open |  | 2026-10-02T17:00:00.000Z |  |
| 8 | 01 | unmet-truth | package.json |  | `mongodb@7.7.0` and `ioredis@6.0.0` are imported by runtime code (`packages/platform/src/mongo/mongo.service.ts` and `packages/platform/src/redis/redis.provider.ts` compile into `dist/`) but live in root **devDependencies** — the repo-wide pattern 01-02 (`ioredis`) and 01-04 (`pino`) established. `npm ci --omit=dev` therefore produces a tree that cannot boot. Not introduced by 01-07 and out of its scope, but it is a deployment-shape decision that must be made once, deliberately, before the first image is built | fixed |  | 2026-10-02T16:45:00.000Z | 2026-10-03T11:14:12.632Z |
| 9 | 01 | deviation | packages/platform/src/health/health.controller.ts |  | **FND-05 is NOT complete.** The `HealthController` and its three dependency indicators are built and proven, but no `apps/**` module mounts it: `apps/api` still registers plan 01's own live-only controller (no `/health/ready`), and `apps/worker` / `apps/scheduler` `main.ts` are `NOT_IMPLEMENTED` shells that serve no HTTP. D-09 requires all three entrypoints to expose both endpoints, and `MetricsController` (which they must also mount) does not exist until plan 09. Owner: plan 10. Do not check FND-05 in REQUIREMENTS.md before then | fixed |  | 2026-10-02T16:45:00.000Z | 2026-10-03T11:14:17.643Z |
| 10 | 01 | deviation | packages/platform/src/queue/platform-heartbeat.job.ts |  | **FND-08 and OBS-01 are NOT complete**, and both stay unchecked in REQUIREMENTS.md. FND-08: the mechanism is delivered and proven (idempotent `upsertJobScheduler`, registered three times against live Redis → `getJobSchedulersCount() === 1`), but `registerPlatformHeartbeat` has no caller and no process constructs the consuming `Worker` — owner plan 10. OBS-01: the instruments are on the OTel meter `akane` and a second `prom-client` path is proven absent, but the requirement names "a Prometheus exporter" and `exporter-prometheus` + the `NodeSDK` bootstrap are plan 09's files — owner plan 09. Closing either requires running processes, not this summary | fixed |  | 2026-10-03T08:00:00.000Z | 2026-10-03T11:14:22.237Z |
| 11 | 01 | deviation | packages/platform/package.json | 8 | The `exports` map still declares only `"."` and `"./crypto"`, so `@akane/platform/queue`, `/metrics`, `/health` and `/mongo` do **not** resolve cross-package. The barrels exist precisely so plans need not edit the root barrel, so this has now recurred FOUR times (01-04 `./logging`, 01-05 `./crypto`, 01-07 `./health` + `./mongo`, 01-08 `./queue` + `./metrics`). Plan 10 is the first plan that must actually deep-import one of them; resolve it there deliberately — add the entries, or import from the root barrel — rather than a fifth time by accident | fixed |  | 2026-10-03T08:00:00.000Z | 2026-10-03T11:14:25.844Z |
| 12 | 01 | deviation | packages/platform/src/otel/otel.bootstrap.ts |  | OTEL_EXPORTER_OTLP_ENDPOINT is not in the Zod boot schema; startOtel takes a narrow config object instead of AppConfig, leaving the new env key unvalidated at boot (FND-09 gap). Owner: plan 10 | fixed |  | 2026-10-03T10:05:00.000Z | 2026-10-03T11:14:34.050Z |
| 13 | 01 | deviation | packages/platform/src/otel/otel.bootstrap.ts |  | The auto-instrumentation bundle is un-narrowed; net and dns emit a span per socket (tcp.connect appears in the captured spans). Deliberate: narrowing is an observability-policy decision. Owner: the phase that owns tracing cost | open |  | 2026-10-03T10:05:00.000Z |  |
| 14 | 01 | deviation | packages/platform/src/otel/otel.bootstrap.node-ordering.spec.ts |  | The D-20 ordering counterfactual only reproduces outside Vitest, so this spec spawns node and costs ~26s; it also depends on per-file module isolation | open |  | 2026-10-03T10:05:00.000Z |  |
| 15 | 01 | deviation | vitest.config.mts |  | isolate:false now saves ~42s (~10% of a 7.5 min suite), up from ~16s in 01-07. Still declined, and plan 09 adds a hard reason: the ordering counterfactual depends on per-file isolation | open |  | 2026-10-03T10:05:00.000Z |  |
| 16 | 01 | unmet-truth | eslint.config.mjs | 44 | The boundary gate does not reach `apps/{api,worker,scheduler}/otel.mjs` — the D-20 loader entry that must load before anything instrumented. Its imports are declared and never evaluated. Two independent reasons, both measured: the rule's `files` block is scoped to `**/*.{ts,mts,cts}`, AND every element pattern is `apps/<app>/src/**`, so the file matches no element descriptor and `Rules/Dependencies.js` gates the evaluation on `!dependency.from.file.isIgnored`. Measured: 0 diagnostics today; widening `files` to `**/*.mjs` still gives 0, including for a planted cross-boundary import; `checkUnknownLocals: true` also gives 0, because it governs an unknown *target*, not an unknown origin. Closing it is an element-graph decision (does a loader entry belong to the `app-<name>` element?), which is D-02's explicit scoping — not a one-liner. Found while closing gap G-1; G-1's own subpath blind spot is fixed and pinned by tests | open |  | 2026-10-03T19:50:00.000Z |  |
| 17 | 01 | deviation | .planning/REQUIREMENTS.md |  | phase.complete flipped FND-10, AUD-10 and DAT-13 from Pending to Complete on 2026-10-03, overriding deliberate deferrals the verifier had just confirmed as honestly held. The requirement bodies still read STAYS PENDING, so the artifact contradicted itself. Reverted by hand. The CLI's phase-status update is keyed on phase completion rather than per-requirement evidence, so any deliberately-deferred requirement is at risk of the same overwrite until that is addressed. FND-10 in particular must stay Pending: Phase 5 must not store a connector credential before a KMS vendor is named (B-3/D-27). SCOPE CORRECTION 2026-10-04: phase.complete writes TWO machine-consumed fields per requirement — the `- [x]` checkbox and the coverage-table Status cell. The 2026-10-03 revert changed only the table, so the checkbox kept reading delivered for FND-10, AUD-10 and DAT-13 while the table and the requirement bodies said Pending; a Nyquist re-verification caught it. Any revert of this class must change BOTH fields. | open |  | 2026-10-04T01:28:19.120Z |  |
| 18 | 01 | superseded | .planning/phases/01-foundations-platform/01-12-PLAN.md | 01-11 Task 2's documented-path verify command | **Both halves now settled. Retained because `.planning/WINDOWS.md` is not in 01-12's `files_modified`, so 01-12's SUMMARY carries this supersession and it is applied here.** (a) *Probe budget.* The 15s (`N=30`) budget is widened to 60s (`N=120`) by 01-12, justified in D-5 as matching the constant `bootUntilLive` already uses (`waitFor(..., 120, 500)`) for the same boot, not fitted to the observed 28.8s. (b) *Port collision — the larger half, which this entry never recorded.* G3 established that on a host where the api default port 3000 is occupied, `tooling/onboarding.spec.ts` fails 4 of 27 outright with `EADDRINUSE :::3000`; `01-11`'s executor reported 27/27 only because it stopped the `pms-2026` container first and restarted it afterwards. That conditional is what made a green run misleading, so 01-12 removes the dependency: every boot acquires a port and passes `PORT` explicitly, and the documented-path shell command gains a bind probe reporting `PORT_OCCUPIED` with the holder named. Verified on the machine's normal state with `pms-2026` left Up: 37/37, nothing stopped. **Honest limit:** the documented-path command itself could not be executed in the verifying harness, which refuses `source`/`.` at command position — so (a)'s widened budget and (b)'s shell-command half are unrun there. Both are recorded as unrun in 01-12-SUMMARY rather than claimed green. | resolved | 01-12 | 2026-10-05T16:45:00.000Z | superseded by 01-12 in both halves; documented-path command unrun in harness |

````json
[
  {
    "id": 1,
    "kind": "stub",
    "phase": "01",
    "file": "packages/contract/src/index.ts",
    "line": null,
    "description": "Intentional `export {}` skeleton barrel; filled by plans 02+",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-02T07:43:17.730Z",
    "resolved_at": "2026-10-03T11:13:54.938Z",
    "milestone": null
  },
  {
    "id": 2,
    "kind": "stub",
    "phase": "01",
    "file": "apps/worker/src/main.ts",
    "line": null,
    "description": "Intentional NOT_IMPLEMENTED shell. **Corrected by 01-07:** the original text said \"completed in plan 07\", but 01-07 is the health/readiness plan; the BullMQ consumer lands in **plan 08**, and the HTTP bootstrap lands in plan 10 (D-09 requires `NestFactory.create()` on all three entrypoints)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-02T07:43:20.539Z",
    "resolved_at": "2026-10-03T11:14:01.741Z",
    "milestone": null
  },
  {
    "id": 3,
    "kind": "stub",
    "phase": "01",
    "file": "apps/scheduler/src/main.ts",
    "line": null,
    "description": "Intentional NOT_IMPLEMENTED shell; completed in plan 10",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-02T07:43:25.045Z",
    "resolved_at": "2026-10-03T11:14:05.840Z",
    "milestone": null
  },
  {
    "id": 4,
    "kind": "deviation",
    "phase": "01",
    "file": "packages/platform/src/logging/pino.config.ts",
    "line": null,
    "description": "`logger.child(bindings)` bypasses the allowlist: pino's child fast path discards `formatters.bindings` (verified in lib/proto.js). Plan 10 wires `nestjs-pino`, which creates child loggers for requests, and MUST route them through `createChildLogger` or wrap the instance in a `LoggerPort` adapter that exposes no `child()`",
    "status": "waived",
    "reason": "Not waived as unimportant — the Phase-1 action item is discharged, the residual is permanent. Plan 10's assignment was conditional on wiring nestjs-pino and this plan deliberately does NOT wire it: Phase 1 has no HTTP request-logging surface (api serves only /health and /metrics), no error-reporting surface, and nestjs-pino is not in STACK.md's verified ledger as installed. Introducing one would be scope creep and would immediately require either a child logger the allowlist cannot gate or a LoggerPort adapter — a Phase-2 decision made for a Phase-1 need. What IS now true: no child logger is created anywhere in the tree, createChildLogger remains the only supported construction path (documented in pino.config.ts with the verified lib/proto.js fast path quoted), and the allowlist is total for every record the code emits. Residual, for whichever phase first wires HTTP logging: pino's child() discards formatters.bindings, so a bare logger.child({ user_email }) emits it — route every child through createChildLogger, or wrap the instance in a LoggerPort adapter that exposes no child().",
    "recorded_at": "2026-10-02T15:10:00.000Z",
    "resolved_at": "2026-10-03T11:15:22.622Z",
    "milestone": null
  },
  {
    "id": 5,
    "kind": "unmet-truth",
    "phase": "01",
    "file": "packages/platform/src/logging/pino.config.ts",
    "line": null,
    "description": "`msg` is emitted verbatim by pino *after* `formatters.log` runs, so the log message is the one channel the allowlist cannot filter. `LoggerPort` fixes the message as a first argument, but no automated test can catch an interpolation. Needs a human ruling plus (likely) a lint rule against interpolating values into a log call",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-02T15:10:00.000Z",
    "resolved_at": null,
    "milestone": null
  },
  {
    "id": 6,
    "kind": "unmet-truth",
    "phase": "01",
    "file": "packages/platform/src/config/config.module.ts",
    "line": 13,
    "description": "`ConfigModule.forRoot()` is `async` in `@nestjs/config@12` and is called at module scope without `await`, so `ConfigService` serves a configuration snapshot taken at **import time**. Measured: with `process.env.NODE_ENV = \"production\"` set before `compile()`, `ConfigService.get('NODE_ENV')` returned `\"test\"`. Plan 05's crypto factory reads the live environment as the workaround; the boot module itself still needs `forRoot()` awaited (or config loaded at bootstrap) in plan 10, or every future `ConfigService` consumer inherits a stale value",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-02T17:00:00.000Z",
    "resolved_at": "2026-10-03T11:14:08.444Z",
    "milestone": null
  },
  {
    "id": 7,
    "kind": "deviation",
    "phase": "01",
    "file": "packages/platform/src/crypto/envelope.ts",
    "line": 88,
    "description": "The envelope derives its DEK from the provider by wrapping a fixed 32-byte label, because D-25 freezes the envelope at five fields with nowhere to persist a per-secret wrapped DEK and D-28 stores no secret. Consequence: rotating `kid` makes previously sealed envelopes undecryptable until the Phase 4 secret store persists the wrapping beside the envelope. The upgrade is additive (the five envelope fields do not change); it is NOT DONE and no real credential may be stored before it is",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-02T17:00:00.000Z",
    "resolved_at": null,
    "milestone": null
  },
  {
    "id": 8,
    "kind": "unmet-truth",
    "phase": "01",
    "file": "package.json",
    "line": null,
    "description": "`mongodb@7.7.0` and `ioredis@6.0.0` are imported by runtime code (`packages/platform/src/mongo/mongo.service.ts` and `packages/platform/src/redis/redis.provider.ts` compile into `dist/`) but live in root **devDependencies** — the repo-wide pattern 01-02 (`ioredis`) and 01-04 (`pino`) established. `npm ci --omit=dev` therefore produces a tree that cannot boot. Not introduced by 01-07 and out of its scope, but it is a deployment-shape decision that must be made once, deliberately, before the first image is built",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-02T16:45:00.000Z",
    "resolved_at": "2026-10-03T11:14:12.632Z",
    "milestone": null
  },
  {
    "id": 9,
    "kind": "deviation",
    "phase": "01",
    "file": "packages/platform/src/health/health.controller.ts",
    "line": null,
    "description": "**FND-05 is NOT complete.** The `HealthController` and its three dependency indicators are built and proven, but no `apps/**` module mounts it: `apps/api` still registers plan 01's own live-only controller (no `/health/ready`), and `apps/worker` / `apps/scheduler` `main.ts` are `NOT_IMPLEMENTED` shells that serve no HTTP. D-09 requires all three entrypoints to expose both endpoints, and `MetricsController` (which they must also mount) does not exist until plan 09. Owner: plan 10. Do not check FND-05 in REQUIREMENTS.md before then",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-02T16:45:00.000Z",
    "resolved_at": "2026-10-03T11:14:17.643Z",
    "milestone": null
  },
  {
    "id": 10,
    "kind": "deviation",
    "phase": "01",
    "file": "packages/platform/src/queue/platform-heartbeat.job.ts",
    "line": null,
    "description": "**FND-08 and OBS-01 are NOT complete**, and both stay unchecked in REQUIREMENTS.md. FND-08: the mechanism is delivered and proven (idempotent `upsertJobScheduler`, registered three times against live Redis → `getJobSchedulersCount() === 1`), but `registerPlatformHeartbeat` has no caller and no process constructs the consuming `Worker` — owner plan 10. OBS-01: the instruments are on the OTel meter `akane` and a second `prom-client` path is proven absent, but the requirement names \"a Prometheus exporter\" and `exporter-prometheus` + the `NodeSDK` bootstrap are plan 09's files — owner plan 09. Closing either requires running processes, not this summary",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-03T08:00:00.000Z",
    "resolved_at": "2026-10-03T11:14:22.237Z",
    "milestone": null
  },
  {
    "id": 11,
    "kind": "deviation",
    "phase": "01",
    "file": "packages/platform/package.json",
    "line": 8,
    "description": "The `exports` map still declares only `\".\"` and `\"./crypto\"`, so `@akane/platform/queue`, `/metrics`, `/health` and `/mongo` do **not** resolve cross-package. The barrels exist precisely so plans need not edit the root barrel, so this has now recurred FOUR times (01-04 `./logging`, 01-05 `./crypto`, 01-07 `./health` + `./mongo`, 01-08 `./queue` + `./metrics`). Plan 10 is the first plan that must actually deep-import one of them; resolve it there deliberately — add the entries, or import from the root barrel — rather than a fifth time by accident",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-03T08:00:00.000Z",
    "resolved_at": "2026-10-03T11:14:25.844Z",
    "milestone": null
  },
  {
    "id": 12,
    "kind": "deviation",
    "phase": "01",
    "file": "packages/platform/src/otel/otel.bootstrap.ts",
    "line": null,
    "description": "OTEL_EXPORTER_OTLP_ENDPOINT is not in the Zod boot schema; startOtel takes a narrow config object instead of AppConfig, leaving the new env key unvalidated at boot (FND-09 gap). Owner: plan 10",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-03T10:05:00.000Z",
    "resolved_at": "2026-10-03T11:14:34.050Z"
  },
  {
    "id": 13,
    "kind": "deviation",
    "phase": "01",
    "file": "packages/platform/src/otel/otel.bootstrap.ts",
    "line": null,
    "description": "The auto-instrumentation bundle is un-narrowed; net and dns emit a span per socket (tcp.connect appears in the captured spans). Deliberate: narrowing is an observability-policy decision. Owner: the phase that owns tracing cost",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-03T10:05:00.000Z",
    "resolved_at": null
  },
  {
    "id": 14,
    "kind": "deviation",
    "phase": "01",
    "file": "packages/platform/src/otel/otel.bootstrap.node-ordering.spec.ts",
    "line": null,
    "description": "The D-20 ordering counterfactual only reproduces outside Vitest, so this spec spawns node and costs ~26s; it also depends on per-file module isolation",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-03T10:05:00.000Z",
    "resolved_at": null
  },
  {
    "id": 15,
    "kind": "deviation",
    "phase": "01",
    "file": "vitest.config.mts",
    "line": null,
    "description": "isolate:false now saves ~42s (~10% of a 7.5 min suite), up from ~16s in 01-07. Still declined, and plan 09 adds a hard reason: the ordering counterfactual depends on per-file isolation",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-03T10:05:00.000Z",
    "resolved_at": null
  },
  {
    "id": 16,
    "kind": "unmet-truth",
    "phase": "01",
    "file": "eslint.config.mjs",
    "line": 44,
    "description": "The boundary gate does not reach `apps/{api,worker,scheduler}/otel.mjs` — the D-20 loader entry that must load before anything instrumented. Its imports are declared and never evaluated. Two independent reasons, both measured: the rule's `files` block is scoped to `**/*.{ts,mts,cts}`, AND every element pattern is `apps/<app>/src/**`, so the file matches no element descriptor and `Rules/Dependencies.js` gates the evaluation on `!dependency.from.file.isIgnored`. Measured: 0 diagnostics today; widening `files` to `**/*.mjs` still gives 0, including for a planted cross-boundary import; `checkUnknownLocals: true` also gives 0, because it governs an unknown *target*, not an unknown origin. Closing it is an element-graph decision (does a loader entry belong to the `app-<name>` element?), which is D-02's explicit scoping — not a one-liner. Found while closing gap G-1; G-1's own subpath blind spot is fixed and pinned by tests",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-03T19:50:00.000Z",
    "resolved_at": null
  },
  {
    "id": 17,
    "kind": "deviation",
    "phase": "01",
    "file": ".planning/REQUIREMENTS.md",
    "line": null,
    "description": "phase.complete flipped FND-10, AUD-10 and DAT-13 from Pending to Complete on 2026-10-03, overriding deliberate deferrals the verifier had just confirmed as honestly held. The requirement bodies still read STAYS PENDING, so the artifact contradicted itself. Reverted by hand. The CLI's phase-status update is keyed on phase completion rather than per-requirement evidence, so any deliberately-deferred requirement is at risk of the same overwrite until that is addressed. FND-10 in particular must stay Pending: Phase 5 must not store a connector credential before a KMS vendor is named (B-3/D-27). SCOPE CORRECTION 2026-10-04: phase.complete writes TWO machine-consumed fields per requirement — the `- [x]` checkbox and the coverage-table Status cell. The 2026-10-03 revert changed only the table, so the checkbox kept reading delivered for FND-10, AUD-10 and DAT-13 while the table and the requirement bodies said Pending; a Nyquist re-verification caught it. Any revert of this class must change BOTH fields.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-04T01:28:19.120Z",
    "resolved_at": null,
    "milestone": null
  },
  {
    "id": 18,
    "kind": "unrun-verify",
    "phase": "01",
    "file": ".planning/phases/01-foundations-platform/01-11-PLAN.md",
    "line": null,
    "description": "Task 2's documented-path verify command fails on this host: its probe allows 30x500ms (15s) for /health/ready, but external load (load avg 7-15, ~1GB free RAM) stretches Nest+instrumented-driver module load to ~29s. Run verbatim it exits 1 with NOT_READY. The identical boot reaches READY_OK mongo,redis_cache,redis_queue after 28.8s, so the documented path is correct and only the probe budget is host-dependent. Not fixed by editing the command (plan forbids it); re-run on an idle host or widen N deliberately.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-05T05:52:40.336Z",
    "resolved_at": null,
    "milestone": null
  }
]
````
