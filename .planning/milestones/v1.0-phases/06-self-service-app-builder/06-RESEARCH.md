# Phase 6: Self-Service App Builder - Research

**Researched:** 2026-10-11
**Domain:** Admin-console SPA (React 19 + Vite) on the existing NestJS 12 API; FormIO 5.6.1 drag-and-drop builder; OIDC SSO + MFA sessions; connector-request queue; template gallery; submissions viewer/export; routing-observability metric
**Confidence:** HIGH (stack, architecture, in-repo reuse) / MEDIUM (FormIO 5.6.1 builder migration outcome — resolved by spike S1 at execution time)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Connector request & the FND-10 gate (BLD-10)**
- **D-97:** The terminal state of "request a connector" is **`provisioned` by a platform operator**: the admin self-serves the entire connector instance *minus the secret* (type, base_url, auth mode, operation list, idempotency expectation); the request lands in a statused queue; a platform operator fills the credential through the existing audited seam; the admin flow resumes once provisioned. Full self-service *credential entry* is explicitly rejected — FND-10/W-24 stay authoritative (D-87). — **Reversibility:** costly — the request queue is a new authored surface; a later switch to full self-service rewires provisioning, not just the UI.
- **D-98:** Connector requests live in a **`connector_requests` collection**, states `pending → provisioned | rejected` (+ reason). The admin sees a status badge on the Connectors page and can cancel/retry while pending; every transition is an AUD-01 event. — **Reversibility:** reversible.
- **D-99:** A request carries the **full connector definition minus the secret** — the operator only fills the credential and validates the test connection. Field mapping stays in the app's Data-routing tab. "No platform admin creating the connector" must hold in substance, not just routing. — **Reversibility:** costly — the request shape is what the operator tooling consumes; changing what a request must carry changes that tooling too.
- **D-100:** The builder mirrors **D-87's credential posture exactly**: local/test credentials may be stored and a test connection run in non-production environments; a production boot still refuses real credentials until a KMS provider is configured. The gate is **not** relaxed for the builder. — **Reversibility:** reversible — unblocks wholesale when a KMS vendor is named.

**Builder auth — OIDC session & MFA (BLD-12, IDN-05, IDN-08)**
- **D-101:** The builder session is **server-side, Redis-backed** (AD-9: services stateless, all session state in Redis), delivered as an **httpOnly, Secure, SameSite=Strict `__Host-` cookie**. OIDC authorization code + PKCE completes at an API endpoint; the React SPA never holds a token, so XSS cannot exfiltrate the session. CSRF is structurally blocked by SameSite plus an origin/double-submit check on state-changing calls. The OIDC subject is never minted into our own JWT (PII-in-JWT constraint). — **Reversibility:** one-way — the session shape is what the SPA auth client and the API session middleware both compile against; swapping to bearer later changes both ends and re-opens the XSS surface.
- **D-102:** MFA is enforced by **verifying the IdP's `acr`/`amr` claims on every builder login** — no homegrown MFA prompt; a login whose authentication level is not MFA-strong is refused. Plain "trust the IdP" (no claim check) is rejected. — **Reversibility:** reversible.
- **D-103:** Builder session lifetime **tracks the IdP session** — silent token exchange keeps the Redis session alive while the IdP session lives; a full re-login when it does not. No second, independently-configured expiry policy. — **Reversibility:** costly — a fixed policy later re-introduces a drift point between two expiry definitions.
- **D-104:** **Auto-provision on first SSO login** — a new subject creates its `real_user` keyed to the OIDC subject and can act (create/publish the apps it owns) on day one. No admin pre-mapping step for builder access. IDN-05's OTP path stays the *employee* self-onboarding route (chat-side), separate from builder access. — **Reversibility:** costly — mandating pre-mapping later changes provisioning and existing identities.

**Template gallery (APP-09)**
- **D-105:** The ~10 template apps ship as **D-31 seed files** — idempotent, audited, platform-owned, loaded by the existing seed loader. "Use template" **forks** a copy into a user-owned draft; the template itself stays read-only platform content. Frontend-bundled catalogues rejected (invisible to the registry, un-audited). — **Reversibility:** costly — the fork/seed boundary is what BLD-02's editor and APP-03 versioning operate on.
- **D-106:** Template set covers the **core domains** — absence/leave, travel, procurement, asset, HR request, ticketing — mostly internal-only (usable immediately, no connector), plus **1–2 external/hybrid examples** that make the connector-request flow demonstrable. — **Reversibility:** reversible.
- **D-107:** Tags use a **curated platform tag set** (use-case + department) shared by templates and user apps, filterable on the Apps page; free-form typing is rejected to keep the catalogue coherent. — **Reversibility:** costly — adding free-form later leaves two tag universes in one filter.
- **D-108:** Forks are **snapshots** — no origin-reference, no auto-adoption, no diff-update pipeline; a later template update never touches an existing fork; APP-03 versioning governs the fork once it lives. — **Reversibility:** one-way — origin-tracking later requires migrating existing forks to carry provenance and building a merge path.

**Surfaces — mockup scope**
- **D-109:** Phase 6 surface scope = **Apps (full editor), Submissions (viewer + export), Connectors (view + request queue), Users (IDN-08 mapping + ACL-05 transfer approval), Dashboard (read-only), Audit Log (read-only browse of AUD-01)**. **Settings (JEV chain, decision cache, circuit breaker) is deferred** as a stub route — platform-admin territory with no Phase-6 requirement. — **Reversibility:** costly — a scope cut; the shipped pages define the nav model (the mockup grid) a Settings page later slots into.
- **D-110:** Global-admin identity actions — **IDN-08 SSO mapping and ACL-05 ownership-transfer approval — live in the builder's Users page**; the operator CLI keeps its Phase-5 read/DLQ/reconcile roles and does **not** duplicate these. — **Reversibility:** reversible.
- **D-111:** The BLD-08 export = **exactly the viewer's visible columns** (projected status, app/form, timestamps, downstream ref, safe reason), CSV via `csv-parse` (already in the stack). PII sits under the same allowlist discipline as logs (D-43/W-22) — never a raw full-payload dump. — **Reversibility:** reversible.
- **D-112:** The Dashboard shows only what has a live data source — recent submissions and recent audit activity. The **connector-health card is held back** until a real health-check job exists (still discretionary from Phase 5); **no static data to fake a card**. — **Reversibility:** reversible.

**Locked by the mockup & prior rulings (recorded, not open)**
- The **create flow is the mockup's 5-step wizard**: **Basics → Triggers → RBAC → Form → Routing**. Step 1 creates the draft ("Saved as a draft · continue through the wizard steps"); `app_id` is lowercase-hyphenated and **immutable after first publish**; data mode is chosen in step 5. Type one in — the editor opens at the drafts tabs.
- **BLD-02's "tabbed editor"** is the mockup's app-detail page: General / Metadata / Triggers / JEV behavior / Role assignments / Roles & permissions / Forms / Versioning / Data routing / Field mapping / Lifecycle state / Retention policy / Deprecation notice.
- **G-11 replacement (this phase's responsibility):** when app definitions are authorable, the `SeedSavedQueryLookup` stopgap is replaced by a real store over builder-written app definitions — written as the frozen D-73 record shape, keyed `(app_id, query_id)`, never `query_id` alone.
- **D-86 reconciliation:** app-definition changes are audited transitions; the builder's writes supersede seed-file+reload for *user* apps, while platform templates stay D-31 seeds.
- **S1 spike (FormIO 5.6.1 builder) blocks this phase** (ROADMAP): render + build a representative form, port one Bootstrap-4-era template, verify `component.errors` and `EditGrid.validateRows`. `apps/renderer` already renders FormIO 5.x, so the spike can verify the *builder* surface, BLD-04 undo/redo, FRM-05 conditional logic, and FRM-09 preview.

### the agent's Discretion
- **BLD-04 50-action undo/redo mechanism** — schema-snapshot history (debounced) vs deep FormIO-builder hooks; decided by the S1 spike and the planner.
- **Connector-request form details** — which "config minus secret" fields surface in the request UI, and the exact `connector_requests` schema.
- **APP-07 routing dry-run / APP-08 collision-check internals** — behaviour is fixed by the requirements; the mechanism is planner-owned.
- **IDN-05 OTP mechanics** — the delivery channel (existing chat pipeline), with the fixed 10-min / 3-attempt / 30-min-lockout numbers.
- **OBS-05 metric naming** and the dashboard wiring for `routing_share{app_id}`.
- **Per-template catalogue contents** (domains fixed in D-106; fields/roles per template at plan time) and copy strings beyond the mockup's.

### Deferred Ideas (OUT OF SCOPE)
- **Settings platform knobs** (JEV provider chain, decision cache, circuit breaker) — deferred to the phase that owns platform administration (D-109).
- **Connector-health dashboard card** — deferred until a real health-check job exists (D-112).
- **Full mockup parity** — rejected; the requirement-mapped surface set (D-109) is the scope.
- **Complete self-service credential entry** — rejected (D-97); FND-10/W-24 stay authoritative.
- **Employee-facing admin surfaces** — none; end users stay on chat + renderer.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BLD-01 | Non-developer creates an app in ≤5 wizard steps without documentation | Mockup wizard is exactly 5 steps (`prototypes/mockup.html:1603-1628`); step-1 draft creation pattern |
| BLD-02 | Owner edits general settings, triggers, RBAC, forms, data routing, retention, lifecycle from tabbed editor | Mockup app-detail tabs (CONTEXT locked); editor reuses `apps/renderer` FormIO integration pattern |
| BLD-03 | Owner creates custom roles with arbitrary permission sets; assign users by name/email autocomplete | `@casl/ability` model (STACK §8.7); identity search via `IdentityService.search` pattern (`identity.service.ts:12-16`) |
| BLD-04 | Owner designs form with drag-and-drop, undo/redo over last 50 actions | FormIO 5.6.1 builder has NO undo/redo API — schema-snapshot history (debounced `builder.schema` capture + `builder.setForm()` restore); resolved by S1 |
| BLD-05 | Data-routing config shows visual form-field → connector-field mapping | Builder-side mapping UI; `ConnectorSeed.mapping` shape (`packages/cli/connector.ts:19`) |
| BLD-06 | Publishing shows confirmation dialog summarising every change; save via keyboard shortcut | Mockup publish modal (`prototypes/mockup.html:1578-1601`) — change-summary rows; implement in SPA |
| BLD-07 | Errors inline, specific, actionable — never generic | SPA error-slot pattern; Zod 4 error mapping |
| BLD-08 | Submission viewer lists app's submissions with filters, detail view, export | Existing `SubmissionRepository`/`SubmissionRevisionsRepository` (`read.module.ts:172-173`); export = visible columns + `csv-stringify` (see Pitfall 11) |
| BLD-09 | Builder usable on tablet; loading skeletons for every async operation | Mockup responsive tokens; SPA skeleton pattern (planner-owned) |
| BLD-10 | Department admin requests a connector and publishes external/hybrid app without a platform admin creating it | D-97..D-100: `connector_requests` collection, full definition minus secret, operator fills credential via `ConnectorCredentialsRepository.upsert` (`connector-credentials.repository.ts:36-52`) |
| BLD-11 | Delegated "workflow manager" operates an app without holding ownership | `@casl/ability` delegation rules; ACL-10's "except ownership transfer" carve-out |
| BLD-12 | Builder authenticates via OIDC SSO with MFA; user manages only owned/administered apps | `openid-client` 6.8.8 v6 flat API (verified from official README); `acr`/`amr` verification (D-102); Redis session (D-101) |
| APP-03 | App definition versioned; last 20 versions retained for rollback | `SubmissionRevisionsRepository` precedent; version collection in `packages/domain/src/builder/` |
| APP-05 | Deprecated app stays functional, shows owner-supplied notice, registers no new triggers | Lifecycle state machine in builder domain; trigger registration gating |
| APP-06 | Archived app accepts no new submissions; existing view links still resolve | Read-path link verification (`ReadVerifierService`) already handles state — consume, don't change |
| APP-07 | Publishing runs routing dry-run; blocks if any existing app's routing share drops >5 points | Dry-run over the labelled intent set using `RoutingOrchestrator`/`PublishedAppLoader` (Phase 3); new `routing_share` computation |
| APP-08 | Publishing rejects an app whose description collides with an existing published app's | Description-similarity check at publish gate (mechanism planner-owned) |
| APP-09 | App tagged/filterable by tag; platform ships ~10 seed template apps | D-105..D-108: D-31 seed files + fork-as-snapshot; curated tag set (D-107) |
| FRM-05 | Form author defines conditional show/hide logic and validation rules (required, pattern, min/max, custom) | FormIO 5 component `conditional` + `validate` properties — native builder capability; S1 verifies |
| FRM-09 | Form author previews a draft form in the builder, with sandbox submissions, before publishing | `Formio.createForm` render path (`view.browser.ts:143-149`) + sandbox submission store |
| IDN-05 | User self-onboards by OTP via IM account: 10-min expiry, 3 attempts, 30-min lockout | Redis state machine (ioredis 6, already a dep); delivered through the existing chat pipeline |
| IDN-08 | Admin maps an SSO identity to a `real_user_id` without user OTP | `IdentityMappingRepository.upsert` pattern (`identity-mapping.repository.ts:12-21`); Users page surface (D-110) |
| ACL-05 | Ownership transfer requires global admin approval; auto-cancels after 7 days unapproved | Pending-approval record + 7-day TTL job (scheduler); `@casl/ability` rules |
| ACL-10 | App owner views/modifies all role assignments except ownership transfer | `@casl/ability` per-app rules; transfer endpoint excluded from owner scope |
| OBS-05 | `routing_share{app_id}` exported so routing traffic theft is detectable | OTel metrics API (`@opentelemetry/api` 1.9.1, already a dep) → `exporter-prometheus` (single metrics path, OBS-01); instrument does not exist yet — must be created |
</phase_requirements>

## Summary

Phase 6 is the largest requirement set in the roadmap (23 requirements) but the **lowest-risk slice**: every backend primitive it needs already exists in-repo — the app store (`AppRepository`), the credential envelope (`encryptSecret`/`decryptSecret` + production guard), the audit append-only log (`AuditRepository.append`), the identity pipeline (`IdentityService`/`IdentityMappingRepository`/`ProfileRepository`), the saved-query store this phase replaces (`SeedSavedQueryLookup`), and the FormIO 5 engine already rendering in `apps/renderer`. The phase's work is **composition and new surfaces**, not new primitives: a React 19 + Vite SPA (`apps/app-builder`), a FormIO **builder** mount (the engine's other half — `apps/renderer` only uses `createForm`), an OIDC auth-code+PKCE session endpoint (`openid-client` 6.8.8, ESM-only like `jose`), a `connector_requests` collection with the operator-provisioned terminal state, a D-31-seeded template gallery with snapshot forks, and the `routing_share{app_id}` metric that OBS-05 requires to exist for the first time.

