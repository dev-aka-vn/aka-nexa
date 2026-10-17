---
phase: 05-integration-async-execution
plan: 09
subsystem: renderer-ui
tags: [formio, self-hosted, read-link, status-list, edit-link, no-cdn, dat-14, lnk-02, frm-07]
dependency_graph:
  requires: [05-07, 05-08]
  provides: [status-list-surface-a, readonly-detail-surface-b, edit-entry-surface-c, edit-confirmation-surface-d, self-hosted-formio]
  affects: [renderer, read-link-surfaces, formio-bundle]
tech-stack:
  added: ["@formio/js@5.6.1 (MIT)"]
  patterns:
    - "DOM-free pure renderer modules with a guarded browser entry (import-safe in Node vitest)"
    - "Self-hosted FormIO engine + CSS from the npm entrypoint (no CDN; script-src 'self')"
    - "mockup :root token reuse — one palette, no drift"
key-files:
  created:
    - apps/renderer/src/read/status.ts
    - apps/renderer/src/read/status.html
    - apps/renderer/src/read/status.spec.ts
    - apps/renderer/src/read/edit.ts
    - apps/renderer/src/read/edit.html
    - apps/renderer/src/read/edit.spec.ts
  modified:
    - apps/renderer/src/read/view.html
    - apps/renderer/src/read/view.browser.ts
    - apps/renderer/src/read/view.spec.ts
    - package.json
    - package-lock.json
key-decisions:
  - "Pin @formio/js@5.6.1 exactly (MIT, official Form.io publisher) after the blocking package-legitimacy gate; never latest"
  - "Keep renderer modules DOM-free at import so the pure logic is testable in the node vitest environment; FormIO is loaded only in the guarded browser entry"
  - "Import FormIO CSS + engine from the npm entrypoint so the bundle is same-origin and CSP script-src 'self' holds (FRM-07)"
  - "A consumed edit link replays its recorded confirmation (D-95) — never the dead-link denial page"
patterns-established:
  - "Renderer pure/browser split: exported pure helpers + a guarded init function that dynamic-imports the DOM-only engine"
  - "Static-markup invariant specs: assert no CDN, no retry control, and the mockup token set directly from the HTML source"
requirements-completed: [DAT-14, LNK-02]
coverage:
  - id: D1
    description: "My submissions status list (Surface A): populated table, empty state, partial badge + retrying phrase, pagination footer, status filter rail, responsive list fallback"
    requirement: DAT-14
    verification:
      - kind: unit
        ref: "apps/renderer/src/read/status.spec.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Read-only submission detail (Surface B): status badge + destination phrase + submitted time; partial warn callout; failed danger callout; no retry control"
    requirement: DAT-14
    verification:
      - kind: unit
        ref: "apps/renderer/src/read/view.spec.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "FormIO self-hosted same-origin; view.html/status.html/edit.html contain no CDN asset (FRM-07); only the mockup :root token set is used"
    requirement: FRM-07
    verification:
      - kind: unit
        ref: "apps/renderer/src/read/status.spec.ts#static markup invariants"
        status: pass
      - kind: unit
        ref: "apps/renderer/src/read/edit.spec.ts#static markup invariants"
        status: pass
    human_judgment: false
  - id: D4
    description: "Edit-link entry (Surface C): prefill from the latest revision, consequential pre-submit acknowledgement, submit via POST /l/edit/:jti, discard"
    requirement: LNK-02
    verification:
      - kind: unit
        ref: "apps/renderer/src/read/edit.spec.ts#buildEditPrefill"
        status: pass
    human_judgment: true
    rationale: "The FormIO editable render + ack interaction + live submit path is browser-only; the pure prefill/copy/classify logic is unit-proven but the end-to-end interaction needs Playwright or human UAT."
  - id: D5
    description: "Edit post-submit confirmation (Surface D): first-submit success card naming the new revision + downstream reference; D-95 replay renders the original confirmation, never the dead-link page"
    requirement: LNK-02
    verification:
      - kind: unit
        ref: "apps/renderer/src/read/edit.spec.ts#classifyEditPostResponse"
        status: pass
      - kind: unit
        ref: "apps/renderer/src/read/edit.spec.ts#buildConfirmation"
        status: pass
    human_judgment: true
    rationale: "Replay correctness depends on the API recording and returning the outcome (05-08); the renderer branch is unit-proven but the cross-surface replay needs an integration/UAT check. Note: edit-link.integration.spec.ts is currently red (see Deferred Items)."
  - id: D6
    description: "Denial reuse (E5): invalid/expired/non-owned edit links reuse dead.html + DENY_REASON_COPY verbatim; no new denial reasons"
    requirement: LNK-02
    verification:
      - kind: unit
        ref: "apps/renderer/src/read/edit.spec.ts#denial reuse"
        status: pass
    human_judgment: false
  - id: D7
    description: "Blocking package-legitimacy gate cleared before install (S1): @formio/js@5.6.1 verified MIT, official Form.io publisher, no postinstall"
    requirement: null
    verification: []
    human_judgment: true
    rationale: "A blocking-human checkpoint — the human approved the pinned install (signal \"approved 5.6.1\"). Recorded here as the audit trail; not machine-verifiable."
