/**
 * Edit-link entry (Surface C, LNK-02/D-91/D-93/D-94) and post-submit
 * confirmation (Surface D, D-95/SC#4).
 *
 * Contract: `05-UI-SPEC.md` §C/§D, `05-CONTEXT.md` D-91…D-95.
 *
 * This module is deliberately DOM-free at import time so it is testable in a
 * Node environment: the pure copy / prefill / classification helpers are
 * exported and the browser entry (`initEdit`) is a guarded function. The
 * FormIO engine is imported dynamically inside the browser entry so importing
 * the module never pulls a DOM-only or CSS dependency into the test runner.
 */

import { DEFAULT_CONNECTOR } from './status.js';

/** Surface C copy (05-UI-SPEC Copywriting Contract). */
export const EDIT_PAGE_TITLE = 'Edit submission';
export const SUBMIT_LABEL = 'Submit correction';
export const DISCARD_LABEL = 'Discard changes';

/** Surface D replay copy (D-95). */
export const REPLAY_TEXT =
  'This correction was already submitted. Here is its confirmation.';

/** The consequential pre-submit acknowledgement (05-UI-SPEC §Copywriting). */
export function buildAckText(connector = DEFAULT_CONNECTOR): string {
  return `Submit correction: This sends a new revision to ${connector} and updates the downstream record. Continue?`;
}

/** The success copy (05-UI-SPEC Copywriting Contract). */
export function buildSuccessText(connector = DEFAULT_CONNECTOR): string {
  return `Correction submitted. A new revision was sent to ${connector}.`;
}

/** The inline submit-failure copy — the user stays on the form. */
export function buildSubmitFailureText(connector = DEFAULT_CONNECTOR): string {
  return `Your correction wasn't sent. Nothing was changed in ${connector}. Try again, or request a new edit link in chat.`;
}

// ---------------------------------------------------------------------------
// Pure helpers (Node-testable)
// ---------------------------------------------------------------------------

export interface EditLinkParams {
  readonly jti?: string;
  readonly token?: string;
  readonly reason?: string;
}

/**
 * Parses an edit-link URL, extracting the `jti` from the `/l/edit/{jti}` path
 * segment and the `token` / `reason` from the query string — the same shape
 * `view.ts` accepts for read links (no cookie).
 */
export function parseEditLinkUrl(url: string): EditLinkParams | null {
  try {
    const parsed = new URL(url, 'https://render.example');
    const token = parsed.searchParams.get('token') ?? undefined;
    const reason = parsed.searchParams.get('reason') ?? undefined;

    let jti = parsed.searchParams.get('jti') ?? undefined;
    if (!jti && parsed.pathname.includes('/l/edit/')) {
      const parts = parsed.pathname.split('/l/edit/');
      if (parts.length > 1 && parts[1]) {
        jti = parts[1].split('?')[0].split('#')[0] || undefined;
      }
    }

    return { jti, token, reason };
  } catch {
    return null;
  }
}

/** A latest revision as returned by `GET /l/edit/:jti` (D-94 pre-fill source). */
export interface RevisionLike {
  submission_id?: string;
  revision?: number;
  data?: Record<string, unknown>;
  downstreamReference?: string | null;
}

/**
 * Pre-fills the editable form from the latest revision (D-94). Reuses the
 * `PrefillService` idiom (a pure builder over the server-returned shape).
 * Returns a fresh object so the caller cannot mutate the payload.
 */
export function buildEditPrefill(
  latestRevision: RevisionLike | null | undefined,
): Record<string, unknown> {
  if (!latestRevision || !latestRevision.data) {
    return {};
  }
  return { ...latestRevision.data };
}

export interface EditGetInput {
  claims?: Record<string, unknown>;
  submission?: { _id?: string; form_schema?: Record<string, unknown>; data?: Record<string, unknown>; form_label?: string } | null;
  latestRevision?: RevisionLike | null;
  editOutcome?: { submission_id?: string; revision?: number; downstreamRef?: string | null } | null;
}

export interface EditGetResult {
  kind: 'edit' | 'replay' | 'error';
  latestRevision?: RevisionLike | null;
  editOutcome?: EditGetInput['editOutcome'];
}

/**
 * Classifies the `GET /l/edit/:jti` response. A consumed link (a recorded
 * outcome) is a **replay** — never an error and never the dead-link page
 * (D-95). A live link yields the latest revision for pre-fill.
 */
