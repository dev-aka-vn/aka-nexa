# Phase 6: Self-Service App Builder - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-11
**Phase:** 6-Self-Service App Builder
**Areas discussed:** Connector request vs FND-10 (BLD-10), Builder auth (BLD-12), Template gallery (APP-09), Mockup surfaces scope

---

## Connector request & the FND-10 gate (BLD-10)

| Option | Description | Selected |
|--------|-------------|----------|
| Request → platform provisions secret | Admin self-serves the connector instance minus the secret; a platform operator provisions the credential through the audited seam; the admin flow resumes when provisioned. | ✅ |
| Full self-service credential entry | Admin pastes credential material in the builder — violates FND-10/W-24 (D-87) without an override ruling. | |
| Request → external ticket only | "Request" files an intention in the platform's ticketing system; the app sits pending until handled out-of-band. | |
| Statused request queue | A `connector_requests` collection with `pending → provisioned | rejected` (+ reason); status badge; cancel/retry while pending; every transition an AUD-01 event. | ✅ |
| Request lives on the app definition | No separate collection; `connector_ref: pending:req_<id>` until provisioned. | |
| Queue + approval + auto-cancel | Mirrors ACL-05's approval loop: global-admin approval + auto-cancel window. Heavier; pairs two approval loops. | |
| Request = full config minus secret | The request carries type, base_url, auth mode, operations, idempotency expectation; provisioning adds only the credential + test validation. | ✅ |
| Lightweight ask, operator builds | The operator builds the connector-shaped config during provisioning. Less pre-work, operator authors. | |
| Post-provision config by admin | The admin configures the instance in the builder once provisioned; the request carries only type + environment. | |
| Mirror D-87 — local/test only | Builder can store/test local/test credentials in non-production; a production boot still refuses non-KMS credentials. | ✅ |
| Relax the gate for the builder | Drop the FND-10/W-24 refusal from the builder path — an explicit override, weakens posture. | |
| No credentials in the builder | Builder never touches credential material; test connections via a platform sandbox service. Heavy. | |

## Builder auth — OIDC session & MFA (BLD-12)

| Option | Description | Selected |
|--------|-------------|----------|
| Redis session + httpOnly cookie | OIDC auth code + PKCE completes at an API endpoint; session in Redis (AD-9); `__Host-` httpOnly SameSite=Strict cookie; SPA never holds a token; CSRF structurally blocked. | ✅ |
| Bearer token in the SPA | SPA holds the OIDC token in memory with silent refresh. Simpler; XSS exfiltrates a live session token. | |
| BFF proxy to the IdP | API proxies to the IdP at the edge. Same cookie result; adds a proxy layer. | |
| Verify IdP ACR at login | Builder checks `acr`/`amr` claims on every login and refuses non-MFA-strong logins; no homegrown MFA prompt. | ✅ |
| ACR at login + step-up for publish/transfer | Same ACR check plus a re-auth gate before destructive actions. Stronger; SPA must carry a re-auth flow. | |
| Trust the IdP, no claim check | No claim check — MFA becomes honour-system if an org misconfigures policy. | |
| Tie to the IdP session | Builder session lives as long as the org's IdP session; silent re-establish while alive, full login when not. One expiry policy — the org's. | ✅ |
| Fixed 8h + 30m idle | Deterministic policy independent of the IdP; simpler to reason about and test; ignores org policy. | |
| Stricter than the IdP | Shorter builder session regardless of IdP; treats the console as higher-risk. Adds authoring friction. | |
| Auto-provision on first login | First SSO login creates the `real_user` keyed to the OIDC subject; acts on day one. IDN-05's OTP path stays employee-only (chat-side). | ✅ |
| Admin pre-maps SSO identities | Global admin pre-maps (IDN-08) before admittance. Strictest; a first-day approval dependency. | |
| Auto-provision + first-publish approval | Instantly provisional; publishing gated until a global admin approves. | |

## Template gallery (APP-09)

| Option | Description | Selected |
|--------|-------------|----------|
| D-31 seed files, forked to drafts | ~10 template apps ship as D-31 seeds (idempotent, audited, platform-owned); "Use template" forks a snapshot into a user-owned draft. | ✅ |
| Frontend-bundled catalogue | Templates as JSON in the builder bundle; no DB seed, invisible to registry, un-audited. | |
| Seed files + derived reference | Derived app references its origin template; provenance kept, adds reference-integrity rules. | |
| Core domains, 1–2 external examples | Absence/leave, travel, procurement, asset, HR, ticketing — mostly internal-only plus 1–2 external/hybrid examples demonstrating the connector-request flow. | ✅ |
| All internal-only | Ten internal-only templates; zero connector dependency; nothing demonstrates the external path. | |
| Content left to planning | No user preference; planner chooses domains/mix. | |
| Curated platform tag set | A curated use-case + department tag set shared by templates and user apps; filterable; users pick, not type. | ✅ |
| Free-form user tags | Any string; maximum flexibility, catalogue fragments. | |
| Curated + free-form hybrid | Curated for templates, free-form for user apps; two universes in one filter UI. | |
| Forks are snapshots | Fork copies the seed content; no origin link; template updates never touch existing forks. | ✅ |
| Template-aware diff updates | Forks record origin + version; builder surfaces "apply changes?" with a diff. Adds a merge pipeline. | |
| Auto-adopt on publish | Forks adopt new template versions on publish unless opted out. Silent drift into user apps. | |

## Mockup surfaces scope

| Option | Description | Selected |
|--------|-------------|----------|
| Core + read-only Audit/Dashboard | Ship Apps (full), Submissions (viewer + export), Connectors (view + request), Users (mapping + approvals), light Dashboard and read-only Audit Log (AUD-01). Settings deferred as a stub route. | ✅ |
| Strictly requirement-minimal | Only Apps, Submissions, Users, Connectors. Dashboard/Audit/Settings deferred entirely. | |
| Full mockup parity | All seven mockup pages functional including Settings wiring (JEV chain, cache, circuit breaker) — not in the requirement set. | |
| In the builder's Users page | IDN-08 SSO mapping and the ACL-05 transfer-approval queue live in the Users page; the operator CLI keeps its Phase-5 read/DLQ roles. | ✅ |
| Stay operator-CLI | Identity admin stays in the Phase-5 CLI; the builder only shows read-only state. | |
| Both surfaces | CLI and builder UI both offer the same audited actions; double surface to keep consistent. | |
| Export = visible columns | CSV covers exactly the viewer's columns (status, app/form, timestamps, downstream ref, safe reason); PII under the D-43/W-22 allowlist discipline. | ✅ |
| Full raw submission JSON | Every submitted field exported raw. Against the allowlist-before-serialisation discipline. | |
| Field picker at export | Admin picks fields per export. Most control; adds a picker UI + per-export validation. | |
| Back by existing data only | Dashboard cards show only live sources: recent submissions + audit activity. Connector-health card held back until a health-check job exists. | ✅ |
| Add health check for the card | Adds the Phase-5-discretionary health-check cadence so the card is real. | |
| Defer Dashboard entirely | No Dashboard page this phase; nav lands on Apps. | |

---

**Deferred ideas:** Settings platform knobs (JEV chain, cache, circuit breaker); connector-health dashboard card; full mockup parity (rejected); full self-service credential entry (rejected).

**Agent's discretion:** BLD-04 undo/redo mechanism (S1 spike + planner); connector-request form field details + `connector_requests` schema; APP-07/APP-08 internals; IDN-05 OTP delivery mechanics; OBS-05 metric naming + dashboard wiring; per-template catalogue contents and non-mockup copy.