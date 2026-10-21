# Deferred Items (07-01)

## Pre-existing test failure — out of scope

`tooling/entrypoint-drift.spec.ts` — "every app source file is reachable from its own main.ts — no orphan escapes the walk" fails at `plan_head_before` (`3aff9e6a`) on `apps/api` (slack adapters, link-error.filter, permission.guard never loaded by main.ts). Pre-existing — NOT caused by 07-01's form-set cutover. Out of scope per scope-boundary rule.
