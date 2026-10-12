---
phase: 06-self-service-app-builder
plan: 05
subsystem: api
tags: [publish-gate, routing-share, otel-observable-gauge, zod-contract, app-builder, rbac, dry-run]

# Dependency graph
requires:
  - phase: 06-04
    provides: commitPublish seam, AppDefinitionService lifecycle transitions, app_definition_versions snapshots
  - phase: 03
    provides: RoutingOrchestrator route(), PublishedAppLoader, intent labelling
provides:
  - publish gate (APP-07 share-drop evaluation + APP-08 description collision)
  - routing_share{app_id} OTel ObservableGauge (OBS-05)
  - RoutingOutcomeRepository + RoutingOutcomeStore structural seam
  - POST /apps/:id/publish endpoint with BLD-06 change summary
affects: [06-06, spa-publish-dialog, phase-07]

# Actuals (#2632) — pairs with the plan's `estimate` (65000 tokens / 3 tasks) to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 30698
  tasks: 3
  commits: 7
  plan_head_before: 060cb42217c2e148bfb7b02481a2286445049e67
  plan_head_after: cfd5e35d28e778bc021c5efa24bdef7aba592df2

# Tech tracking
tech-stack:
  added: []  # zero new npm installs (T-0-SC honored)
  patterns:
    - structural-store-seam
    - addCallback-gauge-registration
    - transition-auditExtra
    - read-only-dry-run

key-files:
  created:
    - packages/domain/src/builder/publish-gate.service.ts
    - packages/domain/src/builder/routing-share/routing-outcome.repository.ts
    - packages/domain/src/builder/routing-share/routing-share.computer.ts
    - packages/domain/src/builder/routing-share/routing-share.metrics.ts
    - packages/contract/src/builder/publish.contract.ts
    - apps/api/src/app-builder/publish.controller.ts
    - packages/domain/src/builder/publish-gate.service.spec.ts
    - packages/domain/src/builder/routing-share/routing-outcome.repository.spec.ts
    - packages/domain/src/builder/routing-share/routing-share.computer.spec.ts
    - packages/domain/src/builder/routing-share/routing-share.metrics.spec.ts
    - apps/api/src/app-builder/publish.integration.spec.ts
  modified:
    - apps/api/src/app-builder/app-builder.controller.ts
    - apps/api/src/app-builder/app-builder.module.ts
    - packages/domain/src/builder/app-definition.service.ts
    - packages/domain/src/builder/data-access/app-definition.repository.ts
    - packages/domain/src/decision/published-app-loader.ts
    - apps/worker/src/processors/inbound-event.processor.ts
    - apps/worker/src/worker.module.ts
    - packages/domain/src/index.ts
    - packages/contract/src/index.ts
    - tooling/boundaries.config.mjs

key-decisions:
  - "Share-drop model is additive dilution: domain = candidate's declared labels, intent set = published apps sharing any domain label (excluding candidate), post(A) = (cA + sA)/(cL + K) with K simulated routings, points = round(100*(preShare-postShare)*100)/100, allowed = every drop <= 5.00 AND no description collision"
  - "Single AUD-01 'app.published' audit entry carrying the full PublishGateResult, via a new auditExtra param on AppDefinitionService.transition()"
  - "declaredLabels: a trigger's labels are its declared intents/aliases; the id/command fallback applies ONLY when a trigger declares neither"
  - "OTel API 1.9.1 registration shape: meter.createObservableGauge(name, options) takes NO callback; the callback attaches via gauge.addCallback(async (observableResult) => observableResult.observe(share, { app_id }))"
  - "RoutingOutcomeStore is a structural interface (record/outcomesForIntent/outcomesForApp); RoutingShareComputer and PublishGateService consume the seam, not the Mongo-backed class"
  - "Zero-change publish (already published) short-circuits the gate before any dry-run: allowed with empty shareDrops, null collision, empty changeSummary; version does not move"

patterns-established:
  - "Read-only dry-run: gate predictions execute the candidate's labelled intent set through the REAL RoutingOrchestrator.route() — the prediction is the live router's own computation, never a second implementation"
  - "Structural store seam: domain services depend on store interfaces satisfied by Mongo repositories and in-memory test doubles alike"
  - "addCallback gauge registration: the only correct observable-gauge wiring for @opentelemetry/api 1.9.1"
  - "auditExtra on transition(): rich audit payloads ride the lifecycle transition without polluting the definition document"

requirements-completed: [APP-07, APP-08, BLD-06, OBS-05]