Three findings de-risk the phase's biggest unknowns:

1. **BLD-04 undo/redo cannot use FormIO internals.** `@formio/js` 5.6.1 (installed, verified) exposes no builder undo/redo API — the only `undo` symbol in the package is an internal select-typing method. The 50-action history must be **schema-snapshot history**: capture `builder.schema` on the builder `change` event (debounced), restore via `builder.setForm(snapshot)`. This resolves CONTEXT's discretion item in favor of snapshots; the S1 spike verifies it.
2. **The connector request is a data-shape problem, not a new workflow.** D-99's "full connector definition minus the secret" is exactly the `ConnectorSeed` interface (`packages/cli/connector.ts:11-22`) minus `credential_ref`'s secret value — the same shape as `config/connectors/redmine.dev.json`. The operator's provision step is the existing `ConnectorCredentialsRepository.upsert(credentialRef, headerName, plaintext)` call behind the audited CLI seam.
3. **The new SPA sits outside the boundary graph, exactly like `apps/renderer`.** `tooling/boundaries.config.mjs:87-97` maps only `apps/api`, `apps/worker`, `apps/scheduler`; `apps/renderer` is unmapped today and `apps/app-builder` will be too. The new *domain* code, however, lands in `packages/domain/src/builder/` — an element type **already reserved** (`DOMAIN_ELEMENT_TYPES`, `boundaries.config.mjs:38-58`) with `ALLOWED_EDGES.builder` already declared (`boundaries.config.mjs:179-187`) but **lacking `identity`, `links`, `contract`** — the builder domain needs those edges for OIDC auto-provision (D-104), the D-73 saved-query write (G-11), and builder-facing contracts, so the edge list must be extended deliberately.

