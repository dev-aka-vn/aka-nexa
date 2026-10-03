---
phase: 01-foundations-platform
reviewed: 2026-10-03T00:00:00Z
depth: standard
files_reviewed: 132
files_reviewed_list:
  - .github/workflows/ci.yml
  - .nvmrc
  - apps/api/otel.mjs
  - apps/api/package.json
  - apps/api/src/app.module.ts
  - apps/api/src/bootstrap/boundary-manifest.ts
  - apps/api/src/main.ts
  - apps/api/tsconfig.json
  - apps/scheduler/otel.mjs
  - apps/scheduler/package.json
  - apps/scheduler/src/app.module.ts
  - apps/scheduler/src/bootstrap/boundary-manifest.ts
  - apps/scheduler/src/main.ts
  - apps/scheduler/tsconfig.json
  - apps/worker/otel.mjs
  - apps/worker/package.json
  - apps/worker/src/app.module.ts
  - apps/worker/src/bootstrap/boundary-manifest.ts
  - apps/worker/src/main.ts
  - apps/worker/src/processors/platform-heartbeat.processor.spec.ts
  - apps/worker/src/processors/platform-heartbeat.processor.ts
  - apps/worker/tsconfig.json
  - eslint.config.mjs
  - package.json
  - packages/contract/package.json
  - packages/contract/src/connector/connector.spec.ts
  - packages/contract/src/connector/connector.ts
  - packages/contract/src/events/events.spec.ts
  - packages/contract/src/events/inbound-event.ts
  - packages/contract/src/events/outbound-message.ts
  - packages/contract/src/index.ts
  - packages/contract/src/jev/jev-provider.spec.ts
  - packages/contract/src/jev/jev-provider.ts
  - packages/contract/src/jev/jev-v1.frozen.spec.ts
  - packages/contract/src/jev/v1/index.ts
  - packages/contract/src/jev/v1/jev-request.ts
  - packages/contract/src/jev/v1/jev-response.ts
  - packages/contract/src/links/rate-limit-key.spec.ts
  - packages/contract/src/links/rate-limit-key.ts
  - packages/contract/src/links/read-link-claims.frozen.spec.ts
  - packages/contract/src/links/read-link-claims.ts
  - packages/contract/src/links/token-classes.ts
  - packages/contract/tsconfig.json
  - packages/domain/package.json
  - packages/domain/src/index.ts
  - packages/domain/tsconfig.json
  - packages/kernel/package.json
  - packages/kernel/src/index.ts
  - packages/kernel/tsconfig.json
  - packages/platform/package.json
  - packages/platform/src/bootstrap/boundary-manifest.ts
  - packages/platform/src/bootstrap/process-capabilities.ts
  - packages/platform/src/bootstrap/provider-boundary.guard.spec.ts
  - packages/platform/src/bootstrap/provider-boundary.guard.ts
  - packages/platform/src/bootstrap/provider-boundary.runner.ts
  - packages/platform/src/config/config.module.spec.ts
  - packages/platform/src/config/config.module.ts
  - packages/platform/src/config/config.schema.spec.ts
  - packages/platform/src/config/config.schema.ts
  - packages/platform/src/config/redis.schema.spec.ts
  - packages/platform/src/config/redis.schema.ts
  - packages/platform/src/crypto/crypto.module.ts
  - packages/platform/src/crypto/envelope.spec.ts
  - packages/platform/src/crypto/envelope.ts
  - packages/platform/src/crypto/index.ts
  - packages/platform/src/crypto/key-provider.contract.spec.ts
  - packages/platform/src/crypto/key-provider.ts
  - packages/platform/src/crypto/local-key-provider.spec.ts
  - packages/platform/src/crypto/local-key-provider.ts
  - packages/platform/src/crypto/production-guard.spec.ts
  - packages/platform/src/crypto/production-guard.ts
  - packages/platform/src/health/health.controller.spec.ts
  - packages/platform/src/health/health.controller.ts
  - packages/platform/src/health/health.indicators.spec.ts
  - packages/platform/src/health/index.ts
  - packages/platform/src/health/mongo.indicator.ts
  - packages/platform/src/health/redis.indicator.ts
  - packages/platform/src/index.ts
  - packages/platform/src/logging/error-codes.ts
  - packages/platform/src/logging/index.ts
  - packages/platform/src/logging/log-allowlist.formatter.spec.ts
  - packages/platform/src/logging/log-allowlist.formatter.ts
  - packages/platform/src/logging/log-allowlist.ts
  - packages/platform/src/logging/logger.port.spec.ts
  - packages/platform/src/logging/logger.port.ts
  - packages/platform/src/logging/pino.config.spec.ts
  - packages/platform/src/logging/pino.config.ts
  - packages/platform/src/metrics/business-metrics.spec.ts
  - packages/platform/src/metrics/business-metrics.ts
  - packages/platform/src/metrics/index.ts
  - packages/platform/src/metrics/metrics.controller.spec.ts
  - packages/platform/src/metrics/metrics.controller.ts
  - packages/platform/src/metrics/metrics.module.ts
  - packages/platform/src/mongo/index.ts
  - packages/platform/src/mongo/mongo.module.ts
  - packages/platform/src/mongo/mongo.service.spec.ts
  - packages/platform/src/mongo/mongo.service.ts
  - packages/platform/src/otel/allowlist-span-exporter.spec.ts
  - packages/platform/src/otel/allowlist-span-exporter.ts
  - packages/platform/src/otel/index.ts
  - packages/platform/src/otel/otel.bootstrap.node-ordering.spec.ts
  - packages/platform/src/otel/otel.bootstrap.ordering.spec.ts
  - packages/platform/src/otel/otel.bootstrap.spec.ts
  - packages/platform/src/otel/otel.bootstrap.ts
  - packages/platform/src/otel/otel.constants.ts
  - packages/platform/src/otel/span-attribute-allowlist.spec.ts
  - packages/platform/src/otel/span-attribute-allowlist.ts
  - packages/platform/src/queue/index.ts
  - packages/platform/src/queue/job-scheduler.ts
  - packages/platform/src/queue/platform-heartbeat.job.ts
  - packages/platform/src/queue/queue-indicators.ts
  - packages/platform/src/queue/queue.constants.ts
  - packages/platform/src/queue/queue.integration.spec.ts
  - packages/platform/src/queue/queue.module.ts
  - packages/platform/src/queue/queue.provider.ts
  - packages/platform/src/queue/queue.spec.ts
  - packages/platform/src/redis/redis.constants.ts
  - packages/platform/src/redis/redis.integration.spec.ts
  - packages/platform/src/redis/redis.provider.spec.ts
  - packages/platform/src/redis/redis.provider.ts
  - packages/platform/tsconfig.json
  - test/setup-env.ts
  - tooling/boundaries.config.mjs
  - tooling/boundaries.fixture.spec.ts
  - tooling/containers.ts
  - tooling/deployment-shape.spec.ts
  - tooling/entrypoint-drift.spec.ts
  - tooling/import-resolver.cjs
  - tooling/tsconfig.base.json
  - tooling/tsconfig.json
  - tsconfig.json
  - vitest.config.mts
