---
phase: 06-self-service-app-builder
plan: 10
subsystem: ui
tags: [formio, bootstrap5, scoped-css, playwright, renderer, computed-style, uat-register]

# Dependency graph
requires:
  - phase: 06-self-service-app-builder/06-09
    provides: [byte-identical scoped stylesheets (designer + renderer copies), drift guard, computed-style guard precedent]
  - phase: 06-self-service-app-builder/06-11
    provides: [publish confirmation gate + dirty-chord guard (G-06-4 closure)]
  - phase: 06-self-service-app-builder/06-12
    provides: [wizard snapshot round trip + deep link (G-06-7 closure)]
provides:
  - Renderer dev server on 5174 making signer pages browser-loadable
  - Scope class + scoped-stylesheet consumption on both signer pages
  - Two-server Playwright harness with renderer + renderer-tablet projects
  - Computed-layout renderer guard over both signer pages at both viewports
  - UAT register recording all four gap closures (G-06-4, G-06-6, G-06-7, G-06-8)
affects: [verify-work (FRM-09 UAT routing), 06-UAT (gap register authoritative for this pass)]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 8800
  tasks: 2
  commits: 2
plan_head_before: 7149632b08a5d237a352b64bd47c065c8b18b027

# Tech tracking
tech-stack:
  added: []
  patterns: [per-project testDir/baseURL with a shared webServer array, live-link vs replay stub classification for edit-page guards, one shared geometry helper across two signer pages]

key-files:
  created:
    - apps/renderer/vite.config.ts
    - apps/renderer/e2e/renderer-form-layout.spec.ts
  modified:
    - apps/renderer/src/read/view.html
    - apps/renderer/src/read/view.browser.ts
    - apps/renderer/src/read/edit.html
    - apps/renderer/src/read/edit.ts
    - playwright.config.ts
    - .planning/phases/06-self-service-app-builder/06-UAT.md

key-decisions:
  - "No resolve.alias / server.fs.allow contingency: the engine resolves from the workspace root on the stock config, so the contingency stays documented, not implemented"
  - "Renderer spec helper (not copy): one expectScopedSignerGeometry so the two pages cannot drift apart"
  - "Edit stub is a live link (no editOutcome): a consumed link replays a confirmation with no layout to assert on"
  - "Whole-suite-as-one-set green is environmentally unproven (OOM + orphaned servers), not code-unproven: recorded, not claimed"

patterns-established:
  - "Renderer page interception: URL-pattern regex over the link path prefix (query follows the trailing separator); origin no-op and empty link id recorded in a comment so nobody 'fixes' the working intercept"
  - "Orphan hygiene for background/foreground Playwright runs: verify no vite/playwright node processes survive a killed run before trusting reuseExistingServer"

requirements-completed: [FRM-09]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Signer read page renders the authored two-column layout with Bootstrap geometry at 1280px and 768px"
    requirement: "FRM-09"
    verification:
      - kind: e2e
        ref: "apps/renderer/e2e/renderer-form-layout.spec.ts#the read page renders the authored two-column layout with Bootstrap geometry (renderer + renderer-tablet)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Signer edit page renders the pre-filled two-column layout with Bootstrap geometry at 1280px and 768px"
    requirement: "FRM-09"
    verification:
      - kind: e2e
        ref: "apps/renderer/e2e/renderer-form-layout.spec.ts#the edit page renders the pre-filled two-column layout with Bootstrap geometry (renderer + renderer-tablet)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Two-server harness collects all projects and boots both dev servers without breaking the app-builder suite"
    requirement: "FRM-09"
    verification:
      - kind: other
        ref: "npx playwright test --list --project=renderer (1 test); --project=chromium (39 tests); app-builder suite 77 passed + isolated designer 5/5 + roles 6/6 under the restructured harness"
        status: pass
    human_judgment: false
  - id: D4
    description: "UAT register records G-06-4, G-06-6, G-06-7, G-06-8 as resolved with the guard that demonstrates each"
    requirement: "FRM-09"
    verification:
      - kind: other
        ref: "node register assertion over 06-UAT.md (all four ids read status: resolved); UAT test 6 added, counts 6 total / 4 passed"
        status: pass
    human_judgment: false

# Metrics
duration: 55min
completed: 2026-10-16
status: complete
---

# Phase 06 Plan 10: Signer-Renderer Styling Closure Summary

**Both signer pages consume the shared scoped Bootstrap sheet under a two-server Playwright harness, proven by computed layout at both viewports — and the UAT register records all four gap closures**

## Performance

- **Duration:** 55min
- **Started:** 2026-10-16T07:30:00Z (approx)
- **Completed:** 2026-10-16T08:23:27Z
- **Tasks:** 2
- **Files modified:** 8 (2 created source + 6 edited, incl. 06-UAT.md)

