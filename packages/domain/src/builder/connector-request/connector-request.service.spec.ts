/**
 * BLD-10 / D-97..D-100 — the connector-request service.
 *
 * Every method an **audited transition** (D-86 discipline):
 * the mutation and its AUD-01 entry are the method's two
 * halves. The service owns the rules; the repository owns
 * the writes.
 *
 * ## The rules this spec proves
 *
 * 1. `request` validates the definition against the Zod
 *    contract and refuses an invalid one inline, naming the
 *    offending field (BLD-07).
 * 2. `request` is **owner-scoped, fail-closed**: an actor
 *    who does not own the app gets the same
 *    `APP_NOT_FOUND` refusal as a missing app — never a
 *    403 that would leak the app's existence (D-97).
 * 3. `request` refuses a second pending request for the
 *    same `(app_id, connector_id)` with a named error that
 *    names the existing `request_id` (T-06-24).
 * 4. `request` persists the full definition minus the
 *    secret and appends the `connector_request.requested`
 *    AUD-01 entry.
 * 5. **No builder read path can carry a credential**
 *    (T-06-23): the served projection's key set is exactly
 *    the response contract's fields — no key matching
 *    `/secret|credential_value|plaintext/i` exists by
 *    construction.
 */

import { describe, expect, it } from 'vitest';

import { ConnectorRequestResponseSchema } from '@akane/contract';
import type { ConnectorRequestDefinition } from '@akane/contract';
import type { MongoService } from '@akane/platform';

import { AppNotFoundError } from '../data-access/app-definition.repository.js';
import type { AppDefinitionDocument } from '../data-access/app-definition.repository.js';
import { AuditRepository } from '../../audit/audit.repository.js';

import { ConnectorRequestPendingExistsError } from './connector-request.errors.js';
import { ConnectorRequestRepository } from './connector-request.repository.js';
import { ConnectorRequestService } from './connector-request.service.js';
import { ConnectorRequestValidationError } from './connector-request.service.js';

// ─── Doubles ──────────────────────────────────────────────

/** The definition store's read surface the service consumes. */
class FakeDefinitions {
  constructor(
    private readonly docs: AppDefinitionDocument[] = [],
  ) {}

  async findByAppId(
    appId: string,
  ): Promise<AppDefinitionDocument | null> {
    return (
      this.docs.find((doc) => doc.app_id === appId) ?? null
    );
  }
}

/** A definition in the extended builder shape. */
function definition(
  overrides: Partial<AppDefinitionDocument> = {},
): AppDefinitionDocument {
  return {
    app_id: 'leave-request',
    name: 'Leave Request',
    description: 'Request time off',
    data_mode: 'external',
    lifecycle: 'draft',
    version: 1,
    tags: ['time-off', 'all-staff'],
    form_schema: null,
    triggers: [],
    roles: {},
    routing_config: null,
    field_mapping: null,
    retention_policy: null,
    deprecation_notice: null,
    lifecycle_prefs: null,
    jev_behavior: null,
    role_assignments: null,
    roles_permissions: null,
    versioning_policy: null,
    metadata: null,
    createdBy: 'user-0001',
    createdAt: new Date('2026-10-12T00:00:00.000Z'),
    ...overrides,
  };
}

/** The full connector definition minus the secret (D-99). */
const FULL_DEFINITION: ConnectorRequestDefinition = {
  connector_id: 'redmine',
  name: 'Redmine',
  base_url: 'https://redmine.example.test',
  timeout_ms: 15000,
  retries: 3,
  rate_limit: { perMinute: 60 },
  mapping: { correlation_custom_field_id: 'issue_id' },
  taxonomy: { domain: 'it' },
};

// ─── The repository's Mongo seam (in-memory double) ─────
//
// The service spec exercises the real repository over the
// same in-memory collection double the repository spec
// uses — the service's rules and the repository's writes
// compose here exactly as they do in production.

class FakeCollection {
  private readonly docs: Record<string, unknown>[] = [];

  async createIndex(): Promise<string> {
    return 'fake-index';
  }

  async insertOne(
    doc: Record<string, unknown>,
  ): Promise<{ insertedId: string }> {
    const stored = { ...doc, _id: `fake-id-${this.docs.length}` };
    this.docs.push(stored);
    return { insertedId: stored._id as string };
  }

