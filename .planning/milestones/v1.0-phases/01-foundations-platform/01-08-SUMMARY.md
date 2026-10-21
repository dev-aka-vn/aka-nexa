---
phase: 01-foundations-platform
plan: 08
subsystem: infra
tags: [bullmq, job-schedulers, redis-cluster, hash-tag, metrics, opentelemetry, readiness, nestjs]

requires:
  - phase: 01-foundations-platform
    provides: "BULLMQ_PREFIX = '{akane-q}' and buildRedisOptions('producer'|'blocking') (01-02), build-failing module boundaries incl. R1 Worker containment (01-03), startThreeContainers + RedisIndicator + EXTRA_HEALTH_INDICATORS token (01-07)"
provides:
  - "producerConnectionOptions(url) / blockingConnectionOptions(url) / queueRootOptions(url) — the two BullMQ connection profiles and the shared root options, no ioredis keyPrefix on either"
  - "queueKeyNames(queueName, prefix) — the mirror of BullMQ's key layout, pinned to a live Queue's own `keys` by queue.integration.spec.ts"
  - "QueueModule — BullModule.forRootAsync against REDIS_QUEUE_URL with prefix {akane-q}, registering the heartbeat queue"
  - "registerJobScheduler / resumeJobScheduler — the idempotent upsertJobScheduler wrapper and the awaited async resume()"
  - "PLATFORM_HEARTBEAT_ID, registerPlatformHeartbeat, processPlatformHeartbeat — the one scheduled job, incrementing an OTel counter"
  - "workerListeningIndicator / jobSchedulerReadyIndicator / SCHEDULER_PROBE_TIMEOUT_MS — the D-10 per-process readiness checks, neither of which can reject or hang"
  - "registerBusinessMetrics — the OTel meter `akane` and its memoised instrument handles"
affects: [01-09 (exports this meter), 01-10 (mounts QueueModule, wires both indicators under EXTRA_HEALTH_INDICATORS, starts the worker and the scheduler), 01-11+, every phase that registers scheduled work or increments a business metric]

actuals:
  tokens: 41000
  tasks: 3
  commits: 3
  plan_head_before: 63fa812133b467c63bf1f73d3d85c19404a95c63
  plan_head_after: 38b6212c3df84b0559c65641c5a3b05409bb1c25

tech-stack:
  added:
    - "bullmq 6.3.11 (exact STACK.md §14 pin — NOT `bullmqjs`, and never 5.x)"
    - "@nestjs/bullmq 12.0.0 (exact STACK.md §14 pin)"
    - "@opentelemetry/api 1.9.1 (exact STACK.md §14 pin)"
  patterns:
    - "Express the BullMQ key namespace ONLY through BullMQ's own `prefix`; the repository-wide scan that proves no call site sets ioredis `keyPrefix` strips comments first, because the documentation explaining the prohibition names it"
    - "Split the BullMQ connection into two profiles because `maxRetriesPerRequest` is load-bearing on both sides: `null` for a blocking connection (BullMQ throws otherwise), finite 1–3 for a request-path producer (T-1-19)"
    - "A readiness probe resolves false and never rejects; `@nestjs/terminus` re-throws a rejection into a 500, and an unbounded probe turns a Redis blip into 'unresponsive' rather than 'not ready'"
    - "Prove a hash tag by computing the cluster slot, not by grepping for `{` — the slot arithmetic is pinned against real `CLUSTER KEYSLOT` answers"

key-files:
  created:
    - "packages/platform/src/queue/queue.provider.ts — the two connection profiles, queueRootOptions, queueKeyNames"
    - "packages/platform/src/queue/queue.module.ts — QueueModule"
    - "packages/platform/src/queue/job-scheduler.ts — registerJobScheduler, resumeJobScheduler"
    - "packages/platform/src/queue/platform-heartbeat.job.ts — PLATFORM_HEARTBEAT_ID, registerPlatformHeartbeat, processPlatformHeartbeat"
    - "packages/platform/src/queue/queue-indicators.ts — workerListeningIndicator, jobSchedulerReadyIndicator, SCHEDULER_PROBE_TIMEOUT_MS"
    - "packages/platform/src/queue/queue.spec.ts — 8 unit tests"
    - "packages/platform/src/queue/queue.integration.spec.ts — 18 tests against two live Redis deployments"
    - "packages/platform/src/metrics/business-metrics.ts — registerBusinessMetrics, METER_NAME, the metric-name constants"
    - "packages/platform/src/metrics/business-metrics.spec.ts — 7 tests"
  modified:
    - "package.json, package-lock.json — the three STACK.md §14 pins"

