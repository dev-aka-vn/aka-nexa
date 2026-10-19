import { describe, it, expect, vi } from 'vitest';
import { NotificationProcessor, notificationJitterBackoff } from './notification.processor.js';

describe('notification jitter backoff (D-13)', () => {
  it('stays within [50%, 100%] of exponential base for attempts 1..3', () => {
    const job = { opts: { backoff: { delay: 1000 } } };
    for (let attempt = 1; attempt <= 3; attempt++) {
      const base = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
      for (let i = 0; i < 50; i++) {
        const delay = notificationJitterBackoff(attempt, 'notification-jitter', undefined, job);
        expect(delay).toBeGreaterThanOrEqual(Math.floor(base * 0.5));
        expect(delay).toBeLessThanOrEqual(Math.ceil(base * 1.0));
      }
    }
  });
});

describe('notification processor - terminal failure', () => {
  it('audits and attempts a failure notice on terminal delivery failure', async () => {
    const assembler = {
      assemble: vi.fn().mockResolvedValue({
        kind: 'assembled',
        message: {
          message_id: 'm1',
          platform: 'teams',
          channel_id: 'chan-1',
          chat_user_id: 'chat-1',
          text: 'status /link',
          action: 'status',
          queue: 'notification-send',
          attempt: 0,
        },
      }),
    } as any;
    const delivery = {
      send: vi.fn().mockRejectedValue(new Error('boom')),
    } as any;
    const audit = { append: vi.fn().mockResolvedValue(undefined) } as any;

    const processor = new NotificationProcessor(assembler, delivery, audit);
    const job = {
      data: { connectorId: 'conn-1', body: { entity_reference: 'entity-1', status: 'done' }, receivedAt: new Date().toISOString() },
      opts: { attempts: 1 },
      attemptsMade: 0,
    } as any;

    await processor.process(job);

    expect(audit.append).toHaveBeenCalled();
    const first = audit.append.mock.calls[0][0];
    expect(first.action).toBe('notification.delivery_failed');
    // at least one delivery attempt + one notice attempt
    expect(delivery.send).toHaveBeenCalledTimes(2);
  });
});

describe('notification processor - unresolved', () => {
  it('audits unresolved and does not retry', async () => {
    const assembler = {
      assemble: vi.fn().mockResolvedValue({ kind: 'unresolved', reference: 'ref-x' }),
    } as any;
    const delivery = { send: vi.fn() } as any;
    const audit = { append: vi.fn().mockResolvedValue(undefined) } as any;

    const processor = new NotificationProcessor(assembler, delivery, audit);
    const job = {
      data: { connectorId: 'conn-1', body: { entity_reference: 'ref-x' } },
      opts: { attempts: 3 },
      attemptsMade: 0,
    } as any;

    await processor.process(job);
    expect(delivery.send).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'notification.unresolved' }));
  });
});