---
phase: 01-foundations-platform
plan: 01
subsystem: infra
tags: [npm-workspaces, typescript, nestjs, zod, vitest, eslint, github-actions, project-references]

requires: []
provides:
  - "npm-workspaces monorepo: packages/{kernel,platform,contract,domain} + apps/{api,worker,scheduler}"
  - "pinned toolchain: typescript 6.0.3, @nestjs/* 12.1.2, zod 4.6.5, vitest 5.0.3, eslint 10.11.0"
  - "committed package-lock.json and .nvmrc (Node 24)"
  - "Zod-validated ConfigModule with a named CONFIG_INVALID boot failure (FND-09)"
  - "apps/api booted via NestFactory.create() answering GET /health/live with 200 (FND-05)"
  - "CI build gate (npm ci) + separate lockfile-deleting install-guard job (FND-01/FND-02/D-06)"
affects: [01-02, 01-03, 01-05, all later phases (workspace + entrypoint contract)]

actuals:
  tokens: 43890
  tasks: 5
  commits: 5
  plan_head_before: 311c136fba64d930691e4eaf43cffb16e813e578
  plan_head_after: 31d8a9c750978207b1c430b40283741b7eb7f64f

tech-stack:
  added:
    - "typescript 6.0.3 (exact pin)"
    - "@nestjs/core|common|platform-express|testing 12.1.2"
    - "@nestjs/config 12.0.1"
    - "zod 4.6.5"
    - "vitest 5.0.3"
    - "eslint 10.11.0"
    - "typescript-eslint 8.71.0"
    - "eslint-plugin-boundaries 7.2.0"
    - "@types/node ^24 (deviation — see below)"
    - "reflect-metadata 0.2.2, rxjs 7.8.2"
  patterns:
    - "npm workspaces + TS project references; every workspace composite, root solution tsconfig"
    - "All 7 workspaces are ESM (\"type\": \"module\"); relative imports use .js extensions"
    - "Zod .strict() schema + a named validate hook that narrows process.env to declared keys"
    - "Liveness handler reads no dependency so a dependency blip cannot cascade into restarts"
    - "Build depends on lint, so a boundary/lint violation fails locally and in CI identically"

key-files:
  created:
    - "package.json, package-lock.json, .nvmrc, tooling/tsconfig.base.json, tsconfig.json"
    - "vitest.config.mts (workspace aliases, 30s timeouts)"
    - "eslint.config.mjs (typescript-eslint recommended; plan 03 extends)"
    - ".github/workflows/ci.yml (build + install-guard jobs)"
    - "packages/platform/src/config/{config.schema.ts,config.module.ts,config.module.spec.ts}"
    - "packages/kernel/{package.json,tsconfig.json,src/index.ts}"
    - "packages/contract/{package.json,tsconfig.json,src/index.ts}"
    - "packages/domain/{package.json,tsconfig.json,src/index.ts} + 13 src/ module dirs (.gitkeep)"
    - "apps/api/{package.json,tsconfig.json,src/main.ts,src/app.module.ts,src/health/*}"
    - "apps/worker/{package.json,tsconfig.json,src/main.ts}"
    - "apps/scheduler/{package.json,tsconfig.json,src/main.ts}"
  modified:
    - "tooling/tsconfig.base.json (composite: true)"

key-decisions:
  - "Set composite: true in tooling/tsconfig.base.json so project references typecheck (TS6306) and tsc -b builds in dependency order."
  - "Added @types/node@^24 as a root devDependency (not in STACK.md §14) — required for tsc; canonical DefinitelyTyped package, not a substitution."
  - "Added a root solution tsconfig.json referencing all seven workspaces — required by build = `npm run lint && tsc -b`."
  - "namedValidate narrows process.env to the declared config keys before .strict() parse; a raw .strict() over process.env would fail every boot."
  - "Resolved the 12-vs-13 domain module flag to thirteen directories including audit (PD-1), so the boundary graph needs no config change later."

patterns-established:
  - "Entrypoint bootstrap: NestFactory.create(AppModule) reading the Zod-validated PORT (D-09); worker/scheduler shells copy this shape."
  - "Named boot failure: errors are prefixed `CONFIG_INVALID: <path> <code>` so failures are greppable."
  - "Workspace packages resolve by name (@akane/*) via npm workspace symlinks, never relative paths."

requirements-completed: [FND-01, FND-02, FND-03]

