---
phase: 06-self-service-app-builder
reviewed: 2026-10-14T02:45:50Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - apps/api/src/app-builder/app-builder.module.ts
  - apps/api/src/app-builder/app-definition.integration.spec.ts
  - apps/api/src/auth/auth.module.ts
  - apps/api/src/auth/oidc-issuer.stub.ts
  - apps/api/src/main.ts
  - apps/api/src/read/edit-link.integration.spec.ts
  - apps/api/src/read/read.controller.ts
  - apps/api/src/read/read.module.ts
  - apps/app-builder/e2e/designer.spec.ts
  - apps/app-builder/src/api/definition.ts
  - apps/app-builder/src/apps/AppsPage.tsx
  - apps/app-builder/src/editor/EditorPage.tsx
  - apps/app-builder/src/editor/publishShortcut.spec.ts
  - apps/app-builder/src/editor/publishShortcut.ts
  - packages/domain/src/datarouter/data-router.service.ts
  - packages/domain/src/datarouter/data-router.spec.ts
  - packages/domain/src/datarouter/outbox.integration.spec.ts
  - tooling/boundaries.config.mjs
  - tooling/deployment-shape.spec.ts
  - tooling/entrypoint-drift.spec.ts
  - tooling/onboarding.spec.ts
findings:
  critical: 0
  warning: 2
  info: 5
  total: 7
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-10-14T02:45:50Z
**Depth:** standard
**Files Reviewed:** 21
**Status:** issues_found

## Summary

Incremental re-review of the 21 source files changed since `900f6529` — the APP-06
lifecycle-guard change and the BLD-06 publish surface. The prior review's findings are
already dispositioned in `06-REVIEW-DISPOSITION.md`; this pass covers only what the
new diff introduces.

Verified correct (no finding):

- **APP-06 seam placement.** `DataRouterService` now injects `AppDefinitionService` and
  calls `assertAcceptsSubmissions(appId)` before the transaction on both paths
  (`data-router.service.ts:73`, `:131`). That is the only production writer of
  `submission_revisions` (grep: no other non-spec `insertOne`), so no write path bypasses
  the guard. `SubmissionRefusedError` (only `archived` refuses — `app-lifecycle.ts:144`)
  becomes `409 {error:'SUBMISSION_REFUSED_ARCHIVED'}` before `startSession`, matching the
  05-08 plan's "nothing inserted, token not consumed" ordering.
- **DI / boundaries.** `ReadModule` imports `AppBuilderModule`, which now exports
  `AppDefinitionService`; the `DataRouterService` factory injects `[MongoService,
  AppDefinitionService]`. `builder` never imports `datarouter`, so the new
  `datarouter → builder` edge (`boundaries.config.mjs:158-173`) adds no module cycle.
- **Auth-surface exclusions.** All four `/l` routes the controller mounts
  (`view/:jti` GET, `query/:jti` GET, `edit/:jti` GET+POST) are excluded by name from the
  session middleware, so the "a new `/l` route fails closed (401)" claim holds. The
  health/metrics exclusions are required for orchestrator probes.
- **`AppsPage.tsx` badge rename** (`it-teal`/`it-amber`/`it-violet`/`it-red` →
  `badge-published`/`badge-draft`/`badge-deprecated`/`badge-archived`) is a correct fix:
  the four classes exist (`chrome.css:192-195`) and match `prototypes/mockup.html:217-220`
  exactly, including the deprecated→amber / archived→violet assignment. The old values
  were `icon-tile` tones misapplied to a badge.
- **Publish-result schema / shortcut helper / tooling spec updates** — no defects.

Two WARNINGs and five INFO items follow.

Context for WR-01 and IN-05: `routeSubmission` has **no production caller** today (only
`data-router.spec.ts` and `outbox.integration.spec.ts`), so the guard there is a
forward-looking seam; the live, exercised path in this diff is `routeEdit` through
`POST /l/edit/:jti`.

## Narrative Findings (AI reviewer)

This review's findings, from direct code review of the 21 changed files. No structural
pre-pass (`<structural_findings>`) and no external reviewer evidence were provided for this
run, so there is no `## Structural Findings (fallow)` section.

## Critical Issues

None.

## Warnings

### WR-01: `editPost` maps only `SubmissionRefusedError`; the same new guard can also throw `AppNotFoundError` → 500

**File:** `apps/api/src/read/read.controller.ts:279-286`
**Severity:** WARNING

The change under review added a second throwing path to `DataRouterService.routeEdit`
(`data-router.service.ts:131` → `AppDefinitionService.assertAcceptsSubmissions`), and that
guard throws **two** error types, not one:

