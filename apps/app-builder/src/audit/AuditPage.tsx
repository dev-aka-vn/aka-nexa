import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { AuditBrowseSchema, type AuditEntryView } from '../api/audit.js';
import { useApiClient } from '../apiHooks.js';
import { InlineError } from '../error/InlineError.js';
import { Skeleton } from '../ui/Skeleton.js';

const PAGE_SIZE = 20;

interface Filters {
  user: string;
  app_id: string;
  action: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { user: '', app_id: '', action: '', from: '', to: '' };

export function AuditPage(): ReactElement {
  const client = useApiClient();
  const [entries, setEntries] = useState<readonly AuditEntryView[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [apps, setApps] = useState<string[]>([]);

  const buildQuery = (f: Filters, pageOffset: number): string => {
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(pageOffset));
    if (f.user.trim()) params.set('user', f.user.trim());
    if (f.app_id) params.set('app_id', f.app_id);
    if (f.action.trim()) params.set('action', f.action.trim());
    if (f.from) params.set('from', f.from);
    if (f.to) params.set('to', f.to);
    return `/audit?${params.toString()}`;
  };

  const load = useCallback(async (pageOffset: number, f: Filters): Promise<void> => {
    setError(null);
    setEntries(null);
    try {
      const response = await client.get(buildQuery(f, pageOffset), AuditBrowseSchema);
      setEntries(response.entries);
      setTotal(response.total);
      setOffset(response.offset);
    } catch (loadError) {
      setEntries(null);
      setError(loadError);
    }
  }, [client]);

  useEffect(() => {
    void load(0, applied);
  }, [load, applied]);

  useEffect(() => {
    // populate app select best-effort
    client.get('/apps', { parse: (d: unknown) => d } as never).then((d: unknown) => {
      const list = (d as { apps?: { app_id: string }[] })?.apps ?? [];
      setApps(list.map((a) => a.app_id));
    }).catch(() => {});
  }, [client]);

  const applyFilters = (): void => setApplied({ ...filters });
  const clearFilters = (): void => {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  };

  const hasPrev = offset > 0;
  const hasNext = entries !== null && offset + PAGE_SIZE < total;

  const exportUrl = (): string => {
    const params = new URLSearchParams();
    if (applied.user.trim()) params.set('user', applied.user.trim());
    if (applied.app_id) params.set('app_id', applied.app_id);
    if (applied.action.trim()) params.set('action', applied.action.trim());
    if (applied.from) params.set('from', applied.from);
    if (applied.to) params.set('to', applied.to);
    return `/audit/export?${params.toString()}`;
  };

  return (
    <div data-testid="audit-page">
      <div className="page-head">
        <div className="titles">
          <h1>Audit Log</h1>
          <p className="sub">Append-only record of every state-changing action. Retained for a minimum of 3 years.</p>
        </div>
        <div className="page-actions">
          <a className="btn" data-testid="audit-export" href={exportUrl()} target="_blank" rel="noreferrer">
            Export JSON Lines
          </a>
          <span className="pill-mono">immutable · append-only</span>
        </div>
      </div>
      <div className="toolbar">
        <label className="sr" htmlFor="audit-user">User</label>
        <input id="audit-user" className="input" placeholder="Filter by user…" value={filters.user} data-testid="audit-filter-user"
          onChange={(e) => { const v={...filters,user:e.target.value}; setFilters(v); setApplied(v); }} />
        <label className="sr" htmlFor="audit-app">App</label>
        <select id="audit-app" className="select" value={filters.app_id} data-testid="audit-filter-app"
          onChange={(e) => { const v={...filters,app_id:e.target.value}; setFilters(v); setApplied(v); }}>
          <option value="">All apps</option>
          {apps.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <label className="sr" htmlFor="audit-action">Action</label>
        <input id="audit-action" className="input" placeholder="e.g. app.purge" value={filters.action} data-testid="audit-filter-action"
          onChange={(e) => { const v={...filters,action:e.target.value}; setFilters(v); setApplied(v); }} />
        <label className="sr" htmlFor="audit-from">From</label>
        <input id="audit-from" className="input" type="date" value={filters.from} data-testid="audit-filter-from"
          onChange={(e) => { const v={...filters,from:e.target.value}; setFilters(v); setApplied(v); }} />
        <label className="sr" htmlFor="audit-to">To</label>
        <input id="audit-to" className="input" type="date" value={filters.to} data-testid="audit-filter-to"
          onChange={(e) => { const v={...filters,to:e.target.value}; setFilters(v); setApplied(v); }} />
        <button className="btn btn-sm btn-ghost" data-testid="audit-clear-filters" onClick={clearFilters}>Clear filters</button>
        <button className="btn btn-sm" onClick={applyFilters}>Apply</button>
        <span className="helper">{total} entries</span>
      </div>
      {error ? (
        <InlineError operation="load the audit log" error={error} onRetry={() => void load(offset, applied)} />
      ) : entries === null ? (
        <Skeleton variant="block" label="Loading audit log" />
      ) : (
        <>
          <div className="table-wrap">
            <table style={{ minWidth: 1100 }} data-testid="audit-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>App</th>
                  <th>Previous</th>
                  <th>New state</th>
                  <th>IP</th>
                  <th>Request</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr key={`${entry.timestamp}-${entry.actor}-${entry.action}-${index}`} data-testid={`audit-entry-${offset + index}`}>
                    <td className="cell-mono od-nowrap">{entry.timestamp}</td>
                    <td className="od-nowrap">{entry.actor}</td>
                    <td><span className="pill-mono">{entry.action}</span></td>
                    <td className="cell-mono">{entry.target}</td>
                    <td className="cell-mono">{entry.app_id ?? '—'}</td>
                    <td className="cell-mono">{entry.previous_state ?? '—'}</td>
                    <td className="cell-mono cell-strong">{entry.new_state ?? '—'}</td>
                    <td className="cell-mono">{entry.ip ?? '—'}</td>
                    <td className="cell-mono">{entry.request_id ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entries.length === 0 ? (
              <div className="card">
                <div className="empty">
                  <h3>No audit entries match</h3>
                  <p>Clear the filters to see the full trail.</p>
                </div>
              </div>
            ) : null}
          </div>
          <div className="od-row" style={{ '--od-gap': '10px', justifyContent: 'flex-end', marginTop: 14 } as never}>
            <button className="btn btn-sm" data-testid="audit-prev" disabled={!hasPrev} onClick={() => void load(Math.max(0, offset - PAGE_SIZE), applied)}>← Newer</button>
            <span className="helper" data-testid="audit-pager">{offset + 1}–{offset + (entries?.length ?? 0)} of {total}</span>
            <button className="btn btn-sm" data-testid="audit-next" disabled={!hasNext} onClick={() => void load(offset + PAGE_SIZE, applied)}>Older →</button>
          </div>
        </>
      )}
    </div>
  );
}
