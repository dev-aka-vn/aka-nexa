---
phase: 06-self-service-app-builder
verified: 2026-10-13T06:01:04Z
status: human_needed
score: 24/25 must-haves verified
covered_files: [".planning/phases/06-self-service-app-builder/06-01-PLAN.md",".planning/phases/06-self-service-app-builder/06-01-SUMMARY.md",".planning/phases/06-self-service-app-builder/06-02-PLAN.md",".planning/phases/06-self-service-app-builder/06-02-SUMMARY.md",".planning/phases/06-self-service-app-builder/06-02-deferred-items.md",".planning/phases/06-self-service-app-builder/06-03-PLAN.md",".planning/phases/06-self-service-app-builder/06-03-SUMMARY.md",".planning/phases/06-self-service-app-builder/06-04-PLAN.md",".planning/phases/06-self-service-app-builder/06-04-SUMMARY.md",".planning/phases/06-self-service-app-builder/06-05-PLAN.md",".planning/phases/06-self-service-app-builder/06-05-SUMMARY.md",".planning/phases/06-self-service-app-builder/06-06-PLAN.md",".planning/phases/06-self-service-app-builder/06-06-SUMMARY.md",".planning/phases/06-self-service-app-builder/06-07-PLAN.md",".planning/phases/06-self-service-app-builder/06-07-SUMMARY.md",".planning/phases/06-self-service-app-builder/06-08-PLAN.md",".planning/phases/06-self-service-app-builder/06-08-SUMMARY.md",".planning/phases/06-self-service-app-builder/06-CONTEXT.md",".planning/phases/06-self-service-app-builder/06-DISCUSSION-LOG.md",".planning/phases/06-self-service-app-builder/06-PATTERNS.md",".planning/phases/06-self-service-app-builder/06-RESEARCH.md",".planning/phases/06-self-service-app-builder/06-REVIEW-DISPOSITION.md",".planning/phases/06-self-service-app-builder/06-REVIEW.md",".planning/phases/06-self-service-app-builder/06-VALIDATION.md",".planning/phases/06-self-service-app-builder/COVERAGE.md",".planning/phases/06-self-service-app-builder/deferred-items.md","apps/api/src/app-builder/app-builder.module.ts","apps/api/src/app-builder/app-definition.integration.spec.ts","apps/api/src/read/edit-link.integration.spec.ts","apps/api/src/read/read.controller.ts","apps/api/src/read/read.module.ts","apps/app-builder/src/api/definition.ts","apps/app-builder/src/editor/EditorPage.tsx","apps/app-builder/src/editor/publishShortcut.spec.ts","apps/app-builder/src/editor/publishShortcut.ts","packages/domain/src/datarouter/data-router.service.ts","packages/domain/src/datarouter/data-router.spec.ts","packages/domain/src/datarouter/outbox.integration.spec.ts","tooling/boundaries.config.mjs"]
covered_digest: "v3:sha256:88ac79ee25b4a9eb4d7a81776d1d146036250acd78796c021623d88b6ce44aeb"
behavior_unverified: 1
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 24/25
  gaps_closed:
    - "APP-06: the lifecycle guard now runs at the submission-creation seam — DataRouterService injects AppDefinitionService and calls assertAcceptsSubmissions(appId) before the transaction in BOTH routeSubmission (data-router.service.ts:73) and routeEdit (:131); the refusal surfaces on the real HTTP path as 409 {error:'SUBMISSION_REFUSED_ARCHIVED'} (read.controller.ts:279-284) with nothing inserted and the edit token not consumed (retry refuses identically, never replays); the boundary graph gains the datarouter→builder edge (boundaries.config.mjs, Pattern 7 with documented rationale) and ReadModule wires the DataRouterService factory over [MongoService, AppDefinitionService] via AppBuilderModule's export; the integration proof is re-pointed at the REAL path — app-definition.integration.spec.ts 'APP-06 both ways' creates + publishes the app, seeds the submission, POSTs /l/edit/:jti with a genuinely signed ES256 edit link (control accepted 200 + revision written), archives, POSTs again (409, revisions collection still holds only the pre-archive row), retries the same token (same 409), and the pre-archived view link still resolves. 13/13 tests pass."
    - "BLD-06 keyboard shortcut: apps/app-builder/src/editor/publishShortcut.ts implements the pure isPublishShortcut(event) predicate — (ctrlKey || metaKey) && key.toLowerCase() === 's' — with a table-driven spec (both modifiers, both cases, near-miss rejection); EditorPage.tsx wires a keydown listener (preventDefault) over a publish callback that POSTs /apps/:id/publish — the same endpoint the API publish surface exposes, no separate save endpoint exists per 06-05-PLAN's contract — and shows the published banner with the new version, refusals inline verbatim (BLD-07 pattern)."
    - "BLD-06 publish-surface advisory (closed this round, bb49dc92): the editor head now carries a visible Publish button (data-testid='editor-publish', .btn .btn-primary .btn-sm — the mockup's own publish-button classes at prototypes/mockup.html:1045/:1252) and the platform chord hint (Ctrl+S / ⌘S via saveShortcutHint(), rendered in the mockup's .helper class). The button's onClick and the Ctrl/Cmd+S keydown listener fire the SAME publish callback — one code path to POST /apps/:id/publish, so the shortcut and the button cannot diverge (the 06-05 contract's own wording). The button is disabled while saving. The post-publish confirmation renders the changeSummary rows the endpoint returns ({field, from, to} — the same rows the AUD-01 entry retains) in .od-row layout, and names a zero-change publish inline via the endpoint's zero_change flag. apps/app-builder/src/api/definition.ts gains PublishResultSchema (definition projection + changeSummary rows + zero_change) — the same structural-schema pattern as AppDefinitionSchema — and the API contract matches (publish.controller.ts:88-106; publish.integration.spec.ts asserts both changeSummary and zero_change, 6/6 pass at HEAD)."
  gaps_remaining: []
  regressions: []
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
  - test: "Tablet touch pass (BLD-09): one manual pass on a real tablet at 768×1024"
    expected: "The wizard, editor and designer are usable without a mouse"
    why_human: "Human judgement the emulated viewport only approximates; skeletons are code-verified, touch usability is not."
  - test: "Publish confirmation visual fidelity (BLD-06): the surface now exists (bb49dc92) — confirm the rendered surface satisfies the mockup's confirmation intent"
    expected: >-
      The editor head shows a visible Publish button plus the Ctrl+S / ⌘S chord hint, and
      the post-publish banner lists the change rows (field, from → to) the endpoint
      returns, naming a zero-change publish inline. Two fidelity questions for a human
      eye: (a) the implementation confirms AFTER publish (banner with rows) whereas the
      mockup's openPublish is a PRE-publish modal with a Confirm button
      (prototypes/mockup.html:1578-1601) — confirm the post-publish confirmation satisfies
      BLD-06's 'publish confirmation summarises every change' contract, or schedule the
      pre-publish modal; (b) the .spacer span only flexes under .card-head (chrome.css:174)
      but the editor head and change rows use it inside .page-head/.od-row, so the button
      sits beside the version pill rather than right-aligned and the rows pack left rather
      than space-between — cosmetic, but the mockup's alignment is not reproduced.
    why_human: "Visual rendering + product-shape judgement that grep cannot settle; Playwright cannot launch in this sandbox. The payload shape is unit-tested (buildChangeSummary, publish-gate.service.spec.ts) and the API contract is integration-tested (publish.integration.spec.ts asserts changeSummary and zero_change), but the rendered fidelity needs a human eye."
