---
phase: 06-self-service-app-builder
plan: 12
subsystem: ui
tags: [react, wizard, sessionStorage, hash-routing, form-designer, playwright, vitest]

# Dependency graph
requires:
  - phase: 06-08
    provides: [wizard five-step flow with per-section PATCH, designer page-head, stubbed wizard e2e harness]
provides:
  - Session-scoped wizard snapshot store with shape guards and injectable storage
  - Wizard-to-designer round trip resuming the exact step with in-progress inputs intact
  - Designer return control gated on a live snapshot plus deep-link resume and fresh-wizard guard
affects: [06-10 (owns the UAT register recording of G-06-7), form-designer navigation, wizard follow-ups]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 8546
  tasks: 2
  commits: 2
plan_head_before: b18f9937ddb235a0f5bce0738aef17d1d1d842e0

# Tech tracking
tech-stack:
  added: []
  patterns: [session-scoped snapshot with versioned shape guards, replaceState route sync without hashchange, keyed remount for route-identity change]

key-files:
  created:
    - apps/app-builder/src/wizard/wizardDraftStore.ts
    - apps/app-builder/src/wizard/wizardDraftStore.spec.ts
  modified:
    - apps/app-builder/src/wizard/WizardPage.tsx
    - apps/app-builder/src/App.tsx
    - apps/app-builder/src/form-designer/FormDesignerPage.tsx
    - apps/app-builder/e2e/wizard.spec.ts

key-decisions:
  - "Resume restores position+inputs from the session snapshot and the draft definition from the server (GET /apps/:id) — the snapshot carries working state, the API carries truth"
  - "Wizard route sync uses history.replaceState, never location.hash assignment, so syncing never fires hashchange and never remounts the page"
  - "RoutedPage keys the wizard by app id so an app-id change remounts into an exact fresh hydration (sidebar Create mid-flow stays a fresh wizard)"
  - "Designer return control renders only with a live snapshot; no breadcrumb was added (explicitly not required)"

patterns-established:
  - "Snapshot pattern: versioned sessionStorage payload, injectable storage defaulting to a guarded accessor, corrupt entries discarded on read"
  - "Route-carried resume position: #/wizard?app=<id>&step=<n> parsed and clamped at the router, consumed as mount props"

requirements-completed: [BLD-01]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Designer detour from wizard step 4 returns to the Form step with Triggers/RBAC/Basics inputs intact and the route carrying app+step"
    requirement: "BLD-01"
    verification:
      - kind: e2e
        ref: "apps/app-builder/e2e/wizard.spec.ts#the wizard survives a designer detour"
        status: pass
    human_judgment: false
  - id: D2
    description: "Deep link to a resumable wizard position with no snapshot resumes on the route step with the draft loaded"
    requirement: "BLD-01"
    verification:
      - kind: e2e
        ref: "apps/app-builder/e2e/wizard.spec.ts#a deep link to a resumable wizard position with no local snapshot resumes on the route step"
        status: pass
    human_judgment: false
  - id: D3
    description: "Fresh wizard route (#/wizard, no query) still starts blank at Basics with Create disabled"
    requirement: "BLD-01"
    verification:
      - kind: e2e
        ref: "apps/app-builder/e2e/wizard.spec.ts#a wizard route with no query still starts a blank five-step wizard at Basics"
        status: pass
    human_judgment: false
  - id: D4
    description: "Snapshot store guards: keyed reads, malformed-payload rejection, step-range rejection, per-app clear, content round-trip, null-storage no-op"
    requirement: "BLD-01"
    verification:
      - kind: unit
        ref: "apps/app-builder/src/wizard/wizardDraftStore.spec.ts"
        status: pass
    human_judgment: false

# Metrics
duration: 40min
completed: 2026-10-16
status: complete
---

# Phase 06 Plan 12: Designer-Return-Path Closure Summary

**Session-scoped wizard snapshots plus route-encoded steps close the designer dead end: leaving step 4 for the designer and returning lands back on the Form step with every typed input intact**

## Performance

- **Duration:** 40min
- **Started:** 2026-10-16T13:40:00Z
- **Completed:** 2026-10-16T14:20:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- `wizardDraftStore` owns the wizard's session working state (app id, step, four step values) with shape guards, a version field, per-app namespaced keys, and an injectable storage that no-ops outside a browser
- `WizardPage` hydrates once on mount from the snapshot, re-reads the draft definition from the server, writes the snapshot on every change while the draft exists, syncs `#/wizard?app=<id>&step=<n>` via `replaceState`, clears on finish, and (Task 2) falls back to the clamped route step with Skeleton/InlineError around the fetch
- `App` parses the wizard route's `app`/`step` query (step clamped to the five-step range, out-of-range reads as absent) and passes them as wizard props; the sidebar Create link is untouched
- `FormDesignerPage` renders a `designer-back-to-wizard` return control in the page-head only when a live snapshot exists — no back-to-app-editor breadcrumb
- e2e pins the round trip (detour and return, inputs intact, route asserted), the no-snapshot deep link, and the fresh-wizard regression guard; the stub's single-app GET leg serves the draft definition both legs need

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end wizard-to-designer round trip** - `96d6376` (feat)
2. **Task 2: Deep link and clamping** - `3317e6c` (feat)

## Files Created/Modified

