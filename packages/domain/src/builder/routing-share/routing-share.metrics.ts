import { metrics, type ObservableGauge } from '@opentelemetry/api';

import { METER_NAME } from '@akane/platform';

import { RoutingShareComputer } from './routing-share.computer.js';

/**
 * The OBS-05 instrument (OBS-01, Pitfall 9).
 *
 * `routing_share` is an OTel `ObservableGauge` on the existing
 * meter provider — the single metrics path (OTel metrics API
 * to the one Prometheus exporter; `prom-client` is on the
 * do-not-use list and a second registry would mean two scrape
 * endpoints). The gauge carries the `app_id` attribute: one
 * series per app in the labelled intent set, each observing
 * that app's share of its intent labels' routings over the
 * rolling 24h window the computer names.
 *
 * The meter is obtained per call, not at module load — the
 * global meter provider is installed by the OTel bootstrap
 * that runs before any instrumented module is imported (D-20);
 * a meter captured at import time can bind to the pre-bootstrap
 * no-op provider and silently record nothing.
 */

/** The instrument name, on the single metrics path. */
export const ROUTING_SHARE_METRIC = 'routing_share';

/**
 * Register the `routing_share{app_id}` gauge over the share
 * computer. Idempotent by the caller's discipline: a second
 * registration of the same name produces two live instruments
 * with one name and the exporter emits the series twice, so a
 * process registers once (its composition root).
 */
export function registerRoutingShareMetrics(
  computer: RoutingShareComputer,
): ObservableGauge {
  const meter = metrics.getMeter(METER_NAME);
  const gauge = meter.createObservableGauge(
    ROUTING_SHARE_METRIC,
    {
      description:
        'Each app share of routings across its declared intent labels, over the rolling 24h window (OBS-05).',
    },
  );
  // The observation callback attaches to the instrument:
  // the meter hands the gauge its readings at collection
  // time (scrape), reading the computer fresh each time.
  gauge.addCallback(async (observableResult) => {
    for (const { appId, share } of await computer.snapshot()) {
      observableResult.observe(share, { app_id: appId });
    }
  });
  return gauge;
}
