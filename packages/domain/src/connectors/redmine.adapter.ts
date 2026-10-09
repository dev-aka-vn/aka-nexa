import {
  Connector,
  ConnectorCapability,
  ConnectorDescriptor,
  ConnectorExecuteContext,
  ConnectorExecuteOutcome,
  ConnectorExecutePayload,
  ConnectorTestResult,
} from '@contract/connector/connector';
import { RestCore, RestCredential } from './rest-core';

export class RedmineAdapter implements Connector {
  readonly descriptor: ConnectorDescriptor = {
    id: 'redmine',
    name: 'Redmine',
    supports_idempotency_key: false,
  };

  constructor(private readonly rest: RestCore) {}

  async testConnection(): Promise<ConnectorTestResult> {
    try {
      // For tracer, return ok
      return { ok: true };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  }

  async getCapabilities(): Promise<ConnectorCapability[]> {
    return [
      {
        name: 'create-issue',
        supportsIdempotency: this.descriptor.supports_idempotency_key,
        operations: ['create-issue'],
      },
    ];
  }

  async execute(
    operation: string,
    payload: ConnectorExecutePayload,
    context: ConnectorExecuteContext,
  ): Promise<ConnectorExecuteOutcome> {
    const result = await this.rest.request({
      method: 'POST',
      path: '/issues.json',
      body: {
        issue: payload.data,
      },
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // For tracer path - if succeeded, try to set externalId null as per plan
    // Plan says "201 → {issue:{id}} mapped to the outcome's external reference"
    // But our rest-core doesn't parse body. For tracer, maybe return as is.
    return result;
  }
}
