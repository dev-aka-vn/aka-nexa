# Phase 6: Self-Service App Builder - Context

**Gathered:** 2026-10-11
**Status:** Ready for planning

<domain>
## Phase Boundary

A department admin builds, secures, and publishes a working app end-to-end — without an
engineering ticket and without a platform admin's help. This phase delivers the **App Builder
admin console** (a new `apps/app-builder` web app): the 5-step create wizard, the tabbed
app editor (general, triggers, RBAC, forms, data routing, retention, lifecycle), drag-and-drop
form design, publish gating (routing dry-run, description collision), app lifecycle
(deprecate/archive/transfer), the submissions viewer + export, connector **request** (not
provisioning), the template gallery (APP-09), builder auth via OIDC SSO + MFA (BLD-12), plus
the identity (IDN-05/08), access-control (ACL-05/10) and routing-observability (OBS-05)
deliverables the ROADMAP assigns here.

**Not this phase:** connector *provisioning* (platform operator owns the secret), platform
Settings knobs (JEV chain, cache, circuit breaker), additional IM adapters (Phase 7), the
purge flow (Phase 8), notification/two-way sync. The frozen contracts from earlier phases
(the read-link claim set D-21, the saved-query record shape D-73, the connector seam D-89)
are **consumed, not changed** — but **G-11's seed stopgap is this phase's job to replace**
with a real store over builder-written app definitions.

</domain>

<decisions>
## Implementation Decisions

### Connector request & the FND-10 gate (BLD-10)
- **D-97:** The terminal state of "request a connector" is **`provisioned` by a platform
  operator**: the admin self-serves the entire connector instance *minus the secret* (type,
  base_url, auth mode, operation list, idempotency expectation); the request lands in a
  statused queue; a platform operator fills the credential through the existing audited seam;
  the admin flow resumes once provisioned. Full self-service *credential entry* is explicitly
  rejected — FND-10/W-24 stay authoritative (D-87). — **Reversibility:** costly — the request
  queue is a new authored surface; a later switch to full self-service rewires provisioning,
  not just the UI.
- **D-98:** Connector requests live in a **`connector_requests` collection**, states
  `pending → provisioned | rejected` (+ reason). The admin sees a status badge on the
  Connectors page and can cancel/retry while pending; every transition is an AUD-01 event. —
  **Reversibility:** reversible.
- **D-99:** A request carries the **full connector definition minus the secret** — the
  operator only fills the credential and validates the test connection. Field mapping stays in
  the app's Data-routing tab. "No platform admin creating the connector" must hold in
  substance, not just routing. — **Reversibility:** costly — the request shape is what the
  operator tooling consumes; changing what a request must carry changes that tooling too.
- **D-100:** The builder mirrors **D-87's credential posture exactly**: local/test credentials
  may be stored and a test connection run in non-production environments; a production boot
  still refuses real credentials until a KMS provider is configured. The gate is **not**
  relaxed for the builder. — **Reversibility:** reversible — unblocks wholesale when a KMS
  vendor is named.

### Builder auth — OIDC session & MFA (BLD-12, IDN-05, IDN-08)
- **D-101:** The builder session is **server-side, Redis-backed** (AD-9: services stateless,
  all session state in Redis), delivered as an **httpOnly, Secure, SameSite=Strict
  `__Host-` cookie**. OIDC authorization code + PKCE completes at an API endpoint; the React
  SPA never holds a token, so XSS cannot exfiltrate the session. CSRF is structurally blocked
  by SameSite plus an origin/double-submit check on state-changing calls. The OIDC subject is
  never minted into our own JWT (PII-in-JWT constraint). — **Reversibility:** one-way — the
  session shape is what the SPA auth client and the API session middleware both compile
  against; swapping to bearer later changes both ends and re-opens the XSS surface.
- **D-102:** MFA is enforced by **verifying the IdP's `acr`/`amr` claims on every builder
  login** — no homegrown MFA prompt; a login whose authentication level is not MFA-strong is
  refused. Plain "trust the IdP" (no claim check) is rejected. — **Reversibility:** reversible.
- **D-103:** Builder session lifetime **tracks the IdP session** — silent token exchange keeps
  the Redis session alive while the IdP session lives; a full re-login when it does not. No
  second, independently-configured expiry policy. — **Reversibility:** costly — a fixed policy
  later re-introduces a drift point between two expiry definitions.
