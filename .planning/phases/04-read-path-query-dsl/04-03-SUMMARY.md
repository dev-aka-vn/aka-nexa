---
phase: 04-read-path-query-dsl
plan: 02
subsystem: database, security
tags: [query-dsl, zod, mongodb, compiler, auth-injection, tdd]

# Dependency graph
requires:
  - phase: 01
    provides: read-link tracer (ReadVerifierService, read.controller) and submission repository seams the query path extends
provides:
  - Strict JSON→AST schema for the Query DSL (DAT-10, D-72/D-73)
  - buildAuthFilter + AST→Mongo compiler with structural auth injection at the root (DAT-11, D-74/D-78)
  - DslService orchestration and per-construct auth-survival proof (DAT-12)
affects: [04-03 query execution + saved-query seeds, 04-04 spec tests, 04-08/04-09/04-10 downstream verification, phase 06 App Builder query authoring]

# Actuals (#2632) — chars/4 over the realized diff, same scale as the plan's estimate.
actuals:
  tokens: 11014
  tasks: 3
  commits: 6

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "strict discriminated-union Zod schema as an authorization boundary (unknown keys and $-operators rejected before compilation)"
    - "structural auth wrapping: emitted filter is {$and: [auth, userFilter]} — user tree appended, never merged (D-74)"
    - "TDD RED evidence via vitest --reporter=junit (classifier-parsable), one test-first commit per task"

key-files:
  created:
    - packages/contract/src/dsl/query-dsl.ts
    - packages/domain/src/dsl/ast.ts
    - packages/domain/src/dsl/dsl.schema.ts
    - packages/domain/src/dsl/filter-builder.ts
    - packages/domain/src/dsl/compiler.ts
    - packages/domain/src/dsl/dsl.service.ts
    - packages/domain/src/dsl/__tests__/compiler.spec.ts
  modified:
    - packages/contract/src/index.ts
    - tooling/boundaries.config.mjs

key-decisions:
  - "Contract package holds the DSL wire types (types-only); domain/dsl/ast.ts re-exports them as the AST and adds MongoFilter/QueryCtx/CompiledQuery — one definition, two names, no drift"
  - "buildAuthFilter emits {deleted_at:null} always and {real_user_id} only when !view_all (D-78 exactly); app scoping (D-76) is applied at the repository's per-app query root in plan 04-03, keeping auth's shape to the two constraints the DAT-11 acceptance criteria name"
  - "contains compiles to an escaped-literal $regex with $options:'i' — the DSL value is never a pattern"
  - "TDD RED evidence captured with vitest --reporter=junit: vitest's TAP output lacks the node:test '# tests' summary the evidence classifier requires"
  - "app_id edge added to boundaries config: dsl element type + dsl→[platform,kernel,contract] and links/submissions→dsl"

patterns-established:
  - "Authorization boundary = strict Zod schema (validates shape) + structural $and at compile time (validates authority); neither alone is sufficient"
  - "One builder emits every auth constraint (buildAuthFilter) so a new constraint cannot be forgotten in one call site"
  - "Per-construct table-driven survival tests: one row per D-72 op asserting the same root invariant"

requirements-completed: [DAT-10, DAT-11, DAT-12]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Strict Query DSL schema — unknown keys, out-of-set operators, $-injection, depth/arity/limit violations all rejected before compilation; valid D-72 documents accepted"
    requirement: DAT-10
    verification:
      - kind: unit
        ref: "packages/domain/src/dsl/__tests__/compiler.spec.ts#DAT-10: strict DSL schema (17 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Auth filter builder + compiler — deleted_at always, real_user_id unless view_all, auth ANDed at the root outside the user's tree; top-level OR cannot bypass"
    requirement: DAT-11
    verification:
      - kind: unit
        ref: "packages/domain/src/dsl/__tests__/compiler.spec.ts#DAT-11: auth filter injection (7 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "DslService parse+compile orchestration with per-construct auth-survival proof for every D-72 construct, plus paging/sort/projection survival"
    requirement: DAT-12
    verification:
      - kind: unit
        ref: "packages/domain/src/dsl/__tests__/compiler.spec.ts#DAT-12: per-construct auth survival (13 tests)"
        status: pass
    human_judgment: false

# Metrics
duration: 34min
completed: 2026-10-08
status: complete
---

# Phase 04 Plan 02: Query DSL Core Summary

**Strict JSON→AST→Mongo DSL compiler where auth is structurally ANDed at the root — 37 tests prove no construct, group, or `view_all` can widen `deleted_at: null` + `real_user_id`.**

