---
phase: 10-outbound-delivery-seam-event-contract
plan: 04
subsystem: adapters
tags:
  - outbound
  - teams
  - slack
  - boundaries
  - hexagonal
  - worker

# Dependency graph
requires:
  - phase: 10-outbound-delivery-seam-event-contract
    plan: 10-01
    provides: "OutboundMessage envelope with threading fields; producer-generated message_id"
  - phase: 10-outbound-delivery-seam-event-contract
    plan: 10-03
    provides: "Neutral platform-event ledger (the marking seam a delivery adapter will call next)"
provides:
  - "TeamsOutboundPort / SlackOutboundPort interfaces in packages/domain/src/adapters/<p>/outbound/"
  - "TeamsDeliveryAdapter (the Teams delivery implementation) in apps/worker/src/adapters/teams/outbound/"
  - "Per-port subpath exports on @akane/domain so a worker can import a port without the root barrel reaching a worker-only path"
  - "API Teams outbound service deleted; R1 now covers the api -> outbound-adapter edge with no exception left in place"
affects:
  - 10-06 (outbound processor): imports TeamsDeliveryAdapter and calls send() / the port token
  - 10-07 (boot assertion): the outbound registration set now has exactly one Teams implementation
  - 10-08 (integration): end-to-end delivery through the worker-only path
  - Slack delivery (later): the port exists; the implementation waits on a conversation-reference writer

# Actuals (#2632)
actuals:
  tokens: 6500
  tasks: 5
  commits: 3
plan_head_before: efd1e0c25bd635f88b3ef19140f2186cfbfbf0e9
plan_head_after: be8371ac

tech-stack:
  added: []
  patterns:
    - "Port in domain adapters/<p>/outbound/ (interfaces only); implementation in apps/worker/src/adapters/<p>/outbound/"
    - "Worker-only domain files are reachable through explicit @akane/domain subpaths, never the root barrel"
    - "Deleting a moved implementation in the same plan as its replacement, so no second copy of the send path survives"

key-files:
  created:
    - packages/domain/src/adapters/teams/outbound/teams.outbound.port.ts
    - packages/domain/src/adapters/teams/outbound/index.ts
    - packages/domain/src/adapters/slack/outbound/slack.outbound.port.ts
    - packages/domain/src/adapters/slack/outbound/index.ts
    - apps/worker/src/adapters/teams/outbound/teams-delivery.adapter.ts
    - apps/worker/src/adapters/teams/outbound/teams-delivery.adapter.spec.ts
  modified:
    - packages/domain/package.json
    - packages/domain/src/index.ts
    - apps/worker/src/app.module.ts
    - apps/worker/src/processors/notification.processor.ts
    - apps/api/src/adapters/teams/teams.module.ts
  deleted:
    - apps/api/src/adapters/teams/teams.outbound.service.ts
    - apps/api/src/adapters/teams/teams.outbound.service.spec.ts
    - apps/worker/src/adapters/teams/teams-delivery.service.ts

key-decisions:
  - "The ports are NOT re-exported from the @akane/domain root barrel. Re-exporting them put both port files in the api's import closure, and `tooling/entrypoint-drift.spec.ts` fails an explicit R1 assertion (`api and scheduler contain no worker-only specifier`) when it does. Each port gets its own package.json subpath instead, which is how the existing inbound module is already reached."
  - "The worker's existing TeamsDeliveryService was moved and renamed to TeamsDeliveryAdapter rather than duplicated: the plan asked for a worker implementation, one already existed, and keeping both would have left two copies of the send path — one unreachable from the processor and free to drift."
  - "Slack gets a port but no implementation in this plan. There is no Slack bot token, no Slack Web API client and — until 10-05's receiver — no writer of a Slack conversation reference; a 'working' adapter would have been an unwired stub in the worker's DI graph. Recorded as deferred item D-10-04-2."
  - "Tasks 3 and 4 (delete the api service, clean the module) are one commit, not two. Splitting them leaves an intermediate commit whose module imports a deleted file — the tree would not compile at that commit, which is a worse failure than a combined task commit."

