import { metrics, type Histogram } from '@opentelemetry/api';

import { METER_NAME } from '@akane/platform';

export const JEV_DECISION_DURATION_METRIC = 'jev_decision_duration_ms';
export const JEV_DECISION_CONFIDENCE_METRIC = 'jev_decision_confidence';

export interface DecisionMetrics {
  readonly duration: Histogram;
  readonly confidence: Histogram;
}

let cached: DecisionMetrics | undefined;

export function registerDecisionMetrics(): DecisionMetrics {
  if (cached === undefined) {
    const meter = metrics.getMeter(METER_NAME);
    cached = Object.freeze({
      duration: meter.createHistogram(JEV_DECISION_DURATION_METRIC, {
        description: 'JEV decision provider latency by provider and outcome.',
        unit: 'ms',
      }),
      confidence: meter.createHistogram(JEV_DECISION_CONFIDENCE_METRIC, {
        description: 'JEV decision confidence by provider.',
      }),
    });
  }
  return cached;
}

export interface DecisionMetricsRecorder {
  recordDecision(input: {
    readonly provider: string;
    readonly outcome: string;
    readonly durationMs: number;
    readonly confidence?: number;
  }): void;
}

export function createDecisionMetricsRecorder(): DecisionMetricsRecorder {
  return Object.freeze({
    recordDecision(input: {
      readonly provider: string;
      readonly outcome: string;
      readonly durationMs: number;
      readonly confidence?: number;
    }): void {
      const { duration, confidence } = registerDecisionMetrics();
      duration.record(input.durationMs, { provider: input.provider, outcome: input.outcome });
      if (typeof input.confidence === 'number') {
        confidence.record(input.confidence, { provider: input.provider });
      }
    },
  });
}