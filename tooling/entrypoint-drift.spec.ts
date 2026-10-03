/**
 * Entrypoint drift — the zero-internals backstop (FND-03, D-03, T-1-23).
 *
 * ## Three controls hold the three entrypoints apart
 *
 * | control | catches | blind to |
 * |---------|---------|----------|
 * | `eslint.config.mjs` + `tooling/boundaries.config.mjs` | an **import** across a declared boundary | a provider registered without an import that names the wrong *process* |
 * | `ProviderBoundaryGuard` + each `BoundaryManifest` | a forbidden provider **resolved** at boot | only what actually boots; nothing runs in a unit test |
 * | **this file** | either, at CI time, with no Nest container and no infrastructure | anything past the import edge — a dynamic `ModuleRef.get()` from a third-party module |
 *
 * The middle row needs three running processes with three live Redis deployments
 * and a MongoDB, which is exactly what makes it useless as a fast gate: it is
 * verified in the phase summary by booting, not by `npm test`. This file is the
 * one that runs on every commit.
 *
 * ## Why walk a real import graph instead of grepping
 *
 * A grep for `Worker` in `apps/api` passes on the day someone adds
 * `apps/api/src/processor.ts` that nobody imports, and fails for the wrong reason
 * the day someone writes `WORKER_READINESS_KEY` in a comment. Walking the closure
 * from `src/main.ts` answers the question FND-03 actually asks — *what can this
 * process reach* — rather than *what does this directory contain*. It also follows
 * the dynamic `import('./app.module.js')` that D-20 makes load-bearing, which a
 * `from`-only regex silently skips, and it reaches through `@akane/platform` into
 * the platform's own sources, so a forbidden specifier arriving through the
 * platform barrel is caught too.
 *
 * ## No `typescript` dependency, on purpose
 *
 * A `ts.createProgram` graph would be more precise and would also cost a full
 * program per app in a seven-minute suite. These assertions are about *reachable
 * specifiers*, and a lexical scan is complete for that question on this tree once
 * block comments are removed — see {@link stripBlockComments} for why that step is
 * load-bearing here and why line comments are deliberately left alone.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  INBOUND_ADAPTER_REGISTRATIONS,
  JOB_SCHEDULER_REGISTRATIONS,
  QUEUE_PRODUCER_TOKEN,
  WORKER_CONSUMERS,
  type BoundaryManifest,
} from '@akane/platform';

import { API_BOUNDARY_MANIFEST } from '../apps/api/src/bootstrap/boundary-manifest.js';
import { SCHEDULER_BOUNDARY_MANIFEST } from '../apps/scheduler/src/bootstrap/boundary-manifest.js';
import { WORKER_BOUNDARY_MANIFEST } from '../apps/worker/src/bootstrap/boundary-manifest.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const APPS = ['api', 'worker', 'scheduler'] as const;
type AppName = (typeof APPS)[number];

const appSrc = (app: AppName): string => path.join(REPO_ROOT, 'apps', app, 'src');

// ------------------------------------------------------------------------ //
// Source scanning
// ------------------------------------------------------------------------ //

interface ImportEdge {
  /** Absolute path of the importing file. */
  readonly from: string;
  /** The literal specifier as written. */
  readonly specifier: string;
  /** Local binding names the clause introduces (`as` aliases resolved). */
  readonly bindings: readonly string[];
}

/**
 * Remove `/* … *\/` comments — and nothing else.
 *
 * This repository's source is roughly 80% prose, and the prose is where the
 * phantom edges come from: the `main.ts` docblock quotes `import('./app.module.js')`
 * and `otel.mjs` quotes `node --import ./otel.mjs`, both of which are edges that
 * do not exist. A comment is not a dependency, so it has to go before scanning.
 *
 * **Line comments are deliberately not stripped.** The obvious implementation —
 * cut each line at `//` — corrupts `'mongodb://…'`, `'redis://…'` and every URL
 * in the boot schema, because this repo's string literals are full of them, and
 * the corruption is silent. A line comment cannot span statements, so it cannot
 * hide an `import` clause behind it the way a block comment can; the residual risk
 * is a line comment that quotes a whole `import … from '…'` line, which this
 * codebase does not do and which the negative control at the bottom would catch
 * if it grew one.
 */
function stripBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * `import … from 'x'` / `export … from 'x'`, including `import type`, with a
 * clause that may wrap across lines.
 *
 * Wrapping is ordinary formatting and this repository uses it constantly — a
 * seven-symbol platform import is written across nine lines. A single-line clause
 * pattern therefore matches almost nothing here, and a walk built on it produces
 * a two-file closure in which **every** assertion below passes vacuously. That
 * failure is silent and total, which is why the first test in this file exists.
 *
 * The clause is lazy, so it stops at the first `from '…'` after the keyword. The
 * one shape that could overshoot is a string containing ` from '` inside a clause,
 * which does not occur in an import list.
 */
const STATIC_FROM =
  /(?:^|\n)[^\n]*?\b(?:import|export)\b([\s\S]*?)\bfrom\s*['"]([^'"]+)['"]/g;

/** Bare `import 'x'` — side effect only, still an edge. */
const SIDE_EFFECT_IMPORT = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;

/**
 * `await import('./app.module.js')` — the dynamic edge D-20 requires.
 *
 * Without this the closure would stop at `main.ts` for every app, the graph would
 * be one file deep, and nothing below could fail.
 */
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Binding names introduced by an import/export clause.
 *
 * Handles `Default`, `* as ns`, `{ a, b as c }`, `type { T }` and
 * `import Foo, { bar } from`. `export *` carries no name and yields nothing, which
 * is correct — a re-export adds a name to the *consuming* module, not an edge.
 */
function parseBindings(clause: string): string[] {
  const withoutTypeKeyword = clause.replace(/\btype\b/g, ' ');
  const braced = /\{([\s\S]*?)\}/.exec(withoutTypeKeyword);
  const names: string[] = [];

  if (braced) {
    for (const part of braced[1].split(',')) {
      const alias = /\bas\s+([A-Za-z_$][\w$]*)/.exec(part);
      const plain = part.trim().split(/\s+as\s+/)[0].trim();
      const name = alias ? alias[1] : plain;
      if (name.length > 0) names.push(name);
    }
  }

  const head = withoutTypeKeyword.replace(/\{[\s\S]*?\}/, ' ');
  for (const part of head.split(',')) {
    const identifier = part.trim().split(/\s+as\s+/).pop()?.trim() ?? '';
    if (/^[A-Za-z_$][\w$]*$/.test(identifier)) names.push(identifier);
  }

  return names;
}

function readImports(file: string): ImportEdge[] {
  const source = stripBlockComments(readFileSync(file, 'utf8'));
  const edges: ImportEdge[] = [];

  for (const match of source.matchAll(STATIC_FROM)) {
    edges.push({ from: file, specifier: match[2], bindings: parseBindings(match[1]) });
  }
  for (const match of source.matchAll(SIDE_EFFECT_IMPORT)) {
    edges.push({ from: file, specifier: match[1], bindings: [] });
  }
  for (const match of source.matchAll(DYNAMIC_IMPORT)) {
    edges.push({ from: file, specifier: match[1], bindings: [] });
  }

  return edges;
}

// ------------------------------------------------------------------------ //
// Resolution
// ------------------------------------------------------------------------ //

interface ResolvedEdge extends ImportEdge {
  /** Absolute path when the edge lands inside this repository, else undefined. */
  readonly local?: string;
}

const TS_SOURCE_FILES = ['.ts', '.tsx', '.mts', '.cts'];

/**
 * NodeNext's `./foo.js` names `./foo.ts` on disk. Same mapping the lint gate's
 * resolver needs, re-implemented rather than imported: that resolver is CommonJS
 * and shaped for `eslint-module-utils`, and requiring it from an ESM spec would
 * put a `.cjs` on the dependency edge of the file whose job is to police edges.
 */
