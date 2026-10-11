---
phase: "06"
slug: "self-service-app-builder"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
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

### Phase requirement → test map (seeded from research)

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BLD-01 | 5-step wizard creates a draft at step 1 | E2E | `npx playwright test apps/app-builder/e2e/wizard.spec.ts` | ❌ W0 |
| BLD-02 | Tabbed editor edits all 12 sections | E2E + unit | `npx vitest run packages/domain/src/builder` + Playwright | ❌ W0 |
| BLD-03 | Custom roles with arbitrary permission sets; assign by email autocomplete | unit + E2E | `npx vitest run packages/domain/src/builder/role-assignments.spec.ts` | ❌ W0 |
| BLD-04 | Drag-and-drop design + 50-action undo/redo | E2E (drag) + unit (history) | `npx playwright test form-designer.spec.ts` + `npx vitest run undoHistory.spec.ts` | ❌ W0 |
| BLD-05 | Visual form-field → connector-field mapping | unit + E2E | `npx vitest run field-mapping.spec.ts` | ❌ W0 |
| BLD-06 | Publish confirmation summarizes every change; keyboard shortcut saves | E2E | `npx playwright test publish.spec.ts` | ❌ W0 |
| BLD-07 | Inline, specific, actionable errors | unit + E2E | `npx vitest run error-mapping.spec.ts` | ❌ W0 |
| BLD-08 | Submission viewer: filters, detail, export | unit + E2E | `npx vitest run apps/api/src/submissions` + Playwright | ❌ W0 |
| BLD-09 | Tablet usability + loading skeletons | E2E (viewport) | `npx playwright test --project=tablet` | ❌ W0 |
| BLD-10 | Connector request → operator provision → resume | integration (testcontainers) | `npx vitest run connector-request.flow.spec.ts` | ❌ W0 |
| BLD-11 | Delegated workflow manager operates without ownership | unit | `npx vitest run delegation.rules.spec.ts` | ❌ W0 |
| BLD-12 | OIDC SSO + MFA login; owner-scoped management | integration + E2E | `npx vitest run auth.session.spec.ts` + Playwright | ❌ W0 |
| APP-03 | Versioned definitions; 20 retained; rollback | unit | `npx vitest run app-definition.versions.spec.ts` | ❌ W0 |
| APP-05 | Deprecated: functional, notice shown, no new triggers | unit | `npx vitest run lifecycle.deprecate.spec.ts` | ❌ W0 |
| APP-06 | Archived: no new submissions; view links resolve | integration | `npx vitest run lifecycle.archive.spec.ts` | ❌ W0 |
| APP-07 | Dry-run blocks >5-point routing-share drop | unit + integration | `npx vitest run publish-gate.spec.ts` | ❌ W0 |
| APP-08 | Description collision rejected at publish | unit | `npx vitest run publish-gate.spec.ts` (same file) | ❌ W0 |
| APP-09 | ~10 template seeds; tag filter; fork is a snapshot | unit + integration | `npx vitest run templates.seed.spec.ts` | ❌ W0 |
| FRM-05 | Conditional show/hide + validation rules authorable | E2E (FormIO) | `npx playwright test form-designer.spec.ts` | ❌ W0 |
| FRM-09 | Draft preview with sandbox submissions | E2E | `npx playwright test form-preview.spec.ts` | ❌ W0 |
| IDN-05 | OTP: 10-min expiry, 3 attempts, 30-min lockout | integration (Redis) | `npx vitest run otp.state-machine.spec.ts` | ❌ W0 |
| IDN-08 | SSO identity mapped to real_user_id without OTP | integration | `npx vitest run users/sso-mapping.spec.ts` | ❌ W0 |
| ACL-05 | Transfer requires global-admin approval; 7-day auto-cancel | integration + scheduler | `npx vitest run transfer-approval.spec.ts` | ❌ W0 |
| ACL-10 | Owner manages roles except ownership transfer | unit | `npx vitest run role-permissions.spec.ts` | ❌ W0 |
| OBS-05 | `routing_share{app_id}` exported | unit | `npx vitest run routing-share.metrics.spec.ts` | ❌ W0 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/app-builder/{package.json, tsconfig.json (DOM lib + jsx), vite.config.ts, index.html}` — the SPA does not exist; root `tsconfig.json` deliberately does not reference SPAs
- [ ] `apps/app-builder/e2e/` + `playwright.config.ts` + `npx playwright install chromium`
- [ ] Install: `react@19.3.0 react-dom@19.3.0`, `-D vite@8.3.4 @vitejs/plugin-react@6.1.2 @playwright/test@1.64.0`, `openid-client@6.8.8 @casl/ability@7.0.1 csv-stringify@6.9.0`
- [ ] `tooling/boundaries.config.mjs` — extend `ALLOWED_EDGES.builder` with `identity`, `links`, `contract` (Pattern 6)
- [ ] `packages/domain/src/builder/` skeleton + `apps/api/src/{auth,app-builder,submissions,users}/` module skeletons mirroring `read.module.ts` factory providers
- [ ] G-11 replacement: repository-backed `SavedQueryLookup` impl + seed backfill migration + its spec (replaces `SeedSavedQueryLookup` wiring at `read.module.ts`)
- [ ] IdP test double: Keycloak testcontainer or stub issuer for auth integration tests (Open Question 1)

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

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending