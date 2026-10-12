/**
 * BLD-10 / D-97..D-100 — the connector-request flow,
 * end-to-end over real MongoDB and Redis (testcontainers)
 * through the HTTP surface.
 *
 * The self-service boundary this spec proves:
 *
 * 1. A department admin POSTs the **full connector
 *    definition minus the secret** (D-99) and gets a
 *    `pending` request — and a `connector_request.requested`
 *    AUD-01 entry.
 * 2. Every builder read path is **owner-scoped, fail-closed**:
 *    a non-owner gets 404 on POST and GET — never a 403
 *    that would leak the app's existence.
 * 3. **No response body can carry a credential** (T-06-23):
 *    the serialized bodies contain no key matching
 *    `/secret|credential_value|plaintext/i`.
 * 4. The operator's provision flow runs through the audited
 *    CLI seam: the credential is written through
 *    `ConnectorCredentialsRepository.upsert` (the AES-256-GCM
 *    envelope), the connector registers through `upsertConnector`,
 *    and the request reaches `provisioned` with a `resolvedAt`,
 *    the `credential_ref` handle, and a `connector_request.provisioned`
 *    AUD-01 entry — **no platform admin touched the builder UI**.
 * 5. **D-100 is not relaxed** (FND-10 stays authoritative): a
 *    production boot without a KMS provider refuses the
 *    operator's credential write with `CRYPTO_KEY_PROVIDER_REQUIRED`
 *    before any I/O.
 * 6. The one-pending invariant (T-06-24): a second pending
 *    request for the same `(app_id, connector_id)` is refused
 *    with the named `CONNECTOR_REQUEST_PENDING_EXISTS` error
 *    naming the existing `request_id`.
 */

import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Request } from 'express';

import {
  AuditRepository,
  ConnectorCredentialsRepository,
  ConnectorRegistry,
  ConnectorRequestRepository,
  ConnectorRequestService,
  type AuditEntry,
} from '@akane/domain';
import { ConfigModule, LocalKeyProvider, MongoService } from '@akane/platform';

import { startThreeContainers, type ThreeContainers } from '../../../../tooling/containers.js';
import { provisionConnectorRequests } from '../../../../packages/cli/provision.js';

import { AppBuilderModule } from './app-builder.module.js';

const OWNER = 'user-0001';
const OTHER = 'user-0002';

/** The full connector definition minus the secret (D-99). */
const CONNECTOR_DEFINITION = {
  connector_id: 'redmine',
  name: 'Redmine',
  base_url: 'https://redmine.example.test',
  timeout_ms: 15000,
  retries: 3,
  rate_limit: { perMinute: 60 },
  mapping: { correlation_custom_field_id: 'issue_id' },
  taxonomy: { domain: 'it' },
};

/** Reserve an ephemeral loopback port for the listening app. */
function reservePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolvePort(port));
    });
  });
}

/** A JSON request helper returning `{status, body}`. */
async function call(
  method: string,
  url: string,
  body?: unknown,
  as?: string,
): Promise<{ status: number; body: Record<string, unknown>; raw: string }> {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(as === undefined ? {} : { 'x-test-user': as }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = { raw };
  }
  return { status: res.status, body: parsed, raw };
}

