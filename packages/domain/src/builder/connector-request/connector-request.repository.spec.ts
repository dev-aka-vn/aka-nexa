/**
 * BLD-10 / D-98 / T-06-24 — the connector-request repository.
 *
 * The repository owns the `connector_requests` collection and
 * the **one-pending-per-(app_id, connector_id)** invariant
 * (T-06-24): a partial unique index on `{ app_id, connector_id }`
 * where `state = 'pending'`, created idempotently on first use
 * (the `AppDefinitionRepository` pattern).
 *
 * ## The in-memory double
 *
 * The double models the four operations the repository uses —
 * `createIndex`, `insertOne`, `findOne`, `find`,
 * `findOneAndUpdate` — and **enforces the partial unique index
 * the way MongoDB does**: an insert that would create a second
 * pending row for the same `(app_id, connector_id)` pair fails
 * with the driver's `11000` duplicate-key error. The repository
 * maps that to the named `CONNECTOR_REQUEST_PENDING_EXISTS`
 * refusal, which is the structural half of the invariant (the
 * service-level check is the other half).
 *
 * The double also **records every `createIndex` call**, so the
 * spec asserts the index is partial on `state = 'pending'` —
 * the thing that makes a rejected or provisioned request NOT
 * block a fresh request for the same pair.
 */

import { describe, expect, it } from 'vitest';

import type { MongoService } from '@akane/platform';

import type { ConnectorRequestDocument } from './connector-request.document.js';
import { ConnectorRequestRepository } from './connector-request.repository.js';

// ─── In-memory collection double ────────────────────────────────

type Doc = Record<string, unknown> & { _id?: string };

/** The driver's duplicate-key failure — the partial unique index firing. */
class DuplicateKeyError extends Error {
  readonly code = 11000;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `fake-id-${idCounter}`;
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = doc[key];
    if (Array.isArray(expected)) {
      return (
        Array.isArray(actual) &&
        actual.length === expected.length &&
        expected.every(
          (value, i) => JSON.stringify(value) === JSON.stringify(actual[i]),
        )
      );
    }
    return JSON.stringify(actual) === JSON.stringify(expected);
  });
}

interface RecordedIndex {
  readonly keys: Record<string, 1>;
  readonly options: Record<string, unknown>;
}

class FakeCollection {
  private readonly docs: Doc[] = [];
  readonly indexes: RecordedIndex[] = [];

  async createIndex(
    keys: Record<string, 1>,
    options: Record<string, unknown> = {},
  ): Promise<string> {
    this.indexes.push({ keys, options });
    return `fake-index-${this.indexes.length}`;
  }

  /**
   * Enforces the partial unique indexes this double was given:
   * for a `{ unique: true, partialFilterExpression }` index, an
   * insert matching the partial filter that duplicates an
   * existing row's indexed keys fails with `11000`.
   */
  async insertOne(doc: Doc): Promise<{ insertedId: string }> {
    for (const index of this.indexes) {
      if (index.options['unique'] !== true) continue;
      const filter = (index.options['partialFilterExpression'] ??
        {}) as Doc;
      // Only rows matching the partial filter are covered by the index.
      if (!matches(doc, filter)) continue;
      const duplicate = this.docs.find(
        (existing) =>
          matches(existing, filter) &&
          Object.keys(index.keys).every(
            (key) =>
              JSON.stringify(existing[key]) ===
              JSON.stringify(doc[key]),
          ),
      );
      if (duplicate !== undefined) {
        throw new DuplicateKeyError(
          `E11000 duplicate key error: ${Object.keys(index.keys).join(', ')}`,
        );
      }
    }
    const stored = {
      ...doc,
      _id: typeof doc._id === 'string' ? doc._id : nextId(),
    };
    this.docs.push(stored);
    return { insertedId: stored._id! };
  }

  async findOne(filter: Doc): Promise<Doc | null> {
    return this.docs.find((doc) => matches(doc, filter)) ?? null;
  }

  async findOneAndUpdate(
    filter: Doc,
    update: { $set?: Doc },
    options?: { returnDocument?: 'after' | 'before' },
  ): Promise<Doc | null> {
    const index = this.docs.findIndex((doc) => matches(doc, filter));
    if (index < 0) return null;
    const updated = { ...this.docs[index], ...(update.$set ?? {}) };
    this.docs[index] = updated;
    return options?.returnDocument === 'after' ? updated : this.docs[index];
  }

  find(filter: Doc): {
    sort: (sort: Doc) => { toArray: () => Promise<Doc[]> };
  } {
    const matched = this.docs.filter((doc) => matches(doc, filter));
    return {
      sort: () => ({ toArray: async () => [...matched] }),
    };
  }
}

