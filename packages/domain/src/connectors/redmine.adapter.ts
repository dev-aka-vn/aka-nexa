import {
  Connector,
  ConnectorCapability,
  ConnectorDescriptor,
  ConnectorExecuteContext,
  ConnectorExecuteOutcome,
  ConnectorExecutePayload,
  ConnectorTestResult,
} from '@akane/contract';
import { RestCore } from './rest-core.js';
import { FieldMappingResolver } from './field-mapping.js';

export interface RedmineAdapterConfig {
  readonly correlationCustomFieldId?: string;
  readonly realUserProfile?: Record<string, unknown>;
}

export class RedmineAdapter implements Connector {
  readonly descriptor: ConnectorDescriptor = {
    id: 'redmine',
    name: 'Redmine',
    supports_idempotency_key: false,
  };

  private readonly resolver = new FieldMappingResolver();
  private readonly config: RedmineAdapterConfig;

  constructor(
    private readonly rest: RestCore,
    config?: RedmineAdapterConfig,
  ) {
    this.config = config ?? {};
  }

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
    // Resolve real user profile from metadata or config
    const realUserProfile =
      (context.metadata?.realUserProfile as Record<string, unknown>) ??
      this.config.realUserProfile ??
      {};

    const revision =
      (context.metadata?.revision as number | string) ?? 0;

    const correlationCustomFieldId =
      (context.metadata?.correlationCustomFieldId as string) ??
      this.config.correlationCustomFieldId;

    // Map FIRST (Pitfall 5) - classify any mapping failure as failed_permanent before transport
    const mappingResult = this.resolver.resolve({
      formData: payload.data,
      realUserProfile,
      submissionId: payload.submissionId,
      revision,
      correlationCustomFieldId,
    });

    if (!mappingResult.success) {
      return mappingResult.outcome;
    }

    const result = await this.rest.request({
      method: 'POST',
      path: '/issues.json',
      body: {
        issue: mappingResult.data,
      },
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return result;
  }
}
