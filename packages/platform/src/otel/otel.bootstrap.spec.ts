import { metrics } from '@opentelemetry/api';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { otlpSignalUrl, type OtelBootstrapConfig } from './otel.bootstrap.js';

const CONFIG: OtelBootstrapConfig = {
  SERVICE_NAME: 'api',
  // A port nothing listens on. The exporters are constructed but never reach it
  // in this spec: no tracer is ever started, so no span is exported and the OTLP
  // client is never dialled. The address exists so that an accidental export
  // fails fast and locally instead of reaching a real collector.
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1',
};

/**
 * Both observability modules, re-imported together.
 *
 * `startOtel()` memoises in module scope and the Prometheus exporter is a
 * process singleton — that is the behaviour under test, and it also means a
 * statically imported module carries whatever state the previous test left
 * behind. Worse, `vi.resetModules()` gives `otel.bootstrap.js` and
 * `otel.constants.js` *fresh* instances while a static import of either would
 * still hold the *original*: two live copies of the singleton, and every
 * assertion about "the" exporter becomes a comparison between them. So both are
 * pulled through the same dynamic import. Same rule as `business-metrics.spec.ts`.
 */
async function freshOtel() {
  vi.resetModules();
  const otel = await import('./otel.bootstrap.js');
  const constants = await import('./otel.constants.js');
  // The allowlist exporter is re-imported too, for the same reason: after
  // `resetModules` the freshly imported `otel.bootstrap.js` builds its
  // `AllowlistSpanExporter` from a *fresh* copy of the class, and an
  // `instanceof` against the original copy would compare two different classes.
  const allowlist = await import('./allowlist-span-exporter.js');
  return { otel, constants, allowlist };
}

type OtelBootstrap = typeof import('./otel.bootstrap.js');
type OtelConstants = typeof import('./otel.constants.js');

/**
 * The configuration `NodeSDK` was actually constructed with.
 *
 * White-box by necessity: `NodeSDK` exposes no getter for its configuration, and
 * "the SDK carries the allowlist wrapper" is the claim under test — asserting it
 * through the SDK's start-up behaviour would mean standing up a real tracer
 * provider per assertion. Safe against drift because every OTel package here is
 * `--save-exact` at its STACK.md §14 pin, so a shape change arrives as a
 * deliberate version bump rather than as a surprise.
 */
function sdkConfiguration(sdk: unknown): Record<string, unknown> {
  return (sdk as { _configuration: Record<string, unknown> })._configuration;
}

function sourceOf(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
}