findings:
  critical: 2
  warning: 12
  info: 9
  total: 23
status: issues_found
---

# Phase 01: Foundations & Platform — Code Review Report

**Reviewed:** 2026-10-03
**Depth:** standard
**Files Reviewed:** 132
**Status:** issues_found

## Summary

This is a very high-quality phase. The load-bearing security controls (log field allowlist, span attribute allowlist, envelope encryption with auth-tag verification, the boundary lint gate with a genuinely exercised fixture suite, the provider-boundary boot guard) are all real, measured, and unusually well-documented. Several of them go beyond "assert it works" to "assert the counterfactual, so the test cannot pass vacuously" — the `checkAllOrigins` backstop, the `wrapper.isResolved` correction, the `otel.bootstrap.node-ordering.spec.ts` child-process probe, and the R2/R3 `noneOf`-selector inertness proof are exemplary.

The boundary fixture set was reviewed only for genuine rule coverage, as instructed. All nine `BOUNDARY_FILE_CATEGORIES` have a real on-disk fixture target, all five R1 disallow policies and all three R2/R3 external-module policies are exercised, the negation grammar and last-match-wins ordering are both pinned, and the app-leaf prohibition is covered. The deliberate cross-boundary imports are correctly excluded from the real gate via `eslint.config.mjs:49`.

Two findings are BLOCKERs and both are in the same family the phase is otherwise careful about: **a security guard whose trigger is an optional environment variable with a permissive default (CR-01)**, and **a documented graceful-drain contract that the shutdown hooks do not actually deliver (CR-02)**. Neither is exotic; both are the exact defect shape WINDOWS.md #8 and D-09 were written to prevent, and both are silent.

The twelve warnings are mostly *enforcement gaps between what the comments claim and what is enforced* — an unenforced kernel-imports-nothing rule, an exported schema with a self-documented trap, three `.mjs` loader entries that escape all three R1 controls, and one assertion in the drift test that can never fail. None is exploitable today; all are the kind of thing that becomes exploitable on the next phase, which is precisely the phase this foundation is meant to survive.

## Critical Issues

### CR-01: The production-KMS guard is disabled by *omitting* `NODE_ENV`, which is optional with a permissive default

**File:** `packages/platform/src/config/config.schema.ts:52`, `packages/platform/src/crypto/crypto.module.ts:129-131`, `packages/platform/src/crypto/production-guard.ts:44`, `packages/platform/src/crypto/local-key-provider.ts:87`
**Classification:** BLOCKER

**Issue:**
`assertKeyProviderAllowed` fires on exactly one condition — `NODE_ENV === 'production'` (`production-guard.ts:44`) — and `LocalKeyProvider`'s constructor backstop fires on exactly the same condition (`local-key-provider.ts:87`). Both derive `NODE_ENV` from a value that **defaults to `'development'` when absent**:

- `config.schema.ts:52` — `NODE_ENV: z.enum([...]).default('development')`
- `crypto.module.ts:129-131` — `NODE_ENV: env['NODE_ENV'] ?? 'development'`, `CRYPTO_KEY_PROVIDER: env['CRYPTO_KEY_PROVIDER'] ?? 'local'`

So a production container that omits `NODE_ENV` gets a `LocalKeyProvider` reading a plaintext key file off local disk, with no warning, no refusal, and no log line.

Worse, the guard is currently *unreachable in the only direction it allows*: selecting `CRYPTO_KEY_PROVIDER=kms` throws `KMS_PROVIDER_BLOCKED` in every environment (`crypto.module.ts:91-95`, asserted at `production-guard.spec.ts:94-100`). That leaves exactly two reachable production states:

| deployment sets | result |
|---|---|
| `NODE_ENV=production` (+ anything) | boot fails — `CRYPTO_KEY_PROVIDER_REQUIRED` or `KMS_PROVIDER_BLOCKED` |
| `NODE_ENV` unset / `development` / `test` | boots on a local key file, **no refusal** |

There is no third state. A platform whose stated security control cannot distinguish "production that forgot to declare itself" from "a developer laptop" is a control that fails open on the most common deployment mistake an orchestrator makes. This directly contradicts NFR-SEC-3 and the D-27 rationale that the refusal must be "loud at the KMS boundary rather than a quiet fall back to the local key".

**Fix:**
Make the refusal depend on an explicit opt-in for the local key rather than on the absence of a production marker, so the default-closed direction is the safe one.

```ts
// config.schema.ts — require the environment to be declared, do not assume it
NODE_ENV: z.enum(['development', 'test', 'production']),

// production-guard.ts — refuse unless the local key is explicitly opted into
export function assertKeyProviderAllowed(config: KeyProviderGuardConfig): void {
  const isLocal = config.CRYPTO_KEY_PROVIDER === 'local';
  const optedIn = config.CRYPTO_LOCAL_KEY_ALLOWED === 'true';
  if (isLocal && config.NODE_ENV !== 'development' && config.NODE_ENV !== 'test' && !optedIn) {
    throw new Error('CRYPTO_KEY_PROVIDER_REQUIRED: ...');
  }
}
```

Apply the same rule to `local-key-provider.ts:87` (constructor backstop) and add a `deployment-shape.spec.ts` assertion that the production profile sets `NODE_ENV` explicitly.

---

### CR-02: Neither Redis connection is ever closed — `enableShutdownHooks()` delivers no drain for two of the three declared dependencies

**File:** `packages/platform/src/redis/redis.provider.ts:47-79`
**Classification:** BLOCKER

**Issue:**
`createRedisClient` returns a bare `IORedis` instance from a `useFactory`, and **nothing in the repository ever closes it**. Confirmed by exhaustive grep across `apps/`, `packages/`, `tooling/`: the only `onModuleDestroy` in production source is `MongoService.onModuleDestroy` (`mongo.service.ts:141`); the only `.quit()` / `.disconnect()` calls are inside test `afterAll`/cleanup helpers.

All three composition roots register both providers (`apps/api/src/app.module.ts:50-51`, `apps/worker/src/app.module.ts:60-61`, `apps/scheduler/src/app.module.ts:63-64`) and all three call `app.enableShutdownHooks()` (`apps/*/src/main.ts:44`). The shutdown contract those hooks exist to serve is stated explicitly at `mongo.service.ts:136-140`:

> *"a zero-downtime rolling deploy should drain connections, not have them severed"*

That sentence is true for MongoDB and false for both Redis deployments. On SIGTERM the cache and queue sockets are destroyed rather than `QUIT`-ed: `REDIS_CACHE` carries rate-limit counters and (from Phase 3) the `GETDEL` one-time-token namespace, and `REDIS_QUEUE` carries in-flight producer commands. The failure is silent — nothing logs, nothing errors, and the process exits "successfully".

**Fix:**
Give the clients an owner with a shutdown hook, mirroring `MongoService`. Either wrap them:

```ts
export class RedisService implements OnModuleDestroy {
  constructor(private readonly client: IORedis) {}
  onModuleDestroy(): Promise<void> { return this.client.quit(); }
}
```

or register a dedicated provider that closes both under one hook:

```ts
export const redisShutdownProvider: Provider = {
  provide: APP_SHUTDOWN,
  inject: [REDIS_CACHE, REDIS_QUEUE],
  useFactory: (cache: IORedis, queue: IORedis) => ({
    onModuleDestroy: async () => {
      await Promise.allSettled([cache.quit(), queue.quit()]);
    },
  }),
};
```

Either way, add a test asserting `quit()` is called on `app.close()` — the absence of one is why this survived.

## Warnings

### WR-01: `entrypoint-drift.spec.ts`'s `QUEUE_PRODUCER_TOKEN` assertion can never fail

**File:** `tooling/entrypoint-drift.spec.ts:626-632`
**Issue:** `QUEUE_PRODUCER_TOKEN = getQueueToken('platform-heartbeat')`, which resolves to the **string** `'BullQueue_platform-heartbeat'` (verified in `node_modules/@nestjs/bull-shared/dist/utils/get-queue-token.util.js`: ``return name ? `BullQueue_${name}` : 'BullQueue_default'``). The assertion is:

```ts
expect(appModuleBindings('api'), 'api must not bind any BullMQ queue token')
  .not.toContain(QUEUE_PRODUCER_TOKEN);
```

`appModuleBindings` returns `parseBindings()` output, which is filtered by `/^[A-Za-z_$][\w$]*$/` (line 148). A hyphen can never match that pattern, so the string can never appear in the list. **This assertion is vacuously true for every possible implementation.**

This is the exact failure class the file's own header (lines 6-15) and `production-guard.spec.ts:151-155` name: *"a guard that cannot fail is indistinguishable from a guard that passes."* It matters because `apps/api/src/bootstrap/boundary-manifest.ts:22` calls this *"the one that is currently violable"*, and `entrypoint-drift.spec.ts` is described as the fast CI-time gate — but the runtime `API_BOUNDARY_MANIFEST` check is the only half that actually fires.

**Fix:** assert on a binding name, which is what `appModuleBindings` can see:

```ts
expect(appModuleBindings('api'), 'api must not register the heartbeat queue')
  .not.toContain('QueueModule');
// and pin the token's shape so a rename is visible:
expect(typeof QUEUE_PRODUCER_TOKEN).toBe('string');
expect(QUEUE_PRODUCER_TOKEN).toBe(`BullQueue_${PLATFORM_HEARTBEAT_QUEUE}`);
```

---

### WR-02: The `.mjs` OTel loader entries escape all three R1 controls

**File:** `eslint.config.mjs:54, 71`; `apps/api/otel.mjs`, `apps/worker/otel.mjs`, `apps/scheduler/otel.mjs`
**Issue:** `platform-heartbeat.processor.ts:21-26` names exactly three controls that confine `Worker` construction to `apps/worker`: `no-restricted-imports`, `API_BOUNDARY_MANIFEST`/`SCHEDULER_BOUNDARY_MANIFEST`, and `tooling/entrypoint-drift.spec.ts`. All three miss the loader entries:

- `eslint.config.mjs:54` scopes the boundary rule to `['**/*.ts', '**/*.mts', '**/*.cts']` — `.mjs` is not linted.
- `eslint.config.mjs:71` scopes R1's named-binding rule to `apps/api/src/**/*.ts` and `apps/scheduler/src/**/*.ts` — `apps/api/otel.mjs` is outside `src/`.
- `entrypoint-drift.spec.ts:305` builds each closure from `apps/<app>/src/main.ts`, and `appSourceFiles` (line 289) walks only `apps/<app>/src` — `otel.mjs` is never visited.

`otel.mjs` runs **before** any application module in the process (that is its whole purpose), so a `Worker` constructed there would also precede `ProviderBoundaryGuardRunner.onApplicationBootstrap` — meaning `WORKER_CONSUMERS` would not be populated and the manifest could not catch it either. `import { Worker } from 'bullmq'` in `apps/api/otel.mjs` would pass every control the phase believes it has.

**Fix:** add `.mjs` to the `no-restricted-imports` glob and have `entrypoint-drift.spec.ts` scan the loader entries for forbidden specifiers:

```js
files: ['apps/api/otel.mjs', 'apps/api/src/**/*.ts', 'apps/scheduler/otel.mjs', 'apps/scheduler/src/**/*.ts'],
```

and add a case asserting the three `otel.mjs` files contain no `bullmq` import.

---

### WR-03: Every `tsconfig.json` compiles spec files into `dist/` — 33 shipped test modules

**File:** `apps/api/tsconfig.json:8`, `apps/worker/tsconfig.json:8`, `apps/scheduler/tsconfig.json:8`, `packages/contract/tsconfig.json:8`, `packages/domain/tsconfig.json:8`, `packages/kernel/tsconfig.json:8`, `packages/platform/tsconfig.json:8-10`
**Issue:** `"include": ["src/**/*.ts"]` (or `["src/**/*.ts"]` in `packages/platform`) matches `.spec.ts`. Confirmed on disk: **33** `*.spec.js` files exist under `apps/*/dist/` and `packages/*/dist/`, each importing `vitest`, `@nestjs/testing`, or `@testcontainers/*` — every one of which `npm ci --omit=dev` prunes.

This is the same defect class as WINDOWS.md #8, which `tooling/deployment-shape.spec.ts` was written to prevent: a production tree that *looks* correct and carries modules whose own imports cannot resolve. It is not a boot failure today (nothing requires a spec module), but it ships test code into the runtime artifact, inflates the image, and will grow silently as specs are added.

**Fix:** exclude specs from every emitted project while keeping them type-checked:

```json
"include": ["src/**/*.ts"],
"exclude": ["src/**/*.spec.ts"]
```

---

### WR-04: `crypto.module.ts`'s docblock contradicts `config.module.ts` and justifies a code shape on a false premise