**Primary recommendation:** Run spike S1 first (half-day, blocks the phase): mount `Formio.builder()` in a React 19 + Vite 8 shell, port one Bootstrap-4-era template against the 5.x Bootstrap-5 default, and verify the snapshot undo/redo, `component.errors` array shape, and `EditGrid.validateRows` array return. Then build the API-side surfaces (session, app CRUD, publish gate, request queue) — they have no external unknowns — and the SPA last, against the mockup's token set.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| App Builder SPA (wizard, tabbed editor, drag-drop form design) | Browser / Client | — | FormIO builder + React chrome render in the browser; the API is a pure CRUD/gating backend |
| OIDC authorization-code + PKCE completion | API / Backend (`apps/api`) | IdP (external) | D-101: PKCE exchange completes at an API endpoint; the SPA never holds a token |
| Session store (httpOnly `__Host-` cookie → opaque ID) | API / Backend (middleware) | Redis (Database/Storage) | AD-9: all session state in Redis; services stay stateless |
| MFA enforcement (`acr`/`amr` claims) | API / Backend | IdP (external) | D-102: claims verified on the ID token at the API callback, per login |
| App definition CRUD, drafts, versions (APP-03), lifecycle (APP-05/06) | API / Backend → MongoDB | — | `AppRepository` precedent (`app.repository.ts:9-33`); builder domain owns transitions |
| Publish gate: routing dry-run (APP-07) + description collision (APP-08) | API / Backend | — | Dry-run executes the labelled intent set through the Phase-3 routing machinery read-only |
| Connector request queue (BLD-10, D-97..D-100) | API / Backend → MongoDB | Operator CLI (packages/cli) | Request is authored in the builder; the operator fills the credential through the existing audited seam |
| Credential storage (AES-256-GCM envelope) | Platform (`packages/platform/src/crypto`) | — | Reuse `encryptSecret`/`decryptSecret` + `assertKeyProviderAllowed`; never hand-roll (D-100) |
| Template gallery (APP-09, D-105..D-108) | API / Backend (seed loader) | MongoDB | D-31 seed files are platform-owned; forks are user-owned snapshots |
| Submissions viewer + CSV export (BLD-08, D-111) | API / Backend | — | `SubmissionRepository` + visible-column projection + CSV writer |
| OTP self-onboarding (IDN-05) | API / Backend → Redis → IM pipeline | — | 10-min/3-attempt/30-min-lockout state machine in Redis; delivery via the existing chat pipeline |
| SSO identity mapping (IDN-08) + transfer approval (ACL-05) | API / Backend (Users page) | Scheduler (7-day auto-cancel) | D-110: global-admin actions live in the builder's Users page; CLI keeps read/DLQ/reconcile only |
| `routing_share{app_id}` (OBS-05) | API / Backend (OTel metrics API) | Prometheus exporter | Single metrics path (OBS-01); the metric instrument must be created — it does not exist in code today |
| Form rendering (preview FRM-09, read-only views) | Browser / Client | — | `Formio.createForm` — same engine as `apps/renderer` |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@formio/js` | **5.6.1** (repo pin — `package.json:23`; installed `node_modules` verified 5.6.1) | Form engine **and** drag-and-drop builder (`Formio.builder()`) | Already the repo's form engine (FRM-01: "Every form is a FormIO.js JSON schema; no other form engine is used anywhere"). Builder verified present in the 5.6.1 tarball (STACK §9.2: `FormBuilder.js`, `WebformBuilder.js`, `dragula@^3.7.3` dep). npm `latest` is 5.7.0 (2026-10-09) — **pin 5.6.1 explicitly**; the spike verifies the pinned version, not latest. MIT. [VERIFIED: package.json:23] [CITED: help.form.io/dev/form-development/form-builder] |
| `react` / `react-dom` | **19.3.0** | `apps/app-builder` SPA — first React in the repo | STACK §9.1; mockup is the design target and React 19 + Vite is the blessed web toolchain. 187.9M dl/wk, official repo. [VERIFIED: npm registry via `npm view` 2026-10-11] |
| `vite` | **8.3.4** | Dev server + build for the SPA | STACK §9.1 says 8.3.2; registry current is **8.3.4** (2026-10-08) — **pin explicitly**. 195.9M dl/wk. [VERIFIED: npm registry] |
| `@vitejs/plugin-react` | **6.1.2** | React fast-refresh for Vite | STACK §9.1 says 6.1.1; registry current is **6.1.2** (2026-10-05) — **pin explicitly**. 97.2M dl/wk. [VERIFIED: npm registry] |
| `openid-client` | **6.8.8** | OIDC authorization-code + PKCE at the API endpoint (BLD-12, D-101) | STACK §8.6: 15.75M dl/wk, maintained, depends on `jose` + `oauth4webapi` (primitives already chosen). **ESM-only** (`type: module`) — same constraint as `jose`, no new migration cost. v6 uses the flat `client.*` namespace (`discovery`, `randomPKCECodeVerifier`, `calculatePKCECodeChallenge`, `buildAuthorizationUrl`, `authorizationCodeGrant`) — verified from the official v6 README. [VERIFIED: npm registry + GitHub v6.x README] |
| `@casl/ability` | **7.0.1** | Owner-scoped authorization: BLD-12 ("only manage apps they own or administer"), BLD-11 delegation, ACL-05/ACL-10 carve-outs | STACK §8.7; 1.83M dl/wk, official repo. [VERIFIED: npm registry + legitimacy gate OK] |
| `zod` | **^4.6.5** (already a dep, `package.json:46`) | Builder DTOs, `connector_requests` shape, publish-gate inputs, session config | NestJS 12 Standard Schema — one validation language across the codebase (STACK §4.2). [VERIFIED: package.json:46] |
| `ioredis` | **6.0.0** (already a dep, `package.json:40`) | Redis-backed session store (D-101), OTP state machine (IDN-05) | One Redis client across BullMQ + sessions halves the connection surface (STACK §4.4). [VERIFIED: package.json:40] |
| `@opentelemetry/api` + `@opentelemetry/semantic-conventions` | **1.9.1** / **1.43.0** (already deps, `package.json:30,50`) | `routing_share{app_id}` metric (OBS-05) | OBS-01: one metrics path — OTel metrics API → `exporter-prometheus`. Both already installed. [VERIFIED: package.json:30,50] |
| `csv-stringify` | **6.9.0** | D-111 / BLD-08 CSV **export** (the *writer*) | D-111 names `csv-parse`, but `csv-parse` is a **parser** — the writer in the same family/repo (`adaltas/node-csv`, MIT) is `csv-stringify` 6.9.0. STACK §10.2 lists `csv-parse` for "import/export"; the export half needs this sibling. See Pitfall 11 and Open Question 5. [VERIFIED: npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@playwright/test` | **1.64.0** (STACK §10.1 says 1.63.0 — pin explicitly) | E2E for the SPA — including the drag-and-drop builder UAT, which unit tests cannot assert | Builder interaction tests, publish-gate E2E, tablet-viewport smoke. 75.7M dl/wk, microsoft/playwright. [VERIFIED: npm registry] |
| `vitest` | **^5.0.3** (already a dep) | Unit + integration tests for builder domain, session, publish gate | Already the repo's test framework (`vitest.config.mts`). [VERIFIED: package.json:59] |
| `testcontainers` (+ `@testcontainers/mongodb`, `@testcontainers/redis`) | **12.2.0** (already devDeps) | Real MongoDB 8.0.x + Redis ≥8.2 in integration tests | `GETDEL`-style atomicity and BullMQ behavior need real Redis semantics (STACK §10.1). Docker confirmed available in this environment. [VERIFIED: package.json:51-53,56] |
| `express-session` + `connect-redis` | 1.19.0 / 10.0.0 | **Alternative** session middleware (NOT recommended — see Don't Hand-Roll #5) | Only if the bespoke session semantics (IdP-session tracking, pre-login PKCE state) outgrow the hand-rolled middleware |
| `helmet` | 8.3.0 (STACK §10.2) | HTTP security headers on the API | Already blessed; apply to new API routes |
| `@nestjs/terminus` | 12.1.0 (already a dep) | Health endpoints for the new modules | Already used by the API |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@formio/js` 5.6.1 (pinned) | `formiojs@4.21.7` | 4.x is in official maintenance mode ("No new features will be added to version 4.x") — the S1 spike's fallback, acceptable only as an explicit decision (ROADMAP), never drift. 4.x has mature docs but no 5.x fixes. |
| `openid-client` 6.8.8 | `@node-saml/node-saml` 5.1.0 | SAML — **deferred** (STACK §8.6): ~14 months since last publish (2025-07-21), MEDIUM confidence; OIDC covers Entra ID/Okta/Auth0/Keycloak/Google Workspace. S3 customer question. |
| Hand-rolled session middleware over ioredis | `express-session` + `connect-redis` | Standard stack, but the D-101 semantics (pre-login PKCE verifier storage, IdP-session-lifetime tracking, OIDC-subject linkage) are bespoke; the repo's own precedent (STACK §8.2 hand-written `ThrottlerStorage`) favors ~120 lines over a second session framework. One fewer dependency family. |
| `csv-stringify` | Hand-rolled CSV emission | CSV escaping/quoting edge cases (embedded commas, quotes, newlines) are exactly what not to hand-roll (D-111 export is a compliance surface). |
| React 19 SPA | Server-rendered admin (e.g. Nest + templates) | The mockup is a rich client-side IA (drawers, modals, wizards); the repo's blessed web toolchain is React 19 + Vite (STACK §9.1). |

**Installation:**

```bash
# Phase 6 additions (pin explicitly — STACK.md's versions have drifted)
npm install react@19.3.0 react-dom@19.3.0
npm install -D vite@8.3.4 @vitejs/plugin-react@6.1.2 @playwright/test@1.64.0
npm install openid-client@6.8.8 @casl/ability@7.0.1 csv-stringify@6.9.0
# E2E browsers (once per machine/CI):
npx playwright install chromium
```

`@formio/js@5.6.1`, `zod`, `ioredis`, `@opentelemetry/api`, `@opentelemetry/semantic-conventions`, `vitest`, `testcontainers` are **already installed** — no action.

**Version verification:** All versions above were resolved against `registry.npmjs.org` on 2026-10-11 via `npm view <pkg> version`: `openid-client` 6.8.8, `@casl/ability` 7.0.1, `csv-parse` 7.0.3, `csv-stringify` 6.9.0, `react`/`react-dom` 19.3.0, `@formio/js` 5.7.0 (repo pins 5.6.1 — keep the pin), `vite` 8.3.4, `@vitejs/plugin-react` 6.1.2, `@playwright/test` 1.64.0. The STACK.md §14 ledger was updated 2026-10-11 to these same registry-current values (it previously recorded vite 8.3.2, plugin-react 6.1.1, playwright 1.63.0) — **pin the registry-current versions explicitly in `package.json`** so the lockfile is reproducible.

## Package Legitimacy Audit

Gate run 2026-10-11 via `gsd-tools query package-legitimacy check --ecosystem npm`. Verdicts:

| Package | Registry | Age | Downloads/wk | Source Repo | Verdict | Disposition |
|---------|----------|-----|--------------|-------------|---------|-------------|
| `openid-client` | npm | 2016 (v6 2026) | 15.75M | github.com/panva/openid-client | **OK** | Approved |
| `@casl/ability` | npm | 2023+ | 1.83M | github.com/stalniy/casl | **OK** | Approved |
| `react` / `react-dom` | npm | 2013+ | 187.9M / 176.7M | github.com/react/react | **OK** | Approved |
| `csv-parse` | npm | adaltas, long-lived | 20.95M | github.com/adaltas/node-csv | **SUS** (`too-new`) | **Keep** — STACK §10.2 already verified 7.0.3 as the repo standard; flag is version-recency only (latest patch published 2026-09-25), official first-party repo, no postinstall. No slopsquat signals. |
| `csv-stringify` | npm | adaltas, long-lived | (same family) | github.com/adaltas/node-csv | **SUS** (`too-new`) | **Keep** — same repo/family as `csv-parse`; version-recency flag only. [WARNING: flagged as suspicious — verify before using.] |
| `@formio/js` | npm | formio.js, long-lived | 51K | github.com/formio/formio.js | **SUS** (`too-new`) | **Keep at pinned 5.6.1** — the flag fires on the *latest* (5.7.0, published 2026-10-09); the repo pin is 5.6.1, installed and tarball-verified (STACK §9.2). [WARNING: flagged as suspicious — verify before using.] |
| `vite` | npm | 2020+ | 195.9M | github.com/vitejs/vite | **SUS** (`too-new`) | **Keep** — 8.3.4 published 2026-10-08; recency-only flag on an established first-party package. [WARNING: flagged as suspicious — verify before using.] |
| `@vitejs/plugin-react` | npm | 2021+ | 97.2M | github.com/vitejs/vite-plugin-react | **SUS** (`too-new`) | **Keep** — 6.1.2 published 2026-10-05; recency-only flag, official repo. [WARNING: flagged as suspicious — verify before using.] |
| `@playwright/test` | npm | 2020+ | 75.7M | github.com/microsoft/playwright | **SUS** (`too-new`) | **Keep** — 1.64.0 published 2026-10-07; recency-only flag, official Microsoft repo. [WARNING: flagged as suspicious — verify before using.] |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `csv-parse`, `csv-stringify`, `@formio/js`, `vite`, `@vitejs/plugin-react`, `@playwright/test` — all flagged **`too-new`** (latest patch published within the gate's recency window), all with official first-party repos and tens-of-millions of weekly downloads. The flag is a version-recency signal, not a legitimacy signal; none exhibit slopsquat indicators (no missing repo, no postinstall, not deprecated). **Planner action:** add one `checkpoint:human-verify` task covering the five *new-to-repo* installs (react-dom aside, react is OK-gated) before the first install wave — this is also the natural point to confirm the explicit version pins above.

*Packages discovered via WebSearch or training data that have not been verified against an authoritative source are tagged `[ASSUMED]` and the planner must gate each install behind a `checkpoint:human-verify` task.* — No such packages remain: every recommendation above passed the gate or is already installed in-repo.

## Architecture Patterns

### System Architecture Diagram

```
                        Browser — apps/app-builder SPA (React 19 + Vite 8)
                        ┌────────────────────────────────────────────────┐
                        │ 5-step wizard · tabbed editor · FormIO builder │
                        │ submissions viewer · dashboard · users · audit │
                        │ Holds NO token — only the __Host- session cookie│
                        └───────────────┬────────────────────────────────┘
                                        │ HTTPS + httpOnly Secure
                                        │ SameSite=Strict __Host- cookie
                                        ▼
                        API — apps/api (NestJS 12, Express 5)
   ┌────────────────────┬─────────────────┬──────────────────┬─────────────────┐
   │ auth/              │ app-builder/    │ submissions/     │ users/          │
   │ ·OIDC PKCE begin   │ ·app CRUD+draft │ ·viewer (filters)│ ·SSO mapping    │
   │ ·OIDC callback     │ ·version store  │ ·detail          │  (IDN-08)       │
   │  (acr/amr verify)  │ ·publish gate   │ ·export (CSV,    │ ·transfer       │
   │ ·session middleware│ ·dry-run        │  visible cols)   │  approval       │
   │  (Redis)           │ ·templates+tags │                  │  (ACL-05)       │
   │ ·OTP onboarding    │ ·connector      │                  │ ·delegation     │
   │  (IDN-05, Redis)   │  requests queue │                  │  (BLD-11)       │
   └─────────┬──────────┴────────┬────────┴────────┬─────────┴────────┬────────┘
             │                   │                 │                  │
             ▼                   ▼                 ▼                  ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │ Redis 8.2+ (ioredis 6)          │ MongoDB 8.0.x (native driver 7.7) │
   │ ·session store (D-101)          │ ·apps, app_versions               │
   │ ·PKCE verifier + state (pre-login)│ ·connector_requests (D-98)      │
   │ ·OTP attempts + lockout (IDN-05)│ ·saved queries (D-73 shape)       │
   │ ·RBAC cache (existing)          │ ·audit log (append-only, AUD-01)  │
   └───────────────────────────────────────────────────────────────────────┘
             │                                   ▲
             │                                   │ operator fills credential
             ▼                                   │ via audited CLI seam
   ┌──────────────────┐               ┌─────────┴──────────────────────┐
   │ Corporate IdP    │               │ packages/cli (provision)        │
   │ OIDC + MFA       │◄──────────────│ reads connector_requests,       │
   │ (openid-client)  │  discovery    │ calls ConnectorCredentials-     │
   └──────────────────┘               │ Repository.upsert → AES-256-GCM │
                                      │ envelope (D-100 guard applies)  │
                                      └─────────────────────────────────┘

   Publish (APP-07): app-builder/ publish gate → RoutingOrchestrator dry-run
   (read-only, labelled intent set) → routing_share{app_id} via OTel metrics
   API → exporter-prometheus (single metrics path, OBS-01/OBS-05)
```

### Recommended Project Structure

```
apps/app-builder/                 # NEW SPA — outside the boundary element graph,
│                                 # same status as apps/renderer today
├── index.html
├── package.json                  # (workspace root owns deps; SPA has no own deps)
├── tsconfig.json                 # DOM lib + jsx — root tsconfig.json does NOT
│                                 # reference apps/* SPAs (verified: tsconfig.json:3-31)
├── vite.config.ts                # dev proxy /api → API origin (renderer precedent)
└── src/
    ├── main.browser.ts           # entry — guarded, DOM-only (edit.ts pattern)
    ├── auth/                     # session cookie client, PKCE redirect handler
    ├── wizard/                   # BLD-01: Basics→Triggers→RBAC→Form→Routing
    ├── editor/                   # BLD-02: tabbed editor (mockup app-detail)
    ├── form-designer/            # BLD-04/FRM-05/FRM-09: FormIO.builder mount,
    │                             #   snapshot undo/redo, preview
    ├── apps/                     # app list, tags, template gallery (APP-09)
    ├── submissions/              # BLD-08: viewer + detail + export
    ├── connectors/               # BLD-10: view + request queue (D-98)
    ├── users/                    # IDN-08 + ACL-05 (D-110)
    ├── dashboard/                # D-112: read-only, live data only
    ├── audit/                    # D-109: read-only AUD-01 browse
    └── tokens.css                # mockup :root tokens (--accent:#0f9d8f …)

packages/domain/src/builder/      # NEW domain element (already reserved in
│                                 # boundaries.config.mjs:38-58)
├── app-definition.repository.ts  # drafts, versions (APP-03: 20 retained), lifecycle
├── app-definition.service.ts     # audited transitions (D-86)
├── publish-gate.service.ts       # APP-07 dry-run + APP-08 collision check
├── template/                     # D-105 seed loading + D-108 fork-as-snapshot
├── connector-request/            # D-97..D-99: collection, states, AUD-01 events
├── routing-share/                # OBS-05: routing_share computation + metric
└── data-access/                  # repositories (BOUNDARY_FILE_CATEGORIES pattern)

packages/domain/src/forms/        # reserved element — form schema versioning (FRM-02)

apps/api/src/auth/                # NEW module: OIDC endpoints + session middleware
apps/api/src/app-builder/         # NEW module: factory providers (read.module.ts pattern)
apps/api/src/submissions/         # viewer/export endpoints (BLD-08/D-111)
apps/api/src/users/               # SSO mapping + transfer approval (D-110)

packages/contract/src/            # builder-facing contracts ADDED BESIDE frozen ones

packages/cli/                     # provision.ts extended to consume
                                  # connector_requests (D-97/98)

tooling/boundaries.config.mjs     # ALLOWED_EDGES.builder extended (identity, links,
                                  # contract) — see Pattern 6
```

### Pattern 1: Browser-guarded FormIO integration (mandatory — `@formio/js` is DOM-dependent)

**What:** `@formio/js` touches `document` at import time. A Node-side (vitest, worker, API) static import throws `document is not defined` (verified by execution this session). Every FormIO touch must live in a browser-only entry that dynamically imports inside a guard.

**When to use:** any file that imports `@formio/js` — the form designer, the preview pane, any SPA route that renders a form.

**Example (the in-repo precedent, `apps/renderer/src/read/edit.ts:309-312`):**

```typescript
// VERIFIED: apps/renderer/src/read/edit.ts:309-312
const { Formio } = (await import('@formio/js')) as {
  Formio: { createForm: (el: HTMLElement, schema: unknown, opts?: unknown) => Promise<{ setSubmission: (s: unknown) => void; on: (ev: string, cb: () => void) => void }> };
};
await import('@formio/js/dist/formio.full.min.css');
```

The builder surface follows the same shape with `Formio.builder(element, form, options)` [CITED: help.form.io/dev/form-development/form-builder]:

```typescript
// FormIO builder — browser entry only (S1 spike verifies this exact surface)
const { Formio } = await import('@formio/js');
const builder = await Formio.builder(containerEl, existingSchema ?? {}, {
  builder: {
    // groups: basic / advanced / layout / data / premium + custom pre-defined
    // components carrying their own `schema` (verified from FormIO docs)
  },
});
builder.on('change', (form) => { /* form === current schema object */ });
// builder.schema — always the current form definition
// builder.setForm(schema) — restores a form (the undo/redo restore path)
```

### Pattern 2: Schema-snapshot undo/redo (BLD-04 — resolves the CONTEXT discretion item)

**What:** FormIO 5.6.1 has **no builder undo/redo API** (the only `undo` symbol in the installed package is `Select.undoValueTyping`, an internal select-input method — verified by grep of `node_modules/@formio/js/lib/mjs` this session). The 50-action history is therefore **app-built**: debounced `builder.schema` snapshots on the `change` event, restore via `builder.setForm(snapshot)`.

**When to use:** the form designer's undo/redo toolbar (last 50 actions).

**Why snapshots, not hooks:** deep FormIO hooks (`builder.instance.editComponent` monkey-patching, per-component interception) are undocumented internal surfaces that break on patch bumps; `change` + `schema` + `setForm` are the documented public API [CITED: help.form.io/dev/form-development/form-builder; github.com/formio/formio.js issues #2773, #1985]. One snapshot per debounced change batch ≈ one "action" for user purposes; 50 entries is a bounded ring buffer of JSON objects.

### Pattern 3: Factory-provider module composition (the `read.module.ts` shape)

**What:** New API modules compose via Nest factory providers with explicit `inject` tokens and wiring guards — env/config read at module init, failing loudly with a named error. The G-11 replacement mirrors the `SeedSavedQueryLookup` factory exactly (`read.module.ts:188-194`).

**When to use:** every new `apps/api` module (auth, app-builder, submissions, users).

**Example (VERIFIED: `apps/api/src/read/read.module.ts:146-165`):**

```typescript
@Module({
  imports: [MongoModule],
  controllers: [ReadController],
  providers: [
    redisCacheProvider,
    {
      provide: 'READ_LINK_CONFIG',
      useFactory: (): ReadLinkConfig => readReadLinkConfig(),
    },
    {
      provide: 'READ_LINK_JWT_VERIFIER',
      useFactory: (config: ReadLinkConfig): ReadLinkJwtVerifier =>
        new ReadLinkJwtVerifierImpl(config.publicKey, config.issuer, config.audience, config.previousPublicKey),
      inject: [{ token: 'READ_LINK_CONFIG', optional: false }],
    },
    // …
  ],
})
export class ReadModule {}
```

### Pattern 4: OIDC authorization-code + PKCE at the API endpoint (D-101/D-102)

**What:** `openid-client` v6 flat-namespace API (verified from the official v6 README, `github.com/panva/openid-client/blob/v6.x/README.md`). The **pre-login** PKCE `code_verifier` and `state` are stored in the Redis session (the README: "You must store the code_verifier and state in the end-user session"); the SPA holds only the opaque session cookie.

**When to use:** the `/auth/oidc/begin` and `/auth/oidc/callback` endpoints.

**Example (openid-client 6.8.8 v6 API — [CITED: github.com/panva/openid-client v6.x README]):**

```typescript
import * as oidcClient from 'openid-client';

// one-time, at module init (discovery)
const config: oidcClient.Configuration = await oidcClient.discovery(
  new URL(OIDC_ISSUER), OIDC_CLIENT_ID, OIDC_CLIENT_SECRET,
);

// GET /auth/oidc/begin — generate PKCE pair, stash verifier+state in Redis session
const code_verifier: string = oidcClient.randomPKCECodeVerifier();
const code_challenge: string = await oidcClient.calculatePKCECodeChallenge(code_verifier);
let state: string | undefined;
const parameters: Record<string, string> = {
  redirect_uri, scope: 'openid profile email',
  code_challenge, code_challenge_method: 'S256',
};
if (!config.serverMetadata().supportsPKCE()) {
  state = oidcClient.randomState();
  parameters.state = state;
}
const redirectTo: URL = oidcClient.buildAuthorizationUrl(config, parameters);
// → 302 to redirectTo.href

// GET /auth/oidc/callback — exchange, then verify claims
const tokens: oidcClient.TokenEndpointResponse = await oidcClient.authorizationCodeGrant(
  config, currentUrl,
  { pkceCodeVerifier: code_verifier, expectedState: state },
);
// D-102: MFA gate — refuse a login whose authentication level is not MFA-strong
const claims = tokens.id_token?.claims() ?? {};
if (!isMfaStrong(claims.acr, claims.amr)) throw new Error('AUTH_MFA_REQUIRED');
// D-104: auto-provision real_user keyed to the OIDC subject (sub claim)
// D-101: the OIDC subject is NEVER minted into our own JWT (PII-in-JWT constraint)
```

### Pattern 5: Seed-loaded templates, fork-as-snapshot (D-105/D-108)

**What:** Template apps are D-31 seed JSON files (idempotent, audited, platform-owned, loaded by the existing seed loader). "Use template" deep-copies the definition into a user-owned draft — a snapshot with no origin reference. The G-11 replacement writes saved queries as D-73 records keyed `(app_id, query_id)` — never `query_id` alone (VERIFIED: `seed-saved-query.lookup.ts:29-34`: "`findSavedQuery` keys on **`(app_id, query_id)`**, never `query_id` alone.").

**When to use:** template gallery (APP-09), app creation from template, the saved-query store replacement.

### Pattern 6: Boundary-graph extension for the `builder` element

**What:** `packages/domain/src/builder/` is a reserved element type [VERIFIED: `tooling/boundaries.config.mjs:38-58` — `DOMAIN_ELEMENT_TYPES` includes `'builder'` and `'forms'`], but its allowed edges lack the types the builder domain needs:

```javascript
// VERIFIED: tooling/boundaries.config.mjs:179-187
builder: Object.freeze([
  'platform',
  'kernel',
  'registry',
  'forms',
  'authz',
  'connectors',
  'audit',
]),
```

The builder domain must import `identity` (D-104 auto-provision), `links` (G-11 saved-query write), and `contract` (builder-facing shapes) — **extend `ALLOWED_EDGES.builder` to include `'identity'`, `'links'`, `'contract'`** as an explicit, reviewed config change. Remember the graph's load-bearing facts [VERIFIED: `boundaries.config.mjs:14-23`]: policies are **last-match-wins** and permissive edges must be declared before R1/R2/R3 restrictions. The SPA (`apps/app-builder/src/**`) matches no element pattern, so it sits outside the graph — identical status to `apps/renderer` today (root `tsconfig.json:3-31` references only tooling, packages/*, apps/api, apps/worker, apps/scheduler — no `apps/renderer`, no `apps/app-builder`).

### Anti-Patterns to Avoid

- **Static `import { Formio } from '@formio/js'` in any Node-executed file** — throws `document is not defined` (verified by execution). Always the Pattern 1 dynamic import inside a browser entry.
- **React re-rendering inside a FormIO-controlled DOM subtree** — FormIO owns its container's DOM; mount the builder in a ref'd container element and treat it as a leaf. Letting React reconcile inside it destroys builder state silently.
- **Frontend-bundled template catalogue** (D-105) — templates must be D-31 seed files: a bundled catalogue is invisible to the registry and un-audited.
- **Free-form tags** (D-107) — the curated platform tag set is a frozen vocabulary; free-form typing creates two tag universes in one filter.
- **`query_id`-only saved-query keying** — the seed spec's uniqueness rule is `(app_id, query_id)`; a query_id-only lookup lets app A's link resolve app B's query (`seed-saved-query.lookup.ts:29-34`).
- **Relaxing the production credential gate for the builder** (D-100) — `assertKeyProviderAllowed` throws `CRYPTO_KEY_PROVIDER_REQUIRED: production requires kms` on any production boot without a KMS provider [VERIFIED: `packages/platform/src/crypto/production-guard.ts:96-105`]; the builder flow must route through the same guard, not around it.
- **SPA-held tokens / localStorage sessions** (D-101) — XSS-exfiltratable by construction; the cookie is httpOnly and the SPA never sees a token.
- **Editing the frozen contracts** — D-73 saved-query shape and D-21 claim set are consumed, never reshaped in-place; new builder contracts are added beside them in `packages/contract`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OIDC discovery, PKCE, token exchange, ID-token validation | A hand-rolled OIDC client | `openid-client` 6.8.8 | PKCE `S256`, `state`, nonce, `kid`/JWKS handling, and IdP metadata quirks are a security-critical surface; v6's flat API is ~5 calls for the whole flow (Pattern 4). |
| Form engine, drag-and-drop builder, validation, conditional logic | A custom form builder | `@formio/js` 5.6.1 `Formio.builder()` | FRM-01 mandates FormIO as the only engine; the builder ships with `dragula`, 5 component groups, per-component edit forms, and `editForm` overrides — a hand-rolled equivalent is months of work. |
| RBAC / owner-scoping / delegation rules | Hand-rolled permission checks in each endpoint | `@casl/ability` 7.0.1 | BLD-11/BLD-12/ACL-05/ACL-10 are per-app rule sets with an ownership carve-out; `@casl/ability` gives one tested rule engine and the boundary tests a consistent shape. |
| AES-256-GCM secret envelope | Any crypto code in the builder | `packages/platform/src/crypto` `encryptSecret`/`decryptSecret` + `assertKeyProviderAllowed` | The envelope (`{ v: 1, alg: "A256GCM", kid, iv, tag, ct }`) is frozen (D-25) with verified-tag and fresh-nonce guarantees [VERIFIED: `packages/platform/src/crypto/envelope.ts:79-93`]; STACK §11 says AES-256-GCM needs no package — Node stdlib `crypto`, already implemented. |
| Session middleware | `express-session` + `connect-redis` (second session framework) | Hand-rolled ~120-line middleware over the existing ioredis connection | The D-101 semantics are bespoke (pre-login PKCE verifier storage, IdP-session-lifetime tracking D-103, OIDC-subject linkage, `__Host-` cookie issuance). Repo precedent: STACK §8.2 hand-writes the `ThrottlerStorage` for exactly this reason. `express-session`/`connect-redis` remain the fallback if semantics outgrow the middleware (Alternatives table). |
| CSV export writer | Hand-rolled CSV string joining | `csv-stringify` 6.9.0 | Embedded commas/quotes/newlines in submission data are a correctness and compliance surface (D-111 export is auditable output). Note: D-111 names `csv-parse`, which *parses* — the writer is this sibling (Pitfall 11). |
| Routing dry-run execution | A second routing implementation | Phase-3 `RoutingOrchestrator` / `PublishedAppLoader` executed read-only | APP-07's dry-run must predict exactly what the live router would do; a second implementation drifts. The dry-run wraps the real one. |
| Audit trail | Any update/delete-capable log | `AuditRepository.append` (append-only by construction) | AUD-01: append-only is enforced structurally — no update or delete methods exist [VERIFIED: `packages/domain/src/audit/audit.repository.ts:13-33`]. Every D-98 transition and D-86 definition change appends here. |
| OTP state machine | In-memory attempt counters | Redis (ioredis 6) keys with TTL | IDN-05's 10-min expiry / 3 attempts / 30-min lockout must survive restarts and apply across instances (AD-9: no sticky sessions). |

**Key insight:** the phase's risk is concentrated in *integration* (FormIO builder inside React, OIDC against a real IdP), not in *construction* — every primitive exists. Hand-rolling any of the above re-introduces the exact failure modes the existing implementations were built to close (envelope tag loss, PKCE downgrade, permission drift, audit mutation).

## Runtime State Inventory

> This phase is predominantly greenfield (new SPA, new domain element) but it **replaces one existing component** (G-11 stopgap) and **extends two existing surfaces** (operator CLI, `apps` collection). Audited explicitly per the rename/refactor trigger.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `SeedSavedQueryLookup` reads the frozen `packages/domain/src/seeds/saved-queries.seed.json` (read-only consumption) [VERIFIED: `seed-saved-query.lookup.ts:1,20-27`]; `apps` collection holds `AppDocument { app_id, connector_ref, updatedAt? }` [VERIFIED: `packages/domain/src/registry/app.repository.ts:3-7`] | Code edit: replace `SeedSavedQueryLookup` with a repository-backed impl of the same `SavedQueryLookup` interface ("replaced by a repository-backed implementation of the same interface, with no change to the verifier" — `seed-saved-query.lookup.ts:25-27`), writing D-73 records keyed `(app_id, query_id)`. **Data migration:** backfill saved-query records from the seed into the collection (idempotent, so the seed loader and the repository coexist during rollout). Builder app definitions extend the `apps` collection with new fields on user-authored apps only — seed-loaded platform apps keep their shape. |
| Live service config | None found — no external service holds builder config yet (the product is pre-Phase-6) | None — verified by reading the CLI seams (`packages/cli/{connector,provision,rebind,dlq}.ts`); provisioning stays operator-owned, no live config references a builder. |
| OS-registered state | None — no systemd/launchd/pm2 registrations in repo or deployment (single enterprise deployment, pre-production) | None — verified by repo grep; no deployment manifests exist in-repo. |
| Secrets / env vars | No secrets are renamed. **New env vars required** (not renames): `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `BUILDER_SESSION_TTL`-style config, OIDC redirect URI registration at the IdP | Code edit: add to the auth module's env reader with a named boot failure (the `READ_LINK_CONFIG_KEYS` pattern, `read.module.ts:55-60`); document in README's auth section. `.env.example` gains single-line entries (PEM-style values must be escaped per the `expandPem` precedent, `read.module.ts:72-74`). |
| Build artifacts | None — no installed-package artifacts carry a builder name (pre-phase); `apps/renderer` has no build output in-repo (vitest-transformed only) | None — verified: root `tsconfig.json:3-31` references no SPA; `apps/app-builder` is new and needs no migration. |

**Nothing found in category:** Live service config, OS-registered state, build artifacts — each explicitly verified as above, not skipped.

## Common Pitfalls

### Pitfall 1: Importing `@formio/js` in Node context
**What goes wrong:** `import('@formio/js')` (or a static import) in any vitest/API/worker file throws `document is not defined` — verified by execution this session.
**Why it happens:** FormIO touches DOM globals at module scope.
**How to avoid:** Pattern 1 — dynamic import inside a browser-only entry, guarded by a DOM check. Keep FormIO-touching code in files vitest never imports into node-environment specs (or mock the dynamic import in specs).
**Warning signs:** any spec failing with `ReferenceError: document is not defined`; any `apps/api` or `packages/*` file importing `@formio/js`.

### Pitfall 2: FormIO 5.x breaking changes applied to 4.x-era assumptions
**What goes wrong:** Custom validation or template code written against 4.x silently breaks: `component.error` (single string) is now `component.errors` (array — read `.errors[0].message`); `EditGrid.validateRows` now returns an **array** of errors, not a boolean (`isValid = validateRow(...).length === 0`); errors are populated even when not visible; **Bootstrap 5 is the default template** (Bootstrap-4-era templates need porting — this is S1's core question); templates moved to a separate repo and `bootstrap` is now a direct dependency.
**Why it happens:** most FormIO docs/examples online are still 4.x (5.x has *fewer* weekly downloads — 52K vs 57K — per STACK §9.4).
**How to avoid:** S1 spike verifies all four behaviors on the pinned 5.6.1 before any builder code is written; code examples in this document use the 5.x shapes.
**Warning signs:** `undefined` where an error string was expected; `validateRows() === true` always falsey-checking an array.

### Pitfall 3: Chasing FormIO-internal undo/redo
**What goes wrong:** Attempting BLD-04 via `builder.instance.*` monkey-patches or per-component interception — undocumented internals that break on patch bumps and were the reason the prior session grepped the package: there is no builder undo/redo API in 5.6.1.
**Why it happens:** 4.x-era community answers suggest instance patching (formio.js issue #3625).
**How to avoid:** Pattern 2 — debounced `builder.schema` snapshots on the `change` event; `builder.setForm(snapshot)` to restore. Bounded 50-entry ring buffer.
**Warning signs:** any import of `FormBuilder` internals beyond the documented instance; tests that patch `builder.instance`.

### Pitfall 4: React ↔ FormIO DOM ownership collision
**What goes wrong:** React re-renders a container whose children FormIO created — reconciliation removes/rewrites FormIO's DOM, corrupting builder state with no error.
**Why it happens:** FormIO is imperative DOM; React is declarative reconciliation. Both want to own the same subtree.
**How to avoid:** mount the builder in a ref'd `<div>` treated as a **leaf** — React never renders children inside it; pass updates only through `builder.setForm()`/builder API calls in effects.
**Warning signs:** builder UI freezing after a React state change; `MutationObserver` churn in devtools.

### Pitfall 5: Session cookie misconfiguration (D-101)
**What goes wrong:** A session cookie without `__Host-` prefix, `Secure`, or `SameSite=Strict` — or a token readable by the SPA — re-opens the XSS/CSRF surface D-101 closes.
**Why it happens:** cookie attribute defaults are permissive; frameworks emit `Lax` by default.
**How to avoid:** issue `Set-Cookie: __Host-<name>=<opaque-id>; Path=/; HttpOnly; Secure; SameSite=Strict` from the API; verify in an E2E test that asserts all five attributes; CSRF double-submit/origin check on state-changing calls (D-101's second layer).
**Warning signs:** any `document.cookie` read in the SPA; any session store keyed by a value the SPA can read.

### Pitfall 6: Skipping the `acr`/`amr` MFA check (D-102)
**What goes wrong:** "Trust the IdP" — completing PKCE without verifying authentication strength lets an IdP configured for step-up MFA log in a password-only session.
**Why it happens:** the OIDC flow succeeds regardless of authentication level unless claims are inspected.
**How to avoid:** at the callback, parse `acr`/`amr` from the ID token and refuse non-MFA-strong logins with a named error (`AUTH_MFA_REQUIRED`); the acceptable values are IdP-specific — confirm against the enterprise IdP in S3 (Open Question 1).
**Warning signs:** a login test that passes with MFA disabled at the IdP.

### Pitfall 7: Builder writes without audit transitions (D-86)
**What goes wrong:** Definition changes bypass `AuditRepository.append` — "who changed what, when" (Phase 8's compliance question) becomes unanswerable.
**Why it happens:** CRUD endpoints naturally do silent updates.
**How to avoid:** every definition mutation is an audited transition (append with `previous_state`/`new_state` — the `AuditEntry` shape, `audit.repository.ts:1-11`); publish/deprecate/archive/transfer are first-class service methods, not field writes.
**Warning signs:** a repository method that `$set`s lifecycle fields without an accompanying `append`.

### Pitfall 8: Publish gate ordering (APP-07/APP-08)
**What goes wrong:** Publishing without the dry-run lets a new app's intent labels steal routing share (>5-point drop for an existing app goes undetected); a description collision ships two indistinguishable apps.
**Why it happens:** the gate is a side concern at the end of the wizard.
**How to avoid:** the publish endpoint executes the gate **before** any state change (dry-run through the real routing machinery, read-only), blocks with a specific error naming the affected app and the share delta; collision check compares the new description against published apps' descriptions. Both are planner-owned mechanisms (CONTEXT discretion) — behaviour is fixed by APP-07/APP-08.
**Warning signs:** a publish test that doesn't assert an existing app's `routing_share` is unchanged after a blocked publish.

### Pitfall 9: `routing_share{app_id}` measured wrong (OBS-05)
**What goes wrong:** Computing share from a single app's counter instead of across the labelled intent set — theft is only detectable as a *distribution* over apps sharing an intent.
**Why it happens:** the metric name suggests per-app data, but the signal is relative.
**How to avoid:** the instrument records per-intent routing outcomes; `routing_share{app_id}` = that app's share of its intent set's routings, exported via the OTel metrics API to the single Prometheus path (OBS-01). The publish dry-run consumes the same computation (APP-07's 5-point rule).
**Warning signs:** a metric that can only go up; a dry-run that doesn't name the affected app.

### Pitfall 10: Exporting the full submission payload (D-111)
**What goes wrong:** A raw full-payload CSV dump exports PII under no discipline — D-111 explicitly forbids it ("PII sits under the same allowlist discipline as logs (D-43/W-22)").
**Why it happens:** the easy export is `JSON.stringify` of the stored document.
**How to avoid:** project exactly the viewer's visible columns (projected status, app/form, timestamps, downstream ref, safe reason) through a field allowlist **before** serialization — the same discipline as the pino log serializers (STACK §6.2).
**Warning signs:** an export test without a PII-field assertion; any `submission.data` spread into a CSV row.

### Pitfall 11: `csv-parse` is a parser, not a writer (D-111)
**What goes wrong:** D-111 says "CSV via `csv-parse`" — but `csv-parse` only *parses* CSV. Writing the export with it is impossible; hand-rolling the writer risks quoting bugs.
**Why it happens:** the locked decision names the family, not the writer.
**How to avoid:** `csv-stringify` 6.9.0 — the writer in the same repo/family (`adaltas/node-csv`, MIT), already legitimacy-gated in this research. Flagged for planner confirmation (Open Question 5); if the planner insists on `csv-parse`-only, the export must be a deliberate hand-rolled writer with escaping tests.
**Warning signs:** an export implementation with manual `","` joins.

### Pitfall 12: TypeScript 7.x creeping into the new SPA
**What goes wrong:** `npm install` without the TS pin pulls typescript 7.0.2 → hard `ERESOLVE` from `typescript-eslint@8.71.0` (peer `>=4.8.4 <6.1.0`, not optional) and a two-compiler tree via `@nestjs/cli`'s nested `~6.0.2`.
**Why it happens:** npm `latest` for TypeScript is 7.0.2; the repo pins 6.0.3.
**How to avoid:** the pin is already in the root `package.json:57` (`"typescript": "6.0.3"`) with the lockfile committed — new SPA devDeps must not re-declare TypeScript; verify with the STACK §11.1 two-step (`npm ci` on a clean tree).
**Warning signs:** a `package.json` diff touching the TypeScript version.

### Pitfall 13: Version drift from STACK.md
**What goes wrong:** the STACK.md §14 ledger now records vite 8.3.4 / `@vitejs/plugin-react` 6.1.2 / `@playwright/test` 1.64.0 (updated 2026-10-11, superseding the stale 8.3.2 / 6.1.1 / 1.63.0). Copying any older number leaves the lockfile one patch behind on day one.
**Why it happens:** STACK.md is a point-in-time verification (2026-10-01).
**How to avoid:** pin the versions in the Installation block above (all `npm view`-verified 2026-10-11); keep `@formio/js` at **5.6.1** (repo pin, installed) even though npm `latest` is 5.7.0 — the spike verifies the pinned version.
**Warning signs:** an install command without `@version` suffixes.

### Pitfall 14: Treating the mockup as a spec
**What goes wrong:** The mockup decides IA, tokens, and copy — but behavior comes from `REQUIREMENTS.md` and the phase's `must_haves`; where they conflict, the requirement wins (AGENTS.md: "The mockup is not a spec").
**Why it happens:** the mockup is complete and self-consistent, so it reads like a spec.
**How to avoid:** reuse the mockup's tokens (`--accent:#0f9d8f`, Space Grotesk/IBM Plex — `prototypes/mockup.html:47-84`) and page structure verbatim; derive acceptance from the requirement IDs. Where the mockup's implied data shape disagrees with a frozen contract (D-21, D-73), **the contract wins and the mockup is wrong** — say so.
**Warning signs:** a UI decision justified with "the mockup shows it" against a frozen contract.

## Code Examples

### 1. FormIO builder mount in React (form designer — Pattern 1 + 2 + 4 combined)

```typescript
// apps/app-builder/src/form-designer/FormioBuilderField.tsx
// Browser-only module — vitest node environment must never import this.
import { useEffect, useRef } from 'react';

export function FormioBuilderField({
  schema, onChange,
}: { schema: unknown; onChange: (next: unknown) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const builderRef = useRef<{ setForm: (f: unknown) => Promise<void>; on: (ev: string, cb: (f: unknown) => void) => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Pattern 1: guarded dynamic import — @formio/js is DOM-dependent
      if (!containerRef.current) return;
      const { Formio } = await import('@formio/js');
      const builder = await Formio.builder(containerRef.current, schema ?? {}, {});
      builderRef.current = builder;
      builder.on('change', (form) => { if (!cancelled) onChange(form); });
    })();
    return () => { cancelled = true; /* builder.destroy() if exposed */ };
  }, []); // mount once — React never re-renders inside the FormIO container

  return <div ref={containerRef} />;
}
```

### 2. Snapshot undo/redo store (BLD-04 — Pattern 2)

```typescript
// apps/app-builder/src/form-designer/undoHistory.ts
const MAX_HISTORY = 50; // BLD-04: undo/redo over the last 50 actions

