/**
 * G-06-8 — the signer-facing renderer renders the authored
 * form with the layout its schema describes, measured by
 * computed style on a real rendered page.
 *
 * The renderer had no browser-level test at all: its specs
 * assert import *strings* (edit.spec.ts, view.spec.ts),
 * which is the assertion class that passed while the signer
 * form rendered unstyled. This spec inverts the measured
 * symptom instead: the scope root exposes a non-empty theme
 * token, rows are wrapping flex containers, the schema's
 * columns are fractions of their row, and form-controls
 * compute Bootstrap geometry — at 1280px (renderer project)
 * and at 768px (renderer-tablet project).
 *
 * Both viewports must hold: the asserted column classes are
 * `col-md-*`, whose breakpoint is min-width 768px, so at
 * exactly 768px they are still fractional — a collapse to
 * full width there is a regression, not responsiveness.
 */

import { expect, test } from '@playwright/test';

/**
 * The budget for the engine to load and the form to mount.
 * The read page pulls the same `@formio/js` graph the
 * designer mounts; the mount is the only cold-path wait
 * (dev-server on-demand transform plus parse/execute), so
 * it gets the same headroom the app-builder specs allow
 * their builder mount — every assertion after it keeps
 * its own tight wait.
 */
const RENDERER_MOUNT_TIMEOUT_MS = 60_000;

/**
 * The per-test budget for this spec: the mount headroom
 * above, plus the computed-style reads. Scoped to this
 * describe block so no other spec's budget moves.
 */
const RENDERER_SPEC_TIMEOUT_MS = 120_000;

/** The read page's dev-server path (vite root is apps/renderer). */
const VIEW_PATH = '/src/read/view.html';

/**
 * The authored layout under test: one two-column row,
 * widths 2 and 10, each holding one text field — the same
 * layout pair the designer guard (s1-spike.spec.ts, G-06-6)
 * proves on the canvas. Without the scoped sheet the row
 * computes display:block and both columns span the full
 * row; with it the row is a wrapping flex container and
 * the columns are 2/12 and 10/12 of it.
 */
const TWO_COLUMN_SCHEMA = {
  display: 'form',
  components: [
    {
      type: 'columns',
      key: 'signerLayout',
      columns: [
        {
          width: 2,
          components: [
            {
              type: 'textfield',
              key: 'layoutFirst',
              label: 'Layout first',
              input: true,
            },
          ],
        },
        {
          width: 10,
          components: [
            {
              type: 'textfield',
              key: 'layoutLast',
              label: 'Layout last',
              input: true,
            },
          ],
        },
      ],
    },
  ],
};

/** A read-link payload whose submission carries the layout pair. */
function viewPayload(): Record<string, unknown> {
  return {
    claims: {
      jti: '',
      action: 'view',
      app_id: 'signer-style-probe',
      form_id: 'probe',
      form_version: 1,
      sub: 'signer',
    },
    submission: {
      _id: 'probe-submission',
      form_schema: TWO_COLUMN_SCHEMA,
      data: { layoutFirst: 'Ada', layoutLast: 'Lovelace' },
    },
    status: 'completed',
  };
}

test.describe('signer renderer layout (G-06-8)', () => {
  test.describe.configure({
    timeout: RENDERER_SPEC_TIMEOUT_MS,
  });

  test('the read page renders the authored two-column layout with Bootstrap geometry', async ({
    page,
  }) => {
    // The read page derives its fetch origin from the page
    // origin with a string substitution (`'renderer'` ->
    // `'api'`) that is a no-op on the dev server, so the
    // request goes to the dev server's own origin — and
    // the path segment it extracts for the link id
    // (`pathname.split('/l/view/')[1]`) is absent under
    // the dev-server path, so the request URL is the bare
    // link path with an empty id (`/l/view/?token=...`).
    // The intercept matches the link path prefix as a
    // URL-pattern regex, not a glob with a trailing
    // wildcard, because the query string follows the
    // trailing separator directly. The page uses only the
    // Fetch API and the engine, so no /api proxy is
    // involved — and none exists on this dev server.
    await page.route(/\/l\/view\//, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(viewPayload()),
      });
    });

    await page.goto(`${VIEW_PATH}?token=probe-token`);

    const mount = page.locator('#formio-readonly');
    await expect(
      mount.locator('.form-control').first(),
    ).toBeVisible({ timeout: RENDERER_MOUNT_TIMEOUT_MS });

    // The mount container carries the scope class — the
    // boundary that keeps the Bootstrap rule set off the
    // page's own token block and its own .card class.
    // (The class is asserted structurally here; everything
    // below is computed style, which is what proves the
    // sheet actually reached the subtree.)
    await expect(mount).toHaveClass(/formio-scope/);

    // The scope root carries the theme token block: without
    // the scoped sheet `--bs-primary` is an empty string
    // (the measured symptom).
    const primary = await mount.evaluate(
      (el) => getComputedStyle(el).getPropertyValue('--bs-primary').trim(),
    );
    expect(
      primary,
      'the scope root exposes no --bs-primary — the scoped sheet is absent',
    ).not.toBe('');

    // Every row inside the scope is a wrapping flex
    // container (without the sheet a row computes
    // display:block / flex-wrap:nowrap).
    const rows = await mount.evaluate((el) =>
      [...el.querySelectorAll('.row')].map((row) => {
        const style = getComputedStyle(row);
        return { display: style.display, wrap: style.flexWrap };
      }),
    );
    expect(
      rows.length,
      'no .row inside the scope — the schema columns did not render',
    ).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.display).toBe('flex');
      expect(row.wrap).toBe('wrap');
    }

    // The schema's two columns render as fractional widths
    // of their row, not two full-width blocks (without the
    // sheet both compute the row width). Scoped to rows
    // with at least two grid columns so the assertion is
    // about the layout pair, and the sum check carries
    // gutter headroom (border-box column widths include
    // half-gutters).
    const grids = await mount.evaluate((el) =>
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
    expect(
      grids.length,
      'no row with two grid columns — the schema layout pair did not render',
    ).toBeGreaterThan(0);
    // The schema's own column classes are present (2/12
    // and 10/12) — each loop below is then about them.
    expect(await mount.locator('.col-md-2').count()).toBeGreaterThanOrEqual(1);
    expect(await mount.locator('.col-md-10').count()).toBeGreaterThanOrEqual(1);
    for (const grid of grids) {
      for (const width of grid.widths) {
        expect(width).toBeLessThan(grid.rowWidth);
      }
      const total = grid.widths.reduce((a, b) => a + b, 0);
      expect(Math.abs(total - grid.rowWidth)).toBeLessThanOrEqual(
        grid.rowWidth * 0.05 + 32,
      );
    }

    // Every form-control inside the scope computes Bootstrap
    // geometry — a 1px top border and 12px left padding —
    // instead of the browser's unstyled default (2px inset
    // border, 1px/2px padding). The count assertion keeps
    // the loop non-vacuous.
    const controls = await mount.evaluate((el) =>
      [...el.querySelectorAll('.form-control')].map((control) => {
        const style = getComputedStyle(control);
        return {
          borderTop: style.borderTopWidth,
          paddingLeft: style.paddingLeft,
        };
      }),
    );
    expect(
      controls.length,
      'no .form-control inside the scope — nothing to check geometry on',
    ).toBeGreaterThan(0);
    for (const control of controls) {
      expect(control.borderTop).toBe('1px');
      expect(control.paddingLeft).toBe('12px');
    }
  });
});