**File:** `packages/platform/src/crypto/crypto.module.ts:27-48`
**Issue:** The "Why the factory reads `process.env` directly instead of `ConfigService`" section states that `ConfigModule.forRoot()` is called at module scope, that `ConfigService` therefore serves an import-time snapshot, and that *"`namedValidate` still validates the shape of both keys at import time."*

None of that is true of the current `config.module.ts`, which was rewritten to a DI-time `useFactory` (`config.module.ts:86-93`) specifically to fix that snapshot bug — with a regression test at `config.module.spec.ts:65-78` proving the fix.

The consequence is real: the next reader who trusts this comment will conclude `ConfigService` is unsafe for `NODE_ENV` and preserve the direct `process.env` read. Once the snapshot bug is gone, the correct shape is to inject `ConfigService` and read the validated config, which would also close the `?? 'development'` / `?? 'local'` defaults in `readKeyProviderEnv` (`crypto.module.ts:129-131`) that CR-01 turns on.

**Fix:** rewrite the section to state the current reason (or delete it if there is no longer one), and migrate the factory to `ConfigService`. If the factory must keep reading live env, say *why* in terms of the current code — not a bug that was fixed.

---

### WR-05: The `kernel` zero-dependency invariant is documented as load-bearing and enforced by nothing

**File:** `tooling/boundaries.config.mjs:129-130, 202-208, 285-287`
**Issue:** `ALLOWED_EDGES.kernel` is documented as *"pure types. ZERO I/O, ZERO deps — it may import nothing"*, and `packages/kernel/src/index.ts:2-6` repeats it (*"stays import-free"*). Neither is enforced.

`edge()` returns `null` for an empty target list (lines 202-208), so `kernel` gets **no `from` policy at all** — it is dropped by the `.filter(policy => policy !== null)` at line 296. Policy 0 (lines 285-287) then allows every `external` and `core` import from anywhere in the tree, including `kernel`. A `zod` import in `packages/kernel/src` therefore passes `npm run lint`, passes `tsc`, and ships — in the one package whose stated purpose is to be dependency-free so every other element may import it.

`tooling/deployment-shape.spec.ts` does not catch it either: `zod` is already a root runtime dependency, so the misplaced-devDependency assertion passes.

**Fix:** add an explicit disallow policy for `kernel`'s origins, ordered after policy 0 so last-match-wins keeps it narrow:

```js
// kernel may reach nothing, not even a third-party package
{ from: { element: { type: 'kernel' } }, disallow: { to: { module: { origin: ['external', 'core'] } } },
  message: 'KERNEL_IS_DEPENDENCY_FREE: packages/kernel may import no runtime package.' },
```

and add it to `tooling/boundaries-fixtures/packages/kernel/` plus a `CASES` entry so the fixture set pins it.

---

### WR-06: Five of thirteen domain element types have no fixture at all, so their allow-edges are unexercised

**File:** `tooling/boundaries.config.mjs:38-52`; `tooling/boundaries-fixtures/packages/domain/src/`
**Issue:** Reviewed specifically for genuine rule coverage. All nine file categories are covered, and every R1/R2/R3 policy has both a violating and a compliant case. But the *element graph* is only partly exercised. Fixture directories exist for `identity`, `authz`, `registry`, `forms`, `links`, `connectors`, `submissions`, `adapters` — and are **missing entirely** for `decision`, `datarouter`, `pipeline`, `builder`, `audit`.

Consequence: the `ALLOWED_EDGES` rows for `decision` (line 138), `datarouter` (150), `pipeline` (159), `builder` (171) are never exercised in either direction, and `contract`'s own row (`contract: ['kernel']`, line 132) is unexercised as an *origin* even though `packages/contract/src/index.ts` exists as a fixture (it is only ever used as a target by the `adapters → contract` case). A typo in any of those five rows — a missing `decision` on `pipeline`, a missing `connectors` on `datarouter` — is invisible to the fixture suite and would only surface as a build failure in whichever later phase first imports it.

**Fix:** add fixture index files at `packages/domain/src/{decision,datarouter,pipeline,builder,audit}/index.ts` and one `COMPLIANT_CASES` entry per type exercising each declared edge from that origin. A cheap completeness guard is worth adding too:

```ts
it('every declared element type has a fixture target and an exercised origin', () => {
  for (const { type } of boundariesSettings['boundaries/elements']) {
    expect(hasFixtureOrOriginCase(type)).toBe(true);
  }
});
```

---

### WR-07: `production-guard.spec.ts`'s "constructor backstop" test does not test the constructor

**File:** `packages/platform/src/crypto/production-guard.spec.ts:126-136`
**Issue:** The test is named *"a provider built under development still refuses to exist under production"* and its comment claims *"If someone ever removes `assertKeyProviderAllowed` from the factory, this still holds."* But the call passes `CRYPTO_KEY_PROVIDER: 'kms'`:

```ts
expect(() => createKeyProvider({
  NODE_ENV: 'production', CRYPTO_KEY_PROVIDER: 'kms', CRYPTO_LOCAL_KEY_FILE: keyFilePath,
})).toThrowError(/^KMS_PROVIDER_BLOCKED: /);
```

