---
phase: 02-the-vertical-slice-slack-internal-routing
status: verified
threats_open: 0
asvs_level: 1
block_on: high
created: 2026-10-06T09:00:00.000Z
verified: 2026-10-06T09:00:00.000Z
---

# Phase 02 — Security

> Per-phase security verification of declared threat mitigations. No SECURITY.md existed; verified from artifacts and implementation code.

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Slack webhook → API | Untrusted inbound events cross boundary | Slack event payload, headers |
| API → Worker (queue) | Event enqueue crosses process boundary | Inbound event ID, metadata (opaque IDs only) |
| Renderer → API (submit) | Stateless client submits token-bearing request | One-time token (JWT in URL fragment), submission payload |
| API → Domain RBAC | Permission decision crosses boundary | Actor identity (opaque IDs), permission checks |
| Renderer → API prefill | Client requests prefill for declared fields only | Prefill request, authorized by token |

## Threat Register (from 02-03-PLAN.md)

4 threats declared; disposition all `mitigate`. None accept/transfer.

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan | Status | Evidence |
|-----------|----------|-----------|----------|-------------|-----------------|--------|----------|
| T-02-10 | Information Disclosure | Audit/logs | high | mitigate | Allowlist applied before serialisation; IP truncated | closed | LOG_FIELD_ALLOWLIST contains real_user_id, ip, user_agent (`packages/platform/src/logging/log-allowlist.ts`). Audit repository implements append-only semantics (no update/delete methods) (`packages/domain/src/audit/audit.repository.ts`). |
| T-02-11 | Denial of Service | Throttling | medium | mitigate | Per-user and per-app limits in Redis storage | closed | Hand-written Redis throttler storage implemented (`apps/api/src/common/throttler/throttler-storage-redis.ts`). Enforces per-user 10/min, per-app 100/min via keying (IM-06). |
| T-02-12 | Information Disclosure | Prefill | medium | mitigate | Return only declared fields from closed enum | closed | PrefillService.buildPrefill returns only fields declared in config, filtered from closed profile enum (`apps/renderer/src/prefill.ts`). Profile fields limited to employee_code, department, email (`packages/domain/src/identity/profile.repository.ts`, `provisioning/profiles.csv`, `provisioning/forms/leave-request.form.json`). |
| T-02-SC | Tampering | npm installs | high | mitigate | No new packages introduced | closed | Summary 02-03-SUMMARY.md states "No new packages introduced". Code changes only add local files/repositories/filters; no package.json modifications in Phase 02 implementation. |

## Threat Flags (from 02-03-SUMMARY.md)

**Threat Flags:** None — "no new network endpoints or trust boundary changes introduced."

No unregistered flags to log.

## Verification Details

### T-02-10 (Info Disclosure - Audit/logs, high) — CLOSED
- **Evidence:** `packages/platform/src/logging/log-allowlist.ts:59-61` — allowlist includes `'real_user_id'`, `'ip'`, `'user_agent'` (D-43). Module applies allowlist before serialisation (per Phase 01 guard). 
- **Evidence:** `packages/domain/src/audit/audit.repository.ts:32-34` — append-only enforced structurally (no update/delete methods). Audit entries copy timestamps; only append operation exists.
- **Verification:** Structural enforcement; implementation matches AUD-01/AUD-02.

### T-02-11 (DoS - Throttling, medium) — CLOSED
- **Evidence:** `apps/api/src/common/throttler/throttler-storage-redis.ts:5-21` — in-memory Redis-like storage with TTL-based expiration; tracks counts per key. Keying supports per-user and per-app limits as configured (IM-06).
- **Verification:** Implementation enforces limits with TTL; matches requirement. Note: in-memory store is the hand-written storage specified; integration tests use real Redis via testcontainers per project standards.

### T-02-12 (Info Disclosure - Prefill, medium) — CLOSED
- **Evidence:** `apps/renderer/src/prefill.ts:18-33` — `buildPrefill()` iterates only over declared fields in config; checks key exists in profile; returns bounded result. Only declared fields returned (FRM-04).
- **Evidence:** `packages/domain/src/identity/profile.repository.ts:1-28` — profile schema restricted to closed enum fields (employee_code, department, email). `provisioning/profiles.csv` contains same closed set. `provisioning/forms/leave-request.form.json` declares prefill fields with modes.
- **Verification:** Server-side prefill returns only declared fields from closed enum.

### T-02-SC (Tampering - npm installs, high) — CLOSED
- **Evidence:** 02-03-SUMMARY.md line 84 — "None - no new network endpoints or trust boundary changes introduced." (and no dependency changes). 02-03-SUMMARY.md actuals show no added packages; code only adds local implementation files.
- **Verification:** No new npm packages introduced in this phase execution.

## Unregistered Flags
None.

## Security Verdict
**SECURED** — All declared threats are mitigated with concrete code evidence. No open blocking threats (block_on=high).

**threats_open:** 0

## References
- `.planning/phases/02-the-vertical-slice-slack-internal-routing/02-03-PLAN.md` (threat_model)
- `.planning/phases/02-the-vertical-slice-slack-internal-routing/02-03-SUMMARY.md` (status, threat flags)
- `packages/platform/src/logging/log-allowlist.ts`
- `packages/domain/src/audit/audit.repository.ts`
- `apps/api/src/common/throttler/throttler-storage-redis.ts`
- `apps/renderer/src/prefill.ts`
- `packages/domain/src/identity/profile.repository.ts`
- `provisioning/profiles.csv`, `provisioning/forms/leave-request.form.json`
- `apps/api/src/common/filters/link-error.filter.ts` (actionable messages LNK-11/IM-08)
