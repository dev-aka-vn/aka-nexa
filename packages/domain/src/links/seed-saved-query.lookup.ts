import seed from '../seeds/saved-queries.seed.json' with { type: 'json' };

import type { SavedQueryLookup, SavedQueryRecord } from './read-verifier.service.js';

/**
 * D-73 — the concrete `SavedQueryLookup` the production read path has lacked.
 *
 * ## Why this exists
 *
 * `ReadVerifierService` takes an **optional** `savedQueries` seam and fails
 * closed to `wrong_version` when it is absent (`verifyQuery`). The API module
 * passed `undefined`, so every `query` read link — the status page's "My
 * submissions" list — was denied in production even though the projection,
 * the DSL execution and the renderer all worked. This is the store that closes
 * that hole.
 *
 * ## Why the seed, and not a collection
 *
 * Saved queries are their own records (`{query_id, query_version, dsl, intents,
 * app_id}`), frozen at `packages/domain/src/seeds/saved-queries.seed.json`.
 * That file's spec calls it a *stored contract*: **Phase 6's App Builder writes
 * the same records**. Until the App Builder exists there is nothing to read
 * from a collection, and inventing one here would be a schema decision with
 * migration consequences owned by that phase. Reading the frozen seed makes the
 * frozen `query` action work end to end *without* inventing storage — and when
 * the App Builder lands, this class is replaced by a repository-backed
 * implementation of the same interface, with no change to the verifier.
 *
 * ## Keying
 *
 * `findSavedQuery` keys on **`(app_id, query_id)`**, never `query_id` alone.
 * Two apps may use the same `qry_*` id for different DSLs, and the seed spec
 * asserts the pair is unique for exactly this reason. A `query_id`-only lookup
 * would let app A's link resolve app B's query.
 */
export class SeedSavedQueryLookup implements SavedQueryLookup {
  private readonly byKey: ReadonlyMap<string, SavedQueryRecord>;

  constructor(records: readonly SavedQueryRecord[] = seed) {
    this.byKey = new Map(
      records.map((record) => [recordKey(record.query_id, record.app_id), record]),
    );
  }

  async findSavedQuery(queryId: string, appId: string): Promise<SavedQueryRecord | null> {
    return this.byKey.get(recordKey(queryId, appId)) ?? null;
  }
}

/** The seed spec's uniqueness rule, applied as the lookup key. */
function recordKey(queryId: string, appId: string): string {
  return `${appId}:${queryId}`;
}
