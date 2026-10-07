# Getting Started — aka-nexa

## Prerequisites

| Tool | Version | Why |
|------|-----------|-----|
| **Node.js** | **24.x LTS** | The pinned runtime; `engines.node` in `package.json` is `>=24 <25`. npm warns on anything else (no `engine-strict`). |
| **npm** | ships with Node 24 | npm workspaces; no other package manager. |
| **Docker** | any recent version | MongoDB and Redis for the local stack (`compose.dev.yml`), and for the test suite. |
| **Git** | any | — |
| **.nvmrc** | contains `24` | Used by local developers; matches `engines.node`. |

> **Important**: `npm ci` is the install — the lockfile is committed and is what makes the install reproducible (FND-02), so `npm install` is not a substitute.

## Local Stack

The local development stack is defined in `compose.dev.yml`. It starts three services:

- **MongoDB 8.0.x** replica set `rs0` — primary + two secondaries
- **Redis Cache** on `6379` — `maxmemory-policy: noeviction` (evicting keys)
- **Redis Queue** on `6380` — `maxmemory-policy: noeviction` (never evicts)

Start the stack:

```bash
docker compose -f compose.dev.yml up -d
```

Verify it's running:

```bash
docker compose -f compose.dev.yml ps
```

## Running the three processes

The platform is three independently runnable Node processes. Each is started by its own npm script, and `SERVICE_NAME` is set inline on the command (it identifies which process is booting and what port it defaults to).

```bash
SERVICE_NAME=api        npm run start:api        # HTTP API          — http://127.0.0.1:3000
SERVICE_NAME=worker     npm run start:worker     # queue consumer     — http://127.0.0.1:3001
SERVICE_NAME=scheduler  npm run start:scheduler  # job scheduler      — http://127.0.0.1:3002
```

All three can run at once; they share no in-process state. Every process answers two health endpoints:

| Endpoint | Meaning |
|----------|---------|
| `GET /health/live` | Liveness. Reads no dependency. A blip in a dependency must never restart an otherwise healthy process. |
| `GET /health/ready` | Readiness. Names MongoDB, the cache Redis and the queue Redis **separately**, so a degraded dependency is identified rather than collapsed into one boolean. |

```bash
curl -s http://127.0.0.1:3000/health/live    # {"status":"ok"}
curl -s http://127.0.0.1:3000/health/ready   # every dependency up, each named
```

### Two traps

1. **Port trap**: If a process dies immediately after printing `Nest application successfully started`, check whether another process already occupies the default port. Each process defaults to `3000`/`3001`/`3002`, but `PORT` can override per process.

2. **`.env` sourcing trap**: This project does **not** load a `.env` file. `ConfigModule.forRoot()` validates `process.env` only. Sourcing `.env.example` rewrites `NODE_ENV` — so `set -a; . ./.env.example; set +a` in a shell that already has `NODE_ENV=production` will overwrite it to `development`, disarming the crypto guard. Source the file and then re-export `NODE_ENV` yourself, or set only the two variables you actually need inline instead of sourcing the whole file.

```bash
# Adopt the documented development values in this shell:
set -a; . ./.env.example; set +a

# Provision the local key file once per checkout (32 raw bytes; the path, never the key):
head -c 32 /dev/urandom > .dev-local-key
```

## Configuration

The boot contract is validated at startup by Zod, and a missing or malformed value fails the boot with a named error rather than a default. Configuration is read from the **process environment only** — nothing in this repository reads a `.env` file from the working directory.

`.env.example` is that contract written down: every key the schema declares, with the local development values filled in.

Every failure is greppable and names the offending key:

