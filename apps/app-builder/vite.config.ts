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
 *
 * ## Why `/auth` is proxied too, and why it has no `rewrite`
 *
 * The OIDC login routes are the API's own, mounted at the root
 * (`/auth/oidc/begin`, `/auth/oidc/callback`), so this entry
 * forwards them unchanged — callers already address the real
 * path. That is the one way it differs from `/api`, which the
 * SPA addresses with a key the API does not serve under and
 * which is therefore stripped. Adding the entry is what lets the
 * callback land on the SPA origin instead of the API's bare root:
 * `oidc.service.ts` re-derives the callback's `redirect_uri` from
 * the live request (`${req.protocol}://${req.get('host')}${req.originalUrl}`),
 * and the stub issuer rejects a token exchange whose
 * `redirect_uri` differs from the one it issued. Host preservation
 * matches `/api`, for the same Origin/Host and redirect-URI reasons.
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
      // `/auth/...` is already the API's own path — its routes are
      // mounted at the root — so there is deliberately no `rewrite`
      // here (one would corrupt the path). See the header for why the
      // entry exists: it lets the OIDC callback finish on the SPA
      // origin. Host preservation matches `/api`.
      '/auth': {
        target: API_ORIGIN,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
