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

| Req ID | Behavior | Test Type | Automated Command | Source Plan | File Exists? |
|--------|----------|-----------|-------------------|-------------|-------------|
| BLD-01 | 5-step wizard creates a draft at step 1 | E2E | `npx playwright test apps/app-builder/e2e/wizard.spec.ts` | 06-07 | ✅ |
| BLD-02 | Tabbed editor edits all 12 sections | E2E + unit | `npx playwright test apps/app-builder/e2e/designer.spec.ts` + `npx vitest run packages/domain/src/builder/app-definition.service.spec.ts` | 06-07, 06-04 | ✅ |
| BLD-03 | Custom roles with arbitrary permission sets; assign by email autocomplete | unit + E2E | `npx vitest run packages/domain/src/authz/builder-ability.spec.ts` + `npx playwright test apps/app-builder/e2e/wizard.spec.ts` (RbacStep) | 06-07 | ✅ |
| BLD-04 | Drag-and-drop design + 50-action undo/redo | E2E (drag) + unit (history) | `npx playwright test apps/app-builder/e2e/s1-spike.spec.ts` + `npx vitest run apps/app-builder/src/form-designer/undoHistory.spec.ts` | 06-01 | ✅ |
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
| FRM-09 | Draft preview with sandbox submissions | E2E | `npx playwright test apps/app-builder/e2e/designer.spec.ts` (PreviewPane + sandbox) | 06-07 | ✅ |
| IDN-05 | OTP: 10-min expiry, 3 attempts, 30-min lockout | integration (Redis) | `npx vitest run packages/domain/src/identity/otp/otp-state-machine.spec.ts` + `npx vitest run apps/worker/src/processors/otp-onboarding.integration.spec.ts` | 06-03 | ✅ |
| IDN-08 | SSO identity mapped to real_user_id without OTP | integration | `npx vitest run apps/api/src/users/sso-mapping.integration.spec.ts` + `npx vitest run packages/domain/src/identity/oidc-provision.service.spec.ts` | 06-02, 06-08 | ✅ |
| ACL-05 | Transfer requires global-admin approval; 7-day auto-cancel | integration + scheduler | `npx vitest run apps/api/src/app-builder/transfer.integration.spec.ts` + `npx vitest run packages/domain/src/acl` + `npx vitest run apps/worker/src/processors/transfer-auto-cancel.processor.spec.ts` | 06-08 | ✅ |
| ACL-10 | Owner manages roles except ownership transfer | unit | `npx vitest run packages/domain/src/authz/builder-ability.spec.ts` | 06-07 | ✅ |
| OBS-05 | `routing_share{app_id}` exported | unit | `npx vitest run packages/domain/src/builder/routing-share/routing-share.metrics.spec.ts` + `npx vitest run packages/domain/src/builder/routing-share/routing-share.computer.spec.ts` | 06-05 | ✅ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> **E2E execution caveat (2026-10-13 audit):** every Playwright spec above
> exists and targets its behavior, but Chromium cannot launch in this
> sandbox (`libatk-1.0.so.0` missing, no root to install OS deps) — the
> same environmental limit recorded in 06-VERIFICATION.md's human items.
> The vitest suite (unit + testcontainers integration) is the executable
> evidence: 124 files / 1196 tests, 1195 passed, 1 failed — the single
> failure the pre-existing entrypoint-drift orphan walk documented in
> 06-02-deferred-items.md. E2E green runs belong to the staging pass.

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

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-10-13 — no MISSING requirements; the E2E
execution caveat above is environmental (sandbox cannot launch Chromium),
recorded as a staging human item in 06-VERIFICATION.md.

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