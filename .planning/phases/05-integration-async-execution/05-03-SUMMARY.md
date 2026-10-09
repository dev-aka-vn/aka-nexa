---
phase: 05-integration-async-execution
plan: 03
subsystem: data-routing
tags: [data-router, outbox, transactions, mongodb]

# Dependency graph
requires:
  - phase: 05-01
    provides: ["data router skeleton and initial specs"]
provides:
  - "Three-mode routing (internal/external/hybrid) with fail-closed semantics"
  - "Atomic outbox commit with transaction guarantee (CON-10, DAT-04)"
  - "Partial outcome derivation based on revision outbound state (DAT-05)"
affects:
  - "Phase 06 - workers/relay will consume outbox rows"

# Actuals (#2632)
actuals:
  tokens: 45000
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Session-scoped transactions for atomic internal+outbox writes"
    - "Idempotent markPublished using revisionRef"
    - "Fail-closed mode validation with explicit failure status"

key-files:
  created:
    - "packages/domain/src/datarouter/outbox.integration.spec.ts"
  modified:
    - "packages/domain/src/datarouter/data-router.service.ts"
    - "packages/domain/src/datarouter/data-access/outbox.repository.ts"
    - "packages/domain/src/datarouter/data-router.spec.ts"
    - "packages/domain/src/submissions/data-access/submission-revisions.repository.ts"

key-decisions:
  - "Use explicit fail-closed behavior for unknown/absent modes returning failed_permanent"
  - "Treat empty external payloads as mapping failures (failed_permanent)"
  - "Require connectorRef for external/hybrid modes or fail permanently"

patterns-established:
  - "Repository methods accept ClientSession for transactional writes"
  - "Integration tests use Testcontainers with real MongoDB replica set"

requirements-completed:
  - DAT-01
  - DAT-04
  - DAT-05
  - CON-10

# Metrics
duration: 45m
completed: 2026-10-09
status: complete
---

# Phase 05 Integration & Async Execution - Plan 03 Summary

**Atomic transactional outbox with three-mode routing and proper partial state derivation.**

## Performance

- **Duration:** 45m
- **Started:** 2026-10-09
- **Completed:** 2026-10-09
- **Tasks:** 3 completed
- **Files modified/created:** 5 files

## Accomplishments

- **Data-mode routing finalized (DAT-01):** Implemented three distinct modes - `internal` (revision only, no outbox), `external` (outbox only, no internal record), and `hybrid` (both in single transaction). Added fail-closed semantics for unknown/absent modes.
- **Atomic outbox guarantee (CON-10, DAT-04):** Both revision and outbox writes commit together in one MongoDB session transaction. Integration test proves both-or-neither atomicity using real MongoDB replica set via Testcontainers.
- **Partial outcome derivation (DAT-05):** Established outbound state tracking on revisions (not_sent → sent_unconfirmed → confirmed) with append-only discipline. Derivation logic keeps `Submission.status` separate from revision outbound state.
- **Repository improvements:** Enhanced outbox repository with idempotent `markPublished(revisionRef)` and pollUnpublished filtering; integrated repository pattern into data router.

## Task Commits

Each task was committed atomically:

1. **Task 1: Data-mode routing + partial outcome (DAT-01, DAT-05)** - `b872225a` (feat)
2. **Task 2: Atomic outbox commit + poll/republish repo (CON-10, DAT-04)** - `f199a93c` (feat)
3. **Task 3: Data-router unit spec: modes, mapping, partial (DAT-01/DAT-03/DAT-05)** - `b44ea89f` (test)

## Files Created/Modified

- `packages/domain/src/datarouter/data-router.service.ts` - Finalized mode policy with fail-closed validation, empty payload guards, and connectorRef validation
- `packages/domain/src/datarouter/data-access/outbox.repository.ts` - Enhanced with idempotent markPublished by revisionRef
- `packages/domain/src/datarouter/data-router.spec.ts` - Extended with comprehensive mode tests and edge cases
- `packages/domain/src/submissions/data-access/submission-revisions.repository.ts` - Maintained outbound state setters following append-only discipline
- `packages/domain/src/datarouter/outbox.integration.spec.ts` - New integration test proving transaction atomicity with real MongoDB

## Decisions Made

- **Fail-closed on unknown modes:** Unknown/absent routing modes return `failed_permanent` without performing external sends
- **Empty payload rejection:** Empty external payloads in `external` or `hybrid` modes are treated as mapping failures (failed_permanent), not no-ops
- **ConnectorRef enforcement:** Missing connectorRef for external/hybrid modes causes immediate failure to prevent orphaned state
- **Separate status domains:** Revision outbound state (per-revision) is never written to `Submission.status`, maintaining clear separation of concerns

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- [x] Three modes behave distinctly and mode-unknown fails closed
- [x] Atomicity integration test green on real MongoDB replica set
- [x] `partial` derives from per-revision outbound state; `Submission.status` unoverloaded
- [x] Data router unit tests green (7 passed)
- [x] Outbox integration tests green (3 passed)
- [x] All data-router related tests green (10 passed)
