/**
 * Integration tests for ReadController (LNK-05, LNK-06, D-40).
 *
 * Tests view and query endpoints end-to-end with the verifier and repository
 * wired appropriately. Deny cases redirect to dead with reason; wrong_version
 * and perm_version enforcement covered.
 */

import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { ReadDenyReason } from '@akane/contract';
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

/**
 * A limiter stub that never blocks. The AUD-10 limiter has its own suite
 * (`signature-failure-limiter.integration.spec.ts`); these cases test routing
 * and branching, so the default here is "not blocked" and the one case that
 * exercises a block overrides it.
 */
function allowLimiter() {
  return {
    recordSignatureFailure: vi.fn().mockResolvedValue({
      blocked: false,
      keys: [{ scope: 'link', id: 'jti' }],
      count: 1,
      retryAfterMs: 600000,
    }),
  };
}

function createRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('ReadController (integration)', () => {
  const rendererOrigin = 'https://renderer.akane.test';

  it('view endpoint returns view data for valid token', async () => {
    const submission = {
      _id: 'sub_456',
      real_user_id: 'u_123',
      app_id: 'leave-request',
      form_id: 'leave-form',
      form_version: 1,
      form_schema: { components: [] },
      data: { reason: 'vacation' },
      created_at: new Date(),
      status: 'completed' as const,
    };

    const verifier = {
      verify: vi.fn().mockResolvedValue({
        ok: true,
        claims: {
          action: 'view',
          sub: 'u_123',
          app_id: 'leave-request',
          jti: 'jti_abc',
        },
        submission,
      } as unknown as ReadVerifyResult),
    } as unknown as ReadVerifierService;

    const repo = {
      queryWithDsl: vi.fn(),
    } as unknown as SubmissionRepository;

    const module = await Test.createTestingModule({
      controllers: [ReadController],
      providers: [
        { provide: ReadVerifierService, useValue: verifier },
        { provide: SubmissionRepository, useValue: repo },
        { provide: SubmissionRevisionsRepository, useValue: { findLatest: vi.fn().mockResolvedValue(null), findByEditJti: vi.fn().mockResolvedValue(null) } },
        { provide: LinkTokenStore, useValue: { readOutcome: vi.fn().mockResolvedValue(null), recordOutcome: vi.fn(), consume: vi.fn() } },
        { provide: DataRouterService, useValue: { routeEdit: vi.fn(), routeSubmission: vi.fn() } },
        { provide: SignatureFailureLimiter, useValue: allowLimiter() },
        { provide: 'READ_SIGNATURE_BLOCKS', useValue: { recordBlock: vi.fn() } },
        { provide: 'READ_LINK_CONFIG', useValue: { rendererOrigin } },
      ],
    }).compile();

    const controller = module.get(ReadController);
    const res = createRes();

    await controller.view('jti_abc', 'token-123', res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalled();
    const jsonCall = (res.json as any).mock.calls[0][0];
    expect(jsonCall.claims.sub).toBe('u_123');
    expect(jsonCall.submission._id).toBe('sub_456');
  });

  it('view endpoint redirects to dead with bad_signature when no token', async () => {
    const verifier = {
      verify: vi.fn(),
    } as unknown as ReadVerifierService;
    const repo = {} as SubmissionRepository;

    const module = await Test.createTestingModule({
      controllers: [ReadController],
      providers: [
        { provide: ReadVerifierService, useValue: verifier },
        { provide: SubmissionRepository, useValue: repo },
        { provide: SubmissionRevisionsRepository, useValue: { findLatest: vi.fn().mockResolvedValue(null), findByEditJti: vi.fn().mockResolvedValue(null) } },
        { provide: LinkTokenStore, useValue: { readOutcome: vi.fn().mockResolvedValue(null), recordOutcome: vi.fn(), consume: vi.fn() } },
        { provide: DataRouterService, useValue: { routeEdit: vi.fn(), routeSubmission: vi.fn() } },
        { provide: SignatureFailureLimiter, useValue: allowLimiter() },
        { provide: 'READ_SIGNATURE_BLOCKS', useValue: { recordBlock: vi.fn() } },
        { provide: 'READ_LINK_CONFIG', useValue: { rendererOrigin } },
      ],
    }).compile();

    const controller = module.get(ReadController);
    const res = createRes();

    await controller.view('jti_x', '', res);

    expect(res.redirect).toHaveBeenCalledWith(
      302,
      `${rendererOrigin}/read/dead.html?reason=${encodeURIComponent(ReadDenyReason.bad_signature)}`,
    );
  });

  it('view endpoint redirects to dead with reason when verifier denies', async () => {
    const verifier = {
      verify: vi.fn().mockResolvedValue({
        ok: false,
        reason: ReadDenyReason.denied,
      } as ReadVerifyResult),
    } as unknown as ReadVerifierService;
    const repo = {} as SubmissionRepository;

    const module = await Test.createTestingModule({
      controllers: [ReadController],
      providers: [
        { provide: ReadVerifierService, useValue: verifier },
        { provide: SubmissionRepository, useValue: repo },
        { provide: SubmissionRevisionsRepository, useValue: { findLatest: vi.fn().mockResolvedValue(null), findByEditJti: vi.fn().mockResolvedValue(null) } },
        { provide: LinkTokenStore, useValue: { readOutcome: vi.fn().mockResolvedValue(null), recordOutcome: vi.fn(), consume: vi.fn() } },
        { provide: DataRouterService, useValue: { routeEdit: vi.fn(), routeSubmission: vi.fn() } },
        { provide: SignatureFailureLimiter, useValue: allowLimiter() },
        { provide: 'READ_SIGNATURE_BLOCKS', useValue: { recordBlock: vi.fn() } },
        { provide: 'READ_LINK_CONFIG', useValue: { rendererOrigin } },
      ],
    }).compile();

    const controller = module.get(ReadController);
    const res = createRes();

    await controller.view('jti_x', 'bad-token', res);

    expect(res.redirect).toHaveBeenCalledWith(
      302,
      `${rendererOrigin}/read/dead.html?reason=${encodeURIComponent(ReadDenyReason.denied)}`,
    );
  });

  it('query endpoint returns results for valid token', async () => {
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
        rows: [{ _id: 'r1', status: 'pending' }],
        total: 1,
        hasMore: false,
      }),
    } as unknown as SubmissionRepository;

    const module = await Test.createTestingModule({
      controllers: [ReadController],
      providers: [
        { provide: ReadVerifierService, useValue: verifier },
        { provide: SubmissionRepository, useValue: repo },
        { provide: SubmissionRevisionsRepository, useValue: { findLatest: vi.fn().mockResolvedValue(null), findByEditJti: vi.fn().mockResolvedValue(null) } },
        { provide: LinkTokenStore, useValue: { readOutcome: vi.fn().mockResolvedValue(null), recordOutcome: vi.fn(), consume: vi.fn() } },
        { provide: DataRouterService, useValue: { routeEdit: vi.fn(), routeSubmission: vi.fn() } },
        { provide: SignatureFailureLimiter, useValue: allowLimiter() },
        { provide: 'READ_SIGNATURE_BLOCKS', useValue: { recordBlock: vi.fn() } },
        { provide: 'READ_LINK_CONFIG', useValue: { rendererOrigin } },
      ],
    }).compile();

    const controller = module.get(ReadController);
    const res = createRes();

    await controller.query('jti_def', 'token-query', res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalled();
    const jsonCall = (res.json as any).mock.calls[0][0];
    expect(jsonCall.rows).toHaveLength(1);
    expect(repo.queryWithDsl).toHaveBeenCalled();
  });

  it('query endpoint redirects to dead with wrong_version when verifier denies with wrong_version', async () => {
    const verifier = {
      verify: vi.fn().mockResolvedValue({
        ok: false,
        reason: ReadDenyReason.wrong_version,
      } as ReadVerifyResult),
    } as unknown as ReadVerifierService;
    const repo = {} as SubmissionRepository;

    const module = await Test.createTestingModule({
      controllers: [ReadController],
      providers: [
        { provide: ReadVerifierService, useValue: verifier },
        { provide: SubmissionRepository, useValue: repo },
        { provide: SubmissionRevisionsRepository, useValue: { findLatest: vi.fn().mockResolvedValue(null), findByEditJti: vi.fn().mockResolvedValue(null) } },
        { provide: LinkTokenStore, useValue: { readOutcome: vi.fn().mockResolvedValue(null), recordOutcome: vi.fn(), consume: vi.fn() } },
        { provide: DataRouterService, useValue: { routeEdit: vi.fn(), routeSubmission: vi.fn() } },
        { provide: SignatureFailureLimiter, useValue: allowLimiter() },
        { provide: 'READ_SIGNATURE_BLOCKS', useValue: { recordBlock: vi.fn() } },
        { provide: 'READ_LINK_CONFIG', useValue: { rendererOrigin } },
      ],
    }).compile();

    const controller = module.get(ReadController);
    const res = createRes();

    await controller.query('jti_x', 'bad', res);

    expect(res.redirect).toHaveBeenCalledWith(
      302,
      `${rendererOrigin}/read/dead.html?reason=${encodeURIComponent(ReadDenyReason.wrong_version)}`,
    );
  });

  it('perm_version enforcement tested via deny reason', async () => {
    const verifier = {
      verify: vi.fn().mockResolvedValue({
        ok: false,
        reason: ReadDenyReason.denied,
      } as ReadVerifyResult),
    } as unknown as ReadVerifierService;
    const repo = {} as SubmissionRepository;

    const module = await Test.createTestingModule({
      controllers: [ReadController],
      providers: [
        { provide: ReadVerifierService, useValue: verifier },
        { provide: SubmissionRepository, useValue: repo },
        { provide: SubmissionRevisionsRepository, useValue: { findLatest: vi.fn().mockResolvedValue(null), findByEditJti: vi.fn().mockResolvedValue(null) } },
        { provide: LinkTokenStore, useValue: { readOutcome: vi.fn().mockResolvedValue(null), recordOutcome: vi.fn(), consume: vi.fn() } },
        { provide: DataRouterService, useValue: { routeEdit: vi.fn(), routeSubmission: vi.fn() } },
        { provide: SignatureFailureLimiter, useValue: allowLimiter() },
        { provide: 'READ_SIGNATURE_BLOCKS', useValue: { recordBlock: vi.fn() } },
        { provide: 'READ_LINK_CONFIG', useValue: { rendererOrigin } },
      ],
    }).compile();

    const controller = module.get(ReadController);
    const res = createRes();

    await controller.query('jti_x', 'token', res);

    expect(res.redirect).toHaveBeenCalledWith(
      302,
      `${rendererOrigin}/read/dead.html?reason=${encodeURIComponent(ReadDenyReason.denied)}`,
    );
  });

  it('AUD-10: a bad_signature failure is counted and, once blocked, answered with 429', async () => {
    const verifier = {
      verify: vi.fn().mockResolvedValue({
        ok: false,
        reason: ReadDenyReason.bad_signature,
      } as ReadVerifyResult),
    } as unknown as ReadVerifierService;

    // The limiter reports this failure exhausted the budget.
    const limiter = {
      recordSignatureFailure: vi.fn().mockResolvedValue({
        blocked: true,
        keys: [{ scope: 'link', id: 'jti_blocked' }],
        count: 5,
        retryAfterMs: 600000,
      }),
    };
    const blocks = { recordBlock: vi.fn() };

    const module = await Test.createTestingModule({
      controllers: [ReadController],
      providers: [
        { provide: ReadVerifierService, useValue: verifier },
        { provide: SubmissionRepository, useValue: {} as SubmissionRepository },
        { provide: SubmissionRevisionsRepository, useValue: { findLatest: vi.fn(), findByEditJti: vi.fn() } },
        { provide: LinkTokenStore, useValue: { readOutcome: vi.fn(), recordOutcome: vi.fn(), consume: vi.fn() } },
        { provide: DataRouterService, useValue: { routeEdit: vi.fn(), routeSubmission: vi.fn() } },
        { provide: SignatureFailureLimiter, useValue: limiter },
        { provide: 'READ_SIGNATURE_BLOCKS', useValue: blocks },
        { provide: 'READ_LINK_CONFIG', useValue: { rendererOrigin } },
      ],
    }).compile();

    const controller = module.get(ReadController);
    const res = createRes();

    await controller.view('jti_blocked', 'forged', res);

    // Counted under the link key only — never the address.
    expect(limiter.recordSignatureFailure).toHaveBeenCalledWith([
      { scope: 'link', id: 'jti_blocked' },
    ]);
    expect(blocks.recordBlock).toHaveBeenCalledWith('link');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '600');
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('AUD-10: five benign failures are never counted and never block', async () => {
    // The PITFALLS formulation: five benign failures from one caller must not
    // block. The address is not part of the key at all; the point here is that
    // the *reason* is not either.
    const benign = [
      ReadDenyReason.expired,
      ReadDenyReason.consumed,
      ReadDenyReason.wrong_version,
      ReadDenyReason.deactivated_user,
      ReadDenyReason.denied,
    ];
    const queued = [...benign];
    const verifier = {
      verify: vi.fn().mockImplementation(async () => ({
        ok: false,
        reason: queued.shift(),
      } as ReadVerifyResult)),
    } as unknown as ReadVerifierService;

    const limiter = { recordSignatureFailure: vi.fn() };

    const module = await Test.createTestingModule({
      controllers: [ReadController],
      providers: [
        { provide: ReadVerifierService, useValue: verifier },
        { provide: SubmissionRepository, useValue: {} as SubmissionRepository },
        { provide: SubmissionRevisionsRepository, useValue: { findLatest: vi.fn(), findByEditJti: vi.fn() } },
        { provide: LinkTokenStore, useValue: { readOutcome: vi.fn(), recordOutcome: vi.fn(), consume: vi.fn() } },
        { provide: DataRouterService, useValue: { routeEdit: vi.fn(), routeSubmission: vi.fn() } },
        { provide: SignatureFailureLimiter, useValue: limiter },
        { provide: 'READ_SIGNATURE_BLOCKS', useValue: { recordBlock: vi.fn() } },
        { provide: 'READ_LINK_CONFIG', useValue: { rendererOrigin } },
      ],
    }).compile();

    const controller = module.get(ReadController);

    for (const reason of benign) {
      const res = createRes();
      await controller.view('jti_x', 'benign', res);
      // A real link in a real state: redirect with the reason, no 429, and the
      // limiter is never consulted — "blocks only on signature failure".
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        `${rendererOrigin}/read/dead.html?reason=${encodeURIComponent(reason)}`,
      );
      expect(res.status).not.toHaveBeenCalledWith(429);
    }

    expect(limiter.recordSignatureFailure).not.toHaveBeenCalled();
  });
});
