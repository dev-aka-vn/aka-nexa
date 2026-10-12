/**
 * The dashboard (D-112, OBS-05, BLD-07,
 * BLD-09) — the builder's read-only home.
 *
 * ## Exactly two live widgets
 *
 * The dashboard renders **two** widgets,
 * both live reads through the API:
 *
 *  - **Recent submissions** — the same
 *    projected rows the submissions viewer
 *    lists (`GET /submissions`, one read
 *    per owned app, merged and sorted
 *    most-recent-first). There is **no
 *    separate dashboard data source**: the
 *    widget reads the viewer's own
 *    endpoint, so the rows a admin sees
 *    here are the rows the submissions page
 *    lists.
 *  - **Recent audit activity** — the
 *    newest AUD-01 entries (`GET /audit`,
 *    the global-admin browse endpoint the
 *    audit module serves).
 *
 * The held-back connector health card is
 * **deliberately absent** (D-112): it is held back until a
 * real health-check job exists, and its
 * absence is the correct shipped state, not
 * a gap. The widget set is exactly the two
 * live widgets.
 *
 * ## Widget isolation (BLD-07/BLD-09)
 *
 * Each widget loads independently: a failed
 * read renders an inline, specific error
 * **naming the widget** in its own slot, and
 * the other widget keeps rendering from its
 * own read. Every widget shows a
 * layout-shaped skeleton while its read is
 * in flight — never a spinner-only blank.
 *
 * ## The token set
 *
 * Styles are the mockup's component classes
 * (`chrome.css`) and its custom properties
 * (`tokens.css`) — no second palette, no
 * second typeface.
 */

import {
  useCallback,
  useEffect,
  useState,
} from 'react';
import type { ReactElement } from 'react';

import {
  AuditBrowseSchema,
  type AuditEntryView,
} from '../api/audit.js';
import {
  AppsListSchema,
  type AppDefinition,
} from '../api/definition.js';
import {
  SubmissionsListSchema,
  type SubmissionViewerRow,
  type SubmissionStatus,
} from '../api/submissions.js';
import { useApiClient } from '../apiHooks.js';
import { InlineError } from '../error/InlineError.js';
import { Skeleton } from '../ui/Skeleton.js';

/**
 * One widget's three states — the shared
 * loading/error/data shape both live widgets
 * ride.
 */
type WidgetState<T> =
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown }
  | { kind: 'data'; data: T };

/** The recent-submissions widget's row cap. */
const RECENT_SUBMISSION_LIMIT = 5;

/** The recent-activity widget's row cap. */
const RECENT_ACTIVITY_LIMIT = 5;

/**
 * The dashboard page — the two live widgets
 * in the mockup's grid layout.
 */
export function DashboardPage(): ReactElement {
  return (
    <div data-testid="dashboard">
      <div className="page-head">
        <div className="titles">
          <h1>Dashboard</h1>
          <p className="sub">
            Recent submissions and audit
            activity across your apps — live
            reads, nothing else.
          </p>
        </div>
        <div className="page-actions">
          <a className="btn" href="#/submissions">
            Open submissions
          </a>
          <a className="btn btn-primary" href="#/wizard">
            New app
          </a>
        </div>
      </div>
      <div className="grid-main">
        <RecentSubmissionsWidget />
        <div
          className="od-stack"
          style={{ '--od-gap': '18px' } as never}
        >
          <RecentActivityWidget />
        </div>
      </div>
    </div>
  );
}

/**
 * The recent-submissions widget — the
 * owner's apps' submissions, merged and
 * most-recent-first, read live from the
 * submissions viewer's own endpoint.
 */
