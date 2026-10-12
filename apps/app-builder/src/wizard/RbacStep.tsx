/**
 * Wizard step 3 — RBAC (BLD-01, ACL-02/ACL-04).
 *
 * Initial role assignments on the new draft. The
 * creator is the app's owner by construction
 * (the definition's `createdBy` — ACL-04's
 * exactly-one-owner is satisfied at creation),
 * so this step captures the *initial* additional
 * assignments: the mockup's role vocabulary
 * (owner / admin / manager / user) plus any
 * custom roles the owner later authors on the
 * Roles page (BLD-03).
 *
 * ACL-02: roles are assignable to a
 * `real_user_id` only — the wizard captures
 * the assignee as the identity the owner
 * knows them by (name or email); the
 * authoritative resolution to a
 * `real_user_id` is the Roles page's
 * autocomplete (plan 07, task 3), and the
 * stored assignment carries what the wizard
 * captured until the owner resolves it there.
 *
 * Zero assignments is a valid step — the
 * owner can assign nobody at creation and do
 * it all on the Roles page.
 */

import type { ReactElement } from 'react';

/** The platform's default app roles (ACL-03). */
export const DEFAULT_ROLES = [
  'admin',
  'manager',
  'user',
] as const;

/** One initial assignment row. */
export interface AssignmentRow {
  /** The assignee as the owner knows them (name or email). */
  user: string;
  role: string;
}

export interface RbacValue {
  assignments: AssignmentRow[];
}

export interface RbacStepProps {
  value: RbacValue;
  onChange: (value: RbacValue) => void;
}

/** Whether every assignment row on the step is complete. */
export function rbacValid(value: RbacValue): boolean {
  return value.assignments.every(
    (row) => row.user.trim().length > 0 && row.role.length > 0,
  );
}

export function RbacStep({
  value,
  onChange,
}: RbacStepProps): ReactElement {
  const setRow = (
    index: number,
    patch: Partial<AssignmentRow>,
  ): void => {
    onChange({
      assignments: value.assignments.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      ),
    });
  };

  const addAssignment = (): void => {
    onChange({
      assignments: [
        ...value.assignments,
        { user: '', role: 'user' },
      ],
    });
  };

  const removeAssignment = (index: number): void => {
    onChange({
      assignments: value.assignments.filter((_, i) => i !== index),
    });
  };

  const valid = rbacValid(value);

  return (
    <div data-testid="wizard-step-rbac">
      <div className="od-stack" style={{ '--od-gap': '12px' } as never}>
        {value.assignments.map((row, index) => (
          <div
            key={index}
            className="od-row-top"
            style={{ '--od-gap': '10px' } as never}
            data-testid={`wizard-assignment-row-${index}`}
          >
            <input
              className="input"
              data-testid={`wizard-assignment-user-${index}`}
              placeholder="Name or email, e.g. manager@example.com"
              value={row.user}
              onChange={(event) =>
                setRow(index, { user: event.target.value })
              }
            />
            <select
              className="select"
              data-testid={`wizard-assignment-role-${index}`}
              aria-label={`Assignment ${index + 1} role`}
              value={row.role}
              onChange={(event) =>
                setRow(index, { role: event.target.value })
              }
            >
              {DEFAULT_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-btn"
              data-testid={`wizard-assignment-remove-${index}`}
              aria-label={`Remove assignment ${index + 1}`}
              onClick={() => removeAssignment(index)}
            >
              ✕
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="btn btn-sm"
            data-testid="wizard-assignment-add"
            onClick={addAssignment}
          >
            + Assign role
          </button>
        </div>
        <span className="helper">
          You are the app's owner. Assignments are scoped to this
          app only — a role here grants nothing in another app.
          The Roles page resolves each assignee to their identity
          and authors custom roles.
        </span>
        <span className="helper">
          v1 constraint: assignment is to a person (a
          real_user_id) only — group- and IM-role-based assignment
          is not supported.
        </span>
      </div>
      <span
        data-testid="wizard-rbac-valid"
        data-valid={valid ? 'true' : 'false'}
        hidden
      />
    </div>
  );
}

/**
 * The stored `role_assignments` section payload:
 * the wizard's captured rows, verbatim, under
 * `assignments` (the Roles page refines them
 * into resolved `real_user_id` records).
 */
export function roleAssignmentsPayload(
  value: RbacValue,
): Record<string, unknown> {
  return {
    role_assignments: {
      assignments: value.assignments
        .filter((row) => row.user.trim().length > 0)
        .map((row) => ({
          user: row.user.trim(),
          role: row.role,
        })),
    },
  };
}