describe('startOtel (D-20, OBS-01)', () => {
  afterEach(() => {
    metrics.disable();
  });

  it('is idempotent: a second call returns the same handle, not a second SDK', async () => {
    const { otel } = await freshOtel();

    const first = await otel.startOtel(CONFIG);
    const second = await otel.startOtel({ ...CONFIG, SERVICE_NAME: 'worker' });

    // Identity, not equality. `NodeSDK.start()` is NOT idempotent: it builds a
    // fresh `MeterProvider` and hands it every configured `MetricReader`, and
    // `MetricReader.setMetricProducer` throws "MetricReader can not be bound to
    // a MeterProvider again." on the second pass. Reaching this assertion at all
    // is the proof that the second call returned early.
    expect(second).toBe(first);
    expect(second.sdk).toBe(first.sdk);
    expect(second.prometheus).toBe(first.prometheus);
    expect(second.serviceName).toBe('api');
  });

  it('registers exactly one Prometheus exporter, and getPrometheusExporter() returns it', async () => {
    const { otel, constants } = await freshOtel();

    // `buildOtelSdk`, not `startOtel`: the singleton is registered by the
    // construction step, and starting a second SDK in this process would fight
    // the global provider the idempotency test already installed. The
    // start-then-import ordering is proved in `otel.bootstrap.ordering.spec.ts`,
    // in its own process.
    const handle = otel.buildOtelSdk(CONFIG);

    expect(handle.prometheus).toBe(constants.getPrometheusExporter());
    // Re-registration cannot displace it: a caller that bypassed `startOtel`
    // would otherwise swap the exporter out from under an already-bound reader,
    // leaving the metric reader bound to an instance nothing scrapes.
    expect(constants.setPrometheusExporter(constants.createPrometheusExporter())).toBe(
      handle.prometheus,
    );
    expect(constants.getPrometheusExporter()).toBe(handle.prometheus);
  });

  it('builds its own exporter when none is registered yet', async () => {
    const { constants } = await freshOtel();

    // The `undefined`-not-fallback rule, asserted directly: a lazy fallback would
    // hand a caller an exporter no `MeterProvider` was ever bound to, and
    // `collect()` on an unbound reader throws. An empty `/metrics` page would
    // read as "nothing is happening" rather than "telemetry is misconfigured".
    expect(constants.getPrometheusExporter()).toBeUndefined();
    expect(constants.createPrometheusExporter()).toBeInstanceOf(PrometheusExporter);
  });

  it('builds one SDK carrying the allowlist trace exporter, OTLP metrics and Prometheus', async () => {
    const { otel, constants, allowlist } = await freshOtel();

    const handle = otel.buildOtelSdk(CONFIG);
    const configuration = sdkConfiguration(handle.sdk);

    // The trace exporter the SDK was handed IS the allowlist wrapper. That the
    // OTLP exporter sits *behind* it is proved end-to-end in
    // `otel.bootstrap.ordering.spec.ts`, which captures spans at the OTLP
    // exporter boundary and finds them already filtered.
    expect(configuration['traceExporter']).toBeInstanceOf(allowlist.AllowlistSpanExporter);

    // Exactly two metric readers, and the first is the singleton the controller
    // will serve. A third would be a second metric path.
    const readers = configuration['metricReaders'] as unknown[];
    expect(readers).toHaveLength(2);
    expect(readers[0]).toBe(handle.prometheus);
    expect(readers[0]).toBe(constants.getPrometheusExporter());
    expect(readers[0]).toBeInstanceOf(PrometheusExporter);
    expect(readers[1]?.constructor.name).toBe('PeriodicExportingMetricReader');

    // The auto-instrumentation bundle is what gives the entrypoint ordering in
    // `otel.bootstrap.ordering.spec.ts` anything to mean.
    const instrumentations = configuration['instrumentations'] as unknown[];
    expect(instrumentations).toHaveLength(1);
    expect((instrumentations[0] as unknown[]).length).toBeGreaterThan(20);

    expect(configuration['serviceName']).toBe('api');
    expect(handle.serviceName).toBe('api');
  });

  it('never creates the Prometheus exporter with its own HTTP server', async () => {
    const { otel, constants } = await freshOtel();
    const handle = otel.buildOtelSdk(CONFIG);
    const exporter = handle.prometheus as unknown as {
      _server?: { listening: boolean };
      _startServerPromise?: unknown;
    };

    // OBS-01 / T-1-22: the app is the only scrape endpoint. Two assertions,
    // because `preventServerStart` is only half of the claim — the exporter also
    // allocates an `unref`'d `http.Server` object in its constructor, so "no
    // listener" is checked against the server itself rather than against the
    // flag that was passed in.
    expect(exporter._server).toBeDefined();
    expect(exporter._server?.listening).toBe(false);
    expect(exporter._startServerPromise).toBeUndefined();

    // …and the default port is genuinely free, the black-box form of the same
    // claim. If a future change dropped `preventServerStart`, this is the line
    // that goes red rather than a comment nobody re-reads.
    await expect(bindOnce(9464)).resolves.toBe(true);

    // The factory itself cannot express the failure: there is no parameter that
    // turns the listener on.
    expect(sourceOf('./otel.constants.ts')).not.toMatch(
      /new PrometheusExporter\(\s*\{[^}]*(?<!preventServerStart:\s*true)[^}]*preventServerStart:\s*false/,
    );
    expect(constants.createPrometheusExporter()).not.toBe(handle.prometheus);
  });

  it('wires the trace exporter through the allowlist, never bare to the collector', async () => {
    const source = sourceOf('./otel.bootstrap.ts');

    // The wrapper is constructed here and nowhere else. A bare
    // `new OTLPTraceExporter` reaching the SDK would export unfiltered spans, and
    // the specs in this directory could not tell the difference — they test the
    // wrapper, not the wiring.
    expect(source).toContain('new AllowlistSpanExporter(new OTLPTraceExporter(');
    expect(source.match(/new OTLPTraceExporter\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/traceExporter:\s*new OTLPTraceExporter\(/);
  });

  it('names no second metrics registry in the observability source', () => {
    // OBS-01 restated at the wiring level. `business-metrics.spec.ts` already
    // scans for `prom-client`; this one additionally refuses any other
    // Prometheus client package reaching the bootstrap.
    //
    // Source files only, never this spec: the patterns below are written here,
    // and a scan that matched its own detector would be a test that can only
    // pass by being deleted.
    const forbidden = /\bprom-client\b|@opentelemetry\/exporter-prometheus-http|node-prometheus\b/;

    for (const file of ['./otel.bootstrap.ts', './otel.constants.ts', './index.ts']) {
      expect(forbidden.test(stripComments(sourceOf(file)))).toBe(false);
    }
    // The one Prometheus package in the graph is the one STACK.md §14 pins.
    expect(sourceOf('./otel.constants.ts')).toContain("from '@opentelemetry/exporter-prometheus'");
  });

  it('declares every OTel package it imports directly, at the pinned version', () => {
    // The `@opentelemetry/core` lesson from STACK.md §6: a package imported by
    // our own source must be declared, not reached through a hoist. This walks
    // the bare specifiers out of the observability sources and checks each one
    // against the manifest.
    const manifest = JSON.parse(sourceOf('../../../../package.json')) as {
      devDependencies: Record<string, string>;
    };
    const declared = new Set(Object.keys(manifest.devDependencies));
    const imported = new Set<string>();

    for (const file of ['./otel.bootstrap.ts', './otel.constants.ts', './allowlist-span-exporter.ts', './span-attribute-allowlist.ts']) {
      for (const match of stripComments(sourceOf(file)).matchAll(/from '(@opentelemetry\/[^']+)'/g)) {
        imported.add(match[1] as string);
      }
    }

    expect([...imported].filter((specifier) => !declared.has(specifier))).toEqual([]);
    expect(manifest.devDependencies['@opentelemetry/sdk-node']).toBe('0.222.0');
    expect(manifest.devDependencies['@opentelemetry/core']).toBe('2.11.0');
    expect(manifest.devDependencies['@opentelemetry/api']).toBe('1.9.1');
    expect(manifest.devDependencies['@opentelemetry/auto-instrumentations-node']).toBe('0.80.0');
    expect(manifest.devDependencies['@opentelemetry/exporter-trace-otlp-http']).toBe('0.222.0');
    expect(manifest.devDependencies['@opentelemetry/exporter-metrics-otlp-http']).toBe('0.222.0');
    expect(manifest.devDependencies['@opentelemetry/exporter-prometheus']).toBe('0.222.0');
  });
});

describe('otlpSignalUrl', () => {
  it('appends the signal path to a base endpoint', () => {
    expect(otlpSignalUrl('http://collector:4318', 'traces')).toBe('http://collector:4318/v1/traces');
    expect(otlpSignalUrl('http://collector:4318', 'metrics')).toBe(
      'http://collector:4318/v1/metrics',
    );
  });

  it('tolerates a trailing slash', () => {
    expect(otlpSignalUrl('http://collector:4318/', 'traces')).toBe('http://collector:4318/v1/traces');
    expect(otlpSignalUrl('http://collector:4318///', 'metrics')).toBe(
      'http://collector:4318/v1/metrics',
    );
  });

  it('is idempotent on an already signal-specific URL', () => {
    expect(otlpSignalUrl('http://collector:4318/v1/traces', 'traces')).toBe(
      'http://collector:4318/v1/traces',
    );
  });

  it('preserves a path prefix, which a collector behind a reverse proxy uses', () => {
    expect(otlpSignalUrl('https://otel.example.com/otlp', 'traces')).toBe(
      'https://otel.example.com/otlp/v1/traces',
    );
  });

  it('would be wrong without it — the counterfactual the SDK itself documents', () => {
    // A user-supplied `url` on the OTLP exporters is used **verbatim**; only the
    // `OTEL_EXPORTER_OTLP_ENDPOINT` environment path appends the signal path.
    // Passing the base endpoint straight through posts every span to the
    // collector root and 404s, which the SDK reports as a diag warning and
    // nothing else.
    expect(otlpSignalUrl('http://collector:4318', 'traces')).not.toBe('http://collector:4318');
  });
});

describe('the scrape endpoint is one constant', () => {
  it('is the value the exporter is configured with', async () => {
    const { constants } = await freshOtel();

    expect(constants.PROMETHEUS_SCRAPE_ENDPOINT).toBe('/metrics');
    // The exporter compares incoming paths against its own configured
    // `endpoint`; a `/metrics` route that disagreed would 404 *inside* the
    // exporter while returning 200 from Nest. Asserted in
    // `metrics.controller.spec.ts` against the running route.
    expect(constants.PROMETHEUS_SCRAPE_ENDPOINT.startsWith('/')).toBe(true);
  });

  it('is a symbol token the metrics module can inject', async () => {
    const { constants } = await freshOtel();

    expect(typeof constants.OTEL_PROMETHEUS_EXPORTER).toBe('symbol');
  });
});

/** Resolve true when `port` could be bound — i.e. nothing else is listening. */
async function bindOnce(port: number): Promise<boolean> {
  const net = await import('node:net');
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

// Referenced only so the unused-import lint stays honest about the two module
// namespaces this file exercises through `freshOtel()`.
export type { OtelBootstrap, OtelConstants };