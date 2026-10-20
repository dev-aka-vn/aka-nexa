/**
 * The emitted-metric registry (OBS-03, D-18, P14).
 *
 * Single source of truth for every metric this platform emits: both the OTel
 * instrument name (as passed to `meter.create*`) and the Prometheus-scraped
 * name (dots become underscores) for each. Plan 09-04's rule-file and dashboard
 * tests read `SCRAPED_NAMES`; the external-exporter tier (Q5) is a separate
 * set so a rule can reference a Redis/Mongo exporter series without pretending
 * the app emits it.
 */

export type MetricTier = 'APP' | 'EXTERNAL_SCRAPED';

export type MetricKind = 'counter' | 'histogram' | 'gauge' | 'updowncounter';

export interface EmittedMetric {
  /** The OTel instrument name, as passed to `meter.create*()`. */
  readonly instrument: string;
  /** The Prometheus-scraped name the exporter renders (`.` -> `_`). */
  readonly scraped: string;
  readonly kind: MetricKind;
  readonly tier: MetricTier;
  /** Source of truth for the emit site. */
  readonly emitSite: string;
  /** The OBS-03/OBS-06 signal this satisfies, or `null` for supporting signals. */
  readonly satisfies: string | null;
}

export const EMITTED_METRICS: readonly EmittedMetric[] = [
  {
    instrument: 'platform.heartbeat',
    scraped: 'platform_heartbeat',
    kind: 'counter',
    tier: 'APP',
    emitSite: 'packages/platform/src/queue/platform-heartbeat.job.ts',
    satisfies: 'OBS-03',
  },
  {
    instrument: 'queue.job.failures',
    scraped: 'queue_job_failures',
    kind: 'counter',
    tier: 'APP',
    emitSite: 'packages/platform/src/queue/*',
    satisfies: 'OBS-03',
  },
  {
    instrument: 'queue.depth',
    scraped: 'queue_depth',
    kind: 'gauge',
    tier: 'APP',
    emitSite: 'packages/platform/src/metrics/queue.metrics.ts',
    satisfies: 'OBS-03',
  },
  {
    instrument: 'queue.oldest.item.age',
    scraped: 'queue_oldest_item_age',
    kind: 'gauge',
    tier: 'APP',
    emitSite: 'packages/platform/src/metrics/queue.metrics.ts',
    satisfies: 'OBS-03',
  },
  {
    instrument: 'submission.status',
    scraped: 'submission_status',
    kind: 'counter',
    tier: 'APP',
    emitSite: 'packages/platform/src/metrics/business-metrics.ts',
    satisfies: 'OBS-03',
  },
  {
    instrument: 'connector.outcome',
    scraped: 'connector_outcome',
    kind: 'counter',
    tier: 'APP',
    emitSite: 'packages/platform/src/metrics/business-metrics.ts',
    satisfies: 'OBS-03',
  },
  {
    instrument: 'routing_share',
    scraped: 'routing_share',
    kind: 'gauge',
    tier: 'APP',
    emitSite: 'packages/domain/src/builder/routing-share/routing-share.metrics.ts',
    satisfies: 'OBS-03',
  },
  {
    instrument: 'read_link_denials_total',
    scraped: 'read_link_denials_total',
    kind: 'counter',
    tier: 'APP',
    emitSite: 'apps/api/src/common/metrics/read-deny.metrics.ts',
    satisfies: 'OBS-03',
  },
  {
    instrument: 'read_link_signature_blocks_total',
    scraped: 'read_link_signature_blocks_total',
    kind: 'counter',
    tier: 'APP',
    emitSite: 'apps/api/src/common/metrics/read-deny.metrics.ts',
    satisfies: 'OBS-03',
  },
  {
    instrument: 'jev_decision_duration_ms',
    scraped: 'jev_decision_duration_ms',
    kind: 'histogram',
    tier: 'APP',
    emitSite: 'packages/domain/src/decision/decision.metrics.ts',
    satisfies: 'OBS-03',
  },
  {
    instrument: 'jev_decision_confidence',
    scraped: 'jev_decision_confidence',
    kind: 'histogram',
    tier: 'APP',
    emitSite: 'packages/domain/src/decision/decision.metrics.ts',
    satisfies: 'OBS-03',
  },
  {
    instrument: 'rbac_resolution_duration_ms',
    scraped: 'rbac_resolution_duration_ms',
    kind: 'histogram',
    tier: 'APP',
    emitSite: 'packages/domain/src/acl/acl.metrics.ts',
    satisfies: 'OBS-03',
  },
  {
    instrument: 'read_link_tokens_issued_total',
    scraped: 'read_link_tokens_issued_total',
    kind: 'counter',
    tier: 'APP',
    emitSite: 'apps/api/src/read/read-link.metrics.ts',
    satisfies: 'OBS-03',
  },
  {
    instrument: 'read_link_token_consume_total',
    scraped: 'read_link_token_consume_total',
    kind: 'counter',
    tier: 'APP',
    emitSite: 'apps/api/src/read/read-link.metrics.ts',
    satisfies: 'OBS-03',
  },
  {
    instrument: 'form_load_duration_ms',
    scraped: 'form_load_duration_ms',
    kind: 'histogram',
    tier: 'APP',
    emitSite: 'apps/api/src/forms/form-load.metrics.ts',
    satisfies: 'OBS-03',
  },
  {
    instrument: 'im_active_connections',
    scraped: 'im_active_connections',
    kind: 'updowncounter',
    tier: 'APP',
    emitSite: 'packages/platform/src/metrics/im-connection.metrics.ts',
    satisfies: 'OBS-03',
  },
];

export const SCRAPED_NAMES: ReadonlySet<string> = new Set(
  EMITTED_METRICS.map((m) => m.scraped),
);

export const EXTERNAL_SCRAPED: ReadonlySet<string> = new Set([
  'redis_memory_used_bytes',
  'redis_memory_max_bytes',
  'mongodb_mongod_replset_member_replication_lag',
]);