```ts
// packages/domain/src/builder/app-definition.service.ts:304-310
async assertAcceptsSubmissions(appId: string): Promise<void> {
  const definition = await this.repository.findByAppId(appId);
  if (definition === null) {
    throw new AppNotFoundError(appId);      // ← not handled by editPost
  }
  AppLifecycle.assertAcceptsSubmissions(appId, definition.lifecycle); // ← SubmissionRefusedError
}
```

`editPost`'s catch handles the duplicate-key case and `SubmissionRefusedError`, then
re-throws everything else (`read.controller.ts:286`). `ReadController` is **not** decorated
with `@UseFilters(BuilderExceptionFilter)` (only the app-builder/submissions controllers
are, e.g. `publish.controller.ts:41`), and there is no global `APP_FILTER` registration
(grep: no `useGlobalFilters`/`APP_FILTER` in `apps/api/src`). So `AppNotFoundError` — a
`BuilderError` whose `APP_NOT_FOUND` code the builder filter maps to **404**
(`app-builder.controller.ts:274-278`) — escapes as an unhandled exception and becomes a
**500**.

Reachability: the app-definition repository has no delete path (grep: no `deleteOne`/
`deleteMany` in `packages/domain/src/builder`, no `@Delete` route in `apps/api/src`), so
this is not reachable through the product's own lifecycle. It **is** reachable whenever an
outstanding link resolves to an absent definition — and read/edit links are stateless,
signature-verified, long-lived artifacts (AD-11/LNK-05): any database reset, environment
copy, or re-provisioning leaves previously minted links valid while their `app_id` no
longer resolves. The result is a 500 on a user-facing form submit instead of the clean,
named refusal the BLD-07 discipline requires elsewhere in the system.

**Fix:** handle the absent-definition case explicitly on the read path, in the same flat
JSON error shape the neighbouring `409` branch already uses (this is a JSON POST endpoint,
so a 302 dead-link redirect is not the right response for the XHR that fires it):

```ts
import { AppNotFoundError, SubmissionRefusedError } from '@akane/domain';

// ...
if (error instanceof SubmissionRefusedError) {
  res.status(409).json({ error: 'SUBMISSION_REFUSED_ARCHIVED' });
  return;
}
if (error instanceof AppNotFoundError) {
  // The link verifies but its app definition no longer resolves: a dead
  // link, not a server fault (the builder surfaces map APP_NOT_FOUND to 404).
  res.status(404).json({ error: 'APP_NOT_FOUND' });
  return;
}
throw error;
```

Alternatively, decorate `ReadController` with `@UseFilters(new BuilderExceptionFilter())`
so every `BuilderError` status mapping applies on the read path too — but keep the explicit
`SubmissionRefusedError → 409` branch, since the read path renders that body shape itself.
(The exact denial reason/status is a contract-shape decision; the defect is that the state
is unhandled, not which literal is chosen.)

### WR-02: the Ctrl/Cmd+S publish shortcut bypasses the `saving` guard, firing concurrent `POST /apps/:id/publish`

**File:** `apps/app-builder/src/editor/EditorPage.tsx:364-374` (handler), `:331`/`:433` (guard)
**Severity:** WARNING

The publish button is guarded — `disabled={saving}` (`EditorPage.tsx:433`) — but the global
keydown handler calls the same callback with no guard at all:

```ts
// EditorPage.tsx:364-374
useEffect(() => {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isPublishShortcut(event)) {
      return;
    }
    event.preventDefault();
    void publish();          // ← no `saving` check, no in-flight ref
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}, [publish]);
```

`publish` (`:325-356`) sets `saving` but does not read it, and `setSaving(true)` is an
async state update, so two events in the same tick (a rapid double chord, or a held key
with `event.repeat`) both enter. Consequences, both observable:

1. **Draft app:** both requests can read `lifecycle === 'draft'` before either commits and
   both call `commitPublish`. `transition` (`app-definition.service.ts:416-447`) retries on
   the version race, then `AppLifecycle.assertTransition('published','published')` throws
   `LIFECYCLE_ILLEGAL_TRANSITION`. One request succeeds and the page shows the green
   "published" banner while the other's refusal is written into `saveError` — a success and
   an error rendered simultaneously.
2. **Already-published app:** every request appends an audit row
   (`publish.controller.ts:80-96` appends unconditionally for a published app), so one user
   action can write **two `app.published` / `zero_change: true`** rows to the AUD-01 trail —
   duplicate entries in a compliance artifact (3-year retention) for a single intent.

