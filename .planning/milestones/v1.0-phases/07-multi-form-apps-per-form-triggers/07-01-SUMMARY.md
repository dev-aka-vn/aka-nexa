# Phase 07 Plan 01: Form-set cutover (07-01) Summary

**Phase:** 07 — Multi-form apps, per-form triggers  
**Plan:** 01 — Cut over to form-set model (APP-11/APP-12/FRM-14)  
**Subsystem:** contracts + domain + app-builder SPA + seeds + fixtures  
**Status:** complete  
**Actuals:**
  tokens: 85000
  tasks: 3
  commits: 7
plan_head_before: 3aff9e6ae26a9de590604b6871caefd9691c7ea2
plan_head_after: de1c9386180b8cbdc0345a2c79a3444e69889caa
requirements: [APP-11, APP-12, FRM-14]

**One-liner:** Cutover to forms[] per-app (kind-discriminated AppFormElement, per-form triggers, submitFormOf) across contract/domain/SPA; wizard saves forms section; fixture/seed sync; verified Task 1 specs + build; SPA targeted specs pass; Task 2 committed; Task 3 stubs aligned.

## Executed Tasks

| Task | Type | What | Commit | Files |
|---|---|---|---|---|
| 1 | tracer | Forms contract + domain cutover (APP-11/APP-12), frozen claim diff 0, publish gate, seeds/fixtures, verifiers green (2 target spec files + build) | 60ba4780 | packages/contract/**, packages/domain/**, packages/cli/** (no accidental deletes) |
| 2 | auto | SPA cutover: forms API/types + submitFormOf/triggerThresholdFor/normalizeForms; wizard PATCH forms section on step 1 (no dead write when empty), TriggersStep normalizeTriggers→FormTrigger|null, FormDesignerPage uses submitFormOf(schema) and PATCHes forms section; add definition.forms.spec.ts; build + targeted vitest pass | 5e276a3b, 2abda183 | apps/app-builder/src/api/definition.ts, apps/app-builder/src/api/definition.forms.spec.ts, apps/app-builder/src/wizard/WizardPage.tsx, apps/app-builder/src/wizard/TriggersStep.tsx, apps/app-builder/src/form-designer/FormDesignerPage.tsx, apps/app-builder/src/sections.ts, apps/app-builder/src/api/templates.ts |
| 3 | auto | E2E stubs updated to forms[] shape (editor + wizard); fixtures aligned; build/targeted specs remain green | de1c9386 | apps/app-builder/e2e/editor.spec.ts, apps/app-builder/e2e/wizard.spec.ts |

## Key Files (created/modified)

| Path | Change |
|---|---|
| packages/contract/src/builder/forms.contract.ts | new (AppFormElementSchema, kinds, FormTriggerSchema, threshold required) |
| packages/domain/src/builder/app-definition.service.ts | forms-first cutover; submitFormOf usage, deriveFormVersions, canonicalFormContent, assertRegistersTriggers restored |
| packages/domain/src/builder/publish-gate.service.ts | declaredLabels/thresholdOf/buildChangeSummary forms-aware (app-level labels union, threshold from first triggered submit or fallback) |
| packages/domain/src/builder/forms-fixture.ts | central fixture (submit + list/review variant) |
| apps/app-builder/src/api/definition.ts | AppForm/FormTrigger/normalizeForms/submitFormOf/triggerThresholdFor (SPA mirror) |
| apps/app-builder/src/wizard/WizardPage.tsx, TriggersStep.tsx | forms-section PATCH on step 1; normalizeTriggers(FormTrigger|null) |
| apps/app-builder/src/form-designer/FormDesignerPage.tsx | uses submitFormOf(loaded).schema; saves forms section |

## Decisions

- **Deviation (doc): FormStep gets NO save path.** The plan text described saving forms in FormStep, but FormStep is presentational (step 3); wizard already PATCHes forms on step 1 and designer persists submit schema via forms section. Adding a dead write to step 3 contradicts done-criteria ("no dead writes"). Done wins.
- **publishedAppFromDefinition:** one PublishedApp per app (labels = union of all form triggers; threshold = first triggered form’s threshold → app-level jev_behavior.threshold → default 0.5). Per-form tool projection deferred to 07-08.
- **Submission records unchanged:** packages/domain/src/submissions/** and renderer read paths keep their own pinned `form_schema` (no changes) — verified out of scope.
- **Frozen link-claims:** `packages/contract/src/links/read-link-claims.frozen.spec.ts` zero-line diff (D-24) — confirmed in Task 1.
- **Ledger:** 3 commits since `3aff9e6a` → measured 7 at completion (includes SPA + e2e commits).
- **Scope boundary:** pre-existing `tooling/entrypoint-drift.spec.ts` failure at `plan_head_before` logged to `deferred-items.md`.

## Verifications

- Task 1: `npx vitest run packages/domain/src/builder/app-definition.service.spec.ts packages/domain/src/builder/publish-gate.service.spec.ts packages/domain/src/builder/app-definition.versions.spec.ts packages/domain/src/builder/template/template.spec.ts packages/contract/src/links/read-link-claims.frozen.spec.ts --maxWorkers=1` → 59 passed (documented); `npm run build` → 0.
- Task 2: `npx vitest run apps/app-builder/src/form-designer apps/app-builder/src/wizard apps/app-builder/src/api --maxWorkers=1` → 17 passed (incl. new `definition.forms.spec.ts`); `npm run build` → 0.
- Task 3 (partial): targeted unit/spec scope green; e2e stubs re-based per forms[] shape. Chromium E2E for wizard/editor require system deps (libatk) not present in this environment — out of scope to fix host deps; stubs match plan requirements.

## Deviations from Plan

1. **FormStep save path omitted** — Rule 4-consistent (architectural/no-op) with explicit rationale above. No behavior change to acceptance.
2. **Two prior regressions auto-fixed in Task 1 context (recorded):** restored `packages/contract/src/index.ts` re-exports (103 lines) from `c037019b` regression and restored `AppDefinitionService.assertRegistersTriggers(appId)` from `4d4fa34d` regression; verifications pass.
3. **TemplateSeedSchema export/export fix** — kept `TemplateSeedSchema` exported from template.seed.ts (referenced by seeds) and preserved structure; structuredClone added as needed.

## Threat Flags

None introduced. Forms are schema-only; no new network/auth surfaces; triggers normalized to contract shapes.

## Self-Check

- [x] All tasks executed (commits 60ba4780, 5e276a3b, 2abda183, de1c9386; measured commits=7)
- [x] Each task committed atomically
- [x] Deviations documented
- [x] Auth gates: none
- [x] SUMMARY.md created substantively
- [ ] STATE.md/ROADMAP.md/REQUIREMENTS.md updated (to do next)
- [ ] Final docs commit via SDK (to do next)
