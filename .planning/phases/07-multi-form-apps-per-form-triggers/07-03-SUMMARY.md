---
phase: 07-multi-form-apps-per-form-triggers
plan: 03
subsystem: template-gallery
tags: [zod, seed, multi-form, saved-query, fail-closed]
requires:
  - phase: 07-01
    provides: per-form TemplateSeedSchema migration and content-hash loader
provides:
  - per-kind config validation in TemplateSeedSchema (.superRefine)
  - genuine multi-form seeds (leave-request submit+list, expense-report show, it-helpdesk-ticket show)
  - fail-closed (app_id, query_id) lookup assertion for the list form reference
  - removal of stale provisioning/forms artifact
affects: [07-04, 07-05]
actuals:
  tokens: 12292
  tasks: 2
  commits: 2
tech-stack:
  added: []
  patterns:
    - "per-kind superRefine on TemplateSeedSchema (same-kind uniqueness, submit schema presence, show fields subset, list query_id/columns)"
key-files:
  created: []
  modified:
    - packages/domain/src/builder/template/template.seed.ts
    - packages/domain/src/builder/template/seeds/leave-request.json
    - packages/domain/src/builder/template/seeds/expense-report.json
    - packages/domain/src/builder/template/seeds/it-helpdesk-ticket.json
    - packages/domain/src/builder/template/template.spec.ts
    - packages/domain/src/builder/saved-query.repository.spec.ts
  deleted:
    - provisioning/forms/leave-request.form.json
key-decisions:
  - "Per-kind config validation lives in TemplateSeedSchema via .superRefine, naming the offending field/key in every rejection message."
  - "Leave-request ships submit+list over qry_pending_leave; expense-report and it-helpdesk-ticket ship a show form over a subset of their own submit keys."
  - "No cross-collection validation in the seed loader; an unknown query_id fails closed at read time."
patterns-established:
  - "show form config.fields must be a subset of the seed's submit schema component keys"
requirements-completed: [APP-11, FRM-14]
coverage:
  - id: D1
    description: "Per-kind config validation in TemplateSeedSchema (same-kind uniqueness, submit schema, show subset, list query_id/columns)"
    requirement: FRM-14
    verification:
      - kind: unit
        ref: "packages/domain/src/builder/template/template.spec.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Multi-form seed content: leave-request submit+list, expense-report show, it-helpdesk-ticket show"
    requirement: FRM-14
    verification:
      - kind: unit
        ref: "packages/domain/src/builder/template/template.spec.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Fail-closed (app_id, query_id) lookup assertion for the list form reference"
    requirement: FRM-14
    verification:
      - kind: unit
        ref: "packages/domain/src/builder/saved-query.repository.spec.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Removal of stale provisioning/forms artifact"
    requirement: APP-11
    verification: []
    human_judgment: true
    rationale: "Deletion verified by file absence and git grep; no automated assertion beyond that."
duration: 15min
completed: 2026-10-18
status: complete
---

# Phase 07 Plan 03: Seed gallery goes genuinely multi-form Summary

**Per-kind config validation in TemplateSeedSchema plus real list/show forms in three seeds, and removal of the stale Phase-2 provisioning form artifact.**

## Performance

- **Duration:** 15 min
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added `.superRefine` to `TemplateSeedSchema`: same-kind uniqueness, submit schema presence, show fields subset of submit keys, list query_id/columns presence.
- `leave-request` seed now ships `submit` + `list` (query_id `qry_pending_leave`); `expense-report` and `it-helpdesk-ticket` ship a `show` form.
- Extended template and saved-query repository specs; deleted `provisioning/forms/leave-request.form.json`.

## Task Commits

1. **Task 1: Per-kind config validation + multi-form seed content** - `2c187c6b` (feat)
2. **Task 2: Remove stale provisioning/forms artifact; assert fail-closed lookup** - `d28a244e` (chore)

## Files Created/Modified

- `packages/domain/src/builder/template/template.seed.ts` - per-kind `.superRefine`
- `packages/domain/src/builder/template/seeds/leave-request.json` - added list form
- `packages/domain/src/builder/template/seeds/expense-report.json` - added show form
- `packages/domain/src/builder/template/seeds/it-helpdesk-ticket.json` - added show form
- `packages/domain/src/builder/template/template.spec.ts` - multi-form-aware assertions
- `packages/domain/src/builder/saved-query.repository.spec.ts` - fail-closed lookup case
- `provisioning/forms/leave-request.form.json` - deleted

## Decisions Made

- Kept seed loader free of cross-collection validation; unknown query_id fails closed at read time.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- Gallery now demonstrates a genuine multi-form app; later plans can fork and publish real multi-form templates.

---
*Phase: 07-multi-form-apps-per-form-triggers*
*Completed: 2026-10-18*

## Self-Check: PASSED
