/**
 * G-11 — the repository-backed saved-query store.
 *
 * This is the replacement `SeedSavedQueryLookup`'s
 * own doc promised: the **same `SavedQueryLookup`
 * interface** (`findSavedQuery(queryId, appId)`),
 * so `ReadVerifierService` is unchanged and every
 * `query` read link now resolves builder-written
 * queries from the `saved_queries` collection
 * instead of the frozen seed.
 *
 * ## The composite key (T-06-15)
 *
 * Records are keyed on **`(app_id, query_id)`**
 * with a compound unique index — never
 * `query_id` alone. Two apps may carry the same
 * `qry_*` id for different DSLs (the frozen
 * seed spec asserts the pair is unique for
 * exactly this reason), and a query_id-only
 * lookup would let app A's link resolve app B's
 * query. The index is created idempotently on
 * first use, the `AppDefinitionRepository`
 * pattern.
 *
 * ## The D-75 version invalidation path
 *
 * `saveQuery` is the builder write method: it
 * saves-or-replaces the record under its key, so
 * a builder's edit bumps `query_version` and
 * outstanding links carrying the old version deny
 * with `wrong_version` — the reason the version
 * lives on the record (D-73).
 */

import type {
  SavedQueryLookup,
  SavedQueryRecord,
} from '../links/read-verifier.service.js';
import type { MongoService } from '@akane/platform';

export class RepositorySavedQueryLookup
  implements SavedQueryLookup
{
  constructor(private readonly mongo: MongoService) {}

  private get collection() {
    return this.mongo
      .db()
      .collection<SavedQueryRecord>('saved_queries');
  }

  private indexPromise: Promise<void> | null = null;

  /**
   * The compound unique index on
   * `(app_id, query_id)` — the composite key
   * (T-06-15), enforced at the database.
   */
  private ensureIndex(): Promise<void> {
    if (this.indexPromise === null) {
      this.indexPromise = this.collection
        .createIndex(
          { app_id: 1, query_id: 1 },
          { unique: true },
        )
        .then(() => undefined)
        .catch(() => undefined);
    }
    return this.indexPromise;
  }

  /**
   * Resolve a saved query by its composite key.
   * A `query_id` that exists under a different
   * `app_id` does **not** resolve — the key is
   * the pair, never the id alone.
   */
  async findSavedQuery(
    queryId: string,
    appId: string,
  ): Promise<SavedQueryRecord | null> {
    return this.collection.findOne({
      app_id: appId,
      query_id: queryId,
    });
  }

  /**
   * The builder write method: save the query
   * definition under its `(app_id, query_id)`
   * key, replacing any earlier version of the
   * same query. The record's `query_version` is
   * what outstanding links compare against
   * (D-75) — a bumped version invalidates the
   * links that carried the old one.
   */
  async saveQuery(record: SavedQueryRecord): Promise<void> {
    await this.ensureIndex();
    await this.collection.replaceOne(
      { app_id: record.app_id, query_id: record.query_id },
      { ...record },
      { upsert: true },
    );
  }
}
