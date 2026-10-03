import { Module, type Provider } from '@nestjs/common';
import type { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

import { OTEL_PROMETHEUS_EXPORTER, getPrometheusExporter } from '../otel/otel.constants.js';
import { MetricsController } from './metrics.controller.js';

/**
 * Resolve the process-wide exporter, or refuse to boot.
 *
 * An `undefined` exporter cannot be substituted: `MetricsController` needs the
 * *registered* instance, because that is the one a `MeterProvider` is bound to.
 * A lazily constructed replacement would collect nothing and serve a page full
 * of `target_info` and no series — a healthy-looking 200 that an operator reads
 * as "the platform is idle". So the failure is a named boot error instead.
 */
export function requirePrometheusExporter(): PrometheusExporter {
  const exporter = getPrometheusExporter();
  if (exporter === undefined) {
    throw new Error(
      'OTEL_NOT_STARTED: no Prometheus exporter is registered. Call startOtel() from ' +
        'apps/*/main.ts (or the otel.mjs loader) before NestFactory.create(); /metrics ' +
        'cannot serve an exporter that no MeterProvider is bound to.',
    );
  }
  return exporter;
}

export const prometheusExporterProvider: Provider = {
  provide: OTEL_PROMETHEUS_EXPORTER,
  useFactory: requirePrometheusExporter,
};

/**
 * Mounts `/metrics` on a process (OBS-01).
 *
 * Imported by all three entrypoints in plan 10, because each process owns its
 * own registry — the `api`, `worker` and `scheduler` registries are separate
 * processes, not three views of one, so all three must serve the endpoint or an
 * operator is silently missing whichever process emitted the series they are
 * querying.
 *
 * The controller is declared here rather than exported as a bare class so no
 * composition root can mount it without also supplying the exporter token, and
 * the token is re-exported because plan 10's health wiring may want to assert
 * against the same instance.
 */
@Module({
  controllers: [MetricsController],
  providers: [prometheusExporterProvider],
  exports: [OTEL_PROMETHEUS_EXPORTER],
})
export class MetricsModule {}