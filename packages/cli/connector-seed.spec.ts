import { describe, it, expect, vi } from 'vitest';
import { loadConnectorSeed, upsertConnector } from './connector.js';
import { ConnectorCredentialsRepository, ConnectorRegistry } from '@akane/domain';

describe('connector seed', () => {
  it('validates the seed file', async () => {
    const seed = await loadConnectorSeed('config/connectors/redmine.dev.json');
    expect(seed).toBeDefined();
    expect(seed.connector_ref).toBeTruthy();
    expect(seed.base_url).toBeTruthy();
    expect(seed.credential_ref).toBeTruthy();
  });

  it('re-run with unchanged file is a no-op', async () => {
    const seed = await loadConnectorSeed('config/connectors/redmine.dev.json');
    const registry = new ConnectorRegistry();
    const credsRepo = {
      get: vi.fn().mockResolvedValue({
        credentialRef: seed.credential_ref,
        headerName: 'X-Redmine-API-Key',
        decryptedValue: 'test-key',
      }),
    } as unknown as ConnectorCredentialsRepository;

    const result1 = await upsertConnector(seed, registry, credsRepo);
    expect(result1.changed).toBe(true);
    
    const result2 = await upsertConnector(seed, registry, credsRepo);
    expect(result2.changed).toBe(false);
  });
});
