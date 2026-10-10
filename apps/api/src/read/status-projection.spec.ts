import { describe, expect, it } from 'vitest';

import { projectSubmissionStatus } from './status-projection.js';

describe('status-projection', () => {
  it('projects confirmed revision with downstream reference', () => {
    const row = projectSubmissionStatus({
      submission: {
        app_id: 'hr-leave-request',
        form_id: 'leave_form',
        created_at: new Date('2024-01-01T00:00:00Z'),
        status: 'completed',
      },
      latestRevision: {
        submission_id: 'sub_01',
        revision: 1,
        outbound: 'confirmed',
        data: {},
        createdAt: new Date('2024-01-01T00:00:00Z'),
        downstreamReference: 'issue-123',
      },
      connectorName: 'Redmine',
    });

    expect(row.app_id).toBe('hr-leave-request');
    expect(row.form_id).toBe('leave_form');
    expect(row.status).toBe('completed');
    expect(row.downstreamRef).toBe('issue-123');
    expect(row.destination).toContain('Redmine');
    expect(row.destination).toContain('issue-123');
    expect(row.reason).toBeUndefined();
  });

  it('projects not_sent revision as partial with retrying message', () => {
    const row = projectSubmissionStatus({
      submission: {
        app_id: 'hr-leave',
        form_id: 'form',
        created_at: new Date('2024-01-01T00:00:00Z'),
        status: 'partial',
      },
      latestRevision: {
        submission_id: 'sub_02',
        revision: 1,
        outbound: 'not_sent',
        data: {},
        createdAt: new Date('2024-01-01T00:00:00Z'),
      },
      connectorName: 'Redmine',
    });

    expect(row.status).toBe('partial');
    expect(row.destination).toContain('Internal saved');
    expect(row.destination).toContain('Redmine');
    expect(row.destination).toContain('retrying');
    expect(row.reason).toBeUndefined();
  });

  it('projects sent_unconfirmed revision as partial with retrying message', () => {
    const row = projectSubmissionStatus({
      submission: {
        app_id: 'hr-leave',
        form_id: 'form',
        created_at: new Date('2024-01-01T00:00:00Z'),
        status: 'partial',
      },
      latestRevision: {
        submission_id: 'sub_03',
        revision: 2,
        outbound: 'sent_unconfirmed',
        data: {},
        createdAt: new Date('2024-01-01T00:00:00Z'),
      },
      connectorName: 'Redmine',
    });

    expect(row.status).toBe('partial');
    expect(row.destination).toContain('Internal saved');
    expect(row.destination).toContain('retrying');
    expect(row.reason).toBeUndefined();
  });

  it('projects failed revision with user-safe reason', () => {
    const row = projectSubmissionStatus({
      submission: {
        app_id: 'hr-leave',
        form_id: 'form',
        created_at: new Date('2024-01-01T00:00:00Z'),
        status: 'failed',
      },
      latestRevision: {
        submission_id: 'sub_04',
        revision: 1,
        outbound: 'not_sent',
        data: {},
        createdAt: new Date('2024-01-01T00:00:00Z'),
      },
      connectorName: 'Redmine',
      taxonomyCode: 'credential_rejected',
    });

    expect(row.status).toBe('failed');
    expect(row.reason).toBeDefined();
    expect(row.reason).toContain('Redmine');
    expect(row.reason).not.toContain('credential_rejected'); // user-safe, not raw code
  });

  it('never includes non-allowlisted fields', () => {
    const row = projectSubmissionStatus({
      submission: {
        app_id: 'hr-leave',
        form_id: 'form',
        created_at: new Date('2024-01-01T00:00:00Z'),
        status: 'completed',
        secretToken: 'should-not-appear',
        password: 'bad',
        piiEmail: 'test@test.com',
      } as any,
      latestRevision: {
        submission_id: 'sub_05',
        revision: 1,
        outbound: 'confirmed',
        data: { sensitive: 'data' },
        createdAt: new Date('2024-01-01T00:00:00Z'),
        downstreamReference: '123',
      },
      connectorName: 'Redmine',
    });

    const keys = Object.keys(row);
    expect(keys).toEqual(
      expect.arrayContaining([
        'app_id',
        'form_id',
        'submittedAt',
        'status',
        'destination',
      ]),
    );
    // Check no extra sensitive keys
    expect((row as any).secretToken).toBeUndefined();
    expect((row as any).password).toBeUndefined();
    expect((row as any).piiEmail).toBeUndefined();
    expect((row as any).sensitive).toBeUndefined();
    expect((row as any).data).toBeUndefined();
  });
});
