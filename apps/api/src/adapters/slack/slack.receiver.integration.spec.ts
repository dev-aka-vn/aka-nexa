import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';

import { SlackWebhookController } from './slack-webhook.controller.js';
import { SlackCommandsController } from './slack-commands.controller.js';

const SIGNING_SECRET = 'test-signing-secret';

/** Compute the real `v0:<ts>:<body>` MAC so the test drives the actual code path. */
function sign(body: string, timestamp: number, secret = SIGNING_SECRET): string {
  return (
    'v0=' +
    createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')
  );
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function makeController(overrides: Record<string, unknown> = {}) {
  const verifier = {
    verify: vi.fn().mockReturnValue({ ok: true, timestamp: nowSeconds() }),
    ...((overrides.verifier as object) ?? {}),
  };
  const platformEvents = {
    record: vi.fn().mockResolvedValue('inserted'),
    ...((overrides.platformEvents as object) ?? {}),
  };
  const conversationReferences = {
    upsert: vi.fn().mockResolvedValue(undefined),
    key: vi
      .fn()
      .mockImplementation(
        (platform: string, channel: string, user: string) =>
          `${platform}:${channel}::${user}`,
      ),
    ...((overrides.conversationReferences as object) ?? {}),
  };
  const queue = {
    add: vi.fn().mockResolvedValue(undefined),
    ...((overrides.queue as object) ?? {}),
  };
  const controller = new SlackWebhookController(
    verifier as never,
    platformEvents as never,
    conversationReferences as never,
    queue as never,
  );
  return { controller, verifier, platformEvents, conversationReferences, queue };
}

/** A minimal Events API envelope with a real signature over its raw bytes. */
function signedEvent(
  payload: unknown,
  options: { timestamp?: number; secret?: string } = {},
): { raw: string; signature: string; timestamp: string } {
  const raw = JSON.stringify(payload);
  const ts = options.timestamp ?? nowSeconds();
  return {
    raw,
    signature: sign(raw, ts, options.secret),
    timestamp: String(ts),
  };
}

function messagePayload(): unknown {
  return {
    type: 'event_callback',
    event_id: 'Ev123',
    event_time: 12345,
    team_id: 'T001',
    event: {
      type: 'message',
      channel: 'C001',
      user: 'U001',
      text: '/redmine 123',
      ts: '12345.678',
    },
  };
}

describe('Slack receiver (OUT-04, T-10-07, T-10-08)', () => {
  describe('transport authentication', () => {
    it('rejects a request whose signature does not verify', async () => {
      const { controller, platformEvents, queue } = makeController({
        verifier: { verify: vi.fn().mockReturnValue({ ok: false, reason: 'signature_mismatch' }) },
      });
      const { raw } = signedEvent(messagePayload());

      await expect(
        controller.handleEvent(raw, undefined, 'v0=bad', String(nowSeconds()), {
          setHeader: vi.fn(),
        } as never),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(platformEvents.record).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('maps a missing signing secret to 503, not 401 (operator fault)', async () => {
      const { controller } = makeController({
        verifier: { verify: vi.fn().mockReturnValue({ ok: false, reason: 'not_configured' }) },
      });
      const { raw, timestamp } = signedEvent(messagePayload());

      await expect(
        controller.handleEvent(raw, undefined, 'v0=x', timestamp, {
          setHeader: vi.fn(),
        } as never),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('rejects a stale timestamp before the MAC is computed', async () => {
      // The verifier contract itself is unit-tested; here we assert the
      // receiver propagates a stale-timestamp rejection as 401.
      const { controller, platformEvents } = makeController({
        verifier: { verify: vi.fn().mockReturnValue({ ok: false, reason: 'stale_timestamp' }) },
      });
      const { raw } = signedEvent(messagePayload());

      await expect(
        controller.handleEvent(raw, undefined, 'v0=x', '1', {
          setHeader: vi.fn(),
        } as never),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(platformEvents.record).not.toHaveBeenCalled();
    });
  });

  describe('url_verification challenge', () => {
    it('echoes the challenge and writes nothing', async () => {
      const { controller, platformEvents, conversationReferences, queue } = makeController();
      const { raw, signature, timestamp } = signedEvent({
        type: 'url_verification',
        challenge: 'challenge-abc',
      });
      const setHeader = vi.fn();

      const result = await controller.handleEvent(raw, undefined, signature, timestamp, {
        setHeader,
      } as never);

      expect(result).toBe('challenge-abc');
      expect(setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain');
      expect(platformEvents.record).not.toHaveBeenCalled();
      expect(conversationReferences.upsert).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('message events', () => {
    it('verifies, records, writes a conversation reference and enqueues once', async () => {
      const { controller, verifier, platformEvents, conversationReferences, queue } =
        makeController();
      const payload = messagePayload();
      const { raw, signature, timestamp } = signedEvent(payload);

      await controller.handleEvent(raw, undefined, signature, timestamp, {
        setHeader: vi.fn(),
      } as never);

      expect(verifier.verify).toHaveBeenCalledTimes(1);
      expect(platformEvents.record).toHaveBeenCalledTimes(1);
      expect(platformEvents.record).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: 'slack',
          platformEventId: 'Ev123',
        }),
      );
      // Platform-scoped key (OUT-07), not a Teams-shaped one.
      expect(conversationReferences.upsert).toHaveBeenCalledTimes(1);
      // Platform-scoped key (OUT-07): the Teams-shaped `channel::user` key
      // would have collided across platforms.
      expect(vi.mocked(conversationReferences.upsert).mock.calls[0][0]).toBe(
        'slack:C001::U001',
      );
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('enqueues an InboundEvent that parses against the strict envelope', async () => {
      const { controller, queue } = makeController();
      const { raw, signature, timestamp } = signedEvent(messagePayload());

      await controller.handleEvent(raw, undefined, signature, timestamp, {
        setHeader: vi.fn(),
      } as never);

      const [queueName, job] = queue.add.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
      ];
      expect(queueName).toBe('inbound-events');
      expect(job.platform).toBe('slack');
      expect(job.event_id).toBe('Ev123');
      expect(job.native_event_id).toBe('Ev123');
      expect(job.thread_id).toBeUndefined();
      expect(job.reply_to_message_id).toBe('12345.678');
      // platform_metadata is depth-1 primitives only.
      expect(job.platform_metadata).toEqual({ team_id: 'T001' });
    });

    it('threads thread_ts through to the envelope', async () => {
      const { controller, queue } = makeController();
      const payload = messagePayload();
      (payload as { event: { thread_ts?: string } }).event.thread_ts = '100.200';
      const { raw, signature, timestamp } = signedEvent(payload);

      await controller.handleEvent(raw, undefined, signature, timestamp, {
        setHeader: vi.fn(),
      } as never);

      const job = queue.add.mock.calls[0][1] as Record<string, unknown>;
      expect(job.thread_id).toBe('100.200');
      expect(job.reply_to_message_id).toBe('12345.678');
    });

    it('acks a duplicate with no enqueue (T-10-08)', async () => {
      const { controller, conversationReferences, queue } = makeController({
        platformEvents: { record: vi.fn().mockResolvedValue('duplicate') },
      });
      const { raw, signature, timestamp } = signedEvent(messagePayload());

      await controller.handleEvent(raw, undefined, signature, timestamp, {
        setHeader: vi.fn(),
      } as never);

      expect(conversationReferences.upsert).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('fails closed when the ledger write throws', async () => {
      const { controller, conversationReferences, queue } = makeController({
        platformEvents: {
          record: vi.fn().mockRejectedValue(new Error('duplicate key')),
        },
      });
      const { raw, signature, timestamp } = signedEvent(messagePayload());

      await expect(
        controller.handleEvent(raw, undefined, signature, timestamp, {
          setHeader: vi.fn(),
        } as never),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(conversationReferences.upsert).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('never ingests a bot message (loop prevention)', async () => {
      const { controller, platformEvents, queue } = makeController();
      const payload = messagePayload();
      (payload as { event: { bot_id: string } }).event.bot_id = 'B001';
      const { raw, signature, timestamp } = signedEvent(payload);

      await controller.handleEvent(raw, undefined, signature, timestamp, {
        setHeader: vi.fn(),
      } as never);

      expect(platformEvents.record).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('acks unaddressable events rather than answering 4xx (Slack retries forever)', async () => {
      const { controller, queue } = makeController();
      const payload = messagePayload();
      (payload as { event: { channel: unknown } }).event.channel = undefined;
      const { raw, signature, timestamp } = signedEvent(payload);

      await controller.handleEvent(raw, undefined, signature, timestamp, {
        setHeader: vi.fn(),
      } as never);

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('ignores non-message event types', async () => {
      const { controller, queue } = makeController();
      const { raw, signature, timestamp } = signedEvent({
        type: 'event_callback',
        event_id: 'Ev9',
        event: { type: 'reaction_added', channel: 'C1', user: 'U1' },
      });

      await controller.handleEvent(raw, undefined, signature, timestamp, {
        setHeader: vi.fn(),
      } as never);

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('rejects a body that is not JSON', async () => {
      const { controller } = makeController();

      await expect(
        controller.handleEvent('not json', undefined, 'v0=x', String(nowSeconds()), {
          setHeader: vi.fn(),
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

describe('Slack slash commands (OUT-04)', () => {
  function makeCommandsController(overrides: Record<string, unknown> = {}) {
    const platformEvents = {
      record: vi.fn().mockResolvedValue('inserted'),
      ...((overrides.platformEvents as object) ?? {}),
    };
    const queue = { add: vi.fn().mockResolvedValue(undefined) };
    const verifier = {
      verify: vi.fn().mockReturnValue({ ok: true, timestamp: nowSeconds() }),
      ...((overrides.verifier as object) ?? {}),
    };
    return {
      controller: new SlackCommandsController(
        verifier as never,
        platformEvents as never,
        {
          upsert: vi.fn().mockResolvedValue(undefined),
          key: vi
            .fn()
            .mockImplementation(
              (p: string, c: string, u: string) => `${p}:${c}::${u}`,
            ),
        } as never,
        queue as never,
      ),
      platformEvents,
      queue,
    };
  }

  it('verifies the urlencoded body and enqueues a slash_command event', async () => {
    const { controller, queue } = makeCommandsController();
    const body = 'command=%2Fredmine+123&channel_id=C1&user_id=U1&team_id=T1&trigger_id=trig-1&text=123';
    const ts = nowSeconds();

    await controller.handleCommand(
      Buffer.from(body),
      undefined,
      sign(body, ts),
      String(ts),
    );

    expect(queue.add).toHaveBeenCalledTimes(1);
    const job = queue.add.mock.calls[0][1] as Record<string, unknown>;
    expect(job.action).toBe('slash_command');
    expect(job.platform).toBe('slack');
    expect(job.native_event_id).toBe('trig-1');
    expect(job.text).toContain('123');
  });

  it('rejects an unverified slash command', async () => {
    const { controller, platformEvents, queue } = makeCommandsController({
      verifier: {
        verify: vi.fn().mockReturnValue({ ok: false, reason: 'signature_mismatch' }),
      },
    });
    const body = 'command=%2Fhelp&channel_id=C1&user_id=U1';
    const ts = nowSeconds();

    await expect(
      controller.handleCommand(Buffer.from(body), undefined, 'v0=bad', String(ts)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(platformEvents.record).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('acks a redelivered trigger_id without a second enqueue', async () => {
    const { controller, queue } = makeCommandsController({
      platformEvents: { record: vi.fn().mockResolvedValue('duplicate') },
    });
    const body = 'command=%2Fredmine&channel_id=C1&user_id=U1&trigger_id=trig-1';
    const ts = nowSeconds();

    await controller.handleCommand(
      Buffer.from(body),
      undefined,
      sign(body, ts),
      String(ts),
    );

    expect(queue.add).not.toHaveBeenCalled();
  });
});
