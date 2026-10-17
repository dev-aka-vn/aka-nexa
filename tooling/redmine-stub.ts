import { Connector, ConnectorExecuteOutcome, ConnectorExecutePayload, ConnectorExecuteContext, ConnectorDescriptor, ConnectorTestResult, ConnectorCapability } from '@akane/contract';

export class RedmineStubConnector implements Connector {
  readonly descriptor: ConnectorDescriptor = {
    id: 'redmine-stub',
    name: 'Redmine Stub',
    supports_idempotency_key: false,
  };

  constructor(
    private readonly behavior: {
      execute: (payload: ConnectorExecutePayload, context: ConnectorExecuteContext) => Promise<ConnectorExecuteOutcome>;
    } = {
      execute: async () => ({ status: 'succeeded' as const, externalId: 'stub-1' }),
    },
  ) {}

  async testConnection(): Promise<ConnectorTestResult> {
    return { ok: true };
  }

  async getCapabilities(): Promise<ConnectorCapability[]> {
    return [];
  }

  async execute(operation: string, payload: ConnectorExecutePayload, context: ConnectorExecuteContext): Promise<ConnectorExecuteOutcome> {
    return this.behavior.execute(payload, context);
  }
}

export const createRedmineStub = (behavior?: any) => new RedmineStubConnector(behavior);
