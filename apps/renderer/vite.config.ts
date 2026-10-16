import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Signer renderer (dev/test only).
 *
 * `root` is this file's directory, so
 * `npx vite --config apps/renderer/vite.config.ts`
 * from the repo root (Playwright's webServer) serves the
 * renderer app — making the signer pages (`src/read/view.html`,
 * `src/read/edit.html`) browser-loadable for the first time.
 * The renderer has no `package.json` of its own, so
 * bare-specifier resolution (notably `@formio/js`) walks up
 * to the workspace root's `node_modules` — the root
 * `package.json` declares `workspaces`, which is how the
 * renderer's engine import resolves today.
 *
 * There are deliberately NO proxy entries: the renderer never
 * calls the builder API. Both signer pages fetch their link
 * payload same-origin (`window.location.origin` with a
 * no-op substitution), and every spec fulfils its own
 * responses via `page.route`, so no request ever leaves
 * the dev server.
 *
 * No `publicDir`, no `appType` override, no plugin — the
 * renderer serves static HTML plus two TypeScript browser
 * entries that the dev server transforms on demand.
 *
 * Contingency (not currently needed): if the dev server ever
 * refuses to serve the engine module from outside its root,
 * add an explicit `resolve.alias` for the engine package and
 * a `server.fs.allow` entry for the workspace root. Do NOT
 * instead copy or vendor the dependency.
 */

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: {
    port: 5174,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
