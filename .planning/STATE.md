---
gsd_state_version: "1.0"
milestone: v2.0
milestone_name: Platform Expansion & Advanced Capabilities
current_phase: 10
current_phase_name: Outbound Delivery Seam & Event Contract
current_plan: 8
status: Phase 10 complete — all 8 plans, 14/14 OUT requirements
stopped_at: Completed 10-08-PLAN.md (trace propagation OUT-13 + end-to-end seam proof)
last_updated: "2026-10-22T21:45:00.000Z"
last_activity: 2026-10-22
last_activity_desc: Phase 10 complete — the outbound delivery seam, the event contract, and trace propagation shipped
state_head: be8371acaa2f703c0306494aa73102c68dd1ddbc
progress:
  total_phases: 8
  completed_phases: 1
  total_plans: 8
  completed_plans: 8
---

## Current Position

Phase: 10 of 17 (Outbound Delivery Seam & Event Contract)
Plan: 8 of 8 — Phase 10 complete
Current Plan: none
Total Plans in Phase: 8
Status: Phase 10 COMPLETE — all 8 plans shipped; 14/14 OUT requirements met
Last activity: 2026-10-22 — OUT-13 trace propagation + end-to-end seam proof landed

Progress: [█████░░░░░] Phase 10 of 8 phases (12% of v2.0 milestone)

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-10-17) · `.planning/REQUIREMENTS.md` (v2.0, 97
requirements) · `.planning/ROADMAP.md` (v2.0, Phases 10-17) · `.planning/research/SUMMARY.md`

**Core value:** An employee can complete a cross-system task entirely through chat plus a single
rendered form, without ever logging into — or learning — the downstream system.
**Current focus:** Phase 10 — Outbound Delivery Seam & Event Contract

## Session

**Last session:** 2026-10-22T09:46:46.931Z
**Stopped at:** Completed 10-04-PLAN.md (outbound ports in domain, Teams impl in worker)
**Resume file:** None

## Performance Metrics

Reset at the v2.0 milestone boundary — no v2.0 plans have executed yet. The v1.0 velocity
record is preserved in `.planning/milestones/v1.0-ROADMAP.md` and the phase summaries.

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| v2.0 (Phases 10-17) | 0 | — | — |
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 10 P03 | ~50min | 4 tasks | 8 files |
| Phase 10 P4 | ~50min | 5 tasks | 12 files |

## Decisions

- **[Roadmap]** v2.0 ships **8 phases (10-17)**, not the 2-4 that `granularity: coarse` nominally
  implies. The deviation is stated in ROADMAP.md, not silently shipped: compressing to 2-4 would
  require collapsing a load-bearing order that four independent research passes converged on.
- **[Roadmap]** Phase 10 gates everything (no adapter is demonstrable without the outbound seam;
  the envelope amendment cannot be retrofitted once adapters ship). Phase 11 gates the two
  security-bearing phases — group RBAC binds to roles, and the AI guard's candidate set *is* the
  authorised set.
- **[Roadmap]** Phase numbering **continues at 10**. v1.0 (Phases 1-9) is archived at
  `.planning/milestones/v1.0-ROADMAP.md`; the numbering never resets.
- **[Roadmap]** Phases 13 (Zalo) and 14 (two-way sync) can run in parallel once Phase 10 lands —
  different adapters, different queues. A one-engineer team follows the sequence.
- **[Frozen contracts]** D-21 (read-link claims), D-23 (JEV v1 wire) and D-43 (audit field
  allowlist) are **worked around, not edited**: the shorter notification TTL is expressed by the
  issuer, the notification destination resolves `real_user_id` → conversation reference at send
  time, and the AI guard is a `JevProvider` **decorator** with zero contract footprint.
- **[Frozen contracts]** The single deliberate exception is the D-16/D-18 allowlist widening in
  Phase 11 (`app_id`, `perm_version`, `group_id` — opaque ids only, never names), with the
  written justification in the same commit.
- **[Contract]** The receiver is a pure ingest contract on all four platforms: verify → validate
  shape → dedupe → enqueue → 200. No DB read, no KMS decrypt, no outbound call. On Zalo the
  budget is 2 seconds.
- **[Scope]** NG1 is **amended, not reversed**: a wider *input* space (free-text intent), a
  narrower *action* space (select a pre-authorised app). The guard may only emit
  `reply | form_link | confirmation | error | status`.
- **[Stack]** Frozen. New runtime deps permitted: `node-telegram-bot-api@2.1.0`, `ai` + exactly one
  `@ai-sdk/*` provider package, and **no Zalo package** (hand-rolled over `undici`).
  OpenTelemetry is **not** bumped this milestone (3.0.0 shipped 2026-10-20, breaking).