# Coverage metadata (#1602) — one entry per shipped deliverable. Drives DETERMINISTIC UAT routing in verify-work.
coverage:
  - id: D1
    description: "Publish gate (APP-07): dry-run share-drop evaluation over the real RoutingOrchestrator with the 5.00/5.01 boundary — exactly 5.00 passes, 5.01 blocks naming app_id and delta"
    requirement: APP-07
    verification:
      - kind: unit
        ref: "packages/domain/src/builder/publish-gate.service.spec.ts#5.00 passes / 5.01 blocks / blocked publish is side-effect-free / no self-drop / orchestrator spy asserts 4 route() calls"
        status: pass
      - kind: integration
        ref: "apps/api/src/app-builder/publish.integration.spec.ts#blocked publish returns 409 PUBLISH_REFUSED naming competitor-app and 5.01, candidate stays draft, audit unextended"
        status: pass
    human_judgment: false
  - id: D2
    description: "APP-08 description collision: case-fold + whitespace-tokenize, exact equality after folding blocks, Jaccard >= 0.90 blocks (0.89 passes), published apps only, returns descriptionCollisionWith"
    requirement: APP-08
    verification:
      - kind: unit
        ref: "packages/domain/src/builder/publish-gate.service.spec.ts#case-folded exact-equal names the colliding app / Jaccard 9/10=0.90 blocks / 8/9=0.89 passes"
        status: pass
      - kind: integration
        ref: "apps/api/src/app-builder/publish.integration.spec.ts#collision case against a live published app"
        status: pass
    human_judgment: false
  - id: D3
    description: "BLD-06 change summary: status draft->published, version vN->vN+1, form versions 'current'->'pinned at link creation', indexes '—'->'creation on {collections}', triggers 'none'->'{n} active'; unchanged fields omitted; zero-change publish returns empty summary with zero_change: true"
    requirement: BLD-06
    verification:
      - kind: unit
        ref: "packages/domain/src/builder/app-definition.service.spec.ts#commitPublish version bump and summary rows"
        status: pass
      - kind: integration
        ref: "apps/api/src/app-builder/publish.integration.spec.ts#summary row accuracy v4->v5 and zero-change v7->v8 edge"
        status: pass
    human_judgment: false
  - id: D4
    description: "POST /apps/:id/publish endpoint: owner-scoped via session realUserId (non-owner 404), gate evaluated BEFORE any state change, commitPublish only when allowed, PUBLISH_REFUSED mapped to 409"
    requirement: APP-07
    verification:
      - kind: integration
        ref: "apps/api/src/app-builder/publish.integration.spec.ts#owner scoping, gate-before-state-change, 409 refusal shape { error: { code, message } }"
        status: pass
    human_judgment: false
  - id: D5
    description: "routing_share OTel ObservableGauge (OBS-05): app_id attribute on the existing 'akane' meter, distribution over the labelled intent set over a rolling 24h window, exported via the prometheus exporter with otel_scope_name='akane'"
    requirement: OBS-05
    verification:
      - kind: unit
        ref: "packages/domain/src/builder/routing-share/routing-share.metrics.spec.ts#asserts '# TYPE routing_share gauge' and series routing_share{app_id=...,otel_scope_name=\"akane\"} with repeating-decimal shares"
        status: pass
      - kind: unit
        ref: "packages/domain/src/builder/routing-share/routing-share.computer.spec.ts#distribution over the intent set, 24h window rollover"
        status: pass
    human_judgment: false
  - id: D6
    description: "RoutingOutcomeRepository producer: the inbound-event processor records every applied link routing outcome (intent_label = first matching declared intent/alias or 'unlabelled' sentinel, never raw question text) at both route() sites; record-write failure is caught and logged, the link is still returned"
    requirement: OBS-05
    verification:
      - kind: unit
        ref: "apps/worker/src/processors/inbound-event.processor.spec.ts#producer invoked at both route() sites, failure swallowed and logged"
        status: pass
      - kind: unit
        ref: "packages/domain/src/builder/routing-share/routing-outcome.repository.spec.ts#Mongo record shape and intent labelling against a cursor-with-toArray collection double"
        status: pass
    human_judgment: false

# Metrics
duration: 129min
completed: 2026-10-12
status: complete
---

# Phase 6 Plan 5: Publish Gate & Routing Share Summary

**Publish gate with read-only routing dry-run, 5-point share-drop boundary, description-collision check, BLD-06 change summary, and the routing_share{app_id} OTel gauge**

