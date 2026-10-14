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
    disposition: deferred
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
  - id: CR-01
    severity: critical
    disposition: fixed
open: 6
total: 8
recorded: 2026-10-14T02:48:03.945Z
---

# Phase 06: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| WR-01 | warning | open | - |
| WR-02 | warning | open | - |
| IN-01 | info | deferred | Systemic Phase 1/2 identity-layer state, not a Phase 6 regression: the in-memory `IdentityMappingRepository`/`ProfileRepository` predate this phase (the OTP state machine is correctly Redis-backed, so IDN-05 policy invariants are unaffected), and SSO mappings are Mongo-backed (06-02). Closing it means reworking the identity layer across phases — recorded here as a tracked deferral for the identity-multi-instance plan, preserving the `deactivated_at` tombstone semantics in `findByChat`/`findByEmail`/`findAllByEmail`. |
| IN-02 | info | open | - |
| IN-03 | info | open | - |
| IN-04 | info | open | - |
| IN-05 | info | open | - |
| CR-01 | critical | fixed | 70feac29 — `assertOwner(appId, actor)` in `AppDefinitionService` (fail-closed `AppNotFoundError`, the 404-not-403 owner-scoping convention), wired into `updateSection`, the shared `transition` (covering `commitPublish`/`deprecate`/`archive`, once before the retry loop) and `rollback`. Two non-owner refusal specs prove the gate (T-06-27): the refusal writes nothing — no version bump, no audit row, no lifecycle move. The `@casl/ability` `PermissionGuard` wiring stays plan-07 work (per the codebase's own module comments: "The @casl/ability rule set lands in plan 07"); the service-boundary gate is the authoritative enforcement and closes the bypass. (not in the current review) |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
