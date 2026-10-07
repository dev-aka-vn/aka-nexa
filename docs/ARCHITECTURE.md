# Architecture — aka-nexa

## Overview

**aka-nexa** is an enterprise platform that turns Instant Messaging systems (Slack, Microsoft Teams, Zalo, Telegram) into the front door for internal systems (Redmine, HR, ERP, ticketing, procurement, asset management). The core value: an employee completes a cross-system task entirely through chat plus a single rendered FormIO.js form, without ever logging into or learning the downstream system.

It is a **modular monolith** — one NestJS codebase, three process entrypoints (`api` / `worker` / `scheduler`), one DI graph enforcing component boundaries at wiring time, backed by a lint rule that fails the build on a boundary violation.

## High-Level Layout

```
packages/          # Shared libs and domain logic
  contract/        # Frozen JEV wire contract, read-link claims, token class config
  domain/          # Per-app business logic and decision models
  platform/        # NestJS framework wiring, guards, bootstrapping, OTel, pino
apps/              # Three independently runnable entrypoints
  api/             # HTTP API (Express adapter, webhooks, health endpoints)
  worker/          # BullMQ consumer, async connector execution, job schedulers
  scheduler/       # Cron-based job scheduling, platform heartbeat
tooling/           # Container scripts, import resolver, boundary fixtures
```

## EntryPoints

| Process | Port (default) | Purpose | Key Files |
|---------|---------------|---------|-----------|
| `api` | 3000 | HTTP API, webhook receiver, health checks | `apps/api/src/main.ts`, `app.module.ts` |
| `worker` | 3001 | BullMQ consumer, async job execution | `apps/worker/src/main.ts`, `processors/` |
| `scheduler` | 3002 | Job schedulers, platform heartbeat | `apps/scheduler/src/main.ts` |

All three share the same DI graph and boundary configuration via `packages/platform/src/`. Each process answers two health endpoints: `/health/live` (liveness, no deps) and `/health/ready` (readiness, names each dependency).

## Runtime Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | **Node.js 24 LTS** | Amends PRD "Node 20+"; Node 20 hit EOL 2026-04-30; only line with ≥18 months runway |
| Framework | **NestJS 12.1.2** | Ships Standard Schema; Zod 4 is first-class; class-validator/class-transformer are dead weight; CommonJS apps keep working |
| Language | **TypeScript 6.0.3** (hard-pinned) | npm `latest` (7.0.2) breaks `@nestjs/swagger@12` peer range and risks decorator-metadata breakage; `typescript-eslint@8.71.0` enforces `<6.1.0` |
| HTTP adapter | **Express** (via `@nestjs/platform-express`) | `@slack/bolt@5` bundles `ExpressReceiver` on `express@^5`; OTel auto-bundle has `instrumentation-express` but not `instrumentation-fastify`; `instrumentation-fastify@0.57.0` is deprecated |
| Validation | **Zod 4.6.5** + `StandardSchemaValidationPipe` | Replaces `class-validator/class-transformer`; one schema is the single source of truth (validates at runtime *and* infers TypeScript type) |
| Database | **MongoDB 8.0.x** + native `mongodb` driver | Runtime-defined schemas (App Builder defines fields at runtime); Mongoose's compile-time `Schema` has no value here; `instrumentation-mongodb` traces raw driver at no extra OTel cost |
| Cache / Tokens / Queue | **Redis 8.2+ cluster** + **ioredis 6** + **BullMQ 6.3.11** | ioredis is shared across app and workers ( halves connection surface); BullMQ provides retries, DLQ, Job Schedulers; `GETDEL` (since 6.2.0) for atomic one-time token consumption |
| JWT / Link tokens | **`jose` 6.2.12** | Replaces `@nestjs/jwt`/`jsonwebtoken`; supports JWKS, `kid`-keyed keyring resolution, and `keyResolver` for 90-day dual-key rotation (NFR-SEC-9) without downtime |
| OIDC SSO | **`openid-client` 6.8.8** | Admin SSO with MFA; 16.7M dl/week, actively maintained, depends on `jose` + `oauth4webapi` (same primitives already chosen) |
| Observability | **manual OTel** (SDK + 49 auto-instrumentations) | Exporters: trace/metrics/logs → OTLP HTTP → Tempo/Jaeger; `exporter-prometheus` for single metrics path; pino for structured JSON logs; `@nestjs/terminus` for health checks |
| Rate limiting | **@nestjs/throttler 6.7.1** + hand-written `ThrottlerStorage` over ioredis | Three named throttlers (per-user 10/min, per-app 100/min, per-connector per config); both community Redis throttler storages are dead/unsable; hand-write ~40 lines over ioredis already owned |
| RBAC | **`@casl/ability` 7.0.1** | Replaces deprecated `casl`; capability-based authorization |
| Password / OTP hashing | **`@node-rs/argon2` 2.2.1** | Ships prebuilt N-API binaries — no `node-gyp` in CI or K8s image; engines `>=10` |
| Form renderer | **`@formio/js` 5.6.1** | MIT, dual CJS/ESM, ships drag-and-drop builder (dragula is a direct dep); `formiojs` 4.x is in maintenance mode |
| React | **19.3.0** | Current stable; forms rendered as standalone React web app |
| Vite | **8.3.2** | Current stable; build/dev server |
| ESLint | **10.11.0** + `eslint-plugin-boundaries@7.2.0` | Architecture enforcement; boundary violation fails the build; `typescript-eslint@8.71.0` supports ESLint `^8.57 \|^9 \|^10` |

