import { Connector } from '@contract/connector/connector';

export class ConnectorNotFoundError extends Error {
  constructor(ref: string) {
    super(`Connector not found: ${ref}`);
    this.name = 'ConnectorNotFoundError';
  }
}

export interface ConnectorRegistryEntry {
  readonly connectorRef: string;
  readonly adapter: Connector;
  readonly credentialRef?: string;
}

export class ConnectorRegistry {
  private readonly entries = new Map<string, ConnectorRegistryEntry>();

  register(entry: ConnectorRegistryEntry): void {
    this.entries.set(entry.connectorRef, entry);
    if (entry.credentialRef) {
      this.entries.set(entry.credentialRef, entry);
    }
  }

  resolve(ref: string): Connector {
    const entry = this.entries.get(ref);
    if (!entry) {
      throw new ConnectorNotFoundError(ref);
    }
    return entry.adapter;
  }

  getDescriptor(ref: string) {
    const entry = this.entries.get(ref);
    if (!entry) {
      throw new ConnectorNotFoundError(ref);
    }
    return entry.adapter.descriptor;
  }
}
