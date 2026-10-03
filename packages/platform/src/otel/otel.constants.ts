import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

/**
 * DI token for the single Prometheus exporter instance (OBS-01).
 *
 * A `Symbol` for the same reason `EXTRA_HEALTH_INDICATORS` is one in
 * `health.controller.ts`: the exporter is a process-wide singleton, and the
 * module that builds it (`otel.bootstrap.ts`) is not a Nest provider. The token
 * is the only handle `MetricsModule` has on it, so a second construction would
 * have to go through `createPrometheusExporter()` explicitly rather than by
 * accident.
 */
export const OTEL_PROMETHEUS_EXPORTER = Symbol('OTEL_PROMETHEUS_EXPORTER');

/**
 * The scrape path this process serves, pinned.
 *
 * Two reasons this is a constant rather than a string at the route decorator:
 * the `PrometheusExporter` compares incoming paths against its own configured
 * `endpoint`, and a `/metrics` route that disagreed with it would 404 inside the
 * exporter. Pinning one value and asserting the equality in
 * `metrics.controller.spec.ts` keeps the two from drifting.
 */
export const PROMETHEUS_SCRAPE_ENDPOINT = '/metrics';

/**
 * Construct the Prometheus exporter — **always with no HTTP server**.
 *
 * `preventServerStart: true` is the OBS-01 guarantee that the app is the only
 * scrape endpoint (T-1-22). Without it the exporter would bind its own listener
 * on `9464` and every deployment would have two places to scrape, two alert
 * rules to keep in sync, and a second, unauthenticated operational surface that
 * nothing in this repository governs.
 *
 * The exporter still allocates an `unref`'d `http.Server` object in its
 * constructor — that is the library's shape, not a listener. `preventServerStart`
 * is what keeps `listen()` from being called, and `metrics.controller.spec.ts`
 * asserts the listener never came up.
 *
 * There is exactly one place in this codebase that constructs a
 * `PrometheusExporter`. A second construction is not caught by a test but is a
 * review red flag, and the singleton below makes it useless anyway.
 */
export function createPrometheusExporter(): PrometheusExporter {
  return new PrometheusExporter({
    preventServerStart: true,
    endpoint: PROMETHEUS_SCRAPE_ENDPOINT,
  });
}

/**
 * The process-wide exporter instance, or `undefined` before `startOtel()` ran.
 *
 * `undefined` rather than a lazily-constructed fallback is deliberate: a
 * fallback would hand a caller an exporter that no `MeterProvider` was ever bound
 * to, and `collect()` on an unbound reader throws. `MetricsModule` therefore
 * fails boot loudly when the process never called `startOtel()`, which is the
 * only honest answer — an empty `/metrics` page would read as "nothing is
 * happening" rather than "telemetry is misconfigured".
 */
let registered: PrometheusExporter | undefined;

export function getPrometheusExporter(): PrometheusExporter | undefined {
  return registered;
}

/**
 * Register `candidate` as *the* exporter, or return the one already registered.
 *
 * Registration is first-write-wins, not last-write-wins. `startOtel()` is
 * already idempotent (it returns the existing handle), so a second registration
 * can only arrive from a caller that bypassed it — and silently swapping the
 * exporter underneath an already-started `MeterProvider` would leave the
 * metric reader bound to an instance nothing scrapes, which is exactly the
 * "permanently-zero series" failure `queue.oldest.item.age` was designed to
 * avoid.
 */
export function setPrometheusExporter(candidate: PrometheusExporter): PrometheusExporter {
  registered ??= candidate;
  return registered;
}