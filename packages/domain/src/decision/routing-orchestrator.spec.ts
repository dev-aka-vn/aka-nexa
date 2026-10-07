import { describe, expect, it, vi } from 'vitest';
import {
  JevResponseSchema,
  RULE_BASED_PROVIDER_NAME,
  type JevProvider,
  type JevRequest,
  type JevResponse,
  type ToolDescriptor,
} from '@akane/contract';

import { ProviderHealthService } from './provider-health.service.js';
import { RuleBasedProvider } from './rule-based.provider.js';
import { RoutingOrchestrator } from './routing-orchestrator.js';

const TOOLS: ToolDescriptor[] = [
  { id: 'leave-request', description: 'Submit a new leave request', parameters: [] },
  { id: 'laptop-support', description: 'Get laptop support', parameters: [] },
];

const ALIASES = new Map<string, readonly string[]>([
  ['leave-request', ['request leave', 'xin nghỉ phép']],
  ['laptop-support', ['laptop support', 'hỗ trợ laptop']],
]);

function makeDraft(overrides: Record<string, unknown> = {}) {
  return {
    spec_version: '1.0' as const,
    request_id: 'req_1',
    state: { locale: 'en', conversation_id: 'c1', turn_count: 0, force_clarification: false },
    question: 'I want to request leave',
    context: { real_user_id: 'u1', app_hints: [], previous_turns: [] },
    ...overrides,
  };
}

function route(orchestrator: RoutingOrchestrator, deadlineEpochMs: number) {
  return orchestrator.route({
    draft: makeDraft(),
    authorizedTools: TOOLS,
    threshold: () => 0.8,
    canOpenNow: async () => true,
    deadlineEpochMs,
  });
}

function validResponse(toolId: string): JevResponse {
  return JevResponseSchema.parse({
    spec_version: '1.0',
    request_id: 'req_1',
    choice: { tool_id: toolId, confidence: 1, verified: true },
    clarification_needed: false,
    provider: 'stub',
    latency_ms: 1,
  });
}

function stubProvider(
  name: string,
  behavior: { decide?: (req: JevRequest) => Promise<JevResponse>; healthStatus?: string },
  calls?: JevRequest[],
): JevProvider {
  return {
    name,
    spec_version: '1.0',
    capabilities: ['tool_selection', 'clarification', 'multi_turn'],
    async decide(req: JevRequest) {
      calls?.push(req);
      return behavior.decide ? behavior.decide(req) : validResponse('leave-request');
    },
    async healthCheck() {
      return {
        status: (behavior.healthStatus ?? 'healthy') as 'healthy',
        model_version: `${name}-0`,
        spec_version: '1.0',
        capabilities: ['tool_selection'],
        uptime_seconds: 0,
      };
    },
  };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('RoutingOrchestrator — absolute deadline propagation (T-03-06, Pitfall 2)', () => {
  const localRules = () => new RuleBasedProvider(ALIASES);

  it('a stalled first provider leaves only the remaining budget — total never resets to a fresh 2000ms', async () => {
    const hostedCalls: JevRequest[] = [];
    const hosted = stubProvider(
      'hosted',
      {
        decide: async () => {
          await delay(120);
          throw new Error('slow and wrong');
        },
      },
      hostedCalls,
    );
    const orchestrator = new RoutingOrchestrator([hosted, localRules()]);
    const deadlineEpochMs = Date.now() + 2000;
    const started = Date.now();
    const outcome = await route(orchestrator, deadlineEpochMs);
    const elapsed = Date.now() - started;
    expect(outcome).toEqual({ kind: 'link', toolId: 'leave-request' });
    expect(hostedCalls).toHaveLength(1);
    expect(elapsed).toBeGreaterThanOrEqual(120);
    expect(elapsed).toBeLessThan(2000);
  });

  it('when remaining budget hits zero mid-chain the orchestrator clarifies without invoking the next provider', async () => {
    const hostedCalls: JevRequest[] = [];
    const hosted = stubProvider(
      'hosted',
      {
        decide: async () => {
          await delay(90);
          return validResponse('leave-request');
        },
      },
      hostedCalls,
    );
    const localSpy = vi.fn();
    const local = localRules();
    const localWrapped: JevProvider = {
      ...local,
      name: RULE_BASED_PROVIDER_NAME,
      healthCheck: () => local.healthCheck(),
      decide: async (req) => {
        localSpy();
        return local.decide(req);
      },
    };
    const orchestrator = new RoutingOrchestrator([hosted, localWrapped]);
    const outcome = await route(orchestrator, Date.now() + 50);
    expect(outcome.kind).toBe('clarify');
    expect(hostedCalls).toHaveLength(1);
    expect(localSpy).not.toHaveBeenCalled();
  });

  it('a hung provider is bounded by the shared remaining budget, never a fresh per-provider 2000ms', async () => {
    const hosted = stubProvider('hosted', {
      decide: () => new Promise<JevResponse>(() => {}), // never resolves
    });
    const orchestrator = new RoutingOrchestrator([hosted, localRules()]);
    const started = Date.now();
    const outcome = await route(orchestrator, Date.now() + 80);
    expect(Date.now() - started).toBeLessThan(500);
    expect(outcome.kind).toBe('clarify');
  });
});

describe('RoutingOrchestrator — health skip and local-unhealthy loud failure (RTE-07)', () => {
  const localRules = () => new RuleBasedProvider(ALIASES);

  it('skips a provider whose last probe failed; a later healthy probe reinstates it', async () => {
    let hostedHealthy = false;
    const hostedCalls: JevRequest[] = [];
    const hosted = stubProvider('hosted', { decide: async () => { throw new Error('skip me'); } }, hostedCalls);
    const hostedProbe: JevProvider = {
      ...hosted,
      healthCheck: async () => ({
        status: hostedHealthy ? 'healthy' : 'unhealthy',
        model_version: 'h',
        spec_version: '1.0',
        capabilities: [],
        uptime_seconds: 0,
      } as const),
    };
    const health = new ProviderHealthService([hostedProbe, localRules()], 60_000);
    await health.probeAll(); // hosted probe fails

    const orchestrator = new RoutingOrchestrator([hostedProbe, localRules()], { health });
    await route(orchestrator, Date.now() + 2000);
    expect(hostedCalls).toHaveLength(0); // skipped due to failed probe

    hostedHealthy = true;
    await health.probeAll(); // later probe succeeds
    await route(orchestrator, Date.now() + 2000);
    expect(hostedCalls).toHaveLength(1); // eligible again
  });

  it('a stale probe is a skip signal', async () => {
    let now = 1_000_000;
    const hostedCalls: JevRequest[] = [];
    const hosted = stubProvider('hosted', {}, hostedCalls);
    const local = localRules();
    const health = new ProviderHealthService([hosted], 60_000, () => now);
    await health.probeAll(); // healthy at t0
    now += 61_000; // last probe now stale
    const orchestrator = new RoutingOrchestrator([hosted, local], { health });
    await route(orchestrator, Date.now() + 2000);
    expect(hostedCalls).toHaveLength(0);
  });

  it('hosted-only outage still routes locally; local unhealthy fails loudly', async () => {
    const hosted = stubProvider('hosted', { healthStatus: 'unhealthy', decide: async () => validResponse('leave-request') });
    const health = new ProviderHealthService([hosted, localRules()], 60_000);
    await health.probeAll();
    const orchestrator = new RoutingOrchestrator([hosted, localRules()], { health });
    const outcome = await route(orchestrator, Date.now() + 2000);
    expect(outcome).toEqual({ kind: 'link', toolId: 'leave-request' });

    const brokenLocal = stubProvider(RULE_BASED_PROVIDER_NAME, { healthStatus: 'unhealthy' });
    const health2 = new ProviderHealthService([brokenLocal], 60_000);
    await health2.probeAll();
    const orchestrator2 = new RoutingOrchestrator([brokenLocal], { health: health2 });
    await expect(route(orchestrator2, Date.now() + 2000)).rejects.toThrow(/LOCAL_PROVIDER_UNHEALTHY/);
  });
});
