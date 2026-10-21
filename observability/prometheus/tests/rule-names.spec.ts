import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { EXTERNAL_SCRAPED, SCRAPED_NAMES } from '@akane/platform';

const RULES_DIR = resolve(process.cwd(), 'observability/prometheus/rules');

const KEYWORDS = new Set([
  'sum',
  'rate',
  'increase',
  'avg',
  'max',
  'min',
  'histogram_quantile',
  'by',
  'on',
  'and',
  'or',
  'unless',
  'le',
  'job',
  'instance',
  'queue',
  'status',
  'outcome',
  'result',
  'severity',
  'alertname',
  'absent',
]);

function ruleFiles(): string[] {
  return readdirSync(RULES_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => join(RULES_DIR, f));
}

function extractMetricNames(src: string): string[] {
  const out: string[] = [];
  for (const line of src.split(/\r?\n/)) {
    const m = /^\s*(expr|record):\s*(.+)$/.exec(line);
    if (!m) continue;
    // Strip quoted strings (label values) and bracketed durations so they
    // are not mistaken for metric identifiers.
    const expr = m[2].replace(/"[^"]*"/g, '""').replace(/\[[^\]]*\]/g, '[]');
    for (const ident of expr.match(/[a-zA-Z_:][a-zA-Z0-9_:]*/g) ?? []) {
      if (KEYWORDS.has(ident)) continue;
      out.push(ident);
    }
  }
  return out;
}

describe('rule names resolve to emitted metrics (OBS-06)', () => {
  it('extracts a non-vacuous number of metric names', () => {
    const all = ruleFiles().flatMap((f) => extractMetricNames(readFileSync(f, 'utf8')));
    const distinct = new Set(all);
    expect(distinct.size).toBeGreaterThanOrEqual(8);
  });

  it('every extracted metric name is in SCRAPED_NAMES or EXTERNAL_SCRAPED', () => {
    const union = new Set([...SCRAPED_NAMES, ...EXTERNAL_SCRAPED]);
    const all = ruleFiles().flatMap((f) => extractMetricNames(readFileSync(f, 'utf8')));
    const unknown = all.filter((n) => !union.has(n));
    expect(unknown).toEqual([]);
  });

  it('declares exactly eight unique alert names', () => {
    const names: string[] = [];
    for (const f of ruleFiles()) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/^\s*(?:-\s*)?alert:\s*(\S+)\s*$/gm)) {
        names.push(m[1]);
      }
    }
    expect(names).toHaveLength(8);
    expect(new Set(names).size).toBe(8);
  });

  it('every runbook_url resolves to an existing file', () => {
    for (const f of ruleFiles()) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/runbook_url:\s*"?([^"\n]+)"?/g)) {
        const p = resolve(process.cwd(), m[1].trim());
        expect(existsSync(p)).toBe(true);
      }
    }
  });
});
