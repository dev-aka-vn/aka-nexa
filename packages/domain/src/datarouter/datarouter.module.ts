import { Module } from '@nestjs/common';
import { DataRouterService } from './data-router.service.js';
import { OutboxRepository } from './data-access/outbox.repository.js';

@Module({
  providers: [DataRouterService, OutboxRepository],
  exports: [DataRouterService, OutboxRepository],
})
export class DatarouterModule {}