- `apps/app-builder/src/wizard/wizardDraftStore.ts` - Session snapshot store: read/write/clear with shape guards, versioned payload, injectable storage
- `apps/app-builder/src/wizard/wizardDraftStore.spec.ts` - Node-environment unit spec pinning the six guard behaviours
- `apps/app-builder/src/wizard/WizardPage.tsx` - Snapshot hydration behind a once-only ref, write-on-change plus `replaceState` route sync, clear on completion, deep-link fetch with Skeleton and InlineError
- `apps/app-builder/src/App.tsx` - `app`/`step` query capture in `parseRoute` with step clamping, keyed wizard route in `RoutedPage`
- `apps/app-builder/src/form-designer/FormDesignerPage.tsx` - Return control in the page-head, offered only with a live snapshot
- `apps/app-builder/e2e/wizard.spec.ts` - Single-app GET stub leg with GET hook, round-trip test, deep-link test, fresh-wizard guard

## Decisions Made

- Resume restores position and inputs from the session snapshot but the draft definition from the server (`GET /apps/:id` through the session cookie). Rationale: the snapshot is working state, the API is truth — the resumed wizard holds the definition's version and form schema, binds every later PATCH to the draft, and can never surface another session's data (T-06-48).
- `history.replaceState` (never `location.hash` assignment) for route sync. Rationale: an assignment fires `hashchange`, which re-parses the route and remounts the page — the re-entrancy loop T-06-49 exists to prevent.
- `RoutedPage` keys the wizard by app id (`key={route.appId ?? 'fresh'}`). Rationale: an app-id change without unmount (sidebar Create clicked mid-flow) would otherwise carry the old draft's live edits; the key turns it into an exact fresh hydration. Step syncs use `replaceState` (no `hashchange`), so the key never churns mid-flow.
- App-level step clamping (Task 2's hardening) landed in the Task 1 commit since `parseRoute` was being touched anyway; Task 2 added the WizardPage-side clamp as defense-in-depth.
- Spec doubles avoid the key format: the unit spec writes via `writeWizardSnapshot` then overwrites the raw payload through an inspectable double, so the key-namespace scheme can change without touching the spec.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] Keyed wizard remount on app-id change**
- **Found during:** Task 1 (WizardPage wiring)
- **Issue:** The plan's mount-only hydration assumes mount-constant props, but the sidebar Create link clicked mid-resumed-flow changes the route (synced query → bare `#/wizard`) without unmounting `WizardPage`, which would carry the old draft's state into what must be a fresh wizard.
- **Fix:** `RoutedPage` renders `<WizardPage key={route.appId ?? 'fresh'} .../>` so an app-id change remounts into the exact hydration path.
- **Files modified:** apps/app-builder/src/App.tsx
- **Verification:** fresh-wizard e2e guard passes; full directory e2e suite green (74 passed)
- **Committed in:** 96d6376 (part of task commit)

---

**Total deviations:** 1 auto-fixed (1 correctness)
**Impact on plan:** The key is required for the plan's own "sidebar Create must keep opening a fresh wizard" invariant to hold once the route carries a query. No scope creep.

## Issues Encountered

- Plan verify commands use `--maxWorkers=1` (vitest-style); Playwright 1.64 requires `--workers=1`. Same single-worker semantics; all e2e runs used `--workers=1`.
- `npx tsc --noEmit -p apps/app-builder/tsconfig.json` reports pre-existing environment noise: `@types/react` is not installed, so every tsx file (including untouched ones like `connectors.ts`, `submissions.ts`) fails with TS7016/TS7026/TS7006. My files introduce no new error class except one TS2322 on the `key` prop — `key` on a custom component is always legal with healthy React types and is only flagged because the untyped-JSX fallback checks props literally. Root `tsc -b` does not cover `apps/app-builder` and `vite build`/eslint (clean on all touched files) are the effective gates.
- `npx vitest run` (full suite): 26 failed files / 3 failed tests, all infra-dependent integration suites (Mongo replica set, Redis, real API-process boot, toolchain pins) plus the already-known `entrypoint-drift` failure recorded in STATE.md blockers. Zero overlap with this plan's blast radius: `npx vitest run apps/app-builder` is 25/25 green, including the 6 new store specs.
- No installs performed, no `package.json` change (T-06-SC holds). The mockup was not treated as authority for this navigation (AGENTS.md rule 3): the return control's copy derives from the wizard's own labels and the gap's decided resume model is what ships.

## Auth Gates

None — the e2e suite stubs the builder API via `page.route`; no live backend, IdP, or secret was needed.

## Known Stubs

None — scanned all created/modified files for empty values, placeholder copy, and TODO/FIXME markers. The stub-builder single-app GET leg is test harness, not product surface.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- G-06-7 is closed in code: round trip, deep link, and fresh-wizard guard are pinned by unit + e2e coverage in both viewports. Register recording belongs to plan 06-10 — this plan deliberately did not touch `06-UAT.md`.
- The snapshot key namespace (`akane.wizard-draft.v1.<appId>`) carries a version field, so a future shape change invalidates old entries by construction.

## Self-Check: PASSED

- `wizardDraftStore.ts`, `wizardDraftStore.spec.ts` exist; `WizardPage.tsx`, `App.tsx`, `FormDesignerPage.tsx`, `wizard.spec.ts` modified — all FOUND.
- Commits `96d6376` and `3317e6c` verified in `git log`.
- e2e: `wizard.spec.ts` 8/8 chromium, 8/8 tablet; directory suite 74/74; unit: `apps/app-builder` 25/25.

---
*Phase: 06-self-service-app-builder*
*Completed: 2026-10-16*
