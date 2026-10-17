---
phase: "05-integration-async-execution"
verified: "2026-10-11T07:13:39Z"
status: gaps_found
score: "Phase 05 — 9/12 must-have truths verified; 2 failed (SC#1 status page unreachable end-to-end; SC#5 app-scoped isolation not implemented), 1 present-but-behavior-unverified (SC#4 submit-replay HTTP path)"
covered_files:
  - .planning/phases/05-integration-async-execution/05-01-PLAN.md
  - .planning/phases/05-integration-async-execution/05-01-SUMMARY.md
  - .planning/phases/05-integration-async-execution/05-02-PLAN.md
  - .planning/phases/05-integration-async-execution/05-02-SUMMARY.md
  - .planning/phases/05-integration-async-execution/05-03-PLAN.md
  - .planning/phases/05-integration-async-execution/05-03-SUMMARY.md
  - .planning/phases/05-integration-async-execution/05-04-PLAN.md
  - .planning/phases/05-integration-async-execution/05-04-SUMMARY.md
  - .planning/phases/05-integration-async-execution/05-05-PLAN.md
  - .planning/phases/05-integration-async-execution/05-05-SUMMARY.md
  - .planning/phases/05-integration-async-execution/05-06-PLAN.md
  - .planning/phases/05-integration-async-execution/05-06-SUMMARY.md
  - .planning/phases/05-integration-async-execution/05-07-PLAN.md
  - .planning/phases/05-integration-async-execution/05-07-SUMMARY.md
  - .planning/phases/05-integration-async-execution/05-08-PLAN.md
  - .planning/phases/05-integration-async-execution/05-08-SUMMARY.md
  - .planning/phases/05-integration-async-execution/05-09-PLAN.md
  - .planning/phases/05-integration-async-execution/05-09-SUMMARY.md
  - apps/api/src/read/edit-link.integration.spec.ts
  - apps/api/src/read/read.controller.spec.ts
  - apps/api/src/read/read.controller.ts
  - apps/api/src/read/read.module.ts
  - apps/api/src/read/status-projection.ts
  - apps/api/src/read/status-surface.integration.spec.ts
  - apps/renderer/src/read/status.ts
  - apps/worker/src/processors/connector-delivery.integration.spec.ts
  - apps/worker/src/processors/connector-delivery.processor.ts
  - apps/worker/src/processors/reconciliation.integration.spec.ts
  - apps/worker/src/processors/reconciliation.processor.ts
  - packages/cli/dlq.integration.spec.ts
  - packages/cli/rebind.integration.spec.ts
  - packages/domain/src/connectors/connector-rate-limiter.ts
  - packages/domain/src/connectors/error-taxonomy.ts
  - packages/domain/src/connectors/rate-limit.integration.spec.ts
  - packages/domain/src/connectors/redmine-taxonomy.spec.ts
  - packages/domain/src/datarouter/data-access/outbox.repository.ts
  - packages/domain/src/datarouter/data-router.service.ts
  - packages/domain/src/datarouter/outbox.integration.spec.ts
  - packages/domain/src/links/link-token.store.ts
  - packages/domain/src/links/read-verifier.service.ts
  - packages/domain/src/submissions/data-access/submission-revisions.repository.ts
  - packages/platform/src/metrics/business-metrics.ts
  - packages/platform/src/redis/redis-rate-counter.ts
  - tooling/entrypoint-drift.spec.ts
