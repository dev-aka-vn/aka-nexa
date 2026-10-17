/**
 * Dev proxy shape — the SPA's dev proxy must preserve the browser Host.
 *
 * ## The failure this file exists to prevent
 *
 * `403 CSRF_ORIGIN_MISMATCH` on every state-changing request from the App
 * Builder SPA in the dev stack. The API's CSRF gate
 * (`apps/api/src/auth/session.middleware.ts`, the T-06-04 / D-101 second layer)
 * refuses a POST/PUT/PATCH/DELETE unless `new URL(origin).host === req.get('host')`.
 * A Vite proxy entry with `changeOrigin: true` rewrites the forwarded `Host` to the
 * target's (`127.0.0.1:3000`), so the API observes a cross-origin request even
 * though the browser sent a same-origin `Origin` — every write 403s while reads
 * (`GET`) keep working, and the SPA only looks half-functional. The fix is Host
 * preservation at the proxy: `changeOrigin: false`.
 *
 * ## The two suites that missed it, and why
 *
 * - `apps/app-builder/e2e/*.spec.ts` satisfy every `/api/**` call with `page.route`,
 *   so the real API — and therefore the CSRF gate — is never exercised through the
 *   SPA.
 * - `apps/api/src/auth/auth.session.integration.spec.ts:350-399` calls the API
 *   directly on a single origin, so the gate always passes there.
 *
 * Nothing exercised "the SPA's dev proxy against the real API" — the only path a
 * developer actually walks.
 *
 * ## The gate is frozen
 *
 * This guard protects the **proxy contract**. It must never be read as a reason to
 * weaken the CSRF gate: the gate and its regression test stay exactly as written,
 * and the proxy is the thing that must conform to them.
 *
 * ## Deterministic and boundary-safe
 *
 * `apps/app-builder/vite.config.ts` is read as **text** with `node:fs`/`node:path`,
 * never imported: `eslint-plugin-boundaries` forbids `tooling/` importing
 * `apps/app-builder`, and reading the file keeps the spec free of ports, dev
 * servers and network — the same shape as `tooling/deployment-shape.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const VITE_CONFIG = path.join(REPO_ROOT, 'apps', 'app-builder', 'vite.config.ts');

/**
 * Strip block comments and line comments, so documentation prose can neither
 * satisfy nor trip an assertion.
 *
 * The line-comment pattern deliberately refuses to treat `://` as a comment
 * opener (`[^:]` before `//`), because this repository's config is full of URLs
 * and cutting a line at `'http://…'` corrupts it silently — the trap
 * `tooling/entrypoint-drift.spec.ts` documents.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Return the balanced `{ … }` slice starting at `openAt` (inclusive). */
function sliceBalanced(source: string, openAt: number): string {
  let depth = 0;
  for (let i = openAt; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openAt, i + 1);
    }
  }
  throw new Error('unbalanced braces while parsing the proxy block');
}

/**
 * The `server.proxy` block: from the first `{` after `proxy:` to its matching
 * `}`. Throws rather than returning `''`, so a broken parse fails loudly instead
 * of making every assertion below pass vacuously.
 */
function findProxyBlock(source: string): string {
  const marker = 'proxy:';
  const markerAt = source.indexOf(marker);
  if (markerAt === -1) {
    throw new Error('server.proxy not found in apps/app-builder/vite.config.ts');
  }
  const braceAt = source.indexOf('{', markerAt + marker.length);
  if (braceAt === -1) {
    throw new Error('server.proxy has no block');
  }
  return sliceBalanced(source, braceAt);
}

interface ProxyEntry {
  /** The quoted path key, e.g. `/api`. */
  readonly key: string;
  /** The entry's own balanced `{ … }` body. */
  readonly body: string;
}

/**
 * Slice the proxy block into its **top-level** entries. Matching a quoted key
 * followed by `: {` and brace-matching that entry's own body is what keeps one
 * entry's body from leaking into the next — without per-entry slicing, `/api`'s
 * body would satisfy an assertion meant for `/auth`, and the assertion would
 * pass vacuously.
 */
function parseProxyEntries(block: string): ProxyEntry[] {
  const entries: ProxyEntry[] = [];
  const opener = /(['"])([^'"]*)\1\s*:\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(block)) !== null) {
    const key = match[2];
    const braceAt = match.index + match[0].length - 1;
    const body = sliceBalanced(block, braceAt);
    entries.push({ key, body });
    // Resume scanning *after* this entry's body so nested braces are not read as
    // further top-level entries.
    opener.lastIndex = braceAt + body.length;
  }
  return entries;
}

describe('dev proxy shape — the SPA dev proxy must preserve the Host', () => {
  const source = stripComments(readFileSync(VITE_CONFIG, 'utf8'));
  const proxyBlock = findProxyBlock(source);
  const entries = parseProxyEntries(proxyBlock);
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));

  it('the parse actually found the proxy entries (non-vacuity, runs first)', () => {
    expect(proxyBlock, 'the server.proxy block was not found — the parser is broken').toBeTruthy();
    expect(
      entries.length,
      'the parser found fewer than two proxy entries — it is broken, and every assertion below would pass vacuously',
    ).toBeGreaterThanOrEqual(2);
    expect(
      [...byKey.keys()],
      'the /api proxy entry is missing — the SPA cannot reach the API in dev',
    ).toContain('/api');
  });

  it('every proxy entry declares a target and none rewrites the Host', () => {
    const missingTarget = entries
      .filter((entry) => !/\btarget\s*:/.test(entry.body))
      .map((entry) => entry.key);
    expect(missingTarget, 'a proxy entry declares no target').toEqual([]);

    const rewriting = entries
      .filter((entry) => /\bchangeOrigin\s*:\s*true\b/.test(entry.body))
      .map((entry) => entry.key);
    expect(
      rewriting,
      'a proxy entry sets changeOrigin: true — it rewrites the forwarded Host to the target\'s, so every state-changing request through it answers 403 CSRF_ORIGIN_MISMATCH at the API CSRF gate',
    ).toEqual([]);
  });

  it('the /api entry explicitly preserves the Host', () => {
    const api = byKey.get('/api');
    expect(api, 'the /api proxy entry is missing').toBeDefined();
    expect(
      /\bchangeOrigin\s*:\s*false\b/.test(api?.body ?? ''),
      'the /api proxy entry must set changeOrigin: false — anything else rewrites the Host and reintroduces 403 CSRF_ORIGIN_MISMATCH on every write',
    ).toBe(true);
  });

  it('the /auth entry preserves the Host and declares no path rewrite', () => {
    const auth = byKey.get('/auth');
    expect(
      auth,
      'the /auth proxy entry is missing — the OIDC callback cannot land on the SPA origin without it',
    ).toBeDefined();
    expect(
      /\bchangeOrigin\s*:\s*false\b/.test(auth?.body ?? ''),
      'the /auth proxy entry must set changeOrigin: false — the callback redirect_uri is derived from the live Host',
    ).toBe(true);
    expect(
      /\brewrite\s*:/.test(auth?.body ?? ''),
      "the /auth entry must declare no rewrite — /auth/... is already the API's own path, so a rewrite would corrupt it",
    ).toBe(false);
  });
});
