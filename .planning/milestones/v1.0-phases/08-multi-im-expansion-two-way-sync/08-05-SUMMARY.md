---
phase: 08-multi-im-expansion-two-way-sync
plan: 05
subsystem: api
tags: [teams, agents-hosting, bullmq, ioredis, nonce-replay, zod, contract, build-gate, gap-closure]

# Dependency graph
requires:
  - phase: 07-multi-form-apps-per-form-triggers
    provides: the Phase 8 Teams adapter + external-webhook sources whose bad-subpath imports and untyped SDK usage broke the repo build
provides:
  - "`npm run build` (eslint . && tsc -b) exits 0 repo-wide — the Phase 8 build gate every later gap-closure plan verifies on top of"
  - "Contract types imported from the `@akane/contract` root in every Phase 8 file (the import shape 08-06/07/08 build on)"
  - "Nonce store injects `REDIS_CACHE` (ioredis `Redis`) with `SET key '1' EX <window> NX`, only `'OK'` succeeding"
  - "Teams controller builds its `AgentApplication<TurnState>` lazily from `loadAuthConfigFromEnv()` + `CloudAdapter`, so a testing module without Teams env still boots"
affects: [08-06, 08-07, 08-08, 08-09, 09-*, verify-work]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 3880        # chars/4 over the realized code diff (15,520 chars, 6 files)
  tasks: 1
  commits: 1          # MEASURED at SUMMARY authoring: git rev-list --count 467344c2..HEAD (the 08-05 code commit; the metadata commit follows this file)
  plan_head_before: 467344c2d9211afb7bd48b71d242c142c7f78860   # HEAD before the 08-05 code commit
  plan_head_after: 2848214fd39d9aa0a922986a063ec274de8a1d38    # HEAD immediately after the 08-05 code commit, at SUMMARY authoring

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy SDK-app factory: build the SDK application on first use, not in the constructor, so env-dependent auth config never blocks module boot"
    - "Narrow-then-use helpers for untrusted `unknown` (readErrorStatus / readBodyStatus) instead of `any` indexing at the boundary"

key-files:
  created: []
  modified:
    - apps/api/src/adapters/teams/teams.controller.ts
    - apps/api/src/adapters/teams/teams.outbound.service.ts
    - apps/api/src/webhooks/external/external-webhook.service.ts
    - apps/api/src/webhooks/external/external-webhook.consumer.ts
    - apps/api/src/webhooks/external/external-webhook.controller.ts
    - apps/api/src/webhooks/external/nonce-store.service.ts

key-decisions:
  - "Type-only import fixes, not a redesign: 08-06 and 08-07 own the receiver and webhook-service rewrites, so this plan only makes the six files compile"
  - "Import contract types from the `@akane/contract` root (the package exports no `events/*` subpath) and `Queue`/`Job` from `bullmq` (type-only) — `@akane/platform` exports no `queue/queue.js`"
  - "Inject the nonce cache through the `REDIS_CACHE` symbol token (from `@akane/platform`) with the ioredis `Redis` type, matching the `apps/api/src/auth/oidc.service.ts` precedent"
  - "Use the SDK's `loadAuthConfigFromEnv()` env factory and a module-level `AgentApplication<TurnState>` type argument instead of constructing the `AuthConfiguration` type (a type, not a constructible value)"
  - "Derive the Teams Activity type as `TurnContext['activity']` rather than importing `@microsoft/agents-activity`, which is a transitive (phantom) dependency"
  - "Type the controller's `@Req`/`@Res` params with the SDK's framework-agnostic `Request`/`WebResponse` (re-exported from the SDK root) instead of widening the repo's minimal `apps/api/src/types/express.d.ts`"

patterns-established:
  - "Env-dependent SDK construction belongs in a lazy factory — constructors stay bootable without runtime credentials"
  - "Untrusted `unknown` is narrowed by a named helper before any property access; `any` never appears in an adapter boundary"

