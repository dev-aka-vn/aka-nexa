---
gsd_state_version: "1.0"
current_phase: 07
current_phase_name: Multi-Form Apps & Per-Form Triggers
current_plan: 8
status: complete
stopped_at: Completed 07-07-PLAN.md
last_updated: "2026-10-18T16:31:04.265Z"
state_head: 0fb4aedfb772fdac6cf0b7427687473f0571c70f
progress:
  total_phases: 9
  completed_phases: 7
  total_plans: 57
  completed_plans: 68
  percent: 78
last_activity: 2026-10-18
last_activity_desc: 07-07 complete — per-form designer ?form= + U-1 trigger panel + U-2 config surfaces; 8/8 plans done
---

## Current Position

Phase: 07 (Multi-Form Apps & Per-Form Triggers) — EXECUTING
Plan: 8 of 8
Status: Ready to execute
Current Plan: 8
Total Plans in Phase: 8

## Session

**Last session:** 2026-10-18T16:30:55.101Z
**Stopped at:** Completed 07-07-PLAN.md
**Resume file:** None

## Performance Metrics

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 04 P02 | 40m | 3 tasks | 7 files |
| Phase 04-read-path-query-dsl P09 | 1m | 1 tasks | 1 files |
| Phase 4 P05 | 00:05:30 | 2 tasks | 3 files |
| Phase 04 P07 | 300 | 1 tasks | 3 files |
| Phase 04-read-path-query-dsl P04 | 15m | 2 tasks | 3 files |
| Phase 04-read-path-query-dsl P08 | 1032 | 2 tasks | 4 files |
| Phase 05 P01 | 13m | 3 tasks | 14 files |
| Phase 05 P03 | 45m | 3 tasks | 5 files |
| Phase 05 P04 | 60 | 3 tasks | 8 files |
| Phase 05-integration-async-execution P06 | 30m | 3 tasks | 10 files |
| Phase 05 P07 | 105m | 2 tasks | 7 files |
| Phase 05 P09 | 23min | 3 tasks | 11 files |
| Phase 06-self-service-app-builder P01 | 74min | 2 tasks | 18 files |
| Phase 06 P02 | 90min | 3 tasks | 25 files |
| Phase 06 P03 | 61min | 2 tasks | 12 files |
| Phase 6 P04 | 95min | 3 tasks | 33 files |
| Phase 6 P05 | 129min | 3 tasks | 28 files |
| Phase 06-self-service-app-builder P06 | 96min | 3 tasks | 28 files |
| Phase 06 P06-07 | 10369 | 3 tasks | 39 files |
| Phase 06 P06-08 | 4h 49m | 3 tasks | 48 files |
| Phase 06-self-service-app-builder P09 | 50min | 3 tasks | 10 files |
| Phase 06-self-service-app-builder P11 | 55min | 2 tasks | 4 files |
| Phase 06-self-service-app-builder P12 | 40min | 2 tasks | 6 files |
| Phase 06-self-service-app-builder P10 | 55min | 2 tasks | 8 files |
| Phase 07 P01 | 60 | 3 tasks | 20 files |
| Phase 07 P02 | 10m | 2 tasks | 9 files |
| Phase 07 P03 | 15 min | 2 tasks | 7 files |
| Phase 07 P04 | 60 | 3 tasks | 5 files |
| Phase 07 P06 | 30min | 2 tasks | 4 files |
| Phase 07 P07 | complete | 3 tasks | 4 files |

## Decisions

