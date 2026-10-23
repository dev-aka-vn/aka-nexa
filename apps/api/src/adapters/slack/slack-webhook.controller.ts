import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  RawBody,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';

import {
  INBOUND_EVENTS_QUEUE,
  SLACK_SIGNATURE_HEADER,
  SLACK_TIMESTAMP_HEADER,
  SlackWebhookVerifier,
} from '@akane/platform';
import { InboundEventSchema, type InboundEvent } from '@akane/contract';
import {
  ConversationReferenceRepository,
  PlatformEventRepository,
} from '@akane/domain';

/** The parts of a Slack Events API payload this receiver acts on. */
interface SlackEventPayload {
  type?: unknown;
  challenge?: unknown;
  team_id?: unknown;
  event_id?: unknown;
  event_time?: unknown;
  event?: {
    type?: unknown;
    subtype?: unknown;
    channel?: unknown;
    user?: unknown;
    bot_id?: unknown;
    text?: unknown;
    ts?: unknown;
    thread_ts?: unknown;
    channel_type?: unknown;
  };
}

/**
 * The Slack Events API receiver (OUT-04, T-10-07, T-10-08).
 *
 * ## Verify → parse → dedupe → conversation reference → enqueue → 200
 *
 * The same shape as the Teams receiver (`teams-activity.service.ts`), for the
 * same reason: the ack budget is 200 ms (D-13) and Slack's own limit is 3 s with
 * retries, so everything expensive has to happen in the worker. The only
 * storage writes on this path are the ledger insert (bounded to 40 ms by
 * `PlatformEventRepository`) and the conversation-reference upsert the outbound
 * delivery path later reads.
 *
 * ## Why the body is re-parsed from the raw bytes
 *
 * The signature covers the exact bytes Slack sent. Acting on `@Body()` — the
 * parser's re-serialised object — would mean the thing that was verified and
 * the thing that is acted on are two different documents. The raw buffer is
 * parsed here, and `@Body()` is only a fallback for a request whose raw body
 * the parser did not capture (which is a test harness, not Slack).
 *
 * ## HTML URL verification is verified too
 *
 * Unlike the Teams handshake (which carries no bot JWT, D-06), Slack signs its
 * `url_verification` request like any other, so the challenge is echoed only
 * after the MAC passes. An unauthenticated caller therefore cannot use the
 * endpoint as an oracle or as a way to make the app answer arbitrary strings.
 */
@Controller('slack')
export class SlackWebhookController {
  private readonly logger = new Logger(SlackWebhookController.name);

  constructor(
    private readonly verifier: SlackWebhookVerifier,
    private readonly platformEvents: PlatformEventRepository,
    private readonly conversationReferences: ConversationReferenceRepository,
    @InjectQueue(INBOUND_EVENTS_QUEUE) private readonly queue: Queue,
  ) {}

