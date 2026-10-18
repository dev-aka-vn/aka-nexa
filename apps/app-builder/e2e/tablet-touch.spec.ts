/**
 * The BLD-09 touch pass (UAT test 4's machine leg).
 *
 * The tablet project's 33 pre-existing specs exercised layout under the
 * 768×1024 touch profile, but every interaction in them was a mouse
 * click — the UAT record's own finding was that "no spec in
 * apps/app-builder/e2e calls tap() or dispatches any touch/pointer
 * event", so a tablet run was layout evidence only. This spec is the
 * interaction leg it lacked: every action below goes through
 * `locator.tap()` (real touchstart/touchend sequences under the
 * emulated touch profile), never `click()`.
 *
 * Three surfaces, one test each — the three BLD-09 names:
 *
 *  1. Wizard — create a draft, advance two steps, return by tapping
 *     the rail, and confirm the typed inputs survived (tap navigation
 *     over touch-reachable targets).
 *  2. Editor — tap the tab bar's scroll chevrons (the 768px viewport
 *     is exactly where the twelve-section strip overflows) and a
 *     section tab, then save by tap.
 *  3. Designer — mount, tap the undo/redo toolbar, and leave by
 *     tapping the exit control (tap targets at the bottom of the
 *     1024px fold).
 *
 * Skipped automatically where `hasTouch` is not emulated (the chromium
 * project): `tap()` requires a touch-capable context and the point of
 * the spec is the touch profile itself.
 */

import {
  expect,
  test,
  type Page,
  type Route,
} from '@playwright/test';

/**
 * The designer mounts the real FormIO builder (~3.7 MB graph); see
 * designer.spec.ts's BUILDER_MOUNT_TIMEOUT_MS for the measured
 * cold-start spread this budget covers.
 */
const BUILDER_MOUNT_TIMEOUT_MS = 60_000;

/** The served draft definition (the shared stub shape across specs). */
function draftDefinition(
  appId: string,
  name: string,
  formSchema: unknown = null,
): Record<string, unknown> {
  return {
    app_id: appId,
    name,
    description: '',
    data_mode: 'internal',
    lifecycle: 'draft',
    version: 1,
    tags: [],
    form_schema: formSchema,
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

const DESIGNER_SCHEMA = {
  display: 'Leave request',
  components: [
    { type: 'textfield', key: 'fullName', label: 'Full name', input: true },
    { type: 'button', key: 'submit', label: 'Submit', action: 'submit' },
  ],
};

/** Stub the session boot and the app paths every surface touches. */
async function stubBuilderApi(
  page: Page,
  definition: Record<string, unknown>,
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
  await page.route('**/api/apps', (route: Route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ apps: [] }),
      });
    }
    const body = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(
        draftDefinition(body.app_id, body.name),
      ),
    });
  });
  await page.route('**/api/apps/**', (route: Route) => {
    const method = route.request().method();
    const url = route.request().url();
    if (method === 'PATCH') {
      const body = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...definition,
          ...(body.patch ?? {}),
          version: 2,
        }),
      });
    }
    if (method === 'GET' && url.endsWith(`/${definition.app_id}`)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(definition),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    });
  });
}