export function classifyEditGetResponse(
  httpStatus: number,
  payload: EditGetInput | null,
): EditGetResult {
  if (httpStatus >= 400 || !payload) {
    return { kind: 'error' };
  }
  if (payload.editOutcome) {
    return { kind: 'replay', editOutcome: payload.editOutcome, latestRevision: null };
  }
  return { kind: 'edit', latestRevision: payload.latestRevision ?? null };
}

export interface EditPostInput {
  status?: string;
  submission_id?: string;
  revision?: number;
  downstreamRef?: string | null;
}

export interface EditPostResult {
  kind: 'accepted' | 'replayed' | 'error';
  revision?: number | null;
  downstreamRef?: string | null;
}

/**
 * Classifies the `POST /l/edit/:jti` response. `accepted` is a first submit;
 * `replayed` renders the original confirmation (D-95). Anything else is an
 * error the form surfaces inline without navigating away.
 */
export function classifyEditPostResponse(
  httpStatus: number,
  payload: EditPostInput | null,
): EditPostResult {
  if (httpStatus >= 400 || !payload) {
    return { kind: 'error' };
  }
  if (payload.status === 'accepted') {
    return { kind: 'accepted', revision: payload.revision ?? null, downstreamRef: payload.downstreamRef ?? null };
  }
  if (payload.status === 'replayed') {
    return { kind: 'replayed', revision: payload.revision ?? null, downstreamRef: payload.downstreamRef ?? null };
  }
  return { kind: 'error' };
}

export interface ConfirmationCard {
  heading: string;
  body: string;
  note: string | null;
  revisionLabel: string | null;
  downstreamRef: string | null;
  replayed: boolean;
}

/** Builds the Surface D confirmation card (first submit or D-95 replay). */
export function buildConfirmation(input: {
  connector?: string;
  revision?: number | null;
  downstreamRef?: string | null;
  replayed?: boolean;
}): ConfirmationCard {
  const connector = input.connector ?? DEFAULT_CONNECTOR;
  const revision = typeof input.revision === 'number' ? input.revision : null;
  return {
    heading: 'Correction submitted',
    body: buildSuccessText(connector),
    note: input.replayed ? REPLAY_TEXT : null,
    revisionLabel: revision != null ? `Revision ${revision}` : null,
    downstreamRef: input.downstreamRef ?? null,
    replayed: Boolean(input.replayed),
  };
}

/**
 * Extracts the denial reason from a redirect location (the API 302s to the
 * renderer dead-link page with `?reason=`). Defaults to `bad_signature`.
 */
export function denyReasonFromLocation(location: string): string {
  try {
    const parsed = new URL(location, 'https://render.example');
    return parsed.searchParams.get('reason') ?? 'bad_signature';
  } catch {
    return 'bad_signature';
  }
}

// ---------------------------------------------------------------------------
// Browser entry (Surface C/D). Called from edit.html; never at import time.
// ---------------------------------------------------------------------------

export interface EditBrowserDeps {
  apiOrigin: string;
  jti: string;
  token: string;
  fetchImpl?: typeof fetch;
}

function el(tag: string, cls: string | null, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = String(text);
  return node;
}

/** Redirects to the reused dead-link denial page (E5, D-70). */
function goToDead(reason: string): void {
  window.location.href = `./dead.html?reason=${encodeURIComponent(reason)}`;
}

/**
 * Browser-only entry. Fetches the latest revision, renders the editable form,
 * and wires the acknowledgement + submit + replay confirmation. Guarded so
 * importing this module in Node is safe (`document === undefined` → no-op).
 */
