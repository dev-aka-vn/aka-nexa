/**
 * BLD-10 / D-97..D-100 — the operator's provision flow.
 *
 * The operator's step is the **only path a credential
 * enters the system** (D-100): `provisionConnectorRequests`
 * reads pending requests, writes the credential through
 * `ConnectorCredentialsRepository.upsert` (the AES-256-GCM
 * envelope seam — no builder surface ever holds a
 * plaintext), registers the connector through the existing
 * `upsertConnector` seed seam, and resolves the request to
 * `provisioned` with the audited `connector_request.provisioned`
 * transition.
 *
 * ## The D-100 guard
 *
 * The credential write is gated by `assertKeyProviderAllowed`
 * — the same guard the composition root runs at boot. A
 * production boot without a KMS provider refuses the write
 * with `CRYPTO_KEY_PROVIDER_REQUIRED` **before any I/O**:
 * no envelope is written, no connector is registered, no
 * request moves, no audit entry is appended. The guard is
 * not relaxed for the builder flow — FND-10 stays
 * authoritative (D-97).
 */

import { describe, expect, it } from 'vitest';

import type {
  ConnectorCredentialsRepository,
  ConnectorCredential,
  ConnectorRegistry,
  ConnectorRequestDocument,
  ConnectorRequestRepository,
} from '@akane/domain';
import { AuditRepository, ConnectorRegistry as RealRegistry } from '@akane/domain';
import type { KeyProviderGuardConfig } from '@akane/platform';

import { provisionConnectorRequests } from './provision.js';

// ─── Doubles ──────────────────────────────────────────────

/** The credential seam: records every upsert, decrypts on get. */
class FakeCredentialsRepository {
  readonly upserts: {
    readonly credentialRef: string;
    readonly headerName: string;
    readonly plaintext: string;
  }[] = [];
  private readonly stored = new Map<string, ConnectorCredential>();

  async upsert(
    credentialRef: string,
    headerName: string,
    plaintext: string,
  ): Promise<void> {
    this.upserts.push({ credentialRef, headerName, plaintext });
    this.stored.set(credentialRef, {
      credentialRef,
      headerName,
      decryptedValue: plaintext,
    });
  }

  async get(credentialRef: string): Promise<ConnectorCredential | null> {
    return this.stored.get(credentialRef) ?? null;
  }
}

/** The request queue: an in-memory `connector_requests` stand-in. */
class FakeRequestRepository {
  readonly docs: ConnectorRequestDocument[] = [];
  readonly transitions: {
    readonly requestId: string;
    readonly to: string;
    readonly options: Record<string, unknown>;
  }[] = [];

  async listPending(): Promise<ConnectorRequestDocument[]> {
    return this.docs.filter((doc) => doc.state === 'pending');
  }

  async transition(
    requestId: string,
    to: string,
    options: Record<string, unknown> = {},
  ): Promise<ConnectorRequestDocument | null> {
    const index = this.docs.findIndex(
      (doc) => doc.request_id === requestId,
    );
    if (index < 0) return null;
    const resolved: ConnectorRequestDocument = {
      ...this.docs[index],
      state: to as ConnectorRequestDocument['state'],
      credential_ref: options['credentialRef'] as string,
      resolvedAt: new Date('2026-10-12T00:00:00.000Z'),
    };
    this.docs[index] = resolved;
    this.transitions.push({ requestId, to, options });
    return resolved;
  }
}

/** A pending request in the D-98 shape. */
function pendingRequest(
  overrides: Partial<ConnectorRequestDocument> = {},
): ConnectorRequestDocument {
  return {
    request_id: 'req-0001',
    app_id: 'leave-request',
    requested_by: 'user-0001',
    connector_id: 'redmine',
    name: 'Redmine',
    base_url: 'https://redmine.example.test',
    timeout_ms: 15000,
    retries: 3,
    mapping: { correlation_custom_field_id: 'issue_id' },
    state: 'pending',
    requestedAt: new Date('2026-10-12T00:00:00.000Z'),
    ...overrides,
  };
}

/** The operator's credential entry for one request. */
const OPERATOR_CREDENTIAL = {
  credentialRef: 'cred-redmine-1',
  headerName: 'X-Redmine-API-Key',
  plaintext: 'redmine-api-token',
};

