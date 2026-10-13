---
phase: 06-self-service-app-builder
reviewed: 2026-10-12T22:34:18Z
depth: standard
files_reviewed: 187
files_reviewed_list:
  - .env.example
  - .gitignore
  - README.md
  - apps/api/src/app-builder/app-builder.controller.ts
  - apps/api/src/app-builder/app-builder.module.spec.ts
  - apps/api/src/app-builder/app-builder.module.ts
  - apps/api/src/app-builder/app-definition.integration.spec.ts
  - apps/api/src/app-builder/connector-request.controller.ts
  - apps/api/src/app-builder/connector-request.integration.spec.ts
  - apps/api/src/app-builder/publish.controller.ts
  - apps/api/src/app-builder/publish.integration.spec.ts
  - apps/api/src/app-builder/transfer-approval.controller.ts
  - apps/api/src/app-builder/transfer-request.controller.ts
  - apps/api/src/app-builder/transfer.integration.spec.ts
  - apps/api/src/app.module.ts
  - apps/api/src/audit/audit.controller.ts
  - apps/api/src/audit/audit.integration.spec.ts
  - apps/api/src/audit/audit.module.ts
  - apps/api/src/auth/auth.controller.ts
  - apps/api/src/auth/auth.module.spec.ts
  - apps/api/src/auth/auth.module.ts
  - apps/api/src/auth/auth.session.integration.spec.ts
  - apps/api/src/auth/oidc-issuer.stub.ts
  - apps/api/src/auth/oidc.service.ts
  - apps/api/src/auth/session.middleware.ts
  - apps/api/src/identity/identity.module.ts
  - apps/api/src/main.ts
  - apps/api/src/read/read.module.spec.ts
  - apps/api/src/read/read.module.ts
  - apps/api/src/submissions/submission-export.service.spec.ts
  - apps/api/src/submissions/submission-export.service.ts
  - apps/api/src/submissions/submissions.controller.ts
  - apps/api/src/submissions/submissions.integration.spec.ts
  - apps/api/src/submissions/submissions.module.ts
  - apps/api/src/submissions/viewer-row.ts
  - apps/api/src/types/express.d.ts
  - apps/api/src/users/sso-mapping.integration.spec.ts
  - apps/api/src/users/users.controller.ts
  - apps/api/src/users/users.module.spec.ts
  - apps/api/src/users/users.module.ts
  - apps/app-builder/e2e/connectors.spec.ts
  - apps/app-builder/e2e/dashboard.spec.ts
  - apps/app-builder/e2e/designer.spec.ts
  - apps/app-builder/e2e/editor.spec.ts
  - apps/app-builder/e2e/roles.spec.ts
  - apps/app-builder/e2e/s1-spike.spec.ts
  - apps/app-builder/e2e/submissions.spec.ts
  - apps/app-builder/e2e/wizard.spec.ts
  - apps/app-builder/index.html
  - apps/app-builder/src/App.tsx
  - apps/app-builder/src/api/audit.ts
  - apps/app-builder/src/api/client.ts
  - apps/app-builder/src/api/connectors.ts
  - apps/app-builder/src/api/definition.ts
  - apps/app-builder/src/api/submissions.ts
  - apps/app-builder/src/api/templates.ts
  - apps/app-builder/src/api/transfer.ts
  - apps/app-builder/src/api/users.ts
  - apps/app-builder/src/apiHooks.ts
  - apps/app-builder/src/apps/AppsPage.tsx
  - apps/app-builder/src/apps/TagFilter.tsx
  - apps/app-builder/src/audit/AuditPage.tsx
  - apps/app-builder/src/auth/oidc-redirect.ts
  - apps/app-builder/src/auth/session.client.spec.ts
  - apps/app-builder/src/auth/session.client.ts
  - apps/app-builder/src/chrome.css
  - apps/app-builder/src/connectors/ConnectorRequestForm.tsx
  - apps/app-builder/src/connectors/ConnectorsPage.tsx
  - apps/app-builder/src/dashboard/DashboardPage.tsx
  - apps/app-builder/src/editor/AppTabs.tsx
  - apps/app-builder/src/editor/EditorPage.tsx
  - apps/app-builder/src/error/InlineError.tsx
  - apps/app-builder/src/form-designer/FormDesignerPage.tsx
  - apps/app-builder/src/form-designer/FormioBuilderField.tsx
  - apps/app-builder/src/form-designer/PreviewPane.tsx
  - apps/app-builder/src/form-designer/bootstrap5Templates.ts
  - apps/app-builder/src/form-designer/representativeSchema.ts
  - apps/app-builder/src/form-designer/sandbox.spec.ts
  - apps/app-builder/src/form-designer/sandbox.ts
  - apps/app-builder/src/form-designer/undoHistory.spec.ts
  - apps/app-builder/src/form-designer/undoHistory.ts
  - apps/app-builder/src/main.browser.ts
  - apps/app-builder/src/roles/PermissionMatrix.tsx
  - apps/app-builder/src/roles/RolesPage.tsx
  - apps/app-builder/src/roles/UserAutocomplete.tsx
  - apps/app-builder/src/sections.ts
  - apps/app-builder/src/settings/SettingsPage.tsx
  - apps/app-builder/src/submissions/SubmissionDetailDrawer.tsx
  - apps/app-builder/src/submissions/SubmissionsPage.tsx
  - apps/app-builder/src/tokens.css
  - apps/app-builder/src/ui/ScopedAppPicker.tsx
  - apps/app-builder/src/ui/Skeleton.tsx
  - apps/app-builder/src/users/UsersPage.tsx
  - apps/app-builder/src/wizard/BasicsStep.tsx
  - apps/app-builder/src/wizard/FormStep.tsx
  - apps/app-builder/src/wizard/RbacStep.tsx
  - apps/app-builder/src/wizard/RoutingStep.tsx
  - apps/app-builder/src/wizard/TriggersStep.tsx
  - apps/app-builder/src/wizard/WizardPage.tsx
  - apps/app-builder/tsconfig.json
  - apps/app-builder/vite.config.ts
  - apps/scheduler/src/app.module.ts
  - apps/scheduler/src/transfer-auto-cancel.registration.ts
  - apps/worker/src/app.module.ts
  - apps/worker/src/processors/inbound-event.processor.spec.ts
  - apps/worker/src/processors/inbound-event.processor.ts
  - apps/worker/src/processors/otp-delivery.service.ts
  - apps/worker/src/processors/otp-onboarding.integration.spec.ts
  - apps/worker/src/processors/transfer-auto-cancel.processor.spec.ts
  - apps/worker/src/processors/transfer-auto-cancel.processor.ts
  - apps/worker/src/worker.module.ts
  - eslint.config.mjs
  - package-lock.json
  - package.json
  - packages/cli/provision.connector-requests.spec.ts
  - packages/cli/provision.ts
  - packages/contract/src/acl/transfer.contract.ts
  - packages/contract/src/auth/session.contract.ts
  - packages/contract/src/builder/app-definition.contract.ts
  - packages/contract/src/builder/connector-request.contract.ts
  - packages/contract/src/builder/field-mapping.contract.ts
  - packages/contract/src/builder/publish.contract.ts
  - packages/contract/src/identity/otp.contract.ts
  - packages/contract/src/index.ts
  - packages/contract/src/submissions/submissions.contract.ts
  - packages/domain/src/acl/transfer-request.document.ts
  - packages/domain/src/acl/transfer-request.errors.ts
  - packages/domain/src/acl/transfer-request.repository.spec.ts
  - packages/domain/src/acl/transfer-request.repository.ts
  - packages/domain/src/acl/transfer-request.service.spec.ts
  - packages/domain/src/acl/transfer-request.service.ts
  - packages/domain/src/authz/builder-ability.spec.ts
  - packages/domain/src/authz/builder-ability.ts
  - packages/domain/src/builder/app-definition.service.spec.ts
  - packages/domain/src/builder/app-definition.service.ts
  - packages/domain/src/builder/app-definition.versions.spec.ts
  - packages/domain/src/builder/app-lifecycle.spec.ts
  - packages/domain/src/builder/app-lifecycle.ts
  - packages/domain/src/builder/connector-request/connector-request.document.ts
  - packages/domain/src/builder/connector-request/connector-request.errors.ts
  - packages/domain/src/builder/connector-request/connector-request.repository.spec.ts
  - packages/domain/src/builder/connector-request/connector-request.repository.ts
  - packages/domain/src/builder/connector-request/connector-request.service.spec.ts
  - packages/domain/src/builder/connector-request/connector-request.service.ts
  - packages/domain/src/builder/data-access/app-definition.repository.ts
  - packages/domain/src/builder/data-routing/field-mapping.service.spec.ts
  - packages/domain/src/builder/data-routing/field-mapping.service.ts
  - packages/domain/src/builder/publish-gate.service.spec.ts
  - packages/domain/src/builder/publish-gate.service.ts
  - packages/domain/src/builder/routing-share/routing-outcome.repository.spec.ts
  - packages/domain/src/builder/routing-share/routing-outcome.repository.ts
  - packages/domain/src/builder/routing-share/routing-share.computer.spec.ts
  - packages/domain/src/builder/routing-share/routing-share.computer.ts
  - packages/domain/src/builder/routing-share/routing-share.metrics.spec.ts
  - packages/domain/src/builder/routing-share/routing-share.metrics.ts
  - packages/domain/src/builder/saved-query.backfill.ts
  - packages/domain/src/builder/saved-query.repository.spec.ts
  - packages/domain/src/builder/saved-query.repository.ts
  - packages/domain/src/builder/template/seeds/asset-request.json
  - packages/domain/src/builder/template/seeds/crm-contact.json
  - packages/domain/src/builder/template/seeds/expense-report.json
  - packages/domain/src/builder/template/seeds/facilities-request.json
  - packages/domain/src/builder/template/seeds/hr-request.json
  - packages/domain/src/builder/template/seeds/it-helpdesk-ticket.json
  - packages/domain/src/builder/template/seeds/leave-request.json
  - packages/domain/src/builder/template/seeds/procurement-request.json
  - packages/domain/src/builder/template/seeds/redmine-issue.json
  - packages/domain/src/builder/template/seeds/travel-request.json
  - packages/domain/src/builder/template/tag-set.ts
  - packages/domain/src/builder/template/template.seed.ts
  - packages/domain/src/builder/template/template.spec.ts
  - packages/domain/src/decision/published-app-loader.ts
  - packages/domain/src/identity/identity-mapping.repository.ts
  - packages/domain/src/identity/oidc-provision.service.spec.ts
  - packages/domain/src/identity/oidc-provision.service.ts
  - packages/domain/src/identity/otp/otp-delivery.port.ts
  - packages/domain/src/identity/otp/otp-onboarding.service.ts
  - packages/domain/src/identity/otp/otp-state-machine.spec.ts
  - packages/domain/src/identity/otp/otp-state-machine.ts
  - packages/domain/src/identity/sso-mapping.service.spec.ts
  - packages/domain/src/identity/sso-mapping.service.ts
  - packages/domain/src/index.ts
  - packages/domain/src/submissions/submission.repository.ts
  - playwright.config.ts
  - tooling/boundaries.config.mjs
  - tooling/entrypoint-drift.spec.ts
  - vitest.config.mts