function resolveLocalSpecifier(specifier: string, fromFile: string): string | undefined {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const extension = path.extname(base);
  const stem = extension.length > 0 ? base.slice(0, base.length - extension.length) : base;

  if (extension.length > 0) {
    for (const candidate of TS_SOURCE_FILES.map((ext) => `${stem}${ext}`)) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
  }

  for (const ext of TS_SOURCE_FILES) {
    if (existsSync(base + ext) && statSync(base + ext).isFile()) return base + ext;
  }
  if (existsSync(base) && statSync(base).isFile()) return base;

  for (const ext of TS_SOURCE_FILES) {
    const candidate = path.join(base, `index${ext}`);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/**
 * `@akane/platform` and `@akane/platform/otel` → the workspace's **source**.
 *
 * The `exports` map points at `dist/`, which would leave the platform's own
 * imports invisible to this walk — a forbidden specifier reaching an app through
 * `@akane/platform` is exactly the case worth catching, and it is only visible
 * if the walk enters `src/`.
 */
function resolveWorkspaceSpecifier(specifier: string): string | undefined {
  const [, pkg, ...rest] = specifier.split('/');
  const packageRoot = path.join(REPO_ROOT, 'packages', pkg ?? '');
  if (!existsSync(packageRoot)) return undefined;

  const subpath = rest.join('/');
  if (subpath.length === 0) {
    const entry = path.join(packageRoot, 'src', 'index.ts');
    return existsSync(entry) ? entry : undefined;
  }
  for (const candidate of [
    path.join(packageRoot, 'src', `${subpath}.ts`),
    path.join(packageRoot, 'src', subpath, 'index.ts'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

function resolveEdge(edge: ImportEdge): ResolvedEdge {
  if (edge.specifier.startsWith('.')) {
    const local = resolveLocalSpecifier(edge.specifier, edge.from);
    return local === undefined ? edge : { ...edge, local };
  }
  if (edge.specifier.startsWith('@akane/')) {
    const local = resolveWorkspaceSpecifier(edge.specifier);
    return local === undefined ? edge : { ...edge, local };
  }
  return edge;
}

// ------------------------------------------------------------------------ //
// Closure
// ------------------------------------------------------------------------ //

interface Closure {
  /** Every repository file reachable from the entrypoint, including itself. */
  readonly files: ReadonlySet<string>;
  /** Specifiers that left the repository, with the binding names each introduced. */
  readonly external: ReadonlyMap<string, ReadonlySet<string>>;
}

const toRepoRelative = (file: string): string => path.relative(REPO_ROOT, file).split(path.sep).join('/');

function buildClosure(entry: string): Closure {
  const files = new Set<string>();
  const external = new Map<string, Set<string>>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);

    for (const raw of readImports(file)) {
      const edge = resolveEdge(raw);
      if (edge.local !== undefined) {
        queue.push(edge.local);
        continue;
      }
      const names = external.get(edge.specifier) ?? new Set<string>();
      for (const binding of edge.bindings) names.add(binding);
      external.set(edge.specifier, names);
    }
  }

  return { files, external };
}

/** Every non-spec `.ts` source under `apps/<app>/src`. */
function appSourceFiles(app: AppName): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) out.push(full);
    }
  };
  walk(appSrc(app));
  return out;
}

// One closure per app, built once: three graph walks over ~40 files, read by
// every test below.
const CLOSURES = Object.fromEntries(
  APPS.map((app) => [app, buildClosure(path.join(appSrc(app), 'main.ts'))]),
) as Record<AppName, Closure>;

const relativeFiles = (app: AppName): string[] => [...CLOSURES[app].files].map(toRepoRelative).sort();

// ------------------------------------------------------------------------ //
// The forbidden specifier vocabulary (D-03, R1)
// ------------------------------------------------------------------------ //
//
// POSIX repo-relative paths, so a pattern can be anchored on `packages/` and can
// never match an app's own directory. An unanchored `/scheduler/` matched
// `apps/scheduler/src/main.ts` — the scheduler failing its own worker-only check —
// which is exactly the class of mistake an assertion like this can hide behind a
// plausible-looking name.

