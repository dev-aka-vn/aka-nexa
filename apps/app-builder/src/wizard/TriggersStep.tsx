/**
 * Wizard step 2 — Triggers (BLD-01).
 *
 * Intent labels and slash-command aliases, the
 * mockup's trigger vocabulary
 * (prototypes/mockup.html, tabTriggers): an
 * intent carries a label and example phrases;
 * a slash command is a deterministic alias
 * that bypasses JEV. Zero triggers is a valid
 * step (triggers are optional at creation —
 * the editor's Triggers tab owns the full
 * surface later).
 *
 * The step's PATCH writes the `triggers`
 * section (plan 04's section vocabulary) in
 * the shape the app definition stores.
 */

import type { ReactElement } from 'react';

/** One wizard trigger row before it is normalized to the stored shape. */
export interface TriggerRow {
  kind: 'intent' | 'slash';
  /** The intent label (intent rows). */
  intent: string;
  /** The example phrase (intent rows). */
  example: string;
  /** The slash-command alias (slash rows). */
  command: string;
}

export interface TriggersValue {
  triggers: TriggerRow[];
}

export interface TriggersStepProps {
  value: TriggersValue;
  onChange: (value: TriggersValue) => void;
}

/** Whether every trigger row on the step is complete (a row's active kind's field is filled). */
export function triggersValid(value: TriggersValue): boolean {
  return value.triggers.every((row) =>
    row.kind === 'intent'
      ? row.intent.trim().length > 0
      : row.command.trim().length > 0,
  );
}

export function TriggersStep({
  value,
  onChange,
}: TriggersStepProps): ReactElement {
  const setRow = (
    index: number,
    patch: Partial<TriggerRow>,
  ): void => {
    onChange({
      triggers: value.triggers.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      ),
    });
  };

  const addTrigger = (): void => {
    onChange({
      triggers: [
        ...value.triggers,
        { kind: 'intent', intent: '', example: '', command: '' },
      ],
    });
  };

  const removeTrigger = (index: number): void => {
    onChange({
      triggers: value.triggers.filter((_, i) => i !== index),
    });
  };

  const valid = triggersValid(value);

  return (
    <div data-testid="wizard-step-triggers">
      <div className="od-stack" style={{ '--od-gap': '12px' } as never}>
        {value.triggers.map((row, index) => (
          <div
            key={index}
            className="od-row-top"
            style={{ '--od-gap': '10px' } as never}
            data-testid={`wizard-trigger-row-${index}`}
          >
            <select
              className="select"
              data-testid={`wizard-trigger-kind-${index}`}
              aria-label={`Trigger ${index + 1} type`}
              value={row.kind}
              onChange={(event) =>
                setRow(index, {
                  kind: event.target.value as TriggerRow['kind'],
                })
              }
            >
              <option value="intent">Intent</option>
              <option value="slash">Slash command</option>
            </select>
            {row.kind === 'intent' ? (
              <>
                <input
                  className="input"
                  data-testid={`wizard-trigger-intent-${index}`}
                  placeholder="Intent label, e.g. request_leave"
                  value={row.intent}
                  onChange={(event) =>
                    setRow(index, { intent: event.target.value })
                  }
                />
                <input
                  className="input"
                  data-testid={`wizard-trigger-example-${index}`}
                  placeholder="Example phrase, e.g. I want to take leave"
                  value={row.example}
                  onChange={(event) =>
                    setRow(index, { example: event.target.value })
                  }
                />
              </>
            ) : (
              <input
                className="input"
                data-testid={`wizard-trigger-command-${index}`}
                placeholder="Slash command, e.g. /leave request"
                value={row.command}
                onChange={(event) =>
                  setRow(index, { command: event.target.value })
                }
              />
            )}
            <button
              type="button"
              className="icon-btn"
              data-testid={`wizard-trigger-remove-${index}`}
              aria-label={`Remove trigger ${index + 1}`}
              onClick={() => removeTrigger(index)}
            >
              ✕
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="btn btn-sm"
            data-testid="wizard-trigger-add"
            onClick={addTrigger}
          >
            + Add trigger
          </button>
        </div>
        <span className="helper">
          Only triggers for the requesting user are sent to the
          JEV decision engine. Intents match on example phrases;
          slash commands route deterministically.
        </span>
      </div>
      <span
        data-testid="wizard-triggers-valid"
        data-valid={valid ? 'true' : 'false'}
        hidden
      />
    </div>
  );
}

/**
 * Normalize the wizard's trigger rows to the
 * stored `triggers` section shape
 * (`{type: 'intent', intent, examples}` /
 * `{type: 'slash', command}` — the mockup's
 * vocabulary, stored verbatim).
 */
export function normalizeTriggers(
  value: TriggersValue,
): Record<string, unknown>[] {
  return value.triggers
    .filter((row) =>
      row.kind === 'intent'
        ? row.intent.trim().length > 0
        : row.command.trim().length > 0,
    )
    .map((row) =>
      row.kind === 'intent'
        ? {
            type: 'intent',
            intent: row.intent.trim(),
            examples:
              row.example.trim().length > 0
                ? [row.example.trim()]
                : [],
          }
        : {
            type: 'slash',
            command: row.command.trim(),
          },
    );
}
