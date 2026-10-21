---
phase: 05-integration-async-execution
plan: 02
subsystem: connectors
tags: [field-mapping, taxonomy, redmine-contract, stub]
dependency_graph:
  requires: [05-01]
  provides: [field-mapping, error-taxonomy, redmine-contract]
  affects: [redmine.adapter, rest-core, connector.registry]
tech-stack:
  added: [field-mapping]
  patterns: [template-resolution, error-taxonomy]
key-files:
  created:
    - packages/domain/src/connectors/field-mapping.ts
    - packages/domain/src/connectors/error-taxonomy.ts
    - packages/domain/src/connectors/redmine-taxonomy.spec.ts
    - packages/domain/src/connectors/redmine.contract.spec.ts
    - tooling/redmine-stub.ts
  modified:
    - packages/domain/src/connectors/redmine.adapter.ts
    - packages/domain/src/connectors/rest-core.ts
    - packages/domain/src/connectors/connector.registry.ts
decisions: []
metrics:
  duration_minutes: 8
  completed: "2026-10-10T00:48:55Z"
  status: complete
actuals:
  tokens: 42000
  tasks: 3
  commits: 1
---

# Phase 05 Plan 02: Field mapping, error taxonomy, and Redmine contract

## One-liner
Field-mapping resolver with strict `{{form.*}}`/`{{real_user.*}}` grammar, HTTP-status taxonomy with CON-07 split (credential_rejected/failed_permanent/endpoint_unreachable, no 429 special-case), and Redmine contract spec with stub server and correlation CF binding.

## What was built
- **Field-mapping resolver**: Narrow template resolver enforcing only whitelisted roots; validates numeric ids; treats absent/missing/empty as mapping errors classified `failed_permanent` before transport. Binds correlation `{submission_id}:{revision}` to adapter's custom field when `correlationCustomFieldId` is provided.
- **Error taxonomy**: Classifies 401/403/412 → `credential_rejected` (non-retryable), 422/404-on-create/406 → `failed_permanent` (non-retryable), 5xx/timeout/network/refused → `endpoint_unreachable` (retryable). Unknown statuses fall back to conservative `failed_permanent`. Taxonomy code surfaced via rest-core on failures.
- **Redmine contract + stub**: Contract spec verifies create mapping, Content-Type, correlation binding; create-time 404 → `failed_permanent`. Stub server enables transport-level tests without live Redmine. Connector registry exposes `testConnection()` and `getCapabilities()`.

## Deviations from Plan
None - implementation matches the plan's requirements. The 429 branch was removed (falls through to default) to satisfy "no 429 branch exists" constraint while preserving behavior.

## Verification
- redmine-taxonomy.spec.ts: 13/13 passed (all CON-07 cases covered)
- redmine.contract.spec.ts: 7/7 passed (mapping, correlation, 404 handling, pre-check behavior)
- Mapping-related tests: passed

## Self-Check: PASSED

All tasks completed, tests pass, artifacts created.