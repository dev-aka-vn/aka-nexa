---
phase: "06"
slug: "self-service-app-builder"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-10-11"
---

# Phase 06 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `06-RESEARCH.md` `## Validation Architecture`. `nyquist_compliant` is set by
> `/gsd-validate-phase` after execution — this file only declares the sampled-verification plan.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.3 (unit/integration, node env) + `@playwright/test` 1.64.0 (SPA E2E) |
| **Config file** | `vitest.config.mts` (root; aliases `@akane/*` → `packages/*/src`, `include: packages/**/*.spec.ts, apps/**/*.spec.ts, tooling/**/*.spec.ts`, `setupFiles: ./test/setup-env.ts`) |
| **Integration substrate** | Testcontainers via `tooling/containers.ts` — real MongoDB 8.0 replica set + Redis 8.10. `GETDEL` atomicity, session-store semantics, transfer-approval 7-day auto-cancel, and OTP state-machine timing are Redis/Mongo-semantics-dependent. |
| **E2E** | Playwright — `apps/app-builder/e2e/` + `playwright.config.ts`; Wave 0 runs `npx playwright install chromium` |
| **Quick run command** | `npx vitest run <touched paths>` |
| **Full suite command** | `npm test` (= `vitest run`) |
| **Estimated runtime** | ~30–90 s unit; Testcontainers integration adds ~60–120 s cold-start; Playwright E2E per project |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched paths>` (quick, <30 s)
- **After every plan wave:** Run `npm test` (full suite) + `npm run lint` (boundary violations fail the build)
- **Before `/gsd-verify-work`:** Full suite green + Playwright E2E green + S1 spike artifacts committed
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

> Populated by `/gsd-plan-phase` once PLAN.md task IDs exist. The phase-level requirement → test
> map below is the seeded contract each task row must cite.

### Phase requirement → test map (reconciled against the phase plans, 2026-10-11)

> Each row names the spec files the plans actually create and the exact verify
> command from the plan's `<verify>` block. Source Plan column = the plan that
> creates the spec.

> Row status after the 2026-10-13 re-audit: all 25 rows green. Two E2E rows
> required test hardening before they were deterministic — `FRM-09` (settle
> guard for the preview remount) and `BLD-04`'s `designer.spec.ts` leg
> (bounded 90 s spec budget + deterministic restore polls). See the two *Gap
> Audit* sections below. `BLD-04`'s E2E leg required
> cold-start budget hardening plus deterministic restore waits in the same
> file (GAP-2, second pass — see *Gap Audit … second pass* below).

| Req ID | Behavior | Test Type | Automated Command | Source Plan | File Exists? |
|--------|----------|-----------|-------------------|-------------|-------------|
| BLD-01 | 5-step wizard creates a draft at step 1 | E2E | `npx playwright test apps/app-builder/e2e/wizard.spec.ts` | 06-07 | ✅ |
| BLD-02 | Tabbed editor edits all 12 sections | E2E + unit | `npx playwright test apps/app-builder/e2e/designer.spec.ts` + `npx vitest run packages/domain/src/builder/app-definition.service.spec.ts` | 06-07, 06-04 | ✅ |
| BLD-03 | Custom roles with arbitrary permission sets; assign by email autocomplete | unit + E2E | `npx vitest run packages/domain/src/authz/builder-ability.spec.ts` + `npx playwright test apps/app-builder/e2e/wizard.spec.ts` (RbacStep) | 06-07 | ✅ |
| BLD-04 | Drag-and-drop design + 50-action undo/redo | E2E (drag) + unit (history) | `npx playwright test apps/app-builder/e2e/s1-spike.spec.ts` + `npx playwright test apps/app-builder/e2e/designer.spec.ts` (sidebar drag → one history entry → undo/redo round-trip; cold-start budget hardened 2026-10-13) + `npx vitest run apps/app-builder/src/form-designer/undoHistory.spec.ts` | 06-01, 06-07 | ✅ |
| BLD-05 | Visual form-field → connector-field mapping | unit + E2E | `npx vitest run apps/api/src/submissions/submissions.integration.spec.ts` (field-mapping round-trip, task 3) + `npx playwright test apps/app-builder/e2e/designer.spec.ts` | 06-06, 06-07 | ✅ |
| BLD-06 | Publish confirmation summarizes every change; keyboard shortcut saves | integration + unit | `npx vitest run apps/api/src/app-builder/publish.integration.spec.ts` + `npx vitest run apps/app-builder/src/editor/publishShortcut.spec.ts` | 06-05, 06-07 | ✅ |
| BLD-07 | Inline, specific, actionable errors | E2E | `npx playwright test apps/app-builder/e2e/wizard.spec.ts` (InlineError assertions) | 06-07 | ✅ |
| BLD-08 | Submission viewer: filters, detail, export | integration + unit | `npx vitest run apps/api/src/submissions/submissions.integration.spec.ts` + `npx vitest run apps/api/src/submissions/submission-export.service.spec.ts` | 06-06, 06-08 | ✅ |
| BLD-09 | Tablet usability + loading skeletons | E2E (viewport) | `npx playwright test apps/app-builder/e2e/wizard.spec.ts apps/app-builder/e2e/designer.spec.ts --project=tablet` | 06-07 | ✅ |
| BLD-10 | Connector request → operator provision → resume | integration (testcontainers) | `npx vitest run apps/api/src/app-builder/connector-request.integration.spec.ts` + `npx vitest run packages/cli/provision.connector-requests.spec.ts` | 06-06 | ✅ |
| BLD-11 | Delegated workflow manager operates without ownership | unit | `npx vitest run packages/domain/src/authz/builder-ability.spec.ts` | 06-07 | ✅ |
| BLD-12 | OIDC SSO + MFA login; owner-scoped management | integration + unit | `npx vitest run apps/api/src/auth/auth.session.integration.spec.ts` + `npx vitest run apps/api/src/auth/auth.module.spec.ts` | 06-02 | ✅ |
| APP-03 | Versioned definitions; 20 retained; rollback | unit | `npx vitest run packages/domain/src/builder/app-definition.versions.spec.ts` | 06-04 | ✅ |
| APP-05 | Deprecated: functional, notice shown, no new triggers | unit | `npx vitest run packages/domain/src/builder/app-lifecycle.spec.ts` | 06-04 | ✅ |
| APP-06 | Archived: no new submissions; view links resolve | integration (real path) + unit | `npx vitest run apps/api/src/app-builder/app-definition.integration.spec.ts` ("APP-06 both ways" — the real POST /l/edit/:jti refusal) + `npx vitest run packages/domain/src/builder/app-lifecycle.spec.ts` | 06-04 | ✅ |
| APP-07 | Dry-run blocks >5-point routing-share drop | unit + integration | `npx vitest run packages/domain/src/builder/publish-gate.service.spec.ts` + `npx vitest run apps/api/src/app-builder/publish.integration.spec.ts` | 06-05 | ✅ |
| APP-08 | Description collision rejected at publish | unit | `npx vitest run packages/domain/src/builder/publish-gate.service.spec.ts` | 06-05 | ✅ |
| APP-09 | ~10 template seeds; tag filter; fork is a snapshot | unit + integration | `npx vitest run packages/domain/src/builder/template/template.spec.ts` | 06-04, 06-08 | ✅ |
| FRM-05 | Conditional show/hide + validation rules authorable | E2E (FormIO) | `npx playwright test apps/app-builder/e2e/s1-spike.spec.ts` + `npx playwright test apps/app-builder/e2e/designer.spec.ts` | 06-01, 06-07 | ✅ |
| FRM-09 | Draft preview with sandbox submissions | E2E | `npx playwright test apps/app-builder/e2e/designer.spec.ts` (PreviewPane + sandbox; settle-guarded 2026-10-13) | 06-07 | ✅ |
| IDN-05 | OTP: 10-min expiry, 3 attempts, 30-min lockout | integration (Redis) | `npx vitest run packages/domain/src/identity/otp/otp-state-machine.spec.ts` + `npx vitest run apps/worker/src/processors/otp-onboarding.integration.spec.ts` | 06-03 | ✅ |
| IDN-08 | SSO identity mapped to real_user_id without OTP | integration | `npx vitest run apps/api/src/users/sso-mapping.integration.spec.ts` + `npx vitest run packages/domain/src/identity/oidc-provision.service.spec.ts` | 06-02, 06-08 | ✅ |
| ACL-05 | Transfer requires global-admin approval; 7-day auto-cancel | integration + scheduler | `npx vitest run apps/api/src/app-builder/transfer.integration.spec.ts` + `npx vitest run packages/domain/src/acl` + `npx vitest run apps/worker/src/processors/transfer-auto-cancel.processor.spec.ts` | 06-08 | ✅ |
| ACL-10 | Owner manages roles except ownership transfer | unit | `npx vitest run packages/domain/src/authz/builder-ability.spec.ts` | 06-07 | ✅ |
| OBS-05 | `routing_share{app_id}` exported | unit | `npx vitest run packages/domain/src/builder/routing-share/routing-share.metrics.spec.ts` + `npx vitest run packages/domain/src/builder/routing-share/routing-share.computer.spec.ts` | 06-05 | ✅ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> ~~**E2E execution caveat (2026-10-13 audit):** every Playwright spec above
> exists and targets its behavior, but Chromium cannot launch in this
> sandbox (`libatk-1.0.so.0` missing, no root to install OS deps) — the
> same environmental limit recorded in 06-VERIFICATION.md's human items.~~
> **SUPERSEDED later on 2026-10-13 — E2E now executes.** Chromium launches in
> this sandbox once `LD_LIBRARY_PATH` points at the user-local Chromium
> runtime (`~/.local/chromium-libs` + the snap runtimes; see the gap-audit
> section below for the exact value). Both Playwright projects run.
> **Executable evidence, 2026-10-13 re-audit:** full E2E suite **66/66 green**
> (chromium + tablet, 7.6 min); 15 phase-6 unit specs **129/129 green**;
> 9 phase-6 testcontainers integration specs **68/68 green**. The vitest
> full-suite figure recorded earlier (1195/1196) is unchanged apart from the
> pre-existing entrypoint-drift orphan documented in
> 06-02-deferred-items.md, which is outside the phase.

---

## Wave 0 Requirements

- [x] `apps/app-builder/{package.json, tsconfig.json (DOM lib + jsx), vite.config.ts, index.html}` — the SPA does not exist; root `tsconfig.json` deliberately does not reference SPAs
- [x] `apps/app-builder/e2e/` + `playwright.config.ts` + `npx playwright install chromium`
- [x] Install: `react@19.3.0 react-dom@19.3.0`, `-D vite@8.3.4 @vitejs/plugin-react@6.1.2 @playwright/test@1.64.0`, `openid-client@6.8.8 @casl/ability@7.0.1 csv-stringify@6.9.0`
- [x] `tooling/boundaries.config.mjs` — extend `ALLOWED_EDGES.builder` with `identity`, `links`, `contract` (Pattern 6)
- [x] `packages/domain/src/builder/` skeleton + `apps/api/src/{auth,app-builder,submissions,users}/` module skeletons mirroring `read.module.ts` factory providers
- [x] G-11 replacement: repository-backed `SavedQueryLookup` impl + seed backfill migration + its spec (replaces `SeedSavedQueryLookup` wiring at `read.module.ts`)
- [x] IdP test double: Keycloak testcontainer or stub issuer for auth integration tests (Open Question 1)

*All 25 requirement rows are Wave 0 — no existing test files cover Phase 6 requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| S1 spike outcome: FormIO 5.6.1 builder renders + builds a representative form; one Bootstrap-4-era template ported; `component.errors` / `EditGrid.validateRows` verified | BLD-04, FRM-05, FRM-09 | Empirical migration check — the spike is the falsification point; automated tests come after the spike lands | Execute the spike task; confirm render + build + port artifacts committed; record fallback decision (`formiojs@4.21.7`) explicitly if taken |
| Wizard usability without documentation | BLD-01 | "Without documentation" is a human judgement | Walk the 5-step wizard with no prior context; confirm each step is self-explanatory |
| Tablet usability | BLD-09 | Emulated viewport approximates but does not prove touch usability | Playwright tablet project + one manual touch pass |
| Live OTP delivery through the chat pipeline | IDN-05 | Needs a real IM provider leg | Manual Slack OTP leg in staging; state machine itself is integration-tested |
| **ESCALATED 2026-10-13** — preview input loss during the first ~400 ms of a designer load: the builder's initial schema-normalisation round-trip re-arms `PreviewPane`'s debounce and destroys/rebuilds the FormIO form, discarding anything typed into it | FRM-09 (designer-flow surface of BLD-04) | Implementation wart surfaced by the Nyquist audit; the auditor may not modify implementation files | Either accept the wart (the spec now waits out the remount) or fix `FormDesignerPage.handleSchemaChange` / the `PreviewPane` debounce to suppress the redundant re-mount of the seeded schema |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-10-13 — no MISSING requirements. The original
approval rested on an environmental E2E caveat (sandbox could not launch
Chromium); that caveat is **superseded** — E2E executes and is green, so the
approval now rests on executable evidence. One implementation finding was
escalated to Manual-Only (see the Gap Audit below).

---

## Validation Audit 2026-10-13

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

Audit trail: the seeded draft (2026-10-11, all rows Wave 0) was
reconciled against the executed phase — all 25 requirement rows' spec
files exist, the vitest suite runs 1195/1196 green (1 pre-existing,
documented failure outside the phase), and the two verification gaps
closed at 9c98ce3d (APP-06 real-path proof, BLD-06 shortcut) plus the
publish-surface advisory (bb49dc92) are reflected in the map. Playwright
E2E execution is the recorded environmental caveat; no requirement is
without an automated test.

---

## Gap Audit 2026-10-13 (adversarial) — FRM-09 preview spec

**Gap GAP-1 — PARTIAL (non-deterministic spec).** Requirement FRM-09 (also
BLD-04's designer-flow surface): "A form author can preview a draft form in
the App Builder, with sandbox submissions, before publishing."
Test: `apps/app-builder/e2e/designer.spec.ts` — "the preview renders the
draft form; a sandbox submission is buffered and no submissions API call
fires (FRM-09)".

**Root cause — CONFIRMED empirically (not re-derived).** Real Playwright
runs (Chromium via `LD_LIBRARY_PATH`, the caveat above is now stale — E2E
executes) instrumented the preview lifecycle:

- The preview mounts **twice** per designer load. Form instance #1 appears
  when the preview first reports `data-ready="true"`; instance #2 replaces
  it ~400–470 ms later — the builder's initial `form_schema` normalisation
  round-trips through `handleSchemaChange`, changing the `schema` prop and
  re-arming `PreviewPane`'s `PREVIEW_DEBOUNCE_MS` (400 ms) timer
  (`PreviewPane.tsx:95,176-183`).
- Tagging the mounted `.formio-component-form` root immediately after
  `data-ready="true"` and waiting a full debounce window: **the tag is
  dropped** (the root is replaced). Tagging the replacement and waiting the
  same window: **the tag survives**. The pre-settle window is genuinely
  unstable; the post-remount window is stable.
- Typing immediately after `data-ready="true"` (the spec's original path):
  fill lands `"Jane Doe"`, the remount arrives ~79 ms later, and after it
  the input reads `""` — the value is discarded with the destroyed DOM.
  This is exactly the intermittent red.

**Fix (test-only; implementation untouched).** Added `waitForSettledPreview`
to `designer.spec.ts`: it waits for `data-ready="true"`, then polls — tag
the mounted FormIO root, wait `PREVIEW_DEBOUNCE_MS + 300 ms`, and require
the tag (and `data-ready`) to survive. The FRM-09 test now runs **only
after** the remount has finished. No assertion was weakened or removed: the
test still proves the preview renders the draft schema the builder edits, a
fill + submit lands in the sandbox buffer (`data-count="1"`, contains
`Jane Doe`), and **zero** submissions-API calls fire. If the preview were
ever re-mounted repeatedly, the poll times out and the spec fails a real
regression.

**Determinism evidence (real runs, this machine):**

| Run | Command | Result |
|-----|---------|--------|
| Spec baseline | `npx playwright test apps/app-builder/e2e/designer.spec.ts --project=chromium` | 4/4 passed |
| Spec ×5 | `… --project=chromium --repeat-each=5` | ✅ the FRM-09 test itself **5/5**. ⚠️ **CORRECTION (orchestrator re-run, cold server):** the whole file returned **19/20** — the 20th was a *different* test (`:385`, BLD-04), which hit the 30 s test timeout. The "20/20" first recorded here overstated a whole-file result. See *Gap Audit (second pass)*. |
| Full E2E suite | `npx playwright test apps/app-builder/e2e` (chromium + tablet) | **66/66 passed** |

The FRM-09 fix is confirmed good in isolation — five consecutive green
executions (12.3 / 16.0 / 10.7 / 8.3 / 9.2 s), each well inside its 20 s
`data-ready` budget. Only the file-level claim was wrong.

**ESCALATED — implementation finding (not fixed, per constraints).**
`PreviewPane` mounts the preview twice per designer load: the builder's
initial schema normalisation round-trips through `handleSchemaChange` and
re-triggers the preview debounce, destroying and rebuilding the FormIO
form. The spec now tolerates it, but it is a real product wart — a user who
types into the preview during the first ~400 ms loses their input. Owner:
`FormDesignerPage.handleSchemaChange` (`FormDesignerPage.tsx:387-392`) /
`PreviewPane` debounce effect (`PreviewPane.tsx:172-183`). Candidate fix:
suppress the initial builder `change` from re-arming the preview (e.g.
compare against the seeded schema before `setSchema`). No implementation
file was modified by this audit.

| Metric | Count |
|--------|-------|
| Gaps found | 1 |
| Resolved | 1 (deterministic) |
| Escalated (implementation findings) | 1 (redundant PreviewPane remount) |

---

## Gap Audit 2026-10-13 (adversarial, second pass) — BLD-04 undo/redo spec

**Gap GAP-2 — PARTIAL (non-deterministic spec).** Requirement BLD-04
("Drag-and-drop design + 50-action undo/redo"), E2E leg. Test:
`apps/app-builder/e2e/designer.spec.ts:385` — "the designer mounts the
builder; an added component captures one history entry and undo/redo
round-trip".

**Reported failure (submitted evidence, not re-derived).** Cold isolation run
`npx playwright test apps/app-builder/e2e/designer.spec.ts --project=chromium
--repeat-each=5` returned 19/20: repetition 1 of that test hit "Test timeout
of 30000ms exceeded" at the undo click, 30.4 s total. Per-repetition
durations of the same test in that run: 26.5 / 15.2 / 13.5 / 12.7 s — 88 % of
Playwright's default 30 s per-test budget on the first execution. The error
was the *test* timeout (the click's actionability log had already reached
"done scrolling"), so the headline cause is budget exhaustion, not element
instability.

**Root cause — thin budget headroom, not broken behaviour.** This spec mounts
the real `@formio/js` 5.6.1 builder (the heaviest module graph the SPA loads)
and the BLD-04 test additionally performs a real dragula drag-and-drop, a
component-dialog save, an undo and a redo. Against a cold vite dev server the
first execution pays the on-demand transform of that graph plus the browser's
parse of it. The behaviour itself is correct in every run; only the 30 s
ceiling was ever crossed.

**Own baseline measurements (this machine, this pass — cold server, no
listener on :5173, pre-fix).** The submitted failure did **not** reproduce,
which is reported here rather than glossed:

| Run | Command | Result | First-execution duration of the BLD-04 test |
|-----|---------|--------|---------------------------------------------|
| Baseline 1 | `… designer.spec.ts --project=chromium --repeat-each=5` (tail-only capture) | 20/20 passed (4.5 m) | not captured |
| Baseline 2 | same, full capture | 20/20 passed (4.8 m) | **20.8 s** (69 % of 30 s); reps 2–5: 18.9 / 15.5 / 15.3 / 13.5 s |
| Baseline 3 | `… --project=chromium`, `node_modules/.vite/deps` prebundle deleted first | 4/4 passed (1.2 m) | **21.8 s** |

The flake is therefore load-dependent: on this machine the first execution
landed at 69–73 % of the ceiling rather than the reported 88 %. The reported
30.4 s crossing is credible and consistent with the same slow first execution
under heavier load — but it was **not observed in three cold runs in this
pass**, and no claim is made that it was.

**Fix (test-only; implementation untouched; no assertion weakened).**

1. `DESIGNER_SPEC_TIMEOUT_MS = 90_000`, applied via
   `test.describe.configure({ timeout: DESIGNER_SPEC_TIMEOUT_MS })` inside
   the spec's own `test.describe`. Bounded at 3× the default — deliberate
   headroom for a real drag against a heavyweight builder, not an unbounded
   wait. **Blast radius: the four tests in `designer.spec.ts` only** (×2
   projects when the tablet project runs). `playwright.config.ts` is
   **unchanged**; no other spec's budget moves.
2. The two fixed `waitForTimeout(SETTLE_MS)` sleeps that followed the
   undo/redo clicks were replaced with `expect.poll(...)` on the builder's
   own schema (via `window.__DESIGNER__.getSchema()`), with
   `RESTORE_TIMEOUT_MS = 15_000`. Undo/redo resolve through
   `builder.setForm()`, so the poll waits for the restored snapshot to land
   instead of sleeping a guessed window — and a restore that never lands now
   **fails** (`expect.poll` errors on timeout) instead of merely being
   slower.

Every assertion is preserved: the real sidebar drag, component count
`3 → 4`, exactly-one-history-entry (a single undo returns the count to `3`),
and redo back to `4`. The redo leg cannot pass vacuously — it asserts `4`
immediately after the undo leg asserted `3`, so the count must have moved.

**Negative controls (temporary specs, run then deleted) — the fix is not
self-confirming:**

| Control | What it proves | Observed |
|---------|----------------|----------|
| `negctl A` — read `test.info().timeout` inside a replica of the describe scope | the describe-scope `configure({ timeout })` really applies (not a silent no-op) | **passed** (timeout reported as 90 000) |
| `negctl B` — `expect.poll` for a value that never arrives | the new restore wait is a real assertion, not a sleep that passes on first evaluation | **failed as required**: `NEGCTL: the awaited value never arrived — this must be RED`; `Expected: 4 / Received: 3`; `Timeout 2000ms exceeded while waiting on the predicate` |
| `negctl C` — a 35 s body (> the old 30 s default) inside the configured scope | the raised budget actually admits a test the default would have killed | **passed**: `NEGCTL-C elapsed=35026ms timeout=90000` |

**Determinism evidence (real runs, this machine, pre-fix vs post-fix):**

| Run | Command | Pre-fix | Post-fix |
|-----|---------|---------|----------|
| Cold isolation ×5 (auditor) | `npx playwright test apps/app-builder/e2e/designer.spec.ts --project=chromium --repeat-each=5` | 20/20 (4.8 m); first exec 20.8 s | **20/20 (4.3 m); first exec 15.9 s** = 18 % of the new 90 s ceiling |
| Cold isolation ×5 (orchestrator, independent) | same | **19/20 (5.1 m)** — first exec 30.4 s, the "Test timeout of 30000ms exceeded" that opened this gap | **20/20 (4.5 m); exit 0**; first exec 19.1 s; FRM-05 first exec 23.0 s |
| Full E2E suite (orchestrator, independent) | `npx playwright test apps/app-builder/e2e` (chromium + tablet) | 66/66 (7.6 m) | **66/66 (8.0 m); exit 0** |

The orchestrator's pre-fix 19/20 is the reproduction the auditor could not obtain
on its own three attempts — it is recorded here as the before-state, and the
post-fix 20/20 as the after-state, both measured independently of the auditor.

**WARNING (measured, not fixed — the same budget class, one spec over).**
`s1-spike.spec.ts` is the spec the map cites for BLD-04 and FRM-05 and it
mounts the same heavyweight builder with **5 fixed `waitForTimeout` sleeps and
no explicit budget of its own**. Cold isolation was probed for this audit:
`s1-spike.spec.ts --project=chromium --repeat-each=3` → **15/15 passed (3.2 m),
exit 0**, with first executions of **19.1 s** and **16.4 s** against the 30 s
default. No failure was observed, so no change was made — but it sits in the
same 65–85 % band as the test that did cross the line, and it carries no
headroom. Flagged for whoever next touches this suite; the bounded fix would be
the same spec-scoped `test.describe.configure`.

**WARNING (outside GAP-2's scope — recorded, not separately fixed).** In
Baseline 2 the **FRM-05** test at `designer.spec.ts:428` ran **23.0 s** on its
first execution — 77 % of the old 30 s default, closer to the ceiling than
BLD-04's 20.8 s in the same run. The describe-scope budget introduced here
already covers it (90 s), so no separate change was made. Its behaviour is
unchanged and still green.

**Preserved:** no implementation file was modified; `playwright.config.ts` is
untouched; the FRM-09 `waitForSettledPreview` hardening from the first pass is
byte-identical (its test body and helper were not edited by this pass).

| Metric | Count |
|--------|-------|
| Gaps found | 1 |
| Resolved | 1 (bounded headroom + deterministic restore waits) |
| Escalated (implementation findings) | 0 |
| Warnings raised | 1 (FRM-05 first execution at 77 % of the old ceiling) |

---

## Validation Audit 2026-10-13 (Nyquist re-audit — consolidated)

| Metric | Count |
|--------|-------|
| Requirements mapped to Phase 6 | 25 |
| Requirements with automated verification, green | 25 — 66 E2E + 129 unit + 68 integration |
| Gaps found | 2 — FRM-09 preview race; BLD-04 designer cold-start budget |
| Resolved (test-only) | 2 |
| Escalated (implementation findings) | 1 — redundant `PreviewPane` preview remount (→ Manual-Only) |
| Warnings raised | 2 — FRM-05 first execution 23.0 s (now covered by the spec budget); `s1-spike.spec.ts` first executions 19.1 / 16.4 s (in budget, no headroom) |
| `nyquist_compliant` | `true` |

Three claims of the earlier audit are **superseded by measurement**, and the
corrections are recorded rather than overwritten:

| Earlier claim | Measured |
|---------------|----------|
| "Chromium cannot launch in this sandbox; E2E green runs belong to the staging pass" | **False.** Both Playwright projects run here; full suite 66/66. |
| "Spec ×5 → 20/20" (whole file) | **19/20.** The 20th failure opened GAP-2; the FRM-09 test alone was genuinely 5/5. |
| "Gaps found 0" | **2.** Both were non-deterministic E2E specs, invisible while E2E could not execute. |

Both fixes are test-only; no implementation file, and no
`playwright.config.ts`, was modified. Evidence for every number above comes
from an observed run on this machine — the auditor's numbers and the
orchestrator's independent re-runs are labelled separately where they differ.
