/**
 * The apps page (`#/apps`): the
 * caller's own definitions (BLD-05)
 * over the platform template gallery
 * (D-105, D-107, APP-09).
 *
 * The **app list** is the department
 * admin's own estate — moved verbatim
 * from the shell so the surface's
 * contract (testids, lifecycle badges,
 * the empty state) does not change.
 *
 * The **template gallery** is the
 * platform's curated starter set: the
 * frozen tag vocabulary filters it, and
 * "Use template" forks one into a
 * user-owned draft (APP-09, D-108) —
 * the fork endpoint deep-copies the
 * definition and drops the origin
 * reference, and the page navigates to
 * the fresh draft's editor.
 */

import {
  useCallback,
  useEffect,
  useState,
} from 'react';
import type { ReactElement } from 'react';

import {
  AppDefinitionSchema,
  AppsListSchema,
  type AppDefinition,
} from '../api/definition.js';
import {
  TemplatesSchema,
  type PlatformTag,
  type TemplateRecord,
} from '../api/templates.js';
import { useApiClient } from '../apiHooks.js';
import { InlineError } from '../error/InlineError.js';
import { Skeleton } from '../ui/Skeleton.js';
import { TagFilter } from './TagFilter.js';

/**
 * The lifecycle badge class — the mockup's
 * statusBadge vocabulary (badge-published /
 * draft / deprecated / archived), not the
 * icon-tile tones.
 */
function lifecycleTone(
  lifecycle: AppDefinition['lifecycle'],
): string {
  switch (lifecycle) {
    case 'published':
      return 'badge-published';
    case 'draft':
      return 'badge-draft';
    case 'deprecated':
      return 'badge-deprecated';
    case 'archived':
      return 'badge-archived';
    case 'purged':
      return 'badge-archived';
    default:
      return 'badge-draft';
  }
}

/**
 * The app list: the caller's own
 * definitions (`GET /apps`),
 * skeleton-shaped while loading,
 * inline-error on failure.
 */