export class SchemaHistory {
  private past: unknown[] = [];
  private future: unknown[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Debounced capture — one entry per change burst, not per keystroke. */
  capture(schema: unknown): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.past.push(structuredClone(schema));
      if (this.past.length > MAX_HISTORY) this.past.shift();
      this.future = [];
    }, 300);
  }

  canUndo() { return this.past.length > 0; }
  canRedo() { return this.future.length > 0; }

  /** Returns the snapshot to restore via builder.setForm(snapshot). */
  undo(current: unknown): unknown | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(structuredClone(current));
    return prev;
  }

  redo(current: unknown): unknown | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(structuredClone(current));
    return next;
  }
}
// Restore path (in the designer component):
// const snap = history.undo(builder.schema); if (snap) await builder.setForm(snap);
```

### 3. OIDC session endpoints (D-101/D-102/D-104 — Pattern 4)

```typescript
// apps/api/src/auth/auth.controller.ts (shape — openid-client 6.8.8 v6 API)
// GET /auth/oidc/begin
//   1. create/find the pre-login Redis session (opaque id, TTL = PKCE window)
//   2. Set-Cookie __Host-akane_sid=<opaque-id>; Path=/; HttpOnly; Secure; SameSite=Strict
//   3. stash { code_verifier, state } in the Redis session record
//   4. 302 → oidcClient.buildAuthorizationUrl(config, { redirect_uri, scope, code_challenge, code_challenge_method: 'S256', state })
//
// GET /auth/oidc/callback
//   1. read the pre-login session by cookie; fail closed if absent (CSRF: state mismatch)
//   2. tokens = await oidcClient.authorizationCodeGrant(config, currentUrl,
//        { pkceCodeVerifier, expectedState })
//   3. claims = tokens.id_token.claims(); if (!isMfaStrong(claims.acr, claims.amr))
//        → 403 AUTH_MFA_REQUIRED            // D-102
//   4. user = await autoProvision(claims.sub, claims.email)  // D-104 — creates real_user
//   5. promote the session: store { oidcSub: claims.sub, realUserId, idpSessionExp,
//        mfaAt: now } in Redis; TTL tracks the IdP session (D-103)
//   6. 302 → / (the SPA learns nothing it can exfiltrate — cookie only)
```

### 4. Connector request document (D-98/D-99 — "full definition minus the secret")

```typescript
// packages/domain/src/builder/connector-request/connector-request.document.ts
// Shape mirrors ConnectorSeed (packages/cli/connector.ts:11-22) minus the secret.
// VERIFIED seed shape (config/connectors/redmine.dev.json:1-27):
// { connector_ref, connector_id, name, base_url, credential_ref, timeout_ms,
//   retries, rate_limit, mapping, taxonomy }
export interface ConnectorRequestDocument {
  readonly request_id: string;            // uuid — crypto.randomUUID() (stdlib)
  readonly app_id: string;
  readonly requested_by: string;          // real_user_id
  // D-99: the full definition minus the secret — exactly what the operator seeds:
  readonly connector_id: string;
  readonly name: string;
  readonly base_url: string;
  readonly timeout_ms?: number;
  readonly retries?: number;
  readonly rate_limit?: Record<string, unknown>;
  readonly mapping?: Record<string, unknown>;
  readonly taxonomy?: Record<string, unknown>;
  // D-98: pending → provisioned | rejected (+ reason)
  readonly state: 'pending' | 'provisioned' | 'rejected';
  readonly reason?: string;
  readonly credential_ref?: string;       // set by the operator at provision time
  readonly requestedAt: Date;
  readonly resolvedAt?: Date;
}
// Every transition appends an AUD-01 event (D-98):
// audit.append({ timestamp, actor, action: 'connector_request.provisioned',
//   target: request_id, previous_state: 'pending', new_state: 'provisioned' })
// Operator side (packages/cli/provision.ts extension, D-97):
//   1. read pending request → 2. operator supplies credential value
//   → 3. credsRepo.upsert(credential_ref, headerName, plaintext)  // VERIFIED:
//      packages/domain/src/connectors/data-access/connector-credentials.repository.ts:36-52
//      — encrypts via encryptSecret (AES-256-GCM envelope; D-100 guard applies)
//   → 4. registry.register(...) via the existing upsertConnector seam
//   → 5. request.state = 'provisioned' + AUD-01 append
```

### 5. Publish gate composition (APP-07/APP-08 — planner-owned mechanism, fixed behaviour)

```typescript
// packages/domain/src/builder/publish-gate.service.ts
export interface PublishGateResult {
  readonly allowed: boolean;
  readonly shareDrops: ReadonlyArray<{ app_id: string; points: number }>; // APP-07
  readonly descriptionCollisionWith: string | null;                        // APP-08
  readonly changeSummary: ReadonlyArray<{ field: string; from: string; to: string }>; // BLD-06
}

