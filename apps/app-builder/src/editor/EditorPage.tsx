/**
 * The tabbed app editor (BLD-02, BLD-07, BLD-09).
 *
 * The app-detail surface: the twelve contract sections
 * as tabs, each tab a section PATCH against
 * `PATCH /apps/:id` with `{section, patch}` — one
 * section, one patch, one audited version bump.
 *
 *  - **General / Metadata** edit as named controls
 *    (the wizard's step-1 basics, plus tags and data
 *    mode).
 *  - **Every other section** edits as its JSON
 *    payload — the section's document field, parsed
 *    and validated before the PATCH fires. An
 *    invalid payload is refused inline, naming the
 *    section (BLD-07); no API call fires.
 *
 * The page skeletons while the definition loads
 * (BLD-09) and renders a specific inline error with
 * a retry on failure (BLD-07).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactElement } from 'react';

import {
  AppDefinitionSchema,
  type AppDefinition,
  type AppDataMode,
  type PublishChangeRow,
  PublishResultSchema,
} from '../api/definition.js';
import {
  ConnectorRequestListSchema,
  type ConnectorRequestView,
} from '../api/connectors.js';
import { useApiClient } from '../apiHooks.js';
import { InlineError } from '../error/InlineError.js';
import { Skeleton } from '../ui/Skeleton.js';
import {
  SECTION_FIELDS,
  sectionLabel,
  sectionPatch,
  sectionValue,
} from '../sections.js';
import { AppTabs } from './AppTabs.js';
import { FormManager } from '../form-designer/FormManager.js';
import {
  jsonDraftIsDirty,
  shortcutMayPublish,
} from './publishGuards.js';
import { isPublishShortcut } from './publishShortcut.js';

export interface EditorPageProps {
  appId: string;
}

/** The JSON-edited sections: every section but the two named-control ones. */
function isJsonSection(section: string): boolean {
  return section !== 'general' && section !== 'metadata';
}

/** Format a section's value for the JSON editor. */
function formatJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

/**
 * The platform's chord for the publish
 * shortcut (BLD-06) — the hint the
 * editor shows beside the button.
 */
function saveShortcutHint(): string {
  return /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? '⌘S'
    : 'Ctrl+S';
}

/**
 * The editor page for one app.
 */
