import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { EXTERNAL_SCRAPED, SCRAPED_NAMES } from '@akane/platform';

const DASH_DIR = resolve(process.cwd(), 'observability/grafana/dashboards');

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
  'absent',
]);

function dashboardFiles(): string[] {
  return readdirSync(DASH_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(DASH_DIR, f));
}

function collectPanels(node: unknown, acc: any[] = []): any[] {
  if (Array.isArray(node)) {
    for (const item of node) collectPanels(item, acc);
    return acc;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.panels)) {
      for (const p of obj.panels) acc.push(p);
    }
    if (Array.isArray(obj.targets)) {
      // panel itself
    }
    for (const v of Object.values(obj)) collectPanels(v, acc);
  }
  return acc;
}

function extractFromExpr(expr: string): string[] {
  const out: string[] = [];
  const cleaned = expr.replace(/"[^"]*"/g, '""').replace(/\[[^\]]*\]/g, '[]');
  for (const ident of cleaned.match(/[a-zA-Z_:][a-zA-Z0-9_:]*/g) ?? []) {
    if (KEYWORDS.has(ident)) continue;
    out.push(ident);
  }
  return out;
}

describe('dashboard queries resolve to emitted metrics (OBS-09)', () => {
  it('loads at least two dashboards with panels (non-vacuous)', () => {
    const files = dashboardFiles();
    expect(files.length).toBeGreaterThanOrEqual(2);
    let panelCount = 0;
    for (const f of files) {
      const json = JSON.parse(readFileSync(f, 'utf8'));
      panelCount += collectPanels(json).length;
    }
    expect(panelCount).toBeGreaterThanOrEqual(8);
  });

  it('every panel expr metric name is in SCRAPED_NAMES or EXTERNAL_SCRAPED', () => {
    const union = new Set([...SCRAPED_NAMES, ...EXTERNAL_SCRAPED]);
    const unknown: string[] = [];
    for (const f of dashboardFiles()) {
      const json = JSON.parse(readFileSync(f, 'utf8'));
      const panels = collectPanels(json);
      for (const panel of panels) {
        const targets = Array.isArray(panel?.targets) ? panel.targets : [];
        for (const t of targets) {
          if (typeof t?.expr !== 'string') continue;
          for (const name of extractFromExpr(t.expr)) {
            if (!union.has(name)) unknown.push(name);
          }
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it('dashboard files are valid JSON', () => {
    for (const f of dashboardFiles()) {
      expect(() => JSON.parse(readFileSync(f, 'utf8'))).not.toThrow();
    }
  });
});