## Performance

- **Duration:** 34 min (first RED run 10:55Z → summary; Task-1 test authoring preceded the recorded start)
- **Started:** 2026-10-08T10:55:53Z
- **Completed:** 2026-10-08T11:29:41Z
- **Tasks:** 3 / 3
- **Files modified:** 9 (7 created, 2 modified)

## Accomplishments
- DAT-10: `.strict()` Zod schema over D-72's eight ops — unknown keys, `$`-prefixed keys at any depth, non-identifier fields, depth 12 / arity 100 / limit 100 caps all rejected with all issues surfaced; raw Mongo is unreachable from input.
- DAT-11: `buildAuthFilter` emits `{deleted_at:null}` unconditionally and `{real_user_id}` only without `view_all` (D-78); `compileQuery` wraps the user tree as `{$and:[auth, userFilter]}` so a top-level OR is auth's sibling, never its replacement (D-74).
- DAT-12: 13-test suite — one row per construct asserting auth sits at `$and[0]` outside the user's fragment, plus sort/limit/offset/projection survival and service-level rejection of unknown keys and `limit>100`.
- Full TDD discipline: every task committed RED (evidence verified via `gsd_run check tdd-red-evidence` → `RED_EVIDENCE_OK`) before GREEN.

## Task Commits

Each task was committed atomically (RED → GREEN):

1. **Task 1: DSL AST + strict schema (DAT-10)** — `ac49faee` (test) → `06a48384` (feat)
2. **Task 2: Filter builder + compiler with auth injection (DAT-11)** — `cd725de0` (test) → `2ac340a3` (feat)
3. **Task 3: DslService + per-construct tests (DAT-12)** — `804d44c6` (test) → `5cabdf26` (feat)

**Plan ledger:** base `0f24d1b9`, head `5cabdf26`, 6 commits measured via `git rev-list --count`.

