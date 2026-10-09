---
phase: 04-read-path-query-dsl
plan: 08
subsystem: read-path/query-dsl
tags: [integration-tests, read-controller, verifier, dsl]
dependency_graph:
  requires:
    - "01-07"
    - "01-10"
  provides:
    - integration-test-coverage
  affects: []
tech-stack:
  added: []
  patterns:
    - integration-test-setup-with-verifier-mocks
    - es256-jwt-signing-in-tests
key-files:
  created:
    - packages/domain/src/dsl/__tests__/integration-query.spec.ts
    - apps/api/src/read/read.controller.spec.ts
    - packages/domain/src/links/__tests__/read-verifier.integration.spec.ts
  modified:
    - apps/api/src/read/read.controller.ts
decisions:
  - controller-extended-with-query-endpoint
  - tests-cover-view-and-query-flows
metrics:
  duration_seconds: 1032
  completed: 2026-10-09T02:31:00Z
  status: complete
  actuals:
    tokens: 6178
    tasks: 2
    commits: 2
  commits: 2
  plan_head_before: f6192434d07d702b21b5d1bc8234fb6869fd50d7
  plan_head_after: 0c95ea797a169eba590c4308c2a32d1857b0aab3
---

# Phase 04 Plan 08: Integration tests tying everything together

## One-liner
Integration tests validate DSL query execution, read controller view/query endpoints, and verifier deny flows with auth injection end-to-end.

## What Was Built

### Task 1: Integration tests for DSL + query execution (feat(04-08): add DSL query execution integration tests, commit 64384978)
- Created `packages/domain/src/dsl/__tests__/integration-query.spec.ts`
- Tests cover auth injection: view_all skips real_user_id only, deleted_at:null always enforced
- Verifies regular users see only own live records; pagination/sort/projection respected
- Tests explicit filters with auth wrapping (D-74 invariant)

### Task 2: API/controller integration tests (feat(04-08): add read controller/query endpoints and integration tests, commit 0c95ea79)
- Extended `apps/api/src/read/read.controller.ts` with `query/:jti` endpoint that verifies token, executes saved query DSL via `SubmissionRepository.queryWithDsl`, returns results
- Created `apps/api/src/read/read.controller.spec.ts` with controller integration tests (6 tests) covering view/query happy paths and deny redirects to dead with reason parameter
- Created `packages/domain/src/links/__tests__/read-verifier.integration.spec.ts` with verifier integration tests (10 tests) covering view/query flows, wrong_version, denied (perm_version enforcement), bad_signature, not_found

## Deviations from Plan

None - plan executed exactly as written.

## Test Results
- DSL integration tests: 4 passed (packages/domain/src/dsl/__tests__/integration-query.spec.ts)
- Verifier integration tests: 10 passed (packages/domain/src/links/__tests__/read-verifier.integration.spec.ts)  
- Controller integration tests: 6 passed (apps/api/src/read/read.controller.spec.ts)

## Success Criteria Met
- All 6 requirements (LNK-05, LNK-06, LNK-08, DAT-10, DAT-11, DAT-12) have coverage
- View + query E2E paths validated
- Auth injection validated end-to-end

## Self-Check: PASSED
All created files exist. Both commits (64384978, 0c95ea79) present. Tests pass.
