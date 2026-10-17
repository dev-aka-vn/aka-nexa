---
phase: 06
plan: 06-07
subsystem: app-builder SPA
tags: [app-builder, spa, wizard, form-designer, rbac, casl, formio, tdd]
dependency_graph:
  requires:
    - 06-01 (domain builder element: AppDefinitionService, lifecycle, repository)
    - 06-02 (API app-builder controller: POST/GET/PATCH /apps, session middleware)
    - 06-04 (field-mapping endpoint GET/PUT /apps/:id/routing/mapping)
    - 06-06 (contract SectionNameSchema, UpdateSectionSchema)
  provides:
    - SPA shell (hash router, session gate, OIDC redirect)
    - five-step create wizard (Basics → Triggers → RBAC → Form → Routing)
    - form designer (FormIO 5.6.1 builder, 50-snapshot undo/redo, FRM-05 authoring)
    - FRM-09 sandbox preview (nosubmit + in-memory submission buffer)
    - BLD-05 field-mapping surface
    - roles & permissions (BLD-03 matrix, ACL-02 autocomplete, ACL-04 single-owner)
    - @casl/ability per-app rule factory (ACL-10 transfer carve-out, BLD-11 delegation)
    - twelve-tab section editor (BLD-02)
  affects:
    - apps/app-builder (new SPA)
    - packages/domain/src/authz (builder-ability joins rbac.service)
    - packages/domain/src/index.ts (barrel export)
tech_stack:
  added:
    - "@casl/ability 7.0.1 (per-app ability factory)"
    - "@formio/js 5.6.1 (builder + renderer, already pinned)"
    - "React 19.3.0 SPA (no new framework — vite + react already present)"
  patterns:
    - "TDD red/green per task (6 commits: 3 red + 3 green)"
    - "structural (hand-written) response schemas instead of Zod at the SPA boundary"
    - "page.route API stubbing in Playwright (no API server needed for SPA specs)"
    - "guarded dynamic import for the FormIO bundle (Pattern 1)"
    - "container-as-leaf React mount for FormIO containers (Pitfall 4)"
    - "cookie-only API client (D-101): credentials same-origin, no token anywhere"
key_files:
  created:
    - apps/app-builder/src/App.tsx
    - apps/app-builder/src/main.browser.ts
    - apps/app-builder/src/api/client.ts
    - apps/app-builder/src/api/definition.ts
    - apps/app-builder/src/api/users.ts
    - apps/app-builder/src/apiHooks.ts
    - apps/app-builder/src/auth/session.client.ts
    - apps/app-builder/src/auth/oidc-redirect.ts
    - apps/app-builder/src/wizard/{WizardPage,BasicsStep,TriggersStep,RbacStep,FormStep,RoutingStep}.tsx
    - apps/app-builder/src/form-designer/{FormDesignerPage,FormioBuilderField,PreviewPane,sandbox,undoHistory,representativeSchema,bootstrap5Templates}.ts(x)
    - apps/app-builder/src/roles/{RolesPage,PermissionMatrix,UserAutocomplete}.tsx
    - apps/app-builder/src/editor/{EditorPage,AppTabs}.tsx
    - apps/app-builder/src/sections.ts
    - apps/app-builder/src/ui/Skeleton.tsx
    - apps/app-builder/src/error/InlineError.tsx
    - apps/app-builder/src/chrome.css
    - apps/app-builder/e2e/{wizard,designer,roles,editor}.spec.ts
    - packages/domain/src/authz/builder-ability.ts
    - packages/domain/src/authz/builder-ability.spec.ts
  modified:
    - packages/domain/src/index.ts (builder-ability barrel export)
    - apps/app-builder/e2e/s1-spike.spec.ts (goto fix)
    - packages/domain/src/builder/data-routing/representativeSchema.ts (type widening)
decisions:
  - "ACL-10's transfer carve-out is implemented as a rule omission — transfer-execution is granted by no @casl/ability rule, to any role; there is no runtime check to forget"
  - "FRM-09 sandbox isolation is structural: SubmissionSandbox has no HTTP surface; PreviewPane sets form.nosubmit=true (FormIO's own submission path resolves {saved:false} without a request) and diverts the submit event to the in-memory buffer"
  - "SPA-side API responses use hand-written structural schemas (parse(data): T) rather than Zod — the contract package ships no response schema for the definition document, and the SPA avoids a second validation language at its boundary"
  - "Playwright specs stub the API via page.route (one dispatch route for all **/api/apps/** paths, method+URL dispatch inside) — no real API server needed; the tablet project is chromium-backed 768×1024 hasTouch"
  - "The mockup's 411-line style block was ported to chrome.css (minus duplicate :root tokens) so components reuse the mockup's class vocabulary — no second palette"
  - "The /users/search endpoint does not exist in apps/api yet (plan 06-08 owns it); the SPA compiles against the contract-first surface and the specs stub it"
  - "FormioBuilderField gained an onHistoryChange callback to drive the designer toolbar's disabled states — a captured change is always undoable (undo flushes pending), a new change invalidates redo"
