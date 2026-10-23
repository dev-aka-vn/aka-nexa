---
phase: 06-self-service-app-builder
plan: 01
subsystem: ui
tags: [formio, react, playwright, vite, undo-redo, drag-and-drop, bootstrap-5]

requires: []
provides:
  - "FormIO 5.6.1 builder mounted in a React 19 SPA shell via a guarded dynamic import (Pattern 1) with container-as-leaf mounting (Pattern 4)"
  - "BLD-04 undo/redo: SchemaHistory — debounced 300 ms builder.schema snapshots, 50-entry ring buffer, restore via builder.setForm()"
  - "One Bootstrap-4-era label template ported to the 5.x bootstrap-5 template set (sr-only -> visually-hidden) via Formio.Templates.extendTemplate"
  - "SPA toolchain: vite 8.3.4 + @vitejs/plugin-react, Playwright 1.64.0 with chromium (1280x1024) and tablet (768x1024, touch) projects, mockup token set in tokens.css"
  - "ALLOWED_EDGES.builder extended with identity, links, contract (Pattern 6)"
affects: [06-02, 06-03, 06-04, 06-05, 06-06, 06-07, 06-08]

actuals:
  tokens: 19333
  tasks: 2
  commits: 2

tech-stack:
  added:
    - "react@19.3.0, react-dom@19.3.0"
    - "@formio/js@5.6.1"
    - "vite@8.3.4, @vitejs/plugin-react@6.1.2"
    - "@playwright/test@1.64.0"
    - "openid-client@6.8.8, @casl/ability@7.0.1, csv-stringify@6.9.0"
  patterns:
    - "Pattern 1 — guarded dynamic import of @formio/js inside a DOM check (a static import in any Node-executed file throws ReferenceError: document is not defined; asserted as the negative control)"
    - "Pattern 4 — container-as-leaf mounting: React never renders children into the FormIO-controlled subtree"
    - "Pattern 2 / BLD-04 — debounced schema-snapshot history: builder.on('change') -> history.capture(builder.schema), restore via builder.setForm(); never monkey-patch builder.instance (FormIO 5.6.1 exposes no builder undo/redo API)"
    - "FormIO 5.6.1 sidebar add flow — dragula drag-and-drop onto the canvas, then the component edit dialog's Save button (the change event fires on dialog save for new components)"

key-files:
  created:
    - apps/app-builder/index.html
    - apps/app-builder/tsconfig.json
    - apps/app-builder/vite.config.ts
    - apps/app-builder/src/main.browser.ts
    - apps/app-builder/src/tokens.css
    - apps/app-builder/src/App.tsx
    - apps/app-builder/src/form-designer/FormioBuilderField.tsx
    - apps/app-builder/src/form-designer/undoHistory.ts
    - apps/app-builder/src/form-designer/undoHistory.spec.ts
    - apps/app-builder/src/form-designer/bootstrap5Templates.ts
    - apps/app-builder/src/form-designer/representativeSchema.ts
    - apps/app-builder/e2e/s1-spike.spec.ts
    - playwright.config.ts
  modified:
    - package.json
    - package-lock.json
    - tooling/boundaries.config.mjs
    - vitest.config.mts
    - .gitignore

key-decisions:
  - "S1 outcome: @formio/js@5.6.1 CONFIRMED — the builder mounts, renders, and round-trips in Chromium under the pinned 5.6.1; the formiojs@4.21.7 fallback is not adopted"
  - "FormIO 5.6.1's sidebar is dragula-powered: a plain click on a sidebar component is a no-op (only an Enter-key handler exists, gated on the off-by-default keyboardBuilder option), so the e2e drives the real drag-and-drop flow"
  - "New-component drops open the component edit dialog (.formio-dialog); the builder's change event — the SchemaHistory input — fires when that dialog is saved (saveComponent), so the e2e saves the dialog"
  - "The chromium Playwright project runs at 1280x1024: the builder canvas is taller than the default 720px viewport, and a drop point below the fold is a cancelled dragula drag (release() finds no container under the cursor and emits a null-target 'drop' that onDrop ignores)"
  - "The tablet project is chromium-backed with viewport 768x1024 + hasTouch + isMobile; the iPad device preset is deliberately NOT spread because its defaultBrowserType is webkit, which cannot be installed in this environment (no OS-deps access)"
  - "TypeScript stays pinned at the workspace root (6.0.3); the SPA never re-declares typescript (Pitfall 12)"