// Behaviour (fixed by requirements):
// 1. Dry-run: execute the app's labelled intent set through the REAL routing
//    machinery (Phase-3 RoutingOrchestrator / PublishedAppLoader), read-only.
// 2. Compute routing_share{app_id} for every app sharing those intents (OBS-05
//    computation — the same one the metric exports).
// 3. Block if any existing app's share drops by more than 5 points (APP-07):
//    allowed = shareDrops.every(d => d.points <= 5)
// 4. Block if the description collides with an existing published app's (APP-08).
// 5. The change summary (BLD-06) is built from the same comparison the dry-run
//    already computed — status, version, form versions, indexes, triggers
//    (the mockup's publish modal rows, prototypes/mockup.html:1580-1585).
```

### 6. `routing_share{app_id}` instrument (OBS-05 — the metric does not exist today)

```typescript
// packages/domain/src/builder/routing-share/routing-share.metrics.ts
import { Meter, ObservableGauge } from '@opentelemetry/api'; // already a dep (1.9.1)
// Single metrics path (OBS-01): OTel metrics API → exporter-prometheus scrape.
// routing_share{app_id} = app's routings / total routings across its intent set,
// computed over the labelled intent set — a distribution, not a counter (Pitfall 9).
// The publish dry-run (APP-07) consumes the same per-intent outcome records,
// so the gate and the exported metric cannot disagree.
```

### 7. Boundary-graph extension (Pattern 6 — explicit, reviewed config change)

```javascript
// tooling/boundaries.config.mjs — extend the reserved builder element
builder: Object.freeze([
  'platform',
  'kernel',
  'registry',
  'forms',
  'authz',
  'connectors',
  'audit',
  // Phase 6 additions (builder domain imports these):
  'identity',  // D-104 auto-provision
  'links',     // G-11 saved-query write (D-73 shape)
  'contract',  // builder-facing shapes
]),
// Reminder (boundaries.config.mjs:14-23): policies are LAST-MATCH-WINS;
// permissive edges must stay before R1/R2/R3 or the restrictions are overwritten.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| FormIO 4.x (`formiojs`) | `@formio/js` 5.x | 5.0 (package rename); 4.x in maintenance mode | Namespace change; builder included in OSS build; Bootstrap 5 default; `component.errors` array; `EditGrid.validateRows` returns array |
| FormIO builder via CDN (`cdn.form.io/js/formio.full.min.js`) | npm bundle (`@formio/js`) | current | SRI-pinning a CDN breaks NFR-SEC-3; bundle from npm (STACK §9.2) |
| `Issuer`/`Client` class API (openid-client v5) | flat `client.*` namespace (v6) | v6 (2026) | `client.discovery()`, `client.buildAuthorizationUrl()`, `client.authorizationCodeGrant()` — the v5 `generators`/`callback` API shape is gone |
| `passport` strategies for OIDC | `openid-client` directly | current | `passport` first published 2023-11-27, wraps the `jsonwebtoken` we rejected; `openid-client` depends on the `jose` already chosen |
| `class-validator`/`class-transformer` | Zod 4 via Standard Schema | NestJS 12 | One validation dialect; class-transformer last published 2021-11-22 |
| NestJS 12 scaffold default: oxlint | ESLint + `eslint-plugin-boundaries` | this repo, now | Boundary-violation-fails-the-build requires the ESLint-only plugin (STACK §3.5/§10.2) |
| prom-client | OTel metrics API → exporter-prometheus | prom-client deprecated (15.1.3) | One metrics path (OBS-01) — `routing_share` rides it |

