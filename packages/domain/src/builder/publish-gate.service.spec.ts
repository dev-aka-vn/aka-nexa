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

import { describe, expect, it } from 'vitest';

import type { AppDefinitionDocument } from '../data-access/app-definition.repository.js';
import { RuleBasedProvider } from '../../decision/rule-based.provider.js';
import { RoutingOrchestrator } from '../../decision/routing-orchestrator.js';
import type { RoutingOutcomeRecord } from './routing-share/routing-outcome.repository.js';
import { PublishGateService } from './publish-gate.service.js';

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
      new RuleBasedProvider(new Map([['expense-report', ['expense report', 'expense']])]),
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
