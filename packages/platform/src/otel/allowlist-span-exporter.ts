import { ExportResultCode } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';

import { filterSpanAttributes } from './span-attribute-allowlist.js';

/**
 * The only point where D-18's span-attribute allowlist can be enforced.
 *
 * ## Why an exporter and not a `SpanProcessor`
 *
 * The obvious place to filter is `SpanProcessor.onStart`, and it cannot be done
 * there. Its signature is `onStart(span: Span, parentContext: Context): void`,
 * and `Span` exposes only `setAttribute` / `setAttributes` — there is **no read
 * and no delete** of an attribute that a caller has already set. `onEnd` sees a
 * `ReadableSpan` whose `attributes` is likewise declared `readonly`. Filtering at
 * either point would mean mutating an object the SDK owns, or maintaining a
 * parallel set of attributes to subtract, both of which fail open the moment a
 * caller uses a key nobody anticipated.
 *
 * A `SpanExporter` is different: `export(spans: ReadableSpan[], …)` receives the
 * finished spans with `attributes` readable, immediately before serialisation and
 * immediately before the bytes leave the process. Copying each span with a
 * filtered attribute set is therefore *subtractive by construction* — an
 * attribute that is not on the allowlist has no path to the wire, whether it was
 * set by our code, by the HTTP instrumentation, or by a future library.
 *
 * ## Why the copy preserves the prototype
 *
 * The research note prescribes `{ ...span, attributes: filtered }`. That shape is
 * wrong against the real SDK: `Span` implements `duration`, `ended`,
 * `droppedAttributesCount`, `droppedEventsCount` and `droppedLinksCount` as
 * **prototype getters** backed by `_`-prefixed own fields, and a spread copies
 * only own enumerable properties. The OTLP serialiser reads all five, so a spread
 * copy would export `undefined` for span duration and a corrupt dropped-attribute
 * count — a silent, hard-to-spot corruption of every exported trace.
 *
 * `Object.create(getPrototypeOf(span), getOwnPropertyDescriptors(span))` keeps
 * the class intact and every own field intact, and shadowing `attributes` with a
 * single own value property overrides the getter. Verified in
 * `allowlist-span-exporter.spec.ts` against a real `Span` from a real
 * `TracerProvider`, not only against a plain-object fixture.
 */
export class AllowlistSpanExporter implements SpanExporter {
  readonly #delegate: SpanExporter;

  constructor(delegate: SpanExporter) {
    this.#delegate = delegate;
  }

  /**
   * Filter, then delegate — in one call, with the caller's callback forwarded.
   *
   * A synchronous throw from the delegate is converted into a `FAILED`
   * `ExportResult` rather than propagated. The batch processor calls `export`
   * from an unref'd timer: an exception escaping here becomes an unhandled
   * rejection that can take the process down, which would turn a telemetry
   * backend outage into an application outage. Telemetry is never allowed to be
   * the reason a pod dies.
   */
  export(
    spans: ReadableSpan[],
    resultCallback: (result: { code: ExportResultCode }) => void,
  ): void {
    const filtered = spans.map((span) => filterSpan(span));
    try {
      this.#delegate.export(filtered, resultCallback);
    } catch {
      resultCallback({ code: ExportResultCode.FAILED });
    }
  }

  async shutdown(): Promise<void> {
    await this.#delegate.shutdown();
  }

  /**
   * `SpanExporter.forceFlush` is optional on the interface, so it is called
   * defensively: a wrapper that invoked it unconditionally would turn a valid
   * delegate into a `TypeError` during shutdown.
   */
  async forceFlush(): Promise<void> {
    await this.#delegate.forceFlush?.();
  }
}

/** A copy of `span` whose `attributes` is the allowlisted subset. */
function filterSpan(span: ReadableSpan): ReadableSpan {
  return Object.create(Object.getPrototypeOf(span), {
    ...Object.getOwnPropertyDescriptors(span),
    attributes: {
      value: filterSpanAttributes(span.attributes),
      enumerable: true,
      writable: false,
      configurable: true,
    },
  });
}