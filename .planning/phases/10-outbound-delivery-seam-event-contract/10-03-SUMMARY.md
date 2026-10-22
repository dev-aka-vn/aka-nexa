---
phase: 10-outbound-delivery-seam-event-contract
plan: 03
subsystem: database
tags:
  - mongodb
  - platform-events
  - deduplication
  - outbox
  - reconciliation
  - boundaries
  - zod

# Dependency graph
requires:
  - phase: 10-outbound-delivery-seam-event-contract
    plan: 10-01
    provides: "InboundEvent/OutboundMessage envelopes with threading + platform metadata (and the Zod 4 record fix this plan had to repair)"
  - phase: 10-outbound-delivery-seam-event-contract
    plan: 10-02
    provides: "Platform-scoped ConversationReferenceRepository key"
  - phase: 08-notifications
    provides: "The teams_events ledger this plan generalizes"
provides:
  - "PlatformEventRepository — neutral, platform-agnostic event ledger in packages/domain/src/platform-events/"
  - "Unique composite index (platform, platform_event_id) as the OUT-09 dedupe contract"
  - "pending -> dispatched state machine via markDispatched(platformEventId, platform)"
  - "findPending() reconciliation read and sweepOlderThan(days) 30-day retention sweep (OUT-11)"
  - "platform-events as a first-class domain element type + R3 file category in tooling/boundaries.config.mjs"
  - "TeamsEventRepository reduced to a stateless Teams-scoped facade over the ledger"
affects:
  - 10-04-outbound-seam (worker reconciler imports the ledger through the neutral path)
  - 10-05-slack-receiver (dedupe write uses the same ledger; no adapter-specific copy)
  - 10-08-integration (wires the reconciler + retention sweep, proves OUT-09/10/11 at runtime)
  - any future IM adapter (Telegram, Zalo) — the ledger is already platform-neutral

# Actuals (#2632)
actuals:
  tokens: 6100
  tasks: 4
  commits: 5
plan_head_before: a9bce31c35e09f963e8131732fc00300ae5a84cc
plan_head_after: 7c1b30477ea79d3fddd23fc515b2e1f4e7d70cfe

tech-stack:
  added: []
  patterns:
    - "Dedicated fail-fast MongoClient for ack-path writes, separate from the shared MongoService"
    - "Duplicate-key error treated as a successful 'already seen' outcome, not an error"
    - "State-filtered compare-and-set transition (pending -> dispatched) applied exactly once"
    - "Domain element type added together with the code that lives in it (D-02)"

key-files:
  created:
    - packages/domain/src/platform-events/platform-event.repository.ts
    - packages/domain/src/platform-events/index.ts
  modified:
    - packages/domain/src/index.ts
    - packages/domain/src/adapters/teams/inbound/data-access/teams-event.repository.ts
    - packages/domain/src/adapters/teams/inbound/teams-inbound.module.ts
    - tooling/boundaries.config.mjs
    - packages/contract/src/events/inbound-event.ts
    - packages/contract/src/events/outbound-message.ts

key-decisions:
  - "Ledger timeouts are 40 ms, not the 500 ms inherited from TeamsEventRepository — the phase decision memo names 500 ms as wrong for a 200 ms ack budget, and the plan's own task text says '<50ms as per CONTEXT'. The plan's `key_links` pattern (`serverSelectionTimeoutMS.*500`) is the stale half of that contradiction."
  - "`platform-events` is registered as its own element type rather than left as an unclassified directory: an unclassified file is entirely outside the boundary graph (empirically confirmed — R3 does not fire), so D-02's 'explicit config change per domain subdirectory' is also the only thing keeping R3 live there."
  - "The R3 allowance is a new file category scoped to `packages/domain/src/platform-events/**` rather than moving the file under a `data-access/` subdirectory. The ledger IS the element, and the plan's declared artifact path is the element root."
  - "markDispatched filters on `state: 'pending'` so the reconciler and the live delivery path cannot both transition the same row; the boolean means 'this call performed the transition', not 'the row exists'."
  - "sweepOlderThan is not state-filtered. A pending row older than 30 days is past any reconciliation horizon, and re-driving a 30-day-old message is worse for the user than dropping it."
  - "TeamsEventRepository is kept as a stateless facade instead of being deleted. The receiver rewrite belongs to 10-04/10-05; keeping the subpath export stable is what lets each commit stand alone."

