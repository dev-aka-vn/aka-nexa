/**
 * The app-builder shell (BLD-01, BLD-12, D-101).
 *
 * A hash-based router (no server-side routing
 * dependency in v1) over a session gate:
 *
 *  - **Boot**: `GET /auth/me` through the
 *    cookie-only api client. A 401 fires the
 *    OIDC redirect (`/auth/oidc/begin`) — the
 *    SPA holds no token, the httpOnly
 *    `__Host-` session cookie is the only
 *    credential (D-101).
 *  - **Routes**: `#/apps` (the caller's app
 *    list), `#/wizard` (the five-step create
 *    wizard), `#/apps/:id` (the tabbed editor,
 *    plan 07 task 3), `#/apps/:id/designer`
 *    (the form designer, plan 07 task 2),
 *    `#/apps/:id/roles` (the roles page, plan
 *    07 task 3).
 *  - **`#/spike`**: the S1 spike surface —
 *    the FormIO 5.6.1 builder verification
 *    harness. Dev-only, deliberately
 *    unauthenticated: it mounts a builder
 *    against a representative schema and calls
 *    no API, so it is the one route that
 *    needs no session.
 *
 * Every async surface shows a layout-shaped
 * skeleton while loading (BLD-09) and an
 * inline, specific, actionable error on
 * failure (BLD-07).
 */

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactElement, Ref } from 'react';

import {
  createApiClient,
  SessionAuthError,
  type ApiClient,
} from './api/client.js';
import {
  AppsListSchema,
  type AppDefinition,
} from './api/definition.js';
import {
  fetchSessionUser,
} from './auth/session.client.js';
import {
  redirectToOidcBegin,
} from './auth/oidc-redirect.js';
import type { SessionMeResponse } from '@akane/contract';
import { InlineError } from './error/InlineError.js';
import { Skeleton } from './ui/Skeleton.js';
import { WizardPage } from './wizard/WizardPage.js';
import { FormioBuilderField } from './form-designer/FormioBuilderField';
import type { FormioBuilderHandle } from './form-designer/FormioBuilderField';
import {
  REPRESENTATIVE_SCHEMA,
  REPRESENTATIVE_SUBMISSION,
} from './form-designer/representativeSchema';
import { registerPortedBootstrap5Templates } from './form-designer/bootstrap5Templates';