coverage:
  - id: D1
    description: "Clean checkout installs with npm ci on the pinned toolchain; typescript resolves to exactly 6.0.3."
    requirement: "FND-01"
    verification:
      - kind: other
        ref: "npm ci && node -e \"...p.devDependencies.typescript!=='6.0.3'...\" -> TS_PIN_OK 6.0.3"
        status: pass
    human_judgment: false
  - id: D2
    description: ".nvmrc contains 24 and package-lock.json is committed alongside the workspace topology."
    requirement: "FND-02"
    verification:
      - kind: other
        ref: "cat .nvmrc (24); git ls-files package-lock.json"
        status: pass
    human_judgment: false
  - id: D3
    description: "Four packages (kernel/platform/contract/domain) and three app workspaces exist, resolve by name, and domain/src holds thirteen tracked module dirs including audit."
    requirement: "FND-03"
    verification:
      - kind: other
        ref: "node -e LIB_WORKSPACES_OK 4; node -e DOMAIN_DIRS_OK 13; node -e APP_SHELLS_OK"
        status: pass
    human_judgment: false
  - id: D4
    description: "apps/api boots through NestFactory.create, GET /health/live returns 200 {status:\"ok\"} reading no dependency; config boot failure is named CONFIG_INVALID."
    requirement: "FND-05"
    verification:
      - kind: unit
        ref: "apps/api/src/health/health.controller.spec.ts#returns 200 with { status: \"ok\" }"
        status: pass
      - kind: unit
        ref: "packages/platform/src/config/config.module.spec.ts#throws a named CONFIG_INVALID error when PORT is non-numeric"
        status: pass
    human_judgment: false
  - id: D5
    description: "The CI install-guard fails loudly when a lockfile-free install resolves TypeScript 7.x."
    requirement: "FND-01"
    verification:
      - kind: manual_procedural
        ref: "A9 smoke: bumped typescript to 7.0.2, rm package-lock.json, npm install (exit 0, warn only), npm run build (exit 2), no apps/*/dist/main.js"
        status: pass
    human_judgment: true
    rationale: "The guard job runs only in CI; its failure behaviour was reproduced manually here and is not committed as an automated test."
  - id: D6
    description: "Booting api, worker, and scheduler yields three independent OS processes with no shared in-process singleton."
    requirement: "FND-03"
    verification:
      - kind: manual_procedural
        ref: "apps/{api,worker,scheduler} are separate workspaces/entrypoints; worker+scheduler shells exit 1 with NOT_IMPLEMENTED and mount no HTTP server"
        status: pass
    human_judgment: true
    rationale: "Final boot separation of all three processes lands in plan 07 (FND-03 partial here); a backstop-level human check is required."

duration: 38min
completed: 2026-10-02
status: complete
---

# Phase 01 Plan 01: Foundations & Platform Summary

**npm-workspaces monorepo on the pinned Node 24 / NestJS 12.1.2 / TS 6.0.3 stack: a Zod-validated config module with a named boot failure, `apps/api` answering `GET /health/live` 200, the full four-package/three-app topology, and a CI build gate plus lockfile-deleting install guard.**

## Performance

- **Duration:** 38 min
- **Started:** 2026-10-02T07:03:50Z
- **Completed:** 2026-10-02T07:41:35Z
- **Tasks:** 5
- **Files modified:** 48

## Accomplishments

- Stood up the npm-workspaces monorepo: `packages/{kernel,platform,contract,domain}` and `apps/{api,worker,scheduler}`, all ESM, all resolving `@akane/*` by workspace name.
- Proved the tracer path end to end: root workspace → `@akane/platform` → Zod `.strict()` config → `CONFIG_INVALID` named boot failure → `NestFactory.create(AppModule)` → `GET /health/live` 200 → green spec.
- Pinned the toolchain (typescript exactly `6.0.3`) and committed `package-lock.json`, with `.nvmrc` = `24` as the single Node source for CI.
- Gated the build on lint (`build = npm run lint && tsc -b`) and added a CI `install-guard` job that deletes the lockfile, installs, builds, and asserts each app's compiled entrypoint exists (for example `apps/api/dist/main.js`, and the worker/scheduler siblings).
- Confirmed the install guard is loud: a lockfile-free install with TypeScript `7.0.2` warns rather than fails at install, but `npm run build` exits 2 and emits no per-app bundle (for example `apps/api/dist/main.js`).

## Task Commits

Each task was committed atomically:

1. **Task 1: Root workspace, pinned toolchain, and the Zod-validated config path** - `f1dd373` (feat)
2. **Task 2: `apps/api` boots end-to-end and answers `GET /health/live`** - `67f27bb` (feat)
3. **Task 3: Complete the library packages and the thirteen domain module directories** - `67ae8a1` (feat)
4. **Task 4: Add the `apps/worker` and `apps/scheduler` composition-root shells** - `ca72897` (feat)
5. **Task 5: Pin Node 24 / TypeScript 6.0.3, commit the lockfile, wire CI** - `31d8a9c` (feat)

**Plan metadata:** (this SUMMARY + STATE.md + ROADMAP.md) — final docs commit

## Files Created/Modified

- `package.json` — workspace root, `engines >=24 <25`, scripts (`build` gates on `lint`), exact TS pin
- `package-lock.json` — committed lockfile (FND-02)
- `.nvmrc` — `24`
- `tooling/tsconfig.base.json` — shared compiler options; `composite: true`, `esModuleInterop`, decorators
- `tsconfig.json` — root solution config referencing all seven workspaces
- `vitest.config.mts` — `@akane/*` aliases, 30s test/hook timeouts
- `eslint.config.mjs` — typescript-eslint recommended (plan 03 adds boundaries)
- `.github/workflows/ci.yml` — `build` (npm ci) + separate `install-guard` job
- `packages/platform/src/config/config.schema.ts` — `AppConfigSchema` (`.strict()`, NODE_ENV/PORT)
- `packages/platform/src/config/config.module.ts` — `namedValidate` + global `ConfigModule`
- `packages/platform/src/config/config.module.spec.ts` — valid boot, named failure, defaults
- `packages/kernel/src/index.ts` — dependency-free barrel (`Brand` helper)
- `packages/contract/src/index.ts`, `packages/domain/src/index.ts` — package skeletons
- `packages/domain/src/{identity,authz,registry,forms,links,decision,connectors,submissions,datarouter,adapters,pipeline,builder,audit}/.gitkeep` — thirteen tracked module dirs
- `apps/api/src/main.ts` — `NestFactory.create(AppModule)` + config-read PORT
- `apps/api/src/app.module.ts` — imports `ConfigModule`, declares `HealthController`
- `apps/api/src/health/health.controller.ts` — `/health/live` reads no dependency
- `apps/api/src/health/health.controller.spec.ts` — ephemeral-port fetch assertion
- `apps/worker/src/main.ts`, `apps/scheduler/src/main.ts` — shells exiting 1 with `NOT_IMPLEMENTED`

## Decisions Made

- **Composite project references.** `tooling/tsconfig.base.json` sets `composite: true` so referenced projects typecheck (`TS6306` was blocking `apps/api`) and `tsc -b` builds in dependency order.
- **`@types/node@^24` devDependency.** Required for `tsc` to typecheck Node globals; not listed in `STACK.md §14`. It is the canonical DefinitelyTyped package (see Deviations).
- **Root solution `tsconfig.json`.** Required by `build = npm run lint && tsc -b`; a deviation from the plan's `files_modified` list (see Deviations).
- **`namedValidate` narrows `process.env`.** The plan's raw `.strict()` over the full environment would reject every boot; the hook forwards only the declared keys before parsing, preserving `.strict()` semantics for direct parses.
- **Thirteen domain directories including `audit`.** Resolves the CONTEXT "12" vs RESEARCH/ARCHITECTURE "13" flag (already recorded in `01-ASSUMPTIONS.md` PD-1).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `composite: true` to the shared base tsconfig**
- **Found during:** Task 2 (`apps/api` typecheck)
- **Issue:** `apps/api/tsconfig.json` references `packages/platform`; `tsc -p apps/api ... --noEmit` failed with `TS6306: Referenced project must have setting "composite": true`.
- **Fix:** Added `composite: true` to `tooling/tsconfig.base.json`; re-ran the Task 1 verify (still exit 0) and the Task 2 verify (exit 0).
- **Files modified:** `tooling/tsconfig.base.json`
- **Committed in:** `67f27bb` (Task 2 commit)

**2. [Rule 1 - Bug] Corrected the spec import path**
- **Found during:** Task 2 (spec typecheck)
- **Issue:** `apps/api/src/health/health.controller.spec.ts` imported `./app.module.js`, which resolves to `src/health/app.module.js` — a nonexistent file; after the composite fix the only remaining `TS2307` was this import.
- **Fix:** Changed to `../app.module.js`.
- **Files modified:** `apps/api/src/health/health.controller.spec.ts`
- **Committed in:** `67f27bb` (Task 2 commit)

