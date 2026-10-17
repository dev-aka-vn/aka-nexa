/**
 * The submissions viewer (BLD-08, D-111,
 * BLD-07, BLD-09) — the app owner's read
 * surface over one app's submissions.
 *
 * ## Filter composition (D-111)
 *
 * The status chips, the date range, and the
 * form select compose against plan 06's
 * query parameters (`status`, `from`, `to`,
 * `form` — `app_id` rides the route). Every
 * filter change refetches `GET /submissions`
 * with the **full composed set** — the
 * request always carries every active
 * filter, not just the one that changed.
 *
 * ## The export (D-111)
 *
 * The export button is a plain anchor to
 * `GET /submissions/export` carrying the
 * **same composed filter set** (the same
 * `URLSearchParams` the list read). The API
 * projects the visible columns before
 * serializing, so no field outside the
 * allowlist can appear in the CSV — the
 * download is the list's own projection.
 *
 * ## States (BLD-07, BLD-09)
 *
 * A layout-shaped skeleton while the list
 * read is in flight; an inline, specific,
 * actionable error on failure; a row click
 * opens the detail drawer (the same
 * projection, read through `GET
 * /submissions/:id`).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactElement } from 'react';

import {
  SubmissionsListSchema,
  SUBMISSION_STATUSES,
  type SubmissionStatus,
  type SubmissionViewerRow,
} from '../api/submissions.js';
import { useApiClient } from '../apiHooks.js';
import { InlineError } from '../error/InlineError.js';
import { Skeleton } from '../ui/Skeleton.js';
import { ScopedAppPicker } from '../ui/ScopedAppPicker.js';
import { SubmissionDetailDrawer } from './SubmissionDetailDrawer.js';

export interface SubmissionsPageProps {
  /** The scoped app (the route's `app` parameter). */
  readonly appId?: string;
}

/** The viewer's filter state — every filter, one composed set. */
interface ViewerFilters {
  readonly status: SubmissionStatus | null;
  readonly from: string;
  readonly to: string;
  readonly form: string | null;
}

/** The empty filter set. */
const EMPTY_FILTERS: ViewerFilters = {
  status: null,
  from: '',
  to: '',
  form: null,
};

/**
 * The submissions viewer. Without a scoped
 * app the page is the app picker; with one,
 * the viewer proper.
 */
export function SubmissionsPage({
  appId,
}: SubmissionsPageProps): ReactElement {
  if (appId === undefined) {
    return (
      <ScopedAppPicker
        surface="submissions"
        title="Submissions"
        description="Pick an app to view its submissions — filter by status, date range, and form, and export the visible columns."
      />
    );
  }
  return <SubmissionsViewer appId={appId} />;
}

/**
 * The viewer for one app's submissions.
 */
