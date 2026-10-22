import { Module } from '@nestjs/common';
import { MongoModule, MongoService } from '@akane/platform';

import { ApiQueueModule } from '../../queue/api-queue.module.js';
import { TeamsController } from './teams.controller.js';
import { TeamsActivityService } from './teams-activity.service.js';
import { TeamsAuthGuard } from './teams-auth.guard.js';
import { TeamsInboundModule } from '@akane/domain/adapters/teams/inbound/teams-inbound.module.js';
import {
  ConversationReferenceRepository,
} from '@akane/domain';

/**
 * The Teams receiver — the api side of the platform.
 *
 * ## No outbound delivery here (OUT-12, T-10-06)
 *
 * The uncalled `TeamsOutboundService` (and its `TEAMS_CLOUD_ADAPTER` holder)
 * used to sit beside this module. Delivery is a worker capability: it resolves
 * a conversation reference and calls the Agents SDK, and doing that from the
 * request path would put an outbound call inside the <200 ms ack budget and
 * give the receiver the ability to send. The port now lives in
 * `@akane/domain/adapters/teams/outbound` and the implementation in
 * `apps/worker/src/adapters/teams/outbound/`; R1
 * (`tooling/boundaries.config.mjs`) makes an api import of that path a build
 * failure, so the removal is enforced rather than merely observed.
 *
 * `ConversationReferenceRepository` stays: the receiver's `TeamsActivityService`
 * writes the reference the worker later reads (OUT-07, platform-scoped key).
 */
@Module({
  imports: [ApiQueueModule, MongoModule, TeamsInboundModule],
  controllers: [TeamsController],
  providers: [
    TeamsActivityService,
    TeamsAuthGuard,
    {
      provide: ConversationReferenceRepository,
      useFactory: (mongo: MongoService) => new ConversationReferenceRepository(mongo),
      inject: [MongoService],
    },
  ],
  exports: [TeamsAuthGuard, TeamsActivityService, ConversationReferenceRepository],
})
export class TeamsModule {}