key-decisions:
  - "`PLATFORM_HEARTBEAT_QUEUE` is now an alias of `PLATFORM_HEARTBEAT_ID` rather than a second literal. The scheduler id *is* the queue name; two literals for one string is how a job gets scheduled onto a queue nothing consumes. Asserted in both specs."
  - "`queueKeyNames` mirrors BullMQ's `QueueKeys.getKeys` rather than importing it. `QueueKeys` is not in bullmq's public export surface, and bullmq ships its `dist/esm` tree under a CommonJS `package.json` — so a deep import works only because Node's module-syntax detection picks it up. A mirror with no pin would be a drift bug, so `queue.integration.spec.ts` asserts every mirrored name equals the corresponding key of a live `Queue`."
  - "The connection profile takes a `url` and hands it to BullMQ whole, rather than decomposing it into host/port/db/credentials. BullMQ destructures `url` itself (`new Redis(url, rest)`), so TLS upgrades and query-string parameters survive without this module re-implementing URL parsing — and `producerConnectionOptions` needs no `URL` parsing to be wrong."
  - "`workerListeningIndicator([])` is FALSE, not true. The vacuous reading of 'every worker in the list is running' makes a worker process that registered no consumers at all report ready — the exact failure D-10's worker check exists to catch, and invisible until work piles up."
  - "The scheduler probe is bounded at 3 s and returns false on expiry. Without the bound the `catch` is unreachable in the one case it was written for, because ioredis's retryStrategy plus BullMQ's `waitUntilReady` leave the promise pending forever rather than rejecting."
  - "`queue.oldest.item.age` is a NAME constant, not a registered instrument. An observable gauge needs a callback observing live queue state; registering it first would export a permanently-zero series, which satisfies a dashboard's existence check while telling an operator the queue is empty."
  - "The integration spec starts TWO Redis containers (cache + queue) and no MongoDB. The two-deployment split is the claim under test; `mongo:8.0`'s replica-set handshake is the most expensive part of the 01-07 harness and proves nothing here. Images and policies are imported from `tooling/containers.ts` so the harness cannot drift from the suite's."
  - "`queue.integration.spec.ts` reimplements Redis Cluster's CRC16 slot arithmetic — 15 lines, pinned against real `CLUSTER KEYSLOT` answers from Redis 8.10. Asserting only 'every key contains {akane-q}' would pass against a Redis that ignores hash tags; asserting only 'all keys share a slot' would pass by accident. The counterfactual (the same name untagged lands elsewhere) is what gives the assertion meaning."

patterns-established:
  - "Negative-control every lint-like guard before trusting it. Each of the three text scans in this plan (keyPrefix, removed repeatable-job API, prom-client) was verified by planting a violation and confirming the test fails, then restoring. A guard that cannot fail is indistinguishable from a guard that passes."
  - "Strip comments before a source-text scan. Documentation that explains a forbidden form must name it; a scan that cannot distinguish the explanation from the violation forces a choice between weakening the guard and mangling the docs. `queue.spec.ts`, `queue.integration.spec.ts` and `business-metrics.spec.ts` all share one `stripComments` shape."
  - "Where a memoised module is the subject under test, re-import it per test (`vi.resetModules()` + dynamic import). A static import carries the first test's cache into every later assertion, making the file a description of its own execution order rather than of the module."

requirements-completed: []
# FND-08 and OBS-01 are BOTH deliberately left unchecked in REQUIREMENTS.md, on the same standard
# 01-07 applied to FND-05:
#   FND-08 — the mechanism is delivered and proven (idempotent `upsertJobScheduler`, registered
#            three times against live Redis, `getJobSchedulersCount() === 1`), but no process calls
#            `registerPlatformHeartbeat` and no process consumes. Plan 10's composition roots.
#   OBS-01 — the instruments are on the OTel meter and a second path is proven absent, but the
#            requirement names "a Prometheus exporter" and that does not exist. Plan 09's files.
# Neither is over-claimed here.

