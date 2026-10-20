/**
 * Q6 WINDOW 5 probe outcome: removal of the `msg` field from
 * LOG_FIELD_ALLOWLIST was NOT attempted. The drift test
 * (packages/platform/src/logging/log-allowlist.formatter.spec.ts) asserts the
 * allowlist is exactly the 24 named fields including `msg`, and
 * pino.config.spec.ts builds records carrying `msg`, so dropping `msg` would
 * break the gate. WINDOW 5 therefore remains open: `msg` is emitted verbatim by
 * pino after formatters.log runs, and no automated test can catch an
 * interpolation into a log message.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(process.cwd(), 'observability/deploy/log-retention.yml');

describe('log retention (OBS-07)', () => {
  it('reads the deploy file rather than a constant', () => {
    const src = readFileSync(FILE, 'utf8');
    expect(src).toContain('hot_retention_days');
    expect(src).toContain('cold_retention_days');
  });

  it('hot retention is exactly 30 days and cold retention is at least 365', () => {
    const src = readFileSync(FILE, 'utf8');
    const hot = Number((src.match(/hot_retention_days:\s*(\d+)/) ?? [])[1]);
    const cold = Number((src.match(/cold_retention_days:\s*(\d+)/) ?? [])[1]);
    expect(hot).toBe(30);
    expect(cold).toBeGreaterThanOrEqual(365);
  });
});