export async function initEdit(deps: EditBrowserDeps): Promise<void> {
  if (typeof document === 'undefined') {
    return;
  }
  const fetchImpl =
    deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!fetchImpl) {
    return;
  }

  const formHost = document.getElementById('formio-edit');
  const statusEl = document.getElementById('edit-status');
  const errorEl = document.getElementById('edit-error');
  const ackEl = document.getElementById('edit-ack');
  const ackTextEl = document.getElementById('edit-ack-text');
  const confirmEl = document.getElementById('edit-confirmation');
  const connector = document.body.dataset.connector || DEFAULT_CONNECTOR;

  const tokenQuery = `token=${encodeURIComponent(deps.token)}`;
  const getRes = await fetchImpl(`${deps.apiOrigin}/l/edit/${deps.jti}?${tokenQuery}`, {
    credentials: 'same-origin',
    redirect: 'manual',
  });

  if (getRes.status === 302) {
    goToDead(denyReasonFromLocation(getRes.headers.get('location') ?? ''));
    return;
  }

  let getPayload: EditGetInput | null = null;
  try {
    getPayload = getRes.ok ? ((await getRes.json()) as EditGetInput) : null;
  } catch {
    getPayload = null;
  }

  const getResult = classifyEditGetResponse(getRes.status, getPayload);
  if (getResult.kind === 'error') {
    if (statusEl) statusEl.hidden = false;
    return;
  }

  if (statusEl) statusEl.hidden = true;

  const renderConfirmation = (card: ConfirmationCard): void => {
    if (!confirmEl) return;
    confirmEl.hidden = false;
    confirmEl.textContent = '';
    const head = el('h2', null, card.heading);
    confirmEl.append(head);
    if (card.note) confirmEl.append(el('p', 'note', card.note));
    confirmEl.append(el('p', null, card.body));
    if (card.revisionLabel) confirmEl.append(el('p', 'meta', card.revisionLabel));
    if (card.downstreamRef) {
      const wrap = el('p', 'meta');
      wrap.append(document.createTextNode('Reference: '));
      wrap.append(el('span', 'pill-mono', card.downstreamRef));
      confirmEl.append(wrap);
    }
  };

  // D-95: a consumed link replays its recorded confirmation — never the form.
  if (getResult.kind === 'replay') {
    const outcome = getResult.editOutcome;
    renderConfirmation(
      buildConfirmation({
        connector,
        revision: outcome?.revision ?? null,
        downstreamRef: outcome?.downstreamRef ?? null,
        replayed: true,
      }),
    );
    return;
  }

  // Live link: render the editable, pre-filled form.
  const prefill = buildEditPrefill(getResult.latestRevision ?? null);

  const { Formio } = (await import('@formio/js')) as {
    Formio: { createForm: (el: HTMLElement, schema: unknown, opts?: unknown) => Promise<{ setSubmission: (s: unknown) => void; on: (ev: string, cb: () => void) => void }> };
  };
  await import('@formio/js/dist/formio.full.min.css');

  let submitting = false;

  const doSubmit = async (): Promise<void> => {
    if (submitting) return;
    submitting = true;
    const submitBtn = document.getElementById('edit-submit') as HTMLButtonElement | null;
    submitBtn?.classList.add('is-loading');
    if (errorEl) errorEl.hidden = true;
    if (ackEl) ackEl.hidden = true;

    try {
      const submission = await form.getSubmission();
      const res = await fetchImpl(`${deps.apiOrigin}/l/edit/${deps.jti}?${tokenQuery}`, {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'manual',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify((submission as { data?: Record<string, unknown> })?.data ?? {}),
      });

      if (res.status === 302) {
        goToDead(denyReasonFromLocation(res.headers.get('location') ?? ''));
        return;
      }

      let postPayload: EditPostInput | null = null;
      try {
        postPayload = res.ok ? ((await res.json()) as EditPostInput) : null;
      } catch {
        postPayload = null;
      }

      const postResult = classifyEditPostResponse(res.status, postPayload);
      if (postResult.kind === 'error') {
        if (errorEl) {
          errorEl.hidden = false;
          errorEl.textContent = buildSubmitFailureText(connector);
        }
        submitBtn?.classList.remove('is-loading');
        submitting = false;
        return;
      }

      const formCard = document.querySelector('section.card');
      if (formCard) formCard.setAttribute('hidden', 'true');
      renderConfirmation(
        buildConfirmation({
          connector,
          revision: postResult.revision ?? null,
          downstreamRef: postResult.downstreamRef ?? null,
          replayed: postResult.kind === 'replayed',
        }),
      );
    } catch {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = buildSubmitFailureText(connector);
      }
      submitBtn?.classList.remove('is-loading');
      submitting = false;
    }
  };

  const form = await Formio.createForm(
    formHost,
    (getPayload?.submission?.form_schema as Record<string, unknown>) ?? {},
    { readOnly: false },
  );
  form.setSubmission({ data: prefill });

  if (ackTextEl) ackTextEl.textContent = buildAckText(connector);

  const submitBtn = document.getElementById('edit-submit');
  submitBtn?.addEventListener('click', () => {
    if (ackEl) ackEl.hidden = false;
  });
  document.getElementById('edit-ack-continue')?.addEventListener('click', () => {
    void doSubmit();
  });
  document.getElementById('edit-ack-cancel')?.addEventListener('click', () => {
    if (ackEl) ackEl.hidden = true;
  });
  document.getElementById('edit-discard')?.addEventListener('click', () => {
    if (window.history.length > 1) {
      window.history.back();
    }
  });
}