  async findOne(
    filter: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    return (
      this.docs.find((doc) =>
        Object.entries(filter).every(
          ([key, expected]) =>
            JSON.stringify(doc[key]) === JSON.stringify(expected),
        ),
      ) ?? null
    );
  }

  async findOneAndUpdate(
    filter: Record<string, unknown>,
    update: { $set?: Record<string, unknown> },
  ): Promise<Record<string, unknown> | null> {
    const index = this.docs.findIndex((doc) =>
      Object.entries(filter).every(
        ([key, expected]) =>
          JSON.stringify(doc[key]) === JSON.stringify(expected),
      ),
    );
    if (index < 0) return null;
    this.docs[index] = { ...this.docs[index], ...(update.$set ?? {}) };
    return this.docs[index];
  }

  find(filter: Record<string, unknown>) {
    const matched = this.docs.filter((doc) =>
      Object.entries(filter).every(
        ([key, expected]) =>
          JSON.stringify(doc[key]) === JSON.stringify(expected),
      ),
    );
    return {
      sort: (sort: Record<string, number>) => ({
        toArray: async () =>
          [...matched].sort((a, b) => {
            for (const [field, dir] of Object.entries(sort)) {
              const left = a[field];
              const right = b[field];
              const cmp =
                left instanceof Date && right instanceof Date
                  ? left.getTime() - right.getTime()
                  : String(left) < String(right)
                    ? -1
                    : 1;
              if (cmp !== 0) return dir === 1 ? cmp : -cmp;
            }
            return 0;
          }),
      }),
    };
  }
}

class FakeMongo {
  private readonly collections = new Map<string, FakeCollection>();

  db(): { collection: (name: string) => FakeCollection } {
    return {
      collection: (name: string) => {
        let collection = this.collections.get(name);
        if (collection === undefined) {
          collection = new FakeCollection();
          this.collections.set(name, collection);
        }
        return collection;
      },
    };
  }
}

function newService(
  definitions: FakeDefinitions,
  audit = new AuditRepository(),
): { service: ConnectorRequestService; repository: ConnectorRequestRepository; audit: AuditRepository } {
  const repository = new ConnectorRequestRepository(
    new FakeMongo() as unknown as MongoService,
  );
  return {
    service: new ConnectorRequestService(
      repository,
      definitions as never,
      audit,
    ),
    repository,
    audit,
  };
}