coverage:
  - id: D1
    description: "Registering the same Job Scheduler id repeatedly converges on exactly one registered scheduler — proven by registering three times and reading getJobSchedulers() back"
    requirement: FND-08
    verification:
      - kind: integration
        ref: "packages/platform/src/queue/queue.integration.spec.ts#converges on exactly one scheduler when every replica registers (T-1-19 boundary)"
        status: pass
      - kind: integration
        ref: "packages/platform/src/queue/queue.integration.spec.ts#reports no scheduler before registration and one after"
        status: pass
    human_judgment: false
  - id: D2
    description: "Registration goes through Queue.upsertJobScheduler; the removed v5 repeatable-job API is absent from the installed BullMQ and named nowhere in the queue sources"
    requirement: FND-08
    verification:
      - kind: integration
        ref: "packages/platform/src/queue/queue.integration.spec.ts#registers through upsertJobScheduler, never the removed add(..., { repeat }) API"
        status: pass
      - kind: integration
        ref: "packages/platform/src/queue/queue.integration.spec.ts#no source file reaches for a removed repeatable-job API"
        status: pass
    human_judgment: false
  - id: D3
    description: "BullMQ root options carry prefix '{akane-q}', and every live queue key produced against a real Redis carries the hash tag"
    requirement: FND-08
    verification:
      - kind: unit
        ref: "packages/platform/src/queue/queue.spec.ts#namespaces every queue under the {akane-q} hash tag"
        status: pass
      - kind: unit
        ref: "packages/platform/src/queue/queue.spec.ts#produces only hash-tagged key names across the whole queue layout"
        status: pass
      - kind: integration
        ref: "packages/platform/src/queue/queue.integration.spec.ts#gives every live BullMQ key the same cluster slot, and the untagged name a different one"
        status: pass
    human_judgment: false
  - id: D4
    description: "The hash tag actually pins the keys to one cluster slot — the slot arithmetic reproduces real CLUSTER KEYSLOT answers, all live keys share one slot, and the untagged equivalent lands elsewhere"
    requirement: FND-08
    verification:
      - kind: integration
        ref: "packages/platform/src/queue/queue.integration.spec.ts#reproduces Redis Cluster slot arithmetic exactly"
        status: pass
      - kind: integration
        ref: "packages/platform/src/queue/queue.integration.spec.ts#gives every live BullMQ key the same cluster slot, and the untagged name a different one"
        status: pass
    human_judgment: false
  - id: D5
    description: "No ioredis client anywhere in the repository sets keyPrefix (D-14, T-1-20)"
    requirement: FND-08
    verification:
      - kind: unit
        ref: "packages/platform/src/queue/queue.spec.ts#sets no keyPrefix on either connection profile"
        status: pass
      - kind: unit
        ref: "packages/platform/src/queue/queue.spec.ts#sets no keyPrefix at any call site in the repository source"
        status: pass
      - kind: integration
        ref: "packages/platform/src/queue/queue.integration.spec.ts#connects through the request-path producer profile, never the blocking one"
        status: pass
    human_judgment: false
  - id: D6
    description: "The producer connection carries a finite maxRetriesPerRequest in D-14's 1–3 band and the blocking connection carries exactly null (T-1-19)"
    requirement: FND-08
    verification:
      - kind: unit
        ref: "packages/platform/src/queue/queue.spec.ts#gives the request-path producer a finite retry budget"
        status: pass
      - kind: unit
        ref: "packages/platform/src/queue/queue.spec.ts#gives the worker blocking connection exactly null"
        status: pass
    human_judgment: false
  - id: D7
    description: "The queue is registered against the noeviction deployment: its policy is read back off the live server, and its live keys are present on that deployment and invisible on the evicting one"
    requirement: FND-08
    verification:
      - kind: integration
        ref: "packages/platform/src/queue/queue.integration.spec.ts#registers the queue against a deployment that must never evict"
        status: pass
      - kind: integration
        ref: "packages/platform/src/queue/queue.integration.spec.ts#puts the live queue keys in the queue deployment and nowhere else"
        status: pass
    human_judgment: false
  - id: D8
    description: "jobSchedulerReadyIndicator reflects registration state, and cannot throw or hang — it resolves false on rejection and on exceeding its 3 s budget"
    requirement: FND-08
    verification:
      - kind: integration
        ref: "packages/platform/src/queue/queue.integration.spec.ts#reports the scheduler as not ready when it is not registered"
        status: pass
      - kind: integration
        ref: "packages/platform/src/queue/queue.integration.spec.ts#reports false — rather than throwing — when Redis is unreachable"
        status: pass
      - kind: integration
        ref: "packages/platform/src/queue/queue.integration.spec.ts#bounds the scheduler probe instead of hanging on an unreachable server"
        status: pass
    human_judgment: false
  - id: D9
    description: "workerListeningIndicator is false with no workers, false when any worker is stopped or cannot answer, and true only when every supplied worker reports running — verified against a real BullMQ Worker as well as stubs"
    requirement: FND-08
    verification:
      - kind: integration
        ref: "packages/platform/src/queue/queue.integration.spec.ts#reports false for an empty worker list and true only when every worker runs"
        status: pass
      - kind: integration
        ref: "packages/platform/src/queue/queue.integration.spec.ts#reports a worker that cannot answer as not listening"
        status: pass
      - kind: integration
        ref: "packages/platform/src/queue/queue.integration.spec.ts#sees a real BullMQ Worker as listening"
        status: pass
    human_judgment: false
  - id: D10
    description: "A Job Scheduler named platform-heartbeat is registered, and its processor increments the platform.heartbeat counter on the OTel meter"
    requirement: FND-08
    verification:
      - kind: integration
        ref: "packages/platform/src/queue/queue.integration.spec.ts#reports no scheduler before registration and one after"
        status: pass
      - kind: integration
        ref: "packages/platform/src/queue/queue.integration.spec.ts#registers the scheduler id that owns the heartbeat processor"
        status: pass
    human_judgment: false
  - id: D11
    description: "Business metric instruments are created through metrics.getMeter on the meter named 'akane' and memoised, so a second registration creates nothing new"
    requirement: OBS-01
    verification:
      - kind: unit
        ref: "packages/platform/src/metrics/business-metrics.spec.ts#creates its instruments on the akane meter, through @opentelemetry/api"
        status: pass
      - kind: unit
        ref: "packages/platform/src/metrics/business-metrics.spec.ts#returns the same handles on a second call, and creates nothing new"
        status: pass
      - kind: unit
        ref: "packages/platform/src/metrics/business-metrics.spec.ts#builds the meter through @opentelemetry/api and nothing else"
        status: pass
    human_judgment: false
  - id: D12
    description: "No prom-client dependency is declared in any manifest and no source file imports it — OBS-01's single metric path"
    requirement: OBS-01
    verification:
      - kind: unit
        ref: "packages/platform/src/metrics/business-metrics.spec.ts#declares no prom-client dependency in any manifest"
        status: pass
      - kind: unit
        ref: "packages/platform/src/metrics/business-metrics.spec.ts#imports no second metrics library anywhere in the source"
        status: pass
    human_judgment: false
  - id: D13
    description: "queueKeyNames mirrors BullMQ's actual key layout exactly — the mirror cannot drift from the original"
    requirement: FND-08
    verification:
      - kind: integration
        ref: "packages/platform/src/queue/queue.integration.spec.ts#mirrors the key names a live Queue actually uses"
        status: pass
    human_judgment: false
  - id: D14
    description: "FND-08 as deployed: a scheduler process that registers at boot and a worker that consumes. NOT delivered by this plan — registration and consumption are wired in plan 10's composition roots."
    requirement: FND-08
    verification: []
    human_judgment: true
    rationale: "Both halves exist and are proven against live Redis, but no `apps/**` module calls `registerPlatformHeartbeat` or constructs a `Worker`. Plan 10 owns `apps/scheduler` and `apps/worker`; plan 09 owns the OTel bootstrap that must precede the SDK registration for these counters to export. A verifier wanting to close the deployed claim needs all three processes running, which is also why FND-08 stays unchecked in REQUIREMENTS.md."
  - id: D15
    description: "OBS-01's full claim: a Prometheus exporter on the OTel meter, producing a scrape endpoint. NOT delivered by this plan — the exporter and the NodeSDK bootstrap are plan 09's files."
    requirement: OBS-01
    verification: []
    human_judgment: true
    rationale: "This plan delivers the instrument half (instruments on meter `akane`, second path proven absent) and plan 09 delivers the transport half. OBS-01's requirement text names 'a Prometheus exporter' explicitly, so it stays unchecked until a scrape endpoint exists and exports a non-flat series."