/** The hash route (minus the leading `#`). */
function useHashRoute(): string {
  const read = (): string => {
    if (typeof window === 'undefined') {
      return '/';
    }
    return window.location.hash.replace(/^#/, '') || '/';
  };
  const [route, setRoute] = useState<string>(read);
  useEffect(() => {
    const onChange = (): void => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/** The parsed route. */
type RouteName =
  | 'apps'
  | 'wizard'
  | 'editor'
  | 'designer'
  | 'roles'
  | 'unknown';

interface ParsedRoute {
  name: RouteName;
  appId?: string;
}

/** Parse the hash route. Unknown routes fall back to the app list. */
function parseRoute(route: string): ParsedRoute {
  const segments = route.split('/').filter(Boolean);
  if (segments.length === 0) {
    return { name: 'apps' };
  }
  const [head, param, sub] = segments;
  if (head === 'wizard') {
    return { name: 'wizard' };
  }
  if (head === 'apps' && segments.length === 1) {
    return { name: 'apps' };
  }
  if (head === 'apps' && param !== undefined) {
    if (sub === 'designer') {
      return { name: 'designer', appId: param };
    }
    if (sub === 'roles') {
      return { name: 'roles', appId: param };
    }
    return { name: 'editor', appId: param };
  }
  return { name: 'unknown' };
}

/** One api client per surface — the 401 hook fires once. */
function useApiClient(): ApiClient {
  return useMemo(
    () => createApiClient({ onUnauthorized: redirectToOidcBegin }),
    [],
  );
}

/** The session boot's three states. */
type BootState =
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown }
  | { kind: 'authed'; user: SessionMeResponse };

/**
 * The session gate (BLD-12): every route but
 * the dev-only spike requires a session. Boots
 * `GET /auth/me`; a 401 has already fired the
 * OIDC redirect by the time the gate catches
 * it (the gate renders nothing further).
 */
function SessionGate({
  children,
}: {
  children: (user: SessionMeResponse) => ReactElement;
}): ReactElement {
  const client = useApiClient();
  const [state, setState] = useState<BootState>({
    kind: 'loading',
  });

  const boot = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' });
    try {
      const user = await fetchSessionUser(client);
      setState({ kind: 'authed', user });
    } catch (error) {
      // A 401 fired the redirect — the page is
      // navigating to the IdP; render nothing.
      if (error instanceof SessionAuthError) {
        return;
      }
      setState({ kind: 'error', error });
    }
  }, [client]);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (state.kind === 'loading') {
    return (
      <div className="view" data-testid="session-boot">
        <div className="page-head">
          <div className="titles">
            <h1>AkaNexa Builder</h1>
            <p className="sub">Signing you in…</p>
          </div>
        </div>
        <Skeleton label="Loading session" />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="view" data-testid="session-boot">
        <div className="page-head">
          <div className="titles">
            <h1>AkaNexa Builder</h1>
            <p className="sub">Sign-in check failed</p>
          </div>
        </div>
        <InlineError
          operation="check your sign-in session"
          error={state.error}
          onRetry={() => void boot()}
        />
      </div>
    );
  }

  return children(state.user);
}

/** The lifecycle badge tone, the mockup's status vocabulary. */
function lifecycleTone(
  lifecycle: AppDefinition['lifecycle'],
): string {
  switch (lifecycle) {
    case 'published':
      return 'it-teal';
    case 'draft':
      return 'it-amber';
    case 'deprecated':
      return 'it-violet';
    case 'archived':
      return 'it-red';
    default:
      return 'it-amber';
  }
}

/**
 * The app list (`#/apps`): the caller's own
 * definitions (GET /apps), skeleton-shaped
 * while loading, inline-error on failure.
 */
function AppsListPage(): ReactElement {
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

/* ======================= The S1 spike surface (#/spike) ======================= */

/**
 * The subset of the FormIO form instance (the
 * `Formio.createForm` result) the spike's e2e
 * reads.
 */
export interface SpikeFormHandle {
  getComponent(path: string): unknown;
  setSubmission(submission: unknown): Promise<unknown>;
  readonly isReady: boolean;
}

/** The preview pane's imperative surface. */
interface PreviewPaneHandle {
  getForm(): SpikeFormHandle | null;
}

/**
 * The spike-only debug handle the Playwright spec
 * evaluates against. Deliberately window-global and
 * deliberately marked: it is observability for the
 * spike, not a production API.
 */
export interface SpikeDebugHandle {
  /** The mounted builder's current schema (`builder.schema`). */
  getSchema(): Record<string, unknown> | null;
  /** The mounted builder instance (spike-only introspection). */
  getBuilder(): FormioBuilderHandle['builder'];
  /** The builder's snapshot history. */
  getHistory(): {
    latest(): Record<string, unknown> | null;
    canUndo(): boolean;
    canRedo(): boolean;
  } | null;
  /** The preview pane's FormIO form instance, once ready. */
  getPreviewForm(): SpikeFormHandle | null;
}

declare global {
  interface Window {
    __SPIKE__?: SpikeDebugHandle;
  }
}

function installSpikeDebug(handle: SpikeDebugHandle): void {
  window.__SPIKE__ = handle;
}

/** The FormIO form namespace surface the preview pane uses. */
interface FormioNamespace {
  createForm: (
    element: HTMLElement,
    form: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<SpikeFormHandle>;
  Templates: {
    extendTemplate: (name: string, template: Record<string, unknown>) => void;
  };
}

/**
 * The spike's preview pane (FRM-09's render path,
 * pre-designer). Mounts `Formio.createForm` with the
 * representative schema and a one-row submission,
 * behind the same guarded dynamic import as the
 * builder (Pattern 1).
 */
function SpikePreviewPane({
  ref,
}: {
  ref?: Ref<PreviewPaneHandle>;
}): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<SpikeFormHandle | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (typeof document === 'undefined') {
        return;
      }
      const { Formio } = (await import('@formio/js')) as {
        Formio: FormioNamespace;
      };
      registerPortedBootstrap5Templates(Formio);
      if (cancelled || !containerRef.current) {
        return;
      }
      const form = await Formio.createForm(
        containerRef.current,
        REPRESENTATIVE_SCHEMA,
        {},
      );
      if (cancelled) {
        return;
      }
      // One EditGrid row, so `validateRow` has a live row.
      await form.setSubmission(REPRESENTATIVE_SUBMISSION);
      formRef.current = form;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      formRef.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      getForm: () => formRef.current,
    }),
    [],
  );

  return (
    <section
      className="spike-preview"
      data-testid="spike-preview"
      data-ready={ready ? 'true' : 'false'}
    >
      <h2>Preview — 5.x shape verification</h2>
      <div ref={containerRef} data-testid="spike-preview-form" />
    </section>
  );
}

