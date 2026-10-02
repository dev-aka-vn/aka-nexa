import { z } from 'zod';

import { JEV_SPEC_VERSION } from './jev-request.js';

/**
 * JEV v1 response — PRD §11.1 transcribed, `.strict()` (D-23).
 *
 * ## Two deliberate differences from the PRD
 *
 * 1. **`choice` is required.** The PRD types it `choice?`. Making it optional
 *    would leave abstention expressible two ways — an absent `choice` *or* a
 *    `choice` with no tool — and the PRD §17.3 conformance suite would then
 *    have two shapes to test for the same signal. D-23 resolves this: the
 *    object is always present and abstention is the `verified === null` state.
 * 2. **`choice.verified` is a tri-state.** `true` = confident and choosing,
 *    `false` = a declared-but-unverified answer, `null` = abstaining.
 *    Abstention is a *different signal* from low confidence, and a scalar
 *    `confidence` cannot express "the model declined to answer" separately from
 *    "the model answered weakly". The platform routes `null` to clarification
 *    regardless of the number beside it.
 *
 * `alternatives` and `clarification_prompt` stay optional, exactly as the PRD
 * has them: a confident single answer legitimately has neither a runner-up nor
 * a prompt.
 */

/** Machine-readable issue tokens. Custom Zod issues always carry `code: 'custom'`, so the token rides in `message` — the same pattern `redis.schema.ts` uses for the D-12 boot failure. */
export const JEV_ABSTENTION_REQUIRES_NULL_CHOICE = 'JEV_ABSTENTION_REQUIRES_NULL_CHOICE';
export const JEV_ABSTENTION_REQUIRES_CLARIFICATION =
  'JEV_ABSTENTION_REQUIRES_CLARIFICATION';

export const JevChoiceSchema = z
  .object({
    tool_id: z.string().nullable(),
    confidence: z.number(),
    /** D-23 — `null` is abstention, which is not the same as a low score. */
    verified: z.boolean().nullable(),
  })
  .strict();

export type JevChoice = z.infer<typeof JevChoiceSchema>;

export const JevAlternativeSchema = z
  .object({
    tool_id: z.string(),
    confidence: z.number(),
  })
  .strict();

export type JevAlternative = z.infer<typeof JevAlternativeSchema>;

/**
 * D-23's cross-field rule: an abstention must be *total*.
 *
 * Without it, `verified: null` next to a real `tool_id` and
 * `clarification_needed: false` is a valid document that means "I am abstaining
 * while also silently picking a tool" — a provider could route on the tool and
 * ignore the abstention, which is exactly the failure the tri-state exists to
 * prevent. The refinement makes the two signals impossible to contradict.
 */
export function refineAbstentionIsTotal(
  response: {
    choice: { tool_id: string | null; verified: boolean | null };
    clarification_needed: boolean;
  },
  ctx: z.RefinementCtx,
): void {
  if (response.choice.verified !== null) {
    return;
  }

  if (response.choice.tool_id !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['choice', 'tool_id'],
      message: JEV_ABSTENTION_REQUIRES_NULL_CHOICE,
    });
  }

  if (!response.clarification_needed) {
    ctx.addIssue({
      code: 'custom',
      path: ['clarification_needed'],
      message: JEV_ABSTENTION_REQUIRES_CLARIFICATION,
    });
  }
}

export const JevResponseSchema = z
  .object({
    spec_version: z.literal(JEV_SPEC_VERSION),
    request_id: z.string(),
    /** Required (D-23) — abstention is the `verified: null` state, not omission. */
    choice: JevChoiceSchema,
    alternatives: z.array(JevAlternativeSchema).optional(),
    clarification_needed: z.boolean(),
    clarification_prompt: z.string().optional(),
    provider: z.string(),
    latency_ms: z.number(),
  })
  .strict()
  .superRefine(refineAbstentionIsTotal);

export type JevResponse = z.infer<typeof JevResponseSchema>;