/** Worker-only: outbound adapters, BullMQ worker modules, scheduler jobs. */
const WORKER_ONLY_LOCAL_PATTERNS: readonly RegExp[] = [
  /^packages\/.*\/adapters\/[^/]+\/outbound\//,
  /^packages\/.*\/bullmq\/workers\//,
  /^packages\/.*\/scheduler\//,
];

const WORKER_ONLY_EXTERNAL_SPECIFIERS: readonly RegExp[] = [/^bullmq\/workers(\/|$)/];

/** Inbound-only: the webhook receiver belongs to `api` (IM-02, IM-03). */
const INBOUND_LOCAL_PATTERNS: readonly RegExp[] = [
  /^packages\/.*\/adapters\/[^/]+\/inbound\//,
  /^packages\/.*\/http\//,
];

function forbiddenLocalHit(app: AppName, patterns: readonly RegExp[]): string[] {
  return relativeFiles(app).filter((file) => patterns.some((p) => p.test(file)));
}

function forbiddenExternalHit(app: AppName, patterns: readonly RegExp[]): string[] {
  return [...CLOSURES[app].external.keys()].filter((s) => patterns.some((p) => p.test(s))).sort();
}

/** `from -> specifier` for every bare-specifier edge that binds the name `Worker`. */
function workerBindingSites(app: AppName): string[] {
  const sites: string[] = [];
  for (const file of CLOSURES[app].files) {
    for (const edge of readImports(file)) {
      const resolved = resolveEdge(edge);
      if (resolved.local === undefined && edge.bindings.includes('Worker')) {
        sites.push(`${toRepoRelative(file)} -> ${edge.specifier}`);
      }
    }
  }
  return sites.sort();
}

// ------------------------------------------------------------------------ //
// Manifest wiring
// ------------------------------------------------------------------------ //

const MANIFESTS: Record<AppName, BoundaryManifest> = {
  api: API_BOUNDARY_MANIFEST,
  worker: WORKER_BOUNDARY_MANIFEST,
  scheduler: SCHEDULER_BOUNDARY_MANIFEST,
};

const ALL_MANIFESTS = APPS.map((app) => MANIFESTS[app]);

/**
 * Which app is *supposed* to hold each capability token. `owners` is a list
 * because one token legitimately has two: the registered queue exists in
 * `worker` (so the consumer's name cannot drift from a producer's) and in
 * `scheduler` (so it has a `Queue` to register the Job Scheduler against), and
 * in neither other.
 */
const CAPABILITY_OWNERS: ReadonlyArray<{ token: symbol | string; owners: readonly AppName[] }> = [
  { token: WORKER_CONSUMERS, owners: ['worker'] },
  { token: JOB_SCHEDULER_REGISTRATIONS, owners: ['scheduler'] },
  { token: QUEUE_PRODUCER_TOKEN, owners: ['worker', 'scheduler'] },
  { token: INBOUND_ADAPTER_REGISTRATIONS, owners: ['api'] },
];

const tokenName = (token: symbol | string): string =>
  typeof token === 'string' ? token : (token.description ?? token.toString());

/**
 * Local binding names an app module introduces, across all its imports.
 *
 * The DI-level question — "does this composition root register the queue module?"
 * — is not answerable from the import *closure*, because one closure edge carries
 * every symbol the platform barrel exports. It is answerable from the names the
 * app module's own clauses bind.
 */
function appModuleBindings(app: AppName): string[] {
  const file = path.join(appSrc(app), 'app.module.ts');
  return readImports(file).flatMap((edge) => edge.bindings).sort();
}

// ------------------------------------------------------------------------ //
// Assertions
// ------------------------------------------------------------------------ //

