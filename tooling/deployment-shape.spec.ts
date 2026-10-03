/**
 * Deployment shape — the production install must be able to boot (WINDOWS.md #8).
 *
 * ## The defect this file exists to prevent
 *
 * Every dependency in this repository lived in the root **`devDependencies`**,
 * including `ioredis` and `mongodb`, which are imported by
 * `packages/platform/src/{redis,mongo}` and therefore compile into `dist/` and are
 * loaded at boot. `npm ci --omit=dev` therefore produced a tree containing
 * TypeScript, ESLint and Vitest and *no database driver* — an install that
 * succeeds and a process that cannot start. That is the worst shape for a
 * deployment bug: the failure surfaces at container start, not at image build.
 *
 * ## The decision, made once (not on every plan that trips over it)
 *
 * **The rule is: a package the built runtime can reach belongs in root
 * `dependencies`; everything else belongs in `devDependencies`.**
 *
 * It is a root-level split because this is a single-hoisting npm-workspaces repo:
 * `packages/*` and `apps/*` declare no `dependencies` field of their own, npm
 * hoists everything to the root `node_modules`, and a deployment installs the
 * root tree and runs three entrypoints out of it. Giving each workspace its own
 * manifest would be more conventional npm hygiene, but it would also mean 20 pins
 * restated in four files with no mechanism keeping them equal to the root's — a
 * second drift risk in exchange for tidiness no process reads. The workspaces stay
 * dependency-free on purpose (D-01: `packages/kernel` has *zero* `dependencies`).
 *
 * The test below is what makes "once" mean something: it re-derives the runtime
 * set from the sources on every commit, so a new import that lands in
 * `devDependencies` is a red test rather than a second deployment-shaped defect.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const ROOT_MANIFEST = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
) as {
  workspaces: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const RUNTIME_DEPENDENCIES = Object.keys(ROOT_MANIFEST.dependencies ?? {});
const DEV_DEPENDENCIES = Object.keys(ROOT_MANIFEST.devDependencies ?? {});

/** `import … from 'x'`, `export … from 'x'`, `import 'x'`, `import('x')`. */
const SPECIFIER_PATTERNS = [
  /(?:^|\n)[^\n]*?\b(?:import|export)\b([\s\S]*?)\bfrom\s*['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/**
 * Every workspace source file, excluding specs.
 *
 * Specs are excluded because they import `vitest`, `@nestjs/testing` and
 * `testcontainers`, and those legitimately live in `devDependencies` — the whole
 * point is that the *runtime* does not need them.
 */
function runtimeSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'dist' || entry === 'node_modules') continue;
        walk(full);
      } else if (full.endsWith('.ts') && !full.endsWith('.spec.ts') && !full.endsWith('.d.ts')) {
        out.push(full);
      }
    }
  };
  for (const pattern of ROOT_MANIFEST.workspaces) {
    const dir = path.join(REPO_ROOT, pattern.replace('*', ''));
    if (existsSync(dir)) walk(dir);
  }
  return out;
}

/** Strip block comments, for the same reason the drift test does. */
const stripBlockComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '');

/** Reduce a bare specifier to its installable package name. */
function packageNameOf(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('node:')) return undefined;
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

/** Every bare package the runtime sources can reach, mapped to its importers. */
function runtimeImports(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const file of runtimeSourceFiles()) {
    const source = stripBlockComments(readFileSync(file, 'utf8'));
    const relative = path.relative(REPO_ROOT, file);
    for (const pattern of SPECIFIER_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const name = packageNameOf(match[match.length - 1]);
        // Workspace packages are symlinked by npm itself; they are never listed.
        if (name === undefined || name.startsWith('@akane/')) continue;
        const importers = found.get(name) ?? new Set<string>();
        importers.add(relative);
        found.set(name, importers);
      }
    }
  }
  return found;
}

