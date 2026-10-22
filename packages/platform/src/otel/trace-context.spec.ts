import { context, trace, type Span, TraceFlags } from '@opentelemetry/api';
import { beforeAll, describe, expect, it } from 'vitest';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';

import {
  formatTraceparent,
  injectTraceContextInto,
  parseTraceparent,
  runWithJobTraceContext,
  TRACEPARENT_JOB_OPTION,
  traceContextFromJobOptions,
} from './trace-context.js';

const VALID_TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const VALID_SPAN_ID = 'b7ad6b7169203331';

/**
 * `context.with()` is a no-op unless a context manager is registered, and
 * `NodeSDK` installs one only in a real process. The three tests that assert
 * active-context behaviour need the same wiring production gets.
 */
beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
});

/** A remote-but-real span context, as `trace.wrapSpanContext` accepts. */
function remoteSpan() {
  return trace.wrapSpanContext({
    traceId: VALID_TRACE_ID,
    spanId: VALID_SPAN_ID,
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  });
}

describe('parseTraceparent (OUT-13)', () => {
  it('round-trips a sampled header', () => {
    const parsed = parseTraceparent(`00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-01`);
    expect(parsed).toMatchObject({
      traceId: VALID_TRACE_ID,
      spanId: VALID_SPAN_ID,
      traceFlags: 1,
    });
  });

  it('accepts an unsampled header', () => {
    expect(parseTraceparent(`00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-00`)).toMatchObject({
      traceFlags: 0,
    });
  });

  it('rejects a header that is not the W3C grammar', () => {
    const bad = [
      '',
      'garbage',
      // Too few fields.
      `00-${VALID_TRACE_ID}-${VALID_SPAN_ID}`,
      // Non-hex trace id.
      '00-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-b7ad6b7169203331-01',
      // Wrong span-id length.
      `00-${VALID_TRACE_ID}-b7ad-01`,
      // Unknown flag.
      `00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-zz`,
      // Future version is not this implementation's.
      `01-${VALID_TRACE_ID}-${VALID_SPAN_ID}-01`,
    ];
    for (const header of bad) {
      expect(parseTraceparent(header)).toBeUndefined();
    }
  });

  it('rejects an all-zero trace id, which is never valid', () => {
    expect(
      parseTraceparent(`00-${'0'.repeat(32)}-${VALID_SPAN_ID}-01`),
    ).toBeUndefined();
  });
});

describe('injectTraceContextInto (OUT-13)', () => {
  it('writes the header when a sampled span is active', () => {
    const span = remoteSpan();
    const carried = context.with(trace.setSpan(context.active(), span), () =>
      injectTraceContextInto({ attempts: 5 }),
    ) as Record<string, unknown>;
    expect(carried[TRACEPARENT_JOB_OPTION]).toBe(
      `00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-01`,
    );
    // The caller's own options survive.
    expect(carried.attempts).toBe(5);
  });

  it('does not mutate the input object', () => {
    const input: Record<string, unknown> = { attempts: 5 };
    context.with(trace.setSpan(context.active(), remoteSpan()), () =>
      injectTraceContextInto(input),
    );
    expect(TRACEPARENT_JOB_OPTION in input).toBe(false);
  });

  it('omits the key entirely with no active span', () => {
    const carried = injectTraceContextInto({ attempts: 5 });
    expect(TRACEPARENT_JOB_OPTION in carried).toBe(false);
    expect(carried).toEqual({ attempts: 5 });
  });
});

describe('traceContextFromJobOptions (OUT-13)', () => {
  it('restores the remote span so a child span can be started from it', () => {
    const ctx = traceContextFromJobOptions({
      [TRACEPARENT_JOB_OPTION]: `00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-01`,
    });
    expect(trace.getSpan(ctx)?.spanContext()).toMatchObject({
      traceId: VALID_TRACE_ID,
      spanId: VALID_SPAN_ID,
      isRemote: true,
    });
  });

  it('falls back to the active context on absent options', () => {
    expect(traceContextFromJobOptions(undefined)).toBe(context.active());
  });

  it('falls back on a malformed header rather than fabricating a span', () => {
    const ctx = traceContextFromJobOptions({ [TRACEPARENT_JOB_OPTION]: 'nope' });
    expect(trace.getSpan(ctx)).toBeUndefined();
  });
});

describe('runWithJobTraceContext (OUT-13)', () => {
  it('makes the restored span active inside the callback', async () => {
    let seen: string | undefined;
    await runWithJobTraceContext(
      { [TRACEPARENT_JOB_OPTION]: `00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-01` },
      () => {
        seen = (trace.getSpan(context.active()) as Span)?.spanContext().spanId;
      },
    );
    expect(seen).toBe(VALID_SPAN_ID);
  });

  it('restores the previous context afterwards', () => {
    const before = context.active();
    runWithJobTraceContext(
      { [TRACEPARENT_JOB_OPTION]: `00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-01` },
      () => undefined,
    );
    expect(context.active()).toBe(before);
  });

  it('runs unchanged when there is nothing to restore', () => {
    const ran = runWithJobTraceContext({}, () => true);
    expect(ran).toBe(true);
  });
});
