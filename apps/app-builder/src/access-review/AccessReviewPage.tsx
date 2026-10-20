import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { AccessReviewSchema, type AccessReviewReport } from '../api/accessReview.js';
import { useApiClient } from '../apiHooks.js';
import { InlineError } from '../error/InlineError.js';
import { Skeleton } from '../ui/Skeleton.js';

export function AccessReviewPage(): ReactElement {
  const client = useApiClient();
  const [report, setReport] = useState<AccessReviewReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const data = await client.get('/audit/access-review', AccessReviewSchema as never);
      setReport(data as AccessReviewReport);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <div data-testid="access-review-page">
        <div className="page-head"><div className="titles"><h1>Access Review</h1><p className="sub">Who holds which role on which app, from the latest quarterly run. Generated automatically and appended to the audit trail.</p></div></div>
        <InlineError operation="load the access review" error={error} onRetry={() => void load()} />
      </div>
    );
  }
  if (loading) {
    return (
      <div data-testid="access-review-page">
        <div className="page-head"><div className="titles"><h1>Access Review</h1></div></div>
        <Skeleton variant="block" label="Loading access review" />
      </div>
    );
  }

  return (
    <div data-testid="access-review-page">
      <div className="page-head">
        <div className="titles">
          <h1>Access Review</h1>
          <p className="sub">Who holds which role on which app, from the latest quarterly run. Generated automatically and appended to the audit trail.</p>
        </div>
        <div className="page-actions">
          <a className="btn" data-testid="access-review-export" href="/audit/access-review/export" target="_blank" rel="noreferrer">Export JSON Lines</a>
        </div>
      </div>
      <div className="table-wrap">
        <table data-testid="access-review-table">
          <thead>
            <tr>
              <th>App</th>
              <th>Role</th>
              <th>Members</th>
              <th>Generated</th>
            </tr>
          </thead>
          <tbody>
            {(report?.apps ?? []).flatMap((app) =>
              (app.roles ?? []).map((r, i) => (
                <tr key={`${app.app_id}-${r.role}-${i}`} data-testid="access-review-row">
                  <td className="cell-mono">{app.app_id}</td>
                  <td>{r.role}</td>
                  <td className="od-clamp-2" style={{ maxWidth: 400, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {(r.members ?? []).join(', ')}
                  </td>
                  <td className="cell-mono">{report?.generated_at}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
        {(!report || (report.apps ?? []).length === 0) ? (
          <div className="card"><div className="empty"><h3>No access review yet</h3><p>Generated automatically each quarter.</p></div></div>
        ) : null}
      </div>
    </div>
  );
}