describe('deployment shape — the production install must boot (WINDOWS.md #8)', () => {
  /**
   * Non-vacuity: the scan has to actually find imports.
   *
   * An empty scan makes every assertion below pass, which is precisely how
   * `boundaries.fixture.spec.ts` and `entrypoint-drift.spec.ts` were both nearly
   * written. One assertion on the scanner's own output, first.
   */
  it('the scan finds the runtime imports it is supposed to police', () => {
    const imports = runtimeImports();
    expect(imports.size, 'no runtime imports found — the scanner is broken').toBeGreaterThan(10);
    for (const known of ['@nestjs/core', 'ioredis', 'mongodb', 'zod', 'pino']) {
      expect([...imports.keys()], `${known} should be reachable from runtime source`).toContain(known);
    }
  });

  it('every package the runtime can reach is a root dependency, not a devDependency', () => {
    const misplaced: string[] = [];
    for (const [name, importers] of runtimeImports()) {
      if (DEV_DEPENDENCIES.includes(name)) {
        misplaced.push(`${name} (imported by ${[...importers].join(', ')})`);
      }
    }
    expect(
      misplaced,
      'npm ci --omit=dev would produce a tree that cannot boot — move these to "dependencies"',
    ).toEqual([]);
  });

  it('the two lists are disjoint — a package is either runtime or build tooling', () => {
    expect(RUNTIME_DEPENDENCIES.filter((name) => DEV_DEPENDENCIES.includes(name))).toEqual([]);
  });

  /**
   * The named pairs, because "the runtime can reach it" is a scan and these are
   * the three that motivated the split. `ioredis` and `mongodb` are the two
   * WINDOWS.md #8 names; `bullmq` is the third runtime import that a
   * build-tooling-only reading would also have dropped.
   */
  it('the drivers plan 08 and plan 02 imported are runtime dependencies', () => {
    for (const name of ['ioredis', 'mongodb', 'bullmq']) {
      expect(RUNTIME_DEPENDENCIES, `${name} must be a runtime dependency`).toContain(name);
      expect(DEV_DEPENDENCIES).not.toContain(name);
    }
  });

  it('build and test tooling stays out of the runtime set', () => {
    for (const name of ['typescript', 'eslint', 'vitest', 'testcontainers', '@nestjs/testing', 'typescript-eslint']) {
      expect(DEV_DEPENDENCIES, `${name} is build/test tooling`).toContain(name);
      expect(RUNTIME_DEPENDENCIES).not.toContain(name);
    }
  });

  /**
   * The committed lockfile agrees with the manifest.
   *
   * FND-02 commits the lockfile precisely so a deployment is reproducible; a lock
   * generated before the split still records every package under the old
   * `dev: true` marker, and `npm ci --omit=dev` honours the **lockfile's** markers
   * rather than the manifest's. A split manifest with a stale lockfile is
   * therefore the same defect with extra steps, so the split is only real when
   * both are regenerated together — which is why this is asserted rather than
   * assumed.
   */
  it('the committed lockfile marks exactly the runtime dependencies as production', () => {
    const lock = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'),
    ) as { packages?: Record<string, { dev?: boolean }> };

    const root = lock.packages?.[''] as
      | { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
      | undefined;
    expect(root, 'lockfile root entry').toBeDefined();
    expect(Object.keys(root?.dependencies ?? {}).sort()).toEqual([...RUNTIME_DEPENDENCIES].sort());
    expect(Object.keys(root?.devDependencies ?? {}).sort()).toEqual([...DEV_DEPENDENCIES].sort());

    // A spot check deep in the tree: `ioredis` and `mongodb` must not be flagged
    // dev, or `npm ci --omit=dev` prunes the database driver.
    for (const name of ['ioredis', 'mongodb', 'bullmq']) {
      expect(lock.packages?.[`node_modules/${name}`]?.dev, `${name} must not be dev-only`).toBeFalsy();
    }
    for (const name of ['typescript', 'vitest']) {
      expect(lock.packages?.[`node_modules/${name}`]?.dev, `${name} should be dev-only`).toBe(true);
    }
  });
});
