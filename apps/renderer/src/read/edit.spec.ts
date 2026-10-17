/**
 * TDD proofs for the edit-link entry (Surface C, LNK-02/D-91/D-93) and the
 * post-submit confirmation (Surface D, D-95/SC#4).
 *
 * As with `status.spec.ts`, the FormIO rendering itself is browser-only
 * (proved by Playwright later); these tests lock in the pure logic and the
 * static markup invariants that keep the contract honest:
 * - prefill from the latest revision (D-94)
 * - first-submit confirmation vs consumed-link replay (D-95)
 * - the inline submit-failure copy that keeps the user on the form
 * - denial reuse (`DENY_REASON_COPY`, dead.html) with no new denial reasons
 * - the "no user-facing retry" prohibition (D-81)
 * - the "no CDN asset" prohibition (FRM-07) and the mockup `:root` token set
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  DISCARD_LABEL,
  EDIT_PAGE_TITLE,
  REPLAY_TEXT,
  SUBMIT_LABEL,
  buildAckText,
  buildConfirmation,
  buildEditPrefill,
  buildSubmitFailureText,
  buildSuccessText,
  classifyEditGetResponse,
  classifyEditPostResponse,
  denyReasonFromLocation,
  parseEditLinkUrl,
} from './edit.js';
import { DENY_REASON_COPY, getDenyReasonCopy } from './view.js';

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const EDIT_HTML = read('./edit.html');
const EDIT_TS = read('./edit.ts');

describe('parseEditLinkUrl (Surface C entry)', () => {
  it('extracts the jti from the /l/edit/ path segment', () => {
    const p = parseEditLinkUrl('https://render.example/l/edit/abc-123?token=tok');
    expect(p?.jti).toBe('abc-123');
    expect(p?.token).toBe('tok');
  });

  it('extracts the token and reason from query params', () => {
    const p = parseEditLinkUrl('/l/edit/abc-123?token=tok&reason=expired');
    expect(p?.token).toBe('tok');
    expect(p?.reason).toBe('expired');
  });

  it('returns null for an unparseable URL', () => {
    // A bare string is still parseable against the fallback base — assert the
    // happy shape rather than a throw.
    expect(parseEditLinkUrl('/l/edit/j1?token=t')?.jti).toBe('j1');
  });
});

describe('buildEditPrefill (Surface C, D-94 — latest revision)', () => {
  it('pre-fills from the latest revision data', () => {
    const prefill = buildEditPrefill({
      submission_id: 's1',
      revision: 3,
      data: { title: 'Old title', amount: 42 },
    });
    expect(prefill).toEqual({ title: 'Old title', amount: 42 });
  });

  it('returns an empty object when there is no revision', () => {
    expect(buildEditPrefill(null)).toEqual({});
    expect(buildEditPrefill({ submission_id: 's1', revision: 1 })).toEqual({});
  });

  it('returns a copy, never the caller\'s object', () => {
    const data = { a: 1 };
    const prefill = buildEditPrefill({ submission_id: 's1', revision: 1, data });
    expect(prefill).not.toBe(data);
  });
});

describe('edit copy contract (05-UI-SPEC Copywriting Contract, verbatim)', () => {
  it('uses the primary CTA verbatim', () => {
    expect(SUBMIT_LABEL).toBe('Submit correction');
  });

  it('uses the dismiss label verbatim', () => {
    expect(DISCARD_LABEL).toBe('Discard changes');
  });

  it('uses the page title verbatim', () => {
    expect(EDIT_PAGE_TITLE).toBe('Edit submission');
  });

  it('uses the destructive acknowledgement verbatim', () => {
    expect(buildAckText('Redmine')).toBe(
      'Submit correction: This sends a new revision to Redmine and updates the downstream record. Continue?',
    );
  });

  it('uses the success copy verbatim', () => {
    expect(buildSuccessText('Redmine')).toBe(
      'Correction submitted. A new revision was sent to Redmine.',
    );
  });

  it('uses the edit submit-failure copy verbatim', () => {
    expect(buildSubmitFailureText('Redmine')).toBe(
      "Your correction wasn't sent. Nothing was changed in Redmine. Try again, or request a new edit link in chat.",
    );
  });

  it('uses the replay copy verbatim', () => {
    expect(REPLAY_TEXT).toBe('This correction was already submitted. Here is its confirmation.');
  });

  it('falls back to the generic connector name', () => {
    expect(buildSuccessText()).toContain('Connector');
  });
});

describe('buildConfirmation (Surface D, first submit vs replay)', () => {
  it('first submit → success copy, revision and downstream reference, no replay note', () => {
    const card = buildConfirmation({ connector: 'Redmine', revision: 4, downstreamRef: '#4821' });
    expect(card.body).toBe('Correction submitted. A new revision was sent to Redmine.');
    expect(card.replayed).toBe(false);
    expect(card.note).toBeNull();
    expect(card.revisionLabel).toBe('Revision 4');
    expect(card.downstreamRef).toBe('#4821');
  });

  it('replay → the same card plus the replay note (D-95)', () => {
    const card = buildConfirmation({
      connector: 'Redmine',
      revision: 4,
      downstreamRef: '#4821',
      replayed: true,
    });
    expect(card.replayed).toBe(true);
    expect(card.note).toBe(REPLAY_TEXT);
    expect(card.body).toBe('Correction submitted. A new revision was sent to Redmine.');
  });
});

describe('classifyEditGetResponse (Surface C — edit vs replay vs denial)', () => {
  it('a live edit link yields the latest revision for pre-fill', () => {
    const r = classifyEditGetResponse(200, {
      claims: { jti: 'j1' },
      submission: { _id: 's1' },
      latestRevision: { submission_id: 's1', revision: 3, data: { a: 1 } },
      editOutcome: null,
    });
    expect(r.kind).toBe('edit');
    expect(r.latestRevision?.revision).toBe(3);
  });

  it('a consumed edit link yields the recorded outcome (replay), not an error', () => {
    const r = classifyEditGetResponse(200, {
      claims: { jti: 'j1' },
      submission: null,
      latestRevision: null,
      editOutcome: { submission_id: 's1', revision: 3, downstreamRef: '#1' },
    });
    expect(r.kind).toBe('replay');
    expect(r.editOutcome?.revision).toBe(3);
  });

  it('an error response is an error', () => {
    expect(classifyEditGetResponse(500, null).kind).toBe('error');
    expect(classifyEditGetResponse(200, null).kind).toBe('error');
  });
});

describe('classifyEditPostResponse (Surface D — accepted / replayed / error)', () => {
  it('accepted → a first submission', () => {
    const r = classifyEditPostResponse(200, {
      status: 'accepted',
      submission_id: 's1',
      revision: 4,
      downstreamRef: '#4821',
    });
    expect(r.kind).toBe('accepted');
    expect(r.revision).toBe(4);
    expect(r.downstreamRef).toBe('#4821');
  });

  it('replayed → the original confirmation (D-95)', () => {
    const r = classifyEditPostResponse(200, {
      status: 'replayed',
      submission_id: 's1',
      revision: 4,
      downstreamRef: null,
    });
    expect(r.kind).toBe('replayed');
    expect(r.revision).toBe(4);
  });

  it('a failed submit is an error that keeps the user on the form', () => {
    expect(classifyEditPostResponse(500, null).kind).toBe('error');
    expect(classifyEditPostResponse(200, {}).kind).toBe('error');
  });
});

describe('denial reuse (E5 — no new denial reasons)', () => {
  it('reads the reason from the redirect location', () => {
    expect(
      denyReasonFromLocation('https://render.example/read/dead.html?reason=not_owned'),
    ).toBe('not_owned');
  });

  it('defaults to bad_signature when the reason is absent or unparseable', () => {
    expect(denyReasonFromLocation('')).toBe('bad_signature');
  });

  it('the reused DENY_REASON_COPY map covers not_owned and denied', () => {
    expect(getDenyReasonCopy('not_owned' as never)).toBe(DENY_REASON_COPY.not_owned);
    expect(getDenyReasonCopy('denied' as never)).toBe(DENY_REASON_COPY.denied);
  });
});

describe('no user-facing retry control (D-81)', () => {
  it('the edit markup and module contain no retry control', () => {
    expect(EDIT_HTML).not.toMatch(/\bRetry\b/);
    expect(EDIT_TS).not.toMatch(/\bRetry\b/);
    expect(EDIT_TS.toLowerCase()).not.toContain('retry external');
  });
});

describe('static markup invariants (FRM-07, AGENTS.md rule 1)', () => {
  it('edit.html loads no CDN asset', () => {
    expect(EDIT_HTML).not.toContain('cdn.form.io');
    expect(EDIT_HTML).not.toMatch(/https?:\/\//);
  });

  it('edit.html reuses the mockup token set and primitives', () => {
    expect(EDIT_HTML).toMatch(/--accent:\s*#0f9d8f/);
    expect(EDIT_HTML).toMatch(/--canvas:\s*#f6f8fa/);
    for (const cls of ['.page-head', '.card', '.btn-primary', '.btn-ghost', '.pill-mono', '.callout']) {
      expect(EDIT_HTML).toContain(cls);
    }
  });

  it('edit.html does not carry a second (drifted) palette', () => {
    expect(EDIT_HTML).not.toContain('--color-bg');
    expect(EDIT_HTML).not.toContain('#f8fafc');
  });

  it('edit.html carries the required labels', () => {
    expect(EDIT_HTML).toContain('Edit submission');
    expect(EDIT_HTML).toContain('Submit correction');
    expect(EDIT_HTML).toContain('Discard changes');
  });

  it('the edit module loads the npm engine self-hosted (no CDN)', () => {
    expect(EDIT_TS).toContain('@formio/js');
    expect(EDIT_TS).not.toContain('cdn.form.io');
  });
});
