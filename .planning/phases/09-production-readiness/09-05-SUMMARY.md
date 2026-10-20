---
phase: 09-production-readiness
plan: 05
subsystem: production-readiness
tags: [throttler, rate-limiting, k6, load-testing, redis, commandstats, ci]
requires: [09-01, 09-03, 09-04]
provides:
  - Three named throttler tiers (perUser, perApp, perConnector) on hand-written Redis storage
  - k6 scenario set (open model for events, closed model for users) with ack budget threshold
  - commandstats-based measurement of throttler Redis cost
  - pinned-image k6 smoke job in CI
affects: [09-06]
tech-stack:
  added:
    - "@nestjs/throttler@6.7.1"
  patterns:
    - Hand-written ThrottlerStorage over ioredis (cache connection)
    - k6 constant-arrival-rate + ramping-vus executors
    - INFO commandstats delta measurement
key-files:
  created:
    - apps/api/src/common/throttler/redis-throttler.storage.ts
    - apps/api/src/common/throttler/redis-throttler.storage.spec.ts
    - apps/api/src/common/throttler/throttler.module.ts
    - load/k6/scenarios.js
    - load/k6/thresholds.js
    - load/k6/scenarios.spec.ts
    - load/k6/lib/redis-commandstats.js
    - load/k6/lib/redis-commandstats.spec.ts
    - load/k6/README.md
  modified:
    - apps/api/src/app.module.ts
    - packages/platform/src/config/config.schema.ts
    - .github/workflows/ci.yml
    - vitest.config.mts
    - docs/ARCHITECTURE.md
decisions:
  - "@nestjs/throttler@6.7.1 install approved via blocking human checkpoint (all six metadata checks passed)."
  - "Throttler counter runs on the cache Redis connection; queue connection is never used."
  - "Rate limits key on user and link jti, never on IP."
  - "Dropped-iterations budget set to 1% (0.01) for the open-model scenario."
  - "Full target-load k6 run is on-demand; CI runs a smoke-level single-VU 5s run."
metrics:
  duration: 0
  completed: 2026-10-20
status: complete
actuals:
  tokens: 86000
  tasks: 3
  commits: 3
  plan_head_before: b56b3581
  plan_head_after: bc320979a29da424eedf2ffbef5d0d43edb7c908
---

# Phase 09 Plan 05: Production Readiness (Throttler + Load) Summary

**One-liner:** Three named throttler tiers (perUser/perApp/perConnector) on a hand-written Redis storage over the cache connection, a k6 scenario set offering 50 events/s as an open model and 1,000 users as a closed model with the webhook ack budget asserted as a threshold, and a commandstats-based measurement of the throttler's per-request Redis cost.

## @nestjs/throttler legitimacy checkpoint outcome
Approved. All six metadata checks passed (NestJS org maintainer, MIT license, peers accept Nest 12 and Node 24, repository nestjs/throttler). Installed `@nestjs/throttler@6.7.1`.

## Dropped-iterations budget
1% (0.01). An open-model executor at target load is expected to drop a small number of iterations under saturation; requiring exactly zero would make the test flaky without improving safety. 1% is small enough to catch a genuinely broken run and large enough to absorb scheduler jitter on a shared CI runner.

## Measured per-request Redis cost
The full target-load run was not executed in this phase (on-demand, requires resources a CI runner does not have). The smoke-level CI run exercises scenario structure and the harness only. The measurement procedure is documented in `load/k6/README.md`; the parser (`load/k6/lib/redis-commandstats.js`) divides commandstats deltas by the throttled request count and reports per-command, so round-trips per request is derivable. No assumed figure is reported.

## Pinned grafana/k6 image tag
`grafana/k6:0.53.0`

## Deviations from Plan
None - plan executed exactly as written.

## Self-Check: PASSED
- All task commits present
- `npm run build` passes
- `npx vitest run apps/api/src/common/throttler load/k6` passes (21 tests)