import '@formio/js/dist/formio.full.min.css';
import './formio-scope.css';
import { Formio } from '@formio/js';

import {
  buildDetailSummary,
  DEFAULT_CONNECTOR,
  formatSubmittedAt,
  statusToBadge,
  type SubmissionStatus,
} from './status.js';

/**
 * Read-only submission detail (Surface B). Extends the Phase 4 view page with
 * a status summary and — for a `partial` submission — a read-only warn callout
 * above the form. No retry control is rendered (D-81): retry stays with the
 * admin/DLQ CLI.
 */
interface ViewPayload {
  claims: {
    jti: string;
    action: string;
    app_id: string;
    form_id: string;
    form_version: number;
    sub: string;
  };
  submission: {
    _id: string;
    form_schema: Record<string, unknown>;
    data: Record<string, unknown>;
    form_label?: string;
  } | null;
  status?: SubmissionStatus;
  destination?: string;
  downstreamRef?: string | null;
  reason?: string;
  submittedAt?: string;
  connector?: string;
}

function badgeElement(cls: string, label: string): HTMLElement {
  const badge = document.createElement('span');
  badge.className = `badge ${cls}`;
  const dot = document.createElement('span');
  dot.className = 'dot';
  const text = document.createElement('span');
  text.textContent = label;
  badge.append(dot, text);
  return badge;
}

async function init(): Promise<void> {
  const statusEl = document.getElementById('status');
  const metadataEl = document.getElementById('metadata');
  const containerEl = document.getElementById('formio-readonly');
  const summaryEl = document.getElementById('status-summary');
  const calloutEl = document.getElementById('status-callout');

  if (!statusEl || !metadataEl || !containerEl) {
    return;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) {
      statusEl.textContent = 'Missing token. Please request a new link via IM.';
      return;
    }

    const apiOrigin = window.location.origin.replace('renderer', 'api') || window.location.origin;
    const jti = (window.location.pathname.split('/l/view/')[1] || '').split('?')[0];

    const res = await fetch(`${apiOrigin}/l/view/${jti}?token=${encodeURIComponent(token)}`, {
      credentials: 'same-origin',
    });

    if (res.status === 302) {
      const location = res.headers.get('location');
      if (location) {
        window.location.href = location;
        return;
      }
      statusEl.textContent = 'This link is no longer valid.';
      return;
    }

    if (!res.ok) {
      statusEl.textContent = 'This link could not be verified.';
      return;
    }

    const payload = (await res.json()) as ViewPayload;
    statusEl.hidden = true;

    if (!payload.submission) {
      statusEl.hidden = false;
      statusEl.textContent = 'No submission data available.';
      return;
    }

    const connector = payload.connector ?? DEFAULT_CONNECTOR;
    const summary = buildDetailSummary({
      status: payload.status ?? (payload.submission.status as SubmissionStatus | undefined),
      destination: payload.destination,
      downstreamRef: payload.downstreamRef ?? null,
      reason: payload.reason,
      connector,
      submittedAt: payload.submittedAt,
    });

    metadataEl.textContent = `${connector} · Form ${payload.claims.form_id} v${payload.claims.form_version}`;

    if (summaryEl) {
      summaryEl.hidden = false;
      const badge = summary.badge ?? statusToBadge('completed');
      summaryEl.append(badgeElement(badge.className, badge.label));
      const destination = document.createElement('span');
      destination.textContent = summary.destination;
      summaryEl.append(destination);
      if (summary.submittedLabel) {
        const submitted = document.createElement('span');
        submitted.textContent = `· Submitted ${formatSubmittedAt(payload.submittedAt)}`;
        summaryEl.append(submitted);
      }
    }

    if (calloutEl && summary.callout) {
      const callout = document.createElement('div');
      callout.className = `callout callout-${summary.callout.kind}`;
      const message = document.createElement('p');
      message.textContent = summary.callout.text;
      callout.append(message);
      if (summary.callout.detail) {
        const detail = document.createElement('p');
        detail.className = 'detail';
        detail.textContent = summary.callout.detail;
        callout.append(detail);
      }
      calloutEl.append(callout);
    }

    await Formio.createForm(containerEl, payload.submission.form_schema, {
      readOnly: true,
    }).then((form) => {
      form.setSubmission({
        data: payload.submission?.data ?? {},
      });
    });
  } catch {
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = 'Failed to load submission. Please request a new link via IM.';
    }
  }
}

init();
