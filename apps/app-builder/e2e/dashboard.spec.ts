/**
 * The dashboard spec (D-112, OBS-05,
 * BLD-09, BLD-07).
 *
 * The dashboard is the phase's
 * read-only home surface, and every
 * invariant here is a plan prohibition
 * turned into an assertion:
 *
 * 1. **Exactly two live widgets**
 *    (D-112): recent submissions and
 *    recent audit activity. The
 *    submissions widget reads the same
 *    `GET /submissions` projection the
 *    viewer lists (no separate dashboard
 *    data source), and the activity
 *    widget reads `GET /audit`. The spec
 *    records the requests the page fired
 *    and asserts both endpoints were read
 *    — OBS-05's "no static or fake
 *    dashboard data" is proven by the
 *    network trace, not by the rendered
 *    rows alone.
 * 2. **No connector-health card**
 *    (D-112): the widget set is exactly
 *    the two live widgets — the held-back
 *    card is absent until a real
 *    health-check job exists, and its
 *    absence is the correct shipped state.
 * 3. **Skeleton-then-data** (BLD-09):
 *    each widget renders its layout-shaped
 *    skeleton while its read is in flight,
 *    then the data — the stubs delay their
 *    fulfillment so the skeleton state is
 *    observable.
 * 4. **Widget isolation** (BLD-07): a
 *    failed audit read renders an inline,
 *    specific error **naming the widget**
 *    ("load recent audit activity") in the
 *    activity slot only — the submissions
 *    widget beside it keeps rendering from
 *    its own successful read.
 *
 * The API is stubbed through `page.route`
 * (the plan-07 mechanism) — no real API
 * server is needed for the SPA surface.
 */

import {
  expect,
  test,
  type Page,
  type Route,
} from '@playwright/test';

/** The owner's apps the dashboard merges submissions across. */
const APPS = [
  {
    app_id: 'hr-leave-request',
    name: 'Leave Request',
    description: 'Request and approve leave',
    data_mode: 'external',
    lifecycle: 'published',
    version: 3,
    tags: ['time-off', 'hr'],
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
    createdAt: '2026-10-12T08:00:00.000Z',
  },
  {
    app_id: 'travel-request',
    name: 'Travel Request',
    description: 'Request travel approval',
    data_mode: 'internal',
    lifecycle: 'draft',
    version: 1,
    tags: ['travel'],
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
    createdAt: '2026-10-12T09:00:00.000Z',
  },
];

/** The projected viewer rows each app's submissions read answers with. */
const SUBMISSIONS: Record<string, Array<Record<string, unknown>>> = {
  'hr-leave-request': [
    {
      submission_id: 'sub_0003',
      app_id: 'hr-leave-request',
      form_id: 'leave-form',
      status: 'completed',
      submitted_at: '2026-10-12T11:00:00.000Z',
      downstream_reference: 'RM-9001',
      reason: null,
    },
    {
      submission_id: 'sub_0002',
      app_id: 'hr-leave-request',
      form_id: 'leave-form',
      status: 'completed',
      submitted_at: '2026-10-12T10:00:00.000Z',
      downstream_reference: null,
      reason: null,
    },
    {
      submission_id: 'sub_0001',
      app_id: 'hr-leave-request',
      form_id: 'leave-form',
      status: 'failed',
      submitted_at: '2026-10-12T09:00:00.000Z',
      downstream_reference: null,
      reason: 'delivery refused downstream',
    },
  ],
  'travel-request': [
    {
      submission_id: 'sub_0005',
      app_id: 'travel-request',
      form_id: 'travel-form',
      status: 'completed',
      submitted_at: '2026-10-12T12:00:00.000Z',
      downstream_reference: null,
      reason: null,
    },
    {
      submission_id: 'sub_0004',
      app_id: 'travel-request',
      form_id: 'travel-form',
      status: 'partial',
      submitted_at: '2026-10-12T09:30:00.000Z',
      downstream_reference: null,
      reason: 'external leg pending',
    },
  ],
};

