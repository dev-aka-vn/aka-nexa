# Configuration — aka-nexa

## Philosophy

**Configuration is read from the process environment only.** There is no `.env` file loader in this project. `ConfigModule.forRoot()` builds its `ConfigService` in a `useFactory` over the live `process.env`, and nothing reads a `.env` file from the working directory.

This is deliberate rather than missing: a configuration file that carries credentials on disk is avoided (NFR-SEC-3, D-15/D-17), and with a single deployment model nothing in the repository needed the capability. `useFactory` is also what makes the validation happen at **boot** rather than at module-import time — `forRoot()` snapshots the environment when it is called, and Nest evaluates a decorator's arguments at import.

Every failure is greppable and names the offending token.

## Environment Schema (Zod)

Every environment variable is validated by a Zod schema at boot. The canonical reference is `.env.example`, which declares every key with development values.

### Key categories

| Category | Variables | Description |
|----------|-----------|-------------|
| **Runtime** | `NODE_ENV` | Required. Arms the crypto guard: development/test permit local key; production requires KMS vendor named per D-27. |
| **Database** | `MONGO_URL` | Required. `?directConnection=true` must **not** be present (local stack runs without `--replSet`). |
| **Cache/Queue** | `REDIS_CACHE_URL` | Required. Cache tier, must be separate from queue per D-12. `maxmemory-policy: noeviction` (evicting keys). |
| | `REDIS_QUEUE_URL` | Required. Queue tier, must be separate from cache per D-12. `maxmemory-policy: noeviction` (never evicts). |
| **Crypto** | `CRYPTO_KEY_PROVIDER` | Required. `local` or `kms`. `local` development only; `kms` refused until a cloud is named (D-27 / blocker B-3). |
| | `CRYPTO_LOCAL_KEY_FILE` | Required when `CRYPTO_KEY_PROVIDER=local`. Path to 32-byte key file; the path, never the key. |
| **Observability** | `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional. Absent is legal; malformed fails boot with `CONFIG_INVALID: OTEL_EXPORTER_OTLP_ENDPOINT`. |
| **Process identity** | `SERVICE_NAME` | Required. Identifies which of the three processes this is (api/worker/scheduler). Derives default port. |
| **Port overrides** | `PORT` | Optional. Defaults per `SERVICE_NAME`: api 3000, worker 3001, scheduler 3002. Set only to move one process off its default. |

### Validation tokens

Every failure is greppable and names the offending key:

| Token | Meaning |
|-------|---------|
| `CONFIG_INVALID: <KEY> <code>` | Missing or malformed value. `<KEY>` is the dotted path to the offending value, or `<root>` for the whole config. |
| `CONFIG_INVALID: <root> REDIS_INSTANCES_NOT_DISTINCT` | The two Redis URLs name one instance. They must be two — see D-12. |
| `CRYPTO_KEY_PROVIDER_REQUIRED:` | A local key outside `NODE_ENV=development or test`, with no explicit operator opt-in. Refused before the key file is read. |
| `KMS_PROVIDER_BLOCKED:` | The KMS provider is selected and has no adapter yet. Named failure, on purpose. |
| `LOCAL_KEY_FILE_MISSING:` | The variable `CRYPTO_LOCAL_KEY_FILE` is unset or empty. About the variable, never about the file. |
| `ENOENT: no such file or directory, open '<path>'` | The variable is set and the file it names is not there (normal state of fresh checkout). Provision with `head -c 32 /dev/urandom > .dev-local-key`. |
| `CONFIG_INVALID: SERVICE_NAME` | `SERVICE_NAME` is unset or has a value that doesn't match a configured process. |
| `CONFIG_INVALID: OTEL_EXPORTER_OTLP_ENDPOINT` | The OTel endpoint is malformed. |

## Configuration Loading

### Boot sequence

1. `ConfigModule.forRoot()` is called — **it is `async` in `@nestjs/config@12`**
2. The `useFactory` runs over `process.env` and returns a validated configuration object
3. Zod `.strict()` validates the entire config — any missing or malformed value fails boot with a named token
4. The application modules resolve their providers using the configured values

### Important: `forRoot()` is `async`

```typescript
// Don't do this — ConfigModule.forRoot() returns a module await:
@Module({
  imports: [ConfigModule.forRoot({ validate: (env) => ({}) })], // wrong: not awaited
})
```

Instead, NestModule lifecycle should handle the async:

```typescript
// Correct pattern — use async register or lifecycle hooks
```

### Two Redis deployments, not one

D-12 requires the cache and queue tiers to be **two separate Redis instances**. `maxmemory-policy` is instance-wide, so a logical-database suffix (`/0` vs `/1`) cannot express the split: the cache tier must be evicting and the queue tier must never evict.

- `REDIS_CACHE_URL=redis://127.0.0.1:6379` — cache tier (evicting, short TTL)
- `REDIS_QUEUE_URL=redis://127.0.0.1:6380` — queue tier (never evicts, BullMQ home)

