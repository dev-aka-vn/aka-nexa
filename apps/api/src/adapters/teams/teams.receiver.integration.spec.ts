import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import { TeamsActivityService } from './teams-activity.service.js';
import { TeamsAuthGuard } from './teams-auth.guard.js';
import { TeamsController } from './teams.controller.js';

describe('Teams receiver (IM-10)', () => {
  describe('urlVerification handshake', () => {
    it('echoes the challenge and performs no writes/enqueue', async () => {
      const handle = vi.fn();
      const service = { handle } as unknown as TeamsActivityService;
      const controller = new TeamsController(service);
      const res = { status: vi.fn().mockReturnThis(), send: vi.fn() } as any;
      await controller.handleEvents({ type: 'urlVerification', value: 'challenge-xyz' } as any, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('challenge-xyz');
      expect(handle).not.toHaveBeenCalled();
    });

    it('service.handle returns challenge with no writes for urlVerification (defence in depth)', async () => {
      const teamsEventRepo = { insert: vi.fn() };
      const convRefRepo = { upsert: vi.fn() };
      const queue = { add: vi.fn() };
      const service = new TeamsActivityService(teamsEventRepo as any, convRefRepo as any, queue as any);
      const out = await service.handle({ type: 'urlVerification', id: 'evt-1' });
      expect(out).toBe('challenge');
      expect(teamsEventRepo.insert).not.toHaveBeenCalled();
      expect(convRefRepo.upsert).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('TeamsAuthGuard', () => {
    it('throws 401 when Authorization header is missing', async () => {
      const guard = new TeamsAuthGuard();
      const req = { body: { id: 'evt-1' }, headers: {} } as any;
      const res = {} as any;
      const ctx = {
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      } as any;
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('passes through urlVerification unauthenticated', async () => {
      const guard = new TeamsAuthGuard();
      const req = { body: { type: 'urlVerification', value: 'c' }, headers: {} } as any;
      const res = {} as any;
      const ctx = {
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      } as any;
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('valid activity', () => {
    it('returns enqueued and adds one job', async () => {
      const teamsEventRepo = { insert: vi.fn().mockResolvedValue('inserted') };
      const convRefRepo = { upsert: vi.fn().mockResolvedValue(undefined), key: (c: string, u: string) => `${c}:${u}` };
      // ensure static key method exists
      (convRefRepo as any).key = (c: string, u: string) => `${c}:${u}`;
      const queue = { add: vi.fn().mockResolvedValue({}) };
      const service = new TeamsActivityService(teamsEventRepo as any, convRefRepo as any, queue as any);

      // ConversationReferenceRepository.key is static; ensure import path uses it
      const out = await service.handle({ id: 'evt-1', type: 'message', text: 'hi', conversation: { id: 'chan-9' }, from: { id: 'chat-7' } });
      expect(out).toBe('enqueued');
      expect(queue.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('duplicate delivery', () => {
    it('returns duplicate and adds no second job', async () => {
      const teamsEventRepo = { insert: vi.fn().mockResolvedValue('duplicate') };
      const convRefRepo = { upsert: vi.fn(), key: (c: string, u: string) => `${c}:${u}` } as any;
      convRefRepo.key = (c: string, u: string) => `${c}:${u}`;
      const queue = { add: vi.fn() };
      const service = new TeamsActivityService(teamsEventRepo as any, convRefRepo as any, queue as any);

      const out = await service.handle({ id: 'evt-1', type: 'message', text: 'hi', conversation: { id: 'chan-9' }, from: { id: 'chat-7' } });
      expect(out).toBe('duplicate');
      expect(queue.add).not.toHaveBeenCalled();
      expect(convRefRepo.upsert).not.toHaveBeenCalled();
    });
  });

  describe('fail-closed on storage timeout', () => {
    it('throws ServiceUnavailableException when insert throws', async () => {
      const teamsEventRepo = { insert: vi.fn().mockRejectedValue(new Error('timeout')) };
      const convRefRepo = { upsert: vi.fn(), key: (c: string, u: string) => `${c}:${u}` } as any;
      convRefRepo.key = (c: string, u: string) => `${c}:${u}`;
      const queue = { add: vi.fn() };
      const service = new TeamsActivityService(teamsEventRepo as any, convRefRepo as any, queue as any);

      await expect(service.handle({ id: 'evt-1', type: 'message' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});