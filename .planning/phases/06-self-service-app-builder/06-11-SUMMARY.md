---
phase: 06-self-service-app-builder
plan: 11
subsystem: ui
tags: [react, playwright, vitest, publish-gate, keyboard-shortcut, BLD-06]

# Dependency graph
requires:
  - phase: 06-08
    provides: [editor page with publish() POST, keydown chord wiring, stubbed editor e2e harness]
provides:
  - Explicit publish confirmation gate both entry points route through (G-06-4 clause 1)
  - Pure dirty-JSON / chord-may-publish guard predicates with unit spec (G-06-4 clause 2)
  - First publish coverage in editor.spec.ts (request-count assertions, confirm + dirty-chord tests)
affects: [06-10 (owns the G-06-4 register closure in 06-UAT.md), verify-work (BLD-06 UAT routing)]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 4800
  tasks: 2
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns: [single-gate entry point for a state-changing action, pure guard predicates beside the page with node-environment specs]

key-files:
  created:
    - apps/app-builder/src/editor/publishGuards.ts
    - apps/app-builder/src/editor/publishGuards.spec.ts
  modified:
    - apps/app-builder/src/editor/EditorPage.tsx
    - apps/app-builder/e2e/editor.spec.ts

key-decisions:
  - "Gate states the effect without change rows — the change summary is the publish response payload and no dry-run endpoint exists (frozen-contract precedence)"
  - "Only the chord carries the dirty guard — a button click is an explicit act the gate already confirms; the gap names the shortcut"
  - "Stub PATCH echoes the forms-section patch so a saved edit stops reading as dirty (the page re-reads persisted state off the PATCH response)"

patterns-established:
  - "Confirmation gate: one requestPublish() entry point; publish() reachable only from the gate's confirm control; request-count (not label) assertions prove it"
  - "Pure editor guards live beside publishShortcut.ts with node-environment vitest specs asserting the same rule the e2e proves"

requirements-completed: [BLD-06]

# Coverage metadata (#1602) — one entry per shipped deliverable. Drives DETERMINISTIC UAT routing in verify-work.
coverage:
  - id: D1
    description: "Publish confirmation gate: button and Ctrl/Cmd+S route through one gate; only the confirm control POSTs; cancel posts nothing"
    requirement: "BLD-06"
    verification:
      - kind: e2e
        ref: "apps/app-builder/e2e/editor.spec.ts#publish opens a confirmation naming the app and posts only on confirm (chromium + tablet)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Dirty-chord guard: Ctrl/Cmd+S over a mid-edit JSON section is blocked inline naming the section; saving clears it and the chord then opens the gate"
    requirement: "BLD-06"
    verification:
      - kind: unit
        ref: "apps/app-builder/src/editor/publishGuards.spec.ts (5 tests)"
        status: pass
      - kind: e2e
        ref: "apps/app-builder/e2e/editor.spec.ts#the chord over a mid-edit section is blocked and names the section (chromium + tablet)"
        status: pass
    human_judgment: false

# Metrics
duration: 55min
completed: 2026-10-16
status: complete
---

# Phase 06 Plan 11: Publish Confirmation Gate Summary

**Explicit publish confirmation gate plus a dirty-JSON chord guard — publishing an app now asks first, and Ctrl/Cmd+S cannot publish a mid-edit section**

## Performance

- **Duration:** 55min
- **Started:** 2026-10-16T05:40:00Z (approx)
- **Completed:** 2026-10-16T06:35:10Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- One `requestPublish()` gate in `EditorPage.tsx`: the publish button and the Ctrl/Cmd+S chord both open it, and `publish()` is reachable only from the gate's confirm control — verified by recorded POST count (zero until confirm, exactly one after)
- Two pure BLD-06 predicates in `publishGuards.ts` (`jsonDraftIsDirty`, `shortcutMayPublish`) pinned by a 5-test node-environment spec
- Chord-over-mid-edit blocked inline with a notice naming the section (`The Forms section has unsaved changes — save the section before publishing.`); saving clears it and the chord then opens the gate
- `editor.spec.ts` gains the publish coverage it never had: a publish stub leg with request hooks, a confirm/cancel test, and a dirty-chord test — 5/5 green in chromium and tablet, 72/72 full app-builder Playwright set green

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end publish confirmation** - `500983c` (feat)
2. **Task 2: Dirty-chord guard + predicates** - `c3bb18e` (feat)

**Plan metadata:** `a062b23` (docs: complete plan)

## Files Created/Modified

- `apps/app-builder/src/editor/publishGuards.ts` - the two pure BLD-06 guard predicates (dirty JSON, chord-may-publish)
- `apps/app-builder/src/editor/publishGuards.spec.ts` - node-environment unit spec pinning both predicates (5 tests)
- `apps/app-builder/src/editor/EditorPage.tsx` - the single confirmation gate both entry points route through, gate markup, dirty-JSON wiring plus blocked notice
- `apps/app-builder/e2e/editor.spec.ts` - publish leg in the stub (with `onPublish` hook), PATCH echo of the forms patch, confirmation test, dirty-chord test

