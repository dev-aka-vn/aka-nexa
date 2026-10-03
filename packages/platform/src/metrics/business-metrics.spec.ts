import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { metrics, type Counter, type MeterProvider } from '@opentelemetry/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PLATFORM_HEARTBEAT_METRIC, QUEUE_JOB_FAILURES_METRIC } from './business-metrics.js';

/**
 * Business metric registration, and the single-metric-path assertion (OBS-01).
 *
 * ## Why this file installs a recording MeterProvider
 *
 * Without an SDK registered, `@opentelemetry/api` hands back **no-op** instruments:
 * `createCounter` returns a `NoopCounter` whose `add()` is a no-op and which
 * carries no name. Every assertion about names, memoisation and handle identity
 * would therefore pass vacuously against code that created the wrong instrument —
 * the exact failure mode 01-07 hit with a readiness probe that only ever ran
 * while everything was healthy.
 *
 * So the provider is a small recording stub: it captures the meter name and every
 * instrument created on it. That makes "the meter is `akane`" and "these two
 * counters exist under these names" checkable facts rather than assumptions, and
 * it keeps the test free of an OTel SDK dependency the plan does not install.
 */
class RecordingMeterProvider implements MeterProvider {
  readonly meters: Array<{ name: string; version?: string }> = [];
  readonly counters = new Map<string, number>();
  readonly observations: number[] = [];

  // An arrow-bodied method, so the inner `createCounter` closes over the provider
// instance lexically rather than needing `const self = this` — which
// `@typescript-eslint/no-this-alias` correctly rejects.
getMeter = (name: string, version?: string) => {
    this.meters.push(version === undefined ? { name } : { name, version });
    return {
      createCounter: (metricName: string) => {
        this.counters.set(metricName, (this.counters.get(metricName) ?? 0) + 1);
        return { add: (amount: number) => this.observations.push(amount) };
      },
    } as unknown as ReturnType<MeterProvider['getMeter']>;
  };
}

describe('registerBusinessMetrics (OBS-01)', () => {
  let recorder: RecordingMeterProvider;

  /**
   * `registerBusinessMetrics()` memoises in module scope, which is the behaviour
   * under test — and also means a statically imported module carries its cache
   * from whichever test ran first. Every test therefore re-imports through
   * `vi.resetModules()`, so the memo starts empty and the assertions describe the
   * module rather than the order the file happens to run in.
   */
  async function freshModule(): Promise<typeof import('./business-metrics.js')> {
    vi.resetModules();
    return import('./business-metrics.js');
  }

  beforeEach(() => {
    recorder = new RecordingMeterProvider();
    metrics.disable();
    metrics.setGlobalMeterProvider(recorder);
  });

  afterEach(() => {
    metrics.disable();
  });

  it('creates its instruments on the akane meter, through @opentelemetry/api', async () => {
    const { METER_NAME: name, registerBusinessMetrics: register } = await freshModule();
    const handles = register();

    expect(recorder.meters.map((meter) => meter.name)).toEqual([name]);
    expect(name).toBe('akane');
    expect([...recorder.counters.keys()].sort()).toEqual(
      [PLATFORM_HEARTBEAT_METRIC, QUEUE_JOB_FAILURES_METRIC].sort(),
    );

    // A real `Counter`, not just an object that quacks like one: the
    // heartbeat processor calls `.add()` on this handle, and a
    // structurally-compatible stub would let a signature drift through.
    for (const handle of Object.values(handles) as Counter[]) {
      expect(typeof handle.add).toBe('function');
      handle.add(1);
    }
    expect(recorder.observations).toEqual([1, 1]);
  });

  it('returns the same handles on a second call, and creates nothing new', async () => {
    const { registerBusinessMetrics: register } = await freshModule();
    const first = register();
    const second = register();

    expect(second).toBe(first);
    expect(second.platformHeartbeat).toBe(first.platformHeartbeat);
    expect(second.queueJobFailures).toBe(first.queueJobFailures);

    // The reason memoisation exists rather than a "did I already do this"
    // check inside the SDK: an OTel meter returns a NEW wrapper for each
    // `createCounter` of the same name, so a second registration produces two
    // live instruments sharing one name and the exporter emits the series twice.
    // Asserted on the creation count, which is the thing that would double.
    expect(recorder.counters.get(PLATFORM_HEARTBEAT_METRIC)).toBe(1);
    expect(recorder.counters.get(QUEUE_JOB_FAILURES_METRIC)).toBe(1);
  });

  it('hands out a frozen handle set', async () => {
    // A caller that assigned `handles.platformHeartbeat = somethingElse` would
    // silently replace the instrument every other module already captured.
    const { registerBusinessMetrics: register } = await freshModule();
    const handles = register();

    expect(Object.isFrozen(handles)).toBe(true);
    expect(() => {
      (handles as { platformHeartbeat: Counter }).platformHeartbeat =
        handles.queueJobFailures;
    }).toThrow(TypeError);
  });

  it('declares the observable-gauge name without registering an instrument', async () => {
    const { registerBusinessMetrics: register, QUEUE_OLDEST_ITEM_AGE_METRIC: gauge } =
      await freshModule();
    register();

    // `queue.oldest.item.age` is the metric that distinguishes "the queue is
    // fine" from "the queue is backed up". It is a NAME only: registering an
    // observable gauge before its callback exists would export a series that is
    // permanently zero, which satisfies a dashboard's existence check while
    // telling an operator the queue is empty.
    expect(gauge).toBe('queue.oldest.item.age');
    expect(recorder.counters.has(gauge)).toBe(false);
  });
});


