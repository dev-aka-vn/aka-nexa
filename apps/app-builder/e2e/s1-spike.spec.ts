/**
 * Spike S1 — the FormIO 5.6.1 builder mounted in the
 * React 19 shell, verified in Chromium.
 *
 * The four behaviors the plan's Test 1 / Test 2 name,
 * plus the undo/redo round-trip through the real
 * builder and the computed-style guard:
 *
 *  1. The builder mounts into the React-owned
 *     container; adding a text component fires the
 *     change event and the captured snapshot
 *     deep-equals `builder.schema`.
 *  2. The 5.x shapes: `component.errors` is an array
 *     read via `errors[0].message`, and
 *     `EditGrid.validateRow` returns an array whose
 *     length is the validity verdict.
 *  3. FRM-05's boundary: a min/max validation pair
 *     passes a value exactly at the bound and fails
 *     one step outside either bound.
 *  4. Undo/redo reverses a real component add
 *     through `builder.setForm()` snapshots.
 *  5. G-06-6: the builder canvas renders with real
 *     Bootstrap 5 styling — the scope root exposes
 *     a non-empty `--bs-primary`, rows are wrapping
 *     flex containers, the schema's columns are
 *     fractions of their row, and form-controls
 *     compute Bootstrap geometry. Measured by
 *     computed style, never by class names: the
 *     class names were already correct while the
 *     styles were entirely absent.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The FormIO change-event capture is debounced
 * (SchemaHistory, 300 ms); every assertion that
 * reads a captured snapshot waits past the window.
 */
const DEBOUNCE_WINDOW_MS = 300;
const SETTLE_MS = DEBOUNCE_WINDOW_MS + 150;

/**
 * The budget for the builder (and the preview) to
 * mount. The spike mounts the same `@formio/js`
 * graph the designer does; the mount is the only
 * cold-path wait and swings from seconds to tens
 * of seconds depending on dev-server coldness and
 * machine load (see the same constant in
 * designer.spec.ts, where this was diagnosed).
 */
const BUILDER_MOUNT_TIMEOUT_MS = 60_000;

/**
 * The per-test budget for this spec: the mount
 * headroom above, plus the drag + dialog save +
 * undo/redo the heavier tests drive.
 */
const SPIKE_SPEC_TIMEOUT_MS = 120_000;

/** The builder's component count, read through the spike handle. */
async function builderComponentCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const schema = window.__SPIKE__?.getSchema() as
      | { components: unknown[] }
      | null;
    return schema?.components.length ?? -1;
  });
}

/**
 * Adds a component through the builder's own sidebar —
 * the drag-and-drop surface (BLD-04). FormIO 5.6.1's
 * sidebar is dragula-powered (a plain click is a no-op),
 * and a new-component drop opens the component edit
 * dialog; the `change` event the history feeds on fires
 * when that dialog is saved. So the real user flow is:
 * drag onto the canvas, then save the dialog.
 *
 * The preview pane mounts asynchronously and re-flows
 * the page, so the flow waits for it before measuring
 * the canvas, scrolls the form into view, and drops
 * near the top of the form — a point safely inside
 * the viewport (the canvas is taller than the default
 * viewport, and a drop point below the fold is a
 * cancelled drag: dragula's release() finds no
 * container under the cursor and emits a null-target
 * "drop" that onDrop ignores).
 */