findings:
  critical: 1
  high: 1
  medium: 3
  low: 2
  info: 1
  total: 8
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-10-12T22:34:18Z
**Depth:** standard
**Files Reviewed:** 187
**Status:** issues_found

## Summary

Reviewed the 187 files of Phase 06 (Self-Service App Builder) across `apps/api`, `apps/app-builder`, `apps/worker`, `apps/scheduler`, `packages/domain`, `packages/contract`, and `packages/cli`.

Verified as correctly implemented (not reported): D-101 session posture (`__Host-` httpOnly/Secure/SameSite=Strict cookie, SPA holds no token, no OIDC sub/PII in own JWTs); D-98/D-100 credential isolation (no credential value in connector-request docs, operator write via `ConnectorCredentialsRepository.upsert` after `assertKeyProviderAllowed`); IDN-05 OTP policy (10-min TTL, 3 attempts, 30-min lockout armed on 3rd failure, single-use tombstone, Lua-atomic state machine, per-chatUserId keying gives cross-identity refusal); ACL-10/BLD-11 publish gate ordering (gate evaluated before `commitPublish`; `orchestrator.route` is pure computation); APP-07/APP-08 (`routing_share` computed over the labelled intent set with an UNLABELLED sentinel, never raw question text; exact 5.00/5.01 boundary); FormIO builder mount invariants (guarded dynamic import only, container-as-leaf, restore via `builder.setForm` with restore lock).

