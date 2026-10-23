# Walking Skeleton — IM-Driven App Builder & Integration Gateway

**Phase:** 1
**Generated:** 2026-10-02

## Capability Proven End-to-End

An operator starts any of the three processes (`api`, `worker`, `scheduler`) from a clean
checkout on the pinned stack, and that process answers `GET /health/live` (no dependency) and
`GET /health/ready` (MongoDB **and both** Redis deployments) over configuration that was
Zod-validated at boot — while the same source tree fails the **build** when one component
imports across a declared boundary or when the three entrypoints drift toward one process.

This is the Phase-1 special case of the tracer: it carries no product feature, but it touches
every architectural layer the project will ever use — workspaces scaffold, pinned toolchain,
Zod config, Nest DI, Mongo, two Redis profiles, BullMQ queue registration, OTel bootstrap,
Pino logging, the boundary lint rule, and the per-app bootstrap shape — end-to-end, so a dead
end is found after one commit rather than after ten committed feature layers.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | Node **24 LTS** (`.nvmrc`, lockfile, Dockerfile, CI all pinned) | Node 20 hit EOL 2026-04-30; Node 22 expires too soon; NFR-SEC-12 (critical vulns block deploy) is unachievable on an EOL runtime (D-01, FND-01). |
| Framework | NestJS **12.1.2** on the **Express** adapter | Standard Schema makes Zod first-class; Express is forced by `@slack/bolt@5`, by OTel shipping `instrumentation-express` and not `instrumentation-fastify`, and by the supported Teams host (D-08). |
| Language | TypeScript **6.0.3 exactly pinned** (no caret/tilde) + committed `package-lock.json` | npm `latest` (7.x) hard-fails `typescript-eslint`'s peer range; a lockfile-free install is the deliberate CI guard, not the default (D-06, FND-01/FND-02). |
| Module system | **ESM** for all three `apps/*` and all `packages/*` (`"type": "module"`) | `jose` and `openid-client` are ESM-only; a CJS/ESM mix across the three entrypoints is exactly the drift FND-03 forbids. Decide once, in Phase 1. |
| Process topology | **Modular monolith**, three process entrypoints (`api` :3000, `worker` :3001, `scheduler` :3002), one DI graph | Boundaries enforced at lint time (`eslint-plugin-boundaries@7.2.0`) plus a runtime boot assertion; no microservices (D-01, D-02, D-03). |
| Data layer | MongoDB **8.0.x** via the **native `mongodb` driver** (no Mongoose) | App-builder schemas are runtime-defined, so a compile-time `Schema` model adds a second serialization layer for no benefit; `instrumentation-mongodb` covers the raw driver (D-07). |
| Cache / queue | **Two distinct Redis deployments** — cache (evicting, `REDIS_CACHE`) and queue (`noeviction`, `REDIS_QUEUE`) — ioredis **6.0.0**, BullMQ **6.3.11** with hash-tag prefix `{akane-q}` | `maxmemory-policy` is instance-wide, so one instance cannot serve both; the split is a boot failure, not a convention (D-12, D-13, D-14). |
| Config / validation | **Zod 4.6.5** through NestJS 12 Standard Schema; named `CONFIG_INVALID: <path>` boot errors | Replaces class-validator/class-transformer; one schema validates at runtime and infers the handler type (D-08, FND-09). |
| Logging | Pino 10 / nestjs-pino, with a **frozen field allowlist** enforced in `formatters.log` **before** serialization; `error.cause` chains dropped | PII must be excluded before serialization; `redact` is a denylist and misses computed keys; this is the security control behind the narrowed erasure promise (D-15, D-16, D-17, FND-06). |
| Observability | Manual OpenTelemetry (`@opentelemetry/sdk-node` 0.222.0) via a per-app `otel.mjs` loader; **one metrics path** (OTLP + Prometheus exporter, no `prom-client`); frozen span-attribute allowlist | OTLP export to Tempo/Jaeger is confirmed; `@nestjs/observe` is rejected (no OTLP exporter). A trace must never carry or be seedable from `submission_id` (D-18, D-20, FND-07, OBS-01). |
| Secrets / crypto | `KeyProvider` interface + `LocalKeyProvider` (refuses `NODE_ENV=production`) + AES-256-GCM envelope; production without `CRYPTO_KEY_PROVIDER=kms` fails boot | The KMS vendor is unnamed, so the interface ships and the vendor adapter is a recorded blocker; Phase 1 stores no real secret (D-25, D-26, D-27, D-28, FND-10). |
| Frozen contracts | Versioned Zod schemas under `packages/contract` — JEV v1 wire contract (RTE-10) and the 15-claim read-link JWT (LNK-07) — each with a `.strict()` object **and** a frozen-key-set test | Both are irreversible once links and providers are live; the test makes adding a field a failing build rather than a silent break (D-21, D-23, D-24). |
| Test stack | **Vitest 5.0.3** unit/integration + `testcontainers` 12.2.0 (Mongo 8.0 + two Redis) for real dependency semantics; Playwright deferred to feature phases | Mocks would not catch `GETDEL` atomicity or BullMQ retry/DLQ behaviour, the two highest-risk behaviours (FND-04/D-04). |
| Deployment target | **Not in Phase 1** — no Kubernetes manifests or probe wiring (D-11); local full-stack run is the testcontainers harness + `npm run start:api` | Probe wiring is deliberately deferred; the health endpoint shape is what Phase 1 owes. |

