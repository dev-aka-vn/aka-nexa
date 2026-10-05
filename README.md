# aka-nexa

Nexa — Where chat meets systems.

An IM-driven app builder and integration gateway. Employees ask for something in chat, a
permission-first pipeline resolves their identity and picks the right app, and the reply carries a
signed link to a form whose submission is routed into the internal systems behind it.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | **24.x LTS** | The pinned runtime. `npm ci` fails on anything else — `typescript-eslint` carries a hard peer range that caps TypeScript below 6.1, and the build is TypeScript 6.0.3. |
| npm | ships with Node 24 | npm workspaces; no other package manager. |
| Docker | any recent version | MongoDB and Redis for the local stack (`compose.dev.yml`), and for the test suite. |
| Git | any | — |

`.nvmrc` contains `24`. `npm ci` is the install — the lockfile is committed and is what makes the
install reproducible (FND-02), so `npm install` is not a substitute.

## Running the three processes

The platform is three independently runnable Node processes: an HTTP API, a queue worker, and a
scheduler. Each is started by its own npm script, and **`SERVICE_NAME` is not set by any of those
scripts** — it is set inline on the command, because it is what identifies which process is booting
and what port it defaults to.

```sh
SERVICE_NAME=api        npm run start:api        # HTTP API          — http://127.0.0.1:3000
SERVICE_NAME=worker     npm run start:worker     # queue consumer     — http://127.0.0.1:3001
SERVICE_NAME=scheduler  npm run start:scheduler  # job scheduler      — http://127.0.0.1:3002
```

All three can run at once; they share no in-process state. Every process answers two health
endpoints:

| Endpoint | Meaning |
|---|---|
| `GET /health/live` | Liveness. Reads no dependency. A blip in a dependency must never restart an otherwise healthy process. |
| `GET /health/ready` | Readiness. Names MongoDB, the cache Redis and the queue Redis **separately**, so a degraded dependency is identified rather than collapsed into one boolean. |

```sh
curl -s http://127.0.0.1:3000/health/live    # {"status":"ok"}
curl -s http://127.0.0.1:3000/health/ready   # every dependency up, each named
```

`PORT` overrides the per-process default. If a process dies immediately after printing
`Nest application successfully started`, see the port trap in [Two traps](#two-traps).

## Configuration

**The boot contract is validated at startup by Zod, and a missing or malformed value fails the boot
with a named error rather than a default.** `.env.example` is that contract written down: every key
the schema declares, with the local development values filled in.

```sh
# Adopt the documented development values in this shell:
set -a; . ./.env.example; set +a

# Provision the local key file once per checkout (32 raw bytes; the path, never the key):
head -c 32 /dev/urandom > .dev-local-key
```

### The application does not load a `.env` file

This is worth stating plainly because it is the opposite of what most Node projects do, and
`ConfigModule.forRoot()` is the API people reach for by habit.

**Configuration is read from the process environment only.** `packages/platform/src/config/config.module.ts`
builds its `ConfigService` in a `useFactory` over the live `process.env`, and nothing in this
repository reads a `.env` file from the working directory. A `.env` sitting next to your shell is
ignored — so `cp .env.example .env` does **not** configure anything, and a deployment supplies its
configuration through the environment, which is what an orchestrator does.

The dropped `.env` loader is deliberate rather than missing: a configuration file that carries
credentials on disk is a thing to avoid (NFR-SEC-3, D-15/D-17), and with a single deployment model
nothing in the repository needed the capability. `useFactory` is also what makes the validation
happen at **boot** rather than at module-import time — `forRoot()` snapshots the environment when it
is called, and Nest evaluates a decorator's arguments at import.

Every failure is greppable and names the offending key:

| Token | Meaning |
|---|---|
| `CONFIG_INVALID: <KEY> <code>` | Missing or malformed value. The process aborts before it serves anything. |
| `CONFIG_INVALID: REDIS_INSTANCES_NOT_DISTINCT` | The two Redis URLs name one instance. They must be two — see below. |
| `CRYPTO_KEY_PROVIDER_REQUIRED:` | A production boot on a local key. Refused before the key file is read. |
| `KMS_PROVIDER_BLOCKED:` | The KMS provider is selected and has no adapter yet. Named failure, on purpose. |
| `LOCAL_KEY_FILE_MISSING:` | `CRYPTO_LOCAL_KEY_FILE` names a file that is not there, or is not set. |

### Two Redis deployments, not one

`REDIS_CACHE_URL` and `REDIS_QUEUE_URL` must name **two different instances**, and the boot refuses
if they do not. `maxmemory-policy` is instance-wide, so a logical-database suffix (`/0` vs `/1`) on a
single Redis cannot express the split: the cache tier wants to evict under pressure, and the queue
tier must never evict because a lost job is lost work. Two URLs on one host are fine as long as the
ports differ, which is what the local stack does.

### The local key file

`CRYPTO_LOCAL_KEY_FILE` names a file holding exactly 32 raw bytes of key material. It is a **path**,
never a key value — a key in an environment variable is a key in the process table, in the crash
dump, and in every CI log that echoes its environment. `.dev-local-key` is gitignored, so following
the recipe above cannot commit a plaintext key.

`CRYPTO_KEY_PROVIDER=local` is development-only. `NODE_ENV=production` selecting it is refused with
`CRYPTO_KEY_PROVIDER_REQUIRED:` before any key file is opened, and `CRYPTO_KEY_PROVIDER=kms` is
refused with `KMS_PROVIDER_BLOCKED:` until a deployment cloud is named. Both are the guards working.

## Deployment

Out of scope for this repository: there are no Kubernetes manifests, no Helm chart, and no image
build. This is a **local development** convenience and nothing more — `compose.dev.yml` publishes
everything on loopback for a developer laptop, and its shape (one Mongo, two Redis, no
authentication, no replicas) is not a deployment topology. See [Local
infrastructure](#local-infrastructure) for what it actually starts.