requirements-completed: [IM-10, NOT-02]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "`npm run build` — `eslint .` reports 0 errors and `tsc -b` reports 0 errors across the whole repository (the Phase 8 build gate closed)"
    requirement: IM-10
    verification:
      - kind: other
        ref: "`set -o pipefail && npm run build 2>&1 | tail -20` → exit 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "The six Phase 8 files carry no `any`, no unused imports, and no import from a non-existent package subpath (contract from the `@akane/contract` root; `Queue`/`InjectQueue` from `bullmq`/`@nestjs/bullmq`)"
    requirement: IM-10
    verification:
      - kind: other
        ref: "`npx eslint apps/api/src/adapters/teams apps/api/src/webhooks/external` → exit 0; `npx tsc -b` → exit 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "Nonce replay detection preserved: `redis.set(key, '1', 'EX', windowSeconds, 'NX')` with only the string `'OK'` treated as success, any other reply raising `UnauthorizedException`"
    requirement: NOT-02
    verification: []
    human_judgment: true
    rationale: "This is a runtime Redis semantic (atomicity + null-on-existing-key). 08-05 is a compile-only gate and no test in this plan exercises the nonce store end-to-end; `ExternalWebhookModule` does not yet register the `REDIS_CACHE` provider (08-07 owns that wiring), so a runtime boot of the class is not possible here. Runtime UAT belongs to 08-07."
  - id: D4
    description: "`tooling/entrypoint-drift.spec.ts` passes — the three entrypoints cannot drift"
    verification:
      - kind: unit
        ref: "tooling/entrypoint-drift.spec.ts#every app source file is reachable from its own main.ts"
        status: fail
    human_judgment: true
    rationale: "Pre-existing, out-of-scope failure. At HEAD the spec reported 2 failures (this orphan test + a bad-subpath resolution error); after 08-05 it reports 1 — this plan removed one failure and created none. The 5 orphaned files (slack adapter ×3, link-error.filter.ts, permission.guard.ts) are outside 08-05's six-file scope and wiring them is a composition-root change. Logged in deferred-items.md as D-08-05-1."

# Metrics
duration: ~95min
started: 2026-10-19T10:34:00Z
completed: 2026-10-19
status: complete
---

# Phase 8 Plan 05: Repo Build Gate (Phase 8 gap closure) Summary

**`npm run build` (eslint . && tsc -b) now exits 0 repo-wide — 7 ESLint and 14 tsc errors across the six Phase 8 Teams-adapter and external-webhook files fixed by type- and import-only edits, unblocking every later gap-closure plan.**

## Performance

- **Duration:** ~95min (approximate wall-clock, executor spawn → plan commit; most of it spent verifying the installed Agents SDK 1.9.1 / bullmq / ioredis type surfaces under `node_modules` before editing)
- **Started:** 2026-10-19T10:34:00Z (approx.)
- **Completed:** 2026-10-19T12:09:20Z
- **Tasks:** 1
- **Files modified:** 6

## Accomplishments

- **Build gate closed.** `eslint .` → 0 errors, `tsc -b` → 0 errors, repo-wide. The plan's `<verify>` (`set -o pipefail && npm run build 2>&1 | tail -20`) exits 0.
- **TS2307 bad-subpath imports eliminated.** `@akane/contract/events/inbound-event.js`, `@akane/contract/events/outbound-message.js`, `@akane/platform/queue/queue.js`, and `@akane/platform/cache/redis-cache.js` do not exist; all contract types now come from the `@akane/contract` root, `Queue`/`Job` from `bullmq` (type-only), `InjectQueue` from `@nestjs/bullmq`.
- **SDK typing corrected against the installed package.** `AgentApplication` is generic → `AgentApplication<TurnState>`; `AuthConfiguration` is a type, not a constructible value → replaced with the SDK's `loadAuthConfigFromEnv()` plus an explicit `CloudAdapter`; `app.processActivity` does not exist → `app.adapter.process(req, res, (context) => app.run(context))`.
- **Lazy app construction.** The Teams controller builds its `AgentApplication` on first use (a `getAgentApp()` factory) rather than in the constructor, so a testing module that never handles a Teams turn boots without Teams connection env vars.
- **`any` removed from both boundaries.** `normalizeTeamsActivity` is typed with the SDK's own Activity shape (`TurnContext['activity']`); `isRetryableError(error: unknown)` narrows through a new `readErrorStatus` helper; `catch (error: unknown)`; `payload.body` is narrowed through a new `readBodyStatus` helper before indexing.
- **Replay semantics preserved verbatim.** `nonce-store.service.ts` now injects the cache via `@Inject(REDIS_CACHE)` typed as ioredis `Redis` and calls `redis.set(key, '1', 'EX', windowSeconds, 'NX')`, treating only `'OK'` as success — any other reply (i.e. `null`, meaning the key already existed) raises `UnauthorizedException`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix all 21 build-gate errors (7 ESLint + 14 tsc) in Phase 8 files** — `2848214f` (fix)

