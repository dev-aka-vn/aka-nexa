---
phase: 07-multi-form-apps-per-form-triggers
plan: 08
type: execute
wave: 3
depends_on: ["07-01"]
requirements: [APP-11, APP-12, FRM-14]
status: complete
---

# 07-08 — Make routing form-driven (summary)

## What was built

- **Publish-gate rules** (`PublishGateService.evaluate()`): submit-presence (D-05), trigger→form uniqueness (APP-12/SC#2, U-5-confirmed copy), routable-kinds (D-08: show/edit carrying a trigger), per-kind config completeness (FRM-14). Each is a named blocked case; a blocked publish leaves the definition byte-identical (no silent repair). Dead `assertRegistersTriggers` removed from `AppDefinitionService`.
- **Form-derived tool catalog** (`PublishedAppLoader`): `PublishedAppForm` + form-scoped tool ids `${app}:${form}`; `appIdOfToolId` helper; RBAC filter runs BEFORE form projection (S8); `triggers: null` yields no tool; four-kind action mapping (submit→create, list→query, show→view, edit→edit). New loader spec (`published-app-loader.spec.ts`).
- **Worker de-hardcode**: `worker.module.ts` factories read real published definitions via `MongoService` (no inline demo literal, no `async () => true` authorize); `RuleBasedProvider` map keyed by tool id. `SLASH_COMMAND_APP` deleted; slash path resolves across authorized forms' aliases (case-folded, leading `/` stripped); multi-app collision degrades to clarify.
- **Form-driven issuance**: `LinkIssuerService.IssueLinkInput` extended with `formId`/`formVersion`/`action`; every `issue()` call site passes them; submit→create, list→query through one seam. `ProcessorOutcome` app attribution keys on `app_id` extracted from the tool id (OBS-05 unchanged). Frozen `read-link-claims` untouched.
- **Publish→route integration** (`decision-routing.integration.spec.ts`) + updated `inbound-event.processor.spec.ts` (16 tests green).
- **Publish controller** surfaces form-rule refusal messages inline, with the U-5-confirmed SC#2 copy for trigger collisions.

## Key decisions

- Trigger uniqueness dedupes labels per form (a single form listing the same label in both intents and aliases is one resolution, not a collision) — applied in both `publish-gate.service.ts` and `publish.controller.ts`.
- Slash commands are looked up by stripping the leading `/` and matching against form aliases.
- RuleBasedProvider map keyed by `${app}:${form}` tool id (not app id), so JEV routing resolves the form-scoped tool.
- Un-migrated definitions (no `forms`) project to no tools (fail closed).

## Commits

- 3df47aa9 feat(07-08): Task 1 — publish-gate rules
- a3e8d1bb feat(07-08): Task 2 — form-derived tool catalog
- d2cbced7 feat(07-08): Task 3 — worker de-hardcode, form-driven issuance, publish→route integration
- 4a34e81f test(07-08): forms: [] in PublishedApp fixtures
- 79a4fad7 feat(07-08): publish.controller form-rule refusal messages + drop dead assertRegistersTriggers

## Verification

- `npm run build` green.
- `packages/domain/src/decision` (10 files, 144 tests) + `publish-gate.service.spec.ts` (17 tests) + `inbound-event.processor.spec.ts` (16 tests) all green.
- `packages/contract/src/links/` zero diff (frozen contracts untouched).
- `assertRegistersTriggers` removed from `app-definition.service.ts`.

## Known consequences

- A fresh environment routes nothing until an app is created and published through the builder (the hardcoded Phase-2 demo entry is replaced) — that is what SC#2/SC#4 demand.