The handler also runs while the page is in its loading (`definition === null`, `:390`) or
`loadError` (`:378`) states — the effect is registered above the early returns — so Ctrl+S
on a failed-load editor still fires a publish for an app the user cannot see.

Note the concurrent-request mutation itself is *not* corrupting: `setLifecycle(...,
current.version)` is an optimistic-concurrency write with retry, so no duplicate version
numbers result. The defect is the defeated single-flight guard and its audit/UX fallout.

**Fix:** guard the shortcut with an in-flight ref so it shares the button's semantic
without re-registering the listener on every `saving` toggle:

```ts
const inFlight = useRef(false);

const publish = useCallback(async (): Promise<void> => {
  if (inFlight.current) return;   // single-flight, shared by button + shortcut
  inFlight.current = true;
  setSaveError(null);
  // ... unchanged ...
  } finally {
    setSaving(false);
    inFlight.current = false;
  }
}, [client, appId]);

const onKeyDown = (event: KeyboardEvent): void => {
  if (event.repeat || !isPublishShortcut(event)) return;
  event.preventDefault();
  void publish();
};
```

## Info

### IN-01: `const bootstrap` shadows the `bootstrap` function
**File:** `apps/api/src/main.ts:95`
**Issue:** `async function bootstrap()` (`:46`) is shadowed inside its own body by
`const bootstrap = new Logger('Bootstrap')` (`:95`). Legal (inner block scope) but the
name now means two different things three lines apart.
**Fix:** rename the logger, e.g. `const bootLog = new Logger('Bootstrap');`, and update the
two `bootstrap.warn(...)` call sites at `:99` and `:104`.

### IN-02: best-effort boot steps swallow provider-resolution failures as "deferred"

**File:** `apps/api/src/main.ts:96-105`
**Issue:** Both `try` blocks catch **all** errors and log `<step> deferred`. The comment
justifies this for "a Mongo that is unreachable at boot", but the same catch also swallows
`app.get(TemplateSeed)` resolution failures — a DI/wiring error — and reports it as a
transient deferral, leaving the process listening with a silently missing seeder.
**Fix:** narrow the intent — either check the failure class before deferring, or log at
`error` level with the stack so a wiring fault is distinguishable from an outage:

```ts
} catch (error) {
  bootLog.error(`template gallery seed (D-105) failed: ${String(error)}`);
}
```

### IN-03: `DatarouterModule` is dead code and now doubly inconsistent with the changed constructor

**File:** `packages/domain/src/datarouter/datarouter.module.ts:6-7`
**Issue:** A direct consequence of the reviewed change: `providers: [DataRouterService,
OutboxRepository]` declares `DataRouterService`, whose constructor now takes
`(MongoService, AppDefinitionService)`. Neither is available to that module (no imports),
and `MongoService` never was — so the module could not have resolved before the change
either. Grep confirms it is imported nowhere (`DatarouterModule` appears only in its own
file); production wiring is the explicit factory in `read.module.ts:211-217`.
**Fix:** delete `datarouter.module.ts`, or update it (`imports: [MongoModule]` plus the
builder export) so the next person to import it does not get a boot-time DI error.

### IN-04: `saveShortcutHint()` reads `navigator` during render

**File:** `apps/app-builder/src/editor/EditorPage.tsx:73-77` (called at `:439`)
**Issue:** A render-time read of `navigator.userAgent` with no guard. Correct in the
browser-only SPA today, but it is a module-level environment dependency evaluated on every
render; any future non-DOM render (SSR, or a test render without the `navigator` global)
throws `ReferenceError`.
**Fix:** guard and default: `typeof navigator !== 'undefined' &&
/Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘S' : 'Ctrl+S'`, or compute once outside the
component.

### IN-05: the `routeSubmission` guard has no production caller

**File:** `packages/domain/src/datarouter/data-router.service.ts:73`
**Issue:** The APP-06 guard placed in `routeSubmission` is exercised only by specs (grep:
the only references are `data-router.service.ts`, `data-router.spec.ts`,
`outbox.integration.spec.ts`). The chat-driven submission path that will call it is not yet
wired, so the acceptance criterion "an archived app accepts no new submissions" is today
proven in production only on the edit path (`routeEdit`). If the future caller ever writes
a revision through anything other than this seam, the guard is bypassed — as it stands
there is exactly one writer of `submission_revisions` (this service), so the invariant
holds.
**Fix:** no code change required now; keep the seam as the sole writer and assert it when
the chat-submission path lands (an integration test that goes through the real HTTP entry
point, in the shape of `app-definition.integration.spec.ts`'s "APP-06 both ways").

---

_Reviewed: 2026-10-14T02:45:50Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
