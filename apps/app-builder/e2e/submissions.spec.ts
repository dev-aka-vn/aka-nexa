/**
 * The submissions viewer spec (BLD-08,
 * D-111, BLD-07, BLD-09).
 *
 * The viewer is the owner's read surface
 * over one app's submissions:
 *
 * 1. **Filter composition** — the status
 *    chips, the date range, and the form
 *    select compose against plan 06's
 *    query parameters (`status`, `from`,
 *    `to`, `form` — `app_id` rides the
 *    route). Every filter change refetches
 *    `GET /submissions` with the full
 *    composed set, and the stub's own
 *    filtering proves the composition
 *    end-to-end: the rows the page renders
 *    are the rows the API returns for the
 *    composed filter.
 * 2. **The detail drawer** — a row opens
 *    the drawer, which reads `GET
 *    /submissions/:id` and renders the
 *    same projected row (D-111: the list,
 *    the detail, and the export share one
 *    projection).
 * 3. **The export** — the export button
 *    requests `GET /submissions/export`
 *    with the **current** filters (the
 *    same composed set) and downloads the
 *    visible-column CSV (D-111: the export
 *    projects through the allowlist before
 *    serialization, so no field outside it
 *    can appear in a row).
 *
 * The API is stubbed through `page.route`
 * (the plan-07 mechanism) with
 * API-surface-only predicates — the dev
 * server also serves the SPA's own
 * `/src/api/submissions.ts` module, and a
 * glob would answer a module script with
 * JSON (a MIME-type load error that
 * blanks the app).
 */

import {
  expect,
  test,
  type Page,
  type Route,
} from '@playwright/test';

import {
  readFileSync,
} from 'node:fs';

/** The app the viewer is scoped to. */
const APP_ID = 'hr-leave-request';

/** The served definition the app header renders. */
function definition(): Record<string, unknown> {
  return {
    app_id: APP_ID,
    name: 'Leave Request',
    description: 'Request and approve leave',
    data_mode: 'external',
    lifecycle: 'draft',
    version: 1,
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
    createdAt: '2026-10-12T10:00:00.000Z',
  };
}

/**
 * The viewer's rows — the projected
 * visible columns, spanning every status
 * the filter chips offer.
 */
const ROWS = [
  {
    submission_id: 'sub_0001',
    app_id: APP_ID,
    form_id: 'leave-form',
    status: 'failed',
    submitted_at: '2026-10-12T09:00:00.000Z',
    downstream_reference: null,
    reason: 'delivery refused downstream',
  },
  {
    submission_id: 'sub_0002',
    app_id: APP_ID,
    form_id: 'leave-form',
    status: 'completed',
    submitted_at: '2026-10-12T10:00:00.000Z',
    downstream_reference: null,
    reason: null,
  },
  {
    submission_id: 'sub_0003',
    app_id: APP_ID,
    form_id: 'leave-form',
    status: 'completed',
    submitted_at: '2026-10-12T11:00:00.000Z',
    downstream_reference: 'RM-9001',
    reason: null,
  },
  {
    submission_id: 'sub_0004',
    app_id: APP_ID,
    form_id: 'leave-form',
    status: 'partial',
    submitted_at: '2026-10-12T09:30:00.000Z',
    downstream_reference: null,
    reason: 'external leg pending',
  },
  {
    submission_id: 'sub_0005',
    app_id: APP_ID,
    form_id: 'leave-form',
    status: 'completed',
    submitted_at: '2026-10-12T12:00:00.000Z',
    downstream_reference: null,
    reason: null,
  },
];

/** The visible-column CSV the export endpoint answers with. */
const EXPORT_CSV = [
  'submission_id,app_id,form_id,status,submitted_at,downstream_reference,reason',
  ...ROWS.map(
    (row) =>
      `${row.submission_id},${row.app_id},${row.form_id},${row.status},${row.submitted_at},${row.downstream_reference ?? ''},${row.reason ?? ''}`,
  ),
].join('\n');