---

# Phase 6: Self-Service App Builder Verification Report

**Phase Goal:** A department admin builds, secures, and publishes a working app end-to-end without an engineering ticket and without a platform admin's help.
**Verified:** 2026-10-13T06:01:04Z
**Status:** human_needed
**Re-verification:** Yes — final pass after gap closure (9c98ce3d) and publish-surface advisory closure (bb49dc92)

## Verdict: ALL DECLARED GAPS CLOSED, ADVISORY CLOSED — GO, pending human verification items

Both gaps from the earlier NO-GO are closed with real code and passing tests (verified at 9c98ce3d), and the one advisory raised by the prior re-verification — the shortcut-only publish surface — is closed at bb49dc92, verified against the code (not the commit message):

1. **APP-06 (was BLOCKER) — CLOSED.** The lifecycle guard runs at the submission-creation seam in both `routeSubmission` and `routeEdit`, before the transaction, so nothing is inserted and no edit token is consumed when an app is archived. The refusal surfaces on the real HTTP path as `409 SUBMISSION_REFUSED_ARCHIVED`. The integration proof exercises the real path — a genuinely signed ES256 edit link POSTed through the live Nest app.
2. **BLD-06 keyboard shortcut (was minor) — CLOSED.** A pure `isPublishShortcut` predicate (both modifiers, case-insensitive, near-miss rejection) is table-driven-spec'd, and `EditorPage` wires a keydown listener over a publish callback that POSTs `/apps/:id/publish` — the same endpoint the API publish surface exposes.
3. **BLD-06 publish-surface advisory (raised last round) — CLOSED at bb49dc92.** The editor head now carries a visible **Publish button** (`data-testid="editor-publish"`, `.btn .btn-primary .btn-sm` — the mockup's own publish-button classes, `prototypes/mockup.html:1045/:1252`) and the **platform chord hint** (`Ctrl+S` / `⌘S` via `saveShortcutHint()`, in the mockup's `.helper` class). The button's `onClick` and the Ctrl/Cmd+S keydown listener fire the **same `publish` callback** — one code path to `POST /apps/:id/publish`, so the shortcut and the button cannot diverge, which is the 06-05 contract's own wording ("the shortcut and the button"). The button is disabled while `saving`. The post-publish confirmation renders the `changeSummary` rows the endpoint returns (`{field, from, to}` — the same rows the AUD-01 entry retains) in `.od-row` layout, and names a zero-change publish inline via the endpoint's `zero_change` flag. The response validates through a new `PublishResultSchema` (`apps/app-builder/src/api/definition.ts` — definition projection + changeSummary rows + zero_change), the same structural-schema pattern as `AppDefinitionSchema`; the API contract matches (`publish.controller.ts:88-106` returns `changeSummary`/`zero_change`, asserted by `publish.integration.spec.ts`).

