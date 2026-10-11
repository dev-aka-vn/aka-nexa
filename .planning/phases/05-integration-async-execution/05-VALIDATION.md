---
phase: "05"
slug: "integration-async-execution"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: false
wave_0_complete: true
created: "2026-10-09"
validated: "2026-10-11"
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `05-RESEARCH.md` `## Validation Architecture`. `nyquist_compliant` is set by
> `/gsd-validate-phase` after execution — this file only declares the sampled-verification plan.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.3 |
| **Config file** | `vitest.config.mts` (`include: packages/**/*.spec.ts`, `apps/**/*.spec.ts`, `tooling/**/*.spec.ts`; `setupFiles: ./test/setup-env.ts`; 30 s timeouts) |
| **Integration substrate** | Testcontainers via `tooling/containers.ts` `startThreeContainers()` — real MongoDB 8.0 replica set (`--replSet rs0`, `directConnection=true`) + Redis 8.10 (`cache` allkeys-lru / `queue` noeviction). Mocks are insufficient: `GETDEL` atomicity, BullMQ retry/DLQ, and multi-document transactions are Redis/Mongo-semantics-dependent. |
| **Quick run command** | `npx vitest run <touched-spec>` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30–90 s unit; Testcontainers integration adds ~60–120 s cold-start per suite |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched-spec>` (quick run)
- **After every plan wave:** Run `npx vitest run` (full suite, Testcontainers-backed integration included)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

> Populated by `/gsd-plan-phase` once PLAN.md task IDs exist. The phase-level requirement → test
> map below is the seeded contract each task row must cite.

### Phase requirement → test map (seeded from research)

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CON-10 / DAT-04 | Internal write + outbox row commit together; a rollback leaves neither | integration | `npx vitest run packages/domain/src/datarouter/outbox.integration.spec.ts -t "transaction atomicity"` | ✅ |
| DAT-06 | Outbound state committed as `sent_unconfirmed` **before** the transport call | integration | `npx vitest run apps/worker/src/processors/connector-delivery.integration.spec.ts -t "pre-call commit"` | ✅ |
| DAT-07 | Reconciliation retries only `not_sent`; `sent_unconfirmed` never auto-resent | integration | `npx vitest run apps/worker/src/processors/reconciliation.integration.spec.ts -t "not_sent only"` | ✅ |
| D-92 / DAT-13 | Same `{submission_id}:{revision}` re-delivered is idempotent (guard short-circuits) | unit | `npx vitest run apps/worker/src/processors/connector-delivery.spec.ts -t "per-revision idempotency"` | ✅ |
| CON-03 | Exponential backoff base 2 s, max 5 attempts, then terminal failed set (DLQ) | integration | `npx vitest run apps/worker/src/processors/connector-delivery.integration.spec.ts -t "backoff dlq"` | ✅ |
| CON-05 | Per-connector-instance limit shared across two apps; real Redis storage | integration | `npx vitest run packages/domain/src/connectors/rate-limit.integration.spec.ts -t "shared connector budget"` | ✅ (commit `CON-05`) |
| CON-07 | 401/403/412 → `credential_rejected`; 5xx/timeout/network → `endpoint_unreachable`; distinct alert attributes | unit + integration | `npx vitest run packages/domain/src/connectors/redmine-taxonomy.spec.ts` | ✅ |
| CON-09 / A2 | Redmine create maps fields correctly; create-time 404 → permanent; `cf_` pre-check | integration (needs live instance for A2) | `npx vitest run packages/domain/src/connectors/redmine.contract.spec.ts` | ✅ (A2 gated — manual row below) |
| CON-08 / D-86 | `connector_ref` rebind writes an AUD-01 before→after transition | integration | `npx vitest run packages/cli/rebind.integration.spec.ts -t "audited rebind"` | ✅ |
| CON-04 / D-84 | `dlq retry` re-enqueues via the same path; `sent_unconfirmed` requires `--force` + pre-check | integration | `npx vitest run packages/cli/dlq.integration.spec.ts -t "retry path"` | ✅ |
| OBS-04 / CON-06 | `submission_status{status="partial"}` and connector counter carry `app_id` | unit | `npx vitest run packages/platform/src/metrics/business-metrics.spec.ts -t "submission_status app_id"` | ❌ **no such test — G-10** |
| LNK-02 / D-93 / D-95 | Edit link consume-on-submit; replay returns original confirmation; expires at 4 h | integration | `npx vitest run apps/api/src/read/edit-link.integration.spec.ts -t "consume replay ttl"` | ✅ (commit `57d91430`) |
| DAT-14 / D-80 | Per-app "My submissions" list via frozen `query` action (no new claim) | integration | `npx vitest run apps/api/src/read/status-surface.integration.spec.ts -t "my submissions"` | ✅ |
| DAT-01/03/05 | Data-mode routing; `{{form.field}}`/`{{real_user.attribute}}` resolution; `partial` on external failure | unit | `npx vitest run packages/domain/src/datarouter/data-router.spec.ts` | ✅ |

**Execution evidence:** every row above was executed as part of the full suite
(`npx vitest run`, 2026-10-11: 884 passed / 1 failed / 0 skipped over 84 files), which is
green except `tooling/entrypoint-drift.spec.ts` (Phase-2 wiring — `05-GAPS.md` G-4). The
`-t` filters were each confirmed to match at least one test, so no row passes vacuously
for want of a name. **Row 11 is the one exception**: `-t "submission_status app_id"`
matches no test, because the assertion was never written and no call site emits either
counter (`05-GAPS.md` G-10). It is left ❌ rather than relabelled.

---

## Wave 0 Requirements

All Wave-0 artefacts now exist and were executed by the full suite; the boxes are
ticked on that basis, not on the plan's intent.

- [x] `tooling/` extension — connector/redmine test doubles + a Redmine stub server (`undici`/`msw` handler) so most of the map runs without a live Redmine.
- [x] `packages/domain/src/datarouter/outbox.integration.spec.ts` — CON-10/DAT-04 transaction atomicity.
- [x] `apps/worker/src/processors/connector-delivery.integration.spec.ts` — DAT-06 + CON-03.
- [x] `apps/worker/src/processors/reconciliation.integration.spec.ts` — DAT-07.
- [x] `packages/domain/src/connectors/redmine-taxonomy.spec.ts` — CON-07 split.
- [x] `packages/domain/src/connectors/redmine.contract.spec.ts` — CON-09/A2 (live-instance-gated for A2).
- [x] `packages/domain/src/connectors/rate-limit.integration.spec.ts` — CON-05.
- [x] `packages/cli/{dlq,rebind}.integration.spec.ts` — CON-04/CON-08.
- [x] `apps/api/src/read/{edit-link,status-surface}.integration.spec.ts` — LNK-02/DAT-14.
- [ ] Metrics spec extension — `packages/platform/src/metrics/business-metrics.spec.ts` for OBS-04/CON-06. **Still open — G-10.** The file exists and passes, but the `submission_status app_id` assertion the row cites was never written, and no call site emits either counter.
- [x] Framework install: **none** — Vitest + Testcontainers already present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Redmine create-time 404 semantics + `cf_<id>` filter behaviour (assumption A2) | CON-09 | No live Redmine instance in CI; governed absence unresolvable from docs | Run `redmine.contract.spec.ts` with `REDMINE_LIVE_URL`/`REDMINE_LIVE_KEY` set against a real instance; confirm CREATE-time 404 → permanent vs GET 404 → not-found; confirm create response is acceptable. If no instance is available, record A2 acceptance in the plan (documented assumption, not silent). |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references — **one exception:** the OBS-04/CON-06 metrics spec extension is still missing (G-10)
- [x] No watch-mode flags
- [x] Feedback latency < 120s (per-touched-spec quick runs; the containerised integration suites are the slow end at ~35–120 s cold start)
- [ ] `nyquist_compliant: true` set in frontmatter — **cannot be set:** row 11 has no test

**Approval:** PARTIAL (2026-10-11) — validated, `nyquist_compliant: false`. Every row
except OBS-04/CON-06 was executed and is green; that row is left ❌ and tracked as
`05-GAPS.md` G-10. Distinguishing this from `draft` matters: the map has been *run*, so
the ❌ is a known gap rather than an unstarted plan.
