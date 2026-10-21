---
status: complete
phase: 03-natural-language-routing
source:
  - .planning/phases/03-natural-language-routing/03-01-SUMMARY.md
  - .planning/phases/03-natural-language-routing/03-02-SUMMARY.md
  - .planning/phases/03-natural-language-routing/03-03-SUMMARY.md
started: "2026-10-07T21:10:00Z"
updated: 2026-10-07T15:08:08.055Z
---

## Current Test

[testing complete]

## Tests

### 1. Plain-language EN/VI routing reaches the same signed-link path as slash
expected: |
  A user sends a plain-language English or Vietnamese message that matches a published app intent.
  The system returns the same signed form link the slash command would return.
  No clarification is shown when the match is confident and unambiguous.
result: pass
source: automated

### 2. Slash commands bypass the JEV provider path
expected: |
  A user sends a slash command such as /leave request.
  The request follows the deterministic Phase 2 path and does not invoke any JEV provider.
result: pass
source: automated

### 3. Only authorized apps are exposed to the user
expected: |
  The routing payload contains only apps the requesting user is currently authorized for.
  A revoked or unauthorized app never appears in choices, alternatives, or provider payloads.
result: pass
source: automated

### 4. Offline rule-based routing works without hosted providers
expected: |
  With hosted providers unavailable, the local terminal RuleBasedProvider still answers.
  The user still receives a link or clarification with no network egress.
result: pass
source: automated

### 5. Hung/slow hosted providers do not block the 2-second budget
expected: |
  A hosted provider that stalls or exceeds its per-attempt budget degrades to the next provider.
  The local fallback still returns a decision inside the 2-second deadline.
result: pass
source: automated

### 6. Unhealthy providers are skipped and do not route
expected: |
  A provider whose last health probe failed or is stale is skipped.
  Routing continues to the next provider rather than returning an error or hanging.
result: pass
source: automated

### 7. Ambiguous or low-confidence input clarifies instead of linking
expected: |
  When no app crosses the confidence threshold or multiple authorized matches exist, the reply is clarification with up to 3 alternatives.
  No signed link is issued.
result: pass
source: automated

### 8. Clarification stays bound to the same thread and expires after at most 2 replies
expected: |
  Replies in the same Slack thread continue the clarification session.
  After 2 replies without resolution, the system escalates to examples/slash commands instead of looping forever.
result: pass
source: automated

### 9. Redacted or uncertain PII never reaches a hosted provider
expected: |
  If redaction is uncertain, the hosted provider is skipped and local routing continues.
  No free-text employee ID, email, or phone number is sent to a hosted provider.
result: pass
source: automated

### 10. Traces and logs do not carry user free text or submission IDs
expected: |
  Exported spans contain only allowlisted attributes.
  No user message text, employee ID, email, or submission ID appears in traces or logs.
result: pass
source: automated

### 11. 50-intent conformance suite passes for every registered provider
expected: |
  The conformance fixtures pass for the rule-based provider across EN/VI/mixed/ambiguous/negation/malformed cases.
  Per-app results are reported; an aggregate pass hides no individual app failure.
result: pass
source: automated

## Coverage auto-passed entries

### C1. Redis-backed clarification session with thread-bound resolution, max 2 replies, fresh RBAC on every reply
expected: |
  Clarification session Redis CRUD, thread-bound resolution via `jev:clarify:{real_user_id}:{channel_id}:{thread_ts}`, max 2 replies, and fresh RBAC re-filter on every reply are covered by unit and integration specs.
result: pass
source: automated
coverage_id: D1

### C2. Best-effort PII redaction with deny-by-default hosted-provider fail-safe
expected: |
  Email/phone/employee-ID redaction and deny-by-default hosted-provider skip are covered by unit and allowlist span exporter specs.
result: pass
source: automated
coverage_id: D2

### C3. 50-intent conformance suite with per-app Wilson intervals
expected: |
  Conformance fixtures covering EN/VI/mixed/ambiguous/negation/malformed cases with per-app Wilson intervals are covered by unit specs.
result: pass
source: automated
coverage_id: D3

## Summary

total: 11
passed: 11
issues: 0
pending: 0
skipped: 0

## Gaps

[none yet]