The full vitest suite reproduces the claimed state at HEAD (bb49dc92): **124 files / 1196 tests — 1195 passed, 1 failed** (the documented pre-existing `tooling/entrypoint-drift.spec.ts` orphan walk, failing on the committed tree before 06-02's first commit, out of scope per 06-02-deferred-items.md — unchanged from the pre-closure run), and `npm run build` (eslint + tsc -b) exits 0. The closure commit touched only two SPA files, both covered by the green SPA specs (4 files / 14 tests).

No must-have fails. Status is `human_needed` (not `passed`) because human-verification items remain — the environmental Playwright limitation (BLD-09), the live Slack OTP leg (IDN-05), the no-documentation walkthrough judgement (BLD-01), and the publish-confirmation visual fidelity — not because any must-have fails.

## Goal Achievement

### Observable Truths (requirement-level)

| # | Requirement | Truth | Status | Evidence |
| --- | ----------- | ----- | ------ | -------- |
| 1 | BLD-01 | Non-developer creates an app in 5 wizard steps without documentation | ✓ VERIFIED | `apps/app-builder/src/wizard/WizardPage.tsx` — locked 5-step rail (Basics→Triggers→RBAC→Form→Routing), step 1 POSTs /apps and toasts the mockup's exact copy; inline validation gates forward navigation; e2e `wizard.spec.ts` encodes the flow (could not execute here — see Human Verification) |
| 2 | BLD-02 | Owner edits all sections from a tabbed editor | ✓ VERIFIED | `EditorPage.tsx` + `sections.ts` — the twelve contract sections as tabs, each a section PATCH (`PATCH /apps/:id` `{section, patch}`), one audited version bump per edit |
| 3 | BLD-03 | Custom roles with arbitrary permission sets; assign by name/email autocomplete | ✓ VERIFIED | `builder-ability.ts` custom-role branch (`operate` exactly the granted subset, spec-tested); `GET /users/search?q=` (name-or-email prefix → opaque real_user_id); `RolesPage`/`PermissionMatrix`/`UserAutocomplete` |
| 4 | BLD-04 | Drag-and-drop designer with undo/redo over the last 50 actions | ✓ VERIFIED | `FormioBuilderField.tsx` — guarded dynamic `@formio/js` Formio.builder() mount (Pattern 1/4); `undoHistory.ts` SchemaHistory — debounced `builder.schema` snapshots restored via `setForm()`, 50-entry ring buffer, redo cleared on new capture; `undoHistory.spec.ts` + e2e `designer.spec.ts` |
| 5 | BLD-05 | Visual form-field → connector-field mapping | ✓ VERIFIED | `FieldMappingService` (owner-scoped, Zod-validated, audited) + `PATCH /apps/:id` field-mapping section + `FormDesignerPage` mapping surface pairing form keys against connector fields |
| 6 | BLD-06 | Publish confirmation summarises every change; save via keyboard shortcut | ✓ VERIFIED | Change summary: `buildChangeSummary` rides the publish payload (`publish.controller.ts:88-107`) and the AUD-01 entry (`commitPublish` → transition with the full gate record), zero-change publishes named inline, all five 06-05 BLD-06 truths hold (publish-gate.service.spec.ts 14/14 + publish.integration.spec.ts 6/6 at HEAD). Keyboard shortcut: ✓ `publishShortcut.ts` predicate + table-driven spec + `EditorPage` keydown listener → `POST /apps/:id/publish`. Visible surface (CLOSED this round, bb49dc92): ✓ Publish button (`data-testid="editor-publish"`, `.btn .btn-primary .btn-sm`) + chord hint (`saveShortcutHint()` → `Ctrl+S`/`⌘S` in `.helper`) in the editor head; button `onClick` and keydown fire the SAME `publish` callback — one code path; button disabled while `saving`; post-publish banner renders the `changeSummary` rows (`{field, from → to}`, `data-testid="publish-change-row"`) and names zero-change publishes inline via `zero_change`; response validates through `PublishResultSchema` |
| 7 | BLD-07 | Errors inline, specific, actionable — never generic | ✓ VERIFIED | `BuilderExceptionFilter` maps every `BuilderError` code to a status + `{error:{code,message}}`; `InlineError` with operation name + retry on every async page; named refusals throughout (APP_NOT_FOUND, SUBMISSION_REFUSED_ARCHIVED, GLOBAL_ADMIN_REQUIRED, AUTH_MFA_REQUIRED…) |
| 8 | BLD-08 | Submission viewer: filters, detail, export | ✓ VERIFIED | `SubmissionsController` — `GET /submissions` (status/date-range/form filters compose), `GET /submissions/:id` detail, `GET /submissions/export` via `SubmissionExportService`: rows projected through the 6-column allowlist *before* `csv-stringify` serialization (D-111), export audited; owner-scoped fail-closed (non-owner = 404) |
| 9 | BLD-09 | Tablet-usable; loading skeletons for every async operation | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Skeletons: ✓ layout-shaped `Skeleton` on every async page (all 10 SPA pages render skeleton slots while loading, inline error replaces skeleton on failure). Tablet usability: e2e tablet project (768×1024, touch) is configured but could not execute here (Chromium OS deps missing) — human verification |
| 10 | BLD-10 | Department admin requests a connector and publishes external/hybrid without a platform admin | ✓ VERIFIED | `ConnectorRequestService.request` (full definition minus secret, D-99 `.strict()` contract, one-pending invariant, owner-scoped fail-closed) → `packages/cli/provision.ts provisionConnectorRequests` (D-100 KMS guard first, credential through the AES-256-GCM `ConnectorCredentialsRepository.upsert` seam, request → provisioned, audited); app publishes once provisioned |
| 11 | BLD-11 | Delegated workflow manager operates without ownership | ✓ VERIFIED | `builder-ability.ts` manager role: `operate` every section, no lifecycle/transfer/role-assignment — spec-tested ("a delegated workflow manager operates the app without lifecycle, transfer, or role assignment") |
| 12 | BLD-12 | OIDC SSO with MFA; user manages only apps they own or administer | ✓ VERIFIED | `OidcService` begin/callback (authorization code + PKCE S256, state verified server-side before any exchange, `acr`/`amr` MFA gate → AUTH_MFA_REQUIRED, D-104 auto-provision, session TTL tracks the IdP session with single-flight renewal); `SessionMiddleware` (CSRF origin check, `__Host-` cookie, opaque Redis session); every builder service enforces `assertOwner` (fail-closed 404); `auth.session.integration.spec.ts` 14 tests over the real flow with the in-repo StubOidcIssuer |
| 13 | APP-03 | Versioned definition, last 20 versions retained, rollback | ✓ VERIFIED | `AppDefinitionRepository` — every mutation writes a full snapshot to `app_definition_versions` (compound unique index (app_id, version)), `RETAINED_VERSIONS = 20` with oldest-eviction; rollback re-writes a retained snapshot at a new version (audited `app.rollback`); `app-definition.versions.spec.ts` + `app-lifecycle.spec.ts` 27 tests |
| 14 | APP-05 | Deprecated app stays functional, shows notice, registers no new triggers | ✓ VERIFIED | `AppLifecycle.assertTransition` legal-transition table (deprecated→published re-activation legal); deprecate stores the owner notice on the definition (served on every surface); no-new-triggers enforced structurally — `PublishedAppLoader.listAuthorized` includes only `status === 'published'`, so deprecated/archived apps never enter the routing distribution; `assertRegistersTriggers` seam guards the future registration path |
| 15 | APP-06 | Archived app accepts no new submissions; existing view links still resolve | ✓ VERIFIED (CLOSED) | No-new-submissions: ✓ the `assertAcceptsSubmissions` guard runs at the submission-creation seam — `data-router.service.ts:73` (routeSubmission) and `:131` (routeEdit), before the transaction; the refusal surfaces as `409 SUBMISSION_REFUSED_ARCHIVED` on the real HTTP path (`read.controller.ts:279-284`), nothing inserted, edit token not consumed (retry refuses identically, never replays); proven end-to-end by the re-pointed integration spec (real ES256-signed edit link through the live app, 13/13 pass). View links: ✓ `ReadVerifierService` deliberately unchanged — pre-archived links verify (asserted in the same spec, "Way 2") |
| 16 | APP-07 | Publish runs a routing dry-run and blocks a >5-point routing-share drop | ✓ VERIFIED | `PublishGateService.evaluate` — read-only dry-run executes the **real** `RoutingOrchestrator` over the candidate's labelled intent set (excluded vs included runs), share computed per existing app against its own pre-publish share over the rolling 24h `RoutingOutcomeRepository` window; strictly-greater-than threshold (exactly 5.00 passes, 5.01 blocks) with a named refusal identifying app_id + delta; blocked publish leaves all state untouched; `publish-gate.service.spec.ts` 14 tests + `publish.integration.spec.ts` |
| 17 | APP-08 | Publishing rejects a description-colliding app | ✓ VERIFIED | `descriptionsCollide` — case-folded token Jaccard ≥ 0.90 (or exact equality after folding) against published apps only; named refusal naming the colliding app_id |
| 18 | APP-09 | App tagged and filterable by tag; ~10 seed templates ship | ✓ VERIFIED | `template.seed.ts` — exactly 10 frozen seeds across the D-106 domains, content-hash-guarded idempotent loader, `forkTemplate` deep-copies to a user-owned draft with **no origin-reference field**; curated tag vocabulary enforced (`assertCuratedTags` names the allowed set on refusal); `AppsPage` + `TagFilter` |
| 19 | FRM-05 | Conditional show/hide and validation rules (required, pattern, min/max, custom) | ✓ VERIFIED | Native FormIO component properties (`conditional`, `validate`), authored in the builder's component edit form; the 06-01 spike verified the 5.x error shapes (`component.errors[0].message`, `EditGrid.validateRows` returns array); min/max boundary asserted in the authored schema and the preview submission path |
| 20 | FRM-09 | Draft preview with sandbox submissions before publishing | ✓ VERIFIED | `sandbox.ts` — in-memory submission buffer (never the real submissions collection) + `PreviewPane`; the designer renders the draft through the FormIO renderer |
| 21 | IDN-05 | Employee self-onboards by OTP: 10-min expiry, 3 attempts, 30-min lockout | ✓ VERIFIED (live delivery leg → human) | `OtpStateMachine` — Redis-backed, atomic Lua scripts (request/verify), injectable clock; `otp-state-machine.spec.ts` 13 tests over real Redis prove the exact boundaries (9:59 verifies / 10:01 OTP_EXPIRED; 3rd failure arms the 30-min lockout measured from that failure; 4th refused; replay refused as consumed; cross-identity refusal; concurrent INCR atomicity). Wired into `inbound-event.processor.ts` (unmapped-user path: keyword requests, 6-digit reply verifies, verified → mapping created). Live Slack DM leg is the declared manual-verify item (OtpDeliveryService logs only) |
| 22 | IDN-08 | Admin maps an SSO identity to a real_user_id without the user verifying anything | ✓ VERIFIED | `POST /users/sso-mappings` — global-admin-gated (service-level `assertGlobalAdmin`), Zod-validated, no OTP on this path (deliberately separate from IDN-05); `sso-mapping.integration.spec.ts` over real HTTP + stub issuer |
| 23 | ACL-05 | Ownership transfer requires global-admin approval; auto-cancels after 7 days | ✓ VERIFIED | `TransferRequestService` — owner requests (fail-closed, 7-day `expiresAt`), `approve`/`reject` guarded by a **service-level** `assertGlobalAdmin` (GLOBAL_ADMIN_REQUIRED fires before any read/write — the non-admin refusal holds even when called directly); approval resolves the record first (atomic — closes the LO-01 double-approval window) then moves ownership in the same transition; `autoCancelExpired` is idempotent, consumed hourly by the scheduler-registered `transfer-auto-cancel` Job Scheduler + worker processor; `transfer-request.service.spec.ts` 10 tests + `transfer.integration.spec.ts` |
| 24 | ACL-10 | Owner views/modifies all role assignments except ownership transfer | ✓ VERIFIED | `createBuilderAbility` — owner: `manage` every section + `request-transfer` on ownership; `transfer-execution` is granted by **no rule to any role** (a rule omission, not a runtime check — the ACL-10 carve-out); owner cannot execute a transfer (only request); spec-tested |
| 25 | OBS-05 | `routing_share{app_id}` is exported | ✓ VERIFIED | `builder/routing-share/routing-share.metrics.ts` — OTel `ObservableGauge` on the single meter provider (no prom-client), `app_id` attribute, observation callback reads the `RoutingShareComputer` fresh at scrape; the gauge and the APP-07 dry-run read the **same** `RoutingOutcomeStore` seam so metric and gate cannot disagree; the rolling 24h window is filled by the live chat pipeline (`inbound-event.processor` records every applied routing outcome at the point the orchestrator's outcome is applied) |

**Score:** 24/25 requirement truths verified (1 present-but-behavior-unverified: BLD-09 tablet usability; 0 failed — both previous gaps and the publish-surface advisory closed)

### Deferred Items

No roadmap-later-phase deferrals apply — Phase 7 (Multi-IM Expansion) covers Teams/webhooks, not archived-submission gating, the builder keyboard shortcut, or the SPA publish surface. The publish-surface question was this phase's own outstanding product decision and is now closed in code (bb49dc92); only its visual-fidelity confirmation remains a human item.

### Advisory (New Scope, Unevidenced)

| # | Finding | Category | Why Advisory |
|---|---------|----------|--------------|
| 1 | IN-01: in-memory IdentityMappingRepository/ProfileRepository | architectural | Pre-existing Phase 1/2 state, dispositioned `deferred` in 06-REVIEW-DISPOSITION.md with rationale (OTP machine is Redis-backed; SSO mappings are Mongo-backed). Tracked for the identity-multi-instance plan. |
| 2 | PermissionGuard (@casl/ability route guard) is a stub applied to no route | architectural | Documented plan-07 work per the codebase's own module comments and the CR-01 disposition; the service-boundary `assertOwner` gate is the authoritative Phase 6 enforcement and is wired into every builder service. `createBuilderAbility` is implemented and spec-tested as the derivation the guard will consume. |

(The previous round's advisory #3 — shortcut-only publish surface — is CLOSED at bb49dc92 and removed from this list; see the verdict section.)

### Required Artifacts

All 25 PLAN-declared artifacts exist, are substantive, and are wired. The gap-closure artifacts verified at three levels (exists / substantive / wired) plus data-flow:

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------ | ------- |
| `packages/domain/src/datarouter/data-router.service.ts` | APP-06 seam guard | ✓ VERIFIED | `AppDefinitionService` injected; `assertAcceptsSubmissions(input.appId)` awaited before the session in both `routeSubmission` (L73) and `routeEdit` (L131) — the refusal precedes every write, so no caller of the seam can bypass it |
| `apps/api/src/read/read.controller.ts` | APP-06 HTTP surfacing | ✓ VERIFIED | `editPost` catches `SubmissionRefusedError` → `409 {error:'SUBMISSION_REFUSED_ARCHIVED'}` (L279-284); the catch sits before `recordOutcome`, so the token is not consumed; the 11000-duplicate branch is checked first and cannot swallow the refusal (`SubmissionRefusedError.code` is a string, never `11000`) |
| `apps/api/src/read/read.module.ts` | APP-06 DI wiring | ✓ VERIFIED | Imports `AppBuilderModule` (L155); `DataRouterService` explicit-token factory over `[MongoService, AppDefinitionService]` (L211-218) — the graph is identical in the test runner and production |
| `tooling/boundaries.config.mjs` | APP-06 boundary edge | ✓ VERIFIED | `datarouter` gains the `builder` edge with the Pattern 7 rationale comment (L158-173); `boundaries.fixture.spec.ts` 9/9 green — the lint gate and the fixture exercise the same objects |
| `apps/api/src/app-builder/app-builder.module.ts` | APP-06 export | ✓ VERIFIED | `AppDefinitionService` provided (L97-102) and exported (L267) for the ReadModule composition |
| `apps/api/src/app-builder/app-definition.integration.spec.ts` | APP-06 real-path proof | ✓ VERIFIED | "APP-06 both ways" (L545-673): real ES256 keypair, `signReadLink` over node:crypto (no jose — R2-safe), `NodeCryptoReadLinkVerifier` performs real public-key verification; control submit through the live Nest app → 200 + revision with the control's edit jti; archive → same-path submit → 409; revisions collection holds exactly 1 row (the pre-archive one); retry → same 409; pre-archived view link still verifies. 13/13 pass (re-run at 9c98ce3d, 45s, real testcontainers) |
| `apps/app-builder/src/editor/publishShortcut.ts` | BLD-06 predicate | ✓ VERIFIED | Pure function, no I/O: `(ctrlKey || metaKey) && key.toLowerCase() === 's'` — covers both modifier conventions and Shift-held `S` |
| `apps/app-builder/src/editor/publishShortcut.spec.ts` | BLD-06 predicate spec | ✓ VERIFIED | Table-driven: both modifiers × both cases accept; bare `s`, a different chord, and a modifier-only press all reject |
| `apps/app-builder/src/editor/EditorPage.tsx` | BLD-06 wiring + visible surface | ✓ VERIFIED | `publish` callback POSTs `/apps/${appId}/publish` (L325-356) — the same endpoint the API publish surface exposes — validated through `PublishResultSchema`; keydown effect (L364-374) calls `preventDefault()` then `publish()`; editor head (L417-438) carries the Publish button (`data-testid="editor-publish"`, `.btn .btn-primary .btn-sm`, `onClick={() => void publish()}`, `disabled={saving}`) and the chord hint (`saveShortcutHint()` → `⌘S`/`Ctrl+S` in `.helper`); post-publish banner (L485-520) shows the new version, names zero-change publishes inline (`zero_change`), and renders the `changeSummary` rows (`data-testid="publish-change-row"`, `.od-row`: field, from → to); refusals surface inline verbatim (BLD-07 pattern, L348-352) |
| `apps/app-builder/src/api/definition.ts` | BLD-06 publish-response schema | ✓ VERIFIED (NEW this round) | `PublishResultSchema` (L166-228): structural parse — `AppDefinitionSchema.parse(data)` for the definition projection, then validates `changeSummary` is an array of `{field, from, to}` string rows and `zero_change` is a boolean, throwing `malformed publish result`/`malformed change row` otherwise — the same structural-schema pattern as `AppDefinitionSchema`; matches the API payload (`publish.controller.ts:88-106`) |
| `packages/domain/src/builder/publish-gate.service.ts` | APP-07/08 + BLD-06 | ✓ VERIFIED | Real-orchestrator dry-run, share-drop model, collision check, `buildChangeSummary` (L385) |
| `packages/domain/src/builder/app-definition.service.ts` | BLD-02/APP-03/05/06 | ✓ VERIFIED | `assertAcceptsSubmissions` (L304-310): loads the definition (fail-closed `AppNotFoundError`) and delegates to `AppLifecycle.assertAcceptsSubmissions`; `commitPublish` (L185-202) retains the full gate decision in the AUD-01 entry |

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
| renderer `edit.ts` submit | `read.controller editPost` → `DataRouterService.routeEdit` → `AppDefinitionService.assertAcceptsSubmissions` | POST `/l/edit/:jti` | ✓ WIRED + GUARDED (CLOSED) | The link works AND the submission write is now lifecycle-gated before the transaction — the APP-06 gap is closed; refusal is a client-visible 409, nothing inserted, token not consumed |
| `AppDefinitionService.assertAcceptsSubmissions` | `DataRouterService` (both routes) | constructor injection via ReadModule's explicit-token factory | ✓ WIRED (CLOSED) | The seam now has its production caller — the previous NOT_WIRED link is closed |
| `EditorPage` Publish button + keydown | `isPublishShortcut` → `publish()` → `POST /apps/:id/publish` | `onClick` and `window` keydown listener, same callback | ✓ WIRED (CLOSED) | The button (L426-434) and the shortcut (L364-374) both invoke the same `publish` useCallback (L325) against the same endpoint the API publish surface exposes — one code path, so the two cannot diverge (06-05's contract); the response is validated through `PublishResultSchema` and its `changeSummary`/`zero_change` flow into the confirmation state |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `DashboardPage` recent submissions | `client.get('/submissions?app_id=…')` | `GET /submissions` (owner-scoped repository query) | ✓ | ✓ FLOWING |
| `DashboardPage` recent activity | `client.get('/audit?limit=…')` | `GET /audit` (AUD-01 repository, global-admin) | ✓ | ✓ FLOWING |
| `AppsPage` list/tag filter | `client.get('/apps')` + tag filter | `GET /apps` (`listByOwner`) | ✓ | ✓ FLOWING |
| `SubmissionsPage` rows | `client.get('/submissions?app_id&status&from&to&form')` | `SubmissionRepository.listByApp` (composed filters) | ✓ | ✓ FLOWING |
| `UsersPage` autocomplete | `GET /users/search?q=` | `ProfileRepository.findAll` prefix filter | ✓ | ✓ FLOWING |
| `PublishController` share drops | `RoutingShareComputer.countsOverLabels` | `RoutingOutcomeRepository.outcomesForIntent/App` (24h window) | ✓ | ✓ FLOWING |
| `DataRouterService.routeEdit` refusal | `assertAcceptsSubmissions(appId)` | `AppDefinitionRepository.findByAppId` → `AppLifecycle.assertAcceptsSubmissions` | ✓ | ✓ FLOWING (the refusal's input is the live lifecycle state, not a hardcoded literal — the integration proof drives it by archiving the app through the real API) |
| `EditorPage` publish confirmation | `response.changeSummary` / `response.zero_change` | `POST /apps/:id/publish` → `PublishGateService.buildChangeSummary` (the same rows the AUD-01 entry retains) | ✓ | ✓ FLOWING (NEW this round — the confirmation rows are the endpoint's computed rows, not client-derived; `PublishResultSchema` gates the shape before they reach state) |
| `OtpStateMachine` attempts | Redis `INCR akane:otp:{chatUserId}:attempts` | real Redis | ✓ | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Build gate (lint + tsc -b) | `npm run build` | exit 0 (eslint clean, tsc -b clean) at bb49dc92 | ✓ PASS |
| Full unit/integration suite | `npx vitest run` | 124 files / 1196 tests — 1195 passed, 1 failed at bb49dc92 (the documented pre-existing `tooling/entrypoint-drift.spec.ts` orphan walk, out of scope per 06-02-deferred-items.md; identical to the pre-closure run — no regressions from the publish-surface commit) | ✓ PASS (1 pre-existing, documented) |
| SPA specs (publish shortcut, session client, undo history, sandbox) | `npx vitest run apps/app-builder` | 4 files / 14 tests passed at bb49dc92 | ✓ PASS |
| Publish API contract (changeSummary + zero_change, real testcontainers) | `npx vitest run apps/api/src/app-builder/publish.integration.spec.ts` | 6/6 passed at bb49dc92 (51s, real MongoDB+Redis; asserts the exact changeSummary rows and the zero_change flag the SPA's PublishResultSchema consumes) | ✓ PASS |
| BLD-06 shortcut predicate + seam mode behavior + lifecycle | `npx vitest run apps/app-builder/src/editor/publishShortcut.spec.ts packages/domain/src/datarouter/data-router.spec.ts packages/domain/src/builder/app-lifecycle.spec.ts` | 3 files / 31 tests passed (at 9c98ce3d) | ✓ PASS |
| APP-06 real-path proof (testcontainers) | `npx vitest run apps/api/src/app-builder/app-definition.integration.spec.ts` | 13/13 passed (45s, real MongoDB+Redis; incl. "APP-06 both ways" over the real HTTP path) | ✓ PASS |
| Edit-link semantics + outbox atomicity (seam-level, pass-through double) | `npx vitest run apps/api/src/read/edit-link.integration.spec.ts packages/domain/src/datarouter/outbox.integration.spec.ts` | 2 files / 8 tests passed | ✓ PASS |
| APP-07/08 publish gate + read controller | `npx vitest run apps/api/src/app-builder/publish.integration.spec.ts apps/api/src/read/read.controller.spec.ts` | 2 files / 14 tests passed | ✓ PASS |
| Boot contract with the new ReadModule→AppBuilderModule wiring + renderer read/edit | `npx vitest run apps/api/src/onboarding.integration.spec.ts apps/renderer/src/read` | 3 files / 97 tests passed (onboarding boots the full API with the new module composition) | ✓ PASS |
| Boundary graph consistency (datarouter→builder edge) | `npx vitest run tooling/boundaries.fixture.spec.ts` | 9/9 passed | ✓ PASS |
| Playwright e2e (BLD-01/04/09) | `npx playwright test` | cannot launch Chromium in this sandbox (`libatk-1.0.so.0` missing; no root) | ? SKIP (environmental — see Human Verification) |

### Probe Execution

No phase-declared probe scripts (`scripts/*/tests/probe-*.sh`) exist for this phase; the verification substrate is the vitest/playwright suites above, executed directly.

### Requirements Coverage

All 25 requirement IDs from REQUIREMENTS.md mapped to this phase are assessed in the Observable Truths table above: 24 ✓ SATISFIED, 1 ⚠️ NEEDS HUMAN (BLD-09 tablet usability — code present, e2e unexecutable here). No orphaned requirements (REQUIREMENTS.md's Phase 6 mapping matches the plan claims exactly). Both previously-blocked requirements (APP-06, BLD-06) are SATISFIED, and the publish-surface advisory is closed in code (bb49dc92) — the SPA now carries a visible Publish button, the chord hint, and the change-rows confirmation.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `apps/app-builder/src/editor/EditorPage.tsx` | 417, 526, 540 | `.spacer` used outside `.card-head` — the class only flexes under `.card-head` (chrome.css:174), so in `.page-head > .titles > .od-row` and the change rows it is a zero-width no-op | ℹ️ Info | Cosmetic: the Publish button sits beside the version pill rather than right-aligned, and the change rows pack left rather than space-between as the mockup's `openPublish` rows do. No functional impact — the button is visible and works; recorded for the visual-fidelity human item, not a must-have failure |
| `apps/worker/src/processors/otp-delivery.service.ts` | 25-27 | Log-only port implementation | ℹ️ Info | Declared manual-verify item (live Slack DM in staging); the seam is correct and everything else is tested |
| `packages/domain/src/authz/rbac.service.ts` | 7-25 | Hardcoded stub (always returns true) | ℹ️ Info | **Pre-existing Phase 2 code** (read-link path only; `git log` confirms). Not consumed by any Phase 6 builder surface — the builder's authorization is `assertOwner` + `createBuilderAbility`. Recorded for the read-path hardening follow-up, not a Phase 6 defect |

No `TBD`/`FIXME`/`XXX` debt markers, no placeholder returns, no hardcoded-empty render data in any Phase 6 file. The previous round's warning (publish reachable only via undocumented keyboard shortcut) is resolved at bb49dc92 — the editor head now carries the visible Publish button and chord hint. The three pass-through `assertAcceptsSubmissions` doubles (`data-router.spec.ts:15-17`, `outbox.integration.spec.ts:19`, `edit-link.integration.spec.ts:74-80`) are documented test doubles with written rationale (their subjects are mode behavior, atomicity, and link semantics — the guard itself is proven on the real path), not production stubs.

### Human Verification Required

1. **Live OTP delivery through the chat pipeline (IDN-05)** — trigger the onboarding keyword from an unmapped Slack identity; the code must arrive via Slack DM, the reply must verify and create the mapping. The state machine and pipeline are integration-tested over real Redis; only the DM leg is unwired (OtpDeliveryService logs the identity). Staging item per 06-VALIDATION.md.
2. **Wizard usability without documentation (BLD-01)** — walk the 5 steps with no prior context.
3. **Playwright e2e suite execution** — run `npx playwright test` (chromium + tablet projects) on a machine with browser OS dependencies; the specs are present and configured but could not launch Chromium in this sandbox.
4. **Tablet touch pass (BLD-09)** — one manual pass on a real tablet at 768×1024.
5. **Publish confirmation visual fidelity (BLD-06)** — the surface now exists (bb49dc92): confirm the post-publish change-rows banner satisfies BLD-06's "publish confirmation summarises every change" contract (the mockup depicts a *pre*-publish modal, `prototypes/mockup.html:1578-1601` — confirm the post-publish shape is acceptable or schedule the modal), and note the `.spacer` alignment nuance (button beside the version pill rather than right-aligned; rows packed left rather than space-between).

### Gaps Summary

**No gaps remain.** Both declared gaps are closed and verified against code and tests, and the one advisory raised by the prior re-verification is closed in code:

**Gap 1 (was BLOCKER) — APP-06: CLOSED.** The guard runs at the submission-creation seam in both `routeSubmission` and `routeEdit` before the transaction (`data-router.service.ts:73,131`); the refusal surfaces on the real HTTP path as `409 SUBMISSION_REFUSED_ARCHIVED` (`read.controller.ts:279-284`) with nothing inserted and the edit token not consumed; the boundary graph (`boundaries.config.mjs`, Pattern 7) and DI wiring (`read.module.ts` over `AppBuilderModule`'s export) carry the dependency; and the integration proof exercises the real path — a genuinely signed ES256 edit link POSTed through the live Nest app — proving the control accepted pre-archive, the refusal post-archive (with the revisions collection still holding only the pre-archive row), the identical retry refusal, and the pre-archived view link still resolving. 13/13 tests pass.

**Gap 2 (was minor) — BLD-06 keyboard shortcut: CLOSED.** The pure `isPublishShortcut` predicate (both modifiers, case-insensitive, near-miss rejection) is table-driven-spec'd, and `EditorPage` wires a keydown listener over a publish callback that POSTs `/apps/:id/publish` — the same endpoint the API publish surface exposes — with a published banner and inline verbatim refusals.

**Advisory (was the prior round's headline) — publish surface: CLOSED at bb49dc92.** The editor head now carries a visible Publish button (`.btn .btn-primary .btn-sm`, the mockup's own publish-button classes) and the platform chord hint (`Ctrl+S` / `⌘S`). The button's `onClick` and the Ctrl/Cmd+S keydown listener fire the same `publish` callback against the same `POST /apps/:id/publish` endpoint — one code path, so the two cannot diverge (the 06-05 contract's own wording). The button is disabled while saving. The post-publish confirmation renders the `changeSummary` rows the endpoint returns (`{field, from, to}` — the same rows the AUD-01 entry retains) and names a zero-change publish inline via the endpoint's `zero_change` flag. The response validates through the new `PublishResultSchema` (definition projection + changeSummary rows + zero_change), and the API contract matches (`publish.controller.ts:88-106`; `publish.integration.spec.ts` asserts both fields, 6/6 at HEAD). Verified at three levels: the artifacts exist and are substantive (EditorPage.tsx:417-520, definition.ts:166-228), wired (button `onClick` → `publish()`; keydown → `publish()`; `PublishResultSchema` → `client.post`), and data flows (the confirmation rows are the endpoint's computed rows, not client-derived).

Status is `human_needed` (not `passed`) because human-verification items remain — the environmental Playwright limitation (BLD-09), the live OTP leg (IDN-05), the no-documentation walkthrough judgement (BLD-01), and the publish-confirmation visual fidelity — not because any must-have fails.

---

_Verified: 2026-10-13T06:01:04Z_
_Verifier: the agent (gsd-verifier)_