/** The S1 spike shell — the FormIO 5.6.1 verification harness. */
function SpikePage(): ReactElement {
  const builderFieldRef = useRef<FormioBuilderHandle>(null);
  const previewPaneRef = useRef<PreviewPaneHandle>(null);

  const handleUndo = useCallback(async () => {
    await builderFieldRef.current?.undo();
  }, []);

  const handleRedo = useCallback(async () => {
    await builderFieldRef.current?.redo();
  }, []);

  useEffect(() => {
    installSpikeDebug({
      getSchema: () => builderFieldRef.current?.builder?.schema ?? null,
      getBuilder: () => builderFieldRef.current?.builder ?? null,
      getHistory: () => builderFieldRef.current?.history ?? null,
      getPreviewForm: () => previewPaneRef.current?.getForm() ?? null,
    });
  }, []);

  return (
    <div className="spike-shell">
      <header className="spike-header">
        <h1>S1 spike — FormIO 5.6.1 builder in the React 19 shell</h1>
        <p>
          Drag-and-drop form design with 50-action snapshot undo/redo
          (BLD-04), the 5.x component shapes, and the Bootstrap-5
          template port.
        </p>
      </header>
      <div className="spike-toolbar" role="toolbar" aria-label="Form designer">
        <button
          type="button"
          data-testid="undo-button"
          onClick={() => {
            void handleUndo();
          }}
        >
          Undo
        </button>
        <button
          type="button"
          data-testid="redo-button"
          onClick={() => {
            void handleRedo();
          }}
        >
          Redo
        </button>
      </div>
      <main className="spike-main">
        <FormioBuilderField
          ref={builderFieldRef}
          schema={REPRESENTATIVE_SCHEMA}
        />
        <SpikePreviewPane ref={previewPaneRef} />
      </main>
    </div>
  );
}

/* ======================= The shell ======================= */

/**
 * The app-builder shell: the session gate over
 * the hash router. The `#/spike` route is the
 * dev-only S1 verification surface and is
 * deliberately outside the gate.
 */
export function App(): ReactElement {
  const route = useHashRoute();

  if (route === '/spike') {
    return <SpikePage />;
  }

  return (
    <SessionGate>
      {(user) => (
        <div className="od-screen">
          <header
            className="od-row"
            data-testid="app-header"
            style={{
              '--od-gap': '14px',
              padding: '10px 22px',
              borderBottom: '1px solid var(--line)',
              background: 'var(--surface)',
              position: 'sticky',
              top: 0,
              zIndex: 50,
            } as never}
          >
            <a
              href="#/apps"
              style={{
                fontFamily: 'var(--display)',
                fontWeight: 600,
                fontSize: 17,
                textDecoration: 'none',
                color: 'var(--text)',
              }}
            >
              AkaNexa Builder
            </a>
            <nav className="od-row" style={{ '--od-gap': '4px' } as never}>
              <a
                className="btn btn-ghost btn-sm"
                href="#/apps"
                data-testid="nav-apps"
              >
                Apps
              </a>
              <a
                className="btn btn-ghost btn-sm"
                href="#/wizard"
                data-testid="nav-wizard"
              >
                Create
              </a>
            </nav>
            <span className="od-fill" />
            <span
              className="helper"
              data-testid="session-user"
              title="Signed in with MFA"
            >
              {user.real_user_id} · MFA
            </span>
          </header>
          <main className="od-scroll">
            <div className="view" style={{ padding: '20px 22px 60px' }}>
              <RoutedPage route={parseRoute(route)} />
            </div>
          </main>
        </div>
      )}
    </SessionGate>
  );
}

/** The routed page. Unknown routes fall back to the app list. */
function RoutedPage({ route }: { route: ParsedRoute }): ReactElement {
  switch (route.name) {
    case 'wizard':
      return <WizardPage />;
    case 'apps':
    case 'unknown':
    default:
      return <AppsListPage />;
  }
}
