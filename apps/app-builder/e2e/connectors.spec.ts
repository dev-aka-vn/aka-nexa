/**
 * The connectors page spec (BLD-10,
 * D-97..D-100, BLD-07, BLD-09).
 *
 * The Connectors page is the admin's
 * self-service surface over the app's
 * connector **requests** — the statused
 * queue the platform operator provisions
 * from (D-97):
 *
 * 1. **Per-state badges** — every request
 *    renders its lifecycle badge (pending
 *    amber, provisioned green, rejected
 *    red) and the rejected reason inline
 *    (D-98's "+ reason").
 * 2. **Cancel / retry** — a pending
 *    request carries the owner's cancel
 *    (`POST /apps/:id/connector-requests/
 *    :requestId/cancel`) and retry
 *    (`.../:requestId/retry`) actions —
 *    a fresh `request_id` for the same
 *    definition (D-98).
 * 3. **The request form (D-99)** — the
 *    drawer collects exactly the frozen
 *    `ConnectorRequestDefinitionSchema`
 *    field set (the full connector
 *    definition **minus the secret**:
 *    connector type, name, base URL, and
 *    the optional operational policy —
 *    timeout, retries, rate limit,
 *    mapping, taxonomy) and POSTs it to
 *    `POST /apps/:id/connector-requests`.
 *    No credential field exists anywhere
 *    in the form: the operator fills the
 *    credential through the existing
 *    audited seam (D-97/FND-10) — a
 *    spec asserts the submitted body
 *    carries no key matching
 *    /credential|secret|password|auth/i.
 * 4. **Provisioned → data routing** — a
 *    provisioned request shows the
 *    provisioned badge, and the app's
 *    data-routing tab offers the
 *    provisioned connector for selection
 *    (the request's definition becomes
 *    the app's routing target).
 *
 * The API is stubbed through `page.route`
 * (the plan-07 mechanism) with
 * API-surface-only predicates — the dev
 * server also serves the SPA's own
 * module URLs, and a glob would answer a
 * module script with JSON (a MIME-type
 * load error that blanks the app).
 */

import {
  expect,
  test,
  type Page,
  type Route,
} from '@playwright/test';

/** The app the requests belong to. */
const APP_ID = 'hr-leave-request';

/** The served definition the page header renders. */
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

/** The seeded request queue — one request per lifecycle state. */
function seedRequests(): Array<
  Record<string, unknown>
> {
  return [
    {
      request_id: 'req_pending_1',
      app_id: APP_ID,
      requested_by: 'usr_owner_1',
      connector_id: 'redmine',
      name: 'Redmine Issues',
      base_url: 'https://redmine.example.com',
      timeout_ms: 30000,
      retries: 3,
      state: 'pending',
      requestedAt: '2026-10-12T10:00:00.000Z',
    },
    {
      request_id: 'req_prov_1',
      app_id: APP_ID,
      requested_by: 'usr_owner_1',
      connector_id: 'zalo-oa',
      name: 'Zalo OA',
      base_url: 'https://zalo.example.com',
      state: 'provisioned',
      credential_ref: 'cred_01HF3Y2',
      requestedAt: '2026-10-11T10:00:00.000Z',
      resolvedAt: '2026-10-11T11:00:00.000Z',
    },
    {
      request_id: 'req_rej_1',
      app_id: APP_ID,
      requested_by: 'usr_owner_1',
      connector_id: 'telegram',
      name: 'Telegram Bot',
      base_url: 'https://api.telegram.org',
      state: 'rejected',
      reason: 'base_url unreachable from the platform network',
      requestedAt: '2026-10-10T10:00:00.000Z',
      resolvedAt: '2026-10-10T11:00:00.000Z',
    },
  ];
}

/** The mutable stub state — the queue the page drives. */
interface QueueState {
  requests: Array<Record<string, unknown>>;
  cancelled: string[];
  retried: string[];
  created: Array<Record<string, unknown>>;
}

/** Every cancel URL the stub served. */
let cancelUrls: string[] = [];

/** Every retry URL the stub served. */
let retryUrls: string[] = [];

/** Every create body the stub served. */
let createBodies: Array<Record<string, unknown>> = [];