The phase ships one critical authorization bypass: the mutation routes `PATCH /apps/:id`, `POST /apps/:id/deprecate`, and `POST /apps/:id/archive` have no owner check at any layer, and the @casl/ability rule set that the threat model requires is never wired to any route — the only guard that exists is a stub that always returns true. Publish, transfer, connector-request, submissions, and field-mapping surfaces all enforce ownership correctly, which makes the gap a cluster of omissions, not a design choice.

## Critical Issues

### CR-01: Any authenticated user can edit, deprecate, or archive any app — owner authorization is absent on three mutation routes

**File:** `apps/api/src/app-builder/app-builder.controller.ts:171-216` (routes); `packages/domain/src/builder/app-definition.service.ts:127-239` (service); `packages/domain/src/builder/data-access/app-definition.repository.ts:259-318` (repository); `apps/api/src/common/guards/permission.guard.ts:7-13` (stub guard); `packages/domain/src/authz/builder-ability.ts` (unwired rules)

**Issue:** The three app-mutation routes resolve the actor via `actorOf(req)` but never compare it to the app's owner:

- Controller (`app-builder.controller.ts:171-188` PATCH, `:191-205` deprecate, `:208-216` archive): no `findByAppId` + `createdBy !== actor` check — unlike `publish.controller.ts:62-67`, which does exactly that and 404s non-owners.
- Service (`app-definition.service.ts:127-170` `updateSection`, `:211-228` `deprecate`, `:237-239` `archive`): the `actor` parameter is used only as the audit-log actor (`audit.append` at `:157-165`); it never participates in an authorization decision.
- Repository (`app-definition.repository.ts:259-282` `updateSection`, `:291-318` `setLifecycle`): writes filter on `{ app_id, version }` only — no `createdBy` in the filter, so a non-owner's write matches and commits.

