/**
 * LNK-08 / D-71 per-reason denial recording.
 *
 * The requirement is not "a denial counter exists" — it is that each of the
 * seven revocation reasons (expired, consumed, revoked, wrong_app,
 * wrong_version, deactivated_user, bad_signature) is counted *distinctly* via a
 * `reason` label, and that every denial also emits one structured log entry
 * whose field names come from the D-43 allowlist (LNK-09).
 *
 * Both halves are proven against fakes injected through the service's seams:
 * a {@link ReadDenyRecorder} (the OTel counter lives in `apps/api`, because a
 * domain module may not own an instrument) and a `LoggerPort`.
 */

import { describe, expect, it, vi } from 'vitest';

import { ALL_DENY_REASONS, ReadDenyReason } from '@akane/contract';
import { LOG_FIELD_ALLOWLIST_SET, type LoggerPort, type LogFields } from '@akane/platform';

import { ReadDenyService, type ReadDenyRecorder } from '../read-deny.service.js';

function makeRecorder(): ReadDenyRecorder & {
  calls: Array<{ reason: ReadDenyReason; action: string }>;
} {
  const calls: Array<{ reason: ReadDenyReason; action: string }> = [];
  return {
    calls,
    recordDenial(reason, action) {
      calls.push({ reason, action });
    },
  };
}

function makeLogger(): LoggerPort & {
  warnings: Array<{ message: string; fields?: LogFields }>;
} {
  const warnings: Array<{ message: string; fields?: LogFields }> = [];
  return {
    warnings,
    info: vi.fn(),
    warn: (message: string, fields?: LogFields) => {
      warnings.push({ message, fields });
    },
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe('ReadDenyService (LNK-08, D-71, LNK-09)', () => {
  it('defines the seven LNK-08 reasons as distinct label values', () => {
    expect(ALL_DENY_REASONS).toHaveLength(7);
    expect(new Set(ALL_DENY_REASONS).size).toBe(7);
  });

  it('records every LNK-08 reason distinctly with its action', () => {
    const recorder = makeRecorder();
    const service = new ReadDenyService(recorder);

    for (const reason of ALL_DENY_REASONS) {
      service.record(reason, { action: 'view' });
    }

    expect(recorder.calls.map((c) => c.reason)).toEqual([...ALL_DENY_REASONS]);
    expect(recorder.calls.every((c) => c.action === 'view')).toBe(true);
  });

  it('records internal denials (not_found / not_owned / denied) with their specific reason', () => {
    const recorder = makeRecorder();
    const service = new ReadDenyService(recorder);

    service.record(ReadDenyReason.not_found, { action: 'view' });
    service.record(ReadDenyReason.not_owned, { action: 'view' });
    service.record(ReadDenyReason.denied, { action: 'query' });

    expect(recorder.calls).toEqual([
      { reason: ReadDenyReason.not_found, action: 'view' },
      { reason: ReadDenyReason.not_owned, action: 'view' },
      { reason: ReadDenyReason.denied, action: 'query' },
    ]);
  });

  it('emits exactly one structured log entry per denial, with allowlisted field names only (LNK-09)', () => {
    const recorder = makeRecorder();
    const logger = makeLogger();
    const service = new ReadDenyService(recorder, logger);

    service.record(ReadDenyReason.wrong_version, {
      action: 'query',
      jti: 'jti-123',
      app_id: 'app-9',
    });

    expect(logger.warnings).toHaveLength(1);
    const entry = logger.warnings[0]!;
    expect(entry.fields).toBeDefined();
    const fields = entry.fields!;
    for (const key of Object.keys(fields)) {
      expect(LOG_FIELD_ALLOWLIST_SET.has(key), `field "${key}" is not allowlisted`).toBe(true);
    }
    expect(fields['reason']).toBe(ReadDenyReason.wrong_version);
    expect(fields['action']).toBe('query');
    expect(fields['jti']).toBe('jti-123');
    expect(fields['app_id']).toBe('app-9');
    expect(fields['status']).toBe('denied');
  });

  it('still counts the denial when no logger is wired', () => {
    const recorder = makeRecorder();
    const service = new ReadDenyService(recorder);

    expect(() => service.record(ReadDenyReason.expired, { action: 'view' })).not.toThrow();
    expect(recorder.calls).toHaveLength(1);
  });
});
