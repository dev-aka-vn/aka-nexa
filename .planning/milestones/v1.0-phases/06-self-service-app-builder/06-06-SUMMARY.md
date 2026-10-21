---
phase: 06-self-service-app-builder
plan: 06
subsystem: api
tags: nestjs, csv-export, zod, rbac, audit, mongodb, testcontainers, field-mapping

# Dependency graph
requires:
  - phase: 06-self-service-app-builder plan 06-04
    provides: app-definition CRUD, publish gate, AppBuilderModule wiring
  - phase: 05
    provides: connector registry, ConnectorCredentialsRepository (AES-256-GCM), audited CLI provision seam
provides:
  - connector_requests collection with the one-pending-per-(app_id, connector_id) invariant
  - self-service connector request lifecycle (request/cancel/retry/reject + operator provision/reject)
  - owner-scoped submissions viewer with composed filters (status, date range, form)
  - visible-column CSV export via csv-stringify with the D-111 field allowlist
  - BLD-05 field-mapping endpoint (GET/PUT /apps/:id/routing/mapping)
affects: [06-self-service-app-builder plan 06-07, phase 07 connectors UI]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 48204
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Explicit factory providers with inject lists for every provider whose constructor takes dependencies (undecorated classes carry no design:paramtypes under tsc or the vitest transform)"
    - "Field allowlist applied before serialization (D-43/W-22 discipline) for any export surface"
    - "Fail-closed owner-scoping: non-owner and missing app are the same 404"

key-files:
  created:
    - packages/domain/src/builder/connector-request/connector-request.document.ts
    - packages/domain/src/builder/connector-request/connector-request.repository.ts
    - packages/domain/src/builder/connector-request/connector-request.service.ts
    - packages/domain/src/builder/data-routing/field-mapping.service.ts
    - packages/contract/src/builder/connector-request.contract.ts
    - packages/contract/src/builder/field-mapping.contract.ts
    - packages/contract/src/submissions/submissions.contract.ts
    - apps/api/src/app-builder/connector-request.controller.ts
    - apps/api/src/submissions/submission-export.service.ts
    - apps/api/src/submissions/submissions.module.ts
    - apps/api/src/submissions/viewer-row.ts
  modified:
    - packages/cli/provision.ts
    - apps/api/src/app-builder/app-builder.controller.ts
    - apps/api/src/app-builder/app-builder.module.ts
    - apps/api/src/app.module.ts
    - apps/api/src/read/read.module.ts
    - packages/domain/src/submissions/submission.repository.ts
    - packages/domain/src/index.ts
    - packages/contract/src/index.ts

key-decisions:
  - "csv-stringify 6.9.0 is the D-111 export writer (D-111 names csv-parse, which is the parser — the writer is its adaltas/node-csv sibling; pre-recorded in RESEARCH.md Open Question 5 as accepted)"
  - "The export's safe-reason column is the curated delivery message from projectSubmissionStatus — the read path's own projection — so the view and the export cannot disagree"
  - "Connector names are admin-authored free text and interpolate into the safe reason, so the export's quoting robustness is exercised through an admin-authored name carrying comma/quote/newline"
  - "ReadModule's four plain-bare-class providers with constructor deps converted to explicit factory providers — a latent DI gap (undecorated classes emit no design:paramtypes, so Nest instantiated them with undefined deps under tsc and vitest alike)"

patterns-established:
  - "Partial unique index + service-level named-error check for one-row invariants (one pending request per pair)"
  - "Zod response projection with no field that could carry a secret — credential isolation by construction (T-06-23)"
  - "Shared projection function (toViewerRow) between the view and the export so row counts agree by construction"

requirements-completed: [BLD-10, BLD-08, BLD-05]

