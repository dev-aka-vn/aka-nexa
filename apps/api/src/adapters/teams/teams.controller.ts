import { Controller, Post, RawBody, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AgentApplication, TurnContext, MemoryStorage, AuthConfiguration } from '@microsoft/agents-hosting';
import { randomUUID } from 'crypto';

import { InboundEvent, type InboundEvent as InboundEventType } from '@akane/contract/events/inbound-event.js';
import type { Queue } from '@akane/platform/queue/queue.js';

/**
 * Teams adapter controller - normalizes Teams activities to InboundEvent.
 *
 * Kernel remains IM-agnostic: only InboundEvent/OutboundMessage cross the
 * adapter boundary. No Teams SDK types are exported from this adapter.
 *
 * Webhook endpoint: POST /teams/events
 */
@Controller('teams')
export class TeamsController {
  private readonly agentApp: AgentApplication;

  constructor(private readonly queue: Queue) {
    this.agentApp = new AgentApplication({
      storage: new MemoryStorage(),
      auth: new AuthConfiguration({
        // Auth configuration per environment; handled by Agents SDK
      }),
    });

    // Register activity handler for message activities
    this.agentApp.onMessage(async (context: TurnContext) => {
      const activity = context.activity;
      
      // Normalize Teams activity to InboundEvent
      const inboundEvent = this.normalizeTeamsActivity(activity);
      
      // Enqueue processing with ack semantics < 200ms (IM-03)
      await this.queue.add('im:inbound', inboundEvent, {
        jobId: inboundEvent.event_id,
      });
    });

    // Register generic activity handler for other event types
    this.agentApp.onActivity(async (context: TurnContext) => {
      const activity = context.activity;
      // Only process message-type activities for now
      if (activity.type === 'message') {
        const inboundEvent = this.normalizeTeamsActivity(activity);
        await this.queue.add('im:inbound', inboundEvent, {
          jobId: inboundEvent.event_id,
        });
      }
      // For other activity types, ack without enqueuing (tracer E2E focuses on messages)
    });
  }

  @Post('events')
  async handleEvents(@Req() req: Request, @Res() res: Response, @RawBody() _rawBody: Buffer): Promise<void> {
    // Process activity via Agents SDK
    await this.agentApp.processActivity(req, res);
  }

  private normalizeTeamsActivity(activity: any): InboundEventType {
    const now = new Date().toISOString();
    const eventId = randomUUID();
    
    // Extract text from message activity
    const text = typeof activity.text === 'string' ? activity.text : '';
    
    // Extract channel and user IDs (opaque)
    const channelId = activity.conversation?.id ?? activity.channelId ?? randomUUID();
    const chatUserId = activity.from?.id ?? activity.recipient?.id ?? randomUUID();
    
    const event: InboundEventType = {
      event_id: eventId,
      platform: 'teams',
      channel_id: channelId,
      chat_user_id: chatUserId,
      text,
      action: 'message',
      queue: 'im:inbound',
      attempt: 0,
      occurred_at: activity.timestamp ?? now,
    };
    
    // Validate against schema to enforce contract at boundary
    return InboundEvent.parse(event);
  }
}