## Accomplishments

- `apps/renderer/vite.config.ts` serves the renderer on 5174 rooted at the app — the signer pages are browser-loadable for the first time; no proxy (the renderer never calls the builder API), no plugin, no publicDir/appType override
- Read page: `formio-scope` on `#formio-readonly` + static scoped-sheet import beside the engine import; edit page: `formio-scope` on `#formio-edit` + dynamic scoped-sheet import on the live-link path only (replay/deny paths render no form)
- `playwright.config.ts`: `webServer` array (5173 + 5174), per-project `testDir`/`baseURL`, `renderer` (Desktop Chrome 1280×1024) + `renderer-tablet` (768×1024 touch) projects; top-level `testMatch` kept; hazard comment extended (renderer `src/read/*.spec.ts` are vitest specs, so the renderer `testDir` must stay the dedicated `e2e` dir)
- `renderer-form-layout.spec.ts`: one shared `expectScopedSignerGeometry` helper (scope class, non-empty `--bs-primary`, every `.row` a wrapping flex, 2/12+10/12 columns fractional within gutter tolerance, every `.form-control` at 1px top border / 12px left padding, all loops count-guarded) over a stubbed two-column schema — read page and pre-filled edit page, both viewports
- `06-UAT.md`: test 6 appended (signer renderer, pass), Summary 6 total / 4 passed, G-06-4/G-06-6/G-06-7/G-06-8 resolved with resolution + evidence in the existing entry shape; the 5 original test results untouched; register assertion green

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end signer read page** - `9869937` (feat)
2. **Task 2: Signer edit page + UAT register** - `4835444` (feat)

## Files Created/Modified

- `apps/renderer/vite.config.ts` - Renderer dev server (port 5174, rooted at the app), no proxy/plugin, contingency documented-not-implemented
- `apps/renderer/e2e/renderer-form-layout.spec.ts` - Computed-layout guard: shared helper + read-page test (Task 1) + edit-page test (Task 2)
- `apps/renderer/src/read/view.html` - `formio-scope` on the read mount container
- `apps/renderer/src/read/view.browser.ts` - Static scoped-sheet import beside the engine import
- `apps/renderer/src/read/edit.html` - `formio-scope` on the edit mount container
- `apps/renderer/src/read/edit.ts` - Dynamic scoped-sheet import on the live-link path
- `playwright.config.ts` - Two-server harness with per-project testDir/baseURL and two renderer projects
- `.planning/phases/06-self-service-app-builder/06-UAT.md` - Test 6, corrected counts, four gap resolutions with evidence

## Decisions Made

- One generator, two byte-identical consumers holds: the renderer imports the plan-06-09 artifact as-is; this plan wires, never regenerates or forks it (G-06-6/G-06-8 share one root cause, one mechanism)
- The `resolve.alias` + `server.fs.allow` contingency was not needed — the engine resolves from the workspace root on the stock config, so it stays a documented fallback, not dead config
- `localhost` kept for both dev-server URLs/baseURLs (existing convention; the specs fulfil their own responses, so no cross-origin surface exists to harden)
- Playwright invocations used `--workers=1` (see deviation 2): `--maxWorkers` is not a Playwright CLI flag
- The whole-suite-as-one-set gate is recorded as environmentally unproven rather than claimed (see Issues): the deliverable guards all passed; the box could not sustain the 82-test serial run

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A spec-glob inside the config's block comment broke Playwright's config parse**

- **Found during:** Task 1 (first `--list`)
- **Issue:** The extended header comment wrote the spec glob literally; the `*/` inside it terminated the block comment early and babel died with `BABEL_PARSE_ERROR` at `playwright.config.ts:35` before collecting a single test
- **Fix:** Reworded to "matching the spec glob" (no `*/` sequence inside any block comment); also fixed a stray non-ASCII typo in the same comment
- **Files modified:** playwright.config.ts
- **Verification:** `npx playwright test --list --project=renderer` → 1 test collected
- **Committed in:** 9869937 (part of Task 1 commit)

**2. [Rule 3 - Blocking] Plan's Playwright flag `--maxWorkers=1` does not exist**

- **Found during:** Task 1 verification (same finding as plans 06-09/06-11/06-12)
- **Issue:** `npx playwright test ... --maxWorkers=1` dies with `unknown option` — that is a jest/vitest flag; Playwright's is `--workers`
- **Fix:** All e2e verifications ran with `--workers=1` (same single-worker serialisation)
- **Files modified:** none (invocation only)
- **Verification:** renderer 4/4, designer 5/5, roles 6/6 all ran under `--workers=1`
- **Committed in:** n/a (no file change)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking-invocation)
**Impact on plan:** Both necessary for the plan's own verification to run truthfully. No scope creep: no new behavior, no new files beyond the plan's list.

