# Phase 7: Multi-Form Apps & Per-Form Triggers - Research

**Researched:** 2026-10-17
**Domain:** App-definition schema migration (single-form → form set), trigger→form routing, per-form versioning against a frozen JWT claim set
**Confidence:** MEDIUM-HIGH (in-repo facts HIGH; several load-bearing phase assumptions in CONTEXT.md are contradicted by the current code — see Summary and Common Pitfalls)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Form kinds & the action mapping**
- **D-01:** A form's `kind` is **exactly** the frozen read-link `action` (D-21): `submit`→`create`, `list`→`query`, `show`→`view`, `edit`→`edit`. No new enum — the wire's `action` **is** the kind. `notification` and `draft` are **not** form kinds (notification is a link class bound to the submitter per D-21; `draft` is reserved). — **Reversibility:** one-way — the action enum is frozen at `packages/contract/src/links/read-link-claims.ts` (D-21) and reusing it as the kind vocabulary binds the domain taxonomy to a published contract; introducing a separate kind enum later means a second taxonomy mapped onto the frozen actions, plus every outstanding link and every stored `forms[]` element is interpreted through it.
- **D-02:** **At most one form per kind per app.** `submit`, `list`, `show`, `edit` are each singular within an app. `form_id` is therefore derivable from the kind, and the router's existing `(tool_id = app_id, action)` resolution (D-64) still identifies the form with **no routing change**. — **Reversibility:** costly — undoing this means the JEV tool list must expose form-level identity so the model can distinguish two forms sharing an action, which touches the tool-descriptor projection, the decision contract, and the builder.

