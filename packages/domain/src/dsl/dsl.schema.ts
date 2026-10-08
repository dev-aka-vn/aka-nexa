/**
 * STRICT DSL schema — DAT-10.
 *
 * Placeholder for the RED phase: accepts every document so the DAT-10 rejection
 * assertions fail on behaviour rather than on a missing module.
 */
import { z } from 'zod';

import type { QueryDsl } from '@akane/contract';

/** Maximum nesting depth of a filter tree. */
export const MAX_FILTER_DEPTH = 12;

export type ParseQueryDslResult =
  | { ok: true; dsl: QueryDsl }
  | { ok: false; issues: string[] };

export const QueryDslSchema: z.ZodType<QueryDsl> = z.custom<QueryDsl>(() => true);

export function parseQueryDsl(json: unknown): ParseQueryDslResult {
  const result = QueryDslSchema.safeParse(json);
  if (result.success) {
    return { ok: true, dsl: result.data };
  }
  return { ok: false, issues: result.error.issues.map((issue) => issue.message) };
}