## Performance

- **Duration:** 129 min (2h 09m)
- **Started:** 2026-10-12T11:16:46+02:00
- **Completed:** 2026-10-12T13:25:31+02:00
- **Tasks:** 3
- **Files modified:** 28 (3041 insertions, 38 deletions)

## Accomplishments
- Publish gate (APP-07): candidate publish is dry-run through the real RoutingOrchestrator; each existing app's routing share over the labelled intent set (rolling 24h window) must not drop by more than 5.00 points — exactly 5.00 passes, 5.01 blocks with a named error identifying app_id and delta; blocked publishes leave all state untouched
- APP-08 description collision: case-folded exact equality or Jaccard >= 0.90 against published apps blocks the publish and names the colliding app
- BLD-06 change summary matching the mockup's publish-modal rows (prototypes/mockup.html:1580-1585), with unchanged fields omitted and a zero-change publish returning an empty summary with zero_change: true
- POST /apps/:id/publish: owner-scoped (non-owner 404), gate evaluated before any state change, commitPublish only when allowed, refusal mapped to 409 PUBLISH_REFUSED
- routing_share{app_id} OTel ObservableGauge (OBS-05) on the existing 'akane' meter — a distribution over the labelled intent set, never a per-app counter
- RoutingOutcomeRepository producer wired at both route() sites in the inbound-event processor, filling the rolling 24h window from live chat traffic; intent_label is the first matching declared intent/alias or the 'unlabelled' sentinel, never raw question text

## Task Commits

Each task was committed atomically:

1. **Task 1 (tracer, TDD): End-to-end publish** — `7437adc8` (fix: pre-existing builder-element type-error baseline), `585cd61d` (test: RED), `0073efdb` (test: RED spec corrections to real seams), `4f4ce581` (feat: GREEN — gate, repository, computer, metrics, controller, wiring)
2. **Task 2 (auto, TDD): APP-07 dry-run edges** — `450b8e5d` (test: RED boundary specs + integration blocked-publish case), `891098d7` (fix: GREEN declaredLabels conditional fallback)
3. **Task 3 (auto, TDD): APP-08 collision + BLD-06 summary edges** — `cfd5e35d` (test: collision boundary 0.90/0.89, zero-change short-circuit, version-row accuracy; the collision and zero-change implementation shipped in Task 1's GREEN slice and is proven here)

**Plan metadata:** final docs commit via `gsd_run query commit` (docs(06-05): complete publish gate plan)

## Files Created/Modified
- `packages/domain/src/builder/publish-gate.service.ts` - the gate: evaluate() with read-only dry-run, declaredLabels, publishedAppFromDefinition, descriptionsCollide, buildChangeSummary, thresholdOf
- `packages/domain/src/builder/routing-share/routing-outcome.repository.ts` - RoutingOutcomeRepository (Mongo, routing_outcomes collection) + RoutingOutcomeStore structural interface + UNLABELLED_INTENT_LABEL sentinel
- `packages/domain/src/builder/routing-share/routing-share.computer.ts` - RoutingShareComputer: distribution over the labelled intent set, rolling 24h window (ROUTING_SHARE_WINDOW_MS)
- `packages/domain/src/builder/routing-share/routing-share.metrics.ts` - registerRoutingShareMetrics: ObservableGauge via addCallback on the 'akane' meter
- `packages/contract/src/builder/publish.contract.ts` - Zod 4 contracts: PublishGateResult, publish request/response shapes
- `apps/api/src/app-builder/publish.controller.ts` - POST /apps/:id/publish (owner-scoped, gate-before-state-change, zero-change branch)
- `packages/domain/src/builder/app-definition.service.ts` - commitPublish + transition(appId, actor, to, action, extra, auditExtra)
- `packages/domain/src/builder/data-access/app-definition.repository.ts` - listPublished for collision candidates
- `packages/domain/src/decision/published-app-loader.ts` - AuthorizedApp.intents exposed for the dry run
- `apps/worker/src/processors/inbound-event.processor.ts` - outcome producer at both route() sites (record failure caught + logged, link still returned)
- `apps/worker/src/worker.module.ts` - RoutingOutcomeRepository provider
- `apps/api/src/app-builder/app-builder.controller.ts` - old bare publish endpoint removed; PUBLISH_REFUSED -> 409 via builderErrorStatus
- `apps/api/src/app-builder/app-builder.module.ts` - publish controller + gate wiring
- `packages/domain/src/index.ts`, `packages/contract/src/index.ts` - barrel exports for domain symbols and contracts
- `tooling/boundaries.config.mjs` - builder element gains a `decision` edge (gate imports RoutingOrchestrator/PublishedAppLoader)

## Decisions Made
- **Additive-dilution share-drop model**: domain = candidate's declared labels; intent set = published apps sharing any domain label (excluding candidate); cL = in-window records with intent_label in domain; cA = records with app_id = A and intent_label in domain; K = |domainLabels| simulated routings; post(A) = (cA + sA)/(cL + K); points = Math.round(100 * (preShare - postShare) * 100) / 100; allowed = shareDrops.every(d => d.points <= 5) && descriptionCollisionWith === null. Verified boundary constructions: 5.00 = two competitors each 9 of 18 shared-label routings with a 2-label candidate (9/18 - 9/20); 5.01 = competitor 10 of 19 (10/19 - 10/21 = 5.0125 -> 5.01).
- **One audit entry, not two**: a single AUD-01 'app.published' entry carries the full PublishGateResult via a new auditExtra param on transition(); the record no longer rides setLifecycle into the definition document.
- **declaredLabels conditional fallback**: a trigger's labels are its declared intents/aliases; the id/command fallback applies only when a trigger declares neither — the unconditional fallback added the slash command as a third domain label and inflated drops to 7.18/6.46 instead of 5.01/4.51.
- **OTel 1.9.1 gauge wiring**: createObservableGauge takes no callback argument; the callback attaches via gauge.addCallback. Version-specific and documented in routing-share.metrics.ts.
- **Structural store seam**: RoutingShareComputer and PublishGateService consume the RoutingOutcomeStore interface, not the Mongo class; specs use in-memory doubles, integration specs use the real repository.
- **Zero-change short-circuit**: an already-published candidate short-circuits the gate before any dry-run — allowed, empty shareDrops, null collision, empty changeSummary, version unmoved.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Repaired 10 pre-existing builder-element type errors**
- **Found during:** Task 1 (baseline verification before any plan work)
- **Issue:** `npx tsc -b` failed on 10 pre-existing errors in the builder element (saved-query import paths, template.seed.ts imports, connector_ref `.default(null)`, applySectionPatch double-cast, in-memory test double fields, express Request/Response types, TEMPLATE_SEEDS assertion) — the publish gate could not be type-verified against a broken baseline
- **Fix:** repaired all 10 errors without behavior change
- **Files modified:** saved-query.backfill.ts, saved-query.repository.ts, saved-query.repository.spec.ts, template.seed.ts, app-definition.service.spec.ts
- **Verification:** `npx tsc -b` exit 0
- **Committed in:** 7437adc8

**2. [Rule 1 - Bug] Corrected RED specs' doubles and expectations to the real seams**
- **Found during:** Task 1 (RED phase)
- **Issue:** the initial failing specs assumed wrong seam shapes — a collection double without cursor-toArray, metric regexes missing the otel_scope_name attribute, 2/6 rendered as 0.666667 instead of the repeating decimal 0.666666, missing owner headers on draft creation, audit baseline captured after section edits, version arithmetic v3->v4 instead of v4->v5, Map dot-access, wrong decision-element import depths, missing 7th processor arg, unescaped apostrophe
- **Fix:** corrected all doubles/expectations to the real interfaces
- **Files modified:** all 7 RED spec files
- **Verification:** specs still failed (RED preserved) but for the right reasons; turned green in 4f4ce581
- **Committed in:** 0073efdb

**3. [Rule 2 - Missing Critical] transition() auditExtra seam for the publish audit record**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** the plan required the full PublishGateResult in the audit trail, but transition() had no way to carry a rich payload without polluting the definition document via setLifecycle
- **Fix:** added an optional auditExtra param to AppDefinitionService.transition(); the AUD-01 'app.published' entry carries the complete gate result
- **Files modified:** packages/domain/src/builder/app-definition.service.ts
- **Verification:** app-definition.service.spec.ts asserts the audit entry shape
- **Committed in:** 4f4ce581

**4. [Rule 2 - Missing Critical] RoutingOutcomeStore structural interface**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** the gate and share computer needed the outcome store, but depending on the Mongo-backed class directly would make unit specs require testcontainers and couple domain logic to infrastructure
- **Fix:** extracted the structural interface (record/outcomesForIntent/outcomesForApp); RoutingOutcomeRepository implements it; specs use in-memory doubles
- **Files modified:** packages/domain/src/builder/routing-share/routing-outcome.repository.ts, routing-share.computer.ts, publish-gate.service.ts
- **Verification:** unit specs run without containers; integration spec exercises the real repository
- **Committed in:** 4f4ce581

**5. [Rule 1 - Bug] OTel 1.9.1 gauge registration shape**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** meter.createObservableGauge(name, options) in @opentelemetry/api 1.9.1 takes NO callback argument — the initially-written callback-passing form silently registered a gauge with no observations
- **Fix:** register the callback via gauge.addCallback(async (observableResult) => { ... observableResult.observe(share, { app_id: appId }) })
- **Files modified:** packages/domain/src/builder/routing-share/routing-share.metrics.ts
- **Verification:** routing-share.metrics.spec.ts asserts exported series lines with the app_id attribute
- **Committed in:** 4f4ce581 (spec corrected in 0073efdb)

**6. [Rule 1 - Bug] declaredLabels conditional id/command fallback**
- **Found during:** Task 2 (GREEN phase)
- **Issue:** the unconditional fallback added a trigger's slash command as a third domain label even when intents/aliases were declared, inflating simulated drops to 7.18/6.46 instead of the specified 5.01/4.51 boundary
- **Fix:** fallback applies only when a trigger declares neither intents nor aliases
- **Files modified:** packages/domain/src/builder/publish-gate.service.ts
- **Verification:** 5.00/5.01 boundary specs pass exactly
- **Committed in:** 891098d7

**7. [Rule 1 - Bug] Integration-spec corrections (owner headers, audit baseline, version arithmetic)**
- **Found during:** Task 1 (RED phase, integration spec)
- **Issue:** draft creation needed owner headers to pass ownership scoping; the audit baseline had to be captured before section edits; create + 3 patches + publish yields v5 (summary row v4->v5), not v4
- **Fix:** corrected the integration spec setup and expectations
- **Files modified:** apps/api/src/app-builder/publish.integration.spec.ts
- **Verification:** integration spec green; the pre-existing app-definition.integration.spec.ts still passes through the gate with an empty outcome store
- **Committed in:** 0073efdb

**8. [Rule 1 - Bug] Metrics-spec regex and decimal corrections**
- **Found during:** Task 1 (RED phase, metrics spec)
- **Issue:** exported series carry otel_scope_name="akane" (regexes must match it), and 2/6 renders as the repeating decimal 0.666666... not the rounded 0.666667
- **Fix:** regexes now match otel_scope_name and the repeating-decimal prefix
- **Files modified:** packages/domain/src/builder/routing-share/routing-share.metrics.spec.ts
- **Verification:** metrics spec asserts '# TYPE routing_share gauge' and both series lines
- **Committed in:** 0073efdb

---

**Total deviations:** 8 auto-fixed (1 Rule 3 blocking, 3 Rule 2 missing-critical, 4 Rule 1 bug)
**Impact on plan:** All auto-fixes were necessary for correctness or to unblock verification. No scope creep — every fix stays within the plan's deliverables, and no new dependencies were installed (T-0-SC honored).

## Issues Encountered
- One earlier vitest run of apps/worker showed container-timing failures (testcontainers startup race); a clean re-run passed all 6 files / 36 tests. Not a code defect.
- vitest's esbuild does not type-check; `npx tsc -b` and `npx tsc --noEmit` are the type gates for this plan (both exit 0).

## User Setup Required
None - no external service configuration required. Integration specs use testcontainers via startThreeContainers from tooling/containers.ts (Docker available).

## Next Phase Readiness
- The publish gate is consumable by the SPA publish dialog (plan 07 / phase 06-06): the 409 PUBLISH_REFUSED body names the blocking app_id and delta, and descriptionCollisionWith names the colliding app — exactly the fields the dialog needs to render the refusal
- routing_share{app_id} is live on the 'akane' meter for dashboards; the rolling 24h window fills from live chat traffic via the producer at both route() sites
- Zod 4 contracts exported from packages/contract (publish.contract.ts) for the SPA to import
- No blockers or concerns

## Self-Check: PASSED

- SUMMARY.md exists at .planning/phases/06-self-service-app-builder/06-05-SUMMARY.md
- All 7 task commits verified in git log: 7437adc8, 585cd61d, 0073efdb, 4f4ce581, 450b8e5d, 891098d7, cfd5e35d

---
*Phase: 06-self-service-app-builder*
*Completed: 2026-10-12*
