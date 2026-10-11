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

/** Submission status transitions by status attribute (queued, sent, confirmed, partial, failed). */
export const SUBMISSION_STATUS_METRIC = 'submission.status';

/**
 * Connector call outcomes. Three labels, each earning its place:
 *
 * - `app_id` (CON-06) — first-class, so one app's traffic spike is attributable
 *   and billable separately.
 * - `outcome` — the call result, so a spike of *successful* calls is visible and
 *   not only a spike of failures.
 * - `taxonomy_code` (CON-07) — separates `credential_rejected` from
 *   `endpoint_unreachable` at the alert layer, without parsing a message.
 *   Always present: `none` on a call that was not a classified failure, so an
 *   operator never has to write an alert against an absent label.
 */
export const CONNECTOR_OUTCOME_METRIC = 'connector.outcome';

export interface BusinessMetrics {
  /** Incremented by the platform heartbeat processor. */
  readonly platformHeartbeat: Counter;
  /** Incremented when a job reaches the `failed` set. */
  readonly queueJobFailures: Counter;
  /** Submission status transitions. */
  readonly submissionStatus: Counter;
  /** Connector call outcomes. */
  readonly connectorOutcome: Counter;
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
      submissionStatus: meter.createCounter(SUBMISSION_STATUS_METRIC, {
        description: 'Submission status transitions.',
      }),
      connectorOutcome: meter.createCounter(CONNECTOR_OUTCOME_METRIC, {
        description: 'Connector call outcomes.',
      }),
    });
  }
  return cached;
}

/**
 * The label values `submission.status` may carry.
 *
 * Declared here, not inferred from the wire types, because `platform` is
 * permitted to import `kernel` and nothing else (`tooling/boundaries.config.mjs`)
 * — it cannot see `@akane/contract`. These strings are the instrument's own API,
 * and they are the vocabulary an alert rule is written against.
 */
export type SubmissionStatusLabel =
  | 'queued'
  | 'sent'
  | 'confirmed'
  | 'partial'
  | 'failed';

/**
 * `connector.outcome`'s taxonomy labels: the frozen contract's
 * `ConnectorErrorCode` values, plus `none` for an attempt that was not a
 * classified failure. Structurally identical to the contract union, so a caller
 * passes its own value without a cast and without this package importing it.
 */
export type ConnectorTaxonomyLabel =
  | 'credential_rejected'
  | 'endpoint_unreachable'
  | 'failed_permanent'
  | 'mapping_error'
  | 'unknown'
  | 'none';

/** `connector.outcome`'s `outcome` labels — the `status` half of an execute result. */
export type ConnectorCallOutcomeLabel =
  | 'succeeded'
  | 'rejected'
  | 'failed_transient'
  | 'failed_permanent';

/**
 * The recording seam for the two business counters whose labels carry meaning
 * (OBS-04, CON-06, CON-07).
 *
 * ## Why a seam and not direct `add()` calls
 *
 * Declaring an instrument is not the same as emitting a series: an OTel counter
 * with no `add()` and no label combination exports **nothing**. That is how
 * `submission_status{status="partial"}` came to be registered in Phase 1 and
 * still invisible in Phase 5 — the instruments existed and no call site used
 * them. Funnelling every write through one typed recorder is what makes the
 * label discipline (which labels, which values, `app_id` never omitted)
 * reviewable in one place and testable without a live exporter.
 *
 * ## Why a fresh object each call, and why `registerBusinessMetrics()` inside
 *
 * The instruments are memoised by `registerBusinessMetrics`; this wrapper holds
 * no state of its own so a recorder obtained before a meter-provider swap still
 * writes to the current provider. A closure-captured instrument would silently
 * keep writing to the pre-swap one, which is the same class of bug the
 * per-call `getMeter` above exists to avoid.
 */
export interface BusinessMetricsRecorder {
  /**
   * One submission-status transition.
   *
   * `app_id` is never omitted (CON-06): an attempt with no resolvable app
   * records `unknown` rather than dropping the series, so a spike cannot hide
   * by being unattributable.
   */
  recordSubmissionStatus(input: {
    readonly appId: string;
    readonly status: SubmissionStatusLabel;
  }): void;
  /** One connector call attempt, attributed to its app and its failure taxonomy. */
  recordConnectorOutcome(input: {
    readonly appId: string;
    readonly outcome: ConnectorCallOutcomeLabel;
    readonly taxonomyCode: ConnectorTaxonomyLabel;
  }): void;
}

/** DI token for the {@link BusinessMetricsRecorder} seam. */
export const BUSINESS_METRICS_RECORDER = 'BUSINESS_METRICS_RECORDER';

export function createBusinessMetricsRecorder(): BusinessMetricsRecorder {
  return Object.freeze({
    recordSubmissionStatus({
      appId,
      status,
    }: {
      readonly appId: string;
      readonly status: SubmissionStatusLabel;
    }): void {
      registerBusinessMetrics().submissionStatus.add(1, { app_id: appId, status });
    },
    recordConnectorOutcome({
      appId,
      outcome,
      taxonomyCode,
    }: {
      readonly appId: string;
      readonly outcome: ConnectorCallOutcomeLabel;
      readonly taxonomyCode: ConnectorTaxonomyLabel;
    }): void {
      registerBusinessMetrics().connectorOutcome.add(1, {
        app_id: appId,
        outcome,
        taxonomy_code: taxonomyCode,
      });
    },
  });
}