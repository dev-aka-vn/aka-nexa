/**
 * The permission matrix (BLD-03).
 *
 * Every app permission — the twelve contract sections —
 * renders as a checkbox row. The matrix is the custom
 * role's granted subset: a role is its non-empty
 * permission set, and the save that persists an empty
 * set is refused by the caller (RolesPage) inline,
 * naming the requirement.
 *
 * Default roles (ACL-03) render their fixed grants
 * read-only: the platform vocabulary is not editable
 * from the matrix.
 */

import type { ReactElement } from 'react';

import { APP_SECTIONS, sectionLabel } from '../sections.js';

export interface PermissionMatrixProps {
  /** The granted section subset (the checked boxes). */
  permissions: readonly string[];
  /** The checked-state change handler. */
  onChange: (permissions: string[]) => void;
  /** Default roles render read-only (ACL-03). */
  readOnly?: boolean;
}

/**
 * The matrix: one checkbox row per app permission, in
 * contract order.
 */
export function PermissionMatrix({
  permissions,
  onChange,
  readOnly = false,
}: PermissionMatrixProps): ReactElement {
  const granted = new Set(permissions);

  const toggle = (section: string, checked: boolean): void => {
    const next = checked
      ? [...permissions, section]
      : permissions.filter((p) => p !== section);
    // Keep the contract order, not the click order.
    onChange(APP_SECTIONS.filter((s) => next.includes(s)));
  };

  return (
    <div data-testid="permission-matrix">
      <div
        className="lr-s"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: '4px 12px',
          fontFamily: 'var(--mono)',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--muted)',
          padding: '0 2px 6px',
        }}
      >
        <span>Permission</span>
        <span>Granted</span>
      </div>
      {APP_SECTIONS.map((section) => {
        const checked = granted.has(section);
        return (
          <label
            key={section}
            className="od-row"
            style={
              {
                '--od-gap': '10px',
                alignItems: 'center',
                padding: '7px 2px',
                borderBottom: '1px solid var(--line)',
                cursor: readOnly ? 'default' : 'pointer',
                opacity: readOnly && !checked ? 0.55 : 1,
              } as never
            }
          >
            <span className="od-fill" style={{ fontSize: 14 }}>
              {sectionLabel(section)}
              <span
                className="lr-s"
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 11.5,
                  color: 'var(--muted)',
                  marginLeft: 8,
                }}
              >
                {section}
              </span>
            </span>
            <input
              type="checkbox"
              data-testid={`permission-${section}`}
              checked={checked}
              disabled={readOnly}
              onChange={(event) =>
                toggle(section, event.target.checked)
              }
              aria-label={`${sectionLabel(section)} permission`}
            />
          </label>
        );
      })}
    </div>
  );
}