## Decisions Made

- Gate carries no change rows: the change summary is the publish *response* payload and no dry-run endpoint exists, so the gate states the effect ("Publishing makes your changes take effect immediately.") rather than inventing a diff — frozen-contract precedence per the plan
- Only the chord carries the dirty guard; the button path is unchanged apart from routing through the gate — the gap names the shortcut specifically
- Confirm control gated on the same `saving` flag as the publish button, and the gate closes as the first act of `publish()`, so a held repeat cannot queue a second publish (T-06-44)
- The gate renders in-flow (no overlay) with `role="dialog"` + `aria-modal` + labelled heading — reachable at 768px by construction, proven by the tablet project run
- Stub PATCH echoes the forms-section patch back into the served definition, because the page re-reads the persisted value off the PATCH response — without the echo a saved edit would still read as dirty

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Restored the Task 1 confirmation test after an over-broad edit deleted its header**

- **Found during:** Task 2 (e2e dirty-chord test insertion)
- **Issue:** An edit replacing the BLD-07 test header with the new test accidentally removed the Task 1 confirmation test committed in `500983c`
- **Fix:** Re-inserted the confirmation test verbatim ahead of the new dirty-chord test; verified 5 distinct `test(` blocks and no duplicates before committing
- **Files modified:** apps/app-builder/e2e/editor.spec.ts
- **Verification:** `test(` count = 5, chromium + tablet runs show all 5 tests passing
- **Committed in:** c3bb18e (Task 2 commit)

**2. [Rule 3 - Blocking] Playwright flag correction: `--workers=1`, not `--maxWorkers=1`**

- **Found during:** Task 1 verification
- **Issue:** The plan's `<verify>` commands use `--maxWorkers=1`, which Playwright 1.64 rejects (`unknown option`) — that flag belongs to jest/vitest
- **Fix:** Ran all Playwright verifications with `--workers=1` (same single-worker serialisation intent)
- **Files modified:** none (command-line only)
- **Verification:** all suites ran and passed under `--workers=1`
- **Committed in:** n/a (no code change)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both necessary for correctness of the deliverable and its verification. No scope creep — no new endpoints, no dependency or script changes, no rows in the gate.

## Issues Encountered

- **Full `npx vitest run` is not green in this environment — pre-existing infra failure, not a regression.** 26 failed suites are all `*.integration.spec.ts` failing at testcontainers setup (`getContainerRuntimeClient` — no container runtime reachable; log also shows `mongo unavailable`) plus `tooling/toolchain-pin` and `tooling/onboarding` (needs a bootable api + env). The 3 failed *tests* are `tooling/entrypoint-drift` (already the known single failure recorded in STATE.md) and 2 onboarding tests. Evidence this is unrelated to the plan: the changed files are SPA-only (`EditorPage.tsx`, `publishGuards.*`, e2e spec) and cannot affect server integration suites; every in-scope suite is green — `apps/app-builder` vitest 5 files / 19 tests pass, `tsc -b` clean, `eslint` on all four touched files clean, full Playwright set 72/72 pass.
- **Vite dev server was down at execution start** (host restarted). Playwright's `webServer` stanza booted it automatically; no manual restart needed.
- **Do-not-touch repo constraints honoured:** `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `start-api.bat`, `testenv.mjs`, `probe-designer-style.mjs` left untracked/uncommitted; `06-UAT.md` untouched (register closure belongs to plan 06-10).

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema changes. The publish POST path is unchanged; the gate only restricts *how* the existing endpoint is reached (T-06-43 mitigated by single-caller invariant + zero-until-confirm e2e; T-06-44 by `saving`-gated confirm + close-on-confirm; T-06-45 by the dirty predicate + inline block). No installs, no new dependencies (T-06-SC).

## Known Stubs

None.

## Self-Check: PASSED

- `apps/app-builder/src/editor/publishGuards.ts` — FOUND
- `apps/app-builder/src/editor/publishGuards.spec.ts` — FOUND
- `apps/app-builder/src/editor/EditorPage.tsx` — gate + dirty wiring present
- `apps/app-builder/e2e/editor.spec.ts` — 5 tests, publish leg + hooks present
- Commits `500983c`, `c3bb18e` — both in `git log`

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- G-06-4 is closed in code: both truth clauses hold under asserted request counts in both viewports. Register recording belongs to plan 06-10 (sole writer of `06-UAT.md`) — this plan deliberately did not touch it.
- Wave-9 note: 06-09 and 06-12 share the wave; this plan's `files_modified` sets are disjoint from theirs and the full app-builder Playwright set (72 tests, both projects) passed after both commits.
- No blockers. No auth gates encountered.

---
*Phase: 06-self-service-app-builder*
*Completed: 2026-10-16*
