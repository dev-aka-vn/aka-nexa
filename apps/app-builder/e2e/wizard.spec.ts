/**
 * E2E for the create wizard (BLD-01).
 */

import {
  expect,
  test,
  type Page,
  type Route,
} from '@playwright/test';

/** The mockup's exact step-1 toast copy (prototypes/mockup.html:1603-1628). */
const DRAFT_TOAST =
  'Saved as a draft · continue through the wizard steps';

export interface WizardApiHooks {
  onPostApps?: (body: Record<string, unknown>) => void;
  onPatch?: (
    url: string,
    body: Record<string, unknown>,
  ) => void;
  /** Every GET the wizard or the designer issues against a deeper app path. */
  onGet?: (url: string) => void;
}

/**
 * Stub the builder API the wizard touches: the
 * session boot, the app list, the step-1 create,
 * the per-section PATCHes, and the connector
 * request list step 5 reads.
 */
async function stubBuilderApi(
  page: Page,
  hooks: WizardApiHooks = {},
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

  await page.route('**/api/apps', async (route: Route) => {
    const method = route.request().method();
    if (method === 'POST') {
      let body: Record<string, unknown> = {};
      try {
        body = route.request().postDataJSON() ?? {};
      } catch {
        body = {};
      }
      hooks.onPostApps?.(body);
      const appId = String(
        (body.app_id as string | undefined) ?? 'test-app',
      ).trim();
      const name = String(
        (body.name as string | undefined) ?? 'Test App',
      ).trim();
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          app_id: appId,
          name,
          description: '',
          data_mode: 'internal',
          lifecycle: 'draft',
          version: 1,
          tags: [],
          forms: [
            {
              kind: 'submit',
              form_id: 'submit-0001',
              form_version: 1,
              schema: { fields: [] },
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
          role_assignments: null,
          roles_permissions: null,
          versioning_policy: null,
          metadata: null,
          createdBy: 'usr_owner_1',
          createdAt: '2026-10-12T10:00:00.000Z',
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/api/apps/**', async (route: Route) => {
    const method = route.request().method();
    const url = route.request().url();
    if (method === 'GET') {
      hooks.onGet?.(url);
    }
    if (method === 'PATCH') {
      const body = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      hooks.onPatch?.(url, body);
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        app_id: 'hr-leave-request',
        name: 'HR Leave Request',
        description: '',
        data_mode: 'internal',
        lifecycle: 'draft',
        version: 1,
        tags: [],
        forms: [
          {
            kind: 'submit',
            form_id: 'submit-0001',
            form_version: 1,
            schema: { fields: [] },
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
        role_assignments: null,
        roles_permissions: null,
        versioning_policy: null,
        metadata: null,
        createdBy: 'usr_owner_1',
        createdAt: '2026-10-12T10:00:00.000Z',
      }),
    });
  });

  await page.route('**/api/connectors/requests', (route: Route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'conn_r1',
              name: 'Leave Requests',
              destination: 'docstore.internal',
              method: 'POST',
              url: '/api/internal/docstore/leave-requests',
              auth: 'm2m',
            },
          ],
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

/** Fill the wizard to completion and return the PATCH bodies. */
async function completeWizard(page: Page): Promise<
  Array<{ url: string; body: Record<string, unknown> }>
> {
  const patches: Array<{ url: string; body: Record<string, unknown> }> = [];
  await stubBuilderApi(page, {
    onPatch: (url, body) => patches.push({ url, body }),
  });

  await page.goto('#/wizard');
  await expect(page.getByTestId('wizard-page')).toBeVisible();

  // Step 0: Basics
  await page.getByTestId('wizard-name').fill('HR Leave Request');
  await page.getByTestId('wizard-app-id').fill('hr-leave-request');
  await page.getByTestId('wizard-description').fill('Submit leave requests');
  await page.getByTestId('wizard-next-button').click();

  await expect(page.getByTestId('toast')).toBeVisible();
  await expect(page.getByTestId('toast')).toContainText(DRAFT_TOAST);

  // Step 1: Triggers
  await page.getByTestId('trigger-kind-intent').first().click();
  await page.getByTestId('trigger-intent-input').first().fill('request_leave');
  await page.getByTestId('trigger-example-input').first().fill('I want to take leave');
  await page.getByTestId('wizard-next-button').click();

  // Step 2: RBAC
  await page.getByTestId('rbac-user').fill('manager@example.com');
  await page.getByTestId('rbac-role-manager').check();
  await page.getByTestId('rbac-add').click();
  await page.getByTestId('wizard-next-button').click();

  // Step 3: Form (nothing required)
  await page.getByTestId('wizard-next-button').click();

  // Step 4: Routing
  await page.getByTestId('wizard-next-button').click();

  return patches;
}

test('the wizard walks all steps and PATCHes each section in order (BLD-01)', async ({
  page,
}) => {
  const patches = await completeWizard(page);

  expect(patches).toHaveLength(4);
  for (const patch of patches) {
    expect(patch.url).toContain('/api/apps/hr-leave-request');
  }
  const sections = patches.map((patch) => patch.body.section);
  expect(sections).toEqual([
    'forms',
    'role-assignments',
    'metadata',
    'data-routing',
  ]);
  expect(patches[0].body.patch).toMatchObject({
    forms: [
      {
        kind: 'submit',
        triggers: {
          intents: ['request_leave'],
          aliases: [],
          threshold: 0.5,
        },
      },
    ],
  });
  expect(patches[1].body.patch).toMatchObject({
    role_assignments: {
      assignments: [
        { user: 'manager@example.com', role: 'manager' },
      ],
    },
  });
  expect(patches[2].body.patch).toMatchObject({
    data_mode: 'internal',
  });
  expect(patches[3].body.patch).toMatchObject({
    routing_config: {
      data_mode: 'internal',
    },
  });

  await expect(page.getByTestId('wizard-complete')).toBeVisible();
  await expect(page.getByTestId('wizard-complete-app-id')).toContainText(
    'hr-leave-request',
  );
});