describe('one metric path (OBS-01, D-20)', () => {
  const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

  it('declares no prom-client dependency in any manifest', () => {
    const forbidden = 'prom-client';
    const manifests = ['package.json', ...workspaceManifests(REPO_ROOT)];

    const offenders = manifests.filter((manifest) => {
      const parsed: unknown = JSON.parse(readFileSync(`${REPO_ROOT}${manifest}`, 'utf8'));
      return declaredDependencies(parsed).includes(forbidden);
    });

    expect(offenders).toEqual([]);
  });

  it('imports no second metrics library anywhere in the source', () => {
    // Scanned as text over every non-spec source file. `prom-client` is on the
    // do-not-use list (STACK.md §12: deprecated in favour of
    // `@prometheus-io/client`), and a second registry means two scrape
    // endpoints, two naming conventions and split alert rules.
    //
    // Comments are stripped for the same reason as the keyPrefix scan in
    // `queue.spec.ts`: a docblock that names the forbidden import in order to
    // explain why it is forbidden is not a violation.
    const forbidden = /\bprom-client\b/;
    const offenders = sourceFiles(REPO_ROOT)
      .filter((file) => !file.endsWith('.spec.ts'))
      .filter((file) => forbidden.test(stripComments(readFileSync(`${REPO_ROOT}${file}`, 'utf8'))));

    expect(offenders).toEqual([]);
  });

  it('builds the meter through @opentelemetry/api and nothing else', async () => {
    // The scanner above proves the forbidden package is absent, which is the
    // half of OBS-01 that can be greppable. This is the other half: that the
    // meter is obtained from `@opentelemetry/api`, so a future metrics library
    // cannot be introduced by changing one import in a module whose prose still
    // says "one metric path".
    const source = readFileSync(
      `${REPO_ROOT}packages/platform/src/metrics/business-metrics.ts`,
      'utf8',
    );
    const code = stripComments(source);
    const bareImports = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] as string);

    expect(bareImports).toContain('@opentelemetry/api');
    // No other bare module specifier at all: `prom-client`, `@opentelemetry/sdk-*`
    // and every other registry all arrive as a bare import, so requiring the list
    // to be a single entry is a stronger statement than "does not mention the
    // forbidden package".
    expect(bareImports).toEqual(['@opentelemetry/api']);
    expect(code).toContain('metrics.getMeter(METER_NAME)');
  });
});

function workspaceManifests(root: string): string[] {
  const found: string[] = [];
  for (const area of ['packages', 'apps']) {
    let entries: string[];
    try {
      entries = readdirSync(`${root}${area}`);
    } catch {
      continue;
    }
    for (const workspace of entries) {
      if (readdirSync(`${root}${area}/${workspace}`).includes('package.json')) {
        found.push(`${area}/${workspace}/package.json`);
      }
    }
  }
  return found;
}

function declaredDependencies(manifest: unknown): string[] {
  if (typeof manifest !== 'object' || manifest === null) {
    return [];
  }
  const record = manifest as Record<string, unknown>;
  return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    .flatMap((field) => Object.keys((record[field] ?? {}) as Record<string, string>));
}

function sourceFiles(root: string): string[] {
  const found: string[] = [];
  for (const area of ['packages', 'apps']) {
    let workspaces: string[];
    try {
      workspaces = readdirSync(`${root}${area}`);
    } catch {
      continue;
    }
    for (const workspace of workspaces) {
      walk(`${area}/${workspace}/src`);
    }
  }
  return found;

  function walk(path: string): void {
    let entries: string[];
    try {
      entries = readdirSync(`${root}${path}`);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = `${path}/${entry}`;
      if (statSync(`${root}${full}`).isDirectory()) {
        walk(full);
      } else if (full.endsWith('.ts')) {
        found.push(relative(root, `${root}${full}`));
      }
    }
  }
}

/**
 * Comments cannot import a package, so they are removed before the scan.
 * Mirrors the keyPrefix and removed-API scans.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}