import { context, trace, type Context, TraceFlags } from '@opentelemetry/api';

import { TRACEPARENT_JOB_OPTION } from '@akane/platform';

/**
 * Test-side trace helpers (OUT-13).
 *
 * `context.with()` is a no-op unless a context manager is registered, and
 * `NodeSDK` installs one only in a real process. The specs that assert
 * active-context behaviour register the same wiring production gets, once, and
 * the two helpers here build a real active span to run a callback inside.
 */

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';

/** A real (not wrapped) span context, so `trace.getActiveSpan` sees it. */
function activeSpanContext() {
  return {
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    traceFlags: TraceFlags.SAMPLED,
  };
}

/** A `Context` whose active span is a sampled, valid one. */
export function makeActiveSpanForTrace(): Context {
  return trace.setSpan(context.active(), trace.wrapSpanContext(activeSpanContext()));
}

/** Run `fn` with the given context active. */
export function runWithin<T>(ctx: Context, fn: () => T): T {
  return context.with(ctx, fn);
}

export { TRACEPARENT_JOB_OPTION };
