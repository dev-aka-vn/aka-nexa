---
phase: 05-integration-async-execution
plan: 06
subsystem: cli
tags:
  - cli
  - dlq
  - rebind
  - connector-seed
dependency_graph:
  requires:
    - 05-01
    - 05-02
    - 05-04
  provides:
    - dlq-ops
    - connector-rebind
  affects: []
tech_stack:
  added: []
  patterns:
    - idempotent-upsert-by-ref
    - redacted-cli-output
key_files:
  created:
    - packages/cli/connector.ts
    - packages/cli/connector-seed.spec.ts
    - packages/cli/dlq.ts
    - packages/cli/dlq.integration.spec.ts
    - packages/cli/rebind.ts
    - packages/cli/rebind.integration.spec.ts
    - packages/cli/index.ts
    - config/connectors/redmine.dev.json
  modified:
    - packages/cli/provision.ts
    - packages/domain/src/registry/app.repository.ts
decisions:
  - decision: upsert-keyed-by-connector-ref
    rationale: Idempotent loader keyed by connector_ref; re-run with unchanged file is no-op
  - decision: dlq-redacted-by-default
    rationale: List output excludes payload/PII; --show-payload is opt-in and audited
  - decision: sent-unconfirmed-gated
    rationale: dlq retry requires --force for sent_unconfirmed (DAT-13 pre-check path enforced)
  - decision: audited-rebind
    rationale: connector_ref change writes exactly one AUD-01 before→after; unchanged produces no event
metrics:
  duration: 30m
  completed_date: 2026-10-10
  tasks: 3
  commits: 3
  plan_head_before: 478050f5ba1572141793f3d266a6c28b5a6c53d9
  plan_head_after: d253c3554189a8fd6f13b93fb4312f926e40f78a
  actuals:
    tokens: 0
    tasks: 3
    commits: 3
status: complete
---

# Phase 05 Plan 06: Integration & Async Execution — CLI DLQ + Rebind Summary

**One-liner:** Operator CLI gains redacted DLQ ops and audited connector-ref rebind with idempotent connector seeding.

## Completed Tasks

1. ✅ **Workspace CLI package + connector seed + idempotent upsert (D-83, D-31)** — connector seed loader with idempotent upsert keyed by connector_ref; seed validates; re-run no-op. CLI files: connector.ts, connector-seed.spec.ts, index.ts; seed: config/connectors/redmine.dev.json; provision.ts delegates to loader. Commit: 3db764e7
2. ✅ **DLQ list + retry CLI (CON-04, D-84/D-85)** — dlq list redacted-by-default, deterministic order; --show-payload audited; retry re-enqueues via same outbox path; sent_unconfirmed requires --force; empty DLQ exits cleanly. Files: dlq.ts, dlq.integration.spec.ts. Commit: 214d24a4
3. ✅ **Audited connector-ref rebind via idempotent reload (CON-08, D-86)** — on change writes exactly one AUD-01 before→after; unchanged emits no event; flows through idempotent seed loader. Files: rebind.ts, rebind.integration.spec.ts; app.repository.ts updated. Commit: d253c355

## Deviations from Plan

None - plan executed as written.

## Verifications

- ✅ Connector seed spec passes (2/2)
- ✅ DLQ integration spec passes (2/2) 
- ✅ Rebind integration spec passes (2/2)
- ✅ CLI compiles under tsconfig project references
- ✅ No direct mongodb imports or Worker construction in CLI code
- ✅ DLQ list redacted by default; sent_unconfirmed gated by --force

## Artifacts

**Created:**
- packages/cli/connector.ts — idempotent connector upsert loader
- packages/cli/connector-seed.spec.ts — seed validation + idempotence
- packages/cli/dlq.ts — redacted list + same-path retry
- packages/cli/dlq.integration.spec.ts — retry path tests
- packages/cli/rebind.ts — audited connector_ref rebind
- packages/cli/rebind.integration.spec.ts — audited rebind tests
- packages/cli/index.ts — CLI entry point
- config/connectors/redmine.dev.json — committed connector seed

**Modified:**
- packages/cli/provision.ts — delegates to connector loader
- packages/domain/src/registry/app.repository.ts — proper AppRepository implementation

## Notes

- DLQ retry uses queue.retryJob behavior (BullMQ v6); integration tests verify correct state transitions
- Pre-check path for sent_unconfirmed is structured (force required; DAT-13 pre-check hook present)
- Rebind uses AuditRepository append-only pattern with before→after states

## Self-Check: PASSED
- [x] All 3 tasks completed and committed
- [x] Connector seed loads idempotently by connector_ref
- [x] DLQ list redacted by default; --show-payload audited; retry uses same outbox path; sent_unconfirmed gated
- [x] Rebind writes exactly one AUD-01 before→after; unchanged is no-op
- [x] CLI compiles and specs pass