patterns-established:
  - "Guarded dynamic import: the only import shape for @formio/js — every import in the SPA is `await import('@formio/js')` inside a typeof document check"
  - "Spike debug handle: window.__SPIKE__ (getSchema/getBuilder/getHistory/getPreviewForm) — deliberate spike-only observability, replaced by real designer chrome in later plans"
  - "Representative schema + submission as shared fixtures for the builder mount and the preview pane"

requirements-completed: [BLD-04, FRM-05, FRM-09]

coverage:
  - id: D1
    description: "FormIO 5.6.1 builder mounts in the React 19 shell via a guarded dynamic import and renders a representative form in Chromium"
    requirement: BLD-04
    verification:
      - kind: e2e
        ref: "apps/app-builder/e2e/s1-spike.spec.ts#builder mounts; a text-component add fires change and the captured snapshot deep-equals builder.schema"
        status: pass
    human_judgment: false
  - id: D2
    description: "FRM-05 boundary: min/max passes exactly at the bound and fails one step outside, with component.errors an array read via errors[0].message"
    requirement: FRM-05
    verification:
      - kind: e2e
        ref: "apps/app-builder/e2e/s1-spike.spec.ts#FRM-05 boundary: min/max passes exactly at the bound and fails one step outside, with component.errors an array"
        status: pass
    human_judgment: false
  - id: D3
    description: "EditGrid.validateRow returns an array — validity is validateRow(...).length === 0 (the 5.x shape)"
    requirement: FRM-05
    verification:
      - kind: e2e
        ref: "apps/app-builder/e2e/s1-spike.spec.ts#EditGrid.validateRow returns an array — isValid is validateRow(...).length === 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "SchemaHistory: 300 ms burst coalesces to one snapshot, 50-entry ring buffer evicts the oldest, new capture clears redo, null at either end, latest() observability"
    requirement: BLD-04
    verification:
      - kind: unit
        ref: "apps/app-builder/src/form-designer/undoHistory.spec.ts#SchemaHistory (BLD-04 — Pattern 2 schema-snapshot undo/redo)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Pitfall 1 negative control — a static import of @formio/js in a Node spec fails with ReferenceError: document is not defined"
    requirement: BLD-04
    verification:
      - kind: unit
        ref: "apps/app-builder/src/form-designer/undoHistory.spec.ts#Pitfall 1 negative control — @formio/js must never be imported in Node"
        status: pass
    human_judgment: false
  - id: D6
    description: "Undo/redo round-trips a real component add through the real builder (setForm restore path)"
    requirement: BLD-04
    verification:
      - kind: e2e
        ref: "apps/app-builder/e2e/s1-spike.spec.ts#undo/redo round-trips a real component add through the builder"
        status: pass
    human_judgment: false
  - id: D7
    description: "One Bootstrap-4-era label template ported to the 5.x bootstrap-5 default template — renders visually-hidden, never sr-only"
    requirement: FRM-09
    verification:
      - kind: e2e
        ref: "apps/app-builder/e2e/s1-spike.spec.ts#the ported Bootstrap-4-era label template renders with the 5.x class vocabulary"
        status: pass
    human_judgment: false
  - id: D8
    description: "ALLOWED_EDGES.builder includes identity, links, contract; boundary fixture suite stays green"
    requirement: BLD-04
    verification:
      - kind: unit
        ref: "tooling/boundaries.fixture.spec.ts (9/9)"
        status: pass
    human_judgment: false
  - id: D9
    description: "SPA toolchain hardening — tokens.css carries the mockup :root token set verbatim; Playwright tablet project (768x1024, touch); npx vite build exits 0"
    verification:
      - kind: other
        ref: "grep -c -- '--accent:' apps/app-builder/src/tokens.css -> 1; grep -c 'tablet' playwright.config.ts -> 4; npx vite build -> exit 0"
        status: pass
    human_judgment: false
  - id: D10
    description: "S1 outcome recorded: @formio/js@5.6.1 confirmed (not the formiojs@4.21.7 fallback)"
    verification:
      - kind: manual_procedural
        ref: "this SUMMARY — Task 1 package-legitimacy gate verdicts + S1 spike evidence"
        status: pass
    human_judgment: true
    rationale: "The S1 outcome statement is a phase-gate record for the roadmap; the spike evidence behind it is fully automated (D1-D7), but the record itself is a human-readable decision artifact."

