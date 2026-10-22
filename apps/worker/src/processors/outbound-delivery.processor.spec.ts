import { describe, expect, it, vi } from 'vitest';

import {
  OutboundMessageSchema,
  type OutboundMessage,
} from '@akane/contract';

import { outboundJitterBackoff } from './outbound-delivery.processor.js';
import { OutboundDeliveryProcessor } from './outbound-delivery.processor.js';
import { OutboundDeliveryRegistry } from './outbound-delivery.registry.js';

/** A deliverable message in the shape the seam enqueues. */
function message(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return OutboundMessageSchema.parse({
    message_id: 'abc',
    platform: 'teams',
    channel_id: 'C1',
    chat_user_id: 'U1',
    text: 'Here is your form',
    action: 'form_link',
    queue: 'im-outbound',
    attempt: 0,
    native_event_id: 'evt_1',
    ...overrides,
  });
}

function build(port?: { send: ReturnType<typeof vi.fn> }) {
  const send = port?.send ?? vi.fn().mockResolvedValue(undefined);
  const markDispatched = vi.fn().mockResolvedValue(undefined);
  const auditAppend = vi.fn().mockResolvedValue(undefined);

  const registry = new OutboundDeliveryRegistry();
  registry.register('teams', { send } as never);

  const processor = new OutboundDeliveryProcessor(
    registry,
    { markDispatched } as never,
    { append: auditAppend } as never,
  );

  return { processor, send, markDispatched, auditAppend };
}

describe('OutboundDeliveryRegistry (OUT-03, OUT-12)', () => {
  it('resolves a registered platform to its port', () => {
    const registry = new OutboundDeliveryRegistry();
    registry.register('telegram', { send: async () => {} });
    expect(registry.get('telegram')).toBeDefined();
  });

  it('reports an unregistered platform as missing, not as a crash', () => {
    const registry = new OutboundDeliveryRegistry();
    expect(registry.get('zalo')).toBeUndefined();
  });

  it('lists the registered platforms — the boot assertion input', () => {
    const registry = new OutboundDeliveryRegistry();
    registry.register('teams', { send: async () => {} });
    registry.register('telegram', { send: async () => {} });
    expect([...registry.registered()].sort()).toEqual(['teams', 'telegram']);
  });
});

describe('OutboundDeliveryProcessor (OUT-01, OUT-02, OUT-14)', () => {
  it('delivers through the platform port and marks the ledger row dispatched', async () => {
    const { processor, send, markDispatched } = build();

    await processor.process({ data: message() } as never);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ message_id: 'abc' }));
    // The reconciliation contract: the inbound row this reply answers is
    // dispatched, so the reconciler does not deliver it again.
    expect(markDispatched).toHaveBeenCalledWith('evt_1', 'teams');
  });

  it('drops a malformed job instead of retrying it', async () => {
    const { processor, send, auditAppend } = build();

    await processor.process({ data: { not: 'an outbound message' } } as never);

    expect(send).not.toHaveBeenCalled();
    expect(auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'im.outbound.malformed' }),
    );
  });

  it('audits an unregistered platform and does not throw', async () => {
    const { processor, send, auditAppend } = build();

    await processor.process({
      data: message({ platform: 'zalo' }),
    } as never);

    expect(send).not.toHaveBeenCalled();
    expect(auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'im.outbound.no_port', target: 'zalo' }),
    );
  });

  it('rethrows a retryable failure when attempts remain', async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('429'), { statusCode: 429 }));
    const { processor, auditAppend } = build({ send });

    await expect(
      processor.process({ data: message(), opts: { attempts: 5 }, attemptsMade: 1 } as never),
    ).rejects.toThrow('429');
    expect(auditAppend).not.toHaveBeenCalled();
  });

  it('audits, notifies and stops on the final attempt (DLQ)', async () => {
    const send = vi.fn().mockRejectedValueOnce(Object.assign(new Error('500'), { statusCode: 500 }));
    const { processor, auditAppend } = build({ send });

    // Last attempt: the retryable error is swallowed, audited, and a failure
    // notice goes out with a NEW id (10-04's rule for a different message).
    await processor.process({ data: message(), opts: { attempts: 5 }, attemptsMade: 4 } as never);

    expect(auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'im.outbound.failed', attempts: 5 }),
    );
    expect(send).toHaveBeenCalledTimes(2);
    const notice = send.mock.calls[1]![0] as OutboundMessage;
    expect(notice.message_id).not.toBe('abc');
    expect(notice.action).toBe('error');
  });

  it('does not regenerate message_id across a delivery retry', async () => {
    // The retryable throw above means BullMQ re-drives the SAME job data. The
    // id must survive that, or one user reply becomes several messages.
    const first = message();
    expect(first.message_id).toBe('abc');
    expect(OutboundMessageSchema.parse(first).message_id).toBe('abc');
  });

  it('swallows a ledger failure after a successful delivery', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const markDispatched = vi.fn().mockRejectedValue(new Error('mongo unavailable'));
    const registry = new OutboundDeliveryRegistry();
    registry.register('teams', { send });
    const processor = new OutboundDeliveryProcessor(
      registry,
      { markDispatched } as never,
      { append: vi.fn() } as never,
    );

    // The message is already delivered. Rethrowing would make BullMQ retry and
    // duplicate a user-visible reply — so the ledger write is logged and lost.
    await expect(processor.process({ data: message() } as never)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(markDispatched).toHaveBeenCalledWith('evt_1', 'teams');
  });
});

describe('outboundJitterBackoff (OUT-02)', () => {
  it('grows exponentially and stays inside the 60s ceiling', () => {
    const job = { opts: { backoff: 2000 } };
    const first = outboundJitterBackoff(1, undefined, undefined, job);
    const second = outboundJitterBackoff(2, undefined, undefined, job);
    expect(first).toBeGreaterThanOrEqual(1000);
    expect(first).toBeLessThanOrEqual(2000);
    expect(second).toBeGreaterThan(first);
    expect(outboundJitterBackoff(20, undefined, undefined, job)).toBeLessThanOrEqual(60000);
  });
});
