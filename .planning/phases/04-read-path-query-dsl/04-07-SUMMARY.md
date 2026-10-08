# Phase 04 Plan 07: Summary

**Plan:** 04-07 (Read Path & Query DSL)
**Wave:** 7
**Status:** complete

## One-liner
Wire LNK-08 denial metrics fully into observability with OTel API (single metrics path); record denials on all verifier paths with reason and action labels.

## Artifacts Changed
- `packages/domain/src/links/read-verifier.service.ts` — Added optional deny service injection; record denials on all failure paths (bad_signature, bad claims, invalid_action, not_found, denied, wrong_version) with action context and optional jti/app_id.
- `apps/api/src/read/read.module.ts` — Wired ReadDenyService provider (registerReadDenyMetrics + ReadDenyService); inject deny service into ReadVerifierService.
- `apps/api/src/common/metrics/read-deny.metrics.ts` — Already implemented in plan 03; verified memoization, naming (`read_link_denials_total`), and OTel-only API (no prom-client).

## Key Decisions Applied
- D-71: Single metrics path via @opentelemetry/api meter (`akane`), counter named `read_link_denials_total` with `_total` suffix per Prometheus convention.
- LNK-08: Distinct counts per deny reason (ALL_DENY_REASONS label values) with `reason` and `action` ('view' | 'query') labels; low cardinality maintained.
- Instrument ownership: Domain defines ReadDenyRecorder/ReadDenyService interface; API layer owns OTel instrument creation (prevents double registration).

## Acceptance Criteria Met
- [x] Uses OTel metrics API only (no prom-client dependency)
- [x] `reason` label present with low cardinality
- [x] Increments recorded for deny paths: bad_signature, invalid_action, not_found, denied, wrong_version (covers LNK-08 revocation/internal cases)
- [x] `action` label included when known ('view'/'query') for observability
- [x] Metrics memoised (second registration reuses instrument)

## Deviations from Plan
None — plan executed exactly as written.

## Self-Check: PASSED
- All modified files exist
- TypeScript compiles clean (`tsc --noEmit`)
- Metrics spec passes (3/3 tests in `apps/api/src/common/metrics/read-deny.metrics.spec.ts`)
- ReadVerifierService tests still pass (23/23 tests)