describe('entrypoint import closure — three processes that cannot drift (FND-03)', () => {
  /**
   * Non-vacuity first.
   *
   * Every other assertion here is a `not.toContain`, so a broken resolver — a
   * regex that stopped matching, a `.js → .ts` mapping that stopped working, an
   * `app.module.js` the dynamic edge no longer follows — yields a closure of one
   * file and **every** test passes. This is the same trap
   * `tooling/boundaries.fixture.spec.ts` pins for the lint gate, and it is the
   * reason these two reachability tests come first.
   */
  it('each closure reaches its app module and the platform source, not just main.ts', () => {
    for (const app of APPS) {
      const files = relativeFiles(app);
      expect(files, `${app} closure`).toContain(`apps/${app}/src/main.ts`);
      expect(files, `${app} closure must follow the dynamic app.module import`).toContain(
        `apps/${app}/src/app.module.ts`,
      );
      expect(files, `${app} closure must enter the platform source`).toContain(
        'packages/platform/src/index.ts',
      );
      expect(
        files.filter((file) => file.startsWith('packages/platform/src/')).length,
        `${app} closure should reach well past the platform barrel`,
      ).toBeGreaterThan(5);
    }
  });

  /**
   * The closure covers *every* source file the app has.
   *
   * A file nobody imports is a file none of the assertions below can see, so it
   * would pass as "compliant" forever while being free to hold a `Worker`. Closing
   * that gap also makes a deleted controller leave no unreachable remainder
   * behind — the plan's `files_deleted` becomes a checked property.
   */
  it('every app source file is reachable from its own main.ts — no orphan escapes the walk', () => {
    for (const app of APPS) {
      const reachable = new Set(relativeFiles(app));
      expect(
        appSourceFiles(app).map(toRepoRelative).filter((file) => !reachable.has(file)),
        `${app} has source files its main.ts never loads`,
      ).toEqual([]);
    }
  });

  it('no app reaches another app source (FND-03)', () => {
    for (const app of APPS) {
      const others = APPS.filter((candidate) => candidate !== app);
      expect(
        relativeFiles(app).filter((file) => others.some((o) => file.startsWith(`apps/${o}/`))),
        `${app} reaches another app's source`,
      ).toEqual([]);
    }
  });

  it('the api closure contains no BullMQ Worker binding (R1, <200 ms ack budget)', () => {
    expect(workerBindingSites('api')).toEqual([]);
    // `api` *does* reach `bullmq` — transitively, through the platform barrel
    // that every composition root imports, which re-exports `queue/index.ts`.
    // That is deliberate and harmless: reaching a module is not registering its
    // providers, and `BullModule.registerQueue` only runs when `QueueModule` is
    // an entry in some module's `imports`. The control that matters is the
    // `QUEUE_PRODUCER_TOKEN` boot assertion below plus the DI-level check that
    // `api/src/app.module.ts` does not import `QueueModule`. Asserting the
    // absence of the *specifier* would force the barrel to be split for no
    // runtime gain, and the D-20 note on `apps/*/otel.mjs` already carves out the
    // one place where barrel reach genuinely does cost something.
    expect(forbiddenExternalHit('api', [/^bullmq/])).toContain('bullmq');
    expect(forbiddenExternalHit('api', WORKER_ONLY_EXTERNAL_SPECIFIERS)).toEqual([]);
  });

  it('the scheduler closure contains no BullMQ Worker binding (R1)', () => {
    expect(workerBindingSites('scheduler')).toEqual([]);
    // `import type { Queue } from 'bullmq'` is legitimate here — the scheduler
    // registers a Job Scheduler against a `Queue` it never consumes from — so the
    // assertion is on the binding, not on the package.
    expect([...CLOSURES.scheduler.external.keys()]).toContain('bullmq');
  });

  it('the worker closure is the only one that binds Worker, and it is the consumer', () => {
    expect(workerBindingSites('worker')).toEqual([
      'apps/worker/src/processors/platform-heartbeat.processor.ts -> bullmq',
    ]);
  });

  it('api and scheduler contain no worker-only specifier (D-03 R1)', () => {
    for (const app of ['api', 'scheduler'] as const) {
      expect(forbiddenLocalHit(app, WORKER_ONLY_LOCAL_PATTERNS), `${app} local`).toEqual([]);
      expect(
        forbiddenExternalHit(app, WORKER_ONLY_EXTERNAL_SPECIFIERS),
        `${app} external`,
      ).toEqual([]);
    }
  });

  it('the worker closure contains no inbound-adapter specifier (D-03 R1)', () => {
    expect(forbiddenLocalHit('worker', INBOUND_LOCAL_PATTERNS)).toEqual([]);
  });

  /**
   * Negative controls.
   *
   * Every pattern above is asserted against a synthetic path or specifier, so a
   * pattern that can never match — a typo, a path shape that changed, an anchor
   * that stopped anchoring — turns this test red instead of silently permitting
   * everything. `boundaries/dependencies` fails the same way when
   * `checkAllOrigins` is dropped; this is the equivalent guard for this file.
   */
  it('the forbidden-specifier patterns actually match what they name', () => {
    expect(WORKER_ONLY_LOCAL_PATTERNS[0].test('packages/domain/src/adapters/slack/outbound/client.ts')).toBe(true);
    expect(WORKER_ONLY_LOCAL_PATTERNS[1].test('packages/domain/src/submissions/bullmq/workers/processor.ts')).toBe(true);
    expect(WORKER_ONLY_LOCAL_PATTERNS[2].test('packages/platform/src/scheduler/jobs/rotate.ts')).toBe(true);
    expect(INBOUND_LOCAL_PATTERNS[0].test('packages/domain/src/adapters/slack/inbound/receiver.ts')).toBe(true);
    expect(INBOUND_LOCAL_PATTERNS[1].test('packages/platform/src/http/server.ts')).toBe(true);
    expect(WORKER_ONLY_EXTERNAL_SPECIFIERS[0].test('bullmq/workers/processor')).toBe(true);

    // And the anchoring is what keeps them from matching an app's own directory.
    for (const pattern of WORKER_ONLY_LOCAL_PATTERNS) {
      expect(pattern.test('apps/scheduler/src/main.ts')).toBe(false);
    }
    expect(WORKER_ONLY_EXTERNAL_SPECIFIERS[0].test('bullmq')).toBe(false);
  });

  /**
   * The comment stripper is load-bearing, and the specific hazard it avoids is
   * asserted rather than described.
   *
   * `main.ts` documents the ordering D-20 requires and quotes the dynamic import
   * that *is* the edge; a scanner that read docblocks would find edges that do not
   * exist. Line comments are left alone on purpose, because cutting at `//`
   * corrupts `'mongodb://…'` — and the boot schema is full of those.
   */
  it('block-comment stripping removes quoted pseudo-imports without touching URL strings', () => {
    const sample = [
      "import { A } from './a.js'; // 'redis://127.0.0.1:6379' stays",
      "/* import { Worker } from 'bullmq'; */",
      '/* multi',
      " * line */ const u = 'mongodb://127.0.0.1:27017/db';",
    ].join('\n');
    const scanned = stripBlockComments(sample);
    const specifiers = [...scanned.matchAll(STATIC_FROM)].map((m) => m[2]);
    expect(specifiers).toEqual(['./a.js']);
    expect(scanned).toContain('redis://127.0.0.1:6379');
    expect(scanned).toContain('mongodb://127.0.0.1:27017/db');
  });
});

