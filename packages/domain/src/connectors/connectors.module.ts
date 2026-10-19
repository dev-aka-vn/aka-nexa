import { Module } from '@nestjs/common';
import { MongoModule, MongoService } from '@akane/platform';

import { ConnectorCredentialsRepository } from './data-access/connector-credentials.repository.js';
import { ConnectorTrustRepository } from './data-access/connector-trust.repository.js';
import { ConnectorRegistry } from './connector.registry.js';

@Module({
  imports: [MongoModule],
  providers: [
    ConnectorCredentialsRepository,
    {
      provide: ConnectorTrustRepository,
      useFactory: (mongo: MongoService): ConnectorTrustRepository =>
        new ConnectorTrustRepository(mongo),
      inject: [MongoService],
    },
    {
      provide: ConnectorRegistry,
      useFactory: () => {
        return new ConnectorRegistry();
      },
    },
  ],
  exports: [ConnectorRegistry, ConnectorCredentialsRepository, ConnectorTrustRepository],
})
export class ConnectorsModule {}