## Stack Touched in Phase 1

- [x] Project scaffold (npm workspaces, TypeScript project references, ESLint + boundaries, Vitest, CI build gate + deleted-lockfile install guard)
- [x] Routing — at least one real route (`/health/live`, `/health/ready`, `/metrics` on all three apps; ports 3000/3001/3002)
- [x] Database — real connection pool and `ping()` against real Mongo 8.0 and real ioredis connections against two real Redis containers; the first product read/write lands in Phase 2
- [ ] UI — **no UI in Phase 1** (frontend apps are Phase 3+); the observable surface is the HTTP health/metrics endpoints
- [x] Deployment — documented local full-stack run (testcontainers harness + three `npm run start:*` commands); no dev-environment deploy (D-11)

## Out of Scope (Deferred to Later Slices)

> Anything that is *not* in the skeleton. Be explicit — this list prevents future phases from
> re-litigating Phase 1's minimalism.

- Any product feature — no Slack/Teams/Zalo/Telegram adapter, no form rendering, no routing, no submission (Phases 2+).
- Kubernetes manifests and probe wiring (D-11).
- The concrete KMS vendor adapter — AWS KMS / GCP KMS / Vault transit (D-27, blocked on naming the deployment cloud; ships `KMS_PROVIDER_BLOCKED:` until then).
- SAML support (D-30) and the MongoDB 9.0 re-evaluation (D-31).
- Form.io `File` component licensing and file upload (D-29).
- Draft-save / resume state machine — only the reserved `action: "draft"` enum value and the `ak:tok:draft:{jti}` namespace land (D-22).
- Decision-model provider selection, hosting, cost profile, and accuracy/legal framing (D-33).
- Frontend applications (Form Renderer, App Builder) — Phase 3+.
- Any real secret storage — the first stored secret is a connector credential in Phase 5 (D-28).

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its
architectural decisions:

- Phase 2: `/leave request` in Slack → signed link → rendered form → audited submission in chat (identity, per-app RBAC, one-time link security).
- Phase 3: Plain-language routing — a user reaches the right app by describing it, even with every hosted decision provider down.
- Phase 4: 90-day stateless read/query links that die the instant permission changes.
- Phase 5: Connectors, transactional outbox, hybrid routing, and the three-state outbound model.
- Phase 6: Self-service App Builder — a department admin publishes a working app with no engineering ticket.
- Phase 7: Teams parity plus signed inbound webhooks that notify the original submitter.
- Phase 8: 3-year auditable trail, erasure/purge workflows, full metric + alert suite, 1,000-user load test.
