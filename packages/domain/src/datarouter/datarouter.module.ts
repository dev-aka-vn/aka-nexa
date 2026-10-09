import { Module } from '@nestjs/common';
import { DataRouterService } from './data-router.service.js';
import { OutboxRepository } from './data-access/outbox.repository.js';
import { SubmissionRevisionsRepository } from '../submissions/data-access/submission-revisions.repository.js';

@Module({
  providers: [DataRouterService, OutboxRepository, SubmissionRevisionsRepository],
  exports: [DataRouterService, OutboxRepository, SubmissionRevisionsRepository],
})
export class DatarouterModule {}
