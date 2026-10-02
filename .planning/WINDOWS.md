---
schema_version: 1
open_count: 7
waived_count: 0
fixed_count: 0
total_count: 7
last_updated: 2026-10-02T17:00:00.000Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | stub | packages/contract/src/index.ts |  | Intentional `export {}` skeleton barrel; filled by plans 02+ | open |  | 2026-10-02T07:43:17.730Z |  |
| 2 | 01 | stub | apps/worker/src/main.ts |  | Intentional NOT_IMPLEMENTED shell; completed in plan 07 | open |  | 2026-10-02T07:43:20.539Z |  |
| 3 | 01 | stub | apps/scheduler/src/main.ts |  | Intentional NOT_IMPLEMENTED shell; completed in plan 10 | open |  | 2026-10-02T07:43:25.045Z |  |
| 4 | 01 | deviation | packages/platform/src/logging/pino.config.ts |  | `logger.child(bindings)` bypasses the allowlist: pino's child fast path discards `formatters.bindings` (verified in lib/proto.js). Plan 10 wires `nestjs-pino`, which creates child loggers for requests, and MUST route them through `createChildLogger` or wrap the instance in a `LoggerPort` adapter that exposes no `child()` | open |  | 2026-10-02T15:10:00.000Z |  |
| 5 | 01 | unmet-truth | packages/platform/src/logging/pino.config.ts |  | `msg` is emitted verbatim by pino *after* `formatters.log` runs, so the log message is the one channel the allowlist cannot filter. `LoggerPort` fixes the message as a first argument, but no automated test can catch an interpolation. Needs a human ruling plus (likely) a lint rule against interpolating values into a log call | open |  | 2026-10-02T15:10:00.000Z |  |
| 6 | 01 | unmet-truth | packages/platform/src/config/config.module.ts | 13 | `ConfigModule.forRoot()` is `async` in `@nestjs/config@12` and is called at module scope without `await`, so `ConfigService` serves a configuration snapshot taken at **import time**. Measured: with `process.env.NODE_ENV = "production"` set before `compile()`, `ConfigService.get('NODE_ENV')` returned `"test"`. Plan 05's crypto factory reads the live environment as the workaround; the boot module itself still needs `forRoot()` awaited (or config loaded at bootstrap) in plan 10, or every future `ConfigService` consumer inherits a stale value | open |  | 2026-10-02T17:00:00.000Z |  |
| 7 | 01 | deviation | packages/platform/src/crypto/envelope.ts | 88 | The envelope derives its DEK from the provider by wrapping a fixed 32-byte label, because D-25 freezes the envelope at five fields with nowhere to persist a per-secret wrapped DEK and D-28 stores no secret. Consequence: rotating `kid` makes previously sealed envelopes undecryptable until the Phase 4 secret store persists the wrapping beside the envelope. The upgrade is additive (the five envelope fields do not change); it is NOT DONE and no real credential may be stored before it is | open |  | 2026-10-02T17:00:00.000Z |  |

````json[
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
    "description": "Intentional NOT_IMPLEMENTED shell; completed in plan 07",
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
  }
]
````
