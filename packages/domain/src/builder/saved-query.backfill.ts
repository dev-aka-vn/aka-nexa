/**
 * G-11 — the seed backfill for the repository-backed
 * saved-query store.
 *
 * `SeedSavedQueryLookup` was the stopgap: it read the
 * frozen seed because the App Builder did not exist.
 * The repository-backed store is the real home, and
 * this backfill gives the frozen seed records one:
 * **insert-if-absent**, keyed `(app_id, query_id)`.
 *
 * Insert-if-absent is deliberate — a **replace** would
 * clobber a builder's newer `query_version` with the
 * frozen version 1 (D-75), invalidating every
 * outstanding link a builder had just re-issued. The
 * seed only ever fills an empty key; a builder's
 * version always wins. That is also what makes the
 * backfill a re-run no-op, and safe to run at every
 * boot, from every process, concurrently.
 */

import seed from '../seeds/saved-queries.seed.json' with {
  type: 'json',
};
import type { SavedQueryRecord } from '../links/read-verifier.service.js';
import type { MongoService } from '@akane/platform';

/**
 * Insert every frozen seed record that its key does
 * not already hold.
 *
 * @returns the number of records inserted — `0` on a
 *   re-run, the proof the backfill is a no-op.
 */
export async function backfillSavedQueries(
  mongo: MongoService,
): Promise<number> {
  const collection = mongo
    .db()
    .collection<SavedQueryRecord>('saved_queries');

  let inserted = 0;
  for (const record of seed) {
    const existing = await collection.findOne({
      app_id: record.app_id,
      query_id: record.query_id,
    });
    if (existing !== null) {
      // The key is taken — a builder's version
      // (or a previous backfill) owns it.
      continue;
    }
    await collection.insertOne({ ...record });
    inserted += 1;
  }
  return inserted;
}
