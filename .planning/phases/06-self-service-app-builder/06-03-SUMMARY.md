---
phase: 06-self-service-app-builder
plan: 03
subsystem: identity
tags: [otp, redis, onboarding, identity, slack, tdd, lua, lockout, brute-force]

# Dependency graph
requires:
  - phase: 02-the-vertical-slice-slack-internal-routing
    provides: inbound-event processor (the chat pipeline this plan wires into) and IdentityMappingRepository
  - phase: 06-self-service-app-builder/06-01
    provides: ALLOWED_EDGES.builder extended with identity, links, contract (lint boundary permissions for the new files)
provides:
  - "OtpStateMachine — Redis-backed OTP policy: 10-minute TTL, 3 attempts, 30-minute lockout from the third failed attempt, integer counts via INCR, atomic Lua scripts"
  - "OtpOnboardingService — requestOtp/verifyOtp; a verified onboarding creates the chat-identity → real_user_id mapping (randomUUID)"
  - "OtpDeliveryPort — the chat pipeline's delivery seam; worker-side OtpDeliveryService logs the chat identity, never the code"
  - "InboundEventProcessor wiring — onboarding intent (keyword regex) requests an OTP, a 6-digit code reply verifies it"
  - "Zod 4 contracts (packages/contract/src/identity/otp.contract.ts): OtpCodeSchema (/^\\d{6}$/), OTP_ONBOARDING_INTENT"
affects: [06-04, 06-05, 06-06, 06-07, 06-08]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 13796
  tasks: 2
  commits: 4

# Tech tracking
tech-stack:
  added: [] # no new libraries — Node stdlib crypto (SHA-256, randomUUID) over the existing ioredis connection
  patterns:
  - "Atomic Lua scripts via redis.eval for read-check-write state transitions (request + verify) — plain TS read-check-INCR-write had a lockout-clobber race under concurrency"
  - "Per-identity key namespacing: akane:otp:{chatUserId} (JSON record, TTL = OTP_TTL_MS) + akane:otp:{chatUserId}:attempts (INCR counter); lockout write sets TTL = OTP_LOCKOUT_MS so the lockout survives restarts (AD-9)"
  - "Consumed tombstone (status 'consumed', TTL = original remaining window) distinguishes replay (OTP_CONSUMED) from never-requested (OTP_EXPIRED)"
  - "Injectable clock (now: () => number) on the state machine for TTL-boundary tests without waiting 10 minutes"
  - "Defense in depth on expiry: the Redis TTL is the only expiry mechanism, and a stale read that races the TTL still refuses via the record's expiresAt field"

key-files:
  created:
  - packages/domain/src/identity/otp/otp-state-machine.ts
  - packages/domain/src/identity/otp/otp-state-machine.spec.ts
  - packages/domain/src/identity/otp/otp-onboarding.service.ts
  - packages/domain/src/identity/otp/otp-delivery.port.ts
  - packages/contract/src/identity/otp.contract.ts
  - apps/worker/src/processors/otp-onboarding.integration.spec.ts
  - apps/worker/src/processors/otp-delivery.service.ts
  modified:
  - apps/worker/src/processors/inbound-event.processor.ts
  - apps/worker/src/processors/inbound-event.processor.spec.ts
  - apps/worker/src/worker.module.ts
  - packages/domain/src/index.ts
  - packages/contract/src/index.ts

key-decisions:
  - "OTP state transitions run as atomic Lua scripts (redis.eval) — the request and verify paths are read-check-INCR-write, and a plain TypeScript implementation lost lockout updates under concurrent verify calls"
  - "Lockout arms on the THIRD failed attempt (not the first) and lasts exactly 30 minutes from that third failure; the third attempt itself returns invalid with attemptsRemaining: 0, the fourth returns locked"
  - "Successful verify leaves a short-lived consumed tombstone so replay is refused with OTP_CONSUMED, distinct from OTP_EXPIRED for a never-requested or lapsed code"
  - "Plaintext OTP code exists only in memory between the state machine and the delivery-port call — only its SHA-256 hash is persisted (T-06-13)"
  - "Injectable clock on OtpStateMachine so the 10-minute boundary (9:59 verifies, 10:01 refused) is tested deterministically"

patterns-established:
  - "Pattern: chat-pipeline onboarding — inbound-event processor detects the onboarding intent, delegates to a domain service over a delivery port, and never touches the OTP policy itself"
  - "Pattern: policy-as-Lua — Redis-semantics-dependent invariants (attempt budgets, lockouts, single-use) live in server-side scripts, asserted over testcontainers Redis, never a mock"

requirements-completed: [IDN-05]