The phase's own threat model makes this a violated obligation, not a style gap — T-06-27 (`06-07-PLAN.md:213`): *"Every app-builder route passes through the session middleware's `request.user.realUserId` and the per-app @casl/ability check; a spec proves a non-owner's PATCH is 403 with the missing-permission name (ACL-09)."* No such spec exists, and the per-app check is missing.

The @casl/ability rule set (`packages/domain/src/authz/builder-ability.ts` — the ACL-10/BLD-11 role matrix) is dead code: a grep across `apps/` finds zero references to `createBuilderAbility` or `PermissionGuard` outside the guard's own file. `PermissionGuard` (`permission.guard.ts:10-12`) is a stub whose `canActivate` unconditionally `return true`, and it is applied to no route.

Impact is full RBAC compromise of any app: `PATCH` accepts `section: 'role_assignments'` (one of the twelve `SectionName` values confined by `applySectionPatch`), so a non-owner can rewrite any app's role assignments — including granting themselves `manage` — then deprecate or archive the app (archive is terminal: submissions refused, APP-06). The audit trail faithfully records the attacker's `realUserId` as the actor, so the tamper is auditable but unprevented. Secondary defect: `actorOf` (`app-builder.controller.ts:267-270`) falls back to `'anonymous'` when the middleware attached no user, so even attribution silently degrades instead of failing closed.

