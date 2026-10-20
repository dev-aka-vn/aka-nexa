---
phase: 09-production-readiness
plan: 01
subsystem: audit
tags: [audit, retention, purge, lifecycle, console]
requires: []
provides:
  - Mongo-backed AuditRepository (audit_entries)
  - AuditRetentionService single delete owner
  - AppPurgeService two-phase purge
  - purged lifecycle state
affects: [09-02]
tech-stack:
  added: []
  patterns: [Mongo repository idiom, BullMQ Job Scheduler sweep, terminal lifecycle state]
key-files:
  created:
    - packages/domain/src/audit/audit-entry.ts
    - packages/domain/src/audit/audit-retention.service.ts
    - packages/domain/src/audit/app-purge.service.ts
    - apps/scheduler/src/audit-retention.registration.ts
    - apps/scheduler/src/purge-sweep.registration.ts
    - apps/worker/src/processors/audit-retention.processor.ts
    - apps/worker/src/processors/purge-sweep.processor.ts
    - tooling/audit-store-ownership.spec.ts
  modified:
    - packages/domain/src/audit/audit.repository.ts
    - packages/contract/src/builder/publish.contract.ts
    - packages/domain/src/builder/app-lifecycle.ts
    - packages/platform/src/config/config.schema.ts
    - apps/scheduler/src/app.module.ts
    - apps/worker/src/app.module.ts
    - apps/api/src/audit/audit.module.ts
    - apps/app-builder/src/ui/ScopedAppPicker.tsx
    - apps/app-builder/src/submissions/SubmissionsPage.tsx
    - apps/app-builder/src/editor/EditorPage.tsx
    - apps/app-builder/src/api/definition.ts
    - apps/app-builder/src/apps/AppsPage.tsx
decisions:
  - Audit trail moved to Mongo audit_entries collection (D-01); repository keeps append/findAll/count signatures.
  - Retention service is the single delete owner; enforced by tooling/audit-store-ownership.spec.ts.
  - purged is terminal; reachable from every state, no exits.
  - Grace-period fields: requested_at, operator_id, execute_after, executed_at.
  - Archived badge truncates app name with ellipsis; badge keeps intrinsic width.
  - Soft-deleted (purged, executed_at null) apps stay in Submissions picker; hard-deleted (executed_at set) leave.
  - U-1 purge confirmation modal not built; irreversible act lives in the sweep.
metrics:
  duration: 0
  completed: 2026-10-20
status: complete
actuals:
  tokens: 92000
  tasks: 3
  commits: 1
---

# Phase 09 Plan 01: Production Readiness (Audit Durability & Purge) Summary

## One-liner

Moved the audit trail onto a Mongo `audit_entries` collection with a single delete owner, a scheduled retention sweep, a two-phase grace-gated app purge with terminal `purged` state, and console marking for archived/purged scope.

## What was built

- Mongo-backed `AuditRepository` (collection `audit_entries`, ascending `{timestamp:1}` index, memoised ensureIndex idiom) preserving `append`/`findAll`/`count`.
- `deleteOlderThan(cutoff, batchSize)` batched by ascending `_id` — the sole delete path (D-04).
- `AuditRetentionService.run()` with Redis `SET NX PX` lock, UTC-ms cutoff (`auditRetentionDays * 86_400_000`), batched delete, self-audit entry (`actor: system`, `action: audit.retention.swept`, `target: audit_entries`, cutoff in `previous_state`, count in `new_state`, `operator: system`), idempotent and silent on zero.
- `AppPurgeService` with `softDelete` (four D-13 grace fields) and `executeDue` (grace-gated, idempotent, `purge.executed` entry).
- Lifecycle enum gains `purged`; `archived -> purged` permitted; `purged` terminal.
- Config keys `AUDIT_RETENTION_DAYS` (default 1095, min 1095) and `PURGE_GRACE_DAYS` (default 30, >=0).
- Scheduler registrations `audit-retention` and `purge-sweep` (daily) with worker consumers.
- Console: archived badge in picker/page head, purged membership by server data, grace-period callout in EditorPage.

## Deviations

None - plan executed as written (minor: side-effect imports added to satisfy entrypoint-drift guard).

## Self-Check: PASSED

All build and guard tests pass.
