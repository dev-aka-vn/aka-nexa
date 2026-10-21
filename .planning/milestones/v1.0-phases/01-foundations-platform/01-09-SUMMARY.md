---
phase: 01-foundations-platform
plan: 09
subsystem: infra
tags: [opentelemetry, otlp, prometheus, span-allowlist, gdpr-erasure, trace-decoupling, nestjs, obs-01]

requires:
  - phase: 01-foundations-platform
    provides: "typed LoggerPort + frozen log field allowlist (01-04), registerBusinessMetrics on the OTel meter `akane` (01-08), the pinned @opentelemetry/api@1.9.1 (01-08)"
provides:
  - "SPAN_ATTRIBUTE_ALLOWLIST + FORBIDDEN_SPAN_ATTRIBUTES — the closed span attribute surface, with `submission_id` and every submission-derived name absent"
  - "filterSpanAttributes — the O(1) gate, built from the frozen list so the gate and the exported list cannot drift"
  - "AllowlistSpanExporter — the only enforcement point for D-18, because SpanProcessor.onStart cannot read or delete a Span attribute"
  - "OTEL_PROMETHEUS_EXPORTER / createPrometheusExporter / getPrometheusExporter / setPrometheusExporter — a first-write-wins process singleton, always `preventServerStart: true`"
  - "startOtel(config) / buildOtelSdk(config) / otlpSignalUrl(endpoint, signal) — one NodeSDK with the allowlist trace exporter, the OTLP metrics reader and the Prometheus reader"
  - "MetricsController + MetricsModule + requirePrometheusExporter — `GET /metrics` served from the single exporter, and a named boot refusal when OTel was never started"
