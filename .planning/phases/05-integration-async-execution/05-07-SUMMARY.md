---
phase: 05-integration-async-execution
plan: 07
subsystem: api
tags: [status-projection, query, read-links]

# Dependency graph
requires:
  - phase: 05-integration-async-execution-05-01
    provides: connector and domain foundations
  - phase: 05-integration-async-execution-05-03
    provides: outbox/revisions persistence
provides:
  - "Per-app 'My submissions' status surface via frozen query read-link action (DAT-14)"
  - "Status projection deriving rows from latest revision (confirmed/partial/failed)"
  - "findLatest lookup on submission_revisions"
affects: []

# Actuals (#2632)
actuals:
  tokens: 3746
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Project rows from submission + latest revision to emit status view"
    - "User-safe failure reason mapping via closed taxonomy map"

key-files:
  created:
    - apps/api/src/read/status-projection.ts
    - apps/api/src/read/status-projection.spec.ts
    - apps/api/src/read/status-surface.integration.spec.ts
  modified:
    - packages/domain/src/submissions/data-access/submission-revisions.repository.ts
    - packages/domain/src/index.ts
    - apps/api/src/read/read.controller.ts
    - apps/api/src/read/read.module.ts

key-decisions:
  - "Extend query action in place (no new route/action/claim) returning projected rows"
  - "Partial status derived from not_sent/sent_unconfirmed latest revision with retrying destination"
  - "Failed status uses taxonomy code mapped to user-safe reason string"

patterns-established: []

requirements-completed:
  - DAT-14

duration: 105m
completed: 2026-10-10
status: complete
---

# Phase 05 Integration & Async Execution: Plan 07 Summary

**Per-app 'My submissions' status surface reachable via the frozen query read-link action, projecting status from each submission's latest revision.**

## Performance

- **Duration:** 105m
- **Tasks completed:** 2/2 (auto, TDD)
- **Commits:** 2
- **Files changed:** 7 (3 created, 4 modified)

## Accomplishments

### Task 1: Status projection + latest-revision lookup (DAT-14, D-80/D-81/D-82)
- Added `findLatest(submissionId)` to `SubmissionRevisionsRepository` returning highest revision (append-only read)
- Re-exported revisions repository and types (`OutboundState`, `SubmissionRevisionDocument`) from domain index
- Implemented `status-projection.ts` to derive status rows from submission + latest revision:
  - `confirmed` → completed with downstream reference
  - `not_sent`/`sent_unconfirmed` → partial (read-only) with "Internal saved · {Connector}: retrying"
  - failed → user-safe reason mapped from taxonomy code (never raw body/PII/credentials)
- Added unit tests covering confirmed/partial/failed mappings and non-allowlisted field leakage
- All projection tests pass (5/5)

### Task 2: Status surface via frozen query action (DAT-14, D-80)
- Extended `read.controller.ts` query path in place (no new route/action/claim): after `queryWithDsl` returns, project each row via status-projection resolving latest revision per row
- Injected `SubmissionRevisionsRepository` in controller and read module
- Added `status-surface.integration.spec.ts` verifying "my submissions" returns only caller's own rows with projected partial status including retrying destination
- Integration test passes; frozen `read-link-claims.frozen.spec.ts` (11/11) remains green

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- [x] All artifacts created as specified
- [x] findLatest implemented and re-exported
- [x] Query endpoint extended in place without new claims/actions
- [x] Tests pass (status-projection unit + status-surface integration + frozen claims)
- [x] No non-allowlisted fields leak in projection
- [x] Each task committed individually (2 commits)
- [x] SUMMARY.md created in plan directory
