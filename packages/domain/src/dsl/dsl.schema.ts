/**
 * DAT-10 — the Query DSL's strict validation boundary (D-72, D-74).
 *
 * Everything a stored query (or a future App Builder draft) can express enters
 * through {@link parseQueryDsl} / {@link QueryDslSchema}. The schema is the
 * security control, not a convenience:
 *
 *  - **`.strict()` at every level.** Unknown keys are rejected, never dropped.
 *    A dropped key would let a stored document *look* narrower than it is —
 *    `{limit: 10, sneaky: 'x'}` must fail, not quietly become `{limit: 10}`.
 *  - **A closed operator vocabulary.** The filter tree is a discriminated
 *    union over exactly D-72's eight ops. `op: 'regex'`, `op: '$where'` and
 *    friends are unknown discriminators, so no Mongo operator is ever
 *    reachable from input — the compiler emits `$`-prefixed operators itself
 *    and input never supplies one (DAT-10).
 *  - **`$` is inadmissible anywhere.** Field names, projection keys and every
 *    nested object key inside a value are checked: a `$`-prefixed key at any
 *    depth is a pending operator injection (`{value: {$gt: 18}}`) and is
 *    rejected before compilation.
 *  - **Bounded shape.** Depth, group arity and page size are capped so a
 *    hostile document can't turn compilation or execution into a DoS
 *    (`MAX_QUERY_LIMIT` is also the default page size — unbounded reads are
 *    the exact failure this phase exists to prevent).
 *
 * Validation is *structural only*: the schema never consults authorization
 * state. Auth injection happens later, at the compiler root (DAT-11, D-74).
 */

import { z } from 'zod';

import { MAX_QUERY_LIMIT, type FilterExpr, type JsonValue, type QueryDsl } from '@akane/contract';

/**
 * Deepest filter tree accepted, counting the leaf as depth 1 — so at most 11
 * `and`/`or` wrappers may sit above a leaf. Past this, compilation cost and
 * Mongo's own query-plan complexity grow without bound.
 */
export const MAX_FILTER_DEPTH = 12;

/** Most children one `and`/`or` group may carry (an OR fan-out is a scan cost). */
export const MAX_FILTER_GROUP_CHILDREN = 100;

/**
 * A field name: a dotted identifier. No leading dot, no `$`, no spaces, no
 * empty string — every shape the operator-injection tests care about is
 * excluded by construction rather than by a denylist.
 */
const fieldName = z
  .string()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_.]*$/,
    'must be a dotted identifier: [A-Za-z_][A-Za-z0-9_.]*',
  );

/** Finite numbers only — `NaN`/`Infinity` are not JSON and never reach Mongo. */
const finiteNumber = z.number().refine((n) => Number.isFinite(n), 'must be a finite number');

/** True when `v` is a JSON-representable value (no undefined/functions/symbols). */
function isJsonValue(v: unknown): v is JsonValue {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJsonValue);
  if (typeof v === 'object') return Object.values(v).every(isJsonValue);
  return false;
}

/** True when any object key at any depth (through arrays too) starts with `$`. */
function hasDollarPrefixedKey(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasDollarPrefixedKey);
  if (v !== null && typeof v === 'object') {
    return Object.entries(v).some(([k, child]) => k.startsWith('$') || hasDollarPrefixedKey(child));
  }
  return false;
}

/** A JSON value with no `$`-prefixed key anywhere inside it. */
const jsonValue = z.custom<JsonValue>(
  (v) => isJsonValue(v) && !hasDollarPrefixedKey(v),
  { message: 'must be a JSON value with no $-prefixed keys' },
);

/** Scalar operands for `in` — documents are inadmissible (Mongo `$in` semantics). */
const scalar = z.union([z.string(), finiteNumber, z.boolean(), z.null()]);

