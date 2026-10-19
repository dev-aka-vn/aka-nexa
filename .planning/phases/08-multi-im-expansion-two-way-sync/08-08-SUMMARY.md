---
phase: 08-multi-im-expansion-two-way-sync
plan: 08
status: complete
subsystem: webhooks/notifications
tags: [NOT-03, NOT-04, NOT-05, notification-processor, teams-delivery, connector-trust]
requires:
  - 08-06
  - 08-07
  - 08-09
provides:
  - NotificationProcessor
  - TeamsDeliveryService
  - ConnectorTrustRepository
  - ConnectorTrustController
affects:
  - apps/worker/src/processors
  - apps/worker/src/adapters/teams
  - apps/api/src/webhooks/external
  - packages/domain/src/connectors
tech-stack:
  added: []
  patterns: [worker-host-consumer, equal-jitter-backoff, per-connector-trust-record, fail-closed-gate]
key-files:
  created:
    - apps/worker/src/processors/notification.processor.ts
    - apps/worker/src/adapters/teams/teams-delivery.service.ts
    - packages/domain/src/connectors/data-access/connector-trust.repository.ts
    - apps/api/src/webhooks/external/connector-trust.controller.ts
    - apps/worker/src/processors/notification.processor.spec.ts
    - apps/api/src/webhooks/external/connector-trust.integration.spec.ts
  modified:
    - apps/worker/src/app.module.ts
    - apps/api/src/webhooks/external/external-webhook.service.ts
    - apps/api/src/webhooks/external/external-webhook.module.ts
    - apps/api/src/webhooks/external/external-webhook.controller.ts
    - packages/domain/src/connectors/connectors.module.ts
    - packages/domain/src/index.ts
  deleted:
    - apps/api/src/webhooks/external/external-webhook.consumer.ts
decisions:
  - "Notification delivery runs in the worker process via a WorkerHost @Processor; no raw Worker binding added (entrypoint-drift unchanged)."
  - "Equal-jitter exponential backoff registered as the notification-jitter BackoffStrategy (D-13)."
  - "Per-connector trust records are admin-guarded, audit-logged, and the receiver fails closed on alternatives."
metrics:
  duration: ~90m
  completed: 2026-10-19
  tasks: 3
  files: 12
actuals:
  tokens: 120000
  tasks: 3
  commits: 3
---

# Phase 08 Plan 08: Notification Delivery and Connector Trust Summary

**Closed the notification loop: a real worker-side consumer assembles and delivers status messages to Teams, retries with jittered backoff, audits terminal failures with a user-visible notice, and records per-connector alternative trust mechanisms.**

## Performance

- **Duration:** ~90 min
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments

- Added `NotificationProcessor` (`@Processor(NOTIFICATION_SEND_QUEUE)`) WorkerHost calling `NotificationAssemblerService.assemble` and `TeamsDeliveryService`, registered in `WORKER_CONSUMERS`.
- Added `TeamsDeliveryService` built on the Microsoft 365 Agents SDK with retryable/non-retryable classification.
- Registered the `notification-jitter` equal-jitter exponential BackoffStrategy (D-13).
- Terminal failures audit `notification.delivery_failed` and attempt a user-visible failure notice (SC#5).
- Removed the orphaned api-side consumer and placeholder `processNotification`.
- Added `ConnectorTrustRepository`, admin-guarded/audit-logged controller, and a receiver gate that fails closed on alternative mechanisms (NOT-05).

## Task Commits

1. `28ea6009` — feat(08-08): notification processor and Teams delivery (NOT-03, NOT-04)
2. `12a393a9` — test(08-08): notification processor terminal-failure cases (NOT-04)
3. `81a055a0` — feat(08-08): per-connector trust mechanism records (NOT-05)

## Verification

- `npm run build` exits 0.
- `npx vitest run apps/worker/src/processors/notification.processor.spec.ts` — 3 passed.
- `npx vitest run apps/api/src/webhooks/external` — 9 passed.
- `npx vitest run tooling/entrypoint-drift.spec.ts -t "worker closure is the only one that binds Worker"` — passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Skipped Mongo index creation on read path**
- **Found during:** Task 3
- **Issue:** `ConnectorTrustRepository.get` triggered Mongo connection in the existing replay spec environment (localhost, no Mongo), breaking the suite.
- **Fix:** `get` no longer calls `ensureIndex`; index creation remains on write/list paths.
- **Files modified:** `packages/domain/src/connectors/data-access/connector-trust.repository.ts`

## Self-Check: PASSED

- All created files exist.
- All three commits present in `git log`.
- Build exits 0.

## Threat Flags

None.

## Known Stubs

None.