import { metrics, type UpDownCounter } from '@opentelemetry/api';

import { METER_NAME } from './business-metrics.js';

export const IM_ACTIVE_CONNECTIONS_METRIC = 'im_active_connections';

let cached: UpDownCounter | undefined;

export function registerImConnectionMetrics(): UpDownCounter {
  if (cached === undefined) {
    const meter = metrics.getMeter(METER_NAME);
    cached = meter.createUpDownCounter(IM_ACTIVE_CONNECTIONS_METRIC, {
      description: 'Active IM adapter connections by provider.',
    });
  }
  return cached;
}

export interface ImConnectionRecorder {
  connect(provider: string): void;
  disconnect(provider: string): void;
}

export function createImConnectionRecorder(): ImConnectionRecorder {
  return Object.freeze({
    connect(provider: string): void {
      registerImConnectionMetrics().add(1, { provider });
    },
    disconnect(provider: string): void {
      registerImConnectionMetrics().add(-1, { provider });
    },
  });
}