- **D-104:** **Auto-provision on first SSO login** — a new subject creates its `real_user`
  keyed to the OIDC subject and can act (create/publish the apps it owns) on day one. No admin
  pre-mapping step for builder access. IDN-05's OTP path stays the *employee* self-onboarding
  route (chat-side), separate from builder access. — **Reversibility:** costly — mandating
  pre-mapping later changes provisioning and existing identities.

### Template gallery (APP-09)
- **D-105:** The ~10 template apps ship as **D-31 seed files** — idempotent, audited,
  platform-owned, loaded by the existing seed loader. "Use template" **forks** a copy into a
  user-owned draft; the template itself stays read-only platform content. Frontend-bundled
  catalogues rejected (invisible to the registry, un-audited). — **Reversibility:** costly —
  the fork/seed boundary is what BLD-02's editor and APP-03 versioning operate on.
- **D-106:** Template set covers the **core domains** — absence/leave, travel, procurement,
  asset, HR request, ticketing — mostly internal-only (usable immediately, no connector), plus
  **1–2 external/hybrid examples** that make the connector-request flow demonstrable. —
  **Reversibility:** reversible.
- **D-107:** Tags use a **curated platform tag set** (use-case + department) shared by
  templates and user apps, filterable on the Apps page; free-form typing is rejected to keep
  the catalogue coherent. — **Reversibility:** costly — adding free-form later leaves two tag
  universes in one filter.
- **D-108:** Forks are **snapshots** — no origin-reference, no auto-adoption, no diff-update
  pipeline; a later template update never touches an existing fork; APP-03 versioning governs
  the fork once it lives. — **Reversibility:** one-way — origin-tracking later requires
  migrating existing forks to carry provenance and building a merge path.

### Surfaces — mockup scope
- **D-109:** Phase 6 surface scope = **Apps (full editor), Submissions (viewer + export),
  Connectors (view + request queue), Users (IDN-08 mapping + ACL-05 transfer approval),
  Dashboard (read-only), Audit Log (read-only browse of AUD-01)**. **Settings (JEV chain,
  decision cache, circuit breaker) is deferred** as a stub route — platform-admin territory
  with no Phase-6 requirement. — **Reversibility:** costly — a scope cut; the shipped pages
  define the nav model (the mockup grid) a Settings page later slots into.
- **D-110:** Global-admin identity actions — **IDN-08 SSO mapping and ACL-05 ownership-transfer
  approval — live in the builder's Users page**; the operator CLI keeps its Phase-5
  read/DLQ/reconcile roles and does **not** duplicate these. — **Reversibility:** reversible.
- **D-111:** The BLD-08 export = **exactly the viewer's visible columns** (projected status,
  app/form, timestamps, downstream ref, safe reason), CSV via `csv-parse` (already in the
  stack). PII sits under the same allowlist discipline as logs (D-43/W-22) — never a raw
  full-payload dump. — **Reversibility:** reversible.
- **D-112:** The Dashboard shows only what has a live data source — recent submissions and
  recent audit activity. The **connector-health card is held back** until a real health-check
  job exists (still discretionary from Phase 5); **no static data to fake a card**. —
  **Reversibility:** reversible.

