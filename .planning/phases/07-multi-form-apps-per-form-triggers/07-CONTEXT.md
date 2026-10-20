# Phase 7: Multi-Form Apps & Per-Form Triggers - Context

**Gathered:** 2026-10-17
**Status:** Ready for planning

<domain>
## Phase Boundary

An app stops being "one embedded form + app-level triggers" and becomes a **container of forms**.
Each form declares a **kind** and carries its own schema; each form may be activated by its own
trigger. All forms in an app share the app's MongoDB collection, role assignments, and
data-routing destination — there is no per-form collection, no per-form role set, and no per-form
connector.

This phase **re-opens surfaces shipped in Phases 2, 4, 5 and 6**:

- The app definition grows from a single embedded `form_schema` to a **form set** (`forms[]`).
- Phase 4's `view`/`query` read path and Phase 5's edit link become **form kinds** rather than
  standalone link classes — while still reusing their existing render/projection machinery.
- Phase 6's Form tab (`BLD-04`) becomes a **form manager** with a per-form designer; the
  app-level Triggers tab is retired.
- `APP-04` is **amended** by `APP-12`: a published **form** declares the intents and slash
  commands that activate it, not the app.
- `LNK-07`'s frozen `form_version` claim becomes genuinely **per-form**.

Existing single-form apps and the ~10 template seeds must keep working; the migration is part of
this phase, not a data-loss event.

</domain>

<decisions>
## Implementation Decisions

### Form kinds & the action mapping
- **D-01:** A form's `kind` is **exactly** the frozen read-link `action` (D-21): `submit`→`create`,
  `list`→`query`, `show`→`view`, `edit`→`edit`. No new enum — the wire's `action` **is** the kind.
  `notification` and `draft` are **not** form kinds (notification is a link class bound to the
  submitter per D-21; `draft` is reserved). — **Reversibility:** one-way — the action enum is
  frozen at `packages/contract/src/links/read-link-claims.ts` (D-21) and reusing it as the kind
  vocabulary binds the domain taxonomy to a published contract; introducing a separate kind enum
  later means a second taxonomy mapped onto the frozen actions, plus every outstanding link and
  every stored `forms[]` element is interpreted through it.
- **D-02:** **At most one form per kind per app.** `submit`, `list`, `show`, `edit` are each
  singular within an app. `form_id` is therefore derivable from the kind, and the router's existing
  `(tool_id = app_id, action)` resolution (D-64) still identifies the form with **no routing
  change**. — **Reversibility:** costly — undoing this means the JEV tool list must expose
  form-level identity so the model can distinguish two forms sharing an action, which touches the
  tool-descriptor projection, the decision contract, and the builder.

### Read forms — projection vs FormIO schema
- **D-03:** The `show` (view) form renders the app's **`submit` schema read-only** via FormIO
  (reuses D-68). `show` is a thin **config** — which fields to surface, ordering, read-only
  derived fields — **not** a second schema, so it cannot drift from what was submitted.
  — **Reversibility:** reversible.
- **D-04:** The `list` (query) form **reuses the Phase-4 saved-query + viewer-row projection**
  (frozen `query` action, `target_id = query_id`, D-80/D-82). A `list` form is a reference to a
  saved query plus column config — **no new FormIO schema** and no second render path.
  — **Reversibility:** costly — if a `list` later needs its own FormIO schema, the read path gains
  a second render route that must be reconciled with the query DSL.
- **D-05:** **`submit` is mandatory** for an app to publish (preserves today's publish-gate rule
  that `form_schema !== null`); **`list`, `show`, `edit` are optional**. An app that only wants a
  chat create-form stays a one-form app. — **Reversibility:** reversible.

### Trigger → form binding & routing
- **D-06:** **Triggers live on the form.** Each form owns `{intents[], aliases[], threshold}`
  (the shape currently carried per-app by `PublishedApp`, D-52/D-53). The app-level `triggers`
  field is **retired** (migrated into the `submit` form). The JEV tool list becomes the set of
  **forms** that declare a trigger. — **Reversibility:** costly — D-52 put triggers on the app's
  publication record; moving them to forms changes `published-app-loader.ts`, the tool-descriptor
  projection, the publish gate, and the builder.
