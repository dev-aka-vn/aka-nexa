---
phase: 05-integration-async-execution
plan: 05
subsystem: throttling-metrics
tags: [throttler, redis, metrics, connector-rate-limit]
dependency_graph:
  requires: [05-01]
  provides: [throttler-storage-redis, business-metrics-enhanced]
  affects: [api-throttler, platform-metrics]
tech-stack:
  added: []
  patterns: [redis-backed-storage, otel-metrics]
key-files:
  created:
    - apps/api/src/common/throttler/throttler-storage-redis.spec.ts
    - packages/domain/src/connectors/rate-limit.integration.spec.ts
  modified:
    - apps/api/src/common/throttler/throttler-storage-redis.ts
    - packages/platform/src/metrics/business-metrics.ts
    - packages/platform/src/metrics/business-metrics.spec.ts
    - packages/platform/src/metrics/index.ts
decisions: []
metrics:
  duration_minutes: 6
  completed: "2026-10-10T02:15:00Z"
  status: complete
actuals:
  tokens: 38000
  tasks: 3
  commits: 1
---

# Phase 05 Plan 05: Throttling & Business Metrics

## One-liner
Redis-backed per-connector throttler storage (atomic INCR+PEXPIRE), extended business metrics with submission_status and connector_outcome counters on the single 'akane' meter.

## What was built
- **ThrottlerStorageRedis**: Replaced in-memory Map with Redis-backed storage using atomic Lua script (INCR + PEXPIRE) via shared REDIS_CACHE client. Keys are connector-instance scoped. Returns totalHits and timeToExpire in seconds. Injectable via NestJS.
- **Business metrics**: Added SUBMISSION_STATUS_METRIC ('submission.status') and CONNECTOR_OUTCOME_METRIC ('connector.outcome') counters on the single akane meter. Extended BusinessMetrics interface, registration logic, and index exports. Metrics carry appropriate attribute dimensions (status, app_id, taxonomy_code).
- **Tests/specs**: Added throttler-storage-redis.spec.ts with Redis-backed integration tests (process-shared state), updated business-metrics.spec.ts for new counters, added rate-limit.integration.spec.ts scaffold.

## Deviations from Plan
None. Implementation follows plan requirements (atomic increments, connector-instance keying, fail-closed posture as documented).

## Verification
- throttler-storage-redis.spec.ts: 2/2 passed (shared Redis state, atomic increments with expiry)
- business-metrics.spec.ts: 7/7 passed (all counters registered on akane meter)
- Other related tests pass

## Self-Check: PASSED

All tasks completed, implementation correct, tests pass.