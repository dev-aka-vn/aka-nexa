# Phase 7: Multi-Form Apps & Per-Form Triggers — Pattern Map

**Mapped:** 2026-10-17
**Files analysed:** 27 (18 modified, 9 new)
**Analogs found:** 24 / 27 (3 with no close analog — see [No Analog Found](#no-analog-found))
**Phase risk note:** every analog below is **git-tracked source** (`git ls-files` verified 2026-10-17). No gitignored install/runtime mirror is cited.

> **How to read this file.** Each row names the closest existing file by **role + data flow**, then quotes
> the exact lines to copy. Where an excerpt lives in `07-RESEARCH.md` with a verbatim line range, the
> research citation is repeated here so the planner can trust the shape without another repo sweep.
> **The three load-bearing corrections from research are repeated in [Shared Patterns](#shared-patterns)**
> because every plan that edits these files inherits them:
> (1) `SectionNameSchema` is **13 → 12**, never 12 → 11;
> (2) the worker routing catalog is **hardcoded** (D-02's "no routing change" is false);
> (3) the publish gate has **no** form rule today (D-05 "preserves" is false — it **adds**).

---

## Role / Data-flow Legend

| Role | Meaning in this repo |
|------|----------------------|
| `model` | A Zod contract / interface (`packages/contract`, barrel-exported DTOs) |
| `service` | A NestJS-injectable domain class (`*.service.ts`) — pure logic + audit |
| `repository` | The Mongo data-access class (`*.repository.ts`) |
| `loader` / `projection` | Reads a stored shape into a routing/projection shape (`published-app-loader.ts`) |
| `processor` | A BullMQ `WorkerHost` consumer (`inbound-event.processor.ts`) |
| `module` | A NestJS composition root / DI wiring (`*.module.ts`) |
| `bootstrap` | Process entrypoint (`main.ts`) |
| `component` | A React surface (`*.tsx`) |
| `config` | A shared vocabulary/constant mirrored by other layers (`sections.ts`) |
| `migration` | A one-shot, idempotent data transform |
| `seed` | Frozen platform seed data + its loader guard (`template.seed.ts`, `seeds/*.json`) |
| `test` | A Vitest spec |

| Data flow | Meaning |
|-----------|---------|
| `CRUD` | Version-guarded document read/write |
| `request-response` | A call returns a value synchronously to a caller (controller/HTTP) |
| `event-driven` | Consumes a queued job |
| `batch` | Iterates a stored collection and rewrites it |
| `transform` | Pure shape mapping (definition → projection → wire) |
| `validation` | Parses/refuses an input shape |

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| **M** `packages/contract/src/builder/app-definition.contract.ts` | model | validation | itself (the enum is the artifact being edited) | n/a — self |
| **M** `packages/domain/src/builder/data-access/app-definition.repository.ts` | repository | CRUD | itself; `submissions/submission.repository.ts` for repo discipline | exact |
| **M** `packages/domain/src/builder/app-definition.service.ts` | service | request-response | itself (audit+snapshot halves) | exact |
| **M** `packages/domain/src/builder/publish-gate.service.ts` | service | request-response | itself (`evaluate()` gate body) | exact |
| **M** `packages/domain/src/builder/template/template.seed.ts` | seed | transform | itself (`.strict()` + content-hash) | exact |
| **M** `packages/domain/src/builder/template/seeds/*.json` (×10) | seed | transform | `seeds/leave-request.json` | exact |
| **M** `packages/domain/src/decision/published-app-loader.ts` | loader | transform | itself | exact |
| **M** `packages/domain/src/links/link-issuer.service.ts` | service | request-response | itself (the seam) | exact |
| **M** `packages/domain/src/index.ts` | model (barrel) | — | itself | exact |
| **M** `apps/worker/src/worker.module.ts` | module | request-response | itself (DI factory block) | exact |
| **M** `apps/worker/src/processors/inbound-event.processor.ts` | processor | event-driven | itself (`handleSlash`) | exact |
| **M** `apps/api/src/main.ts` | bootstrap | batch | itself (the two idempotent boot steps) | exact |
| **M** `apps/app-builder/src/sections.ts` | config | transform | `authz/builder-ability.ts` `APP_SECTION_PERMISSIONS` (mirror) | exact |
| **M** `apps/app-builder/src/api/definition.ts` | model | validation | itself (`AppDefinitionSchema.parse`) | exact |
| **M** `apps/app-builder/src/editor/EditorPage.tsx` | component | request-response | itself (section render + PATCH) | exact |
| **M** `apps/app-builder/src/editor/AppTabs.tsx` | component | — | `roles/PermissionMatrix.tsx` (both read `APP_SECTIONS`) | exact |
| **M** `apps/app-builder/src/roles/PermissionMatrix.tsx` | component | — | `editor/AppTabs.tsx` (mirror) | exact |
| **M** `apps/app-builder/src/wizard/TriggersStep.tsx` | component | transform | itself (`normalizeTriggers`) | exact |
| **M** `apps/app-builder/src/form-designer/FormDesignerPage.tsx` | component | request-response | itself (PATCH-`forms`-section + dirty tracking) | exact |
| **N** `packages/domain/src/builder/migration/forms-migration.ts` | migration | batch | `packages/domain/src/builder/saved-query.backfill.ts` | exact |
| **N** `packages/domain/src/decision/form-tool-projection.ts` *(optional)* | projection | transform | `publish-gate.service.ts` `publishedAppFromDefinition` | role-match |
| **N** `packages/domain/src/builder/form-migration.spec.ts` | test | batch | `packages/domain/src/builder/saved-query.repository.spec.ts` | exact |
| **N** `packages/domain/src/decision/published-app-loader.spec.ts` | test | transform | `packages/domain/src/builder/publish-gate.service.spec.ts` | role-match |
| **N** `packages/domain/src/builder/section-mirrors.spec.ts` | test | validation | `packages/domain/src/authz/builder-ability.spec.ts` | exact |
| **N** `apps/app-builder/src/form-designer/FormManager.tsx` *(optional — U-1/U-2 undepicted)* | component | request-response | `form-designer/FormDesignerPage.tsx` | role-match |
| **N** `apps/app-builder/src/e2e/…` extension | test | — | existing `apps/app-builder/e2e/editor.spec.ts` | role-match |
| **N** `packages/domain/src/builder/template/seeds/*.json` rewrite (same 10 files) | seed | transform | (same as M row above) | exact |
| **N** shared fixture (`FormsFixture`) | test | — | `template/template.spec.ts` `setup()` | exact |

**Match-quality key:** `exact` = same role **and** same data flow; `role-match` = same role, adjacent data flow; `no-ant` = nothing close (see last table).

---

## Pattern Assignments

### `packages/domain/src/builder/data-access/app-definition.repository.ts` (repository, CRUD)

**Analog:** itself — the document type, the section-field map, and the version-guarded write already exist; Phase 7 reshapes three of them.

**1. The document shape to change** (`AppDefinitionDocument`, lines 61-89 — `form_schema` @71 and `triggers` @72 are replaced by `forms`):
```typescript
export interface AppDefinitionDocument {
  readonly _id?: string;
  readonly app_id: string;
  readonly name: string;
  readonly description: string;
  readonly data_mode: AppDataMode;
  readonly lifecycle: AppLifecycleState;
  readonly version: number;
  readonly tags: readonly string[];
  readonly form_schema: Record<string, unknown> | null;   // ← retires (D-09)
  readonly triggers: readonly Record<string, unknown>[];  // ← retires (D-06)
  readonly roles: Record<string, unknown>;
  readonly routing_config: Record<string, unknown> | null;
  // …retention_policy, deprecation_notice, lifecycle_prefs, jev_behavior,
  //   role_assignments, roles_permissions, versioning_policy, metadata, timestamps
}
```

**2. The one-section↔one-field map** (lines 98-114) — `forms` @107 must become `['forms']`; the `triggers:` row @103 is deleted whole:
```typescript
const SECTION_FIELDS: Readonly<Record<SectionName, readonly string[]>> = Object.freeze({
  general: ['name', 'description'],
  metadata: ['tags', 'data_mode'],
  triggers: ['triggers'],      // ← DELETE this row (D-12 retirement)
  'jev-behavior': ['jev_behavior'],
  'role-assignments': ['role_assignments'],
  'roles-permissions': ['roles_permissions'],
  forms: ['form_schema'],      // ← becomes ['forms'] (D-09)
  versioning: ['versioning_policy'],
  'data-routing': ['routing_config'],
  'field-mapping': ['field_mapping'],
  lifecycle: ['lifecycle_prefs'],
  retention: ['retention_policy'],
  'deprecation-notice': ['deprecation_notice'],
});
```

**3. `applySectionPatch` — the "only listed fields survive" rule** (lines 122-137). Copy verbatim; do **not** loosen it. It is what makes `SECTION_FIELDS['forms'] = ['forms']` load-bearing (get it wrong in one mirror and the whole form set is silently dropped):
```typescript
export function applySectionPatch(
  doc: AppDefinitionDocument, section: SectionName,
  patch: Record<string, unknown>, nextVersion: number,
): AppDefinitionDocument {
  const updated: Record<string, unknown> = { ...doc };
  for (const field of SECTION_FIELDS[section] ?? []) {
    if (field in patch) { updated[field] = patch[field]; }
  }
  updated['version'] = nextVersion;
  updated['updatedAt'] = new Date();
  return updated as unknown as AppDefinitionDocument;
}
```

**4. The version-guarded write** (`updateSection`, lines 259-282) — the derived-`form_version` read and the migration's per-document write must both respect this guard, never bypass it. Key clause:
```typescript
const result = await this.collection.findOneAndUpdate(
  { app_id: appId, version: current.version },   // optimistic guard
  { $set: { ...withoutId } },
  { returnDocument: 'after' },
);
```

**5. `createDraft` defaults** (lines 200-245) — the `form_schema`/`triggers` inputs @207-208 and their defaults @220-221 become a `forms` input/default. The duplicate-key map @238-243 (`11000 → AppIdInUseError`) is unchanged.

**Migration filter note (shape union):** the collection holds two shapes — minimal platform docs (`provisioning/apps/leave-request.json` = `{app_id,name,status}`) and definition docs. The migration must filter on `{ form_schema: { $exists: true } }`. Cite `provisioning/apps/leave-request.json` as the proof of the minimal shape.

---

### `packages/domain/src/builder/app-definition.service.ts` (service, request-response)

**Analog:** itself. Two edits and one deletion.

**1. Delete the dead helper** — `assertRegistersTriggers` (lines 319-325) is called by **no production path** (research Pitfall 3). Delete it; the real gate rule goes in `PublishGateService.evaluate()`:
```typescript
async assertRegistersTriggers(appId: string): Promise<void> {   // ← DELETE (dead code)
  const definition = await this.repository.findByAppId(appId);
  if (definition === null) { throw new AppNotFoundError(appId); }
  AppLifecycle.assertRegistersTriggers(appId, definition.lifecycle);
}
```

**2. The mutation half — audit + version bump are one operation.** `updateSection` (lines 127-147 on) validates with `UpdateSectionSchema`, runs `assertOwner`, then writes; the new per-form validation (two forms of the same kind rejected; `forms[]` elements `.strict()`) slots in **beside** the existing `metadata`/tags check @142-144 as a named inline refusal. Copy the refusal *shape* from the tag gate (`assertCuratedTags` at `template/tag-set.ts`, invoked infra) — it throws `AppDefinitionValidationError` with the offending field named.

**3. The `rollback()` hazard — the single most important excerpt in this phase** (lines 264-277). It spreads a **retained whole-document snapshot** back into the live doc:
```typescript
const restored: AppDefinitionDocument = {
  ...retained.snapshot,              // ← a pre-migration snapshot carries form_schema + triggers
  app_id: appId,
  version: current.version + 1,
  updatedAt: new Date(),
};
const { _id, ...definition } = restored;
const written = await this.repository.setLifecycle(
  appId, restored.lifecycle, { ...definition }, current.version,
);
```
A pre-migration snapshot rolled back **resurrects the retired shape and drops `forms[]`** — a data-corruption path, not a cosmetic one. This is why the migration is **two collections** (`apps` **and** `app_definition_versions`). Encode one of: (a) migrate every retained snapshot in the same run (recommended, A5); (b) make `rollback()` shape-aware. The `app-definition.versions.spec.ts` rollback spec is the place to assert the restored doc still parses as `forms[]`.

**4. `transition()` + `snapshot()`** (lines 396-448, 457-472) — the check-then-write loop and the retain/evict `RETAINED_VERSIONS = 20` @64. Unchanged; the migration's snapshot rewrite must preserve the version-of-record so the eviction cutoff still works.

---

### `packages/domain/src/builder/publish-gate.service.ts` (service, request-response)

**Analog:** itself. This file gains the two **new** rules D-05/D-08/APP-12 require.

**1. `evaluate()` has no form rule today** (lines 90-220). The `allowed` expression is the exact insertion point:
```typescript
const allowed =
  shareDrops.every((drop) => drop.points <= PUBLISH_SHARE_DROP_THRESHOLD_POINTS) &&
  descriptionCollisionWith === null;      // ← ADD: ≥1 submit form; trigger→form uniqueness
```
Add: (a) `≥1` `kind:'submit'` form exists; (b) no trigger label resolves to >1 form within the app (D-07); (c) only `submit`/`list` carry triggers (D-08). Each is a blocked-publish case with its own spec.

**2. `declaredLabels` must read **form** triggers, not `definition.triggers`** (lines 268-290 — the retired app-level array):
```typescript
export function declaredLabels(definition: AppDefinitionDocument): string[] {
  const labels: string[] = [];
  for (const trigger of definition.triggers ?? []) {   // ← must iterate forms[].triggers
    const declared = [
      ...(Array.isArray(trigger.intents) ? trigger.intents : []),
      ...(Array.isArray(trigger.aliases) ? trigger.aliases : []),
    ].filter((label): label is string => typeof label === 'string' && label.length > 0);
    if (declared.length > 0) { labels.push(...declared); continue; }
    for (const key of ['id', 'command'] as const) {     // ← seed fallback: {id,command}
      const value = trigger[key];
      if (typeof value === 'string' && value.length > 0) { labels.push(value); }
    }
  }
  return [...new Set(labels)];
}
```
**Keep the `id`/`command` fallback** — the seeds store `{id:"leave", type:"slash", command:"/leave", …}` (`seeds/leave-request.json:22-24`), so they hit the fallback branch, not `intents`/`aliases`. A rewrite that drops the fallback silently zeroes the seeded catalog's labels.

**3. `publishedAppFromDefinition`** (lines 299-316) — the definition→catalog projection whose shape D-06 moves to forms:
```typescript
export function publishedAppFromDefinition(definition: AppDefinitionDocument): PublishedApp {
  const labels = declaredLabels(definition);
  return {
    id: definition.app_id, description: definition.description, parameters: [],
    intents: labels, aliases: labels, threshold: thresholdOf(definition),
    status: definition.lifecycle as PublishedApp['status'],
  };
}
```

**4. `buildChangeSummary`** (lines 385-424) — the only `form_schema` reference lives at line 397 (`if (candidate.form_schema !== null)`); re-point it at `forms[]`, and the `triggers` row @414-421 at `forms[].triggers`.

---

### `packages/domain/src/builder/template/template.seed.ts` (seed, transform)

**Analog:** itself. The `.strict()` schema **rejects** `forms` until this file changes in the same commit as the seed JSONs (research Pitfall 6).

**1. `TemplateSeedSchema`** (lines 132-158) — swap `form_schema` @142 + `triggers` @144 for a `forms` array:
```typescript
const TemplateSeedSchema = z.object({
  template_id: AppIdSchema,
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  domain: z.string().min(1).max(200),
  tags: z.array(z.string()).min(1),
  data_mode: z.enum(['internal', 'external', 'hybrid']),
  connector_ref: z.string().min(1).nullable().default(null),
  form_schema: z.record(z.string(), z.unknown()),   // ← becomes forms: z.array(FormElement)
  roles: z.record(z.string(), z.unknown()),
  triggers: z.array(z.record(z.string(), z.unknown())), // ← retires into forms[]
}).strict()   // ← the load-bearing bit: an unlisted key fails the seed
```

**2. The content-hash auto-replace** (lines 223-259) — a changed seed is `replaceOne`-d on next boot, so **no manual template migration step is needed** once schema + seeds land together:
```typescript
const contentHash = templateContentHash(parsed.data);
const existing = await this.collection.findOne({ template_id: parsed.data.template_id });
if (existing !== null && existing.content_hash === contentHash) { continue; } // no-op
await this.collection.replaceOne(
  { template_id: parsed.data.template_id },
  { ...parsed.data, content_hash: contentHash, owner: 'platform', loadedAt: new Date() },
  { upsert: true },
);
```

**3. `forkTemplate`** deep-copies `form_schema`/`triggers` (`template.spec.ts:380-383` proves the deep copy) — the fork must copy `forms` with the same `structuredClone`/spread discipline and **no origin-reference field** (D-108).

---

### `packages/contract/src/builder/app-definition.contract.ts` (model, validation)

**Analog:** itself. **One edit:** remove `'triggers'` (line 64) from `SectionNameSchema` (lines 61-75). This is a **contract** (BLD-07), so the change ripples to **four mirror lists** (see Shared Patterns) — it is not a local edit.

```typescript
export const SectionNameSchema = z.enum([
  'general', 'metadata',
  'triggers',          // ← REMOVE (line 64) → enum becomes 13 → 12
  'jev-behavior', 'role-assignments', 'roles-permissions', 'forms',
  'versioning', 'data-routing', 'field-mapping', 'lifecycle',
  'retention', 'deprecation-notice',
]);
```
The doc comment @52 says "twelve sections" against 13 entries (pre-existing drift) — correct it to the true count while here. `UpdateSectionSchema` @87-95 is unchanged (`.strict()`, non-empty patch).

---

### `packages/domain/src/decision/published-app-loader.ts` (loader, transform)

**Analog:** itself. The class today is a **filter over an injected static catalog** with no `action` anywhere:
```typescript
export interface PublishedApp {   // lines 7-16 — no `action`, no `form_id`
  readonly id: string; readonly description: string;
  readonly parameters: readonly string[];
  readonly intents: readonly string[]; readonly aliases: readonly string[];
  readonly threshold: number;
  readonly status: 'published' | 'draft' | 'deprecated';
}

export class PublishedAppLoader {                 // lines 36-57
  constructor(private readonly catalog: readonly PublishedApp[],
              private readonly authorize: AuthorizeApp) {}
  async listAuthorized(realUserId: string): Promise<AuthorizedApp[]> {
    const out: AuthorizedApp[] = [];
    for (const app of this.catalog) {
      if (app.status !== 'published') continue;
      if (!(await this.authorize(app.id, realUserId))) continue;   // RBAC filter
      out.push({ tool: { id: app.id, … }, intents: [...app.intents], … });
    }
    return out;
  }
}
```
D-06 makes the **form set** the catalog. Recommended (research Open Q5): keep `RoutingOutcome` as-is (`{kind:'link',toolId}`), carry `form_id`/`kind` on the tool/projection, resolve `kind → action` **downstream at issuance** — do **not** add a `RoutingOutcome` variant, and do **not** change the JEV wire contract (A11).

**RBAC invariant (must hold):** the trigger→form→action mapping runs **after** the `authorize()` filter — a `list` form's trigger must produce **no** tool for a user the app's roles exclude (security table, threat 1).

---

### `apps/worker/src/worker.module.ts` (module, request-response)

**Analog:** itself — the hardcoded catalog D-02 claimed needed no change:
```typescript
{
  provide: PublishedAppLoader,
  useFactory: () =>
    new PublishedAppLoader(
      [ { id: 'leave-request', description: 'Submit a new leave request',
          parameters: ['start_date','end_date','leave_type'],
          intents: ['request leave','xin nghỉ phép'],
          aliases: ['request leave','leave request','xin nghỉ phép','xin nghi phep'],
          threshold: 0.8, status: 'published' } ],   // ← one inline demo app (lines 48-58)
      async () => true,                               // ← authorize always true
    ),
},
{ provide: RuleBasedProvider, useFactory: () => new RuleBasedProvider(new Map([…])) }, // 63-70
```
Replace the inline literal with a factory that reads `AppDefinitionRepository.listPublished()` (inject `MongoService`, mirroring the `RoutingOutcomeRepository` factory @39-42) and projects via `publishedAppFromDefinition`/a form projection. The `authorize` seam becomes the real per-app RBAC check. **This is the fix for SC#2/SC#4** — without it, builder-published apps never reach chat routing (research Pitfall 2).

---

### `apps/worker/src/processors/inbound-event.processor.ts` (processor, event-driven)

**Analog:** itself. The hardcoded slash map (lines 43-46) is the second half of the de-hardcoding:
```typescript
const SLASH_COMMAND_APP: Readonly<Record<string, string>> = {
  '/leave request': 'leave-request',
  '/leave': 'leave-request',
};
```
And its only consumer (`handleSlash`, lines 101-112) — note the `.toLowerCase()` and the `??` fallback chain:
```typescript
const command = event.text.trim().toLowerCase();
const appId = event.app_id ?? SLASH_COMMAND_APP[command] ?? SLASH_COMMAND_APP[command.split(' ')[0]];
if (!appId) return { kind: 'clarify', toolIds: [] };
const authorized = await this.loader.listAuthorized(chat.real_user_id);
const match = authorized.find((app) => app.tool.id === appId);
if (!match || !(await match.canOpenNow())) return { kind: 'clarify', toolIds: [] };
const url = await this.linkIssuer.issue({ appId: match.tool.id, realUserId: chat.real_user_id });
return { kind: 'link', appId: match.tool.id, url };
```
Replace the map lookup with a lookup over **forms that declare a slash trigger** (case-folded), then carry the resolved form's `kind → action` into `linkIssuer.issue`. `RoutingOutcome`/`ProcessorOutcome` (`{kind:'link', appId, url}` @60) gain no new variant if the action is resolved at issuance.

---

### `packages/domain/src/links/link-issuer.service.ts` (service, request-response)

**Analog:** itself — the single issuance seam (SC#4's "same form-driven path"):
```typescript
export interface IssueLinkInput {         // lines 1-4
  readonly appId: string;
  readonly realUserId: string;
}
export class LinkIssuerService {          // lines 13-17
  async issue(input: IssueLinkInput): Promise<string> {
    return `/l/${encodeURIComponent(input.appId)}?u=${encodeURIComponent(input.realUserId)}`;
  }
}
```
Extend `IssueLinkInput` with `formId` / `formVersion` / `action` (the frozen claims already carry them — `read-link-claims.ts:77-123`). **Keep the seam** — the body is a stand-in; the shape it accepts is the integration point. **Do not edit `read-link-claims.ts` or `read-link-claims.frozen.spec.ts`** (D-24; `READ_LINK_TARGET_RULES` @47-67 already defines each action's `target_id`).

---

### `apps/api/src/main.ts` (bootstrap, batch)

**Analog:** itself — the two idempotent boot steps are the template for the third (lines 96-105):
```typescript
const bootstrap = new Logger('Bootstrap');
try {
  await app.get(TemplateSeed).load();
} catch (error) {
  bootstrap.warn(`template gallery seed (D-105) deferred: ${String(error)}`);
}
try {
  await backfillSavedQueries(app.get(MongoService));
} catch (error) {
  bootstrap.warn(`saved-query backfill (G-11) deferred: ${String(error)}`);
}
```
Add a third best-effort, warn-on-failure block for the forms migration, **after** `TemplateSeed.load()` (the gallery must load before the migration reads seeds). Not a throwing step — a Mongo unreachable at boot is a readiness fact, not a boot failure (comment @85-94). **Note:** the worker bootstrap does **not** run these steps today; if routing runs there, wire the migration in too (research Pattern 3 note).

---

### `apps/app-builder/src/sections.ts` (config, transform)

**Analog:** the authz mirror `APP_SECTION_PERMISSIONS` — the two MUST agree. Three edits here:
```typescript
export const SECTION_LABELS: … = {
  // …
  triggers: 'Triggers',     // ← DELETE (line 25)
  // …
};

export const SECTION_FIELDS: … = {
  // …
  triggers: ['triggers'],   // ← DELETE (line 54)
  forms: ['form_schema'],   // ← becomes ['forms'] (line 58)
  // …
};
```
`APP_SECTIONS` @16-17 derives from `SectionNameSchema.options`, so it follows the contract automatically — but the doc comments @4 and @15 say "twelve" and must be corrected. `sectionValue` @68-79 and `sectionPatch` @82-88 follow `SECTION_FIELDS` and need no change.

---

### `apps/app-builder/src/editor/AppTabs.tsx` + `apps/app-builder/src/roles/PermissionMatrix.tsx` (components, mirror)

**Analog:** each other — both iterate `APP_SECTIONS`/`sectionLabel`, so both shrink 13 → 12 **for free** once `sections.ts` changes:
```typescript
// AppTabs.tsx:172-184
{APP_SECTIONS.map((section) => (
  <button … role="tab" data-testid={`editor-tab-${section}`}
          aria-selected={active === section} onClick={() => onSelect(section)}>
    {sectionLabel(section)}
  </button>
))}
```
```typescript
// PermissionMatrix.tsx:67-108 — one checkbox row per section
{APP_SECTIONS.map((section) => { … <input data-testid={`permission-${section}`}
   checked={checked} onChange={(e) => toggle(section, e.target.checked)} /> })}
```
Their doc comments @4 (`PermissionMatrix`) and @4/@9 (`AppTabs`) say "twelve" — correct to the true count. **Verify** no test asserts a literal 13-count.

---

### `apps/app-builder/src/api/definition.ts` (model, validation)

**Analog:** itself. `AppDefinition` (lines 39-64) and `AppDefinitionSchema.parse` (lines 73-164) both carry `form_schema` @48/@102-105 and `triggers` @49/@106:
```typescript
export interface AppDefinition {
  // …
  readonly form_schema: Record<string, unknown> | null;   // ← becomes forms: FormElement[]
  readonly triggers: readonly Record<string, unknown>[];  // ← retires
  // …
}

export const AppDefinitionSchema = {
  parse: (data: unknown): AppDefinition => {
    // …
    form_schema: typeof doc.form_schema === 'object' && doc.form_schema !== null ? doc.form_schema : null,
    triggers: Array.isArray(doc.triggers) ? doc.triggers : [],
    // …
  },
};
```
The structural-schema pattern (validate-at-boundary, default-don't-throw) is the house style — keep it: a `forms` array is normalised element-wise with each element structurally checked, never trusted.

---

### `apps/app-builder/src/form-designer/FormDesignerPage.tsx` (component, request-response)

**Analog:** itself — the Phase-6 single-schema designer D-12 turns into the **per-form** designer + in-form trigger panel. Two anchors.

**1. The PATCH that must become form-scoped** (`saveForm`, lines 482-526 — the section payload is `{section:'forms', patch:{form_schema}}` @492-496). Under D-09 this patches `forms[]` instead:
```typescript
const response = await client.patch(
  `/apps/${appId}`,
  { section: 'forms', patch: { form_schema: current } },   // ← { forms: [...] } with the target form_id
  AppDefinitionSchema,
);
```
Copy the **in-flight ref guard** @481-486 and the **re-derive-dirty-against-live-schema** logic @498-512 verbatim — those close the silent-discard defect; a per-form designer has the same race per form.

**2. The load/dirty/save skeleton** — `load()` @406-432 (`structuredClone` of the served schema), `EMPTY_FORM_SCHEMA` @158-161, `formFieldKeys` @113-134 (used for the field count pill @659 and the `list`/`show` config surfaces), `Skeleton`+`InlineError` discipline @620-628/@690-696. The undo/redo toolbar @630-688 is the designer chrome to reuse.

**3. The in-form trigger panel (U-1) is UNDEPICTED.** Per AGENTS.md rule 3, **do not improvise** — a `checkpoint:human-verify` gates the panel's placement/fields/copy. Sanctioned source material: mockup `tabTriggers` (lines 1093-1117) row vocabulary + `wizard/TriggersStep.tsx` copy (placeholders @111/@120/@131, helper @159-163).

---

### `apps/app-builder/src/wizard/TriggersStep.tsx` (component, transform)

**Analog:** itself — `normalizeTriggers` (lines 181-205) is the row→stored-shape normaliser that must now target the `submit` form's `triggers`, not the retired app-level array:
```typescript
export function normalizeTriggers(value: TriggersValue): Record<string, unknown>[] {
  return value.triggers
    .filter((row) => row.kind === 'intent' ? row.intent.trim().length > 0 : row.command.trim().length > 0)
    .map((row) => row.kind === 'intent'
      ? { type: 'intent', intent: row.intent.trim(),
          examples: row.example.trim().length > 0 ? [row.example.trim()] : [] }
      : { type: 'slash', command: row.command.trim() });
}
```
The `TriggerRow`/`TriggersValue` types @22-39 and the row markup @82-172 (placeholders, `removeTrigger` @74-78, `+ Add trigger` @150-157) are the **vocabulary the in-form panel reuses verbatim** (UI-SPEC copywriting contract). Keep the row-level shape; change where it is written.

---

### `packages/domain/src/builder/migration/forms-migration.ts` (migration, batch) — NEW

**Analog:** `packages/domain/src/builder/saved-query.backfill.ts` — the established idempotent boot-migration shape. Copy its contract exactly: a free function `(mongo: MongoService) => Promise<number>` returning the count touched (`0` on re-run = the no-op proof):
```typescript
export async function backfillSavedQueries(mongo: MongoService): Promise<number> {
  const collection = mongo.db().collection<SavedQueryRecord>('saved_queries');
  let inserted = 0;
  for (const record of seed) {
    const existing = await collection.findOne({ app_id: record.app_id, query_id: record.query_id });
    if (existing !== null) { continue; }        // key taken — never clobber
    await collection.insertOne({ ...record });
    inserted += 1;
  }
  return inserted;
}
```
**Phase-7 differences the planner must encode** (all from research, all absent from the backfill precedent):
1. **Two collections** — rewrite `apps` **and** `app_definition_versions` snapshots (the `rollback()` hazard above).
2. **Shape-union filter** — only docs where `form_schema` is present (`{ form_schema: { $exists: true } }`); skip minimal platform docs.
3. **Atomic per document** — one `replaceOne`/version-guarded `updateOne` per `_id`; a half-migrated doc must not parse.
4. **Role grants** — rewrite `role_assignments[].permissions` (and any `roles_permissions`) to drop `'triggers'` (research Pitfall 5; `builder-ability.ts:83-88` shows `permissions?: readonly AppSectionPermission[]`).
5. **Seeds need no separate step** — the content-hash guard replaces them once `template.seed.ts` + seeds land together.

**Test precedent:** `saved-query.repository.spec.ts` (the `FakeMongoService`/`FakeCollection` in-memory double @47-138, the idempotency assertion @259-268, the never-clobber assertion @270-289) is the exact harness to clone for `form-migration.spec.ts`.

---

### `packages/domain/src/decision/form-tool-projection.ts` (projection, transform) — NEW (optional)

**Analog:** `publishedAppFromDefinition` (`publish-gate.service.ts:299-316`) — a pure definition→shape function. If the loader's catalog needs a form-level projection (tool id + `form_id` + `kind` + `action`), extract it here rather than growing `published-app-loader.ts`. **Only create it if the loader's inline projection would exceed ~40 lines**; otherwise keep the projection in the loader (avoid a file for its own sake).

---

## Shared Patterns

### S1 — The four-mirror discipline (a single edit is never single)

`SectionNameSchema` is a **contract**; three other lists mirror it. **Every plan that touches one must touch all four**, in one commit (research Pitfall 4; UI-SPEC constraint 4):

| # | Mirror | Location | Change |
|---|--------|----------|--------|
| 1 | `SectionNameSchema` | `packages/contract/src/builder/app-definition.contract.ts:61-75` | drop `'triggers'` (13 → 12) |
| 2 | `APP_SECTIONS` + `SECTION_LABELS` + `SECTION_FIELDS` | `apps/app-builder/src/sections.ts:16-65` | drop `triggers`; `forms → ['forms']` |
| 3 | `SECTION_FIELDS` | `packages/domain/src/builder/data-access/app-definition.repository.ts:98-114` | drop `triggers`; `forms → ['forms']` |
| 4 | `APP_SECTION_PERMISSIONS` | `packages/domain/src/authz/builder-ability.ts:42-56` | drop `'triggers'` @45 |

All four doc comments say "twelve" against 13 entries — fix the count to 12 while editing. A drift-guard spec (`section-mirrors.spec.ts`) should assert the union of `SectionNameSchema.options`, `APP_SECTIONS`, and `APP_SECTION_PERMISSIONS` is identical (they already drifted once).

**Apply to:** the contract plan, the SPA sections plan, the repository plan, the authz plan, and the drift-guard test.

### S2 — `.strict()` on every stored payload (never a lenient parse)

**Source:** `app-definition.contract.ts:87-95` (`UpdateSectionSchema`) and `template.seed.ts:132-158` (`TemplateSeedSchema`).
**Apply to:** the new `forms[]` element schema, the migration's output validation, and the SPA's `AppDefinitionSchema`.
**Why load-bearing:** a half-migrated doc carrying both `form_schema` **and** a partial `forms[]` must **fail** the parse, not pass it silently (security table, threat "half-migrated document read as valid"). `.strict()` is the mechanism.

### S3 — One section ↔ one field (the payload discipline)

**Source:** `applySectionPatch` (repository `:122-137`) — "only the fields in `SECTION_FIELDS[section]` survive". `sections.ts:49-65` is the SPA mirror.
**Apply to:** the `forms` section (whose field set changes to `['forms']`) and the (deleted) `triggers` section.
**Consequence:** `SECTION_FIELDS['forms']` must change in **both** copies in the same commit, or the whole form set is silently dropped on save.

### S4 — Optimistic concurrency + audit + snapshot (the mutation trio)

**Source:** `repository.updateSection:259-282` (version-guarded `findOneAndUpdate`) + `service.updateSection` (validate → `assertOwner` → write → `audit.append`) + `service.snapshot:457-472` (retain 20, evict oldest).
**Apply to:** the derived-`form_version` read, the migration's per-document write, and any new per-form mutation.
**Rule:** never write the `apps` collection without the version guard; never mutate without a matching `app_definition_versions` snapshot, or `rollback()` breaks for that app.

### S5 — Idempotent, best-effort, warn-on-failure boot step

**Source:** `saved-query.backfill.ts:34-56` (insert-if-absent, returns count) + `main.ts:96-105` (two `try/catch` + `bootstrap.warn(... deferred)` blocks, never a throw).
**Apply to:** the forms migration.
**Why:** a re-run must be a no-op (the count-returned proof), and a Mongo-down boot must degrade to a readiness failure, never a crash-loop.

### S6 — SPA async-surface trio: `Skeleton` → `InlineError` → section PATCH

**Source:** `FormDesignerPage.tsx` — `Skeleton` while loading (@627), `InlineError` on load/save failure (@620-628, @690-696), `client.patch(...{section, patch}, Schema)` (@492-496).
**Apply to:** the form manager, the per-form designer, the in-form trigger panel.
**Copy:** the in-flight ref guard (@481-486) and dirty-tracking-against-live-schema (@498-512) — they close the silent-discard race the panel and designer both inherit.

### S7 — Frozen-contract "do not touch"

**Source:** `packages/contract/src/links/read-link-claims.ts` + `read-link-claims.frozen.spec.ts`.
**Rule:** D-01/D-10 are designed so the frozen spec **does not change**. Phase 7 adds **no** claim — `form_id`/`form_version` already exist. If the frozen spec fails during Phase 7, a contract was breached: stop, do not edit the spec (D-24).

### S8 — RBAC-filter-before-projection (the security invariant)

**Source:** `published-app-loader.ts:42-56` (`authorize()` filter first) and `routing-orchestrator.ts:49-59` (provider sees only `authorizedTools`).
**Apply to:** the form-derived tool projection.
**Invariant:** the trigger→form→action mapping runs **after** the filter; a trigger on a form the user's roles exclude produces **no** tool (security threat "privilege escalation via a form-level trigger bypassing app RBAC").

### S9 — Trigger row vocabulary (mockup verbatim)

**Source:** mockup `tabTriggers` (1093-1117) + `TriggersStep.tsx` (@111, @120, @131 placeholders; @159-163 helper). Multi-form element vocabulary: mockup `:546-547` (`{id:"create-leave", label:"Create leave", version:2, action:"create", perm:"leave:create", fields:14}`) + `tabForms` (`:1158-1186`: `Forms` header, `New form` CTA, `list-row` + `icon-tile it-teal`, `pill-mono v{n}`, `Preview` action, Versioning card).
**Apply to:** the form-manager rows and the in-form trigger panel rows — reuse this vocabulary; do not invent a second one (UI-SPEC copywriting contract).

---

## No Analog Found

| File | Role | Data Flow | Reason | Fallback |
|------|------|-----------|--------|----------|
| `packages/domain/src/decision/published-app-loader.spec.ts` | test | transform | No loader spec exists today (research Wave 0). | Clone the `FakeDefinitions`/`FakeOutcomeStore` construction style from `publish-gate.service.spec.ts`; assert a `triggers: null` form yields no tool. |
| `packages/domain/src/builder/section-mirrors.spec.ts` | test | validation | No cross-mirror guard exists (the drift is why the guard is needed). | Model on `builder-ability.spec.ts` (imports the exported const arrays and asserts over them) — assert the three lists are set-equal to `SectionNameSchema.options`. |
| `apps/app-builder/src/form-designer/FormManager.tsx` *(optional)* | component | request-response | The mockup depicts a form **list** (`tabForms`) but no manager chrome separate from the designer; U-2/U-6 are undepicted. | If created, follow `FormDesignerPage.tsx`'s page skeleton + `chrome.css` `card`/`stack-list`/`list-row` (S6/S9); **gate the layout on a `checkpoint:human-verify`** (U-2, U-6). |

---

## Metadata

**Analog search scope:** `packages/contract/src/{builder,links}`, `packages/domain/src/{builder,authz,decision,links,submissions}`, `apps/{api,worker,app-builder}/src`, `provisioning/`, `prototypes/`.
**Files scanned:** ~34 source files + 6 specs; 32 analog paths `git ls-files`-verified as tracked 2026-10-17.
**Pattern extraction date:** 2026-10-17.
**Downstream consumer:** `gsd-planner` (Phase 7 `PLAN.md` action sections).
**Not re-verified here (deferred to the planner):** the exact `form_id` derivation (Open Q3), the trigger-panel layout (U-1), and whether `route`-time `action` lives on `RoutingOutcome` or downstream (recommended: downstream — S8/A11).
