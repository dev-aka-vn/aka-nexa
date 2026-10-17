/**
 * Wizard step 1 — Basics (BLD-01).
 *
 * The mockup's step-1 form (prototypes/mockup.html:1603-1628):
 * App name, App ID (with the lowercase-hyphenated rule stated
 * in the helper and validated inline on blur), Description, and
 * the data-mode pills — all three modes **available** here, but
 * the choice is deferred to step 5 (Routing), exactly as the
 * mockup's helper states ("Chosen in step 5 — all three are
 * available.").
 *
 * The `app_id` rule is the contract's own
 * `AppIdSchema` (@akane/contract) — the rule is
 * never re-declared here; the Zod issue's
 * message (which names the rule) renders inline
 * verbatim (BLD-07).
 *
 * Step 1's primary action is **Create app**: it
 * POSTs /apps and receives the draft the wizard
 * then edits through steps 2-5. The
 * immutable-after-first-publish rule is a
 * helper-text statement here; the enforcement
 * is the lifecycle machine's (the API refuses
 * every app_id change — it is not a patchable
 * field).
 */

import { useState } from 'react';
import type { ReactElement } from 'react';

import { AppIdSchema } from '@akane/contract';

export interface BasicsValue {
  name: string;
  appId: string;
  description: string;
}

export interface BasicsStepProps {
  value: BasicsValue;
  onChange: (value: BasicsValue) => void;
  /** The draft exists (created on this step) — the identity fields are then fixed. */
  created?: boolean;
}

/**
 * Validate an app_id against the contract's
 * lowercase-hyphenated rule. Returns the Zod
 * issue's message (the rule, named) or null.
 */
export function appIdError(appId: string): string | null {
  if (appId.length === 0) {
    return 'app_id is required';
  }
  const parsed = AppIdSchema.safeParse(appId);
  if (parsed.success) {
    return null;
  }
  return parsed.error.issues[0]?.message ?? 'invalid app_id';
}

/** The three data modes, with the mockup's labels. */
export const DATA_MODES = [
  'internal',
  'external',
  'hybrid',
] as const;

/** Whether the step's required fields pass inline validation. */
export function basicsValid(value: BasicsValue): boolean {
  return (
    value.name.trim().length > 0 &&
    value.description.trim().length > 0 &&
    appIdError(value.appId) === null
  );
}

export function BasicsStep({
  value,
  onChange,
  created = false,
}: BasicsStepProps): ReactElement {
  // The inline app_id error appears on blur
  // (inline validation, BLD-01 precision) and
  // re-validates on every subsequent change.
  const [appIdTouched, setAppIdTouched] = useState(false);
  const [appIdIssue, setAppIdIssue] = useState<
    string | null
  >(null);

  const set = (patch: Partial<BasicsValue>): void => {
    onChange({ ...value, ...patch });
  };

  const handleAppIdBlur = (): void => {
    setAppIdTouched(true);
    setAppIdIssue(appIdError(value.appId));
  };

  const handleAppIdChange = (next: string): void => {
    set({ appId: next });
    // Once touched, the error tracks the input.
    if (appIdTouched) {
      setAppIdIssue(appIdError(next));
    }
  };

  const valid = basicsValid(value);

  return (
    <div data-testid="wizard-step-basics">
      <div className="field">
        <label htmlFor="wizard-app-name">
          App name<span className="req">*</span>
        </label>
        <input
          id="wizard-app-name"
          data-testid="wizard-app-name"
          className="input"
          placeholder="e.g. Leave Request"
          value={value.name}
          onChange={(event) => set({ name: event.target.value })}
          disabled={created}
        />
      </div>
      <div className="field">
        <label htmlFor="wizard-app-id">
          App ID<span className="req">*</span>
        </label>
        <input
          id="wizard-app-id"
          data-testid="wizard-app-id"
          className={`input${appIdIssue ? ' invalid' : ''}`}
          placeholder="e.g. hr-leave-request"
          value={value.appId}
          onChange={(event) => handleAppIdChange(event.target.value)}
          onBlur={handleAppIdBlur}
          disabled={created}
        />
        <span
          className="helper"
          data-testid="wizard-app-id-helper"
        >
          Lowercase, hyphenated. Immutable after first publish.
        </span>
        {appIdIssue ? (
          <span
            className="error-text"
            data-testid="wizard-app-id-error"
            role="alert"
          >
            {appIdIssue}
          </span>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="wizard-app-description">
          Description<span className="req">*</span>
        </label>
        <textarea
          id="wizard-app-description"
          data-testid="wizard-app-description"
          className="textarea"
          placeholder="What business function does this app perform?"
          value={value.description}
          onChange={(event) =>
            set({ description: event.target.value })
          }
          disabled={created}
        />
      </div>
      <div className="field">
        <span className="label">Data mode</span>
        <div className="od-cluster" style={{ '--od-gap': '8px' } as never}>
          {DATA_MODES.map((mode) => (
            <span key={mode} className="pill-mono">
              {mode}
            </span>
          ))}
        </div>
        <span className="helper">
          Chosen in step 5 — all three are available.
        </span>
      </div>
      {/* The step's validity, exposed to the wizard's
          footer gating (and readable by the specs). */}
      <span
        data-testid="wizard-basics-valid"
        data-valid={valid ? 'true' : 'false'}
        hidden
      />
    </div>
  );
}
