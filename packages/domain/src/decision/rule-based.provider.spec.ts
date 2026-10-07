import { describe, expect, it } from 'vitest';
import {
  JevRequestSchema,
  type JevRequest,
} from '@akane/contract';

import { RuleBasedProvider } from './rule-based.provider.js';

const ALIASES = new Map<string, readonly string[]>([
  ['leave-request', ['request leave', 'leave request', 'xin nghỉ phép']],
  ['laptop-support', ['laptop support', 'hỗ trợ laptop']],
]);

function makeReq(overrides: Partial<JevRequest> = {}): JevRequest {
  return JevRequestSchema.parse({
    spec_version: '1.0',
    request_id: 'req_1',
    state: { locale: 'en', conversation_id: 'c1', turn_count: 0, force_clarification: false },
    question: 'I want to request leave',
    context: { real_user_id: 'u1', app_hints: [], previous_turns: [] },
    tools: [
      { id: 'leave-request', description: 'Submit a new leave request', parameters: [] },
      { id: 'laptop-support', description: 'Get laptop support', parameters: [] },
    ],
    ...overrides,
  });
}

describe('RuleBasedProvider offline conformance', () => {
  const provider = new RuleBasedProvider(ALIASES);

  it('returns a healthy self-report with the rules model version and capabilities', async () => {
    const health = await provider.healthCheck();
    expect(health.status).toBe('healthy');
    expect(health.model_version).toBe('rules-v1');
    expect([...health.capabilities]).toEqual(['tool_selection', 'clarification', 'multi_turn']);
  });

  it('abstains clarification-style on an empty tool list', async () => {
    const res = await provider.decide(makeReq({ tools: [] }));
    expect(res.choice.tool_id).toBeNull();
    expect(res.choice.verified).toBeNull();
    expect(res.clarification_needed).toBe(true);
  });

  it('clarifies on unknown input rather than guessing', async () => {
    const res = await provider.decide(makeReq({ question: 'xyzzy quux frobnicate' }));
    expect(res.choice.tool_id).toBeNull();
    expect(res.choice.verified).toBeNull();
    expect(res.clarification_needed).toBe(true);
  });

  it('throws on a schema-invalid request (the orchestrator owns conversion to clarify)', async () => {
    await expect(provider.decide({ spec_version: '1.0' } as never)).rejects.toThrow();
  });

  it('routes an English request to the same app as the Vietnamese equivalent', async () => {
    const en = await provider.decide(makeReq({ question: 'I want to request leave' }));
    const vi = await provider.decide(
      makeReq({
        state: { locale: 'vi', conversation_id: 'c1', turn_count: 0, force_clarification: false },
        question: 'Tôi muốn xin nghỉ phép',
      }),
    );
    expect(en.choice).toEqual({ tool_id: 'leave-request', confidence: 1, verified: true });
    expect(vi.choice).toEqual({ tool_id: 'leave-request', confidence: 1, verified: true });
  });

  it('offers alternatives when a mixed-language question matches two apps', async () => {
    const res = await provider.decide(
      makeReq({ question: 'request leave and laptop support' }),
    );
    expect(res.choice.verified).toBeNull();
    expect(res.clarification_needed).toBe(true);
    expect(res.alternatives?.map((a) => a.tool_id).sort()).toEqual([
      'laptop-support',
      'leave-request',
    ]);
  });

  it('does not route a negated request (không xin nghỉ...) to leave', async () => {
    const res = await provider.decide(
      makeReq({
        state: { locale: 'vi', conversation_id: 'c1', turn_count: 0, force_clarification: false },
        question: 'không xin nghỉ phép, cần hỗ trợ laptop',
      }),
    );
    // The negation guard abstains entirely: leave must not route, and the
    // ambiguous vi alias for laptop still clarifies rather than links.
    expect(res.choice.tool_id).not.toBe('leave-request');
    expect(res.clarification_needed).toBe(true);
  });

  it('honours state.force_clarification even with a clear match', async () => {
    const res = await provider.decide(
      makeReq({
        state: { locale: 'en', conversation_id: 'c1', turn_count: 0, force_clarification: true },
      }),
    );
    expect(res.choice.tool_id).toBeNull();
    expect(res.clarification_needed).toBe(true);
  });

  it('abstains on an unsupported locale instead of silently routing', async () => {
    const res = await provider.decide(
      makeReq({
        state: { locale: 'de', conversation_id: 'c1', turn_count: 0, force_clarification: false },
      }),
    );
    expect(res.choice.tool_id).toBeNull();
    expect(res.clarification_needed).toBe(true);
  });
});
