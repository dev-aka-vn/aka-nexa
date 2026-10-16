---
status: partial
phase: 06-self-service-app-builder
source: [06-VERIFICATION.md]
started: 2026-10-13T08:48:15Z
updated: 2026-10-16T21:50:00Z
---

## Current Test

[testing complete — 5 passed, 0 issues, 1 blocked on physical hardware (test 4)]

## Tests

### 1. Live OTP delivery through the chat pipeline (IDN-05): trigger the onboarding keyword from an unmapped Slack identity, receive the 6-digit code in Slack, reply, and confirm the identity mapping is created and the granted app becomes usable
expected: The code arrives via Slack DM within seconds; the reply verifies, creates the mapping, and the next inbound event resolves the user
why_human: >-
  Declared manual-verify item (06-VALIDATION.md). The worker's OtpDeliveryService
  (apps/worker/src/processors/otp-delivery.service.ts) implements OtpDeliveryPort by
  logging the chat identity only — the real Slack DM leg is deliberately not wired
  until staging. Everything else (state machine, timing, lockout, single-use, mapping
  creation, pipeline wiring) is implemented and integration-tested over real Redis.
result: pass

### 2. Walk the 5-step wizard with no prior context (BLD-01): create an app end-to-end without reading any documentation
expected: Each step is self-explanatory; step 1 creates the draft and toasts 'Saved as a draft · continue through the wizard steps'; forward navigation blocks until each step validates
why_human: "'Without documentation' is a human judgement (06-VALIDATION.md manual-only row). The wizard implementation matches the mockup's step rail and copy, and wizard.spec.ts encodes the flow — which now actually runs (66/66, test 3), so the flow is machine-verified; no assertion, however, can judge whether a first-time admin finds it self-explanatory."
result: pass
resolved: 2026-10-16 — user confirmed the full flow on the live stack after the
  G-06-6/07/08 gap-closure plans and the G-06-9 inline fixes (dialog styling, form
  save leg, dead chrome CSS removal, hover-toolbar leak, toolbox width, designer
  exit, .view centering, editor designer entry, tab chevrons). Original findings
  and their resolutions are preserved below for the audit trail.
reported: "Form Desiger seems broken style, lost arrangement & style. After form design completion, how do I back to wizard?"
retest: >-
  2026-10-16 interactive session (live stack). After the G-06-6/07/08 gap-closure
  plans landed, the walkthrough surfaced five further findings, all diagnosed and
  fixed inline the same day (gap G-06-9 below): the component-settings dialog
  mounted at document.body outside the formio-scope root (broken controls),
  18px hover-toolbar buttons stretched by the chrome's global .btn min-height,
  the designer had no form-save path at all (only local state), a no-snapshot
  visit left the designer with no exit control, and dead unscoped chrome CSS
  (.nav-item width:100%) stacked the dialog tabs vertically. Also fixed the same
  day: toolbox width (col-md-2 → 200px), .view centering on >1440px viewports,
  the editor Forms-tab designer entry, and the editor tab-bar scroll chevrons.
  Each fix verified by computed-style probe and the e2e suite (18/18 chromium
  designer+wizard+editor, then designer 5/5 after the toolbox change). This
  retest asks the user to confirm the whole test-2 flow passes on the live stack.
