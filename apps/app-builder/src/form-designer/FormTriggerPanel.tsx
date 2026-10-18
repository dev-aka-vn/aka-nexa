/**
 * The U-1 in-form trigger panel.
 *
 * Edits the loaded form's `{intents, aliases, threshold}`
 * (D-06) and saves through the designer's `forms`-section
 * seam. Disabled (with a visible reason) for `show`/`edit`
 * kinds (D-08).
 */
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import type { AppForm, FormTrigger } from '../api/definition.js';
import { InlineError } from '../error/InlineError.js';

export interface FormTriggerPanelProps {
  readonly form: AppForm;
  readonly disabled: boolean;
  readonly disabledReason: string;
  readonly thresholdDefault: number;
  readonly triggers: FormTrigger | null;
  readonly onChangeTriggers: (next: FormTrigger | null) => void;
}

interface TriggerRow {
  kind: 'intent' | 'slash';
  value: string;
}

function rowsFromTriggers(triggers: FormTrigger | null): TriggerRow[] {
  const rows: TriggerRow[] = [];
  for (const intent of triggers?.intents ?? []) {
    rows.push({ kind: 'intent', value: intent });
  }
  for (const alias of triggers?.aliases ?? []) {
    rows.push({ kind: 'slash', value: alias });
  }
  return rows;
}

function rebuild(
  rows: TriggerRow[],
  threshold: number,
): FormTrigger | null {
  const intents = rows
    .filter((row) => row.kind === 'intent')
    .map((row) => row.value);
  const aliases = rows
    .filter((row) => row.kind === 'slash')
    .map((row) => row.value);
  if (intents.length === 0 && aliases.length === 0) {
    return null;
  }
  return { intents, aliases, threshold };
}