The throw comes from the `case 'kms'` branch (`crypto.module.ts:91-95`), which runs *before* `LocalKeyProvider` is ever constructed. `LocalKeyProvider`'s constructor backstop (`local-key-provider.ts:87-91`) — the property the test claims to protect — is never reached. Deleting the constructor's production refusal would leave this test green.

**Fix:** exercise the constructor directly, the way `local-key-provider.spec.ts:34-44` already does, and keep a separate case for the factory ordering:

```ts
it('the constructor backstop holds independently of the factory', () => {
  expect(() => new LocalKeyProvider({ keyFilePath, nodeEnv: 'production' }))
    .toThrowError(/^LOCAL_KEY_PROVIDER_FORBIDDEN: /);
});
```

---

### WR-08: `#lastError` is a latch that is never cleared, so one transient Redis blip marks the worker permanently unready

**File:** `apps/worker/src/processors/platform-heartbeat.processor.ts:112-140`
**Issue:** The `error` handler sets `#lastError` and `isRunning()` short-circuits to `false` whenever it is set (lines 135-139). Nothing ever clears it. BullMQ's `Worker` emits `error` for *transient* connection failures and then recovers — its `error` event is not a terminal state.

So a single 5-second Redis blip permanently flips this process to `bullmq_workers: down`. Because `GET /health/live` still returns `{"status":"ok"}` (correctly — see `health.controller.ts:95-98`), the orchestrator will **never restart the pod**, and it will never recover on its own. The docblock's intent (*"the process stays up, stops claiming to consume, and the orchestrator's probe says why"*) is achieved, but the "why" is never reachable again.

Compounding this, the `lastError` getter (lines 142-145) is read only by `platform-heartbeat.processor.spec.ts:94`. The readiness payload in `apps/worker/src/app.module.ts:76-78` reports `{ workers: workers.length }` and nothing else, so the *reason* the operator is told to look for is never actually surfaced.

**Fix:** clear the latch when the worker reports itself running again, and put the error in the payload:

```ts
this.#worker.on('error', (error: Error) => { this.#lastError = error; });
this.#worker.on('running', () => { this.#lastError = undefined; });

isRunning(): boolean {
  return this.#lastError === undefined && (this.#worker?.isRunning() ?? false);
}
```

```ts
? session.up({ workers: workers.length, last_error: workers.map(w => w.lastError?.name) })
: session.down({ workers: workers.length, last_error: workers.map(w => w.lastError?.name) })
```

---

### WR-09: The frozen read-link claim set accepts an expired-on-arrival token

**File:** `packages/contract/src/links/read-link-claims.ts:118-123`
**Issue:** The only cross-field refinement is the TTL ceiling:

```ts
.refine((claims) => claims.exp - claims.iat <= MAX_READ_LINK_TTL_SECONDS, ...)
```

Nothing constrains `exp` relative to `nbf` or `iat`. A claim set with `exp < iat` (negative lifetime) or `exp <= nbf` (not yet valid and already expired) satisfies `exp - iat <= 90d` and therefore validates cleanly. Both produce a token that is dead the moment it is issued.

This is the phase's most explicitly frozen contract: the file header states that *"adding or removing a claim invalidates every link already in a user's clipboard, silently, on deploy"* and that *"there is no 'we'll add it later'"*. A missing ordering invariant is therefore not a candidate for later correction the way an ordinary schema gap would be — it will need the same version-frozen edit as a claim addition.

**Fix:** extend the refinement to the ordering invariants, keeping the existing named-token pattern:

```ts
.refine((c) => c.nbf >= c.iat, { message: READ_LINK_TIMESTAMPS_UNORDERED, path: ['nbf'] })
.refine((c) => c.exp > c.nbf, { message: READ_LINK_TIMESTAMPS_UNORDERED, path: ['exp'] })
.refine((c) => c.exp - c.iat <= MAX_READ_LINK_TTL_SECONDS, {
  message: READ_LINK_TTL_EXCEEDS_CEILING, path: ['exp'],
});
```

and add cases to `read-link-claims.frozen.spec.ts` for `exp < iat` and `exp <= nbf`.

---

### WR-10: The CI `install-guard` job's comment promises an assertion the workflow does not implement

**File:** `.github/workflows/ci.yml:28-56`
**Issue:** The job comment states:

> *"Peer-dependency-bypass flags must never be added to the install below — they turn the guard into a no-op. The plan's node assertion fails if such a flag is present."*

There is no such node assertion in the file. The job runs `rm -f package-lock.json && npm install`, then `npm run build`, `npm test`, and a loop asserting `apps/$app/dist/main.js` exists. Nothing inspects the resolved toolchain and nothing checks the install command for bypass flags.

The `install-guard` job's stated purpose (FND-01/FND-02/D-06) is to prove the TypeScript pin survives a lockfile-free install. What it actually proves is only that `tsc` emitted three files. In practice the `ERESOLVE` is the real guard, so the gap is narrow — but the comment describes a control that does not exist, and a `--legacy-peer-deps` added later would produce a green job while silently invalidating the phase's central claim.

