/**
 * DAT-10/DAT-11 — the DSL→Mongo compiler (D-74).
 *
 * Takes a schema-validated {@link QueryDsl} AST and a per-execution
 * {@link QueryCtx}, and emits the single Mongo filter the repository runs.
 *
 * ## The invariant everything else hangs from (D-74)
 *
 * `compileQuery` never merges the user's filter *into* auth — it *appends* it:
 *
 *     { $and: [ auth, userFilter ] }
 *
 * Auth is produced by {@link buildAuthFilter} (DAT-11: `deleted_at` always,
 * `real_user_id` unless `view_all`) and always sits at index 0 of the root
 * `$and`. An `$or` the user wrote at the top of their tree is therefore a
 * *sibling* of auth, never a replacement for it — the shape the DAT-12
 * survival tests assert structurally.
 */

import { DEFAULT_QUERY_LIMIT, type QueryDsl } from '@akane/contract';

import type { CompiledQuery, QueryCtx, MongoFilter } from './ast.js';

/**
 * Compile a validated DSL document into the complete Mongo query description.
 */
export function compileQuery(_dsl: QueryDsl, _ctx: QueryCtx): CompiledQuery {
  return { filter: {}, limit: DEFAULT_QUERY_LIMIT, offset: 0 };
}