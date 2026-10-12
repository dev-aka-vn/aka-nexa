/**
 * The OBS-05 instrument (OBS-01, Pitfall 9).
 *
 * `routing_share` is an OTel `ObservableGauge` on the existing
 * meter provider — the single metrics path (OTel metrics API to
 * the one Prometheus exporter). The gauge carries the `app_id`
 * attribute: one series per app in the labelled intent set, each
 * observing that app's share of its intent labels' routings over
 * the rolling 24h window.
 *
 * The spec scrapes the exporter's own serializer through the
 * platform's `MetricsController` — the same end-to-end path a
 * Prometheus server reads — so a registered-but-never-observed
 * gauge, or a gauge on a second meter, fails here.
 */

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  METER_NAME,
  MetricsController,
  MetricsModule,
  startOtel,
} from '@akane/platform';

import type { PublishedApp } from '../../decision/published-app-loader.js';
import type { RoutingOutcomeRecord } from './routing-outcome.repository.js';
import { RoutingShareComputer } from './routing-share.computer.js';
import { registerRoutingShareMetrics } from './routing-share.metrics.js';

const CONFIG = {
  SERVICE_NAME: 'api',
  // Nothing listens here. The OTLP metrics reader is periodic, so a
  // scrape inside the test window never reaches the network.
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1',
} as const;

/** An in-memory outcome store: the records the gauge reads. */
class FakeOutcomeStore {
  private readonly records: RoutingOutcomeRecord[] = [];

  async record(outcome: {
    routing_id: string;
    intent_label: string;
    app_id: string;
  }): Promise<void> {
    this.records.push({ ...outcome, decidedAt: new Date() });
  }

  async outcomesForIntent(
    intentLabel: string,
    windowMs: number,
  ): Promise<RoutingOutcomeRecord[]> {
    const cutoff = Date.now() - windowMs;
    return this.records.filter(
      (r) =>
        r.intent_label === intentLabel && r.decidedAt.getTime() >= cutoff,
    );
  }

  async outcomesForApp(
    appId: string,
    windowMs: number,
  ): Promise<RoutingOutcomeRecord[]> {
    const cutoff = Date.now() - windowMs;
    return this.records.filter(
      (r) => r.app_id === appId && r.decidedAt.getTime() >= cutoff,
    );
  }
}

const CATALOG: readonly PublishedApp[] = [
  {
    id: 'leave-request',
    description: 'Submit a new leave request',
    parameters: [],
    intents: ['request leave'],
    aliases: ['request leave'],
    threshold: 0.8,
    status: 'published',
  },
  {
    id: 'hr-private',
    description: 'Restricted HR app',
    parameters: [],
    intents: ['request leave'],
    aliases: ['request leave'],
    threshold: 0.8,
    status: 'published',
  },
];

describe('routing_share{app_id} (OBS-05)', () => {
  let controller: MetricsController;
  let app: INestApplication;
  let body: string;

  beforeAll(async () => {
    await startOtel(CONFIG);

    const store = new FakeOutcomeStore();
    // 6 routings on the shared label: 2 to leave-request, 4 to hr-private.
    for (let i = 0; i < 2; i++) {
      await store.record({
        routing_id: `lr_${i}`,
        intent_label: 'request leave',
        app_id: 'leave-request',
      });
    }
    for (let i = 0; i < 4; i++) {
      await store.record({
        routing_id: `hr_${i}`,
        intent_label: 'request leave',
        app_id: 'hr-private',
      });
    }

    const computer = new RoutingShareComputer(store, async () => CATALOG);
    registerRoutingShareMetrics(computer);

    const moduleRef = await Test.createTestingModule({
      imports: [MetricsModule],
    }).compile();
    controller = moduleRef.get(MetricsController);
    app = moduleRef.createNestApplication();
    await app.init();

    // The scrape collects the gauge — the callback reads the
    // store and observes each app's share with its app_id.
    body = await controller.scrape();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  it('exports routing_share through the single metrics path', () => {
    // An observable gauge: `# TYPE routing_share gauge`, served by the
    // exporter's own serializer — the same bytes a scraper reads.
    expect(body).toMatch(/^# TYPE routing_share gauge$/m);
  });

  it('observes every app in the labelled intent set with the app_id attribute', () => {
    // leave-request: 2 of 6 shared-label routings; hr-private: 4 of 6.
    expect(body).toMatch(
      /^routing_share\{app_id="leave-request"\} 0\.333333/m,
    );
    expect(body).toMatch(
      /^routing_share\{app_id="hr-private"\} 0\.666667/m,
    );
  });

  it('carries the akane meter scope', () => {
    expect(body).toContain(METER_NAME);
  });
});
