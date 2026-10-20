---
phase: "8"
slug: "multi-im-expansion-two-way-sync"
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-10-19"
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.3 (`npm test` = `vitest run`) |
| **Config file** | `vitest.config.mts` (alias map; `include: packages/**/*.spec.ts`, `apps/**/*.spec.ts`, `tooling/**/*.spec.ts`; `exclude: **/e2e/**`; `setupFiles: ./test/setup-env.ts`; 120 s timeouts) |
| **Quick run command** | `npx vitest run <path-to-spec>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30–120 s per spec; full suite ~120–240 s |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <specs touched by the task>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** `npm test` must be green
- **Max feedback latency:** ~120 s

---

## Per-Requirement Coverage

| Req ID | Behavior | Test Type | Automated Command | File | Status |
|--------|----------|-----------|-------------------|------|--------|
| IM-10 | Teams urlVerification handshake echoes challenge, no writes/enqueue | integration | `npx vitest run apps/api/src/adapters/teams/teams.receiver.integration.spec.ts` | teams.receiver.integration.spec.ts | ✅ green |
| IM-10 | Teams missing/invalid Authorization → 401 | integration | same | teams.receiver.integration.spec.ts | ✅ green |
| IM-10 | Teams valid activity → 'enqueued' + one job | integration | same | teams.receiver.integration.spec.ts | ✅ green |
| IM-10 | Teams duplicate delivery → 'duplicate', no second job | integration | same | teams.receiver.integration.spec.ts | ✅ green |
| IM-10 | Teams fail-closed on storage timeout (ServiceUnavailableException) | integration | same | teams.receiver.integration.spec.ts | ✅ green |
| IM-10 | Teams outbound platform guard (non-teams throws) | unit | `npx vitest run apps/api/src/adapters/teams/teams.outbound.service.spec.ts` | teams.outbound.service.spec.ts | ✅ green |
| IM-10 | Teams outbound missing conv ref → throw naming opaque ids | unit | same | teams.outbound.service.spec.ts | ✅ green |
| IM-10 | Teams outbound real send invokes adapter continueConversation with stored ref + activity text | unit | same | teams.outbound.service.spec.ts | ✅ green |
| IM-10 | Teams outbound retryable vs non-retryable classification | unit | same | teams.outbound.service.spec.ts | ✅ green |
| IM-10 | Teams outbound sendFormLink delegates to sendMessage | unit | same | teams.outbound.service.spec.ts | ✅ green |
| IM-10 | Teams inbound event routes through shared kernel (platform 'teams') | unit | `npx vitest run apps/worker/src/processors/inbound-event.processor.teams.spec.ts` | inbound-event.processor.teams.spec.ts | ✅ green |
| NOT-01 | Per-connector HMAC-SHA256 over raw body (valid sig passes) | unit | `npx vitest run apps/api/src/webhooks/external/webhook-hmac.service.spec.ts` | webhook-hmac.service.spec.ts | ✅ green |
| NOT-01 | HMAC mutated body fails | unit | same | webhook-hmac.service.spec.ts | ✅ green |
| NOT-01 | HMAC wrong secret fails | unit | same | webhook-hmac.service.spec.ts | ✅ green |
| NOT-01 | HMAC missing signature fails | unit | same | webhook-hmac.service.spec.ts | ✅ green |
| NOT-01 | HMAC timing-safe (no early exit on length mismatch) | unit | same | webhook-hmac.service.spec.ts | ✅ green |
| NOT-02 | Replay rejection (skew + nonce) against real Redis | integration | `npx vitest run apps/api/src/webhooks/external/external-webhook.replay.integration.spec.ts` | external-webhook.replay.integration.spec.ts | ✅ green (6) |
| NOT-03 | Notification delivery to original submitter (assembler + deep link/status action) | unit | `npx vitest run packages/domain/src/notifications/notification-assembler.service.spec.ts` | notification-assembler.service.spec.ts | ✅ green (4) |
| NOT-03 | Notification delivery path: conv-ref send + deep link/status flows through | unit | `npx vitest run apps/api/src/adapters/teams/teams.outbound.service.spec.ts` | teams.outbound.service.spec.ts | ✅ green |
| NOT-04 | Three retries with backoff + jitter | unit | `npx vitest run apps/worker/src/processors/notification.processor.spec.ts` | notification.processor.spec.ts | ✅ green (3) |
| NOT-05 | Per-connector documented trust mechanism | unit | `npx vitest run apps/api/src/webhooks/external/connector-trust.integration.spec.ts` | connector-trust.integration.spec.ts | ✅ green (3) |

---

## Wave 0 Requirements

- [x] `apps/api/src/adapters/teams/teams.receiver.integration.spec.ts` — replaced placeholder with real tests
- [x] `apps/api/src/adapters/teams/teams.outbound.service.spec.ts` — replaced placeholder with real tests
- [x] `apps/worker/src/processors/inbound-event.processor.teams.spec.ts` — replaced placeholder with real test
- [x] `apps/api/src/webhooks/external/webhook-hmac.service.spec.ts` — new dedicated spec

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Zalo OA client stability | IM-10 (Zalo) | No official Node SDK; hand-rolled client | Two-day spike on a real OA account (S2) |
| SAML need confirmation | NOT-01/SSO | Customer-specific IdP inventory | Phase 1 discovery question |

*All other Phase 8 behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated (2026-10-19)

---

## Validation Audit 2026-10-19

| Metric | Count |
|--------|-------|
| Gaps found | 4 placeholders / missing specs |
| Resolved | 4 (receiver, outbound, inbound-teams, hmac) |
| Escalated | 0 |

All requirement → test mappings verified green. Build (`npm run build`) and lint exit 0.