# Metrics
duration: 78min
completed: 2026-10-03
status: complete
---

# Phase 1 Plan 08: BullMQ queue floor, idempotent Job Schedulers, OTel business metrics

**The async-execution floor: a queue module whose keys are provably pinned to one Redis Cluster
slot, an `upsertJobScheduler` registration that converges on one scheduler no matter how many
replicas boot, two readiness checks that cannot throw or hang, and business-metric instruments
that exist on exactly one meter.**

## Performance

- **Duration:** ~78 min
- **Tasks:** 3 (3 commits)
- **Files:** 9 created, 2 modified (manifest + lockfile)
- **Test suite:** 27 files / 228 tests green (was 24 / 194)

## Accomplishments

- **The hash tag is proven, not asserted.** Live keys were scanned off a real Redis and every one
  was run through a reimplementation of Redis Cluster's `CRC16(tag) mod 16384` — pinned against
  three real `CLUSTER KEYSLOT` answers (`foo`→12182, `bar`→5061, `hello`→866). All live keys
  resolve to **one** slot; the same key name without the tag lands elsewhere. Asserting "every key
  contains `{akane-q}`" alone would have passed against a Redis that ignores hash tags.
- **FND-08 is a measured claim.** Registering the scheduler **three** times leaves
  `getJobSchedulersCount() === 1`. Three stands in for three replicas booting at once. The count
  is read back out of Redis, not inferred from the return value.
- **The queue is on the right server.** The integration spec starts both deployments, reads
  `noeviction` off the queue container and an evicting policy off the cache one, writes the
  scheduler, then asserts the `{akane-q}` keys are present on the queue deployment and **absent**
  from the cache one. A single-container spec would have satisfied every other assertion here.
- **Three lint-like guards, each negatively controlled.** A planted `keyPrefix`, a planted
  `getRepeatableJobs`, a planted manifest `prom-client` entry and a planted `prom-client` import
  were each confirmed to fail the scanning test, then removed. A guard that cannot fail is
  indistinguishable from a guard that passes.
- **One real defect found and fixed, in the plan's own design.** `jobSchedulerReadyIndicator`
  originally caught rejections — but against an unreachable Redis the promise **never rejects**,
  because ioredis's retry strategy plus BullMQ's `waitUntilReady` leave it pending forever. The
  catch was unreachable in the one case it existed for. Now bounded at 3 s, measured by a test.