patterns-established:
  - "Ack-path ledger: the only storage write permitted in a receiver is the dedupe insert, on a dedicated client whose every timeout is <50 ms, and a duplicate is a success"
  - "A new domain subdirectory ships with its element type + file category in the same commit — otherwise the directory is invisible to `boundaries/dependencies` and its restrictions are silently inert"
  - "Platform-agnostic schema keys are always (platform, <platform-specific-id>) composites; never a globally-unique platform id"

requirements-completed:
  - OUT-09
  - OUT-10
  - OUT-11

coverage:
  - id: D1
    description: "PlatformEventRepository with a platform-agnostic document, unique composite index on (platform, platform_event_id), pending/dispatched state, markDispatched(), findPending()"
    requirement: OUT-09
    verification:
      - kind: other
        ref: "npx tsc -b && npm run lint (packages/domain/src/platform-events/)"
        status: pass
    human_judgment: true
    rationale: "tsc + lint prove the contract compiles and respects the boundary model; they do not prove the unique index rejects a duplicate or that the pending->dispatched transition is applied exactly once. That needs a live Mongo and is proven at integration in 10-08."
  - id: D2
    description: "30-day retention sweep — sweepOlderThan(days) deleting ledger entries older than the cutoff"
    requirement: OUT-11
    verification:
      - kind: other
        ref: "npx tsc -b && npm run lint"
        status: pass
    human_judgment: true
    rationale: "The cutoff arithmetic is not covered by any test; verification of actual deletion behaviour requires a live collection and the scheduler wiring that lands in 10-08."
  - id: D3
    description: "TeamsEventRepository generalized to a stateless facade over the ledger; TeamsInboundModule provides the ledger without exporting a platform-specific path to it"
    requirement: OUT-09
    verification:
      - kind: other
        ref: "npx tsc -b; npx eslint packages/domain/src/adapters/teams/inbound/; npx vitest run tooling/boundaries.fixture.spec.ts"
        status: pass
    human_judgment: true
    rationale: "Compilation and lint prove the delegation and the boundary edges; the behavioural claim ('the Teams receiver still dedupes identically against the new collection') is only exercisable against a live Mongo."
  - id: D4
    description: "platform-events module surface exported from its own barrel and from the domain root, reachable by both api and worker without importing an inbound adapter"
    requirement: OUT-10
    verification:
      - kind: other
        ref: "grep -n 'platform-events' packages/domain/src/index.ts; npx tsc -b; npm run lint; npx vitest run tooling/boundaries.fixture.spec.ts"
        status: pass
    human_judgment: false

# Metrics
duration: "~50min (session start lost to a context compaction; task commits span 2026-10-22T09:08:29Z..09:09:49Z)"
completed: 2026-10-22
status: complete
---

# Phase 10 Plan 03: Platform Event Ledger Summary

**Platform-agnostic event ledger with a `(platform, platform_event_id)` dedupe index, a `pending → dispatched` state machine, reconciliation and 30-day sweep — with `TeamsEventRepository` reduced to a stateless facade over it**

## Performance

- **Duration:** ~50 min (session start not instrumented after a context compaction; the recorded task-commit window is 2026-10-22T09:08:29Z → 09:09:49Z)
- **Started:** 2026-10-22T09:08:29Z (first commit)
- **Completed:** 2026-10-22T09:11:26Z
- **Tasks:** 4
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments

- `PlatformEventRepository` is the neutral ledger: one `platform_events` collection, a composite unique index on `(platform, platform_event_id)`, and a `state` column that makes "did we deliver this?" answerable — the three things the Teams-shaped `teams_events` document could not do.
- The dedupe write stays on the ack path (OUT-10's narrow reading: no *read*) on a dedicated client with 40 ms server-selection/connect/socket timeouts, so a Mongo outage fails the request fast instead of holding the platform's retry window open.
- Reconciliation (OUT-09) and retention (OUT-11) now have a home that both the api and the worker can reach without crossing `adapters/*/inbound/` — which R1 forbids the worker from doing.
- `platform-events` became a real element type with a real R3 file category. This was not cosmetic: an unclassified directory is **entirely outside** `boundaries/dependencies`, so a raw `mongodb` import there would have passed the build gate.
- `TeamsEventRepository` keeps its `insert(platformEventId, payload)` signature and its subpath export while owning no client, no timeouts and no index promise of its own — two clients on one collection would have meant two copies of the ack-path budget, one of which silently drifts.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create platform-events module with generalized ledger** — `eea79506` (feat) — includes the `tooling/boundaries.config.mjs` change the file requires to be reachable and to keep R3 live
2. **Task 2: Add exports to platform-events index** — `3209a559` (feat)
3. **Task 3: Export platform-events from domain root** — `84ab297c` (feat)
4. **Task 4: Generalize or update TeamsEventRepository usage** — `7c1b3047` (feat)

**Pre-task repair (deviation):** `eb6a1ac9` (fix) — see Deviations #1.

**Plan metadata:** committed separately by the executor's final `docs(10-03)` commit.

Measured with the plan ledger (`$(git rev-parse --git-dir)/gsd-plan-head-before-10-03` = `a9bce31c`):
`git rev-list --count a9bce31c..HEAD` = **5**.

## Files Created/Modified

- `packages/domain/src/platform-events/platform-event.repository.ts` (new) — the ledger: `record()`, `markDispatched()`, `findPending()`, `sweepOlderThan()`, `close()`; dedicated 40 ms client; two indexes.
- `packages/domain/src/platform-events/index.ts` (new) — module barrel (values + types).
- `packages/domain/src/index.ts` — root barrel re-export, so api and worker share one import path.
- `packages/domain/src/adapters/teams/inbound/data-access/teams-event.repository.ts` — reduced from ~90 lines owning a client to a 15-line stateless facade.
- `packages/domain/src/adapters/teams/inbound/teams-inbound.module.ts` — provides `PlatformEventRepository` for the facade; deliberately does not export it.
- `tooling/boundaries.config.mjs` — `platform-events` element type, `platform-events-owner` file category, `adapters → platform-events` edge, R3 allow-list + message.
- `packages/contract/src/events/inbound-event.ts`, `packages/contract/src/events/outbound-message.ts` — Zod 4 `z.record` arity repair (deviation #1).

## Decisions Made

See `key-decisions` in the frontmatter. The two that a reviewer should check first:

1. **40 ms, not 500 ms.** `10-CONTEXT.md:123` states the 500 ms ledger timeout is wrong for a 200 ms budget and must be tightened to <50 ms; the plan's `<task>` text says the same. Only the plan's `must_haves.key_links[0].pattern` still encodes `500`. The decision memo and the task text win over the pattern.
2. **The boundary config change is load-bearing, not paperwork.** Verified empirically: a `mongodb` import from `packages/domain/src/submissions/` produces the R3 error, while the identical import from an unclassified directory produces **no diagnostic at all**. Leaving `platform-events` unclassified would have been a silent hole in the one rule that keeps raw drivers out of non-data-access code.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 + Rule 3 — Bug / Blocking] Zod 4 `z.record` arity broke `tsc -b` repo-wide**
- **Found during:** Task 1 verification (`npx tsc -b`)
- **Issue:** `packages/contract/src/events/inbound-event.ts:46` and `outbound-message.ts:31` called `z.record(z.union([...]))`. Zod 4 removed the single-argument `z.record(valueSchema)` overload: `error TS2554: Expected 2-3 arguments, but got 1`. Both lines were introduced by `6c0c98d4` (plan 10-01), so `npm run build` could not pass anywhere in the repo, and no plan-10 task could be verified or committed.
- **Fix:** `z.record(z.string(), z.union([...]))` in both files — the form every other `z.record` in the repo already uses.
- **Files modified:** `packages/contract/src/events/inbound-event.ts`, `packages/contract/src/events/outbound-message.ts`
- **Verification:** `npx tsc -b` → exit 0; `npm run lint` → exit 0.
- **Committed in:** `eb6a1ac9` (separate commit, so the ledger commit stays clean and the repair is attributable to 10-01's output)

**2. [Rule 3 — Blocking] The plan's artifact path could not exist without a boundary-config change**
- **Found during:** Task 1 (before writing any code)
- **Issue:** `packages/domain/src/platform-events/` is a new `packages/domain/src/*` subdirectory. D-02 (encoded in `tooling/boundaries.config.mjs:31-63`) requires an explicit element-type declaration for every such directory, and `packages/domain/src/index.ts` says the same. Empirically confirmed that without it the directory is outside the boundary graph: R3 *does not fire* for a `mongodb` import there, and the directory's own outgoing edges are unchecked too. The plan's `files_modified` does not list `tooling/boundaries.config.mjs`.
- **Fix:** Added `platform-events` to `DOMAIN_ELEMENT_TYPES`, `platform-events: Object.freeze([])` to `ALLOWED_EDGES` (leaf — imports no domain element), `platform-events` to `adapters`' allowed targets, a `platform-events-owner` file category (`packages/domain/src/platform-events/**`), and that category to R3's allow-list + message. `10-08-PLAN.md` already lists the same file with "Boundaries config updated if needed", so this is the first half of a change that plan expected anyway.
- **Files modified:** `tooling/boundaries.config.mjs`
- **Verification:** `npx eslint packages/domain/src/platform-events/` → clean; `npx vitest run tooling/boundaries.fixture.spec.ts` → 9/9 pass (R1/R2/R3 still fire; the resolver canaries still hold); a throwaway probe confirmed a `pipeline` → `platform-events` import is now **rejected** ("no policy allowing dependencies from elements of type `pipeline`…"), proving the element type is live rather than inert.
- **Committed in:** `eea79506` (Task 1 commit — the config change is what makes that commit's file legal)

**3. [Rule 2 — Missing critical] Added the `(state, createdAt)` index alongside the required unique index**
- **Found during:** Task 1 (writing `findPending`/`sweepOlderThan`)
- **Issue:** The plan specifies only the unique composite index. `findPending()` runs every reconciler tick against a table OUT-11 lets grow for 30 days, and `sweepOlderThan` filters on `createdAt` — both would be collection scans. Missing indexes are an explicitly listed Rule 2 category.
- **Fix:** `createIndex({ state: 1, createdAt: 1 }, { name: 'platform_event_state_created' })`, created in the same memoised `ensureIndex()`.
- **Files modified:** `packages/domain/src/platform-events/platform-event.repository.ts`
- **Verification:** `npx tsc -b` → exit 0.
- **Committed in:** `eea79506` (Task 1 commit)

**4. [Rule 2 — Missing critical] `TeamsInboundModule` had to provide the ledger once the facade stopped owning a client**
- **Found during:** Task 4
- **Issue:** Making `TeamsEventRepository` a facade changes its constructor dependency from `ConfigService` to `PlatformEventRepository`. Without a provider the Nest DI graph fails at boot, not at compile time — so `tsc` would not have caught it.
- **Fix:** Added `PlatformEventRepository` to `TeamsInboundModule.providers`. Verified `ConfigService` resolves globally (`packages/platform/src/config/config.module.ts` is `@Global()`), so `PlatformEventRepository`'s own `ConfigService` dependency needs no import.
- **Files modified:** `packages/domain/src/adapters/teams/inbound/teams-inbound.module.ts`
- **Verification:** `npx tsc -b` exits 0 (no `strictPropertyInitialization`/DI diagnostics); provider graph inspected by hand.
- **Committed in:** `7c1b3047` (Task 4 commit)

---

**Total deviations:** 4 auto-fixed (1 bug, 1 blocking, 2 missing critical)
**Impact on plan:** No scope creep. Deviation #1 repairs a build break that predates this plan and blocked every subsequent plan in the phase. #2 is the D-02 config change the plan's own file list omitted. #3 and #4 are consequences of taking OUT-09/OUT-10/OUT-11 literally (reconciliation query, retention query, and a facade that must still be injectable).

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: boundary-widening | tooling/boundaries.config.mjs | R3's allow-list gained a fourth category (`platform-events-owner`), scoped to `packages/domain/src/platform-events/**`. This is the only new place in `packages/domain` outside `**/data-access/**` that may import the raw `mongodb` driver. Reviewed as intentional: the module is a data-access layer by role, is a leaf element, and is now covered by the boundary smoke test. |

Mitigations from the plan's threat model, as implemented:

- **T-10-04 (DoS via ledger timeouts, high / mitigate):** dedicated `MongoClient` with 40 ms `serverSelectionTimeoutMS`/`connectTimeoutMS`/`socketTimeoutMS`; receivers fail closed (the existing Teams receiver already maps a thrown insert to `503`).
- **T-10-05 (Repudiation via dedupe, medium / mitigate):** unique composite index on `(platform, platform_event_id)`; `record()` returns `'duplicate'` for an `E11000`, so a retry is observably "already seen" rather than a second processing.

## Known Stubs

None. The ledger has no placeholder branches, no hardcoded empties and no unwired data sources. `findPending()` and `sweepOlderThan()` have no caller yet — the reconciler and the retention job are 10-08's job — but they are complete implementations, not stubs.

## Issues Encountered

- **`tsc -b --dry` is not a baseline.** The pre-execution baseline was "all projects up to date", which says nothing about correctness; the first real `npx tsc -b` surfaced 10-01's Zod break. Worth remembering for later plans in this phase: a stale `.tsbuildinfo` hides type errors.
- **`npx tsc -b` exceeded the 120 s foreground budget** and was auto-detached mid-run; the retry after settling completed cleanly. No action needed, but a full build in this repo is not a fast check.
- **Boundary inertness had to be proven empirically, twice.** Reading the config suggested R3 would fire; the plugin's own gate (`dependency.from.file.isIgnored`) means it does not for unclassified files. The rule is only as strong as the element-type coverage it runs over.

## User Setup Required

None — no external service configuration required. `MONGO_URL` was already required by the pre-existing `TeamsEventRepository`; the ledger reads the same key.

## Next Phase Readiness

- **10-04 (outbound seam)** can import `PlatformEventRepository` from `@akane/domain` in the worker and call `markDispatched(platformEventId, platform)` after a successful send. The `adapters → platform-events` edge is declared, so a worker-side reconciler needs no boundary change.
- **10-05 (Slack receiver)** should call `record({ platform: 'slack', platformEventId, payload })` and treat `'duplicate'` as `200` with no enqueue — the Teams receiver's existing shape.
- **Collection rename is a live concern.** `teams_events` is no longer written; `10-08` (or an ops note) should decide whether the old collection is dropped or left for the 30-day sweep to age out on the old path. No data migration was performed — the ledger is new, and the pre-existing rows are dedupe tombstones, not content.
- **No runtime proof yet.** OUT-09/OUT-10/OUT-11 are structurally complete but unexercised against a live Mongo. `10-VERIFICATION.md` already routes that proof to plan 10-08, which must wire the reconciler and the scheduler sweep.

---
*Phase: 10-outbound-delivery-seam-event-contract*
*Completed: 2026-10-22*

## Self-Check: PASSED
