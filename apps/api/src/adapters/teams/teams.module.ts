import { Module } from '@nestjs/common';
import { TeamsController } from './teams.controller.js';
import { TeamsOutboundService } from './teams.outbound.service.js';
import { TeamsAuthGuard } from './teams-auth.guard.js';

@Module({
  controllers: [TeamsController],
  providers: [TeamsOutboundService, TeamsAuthGuard],
  exports: [TeamsOutboundService, TeamsAuthGuard],
})
export class TeamsModule {}