## Issues Encountered

- **The whole-suite-as-one-set run never went green — environmental, not code (3 fix attempts, then stopped per protocol).** Sequence: (a) app-builder-only run under the new harness → 77 passed + 1 cold-mount flake (G-06-3 signature: first chromium designer mount exceeded the 60 s ceiling; the identical test passes on tablet and in isolation); (b) isolated designer retry → 5/5 chromium; (c) full 4-project run → 58 passed / 24 failed, every failure a builder-mount test with `Failed to fetch dynamically imported module`; (d) forensics: 7 orphaned processes from my own tool-timed-out foreground runs (a Playwright CLI + worker plus a stale vite pair) were still holding 5173/5174, so every later run's `reuseExistingServer: true` reused a wedged server while leaked workers drove the 11.9 GB box to 2.9 GB free; (e) orphans killed (command lines verified; gsd-mcp × 4 and the user's Chrome untouched), rerun → the fresh 5173 server then died mid-run (non-builder specs failing in 1.3 s) with the box at 1.9 GB free, run aborted (EXIT:-1), orphans cleaned again. What IS proven: renderer 4/4 on clean servers, vitest scope 129/129, app-builder 77/78 + 5/5 + 6/6 under this exact harness, and zero app-builder files touched by this plan (only the harness config), so no code path exists for a plan-caused app-builder regression. Re-run command for a healthy box: `npx playwright test --workers=1` (all four projects, ~82 tests). No SUMMARY claim depends on that run.
- **Pre-existing server noise, left untouched per scope boundary:** the renderer dev server logs a `[PARSE_ERROR]` on `dead.html`'s inline TypeScript (`as` cast) during dependency scan, and the app-builder server logs `Failed to run dependency scan … Build failed with 2 errors`; both are non-fatal (every suite that needs those servers passes). `dead.html` is not in this plan's files.
- **Full `npx vitest run` is not green in this environment — pre-existing infra failures, same as 06-09/06-11/06-12 recorded** (testcontainers suites with no container runtime, onboarding/toolchain-pin suites, the known `entrypoint-drift` failure in STATE.md). In-scope suites all pass: `apps/renderer` + `apps/app-builder` + `tooling/formio-scope-css.spec.ts` → 10 files / 129 tests green, including the file-content assertions on all four edited renderer files.
- **Do-not-touch repo constraints honoured:** `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `start-api.bat`, `testenv.mjs`, `probe-designer-style.mjs` left untracked/uncommitted; probe log files removed after use.

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema changes beyond the plan's threat model. The new dev server binds localhost and is test-only (T-06-39 accept); fixtures are synthetic (T-06-40 accept); the scope class sits on the two FormIO mounts only (T-06-41 mitigated); the register update is gated by the four-id assertion (T-06-42 mitigated). No installs, no `package.json` change (T-06-SC).

## Known Stubs

None — scanned all created/modified files for empty values, placeholder copy, and TODO/FIXME markers. The e2e stub payloads are synthetic harness fixtures, not product surface.

## Self-Check: PASSED

- `apps/renderer/vite.config.ts`, `apps/renderer/e2e/renderer-form-layout.spec.ts` — FOUND
- `view.html` / `view.browser.ts` / `edit.html` / `edit.ts` — scope class + sheet import present
- `playwright.config.ts` — webServer array, four projects, per-project testDir/baseURL
- `06-UAT.md` — test 6 present, total 6 / passed 4, G-06-4/G-06-6/G-06-7/G-06-8 all `status: resolved` (register assertion green)
- Commits `9869937`, `4835444` — both in `git log`; no commit deleted tracked files
- No `package.json` created under `apps/renderer`; no new root dependency

## Self-Check: PASSED

- All created/modified files FOUND on disk; both task commits (`9869937`, `4835444`) in `git log`
- No commit deleted tracked files; forbidden untracked files untouched
- Register assertion green; vitest scope 129/129; renderer e2e 4/4

## User Setup Required

None - no external service configuration required. No installs performed.

## Next Phase Readiness

- G-06-8 is closed in code and in the register: both signer pages render the authored layout with Bootstrap geometry, proven by computed style at both viewports; the renderer is browser-loadable and the harness boots per-app servers
- The UAT register is authoritative for this pass: G-06-3/G-06-5 (previously resolved) plus G-06-4/G-06-6/G-06-7/G-06-8 (this plan set) all read `resolved` — no gap the plan set closes is left reading `failed`
- One environmental follow-up, no code follow-up: re-run `npx playwright test --workers=1` as one set on a healthy box (freed of orphaned vite/playwright processes, adequate free memory) to hold the whole-suite-green evidence in one place; nothing in this plan blocks on it
- No blockers. No auth gates encountered.

---
*Phase: 06-self-service-app-builder*
*Completed: 2026-10-16*
