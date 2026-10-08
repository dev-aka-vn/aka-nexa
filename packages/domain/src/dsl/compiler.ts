/**
 * DAT-10/DAT-11/DAT-12 — the DSL→Mongo compiler (D-74).
 *
 * Takes a schema-validated {@link QueryDsl} AST and a per-execution
 * {@link QueryCtx}, and emits the single Mongo query description the
 * repository runs.
 *
 * ## The invariant everything else hangs from (D-74)
 *
 * `compileQuery` never merges the user's filter *into* auth — it *appends* it:
 *
 *     { $and: [ auth, userFilter ] }
 *
 * Auth comes from {@link buildAuthFilter} (DAT-11: `deleted_at` always,
 * `real_user_id` unless `view_all`) and always sits at index 0 of the root
 * `$and`. An `$or` the user wrote at the top of their tree is therefore a
 * *sibling* of auth, never a replacement for it — the structural shape the
 * DAT-12 survival tests assert.
 *
 * ## Why no `$`-prefixed operator can come from input (DAT-10)
 *
 * Every operator literal below (`$ne`, `$in`, `$gte`, `$lte`, `$regex`,
 * `$and`, `$or`) is written here, on the far side of the strict schema. Input
 * reaches this file only as a {@link FilterExpr} whose `op` was one of D-72's
 * eight, whose `field` matched a dotted-identifier pattern, and whose value
 * carried no `$`-prefixed key at any depth. `contains` receives a plain
 * string and escapes every regex metacharacter before it becomes a pattern,
 * so the DSL's substring match can never be re-interpreted as a regex.
 *
 * App scoping (D-76) is applied by `SubmissionRepository.queryWithDsl`
 * against the query link's bound `app_id`, outside this module.
 */

import {
  DEFAULT_QUERY_LIMIT,
  type FilterExpr,
  type QueryDsl,
  type SortSpec,
} from '@akane/contract';

import type { CompiledQuery, MongoFilter, QueryCtx } from './ast.js';
import { buildAuthFilter } from './filter-builder.js';

/** Escape every regex metacharacter so `contains` matches a literal, never a pattern. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile one filter-tree node into a Mongo filter fragment.
 *
 * Total by construction: the switch covers exactly D-72's eight ops, so
 * adding an op to the contract without handling it here is a compile error.
 */
export function compileFilter(node: FilterExpr): MongoFilter {
  switch (node.op) {
    case 'eq':
      return { [node.field]: node.value };
    case 'ne':
      return { [node.field]: { $ne: node.value } };
    case 'in':
      return { [node.field]: { $in: node.values } };
    case 'gte':
      return { [node.field]: { $gte: node.value } };
    case 'lte':
      return { [node.field]: { $lte: node.value } };
    case 'contains':
      return { [node.field]: { $regex: escapeRegex(node.value), $options: 'i' } };
    case 'and':
      return { $and: node.filters.map(compileFilter) };
    case 'or':
      return { $or: node.filters.map(compileFilter) };
  }
}

/** Sort specs → Mongo sort document (`asc` → 1, `desc` → -1). */
function compileSort(sort: SortSpec[]): Record<string, 1 | -1> {
  const out: Record<string, 1 | -1> = {};
  for (const { field, dir } of sort) out[field] = dir === 'asc' ? 1 : -1;
  return out;
}

/**
 * Compile a validated DSL document into the complete Mongo query
 * description: the auth-wrapped filter at the root (D-74) plus the page,
 * sort and projection clauses the DSL carried.
 */
export function compileQuery(dsl: QueryDsl, ctx: QueryCtx): CompiledQuery {
  const auth = buildAuthFilter(ctx.viewerId, ctx.hasViewAll);
  const userFilter = dsl.filters === undefined ? undefined : compileFilter(dsl.filters);

  // D-74: auth is the root; the user's tree is appended, never merged.
  const filter: MongoFilter = userFilter === undefined ? auth : { $and: [auth, userFilter] };

  const compiled: CompiledQuery = {
    filter,
    limit: dsl.limit ?? DEFAULT_QUERY_LIMIT,
    offset: dsl.offset ?? 0,
  };
  if (dsl.sort !== undefined && dsl.sort.length > 0) compiled.sort = compileSort(dsl.sort);
  if (dsl.projection !== undefined) compiled.projection = dsl.projection;
  return compiled;
}
