/**
 * The published JEV v1 surface (D-23).
 *
 * `z.toJSONSchema()` output is the artifact. There is deliberately **no** second
 * hand-written JSON Schema: a hand-maintained copy of a `.strict()` Zod schema
 * is a schema that can drift, and the entire point of D-24 is that this
 * contract cannot drift silently.
 *
 * The `$id` is stamped by the wrapper rather than by Zod's `override` hook
 * because in `zod@4.6.5` `ctx.override(...)` is called for its side effect
 * only — its return value is discarded (`core/to-json-schema.js:460`), and it
 * runs once per *subschema*, so an unguarded `$id` would land on every
 * property. Stamping the returned document is one line and has no per-node
 * hazard.
 */
import { z } from 'zod';

import {
  JEV_SPEC_VERSION,
  JevContextSchema,
  JevRequestSchema,
  JevStateSchema,
  ToolDescriptorSchema,
  TurnSchema,
} from './jev-request.js';
import {
  JevAlternativeSchema,
  JevChoiceSchema,
  JevResponseSchema,
  JEV_ABSTENTION_REQUIRES_CLARIFICATION,
  JEV_ABSTENTION_REQUIRES_NULL_CHOICE,
  refineAbstentionIsTotal,
} from './jev-response.js';

export {
  JEV_SPEC_VERSION,
  JevContextSchema,
  JevRequestSchema,
  JevStateSchema,
  ToolDescriptorSchema,
  TurnSchema,
  JevAlternativeSchema,
  JevChoiceSchema,
  JevResponseSchema,
  JEV_ABSTENTION_REQUIRES_CLARIFICATION,
  JEV_ABSTENTION_REQUIRES_NULL_CHOICE,
  refineAbstentionIsTotal,
};

export type {
  JevContext,
  JevRequest,
  JevState,
  ToolDescriptor,
  Turn,
} from './jev-request.js';
export type {
  JevAlternative,
  JevChoice,
  JevResponse,
} from './jev-response.js';

/** The two messages the contract publishes as a document. */
export const JEV_V1_DOCUMENTS = Object.freeze({
  request: 'request',
  response: 'response',
} as const);

export type JevV1Document = (typeof JEV_V1_DOCUMENTS)[keyof typeof JEV_V1_DOCUMENTS];

/** The published JSON Schema draft. 2020-12 is what `additionalProperties: false` and `const` need. */
const JSON_SCHEMA_TARGET = 'draft-2020-12';

/**
 * `z.toJSONSchema()` with the version stamped into `$id` (D-23, D-24).
 *
 * The `$id` names the version, so the published document is self-describing
 * even though the wire payload carries no version claim of its own.
 */
export function toJsonSchema(
  schema: z.ZodType,
  document: JevV1Document,
): Record<string, unknown> {
  return {
    ...z.toJSONSchema(schema, { target: JSON_SCHEMA_TARGET }),
    $id: `urn:akane:contract:jev:${JEV_SPEC_VERSION}:${document}`,
  };
}