patterns-established:
  - "A worker-only port's import path is part of the boundary contract: the subpath export list is where 'who may reach this' is decided, and the root barrel must stay free of it"
  - "Moving an implementation is a delete + create in one plan, with the test moving beside it — an orphaned old copy is how two send paths with different retry semantics appear"

requirements-completed:
  - OUT-12

coverage:
  - id: D1
    description: "TeamsOutboundPort and SlackOutboundPort exist under packages/domain/src/adapters/<platform>/outbound/ and import only @akane/contract"
    requirement: OUT-12
    verification:
      - kind: other
        ref: "grep -rn '^import' packages/domain/src/adapters/*/outbound/*.ts (single @akane/contract import each); npx tsc -b; npx eslint packages/domain/src"
        status: pass
    human_judgment: false
  - id: D2
    description: "Teams delivery implementation lives in apps/worker/src/adapters/teams/outbound/ and implements TeamsOutboundPort"
    requirement: OUT-12
    verification:
      - kind: unit
        ref: "npx vitest run apps/worker/src/adapters/teams/outbound/teams-delivery.adapter.spec.ts (5 tests)"
        status: pass
      - kind: other
        ref: "npx tsc -b; npx eslint apps/worker/src"
        status: pass
    human_judgment: false
  - id: D3
    description: "apps/api/src/adapters/teams/teams.outbound.service.ts deleted, its module wiring and export removed, ConversationReferenceRepository retained"
    requirement: OUT-12
    verification:
      - kind: other
        ref: "test -f apps/api/src/adapters/teams/teams.outbound.service.ts -> absent; grep TeamsOutboundService apps/api/src/adapters/teams/teams.module.ts -> comment only"
        status: pass
      - kind: unit
        ref: "npx vitest run apps/api/src/adapters/teams/teams.receiver.integration.spec.ts (7 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "R1 boundary rules still hold after the restructuring: no api -> outbound-adapter edge, no worker-only specifier in the api closure"
    requirement: OUT-12
    verification:
      - kind: integration
        ref: "npx vitest run tooling/boundaries.fixture.spec.ts (9 tests); npx eslint --max-warnings=0 tooling/boundaries.fixture.spec.ts"
        status: pass
      - kind: integration
        ref: "npx vitest run tooling/entrypoint-drift.spec.ts — R1 closure assertion passes; the only remaining failure is the pre-existing apps/api/src/forms/form-load.metrics.ts orphan (deferred-items D-10-04-1)"
        status: pass
    human_judgment: true
    rationale: "The gate text is green for every assertion this plan can affect, but the spec as a whole is red because of the phase-09 orphan. 'Pass' here means R1 is not regressed; the suite-wide result is recorded honestly in Issues Encountered."

# Metrics
duration: "~50min"
completed: 2026-10-22
status: complete
---

# Phase 10 Plan 04: Outbound Delivery Ports Move to Domain, Implementations Move to Worker Summary

**Outbound delivery now has a hexagonal seam: `TeamsOutboundPort` / `SlackOutboundPort` interfaces under the platform adapter directories, a worker-side `TeamsDeliveryAdapter` implementing them, and no outbound implementation left in the api**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-10-22T09:15Z (plan head `efd1e0c2`)
- **Completed:** 2026-10-22T09:44Z
- **Tasks:** 5
- **Files modified:** 12 (6 created, 5 modified, 3 deleted — one of the "created" is a rename of the deleted worker service, and one spec is a rename of the deleted api spec)

## Accomplishments

