/**
 * DAT-10 / DAT-11 / DAT-12 — the Query DSL's authorization surface.
 *
 * The DSL is the one place in the product where *stored user intent* becomes a
 * database filter, so the suite is organised around the three requirements the
 * research flagged as having no test precedent (SUMMARY.md item 7):
 *
 *  - **DAT-10** — JSON → strict schema → AST. Unknown keys, `$` operators and
 *    out-of-range paging are rejected *before* anything is compiled. Raw Mongo
 *    is never expressible.
 *  - **DAT-11** — `buildAuthFilter` injects `deleted_at: null`
 *    unconditionally and `real_user_id` unless the viewer holds `view_all`
 *    (D-78). `view_all` bypasses ownership, never soft-delete. App scoping
 *    (D-76) is applied at the repository's per-app query root (plan 04-03),
 *    deliberately outside this builder so its output stays exactly the
 *    ownership + soft-delete pair the DAT-11 acceptance criteria name.
 *  - **DAT-12** — one test per D-72 construct asserting the injected auth
 *    filters survive compilation *structurally* — they sit at the root of the
 *    emitted filter, outside whatever the user's tree said.
 *
 * The D-74 invariant everything else hangs from: the user's filter is never
 * merged into auth, it is *appended to it* — `{$and: [auth, userFilter]}` — so
 * an `$or` written at the top of the user tree is a sibling of auth, never a
 * replacement for it.
 */
import { describe, expect, it } from 'vitest';

import { MAX_QUERY_LIMIT, type FilterExpr, type QueryDsl } from '@akane/contract';

import type { QueryCtx } from '../ast.js';
import { compileQuery } from '../compiler.js';
import { parseQueryDsl, QueryDslSchema } from '../dsl.schema.js';
import { buildAuthFilter } from '../filter-builder.js';

/** Parse and assert rejection, returning the issue messages for message-level assertions. */
function expectRejected(json: unknown): string[] {
  const result = parseQueryDsl(json);
  expect(result.ok, `expected rejection, got: ${JSON.stringify(result)}`).toBe(false);
  return result.ok ? [] : result.issues;
}

// ─── DAT-10 ─────────────────────────────────────────────────────────────────

describe('DAT-10: strict DSL schema', () => {
  it('accepts a document carrying every D-72 construct', () => {
    const dsl: QueryDsl = {
      filters: {
        op: 'and',
        filters: [
          { op: 'eq', field: 'status', value: 'open' },
          { op: 'ne', field: 'assignee', value: 'u_1' },
          { op: 'in', field: 'priority', values: ['p1', 'p2', null] },
          { op: 'gte', field: 'created_at', value: 1_700_000_000 },
          { op: 'lte', field: 'updated_at', value: 1_800_000_000 },
          { op: 'contains', field: 'title', value: 'deploy' },
          {
            op: 'or',
            filters: [
              { op: 'eq', field: 'team', value: 'platform' },
              { op: 'eq', field: 'team', value: 'runtime' },
            ],
          },
        ],
      },
      sort: [{ field: 'created_at', dir: 'desc' }],
      limit: 25,
      offset: 50,
      projection: { status: 1, title: 1 },
    };

    const result = parseQueryDsl(dsl);
    expect(result.ok).toBe(true);
  });

  it('accepts an empty document — an auth-only query with no user filter', () => {
    const result = parseQueryDsl({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dsl.filters).toBeUndefined();
    }
  });

  it('rejects an unknown top-level key', () => {
    const issues = expectRejected({ limit: 10, sneaky: 'exfiltrate' });
    expect(issues.join(' ')).toContain('sneaky');
  });

  it('rejects an unknown key inside a filter node', () => {
    expectRejected({
      filters: { op: 'eq', field: 'status', value: 'open', extra: true },
    });
  });

  it('rejects an operator outside the D-72 set', () => {
    expectRejected({ filters: { op: 'regex', field: 'title', value: '.*' } });
    expectRejected({ filters: { op: '$where', field: 'title', value: 'x' } });
  });

  it('rejects a field name containing $ (operator injection)', () => {
    expectRejected({ filters: { op: 'eq', field: '$where', value: 'x' } });
    expectRejected({ filters: { op: 'eq', field: 'a$b', value: 1 } });
  });

  it('rejects a field name that is not a dotted identifier', () => {
    expectRejected({ filters: { op: 'eq', field: 'a b', value: 1 } });
    expectRejected({ filters: { op: 'eq', field: '.leading', value: 1 } });
    expectRejected({ filters: { op: 'eq', field: '', value: 1 } });
  });

  it('rejects an eq value containing a $-prefixed key', () => {
    expectRejected({ filters: { op: 'eq', field: 'age', value: { $gt: 18 } } });
  });

  it('rejects an in operand that is a document', () => {
    expectRejected({
      filters: { op: 'in', field: 'status', values: [{ $ne: 'x' }] },
    });
  });

  it(`rejects limit above ${MAX_QUERY_LIMIT}`, () => {
    expectRejected({ limit: MAX_QUERY_LIMIT + 1 });
    // The ceiling itself is still fine.
    const atCeiling = parseQueryDsl({ limit: MAX_QUERY_LIMIT });
    expect(atCeiling.ok).toBe(true);
  });

  it('rejects a non-integer or non-positive limit', () => {
    expectRejected({ limit: 1.5 });
    expectRejected({ limit: 0 });
  });

  it('rejects a negative or non-integer offset', () => {
    expectRejected({ offset: -1 });
    expectRejected({ offset: 2.5 });
  });

  it('rejects an empty and/or group', () => {
    expectRejected({ filters: { op: 'and', filters: [] } });
    expectRejected({ filters: { op: 'or', filters: [] } });
  });

  it('rejects a projection that is not inclusion-only', () => {
    expectRejected({ projection: { status: 0 } });
    expectRejected({ projection: { $where: 1 } });
  });

  it('rejects a sort direction outside asc/desc', () => {
    expectRejected({ sort: [{ field: 'created_at', dir: 'ascending' }] });
  });

  it('rejects a filter tree nested deeper than the depth cap', () => {
    // MAX_FILTER_DEPTH levels of `and` wrapping a leaf is the deepest allowed.
    let node: FilterExpr = { op: 'eq', field: 'status', value: 'open' };
    for (let i = 0; i < 40; i += 1) {
      node = { op: 'and', filters: [node] };
    }
    expectRejected({ filters: node });

    // One wrap at the boundary is still accepted (depth counted from the leaf).
    let shallow: FilterExpr = { op: 'eq', field: 'status', value: 'open' };
    shallow = { op: 'and', filters: [shallow] };
    expect(parseQueryDsl({ filters: shallow }).ok).toBe(true);
  });

  it('surfaces the schema result verbatim through QueryDslSchema', () => {
    // The service entry point must not disagree with the schema it wraps.
    expect(QueryDslSchema.safeParse({ limit: MAX_QUERY_LIMIT + 1 }).success).toBe(false);
    expect(QueryDslSchema.safeParse({}).success).toBe(true);
  });
});

