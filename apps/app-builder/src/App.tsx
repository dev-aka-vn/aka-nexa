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
 *  - **Routes**: `#/dashboard` (the two
 *    live widgets), `#/apps` (the caller's
 *    app list), `#/wizard` (the five-step
 *    create wizard), `#/apps/:id` (the
 *    tabbed editor, plan 07 task 3),
 *    `#/apps/:id/designer` (the form
 *    designer, plan 07 task 2),
 *    `#/apps/:id/roles` (the roles page,
 *    plan 07 task 3), `#/submissions?app=x`
 *    (the submissions viewer, plan 06 task
 *    2), `#/connectors?app=x` (the
 *    connector-request queue, plan 06 task
 *    2), `#/users` (SSO identity mapping
 *    and the transfer approval queue, plan
 *    06 task 3), `#/audit` (the audit
 *    browse, plan 06 task 3), `#/settings`
 *    (the deferred platform knobs, plan
 *    06 task 3).
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
  useRef,
  useState,
} from 'react';
import type { ReactElement, Ref } from 'react';

import {
  SessionAuthError,
} from './api/client.js';
import {
  fetchSessionUser,
} from './auth/session.client.js';
import type { SessionMeResponse } from '@akane/contract';
import { useApiClient } from './apiHooks.js';
import { InlineError } from './error/InlineError.js';
import { Skeleton } from './ui/Skeleton.js';
import { WizardPage } from './wizard/WizardPage.js';
import { WIZARD_STEP_COUNT } from './wizard/wizardDraftStore.js';
import { DashboardPage } from './dashboard/DashboardPage.js';
import { FormDesignerPage } from './form-designer/FormDesignerPage.js';
import { RolesPage } from './roles/RolesPage.js';
import { EditorPage } from './editor/EditorPage.js';
import { SubmissionsPage } from './submissions/SubmissionsPage.js';
import { ConnectorsPage } from './connectors/ConnectorsPage.js';
import { UsersPage } from './users/UsersPage.js';
import { AuditPage } from './audit/AuditPage.js';
import { AccessReviewPage } from './access-review/AccessReviewPage.js';
import { SettingsPage } from './settings/SettingsPage.js';
import { AppsPage } from './apps/AppsPage.js';
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
  | 'dashboard'
  | 'apps'
  | 'wizard'
  | 'editor'
  | 'designer'
  | 'roles'
  | 'submissions'
  | 'connectors'
  | 'users'
  | 'audit'
  | 'access-review'
  | 'settings'
  | 'unknown';

interface ParsedRoute {
  name: RouteName;
  appId?: string;
  /**
   * The wizard's resumable step (`#/wizard?app=<id>&step=<n>`,
   * G-06-7). Present only when the query carries a
   * finite integer inside the wizard's range — a
   * hand-edited out-of-range index never reaches
   * the page as an unusable step.
   */
  step?: number;
}

/**
 * Parse the hash route. The route may carry a
 * query string (`#/submissions?app=x` — the
 * scoped pages' app parameter); the query is
 * split off before the path segments are read.
 * Unknown routes fall back to the app list.
 */
function parseRoute(route: string): ParsedRoute {
  const [path = '', query = ''] = route.split('?');
  const params = new URLSearchParams(query);
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) {
    return { name: 'apps' };
  }
  const [head, param, sub] = segments;
  if (head === 'dashboard') {
    return { name: 'dashboard' };
  }
  if (head === 'wizard') {
    // G-06-7's resume position: the wizard route
    // carries the draft's app id and the step the
    // user left, read exactly the way the
    // submissions and connectors branches read
    // `app`. `#/wizard` with no query still
    // produces a fresh wizard.
    const rawStep = params.get('step');
    const parsedStep =
      rawStep === null ? NaN : Number.parseInt(rawStep, 10);
    return {
      name: 'wizard',
      appId: params.get('app') ?? undefined,
      step:
        Number.isInteger(parsedStep) &&
        parsedStep >= 0 &&
        parsedStep < WIZARD_STEP_COUNT
          ? parsedStep
          : undefined,
    };
  }
  if (head === 'submissions') {
    return {
      name: 'submissions',
      appId: params.get('app') ?? undefined,
    };
  }
  if (head === 'connectors') {
    return {
      name: 'connectors',
      appId: params.get('app') ?? undefined,
    };
  }
  if (head === 'users') {
    return { name: 'users' };
  }
  if (head === 'audit') {
    return { name: 'audit' };
  }
  if (head === 'access-review') {
    return { name: 'access-review' };
  }
  if (head === 'settings') {
    return { name: 'settings' };
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
              // The nav outgrows the tablet
              // viewport (BLD-09's 768px
              // surface): the row wraps —
              // the header grows downward —
              // instead of widening the
              // document past the layout
              // viewport, which pushes the
              // page's wide tables outside
              // the emulated viewport.
              flexWrap: 'wrap',
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
                href="#/dashboard"
                data-testid="nav-dashboard"
              >
                Dashboard
              </a>
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
              <a
                className="btn btn-ghost btn-sm"
                href="#/submissions"
                data-testid="nav-submissions"
              >
                Submissions
              </a>
              <a
                className="btn btn-ghost btn-sm"
                href="#/connectors"
                data-testid="nav-connectors"
              >
                Connectors
              </a>
              <a
                className="btn btn-ghost btn-sm"
                href="#/users"
                data-testid="nav-users"
              >
                Users
              </a>
              <a
                className="btn btn-ghost btn-sm"
                href="#/audit"
                data-testid="nav-audit"
              >
                Audit Log
              </a>
              <a
                className="btn btn-ghost btn-sm"
                href="#/access-review"
                data-testid="nav-access-review"
              >
                Access Review
              </a>
              <a
                className="btn btn-ghost btn-sm"
                href="#/settings"
                data-testid="nav-settings"
              >
                Settings
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
    case 'dashboard':
      return <DashboardPage />;
    case 'wizard':
      // G-06-7: keyed by the resumable draft —
      // an app-id change (the sidebar's Create
      // app link mid-flow, a deep link) remounts
      // into a fresh hydration instead of
      // carrying the previous draft's live
      // edits across. Step syncs inside the
      // mount use replaceState, which fires no
      // hashchange, so the key never churns
      // mid-flow.
      return (
        <WizardPage
          key={route.appId ?? 'fresh'}
          appId={route.appId}
          step={route.step}
        />
      );
    case 'designer':
      return <FormDesignerPage appId={route.appId ?? ''} />;
    case 'roles':
      return <RolesPage appId={route.appId ?? ''} />;
    case 'submissions':
      return <SubmissionsPage appId={route.appId} />;
    case 'connectors':
      return <ConnectorsPage appId={route.appId} />;
    case 'users':
      return <UsersPage />;
    case 'audit':
      return <AuditPage />;
    case 'access-review':
      return <AccessReviewPage />;
    case 'settings':
      return <SettingsPage />;
    case 'editor':
      return <EditorPage appId={route.appId ?? ''} />;
    case 'apps':
    case 'unknown':
    default:
      return <AppsPage />;
  }
}