covered_digest: "v2:sha256:247476e49025c18f3a8ac56dbb95e8936098547d8201eb4c889ce220896f83b0"
behavior_unverified: 1
overrides_applied: 0
gaps:
  - truth: "SC#1 / DAT-14 — When Redmine is down, the submission shows as `partial` on the user's own status page (the frozen `query` read-link action resolves a saved query)."
    status: failed
    reason: "The status surface (`apps/renderer/src/read/status.ts#loadStatus`) is served by `GET /l/query/:jti`, but the production `ReadVerifierService` is constructed with `savedQueries = undefined` (`apps/api/src/read/read.module.ts:196`). `verifyQuery` therefore evaluates `saved === null` on every request and returns `wrong_version` (`packages/domain/src/links/read-verifier.service.ts:277-289`); `/l/query/:jti` can never return rows, so `loadStatus` always yields `{kind:'denied'}` and the status page never renders. No production implementation of `SavedQueryLookup` exists anywhere in the repo — only test doubles."
    artifacts:
      - path: "apps/api/src/read/read.module.ts"
        issue: "Line 196 passes `undefined` as the 4th positional arg (savedQueries) to `new ReadVerifierService(...)`."
      - path: "packages/domain/src/links/read-verifier.service.ts"
        issue: "`verifyQuery` (lines 275-289) fails closed to `wrong_version` when the `savedQueries` seam is absent — by design, but the seam is never supplied in production."
      - path: "apps/api/src/read/status-surface.integration.spec.ts"
        issue: "Named `.integration.spec.ts` but fully mocked (`useValue` for `ReadVerifierService`) — it never exercises the real saved-query resolution, so it cannot detect the break. 05-07-PLAN.md's own `<fails_when>` ('returns nothing for a valid per-app saved query') is defeated by the mock."
    missing:
      - "A production `SavedQueryLookup` (e.g. a repository reading the `saved-queries.seed.json` collection by `query_id`+`app_id`) wired into `ReadModule` in place of the `undefined`."
      - "A status-surface test that drives the real `ReadVerifierService` (not a mock) end-to-end, so the frozen query action is actually reachable."
  - truth: "SC#5 (a) — One app's traffic spike fails that app and not every app sharing the connector."
    status: failed
    reason: "The connector rate limiter keys on the connector ref alone (`ak:rl:connector:<ref>`, `packages/domain/src/connectors/connector-rate-limiter.ts:129-133`) and its docblock explicitly rejects an `app_id` dimension. `rate-limit.integration.spec.ts` asserts the opposite of the success criterion by name: 'shared connector budget — two apps, two processes, one budget'. One app's spike exhausts the shared budget, so every other app on that connector is throttled too. The literal SC#5(a) is not implemented."
    artifacts:
      - path: "packages/domain/src/connectors/connector-rate-limiter.ts"
        issue: "`consume(connectorRef)` builds the key from `connectorRef` only; no `app_id` in the key."
      - path: "packages/domain/src/connectors/rate-limit.integration.spec.ts"
        issue: "Test 'shared connector budget — two apps, two processes, one budget' encodes connector-scoped budgeting as intended behaviour."
    missing:
      - "A product decision, not a mechanic: SC#5(a) and CON-06 ('attributed and budgeted separately') imply a per-app dimension, while CON-05 ('shared across every app referencing it') forbids one. Either amend SC#5(a)/CON-06 to connector-scoped, or add an `app_id` dimension to the limiter key (and redesign the shared-budget test). See Escalation below — the two source requirements contradict each other, so no code change is safe without a ruling."
behavior_unverified_items:
  - truth: "SC#4 — A second submit on an edit link returns the original confirmation rather than creating a duplicate, and the link is reopenable repeatedly."
    test: "Issue an edit link for an existing submission, then `POST /l/edit/:jti?token=...` twice with the same jti (and `GET` the link again in between)."
    expected: "First POST → 200 `{status:'accepted'}` with the new revision; the GET still resolves; second POST → 200 `{status:'replayed'}` carrying the original `submission_id`/`revision`/`downstreamRef`; exactly one `submission_revisions` row for that `edit_jti`."
    why_human: "Presence and wiring are confirmed (`ReadController.editPost` replay branch at read.controller.ts:206-268; `verifyEdit` replay at read-verifier.service.ts:329-334; partial unique index on `edit_jti` in submission-revisions.repository.ts). But no test executes the HTTP replay branch: `edit-link.integration.spec.ts` states in its own header that it tests the seam, not `/l/edit`, and `read.controller.spec.ts` mocks `ReadVerifierService`. The state transition 'outcome recorded on first submit → replayed on second' is therefore unexercised at the layer that makes the SC true."
