# Phase 06: Code Review Disposition

Review: `06-REVIEW.md` (2026-10-12T22:34:18Z, standard depth, 187 files, 8 findings:
1 critical, 1 high, 3 medium, 2 low, 1 info). Fix bundle: commit `70feac29`
(`fix(06): address phase code-review findings CR-01..LO-02`), verified by
`npm run build` (lint + `tsc -b`) exit 0 and 35 spec files / 275 tests green
across `packages/domain` (builder, acl, authz, identity) and `apps/api`
(auth, users, app-builder, submissions, read).

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| CR-01 | critical | fixed | 70feac29 — `assertOwner(appId, actor)` in `AppDefinitionService` (fail-closed `AppNotFoundError`, the 404-not-403 owner-scoping convention), wired into `updateSection`, the shared `transition` (covering `commitPublish`/`deprecate`/`archive`, once before the retry loop) and `rollback`. Two non-owner refusal specs prove the gate (T-06-27): the refusal writes nothing — no version bump, no audit row, no lifecycle move. The `@casl/ability` `PermissionGuard` wiring stays plan-07 work (per the codebase's own module comments: "The @casl/ability rule set lands in plan 07"); the service-boundary gate is the authoritative enforcement and closes the bypass. |
| HI-01 | high | fixed | 70feac29 — `GET /apps/:id` now resolves through `findByAppIdForOwner`; a non-owner gets the same 404 as a missing app, matching the list endpoint's owner scoping and the publish surface's check. |
| MD-01 | medium | fixed | 70feac29 — `GET /users/search?q=` implemented on the global-admin identity surface (name-or-email prefix, case-insensitive, cap 50, `400 QUERY_REQUIRED` naming `q`). The IdP profile-scope `name` claim is plumbed end-to-end (stub `stub_name` → ID token claim → D-104 provisioner → `Profile.name`). New `user-search.integration.spec.ts` asserts over real HTTP + stub issuer: prefix match by name and by email, case-insensitivity, empty result, 400 missing/blank `q`, 403 non-admin. The e2e `page.route` stub in `roles.spec.ts` now backs a real endpoint. |
| MD-02 | medium | fixed | 70feac29 — single-flight renewal via `BuilderSessionStore.renewLock` (`SET key '1' PX 10000 NX`): the read-refresh-extend sequence is serialized per session, lock losers proceed on the current record instead of firing a competing refresh grant against the rotated token, and the extended TTL is computed from a post-grant `renewedAt` clock. |
| MD-03 | medium | fixed | 70feac29 — CSP `script-src 'self'` response-header middleware in the api bootstrap (`apps/api/src/main.ts`). No new dependency: every bundle ships from npm (no CDN, no remote script anywhere in the tree), so `'self'` is the complete allowlist, and the header rides every response the same-origin API serves, including the SPA surface the deployment serves from it (D-103). |
| LO-01 | low | fixed | 70feac29 — `approve()` now resolves the request record first (the guarded `transition` — the conditional that fails a concurrent second approval with `TRANSFER_ILLEGAL_TRANSITION`), then moves ownership, then appends the audit row. The double-approval window is closed by the atomic record transition. |
| LO-02 | low | fixed | 70feac29 — `escapeHtmlAttribute` (`&`, `"`, `<`, `>`) applied to the tooltip before the `data-tooltip` attribute interpolation in `bootstrap5Templates.ts`; a quote-bearing tooltip can no longer break out of the attribute. |
| IN-01 | info | deferred | Systemic Phase 1/2 identity-layer state, not a Phase 6 regression: the in-memory `IdentityMappingRepository`/`ProfileRepository` predate this phase (the OTP state machine is correctly Redis-backed, so IDN-05 policy invariants are unaffected), and SSO mappings are Mongo-backed (06-02). Closing it means reworking the identity layer across phases — recorded here as a tracked deferral for the identity-multi-instance plan, preserving the `deactivated_at` tombstone semantics in `findByChat`/`findByEmail`/`findAllByEmail`. |

## Notes

- The fix bundle also closes the `tsc -b` errors the plan-level verifiers never
  ran (each plan's verify command ran scoped vitest/playwright, not the root
  build): `FieldMappingRecord` endpoint return types, the owner-scoped
  `assertOwner` return narrowing, `SubmissionListFilter` as the internal filter
  shape, the status-projection input's index signature, the transfer document's
  Mongo `_id`, the transfer service's audit import path, the `@akane/cli`
  provision subpath export (wired through an apps/api project reference), and
  the ambient express `Response` surface (`setHeader`/`send`).
- `npm run build` (lint + `tsc -b`) is the gate that caught them; plan-level
  verification should run it.