- **OUT-12 landed as a seam, not a move.** The port is an interface over `@akane/contract` only — no SDK, no repository, no credentials — sitting at `packages/domain/src/adapters/<platform>/outbound/`, which is exactly where the `outbound-adapter` boundary category says it belongs.
- **The api lost the ability to send.** `apps/api/src/adapters/teams/teams.outbound.service.ts` was uncalled *and* unimplementable in the request path: delivery resolves a conversation reference and calls the Agents SDK. Deleting it (with its `TEAMS_CLOUD_ADAPTER` holder, provider and module export) leaves R1 with no exception to grant, and the api's import closure no longer contains any outbound path — asserted, not assumed.
- **One send path, not two.** The worker already had `TeamsDeliveryService` with the same logic. It was moved to `apps/worker/src/adapters/teams/outbound/teams-delivery.adapter.ts`, renamed `TeamsDeliveryAdapter`, and now `implements TeamsOutboundPort`; the old file is deleted. Its spec moved with it: five tests covering the non-Teams platform guard, the missing-conversation-reference error (and its no-PII property), the real `continueConversation` invocation, retryable-vs-terminal classification, and status text passing through.
- **The subpath discipline is now explicit.** `@akane/domain`'s root barrel is in the api's import closure. Re-exporting the ports there — the obvious, minimal first move — makes the api reach a worker-only path *transitively* and trips `tooling/entrypoint-drift.spec.ts`'s R1 assertion. Each port therefore has its own `exports` entry, mirroring how `adapters/teams/inbound/teams-inbound.module.js` is already reached.

## Task Commits

Each task (with tasks 3+4 combined, see Decisions) was committed atomically:

1. **Task 1: Create outbound port interfaces in domain** — `64016778` (feat) — plus the `packages/domain/package.json` subpath exports the ports need to be importable at all
2. **Task 2: Create worker-side implementations** — `848e45ea` (feat) — the moved adapter + moved spec + processor/composition-root imports
3. **Tasks 3+4: Delete the API Teams outbound service and its wiring** — `be8371ac` (refactor)
4. **Task 5: Verify boundaries still pass** — no code change; verification is recorded in `coverage.D4`

Measured with the plan ledger (`$(git rev-parse --git-dir)/gsd-plan-head-before-10-04` = `efd1e0c2`):
`git rev-list --count efd1e0c2..HEAD` = **3**.

## Files Created/Modified

- `packages/domain/src/adapters/teams/outbound/teams.outbound.port.ts` (new) — `TeamsOutboundPort.send(message: OutboundMessage)`, with the R1 / T-10-06 rationale in the docblock.
- `packages/domain/src/adapters/teams/outbound/index.ts` (new) — barrel.
- `packages/domain/src/adapters/slack/outbound/slack.outbound.port.ts` (new) — `SlackOutboundPort.send(...)` and the Phase-10 scope note.
- `packages/domain/src/adapters/slack/outbound/index.ts` (new) — barrel.
- `packages/domain/package.json` — two subpath exports (`adapters/teams/outbound/teams.outbound.port.js`, `adapters/slack/outbound/slack.outbound.port.js`).
- `packages/domain/src/index.ts` — documents why outbound ports are subpath-only; **no** new root export.
- `apps/worker/src/adapters/teams/outbound/teams-delivery.adapter.ts` (moved/renamed from `teams-delivery.service.ts`) — `TeamsDeliveryAdapter implements TeamsOutboundPort`, `TEAMS_CLOUD_ADAPTER` token and `TeamsCloudAdapterHolder` travel with it; the unused `deliver`/`deliverToTeams` aliases were dropped.
- `apps/worker/src/adapters/teams/outbound/teams-delivery.adapter.spec.ts` (moved from `apps/api/src/adapters/teams/teams.outbound.service.spec.ts`) — retargeted at `send`/`sendMessage`; the `sendFormLink` case went away with the api-only method.
- `apps/worker/src/app.module.ts`, `apps/worker/src/processors/notification.processor.ts` — import `TeamsDeliveryAdapter` from the outbound path.
- `apps/api/src/adapters/teams/teams.module.ts` — `TeamsOutboundService` / `TEAMS_CLOUD_ADAPTER` providers and the module export removed; `ConversationReferenceRepository` retained and documented as the writer the worker reads from.
- `apps/api/src/adapters/teams/teams.outbound.service.ts`, `.spec.ts`, `apps/worker/src/adapters/teams/teams-delivery.service.ts` — deleted.