## Task Commits

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | Queue module, `{akane-q}` prefix, two connection profiles | `c00a96f` | feat |
| 2 | Idempotent scheduler registration, heartbeat, readiness indicators | `2e40d36` | feat |
| 3 | Single-metric-path assertion on the OTel meter | `38b6212` | test |

**Plan head before:** `63fa812` · after: `38b6212` · **task commits measured: 3**
(`git rev-list --count 63fa812..38b6212`).

## Files Created

- `packages/platform/src/queue/queue.provider.ts` — `producerConnectionOptions`,
  `blockingConnectionOptions`, `queueRootOptions`, `queueKeyNames`, `QUEUE_KEY_SUFFIXES`
- `packages/platform/src/queue/queue.module.ts` — `QueueModule`, `PLATFORM_HEARTBEAT_QUEUE`
- `packages/platform/src/queue/job-scheduler.ts` — `registerJobScheduler`, `resumeJobScheduler`
- `packages/platform/src/queue/platform-heartbeat.job.ts` — `PLATFORM_HEARTBEAT_ID`,
  `registerPlatformHeartbeat`, `processPlatformHeartbeat`
- `packages/platform/src/queue/queue-indicators.ts` — `workerListeningIndicator`,
  `jobSchedulerReadyIndicator`, `SCHEDULER_PROBE_TIMEOUT_MS`
- `packages/platform/src/queue/index.ts` — the queue barrel
- `packages/platform/src/queue/queue.spec.ts` — 8 unit tests
- `packages/platform/src/queue/queue.integration.spec.ts` — 18 tests, two live Redis deployments
- `packages/platform/src/metrics/business-metrics.ts` + `business-metrics.spec.ts` — 7 tests
- `package.json`, `package-lock.json` — `bullmq@6.3.11`, `@nestjs/bullmq@12.0.0`,
  `@opentelemetry/api@1.9.1`

## Decisions Made

- **`PLATFORM_HEARTBEAT_QUEUE` is now an alias, not a literal.** The first draft of
  `queue.module.ts` carried `export const PLATFORM_HEARTBEAT_QUEUE = 'platform-heartbeat'` while
  `platform-heartbeat.job.ts` declared `PLATFORM_HEARTBEAT_ID = 'platform-heartbeat'` — two
  literals for one string, which is how jobs end up scheduled onto a queue nothing consumes. The
  queue name is now `= PLATFORM_HEARTBEAT_ID`, and a test asserts they are the same value.
- **`queueKeyNames` mirrors BullMQ rather than importing it.** `QueueKeys` is not in bullmq's
  public export surface, and bullmq ships its `dist/esm` tree under a CommonJS `package.json`, so a
  deep import resolves only because Node's module-syntax detection picks the file up as ESM. A
  mirror is only safe with a pin, so `queue.integration.spec.ts` asserts every mirrored name equals
  the corresponding key of a live `Queue`.
- **The connection profile takes a `url` and hands it to BullMQ whole.** BullMQ destructures `url`
  itself (`new Redis(url, rest)`), so TLS upgrades and query-string parameters survive without this
  module re-implementing URL parsing.
- **`workerListeningIndicator([])` is `false`.** Vacuous truth would make a worker process that
  registered no consumers report ready — D-10's check exists for exactly that case.
- **`queue.oldest.item.age` is a name, not an instrument.** Registering an observable gauge before
  its callback exists exports a permanently-zero series: it satisfies a dashboard's existence check
  while telling an operator the queue is empty.
- **The integration spec starts two Redis containers, not three.** MongoDB proves nothing here and
  its replica-set handshake is the most expensive part of the 01-07 harness. Images and policies
  are imported from `tooling/containers.ts`, so this harness cannot drift from the suite's.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] The three STACK.md §14 pins were absent from every manifest**
- **Found during:** Task 1
- **Issue:** `bullmq`, `@nestjs/bullmq` and `@opentelemetry/api` were not installed. T-1-SC names
  all three explicitly and requires no unpinned install; `package.json` is not in the plan's
  `files_modified`.
- **Fix:** `npm install --save-dev --save-exact` at the exact §14 versions, each verified against
  `registry.npmjs.org` before install. Root `devDependencies`, matching how `ioredis` (01-02) and
  `pino` (01-04) were added — **which carries forward 01-07's caveat that `npm ci --omit=dev`
  produces a tree that cannot boot.** That is a pre-existing repo-wide model, not introduced here.
- **Files modified:** `package.json`, `package-lock.json`
- **Committed in:** `c00a96f`

