/**
 * The submission detail drawer (BLD-08,
 * D-111, BLD-07, BLD-09).
 *
 * A row click opens the drawer, which reads
 * `GET /submissions/:id` and renders the
 * **same projected row** the list renders —
 * D-111's single projection: the list, the
 * detail, and the export all flow through
 * the one `toViewerRow`, so they cannot
 * disagree.
 *
 * The drawer unmounts on close (the parent
 * drops the selected id), so a closed
 * drawer is gone from the DOM entirely.
 * While the detail read is in flight the
 * drawer shows a layout-shaped skeleton;
 * a failed read is an inline, specific,
 * actionable error naming the submission.
 */

import {
  useCallback,
  useEffect,
  useState,
} from 'react';
import type { ReactElement } from 'react';

import {
  SubmissionViewerRowSchema,
  type SubmissionViewerRow,
  type SubmissionStatus,
} from '../api/submissions.js';
import { useApiClient } from '../apiHooks.js';
import { InlineError } from '../error/InlineError.js';
import { Skeleton } from '../ui/Skeleton.js';

export interface SubmissionDetailDrawerProps {
  /** The submission the drawer opened on. */
  readonly submissionId: string;
  /** Close (and unmount) the drawer. */
  readonly onClose: () => void;
}

/** The drawer's three states. */
type DrawerState =
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown }
  | { kind: 'data'; row: SubmissionViewerRow };

/**
 * The detail drawer for one submission.
 */
export function SubmissionDetailDrawer({
  submissionId,
  onClose,
}: SubmissionDetailDrawerProps): ReactElement {
  const client = useApiClient();
  const [state, setState] = useState<DrawerState>({
    kind: 'loading',
  });

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' });
    try {
      const row = await client.get(
        `/submissions/${encodeURIComponent(submissionId)}`,
        SubmissionViewerRowSchema,
      );
      setState({ kind: 'data', row });
    } catch (error) {
      setState({ kind: 'error', error });
    }
  }, [client, submissionId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <aside
      className="drawer on"
      data-testid="submission-drawer"
      role="dialog"
      aria-label="Submission detail"
    >
      <div className="drawer-head">
        <div className="od-fill">
          <h2>Submission detail</h2>
          <div
            className="lr-s"
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 12,
              marginTop: 4,
            }}
          >
            {submissionId}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          data-testid="submission-drawer-close"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className="drawer-body">
        {state.kind === 'error' ? (
          <InlineError
            operation={`load submission ${submissionId}`}
            error={state.error}
            onRetry={() => void load()}
          />
        ) : state.kind === 'loading' ? (
          <Skeleton
            variant="text"
            lines={6}
            label="Loading submission detail"
          />
        ) : (
          <div
            className="od-stack"
            style={{ '--od-gap': '14px' } as never}
          >
            <div
              className="od-row"
              style={{ '--od-gap': '10px', alignItems: 'center' } as never}
            >
              <span
                className={`badge ${statusTone(state.row.status)}`}
              >
                {state.row.status}
              </span>
              <span className="pill-mono">{state.row.form_id}</span>
              <span className="pill-mono">{state.row.app_id}</span>
            </div>
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr',
                gap: '8px 16px',
                fontSize: 14,
                margin: 0,
              }}
            >
              <dt className="lr-s">Submission</dt>
              <dd
                className="cell-mono"
                style={{ margin: 0 }}
              >
                {state.row.submission_id}
              </dd>
              <dt className="lr-s">Form</dt>
              <dd style={{ margin: 0 }}>{state.row.form_id}</dd>
              <dt className="lr-s">Status</dt>
              <dd style={{ margin: 0 }}>{state.row.status}</dd>
              <dt className="lr-s">Submitted</dt>
              <dd className="cell-mono" style={{ margin: 0 }}>
                {formatTimestamp(state.row.submitted_at)}
              </dd>
              <dt className="lr-s">Downstream reference</dt>
              <dd className="cell-mono" style={{ margin: 0 }}>
                {state.row.downstream_reference ?? '—'}
              </dd>
              <dt className="lr-s">Reason</dt>
              <dd style={{ margin: 0 }}>
                {state.row.reason ?? '—'}
              </dd>
            </dl>
          </div>
        )}
      </div>
    </aside>
  );
}

/** The submission status badge tone (the mockup's badge vocabulary). */
function statusTone(status: SubmissionStatus): string {
  switch (status) {
    case 'completed':
      return 'badge-completed';
    case 'partial':
      return 'badge-partial';
    case 'failed':
      return 'badge-failed';
    case 'pending_external':
      return 'badge-pending';
    default:
      return 'badge-neutral';
  }
}

/** An ISO timestamp as the mockup's cells render it. */
function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}