function RecentSubmissionsWidget(): ReactElement {
  const client = useApiClient();
  const [state, setState] = useState<
    WidgetState<readonly SubmissionViewerRow[]>
  >({ kind: 'loading' });

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' });
    try {
      // The merge source: the caller's own
      // app definitions (GET /apps).
      const apps = await client.get(
        '/apps',
        AppsListSchema,
      );
      // One viewer read per owned app — the
      // same projection the submissions page
      // lists, no separate dashboard source.
      const reads = await Promise.all(
        apps.apps.map((app: AppDefinition) =>
          client.get(
            `/submissions?app_id=${encodeURIComponent(app.app_id)}`,
            SubmissionsListSchema,
          ),
        ),
      );
      const merged = reads
        .flatMap(
          (response) => response.submissions,
        )
        .sort(
          (left, right) =>
            right.submitted_at.localeCompare(
              left.submitted_at,
            ),
        )
        .slice(0, RECENT_SUBMISSION_LIMIT);
      setState({ kind: 'data', data: merged });
    } catch (error) {
      setState({ kind: 'error', error });
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="card" data-testid="recent-submissions">
      <div className="card-head">
        <h2>Recent submissions</h2>
        <span className="spacer" />
        <a
          className="btn btn-sm btn-ghost"
          href="#/submissions"
        >
          View all
        </a>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {state.kind === 'error' ? (
          <div style={{ padding: 18 }}>
            <InlineError
              operation="load recent submissions"
              error={state.error}
              onRetry={() => void load()}
            />
          </div>
        ) : state.kind === 'loading' ? (
          <div style={{ padding: 18 }}>
            <Skeleton
              variant="text"
              lines={5}
              label="Loading recent submissions"
            />
          </div>
        ) : state.data.length === 0 ? (
          <div className="empty" style={{ padding: 32 }}>
            <h3>No submissions yet</h3>
            <p>
              Submissions appear here as your
              published forms are used.
            </p>
          </div>
        ) : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table data-testid="recent-submissions-table">
              <thead>
                <tr>
                  <th>Submission</th>
                  <th>App</th>
                  <th>Form</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th>Downstream</th>
                </tr>
              </thead>
              <tbody>
                {state.data.map((row) => (
                  <tr
                    key={row.submission_id}
                    data-testid={`submission-row-${row.submission_id}`}
                  >
                    <td className="cell-mono">
                      {row.submission_id}
                    </td>
                    <td className="cell-mono">{row.app_id}</td>
                    <td>{row.form_id}</td>
                    <td>
                      <span
                        className={`badge ${statusTone(row.status)}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="cell-mono">
                      {formatTimestamp(row.submitted_at)}
                    </td>
                    <td className="cell-mono">
                      {row.downstream_reference ??
                        row.reason ??
                        '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The recent-activity widget — the newest
 * AUD-01 entries, read live from the audit
 * browse endpoint.
 */
function RecentActivityWidget(): ReactElement {
  const client = useApiClient();
  const [state, setState] = useState<
    WidgetState<readonly AuditEntryView[]>
  >({ kind: 'loading' });

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' });
    try {
      const response = await client.get(
        `/audit?limit=${RECENT_ACTIVITY_LIMIT}`,
        AuditBrowseSchema,
      );
      setState({ kind: 'data', data: response.entries });
    } catch (error) {
      setState({ kind: 'error', error });
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="card" data-testid="recent-activity">
      <div className="card-head">
        <h2>Recent audit activity</h2>
        <span className="spacer" />
        <a className="btn btn-sm btn-ghost" href="#/audit">
          View all
        </a>
      </div>
      <div className="card-body">
        {state.kind === 'error' ? (
          <InlineError
            operation="load recent audit activity"
            error={state.error}
            onRetry={() => void load()}
          />
        ) : state.kind === 'loading' ? (
          <Skeleton
            variant="text"
            lines={5}
            label="Loading recent audit activity"
          />
        ) : state.data.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            <h3>No audit activity yet</h3>
            <p>
              State-changing actions are
              recorded in the append-only audit
              log.
            </p>
          </div>
        ) : (
          <div className="seg-list">
            {state.data.map((entry, index) => (
              <div
                key={`${entry.action}-${entry.timestamp}-${index}`}
                className="seg-item"
                data-testid={`activity-row-${index}`}
              >
                <span className="icon-tile it-teal">
                  <svg
                    aria-hidden="true"
                    className="ic"
                    viewBox="0 0 24 24"
                    fill="none"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 8v4l2.5 2.5" />
                    <circle cx="12" cy="12" r="9" />
                  </svg>
                </span>
                <div className="od-fill">
                  <div className="lr-t">{entry.action}</div>
                  <div className="lr-s">
                    {entry.actor} · {entry.target} ·{' '}
                    {formatTimestamp(entry.timestamp)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
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

/** An ISO timestamp as the mockup's table cells render it. */
function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}