**2. [Rule 1 — Bug] `jobSchedulerReadyIndicator`'s `catch` was unreachable in the case it existed for**
- **Found during:** Task 2 (GREEN, first full integration run)
- **Issue:** The first implementation was `try { return (await queue.getJobScheduler(id)) !== undefined } catch { return false }`.
  The test that pointed a `Queue` at an unreachable server **timed out at 60 s instead of
  resolving false**. `maxRetriesPerRequest` bounds *queued commands*, not connection
  establishment; ioredis's default `retryStrategy` retries with backoff and BullMQ's
  `RedisConnection.init()` awaits a `ready` event that never arrives. The promise stays pending
  forever.
- **Why this is a production defect, not a test-timing nuisance:** this is D-10's scheduler
  readiness check. It would hang `/health/ready` during any Redis blip, the orchestrator's own
  probe timeout would expire first, and the pod would be reported **unresponsive** instead of
  **not ready** — losing exactly the per-dependency detail the whole health design exists to
  provide. It is the same class of bug 01-07 found in `MongoService` (`connectTimeoutMS`), in the
  same plan-generation, and the docblock asserting the catch was sufficient was false.
- **Fix:** `Promise.race` against an `unref()`'d 3 s timer (`SCHEDULER_PROBE_TIMEOUT_MS`), which is
  cleared in a `finally`. Two new tests: one against a queue pointed at `127.0.0.1:1` asserting
  `resolves.toBe(false)`, one against a stub whose `getJobScheduler` never settles, asserting the
  call returns within 3× the budget.
- **Files modified:** `packages/platform/src/queue/queue-indicators.ts`,
  `packages/platform/src/queue/queue.integration.spec.ts`
- **Committed in:** `2e40d36`

**3. [Rule 3 — Blocking] The three source-text guards needed comment stripping**
- **Found during:** Tasks 1–3
- **Issue:** The first version of each scan matched inside docblocks. `redis.provider.ts` writes
  ``keyPrefix: ""`` to explain why a client-side assertion is vacuous; `job-scheduler.ts` names
  `getRepeatableJobs` to explain why it is wrong. Documentation that explains a prohibition must
  name it — the only ways out were to weaken the guard or to mangle the explanation.
- **Fix:** one `stripComments` shape per spec, removing block comments and whitespace-preceded
  line comments. The whitespace requirement is what preserves a `redis://` URL inside a string
  literal, which is the one line-comment shape that appears as live code here.
- **Verification:** all three scans were **negatively controlled** after the fix — a planted
  `keyPrefix`, a planted `getRepeatableJobs`, and both a planted manifest entry and a planted
  `import 'prom-client'` each fail their test, and each passes again once reverted.
- **Files modified:** `queue.spec.ts`, `queue.integration.spec.ts`, `business-metrics.spec.ts`
- **Committed in:** `c00a96f`, `2e40d36`, `38b6212`

**4. [Rule 1 — Bug] `business-metrics.spec.ts` asserted against a cache warmed by whichever test ran first**
- **Found during:** Task 3 (first run: 6 passed | 1 failed)
- **Issue:** `registerBusinessMetrics()` memoises in module scope — that is the behaviour under
  test. With a static import, the memo was populated by the first test's recording provider, so the
  memoisation test observed zero instruments created and read `undefined` where it expected 1.
- **Fix:** `vi.resetModules()` plus a dynamic `import()` per test, so each starts with an empty
  memo and the assertions describe the module rather than the file's execution order.
- **Files modified:** `packages/platform/src/metrics/business-metrics.spec.ts`
- **Committed in:** `38b6212`

**5. [Rule 3 — Blocking] `JobSchedulerTarget`'s structural type rejected the real `Queue`**
- **Found during:** Task 2 (`npm run build` after GREEN)
- **Issue:** `tsc` reported that `Queue<…>` was not assignable to `JobSchedulerTarget`, because
  BullMQ declares `Job.id` and `Job.name` as `string | undefined` while the seam required `string`.
  Two further build errors: `RedisContainer` was declared where `StartedRedisContainer` was meant
  (the latter has `getConnectionUrl`/`stop`), and `RegisteredJob` had to drop the `ts` field for the
  same reason.
- **Fix:** the seam now mirrors BullMQ's own optionality (`id?: string; name?: string`), with a
  comment stating that a structural seam has to match the class rather than an idealised version of
  it. Container variables are typed `StartedRedisContainer`.
- **Files modified:** `job-scheduler.ts`, `queue.integration.spec.ts`
- **Committed in:** `2e40d36`

**6. [Rule 1 — Bug] `@typescript-eslint/no-this-alias` rejected the recording meter stub**
- **Found during:** Task 3 (`npm run build`)
- **Issue:** The stub captured `const provider = this` inside `getMeter` so its inner
  `createCounter` could record. The lint gate — correctly — rejects the alias.
- **Fix:** `getMeter` became an arrow-bodied class property, closing over the instance lexically.
- **Files modified:** `business-metrics.spec.ts`
- **Committed in:** `38b6212`

