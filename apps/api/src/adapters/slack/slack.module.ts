import { Module } from '@nestjs/common';
import { MongoModule, MongoService, SlackWebhookVerifier } from '@akane/platform';

import { ApiQueueModule } from '../../queue/api-queue.module.js';
import { SlackCommandsController } from './slack-commands.controller.js';
import { SlackWebhookController } from './slack-webhook.controller.js';
import {
  ConversationReferenceRepository,
  PlatformEventRepository,
} from '@akane/domain';

/**
 * The Slack receiver — the api side of the platform (OUT-04).
 *
 * ## What is provided here, and why each one is here
 *
 * - `SlackWebhookVerifier` — the transport-authentication surface. It reads the
 *   boot-validated `SLACK_SIGNING_SECRET` through the global `ConfigService`
 *   and fails closed when the secret is absent.
 * - `PlatformEventRepository` — the dedupe ledger (OUT-09/T-10-08). The
 *   receivers write one `pending` row per inbound event, and a Slack retry
 *   loses the race on the unique `(platform, platform_event_id)` index, which
 *   is what turns a redelivery into a no-op instead of a second processing.
 * - `ConversationReferenceRepository` — the addressing data the worker's
 *   outbound path reads when it replies to the originating Slack channel.
 * - `ApiQueueModule` — the producer side of `INBOUND_EVENTS_QUEUE`. The
 *   receiver enqueues one `InboundEvent` and returns; no logic runs here.
 *
 * ## No outbound delivery here
 *
 * The Slack outbound port lives in
 * `@akane/domain/adapters/slack/outbound` and its implementation belongs to
 * the worker. The api receiver must not gain the ability to send: that would
 * put an outbound call inside the <200 ms ack budget (D-13) and give the
 * receiver a delivery path (T-10-06).
 */
@Module({
  imports: [ApiQueueModule, MongoModule],
  controllers: [SlackCommandsController, SlackWebhookController],
  providers: [
    SlackWebhookVerifier,
    PlatformEventRepository,
    {
      provide: ConversationReferenceRepository,
      useFactory: (mongo: MongoService) => new ConversationReferenceRepository(mongo),
      inject: [MongoService],
    },
  ],
})
export class SlackModule {}