**Plan metadata:** this commit (docs: complete plan)

_Note: single-task plan; one code commit + one metadata commit._

## Files Created/Modified

- `apps/api/src/adapters/teams/teams.controller.ts` — root-barrel `InboundEventSchema`/`InboundEvent` import; `InjectQueue('im:inbound')` with the `bullmq` `Queue` type; lazy `AgentApplication<TurnState>` factory using `loadAuthConfigFromEnv()` + `CloudAdapter`; single `onActivity('message')` registration; SDK `Request`/`WebResponse` param types; typed `normalizeTeamsActivity` (`TeamsActivity = TurnContext['activity']`) with `occurred_at` normalised to an ISO string.
- `apps/api/src/adapters/teams/teams.outbound.service.ts` — typed `AgentApplication<TurnState>`; env-based `CloudAdapter`; new module-level `readErrorStatus(error: unknown)`; `catch (error: unknown)`; `isRetryableError(error: unknown)`.
- `apps/api/src/webhooks/external/external-webhook.service.ts` — `InjectQueue('notification:send')`; root-barrel `OutboundMessageSchema`/`OutboundMessage`; new `readBodyStatus(body: unknown)` narrowing the untrusted body before indexing.
- `apps/api/src/webhooks/external/external-webhook.consumer.ts` — `import type { Job } from 'bullmq'`; `handle(job: Job)` with a `Record<string, unknown>` payload.
- `apps/api/src/webhooks/external/external-webhook.controller.ts` — removed the unused `import * as crypto from 'crypto'`.
- `apps/api/src/webhooks/external/nonce-store.service.ts` — `@Inject(REDIS_CACHE) private readonly redis: Redis` with the ioredis value import; `SET ... EX ... NX` with `'OK'`-only success.

## Decisions Made

- **Type-and-import fixes only, no redesign.** 08-06 (pipeline rewrite) and 08-07 (webhook service + module wiring) own the real receiver work; this plan's job was to hand them a compiling base. The controller/webhook-service shapes were left structurally as found.
- **`@InjectQueue` literals, not constants.** `'im:inbound'` / `'notification:send'` are used as literal queue names, matching what the sources already used; 08-09 introduces `INBOUND_EVENTS_QUEUE` / `NOTIFICATION_SEND_QUEUE` and replaces the literals.
- **`TurnContext['activity']` instead of `import type { Activity } from '@microsoft/agents-activity'`.** That package is a transitive (phantom) dependency, not declared in `package.json`; deriving the type from the SDK surface already depended on avoids inventing a dependency edge.
- **Do not widen `apps/api/src/types/express.d.ts`.** The repo's ambient express module is deliberately minimal (no `end`/`headersSent`/`writableEnded`, `send` returns `void`), so express `Response` is structurally not the SDK's `WebResponse`. Retyping the two controller params with the SDK's own framework-agnostic `Request`/`WebResponse` (both re-exported from the SDK root barrel) is a 0-file-change fix and keeps the ambient declaration's intent.
- **Preserve the exact truthiness semantics in `readBodyStatus`.** Returning `undefined` for any falsy `status` mirrors the original `payload.body?.['status'] || <default>` test, so `''`/`0`/`null` still fall through to the default text rather than stringifying to `"0"`/`""`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Collapsed a double-enqueue on every Teams message**

