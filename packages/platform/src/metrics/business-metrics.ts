import { metrics, type Counter } from '@opentelemetry/api';

/**
 * Business metric instruments (OBS-01, D-20).
 *
 * ## One metric path, and why that is an architectural claim
 *
 * Every instrument in this codebase is created from the meter this module
 * obtains from `@opentelemetry/api`. `prom-client` is on the do-not-use list
 * (STACK.md §12: it is deprecated in favour of `@prometheus-io/client`) and a
 * second registry would mean two scrape endpoints, two naming conventions and
 * split alert rules — the failure mode OBS-01 exists to prevent. Plan 09 wires
 * the Prometheus exporter, and it consumes *this* meter; nothing else is
 * permitted to create one.
 *
 * ## Why registration starts in Phase 1 with almost nothing to record
 *
 * The counters that carry real volume land in later phases, but the instrument
 * names have to exist before the first exporter is wired, or the names get
 * chosen by whoever happens to call `.createCounter` first — from a request
 * handler, with a dashboard-shaped name. Declaring them here makes the naming
 * convention a Phase 1 decision and lets the exporter in plan 09 validate
 * against a known set.
 */

/** Meter name. Fixed, so one provider recognises our instruments from any other. */
export const METER_NAME = 'akane';

/** Heartbeat of the `scheduler` process — one increment per scheduled tick. */
export const PLATFORM_HEARTBEAT_METRIC = 'platform.heartbeat';

/** Terminal job failures, by queue name and job name. */
export const QUEUE_JOB_FAILURES_METRIC = 'queue.job.failures';

/**
 * Age of the oldest waiting job, in seconds.
 *
 * This is the metric that distinguishes "the queue is fine" from "the queue is
 * backed up", and the second is the one that pages someone. It is a **name
 * constant only** — an observable gauge needs a callback that observes live
 * queue state, and creating the instrument before that callback exists would
 * export a series that is permanently zero. A permanently-zero series is worse
 * than a missing one: it satisfies a dashboard's "does this metric exist"
 * check while telling an operator the queue is empty.
 */
export const QUEUE_OLDEST_ITEM_AGE_METRIC = 'queue.oldest.item.age';

export interface BusinessMetrics {
  /** Incremented by the platform heartbeat processor. */
  readonly platformHeartbeat: Counter;
  /** Incremented when a job reaches the `failed` set. */
  readonly queueJobFailures: Counter;
}

let cached: BusinessMetrics | undefined;

/**
 * Create (once) and return the Phase 1 business instruments.
 *
 * Idempotent by memoisation rather than by checking the SDK: an OTel meter
 * returns a *new* wrapper object on each `createCounter` call, so a second
 * registration of the same name produces two live instruments with one name and
 * the exporter emits the series twice. Memoising makes a second call — a second
 * `onModuleInit`, a hot reload, two modules importing this one — return the
 * handles the first call produced.
 *
 * The meter is obtained per call rather than at module load, because the global
 * meter provider is installed by the OTel bootstrap that runs *before* any
 * instrumented module is imported (D-20); a meter captured at import time can
 * bind to the pre-bootstrap no-op provider and silently record nothing.
 */
export function registerBusinessMetrics(): BusinessMetrics {
  if (cached === undefined) {
    const meter = metrics.getMeter(METER_NAME);
    cached = Object.freeze({
      platformHeartbeat: meter.createCounter(PLATFORM_HEARTBEAT_METRIC, {
        description: 'Ticks of the platform heartbeat job scheduler.',
      }),
      queueJobFailures: meter.createCounter(QUEUE_JOB_FAILURES_METRIC, {
        description: 'Jobs that reached the failed set, by queue and job name.',
      }),
    });
  }
  return cached;
}