function AppListSection(): ReactElement {
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
    <div data-testid="apps-list">
      <div
        className="od-row"
        style={{
          '--od-gap': '10px',
          marginBottom: 18,
          justifyContent: 'flex-end',
        } as never}
      >
        <a className="btn btn-primary" href="#/wizard">
          + Create a new app
        </a>
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
                Create your first app — the five-step wizard
                needs no documentation and no engineering ticket.
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
          data-testid="apps-grid"
        >
          {apps.map((app) => (
            <a
              key={app.app_id}
              className="card"
              data-testid={`app-card-${app.app_id}`}
              href={`#/apps/${app.app_id}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div className="card-body">
                <div
                  className="od-row"
                  style={{
                    '--od-gap': '12px',
                    alignItems: 'flex-start',
                  } as never}
                >
                  <div className="od-fill">
                    <h3 style={{ fontSize: 16 }}>{app.name}</h3>
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
                  <span
                    className={`badge ${lifecycleTone(app.lifecycle)}`}
                    data-testid={`app-lifecycle-${app.app_id}`}
                  >
                    {app.lifecycle}
                  </span>
                </div>
                <p
                  className="od-clamp-2"
                  style={{
                    color: 'var(--muted)',
                    fontSize: 13.5,
                    marginTop: 12,
                    minHeight: '2.9em',
                  }}
                >
                  {app.description}
                </p>
                <div
                  className="od-cluster"
                  style={{ '--od-gap': '8px', marginTop: 12 } as never}
                >
                  <span className="pill-mono">v{app.version}</span>
                  <span className="pill-mono">{app.data_mode}</span>
                </div>
              </div>
              <div
                className="card-foot od-row"
                style={{ justifyContent: 'space-between' } as never}
              >
                <span className="lr-s">
                  Open the app
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

/**
 * The template gallery (`GET /templates`):
 * the frozen tag vocabulary's filter over
 * the platform's curated templates, each
 * forkable into a user-owned draft
 * (APP-09, D-108).
 */
function TemplateGallery(): ReactElement {
  const client = useApiClient();
  const [templates, setTemplates] = useState<
    readonly TemplateRecord[] | null
  >(null);
  const [error, setError] = useState<unknown>(null);
  const [activeTag, setActiveTag] =
    useState<PlatformTag | null>(null);
  const [forkingId, setForkingId] =
    useState<string | null>(null);
  const [forkErrors, setForkErrors] =
    useState<Readonly<Record<string, unknown>>>({});

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const response = await client.get(
        '/templates',
        TemplatesSchema,
      );
      setTemplates(response.templates);
    } catch (loadError) {
      setTemplates(null);
      setError(loadError);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered =
    templates === null
      ? null
      : activeTag === null
        ? templates
        : templates.filter((template) =>
            template.tags.includes(activeTag),
          );

  /**
   * The fork (APP-09, D-108): the
   * definition deep-copies into a
   * user-owned draft with no origin
   * reference, and the page navigates to
   * it. A refusal (an `app_id` already
   * in use, say) is inline, on the card
   * that refused.
   */
  const fork = useCallback(
    async (template: TemplateRecord): Promise<void> => {
      setForkErrors((previous) => {
        const next = { ...previous };
        delete next[template.template_id];
        return next;
      });
      setForkingId(template.template_id);
      try {
        const draft = await client.post(
          `/templates/${template.template_id}/fork`,
          { app_id: template.template_id },
          AppDefinitionSchema,
        );
        window.location.hash = `#/apps/${draft.app_id}`;
      } catch (forkError) {
        setForkErrors((previous) => ({
          ...previous,
          [template.template_id]: forkError,
        }));
      } finally {
        setForkingId(null);
      }
    },
    [client],
  );

  return (
    <section
      className="card"
      data-testid="template-gallery"
      style={{ marginTop: 26 }}
    >
      <div className="card-head">
        <div className="od-fill">
          <h2>Template gallery</h2>
          <p
            className="sub"
            style={{ margin: '4px 0 0' }}
          >
            The platform's curated starter
            apps. Fork one — the definition
            is yours from the first edit
            (APP-09).
          </p>
        </div>
        <span className="pill-mono">
          platform-curated
        </span>
      </div>
      <div className="card-body">
        <div style={{ marginBottom: 16 }}>
          <TagFilter
            active={activeTag}
            onSelect={setActiveTag}
          />
        </div>
        {error ? (
          <InlineError
            operation="load the template gallery"
            error={error}
            onRetry={() => void load()}
          />
        ) : templates === null ? (
          <Skeleton
            variant="cards"
            label="Loading templates"
          />
        ) : (
          <>
            <div
              className="od-grid"
              style={{ '--od-cols': '3' } as never}
            >
              {(filtered ?? []).map(
                (template) => (
                  <section
                    key={template.template_id}
                    className="card"
                    data-testid={`template-card-${template.template_id}`}
                  >
                    <div className="card-body">
                      <div
                        className="od-row"
                        style={{
                          '--od-gap': '12px',
                          alignItems: 'flex-start',
                        } as never}
                      >
                        <div className="od-fill">
                          <h3 style={{ fontSize: 16 }}>
                            {template.name}
                          </h3>
                          <div
                            className="lr-s"
                            style={{
                              fontFamily: 'var(--mono)',
                              fontSize: 12,
                            }}
                          >
                            {template.template_id}
                          </div>
                        </div>
                        <span className="pill-mono">
                          {template.data_mode}
                        </span>
                      </div>
                      <p
                        className="od-clamp-2"
                        style={{
                          color: 'var(--muted)',
                          fontSize: 13.5,
                          marginTop: 12,
                          minHeight: '2.9em',
                        }}
                      >
                        {template.description}
                      </p>
                      <div
                        className="od-cluster"
                        style={{
                          '--od-gap': '6px',
                          marginTop: 12,
                        } as never}
                      >
                        {template.tags.map(
                          (tag) => (
                            <span
                              key={tag}
                              className="pill-mono"
                              data-testid={`template-tag-${template.template_id}-${tag}`}
                            >
                              {tag}
                            </span>
                          ),
                        )}
                        {template.connector_ref !==
                        null ? (
                          <span
                            className="pill-mono"
                            data-testid={`template-connector-${template.template_id}`}
                          >
                            ↳ {template.connector_ref}
                          </span>
                        ) : null}
                      </div>
                      {forkErrors[
                        template.template_id
                      ] !== undefined ? (
                        <div style={{ marginTop: 12 }}>
                          <InlineError
                            operation="fork the template"
                            error={
                              forkErrors[
                                template.template_id
                              ]
                            }
                            onRetry={() =>
                              void fork(template)
                            }
                          />
                        </div>
                      ) : null}
                    </div>
                    <div
                      className="card-foot od-row"
                      style={{
                        justifyContent:
                          'space-between',
                      } as never}
                    >
                      <span className="lr-s">
                        Fork into your estate
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        data-testid={`template-use-${template.template_id}`}
                        disabled={
                          forkingId ===
                          template.template_id
                        }
                        onClick={() =>
                          void fork(template)
                        }
                      >
                        {forkingId ===
                        template.template_id
                          ? 'Forking…'
                          : 'Use template'}
                      </button>
                    </div>
                  </section>
                ),
              )}
            </div>
            {(filtered ?? []).length === 0 ? (
              <div className="card">
                <div className="empty">
                  <h3>No templates match</h3>
                  <p>
                    No curated template carries
                    that tag — clear the filter
                    to see the full gallery.
                  </p>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

/** The apps page: the estate over the gallery. */
export function AppsPage(): ReactElement {
  return (
    <div data-testid="apps-page">
      <AppListSection />
      <TemplateGallery />
    </div>
  );
}
