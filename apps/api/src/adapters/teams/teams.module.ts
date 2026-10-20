import { Module } from '@nestjs/common';
import { MongoModule, MongoService } from '@akane/platform';

import { ApiQueueModule } from '../../queue/api-queue.module.js';
import { TeamsController } from './teams.controller.js';
import { TeamsActivityService } from './teams-activity.service.js';
import { TeamsOutboundService, TEAMS_CLOUD_ADAPTER, TeamsCloudAdapterHolder } from './teams.outbound.service.js';
import { TeamsAuthGuard } from './teams-auth.guard.js';
import { TeamsInboundModule } from '@akane/domain/adapters/teams/inbound/teams-inbound.module.js';
import {
  ConversationReferenceRepository,
} from '@akane/domain';

/**
 * The Teams receiver.
 */
@Module({
  imports: [ApiQueueModule, MongoModule, TeamsInboundModule],
  controllers: [TeamsController],
  providers: [
    TeamsActivityService,
    TeamsOutboundService,
    TeamsAuthGuard,
    {
      provide: ConversationReferenceRepository,
      useFactory: (mongo: MongoService) => new ConversationReferenceRepository(mongo),
      inject: [MongoService],
    },
    {
      provide: TEAMS_CLOUD_ADAPTER,
      useFactory: () => new TeamsCloudAdapterHolder(),
    },
  ],
  exports: [TeamsOutboundService, TeamsAuthGuard, TeamsActivityService, ConversationReferenceRepository],
})
export class TeamsModule {}