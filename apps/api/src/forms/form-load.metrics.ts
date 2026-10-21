/**
 * Server-measured form load time (Q4): `form_load_duration_ms` is emitted at
 * the form renderer request path in `apps/api`; it measures server handling
 * duration, not client render time.
 */
import { metrics, type Histogram } from '@opentelemetry/api';

import { METER_NAME } from '@akane/platform';

export const FORM_LOAD_DURATION_METRIC = 'form_load_duration_ms';

let cached: Histogram | undefined;

export function registerFormLoadMetrics(): Histogram {
  if (cached === undefined) {
    const meter = metrics.getMeter(METER_NAME);
    cached = meter.createHistogram(FORM_LOAD_DURATION_METRIC, {
      description: 'Server-side form load duration by app and form.',
      unit: 'ms',
    });
  }
  return cached;
}

export interface FormLoadMetricsRecorder {
  recordLoad(input: { readonly appId: string; readonly formId: string; readonly durationMs: number }): void;
}

export function createFormLoadMetricsRecorder(): FormLoadMetricsRecorder {
  return Object.freeze({
    recordLoad(input: { readonly appId: string; readonly formId: string; readonly durationMs: number }): void {
      registerFormLoadMetrics().record(input.durationMs, {
        app_id: input.appId,
        form_id: input.formId,
      });
    },
  });
}