duration: 74min
completed: 2026-10-12
status: complete
---

# Phase 06 Plan 01: Self-Service App Builder — Foundation & FormIO 5.6.1 Spike Summary

**FormIO 5.6.1 builder mounted in a React 19 shell with BLD-04's 50-action schema-snapshot undo/redo, the 5.x error shapes (errors array, validateRow array) asserted green in Chromium, one Bootstrap-4-era template ported to bootstrap-5, and the SPA toolchain (vite 8.3.4 + Playwright 1.64.0 chromium/tablet projects) proven with a clean build — S1 outcome: @formio/js@5.6.1 confirmed.**

## Task 1 — package-legitimacy gate verdicts (human-approved 2026-10-12)

All eight pinned packages verified against the npm registry before install:

| Package | Version | License | Repository | Verdict |
|---------|---------|---------|------------|---------|
| csv-stringify | 6.9.0 | MIT | github.com/adaltas/node-csv | ✅ legitimate |
| vite | 8.3.4 | MIT | github.com/vitejs/vite | ✅ legitimate |
| @vitejs/plugin-react | 6.1.2 | MIT | github.com/vitejs/vite-plugin-react | ✅ legitimate |
| @playwright/test | 1.64.0 | Apache-2.0 | github.com/microsoft/playwright | ✅ legitimate |
| react | 19.3.0 | MIT | github.com/react/react | ✅ legitimate |
| react-dom | 19.3.0 | MIT | github.com/react/react | ✅ legitimate |
| openid-client | 6.8.8 | MIT | github.com/panva/openid-client | ✅ legitimate |
| @casl/ability | 7.0.1 | MIT | github.com/stalniy/casl | ✅ legitimate |

`@formio/js` is pinned at **5.6.1** (not npm latest — 5.7.0 exists) per the plan and STACK.md §9.2.

## S1 outcome

**'@formio/js@5.6.1 confirmed'** — the spike passed: the builder mounts, renders, accepts a drag-and-drop component add, round-trips undo/redo through the real builder, and the ported template renders with the 5.x class vocabulary. The `formiojs@4.21.7` fallback (MIT, official maintenance mode) is **not adopted**; per the plan it would be acceptable only as an explicit decision with spike evidence — no such decision was needed.

## Task 2 — FormIO 5.6.1 builder spike in the React 19 shell (TDD) — commit fc849ab3