/** Stub the builder API the connectors page touches. */
async function stubConnectorsApi(
  page: Page,
  state: QueueState,
): Promise<void> {
  cancelUrls = [];
  retryUrls = [];
  createBodies = [];

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
  // the app definition the page header renders.
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

  // The request queue — the list and the create.
  await page.route(
    (url: URL) =>
      url.pathname ===
      `/api/apps/${APP_ID}/connector-requests`,
    async (route: Route) => {
      const method = route.request().method();
      if (method === 'POST') {
        const body = route.request().postDataJSON();
        createBodies.push(body);
        const created = {
          request_id: 'req_new_1',
          app_id: APP_ID,
          requested_by: 'usr_owner_1',
          ...body,
          state: 'pending',
          requestedAt: '2026-10-12T12:00:00.000Z',
        };
        state.requests.unshift(created);
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(created),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ requests: state.requests }),
      });
    },
  );

  // The owner's cancel — pending → rejected, audited.
  await page.route(
    (url: URL) =>
      /^\/api\/apps\/[^/]+\/connector-requests\/[^/]+\/cancel$/.test(
        url.pathname,
      ),
    (route: Route) => {
      const requestId = route
        .request()
        .url()
        .split('/connector-requests/')[1]
        .split('/cancel')[0];
      cancelUrls.push(requestId);
      const request = state.requests.find(
        (candidate) =>
          candidate.request_id === requestId,
      );
      const cancelled = {
        ...(request ?? {}),
        state: 'rejected',
        reason: 'cancelled by the requesting admin',
        resolvedAt: '2026-10-12T12:00:00.000Z',
      };
      state.requests = state.requests.map(
        (candidate) =>
          candidate.request_id === requestId
            ? cancelled
            : candidate,
      );
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(cancelled),
      });
    },
  );

  // The owner's retry — a fresh request_id for the
  // same definition, after the previous reached a
  // terminal state.
  await page.route(
    (url: URL) =>
      /^\/api\/apps\/[^/]+\/connector-requests\/[^/]+\/retry$/.test(
        url.pathname,
      ),
    (route: Route) => {
      const requestId = route
        .request()
        .url()
        .split('/connector-requests/')[1]
        .split('/retry')[0];
      retryUrls.push(requestId);
      const previous = state.requests.find(
        (candidate) =>
          candidate.request_id === requestId,
      );
      const retried = {
        ...(previous ?? {}),
        request_id: 'req_retry_1',
        state: 'pending',
        reason: null,
        resolvedAt: null,
        requestedAt: '2026-10-12T12:00:00.000Z',
      };
      state.requests.unshift(retried);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(retried),
      });
    },
  );
}

