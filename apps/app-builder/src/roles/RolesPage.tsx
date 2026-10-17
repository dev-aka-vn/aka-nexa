/**
 * The roles page (BLD-03, ACL-02, ACL-04, BLD-07, BLD-09).
 *
 * The self-service RBAC surface: the app's role
 * assignments and the per-role permission matrix, owned
 * by the department admin — no engineering ticket.
 *
 *  - **Assignments** (the `role-assignments` section):
 *    every principal's role, editable; a user is
 *    assigned through the autocomplete, which resolves
 *    to `real_user_id` only (ACL-02).
 *  - **The permission matrix** (the `roles-permissions`
 *    section): every app permission as a checkbox; a
 *    custom role is saved with any non-empty subset, and
 *    an empty subset is refused inline naming the
 *    requirement (BLD-03).
 *  - **Single-owner enforcement** (ACL-04): the sole
 *    owner cannot be unassigned and a second owner
 *    cannot be assigned — both refused inline, naming
 *    the current owner.
 *
 * Every async surface skeletons while loading (BLD-09)
 * and renders a specific inline error with a retry on
 * failure (BLD-07).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactElement } from 'react';

import { AppDefinitionSchema, type AppDefinition } from '../api/definition.js';
import { useApiClient } from '../apiHooks.js';
import { InlineError } from '../error/InlineError.js';
import { Skeleton } from '../ui/Skeleton.js';
import type { DirectoryUser } from '../api/users.js';
import { PermissionMatrix } from './PermissionMatrix.js';
import { UserAutocomplete } from './UserAutocomplete.js';

/** The ACL-03 default roles (their grants are platform-fixed). */
const DEFAULT_ROLES = ['owner', 'admin', 'manager', 'user'];

/** The served `role_assignments` shape: real_user_id → role. */
type RoleAssignments = Record<string, string>;

/** The served `roles_permissions` shape: role → granted sections. */
type RolesPermissions = Record<string, string[]>;

/** Read the assignment record off a served definition. */
function readAssignments(
  definition: AppDefinition,
): RoleAssignments {
  const raw = definition.role_assignments;
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const out: RoleAssignments = {};
  for (const [userId, role] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (typeof role === 'string') {
      out[userId] = role;
    }
  }
  return out;
}

/** Read the custom-role permission map off a served definition. */
function readRolesPermissions(
  definition: AppDefinition,
): RolesPermissions {
  const raw = definition.roles_permissions;
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const out: RolesPermissions = {};
  for (const [role, sections] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (Array.isArray(sections)) {
      out[role] = sections.filter(
        (section): section is string => typeof section === 'string',
      );
    }
  }
  return out;
}

export interface RolesPageProps {
  appId: string;
}

/**
 * The roles page for one app.
 */
