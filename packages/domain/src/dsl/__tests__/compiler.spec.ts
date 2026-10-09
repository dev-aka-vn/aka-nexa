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
import { DslService } from '../dsl.service.js';
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

// ─── DAT-12 ─────────────────────────────────────────────────────────────────

describe('DAT-12: per-construct auth survival through the service (D-72, D-74)', () => {
  const service = new DslService();
  const ctx: QueryCtx = { viewerId: 'u_1', hasViewAll: false, appId: 'app_1' };
  const viewAllCtx: QueryCtx = { viewerId: 'u_1', hasViewAll: true, appId: 'app_1' };
  const OWNED_AUTH = { $and: [{ deleted_at: null }, { real_user_id: 'u_1' }] };

  /**
   * One row per D-72 construct: the user's tree in, the exact Mongo fragment
   * it must compile to. Every assertion then proves the *same* thing about
   * auth: it sits at index 0 of the root `$and`, structurally outside this
   * fragment, no matter which construct the fragment used.
   */
  const CONSTRUCTS: Array<{
    name: string;
    filters: FilterExpr;
    user: Record<string, unknown>;
  }> = [
    {
      name: 'eq',
      filters: { op: 'eq', field: 'status', value: 'open' },
      user: { status: 'open' },
    },
    {
      name: 'ne',
      filters: { op: 'ne', field: 'assignee', value: 'u_2' },
      user: { assignee: { $ne: 'u_2' } },
    },
    {
      name: 'in',
      filters: { op: 'in', field: 'priority', values: ['p1', 'p2', null] },
      user: { priority: { $in: ['p1', 'p2', null] } },
    },
    {
      name: 'gte',
      filters: { op: 'gte', field: 'created_at', value: 1_700_000_000 },
      user: { created_at: { $gte: 1_700_000_000 } },
    },
    {
      name: 'lte',
      filters: { op: 'lte', field: 'updated_at', value: 1_800_000_000 },
      user: { updated_at: { $lte: 1_800_000_000 } },
    },
    {
      name: 'contains',
      filters: { op: 'contains', field: 'title', value: 'deploy' },
      user: { title: { $regex: 'deploy', $options: 'i' } },
    },
    {
      name: 'AND group',
      filters: {
        op: 'and',
        filters: [
          { op: 'eq', field: 'team', value: 'platform' },
          { op: 'eq', field: 'status', value: 'open' },
        ],
      },
      user: { $and: [{ team: 'platform' }, { status: 'open' }] },
    },
    {
      name: 'OR group',
      filters: {
        op: 'or',
        filters: [
          { op: 'eq', field: 'team', value: 'platform' },
          { op: 'eq', field: 'team', value: 'runtime' },
        ],
      },
      user: { $or: [{ team: 'platform' }, { team: 'runtime' }] },
    },
  ];

  for (const { name, filters, user } of CONSTRUCTS) {
    it(`${name}: auth survives at the root, outside the user's ${name} fragment`, () => {
      const result = service.compile({ filters }, ctx);
      expect(result.ok, result.ok ? '' : result.issues.join('; ')).toBe(true);
      if (!result.ok) return;

      const root = result.query.filter as { $and?: unknown[] };
      expect(root.$and?.[0]).toEqual(OWNED_AUTH);
      expect(root.$and?.[1]).toEqual(user);
      // Auth appears exactly once — the user's fragment carries none of it,
      // so no construct inside that fragment can have rewritten it.
      expect(JSON.stringify(root.$and?.[1])).not.toContain('deleted_at');
      expect(JSON.stringify(root.$and?.[1])).not.toContain('real_user_id');
    });
  }

  it('sort, limit and offset survive compilation alongside auth', () => {
    const result = service.compile(
      { sort: [{ field: 'created_at', dir: 'desc' }], limit: 25, offset: 50 },
      ctx,
    );
    expect(result.ok, result.ok ? '' : result.issues.join('; ')).toBe(true);
    if (!result.ok) return;
    expect(result.query.sort).toEqual({ created_at: -1 });
    expect(result.query.limit).toBe(25);
    expect(result.query.offset).toBe(50);
    // No user filter here, so the emitted filter IS auth verbatim.
    expect(result.query.filter).toEqual(OWNED_AUTH);
  });

  it('projection survives compilation; the emitted filter is still auth-wrapped', () => {
    const result = service.compile({ projection: { status: 1, title: 1 } }, ctx);
    expect(result.ok, result.ok ? '' : result.issues.join('; ')).toBe(true);
    if (!result.ok) return;
    expect(result.query.projection).toEqual({ status: 1, title: 1 });
    expect(result.query.filter).toEqual(OWNED_AUTH);
  });

  it('view_all: deleted_at survives at the root, real_user_id absent (D-78)', () => {
    const result = service.compile(
      {
        filters: {
          op: 'or',
          filters: [
            { op: 'eq', field: 'team', value: 'platform' },
            { op: 'eq', field: 'team', value: 'runtime' },
          ],
        },
      },
      viewAllCtx,
    );
    expect(result.ok, result.ok ? '' : result.issues.join('; ')).toBe(true);
    if (!result.ok) return;

    const root = result.query.filter as { $and?: unknown[] };
    expect(root.$and?.[0]).toEqual({ deleted_at: null });
    expect(JSON.stringify(result.query.filter)).not.toContain('real_user_id');
  });

  it('unknown keys are rejected before compilation', () => {
    const result = service.compile({ limit: 10, sneaky: 'exfiltrate' }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(' ')).toContain('sneaky');
  });

  it(`limit above ${MAX_QUERY_LIMIT} is rejected`, () => {
    const result = service.compile({ limit: MAX_QUERY_LIMIT + 1 }, ctx);
    expect(result.ok).toBe(false);
  });
});
