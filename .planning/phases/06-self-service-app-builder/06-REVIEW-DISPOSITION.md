---
phase: 06
review: 06-REVIEW.md
titles: json
findings:
  - id: WR-01
    severity: warning
    disposition: open
    title: "`editPost` maps only `SubmissionRefusedError`; the same new guard can also throw `AppNotFoundError` → 500"
  - id: WR-02
    severity: warning
    disposition: open
    title: "the Ctrl/Cmd+S publish shortcut bypasses the `saving` guard, firing concurrent `POST /apps/:id/publish`"
  - id: IN-01
    severity: info
    disposition: open
    title: "`const bootstrap` shadows the `bootstrap` function"
  - id: IN-02
    severity: info
    disposition: open
    title: "best-effort boot steps swallow provider-resolution failures as \"deferred\""
  - id: IN-03
    severity: info
    disposition: open
    title: "`DatarouterModule` is dead code and now doubly inconsistent with the changed constructor"
  - id: IN-04
    severity: info
    disposition: open
    title: "`saveShortcutHint()` reads `navigator` during render"
  - id: IN-05
    severity: info
    disposition: open
    title: "the `routeSubmission` guard has no production caller"
  - id: HI-01
    severity: high
    disposition: fixed
    title: "`GET /apps/:id` serves any app's full definition to any authenticated user"
  - id: MD-01
    severity: medium
    disposition: fixed
    title: "`GET /users/search` does not exist — role-assignment user resolution is broken against the real API"
  - id: MD-02
    severity: medium
    disposition: fixed
    title: "Session renewal race — concurrent requests inside the renewal window fire competing refresh grants"
  - id: MD-03
    severity: medium
    disposition: fixed
    title: "No Content-Security-Policy anywhere — the CSP posture promised by T-06-01 and the research record is absent"
  - id: LO-01
    severity: low
    disposition: fixed
    title: "Transfer approval moves ownership before the request record resolves — partial-failure and double-approval window"
  - id: LO-02
    severity: low
    disposition: fixed
    title: "Admin-authored tooltip interpolated unescaped into an HTML attribute"
  - id: CR-01
    severity: critical
    disposition: fixed
    title: "Any authenticated user can edit, deprecate, or archive any app — owner authorization is absent on three mutation routes"
  - id: IN-01
    severity: info
    disposition: deferred
    title: "`IdentityMappingRepository` is an in-memory array — SSO mappings and OTP-onboarding results do not survive restarts or span instances"
open: 7
total: 15
recorded: 2026-10-14T02:51:55.421Z
---

# Phase 06: Code Review Disposition

