/**
 * TDD proofs for the "My submissions" status list (Surface A, DAT-14/D-80)
 * and the shared submission-status mapping used by the read-only detail
 * (Surface B, D-81/D-82).
 *
 * The FormIO rendering itself is browser-only (proved by Playwright later);
 * these tests lock in the pure logic and the static markup invariants that
 * keep the contract honest:
 * - the status → badge → destination-phrase map from 05-UI-SPEC Surface A
 * - the pagination window and empty state copy
 * - the "no user-facing retry" prohibition (D-81)
 * - the "no CDN asset" prohibition (FRM-07)
 * - the mockup `:root` token set (AGENTS.md rule 1)
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  EMPTY_STATE,
  LIST_LOAD_ERROR,
  STATUS_FILTERS,
  buildDetailSummary,
  canEdit,
  computePageWindow,
  destinationPhrase,
  filterRowsByStatus,
  formatSubmittedAt,
  hasRetryControl,
  isEmpty,
  isOwned,
  statusToBadge,
  type StatusRow,
} from './status.js';

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const STATUS_HTML = read('./status.html');
const VIEW_HTML = read('./view.html');
const VIEW_BROWSER = read('./view.browser.ts');

describe('statusToBadge (Surface A — status → badge map)', () => {
  it('maps completed to the green completed badge', () => {
    expect(statusToBadge('completed')).toEqual({
      className: 'badge-completed',
      label: 'Completed',
    });
  });

  it('maps partial to the amber partial badge', () => {
    expect(statusToBadge('partial')).toEqual({
      className: 'badge-partial',
      label: 'Partial',
    });
  });

  it('maps pending_external to the blue pending badge', () => {
    expect(statusToBadge('pending_external')).toEqual({
      className: 'badge-pending',
      label: 'Pending external',
    });
  });

  it('maps failed to the red failed badge', () => {
    expect(statusToBadge('failed')).toEqual({
      className: 'badge-failed',
      label: 'Failed',
    });
  });
});

describe('destinationPhrase (Surface A / D-81 / D-82)', () => {
  const row = (over: Partial<StatusRow>): StatusRow => ({
    status: 'completed',
    ...over,
  });

  it('completed internal → "Internal saved"', () => {
    expect(destinationPhrase(row({ status: 'completed' }))).toBe('Internal saved');
  });

  it('completed external → "{Connector} · {reference}"', () => {
    expect(
      destinationPhrase(row({ status: 'completed', connector: 'Redmine', downstreamRef: '#4821' })),
    ).toBe('Redmine · #4821');
  });

  it('partial → "Internal saved · {Connector}: retrying" (read-only, D-81)', () => {
    expect(destinationPhrase(row({ status: 'partial', connector: 'Redmine' }))).toBe(
      'Internal saved · Redmine: retrying',
    );
  });

  it('pending_external → "{Connector}: sending"', () => {
    expect(
      destinationPhrase(row({ status: 'pending_external', connector: 'Redmine' })),
    ).toBe('Redmine: sending');
  });

  it('failed → the user-safe reason, never a raw HTTP body', () => {
    const reason =
      'The Redmine integration is not available right now. Your submission is saved.';
    expect(destinationPhrase(row({ status: 'failed', reason }))).toBe(reason);
  });

  it('failed with no reason falls back to a safe sentence', () => {
    const phrase = destinationPhrase(row({ status: 'failed', connector: 'Redmine' }));
    expect(phrase).toContain('Redmine');
    expect(phrase).not.toContain('stack');
    expect(phrase).not.toContain('credential');
  });
});

describe('computePageWindow (Surface A — pagination)', () => {
  it('renders no footer and no Load more for an empty list', () => {
    const w = computePageWindow(0, 25, 0);
    expect(w.label).toBe('');
    expect(w.hasMore).toBe(false);
  });

  it('shows an en-dash window on the first page', () => {
    expect(computePageWindow(0, 25, 80).label).toBe('Showing 1–25 of 80');
    expect(computePageWindow(0, 25, 80).hasMore).toBe(true);
  });

  it('clamps the end to the total on the last page and hides Load more', () => {
    const w = computePageWindow(75, 25, 80);
    expect(w.label).toBe('Showing 76–80 of 80');
    expect(w.hasMore).toBe(false);
  });

  it('does not offer Load more exactly at the boundary', () => {
    expect(computePageWindow(0, 25, 25).hasMore).toBe(false);
  });
});

describe('filterRowsByStatus / ownership (Surface A)', () => {
  const rows: StatusRow[] = [
    { status: 'completed', owned: true },
    { status: 'partial', owned: false },
    { status: 'failed', owned: true },
  ];

  it('"all" returns every row', () => {
    expect(filterRowsByStatus(rows, 'all')).toHaveLength(3);
  });

  it('filters to a single status', () => {
    expect(filterRowsByStatus(rows, 'partial')).toEqual([{ status: 'partial', owned: false }]);
  });

  it('offers a filter chip per status plus All', () => {
    expect(STATUS_FILTERS.map((f) => f.status)).toEqual([
      'all',
      'completed',
      'partial',
      'pending_external',
      'failed',
    ]);
  });

  it('shows the Edit submission affordance only for owned rows (D-93)', () => {
    expect(canEdit(rows[0])).toBe(true);
    expect(canEdit(rows[1])).toBe(false);
    expect(isOwned(rows[2])).toBe(true);
  });

  it('detects the empty list', () => {
    expect(isEmpty([])).toBe(true);
    expect(isEmpty(rows)).toBe(false);
  });
});

describe('copy contract (Surface A)', () => {
  it('uses the empty-state heading verbatim', () => {
    expect(EMPTY_STATE.heading).toBe('No submissions yet');
  });

  it('uses the empty-state body verbatim', () => {
    expect(EMPTY_STATE.body).toBe(
      'Nothing has been submitted for this app yet. Start one from chat and it will appear here.',
    );
  });

  it('uses the list-load failure copy verbatim', () => {
    expect(LIST_LOAD_ERROR).toBe(
      "Couldn't load your submissions. Request a new status link in chat and try again.",
    );
  });
});

describe('no user-facing retry control (D-81)', () => {
  it('the module exposes no retry control', () => {
    expect(hasRetryControl()).toBe(false);
  });

  it('the status markup contains no retry control button', () => {
    // The required `partial` phrase uses the lowercase word "retrying"; a user
    // control would be a capitalised standalone "Retry".
    expect(STATUS_HTML).not.toMatch(/\bRetry\b/);
    expect(STATUS_HTML.toLowerCase()).not.toContain('retry external');
  });

  it('the detail markup and script contain no retry control', () => {
    expect(VIEW_HTML).not.toMatch(/\bRetry\b/);
    expect(VIEW_BROWSER).not.toMatch(/\bRetry\b/);
    expect(VIEW_BROWSER.toLowerCase()).not.toContain('retry external');
  });
});

describe('buildDetailSummary (Surface B, D-81/D-82)', () => {
  it('partial → a warn callout with the retrying phrase and no retry control', () => {
    const s = buildDetailSummary({ status: 'partial', connector: 'Redmine' });
    expect(s.badge.className).toBe('badge-partial');
    expect(s.destination).toBe('Internal saved · Redmine: retrying');
    expect(s.callout?.kind).toBe('warn');
    expect(s.callout?.text).toBe('Internal saved · Redmine: retrying');
    expect(s.callout?.detail).toBeTruthy();
    expect(s.callout?.text).not.toMatch(/\bRetry\b/);
  });

  it('failed → a danger callout carrying the user-safe reason', () => {
    const s = buildDetailSummary({
      status: 'failed',
      connector: 'Redmine',
      reason: 'Redmine is temporarily unavailable. Your submission is saved and will be retried.',
    });
    expect(s.badge.className).toBe('badge-failed');
    expect(s.callout?.kind).toBe('danger');
    expect(s.callout?.text).toContain('Redmine');
  });

  it('completed → a green badge and the internal phrase, no callout', () => {
    const s = buildDetailSummary({ status: 'completed' });
    expect(s.badge.className).toBe('badge-completed');
    expect(s.destination).toBe('Internal saved');
    expect(s.callout).toBeNull();
  });

  it('pending_external → a blue badge and the sending phrase', () => {
    const s = buildDetailSummary({ status: 'pending_external', connector: 'Redmine' });
    expect(s.badge.className).toBe('badge-pending');
    expect(s.destination).toBe('Redmine: sending');
  });

  it('defaults an absent status to completed', () => {
    expect(buildDetailSummary({}).badge.className).toBe('badge-completed');
  });
});

describe('formatSubmittedAt', () => {
  it('renders an ISO date for a valid timestamp', () => {
    expect(formatSubmittedAt('2026-10-10T12:34:56.000Z')).toBe('2026-10-10');
  });

  it('returns an empty string for a missing value', () => {
    expect(formatSubmittedAt(undefined)).toBe('');
  });
});

describe('static markup invariants (FRM-07, AGENTS.md rule 1)', () => {
  it('status.html loads no CDN asset', () => {
    expect(STATUS_HTML).not.toContain('cdn.form.io');
    expect(STATUS_HTML).not.toMatch(/https?:\/\//);
  });

  it('view.html loads no CDN asset (Known Drift #2 removed)', () => {
    expect(VIEW_HTML).not.toContain('cdn.form.io');
  });

  it('status.html reuses the mockup token set and primitives', () => {
    expect(STATUS_HTML).toMatch(/--accent:\s*#0f9d8f/);
    expect(STATUS_HTML).toMatch(/--canvas:\s*#f6f8fa/);
    expect(STATUS_HTML).toMatch(/--amber-soft:\s*#fdf5e6/);
    for (const cls of ['.table-wrap', '.empty', '.badge-partial', '.page-head', '.chip']) {
      expect(STATUS_HTML).toContain(cls);
    }
  });

  it('status.html does not carry a second (drifted) palette', () => {
    expect(STATUS_HTML).not.toContain('--color-bg');
    expect(STATUS_HTML).not.toContain('#f8fafc');
  });

  it('the detail bundle imports the npm engine (self-hosted)', () => {
    expect(VIEW_BROWSER).toContain("from '@formio/js'");
    expect(VIEW_BROWSER).toContain('@formio/js/dist/');
  });
});
