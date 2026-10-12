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
  useState,
} from 'react';
import type { ReactElement } from 'react';

import {
  AppDefinitionSchema,
  type AppDefinition,
  type AppDataMode,
} from '../api/definition.js';
import { useApiClient } from '../apiHooks.js';
import { InlineError } from '../error/InlineError.js';
import { Skeleton } from '../ui/Skeleton.js';
import {
  APP_SECTIONS,
  SECTION_FIELDS,
  sectionLabel,
  sectionPatch,
  sectionValue,
} from '../sections.js';
import { AppTabs } from './AppTabs.js';

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
      if (isJsonSection(section) && definition !== null) {
        setJsonText(
          formatJson(sectionValue(section as never, definition)),
        );
      }
    },
    [definition],
  );

  /**
   * Save the active section (BLD-02). The patch is
   * built from the tab's controls; an invalid JSON
   * payload is refused inline, naming the section —
   * never a generic message (BLD-07).
   */
  const save = useCallback(async (): Promise<void> => {
    setSaveError(null);
    setSaved(false);

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
          </div>
          <h1>{definition.name}</h1>
          <p className="sub">{definition.description}</p>
        </div>
      </div>

      <AppTabs active={activeSection} onSelect={selectSection} />

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
      </div>
    </div>
  );
}
