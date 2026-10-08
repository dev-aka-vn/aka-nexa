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
import { describe, expect, it } from 'vitest';

import { ReadDenyReason } from '@akane/contract';

import {
  DENY_REASON_COPY,
  getDenyReasonCopy,
  parseReadLinkUrl,
  isDeadLink,
  type ReadLinkParams,
} from './view.js';

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
