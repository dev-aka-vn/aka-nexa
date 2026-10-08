/**
 * D-73 — the saved-query seed record shape.
 *
 * Saved queries are their own records `{query_id, query_version, dsl, intents,
 * app_id}`: `query_version` bumps independently of app edits, which is what
 * makes D-75's `wrong_version` denial meaningful. This file is a *stored
 * contract* — Phase 6's App Builder writes the same records — so the shape is
 * asserted here rather than trusted, and every seeded DSL is run through the
 * real `DslService.parse` (DAT-10) to prove the seed cannot drift out of the
 * schema the execution path enforces.
 */

import { describe, expect, it } from 'vitest';

import { DslService } from '../dsl/dsl.service.js';
import seed from './saved-queries.seed.json' with { type: 'json' };

const dsl = new DslService();

describe('saved-queries.seed.json (D-73)', () => {
  it('is a non-empty array of saved-query records', () => {
    expect(Array.isArray(seed)).toBe(true);
    expect(seed.length).toBeGreaterThan(0);
  });

  it.each(seed.map((r) => [r.query_id, r] as const))(
    'record %s follows the D-73 shape',
    (_queryId, record) => {
      expect(Object.keys(record).sort()).toEqual([
        'app_id',
        'dsl',
        'intents',
        'query_id',
        'query_version',
      ]);
      expect(record.query_id).toMatch(/^qry_[a-z0-9_]+$/);
      expect(Number.isInteger(record.query_version)).toBe(true);
      expect(record.query_version).toBeGreaterThan(0);
      expect(record.app_id).toBe('leave-request');
      expect(record.intents.length).toBeGreaterThan(0);
      expect(record.intents.every((i) => typeof i === 'string')).toBe(true);
    },
  );

  it('carries unique (app_id, query_id) pairs — the lookup seam keys on both', () => {
    const keys = seed.map((r) => `${r.app_id}:${r.query_id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every seeded DSL passes DAT-10 validation', () => {
    for (const record of seed) {
      const parsed = dsl.parse(record.dsl);
      expect(
        parsed.ok,
        `${record.query_id}: ${parsed.ok ? '' : parsed.issues.join(', ')}`,
      ).toBe(true);
    }
  });
});