**Fix:** make the described assertion real:

```yaml
- name: Assert the resolved toolchain, not just that it compiled
  run: |
    node -e "const p=require('typescript/package.json'); if(p.version!=='6.0.3'){throw new Error('typescript '+p.version+' != 6.0.3')} console.log('typescript', p.version)"
    grep -qE 'legacy-peer-deps|--force' <<< "${{ steps.install.outputs.command }}" && exit 1 || true
```

Simpler: capture the install step's script and assert it carries no bypass flag before running it.

---

### WR-11: `AppConfigObjectSchema` is exported with a self-documented `PORT` trap and nothing preventing its use

**File:** `packages/platform/src/config/config.schema.ts:84-95`
**Issue:** The docblock is unusually candid:

> *"Exported for that assertion and nothing else — **do not parse configuration with it**, which is precisely why its one visible defect (an unresolved `PORT`) is a trap."*

`AppConfigObjectSchema` has no per-process `PORT` default (that is added by `.transform` at line 105), so any caller who parses with it gets `PORT: undefined` and no error — a process that then calls `app.listen(undefined)` gets a random port. The only current consumer is `config.schema.spec.ts:128` (reading `.shape`), but nothing prevents the next caller from importing it and calling `safeParse`.

**Fix:** stop exporting the pre-transform schema. Export the shape instead, which is what the assertion actually needs:

```ts
export const APP_CONFIG_KEYS = Object.keys(AppConfigShape) as Array<keyof AppConfig>;
```

and in `config.schema.spec.ts:128`, assert `Object.keys(AppConfigShape).sort()` against `VALID_CONFIG` keys by importing the shape rather than the parseable schema. If the schema object must stay exported for the assertion, rename it to `AppConfigShapeForAssertion` and keep the prohibition.

---

### WR-12: `/metrics` has no time bound, while every other network-touching indicator in the phase does

**File:** `packages/platform/src/metrics/metrics.controller.ts:58-86`
**Issue:** `#render()` wraps the exporter in a promise with no timeout and no settled-flag guard:

```ts
return new Promise<string>((resolve, reject) => {
  const response = { statusCode: 0, headers: {}, setHeader() {...}, end(chunk?) {...} };
  exporter.getMetricsRequestHandler(undefined as unknown as IncomingMessage,
                                     response as unknown as ServerResponse);
});
```

I verified the claim that the first argument is genuinely ignored — in `@opentelemetry/exporter-prometheus@0.222.0`, `getMetricsRequestHandler(_request, response)` calls `this._exportMetrics(response)` directly and never dereferences `_request` (`build/src/PrometheusExporter.js:145-147`). So the adapter is sound. The gap is the absence of a bound.

This is an internal inconsistency rather than a proven hang: `queue-indicators.ts:88-124` states the phase's own rule — *"a readiness probe that hangs is a strictly worse answer than one that says 'not ready', because the orchestrator cannot distinguish the two"* — and implements a 3 s `Promise.race` with an `unref`'d timer for exactly that reason. `MongoService` bounds itself with two timeouts for the same reason. `MetricsController` is the one network-touching path with no bound, and `shutdownOtel()` (`apps/*/src/app.module.ts:57-61`) can run concurrently with an in-flight scrape.

**Fix:** apply the same shape `queue-indicators.ts` uses:

```ts
const timer = setTimeout(() => reject(new Error('METRICS_SCRAPE_TIMEOUT')), SCRAPE_TIMEOUT_MS);
timer.unref?.();
try { exporter.getMetricsRequestHandler(...); } finally { /* clearTimeout in settle */ }
```

Add a `SCRAPE_TIMEOUT_MS` constant alongside the two existing ones and a spec asserting a stalled exporter rejects rather than hanging.

## Info

### IN-01: Three barrel docblocks describe a stale `exports` map

**File:** `packages/platform/src/metrics/index.ts:9-13`, `packages/platform/src/health/index.ts:6-10`, `packages/platform/src/crypto/index.ts:12-15`
**Issue:** All three say `packages/platform/package.json` *"declares only `"."` and `"./crypto"`"*. The manifest also declares `"./otel"` (`package.json:14-18`). Cosmetic, but these docblocks are what a future plan reads when deciding whether a deep specifier resolves.
**Fix:** Update all three to `.`, `./otel`, `./crypto`, or drop the enumeration and point at the manifest.

---

### IN-02: Two docblocks reference `otel.bootstrap.too-late.spec.ts`, which does not exist

**File:** `packages/platform/src/otel/otel.bootstrap.ts:32`, `packages/platform/src/otel/otel.bootstrap.ordering.spec.ts:8`
**Issue:** Both cite `otel.bootstrap.too-late.spec.ts` as the counterfactual pair for the ordering proof. The file was renamed to `otel.bootstrap.node-ordering.spec.ts`. A reader following the citation finds nothing.
**Fix:** Update both references to `otel.bootstrap.node-ordering.spec.ts`.

---