metrics:
  duration: 10369s
  completed: 2026-10-12
actuals:
  tokens: 194475
  tasks: 3
  commits: 6
status: complete
plan_head_before: 29d568b9e6205f0fc9241aed0c4e946e61346f76
plan_head_after: 21facfe5226953cb5005bcb6722a6b394c9d547d
commits: 6
---

# Phase 6 Plan 07: Self-Service App Builder — SPA core Summary

**One-liner:** React 19 SPA shell with cookie-only session gate, five-step create wizard, FormIO 5.6.1 designer with 50-snapshot undo/redo and sandbox-isolated preview, @casl/ability per-app rules with the ACL-10 transfer carve-out, BLD-03 permission matrix + ACL-02 autocomplete, and the twelve-tab section editor — all TDD red/green, 46 Playwright tests + 20 vitest tests passing.

## Tasks

| # | Name | Type | Commits | Status |
|---|------|------|---------|--------|
| 1 | SPA shell, session auth, API client, five-step wizard | tracer (tdd) | `68b19895` red, `c3f3f763` green | ✅ complete — tracer feedback gate re-verified end-to-end |
| 2 | Form designer — builder mount, undo/redo, FRM-05, FRM-09 sandbox, BLD-05 mapping | auto (tdd) | `88cbc303` red, `69f02ab4` green | ✅ complete |
| 3 | Roles, authorization, errors, skeletons | auto (tdd) | `ae8bb7da` red, `21facfe5` green | ✅ complete |

## Verification evidence

**Task 1 (tracer gate re-run, auto mode):**
- `npx playwright test apps/app-builder/e2e/wizard.spec.ts` — 10/10 (chromium + tablet)
- `npx vitest run apps/app-builder/src/auth` — 3/3 (session client)

**Task 2:**
- `npx playwright test apps/app-builder/e2e/designer.spec.ts` — 8/8 (4 chromium + 4 tablet)
- `npx vitest run apps/app-builder/src/form-designer` — 9/9 (sandbox 3 + undoHistory 6)

**Task 3 (plan verify commands):**
- `npx vitest run packages/domain/src/authz --maxWorkers=1` — 8/8 (builder-ability spec)
- `npx playwright test wizard.spec.ts designer.spec.ts --project=tablet` — 9/9
- `grep -c 'Skeleton' apps/app-builder/src/ui/Skeleton.tsx` — 8

**Plan-level:**
- `npx playwright test apps/app-builder/e2e --workers=1` — **46/46** (both projects)
- `npx vitest run packages/domain/src/authz apps/app-builder/src --maxWorkers=1` — **20/20** (4 files)
- D-101 grep (`localStorage|sessionStorage|document.cookie` in apps/app-builder/src) — **clean, no hits**
- `npx tsc --noEmit` (root) — **pass**
- apps/app-builder tsc shows only the pre-existing @types/react absence (TS7016/TS7026/TS7006 — @types/react is deliberately not installed per T-06-SC; app-builder was never in the tsc project graph; vite transpiles without typechecking)

## Deviations from Plan

### Auto-fixed / added during execution

**1. [Rule 2 — missing critical functionality] `apps/app-builder/src/sections.ts` and `apps/app-builder/src/api/users.ts` added**
- **Found during:** Task 3
- **Issue:** The plan's `<files>` list names the roles/editor components but not the shared section vocabulary (the twelve SectionNameSchema sections + labels + section-field mapping both the editor and the matrix need) nor the identity-directory search response contract (ACL-02's "never offers a group or attribute target" is enforced structurally by the response schema).
- **Fix:** Created both modules; users.ts's `UsersSearchSchema` only ever resolves `users` entries, so group/attribute targets cannot reach the autocomplete.
- **Files modified:** apps/app-builder/src/sections.ts, apps/app-builder/src/api/users.ts
- **Commit:** `21facfe5`

