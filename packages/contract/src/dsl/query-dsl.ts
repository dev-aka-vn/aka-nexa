/**
 * The Query DSL **wire contract** — types only (DAT-10, D-72, D-73).
 *
 * A saved query is stored as JSON (`{query_id, query_version, dsl, intents,
 * app_id}` — D-73) and later authored by the App Builder (Phase 6). Both the
 * seed file and the builder therefore need the DSL's shape to be importable
 * **without** pulling in a Zod schema or the compiler, which is why the types
 * live here and the strict schema lives in `domain/src/dsl/dsl.schema.ts`.
 *
 * ## Why the types are here and not in `domain/`
 *
 * The boundary graph gives `contract` exactly one edge — `contract → kernel`
 * (`tooling/boundaries.config.mjs` ALLOWED_EDGES). Contract *cannot* import
 * domain, so a type both sides share has to originate in contract; domain
 * imports contract freely. `domain/src/dsl/ast.ts` re-exports these as the AST
 * types because a validated DSL document *is* the AST — one definition, two
 * names, no drift.
 *
 * ## Why there is no `$` anywhere in this vocabulary
 *
 * The DSL is an authorization surface (DAT-10). Every operator the compiler can
 * emit is fixed by the `op` discriminant below; MongoDB syntax is not reachable
 * from input. A field name, a value or a projection key carrying `$` is a
 * pending operator-injection and is rejected by the schema, not compiled.
 *
 * Constructs are exactly D-72's set. Aggregations are explicitly deferred
 * (04-CONTEXT.md §"Query DSL scope & authoring").
 */

/** The DSL's stored contract version, bumped only by a breaking construct change. */
export const QUERY_DSL_CONTRACT_VERSION = '1.0';

/**
 * Server-enforced page ceiling (D-72 offset/limit). A DSL asking for more is
 * rejected rather than silently clamped, so a stored query that drifts past the
 * ceiling fails loudly at load instead of returning a surprise page size.
 */
export const MAX_QUERY_LIMIT = 100;

/**
 * Page size used when a DSL omits `limit`.
 *
 * Deliberately equal to {@link MAX_QUERY_LIMIT}: an omitted limit means
 * "the largest page the server offers", never "unbounded". Unbounded reads are
 * the DoS shape this phase's compiler exists to prevent.
 */
export const DEFAULT_QUERY_LIMIT = 100;

/**
 * The eight D-72 operators. `and` / `or` are the group forms; the other six
 * are leaf comparisons.
 */
export const DSL_OPERATORS = [
  'eq',
  'ne',
  'in',
  'gte',
  'lte',
  'contains',
  'and',
  'or',
] as const;

export type DslOperator = (typeof DSL_OPERATORS)[number];

/**
 * A JSON scalar, array or object — the only values a DSL may carry.
 *
 * `number` includes `NaN` / `Infinity` in TypeScript's type but not in JSON, so
 * anything parsed from a stored query or a request body is finite by
 * construction. The schema narrows further: no `$`-prefixed key may appear at
 * any depth (see `dsl.schema.ts`).
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Scalar operands for `in` — Mongo's `$in` accepts scalars and arrays, never documents. */
export type DslScalar = string | number | boolean | null;

/** Leaf: `field` equals `value`. */
export interface DslEqFilter {
  op: 'eq';
  field: string;
  value: JsonValue;
}

/** Leaf: `field` differs from `value`. */
export interface DslNeFilter {
  op: 'ne';
  field: string;
  value: JsonValue;
}

/** Leaf: `field` is one of `values`. */
export interface DslInFilter {
  op: 'in';
  field: string;
  values: DslScalar[];
}

/** Leaf: `field` ≥ `value`. */
export interface DslGteFilter {
  op: 'gte';
  field: string;
  value: JsonValue;
}

/** Leaf: `field` ≤ `value`. */
export interface DslLteFilter {
  op: 'lte';
  field: string;
  value: JsonValue;
}

/**
 * Leaf: `field` contains `value` as a case-insensitive substring.
 *
 * `value` is a plain string, never a pattern — the compiler escapes every
 * regex metacharacter before emitting `$regex`, so this construct cannot be
 * used to inject a pattern (DAT-10).
 */
export interface DslContainsFilter {
  op: 'contains';
  field: string;
  value: string;
}

/** Group: every child matches. */
export interface DslAndGroup {
  op: 'and';
  filters: FilterExpr[];
}

/** Group: at least one child matches. */
export interface DslOrGroup {
  op: 'or';
  filters: FilterExpr[];
}

/** One node of the DSL filter tree — a discriminated union on `op` (D-72). */
export type FilterExpr =
  | DslEqFilter
  | DslNeFilter
  | DslInFilter
  | DslGteFilter
  | DslLteFilter
  | DslContainsFilter
  | DslAndGroup
  | DslOrGroup;

/** Sort direction. `asc` → Mongo `1`, `desc` → Mongo `-1`. */
export type SortDirection = 'asc' | 'desc';

/** One sort key. */
export interface SortSpec {
  field: string;
  dir: SortDirection;
}

/**
 * Column projection — inclusion only. A literal `1` per included column; there
 * is no exclusion form, so a projection can never be used to *remove* a field
 * the viewer's filters already decided they may see.
 */
export type Projection = { [column: string]: 1 };

/** A parsed, schema-valid Query DSL document. */
export interface QueryDsl {
  filters?: FilterExpr;
  sort?: SortSpec[];
  limit?: number;
  offset?: number;
  projection?: Projection;
}