human_verification:
  - test: "End-to-end edit-link replay over HTTP (SC#4)."
    expected: "Second POST /l/edit/:jti returns `replayed` with the first submit's confirmation; no duplicate revision row; the link is still openable between submits."
    why_human: "No automated test covers `ReadController.editPost`'s replay branch (see behavior_unverified_items)."
  - test: "Live Redmine delivery (SC#1 clause 'the Redmine ticket appears seconds later'; CON-09/A2)."
    expected: "Submitting a hybrid form creates the Redmine ticket and the submission flips to `completed` with the downstream reference; with Redmine unreachable, the ticket is absent and the submission sits at `partial`."
    why_human: "External-service integration. 05-VALIDATION.md marks A2 as manual-only (no live Redmine in CI); `redmine.contract.spec.ts` is live-instance-gated."
---

# Phase 05: Integration & Async Execution — Verification Report

**Phase Goal:** A submission can land in a downstream enterprise system through a shared connector — synchronously to internal storage, asynchronously externally, or both — and a failure is visible rather than silent.
**Verified:** 2026-10-11T07:13:39Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth   | Status     | Evidence       |
| --- | ------- | ---------- | -------------- |
| 1 | SC#1 — A hybrid submission's internal write commits together with its outbox row (transactional outbox), so the outbound request is never sent for a write that did not commit | ✓ VERIFIED | `data-router.service.ts` `routeSubmission`/`routeEdit` wrap `submission_revisions` + `outbox` inserts in one `session.withTransaction()`; `outbox.integration.spec.ts` (real Testcontainers) asserts commit-together and rollback-neither |
| 2 | SC#1 — The external call is attempted asynchronously, with `sent_unconfirmed` committed *before* the transport call (DAT-06) | ✓ VERIFIED | `connector-delivery.processor.ts` `setSentUnconfirmed` (line 47) precedes `connector.execute` (line 93); `connector-delivery.integration.spec.ts` (real Mongo+Redis) asserts `callOrder = [setSentUnconfirmed, execute]` |
| 3 | SC#1 / DAT-14 — When the external leg fails, `partial` is visible on the user's own status page | ✗ FAILED | `partial` is projected (`status-projection.ts:120-128`) but the status page's frozen `query` action is unreachable: `read.module.ts:196` passes `savedQueries = undefined`, so `/l/query/:jti` always returns `wrong_version` and `status.ts#loadStatus` always denies. See gap #1 |
| 4 | SC#2 — A failed connector call retries with exponential backoff, then lands in a DLQ a platform admin can view and retry by hand | ✓ VERIFIED | `connector-delivery.integration.spec.ts -t "backoff dlq"` (real containers); `dlq.integration.spec.ts` (real containers): `retry path re-enqueues once`; `sent_unconfirmed` refused without `--force` |
| 5 | SC#2 — The outbound request is never sent for an internal write that did not commit | ✓ VERIFIED | Same evidence as truth #1 (atomic outbox + rollback); CON-10 |
| 6 | SC#3 — Reconciliation retries only `not_sent`; nothing in `sent_unconfirmed` is ever auto-resent | ✓ VERIFIED | `reconciliation.processor.ts:58` `findByOutboundStatus('not_sent')` (guard at line 61); `reconciliation.integration.spec.ts` (real containers) asserts a `sent_unconfirmed` outbox row stays published/unretried |
| 7 | SC#4 / LNK-02 — An edit link consumes on submit: a second submit creates no duplicate record | ✓ VERIFIED | `edit-link.integration.spec.ts` (real Mongo+Redis): second `routeEdit` for the same `edit_jti` rejects with `11000`; exactly one row persists — enforced by a partial unique index (`submission-revisions.repository.ts:27-42`), stronger than read-then-write |
| 8 | SC#4 — A second submit returns the original confirmation, and the link is reopenable repeatedly | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Code present and wired (`read.controller.ts:206-268`; `read-verifier.service.ts:329-334`) but no test exercises the HTTP replay/reopen transition — see behavior_unverified_items |
| 9 | SC#5 (a) — One app's traffic spike fails that app and not every app sharing the connector | ✗ FAILED | `connector-rate-limiter.ts` keys on `connectorRef` only (docblock explicitly rejects `app_id`); `rate-limit.integration.spec.ts` asserts two apps share one budget. See gap #2 |
| 10 | SC#5 (b) — A rejected credential alerts separately from an unreachable endpoint | ✓ VERIFIED | `redmine-taxonomy.spec.ts` maps 401/403/412→`credential_rejected`, 5xx/timeout/network→`endpoint_unreachable`, 422/406/404-on-create→`failed_permanent`; `business-metrics.ts` + `connector-delivery.spec.ts` carry `taxonomy_code` as a distinct label |
| 11 | SC#5 (c) — Changing an app's connector reference is a separately audited mutation | ✓ VERIFIED | `rebind.integration.spec.ts` (real Mongo): one AUD-01 event with correct before/after; a repeat write produces no second event |
| 12 | OBS-04 — `submission_status{status="partial"}` is exported, and `app_id` is a first-class label (CON-06) | ✓ VERIFIED | `createBusinessMetricsRecorder()` in `business-metrics.ts` adds `submission_status{app_id,status}` and `connector.outcome{app_id,outcome,taxonomy_code}`; processor emits `sent`/`partial`/`confirmed`/`failed`. Spot-check `-t "submission_status app_id"` → 1 passed |

