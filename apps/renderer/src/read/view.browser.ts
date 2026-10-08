import { Formio } from '@formio/js';

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
  } | null;
}

async function init(): Promise<void> {
  const statusEl = document.getElementById('status');
  const metadataEl = document.getElementById('metadata');
  const containerEl = document.getElementById('formio-readonly');

  if (!statusEl || !metadataEl || !containerEl) {
    return;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) {
      statusEl.textContent = 'Missing token. Please request a new link via IM.';
      statusEl.className = 'error';
      return;
    }

    // Determine the API base origin. Default to same origin as renderer.
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
      statusEl.className = 'error';
      return;
    }

    if (!res.ok) {
      statusEl.textContent = 'This link could not be verified.';
      statusEl.className = 'error';
      return;
    }

    const payload = (await res.json()) as ViewPayload;
    statusEl.style.display = 'none';

    if (payload.submission) {
      metadataEl.textContent = `App: ${payload.claims.app_id} · Form: ${payload.claims.form_id} v${payload.claims.form_version} · Submission: ${payload.submission._id}`;
      Formio.createForm(containerEl, payload.submission.form_schema, {
        readOnly: true,
      }).then((form) => {
        form.setSubmission({
          data: payload.submission?.data ?? {},
        });
      });
    } else {
      metadataEl.textContent = `App: ${payload.claims.app_id}`;
      statusEl.style.display = 'block';
      statusEl.textContent = 'No submission data available.';
      statusEl.className = 'error';
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = 'Failed to load submission. Please request a new link via IM.';
      statusEl.className = 'error';
    }
  }
}

init();
