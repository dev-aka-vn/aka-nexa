---
phase: "7"
slug: "multi-form-apps-per-form-triggers"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-17"
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.3 (`npm test` = `vitest run`) + Playwright 1.64.0 (`npm run test:e2e`) |
| **Config file** | `vitest.config.mts` (alias map; `include: packages/**/*.spec.ts`, `apps/**/*.spec.ts`, `tooling/**/*.spec.ts`; `exclude: **/e2e/**`; `setupFiles: ./test/setup-env.ts`; 120 s timeouts) and `playwright.config.ts` |
| **Quick run command** | `npx vitest run <path-to-spec>` |
| **Full suite command** | `npm test` (128 `*.spec.ts` files pre-phase — measured via `npx vitest list`; 137 tracked non-e2e, 148 all tracked; grows to 129 when 07-01 adds `definition.forms.spec.ts`) |
| **E2E command** | `npm run test:e2e` (projects: `chromium` + `tablet` on `apps/app-builder/e2e` @ :5173; `renderer` + `renderer-tablet` on `apps/renderer/e2e` @ :5174) |
| **Estimated runtime** | ~120–240 s (full vitest suite); e2e longer |

**Frozen-claim mechanical test:** `packages/contract/src/links/read-link-claims.frozen.spec.ts`
(D-24) asserts the V1 key set and the 6-action enum. D-01/D-10 are designed so it **does not
change**. If it fails during Phase 7, a frozen contract has been breached — stop, do not edit the
spec.

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <specs touched by the task>`; for SPA tasks also `npx vitest run apps/app-builder/src/editor/publishGuards.spec.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** `npm test` **and** `npm run test:e2e` must be green; the frozen-claim spec must be green **without modification**
- **Max feedback latency:** ~120 s

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD (planner fills) | — | — | APP-11, APP-12, FRM-14 | T-7-* | see `07-RESEARCH.md` §Security Domain | unit / integration / e2e | see map below | mixed | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Requirement → Test Map (from research)

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| APP-11 | An app doc carries `forms[]`; each form has `kind` ∈ {`submit`,`list`,`show`,`edit`} and its own `form_version`; two forms of the same kind in one app are rejected | unit | `npx vitest run packages/domain/src/builder/app-definition.service.spec.ts` | ✅ (extend) |
| APP-11 | `form_version` advances only when that form's `schema` changes across publishes (D-10) | unit | `npx vitest run packages/domain/src/builder/app-definition.versions.spec.ts` | ✅ (extend) |
| APP-11 | `SectionNameSchema` has 12 entries after `triggers` retirement; the mirror lists agree (13→12) | unit | `npx vitest run packages/domain/src/authz/builder-ability.spec.ts` | ✅ (extend) + new assertion |
| APP-12 | A trigger activates exactly one form; a publish declaring a trigger that resolves to >1 form is **rejected** in `PublishGateService.evaluate()` | unit | `npx vitest run packages/domain/src/builder/publish-gate.service.spec.ts` | ✅ (extend) |
| APP-12 | Publish requires **≥1 `submit` form** (D-05) | unit | `npx vitest run packages/domain/src/builder/publish-gate.service.spec.ts` | ✅ (extend) |
| APP-12 | JEV tool list is derived from **forms declaring triggers** — a form with `triggers: null` produces no tool | unit | `npx vitest run packages/domain/src/decision/published-app-loader.spec.ts` | ❌ Wave 0 |
| APP-04 (amended) | A trigger→form→link-action projection carries `kind`→`action` end-to-end (submit→create, list→query, show→view, edit→edit) | integration | `npx vitest run packages/domain/src/decision/decision-routing.integration.spec.ts` | ✅ (extend) |
| APP-04 (amended) | The worker catalog is **not** hardcoded: a builder-published app becomes routable | integration | `npx vitest run packages/domain/src/decision/decision-routing.integration.spec.ts` | ✅ (extend) + new case |
| FRM-14 | Every form in an app shares the app's collection, roles, and data-routing destination; a form's schema is scoped to its kind | integration | `npx vitest run packages/domain/src/builder/app-definition.service.spec.ts` | ✅ (extend) |
| FRM-14 | `list` reuses the Phase-4 saved-query viewer-row projection with no new schema | integration | `npx vitest run packages/domain/src/builder/saved-query.repository.spec.ts` | ✅ (extend) |
| Migration | `form_schema`→`forms:[{kind:'submit'}]` and app triggers→that form's triggers, idempotent, shape-detecting (only docs carrying `form_schema`) | integration | `npx vitest run packages/domain/src/builder/form-migration.spec.ts` | ❌ Wave 0 |
| Migration | `app_definition_versions` snapshots are migrated so `rollback()` cannot restore the old shape | integration | `npx vitest run packages/domain/src/builder/app-definition.versions.spec.ts` | ✅ (extend) |
| Migration | Seeds carry `forms[]` and validate against the updated `.strict()` `TemplateSeedSchema` | unit | `npx vitest run packages/domain/src/builder/template/template.spec.ts` | ✅ (extend) |
| D-12 | Builder SPA exposes a form manager with an in-form trigger panel; the `Triggers` tab is gone | e2e | `npx playwright test --project=chromium` | ✅ (extend `apps/app-builder/e2e/editor.spec.ts` / `wizard.spec.ts`) |
| D-24 | Frozen read-link claim set unchanged | unit | `npx vitest run packages/contract/src/links/read-link-claims.frozen.spec.ts` | ✅ (must stay green, **unmodified**) |

---

## Wave 0 Requirements

- [ ] `packages/domain/src/builder/form-migration.spec.ts` — covers the `apps` + `app_definition_versions` two-collection migration (APP-11, D-11). **Highest-value new test in the phase**; migration is the riskiest step.
- [ ] `packages/domain/src/decision/published-app-loader.spec.ts` — covers form-derived tool projection (APP-12, D-06). No spec exists for the loader today.
- [ ] `packages/domain/src/builder/section-mirrors.spec.ts` (or an assertion inside `builder-ability.spec.ts`) — asserts the four section mirror lists agree (13→12). A drift guard: the mirror lists already drifted once (doc comments say "twelve" against 13 entries).
- [ ] Shared fixture: a `FormsFixture` builder producing a two-form app (`submit` + `list`, one trigger on each) for reuse across gate/loader/migration specs.
- [ ] Framework install: **none** — vitest + Playwright are present.

*No existing test infrastructure covers the migration or the loader projection — those are the two genuine Wave 0 gaps.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| In-form trigger panel design (D-12) | FRM-14 / D-12 | The mockup (`prototypes/mockup.html`) does **not** depict an in-form trigger panel (research Open Question #1). Absence is not permission (AGENTS.md). | `checkpoint:human-verify`: confirm the panel's placement, fields and copy against `prototypes/mockup.html` tokens before SPA work is finalised. |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
