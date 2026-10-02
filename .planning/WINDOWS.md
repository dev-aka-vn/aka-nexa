---
schema_version: 1
open_count: 3
waived_count: 0
fixed_count: 0
total_count: 3
last_updated: 2026-10-02T07:43:25.045Z
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
  }
]
````
