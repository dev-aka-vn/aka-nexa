import { devices, defineConfig } from '@playwright/test';

/**
 * Playwright configuration for the app-builder SPA and the
 * signer renderer.
 *
 * The desktop chromium project is the primary
 * verification surface (the S1 spike runs here).
 * The tablet project — 768×1024 with touch
 * emulation — is the BLD-09 responsive surface
 * every later UI plan runs its tablet specs
 * against.
 *
 * The `renderer` and `renderer-tablet` projects are the
 * G-06-8 signer surface: the read and edit pages served by
 * the renderer's own dev server on 5174, asserting by
 * computed style that the authored form renders with the
 * layout its schema describes.
 *
 * Each app boots its own dev server: `webServer` is an
 * array — the SPA on 5173 rooted at apps/app-builder, the
 * renderer on 5174 rooted at apps/renderer — and `testDir`
 * and `baseURL` live per project, not at the top level.
 *
 * `testDir` is scoped per project rather than repo-wide. A
 * root-wide match for e2e spec files also collected
 * `tests/e2e/slack-leave.e2e.spec.ts` — a
 * vitest stub (it imports `describe`/`it` from
 * 'vitest'), which made a bare `npx playwright
 * test` die at collection time with "Cannot read
 * properties of undefined (reading 'config')"
 * before a single spec ran. The same hazard applies to
 * the renderer side: `apps/renderer/src/read/view.spec.ts`
 * and `apps/renderer/src/read/edit.spec.ts` are vitest
 * specs matching the spec glob, so the renderer
 * projects' `testDir` MUST be the dedicated
 * `apps/renderer/e2e` directory — pointing one at
 * `apps/renderer` reproduces exactly the collection-time
 * abort this comment already documents for the repo root.
 * Scoping to the directories each config actually
 * describes also means a future non-SPA Playwright suite
 * in `tests/` gets its own config instead of being
 * silently swallowed by this one.
 */
export default defineConfig({
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'html' : 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testDir: './apps/app-builder/e2e',
      // The builder canvas is taller than the default
      // 720px viewport; a drag-drop that lands below
      // the fold is a cancelled drag (dragula finds no
      // container under the cursor), so the primary
      // verification surface gets a viewport that
      // fits the whole canvas.
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 1024 },
        baseURL: 'http://localhost:5173',
      },
    },
    {
      // BLD-09's responsive surface: every later UI
      // plan runs its tablet specs against this
      // project — 768x1024 with touch emulation.
      // Chromium-backed (the installed browser); the
      // iPad device preset is deliberately NOT
      // spread here — its defaultBrowserType is
      // webkit, which this environment cannot
      // install (no OS-deps access).
      name: 'tablet',
      testDir: './apps/app-builder/e2e',
      use: {
        viewport: { width: 768, height: 1024 },
        hasTouch: true,
        isMobile: true,
        baseURL: 'http://localhost:5173',
      },
    },
    {
      // G-06-8's signer surface: the renderer read and
      // edit pages on their own dev server. Desktop
      // Chrome at the same 1280x1024 viewport as the
      // primary surface so the two are comparable.
      name: 'renderer',
      testDir: './apps/renderer/e2e',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 1024 },
        baseURL: 'http://localhost:5174',
      },
    },
    {
      // The signer surface at the BLD-09 narrow
      // viewport — the same 768x1024 touch profile as
      // the tablet project, so a column that collapses
      // to full width here fails exactly where the
      // app-builder suite would catch it there.
      name: 'renderer-tablet',
      testDir: './apps/renderer/e2e',
      use: {
        viewport: { width: 768, height: 1024 },
        hasTouch: true,
        isMobile: true,
        baseURL: 'http://localhost:5174',
      },
    },
  ],
  webServer: [
    {
      command: 'npx vite --config apps/app-builder/vite.config.ts',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npx vite --config apps/renderer/vite.config.ts',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
