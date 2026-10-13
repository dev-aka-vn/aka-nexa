/**
 * The form-designer spec (BLD-04, BLD-05, FRM-05,
 * FRM-09).
 *
 * The designer is the phase's integration heart:
 * the React 19 shell and the imperative FormIO
 * builder share one page (container-as-leaf
 * mount, Pattern 1), undo/redo is schema-snapshot
 * history (Pattern 2), and the preview renders
 * drafts into an FRM-09 sandbox that cannot
 * reach the real submissions collection.
 *
 * The spec runs against a stubbed builder API
 * (the frozen plan-04/06 contracts) and proves:
 *
 *  1. The designer mounts the app's form schema
 *     in the builder; adding a component fires
 *     the change event and the debounced capture
 *     records ONE history entry (one undo
 *     reverses the whole add), and undo/redo
 *     round-trip through `builder.setForm`.
 *  2. FRM-05: a component's validate (required)
 *     and conditional (show/hide) properties are
 *     authored in the builder's own component
 *     edit form — native FormIO properties, no
 *     custom validation code — and persist with
 *     the schema.
 *  3. The preview renders the draft form; a
 *     sandbox submission lands in the in-memory
 *     buffer and NO submissions API call fires
 *     (FRM-09).
 *  4. BLD-05: the mapping surface lists the
 *     form's fields beside the connector's
 *     fields, and a saved pairing PUTs
 *     /apps/:id/routing/mapping.
 *
 * The tablet project (768×1024, touch) runs
 * this same spec (BLD-09).
 */

import {
  expect,
  test,
  type Page,
  type Route,
} from '@playwright/test';

/**
 * The FormIO change-event capture is debounced
 * (SchemaHistory, 300 ms); every assertion that
 * reads a captured snapshot waits past the
 * window.
 */
const DEBOUNCE_WINDOW_MS = 300;
const SETTLE_MS = DEBOUNCE_WINDOW_MS + 150;

/**
 * PreviewPane's own re-render debounce
 * (`PREVIEW_DEBOUNCE_MS` in PreviewPane.tsx).
 * The preview is scheduled this many ms after a
 * `schema` change, so a change that lands right
 * after the preview first mounts replaces the
 * mounted form instance this long afterwards.
 */
const PREVIEW_DEBOUNCE_MS = 400;

/**
 * The per-test budget for this spec.
 *
 * Every test here mounts the real FormIO 5.6.1
 * builder — the heaviest module graph the SPA
 * loads. Against a COLD vite dev server (no
 * listener on :5173, so Playwright starts one)
 * the first execution additionally pays the dev
 * server's on-demand transform of that graph
 * plus the browser's parse and execution of it.
 * Measured on this machine, the first execution
 * of the :385 drag test lands at 20.8–26.5 s
 * against Playwright's default 30 s per-test
 * budget (69–88 % of the ceiling), and a slower
 * run was observed to cross it — "Test timeout
 * of 30000ms exceeded" at the undo click, 30.4 s
 * total. A real drag + dialog save + undo + redo
 * against a heavyweight builder needs headroom.
 *
 * 90 s is deliberately bounded at 3x the
 * default: enough for the cold cost, nowhere
 * near an unbounded wait. The spec is NOT given
 * an endless timeout — a genuine hang, or any
 * failed assertion, still fails the test, and
 * every step keeps its own explicit wait (20 s
 * visibility, 10 s dialog, the restore polls in
 * the BLD-04 test).
 */
const DESIGNER_SPEC_TIMEOUT_MS = 90_000;

/**
 * Deterministic-wait budget for a builder
 * restore. Undo/redo resolve through
 * `builder.setForm()`; the polls in the BLD-04
 * test wait for the restored schema to land
 * instead of sleeping a fixed window. A poll
 * still fails on timeout, so a restore that
 * never lands is a red test rather than a slow
 * one.
 */
const RESTORE_TIMEOUT_MS = 15_000;

