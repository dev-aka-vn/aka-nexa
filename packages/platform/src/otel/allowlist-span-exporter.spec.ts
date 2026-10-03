import type { Attributes, SpanKind } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';
import { describe, expect, it, vi } from 'vitest';

import { AllowlistSpanExporter } from './allowlist-span-exporter.js';
import { SPAN_ATTRIBUTE_ALLOWLIST } from './span-attribute-allowlist.js';

/**
 * A `ReadableSpan`-shaped object, built by hand rather than by a TracerProvider.
 *
 * The interface is fourteen readonly fields, which makes a literal a better test
 * fixture than a real `Span`: adding a field to the interface breaks this
 * factory at compile time, which is the point.
 */
export function syntheticSpan(
  attributes: Attributes,
  overrides: Partial<ReadableSpan> = {},
): ReadableSpan {
  return {
    name: 'request handler - /metrics',
    kind: 2 satisfies SpanKind,
    spanContext: () => ({
      traceId: '72d32c259894052a4fd5a94ba8fa48ff',
      spanId: '1f31848c7f7b1410',
      traceFlags: 1,
    }),
    startTime: [1_700_000_000, 0],
    endTime: [1_700_000_000, 12_000],
    status: { code: 1 },
    attributes,
    links: [],
    events: [],
    duration: [0, 12_000],
    ended: true,
    // A `Resource` is a class carrying `merge` / `getRawAttributes`. The filter
    // never reads it, so a cast through the interface it has to satisfy is
    // enough — and it keeps `@opentelemetry/resources` (which is only a
    // transitive dependency) out of this spec's import list.
    resource: {
      attributes: { 'service.name': 'api' },
      asyncAttributesPending: false,
    } as unknown as ReadableSpan['resource'],
    instrumentationScope: { name: '@opentelemetry/instrumentation-express' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    ...overrides,
  };
}

/** A delegate that records what it was handed, and can be told to misbehave. */
class RecordingDelegate implements SpanExporter {
  readonly calls: ReadableSpan[][] = [];
  readonly shutdownCalls = { count: 0 };
  readonly flushCalls = { count: 0 };
  result: { code: ExportResultCode } = { code: ExportResultCode.SUCCESS };
  throwOnExport?: Error;

  export(spans: ReadableSpan[], resultCallback: (result: { code: ExportResultCode }) => void): void {
    if (this.throwOnExport !== undefined) {
      throw this.throwOnExport;
    }
    this.calls.push(spans);
    resultCallback(this.result);
  }

  async shutdown(): Promise<void> {
    this.shutdownCalls.count += 1;
  }

  async forceFlush(): Promise<void> {
    this.flushCalls.count += 1;
  }
}

describe('AllowlistSpanExporter (FND-07, D-18, T-1-21)', () => {
  it('maps a span to a copy whose attributes are the intersection with the allowlist', () => {
    const delegate = new RecordingDelegate();
    const exporter = new AllowlistSpanExporter(delegate);

    exporter.export(
      [
        syntheticSpan({
          'http.route': '/metrics',
          'http.request.method': 'GET',
          submission_id: '9f1c2d3e-…',
          email: 'someone@example.com',
        }),
      ],
      () => undefined,
    );

    const exported = delegate.calls[0]?.[0];
    expect(Object.keys(exported?.attributes ?? {}).sort()).toEqual([
      'http.request.method',
      'http.route',
    ]);
  });

  it('never lets submission_id reach the delegate, under any name it is supplied', () => {
    const delegate = new RecordingDelegate();
    const exporter = new AllowlistSpanExporter(delegate);

    exporter.export(
      [
        syntheticSpan({
          submission_id: 'A',
          submissionId: 'B',
          'submission.id': 'C',
          'app.submission_id': 'D',
          'http.route': '/api/v1/forms/42/submissions',
        }),
      ],
      () => undefined,
    );

    const exported = delegate.calls[0]?.[0];
    const keys = Object.keys(exported?.attributes ?? {});

    // Asserted on keys, not on the serialised blob: an allowlisted *value* may
    // legitimately contain the word (an `http.route` template does), but no key
    // may identify a submission.
    expect(keys.some((key) => /submission/i.test(key))).toBe(false);
    expect(keys).toEqual(['http.route']);
  });

  it('emits an attribute key set that is always a subset of the allowlist', () => {
    const delegate = new RecordingDelegate();
    const exporter = new AllowlistSpanExporter(delegate);
    const hostile: Attributes = {
      'http.route': '/health/ready',
      'service.name': 'api',
      'duration_ms': 3,
      'messaging.destination.name': 'platform-heartbeat',
      'messaging.operation': 'process',
      attempt: 1,
      action: 'publish',
      jti: '0d9f0f9a-…',
      trace_id: '72d32c259894052a4fd5a94ba8fa48ff',
      'app_id': '4c1f…',
      'form_id': '9ab2…',
      'messaging.system': 'bullmq',
      'service.version': '0.0.0',
      'deployment.environment': 'production',
      'http.method': 'POST',
      'http.status_code': 201,
      'http.request.method': 'POST',
      'http.response.status_code': 201,
      // …and everything the auto-instrumentation and a careless caller add.
      'url.full': 'https://example.com/x?submission_id=A',
      'user_agent.original': 'curl/8.0',
      'http.request.method_original': 'POST',
      'network.peer.address': '10.0.0.1',
      enduser: 'u-1',
    };

    exporter.export([syntheticSpan(hostile)], () => undefined);

    const keys = Object.keys(delegate.calls[0]?.[0]?.attributes ?? {}).sort();
    for (const key of keys) {
      expect(SPAN_ATTRIBUTE_ALLOWLIST as readonly string[]).toContain(key);
    }
    expect(keys).toEqual(
      Object.keys(hostile)
        .filter((key) => (SPAN_ATTRIBUTE_ALLOWLIST as readonly string[]).includes(key))
        .sort(),
    );
  });

  it('delegates exactly once per export call, forwarding the result callback', () => {
    const delegate = new RecordingDelegate();
    const exporter = new AllowlistSpanExporter(delegate);
    const resultCallback = vi.fn();

    exporter.export([syntheticSpan({ 'http.route': '/a' }), syntheticSpan({ 'http.route': '/b' })], resultCallback);

    expect(delegate.calls).toHaveLength(1);
    expect(delegate.calls[0]).toHaveLength(2);
    expect(resultCallback).toHaveBeenCalledTimes(1);
    expect(resultCallback).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
  });

  it('forwards a delegate failure rather than swallowing it', () => {
    const delegate = new RecordingDelegate();
    delegate.result = { code: ExportResultCode.FAILED };
    const exporter = new AllowlistSpanExporter(delegate);
    const resultCallback = vi.fn();

    exporter.export([syntheticSpan({})], resultCallback);

    expect(resultCallback).toHaveBeenCalledWith({ code: ExportResultCode.FAILED });
  });

  it('reports FAILED instead of throwing when the delegate throws synchronously', () => {
    // The SDK's span processor treats a throwing exporter as an unhandled
    // rejection on the export timer, which in a Nest process takes the pod down
    // for a telemetry backend outage. Telemetry must never be able to do that.
    const delegate = new RecordingDelegate();
    delegate.throwOnExport = new Error('collector unreachable');
    const exporter = new AllowlistSpanExporter(delegate);
    const resultCallback = vi.fn();

    expect(() => {
      exporter.export([syntheticSpan({ 'http.route': '/a' })], resultCallback);
    }).not.toThrow();
    expect(resultCallback).toHaveBeenCalledWith({ code: ExportResultCode.FAILED });
  });

  it('does not mutate the spans it is handed', () => {
    const delegate = new RecordingDelegate();
    const exporter = new AllowlistSpanExporter(delegate);
    const attributes: Attributes = { 'http.route': '/a', submission_id: 'A' };
    const span = syntheticSpan(attributes);

    exporter.export([span], () => undefined);

    expect(span.attributes).toBe(attributes);
    expect(Object.keys(attributes)).toEqual(['http.route', 'submission_id']);
  });

  it('preserves every other field of the span, including the prototype getters', () => {
    // A `{ ...span }` copy — the shape the research note prescribes — silently
    // drops `duration`, `ended` and all three `dropped*Count` values, because
    // they are *prototype getters* backed by `_`-prefixed own fields. The OTLP
    // serialiser reads all of them, so a spread copy exports `undefined` for
    // span duration and a corrupt dropped-attribute count.
    const delegate = new RecordingDelegate();
    const exporter = new AllowlistSpanExporter(delegate);
    const span = syntheticSpan({ 'http.route': '/a', submission_id: 'A' });

    exporter.export([span], () => undefined);
    const exported = delegate.calls[0]?.[0];

    expect(exported?.name).toBe(span.name);
    expect(exported?.kind).toBe(span.kind);
    expect(exported?.startTime).toEqual(span.startTime);
    expect(exported?.endTime).toEqual(span.endTime);
    expect(exported?.status).toBe(span.status);
    expect(exported?.links).toBe(span.links);
    expect(exported?.events).toBe(span.events);
    expect(exported?.duration).toEqual((span as unknown as ReadableSpan).duration);
    expect(exported?.ended).toBe(span.ended);
    expect(exported?.droppedAttributesCount).toBe(0);
    expect(exported?.droppedEventsCount).toBe(0);
    expect(exported?.droppedLinksCount).toBe(0);
    expect(exported?.spanContext()).toEqual(span.spanContext());
    expect(exported?.resource).toBe(span.resource);
    expect(exported?.instrumentationScope).toBe(span.instrumentationScope);
  });

  it('keeps the prototype getters working on a real SDK span', async () => {
    // The fixture above is a plain object, whose getters are own data
    // properties. This one is a real `Span` from a real `TracerProvider`, so the
    // getter-on-the-prototype case is exercised against the actual class.
    const { TracerProvider, SimpleSpanProcessor } = await import('@opentelemetry/sdk-trace');
    const delegate = new RecordingDelegate();
    const exporter = new AllowlistSpanExporter(delegate);
    const provider = new TracerProvider({
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
    });

    const span = provider.getTracer('test').startSpan('real');
    span.setAttribute('http.route', '/a');
    span.setAttribute('submission_id', 'A');
    span.end();
    await provider.forceFlush();

    const exported = delegate.calls[0]?.[0];
    expect(exported?.ended).toBe(true);
    expect(exported?.duration).toEqual((span as unknown as ReadableSpan).duration);
    expect(exported?.droppedAttributesCount).toBe(0);
    expect(Object.keys(exported?.attributes ?? {})).toEqual(['http.route']);
    await provider.shutdown();
  });

  it('leaves the span context untouched, so a trace id is not derived from the attribute set', async () => {
    // The D-18 counterfactual, run against the real SDK. PROJECT rejected
    // `trace_id = submission_id` — and rejected hashing it too — so the trace id
    // must be whatever the SDK's `RandomIdGenerator` produced. Two spans
    // carrying the SAME `submission_id` must land on DIFFERENT trace ids; if a
    // future change seeded the id from the attribute, this fails.
    const { TracerProvider, SimpleSpanProcessor } = await import('@opentelemetry/sdk-trace');
    const delegate = new RecordingDelegate();
    const exporter = new AllowlistSpanExporter(delegate);
    const provider = new TracerProvider({
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
    });
    const tracer = provider.getTracer('test');

    const traceIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const span = tracer.startSpan(`span-${index}`);
      span.setAttribute('submission_id', '9f1c2d3e-0000-4000-8000-000000000000');
      span.end();
      traceIds.push(span.spanContext().traceId);
    }
    await provider.forceFlush();

    expect(new Set(traceIds).size).toBe(5);
    // The exporter must not have rewritten the context either — it delegates
    // `spanContext()` to the original class instance.
    expect(delegate.calls.flat().map((span) => span.spanContext().traceId)).toEqual(traceIds);
    await provider.shutdown();
  });

  it('delegates shutdown and forceFlush', async () => {
    const delegate = new RecordingDelegate();
    const exporter = new AllowlistSpanExporter(delegate);

    await exporter.shutdown();
    await exporter.forceFlush();

    expect(delegate.shutdownCalls.count).toBe(1);
    expect(delegate.flushCalls.count).toBe(1);
  });

  it('is re-export-safe for a delegate that has no forceFlush', async () => {
    // `SpanExporter.forceFlush` is optional on the interface. A wrapper that
    // called it unconditionally would turn a perfectly valid delegate into a
    // TypeError at shutdown.
    const delegate: SpanExporter = {
      export: (_spans, callback) => callback({ code: ExportResultCode.SUCCESS }),
      shutdown: async () => undefined,
    };
    const exporter = new AllowlistSpanExporter(delegate);

    await expect(exporter.forceFlush()).resolves.toBeUndefined();
  });
});