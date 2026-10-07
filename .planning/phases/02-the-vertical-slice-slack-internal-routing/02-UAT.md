---
status: testing
phase: 02-the-vertical-slice-slack-internal-routing
source:
  - .planning/phases/02-the-vertical-slice-slack-internal-routing/02-01-SUMMARY.md
  - .planning/phases/02-the-vertical-slice-slack-internal-routing/02-02-SUMMARY.md
  - .planning/phases/02-the-vertical-slice-slack-internal-routing/02-03-SUMMARY.md
started: 2026-10-07T00:00:00Z
updated: 2026-10-07T00:00:00Z
---

## Current Test

number: 2
name: "Slack Slash Command End-to-End Flow"
expected: |
  In Slack, issue a slash command (e.g., /leave or configured command) that triggers the leave request. The system should process the command and respond appropriately - either providing a form link or an actionable response in the same Slack thread.
awaiting: user response

## Tests

### 1. Cold Start Smoke Test
expected: |
  Kill any running server/service. Clear ephemeral state (temp DBs, caches, lock files). Start the application from scratch. Server boots without errors, any seed/migration completes, and a primary query (health check, homepage load, or basic API call) returns live data.
result: pass

### 2. Slack Slash Command End-to-End Flow
expected: |
  In Slack, issue a slash command (e.g., /leave or configured command) that triggers the leave request. The system should process the command and respond appropriately - either providing a form link or an actionable response in the same Slack thread.
result: [pending]

### 3. Signed Link Generation and Validation
expected: |
  A signed, one-time link is issued for the form submission. The link should be valid when first accessed, expire appropriately, and reject reuse/expired attempts with actionable error messages.
result: [pending]

### 4. Renderer Form with Prefill
expected: |
  Accessing the signed link loads the renderer (apps/renderer). The leave request form renders correctly. If identity mapping resolves to a known user, closed profile fields (employee code, department, email) are prefilled with appropriate modes (prefill or prefill-editable as configured).
result: [pending]

### 5. Form Submission to Worker/Backend
expected: |
  Complete and submit the leave request form via the renderer. The submission is accepted, routed internally, and a confirmation/failure response appears in the same Slack thread as the original command.
result: [pending]

### 6. Identity Resolution and RBAC
expected: |
  The system correctly maps the Slack user to a real user identity, applies deactivation checks, and enforces RBAC permissions (including perm_version cache behavior) for the leave request action.
result: [pending]

### 7. Throttling Enforcement
expected: |
  Rapid successive slash commands or requests are rate-limited according to configured limits (per-user and per-app) and return clear, actionable rate-limited messages without crashing the system.
result: [pending]

### 8. Audit Trail Verification
expected: |
  After a successful submission, audit entries are created (append-only) containing required fields including real_user_id, ip, user_agent. The log allowlist does not leak unauthorized PII.
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
passed: 1
pending: 7
skipped: 0
blocked: 0

## Gaps

[none yet]
