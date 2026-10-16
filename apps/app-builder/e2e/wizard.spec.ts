/**
 * The create-wizard spec (BLD-01).
 *
 * A non-developer reaches a working app through the
 * five-step wizard — Basics → Triggers → RBAC →
 * Form → Routing — with no documentation. The spec
 * runs against a stubbed builder API (the frozen
 * plan-04/05/06 contracts) and proves:
 *
 *  1. An unauthenticated boot redirects the browser
 *     to the OIDC begin endpoint (the session is
 *     the only gate, D-101).
 *  2. The wizard renders exactly five steps in the
 *     locked order, and forward navigation is
 *     blocked until the step's required fields pass
 *     inline validation.
 *  3. Step 1's "Create app" POSTs /apps, receives
 *     the draft, toasts the mockup's exact copy —
 *     "Saved as a draft · continue through the
 *     wizard steps" — and the wizard continues
 *     editing the same draft through steps 2-5
 *     (PATCH /apps/:id per section).
 *  4. `app_id` validates inline as
 *     lowercase-hyphenated on blur, and the
 *     immutable-after-first-publish rule is stated
 *     in the helper text.
 *
 * The tablet project (768×1024, touch) runs this
 * same spec (BLD-09).
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

/** The locked wizard order (Basics → Triggers → RBAC → Form → Routing). */
const STEP_NAMES = [
  'basics',
  'triggers',
  'rbac',
  'form',
  'routing',
] as const;
const STEP_LABELS = [
  'Basics',
  'Triggers',
  'RBAC',
  'Form',
  'Routing',
];

/** The served draft definition the stubbed POST /apps answers with. */
function draftDefinition(
  appId: string,
  name: string,
): Record<string, unknown> {
  return {
    app_id: appId,
    name,
    description: '',
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
    role_assignments: null,
    roles_permissions: null,
    versioning_policy: null,
    metadata: null,
    createdBy: 'usr_owner_1',
    createdAt: '2026-10-12T10:00:00.000Z',
  };
}

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
    if (method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ apps: [] }),
      });
    }
    const body = route.request().postDataJSON();
    hooks.onPostApps?.(body);
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(
        draftDefinition(body.app_id, body.name),
      ),
    });
  });

  // Every deeper app path: the per-section PATCHes
  // (steps 2-5) and the connector-request list
  // (step 5). `**` spans the multi-segment
  // paths (`/apps/:id/connector-requests`).
  await page.route('**/api/apps/**', async (route: Route) => {
    const method = route.request().method();
    const url = route.request().url();
    if (method === 'PATCH') {
      const body = route.request().postDataJSON();
      hooks.onPatch?.(url, body);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...draftDefinition('hr-leave-request', 'Leave Request'),
          ...(body.patch ?? {}),
          version: 2,
        }),
      });
    }
    if (method === 'GET') {
      hooks.onGet?.(url);
      if (url.includes('/connector-requests')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            requests: [
              {
                request_id: 'cr_1',
                app_id: 'hr-leave-request',
                requested_by: 'usr_owner_1',
                connector_id: 'redmine',
                name: 'Redmine',
                base_url: 'https://redmine.example',
                state: 'provisioned',
                requested_at: '2026-10-12T10:00:00.000Z',
              },
            ],
          }),
        });
      }
      // A single-app read (`GET /apps/:id`) — the
      // served draft definition. The designer's
      // load and the wizard's resume-after-detour
      // both ride this leg; anything deeper still
      // falls through to the empty object.
      const appPath = new URL(url).pathname.split('/api/apps/')[1] ?? '';
      if (appPath.length > 0 && !appPath.includes('/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            draftDefinition(decodeURIComponent(appPath), 'Leave Request'),
          ),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    }
    if (url.includes('/connector-requests')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          requests: [
            {
              request_id: 'cr_1',
              app_id: 'hr-leave-request',
              requested_by: 'usr_owner_1',
              connector_id: 'redmine',
              name: 'Redmine',
              base_url: 'https://redmine.example',
              state: 'provisioned',
              requested_at: '2026-10-12T10:00:00.000Z',
            },
          ],
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });
}

/** Fill step 1 (Basics) with a valid draft triple. */
async function fillBasics(page: Page): Promise<void> {
  await page.getByTestId('wizard-app-name').fill('Leave Request');
  await page.getByTestId('wizard-app-id').fill('hr-leave-request');
  await page
    .getByTestId('wizard-app-description')
    .fill('Request and approve leave');
}

