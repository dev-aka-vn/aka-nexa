import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import type { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
// `PeriodicExportingMetricReader` lives in `@opentelemetry/sdk-metrics`, not in
// the OTLP metrics exporter package — declaring it is the same reason STACK.md §6
// requires `@opentelemetry/core` to be installed explicitly: a package this
// codebase imports directly must not be reached through a transitive hoist.
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

import { APP_CONFIG_KEYS, AppConfigSchema, formatConfigError } from '../config/config.schema.js';
import { AllowlistSpanExporter } from './allowlist-span-exporter.js';
import {
  createPrometheusExporter,
  getPrometheusExporter,
  setPrometheusExporter,
} from './otel.constants.js';

/**
 * The OTel bootstrap (D-20, OBS-01, FND-07).
 *
 * ## Why this file must be imported before anything instrumented
 *
 * OpenTelemetry's Node instrumentations patch their targets **at require time**.
 * `@opentelemetry/instrumentation-express` replaces the `express` module export;
 * if `express` was already loaded when the hook was installed, the hook never
 * fires and the process runs to completion with no request spans and no error.
 * That failure is silent, which is what makes it dangerous.
 *
 * Measured against the pinned `@opentelemetry/auto-instrumentations-node@0.80.0`
 * (see `otel.bootstrap.ordering.spec.ts` and `otel.bootstrap.too-late.spec.ts`,
 * which are a matched pair on purpose):
 *
 * - SDK started, *then* the instrumented module imported → 4 spans, including
 *   the express `http.route` span;
 * - instrumented module imported, *then* SDK started → 1 span, and it is the
 *   outbound client span. No server span, no route span.
 *
 * So the entrypoint contract is: import `startOtel`, call it, and only then
 * `await import('./app.module.js')`. Each per-app `otel.mjs` loader does the same
 * thing through `node --import`, so a forgotten flag degrades to the in-file
 * call rather than to no traces at all.
 *
 * ## One metrics path
 *
 * Exactly two metric readers exist and one of them is a process-wide singleton:
 * the Prometheus exporter (served from `/metrics` by `MetricsController`) and the
 * OTLP metrics reader (shipped to the collector). There is no `prom-client` — it
 * is deprecated in favour of `@prometheus-io/client` and on the do-not-use list —
 * because a second registry means two scrape endpoints, two naming conventions
 * and split alert rules, which is the whole of OBS-01.
 */
export interface OtelBootstrapConfig {
  /** `api` | `worker` | `scheduler`. Becomes the `service.name` resource attribute. */
  readonly SERVICE_NAME: string;
  /**
   * Base OTLP/HTTP collector endpoint, e.g. `http://collector:4318`.
   *
   * Optional so a process with no collector configured still boots — the OTLP
   * exporters fall back to their own default, and telemetry failing to export
   * must never be the reason a pod does not start.
   */
  readonly OTEL_EXPORTER_OTLP_ENDPOINT?: string | undefined;
}

/** What `startOtel()` hands back, so a caller can shut the SDK down cleanly. */
export interface OtelHandle {
  readonly sdk: NodeSDK;
  /** The same instance `getPrometheusExporter()` returns. */
  readonly prometheus: PrometheusExporter;
  readonly serviceName: string;
}

/** The OTLP/HTTP signal paths, per the OTLP specification. */
const OTLP_SIGNAL_PATHS = Object.freeze({
  traces: 'v1/traces',
  metrics: 'v1/metrics',
} as const);

/**
 * Resolve a base OTLP endpoint to a signal-specific URL.
 *
 * A user-supplied `url` on the OTLP exporters is used **verbatim**; only the
 * `OTEL_EXPORTER_OTLP_ENDPOINT` *environment variable* path appends
 * `/v1/traces` or `/v1/metrics`. Passing the base endpoint as `url` therefore
 * posts every span to the collector's root and gets a 404 that surfaces only as
 * a diag warning — no traces, no crash. The collector owns those signal paths
 * (Tempo, the OTel Collector and Jaeger all default to them), so the base
 * endpoint is normalised here exactly the way the SDK does it from env.
 *
 * Idempotent by design: an operator who configured the signal-specific URL
 * directly gets it back unchanged rather than `.../v1/traces/v1/traces`.
 */
export function otlpSignalUrl(endpoint: string, signal: keyof typeof OTLP_SIGNAL_PATHS): string {
  const base = endpoint.replace(/\/+$/, '');
  const path = OTLP_SIGNAL_PATHS[signal];
  return base.endsWith(`/${path}`) ? base : `${base}/${path}`;
}

/**
 * Build the SDK without starting it.
 *
 * Split from `startOtel()` for one reason: a test can hold the configuration
 * without a global provider being installed, and `startOtel()` can stay a single
 * obvious sequence of side effects. Nothing else should call this — the ordering
 * claim is about *when* `sdk.start()` runs, and a caller that reaches past
 * `startOtel()` has to re-earn that.
 */
export function buildOtelSdk(config: OtelBootstrapConfig): OtelHandle {
  // Reuse the process-wide exporter when one already exists. `startOtel()` is
  // idempotent so this can only be reached once in practice, but a caller that
  // built an SDK and discarded it must not leave a second registry behind.
  const prometheus = getPrometheusExporter() ?? setPrometheusExporter(createPrometheusExporter());

  const traceEndpoint =
    config.OTEL_EXPORTER_OTLP_ENDPOINT === undefined
      ? undefined
      : otlpSignalUrl(config.OTEL_EXPORTER_OTLP_ENDPOINT, 'traces');
  const metricEndpoint =
    config.OTEL_EXPORTER_OTLP_ENDPOINT === undefined
      ? undefined
      : otlpSignalUrl(config.OTEL_EXPORTER_OTLP_ENDPOINT, 'metrics');

  // D-18: the allowlist wrapper sits between the SDK and the wire. Nothing else
  // in the trace path is allowed to see a raw span.
  const traceExporter = new AllowlistSpanExporter(new OTLPTraceExporter({ url: traceEndpoint }));

  return {
    sdk: new NodeSDK({
      serviceName: config.SERVICE_NAME,
      traceExporter,
      metricReaders: [
        prometheus,
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: metricEndpoint }),
        }),
      ],
      // The whole pinned bundle, at the STACK.md §14 version. It is not
      // narrowed here: the choice of which instrumentations to disable is an
      // observability-policy decision with its own cost (the `net` and `dns`
      // instrumentations in particular emit a span per socket), and quietly
      // dropping them in a bootstrap would hide that choice from review.
      instrumentations: [getNodeAutoInstrumentations()],
    }),
    prometheus,
    serviceName: config.SERVICE_NAME,
  };
}

