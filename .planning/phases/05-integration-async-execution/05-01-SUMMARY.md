---
phase: 05-integration-async-execution
plan: 01
subsystem: connectors,datadomain,worker
tags: [bullmq, mongodb, transaction, outbox, relay, connectors]
key_files:
  - tooling/boundaries.config.mjs
  - packages/contract/src/connector/connector.ts
  - packages/domain/src/connectors/rest-core.ts
  - packages/domain/src/connectors/redmine.adapter.ts
  - packages/domain/src/connectors/connector.registry.ts
  - packages/domain/src/connectors/connectors.module.ts
  - packages/domain/src/connectors/data-access/connector-credentials.repository.ts
  - packages/domain/src/datarouter/data-router.service.ts
  - packages/domain/src/datarouter/data-access/outbox.repository.ts
  - packages/domain/src/submissions/data-access/submission-revisions.repository.ts
  - apps/worker/src/processors/outbox-relay.processor.ts
  - apps/worker/src/processors/connector-delivery.processor.ts
status: complete
depends_on: []
provides:
  - 05-02
  - 05-03
  - 05-04
affects: []
patterns:
  - transactional outbox with Mongo session
  - pre-call commit ordering for delivery
  - registry + credentials with envelope encryption
metrics:
  duration_minutes: 0
  completed: 2026-10-09T12:43:00Z
  tasks: 3
  files_created: 12
  files_modified: 2
  commits: 3
  estimate_tokens: 48000
  actual_tokens: 0
plan_head_before: 8788e6e0169ae4219b54a24b0ae947611af47852
plan_head_after: c402b872e655fbbff7a0aa6ce92b38490c5df872
commits: 3
---

# Phase 05-integration-async-execution Plan 01: Connector seam, transactional outbox, relay & delivery

**One-liner:** Hybrid submission flows end-to-end with transactional outbox, relay, and delivery consumer with pre-call commit ordering.

**Started:** 2026-10-09T12:30:00Z
**Completed:** 2026-10-09T12:43:00Z
**Tasks:** 3/3 completed
**Files modified:** 14 files (12 created, 2 modified)

## Accomplishments
- Evolved Connector seam to new shape (testConnection/getCapabilities/execute with operation/payload/context) with boundary config update
- Established transactional outbox + data-mode routing (internal/external/hybrid) with atomic revision+outbox commit
- Implemented relay and delivery consumers with pre-call sent_unconfirmed commit before transport call, confirmed on success

## Task Commits

Each task was committed atomically:

1. **Task 1: Tracer: evolve Connector seam, boundary edge, credential store, and one live execute path** - `a583a5a9` (feat)
2. **Task 2: Transactional outbox + data-mode routing (CON-10, DAT-01, DAT-04)** - `364ab39e` (feat)
3. **Task 3: Relay + delivery consumer: pre-call commit and confirmed advance (DAT-06)** - `c402b872` (feat)

## Files Created/Modified
- **Modified:** `tooling/boundaries.config.mjs` - Add 'contract' to connectors allowed edges
- **Modified:** `packages/contract/src/connector/connector.ts` - Evolve Connector interface per D-89
- **Created:** `packages/domain/src/connectors/rest-core.ts` - Generic HTTP transport with taxonomy mapping
- **Created:** `packages/domain/src/connectors/redmine.adapter.ts` - Redmine adapter tracer implementation
- **Created:** `packages/domain/src/connectors/connector.registry.ts` - Fail-closed registry
- **Created:** `packages/domain/src/connectors/connectors.module.ts` - DI wiring
- **Created:** `packages/domain/src/connectors/data-access/connector-credentials.repository.ts` - AES-256-GCM envelope store
- **Created:** `packages/domain/src/connectors/connector-tracer.spec.ts` - Tracer slice tests
- **Created:** `packages/domain/src/datarouter/data-router.service.ts` - Mode-based routing with transaction
- **Created:** `packages/domain/src/datarouter/datarouter.module.ts` - DI module
- **Created:** `packages/domain/src/datarouter/data-access/outbox.repository.ts` - Outbox repository
- **Created:** `packages/domain/src/submissions/data-access/submission-revisions.repository.ts` - Append-only revisions
- **Created:** `packages/domain/src/datarouter/data-router.spec.ts` - Data router mode tests
- **Created:** `apps/worker/src/processors/outbox-relay.processor.ts` - Relay processor
- **Created:** `apps/worker/src/processors/connector-delivery.processor.ts` - Delivery processor with pre-call commit
- **Created:** `apps/worker/src/processors/connector-delivery.spec.ts` - Delivery ordering tests
- **Modified:** `apps/worker/src/app.module.ts` - Wire relay and delivery processors

## Decisions Made
None - followed plan as specified

## Deviations from Plan
None - plan executed exactly as written

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Phase skeleton (boundary, seam, credential store, transaction, relay, delivery) is in place for expansion plans 05-02 through 05-09. All tracer tests pass. Pre-call commit ordering is verified. Transactional atomicity structure established.

---
*Phase: 05-integration-async-execution*
*Plan: 05-01*
*Completed: 2026-10-09T12:43:00Z*
