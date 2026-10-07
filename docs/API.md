# API — aka-nexa

## HTTP API EntryPoint

The `api` process (`SERVICE_NAME=api`, default port 3000) exposes a NestJS HTTP API via the Express adapter. It is the entry point for inbound webhooks (slash commands, mentions, messages) from all four IM platforms (Slack, Teams, Zalo, Telegram) and the gateway for signed read links.

### Core endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health/live` | Liveness — reads no dependency. A blip in a dependency must never restart an otherwise healthy process. |
| `GET` | `/health/ready` | Readiness — names MongoDB, the cache Redis and the queue Redis separately. |
| `POST` | `/webhook/:platform` | Inbound webhook from an IM platform (Slack/Teams/Zalo/Telegram). Ack in <200 ms, enqueues `InboundEvent` to BullMQ. **Nothing expensive runs here** (no permission lookup, no DB read, no LLM call). |
| `GET` | `/links/read/:jti` | Verify a signed read link (JWT, `perm_version` comparison, no Redis storage). Returns the linked data if valid. |
| `POST` | `/links/consume` | Consume a one-time write link (GETDEL in Redis, atomic token consumption, NFR-SEC-1). |

### Webhook contract (pure ingest)

The webhook receiver is a **pure ingest contract**:

- Acks in **<200 ms**
- Enqueues a message ID to BullMQ
- **All logic runs in the consumer** (worker process): identity resolution, RBAC filter, JEV routing, form issuance, submission routing
- No permission lookup, no DB read, no LLM call, no connector call
- Trace ID propagates from receiver into consumer via manual OTel (NFR-O-1)

### Platform-specific webhook routes

| Platform | Route | Handler |
|----------|-------|---------|
| Slack | `POST /webhook/slack` | `@slack/bolt@5` `ExpressReceiver`, signing secret HMAC-SHA256 verification |
| Teams | `POST /webhook/teams` | Microsoft 365 Agents SDK `authorizeJWT()`, JWT validation |
| Zalo | `POST /webhook/zalo` | Hand-rolled client over `undici`, OA-provided verification field |
| Telegram | `POST /webhook/telegram` | `node-telegram-bot-api@2.1.0`, secret token header comparison |

### Signed read links

- **Format**: JWT signed with `jose` (asymmetric, ES256) with `kid` in protected header
- **Verification**: `jose.jwtVerify(token, key, { keyResolver })` where `kid` → live keyring entry
- **No Redis storage**: stateless, scales to millions of outstanding read links without memory pressure
- **Invalidation**: monotonically increasing `perm_version` per user-per-app; fresh permission check on every access
- **90-day dual-key rotation** (NFR-SEC-9): `jose`'s `keyResolver` maps `kid` → live keyring entry; zero downtime

### One-time write links (consume)

- **Atomic consumption**: Redis `GETDEL` — gets and deletes in one operation, race-condition safe
- **`perm_version` comparison**: on every access, the link's `perm_version` is compared against the user's current version
- **After consume**: the link is invalidated; a new submission generates a new link

### Connector layer

The API also serves as the gateway for external connector calls. Shared, globally managed credentials with rate limiting, retries, DLQ, and `submission_id` idempotency. The API validates and enqueues connector tasks to the worker BullMQ queue.

## API Module Structure

```
apps/api/src/
  main.ts          — Nest entrypoint, OTel initializer, health controllers
  app.module.ts    — Module composition root, provider wiring
  webhook/         — platform-specific webhook handlers
    slack.guard.ts — @slack/bolt@5 signing secret verification
    teams.guard.ts — JWT authorization via Agents SDK
    zalo.guard.ts  — hand-rolled OA verification over undici
    telegram.guard.ts — secret token header comparison
  link/            — signed link handlers
    read.guard.ts  — JWT verification via jose
    consume.guard.ts — Redis GETDEL atomic consumption
  health/          — /health/live and /health/ready controllers
  config/          — Zod-validated ConfigService
```

## Rate Limiting

Three named throttlers (via `@nestjs/throttler@6.7.1`):

| Throttler | Limit | Scope |
|-----------|-------|-------|
| `perUser` | 10 / min | Per-user rate limit (NFR-SEC-6) |
| `perApp` | 100 / min | Per-app rate limit (NFR-SEC-6) |
| `perConnector` | per config | Per-connector rate limit (NFR-SEC-6) |

Storage is a hand-written `ThrottlerStorage` over ioredis (~40 lines). Both community Redis throttler packages are dead/unsuitable (`kkoomen/throttler-storage-redis` 405/deprecated; `@nest-lab/throttler-storage-redis` peers NestJS ≤11; `@nestjs-redis/throttler-storage` peers node-redis which contradicts ioredis decision).

## Boundary Enforcement

The API code lives under `apps/api/src/`, element type `app-api`. Boundary policies prevent:

- `app-worker`/`app-scheduler` from importing from `app-api` (R1/R2/R3 via `eslint-plugin-boundaries@7.2.0`)
- Third-party deps that are not explicitly allowed

The boundary lint rule must pass (`npm run lint`) before any PR is accepted.

## OpenAPI (Swagger)

- `@nestjs/swagger@12.0.2` reads **Standard Schema** (Zod DTOs document themselves)
- Wiring: `SwaggerModule.createDocument(app, config, { standardSchemaModelConverter })` plus `@ApiCreatedResponse({ standardSchema: schema })` — **not** calling `z.toJSONSchema()` yourself
- TS peer is optional (warns only, §3.2 #2); the hard `ERESOLVE` comes from `typescript-eslint@8.71.0`
- CORS is not configured by default; configure per-deployment needs

## WebSocket (future)

Not in v1. WebSocket support would require a second HTTP stack (Fastify) or running WS alongside Express in the same process — both rejected by the Express-only constraint (Bolt 5 bundles `express@^5`; OTel bundles `instrumentation-express` but not `instrumentation-fastify`).