let started: OtelHandle | undefined;
let startOnce: Promise<unknown> | undefined;

/**
 * Start the SDK. **Call this before importing any instrumented module.**
 *
 * Idempotent: a second call returns the handle the first one produced rather
 * than constructing a second `NodeSDK` or calling `start()` again. This is not a
 * nicety. `NodeSDK.start()` is not itself idempotent — it builds a fresh
 * `MeterProvider` and hands every configured `MetricReader` to it, and
 * `MetricReader.setMetricProducer` throws
 * `"MetricReader can not be bound to a MeterProvider again."` on the second
 * pass. Observed, not assumed: `otel.bootstrap.spec.ts` calls `startOtel()`
 * twice and asserts the identical handle comes back.
 */
export async function startOtel(config: OtelBootstrapConfig): Promise<OtelHandle> {
  if (started === undefined) {
    started = buildOtelSdk(config);
    // `NodeSDK.start()` returns `void` at the pinned 0.222.0. The promise is
    // memoised anyway: the contract this function sells is "the SDK is running by
    // the time this resolves", and a future SDK that makes `start()`
    // asynchronous must not turn a second caller into a second `start()`.
    startOnce = Promise.resolve(started.sdk.start());
  }
  await startOnce;
  return started;
}

let stopped = false;

/**
 * Stop the SDK so buffered spans and metrics are flushed (T-1-24).
 *
 * ## Why the three entrypoints must call this
 *
 * A `BatchSpanProcessor` holds finished spans in memory on a timer. Without an
 * explicit `shutdown()` those spans die with the process — so a rolling deploy
 * is precisely the moment telemetry is most likely to be short, and the gap
 * always coincides with a deploy, which is what makes it look like "the
 * exporter drops spans under load" rather than "we threw them away".
 *
 * Called from each `AppModule`'s `onApplicationShutdown`, which
 * `enableShutdownHooks()` makes reachable from SIGTERM (D-09). Idempotent, and a
 * no-op when the process never started an SDK — otherwise a process that died
 * before `startOtel()` would replace a useful error with a confusing one on the
 * way out.
 */
export async function shutdownOtel(): Promise<void> {
  if (started === undefined || stopped) {
    return;
  }
  stopped = true;
  await started.sdk.shutdown();
}

/**
 * The bootstrap slice of the validated boot config, read from the **live**
 * process environment (FND-09, WINDOWS.md entry 12).
 *
 * `startOtel()` runs before Nest exists — that is the whole of D-20's ordering
 * rule — so there is no `ConfigService` to ask, and it runs before any app
 * module, so asking one later would be too late even if one existed. The
 * environment is therefore read directly and validated through the *same*
 * `AppConfigSchema` the boot module uses rather than through a second, narrower
 * schema: two schemas over overlapping keys is how
 * `OTEL_EXPORTER_OTLP_ENDPOINT` came to be read by the SDK and validated by
 * nobody (entry 12).
 *
 * Narrowing to `APP_CONFIG_KEYS` mirrors `namedValidate`, so `process.env`'s
 * hundreds of unrelated keys cannot trip `.strict()`.
 */
export function otelBootstrapConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): OtelBootstrapConfig {
  const candidate: Record<string, unknown> = {};
  for (const key of APP_CONFIG_KEYS) {
    if (key in env) {
      candidate[key] = env[key];
    }
  }

  const result = AppConfigSchema.safeParse(candidate);
  if (!result.success) {
    // The same named boot error as the DI-time module, deliberately: an operator
    // who mistypes MONGO_URL should not get a different diagnostic depending on
    // whether OTel happened to notice first.
    throw new Error(formatConfigError(result.error.issues[0]));
  }

  return {
    SERVICE_NAME: result.data.SERVICE_NAME,
    OTEL_EXPORTER_OTLP_ENDPOINT: result.data.OTEL_EXPORTER_OTLP_ENDPOINT,
  };
}