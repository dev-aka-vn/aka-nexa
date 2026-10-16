/**
 * The form designer (BLD-02's Forms tab →
 * the designer route, BLD-04, BLD-05,
 * FRM-05, FRM-09).
 *
 * One page, two engines: the React shell
 * and the imperative FormIO builder share
 * it through the container-as-leaf mount
 * (Pattern 4) — React never reconciles
 * inside the FormIO-controlled subtree.
 *
 * The page is the draft's form authoring
 * surface:
 *
 *  - **Builder** — FormioBuilderField
 *    mounts the app's `form_schema`; the
 *    change event feeds the 50-action
 *    snapshot history (Pattern 2) that the
 *    undo/redo toolbar drives.
 *  - **Preview** — the same schema renders
 *    into the FRM-09 sandbox (PreviewPane):
 *    `nosubmit` + the in-memory buffer, so
 *    preview submissions cannot reach the
 *    real submissions collection.
 *  - **Field mapping** (BLD-05) — the
 *    form's fields (from the schema) beside
 *    the connector's fields (from the
 *    routing section), a per-field pairing
 *    control persisted through
 *    PUT /apps/:id/routing/mapping.
 *
 * Every async surface shows the skeleton
 * while loading and the inline, specific,
 * actionable error on failure (BLD-07/
 * BLD-09).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactElement } from 'react';

import {
  type ApiClient,
  type ResponseSchema,
} from '../api/client.js';
import {
  type AppDefinition,
  AppDefinitionSchema,
} from '../api/definition.js';
import { useApiClient } from '../apiHooks.js';
import { InlineError } from '../error/InlineError.js';
import { Skeleton } from '../ui/Skeleton.js';
import { readWizardSnapshot } from '../wizard/wizardDraftStore.js';
import {
  FormioBuilderField,
  type FormioBuilderHandle,
} from './FormioBuilderField.js';
import { PreviewPane, type PreviewPaneHandle } from './PreviewPane.js';
import { SubmissionSandbox } from './sandbox.js';

/**
 * The field-mapping record the routing
 * endpoint serves (plan 06's frozen
 * contract).
 */
interface FieldMappingRecord {
  app_id: string;
  field_mapping: Record<string, string>;
  version: number;
}

/** The field-mapping endpoint's wire shape. */
const FieldMappingSchema: ResponseSchema<FieldMappingRecord> = {
  parse: (data: unknown): FieldMappingRecord => {
    const doc = data as Partial<FieldMappingRecord> | null;
    if (
      typeof doc !== 'object' ||
      doc === null ||
      typeof doc.app_id !== 'string' ||
      typeof doc.field_mapping !== 'object' ||
      doc.field_mapping === null ||
      typeof doc.version !== 'number'
    ) {
      throw new Error('malformed field-mapping record');
    }
    const fieldMapping: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      doc.field_mapping,
    )) {
      if (typeof value === 'string') {
        fieldMapping[key] = value;
      }
    }
    return {
      app_id: doc.app_id,
      field_mapping: fieldMapping,
      version: doc.version,
    };
  },
};

/**
 * The form's field keys, flattened from the
 * schema's component tree (nested
 * components — panels, edit grids —
 * contribute their children).
 */
export function formFieldKeys(
  schema: Record<string, unknown>,
): string[] {
  const keys: string[] = [];
  const walk = (components: unknown): void => {
    if (!Array.isArray(components)) {
      return;
    }
    for (const component of components) {
      if (typeof component !== 'object' || component === null) {
        continue;
      }
      const key = (component as { key?: unknown }).key;
      if (typeof key === 'string' && key.length > 0) {
        keys.push(key);
      }
      walk((component as { components?: unknown }).components);
    }
  };
  walk(schema.components);
  return keys;
}

/**
 * The connector's field list, as the app's
 * routing section declares it. The routing
 * config is an open record by contract;
 * `connector_fields` is the vocabulary the
 * mapping surface pairs against.
 */
export function connectorFields(
  routingConfig: Record<string, unknown> | null,
): string[] {
  const fields = (routingConfig ?? {})[
    'connector_fields'
  ];
  if (!Array.isArray(fields)) {
    return [];
  }
  return fields.filter(
    (field): field is string => typeof field === 'string',
  );
}

/** An empty form definition (a draft with no schema yet). */
const EMPTY_FORM_SCHEMA: Record<string, unknown> = {
  display: 'Untitled form',
  components: [],
};

export interface FormDesignerPageProps {
  /** The draft's immutable app_id. */
  appId: string;
}

/**
 * The field-mapping surface (BLD-05): the
 * form's fields beside the connector's
 * fields, with the per-field pairing
 * control.
 */
