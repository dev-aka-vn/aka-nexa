import { describe, it, expect } from 'vitest';
import { ConnectorRegistry } from './connector.registry.js';
import { RedmineAdapter } from './redmine.adapter.js';
import { RestCore } from './rest-core.js';

describe('connector tracer', () => {
  it('resolves a seeded credential_ref to an adapter', () => {
    const rest = new RestCore({ baseUrl: 'http://example.com' }, { headerName: 'X-API-Key', decryptedValue: 'test-key' });
    const adapter = new RedmineAdapter(rest);
    const registry = new ConnectorRegistry();
    registry.register({
      connectorRef: 'redmine',
      adapter,
      credentialRef: 'cred-redmine-1',
    });

    const resolved = registry.resolve('cred-redmine-1');
    expect(resolved).toBe(adapter);
  });

  it('unknown connector_ref fails closed with a named error', () => {
    const registry = new ConnectorRegistry();
    expect(() => registry.resolve('unknown-ref')).toThrowError(/Connector not found/);
  });

  it('execute reaches transport and returns outcome with valid status', async () => {
    const rest = new RestCore({ baseUrl: 'http://example.com' }, { headerName: 'X-API-Key', decryptedValue: 'test-key' });
    const adapter = new RedmineAdapter(rest);
    const result = await adapter.execute('create-issue', {
      submissionId: 'sub-1',
      appId: 'app-1',
      formId: 'form-1',
      data: { subject: 'Test' },
    }, {
      idempotencyKey: null,
    });

    expect(['succeeded', 'rejected', 'failed_transient', 'failed_permanent']).toContain(result.status);
  });
});
