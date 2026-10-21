import { metrics, type MeterProvider } from '@opentelemetry/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMITTED_METRICS, EXTERNAL_SCRAPED, SCRAPED_NAMES } from './metric-registry.js';

class RecordingMeterProvider implements MeterProvider {
  readonly names = new Set<string>();
  getMeter = () => ({
    createCounter: (name: string) => {
      this.names.add(name);
      return { add: () => {} };
    },
    createHistogram: (name: string) => {
      this.names.add(name);
      return { record: () => {} };
    },
    createObservableGauge: (name: string) => {
      this.names.add(name);
      return { addCallback: () => {} };
    },
    createUpDownCounter: (name: string) => {
      this.names.add(name);
      return { add: () => {} };
    },
  }) as unknown as ReturnType<MeterProvider['getMeter']>;
}

describe('emitted-metric registry (OBS-03)', () => {
  let recorder: RecordingMeterProvider;

  beforeEach(() => {
    recorder = new RecordingMeterProvider();
    metrics.disable();
    metrics.setGlobalMeterProvider(recorder);
  });

  afterEach(() => {
    metrics.disable();
  });

  it('observes at least one registered instrument (non-vacuous)', () => {
    expect(EMITTED_METRICS.length).toBeGreaterThan(0);
    expect(SCRAPED_NAMES.size).toBe(EMITTED_METRICS.length);
  });

  it('maps every instrument name to its scraped name with dots replaced', () => {
    for (const m of EMITTED_METRICS) {
      expect(m.scraped).toBe(m.instrument.replaceAll('.', '_'));
      expect(m.scraped).not.toContain('.');
    }
  });

  it('keeps EXTERNAL_SCRAPED populated with the Redis and MongoDB exporter names', () => {
    expect(EXTERNAL_SCRAPED.size).toBeGreaterThan(0);
    expect(EXTERNAL_SCRAPED.has('redis_memory_used_bytes')).toBe(true);
    expect(EXTERNAL_SCRAPED.has('redis_memory_max_bytes')).toBe(true);
    expect(EXTERNAL_SCRAPED.has('mongodb_mongod_replset_member_replication_lag')).toBe(true);
  });

  it('creates every APP instrument when all register functions run', async () => {
    vi.resetModules();
    const business = await import('./business-metrics.js');
    business.registerBusinessMetrics();

    const queue = await import('./queue.metrics.js');
    queue.registerQueueMetrics({
      getJobCounts: async () => ({ waiting: 2 }),
      getJobs: async () => [{ timestamp: Date.now() - 1000 }],
    });

    const im = await import('./im-connection.metrics.js');
    im.registerImConnectionMetrics();

    const names = recorder.names;

    const localInstruments = [
      'platform.heartbeat',
      'queue.job.failures',
      'queue.depth',
      'queue.oldest.item.age',
      'submission.status',
      'connector.outcome',
      'im_active_connections',
    ];
    const missing = localInstruments.filter((name) => !names.has(name));
    expect(missing).toEqual([]);
  });

  it('returns the identical instrument for repeated registration', async () => {
    vi.resetModules();
    const business = await import('./business-metrics.js');
    const first = business.registerBusinessMetrics();
    const second = business.registerBusinessMetrics();
    expect(second).toBe(first);
    expect(second.platformHeartbeat).toBe(first.platformHeartbeat);
  });
});