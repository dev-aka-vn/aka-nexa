/**
 * The roles & permissions spec (BLD-03, ACL-02, ACL-04,
 * BLD-07, BLD-09).
 *
 * The app-builder's self-service RBAC: department admins
 * build and own their own apps — forms, roles, routing
 * destinations — without engineering tickets. The spec runs
 * against a stubbed builder API (the frozen plan-04/05/06
 * contracts) plus the identity-directory search the plan
 * 06-08 API will serve, and proves:
 *
 *  1. The permission matrix renders **every** app
 *     permission as a checkbox, and saving a custom role
 *     with any non-empty subset succeeds (PATCH
 *     /apps/:id, section `roles-permissions`).
 *  2. An empty subset is refused **inline**, naming the
 *     requirement (BLD-03) — no API call fires.
 *  3. The user autocomplete searches by name or email
 *     prefix (GET /users/search), resolves to
 *     `real_user_id`, and never offers a group or
 *     attribute target (ACL-02 — the search contract only
 *     ever resolves users).
 *  4. A no-match search returns an inline error echoing
 *     the typed string (BLD-07).
 *  5. The sole owner cannot be unassigned and a second
 *     owner cannot be assigned — both refused inline,
 *     naming the current owner (ACL-04).
 *  6. The page skeletons while loading and renders a
 *     specific inline error with a retry action on
 *     failure (BLD-09, BLD-07).
 */

import {
  expect,
  test,
  type Page,
  type Route,
} from '@playwright/test';

/** The app the roles page manages. */
const APP_ID = 'hr-leave-request';

/** The twelve app permissions, in contract order (BLD-02). */
const SECTIONS = [
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
];

/** The identity directory the autocomplete searches (ACL-02: users only). */
const DIRECTORY = [
  {
    real_user_id: 'usr_owner_1',
    name: 'Owenna Owner',
    email: 'owner@example.com',
  },
  {
    real_user_id: 'usr_alice_1',
    name: 'Alice Anderson',
    email: 'alice@example.com',
  },
  {
    real_user_id: 'usr_bob_2',
    name: 'Bob Brown',
    email: 'bob@example.com',
  },
];

/** The served definition the stubbed GET /apps/:id answers with. */
function definition(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    app_id: APP_ID,
    name: 'HR Leave Request',
    description: 'Request and approve leave',
    data_mode: 'internal',
    lifecycle: 'draft',
    version: 1,
    tags: [],
    form_schema: null,
    triggers: [],
    roles: {},
    routing_config: null,
    field_mapping: null,
    retention_policy: null,
    deprecation_notice: null,
    lifecycle_prefs: null,
    jev_behavior: null,
    role_assignments: { usr_owner_1: 'owner' },
    roles_permissions: {
      owner: SECTIONS,
      admin: SECTIONS,
      manager: ['general', 'metadata', 'forms'],
      user: [],
    },
    versioning_policy: null,
    metadata: null,
    createdBy: 'usr_owner_1',
    createdAt: '2026-10-12T10:00:00.000Z',
    ...overrides,
  };
}

export interface RolesApiHooks {
  /** Every PATCH /apps/:id body, in order. */
  onPatch?: (body: Record<string, unknown>) => void;
  /** Fail the definition read (BLD-07's failure path). */
  failAppGet?: () => boolean;
}

/**
 * Stub the builder API the roles page touches: the session
 * boot, the definition read, the section PATCHes, and the
 * identity-directory search.
 */
async function stubRolesApi(
  page: Page,
  hooks: RolesApiHooks = {},
): Promise<void> {
  await page.route('**/api/auth/me', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        real_user_id: 'usr_owner_1',
        mfa_at: '2026-10-12T10:00:00.000Z',
      }),
    }),
  );

  // The identity directory: name or email **prefix** match,
  // users only (ACL-02 — groups and attributes never
  // appear in this contract).
  await page.route('**/api/users/search**', (route: Route) => {
    const q =
      new URL(route.request().url()).searchParams.get('q') ?? '';
    const needle = q.trim().toLowerCase();
    const users =
      needle.length === 0
        ? []
        : DIRECTORY.filter(
            (user) =>
              user.name.toLowerCase().startsWith(needle) ||
              user.email.toLowerCase().startsWith(needle),
          );
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ users }),
    });
  });

  // Every app path: the definition read and the section
  // PATCHes. `**` spans the multi-segment paths.
  await page.route('**/api/apps/**', async (route: Route) => {
    const method = route.request().method();
    const url = route.request().url();

    if (method === 'GET' && url.endsWith(`/${APP_ID}`)) {
      if (hooks.failAppGet?.()) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'APP_READ_FAILED',
              message: 'app definition read failed',
            },
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(definition()),
      });
    }

    if (method === 'PATCH') {
      const body = route.request().postDataJSON();
      hooks.onPatch?.(body);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(definition({ version: 2 })),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });
}

/** Create a custom role through the page's own controls. */
async function createCustomRole(
  page: Page,
  name: string,
): Promise<void> {
  await page.getByTestId('new-role-name').fill(name);
  await page.getByTestId('create-role-button').click();
  await page.getByTestId('role-select').selectOption(name);
}

