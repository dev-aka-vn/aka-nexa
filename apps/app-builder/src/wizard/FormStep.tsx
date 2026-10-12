/**
 * Wizard step 4 — Form (BLD-01, BLD-04).
 *
 * The form is authored in the FormIO designer
 * (the drag-and-drop builder), never in the
 * wizard: this step reports the draft's form
 * status and links to the designer, the
 * mockup's "the editor opens at the drafts
 * tabs" flow. The designer mounts the same
 * guarded FormIO builder the whole phase
 * compiles against (Pattern 1 + 4).
 *
 * Nothing is required on this step — a draft
 * can exist with no form yet; the form is
 * authored before publish, not before the
 * draft exists.
 */

import type { ReactElement } from 'react';

export interface FormStepProps {
  /** The draft's app_id — the designer route's parameter. */
  appId: string;
  /** Whether the draft already carries a form schema. */
  hasFormSchema: boolean;
}

export function FormStep({
  appId,
  hasFormSchema,
}: FormStepProps): ReactElement {
  return (
    <div data-testid="wizard-step-form">
      <section className="card">
        <div className="card-head">
          <h2>Form</h2>
          <span className="spacer" />
          <span className="pill-mono">
            {hasFormSchema ? 'schema present' : 'no form yet'}
          </span>
        </div>
        <div className="card-body">
          {hasFormSchema ? (
            <p className="helper" style={{ fontSize: 14 }}>
              This app already has a form schema. Open the designer
              to edit it — drag-and-drop components, undo/redo the
              last 50 actions, author conditionals and validation,
              and preview the draft in a sandbox.
            </p>
          ) : (
            <p className="helper" style={{ fontSize: 14 }}>
              No form yet. The form is authored in the designer —
              drag-and-drop components, author conditionals and
              validation rules, and preview the draft in a sandbox
              before publishing.
            </p>
          )}
          <div style={{ marginTop: 14 }}>
            <a
              className="btn"
              data-testid="wizard-open-designer"
              href={`#/apps/${appId}/designer`}
            >
              Open the form designer
            </a>
          </div>
        </div>
      </section>
      <span
        data-testid="wizard-form-valid"
        data-valid="true"
        hidden
      />
    </div>
  );
}
