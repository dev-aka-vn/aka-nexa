/**
 * DAT-11 / D-74 / D-76 / D-78 — `SubmissionRepository.queryWithDsl`.
 *
 * The repository is where the compiled query becomes rows, and where two
 * invariants that the compiler deliberately does *not* own are enforced:
 *
 *  - **app scoping (D-76)**: `compileQuery` wraps `{ $and: [auth, user] }` and
 *    knows nothing about the query link's bound app; the repository roots the
 *    whole thing under `{ app_id }` so no user filter can widen past one app.
 *  - **execution semantics**: auth injection only matters if the executor
 *    honours it — `deleted_at: null` must exclude soft-deleted documents even
 *    for a `view_all` viewer (D-78), and `real_user_id` must bind the rows to
 *    the viewer when `view_all` is absent (DAT-11).
 *
 * The store is in-memory, like the rest of the tracer: R3 restricts the
 * mongodb driver to `platform/mongo` and the domain `data-access` directory, so
 * the real driver adapter lands there in a later plan. The filter matcher below
 * implements exactly the operator vocabulary `compiler.ts` emits — nothing
 * parsed from input can introduce an operator this file has not seen.
 */

import { describe, expect, it } from 'vitest';

import { DslService } from '../dsl/dsl.service.js';
import { SubmissionRepository, type Submission } from './submission.repository.js';

const dsl = new DslService();

function doc(overrides: Partial<Submission> = {}): Submission {
  return {
    _id: 'sub_1',
    real_user_id: 'u_1',
    app_id: 'leave-request',
    form_id: 'leave-form',
    form_version: 1,
    form_schema: {},
    data: {},
    created_at: new Date('2026-01-01T00:00:00Z'),
    status: 'completed',
    ...overrides,
  };
}

function makeRepo(docs: Submission[]): SubmissionRepository {
  const repo = new SubmissionRepository(new DslService());
  for (const d of docs) repo.upsert(d);
  return repo;
}

const ownCtx = { viewerId: 'u_1', hasViewAll: false, appId: 'leave-request' };
const viewAllCtx = { viewerId: 'u_1', hasViewAll: true, appId: 'leave-request' };

const baseDocs: Submission[] = [
  doc({ _id: 'a1', data: { status: 'pending' }, created_at: new Date('2026-03-01') }),
  doc({ _id: 'a2', data: { status: 'pending' }, created_at: new Date('2026-02-01') }),
  doc({ _id: 'a3', data: { status: 'approved' }, created_at: new Date('2026-01-01') }),
  doc({ _id: 'other-user', real_user_id: 'u_2', created_at: new Date('2026-04-01') }),
  doc({ _id: 'deleted', deleted_at: new Date('2026-05-01') }),
  doc({ _id: 'other-app', app_id: 'expense-claim' }),
];

describe('SubmissionRepository.queryWithDsl (DAT-11, D-74, D-76, D-78)', () => {
  it('binds rows to the viewer when hasViewAll is false (DAT-11)', async () => {
    const repo = makeRepo(baseDocs);
    const result = await repo.queryWithDsl({}, ownCtx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // own, non-deleted, leave-request rows only — no u_2, no soft-delete
      expect(result.rows.map((r) => r['_id']).sort()).toEqual(['a1', 'a2', 'a3']);
      expect(result.total).toBe(3);
    }
  });

  it('lets view_all see other users rows but never soft-deleted ones (DAT-11, D-78)', async () => {
    const repo = makeRepo(baseDocs);
    const result = await repo.queryWithDsl({}, viewAllCtx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows.map((r) => r['_id']).sort()).toEqual([
        'a1',
        'a2',
        'a3',
        'other-user',
      ]);
      // deleted_at is injected unconditionally: the deleted doc is absent
      expect(result.rows.map((r) => r['_id'])).not.toContain('deleted');
    }
  });

  it('scopes the query to the link bound app_id at the root (D-76), even under a user $or', async () => {
    const repo = makeRepo(baseDocs);
    // an $or that would match other-app rows if app scoping were not rooted
    const result = await repo.queryWithDsl(
      {
        filters: {
          op: 'or',
          filters: [
            { op: 'eq', field: 'app_id', value: 'expense-claim' },
            { op: 'eq', field: 'app_id', value: 'leave-request' },
          ],
        },
      },
      viewAllCtx,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows.map((r) => r['_id'])).not.toContain('other-app');
      expect(result.rows.every((r) => r['app_id'] === 'leave-request')).toBe(true);
    }
  });

  it('applies sort, offset, limit and projection from the DSL (D-69/D-72)', async () => {
    const repo = makeRepo(baseDocs);
    const result = await repo.queryWithDsl(
      {
        sort: [{ field: 'created_at', dir: 'desc' }],
        offset: 1,
        limit: 2,
        projection: { _id: 1, status: 1 },
      },
      ownCtx,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // sorted desc: a1 (Mar), a2 (Feb), a3 (Jan); skip the first, take two
      expect(result.rows.map((r) => r['_id'])).toEqual(['a2', 'a3']);
      expect(result.hasMore).toBe(false);
      expect(result.rows[0]).toEqual({ _id: 'a2', status: 'completed' });
    }
  });

  it('honours a page override and reports hasMore against the total', async () => {
    const repo = makeRepo(baseDocs);
    const result = await repo.queryWithDsl({}, ownCtx, { limit: 2, offset: 0 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toHaveLength(2);
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(true);
    }
  });

  it('executes a contains filter end-to-end as a case-insensitive literal match', async () => {
    const repo = makeRepo([
      doc({ _id: 'c1', data: { note: 'Family Vacation planned' } }),
      doc({ _id: 'c2', data: { note: 'nothing here' } }),
    ]);
    const result = await repo.queryWithDsl(
      { filters: { op: 'contains', field: 'data.note', value: 'vacation' } },
      ownCtx,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows.map((r) => r['_id'])).toEqual(['c1']);
    }
  });

  it('fails closed on a DSL that violates the schema, never running a partial query', async () => {
    const repo = makeRepo(baseDocs);
    const result = await repo.queryWithDsl(
      { filters: { op: 'drop_table', field: 'status', value: 'x' } },
      ownCtx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it('compiles through DslService so auth injection is never bypassable (DAT-10/11)', async () => {
    const repo = makeRepo(baseDocs);
    // u_2 viewing their own row: without injection this returns a row the
    // viewer does not own; with it the row is invisible.
    const result = await repo.queryWithDsl(
      {},
      { viewerId: 'u_2', hasViewAll: false, appId: 'leave-request' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows.map((r) => r['_id'])).toEqual(['other-user']);
    }
  });
});
