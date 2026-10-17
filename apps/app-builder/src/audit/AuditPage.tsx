/**
 * The audit browse page (AUD-01, D-43,
 * T-06-32).
 *
 * A **read-only** paginated browse of the
 * append-only AUD-01 trail. The API
 * projects every entry through the D-43
 * field allowlist before serialization —
 * `ip` and every non-allowlisted key are
 * unreachable by construction, so the
 * columns here are exactly the allowlist's
 * own. No mutation endpoint exists
 * (AUD-01 is append-only), so the page
 * offers no edit affordance — only the
 * pager and a filter over the loaded
 * page.
 *
 * The global-admin gate is the API's
 * (the audit controller refuses a
 * non-admin with the named 403); the
 * page surfaces that refusal inline,
 * never a generic error.
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
import { useApiClient } from '../apiHooks.js';
import { InlineError } from '../error/InlineError.js';
import { Skeleton } from '../ui/Skeleton.js';

/** The page size the browse endpoint serves (its default). */
const PAGE_SIZE = 20;

/**
 * The audit log (`#/audit`): the newest
 * AUD-01 entries first, the D-43
 * allowlist's columns, the pager's two
 * states, skeleton-then-data.
 */
export function AuditPage(): ReactElement {
  const client = useApiClient();
  const [entries, setEntries] = useState<
    readonly AuditEntryView[] | null
  >(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<unknown>(
    null,
  );
  const [query, setQuery] = useState('');

  const load = useCallback(
    async (pageOffset: number): Promise<void> => {
      setError(null);
      setEntries(null);
      try {
        const response = await client.get(
          `/audit?limit=${PAGE_SIZE}&offset=${pageOffset}`,
          AuditBrowseSchema,
        );
        setEntries(response.entries);
        setTotal(response.total);
        setOffset(response.offset);
      } catch (loadError) {
        setEntries(null);
        setError(loadError);
      }
    },
    [client],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  /**
   * The filter — over the loaded page, the
   * same actor/action/target vocabulary the
   * mockup's search box offers. The server
   * owns the pagination; the filter narrows
   * what the page renders.
   */
  const filtered =
    entries === null
      ? null
      : entries.filter((entry) => {
          if (query.trim().length === 0) {
            return true;
          }
          const haystack =
            `${entry.actor} ${entry.action} ${entry.target}`.toLowerCase();
          return haystack.includes(
            query.trim().toLowerCase(),
          );
        });

  const hasPrev = offset > 0;
  const hasNext =
    entries !== null &&
    offset + PAGE_SIZE < total;

  return (
    <div data-testid="audit-page">
      <div className="page-head">
        <div className="titles">
          <h1>Audit Log</h1>
          <p className="sub">
            Append-only record of every
            state-changing action. Retained
            for a minimum of 3 years.
          </p>
        </div>
        <div className="page-actions">
          <span className="pill-mono">
            immutable · append-only
          </span>
        </div>
      </div>
      <div className="toolbar">
        <div
          className="search"
          style={{ width: 320 }}
        >
          <label className="sr" htmlFor="audit-filter">
            Filter audit log
          </label>
          <input
            id="audit-filter"
            className="input"
            type="search"
            placeholder="Filter by actor, action, or target…"
            value={query}
            data-testid="audit-filter"
            onChange={(event) =>
              setQuery(event.target.value)
            }
          />
        </div>
        <span className="helper">
          {total} entries
        </span>
      </div>
      {error ? (
        <InlineError
          operation="load the audit log"
          error={error}
          onRetry={() => void load(offset)}
        />
      ) : entries === null ? (
        <Skeleton variant="block" label="Loading audit log" />
      ) : (
        <>
          <div className="table-wrap">
            <table
              style={{ minWidth: 920 }}
              data-testid="audit-table"
            >
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Previous</th>
                  <th>New state</th>
                  <th>Request</th>
                </tr>
              </thead>
              <tbody>
                {(filtered ?? []).map(
                  (entry, index) => (
                    <tr
                      key={`${entry.timestamp}-${entry.actor}-${entry.action}-${index}`}
                      data-testid={`audit-entry-${offset + index}`}
                    >
                      <td className="cell-mono od-nowrap">
                        {entry.timestamp}
                      </td>
                      <td className="od-nowrap">
                        {entry.actor}
                      </td>
                      <td>
                        <span className="pill-mono">
                          {entry.action}
                        </span>
                      </td>
                      <td className="cell-mono">
                        {entry.target}
                      </td>
                      <td className="cell-mono">
                        {entry.previous_state ?? '—'}
                      </td>
                      <td className="cell-mono cell-strong">
                        {entry.new_state ?? '—'}
                      </td>
                      <td className="cell-mono">
                        {entry.request_id ?? '—'}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            {(filtered ?? []).length === 0 ? (
              <div className="card">
                <div className="empty">
                  <h3>No audit entries match</h3>
                  <p>
                    {query
                      ? 'Clear the filter to see the full trail.'
                      : 'No entries yet — every state-changing action lands here.'}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
          <div
            className="od-row"
            style={{
              '--od-gap': '10px',
              justifyContent: 'flex-end',
              marginTop: 14,
            } as never}
          >
            <button
              className="btn btn-sm"
              data-testid="audit-prev"
              disabled={!hasPrev}
              onClick={() => {
                void load(Math.max(0, offset - PAGE_SIZE));
              }}
            >
              ← Newer
            </button>
            <span
              className="helper"
              data-testid="audit-pager"
            >
              {offset + 1}–{offset + (filtered?.length ?? 0)} of{' '}
              {total}
            </span>
            <button
              className="btn btn-sm"
              data-testid="audit-next"
              disabled={!hasNext}
              onClick={() => {
                void load(offset + PAGE_SIZE);
              }}
            >
              Older →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
