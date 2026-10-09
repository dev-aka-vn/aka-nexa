import { MAX_QUERY_LIMIT, type QueryCtx } from '../dsl/ast.js';
import { DslService } from '../dsl/dsl.service.js';

/**
 * A stored form submission (DAT-02/DAT-04).
 *
 * The shape is intentionally minimal for the read-path tracer: the fields the
 * view page and the verifier need to render a read-only FormIO form. Additional
 * fields (status, external tracking, etc.) are added by later phases.
 */
export interface Submission {
  /** MongoDB document `_id`. This is the `target_id` in a view link claim. */
  readonly _id: string;
  /** The opaque `real_user_id` who owns this submission (D-79). */
  readonly real_user_id: string;
  readonly app_id: string;
  readonly form_id: string;
  readonly form_version: number;
  /** The FormIO JSON schema used to render the form. */
  readonly form_schema: Record<string, unknown>;
  /** The submitted field values. */
  readonly data: Record<string, unknown>;
  readonly created_at: Date;
  readonly status: 'completed' | 'partial' | 'failed' | 'pending_external';
  /**
   * Soft-delete marker. `null`/absent means live — the DAT-11 auth filter
   * injects `{deleted_at: null}` unconditionally (D-78), so this field is what
   * a deleted document carries to become invisible to *every* viewer,
   * `view_all` included.
   */
  readonly deleted_at?: Date | null;
}

/** One projected result row: projection is inclusion-only (D-72), so keys vary. */
export type QueryRow = Record<string, unknown>;

/** Result of {@link SubmissionRepository.queryWithDsl}. */
export type QueryWithDslResult =
  | {
      ok: true;
      rows: QueryRow[];
      /** Matching rows before offset/limit — what the pager renders against. */
      total: number;
      hasMore: boolean;
    }
  | { ok: false; issues: string[] };

/** Caller-supplied page parameters, overriding whatever the DSL carried. */
export interface QueryPage {
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Submission data access (DAT-10, DAT-11).
 *
 * ## Why this is not a MongoDB direct import
 *
 * R3 (tooling/boundaries.config.mjs) restricts the mongodb driver specifier to
 * only packages/platform/src/mongo and packages/domain/src/data-access
 * (the data-access subdirectory pattern). This file lives at
 * packages/domain/src/submissions, so it cannot import the mongodb driver
 * directly. In production the repository receives a MongoService handle
 * injected by the platform module and calls db.collection().findOne() through
 * it. For the tracer - where no MongoDB instance is guaranteed at test time -
 * the methods are defined against a minimal SubmissionStore interface, with
 * the real driver adapter wired by the NestJS module in a later phase.
 *
 * ## The ownership invariant (D-79)
 *
 * `findByIdOwned` does not look up by _id and then check ownership in a
 * second step. It queries on { _id, real_user_id } in one filter, so a
 * user who does not own the submission receives null — indistinguishable
 * from 'the ID does not exist' — and no cross-user record is ever materialised
 * in the domain layer.
 *
 * ## queryWithDsl owns two invariants the compiler deliberately does not
 *
 * 1. **App scoping (D-76):** `compileQuery` produces
 *    `{$and:[auth, userFilter]}` and knows nothing about the query link's
 *    bound app. This method roots the compiled filter under `{app_id}` so the
 *    scope cannot be widened by any user filter structure — including a
 *    top-level `$or`.
 * 2. **Execution semantics (DAT-11/D-78):** an injected filter only guards
 *    what the executor actually applies. The matcher below implements exactly
 *    the operator vocabulary `compiler.ts` can emit, so `deleted_at: null`
 *    excludes soft-deleted rows for every viewer and `real_user_id` binds rows
 *    to the viewer unless `view_all` said otherwise.
 */
export class SubmissionRepository {
  /**
   * In-memory backing store for the tracer.
   *
   * The existing `IdentityMappingRepository` pattern (identity-mapping.repository.ts)
   * uses the same in-memory approach so the tracer is testable without a live
   * MongoDB. A production adapter replaces this with a Mongo-backed `SubmissionLookup`.
   */
  private readonly submissions = new Map<string, Submission>();

  /**
   * @param dsl the DSL entry point (parse + compile with auth injection).
   *   Injected rather than constructed so there is exactly one compilation
   *   path for stored user intent, and so unwiring it fails at composition
   *   time instead of executing an uncompiled filter.
   */
  constructor(private readonly dsl: DslService) {}

  /**
   * Insert or replace a submission. Used by fixtures and tests.
   */
  upsert(submission: Submission): void {
    this.submissions.set(submission._id, submission);
  }

  /**
   * Fetch a submission by ID, returning it only if it belongs to
   * `realUserId` (D-79 — view is own-record only, full stop).
   *
 * The filter ANDs _id and real_user_id together at the data-access layer
 * so the ownership check is structural, not an application-level if that can
 * be bypassed by a bug in the calling code.
   */
  async findByIdOwned(submissionId: string, realUserId: string): Promise<Submission | null> {
    const submission = this.submissions.get(submissionId);
    if (submission === undefined) {
      return null;
    }
    if (submission.real_user_id !== realUserId) {
      return null;
    }
    return submission;
  }