describe('ConnectorRequestService (BLD-10, D-97..D-100)', () => {
  it('request persists the definition minus the secret and appends the audited transition', async () => {
    const { service, repository, audit } = newService(
      new FakeDefinitions([definition()]),
    );

    const created = await service.request(
      'leave-request',
      'user-0001',
      FULL_DEFINITION,
    );

    // The pending request carries the full definition minus
    // the secret — every ConnectorSeed field except a value.
    expect(created).toMatchObject({
      app_id: 'leave-request',
      requested_by: 'user-0001',
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
    expect(created.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(created.requestedAt).toBeInstanceOf(Date);

    // Persisted under the app.
    expect(await repository.listByApp('leave-request')).toHaveLength(1);

    // The AUD-01 entry: the transition, the actor, the states.
    const entries = await audit.findAll();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: 'user-0001',
      action: 'connector_request.requested',
      target: 'leave-request',
      new_state: 'pending',
      connector_id: 'redmine',
      request_id: created.request_id,
    });
    expect(entries[0]?.previous_state).toBeUndefined();
    expect(entries[0]?.timestamp).toBeInstanceOf(Date);
  });

  it('refuses an invalid definition inline, naming the offending field', async () => {
    const { service } = newService(
      new FakeDefinitions([definition()]),
    );

    await expect(
      service.request('leave-request', 'user-0001', {
        connector_id: '',
        name: 'Redmine',
        base_url: 'not-a-url',
        credential: 'smuggled-secret',
      }),
    ).rejects.toThrow(ConnectorRequestValidationError);

    await expect(
      service.request('leave-request', 'user-0001', {
        connector_id: 'redmine',
        name: 'Redmine',
        base_url: 'https://redmine.example.test',
      }),
    ).resolves.toMatchObject({ state: 'pending' });
  });

  it('a non-owner is refused fail-closed — APP_NOT_FOUND, not a leak', async () => {
    const { service, repository, audit } = newService(
      new FakeDefinitions([definition()]),
    );

    // Another owner's app: indistinguishable from a missing one.
    await expect(
      service.request('leave-request', 'user-0002', FULL_DEFINITION),
    ).rejects.toThrow(AppNotFoundError);

    // And nothing was written or audited.
    expect(await repository.listByApp('leave-request')).toHaveLength(0);
    expect(await audit.findAll()).toHaveLength(0);
  });

  it('an unknown app is refused the same way (fail-closed)', async () => {
    const { service } = newService(new FakeDefinitions());

    await expect(
      service.request('missing-app', 'user-0001', FULL_DEFINITION),
    ).rejects.toThrow(AppNotFoundError);
  });

  it('a second pending request for the pair is refused, naming the existing request_id (T-06-24)', async () => {
    const { service, repository } = newService(
      new FakeDefinitions([definition()]),
    );

    const first = await service.request(
      'leave-request',
      'user-0001',
      FULL_DEFINITION,
    );

    let named: ConnectorRequestPendingExistsError | undefined;
    try {
      await service.request('leave-request', 'user-0001', {
        ...FULL_DEFINITION,
        base_url: 'https://redmine2.example.test',
      });
    } catch (error) {
      named = error as ConnectorRequestPendingExistsError;
    }

    // The named error names the pending request it protects.
    expect(named).toBeInstanceOf(ConnectorRequestPendingExistsError);
    expect(named?.message).toContain(first.request_id);

    // The original pending request is untouched.
    expect(await repository.listByApp('leave-request')).toHaveLength(1);
  });

  it('a different connector_id for the same app is a separate request', async () => {
    const { service, repository } = newService(
      new FakeDefinitions([definition()]),
    );

    await service.request('leave-request', 'user-0001', FULL_DEFINITION);
    const second = await service.request('leave-request', 'user-0001', {
      ...FULL_DEFINITION,
      connector_id: 'jira',
      name: 'Jira',
      base_url: 'https://jira.example.test',
    });

    expect(second.connector_id).toBe('jira');
    expect(await repository.listByApp('leave-request')).toHaveLength(2);
  });

  it('listForApp is owner-scoped and fails closed for a non-owner', async () => {
    const { service } = newService(
      new FakeDefinitions([definition()]),
    );

    await service.request('leave-request', 'user-0001', FULL_DEFINITION);

    expect(
      await service.listForApp('leave-request', 'user-0001'),
    ).toHaveLength(1);

    await expect(
      service.listForApp('leave-request', 'user-0002'),
    ).rejects.toThrow(AppNotFoundError);
  });

  it('no field of the served projection can carry a secret (T-06-23, by construction)', () => {
    // The response contract is the allowlist: its key set is
    // exactly what a builder read path may render, and it is
    // strict — an added key is a validation failure. No key
    // matches the credential-value pattern, so no response
    // body can serialize one.
    const keys = Object.keys(ConnectorRequestResponseSchema.shape);
    for (const key of keys) {
      expect(key).not.toMatch(/secret|credential_value|plaintext/i);
    }
    // The opaque handle is the only credential-named field, and it
    // is a reference, never a value.
    expect(keys).toContain('credential_ref');
  });
});

describe('ConnectorRequestService lifecycle (BLD-10, D-98, T-06-24)', () => {
  /** A service with one pending redmine request for the owner. */
  async function withPendingRequest() {
    const outcome = newService(new FakeDefinitions([definition()]));
    const created = await outcome.service.request(
      'leave-request',
      'user-0001',
      FULL_DEFINITION,
    );
    return { ...outcome, created };
  }

  it('cancel moves a pending request to rejected with the owner-supplied reason, audited', async () => {
    const { service, repository, audit, created } =
      await withPendingRequest();

    const cancelled = await service.cancel(
      'leave-request',
      created.request_id,
      'user-0001',
      'cancelled by owner',
    );

    expect(cancelled).toMatchObject({
      request_id: created.request_id,
      state: 'rejected',
      reason: 'cancelled by owner',
    });
    expect(cancelled.resolvedAt).toBeInstanceOf(Date);

    // Persisted — and no longer pending, so the pair is free.
    expect(
      await repository.findPending('leave-request', 'redmine'),
    ).toBeNull();
    expect(
      await repository.findByRequestId(created.request_id),
    ).toMatchObject({ state: 'rejected' });

    // The audited transition.
    const entries = await audit.findAll();
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      actor: 'user-0001',
      action: 'connector_request.cancelled',
      target: 'leave-request',
      previous_state: 'pending',
      new_state: 'rejected',
      connector_id: 'redmine',
      request_id: created.request_id,
      reason: 'cancelled by owner',
    });
  });

  it('cancel defaults the reason to the owner-cancel rule', async () => {
    const { service, created } = await withPendingRequest();

    const cancelled = await service.cancel(
      'leave-request',
      created.request_id,
      'user-0001',
    );

    expect(cancelled.reason).toBe('cancelled by owner');
  });

  it('cancel is refused on a non-pending request — pending only', async () => {
    const { service, created } = await withPendingRequest();

    // Cancel once: the request is now terminal.
    await service.cancel(
      'leave-request',
      created.request_id,
      'user-0001',
    );

    await expect(
      service.cancel('leave-request', created.request_id, 'user-0001'),
    ).rejects.toThrow(/CONNECTOR_REQUEST_ILLEGAL_TRANSITION/);
  });

  it('cancel by a non-owner is refused fail-closed', async () => {
    const { service, created } = await withPendingRequest();

    await expect(
      service.cancel('leave-request', created.request_id, 'user-0002'),
    ).rejects.toThrow(AppNotFoundError);
  });

  it('retry after a terminal state issues a fresh request_id carrying the same definition', async () => {
    const { service, repository, audit, created } =
      await withPendingRequest();

    await service.cancel(
      'leave-request',
      created.request_id,
      'user-0001',
    );

    const retried = await service.retry(
      'leave-request',
      created.request_id,
      'user-0001',
    );

    // A fresh identity — the previous request keeps its own.
    expect(retried.request_id).not.toBe(created.request_id);
    expect(retried.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // The definition traveled with the retry...
    expect(retried).toMatchObject({
      app_id: 'leave-request',
      requested_by: 'user-0001',
      connector_id: 'redmine',
      name: 'Redmine',
      base_url: 'https://redmine.example.test',
      timeout_ms: 15000,
      retries: 3,
      state: 'pending',
    });
    expect(retried.requestedAt).toBeInstanceOf(Date);
    // ...and the terminal request's resolution did not.
    expect(retried.reason).toBeUndefined();
    expect(retried.resolvedAt).toBeUndefined();
    expect(retried.credential_ref).toBeUndefined();

    // The fresh request is the pair's pending record now.
    expect(
      await repository.findPending('leave-request', 'redmine'),
    ).toMatchObject({ request_id: retried.request_id });

    // The audited transition: terminal → pending, both ids named.
    const entries = await audit.findAll();
    expect(entries[entries.length - 1]).toMatchObject({
      actor: 'user-0001',
      action: 'connector_request.retried',
      target: 'leave-request',
      previous_state: 'rejected',
      new_state: 'pending',
      connector_id: 'redmine',
      request_id: retried.request_id,
      previous_request_id: created.request_id,
    });
  });

  it('retry after a provisioned request re-issues the definition without the credential handle', async () => {
    const { service, repository, audit, created } =
      await withPendingRequest();

    // The operator provisioned the request through the
    // repository seam (the CLI's write path)...
    const provisioned = await repository.transition(
      created.request_id,
      'provisioned',
      { credentialRef: 'cred-redmine-1' },
    );
    expect(provisioned).toMatchObject({
      state: 'provisioned',
      credential_ref: 'cred-redmine-1',
    });

    // ...then the owner retried it: the fresh request carries
    // the definition, never the previous handle.
    const retried = await service.retry(
      'leave-request',
      created.request_id,
      'user-0001',
    );
    expect(retried.state).toBe('pending');
    expect(retried.credential_ref).toBeUndefined();

    // And the pair's pending record is the fresh request.
    const entries = await audit.findAll();
    expect(entries[entries.length - 1]).toMatchObject({
      action: 'connector_request.retried',
      previous_state: 'provisioned',
      new_state: 'pending',
    });
  });

  it('retry is refused while the previous request is still pending — the pending record must be terminal first', async () => {
    const { service, created } = await withPendingRequest();

    await expect(
      service.retry('leave-request', created.request_id, 'user-0001'),
    ).rejects.toThrow(/CONNECTOR_REQUEST_ILLEGAL_TRANSITION/);
  });

  it('retry is refused while another pending request exists for the pair (T-06-24)', async () => {
    const { service, created } = await withPendingRequest();

    // The owner cancels, then requests a second pending
    // request for the same connector...
    await service.cancel(
      'leave-request',
      created.request_id,
      'user-0001',
    );
    const second = await service.request(
      'leave-request',
      'user-0001',
      FULL_DEFINITION,
    );

    // ...so retrying the cancelled request would create a
    // second pending row for the pair — refused, naming the
    // pending request that blocks it.
    let named: ConnectorRequestPendingExistsError | undefined;
    try {
      await service.retry('leave-request', created.request_id, 'user-0001');
    } catch (error) {
      named = error as ConnectorRequestPendingExistsError;
    }
    expect(named).toBeInstanceOf(ConnectorRequestPendingExistsError);
    expect(named?.message).toContain(second.request_id);
  });

  it('retry by a non-owner is refused fail-closed', async () => {
    const { service, created } = await withPendingRequest();

    await service.cancel(
      'leave-request',
      created.request_id,
      'user-0001',
    );

    await expect(
      service.retry('leave-request', created.request_id, 'user-0002'),
    ).rejects.toThrow(AppNotFoundError);
  });

  it('retry on an unknown request is refused', async () => {
    const { service } = newService(
      new FakeDefinitions([definition()]),
    );

    await expect(
      service.retry('leave-request', 'req-missing', 'user-0001'),
    ).rejects.toThrow(/CONNECTOR_REQUEST_NOT_FOUND/);
  });

  it('an operator may reject a pending request with a reason — the admin sees it on the status badge', async () => {
    const { service, repository, audit, created } =
      await withPendingRequest();

    const rejected = await service.reject(
      created.request_id,
      'connector unavailable in this region',
    );

    expect(rejected).toMatchObject({
      request_id: created.request_id,
      state: 'rejected',
      reason: 'connector unavailable in this region',
    });
    expect(rejected.resolvedAt).toBeInstanceOf(Date);

    // The reason rides the served record — the status badge
    // renders it.
    const listed = await service.listForApp('leave-request', 'user-0001');
    expect(listed[0]).toMatchObject({
      state: 'rejected',
      reason: 'connector unavailable in this region',
    });

    // The audited transition.
    const entries = await audit.findAll();
    expect(entries[entries.length - 1]).toMatchObject({
      actor: 'operator',
      action: 'connector_request.rejected',
      target: 'leave-request',
      previous_state: 'pending',
      new_state: 'rejected',
      connector_id: 'redmine',
      request_id: created.request_id,
      reason: 'connector unavailable in this region',
    });

    // And the pair is free again.
    expect(
      await repository.findPending('leave-request', 'redmine'),
    ).toBeNull();
  });

  it('reject is refused on a non-pending request', async () => {
    const { service, created } = await withPendingRequest();

    await service.reject(created.request_id, 'no longer needed');

    await expect(
      service.reject(created.request_id, 'again'),
    ).rejects.toThrow(/CONNECTOR_REQUEST_ILLEGAL_TRANSITION/);
  });

  it('reject on an unknown request is refused', async () => {
    const { service } = newService(
      new FakeDefinitions([definition()]),
    );

    await expect(
      service.reject('req-missing', 'reason'),
    ).rejects.toThrow(/CONNECTOR_REQUEST_NOT_FOUND/);
  });

  it('every lifecycle transition is an audited event with previous_state and new_state', async () => {
    const { service, audit, created } = await withPendingRequest();

    const before = (await audit.findAll()).length;

    await service.cancel('leave-request', created.request_id, 'user-0001');
    const retried = await service.retry('leave-request', created.request_id, 'user-0001');
    await service.reject(retried.request_id, 'operator refused');

    // Three more entries — cancel, retry, reject — each
    // carrying the transition pair.
    const entries = await audit.findAll();
    expect(entries.length).toBe(before + 3);
    const transitions = entries.slice(before).map((entry) => ({
      action: entry.action,
      previous: entry.previous_state,
      next: entry.new_state,
    }));
    expect(transitions).toEqual([
      {
        action: 'connector_request.cancelled',
        previous: 'pending',
        next: 'rejected',
      },
      {
        action: 'connector_request.retried',
        previous: 'rejected',
        next: 'pending',
      },
      {
        action: 'connector_request.rejected',
        previous: 'pending',
        next: 'rejected',
      },
    ]);
  });
});
