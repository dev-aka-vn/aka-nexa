/**
 * Tests for `LinkErrorFilter` — the read-deny mapping (D-70).
 *
 * The existing `LinkErrorCode` path (EXPIRED, INVALID, USED, DENIED, …) is
 * covered by the legacy behaviour tests below. The read-deny half is proven
 * against the `ReadDenyReason` enum: every member maps to a non-empty copy
 * string, the actionable set matches the renderer's, and the IM affordance
 * wording is present on actionable reasons.
 */

import { describe, expect, it } from 'vitest';

import { ReadDenyReason } from '@akane/contract';

import {
  LinkErrorCode,
  LinkErrorFilter,
  type LinkError,
} from './link-error.filter.js';

describe('LinkErrorFilter — legacy LinkErrorCode path (unchanged)', () => {
  it('returns the existing copy for every code', () => {
    for (const code of Object.values(LinkErrorCode)) {
      const message = LinkErrorFilter.getErrorMessage(code);
      expect(message, `missing copy for ${code}`).toBeDefined();
      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it('flags SUCCESS and FAILURE as non-actionable', () => {
    const success = LinkErrorFilter.createError(LinkErrorCode.SUCCESS);
    const failure = LinkErrorFilter.createError(LinkErrorCode.FAILURE);
    expect(success.actionable).toBe(false);
    expect(failure.actionable).toBe(false);
  });

  it('flags every other code as actionable', () => {
    const codes = Object.values(LinkErrorCode).filter(
      (c) => c !== LinkErrorCode.SUCCESS && c !== LinkErrorCode.FAILURE,
    );
    for (const code of codes) {
      expect(LinkErrorFilter.createError(code).actionable).toBe(true);
    }
  });
});

describe('LinkErrorFilter — read-deny mapping (D-70)', () => {
  it('covers every member of ReadDenyReason', () => {
    for (const reason of Object.values(ReadDenyReason)) {
      const copy = LinkErrorFilter.getReadDenyReasonCopy(reason);
      expect(copy, `missing copy for ${reason}`).toBeDefined();
      expect(typeof copy).toBe('string');
      expect(copy.length).toBeGreaterThan(10);
    }
  });

  it('falls back to bad_signature copy for an unknown reason', () => {
    const copy = LinkErrorFilter.getReadDenyReasonCopy(
      'totally_unknown_reason' as ReadDenyReason,
    );
    expect(copy).toBe(
      LinkErrorFilter.getReadDenyReasonCopy(ReadDenyReason.bad_signature),
    );
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
      expect(LinkErrorFilter.isActionableReadDenyReason(reason)).toBe(true);
      const copy = LinkErrorFilter.getReadDenyReasonCopy(reason);
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
      expect(LinkErrorFilter.isActionableReadDenyReason(reason)).toBe(false);
      const copy = LinkErrorFilter.getReadDenyReasonCopy(reason);
      expect(copy).not.toContain('request a new one via IM');
    });
  }

  it('fromReadDenyReason produces a DENIED code with correct actionable flag', () => {
    const err: LinkError = LinkErrorFilter.fromReadDenyReason(
      ReadDenyReason.expired,
    );
    expect(err.code).toBe(LinkErrorCode.DENIED);
    expect(err.message).toContain('request a new one via IM');
    expect(err.actionable).toBe(true);

    const notFound: LinkError = LinkErrorFilter.fromReadDenyReason(
      ReadDenyReason.not_found,
    );
    expect(notFound.code).toBe(LinkErrorCode.DENIED);
    expect(notFound.actionable).toBe(false);
  });

  it('the seven LNK-08 reasons all have copy (actionable set is the six self-serve reasons)', () => {
    const reasons = [
      ReadDenyReason.expired,
      ReadDenyReason.consumed,
      ReadDenyReason.revoked,
      ReadDenyReason.wrong_app,
      ReadDenyReason.wrong_version,
      ReadDenyReason.deactivated_user,
      ReadDenyReason.bad_signature,
    ];
    for (const reason of reasons) {
      const copy = LinkErrorFilter.getReadDenyReasonCopy(reason);
      expect(copy, `missing copy for ${reason}`).toBeDefined();
      expect(copy.length).toBeGreaterThan(10);
    }
    // deactivated_user is a LNK-08 reason but is NOT actionable — the user
    // cannot self-serve by requesting a new link; the account is deactivated.
    expect(LinkErrorFilter.isActionableReadDenyReason(ReadDenyReason.deactivated_user)).toBe(false);
    // consumed is defensive (unreachable for read links) but kept actionable
    // so a stale issuer gets the generic self-serve copy rather than an
    // unhandled case.
    expect(LinkErrorFilter.isActionableReadDenyReason(ReadDenyReason.consumed)).toBe(true);
  });
});