- TDD red→green: `undoHistory.spec.ts` written first (6 specs incl. the Test 4 negative control), confirmed failing (module-not-found), then `undoHistory.ts` implemented; the negative control (`await expect(import('@formio/js')).rejects.toThrow(/document is not defined/)`) proves the dynamic import really rejects in Node.
- SPA scaffolded per the renderer precedent: `index.html` (with the mockup's font pipeline), `tsconfig.json` (DOM lib + jsx), `vite.config.ts` (React plugin, /api dev proxy), `src/main.browser.ts` (guarded browser-only entry).
- `FormioBuilderField.tsx`: guarded dynamic import of `@formio/js` inside a `typeof document` check (Pattern 1), `Formio.builder(container, schema, {})` awaited in a mount-once effect, container-as-leaf (Pattern 4), `builder.on('change')` wired to the SchemaHistory with a restore lock so `setForm()` restores don't re-capture.
- `undoHistory.ts` (BLD-04 / Pattern 2): debounced 300 ms capture of `builder.schema`, `MAX_HISTORY = 50` ring buffer, `undo()`/`redo()` restore via `builder.setForm(snapshot)`, `latest()` read-only observability hook. Never monkey-patches `builder.instance` (Pitfall 3 — FormIO 5.6.1 exposes no builder undo/redo API).
- `bootstrap5Templates.ts`: the Bootstrap-4-era label template ported to the 5.x bootstrap-5 set (`sr-only` → `visually-hidden`, `form-group` → `formio-form-group`), registered via `Formio.Templates.extendTemplate('bootstrap', ...)`.
- `representativeSchema.ts`: the shared schema (textfield required, number min/max 5–10, editgrid, hidden-label required field) + one-row submission.
- `App.tsx`: spike shell — undo/redo toolbar, preview pane (`Formio.createForm`, the FRM-09 render path), `window.__SPIKE__` debug handle.
- `e2e/s1-spike.spec.ts`: 5 specs — mount + drag-and-drop add + change-event snapshot deep-equal; FRM-05 min/max boundary with `errors[0].message`; `EditGrid.validateRow` array shape; undo/redo round-trip through the real builder; template-port assertion (`visually-hidden`, never `sr-only`).
- `tooling/boundaries.config.mjs`: `ALLOWED_EDGES.builder` extended with `identity`, `links`, `contract` (Pattern 6, permissive edges before the R1/R2/R3 restrictions — last-match-wins).

**Verification evidence (Task 2):**
- `npx playwright test apps/app-builder/e2e/s1-spike.spec.ts` → **5 passed**
- `npx vitest run apps/app-builder/src/form-designer --maxWorkers=1` → **6 passed** (incl. the document-is-not-defined negative control)
- `npx vitest run tooling/boundaries.fixture.spec.ts --maxWorkers=1` → **9 passed**
- `npm ls react vite @vitejs/plugin-react @playwright/test csv-stringify openid-client @casl/ability @formio/js` → all pinned versions present, no unmet peers

## Task 3 — SPA toolchain hardening — commit 91865e68

- `apps/app-builder/src/tokens.css`: the mockup's `:root` custom properties verbatim (prototypes/mockup.html:47-84) — the full token set (ink/canvas/surface/line/text/accent scales, amber/red/green/blue/violet with -soft variants, radii, shadows, sans/display/mono stacks, `--topbar-h:60px`, `--side-w:250px`, `--od-gap:8px`). No second palette (AGENTS.md rule 1).
- `main.browser.ts` imports `tokens.css`; fonts load through the mockup's exact head mechanism (preconnects + the Google Fonts stylesheet in `index.html`) — no second font pipeline.
- `playwright.config.ts`: tablet project added — 768×1024, `hasTouch: true`, `isMobile: true`, chromium-backed (the iPad preset's `defaultBrowserType` is webkit, uninstallable here); chromium project viewport raised to 1280×1024 so the builder canvas fits.
- `npx playwright install chromium` completed (chromium_headless_shell-1248).
- `npx vite build` → **exit 0**.

**Verification evidence (Task 3):**
- `grep -c -- '--accent:' apps/app-builder/src/tokens.css` → 1
- `npx vite build` → exit 0, "✓ built"
- `grep -c 'tablet' playwright.config.ts` → 4
- Full e2e across both projects → **10 passed** (5 chromium + 5 tablet)

**Final combined verification:**
- `npx vitest run tooling/boundaries.fixture.spec.ts apps/app-builder/src/form-designer --maxWorkers=1` → **15 passed** (2 files)
- `npm ls` (all eight pins) → no unmet/missing/invalid
- Every `@formio/js` import in `apps/app-builder` is a guarded `await import` (the only static-shaped match is a comment in the negative-control spec explaining the pitfall)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] vitest config excludes `**/e2e/**`**
- **Found during:** Task 2
- **Issue:** Playwright e2e specs match the root vitest include glob (`apps/**/*.spec.ts`) but are not vitest specs; without the exclusion `npm test` would fail loading Playwright-only test files.
- **Fix:** `vitest.config.mts` — `exclude: [...defaultExclude, '**/e2e/**']`
- **Files modified:** vitest.config.mts
- **Commit:** fc849ab3

**2. [Rule 2 - Missing critical functionality] Playwright generated output gitignored**
- **Found during:** Task 2
- **Issue:** Running the e2e suite generates `test-results/` (traces, screenshots) — untracked generated output with no gitignore entry.
- **Fix:** `.gitignore` — `test-results/`, `playwright-report/`
- **Files modified:** .gitignore
- **Commit:** fc849ab3

**3. [Rule 1 - Bug] e2e drove a click-add; FormIO 5.6.1's sidebar is dragula-powered**
- **Found during:** Task 2 verification
- **Issue:** The spike spec clicked the sidebar's "Text Field" button. In FormIO 5.6.1 the sidebar has no click-to-add handler — only a dragula drag-and-drop (and an Enter-key handler gated on the off-by-default `keyboardBuilder` option). The click was a no-op, so no `change` event fired and the specs failed.
- **Fix:** The e2e now drives the real user flow: a mouse drag from the sidebar onto the canvas, then the component edit dialog's Save button (a new-component drop opens `.formio-dialog`; the builder's `change` event — SchemaHistory's input — fires on dialog save via `saveComponent`). The flow waits for the preview pane (its async mount re-flows the page), scrolls the form into view, re-measures, and drops near the top of the form.
- **Files modified:** apps/app-builder/e2e/s1-spike.spec.ts
- **Commit:** fc849ab3

**4. [Rule 1 - Bug] chromium project viewport clipped the builder canvas**
- **Found during:** Task 2 verification
- **Issue:** The default 1280×720 viewport is shorter than the builder canvas (~480px tall starting ~y=460 after the preview mounts). A drop point below the fold is a *cancelled* dragula drag: `release()` finds no container under the cursor and emits a null-target "drop" that `onDrop` ignores (`if (!target) return`).
- **Fix:** chromium project viewport 1280×1024; the e2e additionally waits for the preview, `scrollIntoViewIfNeeded`, and drops at a viewport-safe offset.
- **Files modified:** playwright.config.ts, apps/app-builder/e2e/s1-spike.spec.ts
- **Commit:** fc849ab3

**5. [Rule 3 - Blocking issue] tablet project initially inherited webkit via the iPad device preset**
- **Found during:** Task 3
- **Issue:** Spreading `devices['iPad (gen 7)']` sets `defaultBrowserType: "webkit"`; webkit is not installed and cannot be installed in this environment (`npx playwright install-deps` needs sudo, which requires a password).
- **Fix:** The tablet project is chromium-backed with explicit `viewport: { width: 768, height: 1024 }`, `hasTouch: true`, `isMobile: true` — exactly the plan's acceptance criteria ("viewport 768×1024 and touch emulation") without the webkit dependency.
- **Files modified:** playwright.config.ts
- **Commit:** 91865e68

**6. [Rule 2 - Missing critical functionality] spike debug handle exposes the builder instance**
- **Found during:** Task 2 verification
- **Issue:** Asserting the change-event wiring end-to-end needed the mounted builder instance (e.g. `getBuilder()` for introspection of the dragula drake while diagnosing the drop flow).
- **Fix:** `SpikeDebugHandle` gained `getBuilder()` — deliberate spike-only observability, documented as replaced by real designer chrome in later plans.
- **Files modified:** apps/app-builder/src/App.tsx
- **Commit:** fc849ab3

### Scope notes (plan's `files_modified` list was incomplete)

The plan's action text describes the preview pane, the representative schema, and the template port, but `files_modified` omitted the files that carry them: `apps/app-builder/src/App.tsx` (spike shell + preview pane), `apps/app-builder/src/form-designer/representativeSchema.ts`, and `apps/app-builder/src/form-designer/bootstrap5Templates.ts`. All three are created and committed in fc849ab3. `vitest.config.mts` and `.gitignore` were modified per deviations 1–2 above.

## Known Stubs

- `window.__SPIKE__` debug handle (apps/app-builder/src/App.tsx) — deliberate spike-only scaffolding providing `getSchema`/`getBuilder`/`getHistory`/`getPreviewForm` for the Playwright specs. It is explicitly marked in-code as observability for the spike, not a production API; later plans (06-02+) replace it with real designer chrome. Tracked for the verifier; does not block the plan's goal (the spike's purpose is to prove the FormIO mechanics, not to ship designer UX — BLD-04's full designer UX is a manual-verify item per 06-VALIDATION.md).

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary surfaces beyond what the plan's threat model covers (the SPA is a static shell; `@formio/js` is loaded from the bundled npm package, not a CDN).

## Self-Check: PASSED

- [x] `apps/app-builder/src/tokens.css` exists (grep `--accent:` → 1)
- [x] `apps/app-builder/src/main.browser.ts` imports tokens.css
- [x] `playwright.config.ts` defines chromium + tablet projects (grep `tablet` → 4)
- [x] `apps/app-builder/src/form-designer/undoHistory.ts` + `undoHistory.spec.ts` exist (6 specs pass)
- [x] `apps/app-builder/e2e/s1-spike.spec.ts` exists (10 specs pass across both projects)
- [x] `tooling/boundaries.config.mjs` ALLOWED_EDGES.builder includes identity/links/contract (9 fixtures pass)
- [x] Commit fc849ab3 (Task 2) and 91865e68 (Task 3) on `gsd/phase-06-self-service-app-builder`
- [x] `npx vite build` exits 0
- [x] Plan ledger: 1f1442a60b6c717572f22e7583c18936bc5fdfdd → 91865e687e66b869f13c529545bbcdc0b214d3f5 (2 commits)