# Coverage metadata (#1602) — one entry per shipped deliverable. Drives DETERMINISTIC UAT routing in verify-work.
coverage:
  - id: D1
    description: "OTP state machine over real Redis: 10-minute TTL expiry boundary (9:59 verifies / 10:01 refused OTP_EXPIRED), 3-attempt budget with integer INCR counts, 30-minute lockout armed at the third failure, single-use codes (OTP_CONSUMED replay), per-identity key isolation, every transition recorded with attempt count, state survives restarts"
    requirement: IDN-05
    verification:
      - kind: unit
        ref: "packages/domain/src/identity/otp/otp-state-machine.spec.ts — 13 specs (expiry boundary, attempts, lockout arm/refusal/reset, replay, cross-identity, concurrency, transitions)"
        status: pass
      - kind: integration
        ref: "npx vitest run packages/domain/src/identity/otp apps/worker/src/processors/otp-onboarding.integration.spec.ts --maxWorkers=1 — 2 files, 16 tests passed over testcontainers Redis 8.10 + MongoDB 8.0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Inbound-event processor wiring: an unmapped user's onboarding intent creates the OTP state and delivers the code through the chat pipeline's delivery port; a correct 6-digit reply verifies it and creates the identity mapping (real_user_id) so the employee can immediately use an app they were granted (ROADMAP SC#3)"
    requirement: IDN-05
    verification:
      - kind: integration
        ref: "apps/worker/src/processors/otp-onboarding.integration.spec.ts — 3 specs over testcontainers (request → deliver → verify → mapped; wrong code → attemptsRemaining; 4th attempt → locked)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Live OTP delivery through the real Slack pipeline — the code actually arrives in the employee's Slack DM"
    requirement: IDN-05
    verification: []
    human_judgment: true
    rationale: "Needs a real IM provider leg (06-VALIDATION.md 'Manual-Only Verifications': 'Manual Slack OTP leg in staging; state machine itself is integration-tested'). The worker-side OtpDeliveryService logs the chat identity only — the live Slack send is intentionally not automated."

# Metrics
duration: 61min
completed: 2026-10-12
status: complete
plan_head_before: e04f7def
plan_head_after: 2cedc020f8dbbdb7cde253173a5b69a8a3db2260

---

# Phase 6 Plan 03: OTP Self-Service Onboarding Summary

**Redis-backed OTP self-onboarding — 10-minute TTL, 3-attempt budget, 30-minute lockout via atomic Lua scripts, wired into the inbound chat pipeline (IDN-05)**

## Performance

- **Duration:** 61 min
- **Started:** 2026-10-12T05:11:19Z
- **Completed:** 2026-10-12T06:12:01Z
- **Tasks:** 2
- **Files modified:** 12 (7 created, 5 modified)

