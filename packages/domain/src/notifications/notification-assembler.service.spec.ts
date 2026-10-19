import { describe, expect, it, vi } from 'vitest';

import { OutboundMessageSchema } from '@akane/contract';

import { NotificationAssemblerService } from './notification-assembler.service.js';
import type { Submission } from '../submissions/submission.repository.js';

describe('NotificationAssemblerService (NOT-03)', () => {
  it('assembles a user-bound status message for a known reference', async () => {
    const revision = { submission_id: 'sub-1', revision: 1 };
    const submission: Submission = {
      _id: 'sub-1',
      real_user_id: 'user-42',
      app_id: 'app-1',
      form_id: 'form-1',
      form_version: 3,
      form_schema: {},
      data: {},
      created_at: new Date(),
      status: 'completed',
    };
    const mapping = {
      platform: 'teams',
      chat_user_id: 'chat-7',
      channel_id: 'chan-9',
      real_user_id: 'user-42',
    };

    const revisionsRepo = {
      findByDownstreamReference: vi.fn().mockResolvedValue(revision),
    };
    const submissionsRepo = { findById: vi.fn().mockResolvedValue(submission) };
    const identityRepo = { findByRealUserId: vi.fn().mockResolvedValue(mapping) };
    const linkIssuer = { issue: vi.fn().mockResolvedValue('/l/app-1?u=user-42&a=notification') };

    const service = new NotificationAssemblerService(
      revisionsRepo as never,
      submissionsRepo as never,
      identityRepo as never,
      linkIssuer as never,
    );

    const result = await service.assemble('conn-a', 'entity-1', 'Status: updated');

    expect(result.kind).toBe('assembled');
    if (result.kind !== 'assembled') throw new Error('expected assembled');
    expect(result.message.action).toBe('status');
    expect(result.message.platform).toBe('teams');
    expect(result.message.chat_user_id).toBe('chat-7');
    expect(result.message.channel_id).toBe('chan-9');
    expect(result.message.text).toContain('Status: updated');
    expect(result.message.text).toContain('/l/app-1');
    OutboundMessageSchema.parse(result.message);
    expect(linkIssuer.issue).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'app-1', realUserId: 'user-42', action: 'notification' }),
    );
  });

  it('does not cross connectors for the same entity reference', async () => {
    const revA = { submission_id: 'sub-a', revision: 1 };
    const revB = { submission_id: 'sub-b', revision: 1 };

    const revisionsRepo = {
      findByDownstreamReference: vi.fn(async (connectorId: string, _ref: string) =>
        connectorId === 'conn-a' ? revA : connectorId === 'conn-b' ? revB : null,
      ),
    };
    const submissionsRepo = {
      findById: vi.fn(async (id: string) => ({
        _id: id,
        real_user_id: `user-${id}`,
        app_id: 'app-1',
        form_id: 'form-1',
        form_version: 1,
        form_schema: {},
        data: {},
        created_at: new Date(),
        status: 'completed',
      })),
    };
    const identityRepo = {
      findByRealUserId: vi.fn(async (uid: string) => ({
        platform: 'teams',
        chat_user_id: `chat-${uid}`,
        channel_id: `chan-${uid}`,
        real_user_id: uid,
      })),
    };
    const linkIssuer = { issue: vi.fn().mockResolvedValue('/l/x') };

    const service = new NotificationAssemblerService(
      revisionsRepo as never,
      submissionsRepo as never,
      identityRepo as never,
      linkIssuer as never,
    );

    const a = await service.assemble('conn-a', 'entity-X', 's');
    const b = await service.assemble('conn-b', 'entity-X', 's');
    const c = await service.assemble('conn-c', 'entity-X', 's');

    expect(a.kind).toBe('assembled');
    expect(b.kind).toBe('assembled');
    if (a.kind === 'assembled' && b.kind === 'assembled') {
      expect(a.message.message_id).not.toBe(b.message.message_id);
    }
    expect(c.kind).toBe('unresolved');
  });

  it('returns unresolved for an unknown entity reference', async () => {
    const revisionsRepo = { findByDownstreamReference: vi.fn().mockResolvedValue(null) };
    const submissionsRepo = { findById: vi.fn() };
    const identityRepo = { findByRealUserId: vi.fn() };
    const linkIssuer = { issue: vi.fn() };

    const service = new NotificationAssemblerService(
      revisionsRepo as never,
      submissionsRepo as never,
      identityRepo as never,
      linkIssuer as never,
    );

    const result = await service.assemble('conn-a', 'nope', 's');
    expect(result).toEqual({ kind: 'unresolved', reference: 'nope' });
    expect(submissionsRepo.findById).not.toHaveBeenCalled();
  });

  it('returns unmapped when no identity mapping exists', async () => {
    const revision = { submission_id: 'sub-1', revision: 1 };
    const submission: Submission = {
      _id: 'sub-1',
      real_user_id: 'user-99',
      app_id: 'app-1',
      form_id: 'form-1',
      form_version: 1,
      form_schema: {},
      data: {},
      created_at: new Date(),
      status: 'completed',
    };

    const revisionsRepo = { findByDownstreamReference: vi.fn().mockResolvedValue(revision) };
    const submissionsRepo = { findById: vi.fn().mockResolvedValue(submission) };
    const identityRepo = { findByRealUserId: vi.fn().mockResolvedValue(null) };
    const linkIssuer = { issue: vi.fn() };

    const service = new NotificationAssemblerService(
      revisionsRepo as never,
      submissionsRepo as never,
      identityRepo as never,
      linkIssuer as never,
    );

    const result = await service.assemble('conn-a', 'entity-1', 's');
    expect(result).toEqual({ kind: 'unmapped', realUserId: 'user-99' });
    expect(linkIssuer.issue).not.toHaveBeenCalled();
  });
});