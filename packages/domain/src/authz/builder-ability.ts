/**
 * The per-app ability factory (ACL-10, BLD-11, ACL-01, BLD-03).
 *
 * The builder's authorization is a **pure function of the
 * app's role assignments**: given who is assigned what on
 * this app, what may the viewer do? The rules are derived,
 * never stored — which is exactly what the `perm_version`
 * epoch model needs (ACL-07): an epoch bump invalidates the
 * derived ability by construction, because the next request
 * re-derives from the (new) assignment list (ACL-08).
 *
 * The vocabulary:
 *
 *  - **Subjects**: the twelve app sections (the BLD-02
 *    editor's tabs), plus `app` (the app as a whole) and
 *    `ownership` (the transfer surface).
 *  - **Actions**: `manage` (full section control),
 *    `operate` (edit sections without lifecycle, transfer,
 *    or role administration), `use` (consume the app),
 *    `assign-roles`, the lifecycle transitions
 *    (`publish` / `deprecate` / `archive`), and the
 *    ownership-transfer pair (`request-transfer` /
 *    `transfer-execution`).
 *
 * The ACL-10 ownership-transfer carve-out is a **rule
 * omission**: `transfer-execution` is granted by no rule, to
 * any role — not even the owner's. There is no runtime
 * check to forget because there is no rule to forget; the
 * ability simply never contains it.
 */

import {
  AbilityBuilder,
  createMongoAbility,
  type MongoAbility,
} from '@casl/ability';

/**
 * The twelve app sections — the permissions a role grants
 * (the BLD-02 editor's sections, in contract order).
 */
export const APP_SECTION_PERMISSIONS = [
  'general',
  'metadata',
  'triggers',
  'jev-behavior',
  'role-assignments',
  'roles-permissions',
  'forms',
  'versioning',
  'data-routing',
  'field-mapping',
  'lifecycle',
  'retention',
  'deprecation-notice',
] as const;

export type AppSectionPermission =
  (typeof APP_SECTION_PERMISSIONS)[number];

/** The app as a whole (the `use` action's subject). */
export const APP_SUBJECT = 'app';

/** The ownership-transfer surface (ACL-10). */
export const OWNERSHIP_SUBJECT = 'ownership';

/** The ACL-03 default roles. */
export const DEFAULT_BUILDER_ROLES = [
  'owner',
  'admin',
  'manager',
  'user',
] as const;

export type DefaultBuilderRole = (typeof DEFAULT_BUILDER_ROLES)[number];

/**
 * One principal's role on the app (the `role-assignments`
 * section's entry). Custom roles carry their granted
 * section subset (BLD-03); default roles' grants are
 * fixed by this module.
 */
export interface AppRoleAssignment {
  readonly real_user_id: string;
  readonly role: string;
  /** Custom roles only: the granted section subset. */
  readonly permissions?: readonly AppSectionPermission[];
}

/** The derived per-app ability. */
export type BuilderAbility = MongoAbility;

/** Is the role one of the ACL-03 defaults? */
function isDefaultRole(role: string): role is DefaultBuilderRole {
  return (
    (DEFAULT_BUILDER_ROLES as readonly string[]).includes(role)
  );
}

/**
 * Derive the viewer's ability on this app from the
 * assignment list. Pure: the same assignments always
 * derive the same ability, and a changed list derives a
 * changed ability (ACL-07/08).
 *
 * Role grants:
 *
 *  - **owner**: `manage` every section, plus
 *    `request-transfer` on ownership — never
 *    `transfer-execution` (ACL-10's carve-out).
 *  - **admin**: `operate` every section, `assign-roles`,
 *    and the lifecycle transitions. No transfer.
 *  - **manager** (the BLD-11 delegated workflow manager):
 *    `operate` every section — no lifecycle transitions,
 *    no transfer, no role assignment.
 *  - **user**: `use` the app only.
 *  - **custom roles**: `operate` exactly their granted
 *    section subset (BLD-03).
 */
export function createBuilderAbility(
  assignments: readonly AppRoleAssignment[],
  viewer: string,
): BuilderAbility {
  const { can, build } = new AbilityBuilder(createMongoAbility);

  for (const assignment of assignments) {
    if (assignment.real_user_id !== viewer) {
      continue;
    }

    switch (assignment.role) {
      case 'owner':
        for (const section of APP_SECTION_PERMISSIONS) {
          can('manage', section);
        }
        can('request-transfer', OWNERSHIP_SUBJECT);
        // ACL-10: `transfer-execution` is deliberately
        // absent — a rule omission, not a runtime check.
        break;
      case 'admin':
        for (const section of APP_SECTION_PERMISSIONS) {
          can('operate', section);
        }
        can('assign-roles', 'role-assignments');
        can('assign-roles', 'roles-permissions');
        can('publish', 'lifecycle');
        can('deprecate', 'lifecycle');
        can('archive', 'lifecycle');
        break;
      case 'manager':
        // BLD-11: the delegated workflow manager operates
        // the app — no lifecycle transitions, no transfer,
        // no role assignment.
        for (const section of APP_SECTION_PERMISSIONS) {
          can('operate', section);
        }
        break;
      case 'user':
        can('use', APP_SUBJECT);
        break;
      default:
        // Custom roles: exactly their granted subset
        // (BLD-03). A role with no grant operates
        // nothing.
        for (const section of assignment.permissions ?? []) {
          can('operate', section);
        }
    }
  }

  return build();
}

/** The roles a principal holds on the app. */
export function viewerRoles(
  assignments: readonly AppRoleAssignment[],
  viewer: string,
): readonly string[] {
  return assignments
    .filter((a) => a.real_user_id === viewer)
    .map((a) => a.role);
}

/**
 * The app's owners — the principals holding the `owner`
 * role. The single-owner rule (ACL-04) is enforced
 * against this list: there is always exactly one.
 */
export function appOwners(
  assignments: readonly AppRoleAssignment[],
): readonly AppRoleAssignment[] {
  return assignments.filter((a) => a.role === 'owner');
}

/**
 * Can the assignment list still drop this principal's
 * owner role? Only while another owner exists (ACL-04):
 * the sole owner is unremovable.
 */
export function canUnassignOwner(
  assignments: readonly AppRoleAssignment[],
  real_user_id: string,
): boolean {
  const owners = appOwners(assignments);
  if (owners.length !== 1) {
    return true;
  }
  return owners[0]?.real_user_id !== real_user_id;
}

/**
 * Can the principal be assigned the owner role? Only
 * while no owner exists (ACL-04): a second owner is
 * unassignable.
 */
export function canAssignOwner(
  assignments: readonly AppRoleAssignment[],
): boolean {
  return appOwners(assignments).length === 0;
}

export { isDefaultRole };
