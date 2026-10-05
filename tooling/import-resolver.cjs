/**
 * Minimal `import/resolver` for the boundary lint gate (FND-04).
 *
 * `eslint-plugin-boundaries` resolves import specifiers through
 * `eslint-module-utils/resolve`, which defaults to `eslint-import-resolver-node`.
 * That resolver only tries `['.mjs', '.js', '.json', '.node']` and, critically,
 * does **not** map the `.js` specifier NodeNext requires onto the `.ts` source it
 * actually names. Every relative import in this repo is written
 * `from './foo.js'` under `module: NodeNext`, so without this file
 * `resolve()` returns `undefined` for all of them and the boundary rule is
 * **silently inert** — every dependency falls into the "unknown local target"
 * bucket and the rule returns early. That is precisely the silent
 * under-enforcement FND-04 exists to prevent, so the mapping has to exist
 * somewhere. This is the smallest place to put it.
 *
 * Three responsibilities, all load-bearing:
 *
 * 1. `./foo.js` -> `./foo.ts` for relative specifiers.
 * 2. `@akane/<pkg>` -> `<workspace>/src/index.ts`.
 * 3. `@akane/<pkg>/<subpath>` -> `<workspace>/src/<subpath>/index.ts`, falling
 *    back to `<workspace>/src/<subpath>.ts`.
 *
 * 2 and 3 are the same responsibility and they have to be fixed together.
 * `package.json#exports` sends **every** workspace specifier, subpath or not,
 * to `dist/…js` under `node_modules`. `node_modules` is the plugin's definition
 * of `external`, and policy 0 allows `external` unconditionally, so
 * `import { X } from '@akane/platform'` inside `packages/kernel` would be
 * classified a third-party dependency and pass unexamined — a cross-package
 * boundary violation that reads like ordinary element graph inside the
 * local-origin branch the rules are written for.
 *
 * Mapping only the **bare** form (as this file originally did) leaves the
 * subpath form exactly as invisible, and the subpath form is not hypothetical:
 * all three entrypoints import `@akane/platform/otel`, which `package.json`
 * declares as a deep entry precisely so it can load before the instrumented
 * modules (D-20). `tooling/boundaries.fixture.spec.ts` pins both forms, in the
 * violation direction and in the compliant direction, because a resolver that
 * maps one and misses the other is precisely as blind as one that maps neither.
 *
 * Everything else is delegated to Node unchanged, so `@nestjs/*` still resolves
 * into `node_modules` and is classified `external` as intended.
 */

'use strict';

// eslint-module-utils/resolve loads an import/resolver with CommonJS
// require(), so this file cannot be ESM. That is the only reason it is a .cjs
// with require() calls, which the TS-ESLint recommended set forbids by
// default - the rule has no way to know the file is required to be CJS.
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const requireFromFile = createRequire(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_LINKS = path.join(REPO_ROOT, 'node_modules', '@akane');

/** Extensions tried for an extensionless or `.js`-suffixed relative specifier. */
const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];
const JS_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'];
/** Every extension a workspace entry may carry, TS first. */
const ENTRY_EXTENSIONS = [...TS_EXTENSIONS, ...JS_EXTENSIONS];

/**
 * The first candidate that exists as a file, or `null`.
 *
 * @param {readonly string[]} candidates
 * @returns {string | null}
 */
function firstFile(candidates) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * NodeNext's output convention again, one level up: `@akane/platform/otel.js`
 * names `src/otel.ts` (or `src/otel/index.ts`) on disk.
 *
 * @param {string} specifier workspace subpath, without the package name
 * @returns {string}
 */
function stripJsExtension(specifier) {
  const extension = path.extname(specifier);
  return JS_EXTENSIONS.includes(extension) ? specifier.slice(0, -extension.length) : specifier;
}

