/**
 * The Forms-tab form manager (Phase 7, plan 07-06).
 *
 * One list-row per form in declaration order, a `New form`
 * CTA in the card head, the mockup's Versioning side card, the
 * U-6 kind-specific metadata line, and the U-4 remove flow.
 * Every add/remove persists through `{ section: 'forms',
 * patch: { forms } }` — one section, one field (S3).
 */
import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import {
  type AppDefinition,
  type AppForm,
  type AppFormKind,
  APP_FORM_KINDS,
  AppDefinitionSchema,
} from '../api/definition.js';
import { useApiClient } from '../apiHooks.js';
import { InlineError } from '../error/InlineError.js';

export interface FormManagerProps {
  readonly appId: string;
  readonly definition: AppDefinition;
  readonly onDefinitionChange: (next: AppDefinition) => void;
}

const KIND_DESCRIPTIONS: Readonly<Record<AppFormKind, string>> = {
  submit: 'A form users fill in from chat. Required before an app can be published.',
  list: 'Lists this app\u2019s submissions from a saved query.',
  show: 'Opens one submission read-only, from a link.',
  edit: 'Opens one submission for editing, from a link.',
};

/** Derive a row label — there is no per-form label field in the contract. */
export function deriveFormLabel(appName: string, kind: AppFormKind): string {
  return `${appName} \u2014 ${kind}`;
}

function isLastSubmit(definition: AppDefinition, form: AppForm): boolean {
  if (form.kind !== 'submit') {
    return false;
  }
  return definition.forms.filter((f) => f.kind === 'submit').length <= 1;
}

