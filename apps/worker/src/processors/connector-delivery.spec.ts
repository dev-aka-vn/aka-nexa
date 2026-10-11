import { describe, it, expect, vi } from 'vitest';
import { ConnectorDeliveryProcessor } from './connector-delivery.processor.js';

/**
 * A limiter that admits every call. The CON-05 limiter has its own integration
 * suite (`packages/domain/src/connectors/rate-limit.integration.spec.ts`) over
 * real Redis; these cases are about the pre-call-commit / idempotency ordering,
 * so a permissive stub keeps the rate limit out of their way.
 */
function allowAllLimiter() {
  return {
    consume: vi.fn().mockResolvedValue({ allowed: true, count: 1, max: 60, resetInMs: 60000 }),
  } as any;
}

/**
 * A registry stub. `limiterConfig` is part of the surface the processor now
 * calls (CON-05), so a bare `{ resolve }` mock is no longer sufficient.
 */
function registryStub(resolve?: unknown) {
  return {
    resolve: resolve === undefined ? vi.fn() : vi.fn().mockReturnValue(resolve),
    limiterConfig: vi.fn().mockReturnValue({ max: 60, windowMs: 60000 }),
  } as any;
}

describe('connector delivery processor - pre-call commit', () => {
  it('commits sent_unconfirmed before transport call', async () => {
    const callOrder: string[] = [];
    const revisionsRepo = {
      findBySubmissionAndRevision: vi.fn().mockResolvedValue({
        outbound: 'not_sent',
      }),
      setSentUnconfirmed: vi.fn().mockImplementation(async () => {
        callOrder.push('setSentUnconfirmed');
      }),
      setConfirmed: vi.fn().mockImplementation(async () => {
        callOrder.push('setConfirmed');
      }),
    } as any;

    const connector = {
      execute: vi.fn().mockImplementation(async () => {
        callOrder.push('execute');
        return { status: 'succeeded', externalId: 'ext-1' };
      }),
    } as any;

    const registry = registryStub(connector);

    const processor = new ConnectorDeliveryProcessor(revisionsRepo, registry, allowAllLimiter());
    await processor.process({
      data: {
        submissionId: 'sub-1',
        revision: 0,
        connectorRef: 'conn-1',
        payload: { data: {} },
      },
    } as any);

    expect(callOrder[0]).toBe('setSentUnconfirmed');
    expect(callOrder[1]).toBe('execute');
    expect(callOrder[2]).toBe('setConfirmed');
  });

  it('not_sent short-circuit', async () => {
    const revisionsRepo = {
      findBySubmissionAndRevision: vi.fn().mockResolvedValue({
        outbound: 'sent_unconfirmed',
      }),
      setSentUnconfirmed: vi.fn(),
      setConfirmed: vi.fn(),
    } as any;

    const registry = registryStub();

    const processor = new ConnectorDeliveryProcessor(revisionsRepo, registry, allowAllLimiter());
    await processor.process({
      data: {
        submissionId: 'sub-1',
        revision: 0,
        connectorRef: 'conn-1',
        payload: { data: {} },
      },
    } as any);

    expect(revisionsRepo.setSentUnconfirmed).not.toHaveBeenCalled();
    expect(registry.resolve).not.toHaveBeenCalled();
  });

  it('per-revision idempotency - not_sent short-circuit on re-delivery', async () => {
    const revisionsRepo = {
      findBySubmissionAndRevision: vi.fn().mockResolvedValue({
        outbound: 'sent_unconfirmed',
      }),
      setSentUnconfirmed: vi.fn(),
      setConfirmed: vi.fn(),
    } as any;

    const connector = {
      execute: vi.fn(),
    } as any;

    const registry = registryStub(connector);

    const processor = new ConnectorDeliveryProcessor(revisionsRepo, registry, allowAllLimiter());
    await processor.process({
      data: {
        submissionId: 'sub-1',
        revision: 0,
        connectorRef: 'conn-1',
        payload: { data: {} },
      },
    } as any);

    expect(connector.execute).not.toHaveBeenCalled();
    expect(revisionsRepo.setSentUnconfirmed).not.toHaveBeenCalled();
  });

  it('credential_rejected outcome does not consume retry budget', async () => {
    const revisionsRepo = {
      findBySubmissionAndRevision: vi.fn().mockResolvedValue({
        outbound: 'not_sent',
      }),
      setSentUnconfirmed: vi.fn(),
      setConfirmed: vi.fn(),
    } as any;

    const connector = {
      execute: vi.fn().mockResolvedValue({ status: 'rejected' }),
    } as any;

    const registry = registryStub(connector);

    const processor = new ConnectorDeliveryProcessor(revisionsRepo, registry, allowAllLimiter());
    await expect(processor.process({
      data: {
        submissionId: 'sub-1',
        revision: 0,
        connectorRef: 'conn-1',
        payload: { data: {} },
      },
    } as any)).resolves.toBeUndefined();

    expect(revisionsRepo.setSentUnconfirmed).toHaveBeenCalled();
    expect(connector.execute).toHaveBeenCalledTimes(1);
    expect(revisionsRepo.setConfirmed).not.toHaveBeenCalled();
  });
});
