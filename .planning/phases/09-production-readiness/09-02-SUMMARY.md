# Phase 09 Plan 02: Audit Read Path, Erasure, Access Review Summary

**One-liner:** Closed the audit entry type (added app_id, removed index signature), added structured query/export services, operator erase-actor CLI, quarterly access-review generator, HTTP filters/export, and purge operator surface.

## Status: complete

## Commits
- a5a6a17a: feat(09-02): closed audit entry type, query service, export service
- 76382855: feat(09-02): erase-actor CLI with convention-driven redaction
- 91a9fc04: feat(09-02): access review generator and console surfaces
- 88f56500: feat(09-02): purge operator surface and console lifecycle card

## Key Changes
- `AuditEntry` now carries typed `app_id` and all formerly ad-hoc keys; index signature removed.
- Former ad-hoc keys disposition: attempts, changeSummary, connector_id/connectorId, credential_ref, failureReason, field_count, filters, form, from/from_user_id, mechanism, noticeError/noticeFailed, previous_request_id, realUserId, reason, reference, row_count, section, source_version, status, to/to_user_id, transfer_id, updatedBy, zero_change, unlisted_extra (kept typed; unlisted_extra retained for legacy seed compatibility), ticket refs, actor refs, ip/user_agent. None dropped silently.
- `AuditQueryService.search` owns Mongo filter construction: inclusive from/to, bare `to` widens to end-of-day UTC, blank user/action treated absent, unknown app_id returns empty, sort {timestamp:-1,_id:-1}.
- `AuditExportService` streams JSON Lines only (D-11), whole filtered set, zero-match zero-byte.
- Compound indexes {app_id,timestamp}, {actor,timestamp}, {action,timestamp} added via memoised ensureIndex.
- `ActorErasureService.erase` deletes mapping row first, redacts every `*_ref` by convention, purges submission bodies, appends one `erasure.executed` with ticket ref; distinguishes erased/already-erased/nothing-matched.
- `erase-actor` CLI registered; exits non-zero on nothing-matched.
- `AccessReviewService` generates/stores quarterly report; regeneration overwrites and appends one entry; zero-entitlement quarter stored.
- GET /audit extended with user, app_id, action, from, to; export endpoint; access-review read endpoint (also /access-review).
- Console AuditPage uses 5 structured filters + Clear filters, Export JSON Lines; AccessReviewPage added with nav entry.
- Purge: POST apps/:id/purge global-admin, soft-delete + grace callout; AppsPage lifecycleTone 'purged' -> 'badge-purged'; definition.ts includes 'purged'.

## Planner assumptions (U-2, U-4)
- U-4: App filter is a select populated from app listing; From/To are date inputs; placeholders "Filter by user…", "e.g. app.purge"; free-text box removed.
- U-2: Access Review report rows use App/Role/Members/Generated columns; member list clamps at two lines via od-clamp-2.

## Access review queue
- Queue/job id: `access-review`, interval 90 days.

## Known limitations (D-08)
- ProfileRepository and IdentityMappingRepository are in-memory and not durably erasable in this phase.

## Self-Check: PASSED

actuals:
  tokens: 105000
  tasks: 4
  commits: 4
  plan_head_before: 26be5b5fb0b6b2f9fe6014af37321597b105427c
  plan_head_after: 88f56500349a2be0959c98eb9557001f20e75f47
