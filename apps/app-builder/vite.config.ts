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
 * ## Why the `/api` proxy preserves the Host
 * (`changeOrigin` must stay `false`)
 *
 * The API's CSRF gate (`apps/api/src/auth/session.middleware.ts`,
 * the T-06-04 / D-101 second layer) refuses a state-changing
 * request — POST/PUT/PATCH/DELETE — unless the request's
 * `Origin` host equals the request's `Host`:
 *
 *     new URL(origin).host === req.get('host')
 *
 * A browser SPA at `http://127.0.0.1:5173` sends
 * `Origin: http://127.0.0.1:5173`, which is same-origin for
 * the page. A proxy that rewrites the forwarded `Host` to the
 * target's (`127.0.0.1:3000`) makes the API observe a
 * cross-origin request even though the browser sent a
 * same-origin `Origin`, so *every* write answers
 * `403 CSRF_ORIGIN_MISMATCH` while reads (`GET`) still work —
 * the SPA only looks half-functional.
 *
 * Host preservation is therefore required, not cosmetic: it is
 * the whole reason this proxy exists in this shape, and it is
 * what makes the dev stack behave like production, where the
 * API serves the SPA same-origin and no proxy exists at all
 * (T-06-03: the proxy is dev-only; no credentials cross it
 * beyond the same-origin cookie).
 *
 * **Warning:** restoring the rewrite (`changeOrigin: true`)
 * brings back `403 CSRF_ORIGIN_MISMATCH` on every write while
 * reads keep working. `tooling/dev-proxy-shape.spec.ts` is the
 * guard that fails if that value returns.
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
        // Preserve the browser's Host. See the header: rewriting
        // it turns every state-changing request into a
        // `403 CSRF_ORIGIN_MISMATCH` at the API's CSRF gate while
        // leaving reads (GET) working.
        changeOrigin: false,
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
