# Phase 4: Read Path & Query DSL - Context

**Gathered:** 2026-10-08
**Status:** Ready for planning

<domain>
## Phase Boundary

A 90-day view or query link lets a user read their own data with no stored session, and dies the instant their permission changes. This phase delivers:

- **The full IM read path**: "show my tickets" (or `/tickets list`) routes through Phase 3's action-aware chain → a view/query link replies in chat (PRD §12.2), with view links also riding submission confirmations.
- **Link access**: stateless JWT verified by public key alone (LNK-05), fresh permission + `perm_version` re-check on every access (LNK-06), per-reason denial counting across seven reasons (LNK-08).
- **Renderer read surfaces**: a FormIO read-only view page and a server-paginated query results table, plus specific dead-link copy with an IM request affordance.
- **The Query DSL**: a JSON DSL → AST → single compiler that reads internal data with raw MongoDB never exposed (DAT-10), auto-injects `real_user_id` + `deleted_at: null` from one builder unless the user holds `view_all` (DAT-11), and a DAT-12 test per construct proving the injected filters survive.

Delivers LNK-05, LNK-06, LNK-08, DAT-10, DAT-11, DAT-12.

**Not this phase:** App Builder authoring UI and saved-query UI (Phase 6); external connectors (Phase 5); the purge flow that *writes* `deleted_at` (AUD-08, Phase 8 — Phase 4 only *filters* on it); additional IM adapters (Phase 7); groups/org visibility (PRD §6.2 excludes groups from v1). SC#4's zero-downtime dual-key window rides on Phase 2's LNK-12 mechanism (Pending) — this phase verifies outstanding read links survive rotation, it does not build rotation.

</domain>

<decisions>
## Implementation Decisions

### Read-link entry point