/**
 * `@akane/<pkg>` -> the workspace's own `src/index.ts`, and
 * `@akane/<pkg>/<subpath>` -> the workspace's own `src/<subpath>`.
 *
 * npm workspaces symlinks each package into `node_modules/@akane`, and the
 * package `exports` map points at `dist/index.js`. Following that map would
 * classify a cross-workspace import as `external` — the plugin's word for a
 * third-party dependency — and the element graph would never see it. Following
 * the symlink to the real package root and entering at `src/` keeps the import
 * inside the local-origin branch the policies are written for.
 *
 * The **subpath** half is not optional tidiness: it is the same defect. An
 * `exports` entry like `"./otel"` sends the specifier into
 * `node_modules/@akane/platform/dist/otel/index.js`, which is `external`, which
 * policy 0 allows unconditionally — so `@akane/platform/crypto` imported from
 * `packages/contract` (whose only allowed edges are `['kernel']`) reads as
 * compliant. That is gap G-1 in `01-VERIFICATION.md`, and it defeats Phase 1's
 * third success criterion: "a module that imports across a declared component
 * boundary fails the build".
 *
 * `src/<subpath>/index.ts` is tried before `src/<subpath>.ts` because every
 * subfolder barrel in this repo is a directory, which is also the shape
 * `package.json#exports` declares (`"./otel" -> ./dist/otel/index.js`).
 *
 * @param {string} source bare specifier, e.g. `@akane/platform` or
 *   `@akane/platform/otel`
 * @returns {{ found: true, path: string } | { found: false }}
 */
function resolveWorkspacePackage(source) {
  const [, name, ...rest] = source.split('/');
  const subpath = rest.join('/');
  // A workspace name or subpath that walks out of the package root is not a
  // workspace specifier; let it fall through to Node's own resolution, which is
  // the authority on what a real package layout is.
  if (!name || name === '.' || name === '..' || subpath.split('/').includes('..')) {
    return { found: false };
  }

  let realRoot;
  try {
    realRoot = fs.realpathSync(path.join(WORKSPACE_LINKS, name));
  } catch {
    return { found: false };
  }

  const srcRoot = path.join(realRoot, 'src');
  if (subpath === '') {
    const root = firstFile(ENTRY_EXTENSIONS.map((ext) => path.join(srcRoot, `index${ext}`)));
    return root === null ? { found: false } : { found: true, path: root };
  }

  const stem = stripJsExtension(subpath);
  const entry =
    firstFile(ENTRY_EXTENSIONS.map((ext) => path.join(srcRoot, stem, `index${ext}`))) ??
    firstFile(ENTRY_EXTENSIONS.map((ext) => path.join(srcRoot, `${stem}${ext}`)));

  return entry === null ? { found: false } : { found: true, path: entry };
}

/**
 * Node's ESM output convention: `./foo.js` may name `./foo.ts` on disk.
 *
 * @param {string} basePath absolute, extension-suffixed path
 * @returns {string | null}
 */
function resolveWithTsExtensions(basePath) {
  const extension = path.extname(basePath);
  if (!JS_EXTENSIONS.includes(extension)) return null;
  const stem = basePath.slice(0, -extension.length);
  for (const candidate of TS_EXTENSIONS) {
    const tsPath = `${stem}${candidate}`;
    if (fs.existsSync(tsPath) && fs.statSync(tsPath).isFile()) return tsPath;
  }
  return null;
}

/**
 * `eslint-import-resolver` interface v2.
 *
 * @type {{ interfaceVersion: 2, resolve: (source: string, file: string) => { found: boolean, path: string | null } }}
 */
module.exports = {
  interfaceVersion: 2,
  resolve(source, file) {
    if (!source.startsWith('.')) {
      // Workspace packages are resolved to their own source entrypoint so the
      // element graph sees them as local, not as third-party dependencies.
      if (source.startsWith('@akane/')) {
        const workspace = resolveWorkspacePackage(source);
        if (workspace.found) return workspace;
      }

      // Any other bare specifier: Node resolution, unchanged. `@nestjs/*` lands
      // in node_modules and the plugin classifies it `external`, which is
      // exactly what R2/R3 need to inspect.
      try {
        return { found: true, path: requireFromFile.resolve(source) };
      } catch {
        return { found: false };
      }
    }

    const basePath = path.resolve(path.dirname(file), source);

    const direct = resolveWithTsExtensions(basePath);
    if (direct !== null) return { found: true, path: direct };

    if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
      return { found: true, path: basePath };
    }

    for (const extension of [...TS_EXTENSIONS, ...JS_EXTENSIONS, '.json']) {
      const candidate = `${basePath}${extension}`;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { found: true, path: candidate };
      }
    }

    for (const extension of [...TS_EXTENSIONS, ...JS_EXTENSIONS]) {
      const candidate = path.join(basePath, `index${extension}`);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { found: true, path: candidate };
      }
    }

    return { found: false };
  },
};