/** The served definition the stubbed GET /apps/:id answers with. */
function designerDefinition(): Record<string, unknown> {
  return {
    app_id: 'hr-leave-request',
    name: 'Leave Request',
    description: 'Request and approve leave',
    data_mode: 'external',
    lifecycle: 'draft',
    version: 1,
    tags: [],
    form_schema: {
      display: 'Leave request',
      components: [
        {
          type: 'textfield',
          key: 'fullName',
          label: 'Full name',
          input: true,
          validate: { required: true },
        },
        {
          type: 'number',
          key: 'days',
          label: 'Days of leave',
          input: true,
          validate: { min: 1, max: 30 },
        },
        {
          type: 'button',
          key: 'submit',
          label: 'Submit',
          action: 'submit',
        },
      ],
    },
    triggers: [],
    roles: {},
    routing_config: {
      data_mode: 'external',
      connector_id: 'redmine',
      connector_fields: ['subject', 'description', 'priority'],
    },
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

export interface DesignerApiHooks {
  /** Bodies of every PUT /apps/:id/routing/mapping, in order. */
  onMappingPut?: (body: Record<string, unknown>) => void;
}

/**
 * Stub the builder API the designer touches: the
 * session boot, the app definition (with its form
 * schema and routing section), the field-mapping
 * read/write, and a submissions-API tripwire that
 * fails the spec if the preview ever reaches it.
 */
async function stubDesignerApi(
  page: Page,
  hooks: DesignerApiHooks = {},
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

  // The FRM-09 tripwire: the preview's sandbox
  // submissions must never reach a submissions
  // endpoint. Fulfill (so a stray call would not
  // hang the page) and count. The stub matches
  // the API surface only (the request path
  // starts with /api/submissions): the SPA's
  // own module URLs carry the same path segment
  // (the dev server serves /src/api/submissions.ts),
  // and a glob would answer a module script with
  // JSON — a MIME-type load error that blanks the
  // whole app.
  await page.route(
    (url: URL) =>
      url.pathname.startsWith('/api/submissions'),
    (route: Route) => {
      submissionsRequests.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      });
    },
  );

  // Every app path: the definition read, the
  // field-mapping read/write. `**` spans the
  // multi-segment paths.
  await page.route('**/api/apps/**', async (route: Route) => {
    const method = route.request().method();
    const url = route.request().url();

    if (url.includes('/routing/mapping')) {
      if (method === 'PUT') {
        const body = route.request().postDataJSON();
        hooks.onMappingPut?.(body);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            app_id: 'hr-leave-request',
            field_mapping: body.field_mapping ?? {},
            version: 2,
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          app_id: 'hr-leave-request',
          field_mapping: {},
          version: 1,
        }),
      });
    }

    if (method === 'GET' && url.endsWith('/hr-leave-request')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(designerDefinition()),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });
}

/** The submissions-API tripwire counter (reset per test). */
let submissionsRequests: string[] = [];

/** The builder's component count, read through the designer handle. */
async function builderComponentCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const schema = window.__DESIGNER__?.getSchema() as
      | { components: unknown[] }
      | null;
    return schema?.components.length ?? -1;
  });
}

/**
 * Adds a component through the builder's own
 * sidebar — the drag-and-drop surface (BLD-04).
 * FormIO 5.6.1's sidebar is dragula-powered (a
 * plain click is a no-op), and a new-component
 * drop opens the component edit dialog; the
 * `change` event the history feeds on fires
 * when that dialog is saved. So the real user
 * flow is: drag onto the canvas, then save the
 * dialog. (The S1 spike proved this exact
 * trajectory — see s1-spike.spec.ts.)
 */