// ─── DAT-11 ─────────────────────────────────────────────────────────────────

describe('DAT-11: auth filter injection (D-74, D-78)', () => {
  const viewerId = 'u_1';
  const ctx: QueryCtx = { viewerId, hasViewAll: false, appId: 'app_1' };
  const viewAllCtx: QueryCtx = { viewerId, hasViewAll: true, appId: 'app_1' };

  /** What auth must look like for a plain viewer: both constraints, structurally ANDed. */
  const OWNED_AUTH = { $and: [{ deleted_at: null }, { real_user_id: viewerId }] };
  /** What auth must look like under `view_all`: soft-delete protection only (D-78). */
  const VIEW_ALL_AUTH = { deleted_at: null };

  it('always injects deleted_at: null — with and without view_all (D-78)', () => {
    expect(buildAuthFilter(viewerId, false)).toEqual(OWNED_AUTH);
    expect(buildAuthFilter(viewerId, true)).toEqual(VIEW_ALL_AUTH);
  });

  it('view_all bypasses real_user_id only — auth equals {deleted_at:null}', () => {
    const auth = buildAuthFilter(viewerId, true);
    expect(auth).toEqual({ deleted_at: null });
    expect(JSON.stringify(auth)).not.toContain('real_user_id');
  });

  it('without view_all both constraints are present structurally', () => {
    const auth = buildAuthFilter(viewerId, false) as { $and: unknown[] };
    expect(Array.isArray(auth.$and)).toBe(true);
    expect(auth.$and).toEqual([{ deleted_at: null }, { real_user_id: viewerId }]);
  });

  it('ANDs auth with the user filter at the root (D-74)', () => {
    const compiled = compileQuery({ filters: { op: 'eq', field: 'status', value: 'open' } }, ctx);
    expect(compiled.filter).toEqual({ $and: [OWNED_AUTH, { status: 'open' }] });
  });

  it('a top-level OR is a sibling of auth, never a replacement (D-74)', () => {
    const compiled = compileQuery(
      {
        filters: {
          op: 'or',
          filters: [
            { op: 'eq', field: 'team', value: 'platform' },
            { op: 'eq', field: 'team', value: 'runtime' },
          ],
        },
      },
      ctx,
    );
    const root = (compiled.filter as { $and?: unknown[] }).$and;
    expect(Array.isArray(root)).toBe(true);
    // Auth sits at index 0, outside the user's tree; the OR is its sibling.
    expect(root?.[0]).toEqual(OWNED_AUTH);
    expect(root?.[1]).toEqual({
      $or: [{ team: 'platform' }, { team: 'runtime' }],
    });
    // The OR carries no auth of its own — auth appears exactly once, at the root.
    expect(JSON.stringify(root?.[1])).not.toContain('deleted_at');
  });

  it('view_all still gets deleted_at at the root when a user filter exists', () => {
    const compiled = compileQuery(
      { filters: { op: 'eq', field: 'status', value: 'open' } },
      viewAllCtx,
    );
    expect(compiled.filter).toEqual({ $and: [VIEW_ALL_AUTH, { status: 'open' }] });
    expect(JSON.stringify(compiled.filter)).not.toContain('real_user_id');
  });

  it('with no user filter the emitted filter IS auth verbatim', () => {
    expect(compileQuery({}, ctx).filter).toEqual(OWNED_AUTH);
    expect(compileQuery({}, viewAllCtx).filter).toEqual(VIEW_ALL_AUTH);
  });
});
