import type { ReadableSpan } from '@opentelemetry/sdk-trace';
import { describe, expect, it, vi } from 'vitest';

/**
 * The D-20 ordering proof: **the SDK is started before any instrumented module
 * is imported**, and this file proves the instrumentations actually attach.
 *
 * This is deliberately paired with `otel.bootstrap.too-late.spec.ts`, which does
 * the same request with the order reversed. The pairing is the point: an
 * assertion that spans exist proves nothing unless the counterfactual shows they
 * would not exist otherwise, and a comment asserting the ordering is not
 * evidence at all. (01-08's summary makes the same point about guards: "a guard
 * that cannot fail is indistinguishable from a guard that passes".)
 *
 * ## What is instrumented here
 *
 * A real Nest application built from `@nestjs/core` + `@nestjs/platform-express`
 * over a real HTTP request — the same shape as `apps/api/src/main.ts` in plan 10.
 * Nothing in this file imports those packages statically: the whole point is that
 * they are imported *after* `startOtel()` resolves.
 */

/** Spans captured at the OTLP exporter boundary — i.e. after the allowlist filter. */
const captured = vi.hoisted(() => ({ spans: [] as unknown[] }));

/**
 * The OTLP trace exporter is replaced with a recording stub, so the real
 * `AllowlistSpanExporter → OTLPTraceExporter` chain runs and the assertions read
 * the spans *after* filtering. Nothing is dialled: there is no collector, and an
 * export attempt would surface as a diag warning rather than a failure.
 */
vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: class RecordingOtlpTraceExporter {
    export(spans: ReadableSpan[], callback: (result: { code: number }) => void): void {
      captured.spans.push(...spans);
      callback({ code: 0 });
    }
    async shutdown(): Promise<void> {
      return undefined;
    }
    async forceFlush(): Promise<void> {
      return undefined;
    }
  },
}));

function exportedSpans(): ReadableSpan[] {
  return captured.spans as ReadableSpan[];
}

function waitFor(predicate: () => boolean, budgetMs = 60_000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (predicate()) {
        resolve();
      } else if (Date.now() > deadline) {
        reject(new Error('timed out waiting for an exported span'));
      } else {
        setTimeout(tick, 25);
      }
    };
    tick();
  });
}

describe('OTel is started before the instrumented modules are imported (D-20)', () => {
  it('produces request spans, and filters them to the allowlist on the way out', async () => {
    // Flush the batch processor almost immediately instead of on its 5 s
    // default. `OTEL_BSP_SCHEDULE_DELAY` is the SDK's own supported knob, read
    // by `createBatchSpanProcessorFromEnv` when the processor is built — so this
    // is configuration, not a reach into private state.
    process.env['OTEL_BSP_SCHEDULE_DELAY'] = '1';

    const { startOtel } = await import('./otel.bootstrap.js');
    const handle = await startOtel({
      SERVICE_NAME: 'api',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1',
    });

    // …and only now is anything instrumented loaded. In production this is
    // `await import('./app.module.js')` in `main.ts`; here it is the Nest factory
    // and the Express adapter, the two packages the request path runs through.
    const [{ NestFactory }, { Controller, Get, Module }] = await Promise.all([
      import('@nestjs/core'),
      import('@nestjs/common'),
    ]);

    class ProbeController {
      @Get('/otel-ordering-probe')
      probe(): { ok: boolean } {
        return { ok: true };
      }
    }
    @Controller('otel-ordering')
    class WrapperController extends ProbeController {}

    @Module({ controllers: [WrapperController] })
    class ProbeModule {}

    const app = await NestFactory.create(ProbeModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();

    const response = await fetch(`${url}/otel-ordering/otel-ordering-probe`);
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(handle.prometheus).toBeDefined();

    // The load-bearing assertion: an Express route span exists, which can only
    // happen if `@opentelemetry/instrumentation-express` patched `express`
    // before NestFactory loaded it.
    const route = '/otel-ordering/otel-ordering-probe';
    await waitFor(() => exportedSpans().some((span) => span.attributes['http.route'] === route));

    const spans = exportedSpans();
    expect(spans.length).toBeGreaterThan(1);

    const routeSpan = spans.find((span) => span.attributes['http.route'] === route);
    // SpanKind.SERVER = 1, INTERNAL = 0, CLIENT = 2. The express route span is
    // an internal span whose parent is the http server span.
    expect(routeSpan?.kind).toBe(0);
    // The `instrumentation-http` half: a server-side span exists at all, which is
    // the part that vanishes entirely when the SDK starts late.
    expect(spans.some((span) => span.kind === 1)).toBe(true);

    // D-18 end-to-end: what actually reached the exporter boundary carries only
    // allowlisted keys. `url.full`, `url.path` and `user_agent.original` are
    // emitted by the instrumentation on every HTTP span and must be gone.
    const { SPAN_ATTRIBUTE_ALLOWLIST } = await import('./span-attribute-allowlist.js');
    for (const span of spans) {
      for (const key of Object.keys(span.attributes)) {
        expect(SPAN_ATTRIBUTE_ALLOWLIST as readonly string[]).toContain(key);
      }
    }
    const httpSpan = spans.find((span) => span.kind === 1);
    expect(httpSpan?.attributes).not.toHaveProperty('url.full');
    expect(httpSpan?.attributes).not.toHaveProperty('url.path');
    expect(httpSpan?.attributes).not.toHaveProperty('user_agent.original');
    expect(httpSpan?.attributes).not.toHaveProperty('client.address');

    // `http.route` is the matched route *template*, not the request path — the
    // reason it is on the allowlist while `url.path` is not. Asserted so a
    // future instrumentation change that starts putting concrete paths in it
    // goes red rather than quietly reintroducing a submission-bearing value.
    expect(routeSpan?.attributes['http.route']).toBe(route);

    // No identifier a submission could be recovered from is on any span.
    for (const span of spans) {
      expect(JSON.stringify(span.attributes)).not.toMatch(/submission/i);
    }

    await app.close();
    // Generous, because the spec next to this one spawns two Node processes that
    // each load the whole Nest + instrumentation graph. Under contention the
    // first version of this test failed on a 10 s poll budget while passing
    // alone — a wall-clock assumption, not a defect.
  }, 120_000);
});