- **D-64:** Full IM path, action-aware. Apps declare view/query intents alongside create intents; the router resolves `(tool_id, action)`; the worker issues the matching read link (PRD §12.2 exactly). The frozen JEV contract is untouched — `ToolDescriptor` stays `{id, description, parameters}`; the action lives in how tools are declared and listed, not in the wire contract. — **Reversibility:** costly — extends `PublishedAppLoader`, `RoutingOrchestrator`, and the worker issuance seam built in Phase 3.
- **D-65:** When the app is clear but the action is not ("tickets"), reuse Phase 3's clarification loop with the action choice included in the clarification — no silent default to `create`.
- **D-66:** The tool filter becomes per `(app, action)` with action-scoped permissions (e.g. `leave:request` and `leave:view` under the existing namespaced permission pattern). A user who can't view never gets a view tool listed, so no known-dead link is issued; the access-time LNK-06 check stays authoritative regardless. — **Reversibility:** costly — the permission naming convention spreads through seeds, the loader, and the authorization seam.
- **D-67:** View links ride the submission confirmation (`target_id` = that submission — SC#1 satisfied with zero guesswork); query links come from saved queries the app declares with their own intents; view-by-reference from chat ("show my ticket #123") is deferred. — **Reversibility:** costly — the confirmation message shape is shared with Phase 2's thread reply; rework touches both.

### View/query page rendering

- **D-68:** The view page renders the submission via **FormIO read-only mode** (`@formio/js` 5.x install — the S1 spike applies: Bootstrap-5 default, `component.errors` changes). One rendering engine and one visual language for create and view. — **Reversibility:** costly — the rendering engine pervades the renderer.
- **D-69:** The query page is a **server-paginated table**: columns from the saved query's projection, rows paginated through the DSL, proper table semantics for WCAG 2.1 AA (FRM-08) and a mobile fallback.
- **D-70:** A dead read link shows the **specific denial reason** in friendly copy (extending today's `LinkErrorFilter` precedent) plus the LNK-11 "request a new one via IM" affordance. The server records the distinct reason for LNK-08 regardless of what is displayed.
- **D-71:** LNK-08 per-reason counts live as an **OTel counter with a `reason` label** (single metrics path per STACK §6: OTel API → exporter-prometheus) plus an allowlisted structured log entry per denial. Admin-visible UI is deferred to Phase 6. — **Reversibility:** reversible — metric additions are additive; dashboards/alerts are cheap to adjust.

### Query DSL scope & authoring

- **D-72:** Construct set: field filters (`eq`, `ne`, `in`, `gte`/`lte`, `contains`), AND/OR groups, sort, offset/limit pagination, column projection. Aggregations explicitly deferred. Each construct is a DAT-12 test obligation. — **Reversibility:** costly — every construct becomes a published DSL capability with a filter-survival test; removing one breaks seeded queries that used it.
- **D-73:** Saved queries are their own **seeded records** `{query_id, query_version, dsl, intents, app_id}` loaded by the D-31 idempotent loader — `query_version` bumps independently of app edits. Phase 6's builder later writes these same records, so the seam survives. — **Reversibility:** costly — seed record shape is a stored contract the App Builder will inherit.
- **D-74:** The DSL is a **JSON DSL → strict Zod schema (unknown keys rejected) → typed AST → single compiler** that emits the Mongo filter. Authorization filters are AND-ed at the **root of the emitted filter, structurally outside the user's AST** — a user query can never OR its way out of `real_user_id` + `deleted_at: null`. One builder emits both (DAT-11); DAT-12 tests walk every AST node type. — **Reversibility:** costly — the wire representation is a stored contract (seeded DSLs) and every DAT-12 test is written against the AST; changing representation re-proves the whole suite.
- **D-75:** Version enforcement on read access: **`query_version` only** (plus `perm_version` per LNK-06). A query DSL edit invalidates outstanding query links with a `wrong_version` denial (recorded + displayed); form/app edits do **not** kill view links — the 90-day promise survives unrelated admin edits. — **Reversibility:** costly — verifier semantics are security-relevant and change what outstanding links do on deploy.

### view_all semantics

- **D-76:** `view_all` scopes **per app**: every record belonging to that app regardless of submitter (FR-D-7 "permission for that app"). SC#3's "whole team" is satisfied because the seeded team shares one app; team/org scoping needs groups (excluded from v1). — **Reversibility:** costly — the permission's semantics are baked into seeds and the filter builder; widening to org-scoping later requires the group model.
- **D-77:** `view_all` is granted via a **seeded role binding** (manager/owner role permission list). Changing it bumps `perm_version` (ACL-07), which is what makes outstanding links die per LNK-06. No runtime grant endpoint — Phase 6 owns authoring.
- **D-78:** DAT-11's "unless" is resolved canonically: **`view_all` bypasses `real_user_id` only; `deleted_at: null` is always injected.** Basis: PITFALLS.md §18 states the pair as "`real_user_id` (unless `view_all`) AND `deleted_at: null`"; FR-D-7 scopes `view_all` to the `real_user_id` injection; FR-LC-5 says purge soft-deletes to "exclude from queries". Deleted-row access (exports/compliance) requires a separate **audited `include_deleted` flag**, never `view_all`. Downstream agents must treat this as the canonical reading of DAT-11 and not re-litigate the grammar. — **Reversibility:** one-way — relaxing it re-opens the PITFALLS §18 compliance failure: user-erased rows surfacing in read-link results and exports during the 30-day purge grace window.
- **D-79:** A view link's target submission **must belong to `sub`** — view is own-record only, full stop. SC#1 stays a structural invariant with no permission branch. Managers reach others' records only through query links (row scope handled by injected filters + `view_all`). — **Reversibility:** costly — this is a verifier security rule; loosening it later converts the view action into a cross-user read surface that needs its own test matrix.

### the agent's Discretion
No "you decide" answers were taken — every question had a user-selected option. Remaining implementation freedom for the planner/implementer: cursor-vs-offset encoding inside the page construct beyond D-72's offset/limit semantics, table mobile fallback pattern, loading/empty/error states, exact denial copy strings, metric naming/label conventions, seed file layout, WCAG implementation details.

### Note for the researcher
LNK-08/SC#2's seven denial reasons include **"consumed"** — but D-42 (Phase 2) says read links never consume. Reconcile in research: the reason enum likely spans the shared link-error surface (write-path consumption exists), or "consumed" is unreachable for view/query actions. Do not invent consumption semantics for read links.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase roadmap & requirements
- `.planning/ROADMAP.md` §Phase 4 — goal, SC#1–SC#4, requirement list (LNK-05/06/08, DAT-10/11/12)
- `.planning/REQUIREMENTS.md` §Links & Token Security — LNK-05 (stateless public-key JWT), LNK-06 (fresh check + perm_version), LNK-08 (per-reason denial counts), LNK-09/LNK-11 context (logging, expired copy)
- `.planning/REQUIREMENTS.md` §Submissions & Data Routing — DAT-10, DAT-11, DAT-12
- `.planning/REQUIREMENTS.md` AUD-08 — purge is soft-delete then hard delete (Phase 8 owns the writes; defines what `deleted_at` means)

### PRD
- `PRD.md` §12.2 — View / Query Flow: the end-to-end read baseline (IM query → JEV view tool → link → verify → fresh RBAC → injected filter → render → log)
- `PRD.md` FR-D-6 / FR-D-7 — Query DSL required, raw MongoDB forbidden; `real_user_id` injection unless `view_all` **for that app**
- `PRD.md` FR-LC-5 — purge soft-delete "mark as deleted, exclude from queries"; hard delete after 30-day grace
- `PRD.md` §6.6 / §6.7 — link types & TTLs; perm_version model
- `PRD.md` §6.2 — groups not used in v1 (bounds D-76)

### Frozen contracts
- `packages/contract/src/links/read-link-claims.ts` — **the frozen claim set (D-21)**: `ReadLinkAction` enum, `READ_LINK_TARGET_RULES` (view→submission_id, query→query_id), version claims, TTL ceiling
- `packages/contract/src/links/read-link-claims.frozen.spec.ts` — D-24 frozen key-set test; the claim set MUST NOT change
- `packages/contract/src/links/token-classes.ts` — config table: view/query = 90d, `consume: false`; `isEmittableInV1` gate
- `packages/contract/src/jev/v1/jev-request.ts` — `ToolDescriptor` (id/description/parameters, no action field), RBAC-filtered tool list

### Prior phase decisions carried forward
- `.planning/phases/01-foundations-platform/01-CONTEXT.md` — D-21 frozen claims, D-24 frozen test, D-31 seeds + idempotent loader
- `.planning/phases/02-the-vertical-slice-slack-internal-routing/02-CONTEXT.md` — D-40 action-branching verifier (read actions compare epoch live), D-41 fragment transport, D-42 reads never consume, D-43 log allowlist fields
- `.planning/phases/03-natural-language-routing/03-CONTEXT.md` — clarification loop, routing chain, provider chain (all reused by D-64/D-65)

### Security & data research
- `.planning/research/PITFALLS.md` §18 (lines ~709–726, 871, 921) — soft-delete/DSL leak: one builder emits both filters, `view_all` attaches to `real_user_id` only, audited `include_deleted` flag for exports, default index includes `deleted_at`
- `.planning/research/SUMMARY.md` item 7 — auto-injected filters are the authorization surface with no test precedent
- `.planning/research/STACK.md` §5 — asymmetric signing (jose, public-key verification is why SC#1 works), §6 — single metrics path for D-71

### Existing code surfaces
- `apps/api/src/common/filters/link-error.filter.ts` — current `LinkErrorCode` enum + user-facing copy; extend to the seven reasons (D-70)
- `prototypes/mockup.html` — the App Builder admin console only; it does not depict read pages. Absence is not permission — renderer read-surface design follows this CONTEXT's decisions, and FRM-08 (WCAG 2.1 AA) governs accessibility.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/domain/src/decision/published-app-loader.ts` — `PublishedApp` (D-52 app-declared intents, threshold, status) + `listAuthorized`; the seam D-64/D-66 extends (action buckets, per-pair authorization)
- `packages/domain/src/decision/routing-orchestrator.ts` — passes `authorizedTools` to providers; carries the `(tool_id, action)` resolution outward
- `packages/domain/src/decision/clarification-session.service.ts` — reused for action ambiguity (D-65)
- `packages/domain/src/authz/` — `rbac.service.ts` (namespaced permissions `leave:request`/`leave:manage`, roles employee/owner), `permission-check.service.ts` (fresh check + `perm_version`), `rbac-cache.service.ts` (`ak:rbac:{app}:{user}:{ver}`); extend permission names for actions (D-66), seed `view_all` (D-77)
- `packages/domain/src/links/link-issuer.service.ts` — tracer stand-in; the issuance seam the read path plugs into (real KMS-backed signing replaces the body, per 01-CONTEXT)
- `packages/domain/src/submissions/submission.repository.ts` — **empty stub**; the read-path query execution and view fetch land here
- `packages/contract/src/links/token-classes.ts` — view/query rows already exist with 90d/`consume:false`; issuer must pass `isEmittableInV1`
- `packages/domain/src/decision/fixtures/labelled-intents.json` — 50-intent conformance fixture pattern; view/query intents get the same treatment (Phase 3's suite extended)

### Established Patterns
- Frozen contracts + frozen specs (D-24): the claim set cannot change; Phase 4 works strictly within `action`, `perm_version`, `query_version`, `target_id`
- D-31 provisioning: committed seed files + idempotent loader — extended to saved-query records (D-73) and `view_all` role bindings (D-77)
- D-40: link verifier branches on `action`; read actions compare `perm_version` live — Phase 4 activates this seam
- Log allowlist before serialization (D-43) — denial logs use allowlisted fields only
- OTel single metrics path (no prom-client) — D-71's counter follows it

### Integration Points
- **Worker consumer path** (post-Phase-3 decision): resolves `(tool_id, action)` → issues view/query link → replies in the Slack thread
- **API**: new HTTP surface for the renderer — today only Slack controllers exist (`slack-commands`, `slack-webhook`); link-verify + data endpoints are all new
- **Renderer**: `apps/renderer` is a placeholder (9-line index.html, `prefill.ts`); FormIO view page (D-68), query table (D-69), dead-link page (D-70) are all new
- **Issuance**: the submission confirmation gains a view link (D-67)

</code_context>

<specifics>
## Specific Ideas

- PRD §12.2's exact user story: employee types "show my tickets" or `/tickets list` in Slack and gets a working read link back in chat.
- The demo team is the proof of SC#3: a seeded manager holding `view_all` opens one query link and sees the whole team's records in the table; a regular employee's query returns only their own rows (soft-deleted rows excluded for everyone).
- Dead-link copy should sound like today's `LinkErrorFilter` ("This link has expired. Please request a new one via IM."), one sentence per reason.

</specifics>

<deferred>
## Deferred Ideas

- View-by-reference from chat ("show my ticket #123") — resolving an arbitrary submission_id from a chat phrase; future phase.
- Aggregations in the Query DSL (count/sum/group-by) — dashboard reads; larger authorization/DoS surface; not required by Phase 4.
- Admin-visible denial counts UI — Phase 6 (App Builder console) consumes the D-71 metric.
- Runtime grant/revoke endpoint for permissions — Phase 6 replaces seeded role bindings (D-77).
- Team/org-scoped `view_all` — blocked on the group model PRD §6.2 excludes from v1.
- Saved-query authoring UI — Phase 6 App Builder; D-73 keeps the record seam ready.
- Shareable deep links to another user's record (view honoring `view_all`) — rejected this phase (D-79); revisit only with an explicit requirement.

No todos were matched for this phase (`todo_count: 0`); none were reviewed or folded.

</deferred>

---

*Phase: 4-Read Path & Query DSL*
*Context gathered: 2026-10-08*
