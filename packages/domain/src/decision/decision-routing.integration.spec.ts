import { describe, expect, it, vi } from 'vitest';
import {
  JevResponseSchema,
  RULE_BASED_PROVIDER_NAME,
  type JevProvider,
  type JevRequest,
  type JevResponse,
  type ToolDescriptor,
} from '@akane/contract';

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

function makeDraft(question: string, overrides: Record<string, unknown> = {}) {
  return {
    spec_version: '1.0' as const,
    request_id: 'req_it_1',
    state: {
      locale: 'en',
      conversation_id: 'c1',
      turn_count: 0,
      force_clarification: false,
      ...(overrides.state as Record<string, unknown> | undefined),
    },
    question,
    context: {
      real_user_id: 'u1',
      app_hints: [],
      previous_turns: [],
      ...(overrides.context as Record<string, unknown> | undefined),
    },
  };
}

function stubProvider(response: unknown): JevProvider & { calls: JevRequest[] } {
  const calls: JevRequest[] = [];
  const provider: JevProvider & { calls: JevRequest[] } = {
    calls,
    name: 'stub',
    spec_version: '1.0',
    capabilities: ['tool_selection', 'clarification', 'multi_turn'],
    async decide(req: JevRequest) {
      calls.push(req);
      return response as JevResponse;
    },
    async healthCheck() {
      return {
        status: 'healthy',
        model_version: 'stub-0.0.0',
        spec_version: '1.0',
        capabilities: ['tool_selection', 'clarification', 'multi_turn'],
        uptime_seconds: 0,
      };
    },
  };
  return provider;
}

function responseOf(overrides: Partial<JevResponse> = {}): JevResponse {
  return JevResponseSchema.parse({
    spec_version: '1.0',
    request_id: 'req_it_1',
    choice: { tool_id: 'leave-request', confidence: 0.99, verified: true },
    clarification_needed: false,
    provider: 'stub',
    latency_ms: 1,
    ...overrides,
  });
}

const alwaysCanOpen = async () => true;
const threshold = () => 0.8;
const openDeadline = () => Date.now() + 60_000;

describe('RoutingOrchestrator gate (RTE-03, RTE-04, RTE-08, D-23)', () => {
  it('never routes a verified:false decision to a link, even though it parses', async () => {
    const res = responseOf({ choice: { tool_id: 'leave-request', confidence: 0.99, verified: false } });
    expect(JevResponseSchema.safeParse(res).success).toBe(true);
    const orchestrator = new RoutingOrchestrator([stubProvider(res)]);
    const out = await orchestrator.route({
      draft: makeDraft('request leave'),
      authorizedTools: TOOLS,
      threshold,
      canOpenNow: alwaysCanOpen,
      deadlineEpochMs: openDeadline(),
    });
    expect(out.kind).toBe('clarify');
  });

  it('refuses verified:null with a tool_id present at the schema boundary', async () => {
    const bad = {
      spec_version: '1.0',
      request_id: 'req_it_1',
      choice: { tool_id: 'leave-request', confidence: 0.5, verified: null },
      clarification_needed: false,
      provider: 'stub',
      latency_ms: 1,
    };
    expect(JevResponseSchema.safeParse(bad).success).toBe(false);
    const orchestrator = new RoutingOrchestrator([stubProvider(bad)]);
    const out = await orchestrator.route({
      draft: makeDraft('request leave'),
      authorizedTools: TOOLS,
      threshold,
      canOpenNow: alwaysCanOpen,
      deadlineEpochMs: openDeadline(),
    });
    expect(out.kind).toBe('clarify');
  });

  it('sends the provider only the authorized tools, never the global catalogue', async () => {
    const provider = stubProvider(responseOf());
    const orchestrator = new RoutingOrchestrator([provider]);
    await orchestrator.route({
      draft: makeDraft('request leave'),
      authorizedTools: [TOOLS[0]],
      threshold,
      canOpenNow: alwaysCanOpen,
      deadlineEpochMs: openDeadline(),
    });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].tools.map((t) => t.id)).toEqual(['leave-request']);
  });

  it('clarifies when the choice is below the app threshold', async () => {
    const provider = stubProvider(
      responseOf({ choice: { tool_id: 'leave-request', confidence: 0.5, verified: true } }),
    );
    const orchestrator = new RoutingOrchestrator([provider]);
    const out = await orchestrator.route({
      draft: makeDraft('request leave'),
      authorizedTools: TOOLS,
      threshold,
      canOpenNow: alwaysCanOpen,
      deadlineEpochMs: openDeadline(),
    });
    expect(out.kind).toBe('clarify');
  });

  it('clarifies when a competing permitted alternative exists', async () => {
    const provider = stubProvider(
      responseOf({
        alternatives: [{ tool_id: 'laptop-support', confidence: 0.6 }],
      }),
    );
    const orchestrator = new RoutingOrchestrator([provider]);
    const out = await orchestrator.route({
      draft: makeDraft('request leave'),
      authorizedTools: TOOLS,
      threshold,
      canOpenNow: alwaysCanOpen,
      deadlineEpochMs: openDeadline(),
    });
    expect(out).toEqual({ kind: 'clarify', toolIds: ['laptop-support'] });
  });

  it('clarifies without a link once the deadline has passed', async () => {
    const orchestrator = new RoutingOrchestrator([stubProvider(responseOf())]);
    const out = await orchestrator.route({
      draft: makeDraft('request leave'),
      authorizedTools: TOOLS,
      threshold,
      canOpenNow: alwaysCanOpen,
      deadlineEpochMs: Date.now() - 1,
    });
    expect(out.kind).toBe('clarify');
  });

  it('converts a malformed provider request (schema-invalid draft) into clarify', async () => {
    const provider = new RuleBasedProvider(ALIASES);
    const decide = vi.spyOn(provider, 'decide');
    const orchestrator = new RoutingOrchestrator([provider]);
    const out = await orchestrator.route({
      draft: { spec_version: '1.0', request_id: 'x' } as never,
      authorizedTools: TOOLS,
      threshold,
      canOpenNow: alwaysCanOpen,
      deadlineEpochMs: openDeadline(),
    });
    expect(out.kind).toBe('clarify');
    expect(decide).not.toHaveBeenCalled();
  });

  it('routes EN and VI leave requests through the wired chain to the same tool', async () => {
    const provider = new RuleBasedProvider(ALIASES);
    const orchestrator = new RoutingOrchestrator([provider]);
    const en = await orchestrator.route({
      draft: makeDraft('I want to request leave'),
      authorizedTools: TOOLS,
      threshold,
      canOpenNow: alwaysCanOpen,
      deadlineEpochMs: openDeadline(),
    });
    const viOut = await orchestrator.route({
      draft: makeDraft('Tôi muốn xin nghỉ phép', {
        state: { locale: 'vi' },
      }),
      authorizedTools: TOOLS,
      threshold,
      canOpenNow: alwaysCanOpen,
      deadlineEpochMs: openDeadline(),
    });
    expect(en).toEqual({ kind: 'link', toolId: 'leave-request' });
    expect(viOut).toEqual({ kind: 'link', toolId: 'leave-request' });
    expect(provider.name).toBe(RULE_BASED_PROVIDER_NAME);
  });
});
