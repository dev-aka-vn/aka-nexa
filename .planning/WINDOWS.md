---
schema_version: 1
open_count: 15
waived_count: 0
fixed_count: 0
total_count: 15
last_updated: 2026-10-03T10:05:00.000Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | stub | packages/contract/src/index.ts |  | Intentional `export {}` skeleton barrel; filled by plans 02+ | open |  | 2026-10-02T07:43:17.730Z |  |
| 2 | 01 | stub | apps/worker/src/main.ts |  | Intentional NOT_IMPLEMENTED shell. **Corrected by 01-07:** the original text said "completed in plan 07", but 01-07 is the health/readiness plan; the BullMQ consumer lands in **plan 08**, and the HTTP bootstrap lands in plan 10 (D-09 requires `NestFactory.create()` on all three entrypoints) | open |  | 2026-10-02T07:43:20.539Z |  |
| 3 | 01 | stub | apps/scheduler/src/main.ts |  | Intentional NOT_IMPLEMENTED shell; completed in plan 10 | open |  | 2026-10-02T07:43:25.045Z |  |
| 4 | 01 | deviation | packages/platform/src/logging/pino.config.ts |  | `logger.child(bindings)` bypasses the allowlist: pino's child fast path discards `formatters.bindings` (verified in lib/proto.js). Plan 10 wires `nestjs-pino`, which creates child loggers for requests, and MUST route them through `createChildLogger` or wrap the instance in a `LoggerPort` adapter that exposes no `child()` | open |  | 2026-10-02T15:10:00.000Z |  |
| 5 | 01 | unmet-truth | packages/platform/src/logging/pino.config.ts |  | `msg` is emitted verbatim by pino *after* `formatters.log` runs, so the log message is the one channel the allowlist cannot filter. `LoggerPort` fixes the message as a first argument, but no automated test can catch an interpolation. Needs a human ruling plus (likely) a lint rule against interpolating values into a log call | open |  | 2026-10-02T15:10:00.000Z |  |
| 6 | 01 | unmet-truth | packages/platform/src/config/config.module.ts | 13 | `ConfigModule.forRoot()` is `async` in `@nestjs/config@12` and is called at module scope without `await`, so `ConfigService` serves a configuration snapshot taken at **import time**. Measured: with `process.env.NODE_ENV = "production"` set before `compile()`, `ConfigService.get('NODE_ENV')` returned `"test"`. Plan 05's crypto factory reads the live environment as the workaround; the boot module itself still needs `forRoot()` awaited (or config loaded at bootstrap) in plan 10, or every future `ConfigService` consumer inherits a stale value | open |  | 2026-10-02T17:00:00.000Z |  |
| 7 | 01 | deviation | packages/platform/src/crypto/envelope.ts | 88 | The envelope derives its DEK from the provider by wrapping a fixed 32-byte label, because D-25 freezes the envelope at five fields with nowhere to persist a per-secret wrapped DEK and D-28 stores no secret. Consequence: rotating `kid` makes previously sealed envelopes undecryptable until the Phase 4 secret store persists the wrapping beside the envelope. The upgrade is additive (the five envelope fields do not change); it is NOT DONE and no real credential may be stored before it is | open |  | 2026-10-02T17:00:00.000Z |  |
| 8 | 01 | unmet-truth | package.json |  | `mongodb@7.7.0` and `ioredis@6.0.0` are imported by runtime code (`packages/platform/src/mongo/mongo.service.ts` and `packages/platform/src/redis/redis.provider.ts` compile into `dist/`) but live in root **devDependencies** — the repo-wide pattern 01-02 (`ioredis`) and 01-04 (`pino`) established. `npm ci --omit=dev` therefore produces a tree that cannot boot. Not introduced by 01-07 and out of its scope, but it is a deployment-shape decision that must be made once, deliberately, before the first image is built | open |  | 2026-10-02T16:45:00.000Z |  |
| 9 | 01 | deviation | packages/platform/src/health/health.controller.ts |  | **FND-05 is NOT complete.** The `HealthController` and its three dependency indicators are built and proven, but no `apps/**` module mounts it: `apps/api` still registers plan 01's own live-only controller (no `/health/ready`), and `apps/worker` / `apps/scheduler` `main.ts` are `NOT_IMPLEMENTED` shells that serve no HTTP. D-09 requires all three entrypoints to expose both endpoints, and `MetricsController` (which they must also mount) does not exist until plan 09. Owner: plan 10. Do not check FND-05 in REQUIREMENTS.md before then | open |  | 2026-10-02T16:45:00.000Z |  |
| 10 | 01 | deviation | packages/platform/src/queue/platform-heartbeat.job.ts |  | **FND-08 is NOT complete** and stays unchecked in REQUIREMENTS.md. The mechanism is delivered and proven (idempotent `upsertJobScheduler`, registered three times against live Redis → `getJobSchedulersCount() === 1`), but `registerPlatformHeartbeat` has no caller and no process constructs the consuming `Worker` — owner plan 10. **OBS-01 was closed by 01-09** (`startOtel()`, the one Prometheus exporter singleton, `GET /metrics` from it, with a substituted exporter negatively controlled); its residual is that `MetricsModule` is mounted by no process until plan 10 — owner plan 10. Closing FND-08 requires running processes, not this summary | open |  | 2026-10-03T08:00:00.000Z |  |
| 11 | 01 | deviation | packages/platform/package.json | 8 | The `exports` map still declares only `"."` and `"./crypto"`, so `@akane/platform/queue`, `/metrics`, `/health`, `/mongo`, `/otel` do **not** resolve cross-package. The barrels exist precisely so plans need not edit the root barrel, so this has now recurred FIVE times (01-04 `./logging`, 01-05 `./crypto`, 01-07 `./health` + `./mongo`, 01-08 `./queue` + `./metrics`, 01-09 `./otel` + `./metrics`). Plan 10 is the first plan that must actually deep-import one of them; resolve it there deliberately — add the entries, or import from the root barrel — rather than a sixth time by accident | open |  | 2026-10-03T08:00:00.000Z |  |
| 12 | 01 | deviation | packages/platform/src/otel/otel.bootstrap.ts |  | **`OTEL_EXPORTER_OTLP_ENDPOINT` is not in the Zod boot schema.** `startOtel` takes a narrow `OtelBootstrapConfig` (`{ SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT? }`) instead of reading `AppConfig`, because `config.schema.ts` is not in plan 09's `files_modified`. Consequence: the new env key is unvalidated at boot, which is an FND-09 gap. Plan 10 must add it to `AppConfigShape` and pass the validated value through — this is the same `ConfigService`-snapshot hazard as entry 6, and `startOtel` runs before `ConfigModule` exists, so plan 10 should read `process.env` live here for the same reason 01-05's crypto factory does | open |  | 2026-10-03T10:05:00.000Z |  |
| 13 | 01 | deviation | packages/platform/src/otel/otel.bootstrap.ts |  | **The auto-instrumentation bundle is un-narrowed, and `net`/`dns` emit a span per socket** (`tcp.connect` is present in the ordering probe's captured spans). Real trace volume at 1,000 concurrent users. Left as-is deliberately: disabling instrumentations is an observability-policy decision with its own cost, and doing it silently inside a bootstrap would hide the choice from review. Owner: whichever phase owns tracing cost (OBS-03/OBS-08), not plan 10 | open |  | 2026-10-03T10:05:00.000Z |  |
| 14 | 01 | deviation | packages/platform/src/otel/otel.bootstrap.node-ordering.spec.ts |  | **The D-20 ordering counterfactual only reproduces outside Vitest.** It resolves external CJS through its own module runner rather than the `Module._load` chain `require-in-the-middle` patches, so an in-process version of the same test passes for the wrong reason. Consequence: this spec spawns `node --input-type=module -e` and costs ~26 s. **It also depends on per-file module isolation**, which is the hard reason to keep declining `isolate: false` (entry 15). If a future Vitest upgrade closes the gap, the assertion must be moved back in-process rather than left paying for a subprocess | open |  | 2026-10-03T10:05:00.000Z |  |
| 15 | 01 | deviation | vitest.config.mts |  | `isolate: false` now saves ~42 s (~10% of a 7.5 min suite), up from ~16 s in 01-07. **Still declined**, and this plan adds a hard reason: entry 14's counterfactual depends on per-file module isolation and would become order-dependent. Revisit only if a suite is built where no spec depends on isolation | open |  | 2026-10-03T10:05:00.000Z |  |

```json
[
  {
    "id": 1,
    "kind": "stub",
    "phase": "01",
    "file": "packages/contract/src/index.ts",
    "line": null,
    "description": "Intentional `export {}` skeleton barrel; filled by plans 02+",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-02T07:43:17.730Z",
    "resolved_at": null,
    "milestone": null
  },
  {
    "id": 2,
    "kind": "stub",
    "phase": "01",
    "file": "apps/worker/src/main.ts",
    "line": null,
    "description": "Intentional NOT_IMPLEMENTED shell. **Corrected by 01-07:** the original text said \"completed in plan 07\", but 01-07 is the health/readiness plan; the BullMQ consumer lands in **plan 08**, and the HTTP bootstrap lands in plan 10 (D-09 requires `NestFactory.create()` on all three entrypoints)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-02T07:43:20.539Z",
    "resolved_at": null,
    "milestone": null
  },
  {
    "id": 3,
    "kind": "stub",
    "phase": "01",
    "file": "apps/scheduler/src/main.ts",
    "line": null,
    "description": "Intentional NOT_IMPLEMENTED shell; completed in plan 10",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-02T07:43:25.045Z",
    "resolved_at": null,
    "milestone": null
  },
  {
    "id": 4,
    "kind": "deviation",
    "phase": "01",
    "file": "packages/platform/src/logging/pino.config.ts",
    "line": null,
    "description": "`logger.child(bindings)` bypasses the allowlist: pino's child fast path discards `formatters.bindings` (verified in lib/proto.js). Plan 10 wires `nestjs-pino`, which creates child loggers for requests, and MUST route them through `createChildLogger` or wrap the instance in a `LoggerPort` adapter that exposes no `child()`",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-02T15:10:00.000Z",
    "resolved_at": null,
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
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-02T17:00:00.000Z",
    "resolved_at": null,
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
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-02T16:45:00.000Z",
    "resolved_at": null,
    "milestone": null
  },
  {
    "id": 9,
    "kind": "deviation",
    "phase": "01",
    "file": "packages/platform/src/health/health.controller.ts",
    "line": null,
    "description": "**FND-05 is NOT complete.** The `HealthController` and its three dependency indicators are built and proven, but no `apps/**` module mounts it: `apps/api` still registers plan 01's own live-only controller (no `/health/ready`), and `apps/worker` / `apps/scheduler` `main.ts` are `NOT_IMPLEMENTED` shells that serve no HTTP. D-09 requires all three entrypoints to expose both endpoints, and `MetricsController` (which they must also mount) does not exist until plan 09. Owner: plan 10. Do not check FND-05 in REQUIREMENTS.md before then",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-02T16:45:00.000Z",
    "resolved_at": null,
    "milestone": null
  },
  {
    "id": 10,
    "kind": "deviation",
    "phase": "01",
    "file": "packages/platform/src/queue/platform-heartbeat.job.ts",
    "line": null,
    "description": "**FND-08 and OBS-01 are NOT complete**, and both stay unchecked in REQUIREMENTS.md. FND-08: the mechanism is delivered and proven (idempotent `upsertJobScheduler`, registered three times against live Redis → `getJobSchedulersCount() === 1`), but `registerPlatformHeartbeat` has no caller and no process constructs the consuming `Worker` — owner plan 10. OBS-01: the instruments are on the OTel meter `akane` and a second `prom-client` path is proven absent, but the requirement names \"a Prometheus exporter\" and `exporter-prometheus` + the `NodeSDK` bootstrap are plan 09's files — owner plan 09. Closing either requires running processes, not this summary",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-03T08:00:00.000Z",
    "resolved_at": null,
    "milestone": null
  },
  {
    "id": 11,
    "kind": "deviation",
    "phase": "01",
    "file": "packages/platform/package.json",
    "line": 8,
    "description": "The `exports` map still declares only `\".\"` and `\"./crypto\"`, so `@akane/platform/queue`, `/metrics`, `/health` and `/mongo` do **not** resolve cross-package. The barrels exist precisely so plans need not edit the root barrel, so this has now recurred FOUR times (01-04 `./logging`, 01-05 `./crypto`, 01-07 `./health` + `./mongo`, 01-08 `./queue` + `./metrics`). Plan 10 is the first plan that must actually deep-import one of them; resolve it there deliberately — add the entries, or import from the root barrel — rather than a fifth time by accident",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-03T08:00:00.000Z",
    "resolved_at": null,
    "milestone": null
  },
  {
    "id": 12,
    "kind": "deviation",
    "phase": "01",
    "file": "packages/platform/src/otel/otel.bootstrap.ts",
    "line": null,
    "description": "OTEL_EXPORTER_OTLP_ENDPOINT is not in the Zod boot schema; startOtel takes a narrow config object instead of AppConfig, leaving the new env key unvalidated at boot (FND-09 gap). Owner: plan 10",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-03T10:05:00.000Z",
    "resolved_at": null
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
  }
]
```