metrics:
  duration_minutes: 23
  completed: "2026-10-10T17:33:30Z"
  status: complete
actuals:
  tokens: 29600
  tasks: 3
  commits: 2
  plan_head_before: 6b92c777d1c331d9e68e9f79459cc6d66fda0464
  plan_head_after: 4eb9bdb9a88022dad90edaa7e60d2b300a83abd9
---

# Phase 05 Plan 09: Renderer Surfaces (A–D) + Self-Hosted FormIO Summary

**Four read-link renderer surfaces — the "My submissions" list, the read-only detail summary, the edit entry, and the post-submit confirmation with D-95 replay — over a same-origin, self-hosted `@formio/js@5.6.1` bundle (no CDN), reusing only the mockup token set and adding no user-facing retry control.**

## Performance

- **Duration:** ~23 min (from the first-commit ledger to completion)
- **Started:** 2026-10-10T17:10:31Z
- **Completed:** 2026-10-10T17:33:30Z
- **Tasks:** 3 (1 checkpoint gate + 2 TDD implementation tasks)
- **Files modified:** 11 (6 created, 5 modified)

## Accomplishments

- **Surface A — "My submissions" status list** (`status.ts`/`status.html`): status→badge→destination-phrase map (`completed` internal "Internal saved", `completed` external "{Connector} · {ref}", `partial` amber "Internal saved · {Connector}: retrying", `pending_external` "sending", `failed` user-safe reason), the empty state, the en-GB "Showing {start}–{end} of {total}" footer with an accent "Load more", a status filter rail (`aria-pressed`), ellipsis-truncated long cells with `title`, a ≤768px stacked `.list-row` fallback, and the owner-only "Edit submission" affordance.
- **Surface B — read-only detail** (`view.browser.ts`/`view.html`): status summary above the read-only FormIO form, a `partial` `.callout-warn` and a `failed` `.callout-danger`, both read-only with **no retry control** (D-81).
- **Surfaces C/D — edit entry + confirmation** (`edit.ts`/`edit.html`): prefill from the latest revision, the newly-specified consequential acknowledgement, submit via `POST /l/edit/:jti` with the button entering `.is-loading`, the success confirmation card (new revision + downstream ref in a wrapping `.pill-mono`), the D-95 replay confirmation, and the inline submit-failure error — plus dead-link denial reuse (E5).
- **Self-hosted FormIO** (FRM-07): `@formio/js@5.6.1` + its CSS imported from the npm entrypoint; `view.html`/`status.html`/`edit.html` reference no CDN asset and keep `script-src 'self'`.
- **Single palette** (AGENTS.md rule 1): every surface reuses the mockup `:root` tokens; the inherited Phase-4 drift palette was removed from `view.html`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Package-legitimacy gate (checkpoint:human-verify, blocking-human)** — no commit (gate)
2. **Task 2: Self-host FormIO + status list (A) + read-only detail (B)** — `75b1b117` (feat)
3. **Task 3: Edit entry (C) + post-submit confirmation (D) + denial reuse (E5)** — `4eb9bdb9` (feat)

**Plan metadata:** `pending` (docs: complete plan 05-09)

_Note: TDD tasks — the spec (`*.spec.ts`) was written first (RED) and the implementation followed (GREEN) within each task commit._

## Package-Legitimacy Gate Clearance (S1 / T-05-35 / T-05-SC)

- **Gate:** `checkpoint:human-verify gate="blocking-human"` — never auto-approvable.
- **Outcome:** human **APPROVED**, resume signal `"approved 5.6.1"`.
- **Verified:** publisher Form.io (official successor to `formiojs` 4.x), license **MIT**, no `postinstall` script, ~50K weekly downloads (not a typosquat).
- **Installed:** exactly `@formio/js@5.6.1` (never `latest`); no other package added. 64 packages added by the install; CSS resolves to `node_modules/@formio/js/dist/formio.full.min.css`, engine to `lib/cjs/index.js`.
- **S1 spike:** documented 5.x breaking changes noted (`component.error` → `component.errors` array; `EditGrid.validateRows` returns an array). Fallback `formiojs@4.21.7` **not** taken.

## Files Created/Modified

