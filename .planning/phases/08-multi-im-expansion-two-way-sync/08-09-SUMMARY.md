---
phase: 08-multi-im-expansion-two-way-sync
plan: 09
subsystem: api
tags: [bullmq, queue-names, boundary-manifest, d-37, raw-body, jitter, gap-closure]

requires:
  - phase: 08-multi-im-expansion-two-way-sync
    plan: 05
    provides: repo-wide green build gate on top of which this wiring lands
provides:
  - "Shared queue-name vocabulary: INBOUND_EVENTS_QUEUE ('inbound-events') and NOTIFICATION_SEND_QUEUE ('notification-send')"
  - "ApiQueueModule: producer-only BullMQ registration for the two inbound/notification queues under queueRootOptions"
  - "D-37 named exception list on BoundaryManifest, honoured by ProviderBoundaryGuard"
  - "rawBody: true at Nest bootstrap for @RawBody() consumers"
  - "D-13 jittered notification enqueue options (attempts: 3, backoff: notification-jitter, delay 1000)"
affects: [08-06, 08-07, 08-08, verify-work]

actuals:
  tokens: 5596
  tasks: 2
  commits: 1
  plan_head_before: 4265fddfc4f4fd7836ea94be0780c331485a05b4
  plan_head_after: 53b288c3fd32a63dc62f91fc4b240a71176efd38

tech-stack:
  added: []
  patterns:
    - "Producer-only BullMQ module with build-once registerQueue consts (imports == exports)"
    - "Named, reviewed boundary exceptions via BoundaryManifest.allowed"

key-files:
  created:
    - apps/api/src/queue/api-queue.module.ts
    - apps/api/src/queue/api-queue.module.spec.ts
    - apps/api/src/bootstrap/boundary-manifest.spec.ts
  modified:
    - packages/platform/src/queue/queue.constants.ts
    - packages/platform/src/bootstrap/boundary-manifest.ts
    - packages/platform/src/bootstrap/provider-boundary.guard.ts
    - packages/platform/src/bootstrap/provider-boundary.guard.spec.ts
    - apps/api/src/bootstrap/boundary-manifest.ts
    - apps/api/src/adapters/teams/teams.controller.ts
    - apps/api/src/adapters/teams/teams.module.ts
    - apps/api/src/webhooks/external/external-webhook.service.ts
    - apps/api/src/webhooks/external/external-webhook.module.ts
    - apps/api/src/main.ts
    - apps/worker/src/processors/inbound-event.processor.ts

key-decisions:
  - "NOTIFICATION_SEND_QUEUE uses a hyphen ('notification-send') rather than the plan's colon, because BullMQ rejects queue names containing ':' (Rule 3 blocking fix)."
  - "The three D-37 exceptions are the inbound producer token, the notification producer token, and INBOUND_ADAPTER_REGISTRATIONS; the heartbeat producer token stays forbidden."

requirements-completed: [IM-10, NOT-01, NOT-04]

status: complete
duration: 45min
completed: 2026-10-19
---

# Phase 08 Plan 09: Queue/Boundary/Raw-Body Topology Summary

**One shared queue-name vocabulary, a bootable api producer registration under D-37's named exception list, D-13 jittered notification retry options, and raw-body capture at Nest bootstrap.**

## Performance

- **Duration:** 45 min
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments
- `INBOUND_EVENTS_QUEUE` and `NOTIFICATION_SEND_QUEUE` exported from `packages/platform/src/queue/queue.constants.ts`; worker's `@Processor` now references the constant.
- `ApiQueueModule` registers both producer queues with `queueRootOptions` and is imported by `TeamsModule` and `ExternalWebhookModule` only.
- `BoundaryManifest.allowed` added; `ProviderBoundaryGuard` skips forbidden tokens also listed in `allowed`; api manifest declares exactly the three D-37 exceptions while `QUEUE_PRODUCER_TOKEN` stays forbidden.
- `NestFactory.create(AppModule, { rawBody: true })` enables `@RawBody()` for both HMAC paths.
- Teams controller uses the activity id as `event_id` (D-07 dedupe key), no BullMQ `jobId`.
- Notification enqueue uses `attempts: 3` with `backoff: { type: 'notification-jitter', delay: 1000 }`.

## Task Commits

1. **Task 1 + Task 2** - `53b288c3` (feat)

## Files Created/Modified
- See key-files above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] BullMQ rejects queue names containing ':'**
- **Found during:** Task 1 (api-queue module spec boot)
- **Issue:** The plan specified `NOTIFICATION_SEND_QUEUE = 'notification:send'`, but BullMQ throws `Queue name cannot contain :` at construction, so neither the api producer nor the worker consumer could boot.
- **Fix:** Changed the constant to `'notification-send'` (hyphen), consistent with `inbound-events` and `platform-heartbeat`. Job name now follows the same constant.
- **Files modified:** `packages/platform/src/queue/queue.constants.ts` (and transitively the service/controller that use the constant).
- **Verification:** `apps/api/src/queue/api-queue.module.spec.ts` boots both queues against real Redis and asserts names; `npm run build` exits 0.
- **Committed in:** 53b288c3

**2. [Pre-existing, out of scope] entrypoint-drift orphan-file failure**
- **Found during:** verification
- **Issue:** `tooling/entrypoint-drift.spec.ts` reports 5 api source files not reachable from `main.ts` (`slack-commands.controller.ts`, `slack-webhook.controller.ts`, `slack.module.ts`, `link-error.filter.ts`, `permission.guard.ts`). Confirmed pre-existing on the 4265fddf baseline (identical failure before any 08-09 change); unrelated to this plan and outside `files_modified`.
- **Fix:** None applied (scope boundary).
- **Verification:** Baseline reproduction documented above.

**Total deviations:** 1 auto-fixed (blocking), 1 pre-existing out-of-scope observation
**Impact on plan:** The auto-fix was required for the producer to boot at all; no scope creep.

## Issues Encountered
- None beyond the blocking queue-name issue above.

## Verification
- `npm run build` (eslint . && tsc -b) exits 0.
- `npx vitest run apps/api/src/queue/api-queue.module.spec.ts` — 3 tests passed.
- `npx vitest run apps/api/src/bootstrap/boundary-manifest.spec.ts packages/platform/src/bootstrap/provider-boundary.guard.spec.ts` — 14 tests passed.
- `npx vitest run apps/api/src/submissions/submissions.integration.spec.ts` — 9 tests passed (api boot graph regression check).

## Next Phase Readiness
- 08-06/07/08 can build receivers, HMAC/assembler, and delivery on top of these constants and the producer module.
- The D-37 exception list is in place; the heartbeat producer token remains forbidden in api.

---
*Phase: 08-multi-im-expansion-two-way-sync*
*Completed: 2026-10-19*