/**
 * The stub's own filter implementation —
 * the same composition the API performs,
 * so the rendered rows prove the page
 * sent the composed set.
 */
function applyFilter(
  rows: Array<Record<string, unknown>>,
  params: URLSearchParams,
): Array<Record<string, unknown>> {
  const status = params.get('status');
  const from = params.get('from');
  const to = params.get('to');
  const form = params.get('form');
  return rows.filter((row) => {
    if (status !== null && row.status !== status) {
      return false;
    }
    if (form !== null && row.form_id !== form) {
      return false;
    }
    if (from !== null && row.submitted_at < `${from}T00:00:00.000Z`) {
      return false;
    }
    if (to !== null && row.submitted_at > `${to}T23:59:59.999Z`) {
      return false;
    }
    return true;
  });
}

/** Every list URL the stub served, in order. */
let listUrls: string[] = [];

/** The export request the stub served (the last one). */
let exportUrl = '';

/** Stub the builder API the viewer touches. */
async function stubSubmissionsApi(
  page: Page,
): Promise<void> {
  listUrls = [];
  exportUrl = '';

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

  // The app list (the shell's fallback surface) and
  // the app definition the viewer's header renders.
  await page.route(
    (url: URL) => url.pathname === '/api/apps',
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ apps: [] }),
      }),
  );
  await page.route(
    (url: URL) => url.pathname === `/api/apps/${APP_ID}`,
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(definition()),
      }),
  );

  // The viewer's list — the composed filter set.
  await page.route(
    (url: URL) => url.pathname === '/api/submissions',
    async (route: Route) => {
      const url = new URL(route.request().url());
      listUrls.push(url.searchParams.toString());
      const rows = applyFilter(ROWS, url.searchParams);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ submissions: rows }),
      });
    },
  );

  // The export — the same filter, the CSV projection.
  await page.route(
    (url: URL) =>
      url.pathname === '/api/submissions/export',
    async (route: Route) => {
      const url = new URL(route.request().url());
      exportUrl = url.searchParams.toString();
      const rows = applyFilter(ROWS, url.searchParams);
      const csv = [
        'submission_id,app_id,form_id,status,submitted_at,downstream_reference,reason',
        ...rows.map(
          (row) =>
            `${row.submission_id},${row.app_id},${row.form_id},${row.status},${row.submitted_at},${row.downstream_reference ?? ''},${row.reason ?? ''}`,
        ),
      ].join('\n');
      return route.fulfill({
        status: 200,
        headers: {
          'content-type': 'text/csv',
          'content-disposition':
            `attachment; filename="submissions-${APP_ID}.csv"`,
        },
        body: csv,
      });
    },
  );

  // The detail view — one projected row.
  await page.route(
    (url: URL) =>
      url.pathname.startsWith('/api/submissions/') &&
      url.pathname !== '/api/submissions/export',
    (route: Route) => {
      const submissionId = route
        .request()
        .url()
        .split('/api/submissions/')[1];
      const row = ROWS.find(
        (candidate) =>
          candidate.submission_id === submissionId,
      );
      if (row === undefined) {
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'SUBMISSION_NOT_FOUND',
              message: `submission not found: ${submissionId}`,
            },
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(row),
      });
    },
  );
}

