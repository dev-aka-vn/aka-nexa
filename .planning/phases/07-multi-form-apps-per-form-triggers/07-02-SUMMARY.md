---
phase: 07-multi-form-apps-per-form-triggers
plan: 02
subsystem: builder
tags: [section-vocabulary, drift-guard, rbac, contract]
requires:
  - phase: 07-01
    provides: per-form triggers on AppFormElement
provides:
  - 12-entry SectionNameSchema (triggers retired)
  - section-mirrors drift guard spec
  - filtered unknown (retired) section grants in createBuilderAbility
affects:
  - packages/contract
  - packages/domain
  - apps/app-builder
tech-stack:
  added: []
  patterns:
    - "four-mirror section vocabulary with drift-guard spec"
key-files:
  created:
    - packages/domain/src/builder/section-mirrors.spec.ts
  modified:
    - packages/contract/src/builder/app-definition.contract.ts
    - packages/domain/src/builder/data-access/app-definition.repository.ts
    - packages/domain/src/authz/builder-ability.ts
    - apps/app-builder/src/sections.ts
    - packages/domain/src/authz/builder-ability.spec.ts
    - apps/app-builder/e2e/editor.spec.ts
    - apps/app-builder/e2e/roles.spec.ts
    - apps/app-builder/e2e/tablet-touch.spec.ts
decisions:
  - "Retire app-level Triggers section (13→12) because triggers now live on the form (D-06/D-12)."
  - "Filter retired/unknown section grants in createBuilderAbility so a stale 'triggers' grant grants no ability (T-07-05)."
  - "SPA mirror lists (APP_SECTIONS/SECTION_LABELS/SECTION_FIELDS) not imported into the domain drift guard — domain→apps is outside the boundary graph; SPA side asserted via e2e counts."
metrics:
  duration: ~10m
  completed: 2026-10-18
  tasks: 2
  files: 9
  commits: 2
  actuals:
    tokens: 16995
    tasks: 2
    commits: 2
status: complete
plan_head_before: ef0dd3b49f4adacdaa9c5709a0b1de4f4496e1b8
plan_head_after: bec4d404c725df90ec659154b3b7a534948b5a40
---

# Phase 07 Plan 02: Retire app-level Triggers section Summary

**One-liner:** Dropped `triggers` from `SectionNameSchema` (13→12) and all four mirror lists, added a drift-guard spec, and filtered retired section grants in the ability factory.

## What was built

- `SectionNameSchema` now has exactly 12 options; `UpdateSectionSchema.safeParse({section:'triggers',...})` fails.
- `SECTION_FIELDS` (repository), `APP_SECTION_PERMISSIONS` (authz), and SPA `SECTION_LABELS`/`SECTION_FIELDS` all lost the triggers row; `APP_SECTIONS` follows the enum.
- New `packages/domain/src/builder/section-mirrors.spec.ts` asserts set-equality across contract/repository/authz lists, the 12 count, the one-section-one-field rule, and a negative control.
- `builder-ability.spec.ts` extended: 12 sections, no triggers grant parses, stale triggers grant grants no ability.
- `createBuilderAbility` now filters unknown (retired) section grants so they grant no ability.
- e2e suites updated: 12 editor tabs, 12 permission checkboxes, no `editor-tab-triggers`/`permission-triggers` testids; tablet-touch uses a far tab.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated `apps/app-builder/e2e/tablet-touch.spec.ts`**
- **Found during:** Task 2
- **Issue:** The spec tapped `editor-tab-triggers`, which no longer exists after the triggers tab was retired; leaving it would fail the Playwright run.
- **Fix:** Switched the far-tab tap to `editor-tab-deprecation-notice`.
- **Files modified:** apps/app-builder/e2e/tablet-touch.spec.ts
- **Commit:** bec4d404

### Verification environment

- `npm run build` green; domain unit suites green (section-mirrors, builder-ability, builder, authz).
- Playwright (`npx playwright test --project=chromium`) could not run in this environment: the headless Chromium binary lacks `libatk-1.0.so.0` and sudo is unavailable to install system deps. The e2e edits are type-checked by `tsc -b` and mirror the existing tab/checkbox count patterns; the editor/roles counts (12) follow from the enum automatically.

## Self-Check: PASSED

- section-mirrors.spec.ts exists
- commits 24172f30, bec4d404 present