  @Post('events')
  @HttpCode(200)
  async handleEvent(
    @RawBody() rawBody: Buffer | string | undefined,
    @Body() body: SlackEventPayload | undefined,
    @Headers(SLACK_SIGNATURE_HEADER) signature?: string,
    @Headers(SLACK_TIMESTAMP_HEADER) timestamp?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<unknown> {
    this.assertAuthentic(rawBody, signature, timestamp);

    const payload = this.parse(rawBody, body);

    // Slack's one-off endpoint check. Answered after verification, with no
    // writes and nothing enqueued.
    if (payload.type === 'url_verification') {
      if (typeof payload.challenge !== 'string' || payload.challenge.length === 0) {
        throw new BadRequestException('missing challenge');
      }
      res?.setHeader('Content-Type', 'text/plain');
      return payload.challenge;
    }

    // Only message-shaped events are routing input. Slack sends dozens of
    // event types (reactions, channel joins, presence); acknowledging them is
    // correct, and enqueuing them would hand the router an event with no text.
    if (payload.type !== 'event_callback') {
      return { ok: true };
    }

    const event = payload.event;
    if (!event || event.type !== 'message' && event.type !== 'app_mention') {
      return { ok: true };
    }

    // A bot message must never become routing input: the platform's own reply
    // is a message event too, and ingesting it is an infinite loop.
    if (event.bot_id !== undefined || event.subtype === 'bot_message') {
      return { ok: true };
    }

    const channelId = asOpaqueId(event.channel);
    const chatUserId = asOpaqueId(event.user);
    if (!channelId || !chatUserId) {
      // Slack retries a non-2xx forever; a message event we cannot address has
      // no routing destination, so ack and drop rather than answer 4xx.
      return { ok: true };
    }

    const platformEventId =
      asOpaqueId(payload.event_id) ?? asOpaqueId(event.ts) ?? randomUUID();
    const text = typeof event.text === 'string' ? event.text : '';
    const threadId = asOpaqueId(event.thread_ts);
    const replyToMessageId = asOpaqueId(event.ts);
    const teamId = asOpaqueId(payload.team_id);
    const occurredAt = toIsoTimestamp(payload.event_time, event.ts);

    const inbound: InboundEvent = InboundEventSchema.parse({
      event_id: platformEventId,
      platform: 'slack',
      channel_id: channelId,
      chat_user_id: chatUserId,
      text,
      action: 'message',
      queue: INBOUND_EVENTS_QUEUE,
      attempt: 0,
      occurred_at: occurredAt,
      ...(threadId ? { thread_id: threadId } : {}),
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      native_event_id: platformEventId,
      ...(teamId ? { platform_metadata: { team_id: teamId } } : {}),
    });

    // T-10-08: the ledger is the replay/retry contract. Slack retries on any
    // non-2xx and can redeliver after a timeout; a duplicate is a success with
    // nothing enqueued. A ledger failure is fail-closed (503), matching Teams.
    let outcome: 'inserted' | 'duplicate';
    try {
      outcome = await this.platformEvents.record({
        platform: 'slack',
        platformEventId,
        payload,
      });
    } catch {
      throw new ServiceUnavailableException();
    }

    if (outcome === 'duplicate') {
      return { ok: true };
    }

    // The addressing data the worker's Slack outbound path reads. Written here
    // because the receiver is the only place the (channel, user) pair is known
    // while the event is in hand.
    await this.conversationReferences.upsert(
      ConversationReferenceRepository.key('slack', channelId, chatUserId),
      {
        serviceUrl: '',
        conversationId: channelId,
        tenantId: teamId ?? '',
        chatUserId,
        channelId,
        reference: {
          teamId: teamId ?? null,
          channelId,
          chatUserId,
          threadTs: threadId ?? null,
          messageTs: replyToMessageId ?? null,
        },
      },
    );

    await this.queue.add(INBOUND_EVENTS_QUEUE, inbound);

    return { ok: true };
  }

  /**
   * Throw the response for an unauthentic request, and log only allowlisted
   * fields — the presented signature, timestamp and body are never logged.
   */
  private assertAuthentic(
    rawBody: Buffer | string | undefined,
    signature: string | undefined,
    timestamp: string | undefined,
  ): void {
    const result = this.verifier.verify(rawBody, signature, timestamp);
    if (result.ok) {
      return;
    }

    if (result.reason === 'not_configured') {
      // Failing closed, but as an operator fault: no request can be authentic
      // without the secret, and a 401 would read as "Slack is broken".
      this.logger.error({ reason: 'slack_signing_secret_missing', provider: 'slack' });
      throw new ServiceUnavailableException();
    }

    this.logger.warn({ reason: result.reason, provider: 'slack' });
    throw new UnauthorizedException('invalid slack signature');
  }

  private parse(
    rawBody: Buffer | string | undefined,
    body: SlackEventPayload | undefined,
  ): SlackEventPayload {
    const raw = Buffer.isBuffer(rawBody)
      ? rawBody.toString('utf8')
      : typeof rawBody === 'string'
        ? rawBody
        : '';

    if (raw.length === 0) {
      if (body && typeof body === 'object') {
        return body;
      }
      throw new BadRequestException('missing request body');
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        throw new BadRequestException('invalid slack payload');
      }
      return parsed as SlackEventPayload;
    } catch (err: unknown) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      throw new BadRequestException('invalid slack payload');
    }
  }
}

function asOpaqueId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * `event_time` is epoch **seconds** (Slack's `event.ts` is epoch seconds with a
 * fractional part). Both are converted to the envelope's ISO-8601 UTC contract;
 * an unusable timestamp falls back to arrival time rather than failing an
 * otherwise routable message.
 */
function toIsoTimestamp(eventTime: unknown, messageTs: unknown): string {
  const seconds =
    typeof eventTime === 'number'
      ? eventTime
      : typeof messageTs === 'string'
        ? Number.parseFloat(messageTs)
        : Number.NaN;

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return new Date().toISOString();
  }
  return new Date(Math.floor(seconds * 1000)).toISOString();
}