test.describe('submissions viewer (BLD-08, D-111)', () => {
  test.beforeEach(() => {
    listUrls = [];
    exportUrl = '';
  });

  test('lists the app\'s submissions; the status, date-range, and form filters compose against the query parameters', async ({
    page,
  }) => {
    await stubSubmissionsApi(page);
    await page.goto(`/#/submissions?app=${APP_ID}`);

    await expect(
      page.getByTestId('submissions-page'),
    ).toBeVisible({ timeout: 20_000 });

    // The unfiltered list: every projected row,
    // newest first (the API's ordering).
    await expect(
      page.getByTestId('submission-row-sub_0005'),
    ).toBeVisible();
    await expect(
      page.getByTestId('submission-row-sub_0001'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid^="submission-row-"]'),
    ).toHaveCount(ROWS.length);

    // The status chip composes: only the failed
    // row survives the stub's own filtering.
    await page
      .getByTestId('status-filter-failed')
      .click();
    await expect(
      page.locator('[data-testid^="submission-row-"]'),
    ).toHaveCount(1);
    await expect(
      page.getByTestId('submission-row-sub_0001'),
    ).toBeVisible();

    // The date range composes with the status:
    // the 09:00 failed row is inside the window.
    await page
      .getByTestId('filter-from')
      .fill('2026-10-12');
    await page.getByTestId('filter-to').fill('2026-10-12');
    await expect(
      page.locator('[data-testid^="submission-row-"]'),
    ).toHaveCount(1);

    // The form select composes with both: the
    // leave-form rows survive.
    await page
      .getByTestId('filter-form')
      .selectOption('leave-form');
    await expect(
      page.locator('[data-testid^="submission-row-"]'),
    ).toHaveCount(1);

    // The last list request carried the full
    // composed set — every filter, one query.
    const last = listUrls[listUrls.length - 1];
    expect(last).toContain('status=failed');
    expect(last).toContain('from=2026-10-12');
    expect(last).toContain('to=2026-10-12');
    expect(last).toContain('form=leave-form');
    expect(last).toContain(`app_id=${APP_ID}`);
  });

  test('a row opens the detail drawer with the projected detail (GET /submissions/:id)', async ({
    page,
  }) => {
    await stubSubmissionsApi(page);
    await page.goto(`/#/submissions?app=${APP_ID}`);

    await expect(
      page.getByTestId('submission-row-sub_0001'),
    ).toBeVisible({ timeout: 20_000 });

    // The drawer opens on the row's projected
    // detail — the same row the list renders
    // (D-111's one projection).
    await page.getByTestId('submission-row-sub_0001').click();
    const drawer = page.getByTestId('submission-drawer');
    await expect(drawer).toBeVisible({ timeout: 20_000 });
    await expect(drawer).toContainText('sub_0001');
    await expect(drawer).toContainText('failed');
    await expect(drawer).toContainText(
      'delivery refused downstream',
    );
    await expect(drawer).toContainText('leave-form');

    // The drawer closes.
    await page
      .getByTestId('submission-drawer-close')
      .click();
    await expect(drawer).toHaveCount(0);
  });

  test('the export button requests GET /submissions/export with the current filters and downloads the visible-column CSV', async ({
    page,
  }) => {
    await stubSubmissionsApi(page);
    await page.goto(`/#/submissions?app=${APP_ID}`);

    await expect(
      page.getByTestId('submissions-page'),
    ).toBeVisible({ timeout: 20_000 });

    // Compose a filter first — the export must
    // carry the current filter set, not the
    // unfiltered one.
    await page
      .getByTestId('status-filter-failed')
      .click();
    await expect(
      page.getByTestId('submission-row-sub_0001'),
    ).toBeVisible();

    // The export downloads the CSV for the
    // composed filter — the request carries the
    // filters, the file carries the columns.
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-button').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      `submissions-${APP_ID}.csv`,
    );

    // The export request carried the current
    // filters (the same composed set the list
    // read).
    expect(exportUrl).toContain('status=failed');
    expect(exportUrl).toContain(`app_id=${APP_ID}`);

    // The downloaded CSV is the visible-column
    // projection of the filtered rows.
    const path = await download.path();
    const csv = readFileSync(path, 'utf8');
    expect(csv).toContain(
      'submission_id,app_id,form_id,status,submitted_at,downstream_reference,reason',
    );
    expect(csv).toContain('sub_0001');
    expect(csv).not.toContain('sub_0002');
    // The export carries the projected columns
    // only — the header is exactly the visible
    // column set (D-111).
    expect(csv.split('\n')[0]).toBe(
      'submission_id,app_id,form_id,status,submitted_at,downstream_reference,reason',
    );
  });
});
