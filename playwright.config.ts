import { devices, defineConfig } from '@playwright/test';

/**
 * Playwright configuration for the app-builder SPA.
 *
 * The desktop chromium project is the primary
 * verification surface (the S1 spike runs here).
 * The tablet project — 768×1024 with touch
 * emulation — is the BLD-09 responsive surface
 * every later UI plan runs its tablet specs
 * against.
 *
 * The webServer boots the SPA dev server (vite,
 * rooted at apps/app-builder) before any spec
 * runs.
 */
export default defineConfig({
  testDir: './',
  testMatch: '**/e2e/**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'html' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      // The builder canvas is taller than the default
      // 720px viewport; a drag-drop that lands below
      // the fold is a cancelled drag (dragula finds no
      // container under the cursor), so the primary
      // verification surface gets a viewport that
      // fits the whole canvas.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 1024 } },
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
      use: {
        viewport: { width: 768, height: 1024 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: 'npx vite --config apps/app-builder/vite.config.ts',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