describe('connector requests (BLD-10, D-97..D-100)', () => {
  let containers: ThreeContainers;
  let mongo: MongoService;
  let app: INestApplication;
  let baseUrl: string;
  let audit: AuditRepository;
  let requests: ConnectorRequestRepository;
  let requestService: ConnectorRequestService;
  let credsRepo: ConnectorCredentialsRepository;
  let registry: ConnectorRegistry;
  let keyDir: string;

  beforeAll(async () => {
    containers = await startThreeContainers();
    mongo = new MongoService(containers.urls.mongo);

    process.env.NODE_ENV = 'test';
    process.env.SERVICE_NAME = 'api';
    process.env.MONGO_URL = containers.urls.mongo;
    process.env.REDIS_CACHE_URL = containers.urls.cache;
    process.env.REDIS_QUEUE_URL = containers.urls.queue;

    // The operator's local key provider (test env only — the
    // D-100 guard is what keeps this from ever being a
    // production posture).
    keyDir = mkdtempSync(join(tmpdir(), 'akane-06-06-'));
    const keyFile = join(keyDir, 'local.key');
    writeFileSync(keyFile, randomBytes(32));
    const keyProvider = new LocalKeyProvider({ keyFilePath: keyFile });
    credsRepo = new ConnectorCredentialsRepository(mongo, keyProvider);
    registry = new ConnectorRegistry();

    const port = await reservePort();
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AppBuilderModule],
    }).compile();

    audit = moduleRef.get(AuditRepository);
    requests = moduleRef.get(ConnectorRequestRepository);
    requestService = moduleRef.get(ConnectorRequestService);

    app = moduleRef.createNestApplication();
    // The session middleware's principal, replayed from a test
    // header so owner-scoping is exercised over real HTTP.
    app.use((req: Request, _res: unknown, next: () => void) => {
      const realUserId = req.headers['x-test-user'];
      if (typeof realUserId === 'string') {
        (req as Request & { user?: { realUserId: string } }).user = {
          realUserId,
        } as never;
      }
      next();
    });
    await app.init();
    await app.listen(port, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${port}`;

    // The app under test: an owner's draft.
    const created = await call('POST', `${baseUrl}/apps`, {
      name: 'Leave Request',
      app_id: 'leave-request',
      description: 'Request time off',
    }, OWNER);
    expect(created.status).toBe(201);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.client.close();
    if (keyDir !== undefined) {
      rmSync(keyDir, { recursive: true, force: true });
    }
    await containers?.stop();
  });

  it('POST /apps/:id/connector-requests creates a pending request carrying the full definition minus the secret', async () => {
    const before = await audit.findAll();

    const created = await call(
      'POST',
      `${baseUrl}/apps/leave-request/connector-requests`,
      CONNECTOR_DEFINITION,
      OWNER,
    );

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      app_id: 'leave-request',
      requested_by: OWNER,
      connector_id: 'redmine',
      name: 'Redmine',
      base_url: 'https://redmine.example.test',
      timeout_ms: 15000,
      retries: 3,
      rate_limit: { perMinute: 60 },
      mapping: { correlation_custom_field_id: 'issue_id' },
      taxonomy: { domain: 'it' },
      state: 'pending',
    });
    const requestId = created.body['request_id'] as string;
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(typeof created.body['requestedAt']).toBe('string');
    // No resolution yet.
    expect(created.body['resolvedAt']).toBeUndefined();

    // The persisted document matches.
    expect(
      await requests.findByRequestId(requestId),
    ).toMatchObject({ request_id: requestId, state: 'pending' });

    // The AUD-01 entry.
    const after = await audit.findAll();
    expect(after.length).toBe(before.length + 1);
    const entry = after[after.length - 1] as AuditEntry;
    expect(entry).toMatchObject({
      actor: OWNER,
      action: 'connector_request.requested',
      target: 'leave-request',
      new_state: 'pending',
      connector_id: 'redmine',
      request_id: requestId,
    });
    expect(entry.previous_state).toBeUndefined();
  });

  it('no response body from any builder read path carries a credential-named key (T-06-23)', async () => {
    // POST (create), GET (list) — every body the builder
    // surfaces, serialized, checked against the pattern.
    const created = await call(
      'POST',
      `${baseUrl}/apps/leave-request/connector-requests`,
      {
        connector_id: 'jira',
        name: 'Jira',
        base_url: 'https://jira.example.test',
        mapping: { project_key: 'AKANE' },
      },
      OWNER,
    );
    expect(created.status).toBe(201);

    const listed = await call(
      'GET',
      `${baseUrl}/apps/leave-request/connector-requests`,
      undefined,
      OWNER,
    );
    expect(listed.status).toBe(200);

    for (const body of [created.body, listed.body]) {
      const serialized = JSON.stringify(body);
      expect(serialized).not.toMatch(/secret|credential_value|plaintext/i);
      // And no envelope-shaped object: an envelope is
      // {encrypted|wrapped|iv|tag|ct} — none of those keys
      // may appear on a builder surface.
      for (const envelopeKey of ['envelope', 'encrypted', 'wrapped', 'ciphertext', 'ct', 'iv', 'tag']) {
        expect(serialized).not.toContain(`"${envelopeKey}"`);
      }
    }
  });

  it('a non-owner is refused with 404 on POST and GET (fail-closed owner-scoping)', async () => {
    // POST: another owner cannot request against this app.
    const refusal = await call(
      'POST',
      `${baseUrl}/apps/leave-request/connector-requests`,
      CONNECTOR_DEFINITION,
      OTHER,
    );
    expect(refusal.status).toBe(404);
    expect(JSON.stringify(refusal.body)).toMatch(/app not found/);

    // GET: same fail-closed refusal.
    const listed = await call(
      'GET',
      `${baseUrl}/apps/leave-request/connector-requests`,
      undefined,
      OTHER,
    );
    expect(listed.status).toBe(404);

    // An unknown app is indistinguishable from a foreign one.
    const missing = await call(
      'GET',
      `${baseUrl}/apps/no-such-app/connector-requests`,
      undefined,
      OWNER,
    );
    expect(missing.status).toBe(404);
  });

  it('GET /apps/:id/connector-requests lists the app\'s requests with the status badge shape', async () => {
    const listed = await call(
      'GET',
      `${baseUrl}/apps/leave-request/connector-requests`,
      undefined,
      OWNER,
    );

    expect(listed.status).toBe(200);
    const requestsList = (listed.body as { requests: Record<string, unknown>[] }).requests;
    expect(requestsList.length).toBeGreaterThanOrEqual(2);
    // The status badge shape: connector, state, timestamps, reason.
    for (const request of requestsList) {
      expect(typeof request['connector_id']).toBe('string');
      expect(typeof request['name']).toBe('string');
      expect(['pending', 'provisioned', 'rejected']).toContain(request['state']);
      expect(typeof request['requestedAt']).toBe('string');
    }
  });

  it('a second pending request for the same (app_id, connector_id) is refused, naming the pending request_id (T-06-24)', async () => {
    const pending = await requests.listPending();
    const redminePending = pending.find(
      (request) => request.app_id === 'leave-request' && request.connector_id === 'redmine',
    );
    expect(redminePending).toBeDefined();

    const duplicate = await call(
      'POST',
      `${baseUrl}/apps/leave-request/connector-requests`,
      { ...CONNECTOR_DEFINITION, base_url: 'https://redmine2.example.test' },
      OWNER,
    );

    expect(duplicate.status).toBe(409);
    expect(JSON.stringify(duplicate.body)).toMatch(
      /CONNECTOR_REQUEST_PENDING_EXISTS/,
    );
    // The refusal names the pending request it protects.
    expect(JSON.stringify(duplicate.body)).toContain(
      (redminePending as { request_id: string }).request_id,
    );
  });

  it('the operator provision flow resolves pending → provisioned through the audited CLI seam', async () => {
    const before = await audit.findAll();

    // The operator's step — the only path a credential enters.
    const provisioned = await provisionConnectorRequests({
      registry,
      credsRepo,
      requests,
      audit,
      provideCredential: async () => ({
        credentialRef: 'cred-redmine-1',
        headerName: 'X-Redmine-API-Key',
        plaintext: 'redmine-operator-token',
      }),
      guard: { NODE_ENV: 'test', CRYPTO_KEY_PROVIDER: 'local' },
    });

    expect(provisioned.length).toBeGreaterThanOrEqual(1);
    const redmineProvisioned = provisioned.find(
      (request) =>
        request.app_id === 'leave-request' && request.connector_id === 'redmine',
    );
    expect(redmineProvisioned).toMatchObject({
      state: 'provisioned',
      credential_ref: 'cred-redmine-1',
    });
    expect(redmineProvisioned?.resolvedAt).toBeInstanceOf(Date);

    // The request is served as provisioned, with the handle.
    const listed = await call(
      'GET',
      `${baseUrl}/apps/leave-request/connector-requests`,
      undefined,
      OWNER,
    );
    const redmine = (listed.body as { requests: Record<string, unknown>[] })
      .requests.find(
        (request) => request['connector_id'] === 'redmine',
      )!;
    expect(redmine['state']).toBe('provisioned');
    expect(redmine['credential_ref']).toBe('cred-redmine-1');
    expect(typeof redmine['resolvedAt']).toBe('string');

    // The credential round-trips through the envelope seam —
    // the operator's plaintext is retrievable only through the
    // repository's decrypt path.
    const stored = await credsRepo.get('cred-redmine-1');
    expect(stored).toMatchObject({
      credentialRef: 'cred-redmine-1',
      headerName: 'X-Redmine-API-Key',
      decryptedValue: 'redmine-operator-token',
    });

    // The connector is registered through the seed seam.
    expect(() => registry.resolve('redmine')).not.toThrow();
    expect(() => registry.resolve('cred-redmine-1')).not.toThrow();

    // The audited transition — one entry per
    // provisioned request; the redmine request's
    // entry carries the full transition shape.
    const entries = (await audit.findAll()) as AuditEntry[];
    const provisionEntries = entries.filter(
      (entry) =>
        entry.action === 'connector_request.provisioned' &&
        entry.target === 'leave-request' &&
        entry.connector_id === 'redmine',
    );
    expect(provisionEntries).toHaveLength(1);
    expect(provisionEntries[0]).toMatchObject({
      actor: 'operator',
      previous_state: 'pending',
      new_state: 'provisioned',
      connector_id: 'redmine',
      credential_ref: 'cred-redmine-1',
    });
    expect(entries.length).toBe(before.length + provisioned.length);
  });

  it('GET /apps/:id/connector-requests/:requestId returns the single request, owner-scoped fail-closed', async () => {
    const created = await call(
      'POST',
      `${baseUrl}/apps/leave-request/connector-requests`,
      {
        connector_id: 'crm',
        name: 'CRM',
        base_url: 'https://crm.example.test',
      },
      OWNER,
    );
    expect(created.status).toBe(201);
    const requestId = created.body['request_id'] as string;

    const single = await call(
      'GET',
      `${baseUrl}/apps/leave-request/connector-requests/${requestId}`,
      undefined,
      OWNER,
    );
    expect(single.status).toBe(200);
    expect(single.body).toMatchObject({
      request_id: requestId,
      app_id: 'leave-request',
      connector_id: 'crm',
      state: 'pending',
    });

    // A non-owner gets the fail-closed 404...
    const refused = await call(
      'GET',
      `${baseUrl}/apps/leave-request/connector-requests/${requestId}`,
      undefined,
      OTHER,
    );
    expect(refused.status).toBe(404);

    // ...and an unknown request_id is the same refusal.
    const missing = await call(
      'GET',
      `${baseUrl}/apps/leave-request/connector-requests/req-missing`,
      undefined,
      OWNER,
    );
    expect(missing.status).toBe(404);
  });

  it('POST .../cancel cancels the owner\'s pending request — rejected, reasoned, audited', async () => {
    const created = await call(
      'POST',
      `${baseUrl}/apps/leave-request/connector-requests`,
      {
        connector_id: 'jira',
        name: 'Jira',
        base_url: 'https://jira.example.test',
      },
      OWNER,
    );
    expect(created.status).toBe(201);
    const requestId = created.body['request_id'] as string;

    const before = await audit.findAll();

    const cancelled = await call(
      'POST',
      `${baseUrl}/apps/leave-request/connector-requests/${requestId}/cancel`,
      undefined,
      OWNER,
    );

    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      request_id: requestId,
      state: 'rejected',
      reason: 'cancelled by owner',
    });
    expect(typeof cancelled.body['resolvedAt']).toBe('string');

    // The AUD-01 transition.
    const entries = await audit.findAll();
    expect(entries.length).toBe(before.length + 1);
    expect(entries[entries.length - 1]).toMatchObject({
      actor: OWNER,
      action: 'connector_request.cancelled',
      target: 'leave-request',
      previous_state: 'pending',
      new_state: 'rejected',
      connector_id: 'jira',
      request_id: requestId,
      reason: 'cancelled by owner',
    });

    // Cancelling again is refused — pending only.
    const again = await call(
      'POST',
      `${baseUrl}/apps/leave-request/connector-requests/${requestId}/cancel`,
      undefined,
      OWNER,
    );
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).toMatch(
      /CONNECTOR_REQUEST_ILLEGAL_TRANSITION/,
    );

    // A non-owner cannot cancel — fail-closed.
    const foreign = await call(
      'POST',
      `${baseUrl}/apps/leave-request/connector-requests/${requestId}/cancel`,
      undefined,
      OTHER,
    );
    expect(foreign.status).toBe(404);
  });

  it('POST .../retry re-issues a fresh pending request after the terminal state', async () => {
    const created = await call(
      'POST',
      `${baseUrl}/apps/leave-request/connector-requests`,
      {
        connector_id: 'jira',
        name: 'Jira',
        base_url: 'https://jira.example.test',
      },
      OWNER,
    );
    const requestId = created.body['request_id'] as string;
    await call(
      'POST',
      `${baseUrl}/apps/leave-request/connector-requests/${requestId}/cancel`,
      undefined,
      OWNER,
    );

    const before = await audit.findAll();

    const retried = await call(
      'POST',
      `${baseUrl}/apps/leave-request/connector-requests/${requestId}/retry`,
      undefined,
      OWNER,
    );

    expect(retried.status).toBe(201);
    // A fresh identity carrying the same definition.
    expect(retried.body['request_id']).not.toBe(requestId);
    expect(retried.body).toMatchObject({
      app_id: 'leave-request',
      connector_id: 'jira',
      name: 'Jira',
      base_url: 'https://jira.example.test',
      state: 'pending',
    });
    expect(retried.body['reason']).toBeUndefined();

    // The audited transition: terminal → pending.
    const entries = await audit.findAll();
    expect(entries.length).toBe(before.length + 1);
    expect(entries[entries.length - 1]).toMatchObject({
      actor: OWNER,
      action: 'connector_request.retried',
      target: 'leave-request',
      previous_state: 'rejected',
      new_state: 'pending',
      connector_id: 'jira',
      request_id: retried.body['request_id'],
      previous_request_id: requestId,
    });

    // Retrying the fresh pending request is refused —
    // the pending record must be terminal first.
    const whilePending = await call(
      'POST',
      `${baseUrl}/apps/leave-request/connector-requests/${retried.body['request_id']}/retry`,
      undefined,
      OWNER,
    );
    expect(whilePending.status).toBe(409);
  });

  it('an operator rejection carries the reason the admin sees on the status badge', async () => {
    const created = await call(
      'POST',
      `${baseUrl}/apps/leave-request/connector-requests`,
      {
        connector_id: 'salesforce',
        name: 'Salesforce',
        base_url: 'https://salesforce.example.test',
      },
      OWNER,
    );
    const requestId = created.body['request_id'] as string;

    // The operator's refusal — the operator seam, not
    // a builder surface.
    const rejected = await requestService.reject(
      requestId,
      'connector unavailable in this region',
    );
    expect(rejected).toMatchObject({
      state: 'rejected',
      reason: 'connector unavailable in this region',
    });

    // The admin sees the reason on the status badge.
    const listed = await call(
      'GET',
      `${baseUrl}/apps/leave-request/connector-requests`,
      undefined,
      OWNER,
    );
    const request = (listed.body as { requests: Record<string, unknown>[] })
      .requests.find((entry) => entry['request_id'] === requestId)!;
    expect(request['state']).toBe('rejected');
    expect(request['reason']).toBe(
      'connector unavailable in this region',
    );
  });

  it('the provisioned request serves credential_ref as an opaque handle — no plaintext, no envelope (T-06-23)', async () => {
    // The redmine request the operator provisioned
    // earlier in this suite.
    const provisioned = (await requests.listByApp('leave-request'))
      .find(
        (request) =>
          request.connector_id === 'redmine' &&
          request.state === 'provisioned',
      );
    expect(provisioned).toBeDefined();

    const single = await call(
      'GET',
      `${baseUrl}/apps/leave-request/connector-requests/${provisioned?.request_id}`,
      undefined,
      OWNER,
    );
    expect(single.status).toBe(200);
    // The opaque handle — a reference, never a value.
    expect(single.body['credential_ref']).toBe('cred-redmine-1');

    const serialized = JSON.stringify(single.body);
    expect(serialized).not.toMatch(/secret|credential_value|plaintext/i);
    // And no envelope-shaped object: the AES-256-GCM
    // envelope fields never appear on a builder surface.
    for (const envelopeKey of [
      'envelope',
      'encrypted',
      'wrapped',
      'ciphertext',
    ]) {
      expect(serialized).not.toContain(`"${envelopeKey}"`);
    }
  });

  it('D-100: a production boot without KMS refuses the operator credential write — CRYPTO_KEY_PROVIDER_REQUIRED, nothing written', async () => {
    // A fresh pending request for a different connector — the
    // one the refused provision would have resolved.
    const created = await call(
      'POST',
      `${baseUrl}/apps/leave-request/connector-requests`,
      {
        connector_id: 'zendesk',
        name: 'Zendesk',
        base_url: 'https://zendesk.example.test',
      },
      OWNER,
    );
    expect(created.status).toBe(201);

    const before = await audit.findAll();
    const pendingBefore = await requests.listPending();

    // The guard config a production boot without a KMS provider carries.
    await expect(
      provisionConnectorRequests({
        registry,
        credsRepo,
        requests,
        audit,
        provideCredential: async () => ({
          credentialRef: 'cred-jira-1',
          headerName: 'X-Jira-Token',
          plaintext: 'jira-operator-token',
        }),
        guard: { NODE_ENV: 'production', CRYPTO_KEY_PROVIDER: 'local' },
      }),
    ).rejects.toThrow(/CRYPTO_KEY_PROVIDER_REQUIRED/);

    // Nothing happened: no credential written, no request moved,
    // no audit entry appended.
    expect(await credsRepo.get('cred-jira-1')).toBeNull();
    const pendingAfter = await requests.listPending();
    expect(pendingAfter.length).toBe(pendingBefore.length);
    expect(
      pendingAfter.find(
        (request) => request.connector_id === 'zendesk',
      )?.state,
    ).toBe('pending');
    expect(await audit.findAll()).toHaveLength(before.length);
  });
});