**Read forms — projection vs FormIO schema**
- **D-03:** The `show` (view) form renders the app's **`submit` schema read-only** via FormIO (reuses D-68). `show` is a thin **config** — which fields to surface, ordering, read-only derived fields — **not** a second schema, so it cannot drift from what was submitted. — **Reversibility:** reversible.
- **D-04:** The `list` (query) form **reuses the Phase-4 saved-query + viewer-row projection** (frozen `query` action, `target_id = query_id`, D-80/D-82). A `list` form is a reference to a saved query plus column config — **no new FormIO schema** and no second render path. — **Reversibility:** costly — if a `list` later needs its own FormIO schema, the read path gains a second render route that must be reconciled with the query DSL.
- **D-05:** **`submit` is mandatory** for an app to publish (preserves today's publish-gate rule that `form_schema !== null`); **`list`, `show`, `edit` are optional**. An app that only wants a chat create-form stays a one-form app. — **Reversibility:** reversible.

**Trigger → form binding & routing**
- **D-06:** **Triggers live on the form.** Each form owns `{intents[], aliases[], threshold}` (the shape currently carried per-app by `PublishedApp`, D-52/D-53). The app-level `triggers` field is **retired** (migrated into the `submit` form). The JEV tool list becomes the set of **forms** that declare a trigger. — **Reversibility:** costly — D-52 put triggers on the app's publication record; moving them to forms changes `published-app-loader.ts`, the tool-descriptor projection, the publish gate, and the builder.
- **D-07:** **At most one trigger per form.** A form either is triggered or is not; a trigger is one object carrying `intents[]`/`aliases[]`, not many. A form with no trigger is reachable only via an already-issued link (the normal path for `show`/`edit`). — **Reversibility:** reversible.
- **D-08:** **Only `submit` and `list` may carry a routable trigger** — the two entry points a user starts in chat. `show`/`edit` are **link-driven only**. This is consistent with D-64, which already pairs create intents with view/query intents. — **Reversibility:** costly — allowing triggers on `show`/`edit` later would require a target-resolution rule for each kind (a `view` trigger must resolve *which* submission) that this phase deliberately avoids.

**Data model, migration & builder UX**
- **D-09:** The stored shape becomes `forms: [{ form_id, kind, schema, form_version, triggers: {intents, aliases, threshold} | null, config }]`, which **replaces both** the single `form_schema` field and the app-level `triggers` array — one array is the app's whole form set, one source of truth. — **Reversibility:** costly — a stored shape change; rolling back needs a reverse migration over every app document.
- **D-10:** **One app publish counter** (`version`). Each form's `form_version` is **derived** as the app version at which that form's schema last changed (stable per form). A single history (`app_definition_versions`, last 20) keeps rollback unchanged, and the frozen claim's separate `form_version` still means "this form's last change". Editing one form therefore does **not** move another form's `form_version` (SC#1). — **Reversibility:** costly — the shape of the `form_version` claim is compared against frozen D-21; switching to independent per-form counters later requires per-form history storage and a per-form rollback surface.
- **D-11:** **One-shot migration script**: rewrite every existing app document (`form_schema` → `forms: [{ kind: 'submit', … }]`, app `triggers` → that form's `triggers`) and update the ~10 template seeds under `packages/domain/src/builder/template/seeds/`. No dual-shape read path is maintained. — **Reversibility:** costly — once migrated, the old shape is gone; rollback is a reverse migration or a restore.
- **D-12:** The App Builder's **`Forms` tab becomes a form manager** — list the app's forms, add/remove by kind, per-form designer; **triggers are edited as a panel inside the form**. The app-level `Triggers` tab is **retired**, i.e. the section vocabulary drops 12 → 11 sections (`packages/contract` `SectionNameSchema`), so the **BLD-03 permission-matrix rows change** (the builder section list is also the permission matrix — `apps/app-builder/src/sections.ts`). — **Reversibility:** costly — `SectionNameSchema` is a contract and the section list is the permission matrix; any already-stored role/permission documents that name the `triggers` section must be handled by the migration.

### the agent's Discretion
- Exact `forms[]` element field names and the `config` payload shape per kind (`show`'s field surfacing, `list`'s column config) — the decisions fix *what* each holds, not the field spelling.
- Domain kind names (`submit`/`list`/`show`/`edit`) vs wire action names (`create`/`query`/`view`/`edit`) — D-01 makes these a fixed bijection; which side is canonical in code is an implementation choice.
- Whether `form_id` is a stored opaque id or derived from `kind` (D-02 makes derivation possible; the claim already carries `form_id`).
- How the builder presents a form's trigger panel (inline vs drawer) — subject to `prototypes/mockup.html`.

### Deferred Ideas (OUT OF SCOPE)
- **Per-form RBAC / per-form visibility** — the user chose shared roles; a later phase may add per-form field visibility or a role-gated `list`. Not in Phase 7.
- **Independent per-form versioning with per-form rollback** — D-10 deliberately keeps one app history; a per-form history/rollback surface is a candidate future enhancement.
- **Triggers on `show`/`edit`** (e.g. "show my last ticket") — excluded by D-08 because each needs a target-resolution rule (which submission?) that is out of scope here.
- **App-authored vs per-user saved queries for `list` forms** — D-04 reuses the Phase-4 saved-query path; the ownership question (app-owned vs user-owned saved queries) was raised and left to the planner to confirm against Phase-4's existing model rather than decided here.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| APP-11 | An app owns one or more forms; each form declares a kind — `submit` (new), `list`, `view` (show), `edit` — and is versioned independently with its own `form_version` | D-09 stored shape (`forms[]`); D-10 derived `form_version` from the app version at last schema change. The frozen `form_version` claim already exists and already flows through `ReadLinkClaimsSchema` [VERIFIED: packages/contract/src/links/read-link-claims.ts:96]. "Independent versioning" is a **derived read**, not a second counter — see Data Model pattern below. |
| APP-12 | A trigger (intent or slash command) activates exactly one form, not the app; a trigger that resolves to more than one form is rejected at publish | D-06/D-07 move triggers onto forms (one object per form); D-08 limits routable triggers to `submit`/`list`. The publish-time uniqueness check is **new code** — no such rule exists today (see Discrepancy #4). `declaredLabels` currently reads app-level `triggers` [VERIFIED: packages/domain/src/builder/publish-gate.service.ts:268-290]. |
| FRM-14 | Every form in an app shares the app's MongoDB collection, role assignments, and data-routing destination; a form's schema is scoped to its declared kind | App-level `roles`, `routing_config`, and the app's collection are already app-scoped, not form-scoped [VERIFIED: packages/domain/src/builder/data-access/app-definition.repository.ts:61-89 — `roles`, `routing_config`, `field_mapping` are top-level app fields]. Phase 7 must **not** introduce per-form collection/roles/connector; this is a negative requirement (assert the absence). |
| APP-04 (amended) | A published **form** declares the intents and slash commands that activate it, not the app | Amendment encoded by D-06; REQUIREMENTS.md line 164 carries the amendment note [VERIFIED: .planning/REQUIREMENTS.md:164]. |
</phase_requirements>

## Summary

Phase 7 turns an app from "one embedded `form_schema` + a flat `triggers` array" into a **container of forms**, each with a `kind` drawn from the already-frozen read-link `action` vocabulary, each with an optional per-form trigger. The migration is a stored-shape change over the `apps` collection plus the 10 template seeds, and the routing/publish path must move from app-level triggers to form-level triggers.

**The single most important finding:** several load-bearing assumptions in `07-CONTEXT.md` do **not** match the code as it ships today. The planner must treat these as *new work*, not as "no routing change":

1. **D-02 claims the router's `(tool_id = app_id, action)` resolution (D-64) "still identifies the form with no routing change".** D-64 is **not implemented**. `RoutingOutcome` carries no `action` [VERIFIED: packages/domain/src/decision/routing-orchestrator.ts:24-26], `PublishedApp`/`AuthorizedApp` have no action buckets [VERIFIED: packages/domain/src/decision/published-app-loader.ts:7-29], and `LinkIssuerService.issue` takes only `{appId, realUserId}` [VERIFIED: packages/domain/src/links/link-issuer.service.ts:1-16]. There is no `action` anywhere in the routing path.
2. **The worker's routing catalog is hardcoded to a single demo app.** `worker.module.ts` constructs `PublishedAppLoader` with one inline `leave-request` entry and a hardcoded `RuleBasedProvider` [VERIFIED: apps/worker/src/worker.module.ts:44-70]. Builder-published apps **never reach chat routing**. SC#2 ("a trigger resolves to exactly one form") and SC#4 ("a signed link issued by the same form-driven path") are unachievable without wiring the loader to the `apps` collection.
3. **There is no publish-gate rule that a form exists.** D-05 says it "preserves today's publish-gate rule that `form_schema !== null`" — no such rule exists. `PublishGateService.evaluate()` checks only share-drops and description collisions [VERIFIED: packages/domain/src/builder/publish-gate.service.ts:90-220]; the only `form_schema !== null` reference is a change-summary row [VERIFIED: packages/domain/src/builder/publish-gate.service.ts:397]. Phase 7 **adds** the "≥1 `submit` form" rule rather than preserving it.
4. **`SectionNameSchema` has 13 entries, not 12.** D-12 says "drops 12 → 11". The enum has 13 members and `triggers` is one of them [VERIFIED: packages/contract/src/builder/app-definition.contract.ts:61-75]. After retiring `triggers` it becomes **13 → 12**, and every mirroring list must change together: `sections.ts:16-65`, `SECTION_FIELDS` [VERIFIED: packages/domain/src/builder/data-access/app-definition.repository.ts:98-114], and `APP_SECTION_PERMISSIONS` [VERIFIED: packages/domain/src/authz/builder-ability.ts:42-56].
5. **`assertRegistersTriggers` is dead code today.** It is defined [VERIFIED: packages/domain/src/builder/app-definition.service.ts:319-325] but called by no production path; the worker's slash binding is a hardcoded map `SLASH_COMMAND_APP = { '/leave request': 'leave-request', '/leave': 'leave-request' }` [VERIFIED: apps/worker/src/processors/inbound-event.processor.ts:43-46]. A per-form trigger cannot be enforced through a hardcoded map.

**Primary recommendation:** Treat Phase 7 as three separable workstreams, not one: (a) a **deterministic data migration** of `apps` + seeds (mirroring the `saved-query.backfill.ts` boot-migration pattern), (b) a **routing-catalog de-hardcoding** (loader reads published definitions; a form-level tool projection carries kind→action), and (c) a **builder UX restructure** (`Forms` manager + in-form trigger panel, `Triggers` tab retired). Plan the migration first and make it idempotent; the routing and UX work both depend on the new shape being readable.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Form set storage (`forms[]`) | Database / Storage | — | The shape lives in the `apps` MongoDB collection; the repository owns the write. `AppDefinitionDocument` is the document type [VERIFIED: app-definition.repository.ts:61-89]. |
| Section-patch shape discipline (one section ↔ one field) | API / Backend | Frontend SPA | `applySectionPatch` copies only `SECTION_FIELDS[section]` fields [VERIFIED: app-definition.repository.ts:122-137]; the SPA mirrors the map in `sections.ts` [VERIFIED: apps/app-builder/src/sections.ts:49-65]. Both must agree. |
| Trigger→form uniqueness enforcement | API / Backend (publish gate) | — | SC#2/APP-12 require rejection **at publish**, not routing time. The gate is `PublishGateService.evaluate()` [VERIFIED: publish-gate.service.ts:90]. |
| Published-form catalog (JEV tool list) | API / Backend (decision tier) | — | `PublishedAppLoader` + `publishedAppFromDefinition` project definitions into the routing catalog [VERIFIED: publish-gate.service.ts:299-316]. Today the worker hardcodes this — must be de-hardcoded. |
| Form-driven link issuance | API / Backend (worker) | — | `LinkIssuerService.issue` is the single issuance seam [VERIFIED: link-issuer.service.ts:14-16]; must carry `form_id`/`form_version`/`action`. |
| Read verification (`view`/`query`/`edit`) | API / Backend (read path) | — | `ReadVerifierService` already verifies per-action [VERIFIED: read-verifier.service.ts:275-307]. **No change required** — it never reads `form_id`/`form_version`. |
| Form manager + per-form designer + in-form trigger panel | Browser / Client (SPA) | — | `apps/app-builder` — `FormDesignerPage.tsx` is today a single-schema designer [VERIFIED: apps/app-builder/src/form-designer/FormDesignerPage.tsx:330-526]. |
| `form_version` derivation | Database / Storage | API / Backend | Derived from the app-version at last schema change; the app version is on the document [VERIFIED: app-definition.service.ts:64 — `RETAINED_VERSIONS = 20`], and history is `app_definition_versions`. |

## Standard Stack

**No new packages are required for Phase 7.** Every capability is served by the stack already pinned in `.planning/research/STACK.md`:

### Core (already installed)
| Library | Version | Purpose in Phase 7 | Why Standard |
|---------|---------|--------------------|--------------|
| `zod` | 4.6.5 | Validating the `forms[]` element shape (`.strict()`), the migration input, and the seed schema | Already the single validation language [CITED: .planning/research/STACK.md §4.2]. `TemplateSeedSchema` uses `.strict()` [VERIFIED: template.seed.ts:132-158]. |
| native `mongodb` driver | 7.7.0 | The migration script's read/write over `apps`, `templates`, `app_definition_versions` | No Mongoose — the app schema is runtime-defined [CITED: .planning/research/STACK.md §4.3]. |
| `@nestjs/*` | 12.1.2 | Boot wiring for the migration step | [CITED: .planning/research/STACK.md §4.1]. |
| `@formio/js` | 5.6.1 | Unchanged — the per-form designer reuses the same builder | [CITED: .planning/research/STACK.md §9.2]. |
| `vitest` | 5.0.3 | Migration + gate + projection tests | [VERIFIED: package.json `test` = `vitest run`]. |
| `@playwright/test` | 1.63.0 | E2E for the multi-form builder UI | [CITED: .planning/research/STACK.md §10.1]. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| A one-shot migration script invoked at boot | A `mongosh` shell script run manually | The boot-invoked, idempotent script matches the established `backfillSavedQueries` precedent and needs no operator step [VERIFIED: apps/api/src/main.ts:101-105]. A manual script is a deployment-order hazard. |
| Derived `form_version` (D-10) | A stored per-form counter | Stored counters need per-form history and a per-form rollback surface — explicitly deferred [CONTEXT Deferred]. |
| Feeding the worker from `apps` via a repository | A scheduled cache refresh | Out of scope; the loader seam already exists, it is just hardcoded. |

**Installation:** none — no `npm install` needed. `package.json` already pins Node `>=24 <25` and TypeScript `6.0.3` [VERIFIED: package.json `engines`].

**Version verification:** Not applicable — Phase 7 adds no dependency. If a task discovers a need for one, it must run the Package Legitimacy Gate before install.

## Package Legitimacy Audit

**No external packages are installed in this phase.** The work is a schema/data migration plus an in-repo routing/UX restructure, all served by the existing pinned stack.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*If a task's implementation reveals a genuine need for a new package (e.g. a migration helper), run `gsd_run query package-legitimacy check --ecosystem npm <pkg>` before adding it and record the verdict here.*

## Architecture Patterns

### System Architecture Diagram

```
                    BUILDER (apps/app-builder SPA)
                     │
                     │ PATCH /apps/:id {section:'forms', patch:{forms:[…]}}
                     ▼
    ┌──────────────────────────────────────────────────────────────┐
    │ app-builder controller → AppDefinitionService.updateSection   │
    │   • validates section ∈ SectionNameSchema                     │
    │   • assertOwner(appId, actor)                                 │
    └───────────────┬──────────────────────────────────────────────┘
                    │
                    ▼
    ┌──────────────────────────────────────────────────────────────┐
    │ AppDefinitionRepository                                       │
    │   • applySectionPatch: copies ONLY SECTION_FIELDS[section]    │
    │   • $set {...withoutId} guarded on version  (optimistic)      │
    │   • snapshotVersion → app_definition_versions (last 20)       │
    └───────────────┬──────────────────────────────────────────────┘
                    │
                    ▼
              ┌───────────┐        ┌───────────────────────────┐
              │   apps    │        │ app_definition_versions   │
              │ forms[]   │        │  (whole-doc snapshots)    │
              └─────┬─────┘        └───────────────────────────┘
                    │
     ┌──────────────┴───────────────┐
     │                              │
     ▼                              ▼
 PUBLISH PATH                   ROUTING PATH
 ┌────────────────────────┐    ┌──────────────────────────────────────┐
 │ PublishGateService      │    │ InboundEventProcessor (worker)        │
 │  .evaluate():           │    │  • slash  → SLASH_COMMAND_APP (hardcoded) │
 │   • share-drop dry-run  │    │  • message→ RoutingOrchestrator.route()   │
 │   • description collision│   │      → {kind:'link', toolId}          │
 │   • [NEW] ≥1 submit form │   │  • LinkIssuerService.issue({appId,uid})│
 │   • [NEW] trigger→form   │   │      → /l/:appId?u=:uid  (unsigned)   │
 │     uniqueness           │    └──────────────┬───────────────────────┘
 └───────────┬─────────────┘                   │
             │                                  │
             ▼                                  ▼
      commitPublish (draft→published)   ┌──────────────────────┐
                                        │ ReadVerifierService   │
                                        │  view  → perm_version │
                                        │  query → query_version│
                                        │  edit  → perm_version │
                                        └──────────────────────┘
```

**Reading the diagram:** the builder write path is fully implemented and version-guarded. The publish path is implemented but enforces **no form rule**. The routing path is **hardcoded** — the loader never reads `apps`. The read-verifier path is complete and needs **no change** for Phase 7 (it never inspects `form_id`/`form_version`).

### Recommended Project Structure (new/changed files)

```
packages/domain/src/builder/
├── data-access/
│   └── app-definition.repository.ts     # CHANGE: forms[] field, SECTION_FIELDS['forms']=['forms']
├── migration/
│   └── forms-migration.ts               # NEW: one-shot idempotent app+seed migration (D-11)
├── app-definition.service.ts            # CHANGE: derived form_version read; section validation
├── publish-gate.service.ts              # CHANGE: declaredLabels reads form triggers; +submit-form rule; +trigger uniqueness
└── template/
    ├── template.seed.ts                 # CHANGE: TemplateSeedSchema gains forms[]
    └── seeds/*.json                     # CHANGE: all 10 seeds to forms[]
packages/domain/src/decision/
├── published-app-loader.ts              # CHANGE: form-level catalog (form_id + action)
└── form-tool-projection.ts              # NEW (optional): definition → form-level ToolDescriptor
apps/app-builder/src/
├── sections.ts                          # CHANGE: retire 'triggers', forms → ['forms']
└── form-designer/FormDesignerPage.tsx   # CHANGE: per-form designer + in-form trigger panel
apps/worker/src/worker.module.ts         # CHANGE: real PublishedAppLoader + provider from definitions
```

### Pattern 1: One section ↔ one field (the builder's payload discipline)

**What:** A `section` patch writes exactly the fields listed in `SECTION_FIELDS[section]`; `applySectionPatch` ignores any field not listed.
**When to use:** every section edit, including the new `forms` section.
**Example:**
```typescript
// Source: packages/domain/src/builder/data-access/app-definition.repository.ts:122-137 [VERIFIED]
export function applySectionPatch(
  doc: AppDefinitionDocument,
  section: SectionName,
  patch: Record<string, unknown>,
  nextVersion: number,
): AppDefinitionDocument {
  const updated: Record<string, unknown> = { ...doc };
  for (const field of SECTION_FIELDS[section] ?? []) {
    if (field in patch) {
      updated[field] = patch[field];
    }
  }
  updated['version'] = nextVersion;
  updated['updatedAt'] = new Date();
  return updated as unknown as AppDefinitionDocument;
}
```
**Consequence:** `SECTION_FIELDS['forms']` must change from `['form_schema']` to `['forms']` in **both** [VERIFIED: app-definition.repository.ts:107] and [VERIFIED: apps/app-builder/src/sections.ts:58]. Forgetting either silently drops the whole form set.

### Pattern 2: Derived `form_version` (no second counter)

**What:** `form_version` is read off the app's retained history, not stored per form. It is "the app version at which this form's schema last changed".
**When to use:** anywhere a link is issued or a submission is recorded (SC#1, SC#5).
**Implementation note:** the app document carries a single `version` [VERIFIED: app-definition.repository.ts:69]; whole-doc snapshots live in `app_definition_versions` [VERIFIED: app-definition.repository.ts:170-174]. A derived read compares the current form's `schema` against each retained snapshot's form of the same `kind`, taking the highest version where it differs. **This read must be cheap** — issuing a link is on the hot path (webhook ack contract requires the receiver to be pure; issuance itself runs in the consumer).
**Warning:** D-10 assumes rollback is unchanged and history is one array. See Runtime State Inventory — pre-migration snapshots break this.

### Pattern 3: Idempotent boot migration (the D-11 precedent)

**What:** an insert-if-absent / replace-if-changed migration invoked at boot, best-effort, re-runnable from every process.
**When to use:** the D-11 one-shot migration and the seed update.
**Example:**
```typescript
// Source: packages/domain/src/builder/saved-query.backfill.ts:34-56 [VERIFIED] (precedent shape)
export async function backfillSavedQueries(mongo: MongoService): Promise<number> {
  const collection = mongo.db().collection<SavedQueryRecord>('saved_queries');
  let inserted = 0;
  for (const record of seed) {
    const existing = await collection.findOne({ app_id: record.app_id, query_id: record.query_id });
    if (existing !== null) continue;          // key taken — never clobber
    await collection.insertOne({ ...record });
    inserted += 1;
  }
  return inserted;
}
```
Invoked at boot after `TemplateSeed.load()` [VERIFIED: apps/api/src/main.ts:96-105]. **Note:** the worker bootstrap does **not** run these steps today (only the API does) — if the migration must run wherever routing runs, wire it into the worker too, or make the worker tolerant of un-migrated docs.

### Pattern 4: `.strict()` on every stored payload

**What:** an unlisted field is rejected at parse, named inline.
**When to use:** the `forms[]` element schema and the `TemplateSeedSchema`.
**Example:** `TemplateSeedSchema` is `.object({...}).strict()` [VERIFIED: template.seed.ts:132-146]; a seed JSON containing `forms` is **rejected** until the schema is updated in the same change. The content-hash guard then replaces the stored template on next boot [VERIFIED: template.seed.ts:236-257].

### Anti-Patterns to Avoid
- **Dual-shape reads:** D-11 forbids a read path that accepts both `form_schema` and `forms`. Do not add a compatibility branch; migrate instead.
- **Per-form collection/roles/connector:** FRM-14 forbids it. Forms share the app's `roles` and `routing_config`.
- **A second `form_version` counter:** D-10 forbids it; derive.
- **Enforcing trigger uniqueness at routing time:** SC#2 requires publish-time rejection.
- **Editing `read-link-claims.ts` or `read-link-claims.frozen.spec.ts`:** D-01/D-10 are designed so the frozen claim-set test does **not** change. The V1 array and 6-action enum assertions are the one-way contract [VERIFIED: packages/contract/src/links/read-link-claims.frozen.spec.ts:22-79].

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Migration idempotency | A bespoke "has this run?" flag collection | Idempotent per-document transforms (insert-if-absent / replace-if-changed) | The `backfillSavedQueries` pattern already proves re-runnable-at-every-boot is safe [VERIFIED: saved-query.backfill.ts:1-19]. A run-flag is state that can diverge from reality. |
| Optimistic concurrency on the migration write | A new locking scheme | The repository's version-guarded `findOneAndUpdate` [VERIFIED: app-definition.repository.ts:272-276] | The existing guard already handles concurrent edits; a migration that bypasses it can clobber a concurrent builder edit. |
| FormIO schema for `show`/`list` | A second schema or a custom renderer | `show` renders the `submit` schema read-only; `list` reuses the Phase-4 viewer-row projection (D-03/D-04) | Two schemas drift; the frozen `view`/`query` actions already define the semantics. |
| Trigger matching | A new matcher | The existing `declaredLabels` + JEV routing path | The label union is already what the intent set, share computation, and provider match on [VERIFIED: publish-gate.service.ts:292-316]. |
| Versioning history | A per-form history collection | `app_definition_versions` (last 20) [VERIFIED: app-definition.service.ts:64, 457-472] | Per-form history is explicitly deferred [CONTEXT Deferred]. |

**Key insight:** Phase 7 is a **reuse-and-reshape** phase, not a greenfield one. Nearly every primitive exists; the traps are in the *assumptions* (D-64 exists, triggers gate at publish, the mockup has an in-form trigger panel) rather than in missing libraries.

## Runtime State Inventory

> This is a **migration/refactor phase**. A grep audit finds files; it does not find runtime state. Each category below is answered explicitly — "None" means researched and found empty, not un-checked.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | (1) **`apps` collection** — every user-authored / forked document carries `form_schema` + `triggers` [VERIFIED: app-definition.repository.ts:61-89]. The collection is a **shape union**: platform apps carry a minimal `AppDocument` (`app_id`, `connector_ref`) with no `form_schema` [VERIFIED: provisioning/apps/leave-request.json]; only `AppDefinitionDocument` docs carry the old shape. (2) **`app_definition_versions`** — whole-document snapshots, last 20, written by every mutation [VERIFIED: app-definition.repository.ts:170-174, app-definition.service.ts:457-472]. (3) **`templates`** — 10 platform-owned docs, each `{…, content_hash, owner:'platform', loadedAt}`; the seeds carry `form_schema` + `triggers` [VERIFIED: template.seed.ts:107-158; leave-request.json:9,22-24]. (4) **`saved_queries`** — keyed `(app_id, query_id)`, unaffected by the shape change but read by the `list` form (D-04) [VERIFIED: saved-query.backfill.ts:34-56]. (5) **`submissions`** — already carries `form_id` + stores `form_schema` on the record [VERIFIED: packages/domain/src/submissions/submission.repository.ts:20]; **no schema migration needed** — `form_id` already flows through viewer rows and CSV export. (6) **`routing_outcomes`** — records `{routing_id, intent_label, app_id}` only; **no form/action** column today [VERIFIED: inbound-event.processor.ts:424-448]. | **Data migration** — rewrite `apps` docs carrying `form_schema` into `forms: [{kind:'submit', …}]`, fold app `triggers` into that form. **Snapshot rewrite** — `app_definition_versions` snapshots hold the old shape and must be migrated too (see hazard row). **Seed migration** — update the 10 seed JSONs AND `TemplateSeedSchema` in the same commit (the `.strict()` schema rejects `forms` until then). **Code edit** — `routing_outcomes` needs no migration unless SC#2's per-form attribution is required for the share gauge. |
| **Live service config** | **None in git that stores an app/form/trigger string.** `compose.dev.yml` is a loopback-only dev stack (mongo + two redis) with no product data [VERIFIED: compose.dev.yml]. `provisioning/` holds `apps/leave-request.json`, `forms/leave-request.form.json`, `identity.csv`, `profiles.csv` — but **no code loads them** (`packages/cli/index.ts` only calls `runConnectorLoader`; `provision.ts` reads connector seeds) [VERIFIED: packages/cli/index.ts:1-20]. They are committed Phase-2 artifacts, not live config. `config/connectors/redmine.dev.json` is connector scope, not form scope. | **Verify, then decide.** The `provisioning/forms/leave-request.form.json` carries a `form_id` and a `version` but **no `kind`** [VERIFIED: provisioning/forms/leave-request.form.json]. It is not loaded today; if Phase 7 decides it is still a documentation artifact, update it for consistency or delete it — do not leave a second, stale form shape in the tree. No live-service state to patch. |
| **OS-registered state** | **None.** No Dockerfile, no Kubernetes/Helm/Terraform manifests, no systemd units, no launchd plists, no pm2 `ecosystem.config`, no cron entries referencing the renamed shape. Verified by a filesystem search across the repo. | **None — verified by filesystem search.** |
| **Secrets / env vars** | The read-link env keys are `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_READ_PUBLIC_KEY` (+ `JWT_READ_PUBLIC_KEY_PREVIOUS` during the 90-day rotation), and `RENDERER_ORIGIN` [CITED: README.md:130-174]. Crypto keys: `CRYPTO_KEY_PROVIDER` (`local`/`kms`) and `CRYPTO_LOCAL_KEY_FILE` [VERIFIED: .env.example]. Data URLs: `MONGO_URL`, `REDIS_CACHE_URL`, `REDIS_QUEUE_URL` [VERIFIED: .env.example]. **No secret or env var name references the app-level `triggers` concept or the form shape.** | **None.** The rename does not touch any secret key name; no env var carries a form/trigger identity. Code that reads these keys is unaffected. |
| **Build artifacts / installed packages** | (1) **`templates.content_hash`** — a stored sha256 over the seed content [VERIFIED: template.seed.ts:180-185]; when the seeds change, the hash changes and the loader **replaces** the stored template on the next boot [VERIFIED: template.seed.ts:236-257]. This is a *feature* for the migration — no manual template step — but it also means a partially-updated seed set replaces only the seeds that changed. (2) `packages/domain/dist/` and `packages/cli/dist/` contain compiled copies of the old shape [VERIFIED: packages/domain/dist/authz/builder-ability.d.ts]; they are build output, regenerated by a build. (3) No docker image tags, no pip egg-info, no global npm installs relevant here. | **Rebuild** after source changes (`dist/` is stale by definition). **No manual template migration** — the content-hash guard handles it once schema + seeds change together. |

**The canonical question — after every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?**

Answer: **the two stored collections** (`apps` and `app_definition_versions`) hold the old shape in live MongoDB; `templates` self-heals via the content-hash guard. Nothing at the OS level, nothing in a secret name, nothing in an external service's UI.

### ⚠️ The `app_definition_versions` snapshot hazard (load-bearing for D-10)

`rollback()` re-writes a **whole retained snapshot** back into the app document:

```typescript
// Source: packages/domain/src/builder/app-definition.service.ts:264-277 [VERIFIED]
const restored: AppDefinitionDocument = {
  ...retained.snapshot,
  app_id: appId,
  version: current.version + 1,
  updatedAt: new Date(),
};
const { _id, ...definition } = restored;
const written = await this.repository.setLifecycle(
  appId,
  restored.lifecycle,
  { ...definition },
  current.version,
);
```

A **pre-migration snapshot** carries `form_schema` + `triggers` and lacks `forms`. Rolling back to it would re-introduce the old shape into a migrated app and silently undo the migration for that document.

D-10 asserts "a single history (`app_definition_versions`, last 20) keeps rollback unchanged". That holds **only if the migration also rewrites the retained snapshots** (or makes rollback shape-aware, or drops history). The planner must choose one and encode it as an explicit task:

1. **Migrate every retained snapshot** in place (transform snapshots the same way as the app doc). Preserves rollback; costs a second pass over `app_definition_versions`.
2. **Shape-aware rollback** — transform on restore. Leaves old snapshots but guarantees the restored shape is current.
3. **Drop retained history** for migrated apps. Loses APP-03's rollback for existing apps — likely unacceptable.

**Recommendation:** option 1 (migrate snapshots) — it is the only one that keeps APP-03 ("the last 20 versions are retained for rollback") true *and* keeps one read path. Note this makes the migration a **two-collection** transform, not the single-collection transform D-11 implies.

## Common Pitfalls

### Pitfall 1: "D-64 exists, so routing needs no change" (D-02's core claim is false)
**What goes wrong:** A plan treats form→link routing as already solved and allocates no tasks to the routing path. At execution, `list`/`show`/`edit` links cannot be issued with the right `action`, because no code carries an action.
**Why it happens:** D-02 says the router's existing `(tool_id = app_id, action)` resolution (D-64) "still identifies the form with no routing change". D-64 was decided in Phase 4 but is **not implemented**: `RoutingOutcome` is `{kind:'link', toolId} | {kind:'clarify', toolIds}` with no action [VERIFIED: routing-orchestrator.ts:24-26]; `PublishedApp`/`AuthorizedApp` expose `tool/intents/aliases/threshold` only [VERIFIED: published-app-loader.ts:7-29]; `LinkIssuerService.issue` takes `{appId, realUserId}` [VERIFIED: link-issuer.service.ts:1-16].
**How to avoid:** Plan real tasks: extend the tool descriptor/projection to carry `action`, extend `RoutingOutcome` (or the issuance seam) to carry the resolved kind, and extend `IssueLinkInput` with `formId`/`formVersion`/`action`.
**Warning signs:** a plan task description containing "no routing change" or "reuses D-64".

### Pitfall 2: The worker routes from a hardcoded demo app
**What goes wrong:** SC#2 ("a trigger resolves to exactly one form") and SC#4 ("a signed link issued by the same form-driven path") pass unit tests but fail end-to-end because the worker never sees builder-published apps.
**Why it happens:** `worker.module.ts` hardcodes `PublishedAppLoader` with a single inline `leave-request` entry and a hardcoded `RuleBasedProvider` map [VERIFIED: worker.module.ts:44-70]. `SLASH_COMMAND_APP` is a hardcoded two-entry map [VERIFIED: inbound-event.processor.ts:43-46]. `publishedAppFromDefinition` is used only by the publish gate and `app-builder.module.ts`.
**How to avoid:** Make the worker's `PublishedAppLoader` read published definitions (via a repository/`listPublished()`), and replace the hardcoded slash map with a lookup over the forms that declare a slash trigger. Add an integration test that publishes an app **then** routes to it.
**Warning signs:** a routing test that constructs its own catalog instead of publishing through the API.

### Pitfall 3: The publish gate enforces no form rule (D-05's "preserves today's rule" is false)
**What goes wrong:** D-05 is read as "keep the existing `form_schema !== null` gate". No such gate exists, so APP-12's "trigger that resolves to more than one form is rejected at publish" gets no implementation.
**Why it happens:** `PublishGateService.evaluate()` checks only share-drops and description collisions [VERIFIED: publish-gate.service.ts:90-220]. The only `form_schema !== null` reference is a change-summary row [VERIFIED: publish-gate.service.ts:397]. `assertRegistersTriggers` is defined but never called [VERIFIED: app-definition.service.ts:319-325].
**How to avoid:** Add new gate rules explicitly: (a) at least one `kind:'submit'` form exists; (b) no trigger label resolves to more than one form within the app; (c) only `submit`/`list` forms carry triggers (D-08). Test each as a blocked-publish case.
**Warning signs:** a plan that says "preserve the publish rule".

### Pitfall 4: The section count is 13, not 12
**What goes wrong:** D-12 says "drops 12 → 11 sections". Following that literally produces an off-by-one: the real change is 13 → 12, and one of the four mirroring lists is missed, so the permission matrix and the section-field map disagree.
**Why it happens:** the enum has 13 members [VERIFIED: app-definition.contract.ts:61-75] and every mirror list also has 13 [VERIFIED: sections.ts:16-65; app-definition.repository.ts:98-114; authz/builder-ability.ts:42-56]. Doc comments in all of them say "twelve" — pre-existing drift.
**How to avoid:** Change `SectionNameSchema` and **all four** mirrors in one task; grep for `'triggers'` and `SectionName` to find every consumer. Update the "twelve" doc comments.
**Warning signs:** any diff that edits `SectionNameSchema` without editing `APP_SECTION_PERMISSIONS`.

### Pitfall 5: Retiring the `triggers` section orphans stored role grants
**What goes wrong:** A custom role stored in `role_assignments[].permissions` may name `'triggers'` [VERIFIED: authz/builder-ability.ts:83-88 — `permissions?: readonly AppSectionPermission[]`]. After the enum drops it, that stored value is no longer a valid `AppSectionPermission`, and `createBuilderAbility` silently grants nothing for it (it just iterates the array) [VERIFIED: authz/builder-ability.ts:165-167] — but any validation that parses stored assignments against the enum will now fail.
**Why it happens:** D-12 flags this ("any already-stored role/permission documents that name the `triggers` section must be handled by the migration") but the migration scope in D-11 mentions only `form_schema`/`triggers` on the app doc.
**How to avoid:** The migration must also rewrite `role_assignments` (and any `roles_permissions` payload) to drop or remap the `'triggers'` grant. The section is retired, so dropping the grant is correct (its capability moves inside the form).
**Warning signs:** a migration that only touches `form_schema`/`triggers`.

### Pitfall 6: Seed schema coupling — a seed with `forms` is rejected until the schema changes
**What goes wrong:** A task updates the 10 seed JSONs to `forms[]` but not `TemplateSeedSchema`, and boot throws `AppDefinitionValidationError` — the gallery fails to load.
**Why it happens:** `TemplateSeedSchema` is `.strict()` and lists `form_schema` + `triggers` [VERIFIED: template.seed.ts:132-146]; `.strict()` rejects the unknown `forms` key.
**How to avoid:** Update `TemplateSeedSchema` and the seeds in the same commit. The content-hash guard then replaces the stored templates on next boot automatically [VERIFIED: template.seed.ts:236-257] — no manual template migration.
**Warning signs:** a diff touching `seeds/*.json` without touching `template.seed.ts`.

### Pitfall 7: `apps` is a shape union — migrate only definition docs
**What goes wrong:** A migration `updateMany({}, …)` rewrites platform apps (which have no `form_schema`) and either creates spurious `forms: []` or corrupts the minimal `AppDocument`.
**Why it happens:** `provisioning/apps/leave-request.json` shows the platform shape is `{app_id, name, status}` with no `form_schema` [VERIFIED: provisioning/apps/leave-request.json].
**How to avoid:** Filter the migration on docs that actually carry the old shape: `{ form_schema: { $exists: true } }` (or those lacking `forms`).
**Warning signs:** a migration with an empty filter.

### Pitfall 8: The mockup does not contain an in-form trigger panel
**What goes wrong:** The plan cites the mockup as the source of truth for the in-form trigger panel (as CONTEXT's canonical_refs does) and finds nothing to follow.
**Why it happens:** `prototypes/mockup.html` keeps a **separate top-level `triggers` tab** (`tabTriggers`, lines 1093-1117) *and* a `forms` tab (`tabForms`, 1158-1186). `tabForms` is a list + "New form" button + a Versioning card; it has **no** in-form trigger panel and no per-form designer, and `tabTriggers` still reads `app.triggers` [VERIFIED: prototypes/mockup.html:1093-1117, 1158-1186].
**How to avoid:** Per `AGENTS.md` rule 3 ("absence is not permission"), the in-form trigger panel's layout is **not** specified by the mockup — it needs a design decision (or an update to the mockup) before implementation. The mockup **does** already model multi-form entries: `{id:"create-leave", label:"Create leave", version:2, action:"create", perm:"leave:create", fields:14}` [VERIFIED: prototypes/mockup.html:546-547] — reuse that element vocabulary and the `:root` tokens.
**Warning signs:** a UI task that claims to "follow the mockup's trigger panel".

## Code Examples

Verified patterns from the current codebase (verbatim, with line ranges).

### The frozen action enum is the kind vocabulary (D-01)
```typescript
// Source: packages/contract/src/links/read-link-claims.ts:47-67 [VERIFIED]
export const ReadLinkActionSchema = z.enum([
  'create',
  'edit',
  'view',
  'query',
  'notification',
  'draft',
]);

export type ReadLinkAction = z.infer<typeof ReadLinkActionSchema>;

/** `action` → what `target_id` means, and whether `target_id` is present at all (D-21). */
export const READ_LINK_TARGET_RULES: Readonly<Record<ReadLinkAction, string>> =
  Object.freeze({
    create: 'absent — a create link opens a blank form',
    edit: 'submission_id',
    view: 'submission_id',
    query: 'query_id',
    notification: 'absent — the link is bound to the original submitter instead',
    draft: 'draft_id — reserved with the class (D-22); not emitted in v1',
  });
```
**Kind mapping (D-01):** `submit`↔`create`, `list`↔`query`, `show`↔`view`, `edit`↔`edit`. `notification` and `draft` are **not** kinds.

### The frozen claim set — the keys Phase 7 must not change
```typescript
// Source: packages/contract/src/links/read-link-claims.ts:77-123 [VERIFIED, abridged]
export const ReadLinkClaimsSchema = z
  .object({
    iss: z.string().min(1),
    aud: z.string().min(1),
    sub: opaqueId,
    jti: opaqueId,
    iat: numericDate,
    nbf: numericDate,
    exp: numericDate,
    action: ReadLinkActionSchema,
    app_id: opaqueId,
    form_id: opaqueId,
    form_version: versionNumber,
    app_version: versionNumber,
    perm_version: versionNumber,
    query_version: versionNumber,
    target_id: opaqueId.optional(),
  })
  .strict()
  .refine(
    (claims) => claims.exp - claims.iat <= MAX_READ_LINK_TTL_SECONDS,
    { message: READ_LINK_TTL_EXCEEDS_CEILING, path: ['exp'] },
  );
```
`form_id` and `form_version` are **already per-form claims** — D-01/D-10 add nothing to this set, so the frozen test need not change:
```typescript
// Source: packages/contract/src/links/read-link-claims.frozen.spec.ts:22-38 [VERIFIED]
const V1 = [
  'action', 'app_id', 'app_version', 'aud', 'exp', 'form_id', 'form_version',
  'iat', 'iss', 'jti', 'nbf', 'perm_version', 'query_version', 'sub', 'target_id',
] as const;
```

### The stored shape today (what the migration rewrites)
```typescript
// Source: packages/domain/src/builder/data-access/app-definition.repository.ts:61-89 [VERIFIED, abridged]
export interface AppDefinitionDocument {
  readonly _id?: string;
  readonly app_id: string;
  readonly name: string;
  readonly description: string;
  readonly data_mode: AppDataMode;
  readonly lifecycle: AppLifecycleState;
  readonly version: number;
  readonly tags: readonly string[];
  readonly form_schema: Record<string, unknown> | null;
  readonly triggers: readonly Record<string, unknown>[];
  readonly roles: Record<string, unknown>;
  readonly routing_config: Record<string, unknown> | null;
  readonly field_mapping: Record<string, unknown> | null;
  // …retention_policy, deprecation_notice, lifecycle_prefs, jev_behavior,
  //   role_assignments, roles_permissions, versioning_policy, metadata, timestamps
}
```

### The section-field map (both copies must change)
```typescript
// Source: packages/domain/src/builder/data-access/app-definition.repository.ts:98-114 [VERIFIED, abridged]
const SECTION_FIELDS: Readonly<Record<SectionName, readonly string[]>> = Object.freeze({
  general: ['name', 'description'],
  metadata: ['tags', 'data_mode'],
  triggers: ['triggers'],
  // …
  forms: ['form_schema'],   // ← becomes ['forms']
  // …
});
```
```typescript
// Source: apps/app-builder/src/sections.ts:49-65 [VERIFIED, abridged] — the SPA mirror
export const SECTION_FIELDS: Readonly<Record<AppSection, readonly string[]>> = {
  // …
  triggers: ['triggers'],
  forms: ['form_schema'],   // ← becomes ['forms']
  // …
};
```

### Trigger labels today (app-level; must read forms)
```typescript
// Source: packages/domain/src/builder/publish-gate.service.ts:268-290 [VERIFIED]
export function declaredLabels(definition: AppDefinitionDocument): string[] {
  const labels: string[] = [];
  for (const trigger of definition.triggers ?? []) {
    const declared = [
      ...(Array.isArray(trigger.intents) ? trigger.intents : []),
      ...(Array.isArray(trigger.aliases) ? trigger.aliases : []),
    ].filter((label): label is string => typeof label === 'string' && label.length > 0);
    if (declared.length > 0) { labels.push(...declared); continue; }
    for (const key of ['id', 'command'] as const) {
      const value = trigger[key];
      if (typeof value === 'string' && value.length > 0) labels.push(value);
    }
  }
  return [...new Set(labels)];
}
```
Note the fallback: seeds store `{id, type:"slash", command, description}` [VERIFIED: seeds/leave-request.json:22-24] so they hit the `id`/`command` fallback, not the `intents`/`aliases` branch.

### The published-app projection (catalog shape D-06 moves to forms)
```typescript
// Source: packages/domain/src/builder/publish-gate.service.ts:299-316 [VERIFIED]
export function publishedAppFromDefinition(definition: AppDefinitionDocument): PublishedApp {
  const labels = declaredLabels(definition);
  return {
    id: definition.app_id,
    description: definition.description,
    parameters: [],
    intents: labels,
    aliases: labels,
    threshold: thresholdOf(definition),
    status: definition.lifecycle as PublishedApp['status'],
  };
}
```

### The two `.strict()` payloads the migration must respect
```typescript
// Source: packages/domain/src/builder/template/template.seed.ts:132-158 [VERIFIED, abridged]
const TemplateSeedSchema = z
  .object({
    template_id: AppIdSchema,
    name: z.string().min(1).max(200),
    description: z.string().min(1).max(2000),
    domain: z.string().min(1).max(200),
    tags: z.array(z.string()).min(1),
    data_mode: z.enum(['internal', 'external', 'hybrid']),
    connector_ref: z.string().min(1).nullable().default(null),
    form_schema: z.record(z.string(), z.unknown()),
    roles: z.record(z.string(), z.unknown()),
    triggers: z.array(z.record(z.string(), z.unknown())),
  })
  .strict()
  .refine(/* external/hybrid carry connector_ref; internal carries none */);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| One `form_schema` per app | `forms[]` with per-form `kind` | Phase 7 | The definition shape; the migration is the phase's riskiest step |
| App-level `triggers` array | Per-form `triggers` (≤1 per form) | Phase 7 (D-06/D-07) | JEV tool list becomes form-derived; `published-app-loader` + projection change |
| `view`/`query`/`edit` as standalone link classes | Form kinds over one issuance path | Phase 7 (SC#4) | One form-driven issuance for all kinds |
| 13 builder sections incl. `triggers` | 12 sections (triggers retired) | Phase 7 (D-12) | Four mirror lists change together; stored role grants naming `triggers` must be migrated |

**Deprecated/outdated:**
- Never edit `read-link-claims.ts` or `read-link-claims.frozen.spec.ts` to add a claim — that invalidates every outstanding link (D-21/D-24). Phase 7 adds none.
- Do not add a `form_schema` compatibility read path — D-11 forbids dual-shape reads.

## Assumptions Log

> Every claim below is `[ASSUMED]` — training knowledge or a reasonable inference, **not** verified
> from a source in this session. The planner must gate each behind user confirmation before it
> becomes a locked decision. Claims that *were* verified this session are tagged inline in the
> sections above and are **not** repeated here.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The in-form trigger editing surface should be a **panel inside the form detail view** (not a modal, not a wizard step). | Architecture Patterns / D-12 | Design rework; mockup does not depict it (`prototypes/mockup.html` `tabForms` L1158-1186 is a list + "New form" button + Versioning card — **no panel**). AGENTS.md rule 3 applies: absence is not permission. |
| A2 | `form_id` is a **deterministic function of `kind`** (e.g. `form_id = kind`), per D-02 "derivable from kind". | Standard Stack / migration | If `form_id` must be a stable opaque id, the migration from a single `form_schema` must synthesise one — and read links in flight could reference it. |
| A3 | `form_version` = the **app publish version at which that form's schema last changed**, tracked by diffing the form's `schema` against the prior retained snapshot at publish time. | Standard Stack (D-10) | If derivation is wrong, `form_version` never advances and the "schema change ⇒ new form_version" acceptance fails. |
| A4 | The migration runs as an **idempotent, insert-if-absent, best-effort boot step** modelled on `saved-query.backfill.ts`, invoked from `apps/api/src/main.ts` after `TemplateSeed.load()`. | Architecture Patterns (D-11) | A non-idempotent migration re-runs on every boot; a throwing migration blocks API boot. |
| A5 | The `app_definition_versions` **snapshots must also be migrated** (not only the live `apps` docs), so `rollback()` cannot re-introduce the retired shape. | Runtime State Inventory | `rollback()` spreads a pre-migration snapshot back via `setLifecycle`, silently restoring `form_schema` + app-level `triggers` and dropping `forms[]` — a data-corruption path, not a cosmetic one. |
| A6 | Migrating the 10 seed JSONs in the **same commit** as the `.strict()` `TemplateSeedSchema` change is sufficient — the content-hash guard auto-replaces changed seeds on next boot, so no separate template-data migration is needed. | Runtime State Inventory | If the guard does not fire, seeds fail `.strict()` validation and `TemplateSeed.load()` fails at boot. |
| A7 | Stored **custom-role grants naming `'triggers'`** are rare enough that the migration can rewrite them in place (map `'triggers'` → the new `'forms'`-hosted permission) rather than needing a manual remediation runbook. | Runtime State Inventory | Orphaned grants either silently disappear from role UIs or throw on render. |
| A8 | The renderer/read-verifier needs **no change** for Phase 7: `verifyView`/`verifyEdit` key on `perm_version`, `verifyQuery` keys on `query_version`, and none read `form_id`/`form_version`. SC#4 is satisfied by the existing verifier once issuance is form-driven. | Architecture Patterns (SC#4) | If a kind must gate on `form_version`, the frozen claim set (D-21/D-24) would have to grow — which would invalidate every outstanding link. |
| A9 | The **`list` kind's row projection** can reuse the Phase-4 viewer-row projection verbatim with zero schema additions (per D-04 "no new FormIO schema"). | Standard Stack (D-04) | If `list` needs fields the viewer projection does not expose, FRM-14's "schema scoped to kind" forces a schema addition the contract did not anticipate. |
| A10 | Retiring the `Triggers` section is a **hard removal** (no read-only alias, no deprecation shim) — D-12 says "retired". | Architecture Patterns (D-12) | A shim would leave two sources of truth for triggers and re-open the ambiguity D-06 closes. |
| A11 | The webhook→routing→issuance path can carry a `kind`→`action` projection **without** changing the decision model's wire contract (the model still picks a tool id; the app side maps tool→form kind→link action). | Architecture Patterns (worker de-hardcode) | If the model must emit the action, the JEV wire contract (D-23, frozen) changes — a Phase-1 frozen-contract violation. |
| A12 | Phase 7 issues **no signed links** (blocked on FND-10, `STATE.md` G-13); the unsigned stand-in issuer (`link-issuer.service.ts:1-16`) remains the integration point and SC#4 is verified against it. | Architecture Patterns | If SC#4 requires a real signed link, the phase cannot close until FND-10 names a KMS vendor (`REQUIREMENTS.md:424` "Pending"). |

**If a row above is confirmed true**, the planner may fold it into the corresponding plan task
without a checkpoint. **If a row is confirmed false**, the task it touches must be re-scoped.

## Open Questions (RESOLVED)

> All five questions below are resolved by the phase plans (2026-10-18); each carries its adopting
> plan/task. The substance of each question is retained unchanged for the record.

1. **What does the in-form trigger panel look like?**
   - What we know: D-12 says "triggers edited as a panel inside the form". The mockup (`prototypes/mockup.html` L1158-1186) keeps a **separate top-level `triggers` tab** (`tabTriggers`, L1093-1117) *and* a `forms` tab that is only a list + "New form" button + Versioning card — it depicts **no** in-form trigger panel and **no** per-form designer.
   - What's unclear: the panel's information architecture — is it always visible, a collapsible region, or a modal launched from the form row? What happens to the retired `tabTriggers` — does the mockup's `triggers` tab become the panel, or does it disappear?
   - Recommendation: treat as a **design decision requiring confirmation** (AGENTS.md rule 3). The planner should add one `checkpoint:human-verify` task before the SPA trigger-panel work, offering the mockup's `tabTriggers` markup as the starting vocabulary. Do **not** silently improvise a panel.
   - **RESOLVED — adopted by 07-05 Task 1 (blocking-human checkpoint U-1):** placement/fields/copy are gated on a user ruling (inline-collapsible / designer-region / drawer offered, mockup `tabTriggers` vocabulary sanctioned) recorded in 07-05-SUMMARY.md before 07-07 builds the panel.

2. **Do pre-migration `app_definition_versions` snapshots get migrated, or does `rollback()` become shape-aware?**
   - What we know: `rollback()` (`app-definition.service.ts` L264-277) spreads the retained snapshot back into the live doc. Pre-migration snapshots carry `form_schema` + app-level `triggers` and lack `forms[]`.
   - What's unclear: whether D-10's "rollback unchanged" was written assuming snapshots are shape-compatible. They are not.
   - Recommendation: **migrate the snapshots in the same script** (recommended, A5) — it is a two-collection transform over `apps` and `app_definition_versions`. A shape-aware `rollback()` is the fallback only if snapshot migration proves infeasible. Either way this MUST be an explicit task, not left implicit.
   - **RESOLVED — adopted by 07-04 Task 1 (recommendation A5, two-collection transform):** snapshots are migrated in the same idempotent run so `rollback()` stays shape-blind; proven by form-migration.spec.ts case 5.

3. **What is the exact `form_id` derivation, and does it stay stable across a kind change?**
   - What we know: D-02 — "at most one form per kind per app; `form_id` derivable from kind".
   - What's unclear: whether a form's `form_id` may be a plain `kind` string or must be a namespaced id (`{app_id}:{kind}`), and what happens if an app is ever allowed to change a form's kind (D-02 forbids two forms of the same kind, but not a kind migration).
   - Recommendation: pick the simplest deterministic rule that cannot collide **within** an app (the app_id is already the outer key), document it in the migration script, and add a unit assertion that a definition with two forms of the same kind is rejected.
   - **RESOLVED — adopted by 07-01 Task 1 + 07-04 Task 1:** `form_id = kind` (the app_id is the outer key, so no within-app collision), documented in the `forms.contract.ts` docblock and the migration module docblock; same-kind duplicates are rejected by `updateSection` (07-01) and asserted across the suite.

4. **Is `assertRegistersTriggers` (`app-definition.service.ts` L319-325) deleted or repurposed?**
   - What we know: it is **dead code** — called by nothing. Phase 7 ADDS the real gate rule (the publish gate currently has no form rule at all — `PublishGateService.evaluate()` checks only share-drops and description collisions; its only `form_schema` reference is the change-summary row at L397).
   - What's unclear: whether the intended "≥1 `submit` form to publish" rule (D-05) belongs in `PublishGateService.evaluate()` or replaces the dead helper.
   - Recommendation: put the rule in `PublishGateService.evaluate()` (the real gate) and **delete** the dead helper. Add the APP-12 conflict rule ("a trigger resolving to >1 form is rejected at publish") in the same method.
   - **RESOLVED — adopted by 07-08 Task 1:** the ≥1-submit, trigger-uniqueness, D-08-kinds, and config-completeness rules land in `PublishGateService.evaluate()`; the dead helper is deleted (grep-zero asserted).

5. **Does the `list` kind's trigger routing need a distinct `RoutingOutcome` shape?**
   - What we know: `RoutingOutcome` today is `{kind:'link',toolId} | {kind:'clarify',toolIds}` — **no action and no kind** (`inbound-event.processor.ts` L424-448; `routing-orchestrator.ts`). `PublishedApp`/`AuthorizedApp` (`published-app-loader.ts` L7-29) have no action buckets.
   - What's unclear: whether a `list` trigger yields a link with `action: 'query'` through the *same* `RoutingOutcome` (D-02's "no routing change") or needs a new variant.
   - Recommendation: extend the tool projection (tool id → form kind → link action) **without** adding a `RoutingOutcome` variant — the outcome stays `{kind:'link',toolId}` and the action is resolved downstream at issuance. This preserves D-02's intent while acknowledging the projection change D-02 glossed over.
   - **RESOLVED — adopted by 07-08 Task 3:** `RoutingOutcome` keeps its shape; the form-scoped tool id (`app:form`) is split at the processor and the kind→action mapping resolves downstream at issuance via `FORM_KIND_TO_ACTION`.

## Environment Availability

> Phase 7 is a **type-3 mixed phase**: it edits in-repo code + data (no new external services) but its
> migration and its validation both depend on the local runtime and the container stack. Probed this
> session (2026-10-17).

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime (engines `>=24 <25`) | ✓ | v24.15.0 | — |
| npm | Workspace install + scripts | ✓ | 11.12.1 | — |
| Docker + Compose | `compose.dev.yml` dev stack (mongo:8.0, redis-cache :6379, redis-queue :6380) | ✓ | 29.8.0 | Local mongod/redis if Docker unavailable |
| MongoDB 8.0 | Migration target + integration specs | ✓ (via compose) | 8.0.x image | — |
| Redis ≥8.2 | Routing/queue specs | ✓ (via compose) | image (6379 cache / 6380 queue) | — |
| vitest | Unit + integration suite (`npm test`) | ✓ | 5.0.3 | — |
| Playwright | E2E (builder + renderer projects) | ✓ | 1.64.0 | — |
| `@playwright/test` browser binaries | E2E (chromium) | ✓ (assumed installed) | matches 1.64.0 | `npx playwright install chromium` |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None — all probed dependencies are present.

**No new package installs.** Phase 7 adds zero runtime or dev dependencies: the migration uses the
native `mongodb` driver already in the tree, the routing change edits existing modules, and the SPA
change edits existing React components. The Package Legitimacy Audit above is therefore empty by
construction.

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json` [VERIFIED: `.planning/config.json`], so this section is required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.3 (`npm test` = `vitest run`) + Playwright 1.64.0 (`npm run test:e2e`) |
| Config file | `vitest.config.mts` (alias map, `include: packages/**/*.spec.ts`, `apps/**/*.spec.ts`, `tooling/**/*.spec.ts`; `exclude: **/e2e/**`; `setupFiles: ./test/setup-env.ts`; 120 s timeouts); `playwright.config.ts` |
| Quick run command | `npx vitest run <path-to-spec>` |
| Full suite command | `npm test` |
| E2E command | `npm run test:e2e` (projects: `chromium` + `tablet` on `apps/app-builder/e2e` @ :5173; `renderer` + `renderer-tablet` on `apps/renderer/e2e` @ :5174) |

**Frozen-claim mechanical test:** `packages/contract/src/links/read-link-claims.frozen.spec.ts`
(D-24) asserts the V1 key set and the 6-action enum. D-01/D-10 are designed so it **does not
change**. If it fails during Phase 7, a frozen contract has been breached — stop, do not edit the
spec.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| APP-11 | An app doc carries `forms[]`; each form has `kind` ∈ {`submit`,`list`,`show`,`edit`} and its own `form_version`; two forms of the same kind in one app are rejected | unit | `npx vitest run packages/domain/src/builder/app-definition.service.spec.ts` | ✅ (extend) |
| APP-11 | `form_version` advances only when that form's `schema` changes across publishes (D-10) | unit | `npx vitest run packages/domain/src/builder/app-definition.versions.spec.ts` | ✅ (extend) |
| APP-11 | `SectionNameSchema` has 12 entries after `triggers` retirement; the three mirror lists agree (13→12) | unit | `npx vitest run packages/domain/src/authz/builder-ability.spec.ts` | ✅ (extend) + new assertion |
| APP-12 | A trigger activates exactly one form; a publish declaring a trigger that resolves to >1 form is **rejected** in `PublishGateService.evaluate()` | unit | `npx vitest run packages/domain/src/builder/publish-gate.service.spec.ts` | ✅ (extend) |
| APP-12 | Publish requires **≥1 `submit` form** (D-05) | unit | `npx vitest run packages/domain/src/builder/publish-gate.service.spec.ts` | ✅ (extend) |
| APP-12 | JEV tool list is derived from **forms declaring triggers** — a form with `triggers: null` produces no tool | unit | `npx vitest run packages/domain/src/builder/../decision/published-app-loader.spec.ts` | ❌ Wave 0 (no loader spec exists) |
| APP-04 (amended) | A trigger→form→link-action projection carries `kind`→`action` end-to-end (submit→create, list→query, show→view, edit→edit) | integration | `npx vitest run packages/domain/src/decision/decision-routing.integration.spec.ts` | ✅ (extend) |
| APP-04 (amended) | The worker catalog is **not** hardcoded: a builder-published app becomes routable | integration | `npx vitest run packages/domain/src/decision/decision-routing.integration.spec.ts` | ✅ (extend) + new case |
| FRM-14 | Every form in an app shares the app's collection, roles, and data-routing destination; a form's schema is scoped to its kind | integration | `npx vitest run packages/domain/src/builder/app-definition.service.spec.ts` | ✅ (extend) |
| FRM-14 | `list` reuses the Phase-4 saved-query viewer-row projection with no new schema | integration | `npx vitest run packages/domain/src/builder/saved-query.repository.spec.ts` | ✅ (extend) |
| Migration | `form_schema`→`forms:[{kind:'submit'}]` and app triggers→that form's triggers, idempotent, shape-detecting (only docs carrying `form_schema`) | integration | `npx vitest run packages/domain/src/builder/form-migration.spec.ts` | ❌ Wave 0 |
| Migration | `app_definition_versions` snapshots are migrated so `rollback()` cannot restore the old shape | integration | `npx vitest run packages/domain/src/builder/app-definition.versions.spec.ts` | ✅ (extend) |
| Migration | Seeds carry `forms[]` and validate against the updated `.strict()` `TemplateSeedSchema` | unit | `npx vitest run packages/domain/src/builder/template/template.spec.ts` | ✅ (extend) |
| D-12 | Builder SPA exposes a form manager with an in-form trigger panel; the `Triggers` tab is gone | e2e | `npx playwright test --project=chromium` | ✅ (extend `apps/app-builder/e2e/editor.spec.ts` / `wizard.spec.ts`) |
| D-24 | Frozen read-link claim set unchanged | unit | `npx vitest run packages/contract/src/links/read-link-claims.frozen.spec.ts` | ✅ (must stay green, **unmodified**) |

### Sampling Rate
- **Per task commit:** `npx vitest run <specs touched by the task>`; for SPA tasks also `npx vitest run apps/app-builder/src/editor/publishGuards.spec.ts`.
- **Per wave merge:** `npm test` (full vitest suite — 128 `*.spec.ts` files pre-phase, measured via `npx vitest list`; grows to 129 when 07-01 adds `definition.forms.spec.ts`).
- **Phase gate:** `npm test` **and** `npm run test:e2e` green before `/gsd-verify-work`; the frozen-claim spec must be green **without modification**.

### Wave 0 Gaps
- [ ] `packages/domain/src/builder/form-migration.spec.ts` — covers the `apps` + `app_definition_versions` two-collection migration (APP-11, D-11). **Highest-value new test in the phase**; migration is the riskiest step.
- [ ] `packages/domain/src/decision/published-app-loader.spec.ts` — covers form-derived tool projection (APP-12, D-06). No spec exists for the loader today.
- [ ] `packages/domain/src/builder/section-mirrors.spec.ts` (or an assertion inside `builder-ability.spec.ts`) — asserts the four section mirror lists agree (13→12). A drift guard: the mirror lists already drifted once (doc comments say "twelve" against 13 entries).
- [ ] Shared fixture: a `FormsFixture` builder producing a two-form app (`submit` + `list`, one trigger on each) for reuse across gate/loader/migration specs.
- [ ] Framework install: **none** — vitest + Playwright are present.

*(No existing test infrastructure covers the migration or the loader projection — those are the two genuine Wave 0 gaps.)*

## Security Domain

> `security_enforcement` is **absent** from `.planning/config.json` [VERIFIED: `.planning/config.json` — key `security_enforcement` is `undefined`], and the rule is "absent = enabled". `security_asvs_level` is likewise unset; ASVS **L1** is applied as the project default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Unchanged by Phase 7 — chat identity resolution is Phase 4/5 territory |
| V3 Session Management | no | Stateless design (AD-9); nothing session-shaped is touched |
| V4 Access Control | **yes** | Per-form RBAC is **deferred**, but the *existing* app-level RBAC must not be weakened. Two enforcement points are touched: JEV tool filtering (`published-app-loader` → `AuthorizedApp[]`) and publish-time gate validation. The invariant: **no trigger may make a form routable to a user whose app-role filter excludes it.** |
| V5 Input Validation | **yes** | The migration script and the new `forms[]` shape are validated with **Zod 4** (Standard Schema) — the same dialect as the rest of the codebase. Every read of a migrated doc must pass a `FormsSchema` parse before use; never trust a half-migrated doc's shape. Publish-gate input (definition, roles, forms) is Zod-validated before `evaluate()`. |
| V6 Cryptography | no | Phase 7 issues no links and touches no crypto. The frozen read-link claim set (D-21/D-24) and the read verifier are **explicitly unchanged**; the KMS envelope path (FND-10) is untouched. |

### Known Threat Patterns for the Phase-7 surface

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| **Privilege escalation via a form-level trigger bypassing app RBAC** — a `list` form's trigger becomes routable for a user the app's roles exclude | Elevation of Privilege | Project tools from the **filtered** `AuthorizedApp` set only; the trigger→form→action mapping must run *after* the RBAC filter, never before. Assert in `decision-routing.integration.spec.ts` that a trigger on a restricted form produces **no** tool for the excluded user. |
| **Half-migrated document read as valid** — a doc with both `form_schema` and a partial `forms[]` passes a lax parse and routes inconsistently | Tampering | Migration is **atomic per document** (single `replaceOne`/`updateOne` per `_id`) and idempotent; the new shape is parsed with a `.strict()` Zod schema so a leftover `form_schema` key fails the parse rather than being ignored. Migration filter: only docs where `form_schema` is present (`apps` is a shape union — minimal platform docs like `provisioning/apps/leave-request.json` carry no `form_schema` and must be skipped). |
| **Rollback restoring a retired shape** — `rollback()` spreads a pre-migration snapshot back into the live doc | Tampering | Migrate `app_definition_versions` snapshots in the same run (A5); assert in `app-definition.versions.spec.ts` that a post-migration rollback yields a doc that still parses as `forms[]`. |
| **Seed rejection at boot via `.strict()`** — a migrated seed carrying `forms` is rejected until the schema updates in the same commit | Denial of Service | Land the `TemplateSeedSchema` change and the 10 seed JSON updates in **one commit**; assert in `template.spec.ts` that all shipped seeds validate. |
| **Trigger ambiguity** — one trigger resolving to >1 form silently picks one and routes to the wrong destination | Tampering | Reject at publish (APP-12) in `PublishGateService.evaluate()`; unit-assert the rejection. D-07 (≤1 trigger/form) + D-08 (only `submit`/`list` routable) narrow the space further. |

## Sources

### Primary (HIGH confidence)
- **In-repo source of truth (read this session):**
  - `packages/contract/src/links/read-link-claims.ts:47-67,77-123` — frozen read-link action enum + claim set (D-01 basis)
  - `packages/contract/src/links/read-link-claims.frozen.spec.ts` — the D-24 frozen-claim mechanical test (must not change)
  - `packages/domain/src/builder/data-access/app-definition.repository.ts:61-89,98-114,122-137,200-245` — `AppDefinitionDocument`, `SECTION_FIELDS`, `applySectionPatch`, `createDraft`
  - `packages/domain/src/builder/publish-gate.service.ts:90-220,268-290,299-316,385-424` — gate `evaluate()`, `declaredLabels`, `publishedAppFromDefinition`, `buildChangeSummary` (only `form_schema` reference at L397)
  - `packages/domain/src/builder/app-definition.service.ts:64,249-295,319-325,457-472` — `RETAINED_VERSIONS=20`, `rollback`, dead `assertRegistersTriggers`, `snapshot`
  - `packages/domain/src/builder/saved-query.backfill.ts` — the idempotent insert-if-absent migration precedent
  - `apps/api/src/main.ts:101-105` — post-`TemplateSeed.load()` backfill invocation point
  - `apps/worker/src/worker.module.ts:44-70` — hardcoded `PublishedAppLoader` + `RuleBasedProvider`
  - `apps/worker/src/processors/inbound-event.processor.ts:43-46,100-112,424-448` — `SLASH_COMMAND_APP`, `issue({appId,realUserId})`, `routing_outcomes` shape
  - `packages/domain/src/decision/published-app-loader.ts:7-29`, `routing-orchestrator.ts:24-26` — no `action` anywhere
  - `packages/domain/src/links/link-issuer.service.ts:1-16` — unsigned stand-in issuer
  - `apps/app-builder/src/sections.ts:16-65` + `packages/domain/src/authz/builder-ability.ts:42-56,83-88` — the SPA + authz mirror lists (must change with the enum)
  - `packages/domain/src/builder/template/template.seed.ts:132-158,180-185,236-257` — `.strict()` seed schema + content-hash auto-replace
  - `packages/domain/src/builder/template/seeds/*.json` — 10 single-form seeds (each `form_schema` @ L9, `triggers` @ ~L22-24)
  - `prototypes/mockup.html:546-547,1093-1117,1158-1186` — multi-form element vocabulary; `tabTriggers`; `tabForms` (no in-form trigger panel)
- **Runtime probes this session:** `node --version` (v24.15.0), `npm --version` (11.12.1), `docker --version` (29.8.0), installed `vitest` 5.0.3 / `@playwright/test` 1.64.0.
- **Project contracts:** `.planning/REQUIREMENTS.md:164,170-171,184,457,538-540` (APP-04 amended, APP-11, APP-12, FRM-14); `.planning/ROADMAP.md:306-323` (Phase 7 goal + SC#1-5); `.planning/phases/07-.../07-CONTEXT.md` (D-01…D-12).
- `.planning/config.json` — `commit_docs: true`, `workflow.nyquist_validation: true`, `security_enforcement` absent.

### Secondary (MEDIUM confidence)
- None — this phase is entirely in-repo; no external docs were required.

### Tertiary (LOW confidence)
- None. `prototypes/mockup.html` was treated as design authority per AGENTS.md; where it is silent (the in-form trigger panel) the gap is recorded as Open Question 1, not inferred.

## Metadata

**Confidence breakdown:**
- Standard Stack: **HIGH** — Phase 7 installs no packages; the "stack" is the existing in-repo contracts, all read this session with line-range citations.
- Architecture: **HIGH for the data/routing findings** (the hardcoded worker catalog, the missing gate rule, the absent `action` projection, and the snapshot-rollback hazard are all read from source). **MEDIUM for the builder UX restructure** — the mockup does not depict the in-form trigger panel, so the D-12 design is an Open Question, not a verified plan.
- Pitfalls: **HIGH** — every pitfall maps to a specific in-repo line (section-mirror drift, `.strict()` seed coupling, shape-union filter, snapshot rollback, dead-code gate).
- Runtime State Inventory: **HIGH** — five categories explicitly answered; the two-collection migration (apps + `app_definition_versions` snapshots) and the seed coupling are the load-bearing findings.

**Notable corrections captured during research (vs. 07-CONTEXT.md):**
1. `SectionNameSchema` has **13** entries, not 12 (CONTEXT D-12 says "12 → 11"). After `triggers` retirement: **13 → 12**.
2. D-02's "no routing change" is **false** — the worker catalog is hardcoded and `RoutingOutcome`/`PublishedApp` carry no `action`; de-hardcoding is real work.
3. D-05's "preserves today's rule" is **false** — the publish gate has **no** form rule today; Phase 7 **adds** the ≥1-`submit`-form rule.
4. `rollback()` re-introduces the old shape unless snapshots are migrated — the migration is **two collections**, not one.
5. Playwright is **1.64.0**, not 1.63.0.

**Research date:** 2026-10-17
**Valid until:** 2026-11-16 (30 days — the stack is frozen and no external dependency moves; the only churn risk is in-repo drift as Phase 7 lands, so re-verify line ranges if any cited file changes before planning).
