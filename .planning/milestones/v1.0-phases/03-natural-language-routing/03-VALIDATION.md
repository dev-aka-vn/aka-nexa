---
phase: "3"
slug: "natural-language-routing"
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-10-07"
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.3 |
| **Config file** | `vitest.config.mts` |
| **Quick run command** | `npm test -- packages/domain/src/decision` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- packages/domain/src/decision`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01 | 01 | 1 | RTE-01 | T-03-01 | EN/VI NL intent reaches same authorized link path as slash | integration | `npm test -- packages/domain/src/decision/decision-routing.integration.spec.ts` | ✅ W0 | ✅ green |
| 03-01 | 01 | 1 | RTE-03 | T-03-01 | Provider receives only user's currently authorized apps | unit/spy | `npm test -- packages/domain/src/decision/decision-routing.integration.spec.ts` | ✅ W0 | ✅ green |
| 03-01 | 01 | 1 | RTE-04 | T-03-01 | Rule-based default works and provider can swap from config | unit | `npm test -- packages/domain/src/decision/decision-routing.integration.spec.ts` | ✅ W0 | ✅ green |
| 03-01 | 01 | 1 | RTE-05 | T-03-07 | Local provider answers without network egress | unit | `npm test -- packages/domain/src/decision/rule-based.provider.spec.ts` | ✅ W0 | ✅ green |
| 03-01 | 01 | 1 | RTE-06 | T-03-10 | Dead hosted providers do not consume the 2s budget; local fallback returns | unit/integration | `npm test -- packages/domain/src/decision/routing-orchestrator.spec.ts` | ✅ W0 | ✅ green |
| 03-01 | 01 | 1 | RTE-07 | T-03-10 | Unhealthy providers skipped and re-probed every 60s | unit/timers | `npm test -- packages/domain/src/decision/provider-health.spec.ts` | ✅ W0 | ✅ green |
| 03-01 | 01 | 1 | RTE-08 | T-03-02 | Below-threshold choice produces clarification, not a link | unit | `npm test -- packages/domain/src/decision/decision-routing.integration.spec.ts` | ✅ W0 | ✅ green |
| 03-01 | 01 | 1 | RTE-09 | T-03-03 | Cache key includes text + sorted tool ids + locale, no cross-context reuse | integration | `npm test -- packages/domain/src/decision/decision-cache.integration.spec.ts` | ✅ W0 | ✅ green |
| 03-01 | 01 | 1 | RTE-11 | T-03-11 | Every provider passes 50-label conformance; fails closed on malformed input | conformance | `npm test -- packages/domain/src/decision/decision.conformance.spec.ts` | ✅ W0 | ✅ green |
| 03-01 | 01 | 1 | RTE-02 | T-03-11 | Slash command bypasses JEV provider path | unit | `npm test -- apps/worker/src/processors/inbound-event.processor.spec.ts` | ✅ W0 | ✅ green |
| 03-01 | 01 | 1 | OBS-02 | T-03-04 | Stage spans continue from IM receive through worker decision and respond | integration | `npm test -- apps/worker/src/processors/*.spec.ts` | ✅ W0 | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/domain/src/decision/decision.conformance.spec.ts` — RTE-11
- [x] `packages/domain/src/decision/decision-routing.integration.spec.ts` — RTE-01/03/04/08
- [x] `packages/domain/src/decision/decision-cache.integration.spec.ts` — RTE-09
- [x] `packages/domain/src/decision/routing-orchestrator.spec.ts` — RTE-06
- [x] `packages/domain/src/decision/provider-health.spec.ts` — RTE-07
- [x] `packages/domain/src/decision/rule-based.provider.spec.ts` — RTE-05
- [x] `apps/worker/src/processors/inbound-event.processor.spec.ts` — RTE-02
- [x] Synthetic labelled fixtures under `packages/domain/src/decision/fixtures/`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Slack end-user phrasing including mixed EN/VI and ambiguous previews | RTE-01/RTE-08 | Requires real Slack command/message surface | Run Slack leave intent in dev workspace and inspect returned link/clarification |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-10-07. All Wave 0 test scaffolds exist and the full
`npm test -- packages/domain/src/decision apps/worker/src/processors/inbound-event.processor.spec.ts packages/contract/src/jev/jev-v1.frozen.spec.ts`
suite is green (158 passed). Per-task statuses above reflect executed results.

## Validation Audit 2026-10-07

| Metric | Count |
|---|---|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