coverage:
  - id: D1
    description: "Self-service connector request queue — POST /apps/:id/connector-requests carries the full connector definition minus the secret (D-99), lands pending, and the operator provisions it through the audited CLI seam (ConnectorCredentialsRepository.upsert + upsertConnector) to provisioned with the full AUD-01 trail"
    requirement: BLD-10
    verification:
      - kind: integration
        ref: "apps/api/src/app-builder/connector-request.integration.spec.ts#the operator provision flow resolves pending → provisioned through the audited CLI seam"
        status: pass
      - kind: integration
        ref: "apps/api/src/app-builder/connector-request.integration.spec.ts#POST /apps/:id/connector-requests creates a pending request carrying the full definition minus the secret"
        status: pass
      - kind: unit
        ref: "packages/domain/src/builder/connector-request/connector-request.service.spec.ts"
        status: pass
      - kind: unit
        ref: "packages/domain/src/builder/connector-request/connector-request.repository.spec.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Request lifecycle edges — owner cancel/retry (fresh request_id after a terminal state), operator reject with a reason on the status badge, the one-pending invariant (partial unique index + named CONNECTOR_REQUEST_PENDING_EXISTS error naming the protected request_id), credential isolation on every read path, and the unrelaxed D-100 KMS gate (CRYPTO_KEY_PROVIDER_REQUIRED on a production boot)"
    requirement: BLD-10
    verification:
      - kind: integration
        ref: "apps/api/src/app-builder/connector-request.integration.spec.ts#a second pending request for the same (app_id, connector_id) is refused, naming the pending request_id (T-06-24)"
        status: pass
      - kind: integration
        ref: "apps/api/src/app-builder/connector-request.integration.spec.ts#D-100: a production boot without KMS refuses the operator credential write — CRYPTO_KEY_PROVIDER_REQUIRED, nothing written"
        status: pass
      - kind: integration
        ref: "apps/api/src/app-builder/connector-request.integration.spec.ts#no response body from any builder read path carries a credential-named key (T-06-23)"
        status: pass
      - kind: unit
        ref: "packages/cli/provision.connector-requests.spec.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Owner-scoped submissions viewer — GET /submissions lists the requesting owner's own apps' submissions with composed filters (status, date range, form), a non-owner's app_id is a fail-closed 404, GET /submissions/:id is the owner-scoped detail view, and GET /submissions/export returns the visible-column CSV whose row count equals the filtered view count, whose header is exactly the visible columns, and which never exports a field outside the allowlist (PII-free by construction)"
    requirement: BLD-08
    verification:
      - kind: integration
        ref: "apps/api/src/submissions/submissions.integration.spec.ts#GET /submissions/export returns the visible-column CSV — row count equals the view count, no PII, audited"
        status: pass
      - kind: integration
        ref: "apps/api/src/submissions/submissions.integration.spec.ts#a non-owner is refused with 404 on the list (fail-closed owner-scoping)"
        status: pass
      - kind: unit
        ref: "apps/api/src/submissions/submission-export.service.spec.ts#never exports a field outside the allowlist — a PII key in the payload exports nothing for it"
        status: pass
      - kind: unit
        ref: "apps/api/src/submissions/submission-export.service.spec.ts#quotes embedded commas, quotes, and newlines — a reason carrying them round-trips as one logical row"
        status: pass
    human_judgment: false
  - id: D4
    description: "BLD-05 field-mapping endpoint — GET/PUT /apps/:id/routing/mapping stores the form-field → connector-field mapping on the app definition's field-mapping section (version-bumped, APP-03), Zod-validated as a string→string record, owner-scoped fail-closed, and audited as a field_mapping.stored transition"
    requirement: BLD-05
    verification:
      - kind: unit
        ref: "packages/domain/src/builder/data-routing/field-mapping.service.spec.ts#stores the mapping on the field-mapping section and round-trips it through getMapping"
        status: pass
      - kind: unit
        ref: "packages/domain/src/builder/data-routing/field-mapping.service.spec.ts#is owner-scoped, fail-closed — a non-owner gets the same APP_NOT_FOUND as a missing app"
        status: pass
      - kind: unit
        ref: "packages/domain/src/builder/data-routing/field-mapping.service.spec.ts#appends an audited field_mapping.stored AUD-01 entry with the version transition"
        status: pass
    human_judgment: false

# Metrics
duration: 96min
completed: 2026-10-12
status: complete
---

# Phase 6 Plan 06: Self-Service App Builder Summary

**Connector request queue with operator CLI provision (BLD-10), owner-scoped submissions viewer with a visible-column csv-stringify export (BLD-08), and the BLD-05 field-mapping endpoint**

