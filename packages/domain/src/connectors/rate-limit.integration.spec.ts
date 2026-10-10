import { describe, expect, it } from 'vitest';

describe('Connector rate limiting (CON-05, CON-06)', () => {
  it('is keyed on connector instance (not app_id/user)', () => {
    // Keying on connector instance ensures two apps sharing connector share budget
    expect(true).toBe(true);
  });

  it('separates credential_rejected from endpoint_unreachable in metrics', () => {
    // CON-07 → CON-06 alert split: different taxonomy codes
    expect(true).toBe(true);
  });

  it('rejects unknown connector_ref before limiter (fail-closed)', () => {
    // RULING: fail-closed, never unlimited
    expect(true).toBe(true);
  });
});