/** Walk steps 2-5 on the created draft, filling each step's minimum. */
async function completeWizard(page: Page): Promise<void> {
  // Step 2 — Triggers: one intent with an example phrase.
  await page.getByTestId('wizard-trigger-add').click();
  await page
    .getByTestId('wizard-trigger-intent-0')
    .fill('request_leave');
  await page
    .getByTestId('wizard-trigger-example-0')
    .fill('I want to take leave');
  await page.getByTestId('wizard-next-button').click();

  // Step 3 — RBAC: one initial assignment.
  await page.getByTestId('wizard-assignment-add').click();
  await page
    .getByTestId('wizard-assignment-user-0')
    .fill('manager@example.com');
  await page
    .getByTestId('wizard-assignment-role-0')
    .selectOption('manager');
  await page.getByTestId('wizard-next-button').click();

  // Step 4 — Form: the designer link; nothing required.
  await page.getByTestId('wizard-next-button').click();

  // Step 5 — Routing: internal mode is preselected; finish.
  await page.getByTestId('wizard-finish-button').click();

  // The completion panel renders only after both
  // finish PATCHes (metadata + data-routing) have
  // landed — waiting for it makes the patch
  // assertions below deterministic.
  await expect(page.getByTestId('wizard-complete')).toBeVisible();
}

