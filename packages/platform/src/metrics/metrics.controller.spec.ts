import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  METER_NAME,
  PLATFORM_HEARTBEAT_METRIC,
  QUEUE_JOB_FAILURES_METRIC,
  registerBusinessMetrics,
} from './business-metrics.js';
import { MetricsController } from './metrics.controller.js';
import { MetricsModule, requirePrometheusExporter } from './metrics.module.js';
import { OTEL_PROMETHEUS_EXPORTER, getPrometheusExporter } from '../otel/otel.constants.js';

const CONFIG = {
  SERVICE_NAME: 'api',
  // Nothing listens here. The OTLP metrics reader is periodic, so a scrape that
  // happens inside the test window never reaches the network.
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1',
} as const;

/**
 * Prometheus renders a metric name by replacing `.` with `_` and appending the
 * counter unit suffix, so `platform.heartbeat` is scraped as
 * `platform_heartbeat_total`. Asserting the OTel name verbatim would test the
 * wrong string.
 */
const asPrometheusName = (otelName: string): string => `${otelName.replaceAll('.', '_')}_total`;

/**
 * `/metrics` over real HTTP, from a real SDK (OBS-01, T-1-22).
 *
 * The whole stack is live: `startOtel()` installs the meter provider that the
 * plan-08 instruments are created on, `registerBusinessMetrics()` puts the
 * Phase 1 counters on it, and the controller serves whatever the exporter
 * serialises. A stubbed exporter would pass every one of these assertions while
 * proving nothing about the hand-off plan 08 set up — and "the instruments exist
 * but nothing scrapes them" is precisely the half of OBS-01 that plan 08 left
 * open.
 */
describe('GET /metrics (OBS-01)', () => {
  let app: INestApplication;
  let body: string;
  let status: number;
  let contentType: string | null;

  beforeAll(async () => {
    const { startOtel } = await import('../otel/otel.bootstrap.js');
    await startOtel(CONFIG);

    // Real increments, so each counter has a data point to export. A
    // created-but-never-recorded counter can legitimately serialise to nothing,
    // and the assertion would then be measuring the SDK rather than the wiring.
    const instruments = registerBusinessMetrics();
    instruments.platformHeartbeat.add(1);
    instruments.queueJobFailures.add(2, { queue: 'platform-heartbeat', job: 'probe' });

    const moduleRef = await Test.createTestingModule({ imports: [MetricsModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const response = await fetch(`${url}/metrics`);
    status = response.status;
    contentType = response.headers.get('content-type');
    body = await response.text();
    // Explicit: the suite-wide `hookTimeout` is 30 s and this hook also pays for
    // loading the SDK, the auto-instrumentation bundle and `@nestjs/testing`.
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  it('returns 200 with a Prometheus exposition body', () => {
    expect(status).toBe(200);
    // `# HELP` / `# TYPE` headers and `name{labels} value` samples. A JSON body,
    // or an empty 200 from a misconfigured exporter, fails here — and an empty
    // page is the specific failure mode of a reader bound to no MeterProvider.
    expect(contentType).toContain('text/plain');
    expect(body).toMatch(/^# HELP /m);
    expect(body).toMatch(/^# TYPE \S+ (counter|gauge|histogram|summary|uptime)$/m);
    expect(body.split('\n').filter((line) => line.trim().length > 0).length).toBeGreaterThan(3);
  });

  it('names the Phase 1 instruments registered in business-metrics.ts', () => {
    for (const otelName of [PLATFORM_HEARTBEAT_METRIC, QUEUE_JOB_FAILURES_METRIC]) {
      expect(body).toContain(asPrometheusName(otelName));
    }
    // …carrying the values that were recorded, not zeros: a permanently-zero
    // series is what `queue.oldest.item.age` was left un-registered to avoid.
    expect(body).toMatch(
      new RegExp(`^${asPrometheusName(PLATFORM_HEARTBEAT_METRIC)}\\{[^}]*\\} 1$`, 'm'),
    );
    expect(body).toMatch(
      new RegExp(`^${asPrometheusName(QUEUE_JOB_FAILURES_METRIC)}\\{[^}]*\\} 2$`, 'm'),
    );
    // The meter name reaches the scrape output as the OTel scope, proving these
    // came from `akane` and not from some other registry.
    expect(body).toContain(METER_NAME);
  });

  it('resolves the exporter from the shared singleton, not a new one', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [MetricsModule] }).compile();

    expect(moduleRef.get(OTEL_PROMETHEUS_EXPORTER)).toBe(getPrometheusExporter());
    expect(requirePrometheusExporter()).toBe(getPrometheusExporter());

    await moduleRef.close();
  });

  it('serves the exporter\'s own serialisation, not a reimplementation', () => {
    // The controller delegates to the exporter's own request handler. If it ever
    // hand-rolled the exposition format instead, a change in the exporter's
    // serializer would leave `/metrics` silently stale — two formats, one
    // endpoint, and no test would notice. `target_info` and
    // `otel_scope_info` are emitted by the exporter's serializer and by nothing
    // else, so their presence is the marker.
    expect(MetricsController).toBeTypeOf('function');
    expect(body).toContain('target_info');
  });
});

describe('a process that never started OTel', () => {
  it('fails loudly at boot rather than serving an empty page', async () => {
    // `MetricsModule` is composed by every entrypoint in plan 10, so a process
    // that forgets `startOtel()` would otherwise come up healthy with a
    // `/metrics` route that 200s forever. An operator reads that as "the
    // platform is idle"; the honest answer is a boot failure with a named code.
    vi.resetModules();
    const constants = await import('../otel/otel.constants.js');
    const module_ = await import('./metrics.module.js');

    expect(constants.getPrometheusExporter()).toBeUndefined();
    expect(() => module_.requirePrometheusExporter()).toThrow(/OTEL_NOT_STARTED/);
  });
});