**Fix:** Enforce ownership at the service boundary (fail-closed, 404-not-403 per the phase's owner-scoping convention):

```ts
// app-definition.service.ts — shared guard for all owner-scoped mutations
async assertOwner(appId: string, actor: string): Promise<AppDefinitionDocument> {
  const definition = await this.repository.findByAppId(appId);
  if (definition === null || definition.createdBy !== actor) {
    throw new AppNotFoundError(appId); // 404, never 403 (owner-scoping convention)
  }
  return definition;
}
```

Call it at the top of `updateSection`, `deprecate`, and `archive` (and inside `commitPublish`'s `transition` path for defense in depth). Wire the real authorization: implement `PermissionGuard.canActivate` to resolve the route's section/action and evaluate `createBuilderAbility(req.user)` against it, then apply `@UseGuards(PermissionGuard)` to the app-builder routes — fulfilling T-06-27. Replace the `'anonymous'` fallback with a thrown `UnauthorizedException` so a missing session identity can never be attributed as an actor. Add the T-06-27 spec: a non-owner's PATCH returns 403/404 with the named permission.

## High Issues

### HI-01: `GET /apps/:id` serves any app's full definition to any authenticated user

**File:** `apps/api/src/app-builder/app-builder.controller.ts:105-114`

**Issue:** The single-app read takes no `@Req()` at all — it looks up by `app_id` and returns the complete definition (`triggers`, `role_assignments`, `routing_config`, `field_mapping`, connector wiring) to any authenticated caller. The list endpoint immediately below (`GET /apps`, `:117-123`) is owner-scoped via `listByOwner(actorOf(req))`, so the leak is an inconsistency, not a design choice. A non-owner can enumerate app IDs (they are caller-chosen slug-style IDs) and read every other builder's RBAC matrix, trigger configuration, and routing config — the inputs to the publish gate and the routing-share computation. T-06-29's principle ("returns only display fields … to the requesting owner") is violated in spirit for this surface.

**Fix:** Apply the same owner check as publish (`app-builder.controller.ts:62-67`): fetch, then `if (definition === null || definition.createdBy !== actor) throw new NotFoundException(errorBody('APP_NOT_FOUND', ...))`. If a cross-owner read is ever needed (e.g., a global-admin surface), gate it on `req.user.role === 'global-admin'` explicitly rather than leaving it open.

## Medium Issues

### MD-01: `GET /users/search` does not exist — role-assignment user resolution is broken against the real API

**File:** `apps/app-builder/src/roles/UserAutocomplete.tsx:79`; `apps/app-builder/src/api/users.ts:14,25`; `apps/api/src/users/users.controller.ts:34-136`

**Issue:** The SPA compiles against `GET /users/search?q=<prefix>` (called at `UserAutocomplete.tsx:79`, typed at `api/users.ts:14,25`), but `UsersController` exposes only `POST /users/sso-mappings` and `GET /users/sso-mappings` — no `/users/search` route exists anywhere in `apps/api`. Every role-assignment user lookup in the real App Builder 404s. The deferral is documented: `06-07-SUMMARY.md:68` recorded the endpoint as owned by plan 06-08, which never delivered it, and `e2e/roles.spec.ts:145` masks the gap with a `page.route('**/api/users/search**')` stub — so the e2e suite passes while the real flow is broken.

**Fix:** Implement `GET /users/search?q=` in `UsersController` as an identity-directory prefix search over name/email returning display fields only (name, email — per T-06-29), owner-scoped and rate-limited per NFR-SEC-6; or, if the directory is not available in this phase, repoint `UserAutocomplete` to a real endpoint and drop the e2e stub so the suite fails loudly next time.

### MD-02: Session renewal race — concurrent requests inside the renewal window fire competing refresh grants

**File:** `apps/api/src/auth/session.middleware.ts:124-144`

**Issue:** Every request arriving inside the renewal window (`remaining < lifetime * RENEWAL_FRACTION`, i.e. <50% of IdP session lifetime left) performs a full refresh-token grant (`refreshAuthenticated`, `:133`) with the same server-stored refresh token. Under normal browser concurrency (parallel fetches, prefetched navigations), two requests race: the IdP rotates the refresh token on first use, so the loser's grant fails and the middleware answers `401 SESSION_EXPIRED` (`:134-136`) — a spurious forced re-login for a live session. Two secondary defects: `extend` (`:138`) is a non-atomic read-modify-write on the Redis session record (concurrent renewals can resurrect an older `idpSessionExp`), and `now` (`:116`) is captured before the refresh round-trip, so the TTL passed to `extend` (`:141`, `renewed.idpSessionExp - now`) slightly overstates the remaining lifetime.

**Fix:** Single-flight the renewal per session — e.g. a Redis `SET key NX PX` lock (or a per-process mutex keyed by sessionId) held across the read-refresh-extend sequence, with losers re-reading the session instead of refreshing. Alternatively, tolerate in-window refresh failure by falling back to the existing session until the IdP session truly expires (the `:117` check already covers that), reserving `SESSION_EXPIRED` for a genuinely dead IdP session. Compute the TTL from a post-refresh timestamp.

### MD-03: No Content-Security-Policy anywhere — the CSP posture promised by T-06-01 and the research record is absent

**File:** `apps/app-builder/index.html:1-32` (no CSP meta); `apps/api/src/main.ts` (no helmet/CSP header); confirmed by zero matches for `Content-Security-Policy|contentSecurityPolicy|CSP` across `apps/`

**Issue:** The phase's threat model and research record both commit to a CSP: T-06-01 (`06-01-PLAN.md:210`) — *"the SPA enforces the mockup-derived CSP posture (script-src 'self' per FRM-07's renderer precedent)"* — and `06-RESEARCH.md:926` names *"CSP on the SPA (`default-src 'self'; script-src 'self'`)"* as the control for XSS exfiltration of the builder session. Neither exists: `index.html` (all 32 lines) carries no CSP meta, and the API sets no CSP header. The FormIO surface (`FormioBuilderField.tsx`) renders owner-authored component schemas (T-06-28's attack surface); D-101 (httpOnly cookie, no SPA token) holds, but CSP was the second named exfiltration control and it is missing, so a schema-driven XSS in the builder origin would run with no script-source restriction.

**Fix:** Add a CSP meta to `apps/app-builder/index.html` matching the promised posture (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'` — `'unsafe-inline'` for styles only if the FormIO runtime requires it, otherwise drop it), and/or enforce via `helmet.contentSecurityPolicy` on the SPA-serving path. Keep `connect.googleapis.com`/`connect.gstatic.com` allowlisted for the font pipeline already present in `index.html:21-26`, and `data:` for the inline SVG favicon (`:12`). Add a spec asserting the header/meta is present.

## Low Issues

### LO-01: Transfer approval moves ownership before the request record resolves — partial-failure and double-approval window

**File:** `packages/domain/src/acl/transfer-request.service.ts:150-186`

**Issue:** `approve()` calls `definitions.transferOwnership` (`:162-165`) **before** `repository.transition(transferId, 'approved')` (`:167-170`). A failure or crash between the two leaves ownership already moved while the transfer record stays `pending` — and the audit row (`:175-183`) is never written. Concurrent double-approval is also possible: two approvals both pass `assertPending` (`:156`) and both execute `transferOwnership`; the record's conditional transition may then fail for one, but the ownership move has already happened twice with no reconciliation. The method's own doc comment (`:158-161`) claims ownership moves "in the same transition that resolves the request" — the code does not deliver that atomicity.

**Fix:** Reverse the order — transition the record first with a state-guarded conditional update (`transition` must match `status: 'pending'` atomically, failing the second approver with `TRANSFER_ILLEGAL_TRANSITION`), then `transferOwnership`, then audit. If the store supports it, wrap the pair in a transaction; otherwise make `transferOwnership` itself idempotent-guarded on the expected `from_user_id` so a replay is a no-op.

### LO-02: Admin-authored tooltip interpolated unescaped into an HTML attribute

**File:** `apps/app-builder/src/form-designer/bootstrap5Templates.ts:101`

**Issue:** `data-tooltip="${ctx.component.tooltip}"` interpolates the component's tooltip directly into an attribute value with no escaping. A tooltip containing a double quote (e.g. `" onmouseover="…`) breaks out of the attribute. Input is owner-authored FormIO schema content (the BLD-02 form tab), so the blast radius is the builder admin origin — an attribute-breakout vector rather than a stored-XSS from untrusted end users, but the FormIO surface is exactly the T-06-28 concern. The file is a faithful port of the 4.x-era template, which is why the defect is low, not medium.

**Fix:** HTML-escape the attribute value (`&`, `"`, `<`, `>` — minimally `&` and `"`) before interpolation, or build the element via DOM and use `setAttribute('data-tooltip', ...)`, which escapes by construction. Add a template test with a `"`-bearing tooltip asserting the output contains no breakout.

## Info

### IN-01: `IdentityMappingRepository` is an in-memory array — SSO mappings and OTP-onboarding results do not survive restarts or span instances

**File:** `packages/domain/src/identity/identity-mapping.repository.ts:10`

**Issue:** `private mappings: IdentityMapping[] = []` — every SSO identity mapping (and the OTP-onboarding result that creates one) lives only in process memory. A restart wipes the identity directory (all users must re-onboard), and a multi-instance deployment silently partitions mappings per pod. This is a documented deferral to a later plan (the OTP state machine itself is correctly Redis-backed with Lua scripts, so the IDN-05 policy invariants are unaffected), but it bounds the deployment topology until closed.

**Fix:** When the identity surface becomes multi-instance, back the repository with the existing Redis client (or Mongo) keyed on `(platform, chat_user_id)`, preserving the `deactivated_at` tombstone semantics in `findByChat`/`findByEmail`/`findAllByEmail`.

---

_Reviewed: 2026-10-12T22:34:18Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