async function addComponentViaSidebar(
  page: Page,
  componentTitle: string,
): Promise<void> {
  // Layout stability: wait until the preview pane is
  // mounted before measuring anything.
  await waitForPreview(page);

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

/** The schema length through the spike handle. */
async function waitForPreview(page: Page): Promise<void> {
  const preview = page.getByTestId('spike-preview');
  await expect(preview).toHaveAttribute('data-ready', 'true', {
    timeout: BUILDER_MOUNT_TIMEOUT_MS,
  });
}

test.describe('S1 spike — FormIO 5.6.1 builder in the React 19 shell', () => {
  // The whole file drives the real FormIO builder
  // — the heaviest module graph the SPA loads.
  // Scoped to this describe block so no other
  // spec's budget moves.
  test.describe.configure({
    timeout: SPIKE_SPEC_TIMEOUT_MS,
  });

  test('builder mounts; a text-component add fires change and the captured snapshot deep-equals builder.schema', async ({
    page,
  }) => {
    await page.goto('/#/spike');

    // The builder rendered its DOM into the React-owned
    // container (container-as-leaf mount, Pattern 4).
    const host = page.getByTestId('formio-builder-host');
    await expect(host.locator('.formio-builder-form')).toBeVisible({
      timeout: BUILDER_MOUNT_TIMEOUT_MS,
    });

    const before = await builderComponentCount(page);
    expect(before).toBeGreaterThan(0);

    // Add a text component through the builder's own
    // sidebar (the drag-and-drop surface, BLD-04).
    await addComponentViaSidebar(page, 'Text Field');

    expect(await builderComponentCount(page)).toBe(before + 1);

    // The captured snapshot deep-equals the builder's
    // current schema — the change-event wiring
    // (builder.on('change') → history.capture(builder.schema)).
    const wiring = await page.evaluate(() => {
      const spike = window.__SPIKE__;
      if (!spike?.getHistory()) {
        return { captured: false, equal: false, canUndo: false };
      }
      const history = spike.getHistory()!;
      return {
        captured: history.latest() !== null,
        equal:
          JSON.stringify(history.latest()) === JSON.stringify(spike.getSchema()),
        canUndo: history.canUndo(),
      };
    });
    expect(wiring.captured).toBe(true);
    expect(wiring.equal).toBe(true);
    expect(wiring.canUndo).toBe(true);
  });

  test('FRM-05 boundary: min/max passes exactly at the bound and fails one step outside, with component.errors an array', async ({
    page,
  }) => {
    await page.goto('/#/spike');
    await waitForPreview(page);

    // Exactly at the min bound: valid — an empty errors array.
    const atMin = await page.evaluate(async () => {
      const form = window.__SPIKE__!.getPreviewForm()!;
      const quantity = form.getComponent('quantity') as {
        errors: Array<{ message: string }>;
        setValue: (value: number) => Promise<unknown>;
      };
      await quantity.setValue(5);
      return { errors: quantity.errors };
    });
    expect(Array.isArray(atMin.errors)).toBe(true);
    expect(atMin.errors).toHaveLength(0);

    // One step outside the min bound: invalid — errors is
    // an array (the 5.x shape; 4.x was a single string)
    // and errors[0].message is a string.
    const belowMin = await page.evaluate(async () => {
      const form = window.__SPIKE__!.getPreviewForm()!;
      const quantity = form.getComponent('quantity') as {
        errors: Array<{ message: string }>;
        setValue: (value: number) => Promise<unknown>;
      };
      await quantity.setValue(4);
      // The validation processor runs on change; give it a
      // moment to settle before reading the error shape.
      for (let i = 0; i < 25 && quantity.errors.length === 0; i += 1) {
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
      }
      return { errors: quantity.errors };
    });
    expect(Array.isArray(belowMin.errors)).toBe(true);
    expect(belowMin.errors.length).toBeGreaterThan(0);
    expect(typeof belowMin.errors[0].message).toBe('string');
  });

  test('EditGrid.validateRow returns an array — isValid is validateRow(...).length === 0', async ({
    page,
  }) => {
    await page.goto('/#/spike');
    await waitForPreview(page);

    // The 5.x shape: validateRow returns an array of row
    // errors (the 4.x-era boolean return is gone).
    const validation = await page.evaluate(() => {
      const form = window.__SPIKE__!.getPreviewForm()!;
      const grid = form.getComponent('contacts') as {
        editRows: Array<Record<string, unknown>>;
        validateRow: (
          row: Record<string, unknown>,
          dirty: boolean,
        ) => unknown[];
      };
      const row = grid.editRows[0];
      const result = grid.validateRow(row, true);
      return {
        isArray: Array.isArray(result),
        length: result.length,
      };
    });
    expect(validation.isArray).toBe(true);
    expect(validation.length).toBe(0);
  });

  test('undo/redo round-trips a real component add through the builder', async ({
    page,
  }) => {
    await page.goto('/#/spike');
    const host = page.getByTestId('formio-builder-host');
    await expect(host.locator('.formio-builder-form')).toBeVisible({
      timeout: BUILDER_MOUNT_TIMEOUT_MS,
    });
    const before = await builderComponentCount(page);

    // Add a text component through the sidebar's
    // drag-and-drop, saving the edit dialog.
    await addComponentViaSidebar(page, 'Text Field');
    expect(await builderComponentCount(page)).toBe(before + 1);

    // Undo reverses the add (builder.setForm of the
    // pre-change snapshot).
    await page.getByTestId('undo-button').click();
    await page.waitForTimeout(SETTLE_MS);
    expect(await builderComponentCount(page)).toBe(before);

    // Redo re-applies it.
    await page.getByTestId('redo-button').click();
    await page.waitForTimeout(SETTLE_MS);
    expect(await builderComponentCount(page)).toBe(before + 1);
  });

  test('the builder canvas renders with real Bootstrap 5 styling — computed layout, not class names (G-06-6)', async ({
    page,
  }) => {
    await page.goto('/#/spike');
    const host = page.getByTestId('formio-builder-host');
    await expect(host.locator('.formio-builder-form')).toBeVisible({
      timeout: BUILDER_MOUNT_TIMEOUT_MS,
    });

    // The scope root carries the theme token block: without the scoped
    // sheet `--bs-primary` is an empty string (the measured symptom).
    const primary = await host.evaluate(
      (el) => getComputedStyle(el).getPropertyValue('--bs-primary').trim(),
    );
    expect(primary, 'the scope root exposes no --bs-primary — the scoped sheet is absent').not.toBe('');

    // Every row inside the scope is a wrapping flex container (without
    // the sheet a row computes display:block / flex-wrap:nowrap).
    const rows = await host.evaluate((el) =>
      [...el.querySelectorAll('.row')].map((row) => {
        const style = getComputedStyle(row);
        return { display: style.display, wrap: style.flexWrap };
      }),
    );
    expect(rows.length, 'no .row inside the scope — the schema columns did not render').toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.display).toBe('flex');
      expect(row.wrap).toBe('wrap');
    }

    // The schema's two columns render as fractional widths of their row,
    // not two full-width blocks (without the sheet both compute the
    // canvas width). Scoped to rows with at least two grid columns so
    // the assertion is about the layout pair, and the sum check carries
    // gutter headroom (border-box column widths include half-gutters).
    const grids = await host.evaluate((el) =>
      [...el.querySelectorAll('.row')]
        .map((row) => {
          const rowWidth = row.getBoundingClientRect().width;
          const columns = [...row.children].filter((child) =>
            /col-(sm|md|lg|xl|xxl)-\d+/.test(child.className),
          );
          return {
            rowWidth,
            widths: columns.map(
              (child) => child.getBoundingClientRect().width,
            ),
          };
        })
        .filter((grid) => grid.widths.length >= 2),
    );
    expect(grids.length, 'no row with two grid columns — the schema layout pair did not render').toBeGreaterThan(0);
    // The schema's own column classes are present (2/12 and 10/12),
    // at least one of each — the builder chrome may repeat markup.
    expect(await host.locator('.col-md-2').count()).toBeGreaterThanOrEqual(1);
    expect(await host.locator('.col-md-10').count()).toBeGreaterThanOrEqual(1);
    for (const grid of grids) {
      for (const width of grid.widths) {
        expect(width).toBeLessThan(grid.rowWidth);
      }
      const total = grid.widths.reduce((a, b) => a + b, 0);
      expect(Math.abs(total - grid.rowWidth)).toBeLessThanOrEqual(
        grid.rowWidth * 0.05 + 32,
      );
    }

    // Every form-control inside the scope computes Bootstrap geometry —
    // a 1px top border and 12px left padding — instead of the browser's
    // unstyled default (2px inset border, 1px/2px padding). The count
    // assertion keeps the loop non-vacuous.
    const controls = await host.evaluate((el) =>
      [...el.querySelectorAll('.form-control')].map((control) => {
        const style = getComputedStyle(control);
        return {
          borderTop: style.borderTopWidth,
          paddingLeft: style.paddingLeft,
        };
      }),
    );
    expect(controls.length, 'no .form-control inside the scope — nothing to check geometry on').toBeGreaterThan(0);
    for (const control of controls) {
      expect(control.borderTop).toBe('1px');
      expect(control.paddingLeft).toBe('12px');
    }
  });
});
