import { Module } from '@nestjs/common';
import { TeamsController } from './teams.controller.js';
import { TeamsOutboundService } from './teams.outbound.service.js';
import { TeamsAuthGuard } from './teams-auth.guard.js';
import { ApiQueueModule } from '../../queue/api-queue.module.js';

/**
 * The Teams receiver.
 *
 * `ApiQueueModule` is imported here — and by `ExternalWebhookModule` — rather
 * than from `apps/api/src/app.module.ts`: the two receivers are the *only* api
 * surfaces that enqueue, so the producer registration is scoped to them. The api
 * composition root must not bind `QueueModule` (entrypoint-drift asserts it), and
 * the heartbeat producer token stays forbidden in api (D-37).
 */
@Module({
  imports: [ApiQueueModule],
  controllers: [TeamsController],
  providers: [TeamsOutboundService, TeamsAuthGuard],
  exports: [TeamsOutboundService, TeamsAuthGuard],
})
export class TeamsModule {}
