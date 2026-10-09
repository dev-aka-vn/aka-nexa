import { metrics, type Counter } from '@opentelemetry/api';

import type { ReadDenyReason } from '@akane/contract';
import { METER_NAME } from '@akane/platform';
import type { ReadDenyAction, ReadDenyRecorder } from '@akane/domain';

/**
 * The LNK-08 denial counter (D-71).
 *
 * ## One metric path
 *
 * The instrument is created from the same `akane` meter that
 * `registerBusinessMetrics()` uses, obtained from `@opentelemetry/api`. There
 * is no `prom-client` registry here (STACK §12: deprecated) and no second
 * meter — one meter means one Prometheus scrape endpoint, one naming
 * convention, one alert rule set. Plan 09's exporter consumes this meter and
 * never learns that read links exist.
 *
 * ## Why the name is `read_link_denials_total`
 *
 * The `_total` suffix is the OTel/Prometheus counter convention, and the plan
 * names this string in its acceptance criteria. The platform's Phase 1
 * instruments (`platform.heartbeat`, `queue.job.failures`) predate it and use
 * dotted names; the delta is not silently harmonised in either direction —
 * renaming a shipped series breaks dashboards, and adopting `_total` for new
 * series is the forward-compatible direction.
 *
 * ## Label cardinality
 *
 * `reason` spans the eleven `ReadDenyReason` values and `action` the two read
 * actions: 22 series, all fixed by code, none carrying user input. That is the
 * low-cardinality budget D-71 allows; the plan's "7 reasons" requirement is
 * satisfied by the seven LNK-08 reasons being reachable label values, each
 * counted distinctly.
 *
 * ## Memoisation, not "create if absent"
 *
 * An OTel meter returns a *new* wrapper per `createCounter` call, so a second
 * registration of the same name produces two live instruments with one name
 * and the exporter emits the series twice — a counter that double-counts on
 * every module reload. Memoising (the same discipline as
 * `registerBusinessMetrics`) makes a second call return the first call's
 * handles. The meter is obtained per call, not at import time, so the
 * instrument binds to the provider the OTel bootstrap installed before any
 * instrumented module loaded (D-20) rather than the pre-bootstrap no-op.
 */
export const READ_LINK_DENIALS_METRIC = 'read_link_denials_total';

let cached: ReadDenyRecorder | undefined;

/**
 * Create (once) and return the read-link denial recorder.
 *
 * Idempotent by memoisation — see the module docblock.
 */
export function registerReadDenyMetrics(): ReadDenyRecorder {
  if (cached === undefined) {
    const meter = metrics.getMeter(METER_NAME);
    const denials: Counter = meter.createCounter(READ_LINK_DENIALS_METRIC, {
      description:
        'Read-link denials by reason and action (LNK-08; one label value per revocation reason).',
    });
    cached = Object.freeze({
      recordDenial: (reason: ReadDenyReason, action: ReadDenyAction): void => {
        denials.add(1, { reason, action });
      },
    });
  }
  return cached;
}