async function addComponentViaSidebar(
  page: Page,
  componentTitle: string,
): Promise<void> {
  const form = page.locator('.formio-builder-form').first();
  await form.scrollIntoViewIfNeeded();
  // Re-measure after the scroll settles.
  await page.waitForTimeout(200);
  const canvasBox = await form.boundingBox();
  expect(canvasBox).not.toBeNull();
  const button = page.locator('.formcomponent', {
    hasText: componentTitle,
  });
  const buttonBox = await button.boundingBox();
  expect(buttonBox).not.toBeNull();

  // Dragula needs a real mouse trajectory with movement.
  await page.mouse.move(
    buttonBox!.x + buttonBox!.width / 2,
    buttonBox!.y + buttonBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvasBox!.x + 40,
    canvasBox!.y + 60,
    { steps: 15 },
  );
  await page.waitForTimeout(100);
  await page.mouse.up();

  // The edit dialog for the new component; saving it
  // is what emits the builder's `change` event.
  const dialog = page.locator('.formio-dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  await dialog.locator('button.btn-success').click();
  // Let the debounced capture (SchemaHistory, 300 ms)
  // flush the snapshot.
  await page.waitForTimeout(SETTLE_MS);
}

/**
 * Opens a canvas component's own edit dialog —
 * the gear button in the component's hover
 * toolbar (hidden until the wrapper is hovered).
 */
async function openComponentEditor(
  page: Page,
  componentType: string,
): Promise<void> {
  const wrapper = page.locator('.builder-component', {
    has: page.locator(`.formio-component-${componentType}`),
  }).first();
  await wrapper.hover();
  // The toolbar button is hover-revealed; the
  // force click dispatches through to the
  // builder's own edit handler.
  await wrapper
    .locator('[ref="editComponent"]')
    .click({ force: true });
  const dialog = page.locator('.formio-dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
}

/**
 * Waits until the preview's mounted FormIO form
 * instance has settled (FRM-09).
 *
 * The designer mounts the preview twice per page
 * load: the builder normalises the served
 * `form_schema` and round-trips it back through
 * `handleSchemaChange`, which changes the `schema`
 * prop and re-arms PreviewPane's `PREVIEW_DEBOUNCE_MS`
 * (400 ms) timer. The first form instance is
 * therefore destroyed and rebuilt ~400 ms after it
 * first reports `data-ready="true"` — a value typed
 * into it is discarded with the destroyed DOM (the
 * remount clears the container and renders a new
 * root).
 *
 * Rather than racing that remount, tag the mounted
 * form root and require the tag to survive a full
 * debounce window before typing. If the preview were
 * ever re-mounted repeatedly — a real regression —
 * this poll would time out and fail the spec. It is
 * deliberately NOT a longer timeout on the value
 * assertion: it proves the remount has finished
 * rather than hiding it.
 */
async function waitForSettledPreview(page: Page): Promise<void> {
  const preview = page.getByTestId('designer-preview');
  await expect(preview).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });

  const probe = 'data-preview-settle-probe';
  await expect
    .poll(
      async () => {
        // Tag the currently mounted FormIO form root
        // (`.formio-component-form`). A remount clears
        // the container and renders a new root, so the
        // tag is dropped.
        await page.evaluate((attribute) => {
          const root = document.querySelector(
            '[data-testid="designer-preview-form"] > *',
          );
          root?.setAttribute(attribute, 'settled');
        }, probe);
        // A full debounce window plus margin: any
        // re-armed remount lands inside it.
        await page.waitForTimeout(PREVIEW_DEBOUNCE_MS + 300);
        return page.evaluate((attribute) => {
          const section = document.querySelector(
            '[data-testid="designer-preview"]',
          );
          const root = document.querySelector(
            '[data-testid="designer-preview-form"] > *',
          );
          return (
            section?.getAttribute('data-ready') === 'true' &&
            root?.getAttribute(attribute) === 'settled'
          );
        }, probe);
      },
      {
        timeout: 20_000,
        message:
          'the preview form kept re-mounting — it never stayed stable for a full debounce window',
      },
    )
    .toBe(true);
}

