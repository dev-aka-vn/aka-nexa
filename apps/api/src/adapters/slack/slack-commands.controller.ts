import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  RawBody,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
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

/**
 * The Slack slash-command receiver (OUT-04).
 *
 * ## Slack signs slash commands exactly like it signs events
 *
 * The same `x-slack-signature` / `x-slack-request-timestamp` pair over the same
 * `v0:<ts>:<raw body>` material, so the same verifier is used. The difference is
 * the encoding: a slash command arrives as
 * `application/x-www-form-urlencoded`, and the signed bytes are the *encoded*
 * body — which is why the raw buffer is parsed here with `URLSearchParams`
 * rather than trusting a re-serialised object.
 *
 * (`rawBody: true` is set on the Nest factory in `apps/api/src/main.ts`, and it
 * covers the urlencoded parser as well as the JSON one, so the exact bytes
 * Slack signed are available here.)
 */
@Controller('slack')
export class SlackCommandsController {
  private readonly logger = new Logger(SlackCommandsController.name);

  constructor(
    private readonly verifier: SlackWebhookVerifier,
    private readonly platformEvents: PlatformEventRepository,
    private readonly conversationReferences: ConversationReferenceRepository,
    @InjectQueue(INBOUND_EVENTS_QUEUE) private readonly queue: Queue,
  ) {}

  @Post('commands')
  @HttpCode(200)
  async handleCommand(
    @RawBody() rawBody: Buffer | string | undefined,
    @Body() body: Record<string, unknown> | undefined,
    @Headers(SLACK_SIGNATURE_HEADER) signature?: string,
    @Headers(SLACK_TIMESTAMP_HEADER) timestamp?: string,
  ): Promise<Record<string, unknown>> {
    this.assertAuthentic(rawBody, signature, timestamp);

    const params = this.parse(rawBody, body);

    const command = readParam(params, 'command');
    const channelId = readParam(params, 'channel_id');
    const chatUserId = readParam(params, 'user_id');
    const teamId = readParam(params, 'team_id');
    const text = readParam(params, 'text');

    if (!command || !channelId || !chatUserId) {
      // A slash command without a channel or a user cannot be routed, and
      // Slack retries a 4xx forever — so this is acked, not rejected.
      return { response_type: 'ephemeral' };
    }

    // Slack issues a fresh `trigger_id` per invocation, and it is the only
    // per-invocation identifier a slash command carries. A redelivery of the
    // same request repeats it, which is what the ledger needs to collapse a
    // retry into a single processing.
    const platformEventId = readParam(params, 'trigger_id') ?? randomUUID();

    const inbound: InboundEvent = InboundEventSchema.parse({
      event_id: platformEventId,
      platform: 'slack',
      channel_id: channelId,
      chat_user_id: chatUserId,
      // The command token is part of the intent ("/redmine …"), so it travels
      // with the arguments rather than being dropped.
      text: [command, text].filter((part) => part.length > 0).join(' '),
      action: 'slash_command',
      queue: INBOUND_EVENTS_QUEUE,
      attempt: 0,
      occurred_at: new Date().toISOString(),
      native_event_id: platformEventId,
      ...(teamId ? { platform_metadata: { team_id: teamId } } : {}),
    });

    let outcome: 'inserted' | 'duplicate';
    try {
      outcome = await this.platformEvents.record({
        platform: 'slack',
        platformEventId,
        payload: { command, text, teamId, channelId },
      });
    } catch {
      throw new ServiceUnavailableException();
    }

    if (outcome === 'duplicate') {
      return { response_type: 'ephemeral' };
    }

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
          command,
        },
      },
    );

    await this.queue.add(INBOUND_EVENTS_QUEUE, inbound);

    // The visible answer arrives through the outbound path, not here: the ack
    // budget is 200 ms and the reply is a worker delivery.
    return { response_type: 'ephemeral' };
  }

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
      this.logger.error({ reason: 'slack_signing_secret_missing', provider: 'slack' });
      throw new ServiceUnavailableException();
    }

    this.logger.warn({ reason: result.reason, provider: 'slack' });
    throw new UnauthorizedException('invalid slack signature');
  }

  /**
   * Parse the urlencoded body from the **signed** bytes. `URLSearchParams` is
   * the platform's own parser for this encoding; a second dependency (`qs`)
   * would be a dependency for a job the standard library already does.
   */
  private parse(
    rawBody: Buffer | string | undefined,
    body: Record<string, unknown> | undefined,
  ): URLSearchParams {
    const raw = Buffer.isBuffer(rawBody)
      ? rawBody.toString('utf8')
      : typeof rawBody === 'string'
        ? rawBody
        : '';

    if (raw.length === 0) {
      if (body && typeof body === 'object') {
        return new URLSearchParams(
          Object.entries(body).map(([key, value]): [string, string] => [
            key,
            String(value ?? ''),
          ]),
        );
      }
      throw new BadRequestException('missing request body');
    }

    return new URLSearchParams(raw);
  }
}

function readParam(params: URLSearchParams, key: string): string {
  const value = params.get(key);
  return typeof value === 'string' && value.length > 0 ? value : '';
}