## Decisions Made

See `key-decisions` in the frontmatter. The two a reviewer should check first:

1. **No root-barrel export for the ports.** It compiles, it lints, and it still fails the build gate — `entrypoint-drift` walks the api's real import closure and found both port files there. Subpath exports are the pattern the inbound module already uses.
2. **Slack port without a Slack implementation.** The plan's `files_modified` lists `apps/worker/src/adapters/slack/outbound/slack-delivery.adapter.ts`. It is not created; the reason is in Deviations #2 and `deferred-items.md` D-10-04-2.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Ports could not be re-exported from the domain root; the R1 closure gate caught it in the first verification run**
- **Found during:** Task 1 verification (`npx vitest run tooling/entrypoint-drift.spec.ts` on the completed plan)
- **Issue:** Re-exporting `TeamsOutboundPort` / `SlackOutboundPort` from `packages/domain/src/index.ts` put both `adapters/*/outbound/*.port.ts` files in the api's import closure. `tooling/entrypoint-drift.spec.ts` asserts `api and scheduler contain no worker-only specifier (D-03 R1)` and reported exactly those two files. `boundaries/dependencies` (R1's element policy) did **not** catch it — the import is legal; only the transitive reach is wrong.
- **Fix:** removed both root exports and the accompanying comment claim; added explicit `exports` entries in `packages/domain/package.json` for the two port files; the worker imports `@akane/domain/adapters/teams/outbound/teams.outbound.port.js`. `packages/domain/src/index.ts` now documents the mirror-image reason to the existing inbound comment.
- **Files modified:** `packages/domain/src/index.ts`, `packages/domain/package.json`, `apps/worker/src/adapters/teams/outbound/teams-delivery.adapter.ts`
- **Verification:** `npx vitest run tooling/entrypoint-drift.spec.ts` → the R1 assertion passes; `npx tsc -b` → exit 0.
- **Committed in:** `64016778` (Task 1) and `848e45ea` (Task 2)

**2. [Rule 4 — Architectural] Slack delivery implementation not created**
- **Found during:** Task 2 (before writing any Slack code)
- **What the plan asked for:** `apps/worker/src/adapters/slack/outbound/slack-delivery.adapter.ts` implementing `SlackOutboundPort`.
- **Why it cannot exist yet:** no Slack bot token configuration, no Slack Web API client in the dependency graph, and no producer of a Slack conversation reference (10-05 lands the receiver and verifier only). Delivery needs `(channel_id, chat_user_id) -> conversation reference`; with no writer, every send would throw the "no conversation reference" branch. Wiring it into `app.module.ts` providers would also sit dead in the worker's DI graph.
- **Decision taken:** ship the port (the OUT-12 seam), defer the implementation. CONTEXT's own scoping — "Phase 10 only needs the seam, ports, and at least Teams wired through the new path" — makes Teams sufficient for OUT-12, and the Zalo/Telegram impls are explicitly deferred to Phases 12-13 on the same prerequisite.
- **Where recorded:** `deferred-items.md` D-10-04-2.
- **Not a stub:** nothing is wired and doing nothing; there is simply no Slack implementation file, and the port says so.

**3. [Process — not a plan deviation] Tasks 3 and 4 committed together**
- **Why:** Task 3 deletes `teams.outbound.service.ts`; Task 4 removes the module's references to it. Committed separately, Task 3's commit does not compile. One commit (`be8371ac`) carries both.
- **Files modified:** `apps/api/src/adapters/teams/teams.module.ts` + the two deletions.