function MappingSurface({
  appId,
  client,
  schema,
  routingConfig,
}: {
  appId: string;
  client: ApiClient;
  schema: Record<string, unknown>;
  routingConfig: Record<string, unknown> | null;
}): ReactElement {
  const [pairings, setPairings] = useState<
    Record<string, string>
  >({});
  const [saved, setSaved] = useState<
    FieldMappingRecord | null
  >(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const fields = useMemo(() => formFieldKeys(schema), [schema]);
  const targets = useMemo(
    () => connectorFields(routingConfig),
    [routingConfig],
  );

  const save = useCallback(async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const record = await client.put(
        `/apps/${appId}/routing/mapping`,
        { field_mapping: pairings },
        FieldMappingSchema,
      );
      setSaved(record);
    } catch (saveError) {
      setSaved(null);
      setError(saveError);
    } finally {
      setSaving(false);
    }
  }, [appId, client, pairings]);

  return (
    <section className="card" data-testid="field-mapping">
      <div className="card-head">
        <h2>Field mapping</h2>
        <span className="pill-mono">form → connector</span>
      </div>
      <div className="card-body">
        {targets.length === 0 ? (
          <div className="empty" style={{ padding: '24px' }}>
            <h3>No connector fields</h3>
            <p>
              The routing section declares no
              connector fields to map to. Pairings
              appear here once the routing section
              names them.
            </p>
          </div>
        ) : (
          <div className="od-stack" style={{ '--od-gap': '10px' } as never}>
            {fields.map((field) => (
              <div
                className="od-row"
                key={field}
                style={{ '--od-gap': '10px', alignItems: 'center' } as never}
                data-testid={`mapping-field-${field}`}
              >
                <span
                  className="lr-s"
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 12.5,
                    minWidth: 140,
                  }}
                >
                  {field}
                </span>
                <span style={{ color: 'var(--muted)' }}>→</span>
                <select
                  className="select"
                  data-testid={`mapping-select-${field}`}
                  value={pairings[field] ?? ''}
                  onChange={(event) =>
                    setPairings((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))
                  }
                >
                  <option value="">— unmapped —</option>
                  {targets.map((target) => (
                    <option key={target} value={target}>
                      {target}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
        <div
          className="od-row"
          style={{
            '--od-gap': '10px',
            marginTop: 16,
            justifyContent: 'space-between',
            alignItems: 'center',
          } as never}
        >
          <span className="helper">
            {saved === null
              ? 'Pairings persist through the routing endpoint.'
              : `Saved — field mapping stored on version ${saved.version}.`}
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-testid="mapping-save-button"
            disabled={saving || targets.length === 0}
            onClick={() => void save()}
          >
            Save mapping
          </button>
        </div>
        {saved !== null && (
          <span
            className="helper"
            data-testid="mapping-saved"
            style={{ color: 'var(--green)' }}
          >
            Field mapping saved.
          </span>
        )}
        {error !== null && (
          <InlineError
            operation="save the field mapping"
            error={error}
            onRetry={() => void save()}
          />
        )}
      </div>
    </section>
  );
}

/**
 * The designer page. Loads the draft
 * definition (skeleton while loading — the
 * form-schema load is a named skeleton
 * surface, BLD-09), then mounts the
 * builder, the sandbox preview, and the
 * mapping surface.
 */
export function FormDesignerPage({
  appId,
}: FormDesignerPageProps): ReactElement {
  const client = useApiClient();
  const builderFieldRef = useRef<FormioBuilderHandle>(null);
  const previewPaneRef = useRef<PreviewPaneHandle>(null);
  const sandboxRef = useRef<SubmissionSandbox | null>(null);
  if (sandboxRef.current === null) {
    sandboxRef.current = new SubmissionSandbox();
  }
  const sandbox = sandboxRef.current;

  const [definition, setDefinition] =
    useState<AppDefinition | null>(null);
  const [loadError, setLoadError] = useState<unknown>(
    null,
  );
  const [schema, setSchema] = useState<
    Record<string, unknown>
  >(EMPTY_FORM_SCHEMA);
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  });
  /**
   * The schema's persistence state (the user-facing
   * half of BLD-04): the builder edits only its
   * in-memory schema — nothing reaches the API until
   * Save fires PATCH /apps/:id {section: 'forms'}.
   * `dirty` tracks builder edits against the last
   * saved (or served) schema; the back-to-wizard
   * link routes through `saveForm` while dirty, so
   * leaving the designer can no longer silently
   * discard the design.
   */
  const [saving, setSaving] = useState(false);
  const [savedVersion, setSavedVersion] = useState<
    number | null
  >(null);
  const [saveError, setSaveError] = useState<unknown>(
    null,
  );
  const [dirty, setDirty] = useState(false);
  /** The JSON of the schema as last persisted. */
  const lastSavedJsonRef = useRef('');

  /**
   * G-06-7's return leg: the wizard position
   * the user left, when there is one. Read
   * once — the designer mounts because the
   * wizard unmounted, so no snapshot can
   * appear mid-visit. With no snapshot there
   * is no retained step to resume, so the
   * exit control targets the app editor
   * instead: the designer must always offer
   * a way back — entering it from the
   * editor's Forms tab (or after the wizard
   * finished and cleared its snapshot) used
   * to strand the user with no exit at all.
   */
  const [wizardReturnStep] = useState<number | null>(() => {
    const snapshot = readWizardSnapshot(appId);
    return snapshot === null ? null : snapshot.step;
  });

  /**
   * Where the exit control leads: the resumable
   * wizard position when one was snapshotted, the
   * app editor otherwise. The same target the
   * save-on-leave handler navigates to.
   */
  const exitTarget =
    wizardReturnStep !== null
      ? `#/wizard?app=${encodeURIComponent(appId)}&step=${wizardReturnStep}`
      : `#/apps/${encodeURIComponent(appId)}`;

  const load = useCallback(async (): Promise<void> => {
    setLoadError(null);
    try {
      const loaded = await client.get(
        `/apps/${appId}`,
        AppDefinitionSchema,
      );
      setDefinition(loaded);
      // A draft with a schema edits it; a
      // draft without one starts blank.
      const restored = structuredClone(
        (loaded.form_schema ??
          EMPTY_FORM_SCHEMA) as Record<string, unknown>,
      );
      setSchema(restored);
      // The served schema is the persistence baseline
      // the dirty tracker compares builder edits
      // against.
      lastSavedJsonRef.current = JSON.stringify(restored);
      setDirty(false);
      setSavedVersion(null);
      setSaveError(null);
    } catch (error) {
      setDefinition(null);
      setLoadError(error);
    }
  }, [appId, client]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The builder's change handler. The
   * schema is cloned into state so the
   * preview's re-render effect sees a new
   * reference on every change (FormIO may
   * reuse the in-place schema object).
   */
  const handleSchemaChange = useCallback(
    (current: Record<string, unknown>): void => {
      setSchema(structuredClone(current));
      // Every builder change is an unsaved edit until
      // Save persists it. (FormIO may also normalise
      // the served schema and round-trip it through
      // here on mount; the worst case of counting
      // that as dirty is one harmless extra save —
      // never a silently discarded design.)
      setDirty(
        JSON.stringify(current) !== lastSavedJsonRef.current,
      );
    },
    [],
  );

  /**
   * Persist the builder's current schema (BLD-04's
   * save leg): PATCH /apps/:id with the frozen
   * `forms` section shape — `{section, patch:
   * {form_schema}}` — the same version-bumped,
   * audited transition the editor's section saves
   * use. Returns whether the save landed, so the
   * exit controls can refuse to navigate away from
   * a failed save (a silent discard is the exact
   * defect this closes).
   *
   * The in-flight guard is a ref, not state: the
   * exit controls and the InlineError retry call
   * saveForm() directly, bypassing the Save
   * button's disabled attribute, and state updates
   * read stale within the same tick — a second call
   * while the first PATCH is in flight would
   * double-bump the version and duplicate the audit
   * row.
   */
  const saveInFlightRef = useRef(false);
  const saveForm = useCallback(async (): Promise<boolean> => {
    if (saveInFlightRef.current) {
      return false;
    }
    saveInFlightRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const current =
        builderFieldRef.current?.builder?.schema ?? schema;
      const response = await client.patch(
        `/apps/${appId}`,
        { section: 'forms', patch: { form_schema: current } },
        AppDefinitionSchema,
      );
      setDefinition(response);
      lastSavedJsonRef.current = JSON.stringify(current);
      // Re-derive dirty against the LIVE builder
      // schema, not the saved snapshot: edits made
      // while the PATCH was in flight fired their own
      // change events, and resetting dirty to false
      // unconditionally would read the builder as
      // clean while it still holds unsaved work —
      // reopening, through a race window, the very
      // silent-discard defect this control closes.
      const live = builderFieldRef.current?.builder?.schema;
      setDirty(
        live === undefined
          ? false
          : JSON.stringify(live) !== lastSavedJsonRef.current,
      );
      setSavedVersion(response.version);
      return true;
    } catch (error) {
      // savedVersion deliberately stays: a failed
      // save must not wipe the record of the last
      // successful one — the indicator keeps
      // agreeing with server reality mid-failure.
      setSaveError(error);
      return false;
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }, [appId, client, schema]);

  const handleHistoryChange = useCallback(
    (state: { canUndo: boolean; canRedo: boolean }): void => {
      setHistoryState(state);
    },
    [],
  );

  const handleUndo = useCallback(async (): Promise<void> => {
    await builderFieldRef.current?.undo();
  }, []);

  const handleRedo = useCallback(async (): Promise<void> => {
    await builderFieldRef.current?.redo();
  }, []);

  /**
   * The designer's observability handle —
   * the same pattern the S1 spike
   * established (`window.__SPIKE__`):
   * window-global, deliberately marked,
   * read by the e2e spec.
   */
  useEffect(() => {
    const handle = {
      getSchema: (): Record<string, unknown> | null =>
        builderFieldRef.current?.builder?.schema ?? null,
      getHistory: () => builderFieldRef.current?.history ?? null,
      getPreviewForm: () => previewPaneRef.current?.getForm() ?? null,
      getSandbox: () => sandbox,
    };
    (
      window as Window & {
        __DESIGNER__?: typeof handle;
      }
    ).__DESIGNER__ = handle;
    return () => {
      (
        window as Window & {
          __DESIGNER__?: typeof handle;
        }
      ).__DESIGNER__ = undefined;
    };
  }, [sandbox]);

  const routingConfig = definition?.routing_config ?? null;

  return (
    <div className="view" data-testid="designer-page">
      <div className="page-head">
        <div className="titles">
          <h1>
            {definition === null ? 'Form designer' : definition.name}
          </h1>
          <p className="sub">
            Form designer · {appId} · v
            {definition?.version ?? '…'}
          </p>
        </div>
        <a
          className="btn btn-sm"
          data-testid={
            wizardReturnStep !== null
              ? 'designer-back-to-wizard'
              : 'designer-back-to-app'
          }
          href={exitTarget}
          onClick={(event) => {
            // Leaving with unsaved edits routes through
            // the save first — the silent discard this
            // link used to perform is the defect the
            // save leg closes. A failed save keeps the
            // user here (the inline error names why);
            // navigation only proceeds once the
            // schema is persisted.
            if (!dirty) {
              return;
            }
            event.preventDefault();
            void (async () => {
              const saved = await saveForm();
              if (saved) {
                window.location.hash = exitTarget;
              }
            })();
          }}
        >
          {wizardReturnStep !== null
            ? 'Back to the wizard'
            : 'Back to the app'}
        </a>
      </div>

      {loadError !== null ? (
        <InlineError
          operation="load the app definition"
          error={loadError}
          onRetry={() => void load()}
        />
      ) : definition === null ? (
        <Skeleton variant="block" label="Loading the form schema" />
      ) : (
        <>
          <div
            className="od-row"
            role="toolbar"
            aria-label="Form designer"
            style={{
              '--od-gap': '8px',
              marginBottom: 14,
            } as never}
          >
            <button
              type="button"
              className="btn btn-sm"
              data-testid="designer-undo-button"
              disabled={!historyState.canUndo}
              onClick={() => void handleUndo()}
            >
              Undo
            </button>
            <button
              type="button"
              className="btn btn-sm"
              data-testid="designer-redo-button"
              disabled={!historyState.canRedo}
              onClick={() => void handleRedo()}
            >
              Redo
            </button>
            <span className="od-fill" />
            <span className="pill-mono">
              {formFieldKeys(schema).length} fields
            </span>
            {dirty ? (
              <span
                className="pill-mono"
                data-testid="designer-dirty"
                style={{ color: 'var(--amber)' }}
              >
                unsaved changes
              </span>
            ) : null}
            {savedVersion !== null ? (
              <span
                className="helper"
                data-testid="designer-saved"
                style={{ color: 'var(--green)' }}
              >
                Saved — version {savedVersion}.
              </span>
            ) : null}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              data-testid="designer-save-button"
              disabled={saving}
              onClick={() => void saveForm()}
            >
              {saving ? 'Saving…' : 'Save form'}
            </button>
          </div>

          {saveError !== null ? (
            <InlineError
              operation="save the form schema"
              error={saveError}
              onRetry={() => void saveForm()}
            />
          ) : null}

          <div className="grid-main">
            <section className="card">
              <div className="card-head">
                <h2>Builder</h2>
                <span className="pill-mono">{appId}</span>
              </div>
              <div className="card-body">
                <FormioBuilderField
                  ref={builderFieldRef}
                  schema={schema}
                  onChange={handleSchemaChange}
                  onHistoryChange={handleHistoryChange}
                />
              </div>
            </section>

            <div className="od-stack" style={{ '--od-gap': '18px' } as never}>
              <PreviewPane
                ref={previewPaneRef}
                schema={schema}
                sandbox={sandbox}
              />
              <MappingSurface
                appId={appId}
                client={client}
                schema={schema}
                routingConfig={routingConfig}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
