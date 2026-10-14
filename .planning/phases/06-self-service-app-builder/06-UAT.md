---
status: partial
phase: 06-self-service-app-builder
source: [06-VERIFICATION.md]
started: 2026-10-13T08:48:15Z
updated: 2026-10-14T15:10:00Z
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
why_human: "'Without documentation' is a human judgement (06-VALIDATION.md manual-only row). The wizard implementation matches the mockup's step rail and copy, and the e2e wizard.spec.ts encodes the flow, but the e2e suite could not execute in this environment (Chromium OS deps unavailable)."
result: blocked
blocked_by: server
reason: "Need guidance to start backend & frontend services"

### 3. Execute the Playwright e2e suite (npx playwright test) on a machine with browser OS deps installed
expected: The chromium and tablet projects pass across wizard.spec.ts, designer.spec.ts, roles.spec.ts, editor.spec.ts, dashboard.spec.ts, submissions.spec.ts, connectors.spec.ts, s1-spike.spec.ts
why_human: >-
  Environmental: the authoring sandbox cannot launch Chromium (libatk-1.0.so.0 missing,
  no root). The specs are present, configured (desktop chromium + tablet projects,
  vite webServer, page.route API stubs), and the vitest suite behind them is green —
  but the e2e execution itself is unverified.
result: issue
reported: "Ran Playwright e2e on chromium project: 32 passed, 1 failed. Failure in apps/app-builder/e2e/designer.spec.ts: the designer mounts the builder; an added component captures one history entry and undo/redo round-trip - .formio-builder-form not visible (timeout 20000ms)."
severity: major

### 4. Tablet touch pass (BLD-09): one manual pass on a real tablet at 768×1024
expected: The wizard, editor and designer are usable without a mouse
why_human: "Human judgement the emulated viewport only approximates; skeletons are code-verified, touch usability is not. (The BLD-09 truth is the phase's single PRESENT_BEHAVIOR_UNVERIFIED must-have — present and wired, behavior not exercised.)"
result: blocked
blocked_by: server
reason: "Cannot access authenticated UI due to API/OIDC issues"

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
result: blocked
blocked_by: server
reason: "Cannot access authenticated UI due to API/OIDC issues"

## Summary

total: 5
passed: 1
issues: 1
pending: 0
skipped: 0
blocked: 3

## Gaps

- gap_id: G-06-3
  truth: "The chromium and tablet projects pass across wizard.spec.ts, designer.spec.ts, roles.spec.ts, editor.spec.ts, dashboard.spec.ts, submissions.spec.ts, connectors.spec.ts, s1-spike.spec.ts"
  status: failed
  reason: "User reported: Ran Playwright e2e on chromium project: 32 passed, 1 failed. Failure in apps/app-builder/e2e/designer.spec.ts: the designer mounts the builder; an added component captures one history entry and undo/redo round-trip - .formio-builder-form not visible (timeout 20000ms)."
  severity: major
  test: 3
  artifacts: []
  missing: []
  debug_session: ""