/** The newest-first AUD-01 stream the activity widget reads. */
const AUDIT_ENTRIES = [
  {
    timestamp: '2026-10-12T10:30:00.000Z',
    actor: 'usr_owner_1',
    action: 'app.definition_updated',
    target: 'leave-request',
    previous_state: 'v2',
    new_state: 'v3',
  },
  {
    timestamp: '2026-10-12T09:00:00.000Z',
    actor: 'operator',
    action: 'connector_request.provisioned',
    target: 'leave-request',
    previous_state: 'pending',
    new_state: 'provisioned',
    request_id: 'req_01HF3Y2',
  },
  {
    timestamp: '2026-10-12T08:00:00.000Z',
    actor: 'usr_owner_1',
    action: 'app.definition_created',
    target: 'travel-request',
  },
];

/** Every request URL the stubbed API served, per test. */
let servedUrls: string[] = [];

/**
 * Delay a stub's fulfillment so the
 * skeleton-then-data transition is
 * observable (BLD-09): the in-flight
 * state outlives the test's first
 * assertions.
 */
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Stub the builder API the dashboard touches.
 * Every fulfillment is delayed so the
 * skeleton-then-data transition is
 * observable (BLD-09).
 */
async function stubDashboardApi(
  page: Page,
  options: { auditFails?: boolean } = {},
): Promise<void> {
  servedUrls = [];

  await page.route('**/api/auth/me', async (route: Route) => {
    await delay(500);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        real_user_id: 'usr_owner_1',
        mfa_at: '2026-10-12T10:00:00.000Z',
      }),
    });
  });

  // The owner's app list — the merge source
  // for the recent-submissions widget.
  await page.route('**/api/apps', async (route: Route) => {
    servedUrls.push(route.request().url());
    await delay(500);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ apps: APPS }),
    });
  });

  // The submissions viewer's list endpoint —
  // the same projection the submissions page
  // lists (no separate dashboard source). The
  // stub matches the API surface only (the
  // request path starts with /api/submissions):
  // the dev server also serves the SPA's own
  // /src/api/submissions.ts module, which a
  // glob would answer with JSON — a MIME-type
  // load error that blanks the app.
  await page.route(
    (url: URL) =>
      url.pathname.startsWith('/api/submissions'),
    async (route: Route) => {
      const url = new URL(route.request().url());
      servedUrls.push(url.pathname);
      await delay(500);
      const appId = url.searchParams.get('app_id') ?? '';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          submissions: SUBMISSIONS[appId] ?? [],
        }),
      });
    },
  );

  // The audit browse endpoint — the
  // recent-activity widget's live source.
  // API-surface-only for the same reason as
  // the submissions stub above (the SPA serves
  // its own /src/api/audit.ts module).
  await page.route(
    (url: URL) => url.pathname.startsWith('/api/audit'),
    async (route: Route) => {
      servedUrls.push(route.request().url());
      await delay(500);
      if (options.auditFails) {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'audit store unavailable',
          },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entries: AUDIT_ENTRIES,
        total: AUDIT_ENTRIES.length,
        limit: 20,
        offset: 0,
      }),
    });
  });
}