### Plan-declared deviations (documented, not auto-fixable silently)

**3. [Rule 3 - Blocking] Added `@types/node@^24` to root devDependencies**
- **Found during:** Task 1/5 (toolchain)
- **Issue:** `tsc` cannot typecheck Node globals (`process`, `Buffer`) without `@types/node`; not present in `STACK.md §14`.
- **Fix:** Added `@types/node: ^24.19.1`. It is the canonical DefinitelyTyped package, not a substitute for a missing package, so no package-legitimacy checkpoint was raised.
- **Files modified:** `package.json`, `package-lock.json`
- **Committed in:** `31d8a9c` (Task 5 commit)

**4. [Rule 3 - Blocking] Added root solution `tsconfig.json`**
- **Found during:** Task 1
- **Issue:** `build = npm run lint && tsc -b` needs a root solution config to build the seven referenced projects in order; the plan's `files_modified` did not list it.
- **Fix:** Added `tsconfig.json` with `files: []` and `references` to all seven workspaces.
- **Files modified:** `tsconfig.json`
- **Committed in:** `f1dd373` (Task 1 commit)

**5. [Instructed out-of-list edit, not a deviation]** The Task 3 action required recording the 12-vs-13 resolution in `01-ASSUMPTIONS.md`; PD-1 already carried that resolution, so no edit was needed.

---

**Total deviations:** 4 auto-fixed/declared (3 Rule 3 blocking, 1 Rule 1 bug). No unplanned scope.
**Impact on plan:** All were required for the mandated verifies to pass; none changed the architecture or the public contract.

## Issues Encountered

- **npm 11 did not hard-fail on the TS 7 peer conflict.** The A9 smoke showed a lockfile-free install with `typescript: "7.0.2"` exits 0 with `ERESOLVE overriding peer dependency` warnings. This validates the plan's second guard layer: `npm run build` exits 2 and the per-app compiled-entrypoint assertion fails, so the CI job still goes red. Recorded as evidence for D5.
- **The CI `install-guard` node assertion scans the file text for the forbidden flag string.** An initial comment mentioning the flag verbatim tripped the assertion; the comment was reworded. This is expected and correct guard behaviour.

## Threat Model Coverage

- **T-1-01 (Tampering, package.json/lock):** mitigated — exact `typescript: "6.0.3"`, committed lockfile, CI assertion `TS_PIN_OK 6.0.3`.
- **T-1-02 (Tampering, install-guard job):** mitigated — guard deletes the lockfile and runs a lockfile-free install; no bypass flag present.
- **T-1-03 (DoS, `/health/live`):** mitigated — handler reads no dependency, so a downed Mongo/Redis cannot cascade into restarts.
- **T-1-SC (Tampering, npm installs):** `@types/node` is the only added package not in `STACK.md §14`; it is the canonical DefinitelyTyped package and was documented rather than checkpointed.

## Known Stubs

- `packages/contract/src/index.ts` and `packages/domain/src/index.ts` are intentional `export {}` skeletons; plans 02+ fill them. They do not prevent this plan's goal (topology + tracer) from being achieved.
- `apps/worker/src/main.ts` and `apps/scheduler/src/main.ts` are intentional shells that exit `1` with `NOT_IMPLEMENTED`; they are completed in plans 07 and 10 respectively, exactly as the plan specifies.

## User Setup Required

None — no external service configuration required. (The Docker daemon precondition applies only to later testcontainers plans.)

## Next Phase Readiness

- Workspace names, the entrypoint bootstrap shape, and the `CONFIG_INVALID:` contract are now frozen; later plans extend rather than restructure.
- `npm ci`, `npm run build`, and `npm test` are green (2 test files, 4 tests).
- Plan 02 can add the first feature slice on this floor; plan 03 extends `eslint.config.mjs` with `eslint-plugin-boundaries` and the scoped `no-restricted-imports` rule.

## Self-Check: PASSED

- All five task commits exist: `f1dd373`, `67f27bb`, `67ae8a1`, `ca72897`, `31d8a9c`.
- Working tree build/lint/test green; `apps/{api,worker,scheduler}/dist/main.js` present.

---
*Phase: 01-foundations-platform*
*Completed: 2026-10-02*
