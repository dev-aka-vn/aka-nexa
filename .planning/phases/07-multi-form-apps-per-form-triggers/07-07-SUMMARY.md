---
phase: 07-multi-form-apps-per-form-triggers
plan: 07
subsystem: ui
tags: [app-builder, form-designer, triggers, read-form-config, per-form]
requires:
  - phase: 07-multi-form-apps-per-form-triggers (07-05)
    provides: "U-1 (inline-collapsible trigger panel) and U-2 (checklist-picker config surfaces) rulings"
  - phase: 07-multi-form-apps-per-form-triggers (07-06)
    provides: "FormManager row Preview action sets ?form=<form_id>"
provides:
  - "Per-form designer dispatch via ?form= (submit canvas / list-show config / edit read-only)"
  - "FormTriggerPanel: U-1 inline-collapsible panel (switch, rows, threshold, empty state, D-08 disable)"
  - "ReadFormConfig: U-2 config surfaces for list (query_id + columns) and show (ordered field selection)"
affects: [07-multi-form-apps-per-form-triggers-08]
key-files:
  created:
    - apps/app-builder/src/form-designer/ReadFormConfig.tsx
    - apps/app-builder/src/form-designer/FormTriggerPanel.tsx
  modified:
    - apps/app-builder/src/form-designer/FormDesignerPage.tsx
    - apps/app-builder/src/api/definition.ts
key-decisions:
  - "FormDesignerPage reads ?form= from the hash route (default submit) and resolves the target form out of the served definition; unknown form renders InlineError naming it with a return link"
  - "saveForm generalized to replace the routed form's element (schema/config/triggers) while keeping the whole-forms-array payload and the in-flight ref guard"
  - "AppDefinition gains a legacy form_schema fallback so pre-07-04 stubs still synthesize a submit form"
  - "Trigger rows omit the Examples sub-line per U-1 (example phrases are local-only); slash rows render the Deterministic routing sub-line"
tech-stack:
  added: []
patterns:
  - "Per-form routing by form_id inside one designer page, kind-dispatched surface"
metrics:
  duration: complete
  completed: 2026-10-18
  tasks: 3
  commits: 3
status: complete
---

# Phase 7 Plan 7: Per-Form Designer Summary

**The per-form designer: `?form=` routing, the U-2 config surfaces, and the U-1 in-form trigger panel land, so an owner edits exactly the form the manager linked to.**

## What was built

- `FormDesignerPage.tsx` now resolves the `?form=` param (default `submit`), dispatches by kind (`submit` → FormIO canvas untouched; `list`/`show` → `ReadFormConfig`; `edit` → read-only card explaining FRM-02/FRM-03), and renders an `InlineError` naming an unknown form with a return link. `saveForm` generalises from "replace the submit element" to "replace the element whose `form_id` matches the route", keeping the whole-forms-array payload, the in-flight ref guard, and the dirty re-derivation.
- `ReadFormConfig.tsx` implements the U-2 checklist-picker surfaces: `show` toggles/reorders the submit schema's keys into `config.fields` (with a stale-entry `InlineError` mirror of 07-03's subset rule); `list` offers a saved-query picker (from `/apps/:id/saved-queries`) plus a column multiselect into `config.columns`, with the "No saved queries" empty state verbatim.
- `FormTriggerPanel.tsx` implements the U-1 panel: enable switch (a form has a trigger or not, D-07), intent/slash rows with the mockup vocabulary verbatim (`Intent · …` / `Slash command · …`, `Deterministic routing — bypasses JEV (no-JEV mode).`, `icon-btn` remove with `aria-label="Remove trigger"`, `Add trigger` CTA), threshold input (step 0.05, 0–1), the JEV helper copy, and the verbatim empty state (`No triggers yet` / `Add an intent or slash command so users can launch this app from chat.`). Disabled with a visible reason for `show`/`edit` kinds (D-08).
- `definition.ts` gained a legacy `form_schema` fallback so pre-07-04 stubs still synthesize a submit form, keeping the existing designer e2e green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Legacy form_schema fallback in AppDefinition**
- **Found during:** Task 1
- **Issue:** The existing designer e2e stub (`designerDefinition`) still served the pre-07-04 `form_schema` shape with no `forms[]`, which after the per-form dispatch resolved to "unknown form" and broke the canvas flow.
- **Fix:** `AppDefinitionSchema.parse` synthesizes a submit form from `form_schema` when `forms` is empty; `AppDefinition` gained an optional `form_schema` field.
- **Files modified:** `apps/app-builder/src/api/definition.ts`
- **Commit:** 55ce41f4

## Verification

- `npm run build` green (lint + tsc).
- `npx vitest run apps/app-builder` green (27 tests).
- Vocabulary strings match the mockup/07-UI-SPEC copy (grep-verified).

## Self-Check: PASSED

- Created files exist: `ReadFormConfig.tsx`, `FormTriggerPanel.tsx`.
- Commits: 55ce41f4, 46bdea6a, 0fb4aedf.

---
*Phase: 07-multi-form-apps-per-form-triggers*
*Status: complete*
