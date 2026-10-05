import { Controller, Get, Header, Inject } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

import { OTEL_PROMETHEUS_EXPORTER } from '../otel/otel.constants.js';

/**
 * The single scrape endpoint (OBS-01, T-1-22).
 *
 * ## Why the app serves this rather than the exporter
 *
 * `PrometheusExporter` can run its own HTTP listener on port 9464. It must not
 * (D-20's one-metrics-path rule), so it is constructed with
 * `preventServerStart: true` and this controller is the only thing that ever
 * renders it. One endpoint means one set of alert rules and one surface to
 * govern — a second listener would be an unauthenticated read of operational
 * state that nothing in this repository protects, and it would drift from the
 * app's own auth and TLS posture.
 *
 * ## Why the exporter does the serialising
 *
 * The exposition format is the exporter's own `PrometheusSerializer`, reached
 * through `getMetricsRequestHandler`. Hand-rolling the text here would work until
 * the exporter changed a naming rule — a unit suffix, a label-escaping fix — and
 * then `/metrics` would quietly disagree with every dashboard built on it, with
 * nothing failing.
 *
 * The handler takes an `IncomingMessage`/`ServerResponse` pair because it is
 * normally mounted on an `http.Server`. The first argument is ignored by the
 * exporter (only the private `http.createServer` callback routes on `url`), so a
 * minimal response double is passed and the body is captured from `end()`.
 * `resolvePrometheusPage` is that adapter, and it is a method on the controller
 * rather than a free function so the exporter still comes from the DI token.
 */
@Controller('metrics')
export class MetricsController {
  readonly #exporter: PrometheusExporter;

  constructor(@Inject(OTEL_PROMETHEUS_EXPORTER) exporter: PrometheusExporter) {
    this.#exporter = exporter;
  }

  /**
   * `GET /metrics` — Prometheus exposition, served from the one exporter.
   *
   * Returns a string rather than an object so Nest writes the bytes verbatim;
   * anything shaped like JSON would come back as JSON, which no scraper can
   * parse. The `Content-Type` is set explicitly because the exporter's own
   * handler sets `text/plain` on the response object it is handed — which here
   * is a double, not the real HTTP response.
   */
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  scrape(): Promise<string> {
    return this.#render();
  }

  #render(): Promise<string> {
    const exporter = this.#exporter;
    return new Promise<string>((resolve, reject) => {
      const response = {
        statusCode: 0,
        headers: {} as Record<string, string>,
        setHeader(name: string, value: string): void {
          this.headers[name.toLowerCase()] = value;
        },
        end(chunk?: string): void {
          // The exporter reports a collection failure by ending the response
          // with a diagnostic string. Serving that as a 200 would let a broken
          // registry look like a healthy empty one, so it is turned into an
          // error the caller can see.
          const body = chunk ?? '';
          if (body.startsWith('# failed to export metrics:')) {
            reject(new Error(body));
            return;
          }
          resolve(body);
        },
      };

      exporter.getMetricsRequestHandler(
        undefined as unknown as IncomingMessage,
        response as unknown as ServerResponse,
      );
    });
  }
}