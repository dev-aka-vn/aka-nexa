# Phase 4: Read Path & Query DSL - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-08
**Phase:** 4-Read Path & Query DSL
**Areas discussed:** Read-link entry point, View/query page rendering, Query DSL scope & authoring, view_all semantics

---

## Read-link entry point

### Q1: How should a user obtain a read link in Phase 4?

| Option | Description | Selected |
|--------|-------------|----------|
| Full IM path, action-aware | Wire read actions into Phase 3's chain; apps declare view/query intents; router returns (tool_id, action); worker issues read link. Matches PRD §12.2. | ✓ |
| Slash-only entry for reads | Slash commands only; plain-language read routing deferred. | |
| Confirmation link only | View link on submission confirmation; query links via IM deferred entirely. | |
| You decide | Planner chooses based on Phase 3's seams and scope budget. | |

**User's choice:** Full IM path, action-aware (Recommended)
**Notes:** Context given — today's router has no action dimension; JEV picks `tool_id` (an app) and the pipeline always issues a create/form link.

### Q2: App clear but action ambiguous ("tickets") — clarify or default?

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse Phase 3 clarification | Clarification fires with the action choice included; consistent with Phase 3's ambiguity rule. | ✓ |
| Default to create | Ambiguous input resolves to action: create; read links only on explicit read phrasing. | |
| You decide | Planner picks based on Phase 3's clarification session. | |

**User's choice:** Reuse Phase 3 clarification (Recommended)

### Q3: Tool filter per (app, action) or app-level only?

| Option | Description | Selected |
|--------|-------------|----------|
| Filter per (app, action) | Action-scoped permissions (e.g. `leave:view`); loader filters per pair; no known-dead links issued; LNK-06 stays authoritative. | ✓ |
| App-level filter only | Keep `authorize(app.id, userId)`; row-level restriction via injected filters + access-time check. | |
| You decide | Planner decides based on Phase 3's authorization seam. | |

**User's choice:** Filter per (app, action) (Recommended)
**Notes:** Context — permissions already look like `leave:request` / `leave:manage`.

### Q4: How are view/query targets resolved in the IM path?

| Option | Description | Selected |
|--------|-------------|----------|
| Confirmation view + declared queries | View link rides submission confirmation (target = that submission); query links from saved queries declared with app intents (D-52 extended); view-by-reference deferred. | ✓ |
| Full view tools in chat | Also resolve arbitrary view targets ("show my latest ticket") with recency/tie-break semantics. | |
| You decide | Planner chooses based on scope budget. | |

**User's choice:** Confirmation view + declared queries (Recommended)
**Notes:** Context — frozen D-21 target rules: view → submission_id, query → query_id; App Builder doesn't exist until Phase 6.

**Check-in:** "More questions or move to next?" → **Next area**

---

## View/query page rendering

### Q1: What does a VIEW link page render?

| Option | Description | Selected |
|--------|-------------|----------|
| FormIO read-only mode | Same engine as create form; one visual language; schema-driven; requires @formio/js 5.x (S1 spike risk). | ✓ |
| Custom detail view | React detail view from schema + submission; two rendering paths can drift. | |
| You decide | Planner weighs S1 spike status and renderer scope. | |

**User's choice:** FormIO read-only mode (Recommended)
**Notes:** Context — PRD §12.2 step 10 says "read-only FormIO or table view" (undecided either/or); renderer today is a 9-line placeholder, no @formio/js installed, API has only Slack endpoints.

### Q2: What does a QUERY link results page look like?

| Option | Description | Selected |
|--------|-------------|----------|
| Paginated table | Columns from query projection; server-side pagination through the DSL; WCAG table semantics + mobile fallback. | ✓ |
| FormIO card list | Each row a read-only FormIO card; heavy for many rows. | |
| You decide | Planner/renderer implementer chooses based on WCAG and scope. | |

**User's choice:** Paginated table (Recommended)

### Q3: What does the user SEE when a read link is dead?

| Option | Description | Selected |
|--------|-------------|----------|
| Specific reason + IM affordance | Friendly copy per reason (LinkErrorFilter precedent) + LNK-11 "request a new one via IM"; server records distinct reason regardless of display. | ✓ |
| Generic for everything but expired | One "no longer valid" page for every denial except expired. | |
| Hybrid: natural specific, security generic | Expired/consumed get specific copy; revoked/bad signature/wrong version/deactivated collapse to generic. | |
| You decide | Planner chooses copy strategy. | |

**User's choice:** Specific reason + IM affordance (Recommended)
**Notes:** Context — SC#2 requires distinct reason *recorded* (expired, consumed, revoked, wrong app, wrong version, deactivated user, bad signature); LNK-11 already mandates specific expired copy.

### Q4: Where do LNK-08 per-reason denial counts live and surface?

| Option | Description | Selected |
|--------|-------------|----------|
| Metric label + structured log | OTel counter with reason label (STACK §6 single metrics path) + allowlisted log entry; admin UI deferred to Phase 6. | ✓ |
| Metric + admin-visible UI now | Also build an admin surface this phase. | |
| Log-only counting | Count via log aggregation only. | |
| You decide | Planner chooses based on observability conventions. | |

**User's choice:** Metric label + structured log (Recommended)

**Check-in:** "More questions or move to next?" → **Next area**

---

## Query DSL scope & authoring

### Q1: What construct set does the DSL support in Phase 4?

