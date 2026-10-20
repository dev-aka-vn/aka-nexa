import { describe, expect, it, vi } from 'vitest';

import { TeamsOutboundService, TEAMS_CLOUD_ADAPTER } from './teams.outbound.service.js';
import type { OutboundMessage } from '@akane/contract';

function msg(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    message_id: 'm1',
    platform: 'teams',
    channel_id: 'chan-9',
    chat_user_id: 'chat-7',
    text: 'hello',
    action: 'status',
    queue: 'notification-send',
    attempt: 0,
    ...overrides,
  } as OutboundMessage;
}

describe('Teams outbound service (IM-10, NOT-03)', () => {
  it('throws on non-teams platform', async () => {
    const convRefRepo = { get: vi.fn() } as any;
    const adapter = { continueConversation: vi.fn(), botAppId: 'bot-1' } as any;
    const svc = new TeamsOutboundService(convRefRepo, adapter);
    await expect(svc.sendMessage(msg({ platform: 'slack' as any }))).rejects.toThrow(/Invalid platform for Teams outbound/);
    await expect(svc.sendFormLink(msg({ platform: 'slack' as any }))).rejects.toThrow(/Invalid platform for Teams outbound/);
  });

  it('throws naming opaque ids when no conversation reference exists', async () => {
    const convRefRepo = { get: vi.fn().mockResolvedValue(null) } as any;
    const adapter = { continueConversation: vi.fn(), botAppId: 'bot-1' } as any;
    const svc = new TeamsOutboundService(convRefRepo, adapter);
    const m = msg();
    await expect(svc.sendMessage(m)).rejects.toThrow(/chan-9\/chat-7/);
    // must not contain PII-like tokens beyond ids (ids are opaque)
    try { await svc.sendMessage(m); } catch (e) {
      const text = String(e);
      expect(text).not.toMatch(/@/);
    }
  });

  it('real send invokes adapter continueConversation with stored reference and activity carrying text', async () => {
    const storedRef = { reference: { serviceUrl: 'u', conversation: { id: 'c' } }, serviceUrl: 'u', conversationId: 'c', tenantId: 't', chatUserId: 'chat-7', channelId: 'chan-9' };
    const convRefRepo = { get: vi.fn().mockResolvedValue(storedRef) } as any;

    const sendActivity = vi.fn().mockResolvedValue(undefined);
    const adapter = {
      botAppId: 'bot-1',
      continueConversation: vi.fn(async (_botAppId: string, reference: unknown, logic: any) => {
        await logic({ sendActivity });
        expect(reference).toBe(storedRef.reference);
      }),
    } as any;

    const svc = new TeamsOutboundService(convRefRepo, adapter);
    const m = msg({ text: 'status update /link/abc' });
    await svc.sendMessage(m);

    expect(adapter.continueConversation).toHaveBeenCalledTimes(1);
    expect(sendActivity).toHaveBeenCalledWith(expect.objectContaining({ type: 'message', text: 'status update /link/abc' }));
  });

  it('classifies retryable vs non-retryable errors', async () => {
    const storedRef = { reference: { x: 1 } };
    const convRefRepo = { get: vi.fn().mockResolvedValue(storedRef) } as any;

    // retryable 429
    const err429 = Object.assign(new Error('rate'), { statusCode: 429 });
    const adapter1 = { botAppId: 'b', continueConversation: vi.fn().mockRejectedValue(err429) } as any;
    const svc1 = new TeamsOutboundService(convRefRepo, adapter1);
    await expect(svc1.sendMessage(msg())).rejects.toBe(err429);

    // retryable 500
    const err500 = Object.assign(new Error('server'), { statusCode: 500 });
    const adapter2 = { botAppId: 'b', continueConversation: vi.fn().mockRejectedValue(err500) } as any;
    const svc2 = new TeamsOutboundService(convRefRepo, adapter2);
    await expect(svc2.sendMessage(msg())).rejects.toBe(err500);

    // non-retryable 400 -> wrapped
    const err400 = Object.assign(new Error('bad'), { statusCode: 400 });
    const adapter3 = { botAppId: 'b', continueConversation: vi.fn().mockRejectedValue(err400) } as any;
    const svc3 = new TeamsOutboundService(convRefRepo, adapter3);
    await expect(svc3.sendMessage(msg())).rejects.toThrow(/Non-retryable Teams delivery error/);
  });

  it('sendFormLink delegates to sendMessage', async () => {
    const convRefRepo = { get: vi.fn().mockResolvedValue({ reference: { x: 1 } }) } as any;
    const sendActivity = vi.fn().mockResolvedValue(undefined);
    const adapter = {
      botAppId: 'b',
      continueConversation: vi.fn(async (_a: string, _r: unknown, logic: any) => { await logic({ sendActivity }); }),
    } as any;
    const svc = new TeamsOutboundService(convRefRepo, adapter);
    const spy = vi.spyOn(svc, 'sendMessage');
    const m = msg({ text: 'form link /f/1' });
    await svc.sendFormLink(m);
    expect(spy).toHaveBeenCalledWith(m);
  });

  it('deep link / status action flows through as message text', async () => {
    const storedRef = { reference: { x: 1 } };
    const convRefRepo = { get: vi.fn().mockResolvedValue(storedRef) } as any;
    const sendActivity = vi.fn().mockResolvedValue(undefined);
    const adapter = {
      botAppId: 'b',
      continueConversation: vi.fn(async (_a: string, _r: unknown, logic: any) => { await logic({ sendActivity }); }),
    } as any;
    const svc = new TeamsOutboundService(convRefRepo, adapter);
    const m = msg({ text: 'Status: updated /l/app-1?u=user-42&a=notification', action: 'status' });
    await svc.sendMessage(m);
    expect(sendActivity).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('/l/app-1') }));
  });
});