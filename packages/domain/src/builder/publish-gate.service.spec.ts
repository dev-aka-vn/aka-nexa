/**
 * The publish gate (APP-07, APP-08, BLD-06).
 *
 * `PublishGateService.evaluate` is the last enforcement point
 * before an app's triggers enter the routing distribution: it
 * builds the labelled intent set, executes each label's
 * representative input through the **real** RoutingOrchestrator
 * (read-only — the prediction is the live router's own
 * computation, never a second implementation, Pitfall 8),
 * computes each existing app's share drop over the rolling 24h
 * outcome records, checks the description collision, and builds
 * the BLD-06 change summary — all before any state change.
 *
 * This spec covers the clean-publish path and the frozen
 * result shape; the 5.00/5.01 boundary, the blocked-publish
 * side-effect freedom and the collision edges are hardened in
 * the plan's task 2 and task 3 specs.
 */

import { describe, expect, it, vi } from 'vitest';

import type { AppDefinitionDocument } from './data-access/app-definition.repository.js';
import { RuleBasedProvider } from '../decision/rule-based.provider.js';
import { RoutingOrchestrator } from '../decision/routing-orchestrator.js';
import type { RoutingOutcomeRecord } from './routing-share/routing-outcome.repository.js';
import {
  descriptionsCollide,
  PublishGateService,
} from './publish-gate.service.js';

// ─── In-memory doubles ──────────────────────────────────
//
// The definitions double models the two reads the gate makes
// (one definition by app_id, the published set); the outcome
// store models the label-window reads the share computation
// makes. Both are the repository interfaces, structurally.

class FakeDefinitions {
  private readonly docs = new Map<string, AppDefinitionDocument>();

  seed(doc: AppDefinitionDocument): void {
    this.docs.set(doc.app_id, doc);
  }

  async findByAppId(appId: string): Promise<AppDefinitionDocument | null> {
    return this.docs.get(appId) ?? null;
  }

  async listPublished(): Promise<AppDefinitionDocument[]> {
    return [...this.docs.values()].filter(
      (doc) => doc.lifecycle === 'published',
    );
  }
}

class FakeOutcomeStore {
  private readonly records: RoutingOutcomeRecord[] = [];

