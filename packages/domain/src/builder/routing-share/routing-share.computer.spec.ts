/**
 * The share computer (OBS-05, APP-07 substrate — Pitfall 9).
 *
 * `routing_share{app_id}` is a **distribution over the labelled
 * intent set**, never a per-app counter: an app's share is its
 * fraction of the routings across its declared intent labels.
 * Theft is only detectable as a relative shift — an app whose
 * absolute count keeps rising can still be losing its share —
 * so the computer always divides by the label set's total,
 * over the same rolling 24h window the publish dry-run reads.
 */

import { describe, expect, it } from 'vitest';

import type { PublishedApp } from '../../decision/published-app-loader.js';
import type { RoutingOutcomeRecord } from './routing-outcome.repository.js';
import { RoutingShareComputer } from './routing-share.computer.js';

/** An in-memory repository double: label-keyed record lists. */
class FakeOutcomeStore {
  private readonly records: RoutingOutcomeRecord[] = [];

  async record(outcome: {
    routing_id: string;
    intent_label: string;
    app_id: string;
    decidedAt?: Date;
  }): Promise<void> {
    this.records.push({
      routing_id: outcome.routing_id,
      intent_label: outcome.intent_label,
      app_id: outcome.app_id,
      decidedAt: outcome.decidedAt ?? new Date(),
    });
  }

  async outcomesForIntent(
    intentLabel: string,
    windowMs: number,
  ): Promise<RoutingOutcomeRecord[]> {
    const cutoff = Date.now() - windowMs;
    return this.records.filter(
      (r) =>
        r.intent_label === intentLabel && r.decidedAt.getTime() >= cutoff,
    );
  }

  async outcomesForApp(
    appId: string,
    windowMs: number,
  ): Promise<RoutingOutcomeRecord[]> {
    const cutoff = Date.now() - windowMs;
    return this.records.filter(
      (r) => r.app_id === appId && r.decidedAt.getTime() >= cutoff,
    );
  }
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

const CATALOG: readonly PublishedApp[] = [
  {
    id: 'leave-request',
    description: 'Submit a new leave request',
    parameters: [],
    intents: ['request leave'],
    aliases: ['request leave', 'leave request'],
    threshold: 0.8,
    forms: [],
    status: 'published',
  },
  {
    id: 'hr-private',
    description: 'Restricted HR app',
    parameters: [],
    intents: ['request leave'],
    aliases: ['request leave'],
    threshold: 0.8,
    forms: [],
    status: 'published',
  },
  {
    id: 'travel-request',
    description: 'Book travel',
    parameters: [],
    intents: ['book travel'],
    aliases: ['book travel'],
    threshold: 0.8,
    forms: [],
    status: 'published',
  },
];

function computerFor(store: FakeOutcomeStore): RoutingShareComputer {
  return new RoutingShareComputer(store, async () => CATALOG);
}

describe('RoutingShareComputer', () => {
  it('computes a distribution over the intent set, not a per-app counter', async () => {
    const store = new FakeOutcomeStore();
    // 6 routings on the shared label: 2 to leave-request, 4 to hr-private.
    for (let i = 0; i < 2; i++) {
      await store.record({
        routing_id: `lr_${i}`,
        intent_label: 'request leave',
        app_id: 'leave-request',
      });
    }
    for (let i = 0; i < 4; i++) {
      await store.record({
        routing_id: `hr_${i}`,
        intent_label: 'request leave',
        app_id: 'hr-private',
      });
    }
    // An unrelated label's traffic must not enter either app's share.
    await store.record({
      routing_id: 'tr_0',
      intent_label: 'book travel',
      app_id: 'travel-request',
    });

    const computer = computerFor(store);
    // leave-request: 2 of the 6 shared-label routings.
    expect(await computer.share('leave-request', WINDOW_MS)).toBeCloseTo(
      2 / 6,
    );
    // hr-private: 4 of the 6 — the distribution sums to 1 across the set.
    expect(await computer.share('hr-private', WINDOW_MS)).toBeCloseTo(
      4 / 6,
    );
  });

  it('applies the rolling window: out-of-window records do not count', async () => {
    const store = new FakeOutcomeStore();
    await store.record({
      routing_id: 'lr_recent',
      intent_label: 'request leave',
      app_id: 'leave-request',
    });
    await store.record({
      routing_id: 'lr_stale',
      intent_label: 'request leave',
      app_id: 'leave-request',
      decidedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });

    const computer = computerFor(store);
    // Only the in-window record: 1 of 1, not 1 of 2.
    expect(await computer.share('leave-request', WINDOW_MS)).toBeCloseTo(1);
  });

  it('an app with no recorded routings on its labels has zero share', async () => {
    const store = new FakeOutcomeStore();
    await store.record({
      routing_id: 'tr_0',
      intent_label: 'book travel',
      app_id: 'travel-request',
    });

    const computer = computerFor(store);
    expect(await computer.share('leave-request', WINDOW_MS)).toBe(0);
  });

  it('an unknown app has zero share', async () => {
    const computer = computerFor(new FakeOutcomeStore());
    expect(await computer.share('not-an-app', WINDOW_MS)).toBe(0);
  });

  it("the gate's substrate: share over an explicit label set", async () => {
    const store = new FakeOutcomeStore();
    // The dry-run's domain: two labels, 3 routings total, 1 to hr-private.
    await store.record({
      routing_id: 'a',
      intent_label: 'request leave',
      app_id: 'leave-request',
    });
    await store.record({
      routing_id: 'b',
      intent_label: 'request leave',
      app_id: 'leave-request',
    });
    await store.record({
      routing_id: 'c',
      intent_label: 'time off',
      app_id: 'hr-private',
    });

    const computer = computerFor(store);
    // hr-private's share over the domain {request leave, time off}: 1/3.
    expect(
      await computer.shareOverLabels(
        'hr-private',
        ['request leave', 'time off'],
        WINDOW_MS,
      ),
    ).toBeCloseTo(1 / 3);
  });
});
