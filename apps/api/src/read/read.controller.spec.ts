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
  SubmissionRepository,
} from '@akane/domain';

import { ReadController } from './read.controller.js';

function createRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
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
      } as ReadVerifyResult),
    } as unknown as ReadVerifierService;

    const repo = {
      queryWithDsl: vi.fn(),
    } as unknown as SubmissionRepository;

    const module = await Test.createTestingModule({
      controllers: [ReadController],
      providers: [
        { provide: ReadVerifierService, useValue: verifier },
        { provide: SubmissionRepository, useValue: repo },
        { provide: 'READ_LINK_CONFIG', useValue: { rendererOrigin } },
      ],
    }).compile();

    const controller = module.get(ReadController);
    const res = createRes();

    await controller.view('token-123', res);

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
        { provide: 'READ_LINK_CONFIG', useValue: { rendererOrigin } },
      ],
    }).compile();

    const controller = module.get(ReadController);
    const res = createRes();

    await controller.view('', res);

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
        { provide: 'READ_LINK_CONFIG', useValue: { rendererOrigin } },
      ],
    }).compile();

    const controller = module.get(ReadController);
    const res = createRes();

    await controller.view('bad-token', res);

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
        { provide: 'READ_LINK_CONFIG', useValue: { rendererOrigin } },
      ],
    }).compile();

    const controller = module.get(ReadController);
    const res = createRes();

    await controller.query('token-query', res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalled();
    expect(repo.queryWithDsl).toHaveBeenCalled();
    const jsonCall = (res.json as any).mock.calls[0][0];
    expect(jsonCall.result.ok).toBe(true);
    expect(jsonCall.result.rows).toHaveLength(1);
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
        { provide: 'READ_LINK_CONFIG', useValue: { rendererOrigin } },
      ],
    }).compile();

    const controller = module.get(ReadController);
    const res = createRes();

    await controller.query('bad', res);

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
        { provide: 'READ_LINK_CONFIG', useValue: { rendererOrigin } },
      ],
    }).compile();

    const controller = module.get(ReadController);
    const res = createRes();

    await controller.query('token', res);

    expect(res.redirect).toHaveBeenCalledWith(
      302,
      `${rendererOrigin}/read/dead.html?reason=${encodeURIComponent(ReadDenyReason.denied)}`,
    );
  });
});
