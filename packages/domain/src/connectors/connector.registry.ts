import { Connector } from '@akane/contract';

import { DEFAULT_CONNECTOR_LIMIT, type ConnectorLimitConfig } from './connector-rate-limiter.js';

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
  /**
   * The per-instance budget (CON-05). Absent means "use the conservative
   * default" — never "unlimited". Parsed from the seed's `rate_limit` by
   * `parseConnectorLimit` at registration time.
   */
  readonly limit?: ConnectorLimitConfig;
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

  /**
   * The budget for `ref` (CON-05).
   *
   * Throws {@link ConnectorNotFoundError} for an unknown ref **before** the
   * limiter is ever consulted — the fail-closed ruling. A known connector with
   * no declared limit gets the conservative default, so a missing config is
   * never read as an absent limit.
   */
  limiterConfig(ref: string): ConnectorLimitConfig {
    const entry = this.entries.get(ref);
    if (!entry) {
      throw new ConnectorNotFoundError(ref);
    }
    return entry.limit ?? DEFAULT_CONNECTOR_LIMIT;
  }

  async testConnection(ref: string) {
    const entry = this.entries.get(ref);
    if (!entry) {
      throw new ConnectorNotFoundError(ref);
    }
    return entry.adapter.testConnection();
  }

  async getCapabilities(ref: string) {
    const entry = this.entries.get(ref);
    if (!entry) {
      throw new ConnectorNotFoundError(ref);
    }
    return entry.adapter.getCapabilities();
  }
}