## Files Created/Modified
- `packages/contract/src/dsl/query-dsl.ts` — DSL wire contract: FilterExpr union, QueryDsl, MAX/DEFAULT_QUERY_LIMIT, DSL_OPERATORS (types only; contract's only edge is → kernel)
- `packages/contract/src/index.ts` — re-exports the dsl module
- `packages/domain/src/dsl/ast.ts` — re-exports contract types as the AST + MongoFilter, QueryCtx, CompiledQuery
- `packages/domain/src/dsl/dsl.schema.ts` — strict schema; `parseQueryDsl` returns `{ok,dsl}|{ok:false,issues}`
- `packages/domain/src/dsl/filter-builder.ts` — the single producer of auth constraints (DAT-11)
- `packages/domain/src/dsl/compiler.ts` — exhaustive switch over the eight ops; `compileQuery` implements the D-74 root wrap
- `packages/domain/src/dsl/dsl.service.ts` — `@Injectable` parse+compile entry point; schema failures never reach Mongo
- `packages/domain/src/dsl/__tests__/compiler.spec.ts` — DAT-10/11/12, 37 tests
- `tooling/boundaries.config.mjs` — new `dsl` element type and edges (see deviations)

## Decisions Made
- **Types live in contract, schema in domain.** Contract's single edge points at kernel, so the wire shape must originate there for seeds/App Builder to import it without pulling Zod; `ast.ts` re-exports under AST names so there is one definition.
- **App scoping (D-76) is applied at the repository query root in 04-03, not inside `buildAuthFilter`.** Rationale: the plan's DAT-11 acceptance criteria state `view_all test: auth equals {deleted_at:null}` and the research sketch excludes `app_id` from auth ("app scoping implied by collection/query"); keeping auth to the exact ownership + soft-delete pair preserves that acceptance while `SubmissionRepository.queryWithDsl` applies `app_id` against the query link's bound claims (planned + to be tested in 04-03).
- **`contains` → escaped literal `$regex`.** A substring match must not become a pattern (DAT-10); every metacharacter is escaped in the compiler, not in the schema.
- **JUnit for RED evidence.** The evidence classifier requires node:test-style TAP summaries or Surefire XML; vitest's TAP reporter emits neither, `--reporter=junit` produces parseable Surefire-shaped XML.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] New `dsl` boundary element required in `tooling/boundaries.config.mjs`**
- **Found during:** Task 2 (compiler imports `./filter-builder.js`, `./ast.js`)
- **Issue:** `packages/domain/src/dsl/**` was not an element type; with `default: disallow`, every local import inside the new directory is a lint failure and `npm run build` (which depends on `npm run lint`) fails.
- **Fix:** added `dsl` to `DOMAIN_ELEMENT_TYPES`, `dsl: ['platform','kernel','contract']` to `ALLOWED_EDGES`, and `dsl` to the `links` and `submissions` target lists (both consume the compiled DSL in 04-03). App roots already spread `DOMAIN_ELEMENT_TYPES`.
- **Files modified:** `tooling/boundaries.config.mjs`
- **Verification:** `npx eslint packages/domain/src/dsl tooling/boundaries.config.mjs` → clean; `tooling/boundaries.fixture.spec.ts` derives elements from the settings block so it stays in sync.
- **Committed in:** `cd725de0`

**2. [Rule 2 - Missing critical functionality] `packages/contract/src/index.ts` re-exports for the new dsl module**
- **Found during:** Task 1
- **Issue:** the plan lists `contract/src/dsl/query-dsl.ts` but the package barrel must re-export it or consumers cannot `import { MAX_QUERY_LIMIT } from '@akane/contract'`.
- **Fix:** added the barrel export alongside the types file.
- **Committed in:** `ac49faee`

**3. [Rule 1 - Bug] Incorrect auth assertion in the DAT-12 sort/limit/offset test**
- **Found during:** Task 3 GREEN run (1 failed / 36 passed)
- **Issue:** the test asserted `filter.$and[0]` equals full auth, but with no user filter the emitted filter *is* auth verbatim (`{$and:[{deleted_at},{real_user_id}]}`), so `$and[0]` is only `{deleted_at:null}` — the assertion, not the implementation, was wrong.
- **Fix:** assert `filter` toEqual full `OWNED_AUTH` (equal-or-stronger: the whole filter must be auth).
- **Files modified:** `packages/domain/src/dsl/__tests__/compiler.spec.ts`
- **Committed in:** `5cabdf26`

### Plan-text deviations (documented, not auto-fixes)

**4. `buildAuthFilter` takes `(viewerId, hasViewAll)` — the plan action names a third `appId` parameter**
- **Rationale:** the research sketch (Pattern 2) carries `appId` but never uses it ("app scoping implied by collection/query"); an unused parameter fails `@typescript-eslint/no-unused-vars`, and all five DAT-11 acceptance criteria are about `deleted_at`/`real_user_id` only. App scoping lands in `queryWithDsl` (04-03) where `ctx.appId` exists — see Decisions.

**5. Plan `<verify>` commands corrected: `packages/domain/dsl` → `packages/domain/src/dsl`, `--grep` → `-t`**
- vitest 5 rejects `--grep` (`CACError: Unknown option`) and the plan's path does not substring-match the real directory. All three verifies re-run with the corrected invocations: 17 / 21 / 8 passing subsets, full file 37/37.

---

**Total deviations:** 3 auto-fixed (1× Rule 3, 1× Rule 2, 1× Rule 1) + 2 documented plan-text corrections
**Impact on plan:** all must_haves truths satisfied; no scope creep — boundary config and barrel export were prerequisites the plan's file list omitted.

## Issues Encountered
- **TAP RED evidence rejected (`zero_tests_discovered`).** vitest's TAP reporter emits a file-level `not ok` without node:test `# tests/# fail` summary lines, and its nested test names are indented so the classifier's anchored regex misses them. Resolved by capturing `--reporter=junit` (Surefire-shaped XML) — every RED record validated `RED_EVIDENCE_OK`.
- **Pre-existing `tsc -b` failures (out of scope, deferred):** `packages/domain/src/decision/decision.conformance.spec.ts` (fixture json not in tsconfig file list, implicit anys, readonly assigns) and `apps/worker/src/processors/inbound-event.processor.ts` (readonly array), both from Phase 3 commit `32acdbdd`. Zero type errors in `dsl/` or `contract/`. Logged in `deferred-items.md`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `DslService.compile(json, ctx)` is ready for `SubmissionRepository.queryWithDsl` (04-03) — which must also apply the `app_id` root scope this plan deliberately left to it.
- Full suite: `npx vitest run packages/domain/src/dsl/__tests__/compiler.spec.ts` → 37/37; lint clean; no dsl type errors.
- Deferred: pre-existing Phase 3 `tsc` failures (see `deferred-items.md`) — they do not block this plan but will block any full `npm run build`.

---
*Phase: 04-read-path-query-dsl*
*Completed: 2026-10-08*
