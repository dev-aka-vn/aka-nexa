/**
 * TDD tests for the read-only renderer (D-68, D-70).
 *
 * These cover the pure logic that is testable in a Node environment:
 * - the D-70 deny-reason → copy mapping (shared contract between dead.html and
 *   the API's LinkErrorFilter in Task 3)
 * - URL parsing for the view and dead-link entry points
 * - the dead-link detection predicate
 *
 * The actual FormIO read-only rendering is browser-only and exercised by
 * Playwright in a later phase; the tracer proves the verification path,
 * which is what these tests lock in.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ReadDenyReason } from '@akane/contract';

import {
  DENY_REASON_COPY,
  getDenyReasonCopy,
  parseReadLinkUrl,
  isDeadLink,
  type ReadLinkParams,
} from './view.js';
import { buildDetailSummary } from './status.js';

const VIEW_HTML = readFileSync(new URL('./view.html', import.meta.url), 'utf8');
const VIEW_BROWSER = readFileSync(new URL('./view.browser.ts', import.meta.url), 'utf8');

describe('getDenyReasonCopy (D-70 mapping)', () => {
  // Every reason must have a non-empty copy string.
  it('covers every member of ReadDenyReason', () => {
    for (const reason of Object.values(ReadDenyReason)) {
      const copy = DENY_REASON_COPY[reason as ReadDenyReason];
      expect(copy, `missing copy for ${reason}`).toBeDefined();
      expect(typeof copy).toBe('string');
      expect(copy.length).toBeGreaterThan(10);
    }
  });

  it('returns the correct copy via getDenyReasonCopy', () => {
    expect(getDenyReasonCopy(ReadDenyReason.expired)).toBe(
      DENY_REASON_COPY[ReadDenyReason.expired],
    );
  });

  it('falls back to bad_signature copy for an unknown reason', () => {
    const copy = getDenyReasonCopy('totally_unknown_reason' as ReadDenyReason);
    expect(copy).toBe(DENY_REASON_COPY[ReadDenyReason.bad_signature]);
  });

  // Actionable reasons — the user can get a working link again.
  const actionable = [
    ReadDenyReason.expired,
    ReadDenyReason.consumed,
    ReadDenyReason.revoked,
    ReadDenyReason.wrong_app,
    ReadDenyReason.wrong_version,
    ReadDenyReason.bad_signature,
  ];

  for (const reason of actionable) {
    it(`actionable reason "${reason}" includes IM affordance`, () => {
      const copy = getDenyReasonCopy(reason);
      expect(copy).toContain('request a new one via IM');
    });
  }

  // Non-actionable reasons — the problem is on the server/account side.
  const nonActionable = [
    ReadDenyReason.deactivated_user,
    ReadDenyReason.not_found,
    ReadDenyReason.not_owned,
    ReadDenyReason.denied,
    ReadDenyReason.invalid_action,
  ];

  for (const reason of nonActionable) {
    it(`non-actionable reason "${reason}" does NOT suggest IM self-service`, () => {
      const copy = getDenyReasonCopy(reason);
      expect(copy).not.toContain('request a new one via IM');
    });
  }
});

describe('parseReadLinkUrl', () => {
  it('extracts jti and token from a view link', () => {
    const params = parseReadLinkUrl(
      'https://render.example/read/view.html?jti=abc123&token=eyJhbGci',
    );
    expect(params.jti).toBe('abc123');
    expect(params.token).toBe('eyJhbGci');
    expect(params.reason).toBeUndefined();
  });

  it('extracts reason from a dead-link URL', () => {
    const params = parseReadLinkUrl(
      'https://render.example/read/dead.html?reason=expired',
    );
    expect(params.reason).toBe('expired');
    expect(params.jti).toBeUndefined();
    expect(params.token).toBeUndefined();
  });

  it('returns undefined for absent params', () => {
    const params = parseReadLinkUrl(
      'https://render.example/read/view.html',
    );
    expect(params.jti).toBeUndefined();
    expect(params.token).toBeUndefined();
    expect(params.reason).toBeUndefined();
  });

  it('handles a relative URL with a fallback base', () => {
    const params = parseReadLinkUrl(
      '/read/view.html?jti=sub-1&token=jwt.token.here',
    );
    expect(params.jti).toBe('sub-1');
    expect(params.token).toBe('jwt.token.here');
  });

  it('handles a full URL with reason and extra params', () => {
    const params = parseReadLinkUrl(
      'https://render.example/read/dead.html?reason=denied&ref=slack',
    );
    expect(params.reason).toBe('denied');
  });
});

describe('isDeadLink', () => {
  it('returns true when a reason is present', () => {
    const params: ReadLinkParams = { reason: 'expired' };
    expect(isDeadLink(params)).toBe(true);
  });

  it('returns true for any non-empty reason', () => {
    const params: ReadLinkParams = { reason: 'whatever' };
    expect(isDeadLink(params)).toBe(true);
  });

  it('returns false when reason is undefined', () => {
    const params: ReadLinkParams = { jti: 'abc', token: 'jwt' };
    expect(isDeadLink(params)).toBe(false);
  });

  it('returns false when reason is empty string', () => {
    const params: ReadLinkParams = { reason: '' };
    expect(isDeadLink(params)).toBe(false);
  });
});

/**
 * Surface B extension (05-09): the detail page surfaces a status summary and,
 * for a `partial` submission, a read-only warn callout above the form. No
 * retry control is rendered (D-81); the detail page loads no CDN asset
 * (FRM-07) and reuses the mockup token set (AGENTS.md rule 1).
 */
describe('detail status summary (Surface B, D-81/D-82)', () => {
  it('renders a partial warn callout and leaves the form read-only', () => {
    const summary = buildDetailSummary({ status: 'partial', connector: 'Redmine' });
    expect(summary.callout?.kind).toBe('warn');
    expect(summary.callout?.text).toBe('Internal saved · Redmine: retrying');
    expect(summary.badge.className).toBe('badge-partial');
  });

  it('renders a failed danger callout with a user-safe reason', () => {
    const summary = buildDetailSummary({
      status: 'failed',
      connector: 'Redmine',
      reason: 'Redmine is temporarily unavailable. Your submission is saved and will be retried.',
    });
    expect(summary.callout?.kind).toBe('danger');
    expect(summary.callout?.text).toContain('Redmine');
    // No raw transport detail leaks into the user-facing sentence.
    expect(summary.callout?.text).not.toMatch(/[45]\d\d/);
  });

  it('exposes no retry control for any status', () => {
    for (const status of ['completed', 'partial', 'pending_external', 'failed'] as const) {
      const summary = buildDetailSummary({ status });
      expect(summary.callout?.text ?? '').not.toMatch(/\bRetry\b/);
    }
  });

  it('view.html loads no CDN asset (Known Drift #2 removed)', () => {
    expect(VIEW_HTML).not.toContain('cdn.form.io');
    expect(VIEW_HTML).not.toContain('--color-bg');
  });

  it('view.html reuses the mockup token set', () => {
    expect(VIEW_HTML).toMatch(/--accent:\s*#0f9d8f/);
    expect(VIEW_HTML).toMatch(/--canvas:\s*#f6f8fa/);
    expect(VIEW_HTML).toMatch(/--amber-soft:\s*#fdf5e6/);
    expect(VIEW_HTML).toContain('.callout-warn');
  });

  it('view.browser.ts renders read-only and carries no retry control', () => {
    expect(VIEW_BROWSER).toContain('readOnly: true');
    expect(VIEW_BROWSER).not.toMatch(/\bRetry\b/);
  });
});