**2. [Rule 2 — missing critical functionality] roles.spec.ts and editor.spec.ts added beyond the plan's listed spec file**
- **Found during:** Task 3 (TDD)
- **Issue:** The plan lists only `builder-ability.spec.ts` as a spec file, but behavior Tests 2–4 (permission matrix, autocomplete, single-owner) are SPA-surface behaviors with no failing test without an e2e spec. TDD requires the red test first.
- **Fix:** Added `apps/app-builder/e2e/roles.spec.ts` (6 tests: BLD-03 matrix + empty-subset refusal, ACL-02 autocomplete, BLD-07 no-match echo, ACL-04 sole-owner guards, BLD-09/07 skeleton + retry) and `apps/app-builder/e2e/editor.spec.ts` (3 tests: BLD-02 twelve tabs, JSON round-trip, BLD-07 invalid-payload refusal).
- **Files modified:** apps/app-builder/e2e/roles.spec.ts, apps/app-builder/e2e/editor.spec.ts
- **Commit:** `ae8bb7da` (red), `21facfe5` (green)

**3. [Rule 1 — bug] roles.spec.ts assertion refined during green**
- **Found during:** Task 3 green
- **Issue:** The red spec asserted the roles-permissions PATCH body equals `{support: [...]}` exactly; the implementation (correctly, per the repository's wholesale-replacement `applySectionPatch`) sends the full permission map.
- **Fix:** Assertion now checks the saved custom role's subset within the wholesale map.
- **Files modified:** apps/app-builder/e2e/roles.spec.ts
- **Commit:** `21facfe5`

**4. [Rule 1 — bug] vite proxy rewrite (Task 1)**
- **Found during:** Task 1
- **Issue:** The API serves routes at the root (no `/api` prefix); the SPA's client calls `/api/*`.
- **Fix:** `vite.config.ts` proxy gains `rewrite: (path) => path.replace(/^\/api/, '')`.
- **Commit:** `c3f3f763`

**5. [Rule 1 — bug] s1-spike.spec.ts goto fix + representativeSchema widening (Task 1)**
- **Issue:** The spike spec's `page.goto` needed the dev-server origin; `RepresentativeSchema` needed `extends Record<string, unknown>` for the FormIO prop types.
- **Commit:** `c3f3f763`

**6. [Rule 1 — bug] type-error cleanup before Task 1's green commit**
- **Issue:** RoutingStep's `value.appId` → `appId` prop threading, SkeletonLine optional `key` prop.
- **Commit:** `c3f3f763`

**7. [Rule 2 — created earlier than listed] Skeleton.tsx and InlineError.tsx created in Task 1**
- **Found during:** Task 1
- **Issue:** The plan lists both files under Task 3's `<files>`, but Task 1's wizard and boot surfaces need them (BLD-07/BLD-09 are cross-cutting).
- **Fix:** Created in Task 1; Task 3 consumes them.
- **Commit:** `c3f3f763`

## Known Stubs

None — every surface is wired to the stubbed contract in specs and to the real plan-04/05/06 API endpoints in the SPA. The one deliberate contract-first surface: `GET /users/search` is served by plan 06-08 (not yet in apps/api); the SPA compiles against the contract and the specs stub it — this is a plan-boundary, not a code stub, and is recorded here for the verifier.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-network-endpoint | apps/app-builder/src/api/users.ts | SPA now queries the identity directory (`GET /users/search?q=`) — names/emails traverse the session cookie boundary. Mitigated: httpOnly cookie-only credential (D-101), prefix-search-only contract, real_user_id resolution (opaque IDs, no PII beyond the directory's own response). Server-side enforcement belongs to plan 06-08. |

## TDD Gate Compliance

All three tasks carried `tdd="true"` and followed RED → GREEN:

- Task 1: red `68b19895` (session.client.spec.ts 3 + wizard.spec.ts 5, all failing) → green `c3f3f763`. Tracer feedback gate: re-ran `<verify>` end-to-end in auto mode — passed, logged "⚡ Tracer verified end-to-end — expanding".
- Task 2: red `88cbc303` (designer.spec.ts 4 + sandbox.spec.ts 3, all failing) → green `69f02ab4`.
- Task 3: red `ae8bb7da` (builder-ability.spec.ts 8 + roles.spec.ts 6 + editor.spec.ts 3, all failing — module-missing and element-not-found) → green `21facfe5`.

No test was force-committed green; every red commit was observed failing before its green counterpart.

## Self-Check: PASSED

All key files exist (App.tsx, RolesPage.tsx, EditorPage.tsx, builder-ability.ts, 06-07-SUMMARY.md) and all six commits are present in history (68b19895, c3f3f763, 88cbc303, 69f02ab4, ae8bb7da, 21facfe5).
