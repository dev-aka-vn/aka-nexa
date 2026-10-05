import { describe, expect, it } from 'vitest';

import {
  JevRequestSchema,
  JevResponseSchema,
  JEV_ABSTENTION_REQUIRES_CLARIFICATION,
  JEV_ABSTENTION_REQUIRES_NULL_CHOICE,
} from './v1/index.js';
import { JevProvider, RULE_BASED_PROVIDER_NAME } from './jev-provider.js';

/**
 * The provider is a **first-party** interface (D-23), not a vendor protocol.
 * "JEV" is a PRD invention with no industry standard, and the PRD's
 * "OpenJev" reference implementations are unofficial reconstructions — so the
 * contract is a named interface the platform owns.
 *
 * This spec proves the interface is *satisfiable*: a provider that parses both
 * payloads with the frozen schemas and answers one response is enough to show
 * the signature is implementable without a real model behind it.
 */
const stubProvider: JevProvider = {
  name: 'stub',
  spec_version: '1.0',
  capabilities: ['tool_selection', 'clarification', 'multi_turn'],
  async decide() {
    return JevResponseSchema.parse({
      spec_version: '1.0',
      request_id: 'req_01',
      choice: { tool_id: null, confidence: 0, verified: null },
      alternatives: [],
      clarification_needed: true,
      clarification_prompt: 'Which app did you mean?',
      provider: 'stub',
      latency_ms: 1,
    });
  },
  async healthCheck() {
    return {
      status: 'healthy',
      model_version: 'stub-0.0.0',
      spec_version: '1.0',
      capabilities: ['tool_selection'],
      uptime_seconds: 0,
    };
  },
};

describe('JevProvider (D-23 — terminal fallback is a named contract constant)', () => {
  it('is satisfiable by a provider that validates against the frozen schemas', async () => {
    const request = JevRequestSchema.parse({
      spec_version: '1.0',
      request_id: 'req_01',
      state: {
        locale: 'en',
        conversation_id: 'conv_01',
        turn_count: 0,
        force_clarification: false,
      },
      question: 'leave next week',
      context: { real_user_id: 'usr_42', app_hints: [], previous_turns: [] },
      tools: [],
    });

    await expect(stubProvider.decide(request)).resolves.toMatchObject({
      spec_version: '1.0',
      clarification_needed: true,
    });
    await expect(stubProvider.healthCheck()).resolves.toMatchObject({
      status: 'healthy',
    });
  });

  it('names the terminal fallback so its absence is a startup assertion, not a runtime surprise', () => {
    expect(RULE_BASED_PROVIDER_NAME).toBe('rule-based');
  });

  it('reports the D-23 abstention refusal as named codes, not prose', () => {
    const missingClarification = JevResponseSchema.safeParse({
      spec_version: '1.0',
      request_id: 'req_01',
      choice: { tool_id: null, confidence: 0, verified: null },
      alternatives: [],
      clarification_needed: false,
      provider: 'stub',
      latency_ms: 1,
    });

    expect(missingClarification.success).toBe(false);
    if (!missingClarification.success) {
      expect(missingClarification.error.issues.map((i) => i.message)).toContain(
        JEV_ABSTENTION_REQUIRES_CLARIFICATION,
      );
    }

    const smuggledChoice = JevResponseSchema.safeParse({
      spec_version: '1.0',
      request_id: 'req_01',
      choice: { tool_id: 'hr-leave-request:create_leave', confidence: 0.4, verified: null },
      alternatives: [],
      clarification_needed: true,
      provider: 'stub',
      latency_ms: 1,
    });

    expect(smuggledChoice.success).toBe(false);
    if (!smuggledChoice.success) {
      expect(smuggledChoice.error.issues.map((i) => i.message)).toContain(
        JEV_ABSTENTION_REQUIRES_NULL_CHOICE,
      );
    }
  });
});
