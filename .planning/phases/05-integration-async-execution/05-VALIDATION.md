---
phase: "05"
slug: "integration-async-execution"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-09"
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
| CON-10 / DAT-04 | Internal write + outbox row commit together; a rollback leaves neither | integration | `npx vitest run packages/domain/src/datarouter/outbox.integration.spec.ts -t "transaction atomicity"` | ❌ Wave 0 |
| DAT-06 | Outbound state committed as `sent_unconfirmed` **before** the transport call | integration | `npx vitest run apps/worker/src/processors/connector-delivery.integration.spec.ts -t "pre-call commit"` | ❌ Wave 0 |
| DAT-07 | Reconciliation retries only `not_sent`; `sent_unconfirmed` never auto-resent | integration | `npx vitest run apps/worker/src/processors/reconciliation.integration.spec.ts -t "not_sent only"` | ❌ Wave 0 |
| D-92 / DAT-13 | Same `{submission_id}:{revision}` re-delivered is idempotent (guard short-circuits) | unit | `npx vitest run apps/worker/src/processors/connector-delivery.spec.ts -t "per-revision idempotency"` | ❌ Wave 0 |
| CON-03 | Exponential backoff base 2 s, max 5 attempts, then terminal failed set (DLQ) | integration | `npx vitest run apps/worker/src/processors/connector-delivery.integration.spec.ts -t "backoff dlq"` | ❌ Wave 0 |
| CON-05 | Per-connector-instance limit shared across two apps; real Redis storage | integration | `npx vitest run packages/domain/src/connectors/rate-limit.integration.spec.ts -t "shared connector budget"` | ❌ Wave 0 |
| CON-07 | 401/403/412 → `credential_rejected`; 5xx/timeout/network → `endpoint_unreachable`; distinct alert attributes | unit + integration | `npx vitest run packages/domain/src/connectors/redmine-taxonomy.spec.ts` | ❌ Wave 0 |
| CON-09 / A2 | Redmine create maps fields correctly; create-time 404 → permanent; `cf_` pre-check | integration (needs live instance for A2) | `npx vitest run packages/domain/src/connectors/redmine.contract.spec.ts` | ❌ Wave 0 (A2 gated) |
| CON-08 / D-86 | `connector_ref` rebind writes an AUD-01 before→after transition | integration | `npx vitest run packages/cli/rebind.integration.spec.ts -t "audited rebind"` | ❌ Wave 0 |
| CON-04 / D-84 | `dlq retry` re-enqueues via the same path; `sent_unconfirmed` requires `--force` + pre-check | integration | `npx vitest run packages/cli/dlq.integration.spec.ts -t "retry path"` | ❌ Wave 0 |
| OBS-04 / CON-06 | `submission_status{status="partial"}` and connector counter carry `app_id` | unit | `npx vitest run packages/platform/src/metrics/business-metrics.spec.ts -t "submission_status app_id"` | ⚠ extend existing |
| LNK-02 / D-93 / D-95 | Edit link consume-on-submit; replay returns original confirmation; expires at 4 h | integration | `npx vitest run apps/api/src/read/edit-link.integration.spec.ts -t "consume replay ttl"` | ❌ Wave 0 |
| DAT-14 / D-80 | Per-app "My submissions" list via frozen `query` action (no new claim) | integration | `npx vitest run apps/api/src/read/status-surface.integration.spec.ts -t "my submissions"` | ❌ Wave 0 |
| DAT-01/03/05 | Data-mode routing; `{{form.field}}`/`{{real_user.attribute}}` resolution; `partial` on external failure | unit | `npx vitest run packages/domain/src/datarouter/data-router.spec.ts` | ❌ Wave 0 |

---

## Wave 0 Requirements

- [ ] `tooling/` extension — connector/redmine test doubles + a Redmine stub server (`undici`/`msw` handler) so most of the map runs without a live Redmine.
- [ ] `packages/domain/src/datarouter/outbox.integration.spec.ts` — CON-10/DAT-04 transaction atomicity.
- [ ] `apps/worker/src/processors/connector-delivery.integration.spec.ts` — DAT-06 + CON-03.
- [ ] `apps/worker/src/processors/reconciliation.integration.spec.ts` — DAT-07.
- [ ] `packages/domain/src/connectors/redmine-taxonomy.spec.ts` — CON-07 split.
- [ ] `packages/domain/src/connectors/redmine.contract.spec.ts` — CON-09/A2 (live-instance-gated for A2).
- [ ] `packages/domain/src/connectors/rate-limit.integration.spec.ts` — CON-05.
- [ ] `packages/cli/{dlq,rebind}.integration.spec.ts` — CON-04/CON-08.
- [ ] `apps/api/src/read/{edit-link,status-surface}.integration.spec.ts` — LNK-02/DAT-14.
- [ ] Metrics spec extension — `packages/platform/src/metrics/business-metrics.spec.ts` for OBS-04/CON-06.
- [ ] Framework install: **none** — Vitest + Testcontainers already present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Redmine create-time 404 semantics + `cf_<id>` filter behaviour (assumption A2) | CON-09 | No live Redmine instance in CI; governed absence unresolvable from docs | Run `redmine.contract.spec.ts` with `REDMINE_LIVE_URL`/`REDMINE_LIVE_KEY` set against a real instance; confirm CREATE-time 404 → permanent vs GET 404 → not-found; confirm create response is acceptable. If no instance is available, record A2 acceptance in the plan (documented assumption, not silent). |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
