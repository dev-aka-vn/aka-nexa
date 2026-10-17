import { metrics, type Counter } from '@opentelemetry/api';

import type { ReadDenyReason, RateLimitScope } from '@akane/contract';
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

/**
 * The signature-failure **block** counter (AUD-10).
 *
 * ## Why a second series is required, not optional
 *
 * AUD-10's alert condition is `block > 0 ∧ signature_invalid ≈ 0`. The
 * `signature_invalid` half is already covered — it is
 * `read_link_denials_total{reason="bad_signature"}`, incremented by the verifier
 * for every failure. The `block` half is this counter: the number of read-link
 * requests answered with a rate-limit response because a key exhausted its
 * failure budget. The two together let a dashboard distinguish "the limiter is
 * doing its job" (both non-zero) from "the limiter is miscounting and blocking
 * benign traffic" (`block > 0` with no signature failures behind it), which is
 * the false positive the rule exists to catch.
 *
 * A single label, `scope`, spans the two `RateLimitScope` values — two series,
 * fixed by code, no user input.
 */
export const READ_LINK_SIGNATURE_BLOCKS_METRIC = 'read_link_signature_blocks_total';

/** The seam the read controller uses to count a block. */
export interface SignatureBlockRecorder {
  recordBlock(scope: RateLimitScope): void;
}

let cached: ReadDenyRecorder | undefined;
let cachedBlocks: SignatureBlockRecorder | undefined;

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

/**
 * Create (once) and return the signature-failure **block** recorder (AUD-10).
 *
 * Memoised for the same reason as {@link registerReadDenyMetrics}: a second
 * `createCounter` on the same name yields a second live instrument, and the
 * exporter then emits the series twice.
 */
export function registerSignatureBlockMetrics(): SignatureBlockRecorder {
  if (cachedBlocks === undefined) {
    const meter = metrics.getMeter(METER_NAME);
    const blocks: Counter = meter.createCounter(READ_LINK_SIGNATURE_BLOCKS_METRIC, {
      description:
        'Read-link requests blocked by the signature-failure limiter, by key scope (AUD-10).',
    });
    cachedBlocks = Object.freeze({
      recordBlock: (scope: RateLimitScope): void => {
        blocks.add(1, { scope });
      },
    });
  }
  return cachedBlocks;
}
