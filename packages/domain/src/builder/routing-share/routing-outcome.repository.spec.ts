/**
 * The routing-outcome store (OBS-05, APP-07 substrate).
 *
 * Every applied routing decision is recorded here as
 * `{ routing_id, intent_label, app_id, decidedAt }` — the
 * record both the publish gate's dry-run baseline and the
 * `routing_share{app_id}` gauge read (Pitfall 9: the share is
 * a distribution over the labelled intent set, so the record
 * carries the intent label the routing matched, never the raw
 * question text).
 *
 * The repository is the only writer; the dry-run and the
 * metric are readers. The 24h window is applied at read time
 * (the rolling window the constant in the computer names), so
 * the same record serves both consumers at any age.
 */

import { describe, expect, it } from 'vitest';

import type { MongoService } from '@akane/platform';

import { RoutingOutcomeRepository } from './routing-outcome.repository.js';

// ─── In-memory collection double ─────────────────────────
//
// Models the operations the repository uses: insertOne and
// find with equality matches plus the `$gte` range the
// rolling window reads with. Dates compare as timestamps.

type Doc = Record<string, unknown>;

let idCounter = 0;

class FakeCollection {
  private readonly docs: Doc[] = [];

  async createIndex(): Promise<string> {
    return 'fake-index';
  }

  async insertOne(doc: Doc): Promise<{ insertedId: string }> {
    const stored = { ...doc, _id: `fake-id-${++idCounter}` };
    this.docs.push(stored);
    return { insertedId: stored._id as string };
  }

  /**
   * The driver's `find` returns a cursor synchronously and
   * the repository reads it with `toArray()` — the double
   * models that shape, not an array.
   */
  find(filter: Doc): { toArray: () => Promise<Doc[]> } {
    const matched = this.docs.filter((doc) => matches(doc, filter));
    return { toArray: async () => matched };
  }
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = doc[key];
    if (
      expected !== null &&
      typeof expected === 'object' &&
      !Array.isArray(expected) &&
      '$gte' in (expected as Doc)
    ) {
      const cutoff = (expected as { $gte: Date }).$gte;
      return (
        actual instanceof Date &&
        cutoff instanceof Date &&
        actual.getTime() >= cutoff.getTime()
      );
    }
    return JSON.stringify(actual) === JSON.stringify(expected);
  });
}

function fakeMongo(): MongoService {
  const collection = new FakeCollection();
  return {
    db: () => ({
      collection: () => collection,
    }),
  } as unknown as MongoService;
}

const RECENT = new Date();
const STALE = new Date(Date.now() - 25 * 60 * 60 * 1000);

describe('RoutingOutcomeRepository', () => {
  it('records an applied routing decision with its intent label', async () => {
    const repo = new RoutingOutcomeRepository(fakeMongo());
    await repo.record({
      routing_id: 'evt_1',
      intent_label: 'request leave',
      app_id: 'leave-request',
    });

    const records = await repo.outcomesForIntent(
      'request leave',
      24 * 60 * 60 * 1000,
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      routing_id: 'evt_1',
      intent_label: 'request leave',
      app_id: 'leave-request',
    });
    expect(records[0]?.decidedAt).toBeInstanceOf(Date);
  });

  it('reads a label window: only in-window records for that intent label', async () => {
    const repo = new RoutingOutcomeRepository(fakeMongo());
    await repo.record({
      routing_id: 'evt_recent',
      intent_label: 'request leave',
      app_id: 'leave-request',
      decidedAt: RECENT,
    });
    await repo.record({
      routing_id: 'evt_stale',
      intent_label: 'request leave',
      app_id: 'leave-request',
      decidedAt: STALE,
    });
    await repo.record({
      routing_id: 'evt_other',
      intent_label: 'book travel',
      app_id: 'travel-request',
      decidedAt: RECENT,
    });

    const windowMs = 24 * 60 * 60 * 1000;
    const records = await repo.outcomesForIntent('request leave', windowMs);
    expect(records.map((r) => r.routing_id)).toEqual(['evt_recent']);
  });

  it('reads an app window: only in-window records for that app', async () => {
    const repo = new RoutingOutcomeRepository(fakeMongo());
    await repo.record({
      routing_id: 'evt_a1',
      intent_label: 'request leave',
      app_id: 'leave-request',
      decidedAt: RECENT,
    });
    await repo.record({
      routing_id: 'evt_a2',
      intent_label: 'request leave',
      app_id: 'leave-request',
      decidedAt: STALE,
    });
    await repo.record({
      routing_id: 'evt_b1',
      intent_label: 'request leave',
      app_id: 'hr-private',
      decidedAt: RECENT,
    });

    const windowMs = 24 * 60 * 60 * 1000;
    const records = await repo.outcomesForApp('leave-request', windowMs);
    expect(records.map((r) => r.routing_id)).toEqual(['evt_a1']);
  });

  it('a record older than the window is outside every read', async () => {
    const repo = new RoutingOutcomeRepository(fakeMongo());
    await repo.record({
      routing_id: 'evt_old',
      intent_label: 'request leave',
      app_id: 'leave-request',
      decidedAt: STALE,
    });

    const windowMs = 24 * 60 * 60 * 1000;
    expect(await repo.outcomesForIntent('request leave', windowMs)).toEqual(
      [],
    );
    expect(await repo.outcomesForApp('leave-request', windowMs)).toEqual([]);
  });
});
