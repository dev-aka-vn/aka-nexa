---
phase: 06-self-service-app-builder
plan: 04
subsystem: api
tags: nestjs, mongodb, zod, app-builder, lifecycle, templates, saved-queries, tdd

# Dependency graph
requires:
  - phase: 06-03
    provides: the read path's SavedQueryLookup seam (G-11 stopgap) and the frozen D-73 saved-query seed
  - phase: 05
    provides: the publish gate's commitPublish seam and the apps registry collection
provides:
  - AppDefinitionRepository + AppDefinitionService — app-definition CRUD with audited, versioned, snapshot-retaining mutations over the apps collection (D-86 reconciliation model)
  - AppLifecycle state machine — draft→published→deprecated→archived with named refusals and the submission/trigger-registration gates (APP-05/APP-06)
  - Template gallery — 10 D-31 platform seeds, idempotent content-hash loader, D-108 snapshot fork (no origin reference)
  - Curated platform tag vocabulary (D-107) — use-case + department axes as one Zod enum
  - RepositorySavedQueryLookup — the G-11 closure: repository-backed SavedQueryLookup over the saved_queries collection, keyed (app_id, query_id), with idempotent seed backfill
affects: [06-05, 06-06, 06-07, 06-08, 07, verify-work]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 44336
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Factory providers with explicit inject tokens for every DI dependency — required under vitest (esbuild emits no decorator metadata for bare-class providers)"
    - "Content-hash idempotent seed loader (sha256 per template_id) — the D-31 pattern for platform-owned collections"
    - "Snapshot fork via structuredClone — D-108's no-origin-reference boundary"
    - "Insert-if-absent backfill — a builder's newer record is never clobbered by a seed"
    - "Repository data-access placement (packages/domain/src/**/data-access/**) — the R3 boundary rule for mongodb driver imports"

