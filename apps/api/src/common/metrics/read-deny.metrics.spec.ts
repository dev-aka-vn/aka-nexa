/**
 * The LNK-08 denial counter — instrument naming, labels, and the single-metric
 * path assertion (D-71).
 *
 * ## Why a recording MeterProvider
 *
 * Without an SDK, `@opentelemetry/api` hands back no-op instruments: `add()`
 * does nothing and the name is never observed, so "the counter is called
 * `read_link_denials_total`" would pass vacuously against a counter that does
 * not exist. The provider below captures the meter name, the instrument name,
 * and every `add()` call — which is exactly what LNK-08 needs to be able to
 * assert: one increment per denial, labelled by reason.
 *
 * Same pattern as `packages/platform/src/metrics/business-metrics.spec.ts`.
 */

import { metrics, type MeterProvider } from '@opentelemetry/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ALL_DENY_REASONS, ReadDenyReason } from '@akane/contract';

class RecordingMeterProvider implements MeterProvider {
  readonly meters: Array<{ name: string; version?: string }> = [];
  readonly counters = new Map<string, number>();
  readonly adds: Array<{ name: string; value: number; attributes: unknown }> = [];

  getMeter = (name: string, version?: string) => {
    this.meters.push(version === undefined ? { name } : { name, version });
    return {
      createCounter: (metricName: string) => {
        this.counters.set(metricName, (this.counters.get(metricName) ?? 0) + 1);
        return {
          add: (value: number, attributes?: unknown) => {
            this.adds.push({ name: metricName, value, attributes });
          },
        };
      },
    } as unknown as ReturnType<MeterProvider['getMeter']>;
  };
}

describe('registerReadDenyMetrics (LNK-08, D-71)', () => {
  let recorder: RecordingMeterProvider;

  async function freshModule(): Promise<typeof import('./read-deny.metrics.js')> {
    vi.resetModules();
    return import('./read-deny.metrics.js');
  }

  beforeEach(() => {
    recorder = new RecordingMeterProvider();
    metrics.disable();
    metrics.setGlobalMeterProvider(recorder);
  });

  afterEach(() => {
    metrics.disable();
  });

  it('creates one counter named read_link_denials_total on the akane meter', async () => {
    const mod = await freshModule();
    mod.registerReadDenyMetrics();

    expect(recorder.meters).toEqual([{ name: 'akane' }]);
    expect([...recorder.counters.keys()]).toEqual(['read_link_denials_total']);
  });

  it('increments once per denial with the reason and action labels', async () => {
    const mod = await freshModule();
    const metricsRecorder = mod.registerReadDenyMetrics();

    for (const reason of ALL_DENY_REASONS) {
      metricsRecorder.recordDenial(reason, 'view');
    }
    metricsRecorder.recordDenial(ReadDenyReason.denied, 'query');

    expect(recorder.adds).toHaveLength(8);
    expect(recorder.adds[0]).toEqual({
      name: 'read_link_denials_total',
      value: 1,
      attributes: { reason: ReadDenyReason.expired, action: 'view' },
    });
    expect(recorder.adds.at(-1)).toEqual({
      name: 'read_link_denials_total',
      value: 1,
      attributes: { reason: ReadDenyReason.denied, action: 'query' },
    });
  });

  it('memoises so a second registration reuses the same instrument (one series, not two)', async () => {
    const mod = await freshModule();
    const first = mod.registerReadDenyMetrics();
    const second = mod.registerReadDenyMetrics();

    expect(second).toBe(first);
    expect(recorder.counters.get('read_link_denials_total')).toBe(1);
  });
});
