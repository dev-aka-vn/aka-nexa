/**
 * The status surface: projection + controller wiring.
 *
 * **Scope, stated plainly because the filename overstates it.** This spec
 * provides `ReadVerifierService` as a `useValue` stub, so it never reaches
 * `verifyQuery`, never touches Redis or Mongo, and would pass whether or not the
 * production saved-query store is wired. It proves the projection
 * (`completed | partial | failed | pending_external`) and the controller's
 * rendering of it — nothing more.
 *
 * That is exactly how G-11 hid: the `query` action was denied *in production*
 * while this spec stayed green. The real resolution is proven in
 * `packages/domain/src/links/read-verifier.service.spec.ts`
 * (`with the production seed store (G-11 reachability)`), and the DI wiring by
 * `apps/api/src/read/read.module.spec.ts`. The filename is kept deliberately —
 * it is cited by several planning records and by `WINDOWS.md` #21, so renaming it
 * would rewrite history rather than clarify it.
 */

import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import {
  ReadVerifierService,
  type ReadVerifyResult,
  SignatureFailureLimiter,
  SubmissionRepository,
  SubmissionRevisionsRepository,
  LinkTokenStore,
  DataRouterService,
} from '@akane/domain';

import { ReadController } from './read.controller.js';

function createRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('status surface', () => {
  const rendererOrigin = 'https://renderer.akane.test';

  it('my submissions returns only caller own rows with projected status', async () => {
    const verifier = {
      verify: vi.fn().mockResolvedValue({
        ok: true,
        claims: {
          action: 'query',
          sub: 'u_123',
          app_id: 'leave-request',
          jti: 'jti_def',
        },
        savedQuery: {
          query_id: 'qry_789',
          query_version: 1,
          app_id: 'leave-request',
          dsl: { filters: { op: 'eq', field: 'status', value: 'pending' } },
        },
      } as ReadVerifyResult),
    } as unknown as ReadVerifierService;

    const repo = {
      queryWithDsl: vi.fn().mockResolvedValue({
        ok: true,
        rows: [
          { _id: 'sub_001', app_id: 'leave-request', form_id: 'leave-form', status: 'partial', created_at: new Date('2024-01-01T00:00:00Z') },
        ],
        total: 1,
        hasMore: false,
      }),
    } as unknown as SubmissionRepository;

    const revisions = {
      findLatest: vi.fn().mockResolvedValue({
        submission_id: 'sub_001',
        revision: 1,
        outbound: 'not_sent',
        data: {},
        createdAt: new Date('2024-01-01T00:00:00Z'),
      }),
    } as unknown as SubmissionRevisionsRepository;

    const module = await Test.createTestingModule({
      controllers: [ReadController],
      providers: [
        { provide: ReadVerifierService, useValue: verifier },
        { provide: SubmissionRepository, useValue: repo },
        { provide: SubmissionRevisionsRepository, useValue: revisions },
        { provide: LinkTokenStore, useValue: { readOutcome: vi.fn().mockResolvedValue(null), recordOutcome: vi.fn(), consume: vi.fn() } },
        { provide: DataRouterService, useValue: { routeEdit: vi.fn(), routeSubmission: vi.fn() } },
        { provide: SignatureFailureLimiter, useValue: { recordSignatureFailure: vi.fn() } },
        { provide: 'READ_SIGNATURE_BLOCKS', useValue: { recordBlock: vi.fn() } },
        { provide: 'READ_LINK_CONFIG', useValue: { rendererOrigin } },
      ],
    }).compile();

    const controller = module.get(ReadController);
    const res = createRes();

    await controller.query('jti_def', 'token-query', res);

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonCall = (res.json as any).mock.calls[0][0];
    expect(jsonCall.rows).toHaveLength(1);
    expect(jsonCall.rows[0].status).toBe('partial');
    expect(jsonCall.rows[0].destination).toContain('retrying');
    expect(repo.queryWithDsl).toHaveBeenCalled();
  });
});
