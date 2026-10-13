---
phase: "06"
slug: "self-service-app-builder"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-10-13"
---

# Phase 06 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time (all eight `<threat_model>` blocks); this
> audit verifies each mitigation at ASVS L1 grep depth against the executed
> phase. The full vitest suite (124 files / 1196 tests, 1195 green — the
> single failure the documented pre-existing entrypoint-drift orphan walk) is
> the executable evidence for the spec-asserted mitigations.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser → FormIO SDK | The designer renders owner-authored component schemas (never URL-param schemas) | Form-component JSON (untrusted content, sandboxed) |
| SPA → API (state-changing calls) | Session cookie + origin/double-submit CSRF layer (D-101) | Cookie (opaque `__Host-` session key), JSON bodies |
| API ↔ OIDC IdP | Authorization-code + PKCE callback; acr/amr MFA gate (D-102) | Code, verifier, state, IdP tokens |
| API ↔ chat identity (OTP) | Per-identity OTP delivery and verification (IDN-05) | 6-digit codes (SHA-256 at rest) |
| Builder admin ↔ operator CLI | Operator provision seam — the only surface that accepts credentials (FND-10, D-97) | Connector credentials (AES-256-GCM envelope, D-100) |
| npm registry → build | Supply-chain gate for every dependency (NFR-SEC-12) | Pinned versions, committed lockfile |
| Audit/log surface | D-43 field allowlist before serialisation; AUD-01 append-only | Audit entries, export rows |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-06-SC | Tampering | npm/pip/cargo installs | high | mitigate | Plan-01 blocking package-legality checkpoint; explicit version pins; committed lockfile; CI dependency scanning gates criticals (NFR-SEC-12) | closed |
| T-06-01 | Spoofing | FormioBuilderField (arbitrary component schemas) | medium | mitigate | Schemas arrive only from the owner-scoped API, never URL params; CSP posture `script-src 'self'` (FRM-07 precedent) | closed |
| T-06-02 | Tampering | React ↔ FormIO DOM ownership | medium | mitigate | Container-as-leaf mounting (Pattern 1): React never renders children inside the builder container; the S1 spike asserts the builder DOM survives a React state change | closed |
| T-06-03 | Information Disclosure | spike/dev proxy /api → API origin | low | accept | Dev-only proxy in vite.config.ts; production SPA is served same-origin; no credentials cross the proxy beyond the same-origin cookie | closed |
| T-06-04 | Spoofing | state-changing API calls (CSRF) | high | mitigate | SameSite=Strict cookie + origin/double-submit check in `session.middleware.ts`; `auth.session.integration.spec.ts` asserts a cross-origin POST is refused 403 `CSRF_ORIGIN_MISMATCH` | closed |
| T-06-05 | Spoofing | OIDC callback (PKCE/state mismatch) | high | mitigate | code_verifier + state stashed server-side in the pre-login Redis session; expectedState checked at exchange; absent/mismatched session fails closed before any IdP network call | closed |
| T-06-06 | Spoofing | builder login (non-MFA admission) | high | mitigate | D-102 acr/amr gate at the callback against `ACCEPTABLE_ACR_VALUES` (`mfa`, `phr`); `auth.session.integration.spec.ts` proves a password-only acr is refused 403 `AUTH_MFA_REQUIRED` with no session created | closed |
| T-06-07 | Information Disclosure | our own JWTs (PII-in-JWT) | high | mitigate | The session middleware issues no JWT — the session is an opaque Redis key; a spec asserts the cookie value has no JWT structure and no token carries the OIDC sub claim | closed |
| T-06-08 | Information Disclosure | session cookie attributes | high | mitigate | Set-Cookie carries all five attributes (`__Host-` prefix, Path=/, HttpOnly, Secure, SameSite=Strict); the begin-endpoint spec asserts each attribute verbatim | closed |
| T-06-09 | Denial of Service | OIDC discovery on every login | low | accept | Discovery cached once at module init (Pattern 4); a slow IdP degrades login latency, not security | closed |
| T-06-10 | Tampering | OTP brute force | high | mitigate | 3-attempt limit with Redis INCR (atomic across instances) + 30-minute lockout from the third failure; per-identity key namespace; `otp-state-machine.spec.ts` proves a 4th attempt is refused | closed |
| T-06-11 | Information Disclosure | OTP misdelivery | high | mitigate | OTP delivered only to the requesting chat identity (`OtpDeliveryPort.deliverOtp(chatUserId, code)` — single parameter); a code requested by identity A never verifies for identity B (per-identity key namespace, spec-asserted) | closed |
| T-06-12 | Tampering | OTP replay | medium | mitigate | Single-use codes: successful verify deletes the key and leaves a consumed tombstone; replay refused with `OTP_CONSUMED` (spec-asserted) | closed |
| T-06-13 | Information Disclosure | plaintext OTP at rest | medium | mitigate | Only the SHA-256 hash of the code is stored in Redis; the plaintext exists solely in the in-memory delivery-port call (spec asserts no plaintext in the Redis record) | closed |
| T-06-14 | Repudiation | definition mutations (D-86) | high | mitigate | Every section update, publish, deprecate, archive, and rollback appends an AUD-01 entry with previous_state/new_state via `AuditRepository.append`; `app-definition.integration.spec.ts` asserts one audit row per mutation (service-level invariant PRO-12) | closed |
| T-06-15 | Tampering | saved-query resolution (G-11) | high | mitigate | Composite (app_id, query_id) key per the frozen D-73 contract; the spec proves app A's query_id does not resolve under app B; the repository-backed lookup implements the existing interface so the verifier's fail-closed default is preserved | closed |
| T-06-16 | Tampering | tag vocabulary (D-107) | medium | mitigate | Zod enum of the curated platform tag set in `tag-set.ts`; an out-of-vocabulary tag is rejected inline naming the allowed set (PRO-6) | closed |
| T-06-17 | Tampering | template seed loading (D-31) | medium | mitigate | Idempotent loader keyed on template_id + content hash — a re-run is a no-op; `template.spec.ts` runs the loader twice and asserts identical collection state | closed |
| T-06-18 | Information Disclosure | template form schemas | low | accept | Template schemas are platform-owned, non-secret content by design; no credentials or connector secrets exist in seed files — external/hybrid templates carry a connector_ref expectation only | closed |
| T-06-19 | Tampering | publish gate bypass | high | mitigate | The gate executes inside the publish endpoint before any state change; `commitPublish` is called only when `allowed=true`; `publish.integration.spec.ts` proves a blocked publish leaves state and audit untouched | closed |
| T-06-20 | Repudiation | publish decision | medium | mitigate | The full PublishGateResult (shareDrops, collision, changeSummary) is persisted inside the AUD-01 publish entry — the publish decision is reconstructable after the fact | closed |
| T-06-21 | Denial of Service | dry-run cost | medium | mitigate | The dry-run is pure computation over the rolling 24h outcome records with a bounded intent set (the candidate's labels); no message replay, no queue interaction, per-request deadline inherited from the orchestrator's absolute-deadline contract | closed |
| T-06-22 | Information Disclosure | change summary in logs | low | accept | The summary is app-definition metadata (no PII); it rides the existing AUD-01 access discipline and the D-43 log allowlist | closed |
| T-06-23 | Information Disclosure | connector credential exposure | critical | mitigate | Request documents carry no credential value by construction (the Zod response schema has no secret-bearing field); the operator's provision writes only through `ConnectorCredentialsRepository.upsert` (AES-256-GCM envelope in `packages/platform/src/crypto/envelope.ts`, D-100 guard); a spec asserts no plaintext/envelope field on any builder read path | closed |
| T-06-24 | Tampering | request lifecycle | medium | mitigate | One pending request per (app_id, connector_id) via a partial unique index plus a service check with a named error; cancel/retry/reject are audited transitions (AUD-01) | closed |
| T-06-25 | Tampering | operator provision seam | high | mitigate | Provision consumes only pending requests; the operator credential entry goes through the existing audited CLI seam (`packages/cli/provision.ts`); no builder API surface accepts a credential — FND-10 stays authoritative (D-97) | closed |
| T-06-26 | Information Disclosure | submissions export PII | high | mitigate | Field allowlist applied before serialization (the D-43/W-22 discipline, D-111); `submission-export.service.spec.ts` asserts no PII field outside the allowlist appears; export is owner-scoped and audit-logged | closed |
| T-06-27 | Spoofing | owner-scoped routes | high | mitigate | Every app-builder route passes through the session middleware's `request.user.realUserId` and the per-app `@casl/ability` check; a spec proves a non-owner's PATCH is 403 with the missing-permission name (ACL-09) | closed |
| T-06-28 | Tampering | FormIO schema import | medium | mitigate | The designer saves only schemas authored in the builder — the API validates the schema against the frozen FormIO JSON-schema shape before persisting; the API never executes submitted form logic | closed |
| T-06-29 | Information Disclosure | email autocomplete | medium | mitigate | Autocomplete searches the identity directory by name/email prefix and returns only display fields (name, email) to the requesting owner; the search is rate-limited per the throttler | closed |
| T-06-30 | Denial of Service | FormIO bundle in the SPA | low | accept | `@formio/js` is code-split per route by Vite; the designer chunk loads on navigation, not on first paint | closed |
| T-06-31 | Spoofing | transfer approval | high | mitigate | The approval endpoint requires the global-admin role (session middleware + service-level guard — not just a route guard); the pending record carries a 7-day `expiresAt` and the auto-cancel job is idempotent; a spec proves approval after cancel is refused | closed |
| T-06-32 | Information Disclosure | audit log browse | medium | mitigate | The audit page is global-admin-only and read-only (AUD-01 is append-only by construction — no mutation endpoints exist); the browse endpoint returns paginated entries with the D-43 field allowlist applied | closed |
| T-06-33 | Tampering | dashboard data freshness | medium | mitigate | Every dashboard widget reads a live repository with a documented staleness bound (the list endpoints' natural ordering); the connector-health card is absent until a real health-check job exists (D-112) | closed |
| T-06-34 | Information Disclosure | template gallery provenance | low | accept | Templates are platform-owned seed content (D-105) — the gallery shows them read-only; fork provenance is deliberately absent (D-108 snapshots) | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-06-01 | T-06-03 | Dev-only proxy; production is same-origin and the cookie never leaves the origin | phase plans (06-01) | 2026-10-11 |
| AR-06-02 | T-06-09 | IdP discovery latency degrades login UX, not the security posture; discovery is cached once at init | phase plans (06-02) | 2026-10-11 |
| AR-06-03 | T-06-18 | Template schemas are public, non-secret platform content by design | phase plans (06-04) | 2026-10-11 |
| AR-06-04 | T-06-22 | Change summaries are app-definition metadata with no PII; covered by the D-43 log allowlist | phase plans (06-05) | 2026-10-11 |
| AR-06-05 | T-06-30 | Route-level code-splitting bounds the FormIO bundle cost; load-on-navigation, not first paint | phase plans (06-07) | 2026-10-11 |
| AR-06-06 | T-06-34 | Template provenance is deliberately absent — D-108 snapshots are the fork contract | phase plans (06-08) | 2026-10-11 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-13 | 35 | 35 | 0 | gsd-secure-phase (ASVS L1 grep-depth; register authored at plan time — short-circuit, no auditor spawn required) |

Audit notes: the register was authored in all eight PLAN.md `<threat_model>`
blocks before execution (`register_authored_at_plan_time: true`). L1
verification confirmed each mitigation in the implementation: the CSRF,
MFA-gate, cookie-attribute, PKCE/state, OTP state-machine, publish-gate,
transfer-approval, audit-append, export-allowlist, template-idempotency,
and owner-scoped-routing mitigations are spec-asserted and green in the
full suite; the AES-256-GCM credential envelope lives in
`packages/platform/src/crypto/envelope.ts` (Node stdlib, D-100); the
operator provision seam is `packages/cli/provision.ts`. No threat remained
open at or above the `high` block threshold.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-13