describe('provisionConnectorRequests (BLD-10, D-97..D-100)', () => {
  it('provisions a pending request through the credential seam, the seed seam, and the audit trail', async () => {
    const requests = new FakeRequestRepository();
    requests.docs.push(pendingRequest());
    const creds = new FakeCredentialsRepository();
    const registry: ConnectorRegistry = new RealRegistry();
    const audit = new AuditRepository();

    const provisioned = await provisionConnectorRequests({
      registry,
      credsRepo: creds as unknown as ConnectorCredentialsRepository,
      requests: requests as unknown as ConnectorRequestRepository,
      audit,
      provideCredential: async () => OPERATOR_CREDENTIAL,
      guard: {
        NODE_ENV: 'test',
        CRYPTO_KEY_PROVIDER: 'local',
      },
    });

    // The request reached provisioned, with the credential handle.
    expect(provisioned).toHaveLength(1);
    expect(provisioned[0]).toMatchObject({
      request_id: 'req-0001',
      state: 'provisioned',
      credential_ref: 'cred-redmine-1',
    });
    expect(provisioned[0]?.resolvedAt).toBeInstanceOf(Date);

    // The credential went through the repository seam — the
    // only write path — exactly once, with the operator's value.
    expect(creds.upserts).toEqual([
      {
        credentialRef: 'cred-redmine-1',
        headerName: 'X-Redmine-API-Key',
        plaintext: 'redmine-api-token',
      },
    ]);

    // The connector is registered through the seed seam.
    expect(() => registry.resolve('redmine')).not.toThrow();
    expect(() => registry.resolve('cred-redmine-1')).not.toThrow();

    // The audited transition.
    const entries = await audit.findAll();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: 'operator',
      action: 'connector_request.provisioned',
      target: 'leave-request',
      previous_state: 'pending',
      new_state: 'provisioned',
      connector_id: 'redmine',
      request_id: 'req-0001',
      credential_ref: 'cred-redmine-1',
    });

    // The queue is drained.
    expect(await requests.listPending()).toHaveLength(0);
  });

  it('provisions every pending request, in queue order', async () => {
    const requests = new FakeRequestRepository();
    requests.docs.push(
      pendingRequest({ request_id: 'req-0001' }),
      pendingRequest({
        request_id: 'req-0002',
        app_id: 'expense-report',
        requested_by: 'user-0002',
        connector_id: 'jira',
        name: 'Jira',
        base_url: 'https://jira.example.test',
      }),
    );
    const creds = new FakeCredentialsRepository();
    const audit = new AuditRepository();

    const provisioned = await provisionConnectorRequests({
      registry: new RealRegistry(),
      credsRepo: creds as unknown as ConnectorCredentialsRepository,
      requests: requests as unknown as ConnectorRequestRepository,
      audit,
      provideCredential: async (request) => ({
        credentialRef: `cred-${request.connector_id}-1`,
        headerName: 'X-API-Key',
        plaintext: `${request.connector_id}-token`,
      }),
      guard: {
        NODE_ENV: 'test',
        CRYPTO_KEY_PROVIDER: 'local',
      },
    });

    expect(provisioned.map((request) => request.request_id).sort()).toEqual([
      'req-0001',
      'req-0002',
    ]);
    expect(creds.upserts).toHaveLength(2);
    expect((await audit.findAll()).length).toBe(2);
  });

  it('an empty queue is a no-op', async () => {
    const creds = new FakeCredentialsRepository();
    const audit = new AuditRepository();

    const provisioned = await provisionConnectorRequests({
      registry: new RealRegistry(),
      credsRepo: creds as unknown as ConnectorCredentialsRepository,
      requests: new FakeRequestRepository() as unknown as ConnectorRequestRepository,
      audit,
      provideCredential: async () => {
        throw new Error('should not be called');
      },
      guard: {
        NODE_ENV: 'test',
        CRYPTO_KEY_PROVIDER: 'local',
      },
    });

    expect(provisioned).toHaveLength(0);
    expect(creds.upserts).toHaveLength(0);
    expect(await audit.findAll()).toHaveLength(0);
  });

  it('D-100: a production boot without KMS refuses the credential write — CRYPTO_KEY_PROVIDER_REQUIRED, before any I/O', async () => {
    const requests = new FakeRequestRepository();
    requests.docs.push(pendingRequest());
    const creds = new FakeCredentialsRepository();
    const audit = new AuditRepository();

    // The guard config a production boot without a KMS provider carries.
    const productionWithoutKms: KeyProviderGuardConfig = {
      NODE_ENV: 'production',
      CRYPTO_KEY_PROVIDER: 'local',
    };

    await expect(
      provisionConnectorRequests({
        registry: new RealRegistry(),
        credsRepo: creds as unknown as ConnectorCredentialsRepository,
        requests: requests as unknown as ConnectorRequestRepository,
        audit,
        provideCredential: async () => OPERATOR_CREDENTIAL,
        guard: productionWithoutKms,
      }),
    ).rejects.toThrow(/CRYPTO_KEY_PROVIDER_REQUIRED/);

    // Nothing happened: no envelope written, no request moved,
    // no audit entry appended — the guard fires before any I/O.
    expect(creds.upserts).toHaveLength(0);
    expect(requests.docs[0]?.state).toBe('pending');
    expect(requests.transitions).toHaveLength(0);
    expect(await audit.findAll()).toHaveLength(0);
  });

  it('D-100: the guard also fires when the process environment is the config (the default)', async () => {
    // The CLI entry passes no guard: the config is read from the
    // process environment. A production environment without KMS
    // refuses the same way.
    const previousEnv = process.env.NODE_ENV;
    const previousProvider = process.env.CRYPTO_KEY_PROVIDER;
    process.env.NODE_ENV = 'production';
    process.env.CRYPTO_KEY_PROVIDER = 'local';
    try {
      const creds = new FakeCredentialsRepository();
      await expect(
        provisionConnectorRequests({
          registry: new RealRegistry(),
          credsRepo: creds as unknown as ConnectorCredentialsRepository,
          requests: new FakeRequestRepository() as unknown as ConnectorRequestRepository,
          audit: new AuditRepository(),
          provideCredential: async () => OPERATOR_CREDENTIAL,
        }),
      ).rejects.toThrow(/CRYPTO_KEY_PROVIDER_REQUIRED/);
      expect(creds.upserts).toHaveLength(0);
    } finally {
      if (previousEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousEnv;
      }
      if (previousProvider === undefined) {
        delete process.env.CRYPTO_KEY_PROVIDER;
      } else {
        process.env.CRYPTO_KEY_PROVIDER = previousProvider;
      }
    }
  });
});