## Accomplishments
- OTP state machine over real Redis with the exact IDN-05 policy: 10-minute expiry, 3 attempts, 30-minute lockout from the third failed attempt — all transitions atomic via Lua scripts
- OtpOnboardingService joining the OTP flow to identity: a verified onboarding creates the chat-identity → real_user_id mapping (the ROADMAP SC#3 self-service path)
- InboundEventProcessor wiring: onboarding intent requests an OTP through the chat pipeline's delivery port; a 6-digit code reply verifies it
- Zod 4 contracts for the OTP wire shape; plaintext code never persisted (SHA-256 hash only)

## Task Commits

Each task was committed atomically (TDD: red → green per task):

1. **Task 1 (tracer, tdd): End-to-end OTP self-onboarding** — `d22d3b6b` (test, RED) + `43db714d` (feat, GREEN)
2. **Task 2 (auto, tdd): Policy edges — expiry boundary, attempt limit, 30-minute lockout, replay refusal** — `f8de113b` (test, RED) + `2cedc020` (feat, GREEN)

## Files Created/Modified
- `packages/domain/src/identity/otp/otp-state-machine.ts` — OTP policy: request/verify as atomic Lua scripts, OTP_TTL_MS / OTP_MAX_ATTEMPTS / OTP_LOCKOUT_MS constants, injectable clock
- `packages/domain/src/identity/otp/otp-onboarding.service.ts` — requestOtp/verifyOtp; verified onboarding upserts the identity mapping (randomUUID)
- `packages/domain/src/identity/otp/otp-delivery.port.ts` — OtpDeliveryPort interface (the chat pipeline's delivery seam)
- `packages/domain/src/identity/otp/otp-state-machine.spec.ts` — 13 specs incl. TTL boundary, lockout arm/refusal/reset, replay, cross-identity, concurrency
- `packages/contract/src/identity/otp.contract.ts` — Zod 4 contracts: OtpCodeSchema (/^\d{6}$/), OTP_ONBOARDING_INTENT
- `apps/worker/src/processors/otp-onboarding.integration.spec.ts` — 3 integration specs over testcontainers (Redis 8.10 + MongoDB 8.0)
- `apps/worker/src/processors/otp-delivery.service.ts` — worker-side delivery: logs the chat identity, never the code
- `apps/worker/src/processors/inbound-event.processor.ts` — 6th constructor param (OtpOnboardingService); handleUnmappedOnboarding / handleOtpRequest / handleOtpVerify
- `apps/worker/src/worker.module.ts` — DI wiring: OtpStateMachine (REDIS_CACHE), 'OTP_DELIVERY_PORT', OtpOnboardingService
- `apps/worker/src/processors/inbound-event.processor.spec.ts` — two construction sites updated for the new constructor param (in-memory seams)
- `packages/domain/src/index.ts`, `packages/contract/src/index.ts` — barrel exports

## Decisions Made
- **Atomic Lua scripts over plain TS+INCR:** the request and verify paths are read-check-write; a TypeScript implementation passed review but lost lockout updates when two verifies raced (lockout clobbered). Both transitions now run as `redis.eval` scripts — the race is structurally impossible.
- **Lockout timing:** the third failed attempt returns `invalid` with `attemptsRemaining: 0` AND arms the lockout; the fourth returns `locked`. The 30 minutes run from the third failure, not the first.
- **Expiry defense in depth:** the Redis TTL is the only expiry mechanism, but a stale read racing the TTL still refuses via the record's `expiresAt` field — both paths asserted in specs.
- **Consumed tombstone:** successful verify keeps a short-lived record (status `consumed`, TTL = original remaining window) so a replay is refused with `OTP_CONSUMED`, distinct from `OTP_EXPIRED` for a code that was never requested or whose window fully lapsed.
- **Key layout:** `akane:otp:{chatUserId}` (JSON record) + `akane:otp:{chatUserId}:attempts` (INCR counter); the lockout write sets TTL = OTP_LOCKOUT_MS so a lockout survives a Redis restart (AD-9: no in-memory counters).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Worker DI wiring for the OTP onboarding providers**
- **Found during:** Task 1 (implementation)
- **Issue:** The plan's file list did not include `apps/worker/src/worker.module.ts`, but NestJS cannot construct the modified `InboundEventProcessor` (new `OtpOnboardingService` constructor param) without the providers registered: `OtpStateMachine` (with the shared REDIS_CACHE connection), the `'OTP_DELIVERY_PORT'` token, and `OtpOnboardingService` itself. The worker would fail at bootstrap.
- **Fix:** Added the three providers to `WorkerModule`.
- **Files modified:** apps/worker/src/worker.module.ts
- **Verification:** Integration specs boot the full processor path over testcontainers and pass (3/3).
- **Committed in:** 43db714d (Task 1 green commit)

**2. [Rule 3 - Blocking] Existing inbound-processor specs failed to construct**
- **Found during:** Task 1 (implementation) — `tsc -b` and the existing spec run failed after the processor gained a 6th constructor param
- **Issue:** `inbound-event.processor.spec.ts` constructs `InboundEventProcessor` at two sites; both needed the new `OtpOnboardingService` argument. Blocking — the build and regression suite could not pass without it.
- **Fix:** Both construction sites now pass an `OtpOnboardingService` wired to in-memory seams (fake state machine / mapping repo / delivery port), preserving the existing 12 specs' behavior.
- **Files modified:** apps/worker/src/processors/inbound-event.processor.spec.ts
- **Verification:** Existing `inbound-event.processor.spec.ts` 12/12 passed (regression).
- **Committed in:** 43db714d (Task 1 green commit)

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 blocking)
**Impact on plan:** Both auto-fixes are required for the worker to compile and boot. No scope creep — no behavior beyond IDN-05 was added.

## Issues Encountered
- **16 pre-existing TypeScript errors in apps/api** (auth.session.integration.spec.ts ×4, oidc-issuer.stub.ts ×1, session.middleware.ts ×1, sso-mapping.integration.spec.ts ×10) surfaced when this plan's dependency changes forced an api rebuild through a stale tsbuildinfo. They originate in plan 06-02 (which ran vitest only, no typechecking) and are identical at the base commit e04f7def — verified by reverting all 06-03 changes and re-running `tsc -b`. Out of scope per the deviation rules; documented in `deferred-items.md` for the 06-02 owner.

## Known Stubs
- `apps/worker/src/processors/otp-delivery.service.ts` — `OtpDeliveryService` logs the chat identity (never the code) instead of calling the live Slack API. This is intentional: the live Slack leg is the manual-verify item per `06-VALIDATION.md` ("Manual Slack OTP leg in staging; state machine itself is integration-tested"). A future plan replaces this with the real Slack chat.postMessage leg.

## User Setup Required
None - no external service configuration required. (The staging Slack leg for D3 is a manual verification step, not setup.)

## Next Phase Readiness
- IDN-05 complete: the employee self-onboarding path works end-to-end over real Redis and is wired into the inbound chat pipeline
- Ready for 06-04+ (subsequent builder plans); the OTP delivery port is the single seam a future Slack-delivery plan implements
- Open item: 16 pre-existing apps/api type errors from 06-02 (deferred, tracked in deferred-items.md)

## Self-Check: PASSED

- `.planning/phases/06-self-service-app-builder/06-03-SUMMARY.md` exists
- All 4 task commits verified in git history: d22d3b6b, 43db714d, f8de113b, 2cedc020

---
*Phase: 06-self-service-app-builder*
*Completed: 2026-10-12*
