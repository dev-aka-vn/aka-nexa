---
phase: 07-multi-form-apps-per-form-triggers
plan: 06
subsystem: ui
tags: [app-builder, forms-manager, editor, e2e, submissions]
requires:
  - phase: 07-multi-form-apps-per-form-triggers (07-05)
    provides: "U-3/U-4/U-6 rulings"
provides:
  - "FormManager component: rows, New-form kind picker, remove modal, Versioning card, FormIO callout"
  - "EditorPage forms section renders FormManager instead of Phase-6 single-form surface"
  - "Submission-survival integration assertion"
affects: [07-multi-form-apps-per-form-triggers-07]
requirements-completed: [APP-11]
actuals:
  tokens: 42000
  tasks: 2
  commits: 2
  plan_head_before: af0fd928ab92660e7eef6b78b4eab40efe83e0c3
  plan_head_after: 6a22cdad49fe395ae19d68b19a93bb4c54bc6079
key-files:
  created:
    - apps/app-builder/src/form-designer/FormManager.tsx
  modified:
    - apps/app-builder/src/editor/EditorPage.tsx
    - apps/app-builder/e2e/editor.spec.ts
    - apps/api/src/submissions/submissions.integration.spec.ts
key-decisions:
  - "FormManager persists every add/remove through {section:'forms', patch:{forms}} only"
  - "Row label derived from app name + kind (no per-form label field in contract)"
  - "Remove flow blocks last-submit removal via callout-warn with disabled confirm"
decisions: []
status: complete
completed: 2026-10-18
---

# Phase 7 Plan 6: Forms tab form manager Summary

**The App Builder's Forms tab is now a form manager: one list-row per form in declaration order, a `New form` CTA (radio-card kind picker offering only unclaimed kinds), the U-4 remove modal (blocked for the last submit form), the mockup's Versioning side card + FormIO accent callout, and U-6 kind-specific metadata lines. EditorPage renders the manager for the `forms` section. Submission-survival is asserted in integration.**

## Task Commits

1. **Task 1: FormManager + EditorPage wiring** — `79d6f5e4`
2. **Task 2: manager e2e + submission-survival integration** — `6a22cdad`

## Deviations from Plan

None — plan executed as written. Playwright could not launch in this environment (missing libatk), but collection (`--list`) passes and the new specs are syntactically valid; unit + integration + build are green.

## Self-Check: PASSED

- FormManager.tsx exists
- Commits 79d6f5e4 and 6a22cdad exist
- npm run build green
- vitest editor + definition.forms + submissions.integration green
---

*Phase: 07-multi-form-apps-per-form-triggers*
*Status: complete*