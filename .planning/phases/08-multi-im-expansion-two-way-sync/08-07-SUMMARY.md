---
phase: 08-multi-im-expansion-two-way-sync
plan: 07
status: complete
subsystem: webhooks/notifications
tags: [NOT-01, NOT-02, NOT-03, hmac, replay-protection, notification-assembler]
requires:
  - 08-06
  - 08-09
provides:
  - WebhookHmacService
  - external-webhook replay integration spec
  - SubmissionRevisionsRepository.findByDownstreamReference
  - NotificationAssemblerService
affects:
  - apps/api/src/webhooks/external
  - packages/domain/src/notifications
  - packages/domain/src/submissions
tech-stack:
  added: []
  patterns: [timing-safe-hmac, redis-nonce-replay, compound-connector-scoped-lookup, user-bound-notification-link]
key-files:
  created:
    - apps/api/src/webhooks/external/webhook-hmac.service.ts
    - apps/api/src/webhooks/external/external-webhook.replay.integration.spec.ts
    - packages/domain/src/notifications/notification-assembler.service.ts
    - packages/domain/src/notifications/notifications.module.ts
    - packages/domain/src/notifications/notification-assembler.service.spec.ts
  modified:
    - apps/api/src/webhooks/external/external-webhook.controller.ts
    - apps/api/src/webhooks/external/external-webhook.module.ts
    - apps/api/src/webhooks/external/nonce-store.service.ts
    - packages/domain/src/submissions/data-access/submission-revisions.repository.ts
    - packages/domain/src/identity/identity-mapping.repository.ts
    - packages/domain/src/index.ts
    - tooling/boundaries.config.mjs
decisions:
  - "HMAC verification runs after the replay gate, keeping forged timestamps from forcing a secret lookup."
  - "Rejection logs use structured fields (reason, connectorId) and never contain the secret."
  - "Entity-reference lookup is scoped by the compound {connectorId, downstreamReference} pair (D-10)."
  - "notifications domain element may depend on submissions, identity, links, and dsl."
metrics:
  duration: ~60m
  completed: 2026-10-19
  tasks: 3
  files: 12
actuals:
  tokens: 90000
  tasks: 3
  commits: 3
  plan_head_before: e3ab25291e2094499493e3c871c72d756852c897
  plan_head_after: 84b14153a847e2615766e3caa72a254e4fa5e234
---

# Phase 08 Plan 07: Multi-IM Expansion — HMAC, Replay, Notification Assembly Summary

**Timing-safe per-connector HMAC over the raw body, Redis-backed replay rejection with structured logging, and the entity-reference to user-bound status message assembler.**

## Performance

- **Duration:** ~60 min
- **Started:** 2026-10-19
- **Completed:** 2026-10-19
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments

- Replaced the format-only signature check with cryptographic HMAC-SHA256 verification over the raw request body using `crypto.timingSafeEqual`, with a generic 401 on every rejection.
- Proved NOT-02 against real Redis: stale timestamp, reused nonce, missing headers, mutated body all reject with 401 and structured logs; the happy path enqueues exactly one minimal job carrying only `connectorId`, `body`, and `receivedAt`.
- Added `SubmissionRevisionsRepository.findByDownstreamReference(connectorId, reference)` on the compound `{connectorId, downstreamReference}` pair with a compound index.
- Built `NotificationAssemblerService` resolving an external entity reference to the original submitter and a schema-valid `OutboundMessage` with action `status` and a user-bound notification link.

## Task Commits

1. `c0133da8` — feat(08-07): timing-safe per-connector HMAC verification over raw body (NOT-01)
2. `ae037634` — test(08-07): replay rejection proven against real Redis with structured logs (NOT-02)
3. `84b14153` — feat(08-07): entity-reference to user-bound status message assembler (NOT-03)

## Files Created/Modified

See `key-files` above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Wired redisCacheProvider into ExternalWebhookModule**
- **Found during:** Task 2 integration spec
- **Issue:** `NonceStoreService` could not resolve `REDIS_CACHE` when the module was imported in isolation.
- **Fix:** Added `redisCacheProvider` to the module's providers.
- **Files modified:** `apps/api/src/webhooks/external/external-webhook.module.ts`

**2. [Rule 3 - Blocking] Extended boundary policy for notifications**
- **Found during:** Task 3 build
- **Issue:** `notifications` element was only allowed to depend on platform/kernel/contract, but the assembler traverses submissions, identity, links, and dsl.
- **Fix:** Added those dependencies to the notifications policy in `tooling/boundaries.config.mjs`.
- **Files modified:** `tooling/boundaries.config.mjs`

**3. [Rule 2 - Missing critical] Added optional `channel_id` to `IdentityMapping`**
- **Found during:** Task 3
- **Issue:** The assembler needs a channel id for the outbound message, but `IdentityMapping` only carried `chat_user_id`.
- **Fix:** Added an optional `channel_id` field, falling back to `chat_user_id` when absent.
- **Files modified:** `packages/domain/src/identity/identity-mapping.repository.ts`

## Verification

- `npm run build` exits 0 (tail below).
- Integration spec: 6/6 passing.
- Domain specs: 12/12 passing.
- Submissions integration spec: 9/9 passing.

## Self-Check: PASSED

- All created files exist.
- All three commits present in `git log`.
- Build exits 0.

## Threat Flags

None.

## Known Stubs

None. (The old placeholder `processNotification` logic in `external-webhook.service.ts` is intentionally left for deletion by 08-08.)