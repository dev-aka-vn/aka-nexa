import { describe, it, expect, vi } from 'vitest';
import { ConnectorDeliveryProcessor } from './connector-delivery.processor.js';

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

    const registry = {
      resolve: vi.fn().mockReturnValue(connector),
    } as any;

    const processor = new ConnectorDeliveryProcessor(revisionsRepo, registry);
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

    const registry = {
      resolve: vi.fn(),
    } as any;

    const processor = new ConnectorDeliveryProcessor(revisionsRepo, registry);
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
});