class FakeMongoService {
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

/** A D-98 request document in the persisted shape. */
function requestDoc(
  overrides: Partial<ConnectorRequestDocument> = {},
): ConnectorRequestDocument {
  return {
    request_id: 'req-0001',
    app_id: 'leave-request',
    requested_by: 'user-0001',
    connector_id: 'redmine',
    name: 'Redmine',
    base_url: 'https://redmine.example.test',
    state: 'pending',
    requestedAt: new Date('2026-10-12T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ConnectorRequestRepository (BLD-10, D-98, T-06-24)', () => {
  it('creates the pending request with the caller-supplied identity', async () => {
    const repository = new ConnectorRequestRepository(
      new FakeMongoService() as unknown as MongoService,
    );

    const created = await repository.create(requestDoc());

    expect(created).toMatchObject({
      request_id: 'req-0001',
      app_id: 'leave-request',
      requested_by: 'user-0001',
      connector_id: 'redmine',
      state: 'pending',
    });
    expect(created.requestedAt).toBeInstanceOf(Date);

    // Persisted — the pending pair is now resolvable.
    const found = await repository.findPending('leave-request', 'redmine');
    expect(found).toMatchObject({ request_id: 'req-0001' });
  });

  it('creates the one-pending partial unique index, partial on state = pending', async () => {
    const mongo = new FakeMongoService() as unknown as MongoService;
    const repository = new ConnectorRequestRepository(mongo);

    await repository.create(requestDoc());

    // The index the invariant rides: unique over (app_id, connector_id),
    // covering ONLY pending rows — a provisioned or rejected request
    // must not block a fresh request for the same pair.
    const collection = (
      mongo as unknown as {
        db: () => { collection: (name: string) => FakeCollection };
      }
    )
      .db()
      .collection('connector_requests');
    expect(collection.indexes).toHaveLength(1);
    expect(collection.indexes[0]).toMatchObject({
      keys: { app_id: 1, connector_id: 1 },
      options: {
        unique: true,
        partialFilterExpression: { state: 'pending' },
      },
    });
  });

  it('refuses a second pending request for the same (app_id, connector_id) with the named error', async () => {
    const repository = new ConnectorRequestRepository(
      new FakeMongoService() as unknown as MongoService,
    );

    await repository.create(requestDoc());

    await expect(
      repository.create(requestDoc({ request_id: 'req-0002' })),
    ).rejects.toThrow(/CONNECTOR_REQUEST_PENDING_EXISTS/);
  });

  it('a terminal request does not block a fresh request for the same pair', async () => {
    const repository = new ConnectorRequestRepository(
      new FakeMongoService() as unknown as MongoService,
    );

    await repository.create(requestDoc());
    await repository.transition('req-0001', 'rejected', {
      reason: 'cancelled by owner',
    });

    // The partial index covers pending rows only — the rejected
    // request is out of the index's scope, so a fresh request lands.
    const fresh = await repository.create(
      requestDoc({ request_id: 'req-0002' }),
    );
    expect(fresh.request_id).toBe('req-0002');
    expect(
      await repository.findPending('leave-request', 'redmine'),
    ).toMatchObject({ request_id: 'req-0002' });
  });

  it('findPending returns null when the pair has no pending request', async () => {
    const repository = new ConnectorRequestRepository(
      new FakeMongoService() as unknown as MongoService,
    );

    expect(await repository.findPending('leave-request', 'redmine')).toBeNull();
  });

  it('listByApp returns the app\'s requests', async () => {
    const repository = new ConnectorRequestRepository(
      new FakeMongoService() as unknown as MongoService,
    );

    await repository.create(requestDoc());
    await repository.create(
      requestDoc({
        request_id: 'req-0002',
        connector_id: 'jira',
        name: 'Jira',
      }),
    );

    const listed = await repository.listByApp('leave-request');
    expect(listed).toHaveLength(2);
    expect(
      listed.map((request) => request.connector_id).sort(),
    ).toEqual(['jira', 'redmine']);
  });

  it('transition moves the state, stamps resolvedAt, and carries reason and credential_ref', async () => {
    const repository = new ConnectorRequestRepository(
      new FakeMongoService() as unknown as MongoService,
    );

    await repository.create(requestDoc());

    const resolved = await repository.transition('req-0001', 'provisioned', {
      credentialRef: 'cred-redmine-1',
    });

    expect(resolved).toMatchObject({
      request_id: 'req-0001',
      state: 'provisioned',
      credential_ref: 'cred-redmine-1',
    });
    expect(resolved?.resolvedAt).toBeInstanceOf(Date);

    // Persisted, and no longer pending.
    expect(
      await repository.findPending('leave-request', 'redmine'),
    ).toBeNull();
    expect(
      await repository.findByRequestId('req-0001'),
    ).toMatchObject({ state: 'provisioned' });
  });

  it('transition on an unknown request_id resolves null', async () => {
    const repository = new ConnectorRequestRepository(
      new FakeMongoService() as unknown as MongoService,
    );

    expect(
      await repository.transition('req-missing', 'provisioned'),
    ).toBeNull();
  });

  it('listPending returns every pending request across apps (the operator queue)', async () => {
    const repository = new ConnectorRequestRepository(
      new FakeMongoService() as unknown as MongoService,
    );

    await repository.create(requestDoc());
    await repository.create(
      requestDoc({
        request_id: 'req-0002',
        app_id: 'expense-report',
        requested_by: 'user-0002',
      }),
    );
    await repository.create(
      requestDoc({
        request_id: 'req-0003',
        app_id: 'expense-report',
        connector_id: 'jira',
        state: 'provisioned',
        resolvedAt: new Date(),
      }),
    );

    const pending = await repository.listPending();
    expect(pending).toHaveLength(2);
    expect(pending.map((request) => request.request_id).sort()).toEqual([
      'req-0001',
      'req-0002',
    ]);
  });

  it('the persisted document carries no secret-named field (T-06-23)', async () => {
    const repository = new ConnectorRequestRepository(
      new FakeMongoService() as unknown as MongoService,
    );

    const created = await repository.create(
      requestDoc({
        mapping: { correlation_custom_field_id: 'issue_id' },
        taxonomy: { domain: 'it' },
      }),
    );

    // The D-98 shape: the full definition minus the secret. No field
    // on the document — persisted or served — can carry a credential
    // value or an envelope.
    const serialized = JSON.stringify(created);
    expect(serialized).not.toMatch(/secret|credential_value|plaintext/i);
    expect(Object.keys(created)).not.toContain('secret');
    expect(Object.keys(created)).not.toContain('credential');
  });
});
