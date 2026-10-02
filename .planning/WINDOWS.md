---
schema_version: 1
open_count: 5
waived_count: 0
fixed_count: 0
total_count: 5
last_updated: 2026-10-02T15:10:00.000Z
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

````json
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
  }
]
````