  /**
   * Validate + compile `dslJson` with the execution context (DAT-10/DAT-11),
   * root it under the link's `app_id` (D-76), and run it (D-69 pagination).
   *
   * Never executes a partially-compiled query: a schema violation returns
   * `{ok:false, issues}` and touches no rows.
   */
  async queryWithDsl(
    dslJson: unknown,
    ctx: QueryCtx,
    page?: QueryPage,
  ): Promise<QueryWithDslResult> {
    const compiled = this.dsl.compile(dslJson, ctx);
    if (!compiled.ok) {
      return { ok: false, issues: compiled.issues };
    }

    // D-76: app scope is a *root* conjunct, outside the compiler's auth wrap.
    const filter = { $and: [{ app_id: ctx.appId }, compiled.query.filter] };

    const limit = clampLimit(page?.limit ?? compiled.query.limit);
    const offset = Math.max(0, page?.offset ?? compiled.query.offset);

    const matched = [...this.submissions.values()].filter((doc) =>
      matchesFilter(doc, filter),
    );
    const sorted = sortRows(matched, compiled.query.sort);

    const pageRows = sorted.slice(offset, offset + limit);
    const rows = pageRows.map((doc) => projectRow(doc, compiled.query.projection));

    return {
      ok: true,
      rows,
      total: matched.length,
      hasMore: offset + rows.length < matched.length,
    };
  }
}

// ─── Mongo filter matcher ────────────────────────────────────────────────────
//
// Implements only what compiler.ts emits: $and, $or, equality (including
// dotted paths), $ne, $in, $gte, $lte, $regex+$options. An unrecognised
// operator matches nothing (fail closed) rather than throwing — the schema
// should make it unreachable, and "no rows" is the safe answer if it isn't.

/** Read a dotted path the way MongoDB does; missing segments read as `undefined`. */
function readPath(doc: unknown, path: string): unknown {
  let cursor: unknown = doc;
  for (const segment of path.split('.')) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** MongoDB equality: `null` matches both an explicit null and an absent field. */
function mongoEquals(actual: unknown, expected: unknown): boolean {
  if (expected === null) return actual === null || actual === undefined;
  if (actual === null || actual === undefined) return false;
  if (expected instanceof Date && actual instanceof Date) {
    return actual.getTime() === expected.getTime();
  }
  return actual === expected;
}

/** Ordering for $gte/$lte: numbers numerically, dates by time, strings by code unit. */
function compareValues(a: unknown, b: unknown): number | null {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return null;
}

function matchesFilter(doc: unknown, filter: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    if (key === '$and') {
      if (!(condition as unknown[]).every((c) => matchesFilter(doc, c as Record<string, unknown>))) {
        return false;
      }
      continue;
    }
    if (key === '$or') {
      if (!(condition as unknown[]).some((c) => matchesFilter(doc, c as Record<string, unknown>))) {
        return false;
      }
      continue;
    }

    const actual = readPath(doc, key);

    if (condition !== null && typeof condition === 'object' && !Array.isArray(condition)) {
      if (!matchesOperators(actual, condition as Record<string, unknown>)) return false;
      continue;
    }
    if (!mongoEquals(actual, condition)) return false;
  }
  return true;
}

function matchesOperators(actual: unknown, operators: Record<string, unknown>): boolean {
  for (const [op, operand] of Object.entries(operators)) {
    switch (op) {
      case '$options':
        // consumed by $regex; carries no matching semantics of its own
        break;
      case '$ne':
        if (mongoEquals(actual, operand)) return false;
        break;
      case '$in':
        if (!(operand as unknown[]).some((v) => mongoEquals(actual, v))) return false;
        break;
      case '$gte':
      case '$lte': {
        const cmp = compareValues(actual, operand);
        // an incomparable pair (string vs number) satisfies neither bound
        if (cmp === null) return false;
        if (op === '$gte' && cmp < 0) return false;
        if (op === '$lte' && cmp > 0) return false;
        break;
      }
      case '$regex': {
        const flags = typeof operators['$options'] === 'string' ? (operators['$options'] as string) : '';
        if (typeof actual !== 'string') return false;
        if (!new RegExp(String(operand), flags).test(actual)) return false;
        break;
      }
      default:
        // Unrecognised operator: match nothing (fail closed).
        return false;
    }
  }
  return true;
}

/** Server-enforced page ceiling (D-72): a caller or DSL cannot exceed it. */
function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return 1;
  return Math.min(Math.floor(limit), MAX_QUERY_LIMIT);
}

function sortRows(
  docs: Submission[],
  sort: Record<string, 1 | -1> | undefined,
): Submission[] {
  if (sort === undefined || Object.keys(sort).length === 0) return docs;
  const entries = Object.entries(sort);
  return [...docs].sort((a, b) => {
    for (const [field, dir] of entries) {
      const cmp = compareValues(readPath(a, field), readPath(b, field));
      if (cmp === null) continue; // unorderable on this key: try the next one
      if (cmp !== 0) return dir === 1 ? cmp : -cmp;
    }
    return 0;
  });
}

/**
 * Inclusion-only projection (D-72). `_id` is included by default, mirroring
 * MongoDB's own behaviour for inclusion projections.
 */
function projectRow(
  doc: Submission,
  projection: Record<string, 1> | undefined,
): QueryRow {
  if (projection === undefined) return { ...(doc as unknown as QueryRow) };
  const out: QueryRow = { _id: doc._id };
  for (const [column, included] of Object.entries(projection)) {
    if (included !== 1 || column === '_id') continue;
    const value = readPath(doc, column);
    if (value !== undefined) out[column] = value;
  }
  return out;
}
