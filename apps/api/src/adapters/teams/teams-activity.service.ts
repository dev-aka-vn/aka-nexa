import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomUUID } from 'crypto';

import { INBOUND_EVENTS_QUEUE } from '@akane/platform';
import { InboundEventSchema, type InboundEvent } from '@akane/contract';
import { ConversationReferenceRepository } from '@akane/domain';
import { TeamsEventRepository } from '@akane/domain/adapters/teams/inbound/data-access/teams-event.repository.js';

interface TeamsActivityLike {
  id?: string;
  type?: string;
  text?: string;
  serviceUrl?: string;
  conversation?: { id?: string; tenantId?: string };
  from?: { id?: string };
  recipient?: { id?: string };
  channelId?: string;
  timestamp?: string;
  channelData?: { tenant?: { id?: string } };
  value?: unknown;
}

export type TeamsActivityOutcome = 'enqueued' | 'duplicate' | 'challenge';

@Injectable()
export class TeamsActivityService {
  constructor(
    private readonly teamsEventRepo: TeamsEventRepository,
    private readonly convRefRepo: ConversationReferenceRepository,
    @InjectQueue(INBOUND_EVENTS_QUEUE) private readonly queue: Queue,
  ) {}

  async handle(activity: unknown): Promise<TeamsActivityOutcome> {
    const a = (activity ?? {}) as TeamsActivityLike;

    // D-06 defence in depth: a handshake that reaches handle is answered as a
    // challenge with no writes.
    if (a.type === 'urlVerification') {
      return 'challenge';
    }

    const eventId = a.id && a.id.length > 0 ? a.id : randomUUID();

    const channelId = a.conversation?.id ?? a.channelId ?? randomUUID();
    const chatUserId = a.from?.id ?? a.recipient?.id ?? randomUUID();
    const text = typeof a.text === 'string' ? a.text : '';
    const occurredAt =
      a.timestamp && !Number.isNaN(Date.parse(a.timestamp))
        ? new Date(a.timestamp).toISOString()
        : new Date().toISOString();

    const event: InboundEvent = InboundEventSchema.parse({
      event_id: eventId,
      platform: 'teams',
      channel_id: channelId,
      chat_user_id: chatUserId,
      text,
      action: 'message',
      queue: INBOUND_EVENTS_QUEUE,
      attempt: 0,
      occurred_at: occurredAt,
    });

    let insertResult: 'inserted' | 'duplicate';
    try {
      insertResult = await this.teamsEventRepo.insert(eventId, activity);
    } catch {
      throw new ServiceUnavailableException();
    }

    if (insertResult === 'duplicate') {
      return 'duplicate';
    }

    const serviceUrl = a.serviceUrl ?? '';
    const conversationId = a.conversation?.id ?? channelId;
    const tenantId = a.conversation?.tenantId ?? a.channelData?.tenant?.id ?? '';
    const key = ConversationReferenceRepository.key('teams', channelId, chatUserId);
    await this.convRefRepo.upsert(key, {
      serviceUrl,
      conversationId,
      tenantId,
      chatUserId,
      channelId,
      reference: activity,
    });

    await this.queue.add(INBOUND_EVENTS_QUEUE, event);

    return 'enqueued';
  }
}