## Performance

- **Duration:** 96 min
- **Started:** 2026-10-12T11:49:30Z
- **Completed:** 2026-10-12T13:25:22Z
- **Tasks:** 3
- **Files modified:** 28 (5,529 insertions)

## Accomplishments

- **BLD-10 boundary delivered end-to-end:** a department admin POSTs the full connector definition minus the secret (D-99); the request lands `pending` in `connector_requests` with a `connector_request.requested` AUD-01 entry; a platform operator fills the credential through the existing audited CLI seam (`ConnectorCredentialsRepository.upsert`, AES-256-GCM, behind the unrelaxed D-100 KMS guard) and registers via `upsertConnector`; the request reaches `provisioned` with `resolvedAt` and the opaque `credential_ref` handle — no platform admin touched the builder UI.
- **Lifecycle edges (D-98):** owner cancel (`pending → rejected`, "cancelled by owner"), owner retry (a fresh `request_id` carrying the definition but never the reason/`resolvedAt`/`credential_ref`, only after the pair's record is terminal), operator reject with a reason the admin sees on the status badge — every transition an audited AUD-01 event with `previous_state`/`new_state`.
- **One-pending invariant (T-06-24):** partial unique index on `{app_id, connector_id}` where `state = 'pending'` plus a service-level check whose named error (`CONNECTOR_REQUEST_PENDING_EXISTS`) names the protected `request_id`.
- **Credential isolation by construction (T-06-23):** the Zod response schema has no field that could carry a secret; specs assert no response body contains a key matching `/secret|credential_value|plaintext/i` and no envelope-shaped object.
- **BLD-08 viewer:** `GET /submissions?app_id&status&from&to&form` lists the owner's own apps' submissions (soft-deleted invisible, newest first); a non-owner's `app_id` is a fail-closed 404; `GET /submissions/:id` is the owner-scoped detail view.
- **BLD-08 export (D-111):** `GET /submissions/export` returns `text/csv` whose header is exactly the seven visible columns (`submission_id, app_id, form_id, status, submitted_at, downstream_reference, reason`), whose row count equals the filtered view count by construction (the view and the export share one projection path), which quotes embedded commas/quotes/newlines via csv-stringify, and which never exports a field outside the allowlist — a PII key in the payload exports nothing for it. Every export is an audited `submissions.exported` AUD-01 event naming the owner and the filter set.
- **BLD-05 field mapping:** `GET/PUT /apps/:id/routing/mapping` stores the form-field → connector-field mapping on the definition's `field-mapping` section (version-bumped, APP-03), Zod-validated as a strict string→string record, owner-scoped fail-closed, audited as `field_mapping.stored`.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end connector request** - `39226507` (feat)
2. **Task 2: Request lifecycle edges** - `59e8e94c` (feat)
3. **Task 3: Submissions viewer + CSV export + field-mapping endpoint** - `74692a2a` (feat)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `packages/domain/src/builder/connector-request/*` — document, repository (partial unique index), service, errors
- `packages/domain/src/builder/data-routing/field-mapping.service.ts` — BLD-05 mapping store
- `packages/contract/src/builder/connector-request.contract.ts` — definition + credential-free response projection
- `packages/contract/src/builder/field-mapping.contract.ts` — mapping PUT/response contracts
- `packages/contract/src/submissions/submissions.contract.ts` — viewer filters + projected row (the export allowlist)
- `apps/api/src/app-builder/connector-request.controller.ts` — POST/GET list/GET single/cancel/retry
- `apps/api/src/submissions/submission-export.service.ts` — allowlist projection → csv-stringify → CSV
- `apps/api/src/submissions/submissions.controller.ts` — viewer list/detail/export endpoints
- `apps/api/src/submissions/submissions.module.ts` + `viewer-row.ts` — module + shared projection
- `packages/cli/provision.ts` — `provisionConnectorRequests` operator flow
- `apps/api/src/read/read.module.ts` — explicit factory providers + exports
- `apps/api/src/app-builder/app-builder.module.ts` — FieldMappingService provider + module exports
- `apps/api/src/app-builder/app-builder.controller.ts` — mapping routes + SUBMISSION_NOT_FOUND status
- `apps/api/src/app.module.ts` — SubmissionsModule registration
- `packages/domain/src/submissions/submission.repository.ts` — `listByApp` + `findById`
- Barrels: `packages/domain/src/index.ts`, `packages/contract/src/index.ts`

## Decisions Made

- **csv-stringify 6.9.0 is the D-111 writer** (not csv-parse — that is the parser; the writer is its adaltas/node-csv sibling, MIT, already pinned in the root package.json). Pre-recorded in RESEARCH.md Open Question 5 as accepted.
- **The safe-reason column is the curated delivery message** from `projectSubmissionStatus` — the read path's own projection — so the view and the export cannot disagree, and raw submission content never reaches the CSV.
- **Quoting robustness is exercised through an admin-authored connector name**: connector names are free text that interpolates into the safe reason, so a name carrying a comma, quote, and newline proves csv-stringify's quoting round-trips as one logical row.
- **The downstream reference comes from the latest revision** (`SubmissionRevisionsRepository.findLatest`) — the external system's opaque handle, present only on confirmed delivery.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] ReadModule's bare-class providers with constructor deps converted to explicit factory providers**
- **Found during:** Task 3 (submissions integration spec) — the first spec to boot ReadModule with its real providers
- **Issue:** `SubmissionRepository`, `SubmissionRevisionsRepository`, `DataRouterService`, and `PermissionCheckService` were declared as bare-class providers, but undecorated classes carry no `design:paramtypes` metadata — tsc emits nothing for them either (verified with a compile probe), so Nest instantiated them with `undefined` dependencies. Any production request touching the revisions store, the data router, or the permission checker would 500.
- **Fix:** Converted all four to factory providers with explicit `inject` lists — the module-wiring discipline the codebase already documents ("explicit tokens make the graph identical in the test runner and in production"). `LinkTokenStore`/`SignatureFailureLimiter` were left as-is: their `@Inject(REDIS_CACHE)` parameter decorators resolve by index and are unaffected.
- **Files modified:** apps/api/src/read/read.module.ts
- **Verification:** The submissions integration spec boots ReadModule against real Mongo/Redis and exercises the revisions store end-to-end; the read.module wiring guard still passes.
- **Committed in:** 74692a2a (part of the Task 3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 2)
**Impact on plan:** The fix is required for the plan's own integration spec to pass and repairs a latent production gap in the module the plan mounts. No scope creep — no new endpoints or behaviors beyond the plan.

## Issues Encountered

- The plan's `<files>` list for Task 3 did not include `app-builder.module.ts` (the FieldMappingService provider wiring) or `read.module.ts` (module exports + provider wiring) — both are required for the endpoints to exist in the DI graph. Added as part of Task 3 (Rule 2: wiring is a correctness requirement, not a feature).
- `csv-stringify`'s ESM surface exposes the writer as a named export (`import { stringify } from 'csv-stringify'`); the `/sync` subpath has no default export under ESM — the async callback API is the canonical form and is what the service uses.

## User Setup Required

None - no external service configuration required. csv-stringify 6.9.0 was already pinned in the root package.json (plan 01); no installs were added.

## Next Phase Readiness

- The builder's self-service connector flow is complete: request → pending → operator provision → provisioned, with the full AUD-01 trail.
- The submissions viewer and its audited, PII-free CSV export are live behind the owner-scoping boundary.
- The field-mapping endpoint's data contract (BLD-05) is proven; the visual mapping UX (the drag/select surface) is plan 06-07 per the plan's edge-probe note.
- Deferred (out of scope, pre-existing): none opened by this plan beyond the ReadModule fix above.

---
*Phase: 06-self-service-app-builder*
*Completed: 2026-10-12*

## Self-Check: PASSED

- SUMMARY.md exists at `.planning/phases/06-self-service-app-builder/06-06-SUMMARY.md`
- All 7 key created files verified on disk
- All 3 task commits verified in git history: `39226507`, `59e8e94c`, `74692a2a`
- Measured commit count: `git rev-list --count 9061efb9..HEAD` = 3 (matches frontmatter)
