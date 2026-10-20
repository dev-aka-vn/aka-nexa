import { metrics, type Counter } from '@opentelemetry/api';

import { METER_NAME } from '@akane/platform';

export const READ_LINK_TOKENS_ISSUED_METRIC = 'read_link_tokens_issued_total';
export const READ_LINK_TOKEN_CONSUME_METRIC = 'read_link_token_consume_total';

export interface ReadLinkMetrics {
  readonly issued: Counter;
  readonly consume: Counter;
}

let cached: ReadLinkMetrics | undefined;

export function registerReadLinkMetrics(): ReadLinkMetrics {
  if (cached === undefined) {
    const meter = metrics.getMeter(METER_NAME);
    cached = Object.freeze({
      issued: meter.createCounter(READ_LINK_TOKENS_ISSUED_METRIC, {
        description: 'Read-link tokens issued by window.',
      }),
      consume: meter.createCounter(READ_LINK_TOKEN_CONSUME_METRIC, {
        description: 'Read-link token consume attempts by result.',
      }),
    });
  }
  return cached;
}

export interface ReadLinkMetricsRecorder {
  recordIssued(window: 'create' | 'edit' | 'view'): void;
  recordConsume(result: 'ok' | 'expired' | 'replayed' | 'bad_signature'): void;
}

export function createReadLinkMetricsRecorder(): ReadLinkMetricsRecorder {
  return Object.freeze({
    recordIssued(window: 'create' | 'edit' | 'view'): void {
      registerReadLinkMetrics().issued.add(1, { window });
    },
    recordConsume(result: 'ok' | 'expired' | 'replayed' | 'bad_signature' | string): void {
      const allowed = new Set(['ok', 'expired', 'replayed', 'bad_signature']);
      const value = allowed.has(result) ? result : 'unknown';
      registerReadLinkMetrics().consume.add(1, { result: value });
    },
  });
}