Collapsing them to one instance fails boot with `CONFIG_INVALID: <root> REDIS_INSTANCES_NOT_DISTINCT`.

### Crypto guard

- `NODE_ENV=development or test` + `CRYPTO_KEY_PROVIDER=local` + key file present → boots fine
- `NODE_ENV=production` + `CRYPTO_KEY_PROVIDER=local` → refuses with `CRYPTO_KEY_PROVIDER_REQUIRED:` (before key file is even read)
- `NODE_ENV=production` + `CRYPTO_KEY_PROVIDER=kms` → refused with `KMS_PROVIDER_BLOCKED:` until a cloud is named (D-27 / blocker B-3)
- `NODE_ENV` outside `development/test` with no explicit opt-in → `CRYPTO_KEY_PROVIDER_REQUIRED:` (the active line rewrites `NODE_ENV`)

### Sourcing `.env.example` is risky

```bash
# ❌ DANGEROUS — rewrites NODE_ENV
set -a; . ./.env.example; set +a

# ✅ SAFE — adopt values without rewriting NODE_ENV
set -a; . ./.env.example; set +a; export NODE_ENV=development
```

The `.env.example` file carries an active `NODE_ENV=development`, and `set -a; . ./.env.example` assigns every active line — so it overwrites whatever `NODE_ENV` your shell already had. Source the file and then re-export `NODE_ENV` yourself, or set only the two variables you actually need inline instead of sourcing the whole file.

## Per-Process Configuration

Each of the three processes has slightly different default configuration, derived from `SERVICE_NAME`:

| Variable | api default | worker default | scheduler default |
|----------|-----------|-----------|------------------|
| `PORT` | 3000 | 3001 | 3002 |
| `SERVICE_NAME` | api | worker | scheduler |

These defaults are documented in `README.md`. Override them only when necessary (e.g., port conflict).

## Boot Traps

### The `.env` sourcing trap

This project does **not** load a `.env` file. `ConfigModule.forRoot()` validates `process.env` only.

```bash
# ❌ Do NOT do this:
set -a; . ./.env.example; set +a

# ❌ This silently disarms the crypto guard:
#   NODE_ENV=production → overwritten to development by .env.example sourcing

# ✅ Do this instead:
# 1. Source the file
set -a; . ./.env.example; set +a
# 2. Re-export NODE_ENV consciously
export NODE_ENV=development
# Or: set only the variables you need inline:
NODE_ENV=development OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
```

### The port trap

If a process dies immediately after printing `Nest application successfully started`, check whether another process already occupies the default port. Each process defaults to `3000`/`3001`/`3002`, but `PORT` can override per process.

### The MongoDB trap

`MONGO_URL` must **not** include `?directConnection=true`. The local stack runs MongoDB without `--replSet`, so the driver doesn't need (and would fail with) that parameter. See `README.md` for details.

### The Redis trap

Two Redis deployments are required (cache + queue). Collapsing them to one instance fails boot with `CONFIG_INVALID: <root> REDIS_INSTANCES_NOT_DISTINCT`. `maxmemory-policy` is instance-wide — one instance cannot safely be both evicting and non-evicting.

## Configuration Per App

While the core env schema is shared across all three processes, some values are per-process:

- `SERVICE_NAME` — determines the process identity and default port
- `PORT` — overrides the default port for that process
- `OTEL_EXPORTER_OTLP_ENDPOINT` — can be different per process if desired (e.g., different collector endpoints for api vs worker)

All other env vars are shared across the platform and must be consistent across all three processes (same Redis URLs, same MongoDB URL, same crypto config).

## Verifying Configuration at Boot

After starting a process, verify it boots correctly:

```bash
# Check liveness (no deps read)
curl -s http://127.0.0.1:3000/health/live    # {"status":"ok"}

# Check readiness (all deps named)
curl -s http://127.0.0.1:3000/health/ready   # named each dep up
```

If either endpoint fails, check the console output for the named token (e.g., `CONFIG_INVALID: MONGO_URL`, `CRYPTO_KEY_PROVIDER_REQUIRED:`, etc.).

## Development workflow for config changes

1. Update `.env.example` (add/remove/modify keys)
2. Run `npm run build` to recompile
3. Boot a process and verify: `SERVICE_NAME=api npm run start:api`
4. Run the test suite: `npm test` — integration tests start real MongoDB + Redis and validate the config boot path

If a new env key is added, the Zod schema in `packages/platform/src/config/config.module.ts` must be updated accordingly (plan 10 owns this).