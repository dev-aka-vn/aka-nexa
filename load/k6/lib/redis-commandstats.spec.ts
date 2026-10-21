import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseCommandStats,
  deltaCommandStats,
  reportCommandStats,
} from './redis-commandstats.js';

const SAMPLE = `# Commandstats
cmdstat_get:calls=10,usec=100,usec_per_call=10.00
cmdstat_set:calls=5,usec=50,usec_per_call=10.00,rejected_calls=0,failed_calls=0
cmdstat_incr:calls=3,usec=30,usec_per_call=10.00
`;

describe('parseCommandStats', () => {
  it('parses per-command call and usec totals', () => {
    const r = parseCommandStats(SAMPLE);
    expect(r.get).toEqual({ calls: 10, usec: 100 });
    expect(r.set).toMatchObject({ calls: 5, usec: 50, rejectedCalls: 0, failedCalls: 0 });
  });

  it('handles an extra command', () => {
    const r = parseCommandStats(SAMPLE + 'cmdstat_del:calls=1,usec=2,usec_per_call=2.00\n');
    expect(r.del).toEqual({ calls: 1, usec: 2 });
  });

  it('skips a malformed line without throwing', () => {
    expect(() => parseCommandStats(SAMPLE + 'garbage line here\n')).not.toThrow();
    const r = parseCommandStats(SAMPLE + 'garbage line here\n');
    expect(r.get).toBeDefined();
  });

  it('returns empty object for absent section', () => {
    expect(parseCommandStats('')).toEqual({});
    expect(parseCommandStats(null as unknown as string)).toEqual({});
  });
});

describe('deltaCommandStats', () => {
  it('produces per-command deltas', () => {
    const before = parseCommandStats('cmdstat_get:calls=10,usec=100,usec_per_call=10.00\n');
    const after = parseCommandStats('cmdstat_get:calls=15,usec=160,usec_per_call=10.00\n');
    const d = deltaCommandStats(before, after);
    expect(d.get).toEqual({ calls: 5, usec: 60 });
  });
});

describe('reportCommandStats', () => {
  it('divides by request count and states it', () => {
    const delta = { get: { calls: 10, usec: 100 } };
    const r = reportCommandStats(delta, 5);
    expect(r.requestCount).toBe(5);
    expect(r.perRequestCost.get.calls).toBe(2);
    expect(r.perRequestCost.get.usec).toBe(20);
  });

  it('yields no ratio for zero request count', () => {
    const delta = { get: { calls: 10, usec: 100 } };
    const r = reportCommandStats(delta, 0);
    expect(r.requestCount).toBe(0);
    expect(r.perRequestCost).toBeUndefined();
  });
});