### Locked by the mockup & prior rulings (recorded, not open)
- The **create flow is the mockup's 5-step wizard**: **Basics → Triggers → RBAC → Form →
  Routing**. Step 1 creates the draft ("Saved as a draft · continue through the wizard
  steps"); `app_id` is lowercase-hyphenated and **immutable after first publish**; data mode is
  chosen in step 5. Type one in — the editor opens at the drafts tabs.
- **BLD-02's "tabbed editor"** is the mockup's app-detail page: General / Metadata / Triggers /
  JEV behavior / Role assignments / Roles & permissions / Forms / Versioning / Data routing /
  Field mapping / Lifecycle state / Retention policy / Deprecation notice.
- **G-11 replacement (this phase's responsibility):** when app definitions are authorable, the
  `SeedSavedQueryLookup` stopgap is replaced by a real store over builder-written app
  definitions — written as the frozen D-73 record shape, keyed `(app_id, query_id)`, never
  `query_id` alone.
- **D-86 reconciliation:** app-definition changes are audited transitions; the builder's
  writes supersede seed-file+reload for *user* apps, while platform templates stay D-31 seeds.
- **S1 spike (FormIO 5.6.1 builder) blocks this phase** (ROADMAP): render + build a
  representative form, port one Bootstrap-4-era template, verify `component.errors` and
  `EditGrid.validateRows`. `apps/renderer` already renders FormIO 5.x, so the spike can verify
  the *builder* surface, BLD-04 undo/redo, FRM-05 conditional logic, and FRM-09 preview.

### the agent's Discretion
- **BLD-04 50-action undo/redo mechanism** — schema-snapshot history (debounced) vs deep
  FormIO-builder hooks; decided by the S1 spike and the planner.
- **Connector-request form details** — which "config minus secret" fields surface in the
  request UI, and the exact `connector_requests` schema.
- **APP-07 routing dry-run / APP-08 collision-check internals** — behaviour is fixed by the
  requirements; the mechanism is planner-owned.
- **IDN-05 OTP mechanics** — the delivery channel (existing chat pipeline), with the fixed
  10-min / 3-attempt / 30-min-lockout numbers.
- **OBS-05 metric naming** and the dashboard wiring for `routing_share{app_id}`.
- **Per-template catalogue contents** (domains fixed in D-106; fields/roles per template at
  plan time) and copy strings beyond the mockup's.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase & requirement sources
- `.planning/ROADMAP.md` — Phase 6 block: goal, the 5 success criteria in full, requirements
  list, **S1 spike (blocks the phase)** and the `--research-phase` note (FormIO builder
  integration + the connector-request workflow, which has no PRD section).
- `.planning/REQUIREMENTS.md` — BLD-01…BLD-12, APP-03, APP-05…APP-09, FRM-05, FRM-09,
  IDN-05, IDN-08, ACL-05, ACL-10, OBS-05; plus the **FND-10 body** (line ~109 and the
  coverage-table row ~421 — **stays Pending** until a KMS vendor is named) and **DAT-14**
  (`Partial (G-13)` — the G-11 replacement partially lands here).
- `.planning/WINDOWS.md` **#7 (W-24)** and **#17 (FND-10 revert)** — the credential-gate
  rationale D-100 / D-97 rest on.
- `.planning/PRD.md` **§12** (create flow — the wizard shape), **§12.2/12.3/12.4** (the
  connector request / provisioning flow — **there is no dedicated PRD section for the request
  workflow; research required**), **§15** (OIDC SSO + MFA).
- `.planning/phases/04-read-path-query-dsl/04-CONTEXT.md` — D-73 (saved-query record shape
  the builder writes; **frozen**), D-64…D-79 (DSL, `view_all` scope, own-record-only view).

### Prior context & rulings carried forward
- `.planning/phases/05-integration-async-execution/05-CONTEXT.md` — D-83 (the operator CLI
  Phase 6's authoring replaces), D-86 (seeds + idempotent loader reconciliation model the
  builder inherits), D-87 (FND-10/W-24 gates stay open), D-88 (five-field envelope), D-89
  (the `Connector` interface Phase 6's surfaces build on).
- `.planning/phases/01-foundations-platform/01-CONTEXT.md` — D-21 (frozen read-link claim
  set), D-24 (its key-set test must stay green), D-27 (KMS vendor blocked), D-28 (no real
  secret in Phase 1), D-31 (seeds + idempotent loader).
- `.planning/phases/02-the-vertical-slice-slack-internal-routing/02-CONTEXT.md` — D-31
  loader mechanics, D-43 (log field allowlist — D-111's discipline), D-44
  (`real_user_profiles` for `{{real_user.attribute}}`).

### Research & stack
- `.planning/research/STACK.md` — §9 (React 19 / Vite 8 / `@formio/js` 5.6.1 / drag-and-drop
  builder verified in tarball), §5 (`openid-client` OIDC auth code + PKCE), §8.7
  (`@casl/ability` RBAC for ACL-05/10), §4.4 (Redis session store / ioredis), §8.1
  (throttler), §10.2 (ESLint boundaries — the new app must obey), §12 (do-not-use list).

### Existing code to read before planning
- `prototypes/mockup.html` — **the UI source of truth (AGENTS.md). Open it in a browser
  before designing.** Decides IA, tokens (`--accent #0f9d8f`, Space Grotesk / IBM Plex),
  the 5-step wizard, the tabbed editor, and every page named in D-109.
- `packages/cli/{connector,provision,rebind,dlq}.ts` — the Phase-5 operator seam D-97/D-98
  extend (provisioning stays here) and D-110 trims identity work out of.
- `packages/domain/src/registry/app.repository.ts` — the app-definition store the builder's
  write path builds on.
- `packages/domain/src/seeds/saved-queries.seed.json` + `.spec.ts` — the frozen D-73 record
  shape the builder writes; `packages/domain/src/links/seed-saved-query.lookup.ts` — the
  G-11 stopgap this phase supersedes.
- `packages/domain/src/links/read-verifier.service.ts` + `packages/platform/src/crypto/` —
  the read-link and envelope machinery the builder's credential/request flows touch.
- `apps/renderer/` — the FormIO 5 usage (renderer + edit pages) the builder reuses; the S1
  spike builds the builder surface on the same engine.
- `apps/api/src/read/read.module.ts` — the composition pattern (factory providers, wiring
  guards) the builder's new modules should mirror.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`prototypes/mockup.html`** — complete App Builder IA + token system + the wizard and tab
  editor, as a ~1,950-line static file. The build target for `apps/app-builder`.
- **FormIO 5 in `apps/renderer`** — the form engine + renderer already integrated and tested;
  the S1 spike extends it to the *builder* surface.
- **`packages/cli/`** — `provision.ts`, `rebind.ts`, `dlq.ts`: the operator seam D-97/D-98
  tie into; their audit events (AUD-01) are what the read-only Audit Log page (D-109) browses.
- **Envelope + `KeyProvider`** (`packages/platform/src/crypto/`) — the credential store
  D-100's local/test path reuses; the production guard is the fail-closed reference.
- **`@casl/ability`** (in stack) — the ACL-05/10 and BLD-12 owner-scoping model.
- **`csv-parse`** + the existing submissions repository — D-111's export rides on.
- **Domain factory-provider + wiring-guard pattern** (`read.module.ts`,
  `read.module.spec.ts`) — the new builder modules' DI shape.

### Established Patterns
- **D-31 seeds + idempotent loader** — templates (D-105) and platform content stay seed-based;
  user content moves to direct authoring with audited transitions (D-86).
- **Frozen contracts are consumed, never reshaped in-place** — D-73 record shape and D-21
  claim set; the builder writes D-73 records, it does not redefine them.
- **Field allowlist before serialisation** (D-43/W-22) — the export (D-111) and every list
  surface.
- **All sessions in Redis, services stateless** (AD-9) — D-101's session store.
- **Mockup-first UI** — tokens/IA from `prototypes/mockup.html`; a new color/typeface not
  derived from its `:root` tokens is a defect, not a preference (AGENTS.md).

### Integration Points
- `apps/api` — new `auth/` + `app-builder/` modules: OIDC session endpoint, app CRUD,
  publish gate, requests queue, viewer/export, Users (mapping + approvals).
- `apps/worker` — flows that react to publish/lifecycle (e.g. trigger registration changes)
  and to request `provisioned` events.
- `packages/domain` — `app-builder/` (definitions, drafts, versions, templates, requests),
  `identity/` (OTP onboarding IDN-05, SSO mapping IDN-08), `acl/` (transfer approvals,
  delegation BLD-11).
- `packages/contract` — new builder-facing contracts (app draft/version shapes, request
  shape, mapping fixtures) added beside frozen ones, never modifying them.
- `packages/cli` — provisioning consumes `connector_requests` (D-97/98) and loses the
  identity-admin roles (D-110).

</code_context>

<specifics>
## Specific Ideas

- The create wizard's five steps are named in the mockup: **Basics → Triggers → RBAC → Form →
  Routing**; step 1 shows "App name", "App ID" ("Lowercase, hyphenated. Immutable after first
  publish."), "Description", and the data-mode pills ("Chosen in step 5 — all three are
  available").
- "Saved as a draft · continue through the wizard steps" — the toast after "Create app".
- The dashboard, submissions viewer, audit log, and user-management pages all exist in the
  mockup with working filters/drawers; reuse their structure and copy, do not re-invent.
- The connector "Secrets & safety" card in the mockup's Connectors page is where the
  provisioning state (D-98) is surfaced.
- Province: the read-only Audit Log page and the Users page are *global-admin* surfaces; the
  rest of the builder is owner-scoped (BLD-12).

</specifics>

<deferred>
## Deferred Ideas

- **Settings platform knobs** (JEV provider chain, decision cache, circuit breaker) — deferred
  to the phase that owns platform administration (D-109).
- **Connector-health dashboard card** — deferred until a real health-check job exists (D-112).
- **Full mockup parity** — rejected; the requirement-mapped surface set (D-109) is the scope.
- **Complete self-service credential entry** — rejected (D-97); FND-10/W-24 stay authoritative.
- **Employee-facing admin surfaces** — none; end users stay on chat + renderer.

### Reviewed Todos (not folded)
None — the phase had no matching todos.

None beyond the above — discussion stayed within phase scope.

</deferred>

---

*Phase: 6-Self-Service App Builder*
*Context gathered: 2026-10-11*