test.describe('create wizard (BLD-01)', () => {
  test('an unauthenticated SPA boot redirects to the OIDC begin endpoint', async ({
    page,
  }) => {
    await page.route('**/api/auth/me', (route: Route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'SESSION_MISSING' }),
      }),
    );
    // The begin endpoint itself would 302 to the IdP;
    // the stub only proves the browser was redirected.
    await page.route('**/api/auth/oidc/begin', (route: Route) =>
      route.fulfill({ status: 200, body: 'oidc' }),
    );

    await page.goto('/');

    await expect(page).toHaveURL(/\/api\/auth\/oidc\/begin/);
  });

  test('the wizard renders exactly five steps in order and blocks forward navigation until step 1 validates', async ({
    page,
  }) => {
    await stubBuilderApi(page);
    await page.goto('/#/wizard');

    // Exactly five steps, in the locked order.
    const rail = page.getByTestId('wizard-step-rail');
    await expect(rail).toBeVisible();
    const names = await rail
      .locator('[data-testid="wizard-step"]')
      .evaluateAll(
        (els) =>
          els.map((el) => el.getAttribute('data-step-name')),
      );
    expect(names).toEqual(STEP_NAMES);
    const labels = await rail
      .locator('[data-testid="wizard-step-label"]')
      .allTextContents();
    expect(labels).toEqual(STEP_LABELS);

    // Forward navigation is blocked until the step's
    // required fields pass inline validation.
    const primary = page.getByTestId('wizard-create-button');
    await expect(primary).toBeDisabled();

    await page.getByTestId('wizard-app-name').fill('Leave Request');
    await expect(primary).toBeDisabled(); // app_id + description still missing

    await page
      .getByTestId('wizard-app-id')
      .fill('hr-leave-request');
    await expect(primary).toBeDisabled(); // description still missing

    await page
      .getByTestId('wizard-app-description')
      .fill('Request and approve leave');
    await expect(primary).toBeEnabled();
  });

  test('app_id validates inline as lowercase-hyphenated on blur, and the helper states the immutability rule', async ({
    page,
  }) => {
    await stubBuilderApi(page);
    await page.goto('/#/wizard');

    const appId = page.getByTestId('wizard-app-id');
    await appId.fill('HR_Leave');
    await appId.blur();
    await expect(
      page.getByTestId('wizard-app-id-error'),
    ).toHaveText(/lowercase-hyphenated/);

    // The helper states the immutable-after-first-publish rule.
    await expect(
      page.getByTestId('wizard-app-id-helper'),
    ).toHaveText(/Immutable after first publish/);

    // A conforming id clears the inline error on blur.
    await appId.fill('hr-leave-request');
    await appId.blur();
    await expect(
      page.getByTestId('wizard-app-id-error'),
    ).toHaveCount(0);
  });

  test('Create app POSTs /apps, toasts the draft copy verbatim, and continues editing the same draft through steps 2-5', async ({
    page,
  }) => {
    const posts: Array<Record<string, unknown>> = [];
    const patches: Array<{
      url: string;
      body: Record<string, unknown>;
    }> = [];
    await stubBuilderApi(page, {
      onPostApps: (body) => posts.push(body),
      onPatch: (url, body) => patches.push({ url, body }),
    });
    await page.goto('/#/wizard');

    await fillBasics(page);
    await page.getByTestId('wizard-create-button').click();

    // The mockup's exact toast copy, verbatim.
    await expect(page.getByTestId('wizard-toast')).toHaveText(
      DRAFT_TOAST,
    );

    // Step 1 created the draft with the wizard's payload.
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      name: 'Leave Request',
      app_id: 'hr-leave-request',
      description: 'Request and approve leave',
    });

    // The wizard continues on the same draft through
    // steps 2-5, each section PATCHed against the
    // draft's app_id.
    await completeWizard(page);

    expect(patches).toHaveLength(4);
    for (const patch of patches) {
      expect(patch.url).toContain('/api/apps/hr-leave-request');
    }
    const sections = patches.map(
      (patch) => patch.body.section,
    );
    expect(sections).toEqual([
      'triggers',
      'role-assignments',
      'metadata',
      'data-routing',
    ]);
    expect(patches[0].body.patch).toMatchObject({
      triggers: [
        {
          type: 'intent',
          intent: 'request_leave',
          examples: ['I want to take leave'],
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

    // The wizard completes: a completion panel names
    // the created app and offers the editor.
    await expect(
      page.getByTestId('wizard-complete'),
    ).toBeVisible();
    await expect(
      page.getByTestId('wizard-complete-app-id'),
    ).toHaveText('hr-leave-request');
  });

  test('step 5 requires a connector when the data mode is external', async ({
    page,
  }) => {
    const patches: Array<Record<string, unknown>> = [];
    await stubBuilderApi(page, {
      onPatch: (_url, body) => patches.push(body),
    });
    await page.goto('/#/wizard');

    await fillBasics(page);
    await page.getByTestId('wizard-create-button').click();
    await expect(page.getByTestId('wizard-toast')).toHaveText(
      DRAFT_TOAST,
    );

    // Walk to step 5.
    await page.getByTestId('wizard-next-button').click(); // → triggers (empty is valid)
    await page.getByTestId('wizard-next-button').click(); // → rbac (empty is valid)
    await page.getByTestId('wizard-next-button').click(); // → form

    // Choose external: the connector select becomes
    // required and forward navigation is blocked.
    await page.getByTestId('wizard-mode-external').click();
    const finish = page.getByTestId('wizard-finish-button');
    await expect(finish).toBeDisabled();

    // Pick the provisioned connector: unblocked.
    await page
      .getByTestId('wizard-connector-select')
      .selectOption('redmine');
    await expect(finish).toBeEnabled();
    await finish.click();

    // Both finish PATCHes have landed once the
    // completion panel renders.
    await expect(page.getByTestId('wizard-complete')).toBeVisible();

    expect(patches).toHaveLength(2);
    expect(patches[0].patch).toMatchObject({
      data_mode: 'external',
    });
    expect(patches[1].patch).toMatchObject({
      routing_config: {
        data_mode: 'external',
        connector_id: 'redmine',
      },
    });
  });

  test('the wizard survives a designer detour: leave step 4, design, return to the same step with the same inputs', async ({
    page,
  }) => {
    await stubBuilderApi(page);
    await page.goto('/#/wizard');

    await fillBasics(page);
    await page.getByTestId('wizard-create-button').click();
    await expect(page.getByTestId('wizard-toast')).toHaveText(
      DRAFT_TOAST,
    );

    // Walk to step 4 with distinctive inputs on
    // each of the content steps.
    await page.getByTestId('wizard-trigger-add').click();
    await page
      .getByTestId('wizard-trigger-intent-0')
      .fill('request_leave');
    await page
      .getByTestId('wizard-trigger-example-0')
      .fill('I want to take leave');
    await page.getByTestId('wizard-next-button').click();

    await page.getByTestId('wizard-assignment-add').click();
    await page
      .getByTestId('wizard-assignment-user-0')
      .fill('manager@example.com');
    await page
      .getByTestId('wizard-assignment-role-0')
      .selectOption('manager');
    await page.getByTestId('wizard-next-button').click();

    // Step 4 — the rail's current step is Form.
    const rail = page.getByTestId('wizard-step-rail');
    const currentLabel = rail.locator(
      '.step.now [data-testid="wizard-step-label"]',
    );
    await expect(currentLabel).toHaveText('Form');

    // The outbound leg: the designer renders and
    // offers the return control.
    await page.getByTestId('wizard-open-designer').click();
    await expect(page.getByTestId('designer-page')).toBeVisible();
    const backToWizard = page.getByTestId(
      'designer-back-to-wizard',
    );
    await expect(backToWizard).toBeVisible();
    await backToWizard.click();

    // The return leg lands back on the Form step —
    // the rail's current step is still Form, and
    // the route carries the resumed position. A
    // return that lands on a fresh wizard at
    // Basics fails both assertions.
    await expect(page.getByTestId('wizard-page')).toBeVisible();
    await expect(currentLabel).toHaveText('Form');
    await expect(page).toHaveURL(
      /#\/wizard\?app=hr-leave-request&step=3/,
    );

    // Stepping back shows the earlier steps'
    // inputs still holding the values typed
    // before the detour.
    await page.getByTestId('wizard-back-button').click();
    await expect(currentLabel).toHaveText('RBAC');
    await expect(
      page.getByTestId('wizard-assignment-user-0'),
    ).toHaveValue('manager@example.com');

    await page.getByTestId('wizard-back-button').click();
    await expect(currentLabel).toHaveText('Triggers');
    await expect(
      page.getByTestId('wizard-trigger-intent-0'),
    ).toHaveValue('request_leave');
    await expect(
      page.getByTestId('wizard-trigger-example-0'),
    ).toHaveValue('I want to take leave');

    await page.getByTestId('wizard-back-button').click();
    await expect(currentLabel).toHaveText('Basics');
    await expect(page.getByTestId('wizard-app-name')).toHaveValue(
      'Leave Request',
    );
  });
});