**Deprecated/outdated:**
- `formiojs@4.x`: official maintenance mode — "No new features will be added to version 4.x. Only bug fixes and security updates will be provided." (STACK §9.2). Fallback only, as an explicit decision.
- `@nestjs/observe`: vendor APM, no OTLP exporter — rejected (STACK §6.4).
- `botframework-sdk` / Bot Framework SDK: retired, support ended 2025-12-31 (irrelevant to Phase 6; Teams is Phase 7).
- `ua-parser-js`: AGPL-3.0-or-later — hard do-not-use (STACK §12).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | FormIO 5.6.1 builder API (`Formio.builder(element, [form], [options])` → `Promise<FormBuilder>`, `builder.schema`, `builder.setForm()`, `change`/`addComponent`/`removeComponent`/`updateComponent`/`saveComponent`/`builderFormValidityChange` events, `builder` option groups with `custom` pre-defined components carrying `schema`) | Standard Stack, Patterns 1–2, Code Examples 1–2 | MEDIUM — verified against official Form.io docs and the 5.5.2 `.d.ts`, but docs may trail the pinned 5.6.1; the S1 spike is the falsification point. A shape difference changes the form-designer tasks, not the architecture. |
| A2 | The v6 `openid-client` flat API (`client.discovery`, `randomPKCECodeVerifier`, `calculatePKCECodeChallenge`, `buildAuthorizationUrl`, `authorizationCodeGrant`) is the correct 6.8.8 surface | Pattern 4, Code Example 3 | LOW — verified against the official v6 README (github.com/panva/openid-client/blob/v6.x/README.md) this session. |
| A3 | Acceptable `acr`/`amr` values for "MFA-strong" are IdP-specific and unknown until the enterprise IdP is known (S3) | Pitfall 6, Security Domain | MEDIUM — wrong values either block all logins or admit non-MFA logins; confirm in Phase-1-style discovery (Open Question 1). |
| A4 | `csv-stringify` 6.9.0 is the correct writer for D-111's export (D-111 names `csv-parse`, a parser) | Standard Stack, Pitfall 11 | LOW–MEDIUM — if the planner reads D-111 as mandating `csv-parse` only, a hand-rolled writer with escaping tests is the alternative; either way the export must be tested against embedded commas/quotes/newlines. |
| A5 | Hand-rolled session middleware over ioredis (~120 lines) is preferable to `express-session` + `connect-redis` for D-101's bespoke semantics | Don't Hand-Roll #5 | MEDIUM — a judgment call consistent with the repo's throttler-storage precedent; if session semantics grow (rotation, revocation lists), switch to the standard stack. Reversible. |
| A6 | React 19 + FormIO 5.6.1 coexistence via container-as-leaf mounting works without reconciliation conflicts | Pattern 4 (anti-pattern), Code Example 1 | MEDIUM — standard practice, not yet exercised in this repo (no React today); S1 spike is the falsification point. |
| A7 | Root `tsconfig.json` not referencing `apps/renderer` (and therefore `apps/app-builder`) is intentional — SPAs are vitest-transformed only and need their own `tsconfig.json` | Architecture Patterns, Project Structure | LOW — verified by reading `tsconfig.json:3-31`; the SPA tsconfig (DOM lib, jsx) is a Wave-0 gap. |
| A8 | Playwright 1.64.0 (not STACK's 1.63.0) is the version to pin | Standard Stack | LOW — registry-verified 2026-10-11; STACK.md is one patch stale. |

## Open Questions (RESOLVED)

> Every question below carries an inline RESOLVED marker citing the plan that adopted its recommendation. The phase plans are the adopting record; this section is closed.

1. **Which corporate IdP, and does it support OIDC with `acr`/`amr`?**
   - What we know: OIDC auth-code+PKCE is locked (D-101); MFA verification is claim-based (D-102). STACK S3 records that whether SAML is a v1 blocker "depends entirely on which IdPs the target enterprise uses."
   - What's unclear: the IdP's `acr` values for MFA, `supportsPKCE()` result, and whether silent token exchange (D-103) is supported (refresh-token lifetime vs IdP session).
   - Recommendation: ask in planning ("Which IdP do you use, and does it support OIDC?"); until then, implement against a Keycloak testcontainer and keep the acceptable-`acr` set in one named constant. SAML stays deferred (STACK §8.6).
   - RESOLVED: adopted by 06-02-PLAN.md — the acceptable `acr`/`amr` set is frozen in ONE named constant (`ACCEPTABLE_ACR_VALUES` in `apps/api/src/auth/oidc.service.ts`) and every login is gated on it (D-102); tests run against the in-spec OIDC stub issuer (`apps/api/src/auth/oidc-issuer.stub.ts`) with a Keycloak-style `mfa`/`phr` pair as the test default. SAML stays deferred (STACK §8.6); the real IdP inventory remains a Phase-1 discovery item (STACK S3).

2. **Exact curated tag set (D-107)?**
   - What we know: use-case + department axes, shared by templates and user apps, filterable on the Apps page.
   - What's unclear: the specific tags.
   - Recommendation: planner derives the seed list from D-106's six domains + the mockup's tag UI; frozen in a contract file so templates and apps share one vocabulary.
   - RESOLVED: adopted by 06-04-PLAN.md — the curated platform tag set is frozen as a Zod enum in `packages/domain/src/builder/template/tag-set.ts` (use-case + department axes per D-107), shared by the template seeds and user apps; free-form typing is rejected.

3. **Per-template catalogue contents (D-106)?**
   - What we know: six core domains (absence/leave, travel, procurement, asset, HR request, ticketing) mostly internal-only + 1–2 external/hybrid examples.
   - What's unclear: fields/roles per template.
   - Recommendation: planner drafts the ~10 seed files at plan time from the mockup's app shapes; each is a D-31 seed with an idempotent loader test.
   - RESOLVED: adopted by 06-04-PLAN.md — ten D-31 seed files land in `packages/domain/src/builder/template/seeds/` covering D-106's domains: leave-request, travel-request, procurement-request, asset-request, hr-request (internal-only), it-helpdesk-ticket, facilities-request, expense-report, plus redmine-issue and crm-contact (the 1–2 external/hybrid examples); the loader is idempotent via a content-hash guard per template_id.

4. **`routing_share` computation window (APP-07/OBS-05)?**
   - What we know: the drop threshold is 5 points over "the labelled intent set"; the mechanism is planner-owned.
   - What's unclear: the time window the share is computed over (rolling 24h? since publish?).
   - Recommendation: planner picks the window that the dry-run can compute deterministically from routing outcome records; document it beside the metric.
   - RESOLVED: adopted by 06-05-PLAN.md — the share is computed from the app's own routing-outcome records (`packages/domain/src/builder/routing-share/routing-outcome.repository.ts`) over the window the dry-run computes deterministically; the window is documented beside the metric in `routing-share.computer.ts` and exported via `routing-share.metrics.ts` (OBS-05).

5. **D-111's CSV writer — `csv-stringify` or a tested hand-rolled writer?**
   - What we know: D-111 says "CSV via `csv-parse`"; `csv-parse` is a parser.
   - What's unclear: whether the locked decision intends the family or literally that package.
   - Recommendation: `csv-stringify` 6.9.0 (same repo/family, MIT, gated in this research). If the user insists on `csv-parse`-only, plan a hand-rolled writer with escaping tests as a Wave-0 task.
   - RESOLVED: adopted by 06-06-PLAN.md — `csv-stringify` 6.9.0 is the writer (same `adaltas/node-csv` family and repo as `csv-parse`, MIT, legitimacy-gated); the export service is tested against embedded commas/quotes/newlines (`apps/api/src/submissions/submission-export.service.spec.ts`). D-111's wording (csv-parse named, writer intended) is the recorded, accepted deviation.

6. **`connector_requests` exact schema (D-99 discretion)?**
   - What we know: full connector definition minus the secret; states `pending → provisioned | rejected (+reason)`; AUD-01 per transition.
   - What's unclear: operator-facing extras (e.g., test-connection result, operator notes).
   - Recommendation: Code Example 4's document shape is the starting point; planner extends with the operator fields the CLI seam needs.
   - RESOLVED: adopted by 06-06-PLAN.md — `packages/domain/src/builder/connector-request/connector-request.document.ts` carries the full connector definition minus the secret (type, base_url, auth mode, operation list, idempotency expectation), states `pending → provisioned | rejected (+reason)`, and appends AUD-01 per transition.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | all | ✓ | 24.15.0 (engines `>=24 <25`, `package.json:7-9`) | — |
| npm (workspaces) | all | ✓ | 11.12.1 | — |
| Docker | testcontainers (Mongo 8.0.x, Redis ≥8.2) | ✓ | daemon running | — |
| Local Redis server | dev session | ✗ | — | testcontainers/redis (repo standard) |
| Local MongoDB | dev session | ✗ | — | testcontainers/mongodb (repo standard) |
| Vitest | unit/integration | ✓ | ^5.0.3 (`node_modules/.bin/vitest`) | — |
| ESLint + tsc | lint/build | ✓ | eslint 10.11.0, tsc (typescript 6.0.3) | — |
| Playwright browsers | E2E (SPA) | ✗ | `@playwright/test` not yet installed | `npx playwright install chromium` — Wave-0 task |
| React/Vite toolchain | the SPA | ✗ | not in `package.json` | install step (Wave 0) — pins in Standard Stack |
| Corporate OIDC IdP | BLD-12/IDN-08 | ✗ | unknown (Open Question 1) | Keycloak testcontainer or a stub issuer for tests; acceptable-`acr` set in one constant |
| `@formio/js` | form engine | ✓ | 5.6.1 installed (`node_modules` verified) | `formiojs@4.21.7` — S1 fallback, explicit decision only |

**Missing dependencies with no fallback:** none that block execution — every missing item has a repo-standard fallback or is a Wave-0 install.
**Missing dependencies with fallback:** local Redis/MongoDB (testcontainers), Playwright browsers (install step), corporate IdP (Keycloak/stub), React/Vite (install step).

## Validation Architecture

> `workflow.nyquist_validation` is `true` (`.planning/config.json:24`) — this section is mandatory. `security_enforcement` is `true` (`config.json:48`), ASVS level 1 (`config.json:49`).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.3 (unit/integration, node env) + `@playwright/test` 1.64.0 (SPA E2E) |
| Config file | `vitest.config.mts` (root; aliases `@akane/*` → `packages/*/src`, `include: packages/**/*.spec.ts, apps/**/*.spec.ts, tooling/**/*.spec.ts`, `setupFiles: ./test/setup-env.ts`) [VERIFIED: `vitest.config.mts:7-37`] |
| Quick run command | `npx vitest run packages/domain/src/builder apps/api/src/app-builder` |
| Full suite command | `npm test` (= `vitest run`) |
| E2E command | `npx playwright test` (Wave 0: config + `npx playwright install chromium`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BLD-01 | 5-step wizard creates a draft at step 1 | E2E | `npx playwright test apps/app-builder/e2e/wizard.spec.ts` | ❌ Wave 0 |
| BLD-02 | Tabbed editor edits all 12 sections | E2E + unit | `npx vitest run packages/domain/src/builder` + Playwright | ❌ Wave 0 |
| BLD-03 | Custom roles with arbitrary permission sets; assign by email autocomplete | unit + E2E | `npx vitest run packages/domain/src/builder/role-assignments.spec.ts` | ❌ Wave 0 |
| BLD-04 | Drag-and-drop design + 50-action undo/redo | E2E (drag) + unit (history) | `npx playwright test form-designer.spec.ts` + `npx vitest run undoHistory.spec.ts` | ❌ Wave 0 |
| BLD-05 | Visual form-field → connector-field mapping | unit + E2E | `npx vitest run field-mapping.spec.ts` | ❌ Wave 0 |
| BLD-06 | Publish confirmation summarizes every change; keyboard shortcut saves | E2E | `npx playwright test publish.spec.ts` | ❌ Wave 0 |
| BLD-07 | Inline, specific, actionable errors | unit + E2E | `npx vitest run error-mapping.spec.ts` | ❌ Wave 0 |
| BLD-08 | Submission viewer: filters, detail, export | unit + E2E | `npx vitest run apps/api/src/submissions` + Playwright | ❌ Wave 0 |
| BLD-09 | Tablet usability + loading skeletons | E2E (viewport) | `npx playwright test --project=tablet` | ❌ Wave 0 |
| BLD-10 | Connector request → operator provision → resume | integration (testcontainers) | `npx vitest run connector-request.flow.spec.ts` | ❌ Wave 0 |
| BLD-11 | Delegated workflow manager operates without ownership | unit | `npx vitest run delegation.rules.spec.ts` | ❌ Wave 0 |
| BLD-12 | OIDC SSO + MFA login; owner-scoped management | integration + E2E | `npx vitest run auth.session.spec.ts` + Playwright | ❌ Wave 0 |
| APP-03 | Versioned definitions; 20 retained; rollback | unit | `npx vitest run app-definition.versions.spec.ts` | ❌ Wave 0 |
| APP-05 | Deprecated: functional, notice shown, no new triggers | unit | `npx vitest run lifecycle.deprecate.spec.ts` | ❌ Wave 0 |
| APP-06 | Archived: no new submissions; view links resolve | integration | `npx vitest run lifecycle.archive.spec.ts` | ❌ Wave 0 |
| APP-07 | Dry-run blocks >5-point routing-share drop | unit + integration | `npx vitest run publish-gate.spec.ts` | ❌ Wave 0 |
| APP-08 | Description collision rejected at publish | unit | `npx vitest run publish-gate.spec.ts` (same file) | ❌ Wave 0 |
| APP-09 | ~10 template seeds; tag filter; fork is a snapshot | unit + integration | `npx vitest run templates.seed.spec.ts` | ❌ Wave 0 |
| FRM-05 | Conditional show/hide + validation rules authorable | E2E (FormIO) | `npx playwright test form-designer.spec.ts` | ❌ Wave 0 |
| FRM-09 | Draft preview with sandbox submissions | E2E | `npx playwright test form-preview.spec.ts` | ❌ Wave 0 |
| IDN-05 | OTP: 10-min expiry, 3 attempts, 30-min lockout | integration (Redis) | `npx vitest run otp.state-machine.spec.ts` | ❌ Wave 0 |
| IDN-08 | SSO identity mapped to real_user_id without OTP | integration | `npx vitest run users/sso-mapping.spec.ts` | ❌ Wave 0 |
| ACL-05 | Transfer requires global-admin approval; 7-day auto-cancel | integration + scheduler | `npx vitest run transfer-approval.spec.ts` | ❌ Wave 0 |
| ACL-10 | Owner manages roles except ownership transfer | unit | `npx vitest run role-permissions.spec.ts` | ❌ Wave 0 |
| OBS-05 | `routing_share{app_id}` exported | unit | `npx vitest run routing-share.metrics.spec.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched paths>` (quick, <30 s)
- **Per wave merge:** `npm test` (full suite) + `npm run lint` (boundary violations fail the build)
- **Phase gate:** full suite green + Playwright E2E green + S1 spike artifacts committed before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `apps/app-builder/{package.json, tsconfig.json (DOM lib + jsx), vite.config.ts, index.html}` — the SPA does not exist; root `tsconfig.json:3-31` deliberately does not reference SPAs
- [ ] `apps/app-builder/e2e/` + `playwright.config.ts` + `npx playwright install chromium`
- [ ] Install: `react@19.3.0 react-dom@19.3.0`, `-D vite@8.3.4 @vitejs/plugin-react@6.1.2 @playwright/test@1.64.0`, `openid-client@6.8.8 @casl/ability@7.0.1 csv-stringify@6.9.0`
- [ ] `tooling/boundaries.config.mjs` — extend `ALLOWED_EDGES.builder` with `identity`, `links`, `contract` (Pattern 6)
- [ ] `packages/domain/src/builder/` skeleton + `apps/api/src/{auth,app-builder,submissions,users}/` module skeletons mirroring `read.module.ts` factory providers
- [ ] G-11 replacement: repository-backed `SavedQueryLookup` impl + seed backfill migration + its spec (replaces `SeedSavedQueryLookup` wiring at `read.module.ts:188-194`)
- [ ] IdP test double: Keycloak testcontainer or stub issuer for auth integration tests (Open Question 1)

*(No existing test files cover Phase 6 requirements — all rows are Wave 0.)*

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1`, `security_block_on: high` (`.planning/config.json:48-50`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | OIDC authorization-code + PKCE via `openid-client` 6.8.8 (D-101); MFA via IdP `acr`/`amr` claim verification on every login (D-102) |
| V3 Session Management | yes | Server-side Redis session, httpOnly `Secure` `SameSite=Strict` `__Host-` cookie; lifetime tracks IdP session (D-103); SPA holds no token (XSS-exfiltration-resistant by construction) |
| V4 Access Control | yes | `@casl/ability` 7.0.1 per-app rules; BLD-12 owner/admin scoping; BLD-11 delegation; ACL-05 transfer approval; ACL-10 ownership-transfer carve-out; no superuser bypass for app-level permissions (ACL-11 carries forward) |
| V5 Input Validation | yes | Zod 4.6.5 for all builder DTOs, request shapes, and publish-gate inputs (Standard Schema); FormIO schema validation for form designs |
| V6 Cryptography | yes — reuse only | AES-256-GCM envelope (`packages/platform/src/crypto/envelope.ts`) with verified auth tag and fresh 12-byte nonce; `assertKeyProviderAllowed` fail-closed production guard (D-100). **Never hand-roll crypto** — STACK §11: AES-256-GCM is Node stdlib, already implemented. |
| V7 Error Handling | yes | BLD-07: inline, specific, actionable errors; named boot failures (`READ_LINK_CONFIG_INVALID:` precedent) |
| V9 File/Resource Handling | yes | FormIO schema JSON only — no file upload surfaces in Phase 6 scope |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS exfiltration of the builder session | Information Disclosure | D-101: httpOnly cookie, SPA never holds a token; CSP on the SPA (`default-src 'self'; script-src 'self'` — FRM-07 precedent carries to the builder origin) |
| CSRF on state-changing builder calls | Tampering | `SameSite=Strict` + origin/double-submit check on state-changing calls (D-101); OIDC `state` parameter on the authorization request |
| Privilege escalation via `app_id` in path/body | Elevation of Privilege | Owner/admin check at the API on every app-scoped route (`@casl/ability`); `app_id` immutable after first publish (mockup-locked) |
| Non-MFA login at a step-up IdP | Spoofing | D-102: refuse logins whose `acr`/`amr` are not MFA-strong, with a named error |
| OTP brute-force (IDN-05) | Repudiation / DoS | 3 attempts then 30-minute lockout, counters in Redis (not memory) |
| Connector secret exposure in the request flow | Information Disclosure | D-97/D-99: the request carries the definition **minus the secret**; the operator fills the credential through the existing audited seam; envelope at rest (AES-256-GCM) |
| Production boot on a local key | Information Disclosure | D-100: `assertKeyProviderAllowed` throws `CRYPTO_KEY_PROVIDER_REQUIRED: production requires kms` — the builder path routes through the same guard [VERIFIED: `production-guard.ts:96-105`] |
| PII in logs/exports | Information Disclosure | D-43/D-111: field allowlist applied **before** serialisation (pino serializer discipline, STACK §6.2); export projects visible columns only |
| Template/seed injection | Tampering | D-105: templates are platform-owned D-31 seed files loaded by the idempotent audited loader — never user-uploaded |
| Audit-trail mutation | Repudiation | AUD-01: `AuditRepository` has no update/delete methods — append-only by construction [VERIFIED: `audit.repository.ts:13-33`] |
| Dependency supply chain (new SPA deps) | Tampering | Package Legitimacy Audit above; lockfile committed; CI dependency scanning (NFR-SEC-12); `ua-parser-js` (AGPL) excluded |

## Sources

### Primary (HIGH confidence)
- `github.com/panva/openid-client/blob/v6.x/README.md` — v6 flat-namespace API: `discovery`, `randomPKCECodeVerifier`, `calculatePKCECodeChallenge`, `buildAuthorizationUrl`, `authorizationCodeGrant`, `serverMetadata().supportsPKCE()` (fetched 2026-10-11)
- `help.form.io/dev/form-development/form-builder` — `Formio.builder(element, [form], [options])`, builder events (`change`, `addComponent`, `removeComponent`, `updateComponent`, `saveComponent`, `builderFormValidityChange`), `builder` option groups incl. `custom` pre-defined components with `schema`, `editForm` overrides (fetched 2026-10-11)
- `github.com/formio/formio.js` issues #2773 / #1985 — `builder.setForm()` and `builder.on('change', form => …)` usage confirmation
- npm registry (`npm view`) — all versions resolved 2026-10-11 (see Version verification)
- `gsd-tools query package-legitimacy check` — gate verdicts (2026-10-11)
- In-repo files read this session (line ranges cited inline): `apps/renderer/src/read/edit.ts:309-312`, `apps/renderer/src/read/view.browser.ts:143-149`, `tooling/boundaries.config.mjs:38-58,87-97,179-187`, `packages/domain/src/links/seed-saved-query.lookup.ts:1-53`, `packages/platform/src/crypto/{envelope,production-guard}.ts`, `packages/cli/connector.ts:11-22`, `packages/domain/src/connectors/data-access/connector-credentials.repository.ts:36-52`, `packages/domain/src/audit/audit.repository.ts:1-33`, `packages/domain/src/registry/app.repository.ts:3-33`, `packages/domain/src/identity/{identity.service,identity-mapping.repository,profile.repository}.ts`, `apps/api/src/read/read.module.ts:55-227`, `vitest.config.mts:7-37`, `tsconfig.json:3-31`, `package.json:7-59`, `prototypes/mockup.html:47-84,1578-1628`, `config/connectors/redmine.dev.json:1-27`, `.planning/config.json:24,48-50`
- `.planning/phases/06-self-service-app-builder/06-CONTEXT.md` — D-97..D-112 (copied verbatim into User Constraints)
- `.planning/REQUIREMENTS.md` — requirement bodies (BLD/APP/FRM/IDN/ACL/OBS)
- `.planning/ROADMAP.md:219-236` — Phase 6 block, success criteria, S1 spike
- `.planning/research/STACK.md` — §4.4, §5, §8.1-8.7, §9, §10, §11, §12 (the audited stack)

### Secondary (MEDIUM confidence)
- FormIO 5.x breaking changes (Changelog + help.form.io): `component.error` → `component.errors` array; `EditGrid.validateRows` returns array; errors populated when not visible; Bootstrap 5 default + templates in separate `formio/bootstrap` repo — consistent across multiple official sources; runtime impact on a real template is S1's empirical question
- WebSearch-confirmed: `@formio/js` 5.6.1 tarball contents (STACK §9.2, verified in the prior pass)

### Tertiary (LOW confidence)
- None — every recommendation is either tool-verified this session, cited from official documentation, or explicitly logged in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — every package version resolved against the npm registry this session; the FormIO builder API surface confirmed against official Form.io docs; the openid-client v6 API confirmed against the official v6 README; all in-repo reuse points read at specific line ranges.
- Architecture: **HIGH** — tier mapping follows the existing repo structure (API/Backend owns sessions, gates, queues; Browser owns the FormIO builder); boundary-graph facts read from `tooling/boundaries.config.mjs`; the SPA's out-of-graph status verified against `tsconfig.json`.
- Pitfalls: **HIGH** — the load-bearing ones (FormIO DOM import, 5.x breaking changes, no-undo-API, TS pin) were verified by execution or direct file inspection this session; the remainder derive from the frozen requirements.
- **MEDIUM overall for one dimension only:** the FormIO 5.6.1 *builder migration outcome* (Bootstrap-4-template port, React coexistence) — empirically resolved by spike S1, which blocks the phase by design.

**Research date:** 2026-10-11
**Valid until:** 2026-11-10 (30 days — stable stack; re-verify `@formio/js` if 5.7.0 adoption is considered)
