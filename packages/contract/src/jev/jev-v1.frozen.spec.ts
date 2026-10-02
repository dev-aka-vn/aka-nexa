import { describe, expect, it } from 'vitest';

import { JevRequestSchema } from './v1/index.js';
import { JevResponseSchema, toJsonSchema } from './v1/index.js';
import { JEV_SPEC_VERSION } from './v1/jev-request.js';

/**
 * D-24 — "frozen" is mechanical, not a promise.
 *
 * `.strict()` (asserted in behaviour 5) rejects an **extra** runtime key, but
 * it cannot see a key that was **removed** at author time: dropping `question`
 * from the schema would leave a schema that still rejects everything unknown
 * and now accepts nothing where a question belongs. Only a test against a
 * literal key array catches that. The two assertions therefore catch opposite
 * failure modes and both are required.
 *
 * `V1` is the version-named constant. A deliberate break is a visible edit to
 * `V1` and a version bump, never an accident.
 */
const V1_REQUEST_KEYS = [
  'context',
  'question',
  'request_id',
  'spec_version',
  'state',
  'tools',
] as const;

const V1_RESPONSE_KEYS = [
  'alternatives',
  'choice',
  'clarification_needed',
  'clarification_prompt',
  'latency_ms',
  'provider',
  'request_id',
  'spec_version',
] as const;

const REQUEST = {
  spec_version: '1.0',
  request_id: 'req_01',
  state: {
    locale: 'en',
    conversation_id: 'conv_01',
    turn_count: 3,
    force_clarification: false,
  },
  question: 'I want to request leave for next week',
  context: {
    real_user_id: 'usr_42',
    app_hints: [],
    previous_turns: [
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'How can I help?' },
    ],
  },
  tools: [
    {
      id: 'hr-leave-request:create_leave',
      description: 'Submit a new leave request',
      parameters: ['start_date', 'end_date', 'leave_type'],
    },
  ],
} as const;

const RESPONSE = {
  spec_version: '1.0',
  request_id: 'req_01',
  choice: { tool_id: 'hr-leave-request:create_leave', confidence: 0.94, verified: true },
  alternatives: [{ tool_id: 'hr-leave-request:view_leave', confidence: 0.04 }],
  clarification_needed: false,
  provider: 'openjev-v2',
  latency_ms: 230,
} as const;

describe('JEV v1 frozen key set (RTE-10, D-23, D-24)', () => {
  it('names spec version 1.0', () => {
    expect(JEV_SPEC_VERSION).toBe('1.0');
  });

  it('freezes the request top-level key set', () => {
    expect(Object.keys(JevRequestSchema.shape).sort()).toEqual([...V1_REQUEST_KEYS]);
  });

  it('freezes the response top-level key set', () => {
    expect(Object.keys(JevResponseSchema.shape).sort()).toEqual([...V1_RESPONSE_KEYS]);
  });

  it('carries the request-side D-23 addition, state.force_clarification', () => {
    expect(JevRequestSchema.safeParse(REQUEST).success).toBe(true);

    const stateWithoutTheHint: Record<string, unknown> = { ...REQUEST.state };
    delete stateWithoutTheHint.force_clarification;

    const result = JevRequestSchema.safeParse({
      ...REQUEST,
      state: stateWithoutTheHint,
    });

    expect(result.success).toBe(false);
  });

  it('rejects a response that pairs an abstention with a chosen tool', () => {
    const result = JevResponseSchema.safeParse({
      ...RESPONSE,
      choice: { tool_id: 'hr-leave-request:create_leave', confidence: 0.4, verified: null },
    });

    expect(result.success).toBe(false);
  });

  it('accepts a consistent abstention expressed as choice.verified === null', () => {
    const result = JevResponseSchema.safeParse({
      ...RESPONSE,
      choice: { tool_id: null, confidence: 0, verified: null },
      clarification_needed: true,
      clarification_prompt: 'Which app did you mean?',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a response carrying an unlisted top-level key', () => {
    const result = JevResponseSchema.safeParse({
      ...RESPONSE,
      raw_model_output: 'anything',
    });

    expect(result.success).toBe(false);
  });

  it('publishes the response as z.toJSONSchema() output stamped with $id v1.0', () => {
    const published = toJsonSchema(JevResponseSchema, 'response') as {
      $id: string;
      additionalProperties: boolean;
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(published.$id).toContain('1.0');
    expect(published.additionalProperties).toBe(false);
    // The published document carries the SAME frozen key set, not a subset.
    expect(Object.keys(published.properties).sort()).toEqual([...V1_RESPONSE_KEYS]);
    // `alternatives` and `clarification_prompt` are optional in PRD §11.1.
    expect([...published.required].sort()).toEqual([
      'choice',
      'clarification_needed',
      'latency_ms',
      'provider',
      'request_id',
      'spec_version',
    ]);
  });
});