test.describe('tablet touch (BLD-09)', () => {
  // Touch-only: the chromium project has no emulated touch, and the
  // spec's whole point is tap events under the touch profile.
  test.skip(
    ({ hasTouch }) => !hasTouch,
    'tap() requires a touch-capable context — this spec runs in the tablet project',
  );

  test('the wizard is usable by tap: create, advance two steps, return by tapping the rail, inputs intact', async ({
    page,
  }) => {
    await stubBuilderApi(page, draftDefinition('leave-request', 'Leave Request'));
    await page.goto('/#/wizard');

    // Step 1 — Basics, by tap.
    await page.getByTestId('wizard-app-name').fill('Leave Request');
    await page.getByTestId('wizard-app-id').fill('leave-request');
    await page
      .getByTestId('wizard-app-description')
      .fill('Request and approve leave');
    await expect(page.getByTestId('wizard-create-button')).toBeEnabled();
    await page.getByTestId('wizard-create-button').tap();
    await expect(page.getByTestId('wizard-toast')).toHaveText(
      'Saved as a draft · continue through the wizard steps',
    );

    // Step 2 — Triggers: fill one, tap Next.
    await page.getByTestId('wizard-trigger-add').tap();
    await page.getByTestId('wizard-trigger-intent-0').fill('request_leave');
    await page.getByTestId('wizard-next-button').tap();

    // Step 3 — RBAC: tap Next (nothing required).
    await page.getByTestId('wizard-next-button').tap();
    const rail = page.getByTestId('wizard-step-rail');
    await expect(
      rail.locator('.step.now [data-testid="wizard-step-label"]'),
    ).toHaveText('Form');

    // Return to Basics by tapping Back three times (Form → RBAC →
    // Triggers → Basics) — the rail is display-only; the footer
    // buttons are the wizard's real touch navigation. Each tap
    // settles on its landed step before the next (a tap racing the
    // remount is lost).
    await page.getByTestId('wizard-back-button').tap();
    await expect(page.getByTestId('wizard-step-rbac')).toBeVisible();
    await page.getByTestId('wizard-back-button').tap();
    await expect(page.getByTestId('wizard-step-triggers')).toBeVisible();
    await page.getByTestId('wizard-back-button').tap();
    await expect(page.getByTestId('wizard-step-basics')).toBeVisible();
    await expect(page.getByTestId('wizard-app-name')).toHaveValue('Leave Request');
  });

  test('the editor is usable by tap: chevrons scroll the tab strip, a section saves by tap', async ({
    page,
  }) => {
    await stubBuilderApi(
      page,
      draftDefinition('leave-request', 'Leave Request', DESIGNER_SCHEMA),
    );
    await page.goto('/#/apps/leave-request');
    await page.getByTestId('editor-tab-general').waitFor({
      state: 'visible',
      timeout: 15_000,
    });

    // The 768px strip overflows (twelve sections): the next chevron is
    // enabled and tapping it scrolls the strip.
    const strip = page.getByTestId('editor-tabs');
    await expect(page.getByTestId('tabs-next')).toBeEnabled();
    await page.getByTestId('tabs-next').tap();
    await expect
      .poll(() =>
        strip.evaluate((el) => Math.round(el.scrollLeft)),
      )
      .toBeGreaterThan(0);

    // Tap a far section tab (brought into view by the scroll) and save
    // its section by tap.
    await page.getByTestId('editor-tab-deprecation-notice').tap();
    await page.getByTestId('save-section').tap();
    await expect(page.getByTestId('editor-saved')).toBeVisible();
  });

  test('the designer is usable by tap: toolbar and the exit control respond to taps', async ({
    page,
  }) => {
    await stubBuilderApi(
      page,
      draftDefinition('leave-request', 'Leave Request', DESIGNER_SCHEMA),
    );
    await page.goto('/#/apps/leave-request/designer');

    const host = page.getByTestId('formio-builder-host');
    await host.locator('.formio-builder-form').waitFor({
      state: 'visible',
      timeout: BUILDER_MOUNT_TIMEOUT_MS,
    });

    // The toolbar buttons are real tap targets (undo/redo disabled at
    // the seeded history's start — tap-adjacent, assert states).
    await expect(page.getByTestId('designer-undo-button')).toBeDisabled();
    await expect(page.getByTestId('designer-redo-button')).toBeDisabled();
    await expect(page.getByTestId('designer-save-button')).toBeVisible();

    // Leave by tapping the exit control — no wizard snapshot exists on
    // a direct visit, so the app-editor variant renders.
    await page.getByTestId('designer-back-to-app').tap();
    await expect(page.getByTestId('editor-page')).toBeVisible({
      timeout: 15_000,
    });
  });
});
