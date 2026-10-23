---
phase: 07-multi-form-apps-per-form-triggers
plan: 04
subsystem: database
tags: [migration, apps, app_definition_versions, forms, idempotent, mongodb]
requires:
  - phase: 07-01
    provides: forms[] shape on AppDefinitionDocument and AppFormElement contract
provides:
  - migrateAppForms(mongo) two-collection idempotent migration
  - transformLegacyApp / foldLegacyTriggers pure transforms
  - best-effort boot wiring in api and worker
affects: [07-08, 07-09]
tech-stack:
  added: []
  patterns: [filter-guarded compare-and-set migration, two-collection atomic per-doc rewrite]
key-files:
  created:
    - packages/domain/src/builder/migration/forms-migration.ts
    - packages/domain/src/form-migration.spec.ts
  modified:
    - packages/domain/src/index.ts
    - apps/api/src/main.ts
    - apps/worker/src/main.ts
key-decisions:
  - "Migrate BOTH apps and app_definition_versions in one run so rollback() cannot resurrect the retired shape"
  - "Filter on { form_schema: { $exists: true } }; update filter re-checks $exists as compare-and-set"
  - "Drop retired 'triggers' grants from role_assignments and roles_permissions in the same pass"
  - "Best-effort boot step in both api and worker; warn, never crash"
requirements-completed: [APP-11]
actuals:
  tokens: 60000
  tasks: 3
  commits: 3
patterns-established:
  - "Filter-guarded per-document migration: find by shape predicate, updateOne re-checking the predicate"
coverage:
  - id: D1
    description: "migrateAppForms rewrites apps documents carrying form_schema into forms[]"
    requirement: APP-11
    verification:
      - kind: unit
        ref: "packages/domain/src/form-migration.spec.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Retained snapshots in app_definition_versions are transformed with _id/version preserved"
    requirement: APP-11
    verification:
      - kind: unit
        ref: "packages/domain/src/form-migration.spec.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Migration is idempotent (second run returns 0)"
    requirement: APP-11
    verification:
      - kind: unit
        ref: "packages/domain/src/form-migration.spec.ts"
        status: pass
    human_judgment: false
duration: 1h
completed: 2026-10-18
status: complete
plan_head_before: 28ecd828d4a1ab7aaf5815ebd39a1bd3ea48708b
plan_head_after: 594cb317d065e54365f37123786f9ce90edf7c61
---

# Phase 07 Plan 04: One-shot two-collection idempotent migration Summary

**`migrateAppForms` rewrites both `apps` and `app_definition_versions` from `form_schema`+app-level `triggers` into `forms[]`, drops retired `'triggers'` grants, and runs best-effort in api+worker boot; proven idempotent and rollback-safe by 7 spec cases.**

## Performance

- **Duration:** ~1h
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Created `migrateAppForms(mongo): Promise<number>` with filter-guarded, atomic per-document updates across both collections.
- Exported pure transforms `transformLegacyApp` and `foldLegacyTriggers`.
- Added 7-case suite (idempotency, shape-union, snapshots, rollback-safety, grants, concurrency).
- Wired best-effort boot blocks in `apps/api/src/main.ts` (third block) and `apps/worker/src/main.ts`.

## Task Commits

1. `feat(07-04): add two-collection idempotent forms migration (D-11)`
2. `test(07-04): add migration suite (idempotency, shape-union, snapshots, grants)`
3. `feat(07-04): run forms migration best-effort in api and worker boot`

## Files Created/Modified

- `packages/domain/src/builder/migration/forms-migration.ts` (new)
- `packages/domain/src/form-migration.spec.ts` (new)
- `packages/domain/src/index.ts`
- `apps/api/src/main.ts`
- `apps/worker/src/main.ts`

## Deviations from Plan

None - plan executed as written.

## Self-Check: PASSED
---<|end|><|start|>advisor<|channel|>final<|message|>Wait, I need to measure commits at summary write time. I already set commits: 3 from ledger count. But after I commit the final docs commit, count will be 4. The actuals.commits should reflect total including final? The protocol says commits is measured at SUMMARY write: git rev-list count from ledger to HEAD. At summary write time (before final commit), HEAD is task commits = 3. So commits: 3 is correct for task commits. The final docs commit happens after. Good. But the self-check and final commit. Let me also update plan_head_after? At summary write, HEAD is task commits (594cb). After final commit, plan_head_after would change. The protocol says record plan_head_before and plan_head_after. Should plan_head_after be after final commit? The measurement is "at SUMMARY write" before final commit. But final commit includes SUMMARY. Hmm. The protocol example measures commits actuals before final commit. The plan_head_after maybe should be the final HEAD after docs commit? Let me follow protocol: "At SUMMARY write, read the persisted ledger... COMMITS_ACTUAL=$(git rev-list --count ${PLAN_HEAD_BEFORE}..HEAD)". That's before final commit. So plan_head_after = HEAD at that time = 594cb. But then final commit changes HEAD. The verify-work same-instrument check compares plan_head_before/after. If I record 594cb but final commit moves HEAD, mismatch? The protocol says write all three into frontmatter including when count is 0. And final commit is separate. I think it's fine; verify-work uses the recorded hashes. But to be safe, maybe I should create SUMMARY, commit it, then update plan_head_after? That would require editing SUMMARY after commit. Circular.

Let me check how other plans did it. Let me look at a recent SUMMARY.<|end|><|start|>startup to=shell<|channel|>analysis <|constrain|>xml<|message|><rfl:parameter name="command">
cd /home/chunghoi/dev-aka-vn/aka-nexa; ls .planning/phases/07-multi-form-apps-per-form-triggers/*SUMMARY.md; echo "==="; grep -n "plan_head_before\|plan_head_after\|commits:" .planning/phases/07-multi-form-apps-per-form-triggers/07-03-SUMMARY.md