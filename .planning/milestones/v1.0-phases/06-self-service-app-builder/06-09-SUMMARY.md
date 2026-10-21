---
phase: 06-self-service-app-builder
plan: 09
subsystem: ui
tags: [formio, bootstrap5, scoped-css, playwright, computed-style, drift-guard]

requires:
  - phase: 06-self-service-app-builder/06-08
    provides: FormIO 5.6.1 builder/preview mounts and the measured G-06-6 symptom table this plan inverts
provides:
  - Dependency-free scoped-Bootstrap generator with --check drift mode (tooling/formio-scope-css.mjs)
  - Two byte-identical scoped stylesheets (designer canvas + signer renderer read)
  - Computed-style e2e guards proving canvas and preview render real Bootstrap 5 in chromium and tablet
affects: [06-10 (consumes the renderer artifact), 06-UAT (G-06-6 closure evidence)]

actuals:
  tokens: 149000
  tasks: 3
  commits: 3
  plan_head_before: d37aef66affe25dd000ab8706566ef2faf697d0a

tech-stack:
  added: []
  patterns: [selector-prefix scoping of a third-party stylesheet beneath a single scope root, computed-style-over-class-name e2e guards, shell-out drift guards for generated artifacts]

key-files:
  created:
    - tooling/formio-scope-css.mjs
    - tooling/formio-scope-css.spec.ts
    - apps/app-builder/src/form-designer/formio-scope.css
    - apps/renderer/src/read/formio-scope.css
  modified:
    - apps/app-builder/src/form-designer/FormioBuilderField.tsx
    - apps/app-builder/src/form-designer/PreviewPane.tsx
    - apps/app-builder/src/form-designer/representativeSchema.ts
    - apps/app-builder/e2e/s1-spike.spec.ts
    - apps/app-builder/e2e/designer.spec.ts
    - package.json

key-decisions:
  - "One generator, two byte-identical artifacts: the renderer copy is produced by the same transform from the same source read, never by a second path"
  - "The drift-guard spec shells out to --check and parses selector lists in code; it never imports the generator and never counts line matches"
  - "--check compares on normalised line endings so autocrlf checkouts never report false drift"
  - "Playwright runs used --workers=1: the plan's --maxWorkers flag does not exist in the Playwright CLI"

patterns-established:
  - "Scoped third-party CSS: prefix every selector beneath .formio-scope, land :root tokens ON the scope root, drop html/body page rules, recurse @media/@supports, pass @keyframes/@font-face through verbatim"
  - "Computed-style e2e guards (token non-empty, flex rows, fractional columns, control geometry) with explicit non-vacuity counts"

requirements-completed: [BLD-04, FRM-09]

coverage:
  - id: D1
    description: "Scoped-Bootstrap generator emits two byte-identical stylesheets and --check guards drift"
    requirement: "BLD-04"
    verification:
      - kind: unit
        ref: "tooling/formio-scope-css.spec.ts (7 tests)"
        status: pass
      - kind: other
        ref: "node tooling/formio-scope-css.mjs --check + git diff --exit-code on both artifacts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Designer builder canvas renders real Bootstrap 5 styling proven by computed style"
    requirement: "BLD-04"
    verification:
      - kind: e2e
        ref: "apps/app-builder/e2e/s1-spike.spec.ts#the builder canvas renders with real Bootstrap 5 styling (chromium + tablet)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Designer canvas and preview render identical scoped Bootstrap styling"
    requirement: "FRM-09"
    verification:
      - kind: e2e
        ref: "apps/app-builder/e2e/designer.spec.ts#the builder canvas and the preview render identical scoped Bootstrap styling (chromium + tablet)"
        status: pass
    human_judgment: false
  - id: D4
    description: "No previously green app-builder spec regressed"
    requirement: "BLD-04"
    verification:
      - kind: e2e
        ref: "npx playwright test apps/app-builder/e2e --workers=1 (68 passed, chromium + tablet)"
        status: pass
    human_judgment: false

duration: 50min
completed: 2026-10-16
status: complete
---

# Phase 06 Plan 09: Designer-Side Styling Closure Summary