**Total deviations:** 6 auto-fixed (3 × Rule 3 blocking, 3 × Rule 1 bug). Every one was a
prerequisite for the planned work, not scope creep. **No threat mitigation was weakened, no
boundary rule relaxed, and no pin loosened** — `npm run lint` is clean and the plan-03 fixture
spec that proves R1/R2/R3 actually fire is still green.

## Issues Encountered

- **BullMQ 6 resolves to its CommonJS build even under `"type": "module"`.** `bullmq`'s
  `package.json` has no `"type"` field, so `dist/esm/*.js` is loaded as CJS by Node's syntax
  detection. This is why a deep import of `QueueKeys` *appears* to work and why it is still the
  wrong dependency. `bullmq` also **throws** when handed a raw client instance carrying
  `keyPrefix` — D-14's prohibition is enforced by the library, which is worth knowing independently
  of our own scan.
- **`RedisConnection.checkBlockingOptions` fires on truthiness, not nullness.** A blocking
  connection given `maxRetriesPerRequest: 2` does not throw — it logs
  `BullMQ: WARNING! Your redis options maxRetriesPerRequest must be null` on every worker boot and
  silently overrides it. That is why `blockingConnectionOptions` sets `null` explicitly rather than
  relying on the override: our own call site is quiet.
- **`StartedRedisContainer` is a distinct type from `RedisContainer`** and carries
  `getConnectionUrl`, `stop` and `executeCliCmd`. Typing a started container as the builder type is
  a build error, which is why the spec's variables are `StartedRedisContainer`.
- **`vitest.config.mts` sets `hookTimeout: 30000`** and this spec stops two containers in
  `afterAll`. 01-07 recorded the resulting "file failed, all assertions passed" failure mode; both
  hooks here carry explicit `300_000` timeouts.
- **`npm test` is now ~6.5 min** with 27 files. Vitest reports `isolate: false` would save ~25 s of
  import time (5% of wall clock). Not adopted, on 01-07's reasoning: it trades test isolation for a
  small fraction of a Docker-bound suite, and the decision belongs with the phase's later plans.
