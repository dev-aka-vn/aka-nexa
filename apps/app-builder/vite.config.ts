import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * App Builder SPA.
 *
 * `root` is this file's directory, so
 * `npx vite --config apps/app-builder/vite.config.ts`
 * from the repo root (Playwright's webServer, and the
 * workspace build script) serves the SPA rather than
 * the repo root.
 *
 * The `/api` dev proxy mirrors the renderer's dev
 * posture: the browser SPA talks to the API origin
 * through one origin story in dev, and the production
 * SPA is served same-origin from the API's static
 * surface (T-06-03: the proxy is dev-only; no
 * credentials cross it beyond the same-origin cookie).
 */

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3000';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_ORIGIN,
        changeOrigin: true,
        // The API serves its routes at the root
        // (no `/api` prefix — the controllers
        // are mounted unprefixed), so the proxy
        // strips the key it is addressed by.
        // Without the rewrite every proxied
        // call 404s against the API.
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
