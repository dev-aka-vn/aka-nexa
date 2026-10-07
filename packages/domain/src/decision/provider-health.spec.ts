import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JevProvider } from '@akane/contract';

import { ProviderHealthService } from './provider-health.service.js';

function probe(): JevProvider['healthCheck'] {
  return vi.fn(async () => ({
    status: 'healthy' as const,
    model_version: 'm',
    spec_version: '1.0',
    capabilities: [] as const,
    uptime_seconds: 0,
  }));
}

function provider(name: string, healthCheck: JevProvider['healthCheck']): JevProvider {
  return {
    name,
    spec_version: '1.0',
    capabilities: [],
    decide: () => Promise.reject(new Error('unused')),
    healthCheck,
  };
}

describe('ProviderHealthService (RTE-07)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('probes every provider on a 60s interval, and stops cleanly', async () => {
    const healthSpy = probe();
    const service = new ProviderHealthService([provider('p', healthSpy)], 60_000);
    service.start();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(healthSpy).toHaveBeenCalledTimes(3);
    service.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(healthSpy).toHaveBeenCalledTimes(3);
  });

  it('marks a provider usable only after a fresh successful probe', async () => {
    const service = new ProviderHealthService([provider('p', probe())], 60_000);
    expect(service.isSkipped('p')).toBe(false); // never probed: not yet a skip signal
    expect(service.isUsable('p')).toBe(false);
    await service.probeAll();
    expect(service.isUsable('p')).toBe(true);
    expect(service.isSkipped('p')).toBe(false);
  });

  it('a failed probe makes the provider skipped; a later success reinstates it', async () => {
    let healthy = false;
    const flip: JevProvider['healthCheck'] = async () => ({
      status: healthy ? ('healthy' as const) : ('unhealthy' as const),
      model_version: 'm',
      spec_version: '1.0',
      capabilities: [],
      uptime_seconds: 0,
    });
    const service = new ProviderHealthService([provider('p', flip)], 60_000);
    await service.probeAll();
    expect(service.isSkipped('p')).toBe(true);
    expect(service.isUsable('p')).toBe(false);

    healthy = true;
    await service.probeAll();
    expect(service.isSkipped('p')).toBe(false);
    expect(service.isUsable('p')).toBe(true);
  });

  it('a probe exception is an unhealthy record, never a throw', async () => {
    const failing: JevProvider['healthCheck'] = async () => {
      throw new Error('ECONNREFUSED');
    };
    const service = new ProviderHealthService([provider('p', failing)], 60_000);
    await service.probeAll();
    expect(service.isSkipped('p')).toBe(true);
  });

  it('a stale last probe is a skip signal even when it was healthy', async () => {
    vi.setSystemTime(1_000_000);
    const service = new ProviderHealthService([provider('p', probe())], 60_000);
    await service.probeAll();
    expect(service.isUsable('p')).toBe(true);
    vi.setSystemTime(1_000_000 + 61_000);
    expect(service.isSkipped('p')).toBe(true);
  });

  it('assertLocalHealthy throws only on a recorded failure/stale state', async () => {
    const service = new ProviderHealthService([provider('local', probe())], 60_000);
    service.assertLocalHealthy('local'); // unprobed: the boot assertion covers presence
    await service.probeAll();
    service.assertLocalHealthy('local');
    vi.setSystemTime(Date.now() + 61_000);
    expect(() => service.assertLocalHealthy('local')).toThrow(/LOCAL_PROVIDER_UNHEALTHY/);
  });
});
