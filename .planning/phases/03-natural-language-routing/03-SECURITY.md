---
phase: "3"
slug: "natural-language-routing"
status: verified
threats_open: 0
asvs_level: 1
created: "2026-10-07"
---

# Phase 3 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Slack → worker processor | Untrusted message text and event envelope enter here | Plain NL text, user/channel IDs, thread timestamps |
| Worker → JevProvider | Provider receives only what the RBAC filter allows | Authorized tool descriptors, canonical text, locale |
| Provider → orchestrator gate | Provider output is untrusted input to the routing decision | JEV response with choice, confidence, alternatives |
| Orchestrator → Phase 2 link issuer | Only verified, authorized, in-budget decisions may cross | Signed link token, app_id, real_user_id |
| Config → provider registry | Operator config decides which providers may run — hosted entries cross a trust gate here | Provider endpoints, attestation records |
| Orchestrator → hosted provider (future) | Only redacted, RBAC-filtered payloads; deadline-bounded | Redacted NL text, authorized tools |
| Orchestrator → Redis cache | Cached decisions are re-validated before use | Cache key with opaque IDs, canonical text hash |
| Worker → OTel exporter | Telemetry must not carry user text or identifiers | Allowlisted span attributes only |
| Slack thread reply → clarification state machine | Untrusted free text re-enters with session context attached | Reply text, displayed choice IDs |
| Fixture harness → provider registry | Conformance must cover every registered provider | Synthetic labelled intents |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-03-01 | Elevation of Privilege | routing-orchestrator / tool filtering | critical | mitigate | `tools` and `app_hints` filtered by fresh per-app RBAC before any provider sees them; chosen ID and every alternative re-checked against permitted set + `canOpenNow` before a link | closed |
| T-03-02 | Tampering | JevResponse gate | high | mitigate | Strict `JevResponseSchema.safeParse`, `spec_version`/`request_id` match, `verified === true` only (D-23 negative test), threshold + no-competing-alternative gate | closed |
| T-03-03 | Information Disclosure | provider payload / clarification copy | high | mitigate | Only authorized tool descriptors sent; worker-owned localized templates; never relay provider `clarification_prompt`; no global catalogue in payload or reply text | closed |
| T-03-04 | Denial of Service | deadline handling | medium | mitigate | Absolute `deadlineEpochMs` from `occurred_at`; past-deadline results clarify, never late-link | closed |
| T-03-05 | Tampering | intent edge cases | medium | mitigate | Negation guard; `force_clarification` and unsupported-locale abstention; EN/VI mixed conflicts clarify rather than pick a dominant language | closed |
| T-03-SC | Tampering | npm/pip/cargo installs | high | mitigate | No new packages this plan; lockfile + `npm ci` gate only | closed |
| T-03-06 | Denial of Service | provider chain deadline | high | mitigate | One absolute epoch deadline threaded through all hops; exhausted remaining budget yields clarify, never a hung worker or late link | closed |
| T-03-07 | Elevation of Privilege | decision cache | critical | mitigate | Cache key scoped by user/conversation/perm_epoch/publication-version; fresh RBAC re-filter on every hit; single-turn entries cannot serve multi-turn follow-ups | closed |
| T-03-08 | Information Disclosure | cache/log content | medium | mitigate | Never log question text or raw cache hash; opaque IDs only; pino allowlist unchanged | closed |
| T-03-09 | Tampering | hosted provider admission | high | mitigate | D-56/D-58 attestation gate at registry construction; unattested hosted providers excluded with loud boot log; config swap cannot waive regional approval | closed |
| T-03-10 | Denial of Service | provider health | medium | mitigate | 60s probe cadence; unhealthy providers skipped; rule-based terminal provider must be healthy or boot/operation fails loudly | closed |
| T-03-11 | Elevation of Privilege | clarification session | high | mitigate | Displayed choices and number picks re-checked against fresh RBAC + `canOpenNow`; revoked apps filtered on every reply; ≤2 rounds then fresh-request guidance | closed |
| T-03-12 | Information Disclosure | hosted egress redaction | critical | mitigate | Best-effort email/phone/employee-ID strip on current + prior turns; uncertainty skips hosted provider (deny-by-default); `context.real_user_id` stays opaque; no profile/form/submission data in the request | closed |
| T-03-13 | Information Disclosure | traces/logs | high | mitigate | Fixed stage span names; attributes only from frozen allowlist; sentinel-byte test proves no free text, employee ID, or submission ID reaches exported spans/logs | closed |
| T-03-14 | Tampering | provider drift | medium | mitigate | RTE-11 conformance suite runs against every registered provider on every change; schema/version/request_id gates; malformed-input degradation pinned | closed |
| T-03-15 | Denial of Service | clarification loop | low | mitigate | Hard cap of two replies; session TTL bound; Redis on cache deployment with eviction policy compatible with sessions-as-ephemeral | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

*No accepted risks.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-07 | 16 | 16 | 0 | orchestrator |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-07
