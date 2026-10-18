/**
 * G-11 — the repository-backed saved-query store.
 *
 * The stopgap (`SeedSavedQueryLookup`) read the
 * frozen seed because the App Builder did not
 * exist. It did, and this repository is the
 * replacement the stopgap's own doc promised: the
 * **same interface**, backed by the `saved_queries`
 * collection, so `ReadVerifierService` is unchanged
 * and every `query` read link resolves
 * builder-written queries.
 *
 * ## The composite key (T-06-15)
 *
 * `findSavedQuery` keys on **`(app_id, query_id)`**
 * — never `query_id` alone. Two apps may carry the
 * same `qry_*` id for different DSLs, and a
 * query_id-only lookup would let app A's link
 * resolve app B's query. The spec proves the
 * cross-app refusal directly.
 *
 * ## The D-75 invalidation path
 *
 * A builder's edit bumps `query_version`; the
 * record is saved-or-replaced under its key, so
 * outstanding links carrying the old version deny
 * with `wrong_version` — the reason the version
 * lives on the record.
 *
 * The backfill gives the frozen seed records a
 * home in the collection: insert-if-absent, so a
 * builder's newer version is never clobbered by
 * the seed, and a re-run is a no-op.
 */

import { describe, expect, it } from 'vitest';

import seed from '../seeds/saved-queries.seed.json' with {
  type: 'json',
};

import { backfillSavedQueries } from './saved-query.backfill.js';
import { RepositorySavedQueryLookup } from './saved-query.repository.js';
import type { SavedQueryRecord } from '../links/read-verifier.service.js';
import type { MongoService } from '@akane/platform';

// ─── In-memory collection double ─────────────────────────
//
// Models the operations the repository and the
// backfill use: equality-matched findOne, insertOne,
// upserting replaceOne, createIndex and find.

type Doc = Record<string, unknown> & { _id?: string };

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

class FakeCollection {
  private readonly docs: Doc[] = [];

  async createIndex(): Promise<string> {
    return 'fake-index';
  }

