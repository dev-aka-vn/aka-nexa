---
phase: 06-self-service-app-builder
verified: 2026-10-13T05:30:00Z
status: gaps_found
score: 22/25 must-haves verified
covered_files: [".planning/phases/06-self-service-app-builder/06-01-PLAN.md",".planning/phases/06-self-service-app-builder/06-01-SUMMARY.md",".planning/phases/06-self-service-app-builder/06-02-PLAN.md",".planning/phases/06-self-service-app-builder/06-02-SUMMARY.md",".planning/phases/06-self-service-app-builder/06-02-deferred-items.md",".planning/phases/06-self-service-app-builder/06-03-PLAN.md",".planning/phases/06-self-service-app-builder/06-03-SUMMARY.md",".planning/phases/06-self-service-app-builder/06-04-PLAN.md",".planning/phases/06-self-service-app-builder/06-04-SUMMARY.md",".planning/phases/06-self-service-app-builder/06-05-PLAN.md",".planning/phases/06-self-service-app-builder/06-05-SUMMARY.md",".planning/phases/06-self-service-app-builder/06-06-PLAN.md",".planning/phases/06-self-service-app-builder/06-06-SUMMARY.md",".planning/phases/06-self-service-app-builder/06-07-PLAN.md",".planning/phases/06-self-service-app-builder/06-07-SUMMARY.md",".planning/phases/06-self-service-app-builder/06-08-PLAN.md",".planning/phases/06-self-service-app-builder/06-08-SUMMARY.md",".planning/phases/06-self-service-app-builder/06-CONTEXT.md",".planning/phases/06-self-service-app-builder/06-DISCUSSION-LOG.md",".planning/phases/06-self-service-app-builder/06-PATTERNS.md",".planning/phases/06-self-service-app-builder/06-RESEARCH.md",".planning/phases/06-self-service-app-builder/06-REVIEW-DISPOSITION.md",".planning/phases/06-self-service-app-builder/06-REVIEW.md",".planning/phases/06-self-service-app-builder/06-VALIDATION.md",".planning/phases/06-self-service-app-builder/COVERAGE.md",".planning/phases/06-self-service-app-builder/deferred-items.md","apps/api/src/app-builder/app-builder.controller.ts","apps/api/src/app-builder/connector-request.controller.ts","apps/api/src/app-builder/publish.controller.ts","apps/api/src/app-builder/transfer-approval.controller.ts","apps/api/src/app-builder/transfer-request.controller.ts","apps/api/src/audit/audit.controller.ts","apps/api/src/auth/auth.controller.ts","apps/api/src/auth/auth.module.ts","apps/api/src/auth/oidc-issuer.stub.ts","apps/api/src/auth/oidc.service.ts","apps/api/src/auth/session.middleware.ts","apps/api/src/main.ts","apps/api/src/read/read.controller.ts","apps/api/src/read/read.module.ts","apps/api/src/submissions/submission-export.service.ts","apps/api/src/submissions/submissions.controller.ts","apps/api/src/submissions/viewer-row.ts","apps/api/src/users/users.controller.ts","apps/app-builder/src/api/client.ts","apps/app-builder/src/apps/AppsPage.tsx","apps/app-builder/src/apps/TagFilter.tsx","apps/app-builder/src/audit/AuditPage.tsx","apps/app-builder/src/auth/session.client.ts","apps/app-builder/src/connectors/ConnectorRequestForm.tsx","apps/app-builder/src/connectors/ConnectorsPage.tsx","apps/app-builder/src/dashboard/DashboardPage.tsx","apps/app-builder/src/editor/EditorPage.tsx","apps/app-builder/src/error/InlineError.tsx","apps/app-builder/src/form-designer/FormioBuilderField.tsx","apps/app-builder/src/form-designer/bootstrap5Templates.ts","apps/app-builder/src/form-designer/sandbox.ts","apps/app-builder/src/form-designer/undoHistory.ts","apps/app-builder/src/roles/PermissionMatrix.tsx","apps/app-builder/src/roles/RolesPage.tsx","apps/app-builder/src/roles/UserAutocomplete.tsx","apps/app-builder/src/settings/SettingsPage.tsx","apps/app-builder/src/submissions/SubmissionDetailDrawer.tsx","apps/app-builder/src/submissions/SubmissionsPage.tsx","apps/app-builder/src/ui/Skeleton.tsx","apps/app-builder/src/users/UsersPage.tsx","apps/app-builder/src/wizard/WizardPage.tsx","apps/scheduler/src/transfer-auto-cancel.registration.ts","apps/worker/src/processors/inbound-event.processor.ts","apps/worker/src/processors/otp-delivery.service.ts","apps/worker/src/processors/transfer-auto-cancel.processor.ts","packages/cli/provision.ts","packages/domain/src/acl/transfer-request.service.ts","packages/domain/src/audit/audit.repository.ts","packages/domain/src/authz/builder-ability.ts","packages/domain/src/authz/permission-check.service.ts","packages/domain/src/authz/rbac-cache.service.ts","packages/domain/src/authz/rbac.service.ts","packages/domain/src/builder/app-definition.service.ts","packages/domain/src/builder/app-lifecycle.ts","packages/domain/src/builder/connector-request/connector-request.service.ts","packages/domain/src/builder/data-access/app-definition.repository.ts","packages/domain/src/builder/data-routing/field-mapping.service.ts","packages/domain/src/builder/publish-gate.service.ts","packages/domain/src/builder/routing-share/routing-outcome.repository.ts","packages/domain/src/builder/routing-share/routing-share.computer.ts","packages/domain/src/builder/routing-share/routing-share.metrics.ts","packages/domain/src/builder/saved-query.backfill.ts","packages/domain/src/builder/saved-query.repository.ts","packages/domain/src/builder/template/tag-set.ts","packages/domain/src/builder/template/template.seed.ts","packages/domain/src/datarouter/data-router.service.ts","packages/domain/src/decision/published-app-loader.ts","packages/domain/src/decision/routing-orchestrator.ts","packages/domain/src/identity/oidc-provision.service.ts","packages/domain/src/identity/otp/otp-onboarding.service.ts","packages/domain/src/identity/otp/otp-state-machine.ts","packages/domain/src/identity/sso-mapping.service.ts","packages/domain/src/links/link-issuer.service.ts","packages/domain/src/links/link-token.store.ts","packages/domain/src/links/read-verifier.service.ts","playwright.config.ts","tooling/boundaries.config.mjs","tooling/deployment-shape.spec.ts","tooling/entrypoint-drift.spec.ts","tooling/onboarding.spec.ts","vitest.config.mts"]
covered_digest: "v2:sha256:b879f661acbce300493037d27d8cc7299765882e8123cd70406cdf98e6f56871"
behavior_unverified: 1
overrides_applied: 0
gaps:
  - truth: "APP-06: an archived app accepts no new submissions"
    status: failed
    reason: >-
      The lifecycle guard AppLifecycle.assertAcceptsSubmissions (SUBMISSION_REFUSED_ARCHIVED)
      exists and is unit-tested, but it is never called on the real submission-write path.
      The plan (06-04-PLAN.md task 2) explicitly required "the submission-creation seam
      (the repository that writes submission records) calls the lifecycle guard
      assertAcceptsSubmissions(appId)". The actual path — renderer apps/renderer/src/read/edit.ts
      POST /l/edit/:jti → apps/api/src/read/read.controller.ts editPost →
      packages/domain/src/datarouter/data-router.service.ts routeEdit — inserts
      submission_revisions + outbox rows with no lifecycle check anywhere in the chain
      (grep: assertAcceptsSubmissions has zero callers outside the service and specs).
      The integration spec that should prove the invariant (app-definition.integration.spec.ts
      "APP-06 both ways") calls service.assertAcceptsSubmissions(...) directly instead of
      exercising the real path, so it passes without proving the invariant holds on the
      path. Effect: an edit link issued while the app was published still accepts
      submissions after the app is archived. The second APP-06 clause (pre-archived view
      links still resolve) IS enforced — the ReadVerifierService is deliberately unchanged.
    artifacts:
      - path: packages/domain/src/datarouter/data-router.service.ts
        issue: routeEdit/routeSubmission write submission records without consulting the app lifecycle
      - path: apps/api/src/read/read.controller.ts
        issue: editPost routes the submission without a lifecycle check
      - path: packages/domain/src/builder/app-definition.service.ts
        issue: assertAcceptsSubmissions seam exists but has no production caller
      - path: apps/api/src/app-builder/app-definition.integration.spec.ts
        issue: tests the seam directly rather than the real submission path
    missing:
      - "Call definitions.assertAcceptsSubmissions(appId) in DataRouterService.routeEdit (and routeSubmission) before the transaction, or in read.controller.ts editPost before routeEdit — the refusal must surface as SUBMISSION_REFUSED_ARCHIVED, not a silent insert"
      - "Re-point the APP-06 integration spec at the real path: archive an app, then POST /l/edit/:jti with a pre-archived link, and assert the refusal (not a direct service call)"
  - truth: "BLD-06: publishing shows a confirmation dialog summarising every change, and a save is possible with a keyboard shortcut"
    status: failed
    reason: >-
      The change-summary half is fully implemented (PublishGateService.buildChangeSummary
      rides the publish payload and the AUD-01 entry). The keyboard-shortcut half is
      silently dropped: 06-05-PLAN.md scoped it to plan 07 ("the shortcut itself is
      wired in plan 07 against this contract"), but 06-07-PLAN.md and 06-07-SUMMARY.md
      never mention it, and no keydown/Ctrl+S/Cmd+S handler exists anywhere in
      apps/app-builder/src (grep for keydown/metaKey/ctrlKey finds no modifier-key
      listener). The requirement clause is unmet and the drop is undocumented — no
      deviation record, no deferred item.
    artifacts:
      - path: apps/app-builder/src/editor/EditorPage.tsx
        issue: no keyboard-shortcut save handler (the publish modal's save is button-only)
      - path: .planning/phases/06-self-service-app-builder/06-07-PLAN.md
        issue: the plan that was to wire the shortcut never mentions it
    missing:
      - "A Ctrl/Cmd+S keydown handler in the editor/publish modal that fires the same POST /apps/:id/publish endpoint (per 06-05-PLAN.md's contract: no separate save endpoint), or an explicit descope recorded in 06-07-SUMMARY.md deviations"
deferred: []
advisory:
  - finding: "IN-01: IdentityMappingRepository/ProfileRepository are in-memory (pre-existing Phase 1/2 state)"
    category: architectural
    reason: >-
      Dispositioned `deferred` in 06-REVIEW-DISPOSITION.md with rationale: the OTP state
      machine is correctly Redis-backed (AD-9 invariants for attempt counters/lockouts are
      unaffected), SSO mappings are Mongo-backed, and closing the gap means reworking the
      identity layer across phases. Tracked for the identity-multi-instance plan. Recorded
      here so it survives this verification; not a Phase 6 regression.
    evidence_status: "dispositioned deferred in 06-REVIEW-DISPOSITION.md"
  - finding: "PermissionGuard (@casl/ability route guard) is a stub applied to no route"
    category: architectural
    reason: >-
      Per the codebase's own module comments and the CR-01 disposition, the @casl/ability
      PermissionGuard wiring is plan-07 work; the service-boundary owner gate (assertOwner,
      fail-closed AppNotFoundError) is the authoritative Phase 6 enforcement and is wired
      into every builder service (app-definition, connector-request, transfer-request,
      field-mapping) and the owner-scoped controllers. createBuilderAbility is implemented
      and spec-tested as the derivation the guard will consume. Not a gap for this phase;
      flagged so the follow-up does not lose the thread.
    evidence_status: "documented in 06-REVIEW-DISPOSITION.md (CR-01) and module comments"
behavior_unverified_items:
  - truth: "BLD-09: the App Builder is usable on a tablet (768×1024, touch) and shows loading skeletons for every async operation"
    test: >-
      Run the Playwright tablet project (npx playwright test --project=tablet) against the
      wizard/designer specs, and perform one manual touch pass on a real tablet. The
      skeleton halves are structural and present on every async page (Dashboard, Apps,
      Editor, FormDesigner, Roles, Submissions, Connectors, Audit, Users — all render
      layout-shaped Skeleton components while loading); the tablet-usability half is a
      human judgement the emulated viewport only approximates.
    expected: >-
      The tablet project's specs pass (wizard create flow + designer add-component path at
      768×1024 with touch), and a human touch pass finds the wizard, editor and designer
      usable without a mouse.
    why_human: >-
      Playwright could not execute in this verification environment: the Chromium
      headless shell fails to launch (libatk-1.0.so.0 missing; no root to install OS
      deps). The specs exist and are correctly configured (playwright.config.ts tablet
      project, 768×1024, hasTouch, isMobile; API stubbed via page.route), but their
      execution is unproven here. Skeleton presence is verified by code inspection;
      tablet usability is not.
human_verification:
  - test: "Live OTP delivery through the chat pipeline (IDN-05): trigger the onboarding keyword from an unmapped Slack identity, receive the 6-digit code in Slack, reply, and confirm the identity mapping is created and the granted app becomes usable"
    expected: "The code arrives via Slack DM within seconds; the reply verifies, creates the mapping, and the next inbound event resolves the user"
    why_human: >-
      Declared manual-verify item (06-VALIDATION.md). The worker's OtpDeliveryService
      (apps/worker/src/processors/otp-delivery.service.ts) implements OtpDeliveryPort by
      logging the chat identity only — the real Slack DM leg is deliberately not wired
      until staging. Everything else (state machine, timing, lockout, single-use, mapping
      creation, pipeline wiring) is implemented and integration-tested over real Redis.
  - test: "Walk the 5-step wizard with no prior context (BLD-01): create an app end-to-end without reading any documentation"
    expected: "Each step is self-explanatory; step 1 creates the draft and toasts 'Saved as a draft · continue through the wizard steps'; forward navigation blocks until each step validates"
    why_human: "'Without documentation' is a human judgement (06-VALIDATION.md manual-only row). The wizard implementation matches the mockup's step rail and copy, and the e2e wizard.spec.ts encodes the flow, but the e2e suite could not execute in this environment (Chromium OS deps unavailable)."
  - test: "Execute the Playwright e2e suite (npx playwright test) on a machine with browser OS deps installed"
    expected: "The chromium and tablet projects pass across wizard.spec.ts, designer.spec.ts, roles.spec.ts, editor.spec.ts, dashboard.spec.ts, submissions.spec.ts, connectors.spec.ts, s1-spike.spec.ts"
    why_human: >-
      Environmental: this sandbox cannot launch Chromium (libatk-1.0.so.0 missing, no
      root). The specs are present, configured (desktop chromium + tablet projects,
      vite webServer, page.route API stubs), and the vitest suite behind them is green —
      but the e2e execution itself is unverified here.
  - test: "Confirm the wizard's tablet pass and the publish modal's change-summary rows render as the mockup specifies (BLD-06 confirmation dialog, BLD-09 skeletons)"
    expected: "The publish confirmation lists exactly the changed rows (status, version, form versions, indexes, triggers); skeletons replace each widget's layout while loading"
    why_human: "Visual rendering confirmation — the payload shape is unit-tested (buildChangeSummary) but the dialog's visual fidelity to prototypes/mockup.html:1580-1585 needs a human eye."
---

# Phase 6: Self-Service App Builder Verification Report

**Phase Goal:** A department admin builds, secures, and publishes a working app end-to-end without an engineering ticket and without a platform admin's help.
**Verified:** 2026-10-13T05:30:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Verdict: NO-GO (two requirement clauses unmet; everything else verified)

The end-to-end self-service flow is built and largely proven: SSO login (OIDC + PKCE + MFA gate), the 5-step wizard, the tabbed editor, the FormIO designer, the publish gate (routing dry-run + description collision + change summary), connector requests with operator provisioning, OTP self-onboarding, the submissions viewer with allowlist export, ownership transfer with global-admin approval and 7-day auto-cancel, and the `routing_share{app_id}` metric. The full vitest suite reproduces the claimed state in this session (123 files / 1194 tests, 1193 passed / 1 documented pre-existing failure), and `npm run build` exits 0.

Two must-have truths fail:

1. **APP-06 — an archived app accepts no new submissions (BLOCKER).** The guard exists and is unit-tested, but the plan's explicit wiring requirement ("the repository that writes submission records calls the lifecycle guard") is unmet: the real submission path (renderer POST `/l/edit/:jti` → `read.controller.ts editPost` → `data-router.service.ts routeEdit`) writes submission records with no lifecycle check, and the integration spec tests the seam directly instead of the path. An edit link issued while an app was published still accepts submissions after the app is archived.
2. **BLD-06 — keyboard-shortcut save (minor).** The Ctrl/Cmd+S save was scoped to plan 07 by plan 05, then silently dropped — plan 07 never mentions it, no handler exists in the SPA, and no deviation records the drop. The change-summary confirmation half of BLD-06 is fully implemented.

Closing gap 1 is a small, well-localized fix (one guard call in `routeEdit`/`routeSubmission` or `editPost`, plus re-pointing the integration spec at the real path). Gap 2 is either a one-line keydown handler or an explicit descope. Neither requires replanning.

## Goal Achievement

### Observable Truths (requirement-level)

| # | Requirement | Truth | Status | Evidence |
| --- | ----------- | ----- | ------ | -------- |
| 1 | BLD-01 | Non-developer creates an app in 5 wizard steps without documentation | ✓ VERIFIED | `apps/app-builder/src/wizard/WizardPage.tsx` — locked 5-step rail (Basics→Triggers→RBAC→Form→Routing), step 1 POSTs /apps and toasts the mockup's exact copy; inline validation gates forward navigation; e2e `wizard.spec.ts` encodes the flow (could not execute here — see Human Verification) |
| 2 | BLD-02 | Owner edits all sections from a tabbed editor | ✓ VERIFIED | `EditorPage.tsx` + `sections.ts` — the twelve contract sections as tabs, each a section PATCH (`PATCH /apps/:id` `{section, patch}`), one audited version bump per edit |
| 3 | BLD-03 | Custom roles with arbitrary permission sets; assign by name/email autocomplete | ✓ VERIFIED | `builder-ability.ts` custom-role branch (`operate` exactly the granted subset, spec-tested); `GET /users/search?q=` (MD-01 fix, name-or-email prefix → opaque real_user_id); `RolesPage`/`PermissionMatrix`/`UserAutocomplete` |
| 4 | BLD-04 | Drag-and-drop designer with undo/redo over the last 50 actions | ✓ VERIFIED | `FormioBuilderField.tsx` — guarded dynamic `@formio/js` Formio.builder() mount (Pattern 1/4); `undoHistory.ts` SchemaHistory — debounced `builder.schema` snapshots restored via `setForm()`, 50-entry ring buffer, redo cleared on new capture; `undoHistory.spec.ts` + e2e `designer.spec.ts` |
| 5 | BLD-05 | Visual form-field → connector-field mapping | ✓ VERIFIED | `FieldMappingService` (owner-scoped, Zod-validated, audited) + `PATCH /apps/:id` field-mapping section + `FormDesignerPage` mapping surface pairing form keys against connector fields |
| 6 | BLD-06 | Publish confirmation summarises every change; save via keyboard shortcut | ✗ FAILED (partial) | Change summary: ✓ `buildChangeSummary` rides the publish payload and the AUD-01 entry, zero-change publishes named inline. Keyboard shortcut: ✗ no Ctrl/Cmd+S handler exists anywhere in the SPA; dropped between plan 05 and plan 07 without a deviation record (see Gaps) |
| 7 | BLD-07 | Errors inline, specific, actionable — never generic | ✓ VERIFIED | `BuilderExceptionFilter` maps every `BuilderError` code to a status + `{error:{code,message}}`; `InlineError` with operation name + retry on every async page; named refusals throughout (APP_NOT_FOUND, SUBMISSION_REFUSED_ARCHIVED, GLOBAL_ADMIN_REQUIRED, AUTH_MFA_REQUIRED…) |
| 8 | BLD-08 | Submission viewer: filters, detail, export | ✓ VERIFIED | `SubmissionsController` — `GET /submissions` (status/date-range/form filters compose), `GET /submissions/:id` detail, `GET /submissions/export` via `SubmissionExportService`: rows projected through the 6-column allowlist *before* `csv-stringify` serialization (D-111), export audited; owner-scoped fail-closed (non-owner = 404) |
| 9 | BLD-09 | Tablet-usable; loading skeletons for every async operation | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Skeletons: ✓ layout-shaped `Skeleton` on every async page (all 10 SPA pages render skeleton slots while loading, inline error replaces skeleton on failure). Tablet usability: e2e tablet project (768×1024, touch) is configured but could not execute here (Chromium OS deps missing) — human verification |
| 10 | BLD-10 | Department admin requests a connector and publishes external/hybrid without a platform admin | ✓ VERIFIED | `ConnectorRequestService.request` (full definition minus secret, D-99 `.strict()` contract, one-pending invariant, owner-scoped fail-closed) → `packages/cli/provision.ts provisionConnectorRequests` (D-100 KMS guard first, credential through the AES-256-GCM `ConnectorCredentialsRepository.upsert` seam, request → provisioned, audited); app publishes once provisioned |
| 11 | BLD-11 | Delegated workflow manager operates without ownership | ✓ VERIFIED | `builder-ability.ts` manager role: `operate` every section, no lifecycle/transfer/role-assignment — spec-tested ("a delegated workflow manager operates the app without lifecycle, transfer, or role assignment") |
| 12 | BLD-12 | OIDC SSO with MFA; user manages only apps they own or administer | ✓ VERIFIED | `OidcService` begin/callback (authorization code + PKCE S256, state verified server-side before any exchange, `acr`/`amr` MFA gate → AUTH_MFA_REQUIRED, D-104 auto-provision, session TTL tracks the IdP session with single-flight renewal); `SessionMiddleware` (CSRF origin check, `__Host-` cookie, opaque Redis session); every builder service enforces `assertOwner` (fail-closed 404) — CR-01 fix verified; `auth.session.integration.spec.ts` 14 tests over the real flow with the in-repo StubOidcIssuer |
| 13 | APP-03 | Versioned definition, last 20 versions retained, rollback | ✓ VERIFIED | `AppDefinitionRepository` — every mutation writes a full snapshot to `app_definition_versions` (compound unique index (app_id, version)), `RETAINED_VERSIONS = 20` with oldest-eviction; rollback re-writes a retained snapshot at a new version (audited `app.rollback`); `app-definition.versions.spec.ts` + `app-lifecycle.spec.ts` 27 tests |
| 14 | APP-05 | Deprecated app stays functional, shows notice, registers no new triggers | ✓ VERIFIED | `AppLifecycle.assertTransition` legal-transition table (deprecated→published re-activation legal); deprecate stores the owner notice on the definition (served on every surface); no-new-triggers enforced structurally — `PublishedAppLoader.listAuthorized` includes only `status === 'published'`, so deprecated/archived apps never enter the routing distribution; `assertRegistersTriggers` seam guards the future registration path |
| 15 | APP-06 | Archived app accepts no new submissions; existing view links still resolve | ✗ FAILED (partial) | View links: ✓ ReadVerifierService deliberately unchanged — pre-archived links verify. No-new-submissions: ✗ the `assertAcceptsSubmissions` guard is never called on the real submission-write path (routeEdit inserts regardless of lifecycle); the integration spec calls the seam directly instead of the path (see Gaps — BLOCKER) |
| 16 | APP-07 | Publish runs a routing dry-run and blocks a >5-point routing-share drop | ✓ VERIFIED | `PublishGateService.evaluate` — read-only dry-run executes the **real** `RoutingOrchestrator` over the candidate's labelled intent set (excluded vs included runs), share computed per existing app against its own pre-publish share over the rolling 24h `RoutingOutcomeRepository` window; strictly-greater-than threshold (exactly 5.00 passes, 5.01 blocks) with a named refusal identifying app_id + delta; blocked publish leaves all state untouched; `publish-gate.service.spec.ts` 14 tests + `publish.integration.spec.ts` |
| 17 | APP-08 | Publishing rejects a description-colliding app | ✓ VERIFIED | `descriptionsCollide` — case-folded token Jaccard ≥ 0.90 (or exact equality after folding) against published apps only; named refusal naming the colliding app_id |
| 18 | APP-09 | App tagged and filterable by tag; ~10 seed templates ship | ✓ VERIFIED | `template.seed.ts` — exactly 10 frozen seeds across the D-106 domains (6 internal + leave/travel/procurement/asset/HR/ticketing + crm/expense/facilities/redmine external-hybrid examples), content-hash-guarded idempotent loader, `forkTemplate` deep-copies to a user-owned draft with **no origin-reference field**; curated tag vocabulary enforced (`assertCuratedTags` names the allowed set on refusal); `AppsPage` + `TagFilter` |
| 19 | FRM-05 | Conditional show/hide and validation rules (required, pattern, min/max, custom) | ✓ VERIFIED | Native FormIO component properties (`conditional`, `validate`), authored in the builder's component edit form; the 06-01 spike verified the 5.x error shapes (`component.errors[0].message`, `EditGrid.validateRows` returns array); min/max boundary asserted in the authored schema and the preview submission path |
| 20 | FRM-09 | Draft preview with sandbox submissions before publishing | ✓ VERIFIED | `sandbox.ts` — in-memory submission buffer (never the real submissions collection) + `PreviewPane`; the designer renders the draft through the FormIO renderer |
| 21 | IDN-05 | Employee self-onboards by OTP: 10-min expiry, 3 attempts, 30-min lockout | ✓ VERIFIED (live delivery leg → human) | `OtpStateMachine` — Redis-backed, atomic Lua scripts (request/verify), injectable clock; `otp-state-machine.spec.ts` 13 tests over real Redis prove the exact boundaries (9:59 verifies / 10:01 OTP_EXPIRED; 3rd failure arms the 30-min lockout measured from that failure; 4th refused; replay refused as consumed; cross-identity refusal; concurrent INCR atomicity). Wired into `inbound-event.processor.ts` (unmapped-user path: keyword requests, 6-digit reply verifies, verified → mapping created). Live Slack DM leg is the declared manual-verify item (OtpDeliveryService logs only) |
| 22 | IDN-08 | Admin maps an SSO identity to a real_user_id without the user verifying anything | ✓ VERIFIED | `POST /users/sso-mappings` — global-admin-gated (service-level `assertGlobalAdmin`), Zod-validated, no OTP on this path (deliberately separate from IDN-05); `sso-mapping.integration.spec.ts` over real HTTP + stub issuer |
| 23 | ACL-05 | Ownership transfer requires global-admin approval; auto-cancels after 7 days | ✓ VERIFIED | `TransferRequestService` — owner requests (fail-closed, 7-day `expiresAt`), `approve`/`reject` guarded by a **service-level** `assertGlobalAdmin` (GLOBAL_ADMIN_REQUIRED fires before any read/write — the non-admin refusal holds even when called directly); approval resolves the record first (atomic — closes the LO-01 double-approval window) then moves ownership in the same transition; `autoCancelExpired` is idempotent, consumed hourly by the scheduler-registered `transfer-auto-cancel` Job Scheduler + worker processor; `transfer-request.service.spec.ts` 10 tests + `transfer.integration.spec.ts` |
| 24 | ACL-10 | Owner views/modifies all role assignments except ownership transfer | ✓ VERIFIED | `createBuilderAbility` — owner: `manage` every section + `request-transfer` on ownership; `transfer-execution` is granted by **no rule to any role** (a rule omission, not a runtime check — the ACL-10 carve-out); owner cannot execute a transfer (only request); spec-tested |
| 25 | OBS-05 | `routing_share{app_id}` is exported | ✓ VERIFIED | `routing-share.metrics.ts` — OTel `ObservableGauge` on the single meter provider (no prom-client), `app_id` attribute, observation callback reads the `RoutingShareComputer` fresh at scrape; the gauge and the APP-07 dry-run read the **same** `RoutingOutcomeStore` seam so metric and gate cannot disagree; the rolling 24h window is filled by the live chat pipeline (`inbound-event.processor` records every applied routing outcome at the point the orchestrator's outcome is applied) |

**Score:** 22/25 requirement truths verified (1 present-but-behavior-unverified: BLD-09 tablet usability; 2 failed: APP-06, BLD-06)

### Deferred Items

No roadmap-later-phase deferrals apply to the two failed truths — Phase 7 (Multi-IM Expansion) covers Teams/webhooks, not archived-submission gating or the builder keyboard shortcut. Both gaps are this phase's own must-haves.

### Advisory (New Scope, Unevidenced)

| # | Finding | Category | Why Advisory |
|---|---------|----------|--------------|
| 1 | IN-01: in-memory IdentityMappingRepository/ProfileRepository | architectural | Pre-existing Phase 1/2 state, dispositioned `deferred` in 06-REVIEW-DISPOSITION.md with rationale (OTP machine is Redis-backed; SSO mappings are Mongo-backed). Tracked for the identity-multi-instance plan. |
| 2 | PermissionGuard (@casl/ability route guard) is a stub applied to no route | architectural | Documented plan-07 work per the codebase's own module comments and the CR-01 disposition; the service-boundary `assertOwner` gate is the authoritative Phase 6 enforcement and is wired into every builder service. `createBuilderAbility` is implemented and spec-tested as the derivation the guard will consume. |

### Required Artifacts

All 25 PLAN-declared artifacts exist, are substantive, and are wired. Spot-checked at three levels (exists / substantive / wired):

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------ | ------- |
| `packages/domain/src/identity/otp/otp-state-machine.ts` | IDN-05 Redis state machine | ✓ VERIFIED | Atomic Lua request/verify, TTL-structural expiry, consumed tombstone, injectable clock |
| `apps/api/src/auth/oidc.service.ts` | BLD-12 OIDC + D-101..D-104 | ✓ VERIFIED | PKCE S256, MFA gate, auto-provision, IdP-session-lifetime tracking, single-flight renewal |
| `apps/api/src/auth/session.middleware.ts` | Session middleware | ✓ VERIFIED | CSRF origin check, opaque session resolution, renewal window derived from the IdP session |
| `apps/api/src/auth/auth.module.ts` | Middleware wiring | ✓ VERIFIED | Fail-closed `forRoutes('*')` with named, documented exclusions (OIDC routes, probes, `/l/*` methods) — the d268dcd9 fix |
| `packages/domain/src/builder/publish-gate.service.ts` | APP-07/08 + BLD-06 | ✓ VERIFIED | Real-orchestrator dry-run, share-drop model, collision check, change summary |
| `packages/domain/src/builder/app-definition.service.ts` | BLD-02/APP-03/05/06 | ✓ VERIFIED (APP-06 seam unwired — see Gaps) | Audited transitions, 20-version retention, rollback, owner gate |
| `packages/domain/src/acl/transfer-request.service.ts` | ACL-05/ACL-10 | ✓ VERIFIED | Service-level admin guard, atomic approval ordering, 7-day auto-cancel |
| `packages/domain/src/authz/builder-ability.ts` | ACL-10/BLD-03/BLD-11 | ✓ VERIFIED | @casl/ability derivation, transfer-execution rule omission |
| `apps/app-builder/src/wizard/WizardPage.tsx` | BLD-01 | ✓ VERIFIED | 5-step wizard, step-1 draft creation, mockup copy |
| `apps/app-builder/src/form-designer/FormioBuilderField.tsx` | BLD-04 | ✓ VERIFIED | Guarded FormIO 5.6.1 builder mount, snapshot undo/redo |
| `apps/api/src/submissions/submission-export.service.ts` | BLD-08/D-111 | ✓ VERIFIED | Allowlist projection before csv-stringify serialization |
| `packages/cli/provision.ts` | BLD-10 operator seam | ✓ VERIFIED | D-100 guard, AES-256-GCM credential upsert, provisioned transition |
| `packages/domain/src/builder/template/template.seed.ts` | APP-09/D-105/D-108 | ✓ VERIFIED | 10 seeds, content-hash idempotent loader, origin-free fork |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `auth.controller /auth/oidc/begin` | `openid-client buildAuthorizationUrl` | PKCE S256 + Redis pre-login session | ✓ WIRED | Verifier/state stashed server-side, only the opaque session id reaches the browser |
| `auth.controller /auth/oidc/callback` | `OidcProvisionService.upsertFromOidc` | authorizationCodeGrant → acr/amr gate → provision → session promotion | ✓ WIRED | D-104 auto-provision on first SSO login |
| `SessionMiddleware` | `BuilderSessionStore` (Redis) | `__Host-akane_sid` cookie → `req.user.realUserId` | ✓ WIRED | Owner-scoping downstream consumes `req.user` |
| `inbound-event.processor` (unmapped user) | `OtpOnboardingService` → `OtpStateMachine` → `OtpDeliveryPort` | keyword/6-digit reply branch | ✓ WIRED | Verified mapping created on success (delivery leg logs only — human item) |
| `publish.controller POST /apps/:id/publish` | `PublishGateService.evaluate` → `RoutingOrchestrator` | read-only dry-run before any state change | ✓ WIRED | `commitPublish` only when the gate allows; refusal names app_id + delta |
| `inbound-event.processor` (applied routing) | `RoutingOutcomeRepository.record` | outcome recording at the routing execution point | ✓ WIRED | Fills the rolling 24h window both the APP-07 baseline and the OBS-05 gauge read |
| `routing-share.metrics.ts` | OTel ObservableGauge → exporter-prometheus | `routing_share{app_id}` | ✓ WIRED | Single metrics path; meter obtained per call (post-bootstrap) |
| `scheduler registerTransferAutoCancel` | `worker TransferAutoCancelProcessor` | Job Scheduler `transfer-auto-cancel` id, hourly | ✓ WIRED | Producer and consumer agree on the id |
| renderer `edit.ts` submit | `read.controller editPost` → `DataRouterService.routeEdit` | POST `/l/edit/:jti` | ⚠️ WIRED BUT UNGUARDED | The link works, but the submission write has no lifecycle check — the APP-06 gap |
| `AppDefinitionService.assertAcceptsSubmissions` | (no production caller) | — | ✗ NOT WIRED | The seam exists and is tested in isolation; nothing calls it on the submission path |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `DashboardPage` recent submissions | `client.get('/submissions?app_id=…')` | `GET /submissions` (owner-scoped repository query) | ✓ | ✓ FLOWING |
| `DashboardPage` recent activity | `client.get('/audit?limit=…')` | `GET /audit` (AUD-01 repository, global-admin) | ✓ | ✓ FLOWING |
| `AppsPage` list/tag filter | `client.get('/apps')` + tag filter | `GET /apps` (`listByOwner`) | ✓ | ✓ FLOWING |
| `SubmissionsPage` rows | `client.get('/submissions?app_id&status&from&to&form')` | `SubmissionRepository.listByApp` (composed filters) | ✓ | ✓ FLOWING |
| `UsersPage` autocomplete | `GET /users/search?q=` | `ProfileRepository.findAll` prefix filter | ✓ | ✓ FLOWING |
| `PublishController` share drops | `RoutingShareComputer.countsOverLabels` | `RoutingOutcomeRepository.outcomesForIntent/App` (24h window) | ✓ | ✓ FLOWING |
| `OtpStateMachine` attempts | Redis `INCR akane:otp:{chatUserId}:attempts` | real Redis | ✓ | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Build gate (lint + tsc -b) | `npm run build` | exit 0 | ✓ PASS |
| Full unit/integration suite | `npx vitest run` | 123 files / 1194 tests — 1193 passed, 1 failed (the documented pre-existing entrypoint-drift orphan walk: slack-commands.controller, slack-webhook.controller, slack.module, link-error.filter, permission.guard — matches 06-02-deferred-items.md) | ✓ PASS (1 pre-existing, documented) |
| APP-07/08/BLD-06 gate behavior | `npx vitest run packages/domain/src/builder/publish-gate.service.spec.ts` | 14/14 passed | ✓ PASS |
| IDN-05 OTP boundaries | `npx vitest run packages/domain/src/identity/otp/otp-state-machine.spec.ts` | 13/13 passed over real Redis (TTL boundary, lockout-from-third-failure, single-use replay, INCR atomicity, cross-identity) | ✓ PASS |
| ACL-05 transfer service | `npx vitest run packages/domain/src/acl/transfer-request.service.spec.ts` | 10/10 passed | ✓ PASS |
| APP-03/05/06 lifecycle + versions | `npx vitest run packages/domain/src/builder/app-definition.versions.spec.ts packages/domain/src/builder/app-lifecycle.spec.ts` | 27/27 passed | ✓ PASS |
| BLD-12 auth flow over real HTTP | `apps/api/src/auth/auth.session.integration.spec.ts` (in suite) | 14 tests (PKCE S256, __Host- cookie, MFA gate, auto-provision, state-mismatch refusal, expiry, silent renewal, logout) | ✓ PASS |
| Playwright e2e (BLD-01/04/09) | `npx playwright test apps/app-builder/e2e/wizard.spec.ts --project=chromium` | 5/5 failed — **environmental**: Chromium headless shell cannot launch (`libatk-1.0.so.0: cannot open shared object file`; no root to install OS deps) | ? SKIP (environmental — see Human Verification) |

### Probe Execution

No phase-declared probe scripts (`scripts/*/tests/probe-*.sh`) exist for this phase; the verification substrate is the vitest/playwright suites above, executed directly.

### Requirements Coverage

All 25 requirement IDs from REQUIREMENTS.md mapped to this phase are assessed in the Observable Truths table above: 22 ✓ SATISFIED, 2 ✗ BLOCKED (APP-06 submission-refusal clause, BLD-06 keyboard-shortcut clause), 1 ⚠️ NEEDS HUMAN (BLD-09 tablet usability — code present, e2e unexecutable here). No orphaned requirements (REQUIREMENTS.md's Phase 6 mapping matches the plan claims exactly).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `packages/domain/src/datarouter/data-router.service.ts` | 109-156 | Empty implementation of a documented guard (routeEdit writes without the lifecycle check the plan mandated) | 🛑 Blocker | Archived apps keep accepting submissions via pre-issued edit links — the APP-06 invariant is unenforced on the real path |
| `apps/app-builder/src/editor/EditorPage.tsx` | — | Silently dropped requirement clause (no Ctrl/Cmd+S handler; no deviation record) | ⚠️ Warning | BLD-06's keyboard-shortcut clause unmet; publish save is button-only |
| `apps/worker/src/processors/otp-delivery.service.ts` | 25-27 | Log-only port implementation | ℹ️ Info | Declared manual-verify item (live Slack DM in staging); the seam is correct and everything else is tested |
| `packages/domain/src/authz/rbac.service.ts` | 7-25 | Hardcoded stub (always returns true) | ℹ️ Info | **Pre-existing Phase 2 code** (read-link path only, `git log` confirms; only lint underscores changed on this branch). Not consumed by any Phase 6 builder surface — the builder's authorization is `assertOwner` + `createBuilderAbility`. Recorded for the read-path hardening follow-up, not a Phase 6 defect |

No `TBD`/`FIXME`/`XXX` debt markers, no placeholder returns, no hardcoded-empty render data in any Phase 6 file.

### Human Verification Required

1. **Live OTP delivery through the chat pipeline (IDN-05)** — trigger the onboarding keyword from an unmapped Slack identity; the code must arrive via Slack DM, the reply must verify and create the mapping. The state machine and pipeline are integration-tested over real Redis; only the DM leg is unwired (OtpDeliveryService logs the identity). Staging item per 06-VALIDATION.md.
2. **Wizard usability without documentation (BLD-01)** — walk the 5 steps with no prior context.
3. **Playwright e2e suite execution** — run `npx playwright test` (chromium + tablet projects) on a machine with browser OS dependencies; the specs are present and configured but could not launch Chromium in this sandbox.
4. **Tablet touch pass (BLD-09)** — one manual pass on a real tablet at 768×1024.
5. **Publish modal visual fidelity (BLD-06)** — confirm the change-summary rows match `prototypes/mockup.html:1580-1585`.

### Gaps Summary

**Gap 1 (BLOCKER) — APP-06's archived-submission refusal is an unwired seam.** `AppLifecycle.assertAcceptsSubmissions` exists, is unit-tested, and is documented as "the submission-creation seam calls this before writing a submission record" — but no caller exists on the real path. The renderer's form submit POSTs to `/l/edit/:jti`; `read.controller.ts editPost` verifies the link (deliberately no lifecycle check, so view links resolve) and hands straight to `DataRouterService.routeEdit`, which inserts `submission_revisions` + `outbox` rows unconditionally. The APP-06 integration spec passes by calling the service seam directly rather than through the HTTP path, so the suite is green while the invariant is unenforced. Fix: invoke `assertAcceptsSubmissions(appId)` inside `routeEdit`/`routeSubmission` (or in `editPost` before routing), and re-point the integration spec at the real path (archive → submit via a pre-archived link → expect `SUBMISSION_REFUSED_ARCHIVED`).

**Gap 2 (minor) — BLD-06's keyboard shortcut was silently dropped.** Plan 05 scoped the Ctrl/Cmd+S save to plan 07 ("the shortcut itself is wired in plan 07 against this contract"); plan 07 neither implemented nor mentioned it, and the SPA has no modifier-key handler. Fix: add a keydown handler that fires the same `POST /apps/:id/publish` endpoint (no separate save endpoint exists, per the plan's own contract), or record an explicit descope in the phase SUMMARY.

Both gaps are localized and do not invalidate the other 22 verified truths; closing them completes the phase goal.

---

_Verified: 2026-10-13T05:30:00Z_
_Verifier: the agent (gsd-verifier)_