**One dependency-free generator turns pinned Bootstrap 5.3.8 into two byte-identical scope-rooted stylesheets, and computed-style guards prove the designer canvas and preview render real Bootstrap layout in both viewports**

## Performance

- **Duration:** 50 min
- **Started:** 2026-10-16T05:10:00Z (approx)
- **Completed:** 2026-10-16T06:02:00Z
- **Tasks:** 3
- **Files modified:** 10 (4 created source + 2 generated artifacts + 4 edited, incl. package.json)

## Accomplishments

- `tooling/formio-scope-css.mjs` reads the installed transitive Bootstrap 5.3.8 stylesheet, prefixes every selector beneath `.formio-scope`, lands the `:root` token block ON the scope root, drops `html`/`body` page rules, recurses `@media`, passes `@keyframes` through with unprefixed steps, drops `@charset`, and supports `--check`, `--out`/`FORMIO_SCOPE_CSS_OUT`, and a discoverable `npm run build:formio-scope-css` script. No dependency added, no install performed (T-06-SC).
- One source read produces two byte-identical artifacts: `apps/app-builder/src/form-designer/formio-scope.css` and `apps/renderer/src/read/formio-scope.css` (the latter ready for plan 06-10; this plan does not wire it into the renderer).
- `FormioBuilderField` and `PreviewPane` each statically import the sheet and carry `formio-scope` on their FormIO mount containers only — never on page shell, tabs, toolbar, card, or sandbox chrome (FRM-09 prohibition honored).
- The class-name-only spike assertion is retired and replaced by computed-style guards: non-empty `--bs-primary` on the scope root, every `.row` a wrapping flex container, the schema's 2/10 columns fractional widths summing to their row, every `.form-control` at 1px top border / 12px left padding — with explicit counts so no loop passes vacuously, in chromium (1280) and tablet (768).
- `tooling/formio-scope-css.spec.ts` (7 tests) shells out to `--check` (zero clean, non-zero on a perturbed copy), asserts byte-equality, and asserts parsed selector shapes: scope-root token block, no `:root`/`html`/`body` survivors, scoped row/col/form-control rules, unprefixed keyframe steps.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end scoped Bootstrap stylesheet on the designer canvas** - `83dafa2` (feat)
2. **Task 2: Drift guard and shared renderer artifact** - `31c4d58` (test)
3. **Task 3: Preview pane consumes the same stylesheet + dual-surface guard** - `66ab6d0` (feat)

## Files Created/Modified

- `tooling/formio-scope-css.mjs` - Dependency-free scoped-CSS generator with `--check` / `--out` modes
- `tooling/formio-scope-css.spec.ts` - Vitest drift guard (shells out, parses selector lists in code)
- `apps/app-builder/src/form-designer/formio-scope.css` - Generated scoped Bootstrap 5 sheet for the admin canvas
- `apps/renderer/src/read/formio-scope.css` - Byte-identical copy for the signer renderer (06-10 consumes)
- `apps/app-builder/src/form-designer/FormioBuilderField.tsx` - Static sheet import + `formio-scope` on the mount container
- `apps/app-builder/src/form-designer/PreviewPane.tsx` - Same consumption shape on the preview mount container
- `apps/app-builder/src/form-designer/representativeSchema.ts` - Seeded 2/10 `columns` layout pair proving the grid
- `apps/app-builder/e2e/s1-spike.spec.ts` - Class-name assertion replaced by the computed-style canvas guard
- `apps/app-builder/e2e/designer.spec.ts` - Four-component seed + canvas-and-preview computed-style guard
- `package.json` - `build:formio-scope-css` regeneration script (no dependency added)

## Decisions Made

