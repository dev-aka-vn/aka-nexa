---
phase: 09-production-readiness
plan: 03
subsystem: observability
tags: [OBS-03, OBS-10, metrics, runbooks]
requires: [09-01]
provides: [metric-registry, emitted-metric-completeness, runbooks]
affects: [09-04]
tech-stack:
  added: []
  patterns: [single-otel-meter, memoised-instruments, dotted-to-underscore-mapping]
key-files:
  created:
    - packages/platform/src/metrics/metric-registry.ts
    - packages/platform/src/metrics/metric-registry.spec.ts
    - packages/platform/src/metrics/queue.metrics.ts
    - packages/platform/src/metrics/im-connection.metrics.ts
    - packages/domain/src/decision/decision.metrics.ts
    - packages/domain/src/acl/acl.metrics.ts
    - apps/api/src/read/read-link.metrics.ts
    - apps/api/src/forms/form-load.metrics.ts
    - docs/runbooks/decision-provider-outage.md
    - docs/runbooks/connector-timeout-spike.md
    - docs/runbooks/redis-oom.md
    - docs/runbooks/im-webhook-failure.md
    - docs/runbooks/double-submission-reports.md
    - docs/runbooks/README.md
  modified:
    - packages/platform/src/metrics/business-metrics.ts
    - packages/platform/src/metrics/index.ts
    - packages/domain/src/decision/routing-orchestrator.ts
    - packages/domain/src/decision/published-app-loader.ts
    - apps/api/src/read/read.controller.ts
metrics:
  duration: "unknown"
  completed: "2026-10-20"
status: complete
---

# Phase 09 Plan 03: Metric registry and runbooks Summary

Registry lives at `packages/platform/src/metrics/metric-registry.ts` (overrides the alternative `observability/metric-names.ts` name in 09-RESEARCH P14) because `packages/platform` already owns business metrics and must be importable by its own specs.

## External scraped (Q5)
`EXTERNAL_SCRAPED` contains `redis_memory_used_bytes`, `redis_memory_max_bytes`, and `mongodb_mongod_replset_member_replication_lag`; these come from Redis/MongoDB exporters, not from this repo.

## Q4 disposition
`form_load_duration_ms` is server-measured at the form renderer request path, not client render time.

## Instruments
| instrument | scraped |
|---|---|
| platform.heartbeat | platform_heartbeat |
| queue.job.failures | queue_job_failures |
| queue.depth | queue_depth |
| queue.oldest.item.age | queue_oldest_item_age |
| submission.status | submission_status |
| connector.outcome | connector_outcome |
| routing_share | routing_share |
| read_link_denials_total | read_link_denials_total |
| read_link_signature_blocks_total | read_link_signature_blocks_total |
| jev_decision_duration_ms | jev_decision_duration_ms |
| jev_decision_confidence | jev_decision_confidence |
| rbac_resolution_duration_ms | rbac_resolution_duration_ms |
| read_link_tokens_issued_total | read_link_tokens_issued_total |
| read_link_token_consume_total | read_link_token_consume_total |
| form_load_duration_ms | form_load_duration_ms |
| im_active_connections | im_active_connections |

## Alert-to-runbook mapping
- AkaneConnectorFailureRate, AkaneDlqDepthHigh -> connector-timeout-spike.md
- AkaneTokenConsumeFailure -> double-submission-reports.md / im-webhook-failure.md
- AkaneDecisionConfidenceLow, AkaneDecisionProvidersAllDown -> decision-provider-outage.md
- AkaneRedisMemoryHigh -> redis-oom.md
- AkaneMongoReplicationLag -> external exporter (no app runbook)
- AkanePartialSubmissions -> double-submission-reports.md

## Deviations from Plan
None - plan executed as written.

## Self-Check: PASSED