---

**Total deviations:** 2 auto-fixed (1 bug, 1 Rule-4 architectural decline) + 1 commit-grouping note.
**Impact on plan:** OUT-12's structural requirement is fully met for Teams and at the interface level for Slack. No scope creep; the only unimplemented item is the one that would have been a stub.

## Threat Flags

None. No new network endpoint, auth path or trust boundary is introduced — the change **narrows** the api's reachable surface by deleting an outbound implementation from the request path.

Mitigations from the plan's threat model, as implemented:

- **T-10-06 (Elevation of Privilege: api outbound access, high / mitigate):** the api's outbound service is deleted rather than left uncalled; the module no longer provides `TEAMS_CLOUD_ADAPTER`; and `tooling/entrypoint-drift.spec.ts` proves the api's import closure contains no worker-only path (the assertion that caught the root-barrel re-export). R1's `outbound-adapter` category is the static half; the closure walk is the transitive half.

## Known Stubs

None. `TeamsDeliveryAdapter.send()` is a complete implementation with its previous coverage moved alongside it. The Slack port has no implementation by design (deviation #2) — an absent file is not a stub; a wired no-op would have been.

## Issues Encountered

- **The build gate found what lint could not.** `boundaries/dependencies` passed the root-barrel re-export cleanly (the api's `import '@akane/domain'` does not name an outbound path). `tooling/entrypoint-drift.spec.ts` walks the closure and failed. Worth remembering: for worker-only ports, the subpath list — not the boundary rule — is the enforcement point.
- **`tooling/entrypoint-drift.spec.ts` is still red repo-wide**, on exactly one pre-existing orphan: `apps/api/src/forms/form-load.metrics.ts` (last touched by `625460f5`, phase 09; nothing imports it). Classified in `deferred-items.md` D-10-04-1 with the evidence, not fixed here (scope boundary).
- **`npx tsc -b` exceeded the 120 s foreground budget** and auto-detached on the first attempt; the follow-up run completed at exit 0. Same observation as 10-03: a full build here is not a fast check.
- **A `git commit --amend` with a staged index absorbed unrelated staged deletions.** Recovered with `git reset --soft` back to the plan ledger head and rebuilt the three commits with explicit path staging. The published history is the rebuilt one; no data was lost, but this is the second reason to stage per-commit paths rather than leaving `git rm` output sitting in the index.

## User Setup Required

None. No new environment variable, token or service. `@microsoft/agents-hosting` and the Teams env vars were already required by the worker's delivery path.

## Next Phase Readiness

- **10-06 (outbound processor)** can inject `TeamsDeliveryAdapter` (already provided in `apps/worker/src/app.module.ts`) and treat the port as the swap point for other platforms.
- **10-07 (boot assertion)** should register exactly one outbound port per platform: Teams has an implementation, Slack has a port only. The assertion must read its set from a registration list, not from a directory scan, or the missing Slack implementation will look like an OUT-03 violation rather than a documented deferral.
- **Cutover is not complete.** The notification path still calls `TeamsDeliveryAdapter` directly; routing it through a `TeamsOutboundPort` token (and adding the message-level ledger `markDispatched` after a successful send) is 10-06/10-08 work. Nothing in this plan enqueues an outbound job.
- **Slack delivery** needs a conversation-reference writer (10-05) before its adapter is worth writing; see `deferred-items.md` D-10-04-2.

---
*Phase: 10-outbound-delivery-seam-event-contract*
*Completed: 2026-10-22*

## Self-Check: PASSED

- Created files: all 4 verified present (`teams.outbound.port.ts`, `slack.outbound.port.ts`, `teams-delivery.adapter.ts`, `teams-delivery.adapter.spec.ts`)
- Commits: `64016778`, `848e45ea`, `be8371ac` all present in history
- Deletion: `apps/api/src/adapters/teams/teams.outbound.service.ts` absent