key-files:
  created:
    - packages/domain/src/builder/app-lifecycle.ts
    - packages/domain/src/builder/data-access/app-definition.repository.ts
    - packages/domain/src/builder/app-definition.service.ts
    - packages/domain/src/builder/app-lifecycle.spec.ts
    - packages/domain/src/builder/app-definition.versions.spec.ts
    - packages/domain/src/builder/app-definition.service.spec.ts
    - packages/domain/src/builder/template/tag-set.ts
    - packages/domain/src/builder/template/template.seed.ts
    - packages/domain/src/builder/template/template.spec.ts
    - packages/domain/src/builder/template/seeds/*.json (10 files)
    - packages/domain/src/builder/saved-query.repository.ts
    - packages/domain/src/builder/saved-query.repository.spec.ts
    - packages/domain/src/builder/saved-query.backfill.ts
    - packages/contract/src/builder/app-definition.contract.ts
    - apps/api/src/app-builder/app-builder.module.ts
    - apps/api/src/app-builder/app-builder.controller.ts
    - apps/api/src/app-builder/app-builder.module.spec.ts
    - apps/api/src/app-builder/app-definition.integration.spec.ts
  modified:
    - packages/domain/src/index.ts
    - packages/contract/src/index.ts
    - apps/api/src/app.module.ts
    - apps/api/src/main.ts
    - apps/api/src/read/read.module.ts
    - apps/api/src/read/read.module.spec.ts

key-decisions:
  - "AppDefinitionRepository lives under builder/data-access/ — the R3 boundary rule restricts mongodb driver imports to platform/src/mongo/** and domain/src/**/data-access/**"
  - "Every provider with dependencies is a factory provider with explicit inject tokens — vitest's esbuild transform emits no design:paramtypes, so bare-class providers inject undefined and 500"
  - "Lifecycle transition endpoints (publish/deprecate/archive) return 200 with the updated representation — they mutate an existing resource, unlike POST /apps which creates one (201)"
  - "The fork writes through AppDefinitionRepository.createDraft — the forked draft gets the unique app_id guard and the audited-creation discipline for free"
  - "TemplateSeed.load() and backfillSavedQueries() run at api boot in main.ts — the two idempotent composition steps, after graph wiring, before listen"
  - "SeedSavedQueryLookup stays in the codebase (exported, spec-covered) — the G-11 swap changes only the read.module.ts wiring; the verifier is untouched"
  - "saved-query.backfill is insert-if-absent, not upsert — a builder's bumped query_version must survive a re-backfill (D-75)"

patterns-established:
  - "Audited transition: every mutation does exactly one write + one AUD-01 append with previous_state/new_state (D-86)"
  - "Named refusals: BuilderError carries a code the controller maps to a status; the message names the rule (BLD-07)"
  - "Version-guarded writes: check-then-write loops re-read state and filter on the version that was checked"
  - "Composite-key lookups: (app_id, query_id) — never query_id alone (T-06-15)"

requirements-completed: [BLD-02, APP-03, APP-05, APP-06, APP-09]

coverage:
  - id: D1
    description: "A department admin creates a draft app (lowercase-hyphenated app_id) that no link, trigger, or route reaches until published"
    requirement: BLD-02
    verification:
      - kind: integration
        ref: apps/api/src/app-builder/app-definition.integration.spec.ts#POST /apps creates a draft that no link, trigger, or route reaches (APP-02)
        status: pass
      - kind: unit
        ref: packages/domain/src/builder/app-definition.service.spec.ts#creates a draft with a lowercase-hyphenated app_id
        status: pass
    human_judgment: false
  - id: D2
    description: "Every tab edit is an audited transition: version bump + AUD-01 entry {actor, action, target, previous_state, new_state} (D-86)"
    requirement: BLD-02
    verification:
      - kind: integration
        ref: apps/api/src/app-builder/app-definition.integration.spec.ts#PATCH /apps/:id creates version 2 and appends the audited transition (D-86)
        status: pass
      - kind: unit
        ref: packages/domain/src/builder/app-definition.service.spec.ts#a section update bumps the version and appends exactly one audited transition (D-86)
        status: pass
    human_judgment: false
  - id: D3
    description: "APP-03: 20-version retention with oldest-eviction; rollback restores a retained snapshot as a NEW audited version"
    requirement: APP-03
    verification:
      - kind: unit
        ref: packages/domain/src/builder/app-definition.versions.spec.ts#21 consecutive section updates retain exactly the last 20 versions
        status: pass
      - kind: unit
        ref: packages/domain/src/builder/app-definition.versions.spec.ts#rollback re-writes a retained snapshot as the current definition at a NEW version
        status: pass
    human_judgment: false
  - id: D4
    description: "APP-05: a deprecated app stays functional, serves the owner-supplied notice, and registers no new triggers"
    requirement: APP-05
    verification:
      - kind: integration
        ref: apps/api/src/app-builder/app-definition.integration.spec.ts#APP-05: a deprecated app stays functional — notice served, triggers unchanged, no NEW trigger registration
        status: pass
      - kind: unit
        ref: packages/domain/src/builder/app-lifecycle.spec.ts#a deprecated app refuses NEW trigger registrations with the named error
        status: pass
    human_judgment: false
  - id: D5
    description: "APP-06: an archived app refuses new submissions while a pre-archived view link still resolves through the unchanged ReadVerifierService"
    requirement: APP-06
    verification:
      - kind: integration
        ref: apps/api/src/app-builder/app-definition.integration.spec.ts#APP-06 both ways: an archived app refuses new submissions while a pre-archived view link still resolves
        status: pass
      - kind: unit
        ref: packages/domain/src/builder/app-lifecycle.spec.ts#an archived app refuses submissions with the named error
        status: pass
    human_judgment: false
  - id: D6
    description: "APP-09/D-105..D-108: exactly 10 platform templates across the D-106 domains, loaded idempotently (content-hash guard); 'Use template' forks a user-owned snapshot with no origin reference"
    requirement: APP-09
    verification:
      - kind: unit
        ref: packages/domain/src/builder/template/template.spec.ts#the D-31 loader (T-06-17)
        status: pass
      - kind: unit
        ref: packages/domain/src/builder/template/template.spec.ts#the D-108 fork
        status: pass
      - kind: integration
        ref: apps/api/src/app-builder/app-definition.integration.spec.ts#GET /templates serves the ten-template gallery
        status: pass
      - kind: integration
        ref: apps/api/src/app-builder/app-definition.integration.spec.ts#POST /templates/:id/fork deep-copies a template into a user-owned draft with no origin reference (D-108)
        status: pass
    human_judgment: false
  - id: D7
    description: "G-11: the read path resolves saved queries from the repository-backed store over builder-written definitions in the frozen D-73 shape, keyed (app_id, query_id), with an idempotent insert-if-absent backfill"
    verification:
      - kind: unit
        ref: packages/domain/src/builder/saved-query.repository.spec.ts#does NOT resolve a query_id that exists under a different app_id (T-06-15)
        status: pass
      - kind: unit
        ref: packages/domain/src/builder/saved-query.repository.spec.ts#the seed backfill (G-11)
        status: pass
      - kind: unit
        ref: apps/api/src/read/read.module.spec.ts#ReadModule wiring (G-11)
        status: pass
    human_judgment: false
  - id: D8
    description: "D-107: tags come only from the curated platform set — an out-of-vocabulary tag is rejected inline, naming the allowed vocabulary"
    requirement: BLD-02
    verification:
      - kind: unit
        ref: packages/domain/src/builder/template/template.spec.ts#rejects an out-of-vocabulary tag inline, naming the allowed set
        status: pass
      - kind: integration
        ref: apps/api/src/app-builder/app-definition.integration.spec.ts#rejects a tag outside the curated vocabulary, naming the allowed set (D-107)
        status: pass
    human_judgment: false

# Metrics
duration: 95min
completed: 2026-10-12
status: complete
---

# Phase 06 Plan 04: Self-Service App Builder Summary

**Audited app-definition lifecycle (draft→published→deprecated→archived) with 20-version retention and rollback, a 10-template gallery with provenance-free forks, and the G-11 repository-backed saved-query store**

## Performance

- **Duration:** ~1 h 35 min
- **Started:** 2026-10-12T06:40:50Z
- **Completed:** 2026-10-12T08:15:25Z
- **Tasks:** 3
- **Files modified:** 33 (4860 insertions, 18 deletions)

## Accomplishments

- App-definition CRUD over the `apps` collection (D-86 reconciliation: builder writes extend user-authored apps; the registry's `AppDocument` is untouched) — create draft, edit any of the 12 BLD-02 tab sections, publish, deprecate, archive, rollback
- Every mutation is an audited transition: integer version bump + full-definition snapshot + AUD-01 append with `previous_state`/`new_state`; 20 versions retained, oldest evicted by a single atomic `findOneAndDelete`
- `AppLifecycle` state machine with the legal-transition table and the two gating seams: `assertAcceptsSubmissions` (APP-06) and `assertRegistersTriggers` (APP-05)
- Template gallery: 10 D-31 seeds (8 internal request domains + redmine-issue external + crm-contact hybrid), idempotent sha256 content-hash loader, `structuredClone` snapshot fork with no origin-reference field
- Curated tag vocabulary (D-107): use-case + department axes as one Zod enum; out-of-vocabulary tags rejected inline naming the allowed set
- G-11 closed: `RepositorySavedQueryLookup` implements the existing `SavedQueryLookup` interface over the `saved_queries` collection — compound unique index `(app_id, query_id)`, `saveQuery` as the builder write method (D-75 version invalidation), insert-if-absent seed backfill at api boot — with the `ReadVerifierService` unchanged
- All proofs run over real MongoDB 8.0 + Redis 8.10 (testcontainers) through the HTTP surface

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end definition lifecycle** - `79c5d91d` (feat)
2. **Task 2: Version retention + rollback, lifecycle gating** - `bc91bbfe` (test)
3. **Task 3: Template gallery (D-105..D-108) + the G-11 saved-query replacement** - `dd17daaa` (feat)

**Plan metadata:** final docs commit (docs: complete 06-04 plan)

## Files Created/Modified

- `packages/domain/src/builder/app-lifecycle.ts` — `AppLifecycle` state machine, `BuilderError` base, the four named refusals
- `packages/domain/src/builder/data-access/app-definition.repository.ts` — the definition store: unique `app_id` index, section-patch versioning, version-guarded writes, snapshot/evict/find on `app_definition_versions`
- `packages/domain/src/builder/app-definition.service.ts` — the service: every method an audited transition; `RETAINED_VERSIONS = 20`; the D-107 tag gate on the metadata section
- `packages/contract/src/builder/app-definition.contract.ts` — Zod 4 contracts: `AppIdSchema`, `CreateAppDraftSchema`, 12 `SectionName`s, `UpdateSectionSchema`, `DeprecateAppSchema`, `ForkTemplateSchema`
- `apps/api/src/app-builder/app-builder.module.ts` — the module in the read.module.ts factory-provider shape
- `apps/api/src/app-builder/app-builder.controller.ts` — `POST/GET /apps`, `PATCH /apps/:id`, `POST /apps/:id/{publish,deprecate,archive}`, `GET /templates`, `POST /templates/:id/fork`; `BuilderExceptionFilter` renders every refusal inline as `{error:{code,message}}`
- `packages/domain/src/builder/template/tag-set.ts` — `PLATFORM_TAGS` (15 curated tags, both axes) + `assertCuratedTags`
- `packages/domain/src/builder/template/template.seed.ts` — `TemplateSeed.load()` (idempotent) + `forkTemplate()` (D-108)
- `packages/domain/src/builder/template/seeds/*.json` — the 10 seed files
- `packages/domain/src/builder/saved-query.repository.ts` — `RepositorySavedQueryLookup` (G-11)
- `packages/domain/src/builder/saved-query.backfill.ts` — `backfillSavedQueries()` (insert-if-absent)
- `apps/api/src/read/read.module.ts` — the G-11 wiring swap
- `apps/api/src/main.ts` — the two idempotent boot steps (gallery load + saved-query backfill)
- `packages/domain/src/index.ts`, `packages/contract/src/index.ts`, `apps/api/src/app.module.ts` — barrels and module registration

## Decisions Made

- **Repository under `builder/data-access/`** — the R3 boundary rule restricts `mongodb` driver imports to `platform/src/mongo/**` and `domain/src/**/data-access/**`; the plan's file list named `builder/app-definition.repository.ts`, which cannot import the driver. Same placement as the existing `datarouter/data-access/` and `submissions/data-access/` precedents.
- **All DI providers are factory providers with explicit `inject`** — under vitest the esbuild transform emits no `design:paramtypes`, so a bare-class provider's constructor injection resolves to `undefined` and the handler 500s. Explicit tokens make the graph identical in the test runner and in production.
- **Transition endpoints return 200** — `publish`/`deprecate`/`archive` mutate an existing resource and return the updated representation; only `POST /apps` (create) and `POST /templates/:id/fork` (create) return 201.
- **The fork writes through `AppDefinitionRepository.createDraft`** — the forked draft inherits the unique-`app_id` guard and the audited-creation discipline; `structuredClone` at the fork boundary guarantees the snapshot shares no reference with the platform record.
- **Boot steps in `main.ts`** — the plan did not specify where `TemplateSeed.load()` and the backfill run; the api composition root is the natural seam (the api is the only process serving read links), and both steps are idempotent so a rolling deploy is safe.
- **`SeedSavedQueryLookup` retained, unwired** — the G-11 swap changes only the `read.module.ts` provider; the class stays exported and spec-covered, and the backfill reads the frozen seed JSON directly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Bare-class repository provider injected `undefined` under vitest (HTTP 500s)**
- **Found during:** Task 1 (integration spec verification)
- **Issue:** `AppDefinitionRepository` was declared as a bare class provider; vitest's esbuild transform emits no `design:paramtypes` decorator metadata, so Nest's implicit constructor injection of `MongoService` resolved to `undefined` — every handler 500'd with `Cannot read properties of undefined (reading 'db')`
- **Fix:** Converted to a factory provider with `inject: [MongoService]` (the plan's own "factory providers with explicit inject tokens" directive)
- **Files modified:** apps/api/src/app-builder/app-builder.module.ts
- **Verification:** integration spec 7/7 over testcontainers
- **Committed in:** 79c5d91d

**2. [Rule 1 - Bug] Transition endpoints returned 201 instead of 200**
- **Found during:** Task 1 (integration spec verification)
- **Issue:** Nest defaults `POST` to 201; `publish`/`deprecate`/`archive` are state transitions on an existing resource and the spec (the plan's contract) expects 200 with the updated representation
- **Fix:** `@HttpCode(200)` on the three transition endpoints
- **Files modified:** apps/api/src/app-builder/app-builder.controller.ts
- **Verification:** integration spec passes
- **Committed in:** 79c5d91d

**3. [Rule 3 - Blocking] R3 boundary: repository could not import the mongodb driver from `builder/`**
- **Found during:** Task 1 (lint gate)
- **Issue:** `eslint-plugin-boundaries` R3 restricts `mongodb` imports to `packages/platform/src/mongo/**` and `packages/domain/src/**/data-access/**`; the plan's file list placed the repository at `builder/app-definition.repository.ts`, which fails the build
- **Fix:** Moved to `packages/domain/src/builder/data-access/app-definition.repository.ts` (the existing `datarouter/data-access/` precedent); barrel and spec imports updated
- **Files modified:** packages/domain/src/builder/data-access/app-definition.repository.ts, packages/domain/src/index.ts, packages/domain/src/builder/app-definition.service.ts, packages/domain/src/builder/app-definition.service.spec.ts
- **Verification:** `npm run lint` clean
- **Committed in:** 79c5d91d

**4. [Rule 1 - Bug] PermissionCheckService cache denied the second link verification**
- **Found during:** Task 2 (APP-06 integration proof)
- **Issue:** `PermissionCheckService.check` caches `rbac.getPermissions()` after the first allow; the spec's `vi.spyOn` mocked only `hasPermission`, so the cached empty grant list made the pre-archived link's *second* verification deny
- **Fix:** Mock `getPermissions` to return the view permission alongside `hasPermission`
- **Files modified:** apps/api/src/app-builder/app-definition.integration.spec.ts
- **Verification:** APP-06 both-ways proof passes
- **Committed in:** bc91bbfe

**5. [Rule 2 - Missing Critical] Wiring guards extended for the new providers**
- **Found during:** Task 3
- **Issue:** `AppBuilderModule` gained a `TemplateSeed` provider and `ReadModule` swapped its saved-query store; the existing wiring guards assert the DI graph itself — the new bindings needed assertions so a mis-binding is caught the same way G-11's original gap was
- **Fix:** Extended `app-builder.module.spec.ts` (TemplateSeed factory over `[MongoService, AppDefinitionRepository, AuditRepository]`) and rewrote `read.module.spec.ts` for `RepositorySavedQueryLookup`
- **Files modified:** apps/api/src/app-builder/app-builder.module.spec.ts, apps/api/src/read/read.module.spec.ts
- **Verification:** both guards green
- **Committed in:** dd17daaa

**6. [Rule 2 - Missing Critical] Boot invocation for the gallery load and the saved-query backfill**
- **Found during:** Task 3
- **Issue:** The plan specifies `TemplateSeed.load()` and the backfill but not where they run; without a boot step the gallery and the seed queries would be empty in production
- **Fix:** Both run in `apps/api/src/main.ts` after graph wiring, before `listen` — idempotent, so rolling deploys are safe
- **Files modified:** apps/api/src/main.ts
- **Verification:** boot order documented; both functions spec-proven idempotent
- **Committed in:** dd17daaa

### TDD Process Deviation

**Task 2's specs were written against already-implemented behavior.** Task 1's implementation (written in one pass) already contained the version-snapshot, eviction, rollback, and gating machinery. Task 2's specs (`app-lifecycle.spec.ts`, `app-definition.versions.spec.ts`, the APP-05/APP-06 integration proofs) were written first per the plan's TDD protocol but observed **green on first run** — no RED phase was observable without reverting Task 1's work. The specs now lock the behavior (27 unit + 9 integration assertions); the machinery is proven over real Mongo. The integration proofs (APP-05 both-ways, APP-06 both-ways, the ES256 pre-archived view link minted with `node:crypto` — no jose, R2) are genuinely new coverage added in Task 2.

**Plan path typo (Task 2 verify):** the plan's Task 2 `<verify>` names `packages/domain/src/builder/app-definition.integration.spec.ts`, but the plan's own Task 1 file list places the integration spec at `apps/api/src/app-builder/app-definition.integration.spec.ts` (an HTTP-booting spec cannot live in the domain package). The actual path was verified.

---

**Total deviations:** 6 auto-fixed (4 Rule 1 bugs, 2 Rule 2 missing-critical) + 1 TDD process deviation + 1 plan path typo
**Impact on plan:** All fixes necessary for correctness, boundary compliance, or verifiability. No scope creep — every fix is within the plan's files and invariants.

## Issues Encountered

- The vitest/esbuild decorator-metadata gap (deviation 1) is a repo-wide property, not a builder-module property: any future bare-class provider with constructor dependencies must be a factory provider. Recorded as a pattern in `patterns-established`.
- `z.record(z.string(), z.unknown()).min(1)` is invalid in Zod 4 (`min` is not a function on records) — non-empty-record validation uses `.refine()` instead.
- Nest's `@UseFilters(new BuilderExceptionFilter())` requires the filter class to be declared before the controller in the same file (TDZ `ReferenceError` otherwise).

## User Setup Required

None - no external service configuration required. Docker is required for the testcontainers integration specs (MongoDB 8.0 + Redis 8.10); it was available in this environment.

## Next Phase Readiness

- The builder's backend surface is complete: definitions, versions, lifecycle, gallery, forks, saved queries — all over real Mongo/Redis with the audit trail
- Ready for the builder UI phases (06-05+): the tabbed editor's section endpoints, the version-history/rollback controls, the gallery filter, and the fork flow all have proven backends
- The read path now resolves builder-written saved queries (G-11); the status page's query links work end-to-end once builders save queries
- Pre-existing read-path specs (85/85 in `packages/domain/src/links`) stay green — the G-11 swap broke nothing

---
*Phase: 06-self-service-app-builder*
*Completed: 2026-10-12*

## Self-Check: PASSED

- All 28 created files verified present on disk (lifecycle, repository, service, tag-set, template seed + 10 JSON seeds, saved-query repository/backfill, contract, barrels, module, controller, 4 unit spec files, 1 integration spec file)
- All 3 task commits verified in git log: `79c5d91d` (Task 1), `bc91bbfe` (Task 2), `dd17daaa` (Task 3)
- Measured commit count from plan ledger `gsd-plan-head-before-06-04` (`0ae4ac45`): 3 commits — matches frontmatter `commits: 3`