// ─── Filter tree ────────────────────────────────────────────────────────────
// Each member is `.strict()`; `field`/`value` carry their own guards. Group
// children go through `z.lazy` so the recursion resolves at parse time, after
// `filterExprSchema` exists.

const eqFilter = z
  .object({ op: z.literal('eq'), field: fieldName, value: jsonValue })
  .strict();

const neFilter = z
  .object({ op: z.literal('ne'), field: fieldName, value: jsonValue })
  .strict();

const inFilter = z
  .object({ op: z.literal('in'), field: fieldName, values: z.array(scalar).min(1) })
  .strict();

const gteFilter = z
  .object({ op: z.literal('gte'), field: fieldName, value: jsonValue })
  .strict();

const lteFilter = z
  .object({ op: z.literal('lte'), field: fieldName, value: jsonValue })
  .strict();

const containsFilter = z
  .object({ op: z.literal('contains'), field: fieldName, value: z.string() })
  .strict();

const childFilters = () =>
  z
    .array(filterExprSchema)
    .min(1, 'an and/or group must contain at least one child')
    .max(MAX_FILTER_GROUP_CHILDREN);

const andGroup = z
  .object({ op: z.literal('and'), filters: z.lazy(childFilters) })
  .strict();

const orGroup = z
  .object({ op: z.literal('or'), filters: z.lazy(childFilters) })
  .strict();

/** One node of the filter tree — the eight D-72 ops, discriminated on `op`. */
export const filterExprSchema: z.ZodType<FilterExpr> = z.lazy(() =>
  z.discriminatedUnion('op', [
    eqFilter,
    neFilter,
    inFilter,
    gteFilter,
    lteFilter,
    containsFilter,
    andGroup,
    orGroup,
  ]),
);

/** Tree depth counted from the leaf (leaf = 1). */
function filterDepth(node: FilterExpr): number {
  if (node.op === 'and' || node.op === 'or') {
    return 1 + Math.max(...node.filters.map(filterDepth));
  }
  return 1;
}

// ─── Top-level document ─────────────────────────────────────────────────────

const queryDslBase = z
  .object({
    filters: filterExprSchema.optional(),
    sort: z
      .array(z.object({ field: fieldName, dir: z.enum(['asc', 'desc']) }).strict())
      .optional(),
    limit: finiteNumber.int().min(1).max(MAX_QUERY_LIMIT).optional(),
    offset: finiteNumber.int().min(0).optional(),
    projection: z.record(fieldName, z.literal(1)).optional(),
  })
  .strict();

/**
 * The strict DSL schema. `superRefine` adds the depth cap, which needs the
 * fully-parsed tree; every other guard lives on the shape itself so failures
 * surface with the offending path.
 */
export const QueryDslSchema: z.ZodType<QueryDsl> = queryDslBase.superRefine((doc, ctx) => {
  if (doc.filters && filterDepth(doc.filters) > MAX_FILTER_DEPTH) {
    ctx.addIssue({
      code: 'custom',
      message: `filter tree exceeds the depth cap of ${MAX_FILTER_DEPTH}`,
      path: ['filters'],
    });
  }
});

/** Result of parsing untrusted JSON against the DSL schema. */
export type ParseQueryDslResult =
  | { ok: true; dsl: QueryDsl }
  | { ok: false; issues: string[] };

/**
 * Parse untrusted JSON into a {@link QueryDsl} AST, or report every issue.
 *
 * Returns *all* issues (not just the first) so a stored-query load failure can
 * say precisely which constructs are wrong — a stored DSL that drifts out of
 * contract must fail loudly at load, never be silently clamped.
 */
export function parseQueryDsl(json: unknown): ParseQueryDslResult {
  const result = QueryDslSchema.safeParse(json);
  if (result.success) return { ok: true, dsl: result.data };
  return {
    ok: false,
    issues: result.error.issues.map(
      (issue) => `${issue.path.length > 0 ? issue.path.join('.') : '<document>'}: ${issue.message}`,
    ),
  };
}
