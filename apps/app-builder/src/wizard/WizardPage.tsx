/**
 * The create wizard (BLD-01).
 *
 * A non-developer reaches a working app through
 * exactly five steps — **Basics → Triggers →
 * RBAC → Form → Routing** — with no
 * documentation. The order is locked; the step
 * rail renders it; forward navigation is gated
 * on each step's inline validation.
 *
 * **Step 1 creates the draft**: "Create app"
 * POSTs /apps, receives the draft app_id, and
 * toasts the mockup's exact copy — "Saved as a
 * draft · continue through the wizard steps" —
 * after which the wizard edits the *same*
 * draft through steps 2-5, one audited
 * section PATCH per step (plan 04's endpoints).
 *
 * Every async call rides the session cookie
 * (the api client's `credentials:
 * 'same-origin'`; the SPA holds no token,
 * D-101), shows a layout-shaped skeleton while
 * loading (BLD-09), and renders an inline,
 * specific, actionable error on failure (BLD-07).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { createApiClient } from '../api/client.js';
import {
  AppDefinitionSchema,
  type AppDefinition,
} from '../api/definition.js';
import { Skeleton } from '../ui/Skeleton.js';
import { redirectToOidcBegin } from '../auth/oidc-redirect.js';
import { InlineError } from '../error/InlineError.js';
import {
  basicsValid,
  BasicsStep,
  type BasicsValue,
} from './BasicsStep.js';
import { FormStep } from './FormStep.js';
import {
  routingPatches,
  RoutingStep,
  routingValid,
  type RoutingValue,
} from './RoutingStep.js';
import {
  rbacValid,
  RbacStep,
  roleAssignmentsPayload,
  type RbacValue,
} from './RbacStep.js';
import {
  normalizeTriggers,
  TriggersStep,
  triggersValid,
  type TriggersValue,
} from './TriggersStep.js';
import {
  clearWizardSnapshot,
  readWizardSnapshot,
  WIZARD_STEP_COUNT,
  writeWizardSnapshot,
} from './wizardDraftStore.js';

/** The locked wizard order (the mockup's step rail). */
const STEPS = [
  {
    name: 'basics',
    label: 'Basics',
    sub: 'Step 1 of 5 — name and purpose. You can change everything later.',
  },
  {
    name: 'triggers',
    label: 'Triggers',
    sub: 'Step 2 of 5 — how users launch this app from chat.',
  },
  {
    name: 'rbac',
    label: 'RBAC',
    sub: 'Step 3 of 5 — who can do what. You are the owner.',
  },
  {
    name: 'form',
    label: 'Form',
    sub: 'Step 4 of 5 — design the form. Nothing required yet.',
  },
  {
    name: 'routing',
    label: 'Routing',
    sub: 'Step 5 of 5 — where the data lives and how it moves.',
  },
] as const;

/** The mockup's exact step-1 toast copy (prototypes/mockup.html:1603-1628). */
export const DRAFT_TOAST =
  'Saved as a draft · continue through the wizard steps';

/** A failed async operation, retryable inline (BLD-07). */
interface StepError {
  operation: string;
  error: unknown;
  retry: () => void;
}

/** The wizard's resumable position (G-06-7's designer-return-path closure). */
export interface WizardPageProps {
  /**
   * The draft's app id (`#/wizard?app=<id>`).
   * Absent on a fresh create — the page is
   * then a blank wizard exactly as before.
   */
  appId?: string;
  /**
   * The step the user left (`&step=<n>`). The
   * session snapshot wins when both exist;
   * the route step is the deep-link fallback
   * (Task 2 closes that leg).
   */
  step?: number;
}

