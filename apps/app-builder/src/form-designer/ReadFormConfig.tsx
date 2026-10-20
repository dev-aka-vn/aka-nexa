/**
 * The U-2 config surfaces for `list` and `show` forms.
 */
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { useApiClient } from '../apiHooks.js';
import { InlineError } from '../error/InlineError.js';
import { formFieldKeys } from './FormDesignerPage.js';
import type { AppForm } from '../api/definition.js';

export interface ReadFormConfigProps {
  readonly appId: string;
  readonly form: AppForm;
  readonly submitSchema: Record<string, unknown>;
  readonly config: Record<string, unknown>;
  readonly onChangeConfig: (next: Record<string, unknown>) => void;
  readonly saveError: unknown;
}

export function ReadFormConfig({
  appId,
  form,
  submitSchema,
  config,
  onChangeConfig,
  saveError,
}: ReadFormConfigProps): ReactElement {
  const client = useApiClient();
  const submitKeys = formFieldKeys(submitSchema);

  const [queries, setQueries] = useState<string[]>([]);
  const [loadingQueries, setLoadingQueries] = useState(false);

  useEffect(() => {
    if (form.kind !== 'list') {
      return;
    }
    let cancelled = false;
    setLoadingQueries(true);
    void (async () => {
      try {
        const response = await client.get(
          `/apps/${appId}/saved-queries`,
          {
            parse: (data: unknown): string[] => {
              if (Array.isArray(data)) {
                return data
                  .map((item) =>
                    typeof item === 'string'
                      ? item
                      : typeof item === 'object' &&
                          item !== null &&
                          typeof (item as { query_id?: unknown })
                            .query_id === 'string'
                        ? ((item as { query_id: string }).query_id)
                        : null,
                  )
                  .filter((value): value is string => value !== null);
              }
              const payload = data as { queries?: unknown } | null;
              if (Array.isArray(payload?.queries)) {
                return payload.queries
                  .map((item) =>
                    typeof item === 'string'
                      ? item
                      : typeof item === 'object' &&
                          item !== null &&
                          typeof (item as { query_id?: unknown })
                            .query_id === 'string'
                        ? ((item as { query_id: string }).query_id)
                        : null,
                  )
                  .filter((value): value is string => value !== null);
              }
              return [];
            },
          },
        );
        if (!cancelled) {
          setQueries(response);
        }
      } catch {
        if (!cancelled) {
          setQueries([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingQueries(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appId, client, form.kind]);

  if (form.kind === 'show') {
    const selected = Array.isArray(config.fields)
      ? (config.fields as unknown[]).filter(
          (value): value is string => typeof value === 'string',
        )
      : [];
    const stale = selected.filter((key) => !submitKeys.includes(key));

    const toggle = (key: string): void => {
      if (selected.includes(key)) {
        onChangeConfig({
          ...config,
          fields: selected.filter((item) => item !== key),
        });
      } else {
        onChangeConfig({ ...config, fields: [...selected, key] });
      }
    };
    const move = (key: string, direction: -1 | 1): void => {
      const index = selected.indexOf(key);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= selected.length) {
        return;
      }
      const next = [...selected];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      onChangeConfig({ ...config, fields: next });
    };

    return (
      <section className="card" data-testid="read-form-config">
        <div className="card-head">
          <h2>Show form config</h2>
          <span className="pill-mono">{form.form_id}</span>
        </div>
        <div className="card-body">
          {stale.length > 0 ? (
            <InlineError
              operation="validate the field selection"
              error={new Error(
                `Stale field key(s) no longer in the submit schema: ${stale.join(', ')}`,
              )}
            />
          ) : null}
          <div className="field">
            <label>Fields (ordered)</label>
            {submitKeys.length === 0 ? (
              <span className="helper">
                The submit form has no fields yet.
              </span>
            ) : (
              <div className="od-stack" style={{ '--od-gap': '8px' } as never}>
                {submitKeys.map((key) => {
                  const checked = selected.includes(key);
                  return (
                    <div
                      key={key}
                      className="od-row"
                      style={{ '--od-gap': '8px', alignItems: 'center' } as never}
                    >
                      <input
                        type="checkbox"
                        data-testid={`show-field-${key}`}
                        checked={checked}
                        onChange={() => toggle(key)}
                      />
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>
                        {key}
                      </span>
                      {checked ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-sm"
                            data-testid={`show-field-up-${key}`}
                            onClick={() => move(key, -1)}
                            disabled={selected.indexOf(key) === 0}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            data-testid={`show-field-down-${key}`}
                            onClick={() => move(key, 1)}
                            disabled={
                              selected.indexOf(key) === selected.length - 1
                            }
                          >
                            ↓
                          </button>
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {saveError !== null ? (
            <InlineError
              operation="save the form config"
              error={saveError}
            />
          ) : null}
        </div>
      </section>
    );
  }

  // list
  const queryId =
    typeof config.query_id === 'string' ? config.query_id : '';
  const columns = Array.isArray(config.columns)
    ? (config.columns as unknown[]).filter(
        (value): value is string => typeof value === 'string',
      )
    : [];

  const toggleColumn = (key: string): void => {
    if (columns.includes(key)) {
      onChangeConfig({
        ...config,
        columns: columns.filter((item) => item !== key),
      });
    } else {
      onChangeConfig({ ...config, columns: [...columns, key] });
    }
  };

  if (loadingQueries) {
    return (
      <section className="card" data-testid="read-form-config">
        <div className="card-body">
          <span className="helper">Loading saved queries…</span>
        </div>
      </section>
    );
  }

  if (queries.length === 0) {
    return (
      <section className="card" data-testid="read-form-config">
        <div className="card-head">
          <h2>List form config</h2>
          <span className="pill-mono">{form.form_id}</span>
        </div>
        <div className="card-body">
          <div className="empty" style={{ padding: '24px' }}>
            <h3>No saved queries</h3>
            <p>
              Saved queries for this app appear here once they exist. A{' '}
              <code>list</code> form needs one.
            </p>
          </div>
          {saveError !== null ? (
            <InlineError
              operation="save the form config"
              error={saveError}
            />
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="card" data-testid="read-form-config">
      <div className="card-head">
        <h2>List form config</h2>
        <span className="pill-mono">{form.form_id}</span>
      </div>
      <div className="card-body">
        <div className="field">
          <label>Saved query</label>
          <select
            className="select"
            data-testid="list-query-select"
            value={queryId}
            onChange={(event) =>
              onChangeConfig({ ...config, query_id: event.target.value })
            }
          >
            <option value="">— choose a query —</option>
            {queries.map((query) => (
              <option key={query} value={query}>
                {query}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Columns</label>
          <div className="od-stack" style={{ '--od-gap': '8px' } as never}>
            {submitKeys.map((key) => (
              <label key={key} className="switch">
                <input
                  type="checkbox"
                  data-testid={`list-column-${key}`}
                  checked={columns.includes(key)}
                  onChange={() => toggleColumn(key)}
                />
                <span className="track" />
                {key}
              </label>
            ))}
          </div>
        </div>
        {saveError !== null ? (
          <InlineError
            operation="save the form config"
            error={saveError}
          />
        ) : null}
      </div>
    </section>
  );
}