export function FormManager({
  appId,
  definition,
  onDefinitionChange,
}: FormManagerProps): ReactElement {
  const client = useApiClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [removing, setRemoving] = useState<AppForm | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const patchForms = useCallback(
    async (nextForms: AppForm[]): Promise<void> => {
      setSaving(true);
      setSaveError(null);
      try {
        const response = await client.patch(
          `/apps/${appId}`,
          { section: 'forms', patch: { forms: nextForms } },
          AppDefinitionSchema,
        );
        onDefinitionChange(response);
      } catch (error) {
        setSaveError(error);
      } finally {
        setSaving(false);
      }
    },
    [appId, client, onDefinitionChange],
  );

  const claimed = new Set(definition.forms.map((form) => form.kind));
  const unclaimed = APP_FORM_KINDS.filter((kind) => !claimed.has(kind));

  const handleAdd = useCallback(
    (kind: AppFormKind): void => {
      const next: AppForm = {
        form_id: kind,
        kind,
        schema: null,
        form_version: 1,
        triggers: null,
        config: {},
      };
      void patchForms([...definition.forms, next]);
      setPickerOpen(false);
    },
    [definition.forms, patchForms],
  );

  const handleRemoveConfirm = useCallback((): void => {
    if (removing === null) {
      return;
    }
    const next = definition.forms.filter(
      (form) => form.form_id !== removing.form_id,
    );
    void patchForms(next);
    setRemoving(null);
  }, [definition.forms, removing, patchForms]);

  // Close the remove modal on Escape.
  useEffect(() => {
    if (removing === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setRemoving(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [removing]);

  const firstForm = definition.forms[0] ?? null;

  return (
    <div data-testid="form-manager">
      <div className="grid-main">
        <section className="card">
          <div className="card-head">
            <h2>Forms</h2>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn-sm"
              data-testid="new-form-button"
              disabled={saving || unclaimed.length === 0}
              onClick={() => setPickerOpen(true)}
            >
              New form
            </button>
          </div>
          <div className="card-body">
            <div className="stack-list">
              {definition.forms.map((form) => {
                const label = deriveFormLabel(definition.name, form.kind);
                return (
                  <div
                    key={form.form_id}
                    className="list-row"
                    data-testid="form-row"
                  >
                    <span className="icon-tile it-teal">F</span>
                    <div className="lr-main">
                      <div className="lr-t">{label}</div>
                      <div
                        className="lr-s od-clamp-2"
                        style={{ fontFamily: 'var(--mono)' }}
                      >
                        {form.form_id} &middot; {form.kind}
                      </div>
                      {form.kind === 'list' ? (
                        <div className="lr-s od-clamp-2">
                          {String(form.config?.['query_id'] ?? '')}
                        </div>
                      ) : null}
                      {form.kind === 'show' ? (
                        <div className="lr-s od-clamp-2">
                          {Array.isArray(form.config?.['fields'])
                            ? (form.config['fields'] as unknown[]).length
                            : 0}{' '}
                          fields
                        </div>
                      ) : null}
                    </div>
                    <span className="pill-mono">v{form.form_version}</span>
                    <a
                      className="btn btn-sm btn-ghost"
                      data-testid="form-preview"
                      href={`#/apps/${appId}/designer?form=${encodeURIComponent(form.form_id)}`}
                    >
                      Preview
                    </a>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Remove form"
                      data-testid="form-remove"
                      onClick={() => setRemoving(form)}
                    >
                      <span aria-hidden="true">&#128465;</span>
                    </button>
                  </div>
                );
              })}
            </div>
            <div
              className="callout callout-accent"
              style={{ marginTop: 18 }}
            >
              <div>
                All forms are rendered by <b>FormIO.js</b> &mdash; the
                single permitted engine for both the drag-and-drop builder
                and the runtime renderer.
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Versioning</h2>
          </div>
          <div className="card-body">
            <div className="callout callout-info">
              <div>
                Published form changes never affect in-progress submissions.
                The form version is pinned at link creation.
              </div>
            </div>
            <div className="divider" />
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>
              Recent schema versions
            </h3>
            <div className="stack-list">
              {firstForm !== null ? (
                <>
                  <div
                    className="od-row"
                    style={{ justifyContent: 'space-between' }}
                  >
                    <span
                      className="od-fill"
                      style={{ fontSize: 13.5 }}
                    >
                      {deriveFormLabel(definition.name, firstForm.kind)}
                    </span>
                    <span className="pill-mono">
                      v{firstForm.form_version} &middot; current
                    </span>
                  </div>
                  <div
                    className="od-row"
                    style={{ justifyContent: 'space-between' }}
                  >
                    <span
                      className="od-fill"
                      style={{ fontSize: 13.5 }}
                    >
                      {deriveFormLabel(definition.name, firstForm.kind)}
                    </span>
                    <span className="pill-mono">
                      v{Math.max(1, firstForm.form_version - 1)} &middot;
                      archived
                    </span>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </section>
      </div>

      {saveError !== null ? (
        <div style={{ marginTop: 12 }}>
          <InlineError
            operation="save the forms section"
            error={saveError}
            onRetry={() => setSaveError(null)}
          />
        </div>
      ) : null}

      {/* New form picker */}
      {pickerOpen ? (
        <div
          className="scrim"
          data-testid="form-picker-scrim"
          onClick={() => setPickerOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            className="modal"
            data-testid="form-picker"
            onClick={(event) => event.stopPropagation()}
            style={{
              background: 'var(--surface)',
              borderRadius: 'var(--radius)',
              padding: 16,
              maxWidth: 480,
              width: '90%',
            }}
          >
            <div className="modal-head">
              <h2>New form</h2>
            </div>
            <div className="modal-body">
              <div
                className="od-stack"
                style={{ '--od-gap': '10px' } as never}
              >
                {unclaimed.map((kind) => (
                  <label
                    key={kind}
                    className="radio-card"
                    data-testid={`kind-option-${kind}`}
                    onClick={() => handleAdd(kind)}
                  >
                    <input type="radio" name="new-form-kind" readOnly />
                    <span>
                      <span className="rc-t">{kind}</span>
                      <span className="rc-d">{KIND_DESCRIPTIONS[kind]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="btn btn-sm"
                data-testid="form-picker-cancel"
                onClick={() => setPickerOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Remove confirm modal */}
      {removing !== null ? (
        <div
          className="scrim"
          data-testid="form-remove-scrim"
          onClick={() => setRemoving(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            className="modal"
            data-testid="form-remove-modal"
            onClick={(event) => event.stopPropagation()}
            style={{
              background: 'var(--surface)',
              borderRadius: 'var(--radius)',
              padding: 16,
              maxWidth: 480,
              width: '90%',
            }}
          >
            <div className="modal-head">
              <h2>Remove form</h2>
            </div>
            <div className="modal-body">
              {isLastSubmit(definition, removing) ? (
                <div className="callout callout-warn">
                  An app needs a submit form to publish. This is the only
                  one, so the app can&rsquo;t be published until a new submit
                  form is added.
                </div>
              ) : null}
              <p>
                {removing.kind === 'submit' || removing.kind === 'list'
                  ? `Remove \u201C${deriveFormLabel(definition.name, removing.kind)}\u201D? This removes the form and its trigger. Submissions already created through it keep their data. This can\u2019t be undone from here.`
                  : `Remove \u201C${deriveFormLabel(definition.name, removing.kind)}\u201D? This removes the form. Submissions already created through it keep their data. This can\u2019t be undone from here.`}
              </p>
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="btn btn-sm"
                data-testid="form-remove-cancel"
                onClick={() => setRemoving(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                data-testid="form-remove-confirm"
                disabled={isLastSubmit(definition, removing) || saving}
                onClick={handleRemoveConfirm}
              >
                Remove form
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