- **D-07:** **At most one trigger per form.** A form either is triggered or is not; a trigger is
  one object carrying `intents[]`/`aliases[]`, not many. A form with no trigger is reachable only
  via an already-issued link (the normal path for `show`/`edit`). — **Reversibility:** reversible.
- **D-08:** **Only `submit` and `list` may carry a routable trigger** — the two entry points a
  user starts in chat. `show`/`edit` are **link-driven only**. This is consistent with D-64, which
  already pairs create intents with view/query intents. — **Reversibility:** costly — allowing
  triggers on `show`/`edit` later would require a target-resolution rule for each kind (a `view`
  trigger must resolve *which* submission) that this phase deliberately avoids.

### Data model, migration & builder UX
- **D-09:** The stored shape becomes
  `forms: [{ form_id, kind, schema, form_version, triggers: {intents, aliases, threshold} | null, config }]`,
  which **replaces both** the single `form_schema` field and the app-level `triggers` array — one
  array is the app's whole form set, one source of truth. — **Reversibility:** costly — a stored
  shape change; rolling back needs a reverse migration over every app document.
- **D-10:** **One app publish counter** (`version`). Each form's `form_version` is **derived** as
  the app version at which that form's schema last changed (stable per form). A single history
  (`app_definition_versions`, last 20) keeps rollback unchanged, and the frozen claim's separate
  `form_version` still means "this form's last change". Editing one form therefore does **not**
  move another form's `form_version` (SC#1). — **Reversibility:** costly — the shape of the
  `form_version` claim is compared against frozen D-21; switching to independent per-form counters
  later requires per-form history storage and a per-form rollback surface.
