/**
 * The D-73 production saved-query store (G-11).
 *
 * `SeedSavedQueryLookup` is what `ReadModule` wires into `ReadVerifierService`;
 * before it existed the seam was `undefined` and every `query` read link was
 * denied (`wrong_version`) while the suite stayed green against in-memory
 * doubles. These tests pin the store's contract: the key, the null cases, and
 * that the DSL is handed on unmodified for the execution path to validate.
 */

import { describe, expect, it } from 'vitest';

import seed from '../seeds/saved-queries.seed.json' with { type: 'json' };
import { SeedSavedQueryLookup } from './seed-saved-query.lookup.js';

describe('SeedSavedQueryLookup (D-73, G-11)', () => {
  const lookup = new SeedSavedQueryLookup();

  it('is constructed from the seed without an argument — that is what ReadModule wires', async () => {
    // A store that needs a caller-supplied argument cannot be the production
    // store; the module supplies none.
    const found = await lookup.findSavedQuery('qry_pending_leave', 'leave-request');
    expect(found).not.toBeNull();
  });

  it('resolves every seeded record by (app_id, query_id)', async () => {
    for (const record of seed) {
      const found = await lookup.findSavedQuery(record.query_id, record.app_id);
      expect(found, `${record.app_id}:${record.query_id}`).not.toBeNull();
      expect(found?.query_id).toBe(record.query_id);
      expect(found?.app_id).toBe(record.app_id);
      expect(found?.query_version).toBe(record.query_version);
    }
  });

  it('hands the DSL on unmodified — validation belongs to the execution path', async () => {
    const expected = seed.find((r) => r.query_id === 'qry_my_leave_this_year');
    expect(expected).toBeDefined();

    const found = await lookup.findSavedQuery('qry_my_leave_this_year', 'leave-request');
    expect(found?.dsl).toEqual(expected?.dsl);
    expect(found?.intents).toEqual(expected?.intents);
  });

  it('returns null for an unknown query_id', async () => {
    expect(await lookup.findSavedQuery('qry_nope', 'leave-request')).toBeNull();
  });

  it('returns null when the app_id does not match — query_id alone must not resolve', async () => {
    // Two apps may reuse a `qry_*` id for different DSLs; a query_id-only lookup
    // would let one app's link resolve another app's query.
    expect(await lookup.findSavedQuery('qry_pending_leave', 'payroll')).toBeNull();
  });

  it('accepts an explicit record set, so a caller can scope the store', async () => {
    const scoped = new SeedSavedQueryLookup([]);

    expect(await scoped.findSavedQuery('qry_pending_leave', 'leave-request')).toBeNull();
  });
});