- One generator, two byte-identical artifacts: the renderer copy comes from the same transform and the same source read. A second transform path or second source read would defeat the shared-mechanism contract (G-06-6/G-06-8 share one root cause).
- The guard spec never imports the generator: the artifact is the contract, so the spec shells out to `--check` and re-parses selector lists independently in code.
- `--check` normalises `\r\n` before comparing (see deviation 1): checkout line endings are not source drift.
- Playwright invocations used `--workers=1` (see deviation 2): `--maxWorkers` is not a Playwright CLI flag.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `--check` compared raw bytes, so an autocrlf checkout reports false drift**
- **Found during:** Task 2 (generator extension)
- **Issue:** This machine has `core.autocrlf=true` with no `.gitattributes`. The generator always emits LF, but a fresh Windows checkout materialises CRLF in the working tree — `--check` would then exit non-zero on a clean tree, and the drift guard would fail every Windows developer's build for a non-drift.
- **Fix:** `--check` compares `current.replace(/\r\n/g, '\n')` against the generated text; generation still always writes LF so the committed blob stays canonical. Documented in the generator's `normaliseEndings` comment.
- **Files modified:** tooling/formio-scope-css.mjs
- **Verification:** `node tooling/formio-scope-css.mjs --check` exits 0; the perturbed-copy branch still exits non-zero (spec test 2)
- **Committed in:** 31c4d58 (part of Task 2 commit)

**2. [Rule 3 - Blocking] Plan's Playwright flag `--maxWorkers=1` does not exist**
- **Found during:** Task 1 (first e2e run)
- **Issue:** `npx playwright test ... --maxWorkers=1` dies with `error: unknown option '--maxWorkers=1'` — that is a Jest/Vitest flag; Playwright's is `--workers`.
- **Fix:** Ran all e2e verifications with `--workers=1` (same single-worker serialisation the plan intended).
- **Files modified:** none (invocation only)
- **Verification:** s1-spike + designer specs pass in both projects; full suite 68 passed
- **Committed in:** n/a (no file change)

---

**Total deviations:** 2 auto-fixed (1 correctness, 1 blocking-invocation)
**Impact on plan:** Both necessary for the plan's own verification to run truthfully. No scope creep: no new behavior, no new files beyond the plan's list.

## Issues Encountered

- **Full `npx vitest run` is not green in this sandbox (11 failures, 3 tooling suites) — all pre-existing/environmental, none caused by this plan, left untouched per scope boundary:**
  - `tooling/entrypoint-drift.spec.ts` (1 test): the six unreachable `apps/api` sources already recorded as the suite's one known failure in STATE.md blockers. Zero changes to `apps/api/` in this plan's diff.
  - `tooling/onboarding.spec.ts` (10 tests): boots a real API process with 60 s timeouts; fails here with `ERR_UNSUPPORTED_ESM_URL_SCHEME` and `mongo unavailable`. This sandbox runs Node v26.3.0 while the project pins Node 24 (`engines >=24 <25`); the API boot path is outside this plan's files.
  - `tooling/toolchain-pin.spec.ts` (suite): asserts on the CI install-guard workflow's `grep -Eq` bypass — a `.github/` concern; zero changes to `.github/` in this plan's diff.
  - In-scope suites all pass: `tooling/formio-scope-css.spec.ts` 7/7, all renderer specs (`view`/`edit`/`status`), all app-builder unit specs, `tsc -b` clean, full `npm run lint` clean.

## User Setup Required

None - no external service configuration required. No installs performed (per T-06-SC the generator reads the already-installed transitive Bootstrap).

## Next Phase Readiness

- Plan 06-10 can consume `apps/renderer/src/read/formio-scope.css` directly: it exists, is byte-identical to the designer artifact, and is covered by the same drift guard. No regeneration coordination needed beyond `npm run build:formio-scope-css`.
- Register recording stays with 06-10: this plan closes G-06-6 technically but did not touch `06-UAT.md` (06-10 is its sole writer per repo constraints).
- Wave-9 note: 06-11/06-12 share the app-builder dev server and directory-scoped verifies collect the two spec files rewritten here; this plan's files are committed, so sibling waves see the final state.

## Self-Check: PASSED

- All created files exist: `tooling/formio-scope-css.mjs`, `tooling/formio-scope-css.spec.ts`, both `formio-scope.css` artifacts.
- All commits exist: `83dafa2`, `31c4d58`, `66ab6d0` (verified via `git show -s`).
- No commit deleted tracked files (`git diff --diff-filter=D` empty for each).
- Untracked forbidden files untouched: `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `start-api.bat`, `testenv.mjs`, `probe-designer-style.mjs` all still untracked and unmodified.
- `06-UAT.md` not edited.

---
*Phase: 06-self-service-app-builder*
*Completed: 2026-10-16*
