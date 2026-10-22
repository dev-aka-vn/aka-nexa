import { context, trace, type Context, type SpanContext } from '@opentelemetry/api';

/**
 * W3C trace-context propagation across the queue seam (OUT-13).
 *
 * ## The problem
 *
 * The inbound receiver creates the trace (NFR-O-1: it starts at the receiver).
 * The reply that answers it is produced by `InboundEventProcessor` in the
 * `worker` and delivered by `OutboundDeliveryProcessor` — a *different* span
 * tree, because BullMQ's job boundary is where OTel's context is normally
 * lost. Without propagation the delivery attempt is an orphan span: present,
 * but with no path back to the message that caused it.
 *
 * ## Why this is not `bullmq-otel`
 *
 * `@opentelemetry/instrumentation-bullmq` does not exist on npm (verified in
 * STACK.md), and `bullmq-otel` was not installed. Both would need a dependency
 * this phase's budget does not cover. `@opentelemetry/api` **is** already
 * installed — `packages/platform` imports it for metrics — so the W3C
 * encoding is ~40 lines over what is already in the tree.
 *
 * ## Why the trace context does NOT go in the `OutboundMessage` envelope
 *
 * D-21/D-23/D-43 freeze the envelope, and Phase 11 may only widen it with
 * justification. A `traceparent` on the envelope would also leak an internal
 * trace id into the delivery payload every platform sees. Instead the context
 * travels in BullMQ's **job options** (`job.opts`), which Redis already
 * persists with the job and which no contract enumerates.
 *
 * The cost is honesty about it: the delivery span is a *child* of the inbound
 * trace, so both are visible in one waterfall, and the audit record keeps the
 * `native_event_id` for the human-readable join.
 */

/** The job-option key carrying the W3C traceparent. */
export const TRACEPARENT_JOB_OPTION = 'traceparent';

/**
 * Write the active span's W3C `traceparent` onto a carrier object.
 *
 * The carrier is typed loosely on purpose: BullMQ's `JobsOptions` has no index
 * signature, and the alternative is a cast at every call site. Reading back is
 * duck-typed, so a named key on any object works.
 *
 * Returns a **new** carrier, never mutates the input, and omits the key
 * entirely when there is no sampled active span — so a job enqueued outside
 * any trace carries no trace id rather than carrying a fake one.
 */
export function injectTraceContextInto<T extends object>(carrier: T): T {
  const span = trace.getSpan(context.active());
  const spanContext: SpanContext | undefined = span?.spanContext();
  if (!spanContext || !trace.isSpanContextValid(spanContext)) return carrier;
  if ((spanContext.traceFlags & 1) === 0) return carrier;

  return {
    ...carrier,
    [TRACEPARENT_JOB_OPTION]: formatTraceparent(spanContext),
  };
}

/**
 * Parse a W3C `traceparent` into a remote `Context` suitable for
 * `context.with()`.
 *
 * Malformed or absent input yields the active context, never a fabricated span
 * — a corrupt trace id is worse than no trace id, because it points at a trace
 * that does not exist.
 */
export function traceContextFromJobOptions(opts: object | undefined): Context {
  const raw = (opts as Record<string, unknown> | undefined)?.[TRACEPARENT_JOB_OPTION];
  if (typeof raw !== 'string') return context.active();
  return contextWithRemoteSpanContext(parseTraceparent(raw));
}

/** Execute `fn` with the span restored from the job's carrier. */
export function runWithJobTraceContext<T>(opts: object | undefined, fn: () => T): T {
  const ctx = traceContextFromJobOptions(opts);
  if (ctx === context.active()) return fn();
  return context.with(ctx, fn);
}

/** `version-traceid-spanid-flags`, the only W3C format. */
export function formatTraceparent(spanContext: SpanContext): string {
  const flags = (spanContext.traceFlags & 1) === 1 ? '01' : '00';
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

/**
 * The header is validated against the W3C grammar rather than trusted: any
 * field failing its length/hex check yields `undefined`, which the caller
 * treats as "no context".
 */
export function parseTraceparent(value: string): SpanContext | undefined {
  const parts = value.trim().split('-');
  if (parts.length !== 4) return undefined;
  const [version, traceId, spanId, flags] = parts as [string, string, string, string];
  if (version !== '00') return undefined;
  if (!/^[0-9a-f]{32}$/.test(traceId)) return undefined;
  if (!/^[0-9a-f]{16}$/.test(spanId)) return undefined;
  if (flags !== '00' && flags !== '01') return undefined;
  if (!trace.isSpanContextValid({ traceId, spanId, traceFlags: 0, isRemote: true })) {
    return undefined;
  }
  return {
    traceId,
    spanId,
    traceFlags: flags === '01' ? 1 : 0,
    isRemote: true,
  };
}

/** Wrap a remote span context in a `Context`, or return the active one. */
function contextWithRemoteSpanContext(spanContext: SpanContext | undefined): Context {
  if (!spanContext) return context.active();
  const remote = trace.wrapSpanContext(spanContext);
  return trace.setSpan(context.active(), remote);
}