test.describe('connectors page (BLD-10, D-97..D-100)', () => {
  test('lists the app\'s connector requests with per-state badges and the rejected reason inline', async ({
    page,
  }) => {
    const state: QueueState = {
      requests: seedRequests(),
      cancelled: [],
      retried: [],
      created: [],
    };
    await stubConnectorsApi(page, state);
    await page.goto(`/#/connectors?app=${APP_ID}`);

    await expect(
      page.getByTestId('connectors-page'),
    ).toBeVisible({ timeout: 20_000 });

    // One row per request.
    await expect(
      page.getByTestId('connector-request-req_pending_1'),
    ).toBeVisible();
    await expect(
      page.getByTestId('connector-request-req_prov_1'),
    ).toBeVisible();
    await expect(
      page.getByTestId('connector-request-req_rej_1'),
    ).toBeVisible();

    // The per-state badges: pending (amber),
    // provisioned (green), rejected (red) —
    // the mockup's badge posture.
    await expect(
      page.getByTestId('request-state-req_pending_1'),
    ).toHaveClass(/badge-partial/);
    await expect(
      page.getByTestId('request-state-req_pending_1'),
    ).toContainText('pending');
    await expect(
      page.getByTestId('request-state-req_prov_1'),
    ).toHaveClass(/badge-provisioned/);
    await expect(
      page.getByTestId('request-state-req_prov_1'),
    ).toContainText('provisioned');
    await expect(
      page.getByTestId('request-state-req_rej_1'),
    ).toHaveClass(/badge-rejected/);
    await expect(
      page.getByTestId('request-state-req_rej_1'),
    ).toContainText('rejected');

    // The rejected reason renders inline
    // (D-98's "+ reason").
    await expect(
      page.getByTestId('connector-request-req_rej_1'),
    ).toContainText(
      'base_url unreachable from the platform network',
    );
  });

  test('a pending request shows cancel and retry actions that call the plan-06 endpoints', async ({
    page,
  }) => {
    const state: QueueState = {
      requests: seedRequests(),
      cancelled: [],
      retried: [],
      created: [],
    };
    await stubConnectorsApi(page, state);
    await page.goto(`/#/connectors?app=${APP_ID}`);

    await expect(
      page.getByTestId('connector-request-req_pending_1'),
    ).toBeVisible({ timeout: 20_000 });

    // The pending row carries the owner's
    // cancel and retry actions; the terminal
    // rows carry neither.
    await expect(
      page.getByTestId('cancel-request-req_pending_1'),
    ).toBeVisible();
    await expect(
      page.getByTestId('retry-request-req_pending_1'),
    ).toBeVisible();
    await expect(
      page.getByTestId('cancel-request-req_prov_1'),
    ).toHaveCount(0);
    await expect(
      page.getByTestId('retry-request-req_rej_1'),
    ).toHaveCount(0);

    // Cancel: the plan-06 cancel endpoint is
    // called with the request id, and the
    // queue refreshes to the rejected state.
    await page
      .getByTestId('cancel-request-req_pending_1')
      .click();
    expect(cancelUrls).toEqual(['req_pending_1']);
    await expect(
      page.getByTestId('request-state-req_pending_1'),
    ).toContainText('rejected', { timeout: 20_000 });
    await expect(
      page.getByTestId('connector-request-req_pending_1'),
    ).toContainText('cancelled by the requesting admin');

    // Retry: the plan-06 retry endpoint is
    // called with the request id, and a
    // fresh pending request (a new
    // request_id) joins the queue.
    await page
      .getByTestId('retry-request-req_pending_1')
      .click();
    expect(retryUrls).toEqual(['req_pending_1']);
    await expect(
      page.getByTestId('connector-request-req_retry_1'),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByTestId('request-state-req_retry_1'),
    ).toContainText('pending');
  });

  test('the request form collects exactly the D-99 definition minus the secret and submits it (no credential field)', async ({
    page,
  }) => {
    const state: QueueState = {
      requests: seedRequests(),
      cancelled: [],
      retried: [],
      created: [],
    };
    await stubConnectorsApi(page, state);
    await page.goto(`/#/connectors?app=${APP_ID}`);

    await expect(
      page.getByTestId('connectors-page'),
    ).toBeVisible({ timeout: 20_000 });

    // The request form opens in its drawer.
    await page
      .getByTestId('new-connector-request')
      .click();
    const drawer = page.getByTestId(
      'connector-request-drawer',
    );
    await expect(drawer).toBeVisible({ timeout: 20_000 });

    // The form collects exactly the D-99
    // definition minus the secret: the
    // connector type, the display name, the
    // base URL, and the optional operational
    // policy (timeout, retries, rate limit,
    // mapping, taxonomy). No credential,
    // secret, password, or auth input exists
    // anywhere in the form (D-97/FND-10 —
    // the operator fills the credential).
    const formFields = drawer.locator(
      'input, select, textarea',
    );
    const fieldTestIds = await formFields
      .evaluateAll(
        (elements) =>
          elements.map(
            (element) =>
              (element as HTMLElement).dataset.testid ??
              element.id ??
              element.getAttribute('name') ??
              '',
          ),
      );
    const forbidden = fieldTestIds.filter((id) =>
      /credential|secret|password|auth/i.test(id),
    );
    expect(forbidden).toEqual([]);

    await expect(
      drawer.getByTestId('request-field-connector-id'),
    ).toBeVisible();
    await expect(
      drawer.getByTestId('request-field-name'),
    ).toBeVisible();
    await expect(
      drawer.getByTestId('request-field-base-url'),
    ).toBeVisible();

    // Fill the definition: the connector
    // type, the name, the base URL.
    await drawer
      .getByTestId('request-field-connector-id')
      .selectOption('redmine');
    await drawer
      .getByTestId('request-field-name')
      .fill('Redmine Issues');
    await drawer
      .getByTestId('request-field-base-url')
      .fill('https://redmine.example.com');

    // Submit: the definition minus the secret
    // POSTs to the plan-06 create endpoint.
    await drawer.getByTestId('submit-request').click();
    await expect(createBodies).toHaveLength(1);
    const body = createBodies[0];
    expect(body['connector_id']).toBe('redmine');
    expect(body['name']).toBe('Redmine Issues');
    expect(body['base_url']).toBe(
      'https://redmine.example.com',
    );
    // The submitted body carries no key that
    // could carry a credential (T-06-23):
    // the strict contract's field set only.
    const forbiddenKeys = Object.keys(body).filter(
      (key) => /credential|secret|password/i.test(key),
    );
    expect(forbiddenKeys).toEqual([]);

    // The queue refreshes to the new pending
    // request.
    await expect(
      page.getByTestId('connector-request-req_new_1'),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByTestId('request-state-req_new_1'),
    ).toContainText('pending');
  });

  test('a provisioned request shows the provisioned badge and the data-routing tab offers the connector for selection', async ({
    page,
  }) => {
    const state: QueueState = {
      requests: seedRequests(),
      cancelled: [],
      retried: [],
      created: [],
    };
    await stubConnectorsApi(page, state);
    await page.goto(`/#/apps/${APP_ID}`);

    // The editor's data-routing tab offers
    // the app's provisioned connectors for
    // selection — the request's definition
    // becomes the app's routing target.
    await expect(
      page.getByTestId('editor-page'),
    ).toBeVisible({ timeout: 20_000 });
    await page
      .getByTestId('editor-tab-data-routing')
      .click();

    const select = page.getByTestId(
      'routing-connector-select',
    );
    await expect(select).toBeVisible({ timeout: 20_000 });
    // The provisioned connector is offered;
    // the pending and rejected ones are not.
    const options = await select
      .locator('option')
      .evaluateAll(
        (elements) =>
          elements.map(
            (element) => (element as HTMLOptionElement).value,
          ),
      );
    expect(options).toContain('zalo-oa');
    expect(options).not.toContain('redmine');
    expect(options).not.toContain('telegram');

    // Selecting the connector offers it into
    // the routing configuration.
    await select.selectOption('zalo-oa');
    await expect(
      page.getByTestId('section-json'),
    ).toContainText('zalo-oa');
  });
});