- **A docblock cannot contain `*/`.** The first `queue.spec.ts` wrote a JSDoc line reading
  ``packages/*/src``, which closed the comment early and produced a parse error at transform time.
  Reworded.

## Threat Model Coverage

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-1-19 (DoS — a hanging producer turns a Redis outage into a hung request) | mitigate | **Implemented.** `producerConnectionOptions` pins `maxRetriesPerRequest: 2`, inside D-14's 1–3 band; asserted at the 1–3 boundary, not against "some finite number". `blockingConnectionOptions` pins exactly `null` — `toBeNull()`, since BullMQ's check is truthiness-based and `0` or `false` would both fail it. A real BullMQ `Worker` was constructed against a live server with this profile. |
| T-1-20 (Tampering — two disagreeing prefix layers corrupt queue keys) | mitigate | **Implemented.** The prefix is a single constant reached through `queueRootOptions`; no call site supplies it. Neither connection profile sets `keyPrefix`, and a repository-wide scan proves no source file sets it anywhere. Against a live Redis, every key BullMQ created carries the tag and resolves to one cluster slot. |
| T-1-SC (no unpinned install) | mitigate | **Implemented.** `bullmq@6.3.11`, `@nestjs/bullmq@12.0.0`, `@opentelemetry/api@1.9.1` installed `--save-exact` at the STACK.md §14 versions, each verified against the registry first. No package outside the ledger was added. |

**Plan prohibitions, all satisfied:**

- *"MUST NOT let any ioredis client carry `keyPrefix` alongside BullMQ's own prefix"* — asserted
  per-profile **and** by a repository scan, with comments stripped, negatively controlled.
- *"MUST NOT create a second metrics path"* — asserted three ways: no manifest declares
  `prom-client`, no source file imports it, and `business-metrics.ts`'s bare-import list is exactly
  `['@opentelemetry/api']` (stronger than naming the one forbidden package, since it rejects a new
  registry of any name).
- *"MUST NOT use the removed `add(..., { repeat })` API"* — asserted by a `vi.spyOn` on
  `upsertJobScheduler` with exact argument matching, by the absence of `getRepeatableJobs` on the
  installed Queue (a version check as well as an API check), and by a comment-stripped source scan.

## Known Stubs

None. `queue.oldest.item.age` is a deliberate **name constant**, not a stub: an observable gauge
needs a callback observing live queue state, and registering the instrument first would export a
permanently-zero series that satisfies a dashboard's existence check while telling an operator the
queue is empty. The plan asked for a name constant specifically, and the test asserts no instrument
is registered under it. No `TODO`, `FIXME`, placeholder, or skipped test survives in any file this
plan created.

## User Setup Required

None. Docker must be reachable (`docker info` exits 0) for the integration half of task 2 — the
plan's declared `<precondition>`, verified before the task ran. Without a daemon the 18 integration
tests cannot run; everything else in the suite is unaffected.

## Next Phase Readiness

- **Ready for plan 09 (OTel bootstrap).** `registerBusinessMetrics()` obtains its meter **per call**
  rather than at import time, precisely because the global meter provider is installed by a bootstrap
  that must run before instrumented modules are imported (D-20). Plan 09 wires
  `exporter-prometheus` over this meter. **Two instruments exist** — `platform.heartbeat` and
  `queue.job.failures` — and `platform.heartbeat` only moves once a worker consumes a heartbeat job,
  which is plan 10's wiring. Do not read an empty dashboard as a missing exporter.
- **Ready for plan 10 (entrypoints).** `QueueModule` is importable by all three apps and registers
  the heartbeat queue. `scheduler` must call `registerPlatformHeartbeat(queue)` at boot — **on every
  replica, with no leader election**, which is the entire point of `upsertJobScheduler`. `worker`
  constructs the `Worker` with `blockingConnectionOptions` and mounts
  `workerListeningIndicator([worker])` under `EXTRA_HEALTH_INDICATORS`; `scheduler` mounts
  `jobSchedulerReadyIndicator(queue, PLATFORM_HEARTBEAT_ID)`. **Both indicators return plain
  booleans, so plan 10 wraps them** in `HealthIndicatorService.check(key).up()/.down()` — and must
  carry 01-07's rule with them: the wrapper must not throw, or the terminus 500 returns.
- **`packages/platform/package.json`'s `exports` map is the **fourth** recurrence** (01-04
  `./logging`, 01-05 `./crypto`, 01-07 `./health` + `./mongo`, now `./queue` + `./metrics`). The
  barrels exist so no plan has to edit the root barrel, but the map declares only `"."` and
  `"./crypto"`, so `@akane/platform/queue` does not resolve cross-package. **Resolve it once,
  deliberately, in plan 10** — which is the first plan that must actually import one of them.
- **Not delivered, and it must not be assumed:** no process registers a scheduler or consumes a job
  yet, and there is no scrape endpoint. **`FND-08` and `OBS-01` are left unchecked in
  `REQUIREMENTS.md`** — deliberately, on the standard 01-07 set for FND-05. FND-08's requirement is
  about scheduled work *running*; nothing runs it until plan 10 wires `apps/scheduler` and
  `apps/worker`. OBS-01's requirement names "a Prometheus exporter"; there is none until plan 09.
  Each has a note in `REQUIREMENTS.md` stating exactly what landed and what did not, so a verifier
  can close them against running processes rather than against this summary.

## Self-Check: PASSED

- **Created files** (10/10 verified present on disk): the 9 source/spec files listed above plus this
  SUMMARY.
- **Commits** (3/3 verified in `git log`): `c00a96f`, `2e40d36`, `38b6212`.
- **Measured commit count** — `git rev-list --count 63fa812..38b6212` = **3**, matching `commits: 3`
  / `plan_head_before` / `plan_head_after`. Nothing is left uncommitted; the working tree holds only
  pre-existing, out-of-scope entries (`.planning/config.json`, `.planning/ROADMAP.md`,
  `.planning/WINDOWS.md`, `.gsd/`, `.planning/milestone.lock`, `.planning/state.json`).
- **Verification re-run after the last commit:** `npm run build` (lint + `tsc -b`) exits 0; **two
  consecutive full `npm test` runs** report 27 files / 228 tests passed.
- **Plan `<automated>` commands, all green:**
  - `npm test -- packages/platform/src/queue/queue.spec.ts` → 8/8
  - `npm test -- packages/platform/src/queue/queue.integration.spec.ts` → 18/18
  - `npm test -- packages/platform/src/metrics/business-metrics.spec.ts` → 7/7
- **Acceptance criteria checked by command, not by inspection:**
  - `grep -rn "prom-client" package.json packages/*/package.json apps/*/package.json` → no matches;
    the source scan is the third test in `business-metrics.spec.ts`.
  - The `keyPrefix` scan, the removed-API scan and both `prom-client` scans were each negatively
    controlled (planted violation → test fails → reverted).
  - `docker run redis:8.10-alpine --cluster-enabled yes` produced the three `CLUSTER KEYSLOT`
    known-answer vectors the spec pins, confirming the slot arithmetic against Redis itself rather
    than against my own implementation.
  - No `Worker` is constructed outside `apps/worker`: `queue.module.ts` imports only `BullModule`,
    and `queue-indicators.ts` declares its worker seam structurally so the class never enters the
    `api` or `scheduler` module graphs. R1's `no-restricted-imports` remains unweakened and
    `npm run lint` is clean.
- **Stub scan** over every file this plan created: no `TODO`, `FIXME`, `XXX`, `coming soon`,
  `placeholder`, or `not implemented` survives.

---
*Phase: 01-foundations-platform*
*Completed: 2026-10-03*