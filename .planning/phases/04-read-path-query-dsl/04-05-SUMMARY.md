---
phase: 04-read-path-query-dsl
plan: 05
type: execute
subsystem: read-path
tags: [read-link, denial-ux, LNK-08, LNK-11, D-70]
status: complete
depends_on: ["01-04"]
requirements:
  - LNK-08
  - LNK-11
estimate:
  tokens: 20000
  raw_tokens: 14000
  tasks: 2
  confidence: med
actuals:
  tokens: 6400
  tasks: 2
  commits: 2
plan_head_before: 899979b21ad7306405c7b68d86952d3e6ec34f2c
plan_head_after: ee184aa0bc2dbd0cf9acbbf881a00277fcf49fbc
---

# Phase 4 Plan 5: Denial UX & LNK-08 Reason Tracking Summary

## One-liner

Polished dead-link UX with specific denial reasons and IM affordance; extended `LinkErrorFilter` to map all 11 `ReadDenyReason` values with actionable/non-actionable classification.

## What was built

### Task 1: Enhance dead link page with specific reason + IM affordance

**File:** `apps/renderer/src/read/dead.html`

- Parses `?reason=` query param with `ReadDenyReason` enum validation (unknown values fall back to `bad_signature`)
- Displays mapped friendly copy via `getDenyReasonCopy` from `view.ts`
- Adds LNK-11 "request a new one via IM" affordance button, shown only for actionable reasons
- Actionable set: `expired`, `consumed`, `revoked`, `wrong_app`, `wrong_version`, `bad_signature`
- Non-actionable reasons hide the affordance (user cannot self-serve)
- Reuses renderer token set (`--color-primary`, `--color-danger`); no second palette

### Task 2: Finalize LinkErrorFilter mapping for all read deny reasons

**Files:** `apps/api/src/common/filters/link-error.filter.ts`, `apps/api/src/common/filters/link-error.filter.spec.ts`

- Added `ReadDenyReason`-based mapping on `LinkErrorFilter`:
  - `getReadDenyReasonCopy(reason)` — user-facing copy for all 11 enum members
  - `isActionableReadDenyReason(reason)` — true for the six self-serve reasons
  - `fromReadDenyReason(reason)` — builds a `LinkError` with `DENIED` code
- `consumed` mapped defensively (structurally unreachable for read links per D-42, but kept in the actionable set so a stale issuer gets generic self-serve copy)
- `deactivated_user` is a LNK-08 reason but **not** actionable — account-level condition, new link won't help
- Legacy `LinkErrorCode` path unchanged (backward compatible)
- New spec: 18 tests covering every enum member, fallback behavior, actionable/non-actionable classification, and the LNK-08 seven-reason set

## Key decisions

- **Actionable set is the six self-serve reasons** (`expired`, `consumed`, `revoked`, `wrong_app`, `wrong_version`, `bad_signature`). `deactivated_user` is counted under LNK-08 but is not actionable — the user cannot self-serve by requesting a new link.
- **`consumed` is defensive only.** D-42 says read links never consume (`consume: false` on view/query tokens), so no code path in the read verifier produces it. It's retained in the actionable set so a stale issuer gets generic copy rather than an unhandled case.
- **API and renderer share the same source of truth.** Both `LinkErrorFilter` and `view.ts`'s `DENY_REASON_COPY` use the same `ReadDenyReason` enum and the same actionable set, with identical IM affordance wording.
- **Vitest 5 dropped `--grep`** (it's `-t`/`--testNamePattern`). The plan's verification command was run by file path instead — equivalent coverage, no behavioral gap.

## Verification

```
apps/api/src/common/filters/link-error.filter.spec.ts   18 passed
apps/renderer/src/read/view.spec.ts                       23 passed
packages/domain/src/links/__tests__/read-deny.spec.ts     11 passed
apps/api/src/common/metrics/read-deny.metrics.spec.ts     7 passed
─────────────────────────────────────────────────────────
4 files, 49 tests, all passing
```

## Deviations from plan

None — plan executed as written.

## Threat flags

None beyond the plan's `<threat_model>` (T-04-10: information disclosure via error messages). The read-deny copy mapping is the mitigation — all messages are user-safe, internal reasons logged separately via `ReadDenyService` with the D-43 allowlist.

## Known stubs

None. All reason mappings are wired to real copy strings; no placeholder text, empty values, or unbacked components.

## Self-Check: PASSED

- [x] `apps/renderer/src/read/dead.html` — enhanced with reason parsing + IM affordance
- [x] `apps/api/src/common/filters/link-error.filter.ts` — extended with 11-reason mapping
- [x] `apps/api/src/common/filters/link-error.filter.spec.ts` — 18 tests, all passing
- [x] Commit `19d670ec` — dead.html enhancement
- [x] Commit `ee184aa0` — LinkErrorFilter extension + spec
- [x] All 49 related tests pass across 4 spec files