## Component Boundaries

The boundary lint rule (``eslint-plugin-boundaries@7.2.0``) enforces these element types:

- `app-api` — files under `apps/api/src/`
- `app-worker` — files under `apps/worker/src/`
- `app-scheduler` — files under `apps/scheduler/src/`
- `packages/contract` — shared JEV wire contract
- `packages/domain` — per-app business logic
- `packages/platform` — NestJS framework wiring, guards, bootstrapping

Policies (last-match-wins, `disallow` beats `allow`):

- R1: `from: { element: { type: "!(app-api)" } }` — worker/scheduler cannot import from api
- R2: `from: { element: { type: "!(app-worker)" } }` — scheduler cannot import from worker
- R3: `from: { element: { type: "!(app-scheduler)" } }` — api/worker cannot import from scheduler
- Third-party allow: broad permission for deps not explicitly restricted
- `checkAllOrigins: true` — governs on target's origin, not source's

The `tooling/import-resolver.cjs` is load-bearing without it every relative import in the repo is unresolvable and boundaries report zero problems on a tree full of violations.

## Process Communication

- **Webhook receiver** (api): pure ingest contract — acks in <200 ms, enqueues message ID, **nothing expensive runs here** (no permission lookup, no DB read, no LLM call)
- **Consumer** (worker): identity resolution, RBAC filter, JEV routing, form issuance, submission routing
- **Job Schedulers** (scheduler): idempotent `upsertJobScheduler` per boot, converges on a single registered scheduler via live Redis proof
- **State**: application services stateless, all session state in Redis, no sticky sessions

## Data Flow (典型)

1. User types a slash command or plain-language request in chat (Slack/Teams/Zalo/Telegram)
2. Inbound webhook receiver acks in <200 ms, enqueues an `InboundEvent` message to BullMQ
3. Worker consumer processes the message:
   - Identity resolution: `chat_user_id` → `real_user_id` (CSV import or lazy OTP onboarding)
   - RBAC filter: per-app roles and permissions
   - JEV routing: swappable decision model picks the right app
   - Form issuance: signed read link (JWT, `perm_version` comparison, no Redis storage)
   - Submission routing: MongoDB internal storage **or** external connector call **or** both
4. Form renderer (separate static web app) verifies the signed link via `jose` and renders the FormIO.js form
5. Submitted data flows through FormIO.js → internal document storage (MongoDB) → external system via connector (async, BullMQ)

## Diagrams (described)

- **Webhook → Consumer trace**: trace ID = `submission_id` propagated end-to-end via manual OTel (no shared Pub/Sub as correctness mechanism; `perm_version` embedded in cache keys serves both RBAC cache and read-link check)
- **Three processes**: each has its own OTel initializer (`otel.mjs` via `--import`), shares no in-process state, communicates through Redis (two separate deployments: cache on 6379, queue on 6380, `maxmemory-policy=noeviction` on queue, evicting on cache)
- **Token lifecycle**: `GETDEL` atomic consumption in Redis → verified `perm_version` on every access → tombstoneable `actor_ref` for erasure

## Key Directories (source-level)

| Directory | Purpose |
|-----------|---------|
| `packages/contract/src/` | Frozen JEV wire contract, token class config, read-link target rules |
| `packages/domain/src/` | Per-app business logic, decision model interfaces, repository shapes |
| `packages/platform/src/` | NestJS app module, bootstrap (OTel, pino, health indicators), boundary manifest, guards |
| `apps/api/src/` | HTTP API, webhook handlers, inbound event processor, health controllers |
| `apps/worker/src/` | BullMQ consumer, processors (inbound-event, links, connectors), job scheduler wiring |
| `apps/scheduler/src/` | Cron-based scheduling, platform heartbeat, job scheduler bootstrap |