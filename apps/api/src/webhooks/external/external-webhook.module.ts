import { Module } from '@nestjs/common';
import { ExternalWebhookController } from './external-webhook.controller.js';
import { ExternalWebhookService } from './external-webhook.service.js';
import { NonceStoreService } from './nonce-store.service.js';

import { ExternalWebhookConsumer } from './external-webhook.consumer.js';
import { ApiQueueModule } from '../../queue/api-queue.module.js';

/**
 * The external-webhook receiver.
 *
 * `ApiQueueModule` supplies the `NOTIFICATION_SEND_QUEUE` producer the service
 * enqueues onto (D-37). Imported here, not from the api composition root, so the
 * producer registration stays scoped to the receivers that actually enqueue.
 */
@Module({
  imports: [ApiQueueModule],
  controllers: [ExternalWebhookController],
  providers: [ExternalWebhookService, NonceStoreService, ExternalWebhookConsumer],
})
export class ExternalWebhookModule {}