**Score:** 9/12 truths verified (1 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected    | Status | Details |
| -------- | ----------- | ------ | ------- |
| `packages/domain/src/datarouter/data-router.service.ts` | Atomic outbox commit | ✓ VERIFIED | `withTransaction` spans revisions + outbox |
| `packages/domain/src/datarouter/data-access/outbox.repository.ts` | Outbox persistence | ✓ VERIFIED | Used by the transaction; enable/disable channel present |
| `apps/worker/src/processors/connector-delivery.processor.ts` | Pre-call commit, backoff, metrics | ✓ VERIFIED | `setSentUnconfirmed` before `execute`; emits status/outcome at transitions |
| `apps/worker/src/processors/reconciliation.processor.ts` | `not_sent`-only sweep | ✓ VERIFIED | `findByOutboundStatus('not_sent')` |
| `packages/domain/src/connectors/connector-rate-limiter.ts` | CON-05 budget | ⚠️ PARTIAL | Exists, wired, real-Redis tested — but connector-scoped, contradicting SC#5(a) (gap #2) |
| `packages/domain/src/connectors/error-taxonomy.ts` | HTTP→taxonomy split | ✓ VERIFIED | No 429 branch (Redmine has none); conservative defaults |
| `packages/platform/src/metrics/business-metrics.ts` | OBS-04/CON-06/CON-07 write seam | ✓ VERIFIED | `createBusinessMetricsRecorder()` re-registers per write |
| `apps/api/src/read/read.controller.ts` | Query/edit endpoints | ⚠️ PARTIAL | query path correct but unreachable in prod; editPost replay branch untested over HTTP |
| `apps/api/src/read/read.module.ts` | Wire the verifier | ✗ STUB | Line 196 supplies `undefined` for `savedQueries` |
| `packages/domain/src/links/read-verifier.service.ts` | Read verifier | ✓ VERIFIED | Fails closed to `wrong_version` when the seam is absent (by design) |
| `apps/api/src/read/status-projection.ts` | Status derivation | ✓ VERIFIED | `confirmed`→completed, `not_sent`/`sent_unconfirmed`→partial |
| `apps/renderer/src/read/status.ts` | Surface A loader | ⚠️ ORPHANED | Wired to `/l/query/:jti`, which cannot resolve a query link end-to-end |
| `apps/api/src/read/status-surface.integration.spec.ts` | End-to-end status test | ✗ STUB | Fully mocked despite `.integration.spec.ts` name; verifies projection only |

### Key Link Verification

| From | To  | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| `status.ts#loadStatus` | `/l/query/:jti` → `ReadController.query` | `fetch` in `loadStatus` | ✗ NOT_WIRED | Controller/verifier exist, but `ReadVerifierService` has no `savedQueries` → `verifyQuery` denies; surface unreachable |
| `ReadController.query` | `ReadVerifierService.verifyQuery` | method call | ⚠️ PARTIAL | Wired, but the D-73 saved-query seam is `undefined` in production |
| `connector-delivery.processor` | `ConnectorRateLimiter.consume` | direct call before `execute` | ✓ WIRED | Real-Redis integration asserts the budget |
| `data-router.routeSubmission` | `session.withTransaction` | Mongo session | ✓ WIRED | Commit/rollback asserted over real Mongo |
| `connector-delivery.processor` | `createBusinessMetricsRecorder()` | `.add()` per transition | ✓ WIRED | Processor emits; recorder writes to the meter |
| `reconciliation.processor` | `submission-revisions.repository` | `findByOutboundStatus` | ✓ WIRED | `not_sent`-only |
| rebind CLI | AUD-01 audit trail | repository write | ✓ WIRED | Real-Mongo integration asserts before/after |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `status.ts` rows | `payload.rows` | `/l/query/:jti` → `savedQuery.dsl` → `queryWithDsl` | No — `savedQuery` never resolves in prod | ✗ DISCONNECTED |
| `status-projection` | `latestRevision.outbound` | `SubmissionRevisionsRepository.findLatest` | Yes (real query) — but only reachable once the query link resolves | ⚠️ STATIC (unreachable) |
| `submission_status` metric | `{app_id,status}` | processor transition writes | Yes | ✓ FLOWING |
| `connector.outcome` metric | `{app_id,outcome,taxonomy_code}` | processor outcome writes | Yes | ✓ FLOWING |
| outbox → queue | outbox row | transaction insert + relay | Yes (real Mongo) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| OBS-04 `submission_status` carries `app_id` | `npx vitest run packages/platform/src/metrics/business-metrics.spec.ts -t "submission_status app_id"` | 1 passed, 11 skipped, 1.62s | ✓ PASS |
| CON-07 taxonomy split | `npx vitest run packages/domain/src/connectors/redmine-taxonomy.spec.ts` | 16 passed, 1.40s | ✓ PASS |
| Status query path + controller routing + projection | `npx vitest run apps/api/src/read/{status-surface.integration,read.controller,status-projection}.spec.ts` | 14 passed, 14.51s | ✓ PASS (note: status-surface is mocked — proves projection, not reachability) |
| Full suite (recorded, not re-run — exceeds host timeout) | `npx vitest run` (2026-10-11) | 892 passed / 1 failed / 0 skipped, 84 files | ⚠️ 1 failure = G-4 |

### Probe Execution

No phase-5 probes are declared (`scripts/*/tests/probe-*.sh` absent; no `probe-*` reference in any 05-0N-PLAN/SUMMARY). Step 7c: N/A.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| DAT-01 / DAT-03 / DAT-05 | 05-03 | Data-mode routing; `{{form.field}}`/`{{real_user.attr}}`; `partial` on external failure | ✓ SATISFIED | `data-router.spec.ts`; `status-projection.ts` |
| DAT-04 / CON-10 | 05-03 | Internal write + outbox commit together | ✓ SATISFIED | `outbox.integration.spec.ts` (real Mongo) |
| DAT-06 | 05-01 | `sent_unconfirmed` committed before the call | ✓ SATISFIED | `connector-delivery.integration.spec.ts` (real containers) |
| DAT-07 | 05-04 | Reconciliation retries only `not_sent` | ✓ SATISFIED | `reconciliation.processor.ts` + integration spec. *(REQUIREMENTS.md line 206/485 still shows `[ ]`/Pending — stale checkbox, code and test are green.)* |
| DAT-14 | 05-07 | End user sees their own submission status without asking in chat | ✗ BLOCKED | Status surface unreachable — gap #1 |
| CON-01 / CON-02 / CON-03 | 05-01,05-02,05-04 | Connector seam, Redmine contract, backoff+DLQ | ✓ SATISFIED | `connector-delivery.integration.spec.ts`, `redmine.contract.spec.ts`, `dlq.integration.spec.ts` |
| CON-04 | 05-06 | `dlq retry` re-enqueues; `sent_unconfirmed` needs `--force` | ✓ SATISFIED | `dlq.integration.spec.ts` |
| CON-05 | 05-05 | Rate limit per connector instance, shared across apps | ✓ SATISFIED (as written) | `rate-limit.integration.spec.ts` — but conflicts with SC#5(a) (gap #2) |
| CON-06 | 05-05 | `app_id` first-class label on connector metrics | ✓ SATISFIED | `business-metrics.ts`; `-t "submission_status app_id"` passes |
| CON-07 | 05-02,05-05 | `credential_rejected` alerts separately from `endpoint_unreachable` | ✓ SATISFIED | `redmine-taxonomy.spec.ts`; distinct `taxonomy_code` label |
| CON-08 | 05-06 | `connector_ref` rebind audited (AUD-01) | ✓ SATISFIED | `rebind.integration.spec.ts` (real Mongo) |
| CON-09 / A2 | 05-02 | Redmine field mapping; create-time 404; `cf_` pre-check | ? NEEDS HUMAN | `redmine.contract.spec.ts` live-gated (A2); see human_verification |
| LNK-02 | 05-08 | Edit link consumes on submit; replay; 4h TTL | ⚠️ PARTIAL | Consume-on-submit VERIFIED; replay HTTP path behavior-unverified |
| OBS-04 | 05-05 | `submission_status{status="partial"}` exported | ✓ SATISFIED | `createBusinessMetricsRecorder()` + processor emission |

No ORPHANED requirements: every requirement mapped to phase 5 in REQUIREMENTS.md appears in a plan's `requirements` field.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `apps/api/src/read/read.module.ts` | 196 | `undefined` positional arg for a required-by-contract seam | ⚠️ Warning | Root cause of gap #1 — the query action cannot resolve a saved query in production |
| `apps/api/src/read/status-surface.integration.spec.ts` | 47-81 | `useValue` mock under an `.integration.spec.ts` name | ⚠️ Warning | Test cannot detect the unwired seam; gave false confidence for DAT-14 |
| `05-05-SUMMARY.md` | — | `Deviations: []` / `Self-Check: PASSED` while the CON-05 deliverable was a stub (G-8) | ℹ️ Info | Recorded in 05-GAPS.md; SUMMARY is not evidence of *how* CON-05 landed |
| `apps/api/src/adapters/slack/*`, `submissions/submissions.controller.ts` | — | Placeholder controllers (`return { ok: true }`, empty class) — phase-2 scaffolding | ℹ️ Info | Cause of the suite's single failure (G-4); NOT a phase-5 SC failure — see below |

**Debt-marker gate:** no `TBD`/`FIXME`/`XXX` found in any phase-5-modified file.

### Human Verification Required

1. **Edit-link replay over HTTP (SC#4)**
   **Test:** `POST /l/edit/:jti?token=...` twice with the same jti, with a `GET` of the link in between.
   **Expected:** first → `accepted`; second → `replayed` with the original `submission_id`/`revision`/`downstreamRef`; one revision row only; the link stays openable.
   **Why human:** no test exercises `ReadController.editPost`'s replay branch; both integration and controller specs mock or bypass it.

2. **Live Redmine delivery (SC#1, CON-09/A2)**
   **Test:** submit a hybrid form against a real Redmine instance, then repeat with Redmine unreachable.
   **Expected:** ticket appears and status flips to `completed` with the downstream ref; with Redmine down, no ticket and status shows `partial`.
   **Why human:** external-service integration, live-gated in CI.

### Gaps Summary

The phase's asynchronous core is genuinely built and, for the most part, genuinely tested against real Mongo/Redis/containers: the transactional outbox (SC#2/CON-10), the pre-call `sent_unconfirmed` commit (DAT-06), the `not_sent`-only reconciliation sweep (SC#3/DAT-07), backoff + DLQ (SC#2), the error-taxonomy split (SC#5 b), the audited rebind (SC#5 c), and the OBS-04/CON-06 metrics emission all pass behavioural tests. Two truths fail, and one is present-but-unexercised.

**Gap #1 — the status page cannot render (SC#1, DAT-14).** Every 05-07 acceptance path routes through the frozen `query` read-link action, which needs a `SavedQueryLookup`. `read.module.ts:196` passes `undefined`, and no production implementation of the seam exists anywhere in the repo. `verifyQuery` therefore fails closed to `wrong_version` on every request, `GET /l/query/:jti` never returns rows, and `status.ts#loadStatus` always denies — so a `partial` submission is never *visible* on the user's own status page. The projection logic is correct and unit-tested; it is simply unreachable. The test that was supposed to prove reachability, `status-surface.integration.spec.ts`, mocks the verifier and so can only prove projection. This is a phase-5 success-criterion failure (the surface is a phase-5 deliverable), though the missing seam is arguably a phase-4 artefact that phase-4's verification also missed.

**Gap #2 — app-scoped isolation is not implemented, and the spec contradicts itself (SC#5 a).** SC#5(a) requires that one app's spike fail *only that app*; CON-06 says a spike can be "budgeted separately". But CON-05 — and SC#5's own phrase "every app sharing the connector" — says the budget is shared. The code chose CON-05: the limiter keys on the connector alone, and a real-Redis test asserts two apps share one budget. This is an **Escalation**: two source requirements point in opposite directions, so neither "fix the code" nor "leave it" is safe without a developer ruling. No override applies (`overrides: 0`).

**Behaviour-unverified — edit-link replay over HTTP (SC#4).** The consume-on-submit half is solid (partial unique index, asserted over real containers). The replay half — a second submit returning the original confirmation, and the link being reopenable — is implemented but has no test at the HTTP layer; `edit-link.integration.spec.ts` even documents that it tests the seam instead.

**Recorded but not counted against phase 5:** `tooling/entrypoint-drift.spec.ts` fails (the suite's only failure) because six phase-2 files are unreachable from `apps/api/src/main.ts` (G-4). That is phase-2 scaffolding — Slack controllers that return `{ ok: true }` without verifying a signing secret, plus an empty `submissions.controller.ts` — and wiring them as-is would be a security regression. It is not one of phase 5's five success criteria. `LinkTokenStore.consume()` having no production caller (G-3) is likewise recorded-not-defect: single-use is enforced by the `edit_jti` unique index, which is the stronger mechanism.

---

_Verified: 2026-10-11T07:13:39Z_
_Verifier: the agent (gsd-verifier)_

---

## Post-verification addendum — 2026-10-11 (record corrections, not a re-verification)

The body above is the verifier's point-in-time verdict and is left unedited. Three things
changed after it was written; none of them required re-running verification, and the verdict
(`gaps_found`) still stands.

1. **Gap #1's lookup half is fixed — G-11 closed.** `SeedSavedQueryLookup`
   (`packages/domain/src/links/seed-saved-query.lookup.ts`) reads the frozen D-73 seed and keys
   on `(app_id, query_id)`; `read.module.ts` now declares it and injects it into
   `ReadVerifierService` where `undefined` used to be. Proven three ways: tests driving the
   **real** store through the **real** verifier against a real ES256 token
   (`read-verifier.service.spec.ts`), a store contract spec (`seed-saved-query.lookup.spec.ts`),
   and a DI wiring guard (`apps/api/src/read/read.module.spec.ts`). The built ESM `dist` was
   exercised directly as well. Full suite after the fix: **904 passed / 1 failed / 0 skipped,
   86 files** (+12 tests, +2 files; the one failure is still G-4), so the table row above that
   reads 892/84 is the pre-fix snapshot this addendum supersedes.
   **Gap #1's headline conclusion is unchanged** — the status page is still unreachable, for the
   larger reason below.

2. **New gap recorded — G-13: nothing mints a signed read link.** Tracing gap #1 to its root
   showed the `query` action was never the only unreachable route: `link-issuer.service.ts` is a
   documented Phase-2 stand-in returning an unsigned `/l/<appId>?u=...`, and the frozen claim set
   is never constructed outside tests. So **every** `/l/*` route (`view`, `query`, `edit`) is
   verification-only. A real issuer is KMS-backed ES256 and is blocked on the deliberately-open
   **FND-10** gate, so this was recorded rather than patched with a test key. DAT-14 is therefore
   `Partial (G-13)`: the wording of the reason changed, the failure did not.

3. **Gap #2 / the SC#5(a) escalation is resolved — no code changed.** The user ruled that
   **CON-05 stands**: the connector instance is the budgeted resource and `app_id` is the
   attribution label. SC#5(a) (`ROADMAP.md`) and CON-06 (`REQUIREMENTS.md`) were amended to match
   the implemented, test-pinned behaviour. The body's "SC#5(a) FAILED" line is a verdict against
   the *old* wording and is superseded. Full record: `05-GAPS.md` G-12.

Closed since the body: **G-9** (this artifact exists) and **G-11**. Still open and unchanged:
**G-4** (phase-2 entrypoint orphans — the suite's only failure), **G-13**, and the two human
items above (edit-link replay over HTTP, live Redmine delivery).