  async insertOne(doc: Doc): Promise<{ insertedId: string }> {
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

  async replaceOne(
    filter: Doc,
    replacement: Doc,
    options?: { upsert?: boolean },
  ): Promise<{ modifiedCount: number; upsertedId?: string }> {
    const index = this.docs.findIndex((doc) => matches(doc, filter));
    if (index >= 0) {
      this.docs[index] = { ...replacement, _id: this.docs[index]._id };
      return { modifiedCount: 1 };
    }
    if (options?.upsert === true) {
      const id = nextId();
      this.docs.push({ ...replacement, _id: id });
      return { modifiedCount: 0, upsertedId: id };
    }
    return { modifiedCount: 0 };
  }

  find(filter: Doc): {
    sort: () => { toArray: () => Promise<Doc[]> };
  } {
    const matched = this.docs.filter((doc) => matches(doc, filter));
    return { sort: () => ({ toArray: async () => [...matched] }) };
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

/** A builder-written query record in the D-73 shape. */
function queryRecord(
  queryId: string,
  appId: string,
  queryVersion: number,
): SavedQueryRecord {
  return {
    query_id: queryId,
    query_version: queryVersion,
    app_id: appId,
    intents: ['list things'],
    dsl: {
      filters: { op: 'eq', field: 'data.status', value: 'open' },
      limit: 25,
    },
  };
}

describe('RepositorySavedQueryLookup (G-11, D-73, T-06-15)', () => {
  it('resolves a builder-written query by its (app_id, query_id) key', async () => {
    const mongo = new FakeMongoService();
    const lookup = new RepositorySavedQueryLookup(
      mongo as unknown as MongoService,
    );

    await lookup.saveQuery(queryRecord('qry_open_items', 'asset-request', 1));

    const resolved = await lookup.findSavedQuery(
      'qry_open_items',
      'asset-request',
    );
    expect(resolved).toMatchObject({
      query_id: 'qry_open_items',
      app_id: 'asset-request',
      query_version: 1,
    });
  });

  it('does NOT resolve a query_id that exists under a different app_id (T-06-15)', async () => {
    const mongo = new FakeMongoService();
    const lookup = new RepositorySavedQueryLookup(
      mongo as unknown as MongoService,
    );

    // Two apps, the same query_id, different DSLs — the
    // composite key is the only thing telling them apart.
    await lookup.saveQuery(queryRecord('qry_list', 'app-a', 1));
    await lookup.saveQuery(
      queryRecord('qry_list', 'app-b', 1),
    );

    expect(
      await lookup.findSavedQuery('qry_list', 'app-a'),
    ).toMatchObject({ app_id: 'app-a' });
    expect(
      await lookup.findSavedQuery('qry_list', 'app-b'),
    ).toMatchObject({ app_id: 'app-b' });

    // An app that never saved the query_id resolves nothing.
    expect(
      await lookup.findSavedQuery('qry_list', 'app-c'),
    ).toBeNull();
    // And an unknown query_id under a known app resolves nothing.
    expect(
      await lookup.findSavedQuery('qry_missing', 'app-a'),
    ).toBeNull();
  });

  it('a re-save under the same key replaces the record — the D-75 version bump', async () => {
    const mongo = new FakeMongoService();
    const lookup = new RepositorySavedQueryLookup(
      mongo as unknown as MongoService,
    );

    await lookup.saveQuery(queryRecord('qry_open_items', 'asset-request', 1));
    await lookup.saveQuery(queryRecord('qry_open_items', 'asset-request', 2));

    // One record, at the new version — the old version's
    // links deny with wrong_version (D-75).
    const resolved = await lookup.findSavedQuery(
      'qry_open_items',
      'asset-request',
    );
    expect(resolved?.query_version).toBe(2);
  });

  describe('the seed backfill (G-11)', () => {
    it('inserts every frozen seed record keyed (app_id, query_id)', async () => {
      const mongo = new FakeMongoService();

      const inserted = await backfillSavedQueries(
        mongo as unknown as MongoService,
      );

      expect(inserted).toBe(2);

      // After the backfill, a seed query resolves through
      // the repository-backed lookup — the production
      // path, not the stopgap.
      const lookup = new RepositorySavedQueryLookup(
        mongo as unknown as MongoService,
      );
      const resolved = await lookup.findSavedQuery(
        'qry_pending_leave',
        'leave-request',
      );
      expect(resolved).toMatchObject({
        query_id: 'qry_pending_leave',
        app_id: 'leave-request',
        query_version: 1,
      });
      // The stored record is the frozen seed record, verbatim.
      const seedRecord = seed.find(
        (record) => record.query_id === 'qry_pending_leave',
      )!;
      expect(resolved?.dsl).toEqual(seedRecord.dsl);
      expect(resolved?.intents).toEqual(seedRecord.intents);
    });

    it('fails closed on a foreign app_id for the seeded leave-request query (FRM-14)', async () => {
      const mongo = new FakeMongoService();
      await backfillSavedQueries(mongo as unknown as MongoService);

      const lookup = new RepositorySavedQueryLookup(
        mongo as unknown as MongoService,
      );
      // The list form's reference resolves for its own app.
      expect(
        await lookup.findSavedQuery('qry_pending_leave', 'leave-request'),
      ).toMatchObject({
        query_id: 'qry_pending_leave',
        app_id: 'leave-request',
      });
      // The same query_id under a foreign app resolves to nothing —
      // the cross-app guard the list form relies on.
      expect(
        await lookup.findSavedQuery('qry_pending_leave', 'foreign-app'),
      ).toBeNull();
    });

    it('is a no-op on re-run', async () => {
      const mongo = new FakeMongoService();
      await backfillSavedQueries(mongo as unknown as MongoService);

      const inserted = await backfillSavedQueries(
        mongo as unknown as MongoService,
      );

      expect(inserted).toBe(0);
    });

    it('never clobbers a builder-written version with the frozen seed', async () => {
      const mongo = new FakeMongoService();
      await backfillSavedQueries(mongo as unknown as MongoService);

      const lookup = new RepositorySavedQueryLookup(
        mongo as unknown as MongoService,
      );
      // The builder bumped the query_version.
      await lookup.saveQuery(
        queryRecord('qry_pending_leave', 'leave-request', 5),
      );

      // A re-backfill leaves the builder's version alone.
      await backfillSavedQueries(mongo as unknown as MongoService);
      const resolved = await lookup.findSavedQuery(
        'qry_pending_leave',
        'leave-request',
      );
      expect(resolved?.query_version).toBe(5);
    });
  });
});