describe('per-app BoundaryManifest wiring (D-03, T-1-23)', () => {
  /**
   * Each capability token is forbidden by exactly the two apps that must not hold
   * it, and by neither the owner nor any third party.
   *
   * This is what makes the manifest a control rather than a list. A token nobody
   * provides would make its presence in a forbidden list decorative; a token
   * forbidden in its own owner's manifest would make that process unbootable.
   */
  it('every capability token is forbidden by exactly the apps that must not own it', () => {
    for (const { token, owners } of CAPABILITY_OWNERS) {
      const nonOwners = APPS.filter((app) => !owners.includes(app));
      expect(
        APPS.filter((app) => MANIFESTS[app].forbidden.includes(token)),
        `${tokenName(token)} must be forbidden by exactly ${nonOwners.join(' and ')}`,
      ).toEqual(nonOwners);
      for (const owner of owners) {
        expect(
          MANIFESTS[owner].forbidden,
          `${owner} must not forbid its own capability ${tokenName(token)}`,
        ).not.toContain(token);
      }
    }
  });

  it('no manifest is empty and no manifest forbids a token twice', () => {
    for (const app of APPS) {
      const forbidden = MANIFESTS[app].forbidden;
      expect(forbidden.length, `${app} manifest must forbid something`).toBeGreaterThan(0);
      expect(new Set(forbidden).size, `${app} manifest has duplicates`).toBe(forbidden.length);
    }
  });

  it('the three manifests cover every declared capability token', () => {
    for (const { token } of CAPABILITY_OWNERS) {
      expect(
        ALL_MANIFESTS.some((manifest) => manifest.forbidden.includes(token)),
        `${tokenName(token)} is declared but forbidden by nobody`,
      ).toBe(true);
    }
  });

  /**
   * The owner really does provide its token, in source.
   *
   * The guard reads *resolved providers*, so a token forbidden everywhere and
   * provided nowhere would make every assertion above true and the whole mechanism
   * inert — the failure `boundary-manifest.ts` names when it says a guard that
   * allows everything because nobody registered its input is worse than no guard.
   */
  it('each capability owner provides its token from its app module', () => {
    for (const [app, token] of [
      ['worker', WORKER_CONSUMERS],
      ['scheduler', JOB_SCHEDULER_REGISTRATIONS],
    ] as const) {
      expect(
        readFileSync(path.join(appSrc(app), 'app.module.ts'), 'utf8'),
        `${app} must provide ${tokenName(token)}`,
      ).toContain(tokenName(token));
    }
  });

  /**
   * `api` must satisfy its own manifest.
   *
   * `QUEUE_PRODUCER_TOKEN` is forbidden there precisely because importing
   * `QueueModule` into `api` is the plausible mistake — one line, copied from
   * `scheduler`. If `api` ever does it, this turns red before the boot guard can,
   * and names the process that grew the queue, instead of leaving it to a
   * `BOUNDARY_VIOLATION` in a deployment.
   *
   * Checked on the app module's *bindings*, not on its closure: the platform
   * barrel legitimately re-exports `QueueModule`, so the name is reachable from
   * every app. What matters is whether the composition root puts it in `imports`.
   */
  it('api does not register QueueModule, so its manifest is satisfiable', () => {
    expect(appModuleBindings('api'), 'api must not bind QueueModule').not.toContain('QueueModule');
    expect(
      appModuleBindings('api'),
      'api must not bind any BullMQ queue token',
    ).not.toContain(QUEUE_PRODUCER_TOKEN);
  });

  /**
   * `worker` and `scheduler` really do register it — the control for the test above.
   *
   * Without this, "api does not register QueueModule" would also pass if *nobody*
   * did, which is a completely different state of the world, and `worker` would
   * hold a consumer whose queue name nothing else in the repository knows.
   */
  it('worker and scheduler do register QueueModule', () => {
    for (const app of ['worker', 'scheduler'] as const) {
      expect(appModuleBindings(app), `${app} must register the heartbeat queue`).toContain(
        'QueueModule',
      );
      expect(relativeFiles(app), `${app} closure must reach the queue module`).toContain(
        'packages/platform/src/queue/queue.module.ts',
      );
    }
  });

  /**
   * Every app module provides its manifest and the shared guard.
   *
   * Without both, `ProviderBoundaryGuardRunner` cannot resolve `BOUNDARY_MANIFEST`
   * and Nest fails the boot with a dependency error that names neither the cause
   * nor the remedy — an unhelpful failure for what is a one-line omission.
   */
  it('every app module provides BOUNDARY_MANIFEST and the shared guard runner', () => {
    const expected: Record<AppName, string> = {
      api: 'API_BOUNDARY_MANIFEST',
      worker: 'WORKER_BOUNDARY_MANIFEST',
      scheduler: 'SCHEDULER_BOUNDARY_MANIFEST',
    };
    for (const app of APPS) {
      const source = readFileSync(path.join(appSrc(app), 'app.module.ts'), 'utf8');
      expect(source, `${app} must provide BOUNDARY_MANIFEST`).toContain('BOUNDARY_MANIFEST');
      expect(source, `${app} must run the shared guard`).toContain('ProviderBoundaryGuardRunner');
      expect(source, `${app} must name its own manifest`).toContain(expected[app]);
    }
  });
});
