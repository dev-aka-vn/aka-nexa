import { Module } from '@nestjs/common';
import { ExternalWebhookController } from './external-webhook.controller.js';
import { ExternalWebhookService } from './external-webhook.service.js';
import { NonceStoreService } from './nonce-store.service.js';

import { ExternalWebhookConsumer } from './external-webhook.consumer.js';

@Module({
  controllers: [ExternalWebhookController],
  providers: [ExternalWebhookService, NonceStoreService, ExternalWebhookConsumer],
})
export class ExternalWebhookModule {}
