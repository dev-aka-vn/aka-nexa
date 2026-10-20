import { Module } from '@nestjs/common';
import { TeamsEventRepository } from './data-access/teams-event.repository.js';

@Module({
  providers: [TeamsEventRepository],
  exports: [TeamsEventRepository],
})
export class TeamsInboundModule {}
