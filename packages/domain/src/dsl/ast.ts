/**
 * The Query DSL's **AST surface** (DAT-10, D-72, D-74).
 *
 * A validated DSL document *is* the AST, and its shape is fixed by the wire
 * contract in `@akane/contract` — the contract package is the only place both
 * sides (seeds, App Builder, compiler) can originate a shared type from,
 * because its single boundary edge points at kernel while domain imports it
 * freely. This module re-exports those types under their AST names (one
 * definition, two names, no drift) and adds the three compiler-facing shapes
 * that only make sense *inside* the domain:
 *
 *  - {@link MongoFilter} — the compiler's output. Deliberately a string-keyed
 *    record: the operator vocabulary it can carry (`$and`, `$or`, `$regex`, …)
 *    is emitted exclusively by `compiler.ts`, never parsed from input, so a
 *    closed union here would only have to be reopened every time the compiler
 *    legitimately grows a new emission.
 *  - {@link QueryCtx} — the per-execution authorization context the verifier
 *    hands the compiler. `viewerId` + `hasViewAll` drive DAT-11's injection
 *    rule; `appId` scopes the query to one app (D-76).
 *  - {@link CompiledQuery} — filter + paging/sort/projection, the complete
 *    description `SubmissionRepository.queryWithDsl` needs to execute.
 */

import type { Projection } from '@akane/contract';

export {
  DEFAULT_QUERY_LIMIT,
  DSL_OPERATORS,
  MAX_QUERY_LIMIT,
  QUERY_DSL_CONTRACT_VERSION,
} from '@akane/contract';

export type {
  DslOperator,
  FilterExpr,
  JsonValue,
  Projection,
  QueryDsl,
  SortDirection,
  SortSpec,
} from '@akane/contract';

/**
 * A compiled MongoDB filter fragment.
 *
 * Only `compiler.ts` and `filter-builder.ts` construct these; nothing parses
 * user input into one (DAT-10's core invariant — raw Mongo is never
 * expressible from the DSL).
 */
export type MongoFilter = { [key: string]: unknown };

/**
 * Per-execution authorization context (DAT-11).
 *
 * Produced by the read-link verifier from verified JWT claims — never from
 * request input. `hasViewAll` bypasses `real_user_id` injection **only**;
 * `deleted_at: null` is unconditional (D-78).
 */
export interface QueryCtx {
  /** The verified viewer (`sub` claim). */
  viewerId: string;
  /** Does the viewer hold this app's `view_all` permission (D-76/D-77)? */
  hasViewAll: boolean;
  /** The app the query link is bound to (`app_id` claim). */
  appId: string;
}

/**
 * Everything the repository needs to execute a validated query: the
 * auth-wrapped filter at the root (D-74) plus the page/sort/projection
 * clauses the DSL carried.
 */
export interface CompiledQuery {
  filter: MongoFilter;
  sort?: Record<string, 1 | -1>;
  limit: number;
  offset: number;
  projection?: Projection;
}