Per-finding disposition for `06-REVIEW.md`. Two review generations are recorded here:
the original 2026-10-12 review (187 files) and the incremental re-review of
2026-10-14 (the 21 files changed since `900f6529`, per the #3661 incremental scoping).

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| WR-01 | warning | open | - |
| WR-02 | warning | open | - |
| IN-01 | info | open | - |
| IN-02 | info | open | - |
| IN-03 | info | open | - |
| IN-04 | info | open | - |
| IN-05 | info | open | - |
| HI-01 | high | fixed | 70feac29 — `GET /apps/:id` now resolves through `findByAppIdForOwner`; a non-owner gets the same 404 as a missing app, matching the list endpoint's owner scoping and the publish surface's check. |
| MD-01 | medium | fixed | 70feac29 — `GET /users/search?q=` implemented on the global-admin identity surface (name-or-email prefix, case-insensitive, cap 50, `400 QUERY_REQUIRED` naming `q`). The IdP profile-scope `name` claim is plumbed end-to-end (stub `stub_name` → ID token claim → D-104 provisioner → `Profile.name`). New `user-search.integration.spec.ts` asserts over real HTTP + stub issuer: prefix match by name and by email, case-insensitivity, empty result, 400 missing/blank `q`, 403 non-admin. The e2e `page.route` stub in `roles.spec.ts` now backs a real endpoint. |
| MD-02 | medium | fixed | 70feac29 — single-flight renewal via `BuilderSessionStore.renewLock` (`SET key '1' PX 10000 NX`): the read-refresh-extend sequence is serialized per session, lock losers proceed on the current record instead of firing a competing refresh grant against the rotated token, and the extended TTL is computed from a post-grant `renewedAt` clock. |
| MD-03 | medium | fixed | 70feac29 — CSP `script-src 'self'` response-header middleware in the api bootstrap (`apps/api/src/main.ts`). No new dependency: every bundle ships from npm (no CDN, no remote script anywhere in the tree), so `'self'` is the complete allowlist, and the header rides every response the same-origin API serves, including the SPA surface the deployment serves from it (D-103). |
| LO-01 | low | fixed | 70feac29 — `approve()` now resolves the request record first (the guarded `transition` — the conditional that fails a concurrent second approval with `TRANSFER_ILLEGAL_TRANSITION`), then moves ownership, then appends the audit row. The double-approval window is closed by the atomic record transition. |
| LO-02 | low | fixed | 70feac29 — `escapeHtmlAttribute` (`&`, `"`, `<`, `>`) applied to the tooltip before the `data-tooltip` attribute interpolation in `bootstrap5Templates.ts`; a quote-bearing tooltip can no longer break out of the attribute. |
| CR-01 | critical | fixed | 70feac29 — `assertOwner(appId, actor)` in `AppDefinitionService` (fail-closed `AppNotFoundError`, the 404-not-403 owner-scoping convention), wired into `updateSection`, the shared `transition` (covering `commitPublish`/`deprecate`/`archive`, once before the retry loop) and `rollback`. Two non-owner refusal specs prove the gate (T-06-27): the refusal writes nothing — no version bump, no audit row, no lifecycle move. The `@casl/ability` `PermissionGuard` wiring stays plan-07 work (per the codebase's own module comments: "The @casl/ability rule set lands in plan 07"); the service-boundary gate is the authoritative enforcement and closes the bypass. |
| IN-01 | info | deferred | Systemic Phase 1/2 identity-layer state, not a Phase 6 regression: the in-memory `IdentityMappingRepository`/`ProfileRepository` predate this phase (the OTP state machine is correctly Redis-backed, so IDN-05 policy invariants are unaffected), and SSO mappings are Mongo-backed (06-02). Closing it means reworking the identity layer across phases — recorded here as a tracked deferral for the identity-multi-instance plan, preserving the `deactivated_at` tombstone semantics in `findByChat`/`findByEmail`/`findAllByEmail`. |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved.

## Notes — reconciliation of the 2026-10-14 run

- **Incremental scope.** The re-review covered the 21 files changed since `900f6529`; findings are
  reported only against that delta. `WR-01` and `WR-02` are new, untriaged, and advisory — the
  code-review gate never blocks.
- **Restored rows.** The 2026-10-12 review numbered its findings by severity (`CR`/`HI`/`MD`/`LO`/`IN`).
  The gate's reconciler matches only the closed prefix alternation `CR|BL|WR|IN`, so the six
  `HI`/`MD`/`LO` rows were invisible to it and were dropped in `aa0c18bc` with no diagnostic (its
  shortfall check compares the *review's* totals, not the ledger's). They are restored here
  verbatim from `aa0c18bc^`. A future automated run will drop them again until that palette is widened.
- **`IN-01` id collision.** The current review's `IN-01` (`const bootstrap` shadowing) is a different
  finding from the 2026-10-12 review's `IN-01` (in-memory identity repositories). Because the old
  ledger carried no frontmatter titles, the reconciler inherited the old row's `deferred` decision
  onto the new finding; that is corrected — the current `IN-01` is `open`, and the 2026-10-12 `IN-01`
  is carried as the final row above. Two rows share the id by construction; the reconciler cannot
  carry one while the other is present.

## Fix bundle

`70feac29` (`fix(06): address phase code-review findings CR-01..LO-02`) — verified by
`npm run build` (lint + `tsc -b`) exit 0 and 35 spec files / 275 tests green across
`packages/domain` (builder, acl, authz, identity) and `apps/api`
(auth, users, app-builder, submissions, read). All eight 2026-10-12 findings are closed:
seven `fixed`, one (`IN-01`) `deferred` as pre-existing Phase 1/2 state, not a Phase 6 regression.