### IN-03: Dead type exports kept alive by a comment that misstates why

**File:** `packages/platform/src/otel/otel.bootstrap.spec.ts:43-44, 326-328`
**Issue:** `OtelBootstrap` and `OtelConstants` are declared and then re-exported with the comment *"Referenced only so the unused-import lint stays honest about the two module namespaces this file exercises through `freshOtel()`."* Neither type is referenced anywhere in the file, and an `export type` does not satisfy `no-unused-vars` — the premise is wrong as well as the code being dead.
**Fix:** Delete lines 43-44 and 326-328.

---

### IN-04: `PlatformHeartbeatProcessor.lastError` is production-dead API

**File:** `apps/worker/src/processors/platform-heartbeat.processor.ts:142-145`
**Issue:** The getter exists with the comment *"Exposed for the `EXTRA_HEALTH_INDICATORS` details payload"*, but grep confirms the only reader is `platform-heartbeat.processor.spec.ts:94`. `apps/worker/src/app.module.ts:76-78` reports `{ workers: workers.length }` only. Either the payload should carry it (see WR-08) or the getter should go.
**Fix:** Fold into WR-08 — wire it into the readiness payload.

---

### IN-05: The three "verbatim-copied" entrypoints differ by quote style and nothing pins them together

**File:** `apps/api/src/main.ts:41`, `apps/worker/src/main.ts:41`, `apps/scheduler/src/main.ts:41`
**Issue:** All three docblocks claim *"one shape, copied verbatim by"* the other two, and `apps/api/otel.mjs:26-28` says the three loaders are *"byte-identical by design"*. In fact the only code-level difference between the three `main.ts` bodies is that `apps/api/src/main.ts:41` writes `await import("./app.module.js")` with double quotes while the other two — and the entire rest of the repository — use single quotes. `entrypoint-drift.spec.ts` checks reachability and manifest wiring but never compares the three bodies.
**Fix:** Normalize to single quotes and add an assertion to `tooling/entrypoint-drift.spec.ts` that strips docblocks and comments from the three `main.ts` files and asserts the resulting bodies are equal. That is what makes "verbatim" structural rather than aspirational.

---

### IN-06: Shutdown-hook ordering in `worker`/`scheduler` is stated as a Nest guarantee but is an implementation detail

**File:** `apps/worker/src/app.module.ts:86-88`, `apps/scheduler/src/app.module.ts:103-106`
**Issue:** *"The `Worker` closes itself from its own `onApplicationShutdown`, which Nest awaits before this runs"* and *"the queue itself is closed by `@nestjs/bullmq`'s own shutdown hook, which Nest awaits before this runs."* Nest documents that `onApplicationShutdown` runs per module; it does not document that `AppModule`'s hook runs last. The ordering is plausible but not contractual, and the correctness of `shutdownOtel()` relative to those hooks depends on it.
**Fix:** Soften the comments to name the assumption, or hoist the flush into a provider that owns the ordering explicitly.

---

### IN-07: `shutdownOtel`'s `stopped` latch is permanent and unrecoverable

**File:** `packages/platform/src/otel/otel.bootstrap.ts:179-204`
**Issue:** `stopped` is module-level and never reset, while `started` is memoised. A `startOtel` after `shutdownOtel` in the same process returns the handle of a shut-down SDK and reports success. Within one process this is a boot-once/shutdown-once contract so the risk is low, but it is a sharp edge for a test that re-initialises, and for hot reload.
**Fix:** Reset `stopped = false` inside `startOtel` when it constructs a fresh handle, or throw a named error if `startOtel` is called after `shutdownOtel`.

---

### IN-08: CI runs the full container-backed suite twice per change

**File:** `.github/workflows/ci.yml:3-9`
**Issue:** `push: branches: ['**']` and `pull_request:` together mean every PR branch push runs the suite, and so does the PR itself. The integration specs start three Docker containers each; under CI concurrency this doubles the load and the wall clock, and can turn the `hookTimeout`-sensitive teardowns (`redis.integration.spec.ts:43`, `mongo.service.spec.ts:92`) flaky.
**Fix:** Add `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }`, or scope the push trigger to `main`.

---

### IN-09: `otel.mjs` is outside `dist/` and `tsc`, and no test asserts the documented start command's inputs exist

**File:** `package.json:18-20`, `apps/*/otel.mjs`
**Issue:** The three start scripts are `node --import ./apps/<app>/otel.mjs ./apps/<app>/dist/main.js`. The loader lives in the source tree, is not compiled (no `tsconfig` covers `.mjs`), and is not referenced by any test. A deployment image that copies `dist/` + `node_modules` — the natural reading of `npm ci --omit=dev` plus a build step — satisfies the second path and fails on the first with `ERR_MODULE_NOT_FOUND`. No Dockerfile is in this diff's scope, so this is not proven broken; there is simply no guard.
**Fix:** Either copy `otel.mjs` into `dist` as a build step, or add a `deployment-shape.spec.ts` assertion that every path named in the three `start:*` scripts exists after `npm run build`.

---

_Reviewed: 2026-10-03_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_