  async record(outcome: {
    routing_id: string;
    intent_label: string;
    app_id: string;
  }): Promise<void> {
    this.records.push({ ...outcome, decidedAt: new Date() });
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

  /** The recorded distribution, for the read-only assertions. */
  snapshot(): RoutingOutcomeRecord[] {
    return this.records.map((record) => ({ ...record }));
  }
}

/** A definition with every publish-modal section populated. */
function definition(overrides: Partial<AppDefinitionDocument> = {}): AppDefinitionDocument {
  return {
    app_id: 'expense-report',
    name: 'Expense Report',
    description: 'Submit an expense report',
    data_mode: 'internal',
    lifecycle: 'draft',
    version: 2,
    tags: [],
    form_schema: { components: [] },
    triggers: [
      {
        id: 'expense',
        type: 'slash',
        command: '/expense',
        intents: ['expense report'],
        aliases: ['expense'],
      },
    ],
    roles: {},
    routing_config: { collections: ['expenses'] },
    field_mapping: null,
    retention_policy: null,
    deprecation_notice: null,
    lifecycle_prefs: null,
    jev_behavior: null,
    role_assignments: null,
    roles_permissions: null,
    versioning_policy: null,
    metadata: null,
    createdBy: 'user-1',
    createdAt: new Date(),
    ...overrides,
  };
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

function buildGate(opts: {
  definitions: FakeDefinitions;
  outcomes: FakeOutcomeStore;
  orchestrator?: RoutingOrchestrator;
}): PublishGateService {
  const orchestrator =
    opts.orchestrator ??
    new RoutingOrchestrator([
      new RuleBasedProvider(new Map([['expense-report', ['expense report', 'expense']]])),
    ]);
  return new PublishGateService(
    orchestrator,
    opts.outcomes,
    opts.definitions as never,
  );
}

describe('PublishGateService.evaluate', () => {
  it('returns exactly the PublishGateResult shape', async () => {
    const definitions = new FakeDefinitions();
    definitions.seed(definition());
    const gate = buildGate({ definitions, outcomes: new FakeOutcomeStore() });

    const result = await gate.evaluate('expense-report', 'user-1');

    expect(Object.keys(result).sort()).toEqual(
      ['allowed', 'changeSummary', 'descriptionCollisionWith', 'shareDrops'].sort(),
    );
    expect(Array.isArray(result.shareDrops)).toBe(true);
    expect(result.descriptionCollisionWith).toBeNull();
    expect(Array.isArray(result.changeSummary)).toBe(true);
  });

  it('a first-of-kind draft publishes cleanly with the full change summary', async () => {
    const definitions = new FakeDefinitions();
    definitions.seed(definition());
    // A published app that shares none of the candidate's labels.
    definitions.seed(
      definition({
        app_id: 'leave-request',
        description: 'Request time off',
        lifecycle: 'published',
        triggers: [
          { id: 'leave', type: 'slash', command: '/leave', intents: ['request leave'] },
        ],
      }),
    );
    const gate = buildGate({ definitions, outcomes: new FakeOutcomeStore() });

    const result = await gate.evaluate('expense-report', 'user-1');

    expect(result.allowed).toBe(true);
    expect(result.shareDrops).toEqual([]);
    expect(result.descriptionCollisionWith).toBeNull();
    // BLD-06: every publish-modal row, in the mockup's coverage set.
    expect(result.changeSummary).toEqual([
      { field: 'status', from: 'draft', to: 'published' },
      { field: 'version', from: 'v2', to: 'v3' },
      { field: 'form versions', from: 'current', to: 'pinned at link creation' },
      { field: 'indexes', from: '—', to: 'creation on expenses' },
      { field: 'triggers', from: 'none', to: '1 active' },
    ]);
  });

  it('omits the conditional rows the candidate does not carry', async () => {
    const definitions = new FakeDefinitions();
    definitions.seed(
      definition({
        form_schema: null,
        routing_config: null,
        triggers: [],
      }),
    );
    const gate = buildGate({ definitions, outcomes: new FakeOutcomeStore() });

    const result = await gate.evaluate('expense-report', 'user-1');

    expect(result.allowed).toBe(true);
    expect(result.changeSummary).toEqual([
      { field: 'status', from: 'draft', to: 'published' },
      { field: 'version', from: 'v2', to: 'v3' },
    ]);
  });

  it('refuses a candidate no definition carries', async () => {
    const definitions = new FakeDefinitions();
    const gate = buildGate({ definitions, outcomes: new FakeOutcomeStore() });

    await expect(gate.evaluate('missing-app', 'user-1')).rejects.toThrow(
      /app not found: missing-app/,
    );
  });
});

describe('PublishGateService.evaluate — the APP-07 share-drop boundary', () => {
  /**
   * A published competitor declaring both domain labels — the
   * candidate's entry dilutes its share of the labelled set.
   */
  function competitor(appId: string): AppDefinitionDocument {
    return definition({
      app_id: appId,
      name: appId,
      description: `The ${appId} app`,
      lifecycle: 'published',
      triggers: [
        {
          id: appId,
          type: 'slash',
          command: `/${appId}`,
          intents: ['expense report', 'expense'],
          aliases: ['expense report', 'expense'],
        },
      ],
    });
  }

  /** The two-competitor catalog every boundary case runs against. */
  async function boundaryCatalog(
    outcomes: FakeOutcomeStore,
    toA: number,
    toB: number,
  ): Promise<FakeDefinitions> {
    const definitions = new FakeDefinitions();
    definitions.seed(competitor('comp-a'));
    definitions.seed(competitor('comp-b'));
    definitions.seed(definition());
    for (let i = 0; i < toA; i++) {
      await outcomes.record({
        routing_id: `a_${i}`,
        intent_label: 'expense report',
        app_id: 'comp-a',
      });
    }
    for (let i = 0; i < toB; i++) {
      await outcomes.record({
        routing_id: `b_${i}`,
        intent_label: 'expense',
        app_id: 'comp-b',
      });
    }
    return definitions;
  }

  it('allows a publish whose every share drop is exactly 5.00 points', async () => {
    const outcomes = new FakeOutcomeStore();
    // 9 of the 18 shared-label routings to each competitor.
    // The candidate's two labels grow the denominator to 20,
    // so each competitor's share halves 9/18 → 9/20 — exactly
    // 5.00 points, the boundary the rule allows.
    const definitions = await boundaryCatalog(outcomes, 9, 9);
    const gate = buildGate({ definitions, outcomes });

    const result = await gate.evaluate('expense-report', 'user-1');

    expect(result.allowed).toBe(true);
    expect(result.shareDrops).toEqual([
      { app_id: 'comp-a', points: 5 },
      { app_id: 'comp-b', points: 5 },
    ]);
  });

  it('blocks a publish at a 5.01-point drop, naming the affected app and delta', async () => {
    const outcomes = new FakeOutcomeStore();
    // 10 of the 19 shared-label routings to comp-a: the
    // candidate's two labels grow the denominator to 21, so
    // comp-a's share falls 10/19 → 10/21 = 5.0125… points —
    // one hundredth past the line. comp-b's 9/19 → 9/21 is
    // 4.51, inside the rule; the block is comp-a's alone.
    const definitions = await boundaryCatalog(outcomes, 10, 9);
    const gate = buildGate({ definitions, outcomes });

    const result = await gate.evaluate('expense-report', 'user-1');

    expect(result.allowed).toBe(false);
    expect(result.shareDrops).toEqual([
      { app_id: 'comp-a', points: 5.01 },
      { app_id: 'comp-b', points: 4.51 },
    ]);
  });

  it('a blocked publish is side-effect-free: every outcome record is unchanged', async () => {
    const outcomes = new FakeOutcomeStore();
    const definitions = await boundaryCatalog(outcomes, 10, 9);
    const gate = buildGate({ definitions, outcomes });
    const before = outcomes.snapshot();

    const result = await gate.evaluate('expense-report', 'user-1');

    expect(result.allowed).toBe(false);
    // The dry-run is read-only: the rolling 24h window the
    // gate's baseline reads is byte-for-byte what it was.
    expect(outcomes.snapshot()).toEqual(before);
    // The definitions seam exposes no write at all, so the
    // candidate's lifecycle cannot have moved.
    expect(
      (await definitions.findByAppId('expense-report'))?.lifecycle,
    ).toBe('draft');
  });

  it("measures each app's drop against its own pre-publish share, not the candidate's", async () => {
    const outcomes = new FakeOutcomeStore();
    const definitions = new FakeDefinitions();
    // One shared label, a 60/40 split between the
    // two competitors — 100 routings on the label.
    for (const appId of ['comp-a', 'comp-b']) {
      definitions.seed(
        definition({
          app_id: appId,
          name: appId,
          description: `The ${appId} app`,
          lifecycle: 'published',
          triggers: [
            {
              id: appId,
              type: 'slash',
              command: `/${appId}`,
              intents: ['expense report'],
              aliases: ['expense report'],
            },
          ],
        }),
      );
    }
    definitions.seed(
      definition({
        triggers: [
          {
            id: 'expense',
            type: 'slash',
            command: '/expense',
            intents: ['expense report'],
            aliases: ['expense report'],
          },
        ],
      }),
    );
    for (let i = 0; i < 60; i++) {
      await outcomes.record({
        routing_id: `a_${i}`,
        intent_label: 'expense report',
        app_id: 'comp-a',
      });
    }
    for (let i = 0; i < 40; i++) {
      await outcomes.record({
        routing_id: `b_${i}`,
        intent_label: 'expense report',
        app_id: 'comp-b',
      });
    }
    const gate = buildGate({ definitions, outcomes });

    const result = await gate.evaluate('expense-report', 'user-1');

    expect(result.allowed).toBe(true);
    // One simulated routing: comp-a's share falls
    // 0.6 → 60/101 (0.59 points); comp-b's 0.4 →
    // 40/101 (0.40 points) — each measured against
    // its own pre-publish share, never against the
    // candidate's gain.
    expect(result.shareDrops).toEqual([
      { app_id: 'comp-a', points: 0.59 },
      { app_id: 'comp-b', points: 0.4 },
    ]);
  });

  it('an app with no competitors on its labels publishes with empty shareDrops', async () => {
    const definitions = new FakeDefinitions();
    // A published app on entirely different labels — the
    // candidate's entry dilutes nothing it shares, so no app
    // is in the intent set and no drop is measurable.
    definitions.seed(
      definition({
        app_id: 'travel-request',
        name: 'Travel Request',
        description: 'Book travel',
        lifecycle: 'published',
        triggers: [
          {
            id: 'travel',
            type: 'slash',
            command: '/travel',
            intents: ['book travel'],
            aliases: ['book travel'],
          },
        ],
      }),
    );
    definitions.seed(definition());
    const outcomes = new FakeOutcomeStore();
    await outcomes.record({
      routing_id: 'tr_0',
      intent_label: 'book travel',
      app_id: 'travel-request',
    });
    const gate = buildGate({ definitions, outcomes });

    const result = await gate.evaluate('expense-report', 'user-1');

    expect(result.allowed).toBe(true);
    expect(result.shareDrops).toEqual([]);
  });

  it('the dry-run executes through the real RoutingOrchestrator (spy-asserted)', async () => {
    const outcomes = new FakeOutcomeStore();
    const definitions = await boundaryCatalog(outcomes, 9, 0);
    const provider = new RuleBasedProvider(
      new Map([['expense-report', ['expense report', 'expense']]]),
    );
    const orchestrator = new RoutingOrchestrator([provider]);
    const route = vi.spyOn(orchestrator, 'route');
    const gate = buildGate({ definitions, outcomes, orchestrator });

    await gate.evaluate('expense-report', 'user-1');

    // Two domain labels, each routed read-only twice — the
    // live distribution without the candidate, then with it.
    // The prediction is the live router's own computation
    // (Pitfall 8), never a parallel model.
    expect(route).toHaveBeenCalledTimes(4);
    const questions = route.mock.calls.map(
      (call) => call[0].draft.question,
    );
    expect(questions).toEqual([
      'expense report',
      'expense report',
      'expense',
      'expense',
    ]);
  });
});

describe('PublishGateService.evaluate — the APP-08 collision and the BLD-06 summary', () => {
  it('blocks a description case-folded equal to a published app\'s, naming the colliding app', async () => {
    const definitions = new FakeDefinitions();
    // The published app shares none of the candidate's
    // labels — the collision is the only blocker, and
    // the check runs against published apps only.
    definitions.seed(
      definition({
        app_id: 'existing-expense',
        name: 'Existing Expense',
        // The candidate's description, upper-cased:
        // case-folded, the two are equal.
        description: 'SUBMIT AN EXPENSE REPORT',
        lifecycle: 'published',
        triggers: [
          {
            id: 'existing',
            type: 'slash',
            command: '/existing',
            intents: ['existing intent'],
            aliases: ['existing intent'],
          },
        ],
      }),
    );
    definitions.seed(definition());
    const gate = buildGate({ definitions, outcomes: new FakeOutcomeStore() });

    const result = await gate.evaluate('expense-report', 'user-1');

    expect(result.allowed).toBe(false);
    expect(result.descriptionCollisionWith).toBe('existing-expense');
    expect(result.shareDrops).toEqual([]);
  });

  it('blocks a description at a 0.90 token Jaccard and passes one at 0.89', () => {
    // Ten tokens against the same nine: intersection 9,
    // union 10 — exactly the 0.90 the rule blocks.
    const ten =
      'alpha beta gamma delta epsilon zeta eta theta iota kappa';
    const nine = 'alpha beta gamma delta epsilon zeta eta theta iota';
    expect(descriptionsCollide(ten, nine)).toBe(true);
    // Nine tokens against the same eight: intersection 8,
    // union 9 — 0.89, one hundredth inside the rule.
    const eight = 'alpha beta gamma delta epsilon zeta eta theta';
    expect(descriptionsCollide(nine, eight)).toBe(false);
  });

  it('an already-published app is a zero-change publish: allowed with an empty summary', async () => {
    const definitions = new FakeDefinitions();
    definitions.seed(definition({ lifecycle: 'published' }));
    const gate = buildGate({ definitions, outcomes: new FakeOutcomeStore() });

    const result = await gate.evaluate('expense-report', 'user-1');

    // The short-circuit: no dry-run runs, no drop is
    // measurable, and the summary is empty — named
    // inline, never a generic confirmation.
    expect(result).toEqual({
      allowed: true,
      shareDrops: [],
      descriptionCollisionWith: null,
      changeSummary: [],
    });
  });

  it("the summary's version row is the version the publish commits", async () => {
    const definitions = new FakeDefinitions();
    definitions.seed(definition({ version: 7 }));
    const gate = buildGate({ definitions, outcomes: new FakeOutcomeStore() });

    const result = await gate.evaluate('expense-report', 'user-1');

    expect(result.changeSummary).toContainEqual({
      field: 'version',
      from: 'v7',
      to: 'v8',
    });
  });
});
