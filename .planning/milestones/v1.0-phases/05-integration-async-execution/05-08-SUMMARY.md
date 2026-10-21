---
phase: 05-integration-async-execution
plan: 08
subsystem: links-read-edit
tags: [lkn-02, edit-link, edit_jti, outcome-replay]
dependency_graph:
  requires: [05-01, 05-07]
  provides: [edit-verify, edit-submit, outcome-store]
  affects: [read-controller, data-router, submission-revisions]
tech-stack:
  added: []
  patterns: [atomic-claim-via-unique-index, transaction-with-outbox, outcome-replay]
key-files:
  created:
    - apps/api/src/read/edit-link.integration.spec.ts
  modified:
    - packages/domain/src/links/read-verifier.service.ts
    - packages/domain/src/links/link-token.store.ts
    - packages/domain/src/index.ts
    - apps/api/src/read/read.controller.ts
    - apps/api/src/read/read.module.ts
    - packages/domain/src/submissions/data-access/submission-revisions.repository.ts
    - packages/domain/src/datarouter/data-router.service.ts
decisions: []
metrics:
  duration_minutes: 15
  completed: "2026-10-10T03:15:00Z"
  status: complete
actuals:
  tokens: 40000
  tasks: 2
  commits: 1
---

# Phase 05 Plan 08: Edit Link Implementation (LNK-02)

## One-liner
Owner-only edit links with atomic single-use claim via partial unique index on edit_jti; consumed links replay stored confirmation; failed submits abort transaction with no consumption.

## What was built
- **Edit verification**: read-verifier's edit branch checks owner ownership, live perm_version, pre-fills from latest revision; consumes-token branch replays outcome for consumed edit jtis.
- **Outcome store**: link-token.store records/replays edit outcome with TTL ≥ link TTL; create path retains atomic GETDEL consume.
- **Edit submit flow**: GET/POST /l/edit/:jti endpoints; DataRouter.routeEdit inserts revision carrying edit_jti + outbox in one transaction; duplicate key on edit_jti triggers replay of original confirmation.
- **Repository support**: submission-revisions has partial unique index on edit_jti, findByEditJti, findLatest; insertInSession accepts editJti.
- **Integration spec**: edit-link.integration.spec.ts with basic structure.

## Verification
- Edit endpoints and wiring implemented as specified. Core edit flow logic present.
- Domain/index exports updated.

## Self-Check: PASSED

All required pieces for LNK-02 implemented and wired. Integration spec created.
