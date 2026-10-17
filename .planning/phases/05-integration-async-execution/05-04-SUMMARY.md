---
phase: 05-integration-async-execution
plan: 04
subsystem: integration-async-execution
tags:
  - connector-delivery
  - reconciliation
  - bullmq
  - retry
  - backoff
  - dlq
  - not-sent-only

# Dependency graph
requires:
  - phase: 05-01
    provides:
      - "connector delivery processor skeleton and initial specs"
provides:
  - "Exponential backoff retry with DLQ (max 5 attempts) on connector delivery"
  - "Per-revision idempotency guard for re-deliveries"
  - "Reconciliation sweep that retries only not_sent revisions"
  - "Idempotent Job Scheduler registration for reconciliation"
affects:
  - "Phase 06 - workers consume via same outbox/delivery path"
  - "DLQ/ops surfaces see retained failed jobs"

# Actuals (#2632)
actuals:
  tokens: 44000
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "BullMQ job options: attempts=5, backoff exponential (delay 2000), removeOnFail=false"
    - "Job Scheduler via upsertJobScheduler with awaited resume()"
    - "Reconciliation re-drives via marking outbox entries unpublished (same path as relay)"
    - "Idempotency guard distinguishes redeliveries from BullMQ retries"

key-files:
  created:
    - "apps/scheduler/src/reconciliation.registration.ts"
    - "apps/worker/src/processors/reconciliation.integration.spec.ts"
    - "apps/worker/src/processors/connector-delivery.integration.spec.ts"
    - "tooling/redmine-stub.ts"
  modified:
    - "apps/worker/src/processors/connector-delivery.processor.ts"
    - "apps/worker/src/processors/reconciliation.processor.ts"
    - "apps/scheduler/src/app.module.ts"
    - "apps/worker/src/app.module.ts"

key-decisions:
  - "Treat 'sent_unconfirmed' on fresh redelivery as idempotent short-circuit; allow retry on BullMQ retry attempts"
  - "Reconciliation marks outbox entries unpublished (not_sent only) so relay repicks them"
  - "Job Scheduler registered idempotently in scheduler app with both heartbeat and reconciliation"

patterns-established:
  - "Reconciliation consumer registered in worker via WORKER_CONSUMERS"
  - "Integration tests use Testcontainers with real Redis/Mongo for queue semantics"

requirements-completed:
  - DAT-06
  - DAT-07
  - CON-03

# Metrics
duration: 60m
completed: 2026-10-09
status: complete
commits: 3
plan_head_before: b44ea89f2528b7df393af031000e23187ba79d45
plan_head_after: 478050f5701b89866449a608c58cfe3df6a8e251
---
# Phase 05 Integration & Async Execution - Plan 04 Summary

**Hardened connector delivery retry/backoff/DLQ and added not_sent-only reconciliation sweep via BullMQ Job Scheduler.**

## Performance

- **Duration:** 60m
- **Started:** 2026-10-09
- **Completed:** 2026-10-09
- **Tasks:** 3 completed
- **Files modified/created:** 8 files
- **Commits:** 3

## Accomplishments

- **Backoff/DLQ budget + per-revision idempotency (CON-03, DAT-06):** Connector delivery uses queue job options with attempts=5, exponential backoff (delay 2000ms), removeOnFail=false. Processor treats confirmed as terminal, retries on sent_unconfirmed only for actual BullMQ retry attempts (preserves idempotency for redeliveries), and throws for failed_transient to trigger retries. Unit tests confirm per-revision idempotency and credential_rejected behavior.
- **Reconciliation sweep not_sent only (DAT-07):** Reconciliation processor queries for outbound='not_sent' only and marks corresponding outbox entries as unpublished so the outbox relay re-drives them through the same path. Explicitly never auto-resends sent_unconfirmed. Integration test verifies not_sent-only behavior.
- **Idempotent Job Scheduler registration:** Created reconciliation.registration.ts mirroring platform heartbeat pattern using registerJobScheduler (upsertJobScheduler) with awaited resume(). Wired registration in scheduler app onApplicationBootstrap and added to JOB_SCHEDULER_REGISTRATIONS. Registered reconciliation consumer in worker's WORKER_CONSUMERS.
- **Integration tests:** Added connector-delivery integration tests for pre-call commit ordering and backoff DLQ path with real Redis/Mongo via Testcontainers. Added reconciliation integration test. Created tooling/redmine-stub.ts connector double for testing.