export function RolesPage({ appId }: RolesPageProps): ReactElement {
  const client = useApiClient();

  const [definition, setDefinition] = useState<AppDefinition | null>(
    null,
  );
  const [loadError, setLoadError] = useState<unknown>(null);

  const [assignments, setAssignments] = useState<RoleAssignments>({});
  const [rolesPermissions, setRolesPermissions] =
    useState<RolesPermissions>({});

  const [selectedRole, setSelectedRole] = useState<string>('owner');
  const [matrixPermissions, setMatrixPermissions] = useState<string[]>(
    [],
  );
  const [newRoleName, setNewRoleName] = useState('');

  /** The inline refusal area (ACL-04, BLD-03). */
  const [refusal, setRefusal] = useState<string | null>(null);
  /** The save confirmation. */
  const [saved, setSaved] = useState(false);
  /** The save-in-flight marker (disables the save buttons). */
  const [saving, setSaving] = useState(false);

  /** The user picked in the assign-autocomplete. */
  const [pendingUser, setPendingUser] =
    useState<DirectoryUser | null>(null);
  const [assignRole, setAssignRole] = useState('manager');

  const load = useCallback(async (): Promise<void> => {
    setLoadError(null);
    setDefinition(null);
    try {
      const response = await client.get(
        `/apps/${appId}`,
        AppDefinitionSchema,
      );
      setDefinition(response);
      setAssignments(readAssignments(response));
      setRolesPermissions(readRolesPermissions(response));
    } catch (error) {
      setLoadError(error);
    }
  }, [client, appId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The custom roles: the permission map minus the
  // platform-fixed defaults (ACL-03).
  const customRoles = useMemo(
    () =>
      Object.keys(rolesPermissions).filter(
        (role) => !DEFAULT_ROLES.includes(role),
      ),
    [rolesPermissions],
  );

  const allRoles = useMemo(
    () => [...DEFAULT_ROLES, ...customRoles],
    [customRoles],
  );

  // The current owners — the ACL-04 single-owner surface.
  const owners = useMemo(
    () =>
      Object.entries(assignments)
        .filter(([, role]) => role === 'owner')
        .map(([userId]) => userId),
    [assignments],
  );
  const soleOwner = owners.length === 1 ? owners[0] : null;

  // The selected role's granted subset, for the matrix.
  const selectRole = useCallback(
    (role: string): void => {
      setSelectedRole(role);
      setMatrixPermissions(rolesPermissions[role] ?? []);
    },
    [rolesPermissions],
  );

  // Keep the matrix in step when the permission map
  // reloads (after a save).
  useEffect(() => {
    setMatrixPermissions(rolesPermissions[selectedRole] ?? []);
  }, [rolesPermissions, selectedRole]);

  const isDefaultRole = (role: string): boolean =>
    DEFAULT_ROLES.includes(role);

  /** Clear the confirmation and refusal markers. */
  const resetMessages = (): void => {
    setSaved(false);
    setRefusal(null);
  };

  /**
   * Save the selected custom role's permission subset
   * (BLD-03). An empty subset is refused inline, naming
   * the requirement — no API call fires.
   */
  const savePermissions = useCallback(async (): Promise<void> => {
    resetMessages();
    if (matrixPermissions.length === 0) {
      setRefusal(
        'A custom role needs at least one permission — check at least one permission before saving.',
      );
      return;
    }
    setSaving(true);
    try {
      const nextPermissions = {
        ...rolesPermissions,
        [selectedRole]: matrixPermissions,
      };
      const response = await client.patch(
        `/apps/${appId}`,
        {
          section: 'roles-permissions',
          patch: { roles_permissions: nextPermissions },
        },
        AppDefinitionSchema,
      );
      setRolesPermissions(readRolesPermissions(response));
      setDefinition(response);
      setSaved(true);
    } catch (error) {
      setRefusal(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSaving(false);
    }
  }, [client, appId, matrixPermissions, rolesPermissions, selectedRole]);

  /** Create a custom role (an empty subset, saved later). */
  const createRole = useCallback((): void => {
    resetMessages();
    const name = newRoleName.trim();
    if (!name) {
      return;
    }
    if (allRoles.includes(name)) {
      setRefusal(`The role "${name}" already exists.`);
      return;
    }
    setRolesPermissions((current) => ({ ...current, [name]: [] }));
    setNewRoleName('');
    setSelectedRole(name);
    setMatrixPermissions([]);
  }, [allRoles, newRoleName]);

  /**
   * Persist an assignment change (PATCH the
   * role-assignments section wholesale).
   */
  const saveAssignments = useCallback(
    async (next: RoleAssignments): Promise<boolean> => {
      setSaving(true);
      try {
        const response = await client.patch(
          `/apps/${appId}`,
          {
            section: 'role-assignments',
            patch: { role_assignments: next },
          },
          AppDefinitionSchema,
        );
        setAssignments(readAssignments(response));
        setDefinition(response);
        setSaved(true);
        return true;
      } catch (error) {
        // BLD-07: the API's named refusal, verbatim.
        setRefusal(
          error instanceof Error ? error.message : String(error),
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [client, appId],
  );

  /**
   * Change one principal's role (ACL-04: the sole owner's
   * role cannot move off `owner`).
   */
  const changeRole = useCallback(
    (userId: string, role: string): void => {
      resetMessages();
      if (
        soleOwner !== null &&
        userId === soleOwner &&
        role !== 'owner'
      ) {
        setRefusal(
          `${soleOwner} is the app's sole owner — assign another owner before changing or removing this one.`,
        );
        return;
      }
      void saveAssignments({ ...assignments, [userId]: role });
    },
    [assignments, saveAssignments, soleOwner],
  );

  /**
   * Unassign a principal (ACL-04: the sole owner is
   * unremovable — refused inline, naming the owner).
   */
  const unassign = useCallback(
    (userId: string): void => {
      resetMessages();
      if (soleOwner === userId) {
        setRefusal(
          `${soleOwner} is the app's sole owner — assign another owner before removing this one.`,
        );
        return;
      }
      const next = { ...assignments };
      delete next[userId];
      void saveAssignments(next);
    },
    [assignments, saveAssignments, soleOwner],
  );

  /**
   * Assign the autocomplete-resolved user (ACL-02: the
   * target is a real_user_id; ACL-04: a second owner is
   * unassignable — refused inline, naming the current
   * owner).
   */
  const assignUser = useCallback(async (): Promise<void> => {
    resetMessages();
    if (pendingUser === null) {
      return;
    }
    if (assignRole === 'owner' && owners.length > 0) {
      setRefusal(
        `${owners[0]} is the app's current owner — an app has exactly one owner (ACL-04).`,
      );
      return;
    }
    await saveAssignments({
      ...assignments,
      [pendingUser.real_user_id]: assignRole,
    });
    setPendingUser(null);
    setAssignRole('manager');
  }, [assignRole, assignments, owners, pendingUser, saveAssignments]);

  /* ======================= The loading states ======================= */

  if (loadError !== null) {
    return (
      <div data-testid="roles-page">
        <InlineError
          operation="load the app's roles"
          error={loadError}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  if (definition === null) {
    return (
      <div data-testid="roles-page">
        <Skeleton
          variant="cards"
          cards={2}
          label="Loading the app's roles"
        />
      </div>
    );
  }

  /* ======================= The page ======================= */

  return (
    <div data-testid="roles-page">
      <div className="page-head">
        <div className="titles">
          <div
            className="od-row"
            style={{ '--od-gap': '10px', marginBottom: 8 } as never}
          >
            <a className="btn btn-sm" href={`#/apps/${appId}`}>
              ← App
            </a>
            <span className="pill-mono">{appId}</span>
            <span className="pill-mono">v{definition.version}</span>
          </div>
          <h1>{definition.name}</h1>
          <p className="sub">Roles &amp; permissions</p>
        </div>
      </div>

      {refusal ? (
        <div
          data-testid="roles-error"
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
          {refusal}
        </div>
      ) : null}

      {saved ? (
        <div
          data-testid="roles-saved"
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
          Roles saved — permission changes bump the app's version
          immediately.
        </div>
      ) : null}

      <div className="grid-main">
        {/* ============ The role assignments (ACL-02, ACL-04) ============ */}
        <section className="card">
          <div className="card-head">
            <h2>Role assignments</h2>
          </div>
          <div className="card-body">
            <table style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th className="lr-s" style={{ textAlign: 'left' }}>
                    User
                  </th>
                  <th className="lr-s" style={{ textAlign: 'left' }}>
                    Role
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {Object.entries(assignments).map(
                  ([userId, role]) => (
                    <tr
                      key={userId}
                      data-testid={`assignment-row-${userId}`}
                    >
                      <td
                        className="cell-mono"
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: 12.5,
                        }}
                      >
                        {userId}
                      </td>
                      <td>
                        <select
                          className="select"
                          data-testid={`role-for-${userId}`}
                          value={role}
                          onChange={(event) =>
                            changeRole(userId, event.target.value)
                          }
                        >
                          {allRoles.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          data-testid={`unassign-${userId}`}
                          onClick={() => unassign(userId)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>

            <div
              className="divider"
              style={{ margin: '18px 0' }}
            />

            <h3 style={{ fontSize: 14, marginBottom: 10 }}>
              Assign a user
            </h3>
            <UserAutocomplete
              client={client}
              inputTestId="assign-user-input"
              onSelect={(user) => setPendingUser(user)}
            />
            <div
              className="od-row"
              style={
                {
                  '--od-gap': '8px',
                  marginTop: 10,
                  alignItems: 'center',
                } as never
              }
            >
              <select
                className="select"
                data-testid="assign-role-select"
                value={assignRole}
                onChange={(event) => setAssignRole(event.target.value)}
              >
                {allRoles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                data-testid="assign-user-button"
                disabled={pendingUser === null || saving}
                onClick={() => void assignUser()}
              >
                Assign
              </button>
            </div>
            <p className="helper" style={{ marginTop: 10 }}>
              Assignment targets a user's{' '}
              <span className="code-inline">real_user_id</span> —
              group- and attribute-based targets are not supported
              (ACL-02).
            </p>
          </div>
        </section>

        {/* ============ The permission matrix (BLD-03) ============ */}
        <section className="card">
          <div className="card-head">
            <h2>Roles &amp; permissions</h2>
          </div>
          <div className="card-body">
            <div
              className="od-row"
              style={
                {
                  '--od-gap': '8px',
                  marginBottom: 12,
                  alignItems: 'center',
                } as never
              }
            >
              <label
                className="lr-s"
                htmlFor="role-select"
                style={{ fontWeight: 600 }}
              >
                Role
              </label>
              <select
                id="role-select"
                className="select"
                data-testid="role-select"
                value={selectedRole}
                onChange={(event) => selectRole(event.target.value)}
              >
                {allRoles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                    {isDefaultRole(role) ? ' (default)' : ''}
                  </option>
                ))}
              </select>
              <span className="od-fill" />
              <span className="pill-mono">
                {matrixPermissions.length} perm
                {matrixPermissions.length === 1 ? '' : 's'}
              </span>
            </div>

            <PermissionMatrix
              permissions={matrixPermissions}
              onChange={setMatrixPermissions}
              readOnly={isDefaultRole(selectedRole)}
            />

            {isDefaultRole(selectedRole) ? (
              <p className="helper" style={{ marginTop: 10 }}>
                Default roles are platform-fixed (ACL-03) — create a
                custom role to grant a tailored subset.
              </p>
            ) : (
              <div
                className="od-row"
                style={
                  {
                    '--od-gap': '8px',
                    marginTop: 12,
                    alignItems: 'center',
                  } as never
                }
              >
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  data-testid="save-role-permissions"
                  disabled={saving}
                  onClick={() => void savePermissions()}
                >
                  Save role
                </button>
                <span className="helper">
                  A custom role needs a non-empty permission subset.
                </span>
              </div>
            )}

            <div
              className="divider"
              style={{ margin: '18px 0' }}
            />

            <h3 style={{ fontSize: 14, marginBottom: 10 }}>
              New custom role
            </h3>
            <div
              className="od-row"
              style={
                {
                  '--od-gap': '8px',
                  alignItems: 'center',
                } as never
              }
            >
              <input
                type="text"
                className="input"
                data-testid="new-role-name"
                value={newRoleName}
                placeholder="e.g. support"
                onChange={(event) => setNewRoleName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    createRole();
                  }
                }}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-sm"
                data-testid="create-role-button"
                onClick={createRole}
              >
                Create role
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
