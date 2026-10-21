# Phase 06 — UI Review

**Audited:** 2026-10-13
**Baseline:** abstract 6-pillar standards (no UI-SPEC.md for this phase). Design authority: `prototypes/mockup.html` (per AGENTS.md — "prototypes/ is the source of truth" for layout, navigation, IA, copy, colour, type, spacing). The implemented frontend is the App Builder SPA at `apps/app-builder/src/` (React 19 + Vite 8 + `@formio/js` 5.6.1), built across plans 06-01…06-08.
**Screenshots:** not captured — no app-builder dev server is reachable (ports 3000/8080 answer 302 redirects to unrelated login pages; Vite's 5173 is down), and Playwright Chromium cannot launch in this sandbox (`libatk-1.0.so.0` missing, no root to install OS deps). Code-only audit (the documented static-capture fallback).
**Interaction captures:** off (workflow.ui_interaction_capture is false)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Exact mockup copy (wizard toast, step rail, empty states); specific retryable errors. Issues: raw `real_user_id` shown in the header; no publish-modal copy because the publish modal is absent. |
| 2. Visuals | 2/4 | Component vocabulary faithfully ported, but the shell diverges from the design authority: the mockup's left sidebar + topbar was replaced by an inline-styled top button row; 20 ported shell classes are dead code; lifecycle badges use icon-tile tones with a colour mapping that contradicts the mockup's own `statusBadge()`. |
| 3. Color | 3/4 | Zero hardcoded colours in TSX — every colour resolves through `var(--*)` tokens; good accent discipline. Issues: lifecycle status colours diverge from the mockup's badge vocabulary; the absent sidebar removes the mockup's dark `--ink` anchor, so the 60/30/10 has no dark 60%. |
| 4. Typography | 3/4 | The ported class system carries the mockup's full type scale and weights; but ~40 inline `fontSize`/`fontWeight` overrides (9 distinct sizes) bypass it. |
| 5. Spacing | 2/4 | ~130 inline `style={{}}` objects; `--od-gap` overridden off the 8 px grid (10/12/14/18/6/4 px, 39×); the main `.view` padding is a third value (`20px 22px 60px`) matching neither the mockup's desktop (`26px 28px 64px`) nor its 960 px breakpoint (`20px 16px 60px`). |
| 6. Experience Design | 2/4 | Excellent state coverage (layout-shaped skeletons, inline retryable errors, empty states, disabled actions). Gaps: deprecate/archive are unreachable in the UI (endpoints exist, mockup ships the buttons); publish fires with no confirmation; 10/12 editor sections are raw JSON; the unauthenticated `#/spike` route and `window.__SPIKE__`/`__DESIGNER__` debug handles ship in the production build. |

**Overall: 15/24**

---

## Top 3 Priority Fixes

1. **Surface the lifecycle transitions the console promises (BLOCKER — breaks a phase-scoped user task).** The phase boundary is "app lifecycle (deprecate/archive/transfer)" and the API serves `POST /apps/:id/deprecate` and `/archive` (`apps/api/src/app-builder/app-builder.controller.ts:192,209`), but no SPA surface calls them — the only lifecycle transition reachable in the UI is Publish. The mockup's lifecycle tab ships Deprecate/Archive/Purge buttons (`prototypes/mockup.html:1249-1251`). An admin cannot deprecate or archive an app self-service; they must drop to the API/CLI. — **Fix:** add the Lifecycle-state tab's action buttons (Deprecate / Archive, with the mockup's per-state callouts at `mockup.html:1241-1248`) and wire them to the two endpoints.
2. **Replace the raw-JSON section editors with structured fields.** 10 of 12 editor sections (`isJsonSection`, `editor/EditorPage.tsx:59-61`) render a single `<textarea rows={14}>` of hand-edited JSON (`EditorPage.tsx:646-653`). The mockup renders every section as field-by-field controls — retention policy is a mode select + "Retention period (days)" number input (`mockup.html:1255-1260`), deprecation notice is a labelled textarea (`mockup.html:1264`), lifecycle state is a control set (`mockup.html:1226-1253`). Hand-editing JSON contradicts the phase's core value ("a department admin builds… without an engineering ticket"). — **Fix:** port the mockup's per-section structured editors for at least lifecycle, retention, deprecation-notice, versioning, and data-routing; keep JSON as an advanced fallback.
3. **Port the publish confirmation modal and strip the shipped debug surfaces.** Publish fires immediately on the button or Ctrl/Cmd+S (`EditorPage.tsx:325-356`, `364-374`) with no confirmation; the mockup's flow is a confirm modal — "Publish "{name}"?" / "Review the changes that take effect immediately." / change rows / Cancel + "Confirm publish" (`mockup.html:1600-1619`). Publish registers triggers, creates indexes, is versioned and audit-trailed, and makes `app_id` immutable after first publish. Separately, `#/spike` is routed *before* the session gate (`App.tsx:459-461`) — an unauthenticated FormIO builder harness in the production build — and `window.__SPIKE__` (`App.tsx:299-301`) / `window.__DESIGNER__` (`FormDesignerPage.tsx:416-436`) are window-global debug handles the 06-01 SUMMARY said would be "replaced by real designer chrome in later plans"; they were never removed. — **Fix:** add the change-summary confirm modal (and an unsaved-changes guard on the shortcut), and delete the `#/spike` route, `SpikePage`, and both debug globals from the production tree.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

**What's right (substantially met):**
- The wizard carries the mockup's copy verbatim: the step rail is the locked "Basics → Triggers → RBAC → Form → Routing" order (`wizard/WizardPage.tsx:63-89`) and the toast is the mockup's exact string — `DRAFT_TOAST = 'Saved as a draft · continue through the wizard steps'` (`WizardPage.tsx:91-93`, sourced from `mockup.html:1603-1628`).
- Empty states are specific and actionable, never "No data": "No apps yet — Create your first app…" (`apps/AppsPage.tsx:118-123`), "No templates match — clear the filter" (`AppsPage.tsx:461-465`), "No pending transfers" (`users/UsersPage.tsx:643-647`), "No audit entries match" (`audit/AuditPage.tsx:216-221`), "No submissions match" (`submissions/SubmissionsPage.tsx:333-337`), "No connector fields" (`form-designer/FormDesignerPage.tsx:226-232`).
- Errors are inline, specific, and retryable (BLD-07): `InlineError` reads "Failed to {operation}" with the API's named code and verbatim message plus a Retry button (`error/InlineError.tsx:58-96`); the editor names the offending section ("The {section} section needs a valid JSON object", `EditorPage.tsx:274-277`).
- CTAs are specific: "Create app", "Continue", "Finish", "Open the app editor", "Use template", "Fork into your estate", "Export CSV", "Map user", "Submit request". No "Submit"/"Click Here"/"OK" generic labels found.

**Issues:**
- **WARNING — raw internal ID in the header.** The shell renders `{user.real_user_id} · MFA` (`App.tsx:561-567`). `real_user_id` is an opaque internal identifier (the constraints forbid PII in tokens precisely because it is an opaque ID); the mockup's topbar avatar shows a *name and role* (`mockup.html:129-133`, `.avatar .who b/span`). Showing a raw ID to the admin is meaningless copy. — Fix: resolve the session's display name/role (the identity directory the SPA already queries at `api/users.ts`) or show "Signed in · MFA".
- **WARNING — missing publish-modal copy.** Because the publish modal is absent (Pillar 6), none of the mockup's publish copy exists: "Publish "{name}"?", "Review the changes that take effect immediately.", "Confirm publish" (`mockup.html:1600-1619`). The post-hoc inline banner ("{name} published — version N") is good, but the pre-publish confirmation copy is gone with the modal.
- Minor: the AppsPage card footer reads "Open the app / Open →" and the scoped picker "Open {surface} / Open →" — serviceable, but the mockup's card language is not carried verbatim here.

### Pillar 2: Visuals (2/4)

**What's right:** the component vocabulary is faithfully ported and well used on the page surfaces — cards, `card-head`/`card-body`/`card-foot`, badges, tables (`table-wrap`, `cell-mono`, `cell-actions`), chips/rail, callouts (info/warn/danger/accent), drawers, toasts, step-rail, kv lists, and the grid system (`od-grid`, `grid-main`, `grid-2/3`). The dashboard's two-widget layout (`dashboard/DashboardPage.tsx:115-124`) matches the mockup's `grid-main` intent, and the designer's builder+preview+mapping split (`FormDesignerPage.tsx:497-526`) is a clear focal hierarchy. Icon-only buttons carry `aria-label` (e.g. the toast dismiss, `WizardPage.tsx:462-470`).

**Issues:**
- **WARNING (design-authority divergence) — the shell is not the mockup's shell.** The mockup's IA is a fixed left sidebar: `.sidebar` (250 px, dark `--ink`), a `.brand` block (mark + "AkaNexa" + "App Builder Console"), four `.nav-group`s with `.nav-label` headers — **Workspace** (Dashboard, Apps + live count), **Operations** (Submissions, Connectors + count), **Governance** (Audit Log, User Management), **System** (Settings) — each `.nav-item` carrying an SVG icon and an active-indicator bar (`mockup.html:111-141, 468-486`), plus a sticky `.topbar` (breadcrumbs `.crumbs`, `.search`, `.avatar`, env pill). The SPA replaced all of it with a single top header row: a brand text link + eight `btn btn-ghost btn-sm` buttons + a session-user span, all through inline styles (`App.tsx:466-568`). There is no sidebar, no brand mark, no nav grouping, no icons, no live counts, no breadcrumbs, no search, no avatar. AGENTS.md designates the mockup as the authority for "Layout, navigation, page structure, information architecture"; this is the most visible divergence in the build. (The 06-07 PLAN's words were "App.tsx with a minimal router" — the executor followed the plan, but the plan under-specifies the shell against the design authority, and the divergence was never called out.)
- **WARNING — 20 ported shell classes are dead code.** `chrome.css:84-133` ports `.sidebar`, `.brand`, `.nav-scroll`, `.nav-group`, `.nav-label`, `.nav-item`, `.side-foot`, `.env-dot`, `.main`, `.topbar`, `.hamburger`, `.crumbs`, `.search`, `.env-pill`, `.avatar` verbatim — and no component references any of them. The stylesheet was ported to be reused (its header says so) but the shell bypasses it with hand-rolled inline styles. Either wire the classes up (restore the sidebar) or delete the dead block so the stylesheet reflects what actually renders.
- **WARNING — lifecycle badges use the wrong class vocabulary and the wrong colours.** `AppsPage.lifecycleTone` (`:47-62`) maps lifecycle → `it-teal`/`it-amber`/`it-violet`/`it-red` and applies them as `className="badge it-teal"` (`:163-168`). Those are the *icon-tile* tones (`.it-*`), not the mockup's badge vocabulary, and the mapping contradicts the mockup's own `statusBadge()` (`mockup.html:782-790`): the mockup renders published=green (`badge-published`), draft=neutral (`badge-draft`), deprecated=amber (`badge-deprecated`), archived=violet (`badge-archived`); the SPA renders published=teal, draft=amber, deprecated=violet, archived=red. The correct classes (`badge-published/draft/deprecated/archived`) exist in the ported `chrome.css:192-196` and are unused. — Fix: use the mockup's `statusBadge` mapping.
- Minor: no visual focal point distinguishes the current route in the top nav (the mockup's active nav item has an accent bar + tinted background, `.nav-item[aria-current="page"]`); the top row has no active state at all.

### Pillar 3: Color (3/4)

**What's right:** zero hardcoded colours in the SPA's TSX/TS (grep for `#[0-9a-fA-F]{3,8}` / `rgb(` outside `tokens.css` → **0 hits**). Every colour resolves through `var(--*)` custom properties, and `tokens.css` carries the mockup's `:root` block verbatim (the `--accent #0f9d8f` scale, the `--amber/--red/--green/--blue/--violet` semantic scales with `-soft` variants, `--ink/--canvas/--surface/--line/--text`). Accent is used with discipline: primary buttons, focus rings (`:focus-visible{outline:2px solid var(--accent)}`), links (`a{color:var(--accent-strong)}`), selected tabs, the meter, and `radio-card.sel` — not sprayed across decorative elements. No second palette, no second typeface (the font pipeline in `index.html` is the mockup's exact Google-Fonts block).

**Issues:**
- **WARNING — lifecycle status colours diverge from the mockup's badge vocabulary** (detailed under Visuals): deprecated renders violet where the mockup renders amber; archived renders red where the mockup renders violet; draft renders amber where the mockup renders neutral; published renders teal where the mockup renders green. Because the statuses are colour-coded communication (an admin scans a card grid by colour), the wrong mapping is a semantic defect, not a preference.
- **WARNING — no dark anchor.** The mockup's 60/30/10 leans on the dark `--ink` sidebar as the dominant dark surface; with the sidebar absent, the entire console is light canvas + white surface, so the visual weight is all light and the accent has no dark counterweight. This is a consequence of the shell divergence (Pillar 2), not an independent palette error.
- Minor: `AppsPage`'s `badge it-*` combination relies on the icon-tile background classes happening to work on a badge; the intended badge classes exist and should be used (see Visuals).

### Pillar 4: Typography (3/4)

**What's right:** the ported class system carries the mockup's full type scale — display (`Space Grotesk`, 600) for headings via `h1,h2,h3,h4{font-family:var(--display);font-weight:600}`, body `IBM Plex Sans` 16/1.55, mono `IBM Plex Mono` for `.cell-mono`/`.pill-mono`/`.code-inline` — and weights stay inside the mockup's set (500/600/700). Headings, card heads, table headers (`thead th` 11.5 px uppercase 600), and stat values (`.stat .v` 29 px display) all render through classes.

**Issues:**
- **WARNING — inline type overrides bypass the class vocabulary.** ~40 inline `fontSize`/`fontWeight` declarations across the SPA introduce 9 distinct sizes (11, 11.5, 12, 12.5, 13, 13.5, 14, 16, 17) and ~20 `fontWeight: 600` overrides. Examples: `<h3 style={{fontSize:16}}>` overrides the ported `.card-head h3` 15.5 px (`AppsPage.tsx:152,352`); `<p style={{fontSize:14}}>` on wizard copy (`WizardPage.tsx:287,292`); `fontSize: 12.5` on the JSON editor (`EditorPage.tsx:650`). The values mostly land on the mockup's scale, so nothing is off-design — but the overrides duplicate the class system and drift it: the same "card title" is 15.5 px in one place and 16 px in another. — Fix: add type classes (or use the existing `.lr-t`/`.lr-s`/heading classes) and drop the inline `fontSize`/`fontWeight`.
- Minor: `PermissionMatrix.tsx:57,90` uses `fontSize: 11`/`11.5` for matrix labels — the smallest tier, appropriate for dense matrix text, but again inline rather than classed.

### Pillar 5: Spacing (2/4)

**What's right:** the `od-*` layout primitives (`od-stack`, `od-row`, `od-cluster`, `od-grid`, `od-fill`, `od-stack` gaps) are used throughout, and many components correctly vary gaps through the `--od-gap` custom property rather than hardcoding margins — the token-aware mechanism the mockup intends.

**Issues:**
- **WARNING — the spacing scale is overridden off-grid.** `--od-gap` is overridden 39 times with values off the 8 px grid: `10px` (×16), `12px` (×4), `14px` (×3), `18px` (×4), `6px` (×2), `4px` (×1) — the token default is `8px` (`--od-gap:8px`). The mockup's own spacing vocabulary is 8 px-based (`--od-gap:8px`, `--od-rail-pad:16px`, card-body `18px`, page-head `gap:18px`); the SPA's `10/12/14/18` overrides are a parallel, undeclared scale.
- **WARNING — the main view padding diverges from the design authority.** The SPA overrides `.view` to `padding: '20px 22px 60px'` (`App.tsx:570`). The ported `.view` is `26px 28px 64px` (`chrome.css:135`, `mockup.html:160`), and the mockup's own 960 px breakpoint is `20px 16px 60px` (`chrome.css:380`). The SPA's value matches *neither* — it is a third, undeclared padding.
- **WARNING — ~130 inline `style={{}}` objects bypass the ported class vocabulary.** Per-file counts: `AppsPage.tsx` 21, `EditorPage.tsx` 19, `UsersPage.tsx` 15, `RolesPage.tsx` 15, `ConnectorRequestForm.tsx` 12, `SubmissionDetailDrawer.tsx` 10, `UserAutocomplete.tsx` 9, `FormDesignerPage.tsx` 9, `DashboardPage.tsx` 7, `WizardPage.tsx` 6, `ScopedAppPicker.tsx` 6, `SubmissionsPage.tsx` 6, `Skeleton.tsx` 5, `SettingsPage.tsx` 5. Many of these (padding `10px 14px`, `32px`, `24px`; margins `4px 0 0`, `18px 0`; `minWidth: 140`, `maxWidth: 560`, `minHeight: '2.9em'`) are arbitrary values that could be classes or token references. The pattern is consistent enough to read, but the spacing is no longer governed by one scale. — Fix: extend the `od-*`/card/field classes to cover the recurring shapes (section headers, card footers, list rows) and replace the inline numeric spacing with them.

### Pillar 6: Experience Design (2/4)

**What's right (state coverage is genuinely strong):**
- **Loading:** every async surface shows a layout-shaped skeleton (BLD-09), never a spinner-only blank — `Skeleton` ships `text`/`cards`/`block` variants in the content's own shape (`ui/Skeleton.tsx`), used on the app list, gallery, definition load, form-schema load, submissions list, audit log, transfer queue, and each dashboard widget independently.
- **Error:** every async failure renders an inline, specific, retryable `InlineError` in the content's slot (BLD-07) — widget-isolated on the dashboard (`DashboardPage.tsx:194-209, 306-311`), per-card on the gallery fork (`AppsPage.tsx:408-424`), per-section in the editor.
- **Empty:** every list has a tailored empty state (see Copywriting).
- **Disabled:** undo/redo are disabled at the history ends (`FormDesignerPage.tsx:473-490`), publish and section-save disable while `saving`, transfer approve/reject disable while `acting`, template fork disables while `forking`.
- **Sandbox isolation:** the FRM-09 preview is structurally sandboxed — `nosubmit` + an in-memory submission buffer (`form-designer/sandbox.ts`), so preview submissions cannot reach the real collection.
- **Scoped-page pickers:** `#/submissions` and `#/connectors` land on an app picker when unscoped (`ui/ScopedAppPicker.tsx`) — a good empty-path pattern.

**Issues:**
- **BLOCKER — deprecate/archive are unreachable in the UI.** The phase scope is "app lifecycle (deprecate/archive/transfer)" (`06-CONTEXT.md`) and the API exposes `POST /apps/:id/deprecate` and `/archive` (`app-builder.controller.ts:192,209`), but the SPA calls neither — grep for `/deprecate|/archive` across `apps/app-builder/src` → **zero hits**. The only lifecycle transition an admin can perform is Publish. The mockup's lifecycle tab ships the buttons with per-state guidance callouts ("Deprecating shows a notice and stops new trigger registration while keeping the app functional", `mockup.html:1241-1253`). An admin cannot complete the promised lifecycle task self-service. — Fix: add the lifecycle action surface (see Top Fix 1).
- **WARNING — no publish confirmation.** Publish is a significant, versioned, audit-trailed transition that registers triggers and creates indexes, yet it fires immediately from the button and from Ctrl/Cmd+S (`EditorPage.tsx:325-374`) with no confirmation and no unsaved-changes guard — the shortcut will publish even while a section's JSON is mid-edit. The mockup gates the same action behind a confirm modal (`mockup.html:1600-1619`). The change summary *is* computed and shown — but only after the fact, as a green banner (`EditorPage.tsx:486-538`), so the admin never reviews the deltas before they take effect.
- **WARNING — 10/12 editor sections are raw JSON.** `isJsonSection` (`EditorPage.tsx:59-61`) sends every section but General/Metadata to a `<textarea rows={14}>` of hand-edited JSON. The mockup renders each section as structured controls (retention mode + days, deprecation-notice textarea, lifecycle-state controls, versioning fields, `mockup.html:1027-1266`). For the non-developer department admin the console exists for, JSON editing is a usability wall and a validation hazard (a malformed patch is refused inline — good — but the authoring path itself is developer-grade).
- **WARNING — spike/debug surfaces ship in the production build.** `#/spike` is routed before the session gate (`App.tsx:459-461`) — an unauthenticated FormIO builder harness (mounts a representative schema, calls no API, so the data blast radius is limited, but it is dev scaffolding in the shipped console). `window.__SPIKE__` (`App.tsx:299-301`) and `window.__DESIGNER__` (`FormDesignerPage.tsx:416-436`) are window-global introspection handles. The 06-01 SUMMARY records these as "deliberate spike-only scaffolding… replaced by real designer chrome in later plans" — the replacement never removed them. — Fix: delete `SpikePage`, the `#/spike` branch, and both globals; keep the e2e specs on the real designer route.
- Minor: the transfer approve/reject and connector cancel/retry actions execute immediately with no confirmation. These are lower-stakes than publish (and the transfer queue reloads on resolve), but destructive-action confirmation is absent across the console — publish is the one that warrants the modal.

**Registry audit:** not applicable — `components.json` does not exist (NO_SHADCN; the SPA is hand-rolled React over the ported mockup stylesheet, no shadcn/third-party component registry), and no UI-SPEC.md lists registries. Skipped entirely per the audit rules.

---

## Files Audited

**Shell & shared**
- `apps/app-builder/src/App.tsx` — hash router, session gate, shell header, `#/spike` route, `window.__SPIKE__`
- `apps/app-builder/src/main.browser.ts` — browser-only entry, token/chrome css import order
- `apps/app-builder/src/chrome.css` — ported mockup component stylesheet (dead shell classes at 84-133)
- `apps/app-builder/src/tokens.css` — mockup `:root` token block (verbatim)
- `apps/app-builder/index.html` — font pipeline, title/meta
- `apps/app-builder/src/ui/Skeleton.tsx`, `apps/app-builder/src/ui/ScopedAppPicker.tsx`
- `apps/app-builder/src/error/InlineError.tsx`
- `apps/app-builder/src/sections.ts`, `apps/app-builder/src/apiHooks.ts`

**Wizard**
- `apps/app-builder/src/wizard/WizardPage.tsx`, `BasicsStep.tsx`, `TriggersStep.tsx`, `RbacStep.tsx`, `FormStep.tsx`, `RoutingStep.tsx`

**Editor & designer**
- `apps/app-builder/src/editor/EditorPage.tsx`, `AppTabs.tsx`, `publishShortcut.ts`, `publishShortcut.spec.ts`
- `apps/app-builder/src/form-designer/FormDesignerPage.tsx`, `FormioBuilderField.tsx`, `PreviewPane.tsx`, `sandbox.ts`, `undoHistory.ts`, `bootstrap5Templates.ts`, `representativeSchema.ts`

**Roles**
- `apps/app-builder/src/roles/RolesPage.tsx`, `PermissionMatrix.tsx`, `UserAutocomplete.tsx`

**Surfaces (06-08)**
- `apps/app-builder/src/apps/AppsPage.tsx`, `TagFilter.tsx`
- `apps/app-builder/src/dashboard/DashboardPage.tsx`
- `apps/app-builder/src/submissions/SubmissionsPage.tsx`, `SubmissionDetailDrawer.tsx`
- `apps/app-builder/src/connectors/ConnectorsPage.tsx`, `ConnectorRequestForm.tsx`
- `apps/app-builder/src/users/UsersPage.tsx`
- `apps/app-builder/src/audit/AuditPage.tsx`
- `apps/app-builder/src/settings/SettingsPage.tsx`

**API boundary (SPA-side structural schemas)**
- `apps/app-builder/src/api/client.ts`, `definition.ts`, `users.ts`, `submissions.ts`, `connectors.ts`, `audit.ts`, `transfer.ts`, `templates.ts`
- `apps/app-builder/src/auth/session.client.ts`, `oidc-redirect.ts`

**Design authority & upstream**
- `prototypes/mockup.html` — sidebar/brand/nav (111-141, 468-486), topbar/avatar (115-133), `.view` padding (160, 403), `statusBadge()` (782-790), tabbed editor structured sections (1027-1266), lifecycle action buttons (1241-1253), publish modal `openPublish` (1600-1619), create-app modal (1620-1640)
- `.planning/phases/06-self-service-app-builder/06-CONTEXT.md`, `06-01…06-08-SUMMARY.md`, `06-07-PLAN.md`, `06-08-PLAN.md`
- `apps/api/src/app-builder/app-builder.controller.ts` — deprecate (192) / archive (209) endpoints the SPA never calls

---

## Orchestrator Disposition (2026-10-13)

**Fixed in this commit (badge vocabulary — Pillars 2 & 3):**
`AppsPage.lifecycleTone` now returns the mockup's `statusBadge()`
classes — `badge-published` (green) / `badge-draft` (neutral) /
`badge-deprecated` (amber) / `badge-archived` (violet) — which
were already ported in `chrome.css:192-196` but unused. The colour
mapping a colour-coded status grid communicates now matches the
design authority.

**Recorded as follow-ups (not execution defects — the phase's
must-haves are the plans' must-haves, and the goal-backward
verification passed 24/25 against them):**

1. **Deprecate/archive console surface (the audit's BLOCKER) —
   explicitly deferred by the phase's own plan.** 06-04-PLAN.md:259:
   *"APP-06: archived apps refuse submissions with links resolving —
   proven here; no UI surface (end users see the renderer, not the
   builder)."* The lifecycle state machine, both endpoints, and
   their proofs are the phase's deliverable (`app-lifecycle.spec.ts`,
   the APP-06 real-path integration proof); the console buttons are
   a follow-up task for the next pass, with the mockup's lifecycle
   tab (`mockup.html:1241-1253`) as the spec.
2. **Pre-publish confirmation modal — frozen-contract divergence,
   contract wins.** The 06-05 contract defines the confirmation as
   the publish *response* payload ("the publish confirmation payload
   lists every change … matching the mockup's publish-modal rows") —
   implemented and rendered as the change-summary banner. A
   pre-publish modal needs a dry-run endpoint that does not exist.
   Per the precedence rule (AGENTS.md: a mockup never overrides a
   frozen contract), the contract wins. The unsaved-changes guard on
   Ctrl/Cmd+S (publishing while a section's JSON is mid-edit) is a
   legitimate follow-up.
3. **Structured per-section editors — not a phase must-have.**
   BLD-02's contract is "each section editable"; the sections are
   runtime-defined JSON and the JSON editors satisfy the contract
   (inline refusal on malformed input, BLD-07). Porting the mockup's
   field controls is a usability follow-up.
4. **Shell divergence (sidebar) — the plan under-specified the
   shell.** 06-07-PLAN said "App.tsx with a minimal router"; the
   executor followed the plan. Restoring the mockup's sidebar with
   the ported classes (`chrome.css:84-133`) is a follow-up.
5. **Inline style/type overrides (~130 `style={{}}`, ~40 type
   overrides, off-grid `--od-gap` values) — class-vocabulary
   consolidation follow-up.**
6. **Header raw `real_user_id` copy — display-name resolution
   follow-up.**

**By design (not dead scaffolding):** `window.__SPIKE__` and
`window.__DESIGNER__` are the e2e specs' introspection seams
(FormDesignerPage.tsx:414 — "read by the e2e spec";
`e2e/designer.spec.ts`, `e2e/s1-spike.spec.ts` navigate the real
routes and read the handles). The `#/spike` route is the S1 spike's
verification surface — the phase's S1 falsification point
(06-VALIDATION.md manual-only row); it mounts a representative
schema and calls no API. A production hardening pass may gate it
behind a dev-only flag; removing it now would break the phase's own
Wave-0 test infrastructure.