test('the permission matrix renders every app permission and saves a non-empty custom role subset (BLD-03)', async ({
  page,
}) => {
  const patches: Array<Record<string, unknown>> = [];
  await stubRolesApi(page, {
    onPatch: (body) => patches.push(body),
  });

  await page.goto(`#/apps/${APP_ID}/roles`);
  await expect(page.getByTestId('roles-page')).toBeVisible();

  // The default roles render with their permission counts.
  await expect(page.getByTestId('role-select')).toContainText(
    /owner.*admin.*manager.*user/s,
  );

  await createCustomRole(page, 'support');

  // Every app permission renders as a checkbox.
  const matrix = page.getByTestId('permission-matrix');
  const checkboxes = matrix.locator('input[type="checkbox"]');
  await expect(checkboxes).toHaveCount(SECTIONS.length);

  // Any non-empty subset is savable: check the first two.
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await page.getByTestId('save-role-permissions').click();

  await expect(page.getByTestId('roles-saved')).toBeVisible();

  expect(patches).toHaveLength(1);
  expect(patches[0]['section']).toBe('roles-permissions');
  const patch = patches[0]['patch'] as Record<string, unknown>;
  expect(patch['roles_permissions']).toEqual({
    support: ['general', 'metadata'],
  });
});

test('saving a custom role with an empty permission subset is refused inline, naming the requirement (BLD-03)', async ({
  page,
}) => {
  const patches: Array<Record<string, unknown>> = [];
  await stubRolesApi(page, {
    onPatch: (body) => patches.push(body),
  });

  await page.goto(`#/apps/${APP_ID}/roles`);
  await expect(page.getByTestId('roles-page')).toBeVisible();

  await createCustomRole(page, 'empty');
  // No box checked — the subset is empty.
  await page.getByTestId('save-role-permissions').click();

  const error = page.getByTestId('roles-error');
  await expect(error).toBeVisible();
  await expect(error).toContainText('at least one permission');

  // The refusal is inline: no API call fired.
  expect(patches).toHaveLength(0);
});

test('the autocomplete resolves a name or email prefix to a real_user_id and never offers group targets (ACL-02)', async ({
  page,
}) => {
  const patches: Array<Record<string, unknown>> = [];
  await stubRolesApi(page, {
    onPatch: (body) => patches.push(body),
  });

  await page.goto(`#/apps/${APP_ID}/roles`);
  await expect(page.getByTestId('roles-page')).toBeVisible();

  const input = page.getByTestId('assign-user-input');
  await input.fill('alice');

  // The prefix search resolves Alice — by name and by
  // email prefix — to her real_user_id, and only her.
  const options = page.locator('[data-testid^="user-option-"]');
  await expect(options).toHaveCount(1);
  await expect(page.getByTestId('user-option-usr_alice_1')).toBeVisible();
  await expect(page.getByTestId('user-option-usr_alice_1')).toContainText(
    'Alice Anderson',
  );
  await page.getByTestId('user-option-usr_alice_1').click();

  await page.getByTestId('assign-role-select').selectOption('manager');
  await page.getByTestId('assign-user-button').click();

  await expect(page.getByTestId('roles-saved')).toBeVisible();

  expect(patches).toHaveLength(1);
  expect(patches[0]['section']).toBe('role-assignments');
  const patch = patches[0]['patch'] as Record<string, unknown>;
  expect(patch['role_assignments']).toEqual({
    usr_owner_1: 'owner',
    usr_alice_1: 'manager',
  });
});

test('a no-match search returns an inline error echoing the typed string (BLD-07)', async ({
  page,
}) => {
  await stubRolesApi(page);

  await page.goto(`#/apps/${APP_ID}/roles`);
  await expect(page.getByTestId('roles-page')).toBeVisible();

  const input = page.getByTestId('assign-user-input');
  await input.fill('zzznope');

  const error = page.getByTestId('autocomplete-error');
  await expect(error).toBeVisible();
  await expect(error).toContainText('zzznope');
});

test('the sole owner cannot be unassigned and a second owner cannot be assigned (ACL-04)', async ({
  page,
}) => {
  const patches: Array<Record<string, unknown>> = [];
  await stubRolesApi(page, {
    onPatch: (body) => patches.push(body),
  });

  await page.goto(`#/apps/${APP_ID}/roles`);
  await expect(page.getByTestId('roles-page')).toBeVisible();

  // usr_owner_1 is the app's sole owner: removing the only
  // owner is refused inline, naming the current owner.
  await page.getByTestId('unassign-usr_owner_1').click();
  await expect(page.getByTestId('roles-error')).toContainText(
    'usr_owner_1',
  );

  // Assigning a second owner is refused the same way.
  const input = page.getByTestId('assign-user-input');
  await input.fill('alice');
  await expect(page.getByTestId('user-option-usr_alice_1')).toBeVisible();
  await page.getByTestId('user-option-usr_alice_1').click();
  await page.getByTestId('assign-role-select').selectOption('owner');
  await page.getByTestId('assign-user-button').click();
  await expect(page.getByTestId('roles-error')).toContainText(
    'usr_owner_1',
  );

  // Both refusals are inline: no API call fired.
  expect(patches).toHaveLength(0);
});

test('the roles page skeletons while loading and renders a specific inline error with retry (BLD-09, BLD-07)', async ({
  page,
}) => {
  let fail = true;
  await stubRolesApi(page, { failAppGet: () => fail });

  await page.goto(`#/apps/${APP_ID}/roles`);

  // The layout-shaped placeholder renders while the
  // definition loads …
  await expect(page.getByTestId('skeleton')).toBeVisible();
  // … and the specific, named failure replaces it, with
  // the retry action.
  const error = page.getByTestId('inline-error');
  await expect(error).toBeVisible();
  await expect(error).toContainText('APP_READ_FAILED');
  await expect(page.getByTestId('inline-error-retry')).toBeVisible();

  fail = false;
  await page.getByTestId('inline-error-retry').click();
  await expect(page.getByTestId('roles-page')).toBeVisible();
});