test.describe('dashboard (D-112, OBS-05)', () => {
  test.beforeEach(() => {
    servedUrls = [];
  });

  test('renders exactly two live widgets — recent submissions and recent audit activity — from live reads, skeleton-then-data', async ({
    page,
  }) => {
    await stubDashboardApi(page);
    await page.goto('/#/dashboard');

    // Skeleton-then-data (BLD-09): every read
    // is delayed, so the layout-shaped
    // skeleton state is observable before any
    // data renders — the session boot's
    // skeleton first, then each widget's own
    // skeleton while its read is in flight.
    await expect(
      page.getByTestId('session-boot'),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByTestId('recent-submissions')
        .getByTestId('skeleton')
        .first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByTestId('recent-activity')
        .getByTestId('skeleton')
        .first(),
    ).toBeVisible({ timeout: 20_000 });

    // The submissions widget lists the merged,
    // most-recent-first projection of both
    // apps' submissions — the newest
    // (travel's sub_0005, 12:00) first.
    // The data rows render only after the
    // (delayed) reads land, so their
    // visibility proves the reads fired.
    const submissionsWidget = page.getByTestId(
      'recent-submissions',
    );
    const rows = submissionsWidget.getByTestId(
      /^submission-row-/,
    );
    await expect(rows).toHaveCount(5);
    await expect(
      submissionsWidget.getByTestId('submission-row-sub_0005'),
    ).toBeVisible();
    // Most recent first: the newest row is the
    // first row of the widget's table.
    const firstRow = submissionsWidget
      .locator('tbody tr')
      .first();
    await expect(firstRow).toHaveText(/sub_0005/);

    // Both live reads fired — OBS-05's
    // "no static or fake dashboard data"
    // proven by the network trace.
    expect(
      servedUrls.filter((url) =>
        url.includes('/api/submissions'),
      ),
    ).not.toHaveLength(0);
    expect(
      servedUrls.filter((url) => url.includes('/api/audit')),
    ).not.toHaveLength(0);

    // The activity widget lists the newest
    // AUD-01 entries — the definition update
    // (10:30) first.
    const activityWidget = page.getByTestId(
      'recent-activity',
    );
    await expect(activityWidget).toBeVisible();
    await expect(
      activityWidget.getByTestId('activity-row-0'),
    ).toContainText('app.definition_updated');
    await expect(
      activityWidget.getByTestId('activity-row-1'),
    ).toContainText('connector_request.provisioned');
    await expect(
      activityWidget.getByTestId('activity-row-2'),
    ).toContainText('app.definition_created');
  });

  test('renders no connector-health card — the widget set is exactly the two live widgets (D-112)', async ({
    page,
  }) => {
    await stubDashboardApi(page);
    await page.goto('/#/dashboard');

    await expect(
      page.getByTestId('recent-submissions'),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByTestId('recent-activity'),
    ).toBeVisible();

    // The held-back card is absent — its
    // absence is the correct shipped state
    // until a real health-check job exists.
    await expect(page.getByTestId('connector-health')).toHaveCount(
      0,
    );
    await expect(
      page.getByText('Connector health', { exact: false }),
    ).toHaveCount(0);
  });

  test('each widget shows its skeleton while loading and an inline error naming the widget on failure', async ({
    page,
  }) => {
    // The audit read fails; the submissions
    // read succeeds — widget isolation is the
    // assertion.
    await stubDashboardApi(page, { auditFails: true });
    await page.goto('/#/dashboard');

    // Each widget renders its layout-shaped
    // skeleton while its read is in flight
    // (BLD-09) — including the widget whose
    // read will fail: the error replaces the
    // skeleton, never a blank.
    await expect(
      page.getByTestId('recent-submissions')
        .getByTestId('skeleton')
        .first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByTestId('recent-activity')
        .getByTestId('skeleton')
        .first(),
    ).toBeVisible({ timeout: 20_000 });

    // The submissions widget rendered from its
    // live read — the failure beside it did not
    // blank the dashboard.
    await expect(
      page.getByTestId('recent-submissions'),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByTestId('submission-row-sub_0005'),
    ).toBeVisible();

    // The failed activity read renders an
    // inline, specific error naming the widget
    // (BLD-07) — in the activity slot only.
    const activityWidget = page.getByTestId(
      'recent-activity',
    );
    const error = activityWidget.getByTestId('inline-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText(
      'load recent audit activity',
    );
    await expect(error).toContainText(
      'audit store unavailable',
    );
    // The failure is not a whole-page error.
    await expect(
      page.getByTestId('recent-submissions').getByTestId('inline-error'),
    ).toHaveCount(0);
  });
});