affects: [01-10 (creates apps/*/otel.mjs + main.ts, which must call startOtel() BEFORE importing app.module.js, and mounts MetricsModule on all three processes), every later phase that sets a span attribute or registers a metric, 01-08's platform.heartbeat only becoming non-zero once the worker consumes]

actuals:
  tokens: 39000
  tasks: 3
  commits: 3
  plan_head_before: 288eb235a994bb81be9b9004d59245c0a3fe5f5d
  plan_head_after: a642cdc7e2ad75f106874538b530bf766ad0d0c5

tech-stack:
  added:
    - "@opentelemetry/sdk-node 0.222.0 (exact STACK.md §14 pin)"
    - "@opentelemetry/core 2.11.0 — §6 requires it explicitly; the auto-bundle only peers on ^2.0.0"
    - "@opentelemetry/auto-instrumentations-node 0.80.0 (exact STACK.md §14 pin)"
    - "@opentelemetry/exporter-trace-otlp-http 0.222.0 (exact STACK.md §14 pin)"
    - "@opentelemetry/exporter-metrics-otlp-http 0.222.0 (exact STACK.md §14 pin)"
    - "@opentelemetry/exporter-prometheus 0.222.0 (exact STACK.md §14 pin)"
    - "@opentelemetry/semantic-conventions 1.43.0 (exact STACK.md §14 pin)"
    - "@opentelemetry/sdk-metrics 2.11.0 and @opentelemetry/sdk-trace 2.11.0 — imported directly, therefore declared (the §6 `@opentelemetry/core` rule)"
  patterns:
    - "Enforce a closed attribute surface at the EXPORT boundary, not at a SpanProcessor — `Span` has `setAttribute` but no read and no delete, so `onStart` structurally cannot subtract"
    - "Copy a span with `Object.create(getPrototypeOf(span), getOwnPropertyDescriptors(span))`, never `{ ...span }` — `duration`, `ended` and the three `dropped*Count` values are prototype getters, and a spread loses all five"
    - "A user-supplied OTLP `url` is used verbatim; only the env path appends `/v1/traces`. Normalise the base endpoint to the signal path in code, because a wrong URL 404s as a diag warning and nothing else"
    - "Idempotency must memoise `sdk.start()`, not just the handle: a second `NodeSDK.start()` throws `MetricReader can not be bound to a MeterProvider again.`"
    - "`getPrometheusExporter()` returns `undefined` before `startOtel()`, never a lazily-built fallback — a reader bound to no MeterProvider serves a permanently empty page that reads as 'the platform is idle'"
    - "Prove a module-load ordering in a real Node process. Vitest's module runner bypasses the `require-in-the-middle` chain, so an in-process counterfactual passes for the wrong reason"

key-files:
  created:
    - "packages/platform/src/otel/span-attribute-allowlist.ts — SPAN_ATTRIBUTE_ALLOWLIST, FORBIDDEN_SPAN_ATTRIBUTES, SPAN_ATTRIBUTE_ALLOWLIST_SET, filterSpanAttributes"
    - "packages/platform/src/otel/span-attribute-allowlist.spec.ts — 11 tests"
    - "packages/platform/src/otel/allowlist-span-exporter.ts — AllowlistSpanExporter"
    - "packages/platform/src/otel/allowlist-span-exporter.spec.ts — 12 tests"
    - "packages/platform/src/otel/otel.constants.ts — OTEL_PROMETHEUS_EXPORTER, PROMETHEUS_SCRAPE_ENDPOINT, the singleton accessors"
    - "packages/platform/src/otel/otel.bootstrap.ts — startOtel, buildOtelSdk, otlpSignalUrl"
    - "packages/platform/src/otel/otel.bootstrap.spec.ts — 15 tests"
    - "packages/platform/src/otel/otel.bootstrap.ordering.spec.ts — the in-process positive proof (real Nest app, real spans, allowlist applied)"
    - "packages/platform/src/otel/otel.bootstrap.node-ordering.spec.ts — the out-of-process counterfactual"
    - "packages/platform/src/otel/index.ts — the observability barrel"
    - "packages/platform/src/metrics/metrics.controller.ts — GET /metrics"
    - "packages/platform/src/metrics/metrics.module.ts — MetricsModule, requirePrometheusExporter, prometheusExporterProvider"
    - "packages/platform/src/metrics/metrics.controller.spec.ts — 5 tests"
    - "packages/platform/src/metrics/index.ts — the metrics barrel"
  modified:
    - "package.json, package-lock.json — the nine STACK.md §14 OTel pins"

key-decisions:
  - "The allowlist is pinned against a LITERAL sorted array, not against a rule. `submission_id is absent` alone would let `user.email` in through the next door; asserting the whole list makes widening the trace attribute surface a deliberate, reviewable edit — the same friction D-16 imposed on log fields, on the same one-way store."
  - "Both the legacy and the stable HTTP semconv spellings are allowlisted (`http.method` AND `http.request.method`, `http.status_code` AND `http.response.status_code`). Verified against the installed instrumentation: `@opentelemetry/instrumentation-http@0.80.0`'s bundle emits the STABLE pair, so the plan's legacy-only list would have stripped the method and status from every HTTP span. An unused entry is inert; a missing one is a blind spot."
  - "`url.*`, `user_agent.*`, `client.address`, `server.address`, `server.port` and `network.*` stay out even though the instrumentation emits them on every span — and that is the point: a URL path in this product carries the submission identifier, so admitting them would undo D-18 through the HTTP instrumentation rather than through a careless call site. A test enumerates all fourteen by name."
  - "`http.route` is allowlisted because it is the matched route TEMPLATE, not the request path. `otel.bootstrap.ordering.spec.ts` asserts `/otel-ordering/otel-ordering-probe` survives while `url.path` does not, so an instrumentation change that starts putting concrete paths in `http.route` goes red."
  - "The trace id is proven independent of the attribute set, not asserted to be: five spans carrying the SAME `submission_id` through a real `TracerProvider` produce five distinct trace ids, and the exporter leaves `spanContext()` untouched."
  - "`requirePrometheusExporter()` throws `OTEL_NOT_STARTED` rather than substituting an exporter. `MetricsModule` is composed by every entrypoint in plan 10, so a process that forgets `startOtel()` would otherwise come up healthy with a `/metrics` route that 200s forever — which an operator reads as 'the platform is idle'."
  - "The controller delegates to the exporter's own `getMetricsRequestHandler` with a minimal response double rather than calling `collect()` and re-serialising. A hand-rolled exposition format would work until the exporter changed a naming rule, and then `/metrics` would silently disagree with every dashboard built on it."
  - "The D-20 counterfactual runs as a spawned `node --input-type=module -e` process. Written first as the in-process mirror of the ordering spec, it failed: Vitest resolves external CJS through its own module runner rather than the `Module._load` chain `require-in-the-middle` patches, so the route span appeared in BOTH orders and the assertion would have been measuring the test runner. A guard that passes for the wrong reason is worse than no guard."

patterns-established:
  - "Run the counterfactual, not just the claim. Every lint-like guard in this plan was negatively controlled: planting `submission_id` in the allowlist fails 6 tests; replacing the prototype-preserving copy with the plan's `{ ...span }` spread fails 2; swapping the singleton for a fresh exporter fails 3; making the boot refusal fall back fails 1; disabling the late-load in the ordering probe fails the whole pair."
  - "When a library's documented shape turns out to be wrong against the installed version, verify against `node_modules` before writing code — `SimpleSpanProcessor`/`BatchSpanProcessor` take a config object at sdk-trace 2.11.0, `NodeSDK.start()` is synchronous, `InMemorySpanExporter.shutdown()` CLEARS the recorded spans, and a span's export awaits the SDK's async resource detectors (so `forceFlush()` is required before reading them). Each of these read as 'the instrumentation is broken' before being traced to its cause."
  - "Record the residual honestly. `platform.heartbeat` scrapes at 0 until plan 10 wires the worker, and no `main.ts` or `otel.mjs` exists yet, so the ordering this plan proves is proven but not yet deployed."

requirements-completed:
  - FND-07
  - OBS-01

coverage:
  - id: D1
    description: "SPAN_ATTRIBUTE_ALLOWLIST is frozen, excludes submission_id, and is pinned against a literal sorted array so ANY addition fails the spec"
    requirement: FND-07
    verification:
      - kind: unit
        ref: "packages/platform/src/otel/span-attribute-allowlist.spec.ts#is a frozen list, so a runtime mutation cannot widen it"
        status: pass
      - kind: unit
        ref: "packages/platform/src/otel/span-attribute-allowlist.spec.ts#is exactly the frozen literal named in the plan — every addition fails here"
        status: pass
    human_judgment: false
  - id: D2
    description: "submission_id and every submission-derived name is stripped before export, under any spelling"
    requirement: FND-07
    verification:
      - kind: unit
        ref: "packages/platform/src/otel/allowlist-span-exporter.spec.ts#never lets submission_id reach the delegate, under any name it is supplied"
        status: pass
      - kind: unit
        ref: "packages/platform/src/otel/allowlist-span-exporter.spec.ts#emits an attribute key set that is always a subset of the allowlist"
        status: pass
    human_judgment: false
  - id: D3
    description: "The emitted attribute key set equals the intersection of the input keys with the allowlist; one export call; the result callback is forwarded and a delegate failure is surfaced as FAILED"
    requirement: FND-07
    verification:
      - kind: unit
        ref: "packages/platform/src/otel/allowlist-span-exporter.spec.ts#maps a span to a copy whose attributes are the intersection with the allowlist"
        status: pass
      - kind: unit
        ref: "packages/platform/src/otel/allowlist-span-exporter.spec.ts#delegates exactly once per export call, forwarding the result callback"
        status: pass
    human_judgment: false
    negative_control: "Replacing the prototype-preserving copy with the plan's `{ ...span }` spread fails 2 tests, including the one built from a real TracerProvider — the shape the research note prescribes silently loses duration, ended and all three dropped*Count getters."
  - id: D4
    description: "The trace id is whatever the SDK generated: five spans carrying one submission_id get five distinct trace ids, and the exporter does not rewrite spanContext()"
    requirement: FND-07
    verification:
      - kind: unit
        ref: "packages/platform/src/otel/allowlist-span-exporter.spec.ts#leaves the span context untouched, so a trace id is not derived from the attribute set"
        status: pass
    human_judgment: false
  - id: D5
    description: "End to end, in a real Nest app over real HTTP: the instrumentations attach and the spans that reach the exporter boundary are allowlist-only — url.full, url.path, user_agent.original and client.address are gone"
    requirement: FND-07
    verification:
      - kind: integration
        ref: "packages/platform/src/otel/otel.bootstrap.ordering.spec.ts#produces request spans, and filters them to the allowlist on the way out"
        status: pass
    human_judgment: false
  - id: D6
    description: "The ordering is load-bearing, measured in a real Node process: 7 spans with the SDK started first, 1 with it second, and the survivor is the outbound client span — the failure is silent by construction"
    requirement: FND-07
    verification:
      - kind: integration
        ref: "packages/platform/src/otel/otel.bootstrap.node-ordering.spec.ts#emits the route span when the SDK starts first, and loses it when it starts second"
        status: pass
    human_judgment: false
    negative_control: "Removing the late-mode pre-load makes both runs identical and the test fails — the guard can fail."
  - id: D7
    description: "One NodeSDK carries the allowlist trace exporter, exactly two metric readers (the singleton Prometheus reader and a PeriodicExportingMetricReader), and the auto-instrumentation bundle"
    requirement: OBS-01
    verification:
      - kind: unit
        ref: "packages/platform/src/otel/otel.bootstrap.spec.ts#builds one SDK carrying the allowlist trace exporter, OTLP metrics and Prometheus"
        status: pass
    human_judgment: false
  - id: D8
    description: "The Prometheus exporter starts no HTTP server — asserted against the exporter's own server object, and black-box by binding port 9464"
    requirement: OBS-01
    verification:
      - kind: unit
        ref: "packages/platform/src/otel/otel.bootstrap.spec.ts#never creates the Prometheus exporter with its own HTTP server"
        status: pass
    human_judgment: false
  - id: D9
    description: "startOtel() is idempotent and the exporter singleton is first-write-wins; two startOtel() calls cannot yield two instances"
    requirement: OBS-01
    verification:
      - kind: unit
        ref: "packages/platform/src/otel/otel.bootstrap.spec.ts#is idempotent: a second call returns the same handle, not a second SDK"
        status: pass
      - kind: unit
        ref: "packages/platform/src/otel/otel.bootstrap.spec.ts#registers exactly one Prometheus exporter, and getPrometheusExporter() returns it"
        status: pass
    human_judgment: false
  - id: D10
    description: "GET /metrics returns 200 with Prometheus exposition served from the exporter's own serialisation, and names the plan-08 counters with the values recorded"
    requirement: OBS-01
    verification:
      - kind: integration
        ref: "packages/platform/src/metrics/metrics.controller.spec.ts#returns 200 with a Prometheus exposition body"
        status: pass
      - kind: integration
        ref: "packages/platform/src/metrics/metrics.controller.spec.ts#names the Phase 1 instruments registered in business-metrics.ts"
        status: pass
    human_judgment: false
    negative_control: "Constructing a second exporter inside the controller fails 3 of the 5 tests — the singleton is load-bearing, not decorative."
  - id: D11
    description: "A process that never called startOtel() refuses to compose MetricsModule with a named error, instead of serving an empty page"
    requirement: OBS-01
    verification:
      - kind: unit
        ref: "packages/platform/src/metrics/metrics.controller.spec.ts#fails loudly at boot rather than serving an empty page"
        status: pass
    human_judgment: false
    negative_control: "Falling back to a substituted exporter fails the test."
  - id: D12
    description: "No prom-client, @nestjs/observe or instrumentation-fastify anywhere in the manifests or the source; every @opentelemetry package this plan imports is declared at its STACK.md §14 pin"
    requirement: OBS-01
    verification:
      - kind: unit
        ref: "packages/platform/src/metrics/business-metrics.spec.ts#declares no prom-client dependency in any manifest"
        status: pass
      - kind: unit
        ref: "packages/platform/src/otel/otel.bootstrap.spec.ts#names no second metrics registry in the observability source"
        status: pass
      - kind: unit
        ref: "packages/platform/src/otel/otel.bootstrap.spec.ts#declares every OTel package it imports directly, at the pinned version"
        status: pass
    human_judgment: false
  - id: D13
    description: "OBS-01 as deployed: /metrics reachable from all three processes. NOT delivered by this plan — MetricsModule is composed by plan 10's entrypoints."
    requirement: OBS-01
    verification: []
    human_judgment: true
    rationale: "The metric path exists and is proven end to end over real HTTP with real instruments; what does not exist yet is a process that mounts it. Plan 10 owns apps/api, apps/worker and apps/scheduler. A verifier wanting the deployed claim needs all three running, which is also why the note in REQUIREMENTS.md says so."
  - id: D14
    description: "D-20's ordering as deployed: an entrypoint that starts OTel before importing its app module. NOT delivered by this plan — apps/*/otel.mjs and main.ts are plan 10's files."
    requirement: FND-07
    verification: []
    human_judgment: true
    rationale: "This plan supplies `startOtel()` and MEASURES the ordering property it buys (7 spans vs 1, in a real Node process). No entrypoint calls it yet, because plan 10 creates them. FND-07 itself is about the trace id's independence from submission_id, which is delivered and proven; the deployment of the ordering is a separate, later fact and is called out here rather than assumed."

# Metrics
duration: 105min
completed: 2026-10-03
status: complete
---

# Phase 1 Plan 09: Span-attribute allowlist, OTel-first bootstrap, one Prometheus path

**A closed trace attribute surface enforced at the only point that can enforce it, a bootstrap whose
ordering is measured rather than asserted, and one `/metrics` route served from one exporter.**

## Performance

- **Duration:** ~105 min
- **Tasks:** 3 (3 commits)
- **Files:** 14 created, 2 modified (manifest + lockfile)
- **Test suite:** 33 files / 273 tests green (was 27 / 228)

## Accomplishments

- **D-18 is closed, and closed at the export boundary for a structural reason.** `SpanProcessor.onStart`
  receives a `Span`, which exposes `setAttribute` and nothing else — no read, no delete. A processor
  cannot subtract an attribute a caller already set. A `SpanExporter` receives finished spans with
  `attributes` readable, immediately before serialisation, so `AllowlistSpanExporter` is *subtractive
  by construction*: a name that is not on the list has no path to the wire, whether it was set by our
  code, by the HTTP instrumentation, or by a future library.
- **The trace id is proven independent, not asserted to be.** Five spans carrying the **same**
  `submission_id` through a real `TracerProvider` produce five distinct trace ids, and the exporter
  leaves `spanContext()` untouched. PROJECT rejected `trace_id = submission_id` and rejected hashing
  it too; this is the mechanical counterpart.
- **D-20's ordering is measured.** Spawned `node --input-type=module -e` runs of the same Nest app:
  **SDK first → 7 spans** (tcp.connect, three middleware spans, a SERVER `GET`, the express
  `http.route` span, and the outbound client `GET`); **app modules first → 1 span**, and it is the
  *outbound client* span. No server span, no route span, no error. That survivor is exactly why the
  mistake is silent: the process still has a working telemetry pipeline, just not the spans anyone is
  querying.
- **The allowlist is a frozen literal, not a rule.** `submission_id is absent` would let `user.email`
  in through the next door. Asserting the whole list means widening the trace attribute surface is a
  reviewable edit — the same friction D-16 imposed on log fields, on the same one-way store.
- **Fourteen URL/address attributes the HTTP instrumentation emits on every span are named and kept
  out**, because a URL path in this product carries the submission identifier. Admitting them would
  undo D-18 through the instrumentation rather than through a careless call site.
- **Five guards, each negatively controlled.** Planting `submission_id` fails 6 tests; replacing the
  prototype-preserving span copy with the plan's `{ ...span }` spread fails 2; swapping the singleton
  for a fresh exporter fails 3; making the boot refusal fall back fails 1; disabling the late-load in
  the ordering probe fails the pair.
- **Four defects found by running the real thing**, none visible from reading the docs — see below.

## Task Commits

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | Frozen span-attribute allowlist + `AllowlistSpanExporter` | `fc2e606` | feat |
| 2 | `startOtel()` — one NodeSDK, one exporter singleton | `a912bc9` | feat |
| 3 | `MetricsController` `/metrics` from the single exporter | `a642cdc` | feat |

**Plan head before:** `288eb23` · after: `a642cdc` · **task commits measured: 3**
(`git rev-list --count 288eb23..a642cdc`).

## Files Created

- `packages/platform/src/otel/span-attribute-allowlist.ts` + `.spec.ts` — 11 tests
- `packages/platform/src/otel/allowlist-span-exporter.ts` + `.spec.ts` — 12 tests
- `packages/platform/src/otel/otel.constants.ts` — the exporter singleton and its DI token
- `packages/platform/src/otel/otel.bootstrap.ts` + `.spec.ts` — 15 tests
- `packages/platform/src/otel/otel.bootstrap.ordering.spec.ts` — in-process proof against a real Nest app
- `packages/platform/src/otel/otel.bootstrap.node-ordering.spec.ts` — out-of-process counterfactual
- `packages/platform/src/otel/index.ts` — the observability barrel
- `packages/platform/src/metrics/metrics.controller.ts` + `.module.ts` + `.spec.ts` — 5 tests
- `packages/platform/src/metrics/index.ts` — the metrics barrel
- `package.json`, `package-lock.json` — nine STACK.md §14 OTel pins

## Decisions Made

- **Both HTTP semconv spellings are allowlisted.** The plan names `http.method` / `http.status_code`;
  the installed `@opentelemetry/instrumentation-http` (via the 0.80.0 bundle) emits the **stable**
  pair `http.request.method` / `http.response.status_code`, and `@opentelemetry/instrumentation-express`
  emits `http.route`. Following the plan's literal would have stripped the method and status from
  every HTTP span. An unused allowlist entry is inert; a missing one is a blind spot.
- **`http.route` is allowlisted because it is a matched route TEMPLATE, not the request path** — and
  that is asserted, not assumed: `otel.bootstrap.ordering.spec.ts` finds
  `/otel-ordering/otel-ordering-probe` on the exported span while `url.path` is absent. An
  instrumentation change that starts putting concrete paths in `http.route` goes red.
- **`getPrometheusExporter()` returns `undefined` before `startOtel()`, never a lazy fallback.** A
  fallback would hand a caller a reader no `MeterProvider` is bound to, which collects nothing and
  serves a page of `target_info` and no series — a healthy-looking 200 that an operator reads as "the
  platform is idle". The refusal is a named boot error (`OTEL_NOT_STARTED`).
- **The controller delegates to the exporter's own `getMetricsRequestHandler`** with a minimal
  response double, rather than calling `collect()` and re-serialising. A hand-rolled exposition format
  would work until the exporter changed a naming rule, and then `/metrics` would silently disagree
  with every dashboard built on it.
- **`otlpSignalUrl()` normalises the base endpoint to the signal path in code.** A user-supplied `url`
  on the OTLP exporters is used **verbatim**; only the `OTEL_EXPORTER_OTLP_ENDPOINT` *env* path appends
  `/v1/traces`. Passing the base endpoint straight through posts every span to the collector root and
  404s — which the SDK reports as a diag warning and nothing else.
- **The counterfactual runs out of process.** See the deviation below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Nine OTel packages were absent from every manifest**
- **Found during:** Task 1
- **Issue:** Only `@opentelemetry/api@1.9.1` was installed. T-1-SC names seven of the rest explicitly
  and requires no unpinned install; `package.json` is not in the plan's `files_modified`.
- **Fix:** `npm install --save-dev --save-exact` at the exact §14 versions, each verified against
  `registry.npmjs.org` first. Root `devDependencies`, matching `ioredis` (01-02), `pino` (01-04) and
  `bullmq` (01-08) — **which carries forward the caveat that `npm ci --omit=dev` produces a tree that
  cannot boot.** Pre-existing repo-wide model, not introduced here.
- **Files:** `package.json`, `package-lock.json`
- **Committed in:** `fc2e606`

**2. [Rule 1 — Bug] The prescribed `{ ...span }` copy silently corrupts every exported trace**
- **Found during:** Task 1 (RED probe against a real `TracerProvider`)
- **Issue:** RESEARCH P3 and the plan both prescribe `{ ...span, attributes: filtered }`. `Span`
  implements `duration`, `ended`, `droppedAttributesCount`, `droppedEventsCount` and
  `droppedLinksCount` as **prototype getters** backed by `_`-prefixed own fields, and a spread copies
  only own enumerable properties. Measured: after a spread copy, `duration` → `undefined`,
  `ended` → `undefined`, `droppedAttributesCount` → `undefined`. The OTLP serialiser reads all five.
- **Fix:** `Object.create(Object.getPrototypeOf(span), Object.getOwnPropertyDescriptors(span))` with
  `attributes` shadowed by one own value property. A test builds a real `Span` from a real
  `TracerProvider` and asserts all five survive — not only the plain-object fixture, whose getters are
  own data properties and would have passed the naive shape.
- **Negatively controlled:** substituting the prescribed spread fails exactly that test.
- **Files:** `allowlist-span-exporter.ts`, `allowlist-span-exporter.spec.ts`
- **Committed in:** `fc2e606`

**3. [Rule 1 — Bug] The plan's `OTLPTraceExporter({ url })` posts every span to the collector root**
- **Found during:** Task 2 (reading `otlp-exporter-base`'s configuration merge)
- **Issue:** `mergeOtlpHttpConfigurationWithDefaults` uses a user-supplied `url` verbatim; only
  `getNonSpecificUrlFromEnv` appends `v1/traces` / `v1/metrics`. Tempo, the OTel Collector and Jaeger
  all serve the signal paths, so every span would 404 — reported by the SDK as a diag warning and
  nothing else.
- **Fix:** `otlpSignalUrl(endpoint, signal)` — trailing slashes tolerated, idempotent on an already
  signal-specific URL, path prefixes preserved (reverse-proxy deployments). Five tests, including a
  counterfactual.
- **Files:** `otel.bootstrap.ts`, `otel.bootstrap.spec.ts`
- **Committed in:** `a912bc9`

**4. [Rule 1 — Bug] `startOtel()` idempotency must memoise `start()`, not just the handle**
- **Found during:** Task 2
- **Issue:** `started ??= buildOtelSdk(config)` returned early on the second call but still ran
  `await started.sdk.start()`. `NodeSDK.start()` builds a fresh `MeterProvider` and hands it every
  configured `MetricReader`, and `MetricReader.setMetricProducer` throws
  `"MetricReader can not be bound to a MeterProvider again."` — so the guard *was* the bug.
- **Fix:** `startOnce` memoises the promise. The idempotency test now reaches its assertion instead of
  raising, which is what makes it evidence.
- **Files:** `otel.bootstrap.ts`, `otel.bootstrap.spec.ts`
- **Committed in:** `a912bc9`

**5. [Rule 3 — Blocking] `PeriodicExportingMetricReader` is not exported by the OTLP metrics package**
- **Found during:** Task 2
- **Issue:** It lives in `@opentelemetry/sdk-metrics`. Reaching it through a transitive hoist is
  precisely what STACK.md §6 forbids for `@opentelemetry/core`.
- **Fix:** declared `@opentelemetry/sdk-metrics@2.11.0` and `@opentelemetry/sdk-trace@2.11.0`
  explicitly — both are what `sdk-node@0.222.0` already resolves, so no version conflict. A test now
  walks the bare `@opentelemetry/*` specifiers out of the four source files and fails on any that the
  manifest does not declare; **it immediately caught `@opentelemetry/sdk-trace`,** which was imported
  and undeclared before the pin was added.
- **Files:** `package.json`, `package-lock.json`, `otel.bootstrap.ts`, `otel.bootstrap.spec.ts`
- **Committed in:** `a912bc9`

**6. [Rule 1 — Bug] A delegate that throws synchronously would take the process down**
- **Found during:** Task 1
- **Issue:** The batch processor calls `export` from an unref'd timer. An exception escaping the
  exporter becomes an unhandled rejection that can kill a Nest process — a telemetry backend outage
  becoming an application outage.
- **Fix:** the wrapper catches and reports `{ code: FAILED }`. Covered by a test with a delegate whose
  `export` throws.
- **Files:** `allowlist-span-exporter.ts`, `allowlist-span-exporter.spec.ts`
- **Committed in:** `fc2e606`

**7. [Rule 2 — Missing critical functionality] The D-20 ordering needed two spec files the plan does not list**
- **Found during:** Task 2
- **Issue:** The plan's `files_modified` has no ordering proof, and "assert the config is shaped
  correctly" is not evidence that an instrumentation attached — the whole premise of the plan is that
  a static import defeats it silently.
- **Fix:** `otel.bootstrap.ordering.spec.ts` (real Nest app over real HTTP, proving attachment AND that
  exported attributes are allowlist-only) and `otel.bootstrap.node-ordering.spec.ts` (the
  counterfactual).
- **Note:** the counterfactual was first written as the in-process mirror of the ordering spec and
  **failed**: the route span appeared in both orders, because Vitest resolves external CJS through its
  own module runner rather than the `Module._load` chain `require-in-the-middle` patches. Asserting
  `false` there would have been asserting a property of the test runner. It now runs as a spawned
  `node --input-type=module -e` process, in the execution model production uses.
- **Files:** both new specs
- **Committed in:** `a912bc9`

**8. [Rule 2 — Missing critical functionality] `metrics/index.ts` barrel**
- **Found during:** Task 3
- **Issue:** The plan's action says "Export the module and controller from the metrics folder"; its
  `files_modified` omits the file. Every other platform folder has one (`queue/index.ts`,
  `logging/index.ts`, `health/index.ts`, `crypto/index.ts`, `mongo/index.ts`).
- **Fix:** added, mirroring `queue/index.ts`. The `exports` map in
  `packages/platform/package.json` is deliberately **not** touched — plan 10 is the first plan that must
  resolve a cross-package deep specifier, and adding one entry per plan is how that map drifts.
- **Files:** `packages/platform/src/metrics/index.ts`
- **Committed in:** `a642cdc`

**Total deviations:** 8 auto-fixed (3 × Rule 3 blocking, 3 × Rule 1 bug, 2 × Rule 2 missing
functionality). Every one was a prerequisite for the planned work. **No threat mitigation was weakened,
no boundary rule relaxed, and no pin loosened** — `npm run lint` is clean and the plan-03 fixture spec
that proves R1/R2/R3 actually fire is still green.

## Issues Encountered

- **`@opentelemetry/sdk-trace@2.11.0` changed both span processors to a config object.**
  `new SimpleSpanProcessor(exporter)` is silently `undefined` at the exporter and throws at shutdown;
  the shape is `new SimpleSpanProcessor({ exporter })`. Same for `BatchSpanProcessor`. Every spec in
  this plan uses the new form.
- **`NodeSDK.start()` returns `void` at 0.222.0**, not a promise. `startOtel` awaits it anyway so that a
  future SDK making it asynchronous cannot reintroduce the race D-20 rules out.
- **`InMemorySpanExporter.shutdown()` CLEARS the recorded spans.** Every "zero spans" result in early
  debugging was this: reading `getFinishedSpans()` *after* `sdk.shutdown()`.
- **A span's export awaits the SDK's async resource detectors**, so `forceFlush()` is required before
  reading the recorded spans. Without it, both arms of the ordering probe read as "zero spans" — which
  is indistinguishable from "the instrumentation did not attach". This cost real debugging time and is
  documented in the spec.
- **`NestFactory.create()` resolves the Express adapter lazily.** Without an explicit
  `@nestjs/platform-express` import in the probe's late mode, `express` is not loaded until *after*
  `sdk.start()` in either mode and the two runs come out byte-identical — a counterfactual that proves
  nothing. Recorded in the spec.
- **`NodeSDK` builds a meter provider from `OTEL_*` env defaults even when the caller asks for none**,
  and its 60 s export timer keeps a child process alive. The probe passes `metricReaders: []` and calls
  `sdk.shutdown()`; without them the spec waited out the full interval on every run.
- **A docblock cannot contain `*/`.** `apps/*/otel.mjs` closed the comment early in two files and
  produced a transform-time parse error. (Same trap 01-08 recorded.) Separately, the child-process
  probe lives in a `String.raw` template, so **no backticks** are permitted inside it — one closes the
  literal.
- **`vitest.config.mts` sets `hookTimeout: 30000`**, and the metrics controller's `beforeAll` pays for
  the SDK, the 39-instrumentation bundle and `@nestjs/testing`. It, and the ordering spec's test, pass
  explicit long timeouts.
- **`npm test` is now ~7.5 min** with 33 files. Vitest reports `isolate: false` would save ~42 s
  (~10% of wall clock). Not adopted, on 01-07's and 01-08's reasoning — and this plan adds a concrete
  reason to keep it: the ordering counterfactual **depends** on per-file module isolation, and sharing
  workers across files would make it order-dependent.

## Threat Model Coverage

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-1-21 (Information Disclosure — exported span attributes are retained by a store with no erasure path) | mitigate | **Implemented.** `AllowlistSpanExporter` filters every span to the frozen list at the export boundary, immediately before serialisation. `submission_id` is absent from the list, so it has no path to the wire under any spelling — asserted per-spelling and by a subset assertion over a hostile attribute bag. The trace id is proven independent: five spans carrying one `submission_id` get five distinct ids. Fourteen URL/address attributes the HTTP instrumentation emits on every span are named and excluded. |
| T-1-22 (Information Disclosure — a second metrics server or a second registry) | mitigate | **Implemented.** The exporter is created only by `createPrometheusExporter()`, always with `preventServerStart: true`, and there is exactly one instance process-wide (first-write-wins). "No listener" is asserted against the exporter's own server object *and* black-box by binding port 9464. `/metrics` is the only route, and it serves the exporter's own serialisation rather than a reimplementation. `/metrics` exposes aggregate instrument values only — no PII-bearing attribute is on the metric path. |
| T-1-SC (Tampering — no unpinned install) | mitigate | **Implemented.** Nine packages installed `--save-exact` at the STACK.md §14 versions (or, for `sdk-metrics` / `sdk-trace`, at exactly what `sdk-node@0.222.0` already resolves), each verified against `registry.npmjs.org` before install. A test now fails if any `@opentelemetry/*` specifier in the observability sources is undeclared, and pins the seven §14 versions. No package outside the ledger was added. `@nestjs/observe`, `prom-client` and `instrumentation-fastify` are absent. |

**Plan prohibitions, all satisfied:**

- *"MUST NOT export `submission_id` or any submission-derived attribute on a span, and MUST NOT seed a
  trace context from it"* — asserted four ways: the frozen list omits it; the exporter strips it under
  any spelling; five spans with one `submission_id` get five trace ids; and an end-to-end run asserts no
  exported span's attributes match `/submission/i`.
- *"MUST NOT start a second HTTP server for metrics — exactly one `/metrics` route exists"* — the
  exporter's listener is asserted never to come up, port 9464 is proven bindable, and the controller
  test is negatively controlled against a substituted exporter.

## Known Stubs

None. No `TODO`, `FIXME`, `XXX`, placeholder or skipped test survives in any file this plan created.

Three things are **deliberately absent** and must not be read as defects:

- **`platform.heartbeat` scrapes at 0.** The instrument exists and is exported by the metrics spec, but
  nothing increments it until plan 10 wires the `Worker` that consumes the heartbeat job. This is
  plan 08's hand-off, unchanged — do not read a flat series as a missing exporter.
- **No `main.ts` and no `otel.mjs` exist yet.** Plan 10 creates all three. D-20's ordering is
  *proven* here and *deployed* there; this summary does not claim the latter.
- **`OTEL_EXPORTER_OTLP_ENDPOINT` is not in the Zod boot schema.** `startOtel` takes a narrow
  `OtelBootstrapConfig` ({ SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT? }) rather than reading
  `AppConfig`, so FND-09 validation of the new key — and the `ConfigModule` wiring that supplies it —
  belongs to plan 10's entrypoint work. Adding it here would have edited `config.schema.ts`, which is
  not in this plan's `files_modified`.

**One observation, deliberately not acted on:** the auto-instrumentation bundle's `net` and `dns`
instrumentations emit a span per socket (`tcp.connect` appears in the ordering probe's output). That is
real trace volume. Narrowing the bundle is an observability-policy decision with its own cost, and
doing it silently inside a bootstrap would hide the choice from review — so the full pinned bundle is
used, and the observation is recorded here for whichever phase owns tracing cost.

## User Setup Required

None. Docker is **not** required by any spec this plan added — the ordering proof runs in a spawned
`node` process, and no container is started.

## Next Phase Readiness

- **Plan 10 must start OTel before importing the app module, and this plan tells it exactly how.** In
  `apps/*/otel.mjs`: import `startOtel` from the platform barrel, call it, and let the loader return;
  in `main.ts`: `await startOtel({ SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT })` as the first statement,
  then `await import('./app.module.js')`. **A top-of-file `import './app.module.js'` silently costs 6 of
  7 spans** — measured, in `otel.bootstrap.node-ordering.spec.ts`. Keep both halves (loader entry *and*
  in-file call) so a forgotten `--import` flag degrades instead of losing traces.
- **`MetricsModule` must be imported by all three entrypoints**, and `startOtel` must have run in that
  process first or the module refuses to compose with `OTEL_NOT_STARTED`. Each of the three processes
  owns its own registry, so all three must serve `/metrics` or an operator silently misses whichever
  process emitted the series they are querying.
- **`packages/platform/package.json`'s `exports` map is still the blocker 01-04, 01-05, 01-07 and 01-08
  recorded** — it declares only `"."` and `"./crypto"`, so `@akane/platform/otel` and
  `@akane/platform/metrics` do not resolve cross-package. Both barrels now exist. Resolve it once, in
  plan 10, which is the first plan that must import one.
- **The root barrel `packages/platform/src/index.ts` is untouched**, as planned — plan 10 composes it.
- **`@nestjs/observe` stays rejected** (vendor APM, no OTLP exporter), and **`prom-client` stays on the
  do-not-use list**. Both are now asserted by test rather than by convention.

## Self-Check: PASSED

- **Created files** (14/14 verified present on disk).
- **Commits** (3/3 verified in `git log`): `fc2e606`, `a912bc9`, `a642cdc`.
- **Measured commit count** — `git rev-list --count 288eb23..a642cdc` = **3**, matching `commits: 3` /
  `plan_head_before` / `plan_head_after`. Nothing left uncommitted except pre-existing, out-of-scope
  entries (`.planning/config.json`, `.gsd/`, `.planning/milestone.lock`, `.planning/state.json`).
- **Verification re-run after the last commit:** `npm run build` (lint + `tsc -b`) exits 0; **a full
  `npm test` reports 33 files / 273 tests passed** (442 s).
- **Plan `<automated>` commands, all green:**
  - `npm test -- …/span-attribute-allowlist.spec.ts …/allowlist-span-exporter.spec.ts` → 23/23
  - `npm test -- …/otel.bootstrap.spec.ts` → 15/15
  - `npm test -- …/metrics.controller.spec.ts` → 5/5
- **Acceptance criteria checked by command, not by inspection:**
  - `grep -rn "prom-client" package.json packages/*/package.json apps/*/package.json` → no matches;
    `@nestjs/observe` and `instrumentation-fastify` → no matches anywhere.
  - All five guards negatively controlled (planted violation → test fails → reverted), each recorded
    above with the count of tests it turned red.
  - The OTLP URL normalisation was read out of the installed
    `otlp-exporter-base/build/esnext/configuration/otlp-http-configuration.js`, which uses a
    user-provided `url` verbatim, and cross-checked against
    `otlp-node-http-env-configuration.js`'s `appendResourcePathToUrl`.
  - The span-copy defect was measured against a real `Span` from a real `TracerProvider`
    (`duration`/`ended`/`dropped*Count` all `undefined` after a spread, all correct after
    `Object.create`).
  - The ordering difference was measured in a real `node` process, twice, before it was written down.
- **Stub scan** over every file this plan created: no `TODO`, `FIXME`, `XXX`, `coming soon`,
  `placeholder`, or `not implemented` survives.

---
*Phase: 01-foundations-platform*
*Completed: 2026-10-03*