- [Phase 10]: 10-03: the platform-event ledger uses 40 ms Mongo timeouts, not the 500 ms inherited from TeamsEventRepository — the phase decision memo names 500 ms as wrong for the 200 ms ack budget. Only the plan's key_links pattern still says 500.
- [Phase 10]: 10-03: `platform-events` is a declared domain element type, not an unclassified directory. Empirically, R3 (no raw mongodb outside mongo-owner/data-access) does not fire at all for files in no element type, so D-02's per-subdirectory config change is what keeps the rule live there.
- [Phase 10]: 10-03: TeamsEventRepository stays as a stateless Teams-scoped facade over PlatformEventRepository instead of being deleted, so the receiver rewrite in 10-04/10-05 lands as its own atomic commit and the @akane/domain subpath export stays stable.
- [Phase 10]: OUT-12 ports are subpath-only: re-exporting them from the @akane/domain root barrel is legal to lint but puts a worker-only outbound-adapter file in the api's import closure, which tooling/entrypoint-drift.spec.ts's R1 assertion rejects. Each port has its own package.json subpath.
- [Phase 10]: Worker Teams delivery was moved and renamed (TeamsDeliveryService -> TeamsDeliveryAdapter implements TeamsOutboundPort) with the old file deleted, so exactly one send path exists. Its spec moved with it and the api's now-orphaned spec was deleted.
- [Phase 10]: Slack ships a port but no worker implementation in 10-04: no bot token, no Slack Web API client and no conversation-reference writer yet (10-05). Recorded as deferred item D-10-04-2 rather than wiring a dead adapter.

## Blockers/Concerns

- **[Milestone]** **Human actions sit on the critical path** and are not code work. Track them
  from Phase 12: (1) Zalo OA approval + creation + permission grants; (2) the VN-egress vs
  data-residency deployment decision; (3) Microsoft Graph application-permission admin consent in
  the target tenant; (4) the directory-source-of-record decision (Entra ID / LDAP-AD / CSV).
- **[Phase 12]** Spike S3 (half-day, real bot) gates the Telegram adapter: `setWebhook` with a
  `secret_token`, a forum-topic post, a `reply_parameters` reply, and the delivered message shape.
  Gap G6 — host the webhook in the existing Express app, not the library's server.
- **[Phase 13]** Spike S2′ (two days, real OA) gates Zalo: capture the exact bytes, verify the
  signature offline against a recorded digest, resolve the two conflicting documented
  concatenations, confirm `timeStamp`'s location, and deliberately exhaust a test quota. Gap G1 —
  the signature is a **plain hash used as a MAC**, not an HMAC, over byte-identical raw bytes.
- **[Phase 15]** Spikes S4 + S5: which Graph application permission is grantable (admin consent is
  a *customer* action — ask during Phase 12/13 discovery), and which directory source is the
  system of record. Do **not** adopt a `<1.0` SCIM server library.
- **[Phase 16]** Spike S6: which provider, which model, which host, and does it satisfy data
  residency? The tool-catalogue accuracy-vs-size curve must be **measured on the v1 fixture set**,
  not guessed, before the cap is chosen (gap G13).
- **[Phase 17]** Real per-tenant IM credential volume — KMS reads per request × tenant count × 3
  platforms — determines whether a credential cache is needed and its TTL. Measure it there.
- **[Phase 10]** A short written **decision memo** is required on four contract questions before
  the envelope amendment lands once: envelope field names, `native_event_id` semantics,
  `platform_metadata` shape, notification-link TTL policy.
- **[Boundary lint]** The `groups` element type and every new adapter directory must be declared
  in `tooling/boundaries.config.mjs` in the same commit that uses them, or the build fails.

## Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 261015-p1h | Fix the App Builder dev stack so same-origin state-changing requests from the SPA succeed — every write currently 403s with `CSRF_ORIGIN_MISMATCH` because the Vite dev proxy rewrites the Host header. | 2026-10-15 | d57aeca | [261015-p1h-fix-dev-proxy-csrf-vite-changeorigin-fal](./quick/261015-p1h-fix-dev-proxy-csrf-vite-changeorigin-fal/) |

## Accumulated Context

### Roadmap Evolution

- **Milestone v2.0 roadmap created 2026-10-22.** `.planning/ROADMAP.md` rewritten for Phases
  10-17; `.planning/REQUIREMENTS.md` traceability populated (97/97 mapped, 0 unmapped, 0
  duplicated). v1.0's roadmap and requirements are archived at
  `.planning/milestones/v1.0-ROADMAP.md` and `.planning/milestones/v1.0-REQUIREMENTS.md`.
- **v1.0 (Phases 1-9) shipped 2026-10-21** — 9 phases, 72 plans, 100% complete, PR #7 mergeable,
  59 tests pass, `nyquist_compliant: true`, 54 threat mitigations across 7 STRIDE categories.
  Phase numbering continues at 10; it never resets.

### Deferred Items

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| Feature | SCIM / Entra ID as the authoritative directory upstream | Deferred to v3 | v2.0 | v2.0 |
| Feature | The remaining 29 IM platforms beyond the four | Deferred to v3 | v2.0 | v2.0 |
| Feature | Notification topic subscriptions (FR-N-5), per-app muting (FR-N-7) | Deferred to v2.x | v2.0 | v2.0 |
| Feature | Zalo GMF group targeting, Telegram forum-topic threads | Deferred to v2.x | v2.0 | v2.0 |
| Platform | OpenTelemetry 3.0.0 upgrade (breaking, shipped 2026-10-20) | Scheduled — isolated change, never during feature work | v2.0 | v2.0 |

## Session Continuity

Last session: 2026-10-22
Stopped at: v2.0 roadmap created — 8 phases (10-17), 97/97 requirements mapped; awaiting
Phase 10 planning
Resume file: None

**Next:** `/gsd-plan-phase 10` — plan the Outbound Delivery Seam & Event Contract, starting with
the four-question decision memo.
