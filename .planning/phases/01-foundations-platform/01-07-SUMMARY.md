---
phase: 01-foundations-platform
plan: 07
subsystem: infra
tags: [mongodb, testcontainers, redis, terminus, health-check, readiness, liveness, nestjs]

requires:
  - phase: 01-foundations-platform
    provides: "Zod-validated ConfigModule + MONGO_URL/REDIS_*_URL boot contract (01-02), REDIS_CACHE/REDIS_QUEUE DI tokens and createRedisClient profiles (01-02), build-failing module boundaries incl. R3 mongodb containment (01-03), typed LoggerPort (01-04)"
provides:
  - "startThreeContainers() — testcontainers harness starting MongoDB 8.0, cache Redis (allkeys-lru) and queue Redis (noeviction), with readMaxMemoryPolicy() to read either policy back"
  - "MongoService over the native `mongodb` driver — client, db(name), ping(), onModuleDestroy(); MongoModule registers it under its class and under MONGO_CLIENT"
  - "HealthController with /health/live (reads nothing) and /health/ready (always mongo + redis_cache + redis_queue, 503 naming the failing key)"
  - "MongoIndicator and RedisIndicator — terminus indicators that never place a driver error message in the result (T-1-18)"
  - "EXTRA_HEALTH_INDICATORS optional DI token — the extension point plans 08/10 use for the worker/scheduler checks"
  - "redis.integration.spec.ts proving the two-Redis split against live servers"
