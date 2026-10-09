/**
 * Integration tests for DSL + query execution (DAT-11, D-74, D-76).
 *
 * Validates auth injection in the execution path end-to-end:
 * - view_all skips real_user_id, but always enforces deleted_at:null
 * - regular user sees only own records
 * - pagination/limit/sort/projection respected
 */

import { describe, expect, it } from 'vitest';

import type { Submission } from '../../submissions/submission.repository.js';
import { SubmissionRepository } from '../../submissions/submission.repository.js';
import { DslService } from '../dsl.service.js';

function makeRepo(docs: Submission[]): SubmissionRepository {
  const repo = new SubmissionRepository(new DslService());
  for (const d of docs) repo.upsert(d);
  return repo;
}

function doc(partial: Partial<Submission> & { _id: string }): Submission {
  const base: Submission = {
    _id: partial._id,
    real_user_id: partial.real_user_id ?? 'u_1',
    app_id: partial.app_id ?? 'leave-request',
    form_id: 'f1',
    form_version: 1,
    form_schema: { components: [] },
    data: partial.data ?? { status: 'open' },
    created_at: partial.created_at ?? new Date('2025-01-01T00:00:00Z'),
    status: partial.status ?? 'completed',
  };
  return { ...base, ...partial };
}

describe('DSL + query execution integration', () => {
  const ownCtx = { viewerId: 'u_1', hasViewAll: false, appId: 'leave-request' } as const;
  const viewAllCtx = { viewerId: 'u_1', hasViewAll: true, appId: 'leave-request' } as const;

  const baseDocs: Submission[] = [
    doc({ _id: 'a1', real_user_id: 'u_1', created_at: new Date('2025-03-01T00:00:00Z') }),
    doc({ _id: 'a2', real_user_id: 'u_1', created_at: new Date('2025-02-01T00:00:00Z') }),
    doc({ _id: 'a3', real_user_id: 'u_1', created_at: new Date('2025-01-01T00:00:00Z') }),
    doc({ _id: 'other-user', real_user_id: 'u_2', created_at: new Date('2025-01-01T00:00:00Z') }),
    doc({
      _id: 'deleted',
      real_user_id: 'u_1',
      deleted_at: new Date('2025-01-01T00:00:00Z'),
    }),
    doc({
      _id: 'other-app',
      real_user_id: 'u_1',
      app_id: 'expense-claim',
    }),
  ];

  it('auth filters applied in executed query; regular user sees only own, live records', async () => {
    const repo = makeRepo(baseDocs);
    const result = await repo.queryWithDsl({}, ownCtx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows.map((r) => r['_id']).sort()).toEqual(['a1', 'a2', 'a3']);
      expect(result.rows.every((r) => r['real_user_id'] === 'u_1')).toBe(true);
      expect(result.rows.map((r) => r['_id'])).not.toContain('deleted');
      expect(result.rows.map((r) => r['_id'])).not.toContain('other-app');
      expect(result.total).toBe(3);
    }
  });

  it('view_all skips real_user_id only; deleted_at:null always present', async () => {
    const repo = makeRepo(baseDocs);
    const result = await repo.queryWithDsl({}, viewAllCtx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.rows.map((r) => r['_id']).sort();
      expect(ids).toContain('a1');
      expect(ids).toContain('a2');
      expect(ids).toContain('a3');
      expect(ids).toContain('other-user');
      expect(ids).not.toContain('deleted');
      expect(ids).not.toContain('other-app');
    }
  });

  it('pagination, limit, sort and projection respected in execution', async () => {
    const repo = makeRepo(baseDocs.filter((d) => d.app_id === 'leave-request'));
    const result = await repo.queryWithDsl(
      {
        sort: [{ field: 'created_at', dir: 'desc' }],
        offset: 1,
        limit: 2,
        projection: { _id: 1, status: 1, created_at: 1 },
      },
      ownCtx,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows.map((r) => r['_id'])).toEqual(['a2', 'a3']);
      expect(result.rows[0]).toHaveProperty('_id');
      expect(result.rows[0]).toHaveProperty('status');
      expect(result.hasMore).toBe(false);
    }
  });

  it('auth injection works end-to-end with explicit filter', async () => {
    const repo = makeRepo(baseDocs);
    const result = await repo.queryWithDsl(
      {
        filters: { op: 'eq', field: 'status', value: 'completed' },
      },
      ownCtx,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows.map((r) => r['_id']).sort()).toEqual(['a1', 'a2', 'a3']);
      expect(result.rows.every((r) => (r as any).status === 'completed')).toBe(true);
    }
  });
});
