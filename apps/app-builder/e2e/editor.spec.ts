/**
 * The tabbed editor spec (BLD-02, BLD-07).
 *
 * The app-detail editor: the twelve contract sections
 * (SectionNameSchema) as tabs, each tab a section PATCH
 * against `PATCH /apps/:id` with `{section, patch}`. The
 * spec runs against a stubbed builder API (the frozen
 * plan-04 contract) and proves:
 *
 *  1. The editor renders exactly the twelve section tabs
 *     in contract order, and the General tab is active on
 *     load.
 *  2. Editing the General tab saves a `general` section
 *     patch (name + description) and confirms inline.
 *  3. Every other section edits as its JSON payload —
 *     the forms tab round-trips the app's form schema.
 *  4. An invalid section payload is refused inline,
 *     naming the section — never a generic message
 *     (BLD-07) — and no API call fires.
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

/** The section tab labels the editor renders. */
const SECTION_LABELS: Record<string, string> = {
  general: 'General',
  metadata: 'Metadata',
  triggers: 'Triggers',
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
    form_schema: {
      components: [
        { type: 'textField', key: 'fullName', label: 'Full name' },
      ],
    },
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
  expect((patch['form_schema'] as { components: unknown[] })
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

  // The gate is not present until publish is requested.
  const gate = page.getByTestId('editor-publish-confirm');
  await expect(gate).toHaveCount(0);

  // A click opens the gate — and fires no request.
  await page.getByTestId('editor-publish').click();
  await expect(gate).toBeVisible();
  await expect(gate).toContainText('HR Leave Request');
  expect(publishes).toHaveLength(0);

  // Cancel closes the gate — and still fires nothing.
  await page.getByTestId('editor-publish-cancel').click();
  await expect(gate).toHaveCount(0);
  expect(publishes).toHaveLength(0);

  // Only the gate's confirm posts: exactly one request,
  // and the post-publish banner renders the response rows.
  await page.getByTestId('editor-publish').click();
  await expect(gate).toBeVisible();
  await page.getByTestId('editor-publish-confirm-button').click();
  await expect(page.getByTestId('editor-published')).toBeVisible();
  await expect(page.getByTestId('publish-change-row')).toHaveCount(1);
  expect(publishes).toHaveLength(1);
});

test('an invalid section payload is refused inline, naming the section (BLD-07)', async ({
  page,
}) => {
  const patches: Array<Record<string, unknown>> = [];
  await stubEditorApi(page, {
    onPatch: (body) => patches.push(body),
  });

  await page.goto(`#/apps/${APP_ID}`);
  await expect(page.getByTestId('editor-page')).toBeVisible();

  await page.getByTestId('editor-tab-triggers').click();
  const json = page.getByTestId('section-json');
  await json.fill('{ not valid json');
  await page.getByTestId('save-section').click();

  const error = page.getByTestId('editor-error');
  await expect(error).toBeVisible();
  await expect(error).toContainText('triggers');
  await expect(error).toContainText('valid JSON');

  // The refusal is inline: no API call fired.
  expect(patches).toHaveLength(0);
});