severity: major
diagnosis: >-
  Two distinct findings, both surfaced while walking this test — the designer is step 4's
  surface, so both sit squarely inside "create an app end-to-end".

  (1) The FormIO canvas and preview render UNSTYLED. Measured, not inferred. The @formio/js
  5.x active template set is Bootstrap 5, so the builder and the preview emit Bootstrap 5
  class names (row, col-md-2, col-md-10, col-sm-3, form-control, card, card-header,
  btn-outline-primary, d-grid, mb-2, col-form-label, visually-hidden) — but Bootstrap's
  stylesheet is never loaded. The only CSS imported is
  @formio/js/dist/formio.full.min.css (FormioBuilderField.tsx:220, PreviewPane.tsx:139),
  which styles .formio-* and carries a bare .form-control{height}, with no grid or utility
  CSS and no :root token layer. @formio/bootstrap ships class names only (no CSS at all),
  and node_modules/bootstrap/dist/css/bootstrap.min.css (226.7 KB, bootstrap@5.3.8) is
  installed but imported nowhere. Probe (repo-root probe-designer-style.mjs, real Chromium
  against the live SPA, spike route — the same FormioBuilderField component, template set
  and CSS import the designer mounts): --bs-primary EMPTY; no stylesheet rule defines .row;
  .row computes display:block / flex-wrap:nowrap (Bootstrap's .row is display:flex / wrap);
  the emitted .col-md-2 and .col-md-10 both compute width:1280px (full width, not 2/12 and
  10/12); .form-control computes 2px inset / padding 1px 2px / width 177px — the browser's
  default <input>, not a styled control. Every column collapses and every field stacks
  full-width. This is why the suite never saw it: the S1 acceptance criterion
  (06-01-PLAN.md:38 — "renders without silently broken 4.x grid classes") was verified by
  asserting class NAMES in the DOM (s1-spike.spec.ts), and drag-drop / undo-redo all work
  fine over a dead grid. Recorded as G-06-6.

  (2) The designer is a navigation dead end — the direct answer to the second question.
  Step 4 links out to the designer (FormStep.tsx:58-66, data-testid="wizard-open-designer"
  -> #/apps/:id/designer) and FormDesignerPage offers no return affordance whatsoever: its
  page-head is an h1 plus a sub line (FormDesignerPage.tsx:442-452), with no back control,
  no breadcrumb and no done action. The sidebar's Create app link (#/wizard) is a FRESH
  wizard — WizardPage keeps every field in useState, with draft=null and step=0
  (WizardPage.tsx:111-131), so it remounts at step 1 with empty inputs — and browser Back
  behaves identically. The draft survives server-side (POST /apps on step 1, then PATCH per
  section on Next), so nothing saved is lost; the wizard's position and any in-progress
  step input are. Recorded as G-06-7.
prior_context: >-
  The row was blocked on human-judgement until 2026-10-15 and was re-opened for this live
  walkthrough. The stack (mongo 8.0 :27017, redis 8.10 :6379/6380, api 127.0.0.1:3000, SPA
  127.0.0.1:5173) runs and login completes against the in-repo StubOidcIssuer; the write
  path was already proven by the user's own template fork at 2026-10-15T18:38:54+07:00 — the
  surface that produced G-06-5. 66 final-state screenshots (every spec, both viewports) are
  at C:\Users\stl-l\AppData\Local\Temp\opencode\uat-shots\final\ — including
  wizard-create-wizard-BLD-0-8d736-* (the five-step rail and step 1 blocking forward
  navigation) and wizard-create-wizard-BLD-0-4f249-* (steps 2-5 and the verbatim draft
  toast).

### 3. Execute the Playwright e2e suite (npx playwright test) on a machine with browser OS deps installed
expected: The chromium and tablet projects pass across wizard.spec.ts, designer.spec.ts, roles.spec.ts, editor.spec.ts, dashboard.spec.ts, submissions.spec.ts, connectors.spec.ts, s1-spike.spec.ts
why_human: >-
  Environmental: the authoring sandbox could not launch Chromium (libatk-1.0.so.0 missing,
  no root). Re-run on a Windows machine with Chromium installed (Playwright 1.64.0,
  chromium-1248).
result: pass
note: >-
  `npx playwright test` (the documented bare command) → 66 passed (1.4 m), both projects
  (chromium 33 + tablet 33), exit 0; `npx playwright test apps/app-builder/e2e --reporter=list`
  → 66 passed (1.8 m). G-06-3's reported single failure reproduced as a cold-start flake, not a
  deterministic break: the first builder mount was pinned to a fixed 20 s visibility ceiling,
  while that one wait measured 6–40 s across repeated isolated runs on this machine (vite
  cold-transforming the 3.68 MB `@formio/js` graph). Fixed by raising the mount ceiling to a
  named BUILDER_MOUNT_TIMEOUT_MS = 60 s and the per-test budget to 120 s in designer.spec.ts +
  s1-spike.spec.ts, and by scoping playwright.config.ts `testDir` to apps/app-builder/e2e so
  the bare command no longer aborts collecting a vitest stub at tests/e2e/slack-leave.e2e.spec.ts.
  Cold-isolation repeat (`--repeat-each=5` over designer.spec.ts + s1-spike.spec.ts, chromium)
  → 45 passed (2.1 m), 0 flaky — the same method the prior Nyquist pass used to bound this
  wait (it recorded 20/20 for designer alone).
  A `--trace on` run then exposed a SECOND, independent flake: roles.spec.ts asserted its
  loading skeleton while its own stub fulfilled the read in ~1 ms, so the placeholder could be
  replaced before Playwright's first poll. Fixed by letting the stub hold the read open
  (`appGetDelayMs`). Re-run under the condition that had failed, `npx playwright test --trace
  on` → 66 passed (2.8 m), exit 0. See deferred-items.md (Resolved, 2026-10-15).
  RE-RUN 2026-10-15 19:06 (+07:00), after the G-06-5 fix changed apps/app-builder/vite.config.ts:
  bare `npx playwright test` → 66 passed (1.7 m), exit 0, both projects (chromium 33 + tablet
  33), no flaky tests. This run is the regression check on that config change, and it matters
  because playwright.config.ts `webServer` boots the SPA through the very vite config the fix
  edited (`npx vite --config apps/app-builder/vite.config.ts`, line 72) — the suite had to be
  re-proved on the changed proxy, not assumed. It was: the `changeOrigin: false` /api rule and
  the added /auth rule are transparent to `npx playwright test`, because every spec satisfies
  its own /api/** calls with `page.route` and never reaches the proxy.
  Reproduced again with the run captured to a log (exit 0, `66 passed (2.0 m)`, no flaky line):
  the vite dev server emits, twice per run while the designer spec exercises the JSON/CSS tabs,
  `[Unhandled error] Error: Uncaught NetworkError: Failed to execute 'importScripts' on
  'WorkerGlobalScope': The script at 'https://cdn.form.io/ace/1.4.12/worker-json.js' failed to
  load.` Playwright forwards it as a `[WebServer]` line — the same third-party cdn.form.io Ace
  dependency already recorded in deferred-items.md. It is a vite-level console error, not a
  test failure (the designer spec passes in the run that emits it), so it does not change this
  test's result; it is noted because a captured reproduction is evidence for that deferred
  finding. Capture:
  C:\Users\stl-l\AppData\Local\Temp\opencode\uat-shots\pw-run.log

### 4. Tablet touch pass (BLD-09): one manual pass on a real tablet at 768×1024
expected: The wizard, editor and designer are usable without a mouse
why_human: "Human judgement the emulated viewport only approximates; skeletons are code-verified, touch usability is not. (The BLD-09 truth is the phase's single PRESENT_BEHAVIOR_UNVERIFIED must-have — present and wired, behavior not exercised.)"
result: blocked
blocked_by: physical-device
reason: >-
  Two prerequisites. The second is now satisfied; the first cannot be satisfied from this
  machine, so the test stays blocked — but on hardware alone.

  (2) An authenticated session for a live UI — RESOLVED 2026-10-15. The data stack and API run
  on this machine (mongo 8.0 on 27017, redis 8.10 on 6379/6380, the api on 127.0.0.1:3000, the
  SPA on 127.0.0.1:5173) and login works end to end against the in-repo StubOidcIssuer, so the
  blocker recorded here originally (OIDC_ISSUER pointing at https://idp.example.com, no stub
  IdP server in the repo, no dev auth bypass) no longer applies. It never mattered for the
  emulated project anyway: those specs stub the session with page.route and need no stack.

  (1) Physical hardware — STILL BLOCKED, and now for a verified reason. The truth is a manual
  pass on a real tablet at 768×1024 "without a mouse", and no emulation reproduces multi-touch
  or real scroll behaviour. The emulated tablet project does pass, 33/33 (re-confirmed
  2026-10-15), but a Playwright pass run on 2026-10-15 checked *why* that cannot count as this
  test's evidence: no spec in apps/app-builder/e2e calls `tap()` or dispatches any
  touch/pointer event, and the tablet project differs from chromium only by
  `viewport: {width: 768, height: 1024}` plus `hasTouch: true, isMobile: true`
  (playwright.config.ts:63-69). So the tablet run exercises layout and responsive reflow under
  a narrow viewport with a touch-capable device profile, while every interaction in it is
  still a mouse click. It is layout evidence, full stop.
  Partial evidence available offline: the emulated 768×1024 final frames for every spec are at
  C:\Users\stl-l\AppData\Local\Temp\opencode\uat-shots\final\ (the `*-tablet.jpeg` files, e.g.
  wizard-create-wizard-BLD-0-8d736-*-tablet.jpeg and editor-the-editor-renders-*-tablet.jpeg).
  Those can narrow the judgement — layout, tap-target size, whether anything overflows — but
  they cannot satisfy the test's own condition, which is a device in a human's hands.

### 5. Publish confirmation visual fidelity (BLD-06): the surface exists and the head pair is now right-aligned (4fe54c5b) — confirm the rendered surface satisfies the mockup's confirmation intent
expected: >-
  The editor head shows a visible Publish button (now right-aligned against the head
  row via the auto flex margin, 4fe54c5b) plus the Ctrl+S / ⌘S chord hint, and the
  post-publish banner lists the change rows (field, from → to) the endpoint returns,
  naming a zero-change publish inline. Two fidelity questions remain for a human eye:
  (a) the implementation confirms AFTER publish (banner with rows) whereas the
  mockup's openPublish is a PRE-publish modal with a Confirm button
  (prototypes/mockup.html:1578-1601) — confirm the post-publish confirmation
  satisfies BLD-06's 'publish confirmation summarises every change' contract, or
  schedule the pre-publish modal (the 06-UI-REVIEW disposition records this as a
  frozen-contract divergence where the contract wins, per the AGENTS.md precedence
  rule); (b) the change-rows still carry a .spacer span (EditorPage.tsx:529) that
  only flexes under .card-head, so the rows pack left rather than space-between as
  the mockup's openPublish rows do — cosmetic, the rows are readable and correct.
why_human: "Visual rendering + product-shape judgement that grep cannot settle; Playwright cannot launch in the authoring sandbox. The payload shape is unit-tested (buildChangeSummary, publish-gate.service.spec.ts) and the API contract is integration-tested (publish.integration.spec.ts asserts changeSummary and zero_change), but the rendered fidelity needs a human eye."
result: pass
note: >-
  Question (a) is answered by the frozen contract, not by taste: the change summary is defined
  as the publish *response* payload (packages/contract/src/builder/publish.contract.ts —
  PublishResponseSchema.changeSummary, per PublishGateResult.changeSummary) and the only route
  is POST apps/:id/publish (apps/api/src/app-builder/publish.controller.ts). There is no
  dry-run endpoint, so a *pre*-publish modal as the mockup's openPublish depicts
  (prototypes/mockup.html:1600-1619) would require a new endpoint the phase never froze — the
  post-publish banner is the only shape the contract supports. Re-derived independently, then
  matched 06-UI-REVIEW.md disposition #2 ("frozen-contract divergence, contract wins"). The
  rendered banner names the version and the zero-change case inline and lists the change rows
  the endpoint returns (EditorPage.tsx:486-538), satisfying BLD-06's "summarises every change".
  Question (b) is confirmed from the code and is cosmetic: the change rows carry
  `<span className="spacer" />` (EditorPage.tsx:529) while the spec's own comment records that
  ".spacer only flexes under .card-head" (EditorPage.tsx:425-426), so the rows pack left rather
  than space-between. Readable and correct; a one-line `justifyContent` change if the mockup's
  spacing is wanted.
  Surfaced while answering this and logged as G-06-4 below: publish fires with no confirmation
  at all, and Ctrl/Cmd+S can publish while a section's JSON is mid-edit
  (EditorPage.tsx:325-374) — the unsaved-changes guard 06-UI-REVIEW already calls a legitimate
  follow-up. Screenshots of the auth-stubbed surface (no backend needed) are at
  `%TEMP%\opencode\uat-shots\final\editor-the-editor-renders-*0fd8a*` if a visual re-check is
  wanted.

### 6. Signer renderer layout (G-06-8): the read and edit pages render the authored form with the layout its schema describes
expected: A two-column form's columns sit side by side as fractions of a wrapping flex row, and every control computes a 1px top border and 12px left padding — on both signer pages, at 1280px and at 768px
result: pass
note: >-
  Machine-verified, not a human walkthrough: `apps/renderer/e2e/renderer-form-layout.spec.ts`
  (guard `signer renderer layout (G-06-8)`) boots the renderer's own dev server on 5174, fulfils
  each page's link fetch with a two-column schema (widths 2 and 10, one text field each), and
  asserts by computed style — the scope root exposes a non-empty theme token, every row inside
  it is a wrapping flex container, the 2/12 and 10/12 columns are fractions of their row, and
  every form-control computes Bootstrap geometry — with explicit count assertions so no loop
  passes vacuously. `npx playwright test --project=renderer --project=renderer-tablet` →
  4 passed (read + edit × 1280px + 768px), exit 0. This is the coverage G-06-8 records as
  missing: no UAT test rendered a read or edit page before, which is why the unstyled signer
  form shipped.

## Summary

total: 6
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 1

## Gaps

- gap_id: G-06-3
  truth: "The chromium and tablet projects pass across wizard.spec.ts, designer.spec.ts, roles.spec.ts, editor.spec.ts, dashboard.spec.ts, submissions.spec.ts, connectors.spec.ts, s1-spike.spec.ts"
  status: resolved
  resolved_by: "inline UAT fix (no gap-closure plan) — apps/app-builder/e2e/designer.spec.ts, apps/app-builder/e2e/s1-spike.spec.ts, playwright.config.ts"
  resolved_at: 2026-10-15
  reason: "User reported: Ran Playwright e2e on chromium project: 32 passed, 1 failed. Failure in apps/app-builder/e2e/designer.spec.ts: the designer mounts the builder; an added component captures one history entry and undo/redo round-trip - .formio-builder-form not visible (timeout 20000ms)."
  root_cause: >-
    Cold-start flake, not a code defect. `designer.spec.ts` pinned the *first* builder mount to a
    fixed 20 s visibility ceiling. That single wait is dominated by the vite dev server
    cold-transforming the 3.68 MB `@formio/js` dependency graph, and measured 6 s–40 s across
    repeated isolated runs on this machine — so a 20 s ceiling is a coin flip. The reported run's
    failure ("timeout 20000ms") reproduces the wait landing just past the ceiling; the same spec
    passes in 19.5 s when the machine is idle. Prior hardening (06-VALIDATION) raised the
    per-test budget to 90 s but left the inner visibility wait at 20 s. Two contributing
    environment facts, both recorded as separate findings below rather than causes: the mount
    cost is machine-load-dominated, and FormIO lazily loads its Ace editor from `cdn.form.io`
    at runtime.
  severity: major
  test: 3
  artifacts:
    - path: "apps/app-builder/e2e/designer.spec.ts"
      issue: "Builder-mount `toBeVisible` waits pinned to a fixed 20 s ceiling while the wait measures 6–40 s on a cold/contended vite server."
    - path: "apps/app-builder/e2e/s1-spike.spec.ts"
      issue: "Same 20 s mount ceiling; also carried no per-test budget override, so the default 30 s test timeout capped it."
    - path: "playwright.config.ts"
      issue: "Root-wide `testDir: './'` collected tests/e2e/slack-leave.e2e.spec.ts — a vitest stub, not a Playwright spec — so the documented bare `npx playwright test` aborted at collection time with \"Cannot read properties of undefined (reading 'config')\" before running a single test."
  resolution: >-
    Raised the mount ceiling to a named `BUILDER_MOUNT_TIMEOUT_MS = 60_000` and the per-test budget
    to `120_000` in both designer.spec.ts and s1-spike.spec.ts (every post-mount assertion stays
    tight — only the cold mount is allowed headroom). Scoped playwright.config.ts `testDir` to
    `./apps/app-builder/e2e` so the harness only collects the suite this config describes; all
    documented invocations (bare, directory-scoped, file-scoped) collect correctly.
  evidence: >-
    `npx playwright test` (bare) → 66 passed (1.4 m), exit 0, both projects. `npx playwright test
    apps/app-builder/e2e --reporter=list` → 66 passed (1.8 m). Cold-isolation repeat
    (`designer.spec.ts` + `s1-spike.spec.ts`, `--project=chromium --repeat-each=5`) →
    45 passed (2.1 m), 0 flaky. designer.spec.ts + s1-spike.spec.ts in isolation → 9 passed.
    --list checks: bare 66, directory+project 33, file+project 4. `npx eslint .` → exit 0.
  missing: []
  debug_session: ""

- gap_id: G-06-4
  truth: "Publish cannot fire by accident: the action is confirmed before the change takes effect, and the Ctrl/Cmd+S shortcut cannot publish while a section's JSON is mid-edit"
  status: resolved
  resolved_by: "plan 06-11 — apps/app-builder/src/editor/publishGuards.ts, apps/app-builder/src/editor/publishGuards.spec.ts, apps/app-builder/src/editor/EditorPage.tsx, apps/app-builder/e2e/editor.spec.ts"
  resolved_at: 2026-10-16
  reason: >-
    Surfaced while resolving UAT test 5 (it does not fail test 5's human question, which is
    answered by the contract — see test 5). Publish fires immediately from the button and from
    Ctrl/Cmd+S with no confirmation of any kind (EditorPage.tsx:325-374); the mockup gates the
    same action behind a confirm modal — "Publish \"{name}\"?" / "Review the changes that take
    effect immediately." / change rows / Cancel + "Confirm publish" (mockup.html:1600-1619).
    06-UI-REVIEW.md records this twice: the Pillar 6 score of 2/4 ("publish fires with no
    confirmation") and the Visuals WARNING "no publish confirmation … the shortcut will publish
    even while a section's JSON is mid-edit".
  root_cause: >-
    Two halves with different verdicts. The *pre-publish modal* is a frozen-contract
    divergence: the change summary is the publish *response* payload and no dry-run endpoint
    exists, so the mockup's modal cannot be restored without a new contract (per the AGENTS.md
    precedence rule the contract wins — that half is closed, not open). The *unsaved-changes
    guard* is a genuine, actionable defect: the shortcut publishes a section's persisted state
    while its JSON editor is mid-edit. Blast radius is bounded because a malformed payload is
    refused inline (BLD-07) so nothing publishes — but a valid-yet-incomplete edit does publish.
  severity: minor
  test: 5
  artifacts:
    - path: "apps/app-builder/src/editor/EditorPage.tsx"
      issue: "publish() is wired straight to the button (line 428-437) and to the Ctrl/Cmd+S listener (325-374) with no confirmation step and no dirty-JSON check."
  resolution: >-
    One `requestPublish()` gate both entry points route through: the publish button and the
    Ctrl/Cmd+S chord open the gate, and `publish()` is reachable only from the gate's confirm
    control (proven by recorded POST count — zero until confirm, exactly one after). Only the
    chord carries the dirty-JSON guard: a chord over a mid-edit section is blocked inline naming
    the section, and saving clears it. The gate states the effect without change rows (the
    change summary is the publish response payload; no dry-run endpoint exists — frozen-contract
    precedence), and the stub PATCH echoes the forms-section patch so a saved edit stops reading
    as dirty.
  evidence: >-
    `npx vitest run apps/app-builder/src/editor/publishGuards.spec.ts` → 5 passed (the two pure
    BLD-06 predicates). `npx playwright test apps/app-builder/e2e/editor.spec.ts` → 5/5 in the
    chromium project and 5/5 in the tablet project (confirmation gate + dirty-chord tests).
    Full app-builder set 72/72 green with no regressions (per 06-11-SUMMARY.md).
  missing: []
  debug_session: ""

- gap_id: G-06-5
  truth: "Through the dev proxy a builder's own browser can complete every write path the App Builder has - create app, fork template, save section, publish, deprecate, archive and logout - and the CSRF gate still refuses genuinely cross-origin requests"
  status: resolved
  resolved_by: "quick task 261015-p1h — apps/app-builder/vite.config.ts, .env.example, README.md, tooling/dev-proxy-shape.spec.ts (commits 8e771a6, b9540a6, d57aeca, 0a41ac7)"
  resolved_at: 2026-10-15
  reason: >-
    User report, verbatim: "I could access app but app creation or use template seems not work.
    are they not implement or error?" The answer is an ERROR, not an unimplemented feature.
    Both paths were fully implemented and seeded - `GET /templates` returns 200 with the 10
    seeded templates and `POST /apps` returns 201 with a full definition - but every
    *state-changing* request the SPA sent answered 403 `CSRF_ORIGIN_MISMATCH`. Reads
    (dashboard, app list, template gallery) all work, which is exactly why the app looked
    half-alive rather than dead.
  root_cause: >-
    The `apps/app-builder/vite.config.ts` dev proxy was configured `changeOrigin: true` on
    `/api`, so http-proxy rewrote the request's Host header to the target's
    (`127.0.0.1:3000`). The CSRF gate in `apps/api/src/auth/session.middleware.ts:96-111` is a
    T-06-04 / D-101 contract that compares the request's `Origin` host against its `Host`
    header (`sameOrigin = new URL(origin).host === host`, line 102). The browser therefore
    sent `Origin: http://127.0.0.1:5173` while the API saw `Host: 127.0.0.1:3000`, so every
    mutation was refused - and logout too, since it is a POST. The gate was never wrong: it
    correctly fails closed. The dev proxy was defeating the same-origin illusion its own doc
    comment claims ("the browser SPA talks to the API origin through one origin story in
    dev", vite.config.ts:14-19).
  severity: major
  test: 2
  artifacts:
    - path: "apps/app-builder/vite.config.ts"
      issue: "`/api` proxy used `changeOrigin: true`, rewriting Host to the API origin so the CSRF gate could never see a same-origin request; no `/auth` rule existed either, so the OIDC callback had nowhere to land on the SPA origin."
    - path: "apps/api/src/auth/session.middleware.ts"
      issue: "Not a defect. Line 102's host comparison is the frozen contract and is correct; recorded here so nobody 'fixes' it by relaxing the gate. apps/api/src/auth/auth.session.integration.spec.ts:350-399 pins this behaviour."
  resolution: >-
    `changeOrigin: false` on `/api` so the browser's Host is forwarded verbatim - the API now
    observes a genuinely same-origin request. Added an `/auth` proxy rule (also
    `changeOrigin: false`, no path rewrite) because `oidc.service.ts` derives the callback's
    redirect_uri from the request (`protocol://host + originalUrl`, line 411) while `begin`
    uses the configured value verbatim (line 382); with the Host preserved the two only agree
    if `OIDC_REDIRECT_URI` names the SPA origin, which is now documented in `.env.example`
    and `README.md`. Bonus: login now finishes on the SPA root instead of the API's bare 401
    JSON root, making dev closer to the production same-origin shape. Added
    `tooling/dev-proxy-shape.spec.ts` as a deterministic guard for the invariant.
  evidence: >-
    Before (5-way probe, varying only the Origin header, same `POST /apps` body): no Origin →
    403; `Origin: 127.0.0.1:5173` direct → 403; **via the `/api` proxy with
    `Origin: 127.0.0.1:5173` — what a real browser does — → 403**; `Origin: 127.0.0.1:3000`
    direct → 201; via proxy with `Origin: 127.0.0.1:3000` → 201. D and E proved the create
    path was implemented; C proved the failure was the Host rewrite. After
    (`probe-postfix.mjs`, 17/17 PASS, exit 0): the full login chain through the proxy —
    `/api/auth/oidc/begin` → 302, the authorization request naming
    `http://127.0.0.1:5173/auth/oidc/callback`, the IdP returning to the SPA origin, the
    callback → 302 to `/` on the SPA, `/api/auth/me` → 200 — then the table with A and B
    still 403 (the gate is preserved, not bypassed), C → 201, D → 201, and E now → 403,
    because with Host preserved a `127.0.0.1:3000` Origin really is cross-origin. Real write
    surfaces through the SPA origin: templates gallery → 200 (10), `POST
    /templates/asset-request/fork` → 201, the created apps visible to the builder, `POST
    /auth/logout` → 200. Independent confirmation that this is not just a probe artefact: the
    user's own browser forked the Asset Request template at 2026-10-15T18:38:54+07:00 (app
    `asset-request`, draft, v1, createdBy 449cfa03-4207-4ce0-8fbb-b3eb40615a8f), after the
    fixed config went live in the already-open dev server at 18:12:08. All probe apps were
    deleted from Mongo afterwards; that user app was left in place.
  missing:
    - "The coverage hole that let this ship is real and only partly closed. The Playwright e2e specs satisfy every /api/** call with page.route, so the real API and its CSRF gate are never exercised through the SPA; and the api's own integration specs call it directly on one origin, where the gate always passes. Nothing tested 'the SPA's dev proxy against the real API', which is the only path a developer walks. tooling/dev-proxy-shape.spec.ts guards the configuration that caused it, but a live proxy-against-real-API test does not yet exist."
  debug_session: ""

- gap_id: G-06-6
  truth: "The authored form renders with the layout its schema describes — the designer canvas and the FRM-09 preview show the form as a signer will see it (grid columns side by side, styled controls), not a collapsed full-width stack of browser-default inputs"
  status: resolved
  resolved_by: "plan 06-09 — tooling/formio-scope-css.mjs, tooling/formio-scope-css.spec.ts, apps/app-builder/src/form-designer/formio-scope.css, apps/renderer/src/read/formio-scope.css, FormioBuilderField.tsx, PreviewPane.tsx, representativeSchema.ts, s1-spike.spec.ts, designer.spec.ts"
  resolved_at: 2026-10-16
  reason: "User report, verbatim: \"Form Desiger seems broken style, lost arrangement & style.\""
  severity: major
  test: 2
  root_cause: >-
    The active @formio/js 5.x template set is Bootstrap 5, so the builder canvas and the
    preview emit Bootstrap 5 class names — but Bootstrap's stylesheet is never loaded, so the
    emitted vocabulary has no rules behind it. Only one CSS file is imported for the whole
    FormIO surface, @formio/js/dist/formio.full.min.css (FormioBuilderField.tsx:220,
    PreviewPane.tsx:139). It styles .formio-* and carries a bare .form-control{height} rule,
    but contains no Bootstrap grid or utility CSS and no :root token layer. The template sets
    themselves cannot supply it: @formio/bootstrap ships class names only and no CSS file at
    all. bootstrap@5.3.8 is installed (a dependency of @formio/js 5.x) and
    node_modules/bootstrap/dist/css/bootstrap.min.css (226.7 KB) exists, but nothing in the
    tree imports it. Verified by measurement, not inference (repo-root probe-designer-style.mjs,
    real Chromium against the live SPA, spike route — the same FormioBuilderField component,
    template set and CSS import the designer mounts): --bs-primary EMPTY; no stylesheet rule
    defines .row; .row computes display:block / flex-wrap:nowrap where Bootstrap's .row is
    display:flex / wrap; the emitted .col-md-2 and .col-md-10 both compute width:1280px
    (full width, not 2/12 and 10/12); .form-control computes 2px inset / padding 1px 2px /
    width 177px — the browser default for an <input>. Every column collapses and every field
    stacks full-width. The suite could not see it because the S1 acceptance criterion
    (06-01-PLAN.md:38 — "renders without silently broken 4.x grid classes") was verified by
    asserting class NAMES in the DOM (s1-spike.spec.ts), and drag-drop / undo-redo function
    fine over a dead grid.
  artifacts:
    - path: "apps/app-builder/src/form-designer/FormioBuilderField.tsx"
      issue: "Imports only @formio/js/dist/formio.full.min.css (line 220). The Bootstrap 5 grid and utility classes the canvas emits (row, col-md-*, d-grid, mb-*) have no stylesheet behind them."
    - path: "apps/app-builder/src/form-designer/PreviewPane.tsx"
      issue: "The same single import (line 140). The preview is the surface FRM-09 defines as 'renders the draft form exactly as a signer would see it', so it currently shows something a signer will not see."
    - path: "apps/app-builder/src/form-designer/bootstrap5Templates.ts"
      issue: "Ports exactly one template — the Bootstrap-4-era label (sr-only -> visually-hidden). The container/form templates that emit row/col-* were never addressed, so the 5.x class vocabulary was adopted without its stylesheet. This is where the S1 spike stopped short."
    - path: "apps/app-builder/e2e/s1-spike.spec.ts"
      issue: "Asserts the 5.x class vocabulary is present in the DOM. That is the assertion that passed while the layout was dead; it measures names, not computed layout."
    - path: "node_modules/bootstrap/dist/css/bootstrap.min.css"
      issue: "Present (bootstrap@5.3.8, 226.7 KB) and imported nowhere — this is the missing stylesheet."
  resolution: >-
    One dependency-free generator (`tooling/formio-scope-css.mjs`) turns the pinned Bootstrap
    5.3.8 source into two byte-identical scope-rooted stylesheets — every selector reachable
    only beneath the `formio-scope` root, the `:root` token block landed ON the scope root,
    page-level `html`/`body` rules dropped. The designer canvas (FormioBuilderField) and the
    FRM-09 preview (PreviewPane) each statically import the sheet and carry the scope class on
    their FormIO mount containers only — never on page shell, tabs, toolbar, card or sandbox
    chrome. The class-name-only spike assertion was retired and replaced by computed-style
    guards on both surfaces.
  evidence: >-
    `node tooling/formio-scope-css.mjs --check` exits 0 (no drift).
    `npx vitest run tooling/formio-scope-css.spec.ts` → 7 passed (drift guard, byte-equality,
    parsed transform invariants). `npx playwright test apps/app-builder/e2e/s1-spike.spec.ts
    apps/app-builder/e2e/designer.spec.ts` green in the chromium and tablet projects (per
    06-09-SUMMARY.md); re-confirmed from this plan's own runs — the G-06-6 designer guard
    (canvas + preview, populated token, wrapping flex rows, fractional columns, Bootstrap
    control geometry) passes in both projects. No `bootstrap` entry added to package.json.
  missing: []
  debug_session: ""

- gap_id: G-06-7
  truth: "A user part-way through the create wizard can open the form designer from step 4, design the form, and return to the wizard to finish it without losing their wizard position or the draft they are building"
  status: resolved
  resolved_by: "plan 06-12 — apps/app-builder/src/wizard/wizardDraftStore.ts, apps/app-builder/src/wizard/wizardDraftStore.spec.ts, apps/app-builder/src/wizard/WizardPage.tsx, apps/app-builder/src/App.tsx, apps/app-builder/src/form-designer/FormDesignerPage.tsx, apps/app-builder/e2e/wizard.spec.ts"
  resolved_at: 2026-10-16
  reason: "User report, verbatim: \"After form design completion, how do I back to wizard?\""
  severity: major
  test: 2
  root_cause: >-
    The designer is a navigation dead end. WizardPage step 4 (index 3) renders exactly one
    outbound action, an <a data-testid="wizard-open-designer" href="#/apps/:id/designer">
    (FormStep.tsx:58-66), and FormDesignerPage offers no return affordance of any kind: its
    page-head is an h1 plus a sub line and nothing else (FormDesignerPage.tsx:442-452), with
    no back control, no breadcrumb and no done action. The only route back is the sidebar's
    Create app link (#/wizard, App.tsx:519, data-testid="nav-wizard"), and that is a FRESH
    wizard — WizardPage holds every field in useState with draft=null and step=0
    (WizardPage.tsx:111-131), so remounting resets it to step 1 with empty inputs. Browser
    Back behaves identically: the hash route changes, the component remounts, the state
    resets. The draft itself survives (POST /apps on step 1, then PATCH per section on Next),
    so nothing that was saved is lost — but the wizard's position and any in-progress step
    input are, and the user is left with no way to resume the flow they were in.
  artifacts:
    - path: "apps/app-builder/src/form-designer/FormDesignerPage.tsx"
      issue: "page-head carries no back, breadcrumb or done affordance (lines 442-452); the page is a one-way destination."
    - path: "apps/app-builder/src/wizard/FormStep.tsx"
      issue: "Step 4's only action navigates away from the wizard (href=#/apps/:id/designer) and the destination has no return path, so the step is a trap."
    - path: "apps/app-builder/src/wizard/WizardPage.tsx"
      issue: "All wizard state is component-local useState (step, basics, triggers, rbac, routing, draft) with no persistence and no route encoding, so any remount restarts at step 0."
    - path: "prototypes/mockup.html"
      issue: "Not a defect, and deliberately recorded as such: the mockup never depicts a designer surface, so it does not define this navigation and cannot be cited as authority either way. Its sub-pages do establish the pattern the designer does not follow — an explicit back control (line 1039: icon-btn + i-arrow-left + aria-label='Back to apps'; line 925: 'Back to dashboard'). Per AGENTS.md rule 3 (absence is not permission) the designer's navigation must be confirmed, not improvised."
  resolution: >-
    Session-scoped wizard snapshots plus route-encoded steps close the dead end: the wizard
    hydrates once on mount from the snapshot (position + in-progress inputs) and re-reads the
    draft definition from the server, syncs `#/wizard?app=<id>&step=<n>` via `replaceState`
    (never `location.hash` assignment, so no hashchange remount loop), and clears on finish.
    Leaving step 4 for the designer and returning lands back on the Form step with every typed
    input intact; a deep link with no snapshot resumes on the route step with the draft loaded;
    the sidebar Create link still opens a fresh wizard (keyed remount on app-id change). The
    designer page-head renders a return control only when a live snapshot exists — no
    back-to-app-editor breadcrumb, per the decided model.
  evidence: >-
    `npx vitest run apps/app-builder/src/wizard/wizardDraftStore.spec.ts` → 6 passed (keyed
    reads, malformed-payload and step-range rejection, per-app clear, round-trip,
    null-storage no-op). `npx playwright test apps/app-builder/e2e/wizard.spec.ts` → 8/8 in
    the chromium project and 8/8 in the tablet project (designer detour-and-return with inputs
    intact, no-snapshot deep link, fresh-wizard guard); directory suite 74/74 (per
    06-12-SUMMARY.md).
  missing: []
  debug_session: ""

- gap_id: G-06-8
  truth: "The signer-facing Form Renderer (apps/renderer read and edit pages) renders the authored form with the layout its schema describes — grid columns side by side and styled controls — not a collapsed full-width stack of browser-default inputs"
  status: resolved
  resolved_by: "plan 06-10 — apps/renderer/vite.config.ts, apps/renderer/src/read/view.html, apps/renderer/src/read/view.browser.ts, apps/renderer/src/read/edit.html, apps/renderer/src/read/edit.ts, apps/renderer/e2e/renderer-form-layout.spec.ts, playwright.config.ts"
  resolved_at: 2026-10-16
  reason: >-
    Not reported by the user — found by orchestrator investigation while scoping G-06-6
    (2026-10-15) and confirmed by the user as in-scope for this gap-closure pass. G-06-6's root
    cause is not designer-local: every consumer of @formio/js 5.x receives the Bootstrap 5
    template set by default, and apps/renderer imports formio.full.min.css without Bootstrap's
    stylesheet — so the form a signer actually fills in and reads renders unstyled. This is the
    surface the product's core value rests on ("a single rendered form").
  severity: major
  test: 2
  root_cause: >-
    Identical root cause to G-06-6, proven independently of the designer.
    (a) @formio/js wires the Bootstrap 5 template set in by default: lib/cjs/index.js:6 does
    require("@formio/bootstrap/bootstrap5"), and formio.form.js:93 defaults the framework name to
    'bootstrap' — which in 5.x is the Bootstrap 5 set (the app-builder's own
    bootstrap5Templates.ts:8-10 says the framework *name* stayed while the set became Bootstrap 5).
    (b) @formio/bootstrap ships no CSS whatsoever: lib/cjs/** is only .js/.d.ts and dist/ is only
    bootstrap{3,4,5}.js.
    (c) bootstrap@^5.3.3 is a *direct dependency* of @formio/js, and
    node_modules/bootstrap/dist/css/bootstrap.min.css (5.3.8, 226.7 KB) is installed — but nothing
    in the tree imports it.
    (d) @formio/js/dist/formio.full.min.css (130.5 KB) carries only partial Bootstrap component
    styling — .form-control{ x5, .btn{ x2, .card-body x2, .form-check x7, .invalid-feedback x6 —
    and .row has ZERO occurrences, with .mb-2 / .d-flex / .visually-hidden / .form-label /
    .form-select / .card-header / .card{ all absent. The renderer therefore emits row / col-md-*
    markup with no width rule behind it.
    The measurement is the designer's, and it is this gap's measurement too: apps/app-builder and
    apps/renderer import the same single stylesheet and share the same default template set, and
    the app-builder's registerPortedBootstrap5Templates only *extends* that set (a single label
    template, sr-only -> visually-hidden) rather than replacing it. probe-designer-style.mjs, real
    Chromium: .row computes display:block (Bootstrap's is display:flex); .col-md-2 and .col-md-10
    both compute width:1280px (full width, not 2/12 and 10/12); .form-control computes
    2px inset / padding 1px 2px / width 177px — the browser default for an <input>. Every column
    collapses and every field stacks full-width.
    The suite could not see it because the renderer's specs assert import *strings*, not layout —
    the same class of blind assertion as s1-spike.spec.ts in G-06-6 (edit.spec.ts:257
    expect(EDIT_TS).toContain('@formio/js'); view.spec.ts:287-288 the same shape).
  artifacts:
    - path: "apps/renderer/src/read/view.browser.ts"
      issue: "Imports only @formio/js/dist/formio.full.min.css (line 1) and never calls Formio.use; the read-only submission view renders Bootstrap-5-classed markup with no Bootstrap CSS behind it."
    - path: "apps/renderer/src/read/edit.ts"
      issue: "The same single import (line 312), after a dynamic import of @formio/js (line 309); the signer's edit form renders unstyled."
    - path: "apps/renderer/src/read/view.html"
      issue: "Not a defect, but the reason scoping is mandatory rather than optional: the page defines its own :root token set (lines 12-40, the mockup palette per AGENTS.md rule 1) and its own .card class (line 56). Bootstrap defines .card and .btn too, so a raw global import would collide with both."
    - path: "apps/renderer/src/read/edit.spec.ts"
      issue: "Asserts the import string (line 257) rather than computed layout — the assertion that passes while the form is unstyled."
    - path: "apps/renderer/src/read/view.spec.ts"
      issue: "Asserts import strings (lines 287-288) for the same reason."
    - path: "node_modules/bootstrap/dist/css/bootstrap.min.css"
      issue: "Present (bootstrap@5.3.8, 226.7 KB) and imported nowhere — the missing stylesheet on this surface too."
  resolution: >-
    One root cause, one mechanism, two surfaces: the renderer consumes the same scoped,
    byte-identical artifact the designer consumes (produced by plan 06-09's generator, drift
    guarded there). The renderer serves its signer pages from its own dev server (5174,
    `apps/renderer/vite.config.ts`); the read page statically imports the sheet beside the
    engine stylesheet and the edit page dynamically imports it on the live-link path only
    (replay and deny paths render no form); both pages carry `formio-scope` on their FormIO
    mount containers only — never on the page body or the surrounding card — so the page's
    own token block and its own `.card` class cannot be overridden. The renderer is
    browser-loadable for the first time, and the harness boots each app's dev server per
    project without breaking the existing suite.
  evidence: >-
    `npx playwright test --project=renderer --project=renderer-tablet` → 4 passed (read +
    edit × 1280px + 768px), exit 0 — this plan's own guard, run here: populated theme token,
    wrapping flex rows, 2/12 + 10/12 fractional columns, 1px/12px control geometry on both
    signer pages. The two scoped sheets remain byte-identical under the plan-06-09 drift
    guard (`tooling/formio-scope-css.spec.ts`, green in this plan's 129-test vitest scope).
    Recorded as UAT test 6 above — the signer-renderer coverage this gap records as missing.
  missing: []
  debug_session: ""

- gap_id: G-06-9
  truth: "The designer's interactive surface works as a whole: styled component-settings dialog, compact hover toolbar, a form-save path, an exit control on every visit, one-line toolbox labels, and horizontal dialog tabs"
  status: resolved
  resolved_by: "inline UAT fix (no gap-closure plan) — apps/app-builder/src/form-designer/FormioBuilderField.tsx, formio-overrides.css (new), FormDesignerPage.tsx, apps/app-builder/src/editor/AppTabs.tsx, EditorPage.tsx, apps/app-builder/src/chrome.css"
  resolved_at: 2026-10-16
  reason: >-
    Five user reports during the 2026-10-16 interactive test-2 walkthrough, each
    reproduced by computed-style probe against the live SPA before fixing:
    (1) "the dialog Text Field Component has broken style" — the component-settings
    dialog mounts at document.body, outside the .formio-scope root, so the scoped
    Bootstrap sheet never reached it; its form controls computed browser-default
    geometry (2px inset borders, 1px/2px padding).
    (2) "when I complete the design & back to the wizard, the form is not saved" —
    the designer had NO persistence path: handleSchemaChange updated local React
    state only; nothing ever called the API.
    (3) "In Component dialog, the tab display incorrectly, it shows vertical tab not
    horizontal" — dead, unscoped chrome sidebar CSS (.nav-item{width:100%}) matched
    the dialog's li.nav-item tab items, wrapping each tab to its own line.
    (4) "when hover on component, the floating buttons/toolbar broken" — the chrome's
    global .btn{min-height:40px} beats FormIO's height:18px (min-height always wins),
    stretching every hover-toolbar button to a 40px slab.
    (5) "Toolbox is a bit narrow so the components are wrapped" — FormIO's builder
    row places the toolbox in col-md-2 (16.7% ≈ 120px of the ~720px card), wrapping
    every two-word label.
  root_cause: >-
    One class of defect with five faces: chrome.css global (unscoped) rules and
    FormIO's body-mounted surfaces (the dialog; and the canvas, whose buttons carry
    chrome-matching class names) collide, plus one missing feature (the save leg
    the phase plans never scoped — BLD-04's persistence half).
  severity: major
  test: 2
  artifacts:
    - path: "apps/app-builder/src/form-designer/FormioBuilderField.tsx"
      issue: "Dialog mounted at body escaped the G-06-6 scope root; MutationObserver now tags each .formio-dialog with formio-scope as it appears."
    - path: "apps/app-builder/src/form-designer/FormDesignerPage.tsx"
      issue: "No save path: added saveForm (PATCH /apps/:id {section:'forms', patch:{form_schema}}), Save button, dirty tracking, save-on-leave for both exit controls, saved/dirty indicators."
    - path: "apps/app-builder/src/chrome.css"
      issue: "Dead mockup-era sidebar chrome (.nav-item/.sidebar/.topbar...) leaked into FormIO surfaces; removed (the shell renders a top header; nothing used them). .view gained margin-inline:auto for >1440px viewports."
    - path: "apps/app-builder/src/form-designer/formio-overrides.css"
      issue: "New: scope-root guards the generated sheet cannot carry (it is regenerated) — min-height/gap zeroing for FormIO .btn, btn-default styling, and the 200px toolbox fix (col-md-2 override, md+ only)."
    - path: "apps/app-builder/src/editor/AppTabs.tsx"
      issue: "Twelve-section tab bar scrolled by trackpad only (scrollbar hidden) — added prev/next chevrons with settled measurement (rAF + fonts.ready + ResizeObserver) and active-tab scrollIntoView."
    - path: "apps/app-builder/src/editor/EditorPage.tsx"
      issue: "No designer entry point outside the wizard — added 'Open the form designer' to the Forms tab."
  resolution: >-
    Every fix verified empirically before moving on: dialog controls compute
    Bootstrap geometry (1px/12px) and horizontal tabs; toolbar buttons compute
    18x18 at padding 2px; Save PUTs the frozen contract shape and the UI shows
    Saved — version N with the dirty pill cleared; exit control renders with or
    without a wizard snapshot and navigates correctly; toolbox computes 200px with
    zero wrapped labels across all 36 buttons; tab chevrons disabled-state correct
    at both ends. Regression suites green after each fix (designer+wizard+editor
    18/18 chromium; designer 5/5 after the toolbox change).
  missing: []
  debug_session: ""