- `apps/renderer/src/read/status.ts` — shared status/badge/destination mapping + Surface A browser loader (DOM-free at import)
- `apps/renderer/src/read/status.html` — Surface A markup (table, empty, pagination, filter rail, list fallback)
- `apps/renderer/src/read/status.spec.ts` — Surface A + detail-mapping proofs
- `apps/renderer/src/read/edit.ts` — Surface C/D pure helpers + guarded browser entry (dynamic FormIO import)
- `apps/renderer/src/read/edit.html` — Surface C page (page-head, editable form, ack callout, footer)
- `apps/renderer/src/read/edit.spec.ts` — prefill / confirmation / replay / failure / denial proofs
- `apps/renderer/src/read/view.html` — CDN removed, mockup tokens, self-hosted FormIO (FRM-07)
- `apps/renderer/src/read/view.browser.ts` — detail status summary + `partial`/`failed` callouts (Surface B, D-81)
- `apps/renderer/src/read/view.spec.ts` — extended detail-state proofs
- `package.json` / `package-lock.json` — `@formio/js@5.6.1` pinned dependency + locked tree

## Decisions Made

- Pinned `@formio/js@5.6.1` exactly after the blocking gate; MIT + official publisher confirmed before install.
- Kept every renderer module DOM-free at import time and moved the FormIO engine behind a guarded browser entry (dynamic import) so the pure logic is testable in the node vitest environment without a DOM.
- No user-facing retry anywhere on the status/detail/partial surfaces — retry stays admin/DLQ-only (D-81).
- A consumed edit link renders its recorded confirmation (D-95 replay), never the generic dead-link page.
- Reused `DENY_REASON_COPY` and `dead.html` verbatim — Phase 5 adds no new denial reasons.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Temporarily relocated untracked `packages/cli` files to run `npm install`**

- **Found during:** Task 2 (self-host FormIO install, after the gate approved).
- **Issue:** `npm install @formio/js@5.6.1` failed because an untracked `packages/cli/package.json` declared an invalid `workspace:*` protocol, aborting dependency resolution for the whole workspace. The committed `package-lock.json` had no `packages/cli` entry.
- **Fix:** Temporarily moved the two untracked files (`packages/cli/package.json`, `packages/cli/tsconfig.json`) to `/tmp/opencode/cli-stash/`, ran the install against the committed tree, then restored them untouched. No files from `packages/cli` were staged or committed.
- **Files modified:** none committed — `package.json` / `package-lock.json` only (the intended change).
- **Verification:** `@formio/js@5.6.1` resolved; renderer suite green; `packages/cli` files restored and left untracked as before.

_No functional deviations from the plan otherwise. The plan executed as written._

## Issues Encountered

- **Full suite `npx vitest run` not run to completion:** 83 spec files, several Docker-backed `*.integration.spec.ts`; a complete run exceeded a 10-minute timeout. The **plan-scoped renderer suite is green: 3 files, 97 tests** (`npx vitest run apps/renderer`). Logged to the windows ledger as `unrun-verify`.
- **Pre-existing red from plan 05-08 (out of scope):** `apps/api/src/read/status-surface.integration.spec.ts` and `edit-link.integration.spec.ts` fail with a Nest DI error — `read.controller.ts` gained a `LinkTokenStore` constructor dependency in 05-08 (`0e671435`) but the spec's `RootTestModule` (last touched by 05-07) does not provide it. Not caused by 05-09 (renderer-only). Logged to the windows ledger and to `deferred-items.md`; owner: plan 05-08.

## Known Stubs

None — no hardcoded empty values, placeholder text, or unwired data sources were introduced. The `edit.ts` input shape is treated as optional-by-design (`?? {}` / `?? null` fallbacks) because the API response is the source of truth, not a stub.

## Threat Flags

None — no new network endpoints, auth paths, file-access patterns, or trust-boundary schema changes beyond the plan's `<threat_model>`. T-05-35 (package legitimacy) and T-05-SC (single gated install) were mitigated by the blocking gate; T-05-36 (user-safe status data) and T-05-37 (FormIO escaping + self-hosted bundle) hold.

## Next Phase Readiness

- All four user-facing surfaces are implemented and unit-proven; the renderer suite is green.
- **Blockers/concerns:** (1) the plan-scoped verify is green but the **full suite is not green** due to the pre-existing 05-08 integration-spec wiring failure; (2) browser-only interactions (FormIO editable render, ack modal, live submit/replay) are proved by pure-logic tests only and remain for Playwright/UAT.

---

## Self-Check: PASSED

- Files verified on disk: all six created artifacts present (`status.{ts,html,spec.ts}`, `edit.{ts,html,spec.ts}`).
- Commits verified in history: `75b1b117` (task 2) and `4eb9bdb9` (task 3).
- Ledger measured: `plan_head_before=6b92c777`, `plan_head_after=4eb9bdb9`, `commits=2`.
- Renderer suite: 3 files, 97 tests, all green.

---

*Phase: 05-integration-async-execution*
*Completed: 2026-10-10*
