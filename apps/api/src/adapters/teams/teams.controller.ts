import { Controller, Post, RawBody, Req, Res } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  AgentApplication,
  CloudAdapter,
  MemoryStorage,
  TurnState,
  loadAuthConfigFromEnv,
  type Request as AgentRequest,
  type TurnContext,
  type WebResponse,
} from '@microsoft/agents-hosting';
import { randomUUID } from 'crypto';

import { InboundEventSchema, type InboundEvent } from '@akane/contract';

/**
 * The Agents SDK's own `Activity` shape, reached through `TurnContext`.
 *
 * A direct `@microsoft/agents-activity` import would be a *phantom* dependency —
 * that package is a transitive dependency of `@microsoft/agents-hosting`, not a
 * declared one — so the type is derived from the SDK surface we already depend
 * on. `TurnContext['activity']` is exactly that `Activity` type.
 */
type TeamsActivity = TurnContext['activity'];

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
  private agentApp: AgentApplication<TurnState> | undefined;

  constructor(@InjectQueue('im:inbound') private readonly queue: Queue) {}

  /**
   * Built on first use rather than in the constructor: `loadAuthConfigFromEnv()`
   * reads the Teams connection settings out of the environment, and a testing
   * module that never handles a Teams turn must still boot without them.
   */
  private getAgentApp(): AgentApplication<TurnState> {
    if (this.agentApp) {
      return this.agentApp;
    }

    const app = new AgentApplication<TurnState>({
      storage: new MemoryStorage(),
      adapter: new CloudAdapter(loadAuthConfigFromEnv()),
    });

    // Register the message handler. `onActivity` takes the activity type first;
    // the previous catch-all registration only ever acted on `message`, so that
    // single type expresses the same behaviour without an unroutable selector.
    app.onActivity('message', async (context) => {
      const inboundEvent = this.normalizeTeamsActivity(context.activity);

      // Enqueue processing with ack semantics < 200ms (IM-03)
      await this.queue.add('im:inbound', inboundEvent, {
        jobId: inboundEvent.event_id,
      });
    });

    this.agentApp = app;
    return app;
  }

  @Post('events')
  async handleEvents(
    @Req() req: AgentRequest,
    @Res() res: WebResponse,
    @RawBody() _rawBody: Buffer,
  ): Promise<void> {
    const app = this.getAgentApp();
    // The CloudAdapter owns the HTTP contract; `run` dispatches the turn to the
    // activity handler registered above.
    await app.adapter.process(req, res, (context) => app.run(context));
  }

  private normalizeTeamsActivity(activity: TeamsActivity): InboundEvent {
    const now = new Date().toISOString();
    const eventId = randomUUID();

    // Extract text from message activity
    const text = typeof activity.text === 'string' ? activity.text : '';

    // Extract channel and user IDs (opaque)
    const channelId = activity.conversation?.id ?? activity.channelId ?? randomUUID();
    const chatUserId = activity.from?.id ?? activity.recipient?.id ?? randomUUID();

    const event: InboundEvent = {
      event_id: eventId,
      platform: 'teams',
      channel_id: channelId,
      chat_user_id: chatUserId,
      text,
      action: 'message',
      queue: 'im:inbound',
      attempt: 0,
      occurred_at: activity.timestamp ? new Date(activity.timestamp).toISOString() : now,
    };

    // Validate against schema to enforce contract at boundary
    return InboundEventSchema.parse(event);
  }
}