affects: [01-08, 01-09, 01-10, every later phase that reads or writes MongoDB, every entrypoint's probe wiring]

actuals:
  tokens: 12495
  tasks: 3
  commits: 6
  plan_head_before: 41fb141be82594fb6dffebd1545bea4504e852af
  plan_head_after: 8379909

tech-stack:
  added:
    - "mongodb 7.7.0 (exact STACK.md §14 pin — native driver, NOT mongoose)"
    - "@nestjs/terminus 12.1.0 (exact STACK.md §14 pin)"
    - "testcontainers 12.2.0 + @testcontainers/mongodb 12.2.0 + @testcontainers/redis 12.2.0 (exact STACK.md §14 pins)"
  patterns:
    - "A health indicator CATCHES internally: terminus re-throws a rejected indicator into a 500, and the driver's error message is the one thing that would leak the seed address"
    - "An indicator is a plain class constructed from injected clients, not an injected class — that is what binds a Redis deployment to its readiness key in exactly one place"
    - "Construct a client without connecting (lazyConnect / connect-on-first-operation) so module compilation never opens a socket and a unit test that imports the module needs no server"
    - "Read a dependency's configuration back off the live server (CONFIG GET) rather than asserting on the command line that started it"
    - "Bound the server-selection timeout so a readiness probe reports 'not ready' instead of hanging until the orchestrator calls it unresponsive"

key-files:
  created:
    - "tooling/containers.ts — startThreeContainers(), mongoUrl(), readMaxMemoryPolicy(), EVICTING_POLICIES"
    - "tooling/tsconfig.json — new composite project so containers.ts is typechecked by `tsc -b`"
    - "packages/platform/src/mongo/{mongo.service,mongo.module,index}.ts + mongo.service.spec.ts"
    - "packages/platform/src/health/{mongo.indicator,redis.indicator,health.controller,index}.ts + health.controller.spec.ts + health.indicators.spec.ts"
    - "packages/platform/src/redis/redis.integration.spec.ts"
  modified:
    - "package.json, package-lock.json — the five STACK.md §14 pins"
    - "tsconfig.json, packages/platform/tsconfig.json — reference the new tooling project"

key-decisions:
  - "MongoService takes the URL as a constructor argument, not via ConfigService. The module factory injects ConfigService; the service itself has no config dependency, so a spec can point it at a container and a future repo can construct it directly. This follows the 01-05 lesson in the opposite direction: the *policy* read the live environment, but a *value* that is fixed for the process lifetime does not need a stale-snapshot workaround."
  - "The indicators are constructed by the controller from injected clients rather than registered as injectable classes. It removes the need for a `HealthModule` the plan does not list, and it is the only way `redis_cache` and `redis_queue` are bound to their names in one place — the alternative is a caller naming the key."
  - "The indicators return a bare `up()`/`down()` with no data. Terminus's `JsonErrorLogger` also echoes `details` to its logger, so a single extra field would reach two places; status flags are the whole body."
  - "readMaxMemoryPolicy matches the policy vocabulary rather than indexing output lines, and it treats `redis-cli` exiting 0 on an `ERR unknown command` as a failure. A positional parse that read the key as the value would make 'the value is noeviction' pass for the wrong reason."
  - "The plan's harness needed `directConnection=true`, which `getConnectionString()` does not supply. See deviation 1."

patterns-established:
  - "Boot contract extension: a capability is registered under both its class and a Symbol token, so consumers can inject the capability without importing a concrete class."
  - "Health contract: liveness returns a fixed literal and constructs no dependency; readiness always runs the full frozen key set. Both halves are asserted — a liveness test that only ran with everything healthy would pass against a liveness probe that touched Mongo."
  - "Topology contract: two-deployment claims are proven by reading each server's own configuration and by showing one deployment's data is invisible to the other. A syntactic URL comparison alone is exactly what a single-instance regression would still satisfy."

requirements-completed: []
# FND-05 is deliberately NOT in the list. This plan delivered the readiness *mechanism* and the
# three-container proof, but the requirement as written is "api, worker, and scheduler each expose
# /health/live and /health/ready". No `apps/**` file is in this plan's `files_modified`, and the
# plan's own success_criteria assign process-level mounting to plan 10. The exact gap is named in
# "FND-05 status" below. Its REQUIREMENTS.md checkbox stays unchecked.

coverage:
  - id: D1
    description: "MongoService.ping() resolves against a running MongoDB 8.0 and rejects — with a server-selection/connect error, not an arbitrary throw — once the server is stopped"
    requirement: FND-05
    verification:
      - kind: integration
        ref: "packages/platform/src/mongo/mongo.service.spec.ts#resolves ping() while the server is up"
        status: pass
      - kind: integration
        ref: "packages/platform/src/mongo/mongo.service.spec.ts#rejects ping() within the selection timeout once the server is gone"
        status: pass
    human_judgment: false
  - id: D2
    description: "startThreeContainers() starts MongoDB, a cache Redis and a queue Redis concurrently, hands back all three URLs, and stops all three (idempotently, and cleaning up after a partial start)"
    requirement: FND-05
    verification:
      - kind: integration
        ref: "packages/platform/src/mongo/mongo.service.spec.ts#starts MongoDB, a cache Redis and a queue Redis, each addressable"
        status: pass
    human_judgment: false
  - id: D3
    description: "The cache Redis reports an evicting maxmemory-policy and the queue Redis reports noeviction, read back off each live server with CONFIG GET; the two answers differ"
    requirement: FND-05
    verification:
      - kind: integration
        ref: "packages/platform/src/redis/redis.integration.spec.ts#runs the queue deployment with noeviction and the cache deployment with an evicting policy"
        status: pass
    human_judgment: false
  - id: D4
    description: "The two Redis deployments are two servers, not one URL with two logical databases: a key written through the cache client is invisible through the queue client, and the two host:port values differ"
    requirement: FND-05
    verification:
      - kind: integration
        ref: "packages/platform/src/redis/redis.integration.spec.ts#keeps the two deployments from sharing state"
        status: pass
      - kind: integration
        ref: "packages/platform/src/redis/redis.integration.spec.ts#binds the two URLs to two distinct host:port deployments"
        status: pass
    human_judgment: false
  - id: D5
    description: "GET /health/ready returns 200 with all three up, and 503 with the failing key named (and only that key) when exactly one deployment is down"
    requirement: FND-05
    verification:
      - kind: integration
        ref: "packages/platform/src/health/health.controller.spec.ts#returns 200 with every dependency up"
        status: pass
      - kind: integration
        ref: "packages/platform/src/health/health.controller.spec.ts#returns 503 naming redis_queue when only the queue deployment is down"
        status: pass
    human_judgment: false
  - id: D6
    description: "GET /health/live returns 200 with { status: 'ok' } while every dependency is failing, and constructs no dependency at all (T-1-17)"
    requirement: FND-05
    verification:
      - kind: integration
        ref: "packages/platform/src/health/health.controller.spec.ts#returns 200 with { status: \"ok\" } while every dependency is failing"
        status: pass
      - kind: integration
        ref: "packages/platform/src/health/health.controller.spec.ts#reads no dependency at all"
        status: pass
    human_judgment: false
  - id: D7
    description: "No health response body contains a connection string, credential, URL, or hostname, whether the dependency is up or down (T-1-18)"
    requirement: FND-05
    verification:
      - kind: integration
        ref: "packages/platform/src/health/health.controller.spec.ts#never puts a connection string, credential, or URL in the body (T-1-18)"
        status: pass
      - kind: unit
        ref: "packages/platform/src/health/health.indicators.spec.ts#reports down when ping() rejects, without carrying the driver message"
        status: pass
      - kind: unit
        ref: "packages/platform/src/health/health.indicators.spec.ts#reports down without carrying the connection URL when PING rejects"
        status: pass
    human_judgment: false
  - id: D8
    description: "Readiness always runs exactly the three core keys, and an optional injected EXTRA_HEALTH_INDICATORS list extends it without duplicating or replacing them"
    requirement: FND-05
    verification:
      - kind: integration
        ref: "packages/platform/src/health/health.controller.spec.ts#always checks exactly the three core dependencies"
        status: pass
      - kind: integration
        ref: "packages/platform/src/health/health.controller.spec.ts#runs an injected extra indicator alongside the core three"
        status: pass
    human_judgment: false
  - id: D9
    description: "The plan-02 connection profiles are still the ones used against live servers: finite maxRetriesPerRequest on the request path, null on the blocking profile, and keyPrefix on neither"
    requirement: FND-05
    verification:
      - kind: integration
        ref: "packages/platform/src/redis/redis.integration.spec.ts#gives the request-path clients a finite retry budget and the blocking client none (D-14)"
        status: pass
    human_judgment: false
  - id: D10
    description: "FND-05 as written: all three entrypoints actually serving both endpoints. NOT delivered by this plan — the controller exists and is proven, but no `apps/**` module mounts it."
    requirement: FND-05
    verification: []
    human_judgment: true
    rationale: "Process-level mounting is plan 10's files. It cannot be automated here because the deliverable does not exist yet; the verifier must confirm each of apps/api, apps/worker and apps/scheduler answers both endpoints on its own port after plan 10."

# Metrics
duration: 82min
completed: 2026-10-02
status: complete
---

# Phase 1 Plan 07: Three-container harness, native-driver Mongo, per-dependency readiness

**A three-container integration harness that proves the cache/queue Redis split is two servers with
different `maxmemory-policy` values, a `MongoService` over the native driver with a bounded `ping()`,
and a `/health/live` + `/health/ready` pair where liveness reads nothing and readiness always names
the deployment that is down.**

## Performance

- **Duration:** ~82 min
- **Started:** 2026-10-02T15:11Z
- **Completed:** 2026-10-02T16:33Z
- **Tasks:** 3
- **Files modified:** 16 (12 new source/test, 4 config)
- **Test suite:** 24 files / 193 tests green (was 20 / 171)

## Accomplishments

- **The three-container topology is proven, not asserted.** Live evidence from this run:
  `CACHE host=localhost:33143 policy=allkeys-lru`, `QUEUE host=localhost:33142 policy=noeviction`,
  `MONGO mongodb://localhost:33144?directConnection=true`. The policy is read back off each server
  with `CONFIG GET maxmemory-policy`, and the test additionally requires the two answers to *differ*
  — otherwise a harness that silently started the same image twice would satisfy both assertions.
- **"Two Redis deployments" is now an empirical claim.** A key written through the cache client is
  invisible through the queue client. A syntactic `URL.host` comparison alone would still pass if the
  split regressed to one instance with a `/0` vs `/1` suffix — which is precisely the failure D-12
  exists to prevent, and which `refineRedisInstancesDistinct` already rejects at boot.
- **Readiness is diagnosable.** `GET /health/ready` returns 503 with `error: { redis_queue: { status:
  "down" } }` and nothing else, when the queue deployment alone is down. A single collapsed
  `redis: down` would leave an operator guessing which of two deployments to page about.
- **Liveness is provably dependency-free.** A test asserts `mongo.ping` and both Redis `ping`s are
  called **zero** times across two requests to `/health/live`. A liveness test that only ran with
  healthy dependencies would pass against a probe that touched Mongo — which is the exact bug T-1-17
  describes.
- **Nothing leaks through the probe.** A 503 with all three dependencies rejecting is asserted not to
  contain `mongodb://`, `redis://`, `:password@`, the seeded credential, or the hostnames. The
  indicators drop the driver error entirely rather than trimming it.

## TDD: RED → GREEN

| Task | RED | GREEN | Notes |
|------|-----|-------|-------|
| 1 — harness + `MongoService` | `d0d27b1` | `29436b3` | 2 of 3 named tests failed on assertions; the third (the harness itself) passed |
| 2 — indicators + controller | `88def4f` | `ee38ae8` | 11 of 12 failed on assertions; the liveness test passed because the contract was already proven by plan 01's tracer |
| 3 — Redis split proof | — | `646087c` | `type="auto"` (no `tdd` attribute); test and proof land together |

**RED evidence (Task 1).** `npx vitest run packages/platform/src/mongo/mongo.service.spec.ts` →
exit 1, `Tests 2 failed | 1 passed (3)`, both failures on the target behaviour
(`AssertionError: promise rejected "Error: MongoService.ping: not implemented" instead of resolving`
and `expected [Function] to throw error matching /server selection|ECONNREFUSED/i but got
'MongoService.ping: not implemented'`). An earlier RED attempt was **INVALID_RED** — the skeleton
constructor threw, so Vitest classified it as a failed *suite* with 3 skipped tests and no assertion
failure. The skeleton was changed to construct successfully and fail inside `ping()`.

**RED evidence (Task 2).** `npx vitest run packages/platform/src/health/*.spec.ts` → exit 1,
`Tests 11 failed | 1 passed (14)`, every failure an `AssertionError` or a driver/terminus error at
the assertion.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED** — `d0d27b1` (test) — harness + failing spec + the five STACK.md §14 pins
2. **Task 1 GREEN** — `29436b3` (feat) — `MongoService`, `MongoModule`, `mongo/index.ts`
3. **Task 2 RED** — `88def4f` (test) — indicators + controller specs and skeletons
4. **Task 2 GREEN** — `ee38ae8` (feat) — indicators, controller, barrel
5. **Task 3** — `646087c` (feat) — `redis.integration.spec.ts` + the `executeCliCmd` fix
6. **Teardown fix** — `8379909` (fix) — explicit `afterAll` timeouts

**Plan metadata:** this summary + STATE.md + ROADMAP.md (docs)

_Plan head before: `41fb141` · after: `8379909` · commits measured: 6_

## Files Created/Modified

- `tooling/containers.ts` — `startThreeContainers()`, `mongoUrl()`, `readMaxMemoryPolicy()`, `EVICTING_POLICIES`
- `tooling/tsconfig.json` — new; makes `tooling/` a referenced composite project
- `tsconfig.json`, `packages/platform/tsconfig.json` — reference `../../tooling`
- `packages/platform/src/mongo/mongo.service.ts` — `MongoService`: `client`, `db(name)`, `ping()`, `onModuleDestroy()`
- `packages/platform/src/mongo/mongo.module.ts` — `MONGO_CLIENT` token, `mongoServiceProvider`, `MongoModule`
- `packages/platform/src/mongo/index.ts` — the `mongo/` barrel
- `packages/platform/src/mongo/mongo.service.spec.ts` — 3 integration tests
- `packages/platform/src/health/mongo.indicator.ts` — `MongoIndicator`, `MONGO_HEALTH_KEY`
- `packages/platform/src/health/redis.indicator.ts` — `RedisIndicator`, `RedisPingClient`
- `packages/platform/src/health/health.controller.ts` — `HealthController`, `CORE_HEALTH_INDICATOR_KEYS`, `EXTRA_HEALTH_INDICATORS`
- `packages/platform/src/health/health.controller.spec.ts` — 7 tests over real HTTP
- `packages/platform/src/health/health.indicators.spec.ts` — 7 unit tests
- `packages/platform/src/health/index.ts` — the `health/` barrel
- `packages/platform/src/redis/redis.integration.spec.ts` — 5 tests against live containers
- `package.json`, `package-lock.json` — `mongodb@7.7.0`, `@nestjs/terminus@12.1.0`, `testcontainers@12.2.0`, `@testcontainers/mongodb@12.2.0`, `@testcontainers/redis@12.2.0`

## Decisions Made

- **`MongoService` takes a URL, not `ConfigService`.** The module factory injects config; the service
  has no config dependency. This is deliberately *not* 01-05's live-environment workaround — that was
  for a **policy** that must not read a possibly-stale value, whereas `MONGO_URL` is fixed for the
  process lifetime and the snapshot is correct. Coupling the two would have made a unit test need a
  Nest container to point at a container.
- **Indicators are constructed by the controller, not injected as classes.** The plan lists no
  `health.module.ts`, and constructing them is what binds `redis_cache` / `redis_queue` to their keys
  in exactly one place. The alternative — an injected `RedisIndicator` per deployment — needs a
  factory per deployment and a key argument at every call site, which is where a swapped key would
  come from.
- **Indicators catch internally, and the catch is the security control.** `@nestjs/terminus`'s
  executor re-throws anything an indicator rejects into a 500 — so catching is required for the 503 —
  and a `MongoServerSelectionError` carries the seed address and the resolved member list while an
  ioredis `ReplyError` carries the host it failed against. Both are dropped; the operator gets the key
  ("which deployment") and not the location ("where it is").
- **`PING` must answer `PONG`, not merely succeed.** A stale connection reused across a failover, or
  a proxy in front of Redis, answers on the socket. Treating any reply as healthy would report a
  deployment as up when it is not.
- **`serverSelectionTimeoutMS` is 3 s, not the 30 s default.** A readiness probe that hangs for 30 s is
  usually outlived by the orchestrator's own probe timeout, so the process is reported *unresponsive*
  instead of *not ready* — losing the one thing the per-dependency design exists to give an operator.
- **The two Redis clients are given their names at construction, and the readiness key defaults to
  the constructor's name.** The `check(key)` parameter still exists for a caller that must
  disambiguate a second entry, but nothing in the shipped path uses it.

## FND-05 status — **still Pending, and the gap is exactly this**

FND-05 as written is "`api`, `worker`, and `scheduler` **each expose** `/health/live` and
`/health/ready`". Delivered by this plan:

- the `HealthController` itself, with both endpoints, proven over real HTTP;
- the three dependency indicators and the no-leak guarantee;
- the three-container proof that the two Redis deployments exist as two servers.

**Not delivered, and why:**

1. **`apps/api` does not mount it.** `apps/api/src/app.module.ts` still registers plan 01's
   `apps/api/src/health/health.controller.ts`, which has `/health/live` and no `/health/ready`. No
   `apps/**` file is in this plan's `files_modified`, and replacing a working tracer is plan 10's edit.
2. **`apps/worker` and `apps/scheduler` serve no HTTP at all.** Both `main.ts` files are shells that
   print `NOT_IMPLEMENTED` and set `process.exitCode = 1`. D-09 requires all three to use
   `NestFactory.create()` and to mount only `HealthController` and `MetricsController` — that is
   plan 10, and `MetricsController` does not exist yet (plan 09).
3. **The per-process indicators are absent**, by design: `worker`'s "every registered BullMQ `Worker`
   is listening" (plan 08) and `scheduler`'s "at least one Job Scheduler is running" (plan 10). The
   `EXTRA_HEALTH_INDICATORS` token they will use is built and tested here.

**Do not check FND-05 in `REQUIREMENTS.md` on the strength of this summary.** A verifier that wants
to close it needs three running processes, each answering both endpoints on its own configurable
port (D-09: api 3000, worker 3001, scheduler 3002).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `MongoDBContainer`'s connection string needs `directConnection=true`**
- **Found during:** Task 1 (GREEN)
- **Issue:** `MongoDBContainer` starts MongoDB with `--replSet rs0`, so the server advertises itself
  as a replica-set member using its **container hostname** (`911148e5986d:27017`). The driver
  performs topology discovery, believes the advertisement, and tries to reach that address from the
  host, where it is an unresolvable name. Every `ping()` failed with
  `MongoServerSelectionError: getaddrinfo EAI_AGAIN …` against a perfectly healthy server.
  `getConnectionString()` does not add the parameter.
- **Fix:** `mongoUrl()` rewrites the container's connection string with
  `searchParams.set('directConnection', 'true')`, which is the correct mode for a single node reached
  through a published port.
- **Files modified:** `tooling/containers.ts`
- **Verification:** `mongo.service.spec.ts` 3/3 pass; live probe printed
  `MONGO url=mongodb://localhost:33144?directConnection=true` and `ping()` resolved.
- **Committed in:** `29436b3`

**2. [Rule 3 - Blocking] `executeCliCmd` needs the command and its arguments as separate argv entries**
- **Found during:** Task 3
- **Issue:** `executeCliCmd('CONFIG GET maxmemory-policy')` builds one argument —
  `redis-cli "CONFIG GET maxmemory-policy"` — which the server answers with
  `ERR unknown command 'CONFIG GET maxmemory-policy'`. **`redis-cli` still exits 0**, so the failure
  is invisible to a caller that only checks the exit code; it surfaced as a healthy instance reported
  as unreadable.
- **Fix:** `readMaxMemoryPolicy` calls `executeCliCmd('CONFIG', ['GET', 'maxmemory-policy'])` and
  matches the returned policy against a known vocabulary instead of indexing lines, so a future
  change to `CONFIG GET`'s output shape fails loudly rather than reading the *key* as the value.
- **Files modified:** `tooling/containers.ts`
- **Verification:** `redis.integration.spec.ts` 5/5 pass; live probe printed both policies.
- **Committed in:** `646087c`

**3. [Rule 3 - Blocking] `@nestjs/terminus` indicator entries are functions, not promises**
- **Found during:** Task 2 (GREEN)
- **Issue:** `HealthCheckExecutor` evaluates each entry as
  `h instanceof HealthCheckAttempt ? h : h()`, so passing the promise returned by `check()` is a
  `TypeError: h is not a function` on **every** request — including the all-dependencies-up path,
  which is why the first green run read as "500 everywhere" rather than "500 only when something is
  down". Separately, `HealthIndicatorService` had to be imported as a value rather than
  `import type`, or `emitDecoratorMetadata` emits `Object` and the controller cannot be constructed.
- **Fix:** entries are `() => this.#mongo.check(...)`; `HealthIndicatorService` is a value import.
- **Files modified:** `packages/platform/src/health/health.controller.ts`
- **Verification:** `health.controller.spec.ts` + `health.indicators.spec.ts` 14/14 pass;
  `npm run build` clean.
- **Committed in:** `ee38ae8`

**4. [Rule 3 - Blocking] `tooling/` needed to become a TypeScript project**
- **Found during:** Task 1
- **Issue:** `tooling/containers.ts` is a named artifact but no `tsconfig` covered `tooling/`, so a
  type error in it would not fail `npm run build` — only Vitest's esbuild transpile would run it. A
  cross-project relative import also fails with `TS6059`/`TS6307` while `packages/platform` has
  `rootDir: ./src`.
- **Fix:** added `tooling/tsconfig.json` (composite, `rootDir: "."`, `include: ["containers.ts"]` —
  deliberately excluding `tooling/boundaries-fixtures/**`, which violate boundaries by design) and
  referenced it from `tsconfig.json` and `packages/platform/tsconfig.json`.
- **Files modified:** `tooling/tsconfig.json`, `tsconfig.json`, `packages/platform/tsconfig.json`
- **Verification:** `npx tsc -b` exits 0; a deliberate type error in `containers.ts` is now caught
  (verified by construction — the project is referenced by the solution).
- **Committed in:** `d0d27b1`

**5. [Rule 3 - Blocking] Installed the five STACK.md §14 pins the plan's threat register names**
- **Found during:** Task 1
- **Issue:** `mongodb`, `@nestjs/terminus`, `testcontainers`, `@testcontainers/mongodb` and
  `@testcontainers/redis` were absent from every manifest. T-1-SC names all five explicitly and
  requires no unpinned install; `package.json` is not in the plan's `files_modified`.
- **Fix:** `npm install --save-dev --save-exact` at the exact §14 versions (verified against
  `registry.npmjs.org` before installing: all five resolve to the stated version). Root
  `devDependencies` matches how 01-02 (`ioredis`) and 01-04 (`pino`) were added. **Caveat carried
  forward:** `mongodb` and `ioredis` are imported by runtime code (`dist/`) but live in
  `devDependencies`, so `npm ci --omit=dev` would produce a tree that cannot boot. That is a
  pre-existing repo-wide model, not introduced here, and changing it is out of this plan's scope.
- **Files modified:** `package.json`, `package-lock.json`
- **Verification:** `npm run build` clean; full suite green.
- **Committed in:** `d0d27b1`

**6. [Rule 1 - Bug] Explicit `afterAll` timeouts on the container specs**
- **Found during:** Task 3 (full-suite run)
- **Issue:** `vitest.config.mts` sets `hookTimeout: 30000`. Stopping three containers — one of them a
  MongoDB replica set — can exceed it. The first full-suite run reported
  `Test Files 1 failed | 23 passed (24)` with `Tests 193 passed (193)` and
  `Error: Hook timed out in 30000ms`: a **file-level failure with every assertion passing**, which
  trains a reader to ignore the failure line.
- **Fix:** explicit `300_000` timeouts on both container specs' `afterAll`, matching the ones already
  on their `beforeAll`.
- **Files modified:** `packages/platform/src/mongo/mongo.service.spec.ts`,
  `packages/platform/src/redis/redis.integration.spec.ts`
- **Verification:** `npm test` → 24 files / 193 tests, exit 0.
- **Committed in:** `8379909`

**7. [Rule 2 - Missing Critical] Declared `EXTRA_HEALTH_INDICATORS` in the controller test's base providers**
- **Found during:** Task 2 (GREEN)
- **Issue:** `TestingModuleBuilder.overrideProvider()` rewrites an *existing* definition and is a
  **silent no-op** on an unknown token. The extension-point test therefore passed an
  `EXTRA_HEALTH_INDICATORS` provider that never reached the controller — and the test failed only
  because the assertion was honest. Left as-is it would have been a test that can never pass for the
  right reason, or (had the assertion been looser) one that passes vacuously.
- **Fix:** the base module declares `{ provide: EXTRA_HEALTH_INDICATORS, useValue: [] }`, which the
  builder then overrides. `@Optional()` alone is not sufficient for `overrideProvider` to have
  anything to override.
- **Files modified:** `packages/platform/src/health/health.controller.spec.ts`
- **Verification:** `health.controller.spec.ts` 7/7 pass, including the extra-indicator test.
- **Committed in:** `ee38ae8`

**8. [Rule 3 - Blocking] Planning state updated by hand — the `gsd-tools` / `gsd_run` CLI is not on PATH**
- **Found during:** end-of-plan state updates
- **Issue:** The executor protocol routes `state.advance-plan`, `state.update-progress`,
  `state.record-metric`, `state.add-decision`, `state.record-session`,
  `roadmap.update-plan-progress` and `windows append` through `gsd_run` / `gsd-tools query`. Neither
  binary exists in this environment; the installed GSD is `gsd-cli` (v1.20.1, the `gsd-pi` build),
  whose subcommand set is `config / install / list / update / upgrade / sessions / worktree / auto /
  quick / headless / graph / hermes` — no `query` verb and no `check tdd-red-evidence`.
- **Fix:** `STATE.md`, `ROADMAP.md` and `WINDOWS.md` were edited directly, applying the same
  semantics: plan counter, recalculated progress bar, per-plan metrics row, twelve accumulated-context
  decisions, two pending todos, session continuity, the `[x]` plan checkbox, the progress table
  (which was stale at 4/10 and is now 7/10), and two new `WINDOWS.md` entries. The `WINDOWS.md` JSON
  block was re-parsed after editing to confirm it is still valid and that the table row count, the
  JSON entry count, and `open_count`/`total_count` all agree at 9.
- **Files modified:** `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/WINDOWS.md`
- **Verification:** `json.loads` on the embedded ledger succeeds with ids `[1..9]`; `git diff` on the
  three files shows only the intended lines.
- **Committed in:** the plan metadata commit.
- **Side effect:** the **TDD RED evidence gate could not be run** (`gsd_run check tdd-red-evidence`).
  The RED records are reproduced verbatim in the "TDD: RED → GREEN" section above — command, exit
  code, test counts, and the two assertion messages — so a reviewer can re-run both RED commands
  against the RED commits (`d0d27b1`, `88def4f`) to confirm. The INVALID_RED first attempt and its
  correction are recorded there too, because that is the fact the gate would have caught.

---

**Total deviations:** 8 auto-fixed (4 × Rule 3 blocking, 2 × Rule 1 bug, 1 × Rule 2 missing critical, 1 × Rule 3 tooling gap)
**Impact on plan:** Every one was a prerequisite for the planned work rather than scope creep. 1, 2
and 3 are corrections to library behaviour the plan's prose could not have anticipated; 4, 5 and 6 are
compile/install/teardown prerequisites; 7 removes a vacuous-pass hazard from the plan's own test
instruction; 8 is an environment gap in the executor tooling, not in the deliverable.
**No threat mitigation was weakened.** No boundary rule, allowlist, or pin was relaxed
to make a file pass — `npm run lint` (boundaries + `no-restricted-imports`) is clean, and the plan-03
fixture spec that proves R2/R3 actually fire is still green.

## `WINDOWS.md` ledger

Two new **open** entries, and one correction to an existing one:

- **Entry 2 corrected** (it read "completed in plan 07", naming this plan as the owner of
  `apps/worker`'s consumer). 01-07 is the health plan; the consumer is plan 08 and the HTTP bootstrap
  is plan 10. Left uncorrected, the ledger would have told a future reader that this plan owed
  `apps/worker` a BullMQ consumer.
- **Entry 8 (`unmet-truth`)** — `mongodb` and `ioredis` are imported by runtime code but live in root
  `devDependencies`, so `npm ci --omit=dev` yields a tree that cannot boot. Pre-existing, recorded.
- **Entry 9 (`deviation`)** — FND-05 is not complete; plan 10 owns mounting the controller.
- **Entry 1 left alone** — it records `packages/contract/src/index.ts` as an "intentional `export {}`
  skeleton barrel", which 01-06 superseded by re-exporting the full surface. That entry is 01-06's to
  close; this plan did not touch the contract barrel.

## Issues Encountered

- **INVALID_RED on the first Task 1 attempt.** The skeleton constructor threw, so Vitest reported a
  failed *suite* with 3 skipped tests rather than a failing assertion. The skeleton was changed to
  construct successfully and fail inside `ping()`, and the "container stopped" assertion was tightened
  to require a *server-selection or connection-refused* error rather than any throw — a `ping()` that
  failed for an unrelated reason (a closed client, a bug) also rejects, and the readiness indicator
  would then report a healthy MongoDB as down for the wrong reason.
- **Test ordering is load-bearing in `mongo.service.spec.ts`.** The three tests share one container
  set and the last one tears MongoDB down, so it must stay last in declaration order. The file
  says so at the top. Moving it up would cascade the failure into the tests above it for the wrong
  reason.
- **`npm test` takes ~5 min**, almost all of it container startup: MongoDBContainer runs a
  replica-set `rs.initiate()` on a 5 s health-check interval, and three specs start their own
  harness. Vitest reports that `isolate: false` would save ~16 s by sharing module transforms across
  workers. Not changed here — it trades test isolation for 5% of a suite that is dominated by Docker,
  and the decision belongs with the phase's later plans, not a foundation plan.
- **`apps/worker/src/main.ts` carries a stale plan number.** Its docblock says "the consumer lands in
  plan 07". It does not: this plan is the health plan; the BullMQ consumer is plan 08. The file also
  says "Completed in plan 10" in `apps/scheduler/src/main.ts`, so the numbering in these two shells
  is inconsistent. **Not edited** — plan 10 rewrites both files, and a doc-only edit here would be
  overwritten. Recorded so plan 10 does not read the comment as a completed commitment.

## Threat Model Coverage

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-1-17 (DoS — liveness must not restart a healthy pod) | mitigate | **Implemented.** `/health/live` returns a fixed literal and constructs nothing; a test counts `mongo.ping` and both Redis `ping` calls at **zero** across two requests while all three dependencies reject. Readiness returns 503 naming the failing key, so a blip withdraws traffic instead of cascading into restarts. |
| T-1-18 (Information Disclosure — the readiness body is unauthenticated) | mitigate | **Implemented.** Both indicators catch and return a bare `down`; no `error.message`, `options`, or `hosts` reaches the result. Asserted at unit level (per indicator) and over real HTTP (all three down, 503 body checked for `mongodb://`, `redis://`, `:password@`, the seeded secret, and both hostnames). |
| T-1-SC (no unpinned install) | mitigate | **Implemented.** All five additions are `--save-exact` at the STACK.md §14 versions, each verified against the registry before install. No package outside the ledger was added. |

**Prohibitions from the plan, both satisfied:**

- *"MUST NOT provide one aggregate readiness check that cannot name which dependency failed, and MUST
  NOT let liveness read any dependency"* — the response's `error` object is asserted to equal exactly
  `['redis_queue']` when only the queue is down, and liveness's zero-construction test is above.
- *"MUST NOT report a connection string, credential, or URL in any health response body"* — see
  T-1-18. **Proven by test, not by inspection.**

## Known Stubs

None. The skeleton files written for RED were all replaced by real implementations in the same plan;
no `TODO`, no placeholder text, no skipped test, no unwired component remains in the files this plan
created. `MongoService.defaultDb` and the `check(key)` override on both indicators are optional
affordances with real callers behind them (the container URL's database name, and plan 08/10's
per-process keys), not dead code.

## User Setup Required

None. Docker must be reachable for the integration suite — `docker info` must exit 0 — which is
RESEARCH B-5's Wave-0 precondition and is the plan's declared `<precondition>`. Without a daemon the
three D-07 integration tests cannot run; everything else in the suite is unaffected.

## Next Phase Readiness

- **Ready for plan 08 (BullMQ).** `BULLMQ_PREFIX = "{akane-q}"` (01-02) and
  `buildRedisOptions('blocking')` are now exercised against a real Redis: the blocking client's
  `maxRetriesPerRequest: null` and the absence of `keyPrefix` are asserted on the pure factory
  against live servers. The `{akane-q}` key-slot assertion is still plan 08's (A7), as planned.
- **Ready for plan 09 (OTel/metrics).** `MetricsController` does not exist yet; D-09 requires all
  three entrypoints to mount it alongside `HealthController`, so plan 10 is blocked on it.
- **Ready for plan 10 (entrypoints).** `HealthController` is mountable in all three apps. Wire
  `TerminusModule.forRoot()`, `MongoModule`, and the two Redis providers into each composition root;
  register worker/scheduler extras under `EXTRA_HEALTH_INDICATORS`; call
  `app.enableShutdownHooks()` so `MongoService.onModuleDestroy()` actually runs.
- **Two hand-offs, both additive:**
  1. `packages/platform/package.json`'s `exports` map declares only `"."` and `"./crypto"`, so
     `@akane/platform/health` and `@akane/platform/mongo` do **not** resolve cross-package. The
     barrels exist so plan 10 does not have to edit the root barrel; the first plan that needs the
     deep specifier adds the entry. This is the **third** occurrence of this exact hand-off (01-04
     `./logging`, 01-05 `./crypto`) — worth resolving once, deliberately, rather than a fourth time.
  2. `redis.cache` / `redis.queue` are not wrapped in a class yet. `REDIS_CACHE` and `REDIS_QUEUE`
     inject a raw ioredis client, which is what `RedisIndicator` needs and nothing more; a phase that
     wants namespacing or typed commands should introduce a wrapper without changing the tokens.
- **Not done, and it must not be assumed:** FND-05 stays open. See "FND-05 status" above.

## Self-Check: PASSED

- **Created files** (13/13 verified present on disk): this SUMMARY, `tooling/containers.ts`,
  `tooling/tsconfig.json`, `mongo/{mongo.service,mongo.module,index,mongo.service.spec}.ts`,
  `health/{mongo.indicator,redis.indicator,health.controller,index,health.controller.spec,health.indicators.spec}.ts`,
  `redis/redis.integration.spec.ts`.
- **Commits** (6/6 verified in `git log`): `d0d27b1`, `29436b3`, `88def4f`, `ee38ae8`, `646087c`,
  `8379909`.
- **Measured commit count** — `git rev-list --count 41fb141..HEAD` = **6** for the task commits
  (plus this metadata commit = 7 total), matching `commits: 6` / `plan_head_before` /
  `plan_head_after` in the frontmatter, which are the **task** boundaries. Nothing is left
  uncommitted: the only working-tree entries are pre-existing and out of scope
  (`.planning/config.json`, `.gsd/`, `.planning/milestone.lock`, `.planning/state.json`).
- **Verification re-run after the last commit:** `npm run build` (lint + `tsc -b`) exits 0;
  `npm test` reports 24 files / 193 tests passed.
- **Plan `<automated>` commands, all green:**
  - `npm test -- packages/platform/src/mongo/mongo.service.spec.ts` → 3/3
  - `npm test -- packages/platform/src/health/health.controller.spec.ts packages/platform/src/health/health.indicators.spec.ts` → 14/14
  - `npm test -- packages/platform/src/redis/redis.integration.spec.ts` → 5/5
- **Acceptance criteria checked by command, not by inspection:**
  - No `mongoose` import anywhere in `packages/`, `apps/`, `tooling/` → `NONE`.
  - The `mongodb` driver is imported in exactly one source file,
    `packages/platform/src/mongo/mongo.service.ts` (plus its compiled `.d.ts` in `dist/`, and the
    deliberately-violating strings inside `tooling/boundaries.fixture.spec.ts` which are the R3
    fixture, not imports).
  - Threat mitigations T-1-17, T-1-18 and T-1-SC are asserted by named tests, listed above.
- **Stub scan** over every file this plan created: no `TODO`, `FIXME`, `XXX`, `coming soon`,
  `placeholder`, or `not implemented` survives. The RED skeletons are gone.

---
*Phase: 01-foundations-platform*
*Completed: 2026-10-02*