- **Found during:** Task 1 (`teams.controller.ts` rewrite)
- **Issue:** The file registered *both* `app.onMessage(...)` and a catch-all `app.onActivity(...)` handler that re-enqueued whenever `activity.type === 'message'` — two registrations that each produced an `im:inbound` job for the same message.
- **Fix:** Both collapses into one `app.onActivity('message', ...)` handler, which expresses the same intended behaviour (only `message` activities enqueue) without the ambiguous duplicate registration. Aside from removing the double-enqueue hazard, the enqueue payload/`jobId` are unchanged.
- **Files modified:** `apps/api/src/adapters/teams/teams.controller.ts`
- **Verification:** `npx tsc -b` → 0 errors; `npm run build` → exit 0; the enqueue call (`queue.add('im:inbound', inboundEvent, { jobId: inboundEvent.event_id })`) is byte-identical to the original.
- **Committed in:** `2848214f`

**2. [Rule 3 - Blocking] Normalised `occurred_at` to an ISO string**

- **Found during:** Task 1 (`teams.controller.ts` typing fix)
- **Issue:** `occurred_at: activity.timestamp ?? now` — the SDK's `Activity.timestamp` is `Date | string | undefined`, so a `Date` would have been assigned where the contract requires an ISO string (and the `InboundEventSchema.parse` at the boundary would reject or the value would diverge).
- **Fix:** `activity.timestamp ? new Date(activity.timestamp).toISOString() : now`.
- **Files modified:** `apps/api/src/adapters/teams/teams.controller.ts`
- **Verification:** `npx tsc -b` → 0 errors; `InboundEventSchema.parse` is still the boundary validator.
- **Committed in:** `2848214f`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both are strictly inside the six `files_modified` and are necessary for correctness (the first removes a latent duplicate job; the second makes the value satisfy the contract the code already validated against). No scope creep, no redesign, no new dependencies.

## Issues Encountered

- **The Agents SDK has no `processActivity` and no `auth` option.** Resolved by reading the installed `@microsoft/agents-hosting` type declarations under `node_modules` and switching to `app.adapter.process(req, res, logic)` with a `CloudAdapter(loadAuthConfigFromEnv())` built lazily.
- **`apps/api/src/types/express.d.ts` is intentionally minimal.** Resolved by typing the controller params with the SDK's framework-agnostic `Request`/`WebResponse` rather than expanding the ambient declaration (which would have been a 7th modified file).
- **`tooling/entrypoint-drift.spec.ts` still fails — pre-existing and out of scope.** Proven so by running the spec against the pristine `HEAD` versions of the six files (2 failed | 16 passed) versus the merged state (1 failed | 17 passed). Logged as `D-08-05-1` in `deferred-items.md`; see Coverage `D4`.

## Known Stubs

None. No placeholder values, no unwired data sources, no TODOs introduced by this plan.

## Threat Flags

None. The plan is type/import-only: no new endpoints, auth paths, file-access patterns, or schema changes at a trust boundary. `T-08-SC` (supply-chain tampering via `npm/pip/cargo installs`) was mitigated as planned — **no package installs were performed**; every symbol referenced (`bullmq`, `@nestjs/bullmq`, `@microsoft/agents-hosting`, `ioredis`, `@akane/contract`, `@akane/platform`) was already in the tree.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Ready:** the repo build gate is green, so 08-06/07/08/09 can each run their own verify on top of it. Contract imports now come from the `@akane/contract` root in all six files, which is the import shape those plans build on.
- **Blocker / owner note:** `ExternalWebhookModule` does not yet register the `REDIS_CACHE` provider, so `NonceStoreService` would fail DI at runtime until 08-07 wires it — this plan is a compile-only gate and does not boot those classes. 08-09 replaces the literal queue names (`'im:inbound'`, `'notification:send'`) with `INBOUND_EVENTS_QUEUE` / `NOTIFICATION_SEND_QUEUE` and adds the D-37 api-producer allowance.
- **Carried forward:** the pre-existing `entrypoint-drift.spec.ts` orphan failure (`deferred-items.md` → `D-08-05-1`) is unrelated to Phase 8 and needs a composition-root owner.

---
*Phase: 08-multi-im-expansion-two-way-sync*
*Completed: 2026-10-19*

## Self-Check: PASSED