function SubmissionsViewer({
  appId,
}: {
  appId: string;
}): ReactElement {
  const client = useApiClient();

  const [filters, setFilters] =
    useState<ViewerFilters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<
    readonly SubmissionViewerRow[] | null
  >(null);
  const [error, setError] = useState<unknown>(null);
  const [selectedId, setSelectedId] = useState<
    string | null
  >(null);

  /**
   * The composed query set — the same
   * parameters the list read and the export
   * download both carry (D-111: one filter
   * set, every surface).
   */
  const composedParams = useCallback(
    (): URLSearchParams => {
      const params = new URLSearchParams();
      params.set('app_id', appId);
      if (filters.status !== null) {
        params.set('status', filters.status);
      }
      if (filters.from.length > 0) {
        params.set('from', filters.from);
      }
      if (filters.to.length > 0) {
        params.set('to', filters.to);
      }
      if (filters.form !== null) {
        params.set('form', filters.form);
      }
      return params;
    },
    [appId, filters],
  );

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const response = await client.get(
        `/submissions?${composedParams().toString()}`,
        SubmissionsListSchema,
      );
      setRows(response.submissions);
    } catch (loadError) {
      setRows(null);
      setError(loadError);
    }
  }, [client, composedParams]);

  // Every filter change refetches with the
  // full composed set.
  useEffect(() => {
    void load();
  }, [load]);

  /** The distinct form ids the loaded rows carry — the form filter's options. */
  const formOptions = useMemo(() => {
    if (rows === null) {
      return [];
    }
    return Array.from(
      new Set(rows.map((row) => row.form_id)),
    );
  }, [rows]);

  const setStatus = useCallback(
    (status: SubmissionStatus | null): void => {
      setFilters((previous) => ({ ...previous, status }));
    },
    [],
  );

  const setFrom = useCallback(
    (from: string): void => {
      setFilters((previous) => ({ ...previous, from }));
    },
    [],
  );

  const setTo = useCallback(
    (to: string): void => {
      setFilters((previous) => ({ ...previous, to }));
    },
    [],
  );

  const setForm = useCallback(
    (form: string | null): void => {
      setFilters((previous) => ({ ...previous, form }));
    },
    [],
  );

  /** The export download — the same composed set, the visible columns. */
  const exportHref = useMemo(
    () => `/api/submissions/export?${composedParams().toString()}`,
    [composedParams],
  );

  return (
    <div data-testid="submissions-page">
      <div className="page-head">
        <div className="titles">
          <div
            className="od-row"
            style={{
              '--od-gap': '10px',
              marginBottom: 8,
            } as never}
          >
            <a className="btn btn-sm" href="#/apps">
              ← Apps
            </a>
            <span className="pill-mono">{appId}</span>
          </div>
          <h1>Submissions</h1>
          <p className="sub">
            Every submission this app has
            delivered — filter, inspect, and
            export the visible columns.
          </p>
        </div>
        <div className="page-actions">
          <a
            className="btn"
            data-testid="export-button"
            href={exportHref}
          >
            Export CSV
          </a>
        </div>
      </div>

      {/* The filter bar — every filter composes into one query set. */}
      <div
        className="toolbar"
        data-testid="submissions-filters"
      >
        <div
          className="rail"
          role="group"
          aria-label="Filter by status"
        >
          {SUBMISSION_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className="chip"
              data-testid={`status-filter-${status}`}
              aria-pressed={filters.status === status}
              onClick={() =>
                setStatus(
                  filters.status === status ? null : status,
                )
              }
            >
              {status}
            </button>
          ))}
        </div>
        <label className="field" style={{ margin: 0 }}>
          <span className="lr-s">From</span>
          <input
            type="date"
            className="input"
            data-testid="filter-from"
            value={filters.from}
            onChange={(event) =>
              setFrom(event.target.value)
            }
          />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span className="lr-s">To</span>
          <input
            type="date"
            className="input"
            data-testid="filter-to"
            value={filters.to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span className="lr-s">Form</span>
          <select
            className="select"
            data-testid="filter-form"
            value={filters.form ?? ''}
            onChange={(event) =>
              setForm(
                event.target.value.length === 0
                  ? null
                  : event.target.value,
              )
            }
          >
            <option value="">All forms</option>
            {formOptions.map((formId) => (
              <option key={formId} value={formId}>
                {formId}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <InlineError
          operation="load this app's submissions"
          error={error}
          onRetry={() => void load()}
        />
      ) : rows === null ? (
        <Skeleton
          variant="text"
          lines={6}
          label="Loading submissions"
        />
      ) : rows.length === 0 ? (
        <section className="card">
          <div className="card-body">
            <div className="empty" style={{ padding: '32px' }}>
              <h3>No submissions match</h3>
              <p>
                No submissions for this app match
                the current filters.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <div className="table-wrap">
          <table data-testid="submissions-table">
            <thead>
              <tr>
                <th>Submission</th>
                <th>Form</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Downstream</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.submission_id}
                  data-testid={`submission-row-${row.submission_id}`}
                  onClick={() => setSelectedId(row.submission_id)}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="cell-mono">
                    {row.submission_id}
                  </td>
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
                    {row.downstream_reference ?? '—'}
                  </td>
                  <td>{row.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* The detail drawer — the same projection, read through GET /submissions/:id. */}
      {selectedId !== null ? (
        <SubmissionDetailDrawer
          submissionId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </div>
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
