import { metrics, type Histogram } from '@opentelemetry/api';

import { METER_NAME } from '@akane/platform';

export const RBAC_RESOLUTION_DURATION_METRIC = 'rbac_resolution_duration_ms';

let cached: Histogram | undefined;

export function registerAclMetrics(): Histogram {
  if (cached === undefined) {
    const meter = metrics.getMeter(METER_NAME);
    cached = meter.createHistogram(RBAC_RESOLUTION_DURATION_METRIC, {
      description: 'RBAC resolution latency by outcome.',
      unit: 'ms',
    });
  }
  return cached;
}

export interface AclMetricsRecorder {
  recordResolution(input: { readonly outcome: string; readonly durationMs: number }): void;
}

export function createAclMetricsRecorder(): AclMetricsRecorder {
  return Object.freeze({
    recordResolution(input: { readonly outcome: string; readonly durationMs: number }): void {
      registerAclMetrics().record(input.durationMs, { outcome: input.outcome });
    },
  });
}