# Testing — aka-nexa

## Test Stack

| Technology | Version | Purpose | Why |
|-----------|-----------|---------|-----|
| **vitest** | **5.0.3** | Unit + integration tests (server) | NestJS 12's ESM projects default to Vitest; framework team migrated all repos off Jest. (Corrected from 5.0.2.) |
| **@playwright/test** | **1.63.0** | E2E — UI and API | PRD §17.1 already commits to Playwright. Also the only practical way to UAT FormIO's drag-and-drop builder. |
| **testcontainers** | **12.2.0** | Real MongoDB + Redis in integration tests | Mocks would not catch the `GETDEL` atomicity (NFR-SEC-1) or BullMQ retry/DLQ behaviour that FR-C-* depends on. Those are the two highest-risk behaviours in the system and both are Redis-semantics-dependent. Engines `>=22.22` — satisfied. |
| **fast-check** | 4.10.2 | Property-based testing | Valuable for the JEV routing layer: "no input produces a routing decision that bypasses RBAC" is a property, not an example. |
| **msw** | 3.0.1 | HTTP mocking for connector tests | Where testcontainers is not warranted (third-party APIs). |
| **@faker-js/faker** | 10.6.0 | Fixture data | Standard. |

## Test Configuration

### vitest.config.mts

```mts
import { defineConfig } from 'vitest/config'
import { nxCompatiblePaths } from '@nx/eslint/plugin' // if using nx paths
import vue from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineConfig({
  testTimeout: 120000,
  hookTimeout: 30000,
  isolate: false, // still declined — ordering counterfactual depends on per-file module isolation (01-07, 01-08)
  globalSetup: [],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  // Experimental features for property-based testing
  experimental: {
    // fast-check integration can be configured here
  },
  // Watch exclude patterns
  watch: {
    disabled: false,
  },
  // Reporter
  reporter: ['default'],
})
```

### Test Organization

```
packages/domain/src/       — domain logic specs
packages/platform/src/     — platform guards & boot specs
apps/api/src/              — HTTP handler specs, E2E tests
apps/worker/src/           — processor specs, BullMQ integration
apps/scheduler/src/      — scheduler specs
apps/renderer/src/        — frontend E2E (Playwright)
e2e/                       — end-to-end user flows
```

### Test Patterns

#### Unit tests (vitest)

- File convention: `**/*.spec.ts` or `**/*.test.ts`
- Use `vi.mock()` for cross-module dependencies
- Property-based testing with `fast-check` for JEV routing invariants
- Mock external dependencies (connectors, third-party APIs) with `msw`

#### Integration tests (vitest + testcontainers)

- Start real MongoDB + two Redis deployments (cache + queue)
- Test `GETDEL` atomic consumption (NFR-SEC-1)
- Test BullMQ retry/DLQ behaviour (FR-C-*)
- Test token lifecycle: mint → `GETDEL` → consume → invalidated
- Test RBAC enforcement at runtime

#### E2E tests (Playwright)

- UI flows through the FormIO.js rendered form
- Slash command → inbound event → routing → form submission → downstream system
- Admin SSO login (OIDC)
- Form Builder drag-and-drop (validates builder JSON schema)
- Submission export, erasure, and export

## Key Testing Gates

### FND-01: Clean checkout builds and runs

```bash
npm ci     # must succeed, lockfile guaranteed reproducible
npm run build   # tsc -b must succeed
```

### FND-02: Package-lock.json committed

The lockfile is the source of truth for `npm ci`. `npm install` is not a substitute.

### FND-03: Three independently runnable processes

Boot all three processes and verify they each answer `/health/live` and `/health/ready`:

```bash
SERVICE_NAME=api     npm run start:api     && curl -s http://127.0.0.1:3000/health/ready
SERVICE_NAME=worker  npm run start:worker  && curl -s http://127.0.0.1:3001/health/ready
SERVICE_NAME=scheduler  npm run start:scheduler && curl -s http://127.0.0.1:3002/health/ready
```

### FND-04: TypeScript compilation

```bash
npm run build   # tsc -b must succeed with hard-pin 6.0.3
```

### FND-05: Boundary lint

```bash
npm run lint   # boundary violations must fail the build
```

### FND-06: OTel initialization

All three processes must successfully initialize OTel before any instrumented module loads. The `--import ./apps/api/otel.mjs` flag ensures this.

## Testcontainers Setup

Integration tests use testcontainers to start real MongoDB and Redis instances:

```typescript
import { MongoDbContainer } from '@testcontainers/mongodb'
import { RedisContainer } from '@testcontainers/redis'

async function startContainers() {
  const mongo = new MongoDbContainer('mongo:8.0')
    .withReplicaSet('rs0')
    .withStartupOptions(['--no-auth'])

  const redisCache = new RedisContainer('redis:8.2')
    .withExposedPort(6379)

  const redisQueue = new RedisContainer('redis:8.2')
    .withExposedPort(6380)

  await Promise.all([mongo, redisCache, redisQueue].map(c => c.start()))

  return { mongo, redisCache, redisQueue }
}
```

**Important**: MongoDB container needs `directConnection=true` in its connection string (01-07's Mongo trap). Redis containers need `maxmemory-policy=noeviction` on the queue, `noeviction` or evicting on the cache.

## Common Test Commands

```bash
# Run all tests
npm test

# Run a specific test file
npx vitest run packages/domain/src/find-user.spec.ts

# Run tests with code coverage
npx vitest run --coverage

# Run tests in watch mode
npx vitest watch

# Run only unit tests (no testcontainers)
npx vitest run --no-threads

# Run only integration tests (with testcontainers)
npx vitest run --files 'e2e/**/*.spec.ts'
```

## Debugging Tests

### Test takes too long

- Check if a testcontainer is hanging (MongoDB replica init can take time)
- Review `hookTimeout` and `testTimeout` in `vitest.config.mts`
- Isolate the hanging test and run it alone

### Tests flake under Docker contention

- Some specs (MongoDB/Redis integration) may fail ~50% of runs under Docker contention
- Run the full suite once to establish a baseline
- If flakiness persists, consider increasing timeouts or running on a less loaded host

### connectTimeoutMS vs serverSelectionTimeoutMS

- `connectTimeoutMS` bounds individual command attempts (30 s default)
- `serverSelectionTimeoutMS` bounds server selection/retry for topology selection
- A MongoDB that *hangs* rather than refuses will hang through `connectTimeoutMS`, not `serverSelectionTimeoutMS`
- `MongoService` sets both to 3 s

## Test Skips and Known Issues

- **isolate: false** is declined — the ordering counterfactual depends on per-file module isolation (01-07, 01-08). Savings of ~42s (~10% of a 7.5 min suite) would be traded for test isolation loss.
- **Container specs** now use explicit `300_000` timeouts in `afterAll` to match their `beforeAll` teardown (previously timed out at 30 s).
- **`vitest.config.mts`** now includes `tooling/**/*.spec.ts` — any future spec outside `packages/` or `apps/` will not run until that glob is extended.
- **Boundary fixture spec** is the only test outside `packages/`/`apps/` today; it runs due to the glob extension.