- **D-11:** **One-shot migration script**: rewrite every existing app document
  (`form_schema` → `forms: [{ kind: 'submit', … }]`, app `triggers` → that form's `triggers`) and
  update the ~10 template seeds under `packages/domain/src/builder/template/seeds/`. No
  dual-shape read path is maintained. — **Reversibility:** costly — once migrated, the old shape is
  gone; rollback is a reverse migration or a restore.
- **D-12:** The App Builder's **`Forms` tab becomes a form manager** — list the app's forms,
  add/remove by kind, per-form designer; **triggers are edited as a panel inside the form**. The
  app-level `Triggers` tab is **retired**, i.e. the section vocabulary drops 12 → 11 sections
  (`packages/contract` `SectionNameSchema`), so the **BLD-03 permission-matrix rows change** (the
  builder section list is also the permission matrix — `apps/app-builder/src/sections.ts`).
  — **Reversibility:** costly — `SectionNameSchema` is a contract and the section list is the
  permission matrix; any already-stored role/permission documents that name the `triggers` section
  must be handled by the migration.

### the agent's Discretion
- Exact `forms[]` element field names and the `config` payload shape per kind (`show`'s field
  surfacing, `list`'s column config) — the decisions fix *what* each holds, not the field spelling.
- Domain kind names (`submit`/`list`/`show`/`edit`) vs wire action names
  (`create`/`query`/`view`/`edit`) — D-01 makes these a fixed bijection; which side is canonical in
  code is an implementation choice.
- Whether `form_id` is a stored opaque id or derived from `kind` (D-02 makes derivation possible;
  the claim already carries `form_id`).
- How the builder presents a form's trigger panel (inline vs drawer) — subject to
  `prototypes/mockup.html`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase definition & requirements
- `.planning/ROADMAP.md` §"Phase 7: Multi-Form Apps & Per-Form Triggers" — goal, five success
  criteria, the re-opened-surfaces notes, and the required research areas.
- `.planning/REQUIREMENTS.md` — `APP-11`, `APP-12`, `FRM-14` (new); `APP-04` (amended by `APP-12`).
- `.planning/PROJECT.md` — core value and constraints the form set must not break.

### Frozen contracts (must not be reshaped)
- `packages/contract/src/links/read-link-claims.ts` — the frozen read-link claim set (D-21): the
  `action` enum is the kind vocabulary (D-01); `form_id` + `form_version` are already per-form
  (`LNK-07`); `READ_LINK_TARGET_RULES` gives each action's `target_id` meaning.
- `packages/contract/src/builder/app-definition.contract.ts` — builder-facing app-definition
  contracts and the `.strict()` section payload discipline (BLD-07).
- `packages/contract/src/submissions/submissions.contract.ts` — submissions already carry
  `form_id`; the `form` query filter and export column.

### Existing implementation (integration points)
- `packages/domain/src/builder/data-access/app-definition.repository.ts` — the D-86 app store:
  `form_schema: Record | null` (single) and the `forms → ['form_schema']` section-field map that
  D-09/D-12 change; `DEFAULT_TEMPLATE`/seed shape.
- `packages/domain/src/builder/app-definition.service.ts` — section validation, version history,
  and the deprecation/trigger-registration guard (APP-05).
- `packages/domain/src/builder/publish-gate.service.ts` — the `form_schema !== null` publish rule
  (§397) that D-05 becomes "a `submit` form exists".
- `packages/domain/src/decision/published-app-loader.ts` — `PublishedApp` intents/aliases/threshold
  (D-52/D-53) that D-06 moves onto forms.
- `packages/domain/src/builder/template/seeds/*.json` — the ~10 seed apps whose single
  `form_schema` + `triggers` D-11 migrates.
- `apps/app-builder/src/sections.ts` — the 12-section vocabulary (BLD-02/BLD-03) that D-12 reduces
  to 11; also the editor tabs and permission-matrix rows.
- `apps/app-builder/src/form-designer/FormDesignerPage.tsx` — the Phase-6 single-form designer that
  D-12 turns into a per-form designer.

### Prior-phase decisions this phase builds on
- `.planning/phases/02-the-vertical-slice-slack-internal-routing/02-CONTEXT.md` — D-39
  (action-branching verifier), D-45 (per-form pre-fill), D-52 (triggers on the app record).
- `.planning/phases/04-read-path-query-dsl/04-CONTEXT.md` — D-64 (`(tool_id, action)` resolution),
  D-65 (action ambiguity → clarification), D-66 (action-scoped tools/permissions), D-68 (view
  renders via FormIO read-only), D-75 (read links enforced on `query_version` only), D-79
  (own-record only).
- `.planning/phases/05-integration-async-execution/05-CONTEXT.md` — D-80/D-82 (per-app "My
  submissions" list uses the frozen `query` action), D-93 (edit link issued from the status/view
  surface, owner-only).
- `.planning/phases/06-self-service-app-builder/06-CONTEXT.md` — the Form tab seam (`BLD-04`) and
  the builder section vocabulary this phase restructures.

### UI source of truth
- `prototypes/mockup.html` — the App Builder console. Per `AGENTS.md`, the **`Forms` tab manager,
  the per-form designer, and the in-form trigger panel** must follow this mockup's layout, tokens
  and copy; a frozen contract (above) wins wherever the mockup disagrees.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Frozen read-link claims** (`read-link-claims.ts`): already carry `form_id` + `form_version` +
  `app_version` and a frozen `action` enum — D-01/D-02/D-10 add **no new claim**, so no issued
  link is invalidated.
- **Phase-4 query path** (`saved query` + `viewer-row` projection): reused verbatim as the `list`
  form's definition (D-04).
- **FormIO read-only render** (D-68): reused verbatim as the `show` form's renderer (D-03).
- **`app_definition_versions`** (last-20 whole-doc snapshots): reused as the single history that
  D-10's derived `form_version` reads from.
- **Section-field map** (`SECTION_FIELDS` in `apps/app-builder/src/sections.ts`): one section owns
  one field — `forms → ['form_schema']` becomes `forms → ['forms']` under D-09/D-12.

### Established Patterns
- **One section ↔ one field** — the builder's section payload discipline (BLD-02/07); the `forms`
  section must continue to patch exactly one definition field.
- **`.strict()` builder payloads** — an unlisted field is rejected inline with the field named
  (BLD-07); `forms[]` elements must be equally strict.
- **Action-scoped tools & permissions** (D-66) — a form's kind is its action, so per-form
  permissions fall out of the existing `(app, action)` model rather than a new one.
- **Frozen-claim mechanical test** (D-24) — any claim-shape change is a *failing test*; D-01/D-10
  are designed so this test does not change.

### Integration Points
- `app-definition.repository.ts` (`toDocument`/section map) — where `forms[]` lands and where the
  one-shot Migration (D-11) rewrites existing docs.
- `published-app-loader.ts` + the decision tool projection — where form-level triggers become the
  JEV tool list (D-06), still keyed by `(app, action)` (D-02).
- `publish-gate.service.ts` — the publish rule becomes "≥1 `submit` form; no trigger resolves to
  more than one form" (SC#2, D-05).
- The link-issuance path — one form-driven issuance for all kinds, carrying the form's
  `form_id`/`form_version` (SC#4).

</code_context>

<specifics>
## Specific Ideas

- **"Each form could be activated by one trigger"** — the user's framing that drove D-06/D-07; a
  form is the unit of activation, and a trigger names exactly one form.
- **"Share same collection data and users/roles"** — the user's explicit constraint behind SC#3:
  forms share the app's collection, role assignments, and routing destination; no per-form
  collection/roles/connector.
- The four kinds were named by the user as **list / edit / new / show**; D-01 maps these onto the
  frozen actions (`new`→`create`/`submit`, `show`→`view`).

</specifics>

<deferred>
## Deferred Ideas

- **Per-form RBAC / per-form visibility** — the user chose shared roles; a later phase may add
  per-form field visibility or a role-gated `list`. Not in Phase 7.
- **Independent per-form versioning with per-form rollback** — D-10 deliberately keeps one app
  history; a per-form history/rollback surface is a candidate future enhancement.
- **Triggers on `show`/`edit`** (e.g. "show my last ticket") — excluded by D-08 because each needs
  a target-resolution rule (which submission?) that is out of scope here.
- **App-authored vs per-user saved queries for `list` forms** — D-04 reuses the Phase-4 saved-query
  path; the ownership question (app-owned vs user-owned saved queries) was raised and left to the
  planner to confirm against Phase-4's existing model rather than decided here.

</deferred>

<corrections>
## Corrections from research (2026-10-17)

Locked decisions stand; several **rationales** asserted in them were factually wrong and are
corrected here so the planner does not inherit a false premise. Evidence: `07-RESEARCH.md`
(in-repo, read this session with line-range + verbatim citations).

- **D-12 count is wrong: it is 13 → 12, not 12 → 11.** `SectionNameSchema` has **13** entries
  `[VERIFIED: packages/contract/src/builder/app-definition.contract.ts:61-75]`. Four mirror lists
  must change together: `apps/app-builder/src/sections.ts`, both `SECTION_FIELDS` copies, and
  `APP_SECTION_PERMISSIONS`. Their doc comments already say "twelve" against 13 entries
  (pre-existing drift). Stored custom-role grants naming `'triggers'` are orphaned and need
  rewriting by the migration.
- **D-02's "no routing change" is false.** The worker catalog is **hardcoded**
  (`apps/worker/src/worker.module.ts:44-70` — one inline `leave-request` demo + `RuleBasedProvider`);
  `RoutingOutcome`/`PublishedApp` carry no `action`; the tool projection has no form notion. Making
  a builder-published app routable is real work, not a no-op.
- **D-05's "preserves today's rule" is false.** `PublishGateService.evaluate()` has **no** form rule
  at all — it only requires `form_schema !== null` via a different path. D-05 **adds** the
  ≥1-`submit`-form rule; it does not preserve one. `assertRegistersTriggers` is dead code.
- **The migration is two collections, not one.** `app_definition_versions` snapshots also carry the
  retired shape; `rollback()` (`app-definition.service.ts:264-277`) spreads a retained snapshot back
  into the live doc, so an unmigrated snapshot silently resurrects `form_schema` + app-level
  `triggers` and drops `forms[]` — a data-corruption path. Migrate both collections in one run.
- **`apps` is a shape union.** Minimal platform docs (e.g.
  `provisioning/apps/leave-request.json`) carry no `form_schema` and must be **skipped** by the
  migration filter (only docs where `form_schema` is present).

### Open Question for the planner (design checkpoint required)

- **The mockup does not depict the in-form trigger panel.** `prototypes/mockup.html` `tabForms`
  (lines ~1158-1186) is a form list + "New form" button + Versioning card, with a separate
  top-level `tabTriggers` retained. Per `AGENTS.md` rule 3 ("absence is not permission"), D-12's
  panel placement/fields/copy must be confirmed with a `checkpoint:human-verify` rather than
  improvised.

</corrections>

---

*Phase: 7-Multi-Form Apps & Per-Form Triggers*
*Context gathered: 2026-10-17 (corrections appended after research)*
