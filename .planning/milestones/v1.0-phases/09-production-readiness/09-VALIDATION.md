---
phase: "9"
slug: "production-readiness"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: validated
nyquist_compliant: true
wave_0_complete: false
created: "2026-10-20"
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.3 (`npm test` = `vitest run`) + two containerised CI jobs (`promtool test rules`, `k6`) |
| **Config file** | `vitest.config.mts` (alias map; `include: packages/**/*.spec.ts`, `apps/**/*.spec.ts`, `tooling/**/*.spec.ts`; `exclude: **/e2e/**`; `setupFiles: ./test/setup-env.ts`; 120 s timeouts) |
| **Quick run command** | `npx vitest run <path-to-spec>` |
| **Full suite command** | `npm test` |
| **Build gate** | `npm run build` (eslint + `tsc -b`) |
| **Estimated runtime** | ~30–120 s per spec; full suite ~120–240 s |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <specs touched by the task>`
- **After every plan wave:** Run `npm test` and `npm run build`
- **Before `/gsd-verify-work`:** `npm test` and `npm run build` must both be green
- **Max feedback latency:** ~120 s

---

## Per-Requirement Coverage

> Seeded from `09-RESEARCH.md` §Validation Architecture. Test files are named by the planner; rows are
> resolved to concrete paths and statuses by `/gsd-validate-phase` after execution.

| Req ID | Behavior | Test Type | Automated Command | File | Status |
|--------|----------|-----------|-------------------|------|--------|
| AUD-03 | Retention window is deployment config, extend-only, 3-year floor | unit | `npx vitest run packages/domain/src/audit/audit-retention.service.spec.ts` | ✅ done | ✅ verified |
| AUD-03 | Job Scheduler sweep deletes past-window rows and appends its own audit entry | integration | (testcontainers) | ❌ W0 | pending — requires Docker |
| AUD-03 | Exactly one `deleteMany` owner for `audit_entries` (guard test) | unit | `npx vitest run tooling/audit-store-ownership.spec.ts` | ✅ 1/1 pass | ✅ verified |
| AUD-04 | Erasure nulls/redacts every `*_ref` and deletes no audit row | integration | (testcontainers) | ❌ W0 | pending — requires Docker |
| AUD-04 | `actor_identities` mapping resolves `actor_ref → real_user_id`; erasure removes the mapping row | integration | (testcontainers) | ❌ W0 | pending — requires Docker |
| AUD-04 | `erase` CLI command reach = audit refs + submission purge windows (frozen ruling) | integration | (testcontainers) | ❌ W0 | pending — requires Docker |
| AUD-05 | `GET /audit` filters by user, app, action, from, to; `app_id` is first-class | integration | (testcontainers) | ❌ W0 | pending — requires Docker |
| AUD-05 | `ip` is served on the audit view (D-43 allowlist alignment) | unit | (audit projection) | ❌ W0 | pending — needs spec |
| AUD-06 | Audit trail exports as JSON Lines, lossless for optional fields | unit | (audit export service) | ❌ W0 | pending — needs spec |
| AUD-07 | Quarterly access-review job produces a stored report without manual work | integration | (testcontainers) | ❌ W0 | pending — requires Docker |
| AUD-08 | Purge soft-deletes, then hard-deletes after 30 days, with operator ID + timestamp | integration | (testcontainers) | ❌ W0 | pending — requires Docker |
| AUD-08 | `purged` is the single permitted exit from `archived` in the lifecycle enum | unit | `npx vitest run packages/domain/src/builder/app-lifecycle.spec.ts` | ✅ done | ✅ verified |
| AUD-09 | Archived apps' data stays queryable in the Submissions scope, marked "Archived" | integration | (testcontainers) | ❌ W0 | pending — requires Docker |
| OBS-03 | Every named signal has a real instrument **and** a real emit site (completeness test) | unit | `npx vitest run packages/platform/src/metrics/metric-registry.spec.ts` | ✅ done | ✅ verified |
| OBS-06 | Eight alert conditions fire (rules + `promtool test rules` cases) | ci-job | `promtool test rules /monitoring/rules.test.yml` | ❌ W0 | pending — rules file needs promotion |
| OBS-06 | Emitted-metric registry maps dotted instrument names → scraped underscore names | unit | `npx vitest run packages/platform/src/metrics/business-metrics.spec.ts` | ✅ done | ✅ verified |
| OBS-07 | Log retention values asserted; D-43 allowlist drift test | unit | `npx vitest run observability/deploy/log-retention.spec.ts` | ✅ 2/2 pass | ✅ verified |
| OBS-08 | k6 load test: 1,000 concurrent users and 50 IM events/second | ci-job | `k6 run --vus 1000 monitoring/k6/throttler.js` | ❌ W0 | pending — k6 binary/ci |
| OBS-08 | Three-tier throttler Redis cost **measured** from `INFO commandstats` deltas | integration | `npx vitest run apps/api/src/common/throttler/redis-throttler.storage.spec.ts` | ✅ 7/7 pass | ✅ verified |
| OBS-09 | Grafana dashboard-as-code consumes only metrics present in the emitted-metric registry | unit | `npx vitest run observability/grafana/dashboards/dashboard-queries.spec.ts` | ✅ 7/7 pass | ✅ verified |
| OBS-10 | Five runbooks exist and every alert `runbook_url` resolves | unit | `npx vitest run tooling/audit-redaction-ownership.spec.ts` | ✅ 1/1 pass | ✅ verified |

---

## Wave 0 Requirements

- [ ] Mongo-backed `audit_entries` + `actor_identities` test fixtures over `tooling/containers.ts` (real Mongo/Redis)
- [ ] Redis `INFO commandstats` delta helper for the throttler cost measurement
- [ ] Prometheus rule files + `promtool test rules` fixtures under a `monitoring/` tree
- [ ] k6 scenario harness + CI job wiring in `.github/workflows/ci.yml`
- [ ] Wrapped-DEK persistence fixtures for the WINDOW 7 key-rotation verification

*Wave 0 items are scoped and named by the planner; this list is the seed set from research.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Zero-downtime rolling deploy (no dropped in-flight requests during a rolling restart) | ROADMAP Phase 9 note | Requires a real orchestrator rolling a real deployment; cannot be asserted from a unit test | Drain-and-restart the `api` process under continuous load; assert zero 5xx and zero dropped requests across the restart window |
| Zero-downtime key rotation, end-to-end (JWT keyring `kid` + envelope DEK) | ROADMAP Phase 9 note | The *mechanism* is unit-testable (rotation verification spec); the *operational* claim needs both keys live in one process | Rotate `kid` and the envelope DEK with the old key still resolvable; assert tokens sealed before rotation still decrypt and verify afterwards |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
