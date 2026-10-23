---
phase: 08-multi-im-expansion-two-way-sync
plan: 06
subsystem: api
tags: [teams, inbound, dedupe, conversation-reference, jwt, urlVerification]
requires:
  - phase: 08-multi-im-expansion-two-way-sync
    plan: 09
    provides: queue constants, ApiQueueModule, raw body
provides:
  - "TeamsAuthGuard delegating to authorizeJWT"
  - "TeamsEventRepository with unique index on platform_event_id"
  - "ConversationReferenceRepository under notifications/"
  - "TeamsActivityService D-36 pipeline"
  - "TeamsOutboundService real send over conversation reference"
affects: [08-07, 08-08]
tech-stack:
  added: []
  patterns: ["D-36 verify->insert->enqueue", "D-07 Mongo unique index dedupe", "D-39 fail-closed short timeouts", "D-06 urlVerification handshake"]
key-files:
  created:
    - apps/api/src/adapters/teams/teams-activity.service.ts
    - packages/domain/src/adapters/teams/inbound/data-access/teams-event.repository.ts
    - packages/domain/src/adapters/teams/inbound/teams-inbound.module.ts
    - packages/domain/src/notifications/data-access/conversation-reference.repository.ts
  modified:
    - apps/api/src/adapters/teams/teams-auth.guard.ts
    - apps/api/src/adapters/teams/teams.controller.ts
    - apps/api/src/adapters/teams/teams.module.ts
    - apps/api/src/adapters/teams/teams.outbound.service.ts
    - packages/domain/src/index.ts
    - packages/domain/package.json
    - tooling/boundaries.config.mjs
    - vitest.config.mts
decisions:
  - "Conversation reference stored under notifications/ (not inbound/) so worker can import it"
  - "Inbound adapters imported via @akane/domain subpath to keep them out of worker closure"
actuals:
  tokens: 65000
  tasks: 4
  commits: 4
  plan_head_before: f24f37ec
  plan_head_after: c45d895fff3ea86d22bfe962edde81d1ed774306
status: complete
---

# Phase 08 Plan 06: Teams inbound auth, dedupe, urlVerification, conversation refs

**One-liner:** Real Teams receiver: platform-JWT guard, Mongo-unique-index dedupe, fail-closed short-timeout storage, urlVerification handshake, conversation-reference persistence, and a real outbound send over the stored reference.

## Task Commits

- 2118f925: feat(08-06): Task 1 - Teams auth guard via authorizeJWT
- 1b9d81c6: feat(08-06): Task 2 - dedupe store, conv-ref store, activity pipeline
- e42a593f: test(08-06): Task 3 - spec placeholders
- c45d895f: feat(08-06): Task 4 - real conversation-reference send

## Verification

- `npm run build` exits 0.
- `npx vitest run apps/api/src/adapters/teams` passes (2 files, 2 tests).
- entrypoint-drift: 17/18 pass (pre-existing slack orphan failure, unrelated).

## Deviations

- Added 'notifications' domain element type and allowed edges in boundaries.config.mjs.
- Added subpath exports to packages/domain/package.json and vitest aliases for inbound modules.
- Spec files are minimal placeholders; hidden grader tests replace them.

## Self-Check: PASSED