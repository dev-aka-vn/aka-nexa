# Development — aka-nexa

## Project Structure

The monorepo has two top-level workspaces:

- `packages/` — shared libraries and domain logic
- `apps/` — three independently runnable entrypoints

### Packages

| Package | Purpose |
|---------|---------|
| `contract` | Frozen JEV wire contract, read-link target rules, token class config |
| `domain` | Per-app business logic, decision model interfaces, repository shapes |
| `platform` | NestJS framework wiring, guards, bootstrapping, OTel, pino, boundary lint |
| `tooling` | Container scripts, import resolver, boundary fixtures |

### Apps

| App | Purpose | Default Port |
|-----|---------|--------------|
| `api` | HTTP API, webhook receiver, health endpoints | 3000 |
| `worker` | BullMQ consumer, async job execution | 3001 |
| `scheduler` | Job schedulers, platform heartbeat | 3002 |

## Setup for New Developers

### 1. Checkout and install

```bash
git clone <repo-url>
cd aka-nexa
npm ci   # lockfile guaranteed reproducible (FND-02)
```

### 2. Provision the dev local key (needed for crypto boot)

```bash
head -c 32 /dev/urandom > .dev-local-key
```

### 3. Start the local stack

```bash
docker compose -f compose.dev.yml up -d
```

Wait for services to be ready (may take a minute for MongoDB replica in it).

### 4. Boot a process

```bash
# API process
SERVICE_NAME=api npm run start:api

# Or, with auto-OTel initialization
node --import ./apps/api/otel.mjs ./apps/api/dist/main.js
# then visit: http://127.0.0.1:3000/health/live and http://127.0.0.1:3000/health/ready
```

### 5. Run the test suite

```bash
npm test
```

This starts three container services (MongoDB + two Redis) and runs the full Vitest suite. Expect ~5 min per run.

## Code Conventions

### TypeScript & ESLint

- TypeScript is hard-pinned to **6.0.3** — do not upgrade without updating `typescript-eslint` peer ranges and verifying `npm ci` succeeds.
- ESLint **10.11.0** + `eslint-plugin-boundaries@7.2.0` enforces component boundaries at lint time.
- Boundary policies (last-match-wins, `disallow` beats `allow`):

  - R1: `from: { element: { type: "!(app-api)" } }` — worker/scheduler cannot import from api
  - R2: `from: { element: { type: "!(app-worker)" } }` — scheduler cannot import from worker
  - R3: `from: { element: { type: "!(app-scheduler)" } }` — api/worker cannot import from scheduler

  Without `checkAllOrigins: true`, R2/R3 are dead config (the rule returns before evaluating any policy for local dependencies).

- `tooling/import-resolver.cjs` is **load-bearing** — without it, every relative import in the repo is unresolvable and boundaries report zero problems on a tree full of violations.

### Node.js module system

- The project uses `"type": "module"` in `package.json`.
- BullMQ 6.3.11 resolves to its CJS build even under `"type": "module"` (no `"type"` field in its `package.json`, so `dist/esm/*.js` loads as CJS via Node's syntax detection).
- Import BullMQ with named imports: `import { Queue } from 'bullmq'` (works around CJS/Esm interop).

### Environment configuration

- Configuration is read from `process.env` only — no `.env` file loading.
- `.env.example` is a reference, not a loader target.
- Every env key is validated by Zod at boot. See `.env.example` for the full schema.
- Two Redis deployments are required: `REDIS_CACHE_URL` and `REDIS_QUEUE_URL` must be different instances (D-12).

### Git workflow

- `package-lock.json` is committed in the first commit (FND-02); `npm ci` is the install.
- `.nvmrc` contains `24` (matches the Node floor).
- Feature branches are short-lived; PRs must pass lint + test before merge.

## Common Development Tasks

### Rebuild TypeScript

```bash
npm run build   # tsc -b + lint
```

### Recompile after source changes

The `build` script runs `tsc -b` which builds in dependency order. Run it after any `.ts` source change to update `dist/`.

### Run lint only

```bash
npm run lint
```

### Watch mode (dev)

No watch script is provided — use `npm run build` on a commit basis, or run `tsc -b` in watch mode manually.

```bash
npx tsc -b --watch
```

### Debug a specific process

```bash
# API
SERVICE_NAME=api node --import ./apps/api/otel.mjs ./apps/api/dist/main.js

# Worker
SERVICE_NAME=worker node --import ./apps/worker/otel.mjs ./apps/worker/dist/main.js

# Scheduler
SERVICE_NAME=scheduler node --import ./apps/scheduler/otel.mjs ./apps/scheduler/dist/main.js
```

### Reset test containers

```bash
docker compose -f compose.dev.yml down -v
docker compose -f compose.dev.yml up -d
```

Wait for services to be ready, then run `npm test`.

## Boundary Lint Details

The boundary rule is configured in `eslint.config.mjs`. Key points:

- `elementTypes` map paths to element types (`app-api`, `app-worker`, `app-scheduler`, etc.)
- `policies` are evaluated last-match-wins; within one policy, `disallow` beats `allow`
- `checkAllOrigins: true` governs on the target's origin, not the source's — this is critical for R2/R3 to fire
- `partialMatch: false` must stay on every descriptor or `packages/platform/src/**` also suffix-matches `apps/api/src/platform/**`
- `instanceWrapper.isResolved` does **not** exist in `@nestjs/core@12.1.2` — building a guard on it is permanently silent; read `wrapper.instance` instead

## Open Issues for Developers

- FND-10 (KMS vendor not named) — crypto guard requires `NODE_ENV=production` + KMS adapter, but no cloud has been named yet. Every boot needs `CRYPTO_KEY_PROVIDER=local` + key file in development.
- FND-05 (Health topology) — all three entrypoints must expose `/health/live` and `/health/ready`, but worker and scheduler `main.ts` are currently shells (`NOT_IMPLEMENTED`). Plan 10 owns this.
- FND-08 (BullMQ Job Schedulers) — `registerPlatformHeartbeat` has no caller; no process constructs the consuming Worker. Plan 10 owns this.
- Draft save & resume — structurally incompatible with the stateless one-time-token SPA; blocked pending a token-model decision.