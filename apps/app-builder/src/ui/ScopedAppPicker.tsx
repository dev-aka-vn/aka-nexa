/**
 * The scoped-page app picker (BLD-07,
 * BLD-09) — the landing surface for the
 * pages that are scoped to one app
 * (`#/submissions`, `#/connectors`).
 *
 * Both pages read **one app's** data (the
 * viewer's `app_id` filter, the connectors
 * page's request queue). Navigating to the
 * bare route lands here: the caller's own
 * app definitions (`GET /apps`), each
 * linking into the scoped surface. Skeleton
 * while loading, inline error on failure —
 * the shell's two non-negotiable states.
 */

import {
  useCallback,
  useEffect,
  useState,
} from 'react';
import type { ReactElement } from 'react';

import {
  AppsListSchema,
  type AppDefinition,
} from '../api/definition.js';
import { useApiClient } from '../apiHooks.js';
import { InlineError } from '../error/InlineError.js';
import { Skeleton } from '../ui/Skeleton.js';

export interface ScopedAppPickerProps {
  /** The scoped surface the picked app opens. */
  readonly surface: 'submissions' | 'connectors';
  /** The picker's heading. */
  readonly title: string;
  /** The picker's explanatory line. */
  readonly description: string;
}

/**
 * The picker: the caller's apps as cards,
 * each a link into the scoped surface for
 * that app.
 */
export function ScopedAppPicker({
  surface,
  title,
  description,
}: ScopedAppPickerProps): ReactElement {
  const client = useApiClient();
  const [apps, setApps] = useState<AppDefinition[] | null>(
    null,
  );
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const response = await client.get('/apps', AppsListSchema);
      setApps(response.apps);
    } catch (loadError) {
      setApps(null);
      setError(loadError);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div data-testid={`${surface}-picker`}>
      <div className="page-head">
        <div className="titles">
          <h1>{title}</h1>
          <p className="sub">{description}</p>
        </div>
      </div>
      {error ? (
        <InlineError
          operation="load your app list"
          error={error}
          onRetry={() => void load()}
        />
      ) : apps === null ? (
        <Skeleton variant="cards" label="Loading your apps" />
      ) : apps.length === 0 ? (
        <section className="card">
          <div className="card-body">
            <div className="empty" style={{ padding: '32px' }}>
              <h3>No apps yet</h3>
              <p>
                Create your first app — the
                five-step wizard needs no
                documentation and no engineering
                ticket.
              </p>
              <a className="btn btn-primary" href="#/wizard">
                + Create a new app
              </a>
            </div>
          </div>
        </section>
      ) : (
        <div
          className="od-grid"
          style={{ '--od-cols': '3' } as never}
        >
          {apps
            .filter(
              (app) =>
                !(
                  app.lifecycle === 'purged' &&
                  app.executed_at != null
                ),
            )
            .map((app) => (
            <a
              key={app.app_id}
              className="card"
              data-testid={`${surface}-app-${app.app_id}`}
              href={`#/${surface}?app=${encodeURIComponent(
                app.app_id,
              )}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div className="card-body">
                <div
                  className="od-row"
                  style={{
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <h3
                    style={{
                      fontSize: 16,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {app.name}
                  </h3>
                  {app.lifecycle === 'archived' ? (
                    <span className="badge badge-archived">Archived</span>
                  ) : app.lifecycle === 'purged' ? (
                    <span className="badge badge-archived">Purged</span>
                  ) : null}
                </div>
                <div
                  className="lr-s"
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 12,
                  }}
                >
                  {app.app_id}
                </div>
              </div>
              <div
                className="card-foot od-row"
                style={{ justifyContent: 'space-between' } as never}
              >
                <span className="lr-s">
                  Open {surface}
                </span>
                <span className="btn btn-sm">Open →</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