export function WizardPage({ appId, step: routeStep }: WizardPageProps): ReactElement {
  // One api client for the wizard's lifetime —
  // the 401 hook fires once (the redirect), so
  // a burst of refusals cannot loop.
  const client = useMemo(
    () => createApiClient({ onUnauthorized: redirectToOidcBegin }),
    [],
  );

  const [step, setStep] = useState(0);
  const [basics, setBasics] = useState<BasicsValue>({
    name: '',
    appId: '',
    description: '',
  });
  const [triggers, setTriggers] = useState<TriggersValue>({
    triggers: [],
  });
  const [rbac, setRbac] = useState<RbacValue>({
    assignments: [],
  });
  const [routing, setRouting] = useState<RoutingValue>({
    mode: 'internal',
    connectorId: '',
  });
  const [draft, setDraft] = useState<AppDefinition | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stepError, setStepError] = useState<StepError | null>(null);
  const [done, setDone] = useState(false);

  /**
   * Resume the step the user left (G-06-7).
   * On mount with a draft app id, the session
   * snapshot seeds the step and the four
   * in-progress values exactly once — the ref
   * guards so a re-render can never
   * re-hydrate over the user's live edits.
   * With no snapshot (a deep link straight
   * to a resumable position), the step comes
   * from the route — clamped into the
   * wizard's range — and the values start
   * blank. With no app id (`#/wizard`) the
   * page is a fresh wizard exactly as before.
   *
   * Either way, the draft itself is re-read
   * from the server through the session
   * cookie (T-06-48): the snapshot carries
   * working state, and the definition (with
   * its version and form schema) is restored
   * so the resumed wizard holds no other
   * session's data and every later PATCH
   * binds to the draft's app id.
   */
  const hydratedRef = useRef(false);
  const [resuming, setResuming] = useState(appId !== undefined);
  const [resumeError, setResumeError] = useState<unknown>(null);

  const loadDraft = useCallback(async (): Promise<void> => {
    if (appId === undefined) {
      return;
    }
    setResuming(true);
    setResumeError(null);
    try {
      const restored = await client.get(
        `/apps/${appId}`,
        AppDefinitionSchema,
      );
      setDraft(restored);
    } catch (error) {
      setResumeError(error);
    } finally {
      setResuming(false);
    }
  }, [appId, client]);

  useEffect(() => {
    if (hydratedRef.current) {
      return;
    }
    hydratedRef.current = true;
    if (appId === undefined) {
      return;
    }
    const snapshot = readWizardSnapshot(appId);
    if (snapshot !== null) {
      setStep(snapshot.step);
      setBasics(snapshot.basics);
      setTriggers(snapshot.triggers);
      setRbac(snapshot.rbac);
      setRouting(snapshot.routing);
    } else if (routeStep !== undefined) {
      setStep(
        Math.min(Math.max(routeStep, 0), WIZARD_STEP_COUNT - 1),
      );
    }
    void loadDraft();
  }, [appId, routeStep, loadDraft]);

  /** The current step's required fields pass inline validation. */
  const stepValid = (index: number): boolean => {
    switch (index) {
      case 0:
        return basicsValid(basics);
      case 1:
        return triggersValid(triggers);
      case 2:
        return rbacValid(rbac);
      case 3:
        return true; // the form is authored in the designer — nothing required here
      case 4:
        return routingValid(routing);
      default:
        return false;
    }
  };

  /**
   * PATCH one section against the draft. The
   * response is the updated definition — the
   * wizard keeps editing the same draft.
   */
  const saveSection = useMemo(
    () =>
      async (
        section: string,
        patch: Record<string, unknown>,
      ): Promise<void> => {
        if (draft === null) {
          return;
        }
        const updated = await client.patch(
          `/apps/${draft.app_id}`,
          { section, patch },
          AppDefinitionSchema,
        );
        setDraft(updated);
      },
    [client, draft],
  );

  /** Step 1: create the draft (POST /apps). */
  const handleCreate = async (): Promise<void> => {
    setBusy(true);
    setStepError(null);
    try {
      const created = await client.post(
        '/apps',
        {
          name: basics.name.trim(),
          app_id: basics.appId.trim(),
          description: basics.description.trim(),
        },
        AppDefinitionSchema,
      );
      setDraft(created);
      // The mockup's exact toast copy, verbatim.
      setToast(DRAFT_TOAST);
      setStep(1);
    } catch (error) {
      setStepError({
        operation: 'create the app',
        error,
        retry: () => void handleCreate(),
      });
    } finally {
      setBusy(false);
    }
  };

  /** Steps 2-4: save the step's section (when it has content), advance. */
  const handleNext = async (): Promise<void> => {
    if (draft === null) {
      return;
    }
    setBusy(true);
    setStepError(null);
    try {
      if (step === 1) {
        // Triggers: PATCH only when the step has content.
        const normalized = normalizeTriggers(triggers);
        if (normalized.length > 0) {
          await saveSection('triggers', { triggers: normalized });
        }
      } else if (step === 2) {
        // RBAC: PATCH only when the step has content.
        if (rbac.assignments.length > 0) {
          await saveSection(
            'role-assignments',
            roleAssignmentsPayload(rbac),
          );
        }
      }
      setStep(step + 1);
    } catch (error) {
      const operation =
        step === 1 ? 'save the triggers section' : 'save the role assignments';
      setStepError({
        operation,
        error,
        retry: () => void handleNext(),
      });
    } finally {
      setBusy(false);
    }
  };

  /** Step 5: finish — PATCH the data mode and the routing config. */
  const handleFinish = async (): Promise<void> => {
    if (draft === null) {
      return;
    }
    setBusy(true);
    setStepError(null);
    try {
      for (const { section, patch } of routingPatches(routing)) {
        await saveSection(section, patch);
      }
      // The flow is complete — the session
      // snapshot is working state, and a
      // finished wizard leaves none behind.
      clearWizardSnapshot(draft.app_id);
      setDone(true);
    } catch (error) {
      setStepError({
        operation: 'save the routing section',
        error,
        retry: () => void handleFinish(),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleBack = (): void => {
    setStepError(null);
    setStep(Math.max(0, step - 1));
  };

  /**
   * Survive the designer round trip (G-06-7).
   * On every change while the draft exists,
   * the position and the in-progress inputs
   * are snapshotted for the session — the
   * designer link unmounts this page, and the
   * snapshot is what the return leg resumes
   * from — and the route is kept in step with
   * the wizard through `history.replaceState`,
   * deliberately NOT an assignment to
   * `location.hash`: an assignment fires a
   * `hashchange` that re-parses the route and
   * remounts the page — the loop this fix
   * must not introduce. Nothing is written
   * once the flow is complete.
   */
  useEffect(() => {
    if (draft === null || done) {
      return;
    }
    writeWizardSnapshot({
      appId: draft.app_id,
      step,
      basics,
      triggers,
      rbac,
      routing,
    });
    if (typeof window !== 'undefined') {
      window.history.replaceState(
        null,
        '',
        `#/wizard?app=${encodeURIComponent(draft.app_id)}&step=${step}`,
      );
    }
  }, [draft, done, step, basics, triggers, rbac, routing]);

  // The wizard's completion panel — the draft
  // exists and every section is saved.
  if (done && draft !== null) {
    return (
      <div className="view" data-testid="wizard-page">
        <div className="page-head">
          <div className="titles">
            <h1>Create a new app</h1>
            <p className="sub">Complete</p>
          </div>
        </div>
        <section className="card" data-testid="wizard-complete">
          <div className="card-head">
            <h2>Draft created</h2>
            <span className="spacer" />
            <span className="pill-mono">v{draft.version}</span>
          </div>
          <div className="card-body">
            <p style={{ fontSize: 14, marginBottom: 12 }}>
              <b>{draft.name}</b> is saved as a draft. Its form,
              roles, and routing are all editable in the editor —
              publish when the app is ready.
            </p>
            <p style={{ fontSize: 14, marginBottom: 16 }}>
              App ID:{' '}
              <span
                className="pill-mono"
                data-testid="wizard-complete-app-id"
              >
                {draft.app_id}
              </span>
            </p>
            <a
              className="btn btn-primary"
              data-testid="wizard-complete-open"
              href={`#/apps/${draft.app_id}`}
            >
              Open the app editor
            </a>
          </div>
        </section>
      </div>
    );
  }

  // The deep-link resume (G-06-7): the draft
  // is still in flight — a layout-shaped
  // skeleton, never a blank wizard (BLD-09).
  if (resuming) {
    return (
      <div className="view" data-testid="wizard-page">
        <div className="page-head">
          <div className="titles">
            <h1>Create a new app</h1>
            <p className="sub">Resuming the draft…</p>
          </div>
        </div>
        <Skeleton label="Loading the wizard draft" />
      </div>
    );
  }

  // The resume refused — an app the session
  // may not open, or one that does not exist:
  // an actionable retryable error (BLD-07),
  // never another user's data.
  if (resumeError !== null) {
    return (
      <div className="view" data-testid="wizard-page">
        <div className="page-head">
          <div className="titles">
            <h1>Create a new app</h1>
            <p className="sub">The draft could not be resumed</p>
          </div>
        </div>
        <InlineError
          operation="load the app draft"
          error={resumeError}
          onRetry={() => void loadDraft()}
        />
      </div>
    );
  }

  const current = STEPS[step];
  const primaryDisabled = busy || !stepValid(step);

  return (
    <div className="view" data-testid="wizard-page">
      <div className="page-head">
        <div className="titles">
          <h1>Create a new app</h1>
          <p className="sub">{current.sub}</p>
        </div>
      </div>

      {/* The step rail — the locked five-step order. */}
      <div className="step-rail" data-testid="wizard-step-rail">
        {STEPS.map((railStep, index) => (
          <span
            key={railStep.name}
            className={`step${
              index < step ? ' done' : index === step ? ' now' : ' todo'
            }`}
            data-testid="wizard-step"
            data-step-name={railStep.name}
          >
            <span className="dot">{index + 1}</span>
            <span
              className="lbl"
              data-testid="wizard-step-label"
            >
              {railStep.label}
            </span>
          </span>
        ))}
      </div>

      {/* The failed operation, inline and retryable (BLD-07). */}
      {stepError ? (
        <div style={{ marginTop: 16 }}>
          <InlineError
            operation={stepError.operation}
            error={stepError.error}
            onRetry={stepError.retry}
          />
        </div>
      ) : null}

      {/* The current step. */}
      <div style={{ marginTop: 18 }}>
        {step === 0 ? (
          <BasicsStep
            value={basics}
            onChange={setBasics}
            created={draft !== null}
          />
        ) : null}
        {step === 1 ? (
          <TriggersStep value={triggers} onChange={setTriggers} />
        ) : null}
        {step === 2 ? (
          <RbacStep value={rbac} onChange={setRbac} />
        ) : null}
        {step === 3 && draft !== null ? (
          <FormStep
            appId={draft.app_id}
            hasFormSchema={draft.form_schema !== null}
          />
        ) : null}
        {step === 4 && draft !== null ? (
          <RoutingStep
            appId={draft.app_id}
            value={routing}
            onChange={setRouting}
            client={client}
          />
        ) : null}
      </div>

      {/* The footer — gated forward navigation. */}
      <div
        className="od-row"
        style={{
          '--od-gap': '10px',
          marginTop: 20,
          justifyContent: 'flex-end',
        } as never}
      >
        {step > 0 ? (
          <button
            type="button"
            className="btn"
            data-testid="wizard-back-button"
            onClick={handleBack}
            disabled={busy}
          >
            Back
          </button>
        ) : null}
        {step === 0 && draft === null ? (
          <button
            type="button"
            className="btn btn-primary"
            data-testid="wizard-create-button"
            onClick={() => void handleCreate()}
            disabled={primaryDisabled}
          >
            Create app
          </button>
        ) : step < 4 ? (
          <button
            type="button"
            className="btn btn-primary"
            data-testid="wizard-next-button"
            onClick={() => void handleNext()}
            disabled={primaryDisabled}
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            data-testid="wizard-finish-button"
            onClick={() => void handleFinish()}
            disabled={primaryDisabled}
          >
            Finish
          </button>
        )}
      </div>

      {/* The toast — the mockup's fixed bottom-right slot. */}
      {toast ? (
        <div className="toast-root">
          <div
            className="toast ok"
            role="status"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <path d="M4 12l5 5L20 7" />
            </svg>
            <div className="tx" data-testid="wizard-toast">
              {toast}
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label="Dismiss"
              onClick={() => setToast(null)}
              style={{ color: 'inherit', width: 24, height: 24 }}
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
