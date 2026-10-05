import { describe, expect, it } from 'vitest';

import { RateLimitKeySchema } from './rate-limit-key.js';

/**
 * AUD-10: rate limiting is applied **per user and per link `jti`, never per
 * IP**, and blocks only on signature failure.
 *
 * The "never per IP" half of that rule is a *type* property, not a policy
 * statement. A throttler key that admits an address-shaped scope is a per-IP
 * limiter one refactor away from being switched on, and the failure mode is
 * quiet: everyone behind one corporate NAT shares one bucket, and the platform
 * rate-limits an entire office. So the union has no third member and
 * `ip`/`address`/`remote_addr` are not expressible at all — asserted here by
 * value, not by a negative grep.
 */
describe('RateLimitKeySchema (AUD-10)', () => {
  it('admits a user-scoped key', () => {
    const result = RateLimitKeySchema.safeParse({ scope: 'user', id: 'usr_42' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ scope: 'user', id: 'usr_42' });
    }
  });

  it('admits a link-scoped key keyed by jti', () => {
    const result = RateLimitKeySchema.safeParse({ scope: 'link', id: 'jti_01' });

    expect(result.success).toBe(true);
  });

  it('rejects a third scope — the union has exactly two members', () => {
    expect(RateLimitKeySchema.safeParse({ scope: 'ip', id: '10.0.0.7' }).success).toBe(
      false,
    );
    expect(RateLimitKeySchema.safeParse({ scope: 'address', id: '10.0.0.7' }).success).toBe(
      false,
    );
    expect(RateLimitKeySchema.safeParse({ scope: 'app', id: 'hr-leave' }).success).toBe(
      false,
    );
  });

  it('refuses an empty id, so a scope can never key an unbounded bucket', () => {
    expect(RateLimitKeySchema.safeParse({ scope: 'user', id: '' }).success).toBe(false);
  });

  it('rejects an unlisted key rather than stripping it', () => {
    expect(
      RateLimitKeySchema.safeParse({ scope: 'user', id: 'usr_42', limit: 1000 }).success,
    ).toBe(false);
  });
});
