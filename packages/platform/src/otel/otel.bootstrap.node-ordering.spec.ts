import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The D-20 counterfactual, run in a **real Node process**.
 *
 * `otel.bootstrap.ordering.spec.ts` proves the positive half: with
 * `startOtel()` called first, a Nest route produces an Express `http.route`
 * span. That assertion alone is worth little — it is equally consistent with an
 * entrypoint order that works and one that is broken. The property that makes
 * the ordering load-bearing is the *difference*, so it has to be measured.
 *
 * ## Why a child process and not a second in-process test file
 *
 * Because inside Vitest the difference is not observable. This file was first
 * written as the mirror image of the ordering spec — `@nestjs/core` and
 * `@nestjs/common` imported statically at the top, `startOtel()` called in the
 * test body, the same request issued — and the route span **still appeared**.
 * Vitest resolves external CJS through its own module runner rather than
 * through the `Module._load` chain that `require-in-the-middle` patches, so the
 * "load it too early and the hook never fires" mechanism does not reproduce
 * there. Asserting `false` on that file would have been asserting a property of
 * the test runner, not of the code.
 *
 * Spawning `node` puts the probe back in the execution model production uses —
 * plain ESM, native loader, `require-in-the-middle` in the chain — and the
 * difference is stark. Measured, not assumed:
 *
 * | order                                | spans | server span | route span |
 * |--------------------------------------|-------|-------------|------------|
 * | SDK first, app modules second        | 7     | yes         | yes        |
 * | app modules first, SDK second        | 1     | **no**      | **no**     |
 *
 * The surviving span in the late case is the *outbound client* span — proof
 * that telemetry is not entirely absent, which is exactly why the mistake is
 * silent: a process still emits traces, just not the ones an operator needs.
 *
 * Two details cost real debugging time and are worth keeping in the file:
 *
 *  1. **`NestFactory.create()` resolves the Express adapter lazily.** Without
 *     an explicit `@nestjs/platform-express` import in the late mode, `express`
 *     is not loaded until after `sdk.start()` in *either* mode, and the two runs
 *     come out byte-identical — a counterfactual that proves nothing.
 *  2. **`forceFlush()` is required before reading.** The SDK's resource detectors
 *     resolve asynchronously and a span's export awaits them, so both modes
 *     read as "zero spans" without it.
 *
 * `--input-type=module -e` is used instead of a file on disk so the spec leaves
 * nothing behind, and so the module base URL is the repository root, where the
 * pinned `@opentelemetry/*` packages resolve.
 */
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

const PROBE = String.raw`
import 'reflect-metadata';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace';

const MODE = process.env.PROBE_MODE;

// The instrumented modules. Loaded before the SDK in one mode, after it in the
// other — nothing else differs between the two runs.
const loadInstrumented = async () => {
  const [{ NestFactory }, { Controller, Get, Module }] = await Promise.all([
    import('@nestjs/core'),
    import('@nestjs/common'),
  ]);
  return { NestFactory, Controller, Get, Module };
};

let instrumented;
if (MODE === 'late') {
  instrumented = await loadInstrumented();
  // The mistake being reproduced is a top-of-file import of the application
  // module, and this is the package that import drags in: NestFactory resolves
  // the Express adapter lazily, so without this line express would not be
  // loaded until after sdk.start() in EITHER mode and the two runs would be
  // indistinguishable.
  await import('@nestjs/platform-express');
}

const memory = new InMemorySpanExporter();
const sdk = new NodeSDK({
  serviceName: 'akane-ordering-probe',
  // A SimpleSpanProcessor, so the result needs no flush delay and the probe is
  // not timing-dependent.
  spanProcessors: [new SimpleSpanProcessor({ exporter: memory })],
  instrumentations: [getNodeAutoInstrumentations()],
  // No metric readers. NodeSDK otherwise builds an OTLP periodic reader from the
  // OTEL_* env defaults, which has nothing to talk to here and keeps the child
  // alive through its export retries. This probe is about spans.
  metricReaders: [],
});
sdk.start();

if (MODE === 'early') {
  instrumented = await loadInstrumented();
}

const { NestFactory, Controller, Get, Module } = instrumented;

// Decorators are TypeScript syntax, and this probe runs on plain node. The
// decorator functions are applied by hand instead — same metadata, no syntax the
// runtime has to be taught. (No backticks in this string: it is a template
// literal, and one would close it.)
class ProbeController {
  probe() {
    return { ok: true };
  }
}
Get('/probe')(
  ProbeController.prototype,
  'probe',
  Object.getOwnPropertyDescriptor(ProbeController.prototype, 'probe'),
);
Controller('order-probe')(ProbeController);

class ProbeModule {}
Module({ controllers: [ProbeController] })(ProbeModule);

const app = await NestFactory.create(ProbeModule, { logger: false });
await app.listen(0, '127.0.0.1');
const url = await app.getUrl();
const response = await fetch(url + '/order-probe/probe');
await response.text();
await app.close();

// The SDK's resource detectors resolve asynchronously, and a span's export
// awaits them — so without this the exporter has not been called yet and both
// modes read as zero spans. This is the single most confusing thing about
// reading these numbers by hand.
await sdk._tracerProvider.forceFlush();

const result = JSON.stringify(
  memory.getFinishedSpans().map((span) => ({
    name: span.name,
    kind: span.kind,
    route: span.attributes['http.route'] ?? null,
  })),
);

// Without this the child hangs for the SDK's default 60 s metric-export timer —
// NodeSDK builds a meter provider from OTEL_* env defaults even when the caller
// asks for none — and the spec waits out the full interval on every run.
await sdk.shutdown();
process.stdout.write(result);
`;

interface ProbeSpan {
  readonly name: string;
  readonly kind: number;
  readonly route: string | null;
}

function runProbe(mode: 'early' | 'late'): Promise<ProbeSpan[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', PROBE],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, PROBE_MODE: mode },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`probe (${mode}) exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as ProbeSpan[]);
      } catch {
        reject(new Error(`probe (${mode}) produced unparseable output: ${stdout}\n${stderr}`));
      }
    });
  });
}

describe('D-20 ordering, measured in a real Node process', () => {
  it('emits the route span when the SDK starts first, and loses it when it starts second', async () => {
    const [early, late] = await Promise.all([runProbe('early'), runProbe('late')]);

    // SpanKind.SERVER = 1. The http instrumentation's server span, and the
    // express instrumentation's route span, are what an operator actually
    // queries.
    const routeSpans = (spans: ProbeSpan[]): ProbeSpan[] => spans.filter((s) => s.route !== null);
    const serverSpans = (spans: ProbeSpan[]): ProbeSpan[] => spans.filter((s) => s.kind === 1);

    expect(routeSpans(early).length).toBeGreaterThan(0);
    expect(serverSpans(early).length).toBeGreaterThan(0);

    expect(routeSpans(late)).toEqual([]);
    expect(serverSpans(late)).toEqual([]);

    // Not "nothing at all" — the late run still emits the outbound client span.
    // This is what makes the mistake silent: the process still has a working
    // pipeline, just not the spans anyone is looking for.
    expect(late.length).toBeGreaterThan(0);
    expect(late.length).toBeLessThan(early.length);
  }, 120_000);
});