export function FormTriggerPanel({
  form,
  disabled,
  disabledReason,
  thresholdDefault,
  triggers,
  onChangeTriggers,
}: FormTriggerPanelProps): ReactElement {
  const [rows, setRows] = useState<TriggerRow[]>(() =>
    rowsFromTriggers(triggers),
  );
  const [threshold, setThreshold] = useState<number>(
    triggers?.threshold ?? thresholdDefault,
  );
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setRows(rowsFromTriggers(triggers));
    setThreshold(triggers?.threshold ?? thresholdDefault);
  }, [triggers, thresholdDefault]);

  const enabled = triggers !== null;

  const commit = (
    nextRows: TriggerRow[],
    nextThreshold: number,
  ): void => {
    setRows(nextRows);
    setThreshold(nextThreshold);
    try {
      onChangeTriggers(rebuild(nextRows, nextThreshold));
      setError(null);
    } catch (commitError) {
      setError(commitError);
    }
  };

  const handleToggleEnabled = (on: boolean): void => {
    if (on) {
      const nextThreshold = thresholdDefault;
      setRows([]);
      setThreshold(nextThreshold);
      onChangeTriggers({
        intents: [],
        aliases: [],
        threshold: nextThreshold,
      });
    } else {
      setRows([]);
      onChangeTriggers(null);
    }
  };

  const addRow = (): void => {
    const next = [...rows, { kind: 'intent' as const, value: '' }];
    commit(next, threshold);
  };

  const removeRow = (index: number): void => {
    const next = rows.filter((_, i) => i !== index);
    commit(next, threshold);
  };

  const setRowKind = (
    index: number,
    kind: TriggerRow['kind'],
  ): void => {
    const next = rows.map((row, i) =>
      i === index ? { ...row, kind } : row,
    );
    commit(next, threshold);
  };

  const setRowValue = (index: number, value: string): void => {
    const next = rows.map((row, i) =>
      i === index ? { ...row, value } : row,
    );
    commit(next, threshold);
  };

  return (
    <section className="card" data-testid="form-trigger-panel">
      <div className="card-head">
        <h2>Triggers</h2>
        <span className="pill-mono">{form.form_id}</span>
      </div>
      <div className="card-body">
        {disabled ? (
          <div className="callout callout-info" data-testid="trigger-disabled-note">
            {disabledReason}
          </div>
        ) : null}

        <label className="switch" style={{ marginBottom: 16 }}>
          <input
            type="checkbox"
            data-testid="trigger-enable-switch"
            checked={enabled}
            disabled={disabled}
            onChange={(event) =>
              handleToggleEnabled(event.target.checked)
            }
          />
          <span className="track" />
          Enable triggers for this form
        </label>

        {enabled && !disabled ? (
          <>
            {rows.length === 0 ? (
              <div className="empty" style={{ padding: '24px' }}>
                <h3>No triggers yet</h3>
                <p>
                  Add an intent or slash command so users can launch
                  this app from chat.
                </p>
              </div>
            ) : (
              <div className="stack-list">
                {rows.map((row, index) => (
                  <div
                    key={index}
                    className="list-row"
                    data-testid={`trigger-row-${index}`}
                  >
                    <span
                      className={`icon-tile ${
                        row.kind === 'intent' ? 'it-blue' : 'it-teal'
                      }`}
                    >
                      {row.kind === 'intent' ? 'I' : '/'}
                    </span>
                    <div className="lr-main">
                      <div className="lr-t">
                        {row.kind === 'intent'
                          ? `Intent · ${row.value}`
                          : `Slash command · ${row.value}`}
                      </div>
                      {row.kind === 'slash' ? (
                        <div className="lr-s">
                          Deterministic routing — bypasses JEV (no-JEV
                          mode).
                        </div>
                      ) : null}
                    </div>
                    <select
                      className="select"
                      data-testid={`trigger-kind-${index}`}
                      value={row.kind}
                      disabled={disabled}
                      onChange={(event) =>
                        setRowKind(
                          index,
                          event.target.value as TriggerRow['kind'],
                        )
                      }
                      style={{ maxWidth: 140 }}
                    >
                      <option value="intent">Intent</option>
                      <option value="slash">Slash command</option>
                    </select>
                    {row.kind === 'intent' ? (
                      <input
                        className="input"
                        data-testid={`trigger-intent-${index}`}
                        placeholder="Intent label, e.g. request_leave"
                        value={row.value}
                        disabled={disabled}
                        onChange={(event) =>
                          setRowValue(index, event.target.value)
                        }
                      />
                    ) : (
                      <input
                        className="input"
                        data-testid={`trigger-command-${index}`}
                        placeholder="Slash command, e.g. /leave request"
                        value={row.value}
                        disabled={disabled}
                        onChange={(event) =>
                          setRowValue(index, event.target.value)
                        }
                      />
                    )}
                    <button
                      type="button"
                      className="icon-btn"
                      data-testid={`trigger-remove-${index}`}
                      aria-label="Remove trigger"
                      disabled={disabled}
                      onClick={() => removeRow(index)}
                    >
                      <span aria-hidden="true">&#128465;</span>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-sm"
                data-testid="add-trigger"
                disabled={disabled || !enabled}
                onClick={addRow}
              >
                Add trigger
              </button>
            </div>

            <div className="field" style={{ marginTop: 16 }}>
              <label>
                Confidence threshold
                <span className="helper" style={{ fontWeight: 400 }}>
                  {' '}
                  · per app
                </span>
              </label>
              <input
                className="input"
                type="number"
                data-testid="trigger-threshold"
                value={threshold}
                step={0.05}
                min={0}
                max={1}
                disabled={disabled || !enabled}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setThreshold(next);
                  commit(rows, next);
                }}
              />
              <span className="helper">
                Below threshold → clarification prompt or fall back to
                rule-based.
              </span>
            </div>

            <span className="helper">
              Only triggers for the requesting user are sent to the JEV
              decision engine. Intents match on example phrases; slash
              commands route deterministically.
            </span>
          </>
        ) : null}

        {error !== null ? (
          <InlineError
            operation="save the triggers"
            error={error}
          />
        ) : null}
      </div>
    </section>
  );
}