test.describe('form designer (BLD-04/BLD-05/FRM-05/FRM-09)', () => {
  // The whole file drives the real FormIO builder
  // page; see DESIGNER_SPEC_TIMEOUT_MS. Scoped to
  // this describe block — no other spec's budget
  // moves.
  test.describe.configure({
    timeout: DESIGNER_SPEC_TIMEOUT_MS,
  });

  test.beforeEach(() => {
    submissionsRequests = [];
  });

  test('the designer mounts the builder; an added component captures one history entry and undo/redo round-trip', async ({
    page,
  }) => {
    await stubDesignerApi(page);
    await page.goto('/#/apps/hr-leave-request/designer');

    // The builder rendered the app's form schema into
    // the React-owned container (container-as-leaf,
    // Pattern 4).
    const host = page.getByTestId('formio-builder-host');
    await expect(host.locator('.formio-builder-form')).toBeVisible({
      timeout: 20_000,
    });

    // The served schema: two fields + the submit
    // button.
    const initialCount = await builderComponentCount(page);
    expect(initialCount).toBe(3);

    // Undo is a no-op at the seeded history's
    // beginning — the toolbar reflects it.
    await expect(page.getByTestId('designer-undo-button')).toBeDisabled();
    await expect(page.getByTestId('designer-redo-button')).toBeDisabled();

    // Add a text component through the builder's own
    // sidebar (the drag-and-drop surface, BLD-04).
    await addComponentViaSidebar(page, 'Text Field');
    expect(await builderComponentCount(page)).toBe(initialCount + 1);

    // The change captured exactly ONE history entry:
    // a single undo reverses the whole add.
    await expect(page.getByTestId('designer-undo-button')).toBeEnabled();
    await page.getByTestId('designer-undo-button').click();
    // Deterministic wait for the restore: the click
    // handler resolves through `builder.setForm()`,
    // so poll the builder's own schema until the
    // pre-add snapshot has landed. Polling fails on
    // timeout — a restore that never lands is red —
    // so this is a real assertion, not a sleep. The
    // count is 3 here and 4 below, so the redo leg
    // cannot pass without the count actually moving.
    await expect
      .poll(() => builderComponentCount(page), {
        timeout: RESTORE_TIMEOUT_MS,
        message:
          'a single undo did not restore the pre-add component count',
      })
      .toBe(initialCount);

    // And redo restores it.
    await expect(page.getByTestId('designer-redo-button')).toBeEnabled();
    await page.getByTestId('designer-redo-button').click();
    await expect
      .poll(() => builderComponentCount(page), {
        timeout: RESTORE_TIMEOUT_MS,
        message: 'redo did not restore the added component',
      })
      .toBe(initialCount + 1);
  });

  test("a component's validate and conditional properties are authored in the builder's edit form and persist with the schema (FRM-05)", async ({
    page,
  }) => {
    await stubDesignerApi(page);
    await page.goto('/#/apps/hr-leave-request/designer');

    const host = page.getByTestId('formio-builder-host');
    await expect(host.locator('.formio-builder-form')).toBeVisible({
      timeout: 20_000,
    });

    // Open the "Days of leave" number component's own
    // edit form (the native FormIO component editor).
    await openComponentEditor(page, 'number');
    const dialog = page.locator('.formio-dialog');

    // The native edit form carries the Validation and
    // Conditional tabs — FRM-05's properties are
    // FormIO capabilities, not custom code.
    await dialog.locator('a[href="#validation"]').click();
    // "Required" — a native validate property (the
    // first checkbox of the validation panel).
    await dialog
      .locator('[ref="tab-tabs"]:visible')
      .locator('input[type="checkbox"]')
      .first()
      .check();
    await dialog.locator('button.btn-success').click();
    await page.waitForTimeout(SETTLE_MS);

    // The edit persisted with the schema: the days
    // component now carries validate.required.
    const requiredPersisted = await page.evaluate(() => {
      const schema = window.__DESIGNER__!.getSchema() as {
        components: Array<{
          key?: string;
          validate?: { required?: boolean };
        }>;
      };
      const days = schema.components.find(
        (component) => component.key === 'days',
      );
      return days?.validate?.required === true;
    });
    expect(requiredPersisted).toBe(true);

    // The Conditional tab: the native show/hide
    // authoring surface. Set the simple conditional
    // (display when "Full name" has a value).
    await openComponentEditor(page, 'number');
    await dialog.locator('a[href="#conditional"]').click();
    const panel = dialog.locator('[ref="tab-tabs"]:visible');
    // "This component should Display:" → True.
    const displayWidget = panel.locator('.choices').first();
    await displayWidget.click();
    await displayWidget
      .locator('.choices__item--choice', { hasText: 'True' })
      .first()
      .click();
    // "When the form component:" → the fullName field.
    const whenWidget = panel.locator('.choices').nth(1);
    await whenWidget.click();
    await whenWidget
      .locator('.choices__item--choice', { hasText: 'fullName' })
      .first()
      .click();
    // "Has the value:".
    await panel.getByLabel('Has the value:').fill('approved');
    await dialog.locator('button.btn-success').click();
    await page.waitForTimeout(SETTLE_MS);

    // The conditional persisted with the schema.
    const conditionalPersisted = await page.evaluate(() => {
      const schema = window.__DESIGNER__!.getSchema() as {
        components: Array<{
          key?: string;
          conditional?: {
            show?: boolean;
            when?: string;
            eq?: string;
          };
        }>;
      };
      const days = schema.components.find(
        (component) => component.key === 'days',
      );
      return (
        days?.conditional?.show === true &&
        days?.conditional?.when === 'fullName' &&
        days?.conditional?.eq === 'approved'
      );
    });
    expect(conditionalPersisted).toBe(true);
  });

  test('the preview renders the draft form; a sandbox submission is buffered and no submissions API call fires (FRM-09)', async ({
    page,
  }) => {
    await stubDesignerApi(page);
    await page.goto('/#/apps/hr-leave-request/designer');

    // Wait for the preview to settle before typing.
    // The designer mounts the preview twice (the
    // builder's initial schema round-trip re-arms the
    // 400 ms debounce), and a value typed into the
    // first instance is discarded when it is replaced.
    // The helper proves the mounted instance is stable
    // across a full debounce window first.
    await waitForSettledPreview(page);

    // The preview rendered the draft form from the
    // same schema the builder edits.
    const preview = page.getByTestId('designer-preview');
    await expect(
      preview.getByLabel('Full name'),
    ).toBeVisible();

    // Fill and submit the preview form. The value
    // assertions settle the FormIO input handling
    // before the submit click (the data model
    // flushes on the input events; asserting the
    // value makes the submit deterministic).
    await preview.getByLabel('Full name').fill('Jane Doe');
    await preview.getByLabel('Days of leave').fill('5');
    await expect(preview.getByLabel('Full name')).toHaveValue('Jane Doe');
    await expect(preview.getByLabel('Days of leave')).toHaveValue('5');
    await preview.getByRole('button', { name: 'Submit' }).click();

    // The submission landed in the sandbox buffer —
    // rendered in place, newest last.
    const buffer = page.getByTestId('sandbox-buffer');
    await expect(buffer).toHaveAttribute('data-count', '1');
    const first = page.getByTestId('sandbox-submission-0');
    await expect(first).toContainText('Jane Doe');

    // FRM-09's guarantee: the sandbox submission
    // never reached a submissions endpoint.
    expect(submissionsRequests).toHaveLength(0);
  });

  test('the mapping surface lists the form fields beside the connector fields and saves a pairing (BLD-05)', async ({
    page,
  }) => {
    const mappingPuts: Array<Record<string, unknown>> = [];
    await stubDesignerApi(page, {
      onMappingPut: (body) => mappingPuts.push(body),
    });
    await page.goto('/#/apps/hr-leave-request/designer');

    // The mapping surface lists the form's fields
    // (from the schema) beside the connector's
    // fields (from the routing section).
    const mapping = page.getByTestId('field-mapping');
    await expect(mapping.getByTestId('mapping-field-fullName')).toBeVisible();
    await expect(mapping.getByTestId('mapping-field-days')).toBeVisible();
    // The connector's fields are the pairing
    // targets.
    await expect(
      mapping.getByTestId('mapping-select-fullName').locator('option'),
    ).toContainText(['subject', 'description', 'priority']);

    // Pair the form's fullName field with the
    // connector's subject field and save.
    await mapping
      .getByTestId('mapping-select-fullName')
      .selectOption('subject');
    await mapping.getByTestId('mapping-save-button').click();

    // The pairing PUT /apps/:id/routing/mapping with
    // the frozen contract shape.
    expect(mappingPuts).toHaveLength(1);
    expect(mappingPuts[0]).toEqual({
      field_mapping: { fullName: 'subject' },
    });

    // The saved state renders in place.
    await expect(page.getByTestId('mapping-saved')).toBeVisible();
  });
});
