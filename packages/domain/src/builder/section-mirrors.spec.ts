/**
 * Drift guard for the four section mirror lists (07-02, T-07-04).
 *
 * The BLD-02 vocabulary is mirrored in four places:
 *   1. `SectionNameSchema.options` (contract) — the source of truth.
 *   2. `SECTION_FIELDS` (repository) — one top-level field per section.
 *   3. `APP_SECTION_PERMISSIONS` (authz) — permission matrix rows.
 *   4. `APP_SECTIONS` / `SECTION_LABELS` / `SECTION_FIELDS` (SPA) — not
 *      importable here (domain → apps is outside the boundary graph), so
 *      the SPA side is asserted in the e2e suites instead.
 *
 * These must stay set-equal; a drift is a privilege hole, not a typo.
 */

import { describe, expect, it } from 'vitest';

import { SectionNameSchema } from '@akane/contract';

import { SECTION_FIELDS as REPO_SECTION_FIELDS } from './data-access/app-definition.repository.js';
import { APP_SECTION_PERMISSIONS } from '../authz/builder-ability.js';

function asSet(values: readonly string[]): Set<string> {
  return new Set(values);
}

describe('section mirror drift guard', () => {
  it('contract, repository, and authz lists are set-equal', () => {
    const contract = asSet(SectionNameSchema.options as readonly string[]);
    const repo = asSet(Object.keys(REPO_SECTION_FIELDS));
    const authz = asSet(APP_SECTION_PERMISSIONS as readonly string[]);

    expect(repo).toEqual(contract);
    expect(authz).toEqual(contract);
  });

  it('SectionNameSchema has exactly 12 options and no triggers', () => {
    expect(SectionNameSchema.options.length).toBe(12);
    expect(SectionNameSchema.options as readonly string[]).not.toContain(
      'triggers',
    );
  });

  it('each section owns exactly one top-level document field (S3), except general & metadata', () => {
    expect(REPO_SECTION_FIELDS['forms']).toEqual(['forms']);
    expect(REPO_SECTION_FIELDS['general']).toEqual(['name', 'description']);
    expect(REPO_SECTION_FIELDS['metadata']).toEqual(['tags', 'data_mode']);
    for (const section of SectionNameSchema.options as readonly string[]) {
      expect(REPO_SECTION_FIELDS[section as keyof typeof REPO_SECTION_FIELDS]).toBeDefined();
    }
  });

  it('a drifted list fails the guard (negative control)', () => {
    const drifted = new Set(SectionNameSchema.options as readonly string[]);
    drifted.add('triggers');
    expect(drifted).not.toEqual(
      asSet(SectionNameSchema.options as readonly string[]),
    );
  });
});
