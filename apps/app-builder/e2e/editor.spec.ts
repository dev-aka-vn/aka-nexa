/**
 * E2E for the app editor (BLD-02/03/06).
 *
 * Stubs the builder API so the browser boot, the
 * twelve section tabs, the JSON payload edit, and
 * the publish confirm/cancel all run against the
 * real SPA — no backend needed.
 */

import {
  expect,
  test,
  type Page,
  type Route,
} from '@playwright/test';

/** The app the editor edits. */
const APP_ID = 'hr-leave-request';

/** The twelve section tabs, in contract order (BLD-02). */
const SECTIONS = [
  'general',
  'metadata',
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

/** The section tab labels the editor renders. */
const SECTION_LABELS: Record<string, string> = {
  general: 'General',
  metadata: 'Metadata',
  'jev-behavior': 'JEV behavior',
  'role-assignments': 'Role assignments',
  'roles-permissions': 'Roles & permissions',
  forms: 'Forms',
  versioning: 'Versioning',
  'data-routing': 'Data routing',
  'field-mapping': 'Field mapping',
  lifecycle: 'Lifecycle state',
  retention: 'Retention policy',
  'deprecation-notice': 'Deprecation notice',
};

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
    forms: [
      {
        kind: 'submit',
        form_id: 'submit-0001',
        form_version: 1,
        schema: {
          components: [
            { type: 'textField', key: 'fullName', label: 'Full name' },
          ],
        },
        triggers: null,
        config: {},
      },
    ],
    triggers: [],
    roles: {},
    routing_config: null,
    field_mapping: null,
    retention_policy: null,
    deprecation_notice: null,
    lifecycle_prefs: null,
    jev_behavior: null,
    role_assignments: { usr_owner_1: 'owner' },
    roles_permissions: null,
    versioning_policy: null,
    metadata: null,
    createdBy: 'usr_owner_1',
    createdAt: '2026-10-12T10:00:00.000Z',
    ...overrides,
  };
}

export interface EditorApiHooks {
  /** Every PATCH /apps/:id body, in order. */
  onPatch?: (body: Record<string, unknown>) => void;
  /** Every POST /apps/:id/publish body, in order. */
  onPublish?: (body: Record<string, unknown>) => void;
}

/** Stub the builder API the editor touches. */
async function stubEditorApi(
  page: Page,
  hooks: EditorApiHooks = {},
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

  await page.route('**/api/apps/**', async (route: Route) => {
    const method = route.request().method();
    const url = route.request().url();

    if (method === 'GET' && url.endsWith(`/${APP_ID}`)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(definition()),
      });
    }

    if (method === 'POST' && url.endsWith('/publish')) {
      let body: Record<string, unknown> = {};
      try {
        body = route.request().postDataJSON() ?? {};
      } catch {
        body = {};
      }
      hooks.onPublish?.(body);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...definition({ version: 2 }),
          changeSummary: [
            {
              field: 'name',
              from: 'HR Leave Request',
              to: 'Renamed leave app',
            },
          ],
          zero_change: false,
        }),
      });
    }

    if (method === 'PATCH') {
      const body = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      hooks.onPatch?.(body);
      // Echo a forms-section patch back into the
      // served definition: the page re-reads the
      // persisted value off the PATCH response,
      // so a saved edit stops reading as dirty.
      const updated = definition({ version: 2 });
      if (body['section'] === 'forms') {
        const patch = body['patch'] as Record<string, unknown>;
        if (
          typeof patch === 'object' &&
          patch !== null &&
          'forms' in patch
        ) {
          updated['forms'] = patch['forms'];
        }
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(updated),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });
}

test('the editor renders the twelve section tabs in contract order and saves a general section patch (BLD-02)', async ({
  page,
}) => {
  const patches: Array<Record<string, unknown>> = [];
  await stubEditorApi(page, {
    onPatch: (body) => patches.push(body),
  });

  await page.goto(`#/apps/${APP_ID}`);
  await expect(page.getByTestId('editor-page')).toBeVisible();

  // Exactly the twelve contract sections, in order.
  const tabs = page.locator('[data-testid^="editor-tab-"]');
  await expect(tabs).toHaveCount(SECTIONS.length);
  for (const section of SECTIONS) {
    await expect(
      page.getByTestId(`editor-tab-${section}`),
    ).toContainText(SECTION_LABELS[section]);
  }
  // The General tab is active on load.
  await expect(page.getByTestId('editor-tab-general')).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Edit the General tab: name + description.
  await page.getByTestId('section-name').fill('Renamed leave app');
  await page.getByTestId('section-description').fill(
    'Request, approve, and track leave',
  );
  await page.getByTestId('save-section').click();

  await expect(page.getByTestId('editor-saved')).toBeVisible();

  expect(patches).toHaveLength(1);
  expect(patches[0]['section']).toBe('general');
  const patch = patches[0]['patch'] as Record<string, unknown>;
  expect(patch['name']).toBe('Renamed leave app');
  expect(patch['description']).toBe(
    'Request, approve, and track leave',
  );
});

test('every other section edits as its JSON payload — the forms tab round-trips the form schema', async ({
  page,
}) => {
  const patches: Array<Record<string, unknown>> = [];
  await stubEditorApi(page, {
    onPatch: (body) => patches.push(body),
  });

  await page.goto(`#/apps/${APP_ID}`);
  await expect(page.getByTestId('editor-page')).toBeVisible();

  // The forms tab shows the served form schema as JSON.
  await page.getByTestId('editor-tab-forms').click();
  await expect(page.getByTestId('editor-tab-forms')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const json = page.getByTestId('section-json');
  await expect(json).toHaveValue(/"fullName"/);

  // Save the (unchanged) schema — the patch round-trips.
  await page.getByTestId('save-section').click();
  await expect(page.getByTestId('editor-saved')).toBeVisible();

  expect(patches).toHaveLength(1);
  expect(patches[0]['section']).toBe('forms');
  const patch = patches[0]['patch'] as Record<string, unknown>;
  expect((patch['forms'] as { components: unknown[] })
    .components.length).toBeGreaterThan(0);
});

test('publish opens a confirmation naming the app and posts only on confirm (BLD-06)', async ({
  page,
}) => {
  const publishes: Array<Record<string, unknown>> = [];
  await stubEditorApi(page, {
    onPublish: (body) => publishes.push(body),
  });

  await page.goto(`#/apps/${APP_ID}`);
  await expect(page.getByTestId('editor-page')).toBeVisible();

  // The publish action is present but does nothing yet.
  await page.getByTestId('publish-app').click();
  const dialog = page.getByTestId('publish-confirm');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('HR Leave Request');
  expect(publishes).toHaveLength(0);

  // Confirm — only now does the POST fire.
  await page.getByTestId('publish-confirm-yes').click();
  await expect(publishes).toHaveLength(1);
  expect(publishes[0]['app_id']).toBe(APP_ID);
});
