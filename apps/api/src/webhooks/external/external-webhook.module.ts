import { Module } from '@nestjs/common';
import { MongoModule, MongoService, CryptoModule, CRYPTO_KEY_PROVIDER, redisCacheProvider } from '@akane/platform';

import { ExternalWebhookController } from './external-webhook.controller.js';
import { ExternalWebhookService } from './external-webhook.service.js';
import { NonceStoreService } from './nonce-store.service.js';
import { WebhookHmacService } from './webhook-hmac.service.js';
import { ConnectorTrustController } from './connector-trust.controller.js';

import { ApiQueueModule } from '../../queue/api-queue.module.js';
import { AuditRepository, ConnectorCredentialsRepository, ConnectorTrustRepository } from '@akane/domain';

/**
 * The external-webhook receiver.
 */
@Module({
  imports: [ApiQueueModule, MongoModule, CryptoModule],
  controllers: [ExternalWebhookController, ConnectorTrustController],
  providers: [
    redisCacheProvider,
    ExternalWebhookService,
    NonceStoreService,
    WebhookHmacService,
    AuditRepository,
    {
      provide: ConnectorCredentialsRepository,
      useFactory: (mongo: MongoService, keyProvider: unknown) =>
        new ConnectorCredentialsRepository(mongo, keyProvider as never),
      inject: [MongoService, CRYPTO_KEY_PROVIDER],
    },
    {
      provide: ConnectorTrustRepository,
      useFactory: (mongo: MongoService) => new ConnectorTrustRepository(mongo),
      inject: [MongoService],
    },
  ],
  exports: [ExternalWebhookService, NonceStoreService, WebhookHmacService],
})
export class ExternalWebhookModule {}