| Option | Description | Selected |
|--------|-------------|----------|
| Filters + sort + page + projection | eq/ne/in/gte/lte/contains, AND/OR groups, sort, offset/limit pagination, column projection; aggregations deferred; one DAT-12 test per construct. | ✓ |
| Minimal: flat filters + pagination | Equality/range filters AND-ed, limit pagination only. | |
| Include aggregations | Plus count/sum/group-by pipelines; much larger authorization/DoS surface. | |
| You decide | Planner sizes the construct set. | |

**User's choice:** Filters + sort + page + projection (Recommended)

### Q2: Where do saved queries come from (App Builder is Phase 6)?

| Option | Description | Selected |
|--------|-------------|----------|
| Seeded query records | {query_id, query_version, dsl, intents, app_id} from committed seeds via idempotent loader (D-31 extended); Phase 6 builder writes the same records. | ✓ |
| Embed in app publication | Saved queries ride the app's publication record alongside intents. | |
| Runtime creation API | Author queries via API endpoint this phase (throwaway admin API, no caller). | |
| You decide | Planner chooses storage shape. | |

**User's choice:** Seeded query records (Recommended)

### Q3: How is the DSL shaped on the wire and where does injection happen?

| Option | Description | Selected |
|--------|-------------|----------|
| JSON DSL → AST → single compiler | Strict Zod (unknown keys rejected) → typed AST → one compiler; auth filters AND-ed at root outside user AST; DAT-12 tests walk every node type. | ✓ |
| Whitelisted Mongo-shaped passthrough | Restricted JSON mapping to Mongo operators with whitelist; Mongo-flavored wire shape. | |
| String mini-language | Text syntax with hand-written parser (locales, error recovery). | |
| You decide | Planner picks the representation. | |

**User's choice:** JSON DSL → AST → single compiler (Recommended)
**Notes:** Context — the security-critical property: a user's query can never OR its way out of `real_user_id` + `deleted_at: null`.

### Q4: Which version claims besides perm_version does a read access enforce?

| Option | Description | Selected |
|--------|-------------|----------|
| Enforce query_version only | Query edits invalidate query links (wrong_version denial); form/app edits don't kill view links; perm_version always per LNK-06. | ✓ |
| Enforce all version claims | Any edit invalidates outstanding links. | |
| Enforce none but perm_version | query_version stays metadata (contradicts SC#2's wrong-version reason). | |
| You decide | Planner decides. | |

**User's choice:** Enforce query_version only (Recommended)

**Check-in:** "More questions or move to next?" → **Next area**

---

## view_all semantics

### Q1: What does view_all scope to?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-app: all records of that app | FR-D-7 "permission for that app"; team works because seeded team shares one app; matches v1 no-groups constraint. | ✓ |
| Team/org-scoped visibility | view_all resolves against org/team structure; needs groups (excluded from v1). | |
| You decide | Planner settles scope against requirements. | |

**User's choice:** Per-app: all records of that app (Recommended)
**Notes:** Context — SC#3 says "whole team's records"; PRD §6.2: groups not used in v1; FR-D-7 says view_all is a permission "for that app".

### Q2: How does a manager hold view_all in Phase 4?

| Option | Description | Selected |
|--------|-------------|----------|
| Seeded role binding | view_all in a manager/owner role's permission list in seeds; change bumps perm_version (ACL-07); same seam Phase 6 replaces. | ✓ |
| Runtime grant endpoint | Grant/revoke endpoint this phase (throwaway API, needs its own audit story). | |
| You decide | Planner chooses. | |

**User's choice:** Seeded role binding (Recommended)

### Q3: DAT-11 "unless" ambiguity — which filters does view_all bypass?

| Option | Description | Selected |
|--------|-------------|----------|
| view_all bypasses real_user_id only | Matches PITFALLS §18 and FR-D-7; deleted_at: null always injected; deleted-row access needs audited include_deleted flag; CONTEXT records the canonical reading of DAT-11. | ✓ |
| view_all bypasses both filters | Strict grammatical reading; managers see soft-deleted rows during purge grace; conflicts with PITFALLS §18 compliance argument. | |
| You decide | Planner/research resolve against DAT-11's wording. | |

**User's choice:** view_all bypasses real_user_id only (Recommended)
**Notes:** Context — FR-LC-5: purge soft-delete "mark as deleted, exclude from queries".

### Q4: Can a view link target a record the opener doesn't own?

| Option | Description | Selected |
|--------|-------------|----------|
| View = own record only | Verifier requires target submission belongs to sub; SC#1 stays structural; managers reach others' records via query links only. | ✓ |
| View honors view_all | View access checks owner == sub OR view_all; enables shareable deep links; second row-scope rule to test. | |
| You decide | Planner decides the verifier rule. | |

**User's choice:** View = own record only (Recommended)

---

## the agent's Discretion

No "you decide" options were selected — every question had a user-selected answer. Discretion left to planner/implementer: cursor-vs-offset encoding detail, table mobile fallback pattern, loading/empty/error states, exact denial copy strings, metric naming/label conventions, seed file layout, WCAG implementation details.

## Deferred Ideas

- View-by-reference from chat ("show my ticket #123") — future phase
- Aggregations in the Query DSL — not required by Phase 4
- Admin-visible denial counts UI — Phase 6
- Runtime grant/revoke endpoint — Phase 6
- Team/org-scoped view_all — blocked on groups (PRD §6.2 excludes from v1)
- Saved-query authoring UI — Phase 6 App Builder
- Shareable deep links to others' records (view honoring view_all) — rejected this phase; revisit only with an explicit requirement
