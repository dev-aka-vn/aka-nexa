/**
 * The per-app ability factory (ACL-10, BLD-11, ACL-01, BLD-03).
 *
 * The builder's authorization is a pure function of the
 * app's role assignments: given who is assigned what on
 * this app, what may the viewer do? The rules are
 * derived, never stored — so a `perm_version` epoch bump
 * (ACL-07) invalidates the derived ability by
 * construction: re-derive on the next request (ACL-08).
 *
 * The ACL-10 ownership-transfer carve-out is a **rule
 * omission**: `transfer-execution` is simply never in any
 * role's rule set — not the owner's, not anyone's. There
 * is no runtime check to forget because there is no rule
 * to forget.
 */

import { describe, expect, it } from 'vitest';

import {
  APP_SECTION_PERMISSIONS,
  createBuilderAbility,
  type AppRoleAssignment,
} from './builder-ability.js';

/** The viewing principal the specs derive abilities for. */
const VIEWER = 'usr_viewer_1';

/** Build an assignment list from `[real_user_id, role, permissions?]` rows. */
function assignments(
  ...rows: Array<[string, string, string[]?]>
): AppRoleAssignment[] {
  return rows.map(([real_user_id, role, permissions]) => ({
    real_user_id,
    role,
    ...(permissions ? { permissions } : {}),
  }));
}

describe('createBuilderAbility — per-app abilities from the role assignments', () => {
  it('the owner manages every app section (ACL-03)', () => {
    const ability = createBuilderAbility(
      assignments([VIEWER, 'owner']),
      VIEWER,
    );

    for (const section of APP_SECTION_PERMISSIONS) {
      expect(ability.can('manage', section)).toBe(true);
    }
  });

  it('the owner may request an ownership transfer but never executes it (ACL-10 carve-out)', () => {
    const ability = createBuilderAbility(
      assignments([VIEWER, 'owner']),
      VIEWER,
    );

    expect(ability.can('request-transfer', 'ownership')).toBe(true);
    // The carve-out is a rule omission: transfer-execution is
    // granted by no rule, to any role.
    expect(ability.can('transfer-execution', 'ownership')).toBe(false);
  });

  it('a delegated workflow manager operates the app without lifecycle, transfer, or role assignment (BLD-11)', () => {
    const ability = createBuilderAbility(
      assignments([VIEWER, 'manager'], ['usr_owner_1', 'owner']),
      VIEWER,
    );

    expect(ability.can('operate', 'forms')).toBe(true);
    expect(ability.can('operate', 'data-routing')).toBe(true);
    // No lifecycle transitions …
    expect(ability.can('publish', 'lifecycle')).toBe(false);
    expect(ability.can('deprecate', 'lifecycle')).toBe(false);
    expect(ability.can('archive', 'lifecycle')).toBe(false);
    // … no transfer of any kind …
    expect(ability.can('request-transfer', 'ownership')).toBe(false);
    expect(ability.can('transfer-execution', 'ownership')).toBe(false);
    // … and no role assignment.
    expect(ability.can('assign-roles', 'role-assignments')).toBe(false);
    expect(ability.can('assign-roles', 'roles-permissions')).toBe(false);
  });

  it('an admin operates sections, assigns roles, and runs lifecycle transitions', () => {
    const ability = createBuilderAbility(
      assignments([VIEWER, 'admin'], ['usr_owner_1', 'owner']),
      VIEWER,
    );

    for (const section of APP_SECTION_PERMISSIONS) {
      expect(ability.can('operate', section)).toBe(true);
    }
    expect(ability.can('assign-roles', 'role-assignments')).toBe(true);
    expect(ability.can('assign-roles', 'roles-permissions')).toBe(true);
    expect(ability.can('publish', 'lifecycle')).toBe(true);
    expect(ability.can('deprecate', 'lifecycle')).toBe(true);
    expect(ability.can('archive', 'lifecycle')).toBe(true);
    // Even the admin cannot transfer ownership (ACL-10).
    expect(ability.can('request-transfer', 'ownership')).toBe(false);
    expect(ability.can('transfer-execution', 'ownership')).toBe(false);
  });

  it('a plain user may only use the app', () => {
    const ability = createBuilderAbility(
      assignments([VIEWER, 'user'], ['usr_owner_1', 'owner']),
      VIEWER,
    );

    expect(ability.can('use', 'app')).toBe(true);
    expect(ability.can('operate', 'forms')).toBe(false);
    expect(ability.can('manage', 'general')).toBe(false);
  });

  it('a user with no role gets no app actions (ACL-01)', () => {
    const ability = createBuilderAbility(
      assignments(['usr_owner_1', 'owner']),
      VIEWER,
    );

    expect(ability.can('use', 'app')).toBe(false);
    expect(ability.can('operate', 'forms')).toBe(false);
    expect(ability.can('manage', 'general')).toBe(false);
    expect(ability.can('request-transfer', 'ownership')).toBe(false);
  });

  it('a custom role operates exactly its granted section subset (BLD-03)', () => {
    const ability = createBuilderAbility(
      assignments([
        VIEWER,
        'support',
        ['forms', 'field-mapping'],
      ]),
      VIEWER,
    );

    expect(ability.can('operate', 'forms')).toBe(true);
    expect(ability.can('operate', 'field-mapping')).toBe(true);
    expect(ability.can('operate', 'triggers')).toBe(false);
    expect(ability.can('manage', 'forms')).toBe(false);
  });

  it('abilities are pure functions of the assignment list — re-derivation follows the assignments (ACL-07/08)', () => {
    const asOwner = createBuilderAbility(
      assignments([VIEWER, 'owner']),
      VIEWER,
    );
    expect(asOwner.can('manage', 'forms')).toBe(true);

    // The assignment list changes (the epoch bump invalidated the
    // old derivation); the next request re-derives from scratch.
    const asStranger = createBuilderAbility(
      assignments(['usr_other_1', 'owner']),
      VIEWER,
    );
    expect(asStranger.can('manage', 'forms')).toBe(false);
    expect(asStranger.can('use', 'app')).toBe(false);
  });
});
