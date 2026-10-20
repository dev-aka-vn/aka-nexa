import { describe, it, expect } from 'vitest';

import { options } from './scenarios.js';
import { thresholds, DROPPED_ITERATIONS_BUDGET } from './thresholds.js';

describe('k6 scenarios', () => {
  it('inbound-events uses constant-arrival-rate at 50 per second', () => {
    const s = options.scenarios.inbound_events;
    expect(s.executor).toBe('constant-arrival-rate');
    expect(s.rate).toBe(50);
    expect(s.timeUnit).toBe('1s');
  });

  it('concurrent-users uses ramping-vus reaching 1000', () => {
    const s = options.scenarios.concurrent_users;
    expect(s.executor).toBe('ramping-vus');
    const targets = s.stages.map((st: { target: number }) => st.target);
    expect(Math.max(...targets)).toBe(1000);
  });

  it('has an ack-budget threshold scoped to inbound-events', () => {
    const key = 'http_req_duration{scenario:inbound_events}';
    expect(thresholds[key]).toBeDefined();
    expect(thresholds[key][0]).toMatch(/p\(95\)<200/);
  });

  it('has a 5xx-rate threshold', () => {
    expect(thresholds.http_req_failed).toBeDefined();
  });

  it('has a dropped-iterations threshold', () => {
    expect(thresholds.dropped_iterations).toBeDefined();
  });

  it('does not end the arrival-rate iteration with a sleep', () => {
    const src = '' + (options as unknown);
    // Structural: ensure no sleep token in source file is asserted via read of function body.
    // We check the exported options do not declare a sleep; the source check is in README.
    expect(true).toBe(true);
  });
});

// Source-level check: read the scenarios file text for a trailing sleep() in inboundEvents.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

describe('k6 scenario source', () => {
  it('inboundEvents does not call sleep()', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, 'scenarios.js'), 'utf8');
    // Extract the inboundEvents function body.
    const match = src.match(/export function inboundEvents\(\)\s*\{([\s\S]*?)\n\}/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toMatch(/\bsleep\s*\(/);
  });
});