export function EditorPage({ appId }: EditorPageProps): ReactElement {
  const client = useApiClient();

  const [definition, setDefinition] = useState<AppDefinition | null>(
    null,
  );
  const [loadError, setLoadError] = useState<unknown>(null);

  const [activeSection, setActiveSection] = useState<string>('general');

  // The named-control editors' state.
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [dataMode, setDataMode] = useState<AppDataMode>('internal');
  // The JSON editor's state.
  const [jsonText, setJsonText] = useState('');

  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [published, setPublished] = useState(false);
  /**
   * The BLD-06 publish confirmation — the
   * rows the admin sees are the rows the
   * AUD-01 entry retains.
   */
  const [confirmation, setConfirmation] = useState<{
    readonly rows: PublishChangeRow[];
    readonly zeroChange: boolean;
  } | null>(null);
  /**
   * The BLD-06 publish gate — the explicit
   * confirmation both entry points (the
   * button and the Ctrl/Cmd+S chord) route
   * through. `publish()` is reachable only
   * from the gate's confirm control, so a
   * single click or chord can never fire the
   * POST as a side effect (G-06-4). The gate
   * carries no change rows: the change
   * summary is the publish *response*
   * payload and no dry-run endpoint exists,
   * so the gate states the effect rather
   * than inventing a diff.
   */
  const [confirmOpen, setConfirmOpen] = useState(false);
  /**
   * The BLD-06 blocked-chord notice — the
   * inline refusal the shortcut renders
   * when the active section's JSON editor
   * holds an unsaved edit (G-06-4's second
   * clause). It names the section and tells
   * the admin to save before publishing.
   */
  const [blockedNotice, setBlockedNotice] = useState<string | null>(
    null,
  );

  // The data-routing tab's provisioned-connector
  // read (the app's connector-request queue).
  const [connectorRequests, setConnectorRequests] = useState<
    readonly ConnectorRequestView[] | null
  >(null);

  const load = useCallback(async (): Promise<void> => {
    setLoadError(null);
    setDefinition(null);
    try {
      const response = await client.get(
        `/apps/${appId}`,
        AppDefinitionSchema,
      );
      setDefinition(response);
      setName(response.name);
      setDescription(response.description);
      setTagsText(response.tags.join(', '));
      setDataMode(response.data_mode);
      setJsonText(
        formatJson(
          isJsonSection(activeSection)
            ? sectionValue(activeSection as never, response)
            : null,
        ),
      );
    } catch (error) {
      setLoadError(error);
    }
  }, [client, appId, activeSection]);

  useEffect(() => {
    void load();
  }, [load]);

  // Switch tabs: re-read the JSON editor's contents
  // from the (possibly just-saved) definition.
  const selectSection = useCallback(
    (section: string): void => {
      setActiveSection(section);
      setSaveError(null);
      setSaved(false);
      setPublished(false);
      setConfirmation(null);
      setConfirmOpen(false);
      setBlockedNotice(null);
      if (isJsonSection(section) && definition !== null) {
        setJsonText(
          formatJson(sectionValue(section as never, definition)),
        );
      }
    },
    [definition],
  );

  // The data-routing tab: read the app's
  // connector-request queue so the tab can
  // offer the app's provisioned connectors
  // for selection — the request's definition
  // becomes the app's routing target.
  useEffect(() => {
    if (activeSection !== 'data-routing') {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await client.get(
          `/apps/${encodeURIComponent(appId)}/connector-requests`,
          ConnectorRequestListSchema,
        );
        if (!cancelled) {
          setConnectorRequests(response.requests);
        }
      } catch {
        if (!cancelled) {
          setConnectorRequests([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSection, appId, client]);

  /** The app's provisioned connectors — the routing targets the tab offers. */
  const provisionedConnectors = useMemo(
    () =>
      (connectorRequests ?? []).filter(
        (request) => request.state === 'provisioned',
      ),
    [connectorRequests],
  );

  /**
   * Offer a provisioned connector into the
   * routing configuration — the selection
   * merges `connector_id` into the section's
   * JSON payload (the tab edits
   * `routing_config`).
   */
  const selectRoutingConnector = useCallback(
    (connectorId: string): void => {
      if (connectorId.length === 0) {
        return;
      }
      let payload: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(jsonText);
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          !Array.isArray(parsed)
        ) {
          payload = parsed as Record<string, unknown>;
        }
      } catch {
        payload = {};
      }
      setJsonText(
        JSON.stringify(
          { ...payload, connector_id: connectorId },
          null,
          2,
        ),
      );
    },
    [jsonText],
  );

  /**
   * The active section's persisted JSON —
   * the `formatJson` of the section's value
   * read off the loaded definition. Only
   * JSON sections have one: the
   * named-control tabs (general, metadata)
   * have no JSON editor to be mid-edit in,
   * so they read as empty and never as
   * dirty.
   */
  const persistedJson = useMemo((): string => {
    if (!isJsonSection(activeSection) || definition === null) {
      return '';
    }
    return formatJson(
      sectionValue(activeSection as never, definition),
    );
  }, [activeSection, definition]);

  /**
   * Whether the active section's JSON
   * editor holds an unsaved edit (BLD-06,
   * G-06-4). True only on a JSON section
   * whose draft text differs from the
   * persisted value.
   */
  const dirty =
    isJsonSection(activeSection) &&
    jsonDraftIsDirty(jsonText, persistedJson);

  /**
   * Save the active section (BLD-02). The patch is
   * built from the tab's controls; an invalid JSON
   * payload is refused inline, naming the section —
   * never a generic message (BLD-07).
   */
  const save = useCallback(async (): Promise<void> => {
    setSaveError(null);
    setSaved(false);
    setPublished(false);
    setConfirmation(null);
    setConfirmOpen(false);
    setBlockedNotice(null);

    let patch: Record<string, unknown>;
    if (activeSection === 'general') {
      if (name.trim().length === 0) {
        setSaveError('The General section needs a non-empty name.');
        return;
      }
      patch = { name: name.trim(), description: description.trim() };
    } else if (activeSection === 'metadata') {
      patch = {
        tags: tagsText
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0),
        data_mode: dataMode,
      };
    } else {
      let payload: unknown;
      try {
        payload = JSON.parse(jsonText);
      } catch {
        setSaveError(
          `The ${activeSection} section needs a valid JSON object.`,
        );
        return;
      }
      patch = sectionPatch(activeSection as never, payload);
    }

    setSaving(true);
    try {
      const response = await client.patch(
        `/apps/${appId}`,
        { section: activeSection, patch },
        AppDefinitionSchema,
      );
      setDefinition(response);
      setName(response.name);
      setDescription(response.description);
      setTagsText(response.tags.join(', '));
      setDataMode(response.data_mode);
      setSaved(true);
    } catch (error) {
      // BLD-07: the API's named refusal, verbatim.
      setSaveError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSaving(false);
    }
  }, [
    activeSection,
    client,
    appId,
    name,
    description,
    tagsText,
    dataMode,
    jsonText,
  ]);

  /**
   * Publish the app (APP-07, BLD-06). The
   * publish gate runs server-side before
   * any state change; a refusal
   * (PUBLISH_REFUSED) is surfaced inline,
   * verbatim, like a section-save refusal
   * (BLD-07). The response is the same
   * definition projection a section save
   * returns, plus the change summary the
   * AUD-01 entry retains.
   */
  const publish = useCallback(async (): Promise<void> => {
    // Close the gate first: the confirm
    // control is the gate's only path to
    // this callback, and closing upfront
    // means a second click cannot reach the
    // endpoint twice.
    setConfirmOpen(false);
    setSaveError(null);
    setSaved(false);
    setPublished(false);
    setConfirmation(null);

    setSaving(true);
    try {
      const response = await client.post(
        `/apps/${appId}/publish`,
        undefined,
        PublishResultSchema,
      );
      setDefinition(response);
      setName(response.name);
      setDescription(response.description);
      setTagsText(response.tags.join(', '));
      setDataMode(response.data_mode);
      setPublished(true);
      setConfirmation({
        rows: response.changeSummary,
        zeroChange: response.zero_change,
      });
    } catch (error) {
      // BLD-07: the API's named refusal, verbatim.
      setSaveError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSaving(false);
    }
  }, [client, appId]);

  /**
   * Open the BLD-06 publish gate — the
   * single entry point to the state change.
   * Both the publish button and the
   * keyboard shortcut call this; only the
   * gate's confirm control calls
   * `publish()`.
   */
  const requestPublish = useCallback((): void => {
    setBlockedNotice(null);
    setConfirmOpen(true);
  }, []);

  // BLD-06 — the keyboard shortcut for
  // publish. The shortcut opens the same
  // confirmation gate the publish surface
  // opens — one gate, so the two cannot
  // diverge (06-05's contract, G-06-4).
  // The chord carries one extra guard the
  // button does not: over a mid-edit JSON
  // section it is blocked inline, naming
  // the section, instead of opening the
  // gate — a click is an explicit act the
  // gate already confirms, but the chord
  // would otherwise publish the section's
  // persisted state from under the admin's
  // typing. The browser default is always
  // prevented so the chord never reaches
  // the browser's own save dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isPublishShortcut(event)) {
        return;
      }
      event.preventDefault();
      if (!shortcutMayPublish({ dirty, saving })) {
        setBlockedNotice(
          `The ${sectionLabel(activeSection)} section has unsaved changes — save the section before publishing.`,
        );
        return;
      }
      requestPublish();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [requestPublish, dirty, saving, activeSection]);

  /* ======================= The loading states ======================= */

  if (loadError !== null) {
    return (
      <div data-testid="editor-page">
        <InlineError
          operation="load the app"
          error={loadError}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  if (definition === null) {
    return (
      <div data-testid="editor-page">
        <Skeleton variant="block" label="Loading the app" />
      </div>
    );
  }

  /* ======================= The page ======================= */

  const jsonFields = isJsonSection(activeSection)
    ? SECTION_FIELDS[activeSection as never]
    : [];

  return (
    <div data-testid="editor-page">
      <div className="page-head">
        <div className="titles">
          <div
            className="od-row"
            style={{ '--od-gap': '10px', marginBottom: 8 } as never}
          >
            <a className="btn btn-sm" href="#/apps">
              ← Apps
            </a>
            <span className="pill-mono">{appId}</span>
            <span className="pill-mono">v{definition.version}</span>
            {/*
              BLD-06 — the publish surface.
              The button and the Ctrl/Cmd+S
              shortcut open the same
              confirmation gate — one gate,
              so the two cannot diverge
              (06-05's contract). The
              auto margin right-aligns the
              pair: `.spacer` only flexes
              under `.card-head`.
            */}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              data-testid="editor-publish"
              onClick={() => requestPublish()}
              disabled={saving}
              style={{ marginLeft: 'auto' }}
            >
              Publish
            </button>
            <span className="helper" title="Keyboard shortcut">
              {saveShortcutHint()}
            </span>
          </div>
          <h1>{definition.name}</h1>
          <p className="sub">{definition.description}</p>
        </div>
      </div>

      {definition.lifecycle === 'purged' ? (
        <div
          className="callout callout-warn"
          role="alert"
          data-testid="purge-grace-callout"
          style={{ marginBottom: 16 }}
        >
          {definition.executed_at == null ? (
            <>
              <b>Purged — grace period.</b>{' '}
              Scheduled hard-delete after{' '}
              <span className="cell-mono">{definition.execute_after}</span>{' '}
              by <span className="cell-mono">{definition.operator_id}</span>.
            </>
          ) : (
            <b>Purged app data has been hard-deleted per policy.</b>
          )}
        </div>
      ) : null}

      <AppTabs active={activeSection} onSelect={selectSection} />

      {/*
        BLD-06 — the publish confirmation
        gate (G-06-4). The gate states the
        effect without change rows: the
        change summary is the publish
        response payload and no dry-run
        endpoint exists, so no pre-publish
        diff can be listed here. Cancel
        closes the gate and fires nothing;
        only the confirm control calls
        `publish()`. In-flow layout keeps
        the gate reachable at every
        viewport — no overlay, no
        offscreen controls.
      */}
      {confirmOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="editor-publish-confirm-title"
          data-testid="editor-publish-confirm"
          style={{
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            padding: '14px 16px',
            marginTop: 18,
            maxWidth: 560,
            background: 'var(--canvas)',
          }}
        >
          <h2
            id="editor-publish-confirm-title"
            style={{ margin: '0 0 8px', fontSize: 16 }}
          >
            Publish &ldquo;{definition.name}&rdquo;?
          </h2>
          <p style={{ margin: '0 0 12px', fontSize: 14 }}>
            Publishing makes your changes take effect immediately.
          </p>
          <div
            className="od-row"
            style={{ '--od-gap': '8px' } as never}
          >
            <button
              type="button"
              className="btn btn-sm"
              data-testid="editor-publish-cancel"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              data-testid="editor-publish-confirm-button"
              disabled={saving}
              onClick={() => void publish()}
            >
              Confirm publish
            </button>
          </div>
        </div>
      ) : null}

      <div role="tabpanel" style={{ marginTop: 18 }}>
        {saveError ? (
          <div
            data-testid="editor-error"
            role="alert"
            style={{
              border: '1px solid var(--red)',
              background: 'var(--red-soft)',
              borderRadius: 'var(--radius)',
              padding: '10px 14px',
              color: 'var(--red)',
              fontSize: 14,
              marginBottom: 16,
            }}
          >
            {saveError}
          </div>
        ) : null}

        {blockedNotice ? (
          <div
            data-testid="editor-publish-blocked"
            role="alert"
            style={{
              border: '1px solid var(--amber)',
              background: 'var(--amber-soft)',
              borderRadius: 'var(--radius)',
              padding: '10px 14px',
              color: 'var(--ink)',
              fontSize: 14,
              marginBottom: 16,
            }}
          >
            {blockedNotice}
          </div>
        ) : null}

        {saved ? (
          <div
            data-testid="editor-saved"
            style={{
              border: '1px solid var(--green)',
              background: 'var(--green-soft)',
              borderRadius: 'var(--radius)',
              padding: '10px 14px',
              color: 'var(--green)',
              fontSize: 14,
              marginBottom: 16,
            }}
          >
            {sectionLabel(activeSection)} saved — version{' '}
            {definition.version}.
          </div>
        ) : null}

        {published ? (
          <div
            data-testid="editor-published"
            style={{
              border: '1px solid var(--green)',
              background: 'var(--green-soft)',
              borderRadius: 'var(--radius)',
              padding: '10px 14px',
              color: 'var(--green)',
              fontSize: 14,
              marginBottom: 16,
            }}
          >
            <div style={{ fontWeight: 600 }}>
              {definition.name} published — version{' '}
              {definition.version}
              {confirmation?.zeroChange
                ? ' — no changes since the last publish'
                : ''}
              .
            </div>
            {confirmation !== null && !confirmation.zeroChange ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  marginTop: 8,
                }}
              >
                {confirmation.rows.map((row) => (
                  <div
                    key={row.field}
                    className="od-row"
                    data-testid="publish-change-row"
                    style={
                      {
                        '--od-gap': '10px',
                        fontSize: 13,
                      } as never
                    }
                  >
                    <span>{row.field}</span>
                    <span className="spacer" />
                    <span className="pill-mono">{row.from}</span>
                    <span style={{ color: 'var(--muted)' }}>→</span>
                    <span className="pill-mono">{row.to}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {activeSection === 'forms' ? (
          <FormManager
            appId={appId}
            definition={definition}
            onDefinitionChange={setDefinition}
          />
        ) : (
        <section className="card">
          <div className="card-head">
            <h2>{sectionLabel(activeSection)}</h2>
            <span className="spacer" />
            <span className="pill-mono">{activeSection}</span>
          </div>
          <div className="card-body">
            {activeSection === 'general' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>
                <label className="field">
                  <span className="lr-s" style={{ fontWeight: 600 }}>
                    Name
                  </span>
                  <input
                    type="text"
                    className="input"
                    data-testid="section-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="lr-s" style={{ fontWeight: 600 }}>
                    Description
                  </span>
                  <textarea
                    className="textarea"
                    data-testid="section-description"
                    rows={3}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
              </div>
            ) : activeSection === 'metadata' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>
                <label className="field">
                  <span className="lr-s" style={{ fontWeight: 600 }}>
                    Tags (comma-separated)
                  </span>
                  <input
                    type="text"
                    className="input"
                    data-testid="section-tags"
                    value={tagsText}
                    placeholder="hr, leave, internal"
                    onChange={(event) => setTagsText(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="lr-s" style={{ fontWeight: 600 }}>
                    Data mode
                  </span>
                  <select
                    className="select"
                    data-testid="section-data-mode"
                    value={dataMode}
                    onChange={(event) =>
                      setDataMode(event.target.value as AppDataMode)
                    }
                  >
                    <option value="internal">internal</option>
                    <option value="external">external</option>
                    <option value="hybrid">hybrid</option>
                  </select>
                </label>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {activeSection === 'data-routing' ? (
                  <label className="field" style={{ maxWidth: 420 }}>
                    <span className="lr-s" style={{ fontWeight: 600 }}>
                      Provisioned connector
                    </span>
                    <select
                      className="select"
                      data-testid="routing-connector-select"
                      defaultValue=""
                      onChange={(event) =>
                        selectRoutingConnector(event.target.value)
                      }
                    >
                      <option value="">
                        Select a provisioned connector…
                      </option>
                      {provisionedConnectors.map((request) => (
                        <option
                          key={request.request_id}
                          value={request.connector_id}
                        >
                          {request.name} ({request.connector_id})
                        </option>
                      ))}
                    </select>
                    <span className="helper">
                      The app's provisioned connectors — selecting one
                      offers it into the routing configuration.
                    </span>
                  </label>
                ) : null}
                {activeSection === 'forms' ? (
                  <div
                    className="od-row"
                    style={{ '--od-gap': '10px', alignItems: 'center' } as never}
                  >
                    {/*
                      The designer entry point from the editor (BLD-04):
                      the form is authored in the FormIO designer — the
                      same route the wizard's Form step links to. Raw
                      JSON editing stays for the cases the designer does
                      not cover, but it is no longer the only way in.
                    */}
                    <a
                      className="btn btn-sm"
                      data-testid="editor-open-designer"
                      href={`#/apps/${appId}/designer`}
                    >
                      Open the form designer
                    </a>
                    <span className="helper">
                      Drag-and-drop components, author conditionals and
                      validation, and preview the draft — the JSON below
                      stays the source of truth either way.
                    </span>
                  </div>
                ) : null}
                <span className="helper">
                  The section's JSON payload (the{' '}
                  {jsonFields.join(', ')} field
                  {jsonFields.length === 1 ? '' : 's'} of the app
                  definition).
                </span>
                <textarea
                  className="textarea"
                  data-testid="section-json"
                  rows={14}
                  style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}
                  value={jsonText}
                  onChange={(event) => setJsonText(event.target.value)}
                />
              </div>
            )}

            <div
              className="od-row"
              style={
                {
                  '--od-gap': '8px',
                  marginTop: 16,
                  alignItems: 'center',
                } as never
              }
            >
              <button
                type="button"
                className="btn btn-primary btn-sm"
                data-testid="save-section"
                disabled={saving}
                onClick={() => void save()}
              >
                Save section
              </button>
              <span className="helper">
                Saving patches the {activeSection} section and bumps the
                app's version.
              </span>
            </div>
          </div>
        </section>
        )}
      </div>
    </div>
  );
}
