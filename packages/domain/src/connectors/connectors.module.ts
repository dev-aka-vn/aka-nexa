import { Module } from '@nestjs/common';
import { ConnectorCredentialsRepository } from './data-access/connector-credentials.repository.js';
import { ConnectorRegistry } from './connector.registry.js';

@Module({
  providers: [
    ConnectorCredentialsRepository,
    {
      provide: ConnectorRegistry,
      useFactory: () => {
        return new ConnectorRegistry();
      },
    },
  ],
  exports: [ConnectorRegistry, ConnectorCredentialsRepository],
})
export class ConnectorsModule {}
