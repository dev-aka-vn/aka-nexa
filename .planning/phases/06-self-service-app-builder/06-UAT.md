---
status: partial
phase: 06-self-service-app-builder
source: [06-VERIFICATION.md]
started: 2026-10-13T08:48:15Z
updated: 2026-10-15T09:56:07Z
---

## Current Test

[testing complete]

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
result: blocked
blocked_by: server
reason: >-
  The environment blocker is narrower than it first appeared, and only the human judgement
  remains. The authenticated wizard surface does NOT need a backend to be looked at: the e2e
  specs stub the session and the app API with page.route, so the SPA boots signed in offline.
  66 final-state screenshots (every spec, both viewports) are at
  C:\Users\stl-l\AppData\Local\Temp\opencode\uat-shots\final\ — the two wizard ones that
  answer this test are wizard-create-wizard-BLD-0-8d736-* (the five-step rail and step 1
  blocking forward navigation) and wizard-create-wizard-BLD-0-4f249-* (steps 2-5 and the
  verbatim draft toast). A *live* walkthrough still needs the real stack, which needs two
  things nothing local substitutes for: `docker compose -f compose.dev.yml up -d` (mongo
  8.0 on 27017, redis 8.10 on 6379/6380) and an OIDC IdP — .env.development.example points
  OIDC_ISSUER at https://idp.example.com, no stub IdP server exists in the repo
  (apps/api/src/auth/oidc-issuer.stub.ts is an in-process test fixture, not a server) and
  there is no dev auth bypass, so `npm run start:api` cannot issue a session on its own.

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

### 4. Tablet touch pass (BLD-09): one manual pass on a real tablet at 768×1024
expected: The wizard, editor and designer are usable without a mouse
why_human: "Human judgement the emulated viewport only approximates; skeletons are code-verified, touch usability is not. (The BLD-09 truth is the phase's single PRESENT_BEHAVIOR_UNVERIFIED must-have — present and wired, behavior not exercised.)"
result: blocked
blocked_by: physical-device
reason: >-
  Two prerequisites, and neither can be satisfied from this machine. (1) Physical hardware —
  the truth is a manual pass on a real tablet at 768×1024 "without a mouse", and no emulation
  reproduces multi-touch or real scroll behaviour. The emulated tablet *project* does pass
  (33/33), but that is layout evidence only, not touch evidence. (2) An authenticated session
  for a live UI: the same OIDC blocker as test 2 — OIDC_ISSUER points at
  https://idp.example.com, no stub IdP server exists in the repo and there is no dev auth
  bypass, so `npm run start:api` cannot issue a session on its own; the compose.dev.yml data
  stack (mongo 8.0 / redis 8.10) is also required.
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

## Summary

total: 5
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 2

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
  status: failed
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
  missing: []
  debug_session: ""