- [Phase 04-read-path-query-dsl]: UAT-GAPS.md already existed with all three required sections; plan 10 is an idempotent no-op — verified rather than re-wrote
- [Phase 04-read-path-query-dsl]: Verified existing DAT-11/DAT-12 DSL auth invariant tests remain green
- [Phase 04-read-path-query-dsl]: Created comprehensive read-verifier tests for LNK-05/LNK-06/D-79/D-75
- [Phase 04-read-path-query-dsl]: controller-extended-with-query-endpoint
- [Phase 04-read-path-query-dsl]: tests-cover-view-and-query-flows
- [Phase 05]: Fail-closed on unknown modes: return failed_permanent without external sends
- [Phase 05]: Empty external payloads treated as mapping failures (failed_permanent)
- [Phase 05]: ConnectorRef required for external/hybrid modes
- [Phase 05]: Treat 'sent_unconfirmed' on fresh redelivery as idempotent short-circuit; allow retry on BullMQ retry attempts
- [Phase 05]: Reconciliation marks outbox entries unpublished (not_sent only) so relay repicks them
- [Phase 05]: Job Scheduler registered idempotently in scheduler app with both heartbeat and reconciliation
- [Phase 05-integration-async-execution]: upsert-keyed-by-connector-ref: Idempotent loader keyed by connector_ref
- [Phase 05-integration-async-execution]: dlq-redacted-by-default: DLQ list excludes payload/PII by default
- [Phase 05]: Extend query action in place (no new route/action/claim) returning projected rows
- [Phase 05]: Partial status derived from not_sent/sent_unconfirmed latest revision with retrying destination
- [Phase 05]: Failed status uses taxonomy code mapped to user-safe reason string
- [Phase 05]: Pinned @formio/js@5.6.1 exactly after a blocking package-legitimacy gate (MIT, official Form.io publisher); self-hosted same-origin so CSP script-src 'self' holds and no CDN asset is referenced (FRM-07).
- [Phase 05]: Renderer modules stay DOM-free at import with a guarded browser entry that dynamically imports FormIO, keeping the pure status/edit logic testable in the node vitest environment.
- [Phase 05]: A consumed edit link replays its recorded confirmation (D-95) — never the dead-link denial page; no user-facing retry control exists on any status/detail/partial surface (D-81).
- [Phase 06-self-service-app-builder]: S1 outcome: @formio/js@5.6.1 confirmed — builder mounts, renders, and round-trips in Chromium under the pinned 5.6.1; formiojs@4.21.7 fallback not adopted
- [Phase 06-self-service-app-builder]: FormIO 5.6.1 sidebar is dragula-powered (click is a no-op); e2e drives the real drag-and-drop + edit-dialog-save flow
- [Phase 06-self-service-app-builder]: New-component drops open the component edit dialog; the builder change event fires on dialog save (saveComponent)
- [Phase 06-self-service-app-builder]: Chromium Playwright project at 1280x1024 so the builder canvas fits (below-fold drop = cancelled dragula drag)
- [Phase 06-self-service-app-builder]: Tablet project is chromium-backed 768x1024 + hasTouch + isMobile (iPad preset forces webkit, uninstallable here)
- [Phase 06-self-service-app-builder]: TypeScript stays pinned at workspace root 6.0.3; the SPA never re-declares typescript (Pitfall 12)
- [Phase 06]: D-101 auto-selected (LOCKED): server-side Redis session, httpOnly Secure SameSite=Strict __Host- cookie, no token readable from SPA
- [Phase 06]: Shared IdentityModule composes the identity stores once per api process — the IDN-08 realUserId check must see D-104-provisioned users
- [Phase 06]: Session renewal window is less than half the IdP session lifetime remaining — derived from the IdP session, no second expiry policy (D-103)
- [Phase 06]: IDN-05: OTP state transitions run as atomic Lua scripts (redis.eval) — request/verify are read-check-write and plain TS+INCR lost lockout updates under concurrent verifies
- [Phase 06]: IDN-05: lockout arms on the THIRD failed attempt (not the first) and lasts exactly 30 minutes from that failure; third attempt returns invalid with attemptsRemaining: 0, fourth returns locked
- [Phase 06]: IDN-05: successful verify leaves a consumed tombstone (TTL = remaining window) so replay is refused OTP_CONSUMED, distinct from OTP_EXPIRED
- [Phase 06]: IDN-05: plaintext OTP code never persists — only SHA-256 hash; OtpDeliveryService logs the chat identity, never the code (T-06-13)
- [Phase 6]: Repository under builder/data-access/ — R3 boundary rule restricts mongodb driver imports to platform/src/mongo/** and domain/src/**/data-access/** (matches datarouter/submissions precedents)
- [Phase 6]: All DI providers are factory providers with explicit inject — vitest esbuild emits no design:paramtypes, bare-class providers inject undefined and 500
- [Phase 6]: Transition endpoints (publish/deprecate/archive) return 200; only POST /apps and POST /templates/:id/fork return 201
- [Phase 6]: Template fork writes through AppDefinitionRepository.createDraft — inherits unique-app_id guard + audited creation; structuredClone guarantees no shared reference with the platform record (D-108)
- [Phase 6]: Boot steps in main.ts — TemplateSeed.load() and saved-query backfill run at api composition root; both idempotent so rolling deploys are safe
- [Phase 6]: SeedSavedQueryLookup retained, unwired — G-11 swap changes only the read.module.ts provider; backfill reads the frozen seed JSON directly
- [Phase 6]: Share-drop model is additive dilution with 2dp rounding: post(A)=(cA+sA)/(cL+K), points=round(100*(preShare-postShare)*100)/100, allowed = all drops <= 5.00 AND no collision
- [Phase 6]: Single AUD-01 app.published audit entry carries the full PublishGateResult via a new auditExtra param on AppDefinitionService.transition()
- [Phase 6]: declaredLabels: trigger labels are declared intents/aliases; id/command fallback applies only when a trigger declares neither
- [Phase 6]: OTel API 1.9.1 gauge registration: createObservableGauge takes no callback; attach via gauge.addCallback with observableResult.observe(share, { app_id })
- [Phase 6]: RoutingOutcomeStore structural interface: gate and share computer consume the seam, not the Mongo-backed class; specs use in-memory doubles
- [Phase 6]: Zero-change publish short-circuits the gate before any dry-run: allowed, empty shareDrops/collision/changeSummary, version unmoved
- [Phase 06-self-service-app-builder]: csv-stringify 6.9.0 is the D-111 export writer (D-111 names csv-parse, the parser; the writer is its adaltas/node-csv sibling)
- [Phase 06-self-service-app-builder]: Submissions viewer and export share one projection path (toViewerRow over projectSubmissionStatus) so the export row count equals the filtered view count by construction
- [Phase 06-self-service-app-builder]: ReadModule providers with constructor deps are explicit factory providers — undecorated classes emit no design:paramtypes under tsc or vitest, so bare-class providers instantiate with undefined deps
- [Phase 06-self-service-app-builder]: Export safe-reason column carries the curated delivery message (never raw submission content); downstream reference comes from the latest revision
- [Phase 06]: Per-app @casl/ability rule factory with the ACL-10 transfer-execution carve-out implemented as a rule omission (06-07)
- [Phase 06]: FRM-09 sandbox isolation is structural: form.nosubmit + diverted submit event to an in-memory buffer — the sandbox has no HTTP surface (06-07)
- [Phase 06]: SPA-side API responses validated by hand-written structural schemas (parse(data): T), not Zod (06-07)
- [Phase 06]: Playwright specs stub the builder API via page.route with one method+URL dispatch route for all **/api/apps/** paths (06-07)
- [Phase 06]: ACL-05 transfer: one pending transfer per app is a Mongo partial unique index (partialFilterExpression {state: pending}); owner requests, global admin approves/rejects with route+service defense-in-depth guards, 7-day TTL, hourly idempotent auto-cancel Job Scheduler + worker processor, AUD-01 per transition
- [Phase 06]: Audit browse GET /audit is global-admin-only, paginated (default 20/max 100), newest-first, projected through the D-43 field allowlist before serialization — ip and non-allowlisted keys are unreachable by construction
- [Phase 06]: Dashboard (D-112) ships exactly two live widgets (recent submissions via per-app GET /submissions merge, recent audit activity via GET /audit?limit=5); the connector-health card is deliberately absent
- [Phase 06]: The SPA never imports @akane/domain — frozen vocabularies (PLATFORM_TAGS, transfer states, SSO mappings) ride as structural copies with the domain package as source of truth, keeping the Mongo driver out of the browser bundle
- [Phase 06]: The plan's single transfer.controller.ts was split into transfer-request.controller.ts (owner) + transfer-approval.controller.ts (global-admin) — the two RBAC roles own distinct route trees
- [Phase 06]: Rule 1 fix: the app-shell header row wraps at narrow widths — the 8-link nav's min-content width (~865px) exceeded the 768px tablet layout viewport, widening the document and breaking Playwright click hit-testing on wide tables (13 tablet e2e timeouts); proven causal by a stash-and-compare geometry probe
- [Phase 06]: Settings page is a deliberate read-only stub (D-109): it names the deferred JEV-chain/decision-cache/circuit-breaker knobs as platform-admin territory; no fake inputs
- [Phase 06]: [Phase 06-09]: One generator writes two byte-identical scoped Bootstrap stylesheets (designer + renderer) from a single Bootstrap 5.3.8 source read
- [Phase 06]: [Phase 06-09]: --check compares on normalised line endings so autocrlf checkouts never report false drift
- [Phase 06]: [Phase 06-11]: Publish gate states the effect without change rows — change summary is the publish response payload, no dry-run endpoint (frozen-contract precedence)
- [Phase 06]: [Phase 06-11]: Only the Ctrl/Cmd+S chord carries the dirty-JSON guard — a button click is an explicit act the gate already confirms
- [Phase 06]: [Phase 06-11]: Stub PATCH echoes the forms-section patch so a saved edit stops reading as dirty (page re-reads persisted state off the PATCH response)
- [Phase 06]: [Phase 06-12]: Resume restores position+inputs from the session snapshot and the draft definition from the server (GET /apps/:id) — snapshot is working state, API is truth (T-06-48)
- [Phase 06]: [Phase 06-12]: Wizard route sync uses history.replaceState, never location.hash assignment — no hashchange, no remount loop (T-06-49)
- [Phase 06]: [Phase 06-12]: RoutedPage keys the wizard by app id so an app-id change remounts into exact fresh hydration — sidebar Create mid-flow stays a fresh wizard
- [Phase 06]: [Phase 06-12]: Designer return control renders only with a live snapshot; no back-to-app-editor breadcrumb (explicitly not required)
- [Phase 06]: [Phase 06-10]: One generator two byte-identical artifacts holds - the renderer wires plan-06-09 formio-scope.css as-is, never regenerates or forks it
- [Phase 06]: [Phase 06-10]: Renderer e2e shares one geometry helper across read+edit pages; edit stub is a live link (no editOutcome) so the form renders
- [Phase 06]: [Phase 06-10]: Whole-suite-as-one-set green environmentally unproven (orphaned vite/playwright processes + OOM), not code-unproven - rerun npx playwright test --workers=1 on a healthy box
- [Phase 07]: FormStep gets no save path (no dead writes)
- [Phase 07]: publishedAppFromDefinition is single PublishedApp; per-form tool projection deferred to 07-08
- [Phase 07]: Retired app-level Triggers section (13→12); triggers now live on the form (D-06/D-12). Stale triggers grants filtered as no-ops until 07-04 migration.
- [Phase 07]: Per-kind config validation lives in TemplateSeedSchema via .superRefine (same-kind uniqueness, submit schema presence, show subset, list query_id/columns).
- [Phase 07]: Seed gallery now ships genuine multi-form templates: leave-request submit+list over qry_pending_leave; expense-report and it-helpdesk-ticket carry show forms.
- [Phase 07]: Migrate both apps and app_definition_versions in one run (D-11) so rollback() cannot resurrect retired shape
- [Phase 07]: Filter-guarded compare-and-set migration: find by {form_schema:{$exists:true}}, updateOne re-checks $exists
- [Phase 07]: FormManager persists every add/remove through {section:'forms'} only; row label derived from app name + kind; remove blocks last-submit via callout-warn
- [Phase 07]: 07-07: per-form designer dispatch via ?form=; U-1 FormTriggerPanel (inline-collapsible, D-08 disable); U-2 ReadFormConfig (show field selection/ordering, list query_id+columns)

## Blockers/Concerns

- **[Phase 05] Phase 5 is executed, validated and verified.** `05-GAPS.md` records the findings
  of the verification pass, and `05-VERIFICATION.md` (G-9, closed 2026-10-11) is the
  goal-backward artifact: 9/12 must-have truths confirmed, verdict `gaps_found`. The
  substantive gaps are **closed**: **CON-05** (the connector rate limiter), **AUD-10**
  (read-link rate limiting, per user/jti, never per IP) and **OBS-04 / CON-06 / CON-07** (the
  business counters, which now have a write seam and a call site) are all implemented and
  tested over real Redis/Mongo/containers. `05-VALIDATION.md` is `status: validated` with
  `nyquist_compliant: true`. What remains open is recorded below, not silently absorbed.
- **[Phase 05] G-11 — ✅ CLOSED 2026-10-11.** The status page's "My submissions" list uses the
  `query` action, and `verifyQuery` fails closed when the D-73 `savedQueries` seam is absent —
  `read.module.ts` passed `undefined`, so every `query` link was denied while the verifier's own
  suite stayed green against in-memory doubles. Fixed by `SeedSavedQueryLookup`
  (`packages/domain/src/links/seed-saved-query.lookup.ts`), which reads the frozen seed and keys
  on `(app_id, query_id)`, wired through `read.module.ts`, with a module-wiring guard asserting
  the DI graph. **DAT-14** nevertheless stays `Partial` — see G-13.
- **[Phase 05] G-13 — nothing mints a signed read link.** The only issuer,
  `packages/domain/src/links/link-issuer.service.ts`, is a documented Phase-2 stand-in that
  returns an unsigned `/l/<appId>?u=...`; the frozen claim set is never constructed outside
  tests. So the whole read path (`view`/`query`/`edit`) is verification-only — **every**
  `/l/*` route can be reached only by a hand-crafted token. This is deliberately not patched:
  a real issuer is KMS-backed ES256 and is blocked on the still-open **FND-10** gate, and a
  test-key stand-in would put an unrotated signing key on a 90-day token's critical path. The
  full remediation plan — claim set, token classes, `kid` keyring, rotation, the fail-closed
  production guard, and testable acceptance criteria — is written up in
  `phases/05-integration-async-execution/deferred-items.md` **D-3**.
- **[Phase 05] G-12 — ✅ RESOLVED 2026-10-11, no code change.** ROADMAP SC#5(a) and
  `REQUIREMENTS.md` CON-06 both said an app's spike should be *budgeted* separately, while
  CON-05 says limits are *per connector instance, shared across every app*. The user ruled that
  **CON-05 stands** — the connector instance is the budgeted resource and `app_id` is the
  attribution label — so SC#5(a) and CON-06 were amended to match the implemented,
  test-pinned behaviour.
- **[Phase 05] Six `apps/api` sources are unreachable from `main.ts`** — the only
  failing test in the suite (`entrypoint-drift`, 1 failed / 904 passed). They are phase-2
  scaffolding: the Slack controllers verify no signing secret and return `{ ok: true }`, so
  wiring them as-is would be a security regression. This needs phase 2, not a bolt-on.
- **[Phase 02/03] Their ROADMAP boxes are unticked while every plan is ticked**, and their
  code is unwired. `gsd-tools progress` reports them "Complete" on plans+summaries alone,
  which is a plan-execution notion, not a verified one.

## Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 261015-p1h | Fix the App Builder dev stack so same-origin state-changing requests from the SPA succeed — every write currently 403s with `CSRF_ORIGIN_MISMATCH` because the Vite dev proxy rewrites the Host header. | 2026-10-15 | d57aeca | [261015-p1h-fix-dev-proxy-csrf-vite-changeorigin-fal](./quick/261015-p1h-fix-dev-proxy-csrf-vite-changeorigin-fal/) |

## Accumulated Context

### Roadmap Evolution

- Phase 7 edited: Phase 7 replaced: Multi-IM Expansion & Two-Way Sync -> Multi-Form Apps & Per-Form Triggers (APP-11, APP-12, FRM-14 added). Multi-IM renumbered to Phase 8; Production Readiness renumbered to Phase 9. Milestone scope 8 -> 9 phases.
