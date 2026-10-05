import { z } from 'zod';

/**
 * JEV v1 request — PRD §11.1 transcribed, `.strict()` (D-23).
 *
 * One addition over the PRD: `state.force_clarification` (D-23). The PRD lets
 * only the *provider* ask for clarification. The platform has its own reasons
 * to force it — a locale outside `en`/`vi`, an input under N characters, a tool
 * set that changed inside the last hour — and expressing that as a provider
 * concern would require faking a provider response. It is a request-side
 * boolean, so the platform can ask without pretending to be the model.
 *
 * `spec_version` is retained from the PRD. This schema IS the version, and the
 * frozen-key-set test in `jev-v1.frozen.spec.ts` is what makes changing it
 * loud.
 */
export const JEV_SPEC_VERSION = '1.0';

/** One prior conversational turn. Roles are closed — a system turn is not a thing. */
export const TurnSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    text: z.string(),
  })
  .strict();

export type Turn = z.infer<typeof TurnSchema>;

/**
 * A tool the caller is *allowed* to use. The list is already RBAC-filtered
 * before it reaches the provider (PRD §7.1: tool filter → JEV), so the
 * descriptor carries no permission surface of its own.
 */
export const ToolDescriptorSchema = z
  .object({
    id: z.string(),
    description: z.string(),
    parameters: z.array(z.string()),
  })
  .strict();

export type ToolDescriptor = z.infer<typeof ToolDescriptorSchema>;

/** Conversation-level state, including the platform's own clarification hint. */
export const JevStateSchema = z
  .object({
    locale: z.string(),
    conversation_id: z.string(),
    turn_count: z.number().int().nonnegative(),
    /** D-23 addition — the platform may force clarification for its own reasons. */
    force_clarification: z.boolean(),
  })
  .strict();

export type JevState = z.infer<typeof JevStateSchema>;

/**
 * `real_user_id` is an opaque identifier, never a name, an email or a chat
 * handle (D-16/D-21: opaque IDs only, no PII on the wire).
 */
export const JevContextSchema = z
  .object({
    real_user_id: z.string(),
    app_hints: z.array(z.string()),
    previous_turns: z.array(TurnSchema),
  })
  .strict();

export type JevContext = z.infer<typeof JevContextSchema>;

export const JevRequestSchema = z
  .object({
    spec_version: z.literal(JEV_SPEC_VERSION),
    request_id: z.string(),
    state: JevStateSchema,
    question: z.string(),
    context: JevContextSchema,
    tools: z.array(ToolDescriptorSchema),
  })
  .strict();

export type JevRequest = z.infer<typeof JevRequestSchema>;