| Token | Meaning |
|-------|---------|
| `CONFIG_INVALID: <KEY> <code>` | Missing or malformed value. The process aborts before it serves anything. `<KEY>` is the dotted path to the offending value, or the literal `<root>` when the rule is about the configuration as a whole. |
| `CONFIG_INVALID: <root> REDIS_INSTANCES_NOT_DISTINCT` | The two Redis URLs name one instance. They must be two — see DEPLOYMENT.md. |
| `CRYPTO_KEY_PROVIDER_REQUIRED:` | A local key outside `NODE_ENV=development or test`, with no explicit operator opt-in. Refused before the key file is read. |
| `KMS_PROVIDER_BLOCKED:` | The KMS provider is selected and has no adapter yet. Named failure, on purpose. |
| `LOCAL_KEY_FILE_MISSING:` | The variable `CRYPTO_LOCAL_KEY_FILE` is unset or empty. About the variable, never about the file. |
| `ENOENT: no such file or directory, open '<path>'` | The variable is set and the file it names is not there (normal state of fresh checkout). Provision the key file: `head -c 32 /dev/urandom > .dev-local-key`. |
| `CONFIG_INVALID: SERVICE_NAME` | `SERVICE_NAME` is unset or has a value that doesn't match a configured process. |

### Two Redis deployments, not one

D-12 requires the cache and queue tiers to be **two separate Redis instances**. `maxmemory-policy` is instance-wide, so a logical-database suffix (`/0` vs `/1`) cannot express the split: the cache tier must be evicting and the queue tier must never evict.

- `REDIS_CACHE_URL=redis://127.0.0.1:6379` — cache tier (evicting, short TTL)
- `REDIS_QUEUE_URL=redis://127.0.0.1:6380` — queue tier (never evicts, BullMQ home)

Collapsing them to one instance fails boot with `CONFIG_INVALID: <root> REDIS_INSTANCES_NOT_DISTINCT`.

## Boot contract (Zod schema)

Every environment variable is validated by a Zod schema at boot. See `.env.example` for the full list with development values. Key categories:

- `NODE_ENV` — required; arms the crypto guard (development/test permit local key; production requires KMS vendor named per D-27)
- `MONGO_URL` — required; `?directConnection=true` must **not** be present (local stack runs without `--replSet`)
- `REDIS_CACHE_URL` / `REDIS_QUEUE_URL` — required; must be two different instances (D-12)
- `CRYPTO_KEY_PROVIDER` — `local` or `kms`; `local` development only; `kms` refused until a cloud is named (D-27 / blocker B-3)
- `CRYPTO_LOCAL_KEY_FILE` — path to 32-byte key file; required when `CRYPTO_KEY_PROVIDER=local`
- `OTEL_EXPORTER_OTLP_ENDPOINT` — optional; absent is legal, malformed fails boot

## Developing on a single process

```bash
# API process
SERVICE_NAME=api npm run start:api

# Worker process  
SERVICE_NAME=worker npm run start:worker

# Scheduler process
SERVICE_NAME=scheduler npm run start:scheduler
```

## Testing

```bash
npm test   # runs vitest suite
```

The test suite starts containerized MongoDB + two Redis deployments. See `vitest.config.mts` for configuration details.

## Available npm scripts

| Script | Description |
|--------|-------------|
| `build` | `npm run lint && tsc -b` |
| `lint` | `eslint .` |
| `test` | `vitest run` |
| `start:api` | `SERVICE_NAME=api node --import ./apps/api/otel.mjs ./apps/api/dist/main.js` |
| `start:worker` | `SERVICE_NAME=worker node --import ./apps/worker/otel.mjs ./apps/worker/dist/main.js` |
| `start:scheduler` | `SERVICE_NAME=scheduler node --import ./apps/scheduler/otel.mjs ./apps/scheduler/dist/main.js` |

## Common local tasks

### Provision a dev local key

```bash
head -c 32 /dev/urandom > .dev-local-key
```

This creates a 32-byte key file in `.dev-local-key` (gitignored). It is required when `CRYPTO_KEY_PROVIDER=local`.

### Run a specific process in development

```bash
SERVICE_NAME=api npm run start:api
```

The `--import ./apps/api/otel.mjs` flag initializes OpenTelemetry before any instrumented module loads.

### Run the test suite

```bash
npm test
```

This starts three container services (MongoDB + two Redis) and runs the full Vitest suite. Expect ~5 min per run due to Docker container startup.

### Lint the codebase

```bash
npm run lint
```