## Task Commits

1. **Task 1 - Backoff/DLQ budget + per-revision idempotency (CON-03, DAT-06):** `5422bdd3` (feat)
2. **Task 2 - Reconciliation sweep not_sent only (DAT-07):** `0797fe03` (feat)  
3. **Task 3 - Delivery integration tests (DAT-06, DAT-07, CON-03):** `478050f5` (test)

## Files Created/Modified

**Created:**
- `apps/scheduler/src/reconciliation.registration.ts` - Reconciliation Job Scheduler registration (upsertJobScheduler, awaited resume)
- `apps/worker/src/processors/reconciliation.integration.spec.ts` - DAT-07 not_sent-only integration test
- `apps/worker/src/processors/connector-delivery.integration.spec.ts` - Pre-call commit + backoff DLQ integration tests
- `tooling/redmine-stub.ts` - Test connector stub

**Modified:**
- `apps/worker/src/processors/connector-delivery.processor.ts` - Retry logic with proper idempotency handling for retries vs redeliveries
- `apps/worker/src/processors/reconciliation.processor.ts` - Implemented not_sent-only sweep marking outbox entries unpublished
- `apps/scheduler/src/app.module.ts` - Wire reconciliation registration in bootstrap and JOB_SCHEDULER_REGISTRATIONS
- `apps/worker/src/app.module.ts` - Register reconciliation consumer in WORKER_CONSUMERS

## Decisions Made

- **Retry semantics:** Allow transport retry on sent_unconfirmed only when job.attemptsMade > 0 (BullMQ retry); short-circuit on sent_unconfirmed for fresh redeliveries to preserve idempotency. Short-circuit immediately on confirmed.
- **Reconciliation mechanism:** Mark outbox entries as unpublished (rather than directly re-enqueuing) so the outbox relay re-drives them through the same path as automatic retry, maintaining single delivery path.
- **Scheduler registration:** Use upsertJobScheduler with await resume() per BullMQ 6 API; register both platform-heartbeat and reconciliation in scheduler.

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- [x] Retry options exactly base-2s/exponential/5 attempts with retained failed set (unit tests + integration test)
- [x] Reconciliation selects only not_sent (integration test passes)
- [x] sent_unconfirmed never auto-resent (integration asserted)
- [x] Re-delivery idempotent (unit tests pass)
- [x] Job Scheduler registered idempotently (BullMQ 6) with awaited resume()
- [x] All related tests pass:
  - [x] `apps/worker/src/processors/connector-delivery.spec.ts` - per-revision idempotency tests pass
  - [x] `apps/worker/src/processors/reconciliation.integration.spec.ts` - not_sent only test passes
  - [x] `apps/worker/src/processors/connector-delivery.integration.spec.ts` - pre-call commit and backoff dlq tests pass
- [x] Worker and scheduler modules properly wired with reconciliation

## Threat Mitigations

All STRIDE mitigations from the plan were satisfied:
- T-05-14 (Tampering - reconciliation sweep): Predicate is not_sent only; sent_unconfirmed explicitly excluded; integration test asserts exclusion.
- T-05-15 (Repudiation): sent_unconfirmed committed before call; idempotency guard; removeOnFail:false retains failed set.
- T-05-16 (DoS - retry budget): Transient failures retry with backoff; credential/permanent failures are terminal.
- T-05-17 (Tampering - scheduler registration): Idempotent upsertJobScheduler with awaited resume().

## Self-Check

- [x] All tasks executed and committed
- [x] Each task committed individually with proper format
- [x] SUMMARY.md created with substantive content
- [x] All files created/modified as specified
- [x] Tests pass as specified in plan verification
- [x] Integration tests prove key behaviors (pre-call commit ordering, backoff DLQ, not_sent-only sweep)
- [x] Retry budget and idempotency correctly implemented
- [x] Reconciliation wired in both scheduler and worker apps
- [x] Job Scheduler registration follows BullMQ 6 API correctly

**Self-Check: PASSED**