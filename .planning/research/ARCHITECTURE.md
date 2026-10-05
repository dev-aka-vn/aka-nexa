# Architecture Research

**Domain:** Chat-driven enterprise workflow gateway — IM adapters → permission-first routing → signed one-time links → FormIO.js forms → hybrid data routing (MongoDB / connector / both)
**Milestone context:** Greenfield. No existing code. `PRD.md` v2.0 §7 is the authoritative baseline; `.planning/PROJECT.md` carries the adopted amendments.
**Researched:** 2026-10-01
**Confidence:** HIGH on component boundaries, the webhook ingest contract, the hybrid transactional boundary, the read-path verification sequence, and all Redis/BullMQ operational constraints (all verified against official documentation). MEDIUM on the JEV fallback latency budget and on the exact Redis Cluster failover blast radius for this workload.

---

## Verdict — the seven findings that change the PRD

This document does not restate PRD §7. It stress-tests it. Seven conclusions, in the order they matter:

| # | Finding | Verdict |
|---|---------|---------|
| 1 | **BullMQ `jobId` deduplication does not survive `removeOnComplete`.** Official docs: *"Jobs that are removed from the queue (either manually, or when using settings such as `removeOnComplete`/`removeOnFailed`) will **not** be considered as duplicates."* So a BullMQ `jobId` cannot be the durable write-once record FR-D-12 requires. | **The durable idempotency guarantee must be a MongoDB unique index**, not Redis and not BullMQ. GETDEL stays as the fast-path race closer; it is not the guarantee. |
| 2 | **BullMQ requires `maxmemory-policy=noeviction`,** and its docs carry this as a `DANGER`. The PRD's Redis runbook says *"Redis OOM → evict expired keys"* and its alert fires at 80% memory. `maxmemory-policy` is instance-wide, so the cache and the queue **cannot** share an eviction policy. | **Amendment:** two Redis deployments. `noeviction` for queue + tokens, evicting policy for cache. Non-negotiable, not a preference. |
| 3 | **BullMQ's internals require atomic operations spanning multiple keys,** which "breaks Redis's rules for cluster configurations." The documented workaround is a `{hash-tag}` queue prefix, which **pins all queue keys for that prefix to one hash slot** — i.e. one cluster node. | Queue throughput does not scale across the cluster. Fine at this scale, but it must be stated: cluster *memory* is the scaling axis, not queue parallelism. |
| 4 | **Redis Pub/Sub is at-most-once.** FR-I-6 and FR-R-9 both specify "immediate invalidation via pub/sub." A dropped message means a stale permission read. | **Epoch-keyed cache keys replace Pub/Sub as the correctness mechanism.** Pub/Sub becomes a latency optimisation only. One primitive (`perm_version` in the cache key) then serves *both* the RBAC cache and the read-link security check. |
| 5 | **Redis Cluster replication is asynchronous; acknowledged writes can be lost on failover.** Therefore Redis `GETDEL` can be acknowledged and then un-happen — a consumed one-time link can come back. The PRD's own runbook already anticipates this (*"Check Redis cluster split-brain"*) but specifies no second line of defence. | **A MongoDB `unique` index on `submissions.link_jti` is the actual anti-double-submission guarantee.** Two independent guards, neither load-bearing alone. |
| 6 | **The fallback chain can overrun the request budget.** PRD §11.4 chains `500 + 1000 + 50 ms` = 1550 ms of decision latency against an NFR-P-5 end-to-end target of 2000 ms, before identity, RBAC, or link generation have run. | **A deadline must be propagated down the chain.** Skip to the next provider if the remaining budget cannot accommodate it; fall straight through to `RuleBasedProvider` when it cannot. |
| 7 | **Slash commands should bypass the ack window entirely.** Slack acks within 3 s; `response_url` is valid for up to 5 responses within 30 minutes. | Ack empty immediately, deliver the link asynchronously. The 2 s end-to-end budget and the 3 s ack budget stop contending for the same request. |

The single most consequential structural amendment: **the PRD's §7.1 linear pipeline is wrong as an execution model.** It puts the rate limiter before identity and the whole pipeline before the response. Both are correct only for a synchronous request. With a pure-ingest receiver, none of that pipeline runs inside the ack window — the pipeline runs in the worker, driven by a queued event. The PRD needs a second diagram that distinguishes *ingest* from *processing*.

---

## Standard Architecture

### System Overview

Three process entrypoints, one codebase, one DI graph. The diagram below shows **deployment-level** process boundaries and the trust boundaries between them. The component-level decomposition is in the next section.

```
        ┌──────────────────────────────────────────────────────────────────┐
  T1    │  INTERNET  (IM platforms · employee browsers · external systems) │
        └───────────────────────────────┬──────────────────────────────────┘
                                        │ TLS terminated at LB / ingress
  T2    ┌───────────────────────────────▼──────────────────────────────────┐
        │  INGRESS  nginx / ALB   — IP rate limit, body-size cap, no app  │
        └───────┬──────────────────────────────────────────┬───────────────┘
                │ webhook POST (Slack/Teams/Zalo/TG)      │ HTTPS (browsers)
                │ untrusted                               │ untrusted
  ┌─────────────▼──────────────┐        ┌──────────────────▼───────────────┐
  │  PROCESS: api              │        │  STATIC: form-renderer / builder │
  │  NestFactory.create()       │        │  Vite build → CDN (no secrets,   │
  │  NestFactory rawBody:true   │        │  no cookies, public JWKS only)   │
  │                             │        │  ── or ──> same origin as api    │
  │  ├─ IM adapters (inbound)   │        └──────────────────┬───────────────┘
  │  ├─ Link API (issue+verify) │                           │ bearer = JWT in URL
  │  ├─ Submission API          │◄──────────────────────────┘
  │  ├─ Builder API (SSO)       │
  │  ├─ /webhooks/inbound (T9)  │
  │  └─ NO connector HTTP       │
  │  └─ NO BullMQ workers       │
  └───┬───────────────┬─────────┘
      │               │
      │  pipeline     │  enqueue only
      │  (in-process) │  never awaits a worker
  T3  │               │
  ┌───▼───────────────▼─────────┐        ┌──────────────────────────────┐
  │  MongoDB 8 replica set (3)  │        │  Redis  — TWO deployments    │
  │  source of truth for:       │        │  ┌────────────────────────┐  │
  │   identity, rbac, apps,     │        │  │ cache  (evicting)     │  │
  │   submissions, audit,       │        │  │ toolset, jev, rate    │  │
  │   OUTBOX, DELIVERIES        │        │  ├────────────────────────┤  │
  │   (+ durable unique idx)    │        │  │ queue+tokens          │  │
  └──────────────▲──────────────┘        │  │ (noeviction)          │  │
                 │                       │  │ bullmq, ak:tok:*      │  │
                 │ relay / result        │  └────────────────────────┘  │
  ┌──────────────┴───────────────────────┴──────────────────────────────┐
  │  PROCESS: worker                                                   │
  │  NestFactory.createApplicationContext()  — no HTTP server          │
  │  ├─ InboundRouter    (consumes im.inbound; runs identity→JEV→link) │
  │  ├─ ConnectorRunner  (consumes connector.execute)                 │
  │  ├─ ImDispatcher     (consumes im.outbound;  T4/T5 egress)         │
  │  ├─ DataRouter       (hybrid coordinator, partial-status)          │
  │  └─ NO http controllers, NO builders                              │
  └──────────────────────────┬────────────────────────────────────────┘
                             │ upsertJobScheduler (idempotent)
  ┌──────────────────────────▼────────────────────────────────────────┐
  │  PROCESS: scheduler  — createApplicationContext(), no HTTP         │
  │  ├─ OutboxRelay        (outbox → connector.execute)                │
  │  ├─ DeliveryRelay     (delivery_log → im.outbound)                 │
  │  ├─ JevHealthProbe    (60 s, provider circuit state in Redis)     │
  │  ├─ ConnectorHealth   (60 s)                                      │
  │  ├─ KeyRotation       (90 d dual-key, NFR-SEC-9)                  │
  │  ├─ RetentionPurge    (FR-LC-4/5)                                 │
  │  └─ OutboundRetry     (im.outbound exhausted → DLQ → re-drive)    │
  └───────────────────────────────────────────────────────────────────┘

  T4  egress: connector HTTP + connector credentials (KMS unwrapped here only)
  T5  egress: IM platform HTTP (chat.postMessage / response_url)
  T6  egress: KMS / Vault
  T9  ingress: external-system webhooks → HMAC-verified receiver (same ingest contract as T2)
```

**Why three entrypoints is the right split.** `api` is request-latency-bound and scales on request rate. `worker` is third-party-latency-bound (connector timeouts up to 30 s, NFR-C-11) and scales on connector throughput — running it inside `api` would let 30 s connector calls consume web-server concurrency and blow the 200 ms ack budget. `scheduler` is calendar-bound and must be durable (§7.3's rejection of `@nestjs/schedule` — an in-memory cron that silently doesn't run on one pod is a *security* failure for key rotation, not a bug). **The split is correct. Amend what each entrypoint is allowed to load** — see the boundary matrix below, because without that the split is three copies of one process.

### Component Responsibilities

| Component | Owns | Never does |
|-----------|------|------------|
| `PlatformModule` | Config (Zod-validated), Mongo client, two Redis clients, BullMQ wiring, KMS crypto, OTel bootstrap, `undici` fetch wrapper | Knows nothing about apps, users, or IM |
| `KernelModule` | Shared Zod schemas + types: `InboundEvent`, `OutboundMessage`, `AppSpec`, `PermissionSet`, `ToolDescriptor`, `SubmissionStatus`, `LinkClaims` | Any I/O. Pure types only. |
| `IdentityModule` | `identity_mappings`, `real_users`, OTP onboarding, `identity_epoch` | Touch RBAC or apps |
| `AuthzModule` | per-app roles/permissions/assignments, `perm_version` (**sole writer**), tool filter, `assertPermissionsAtVersion()` | Issue links or call JEV |
| `RegistryModule` | app definitions + versions + triggers + lifecycle + publish pipeline, declared-index creation, in-process LRU of published apps | Validate form payloads |
| `FormsModule` | FormIO schema storage/versioning, server-side prefill, server-side payload validation, Query DSL | Touch Mongo data collections directly |
| `LinksModule` | Link issuance (create/edit — Redis-backed), read-link signing/verification (view/query/notification), `KeyringService`, one-time token store | Consume tokens, route data |
| `DecisionModule` | `JevProvider` interface + registry, fallback chain, **shared circuit-breaker state**, deadline propagation, JEV response cache | Know about permissions (receives the already-filtered toolset) |
| `ConnectorsModule` | connector interface + registry, REST connector, per-connector rate limit, retry/backoff, KMS credential resolution, `dry_run` | Decide *whether* to run; the DataRouter decides that |
| `SubmissionsModule` | submission processor orchestration, the Mongo transaction, submission status transitions | Enqueue connector jobs (the outbox relay does) |
| `DataRouterModule` | internal writer, Query DSL execution with auto-injected user filter, hybrid coordinator, field-mapping templates, `outbox` writes | Call connectors directly (only via the queue) |
| `AdaptersModule` | `im/<platform>/inbound` (receiver) + `im/<platform>/outbound` (client, formatter), platform signature verification, `im.inbound`/`im.outbound` producers | Run the routing pipeline (the InboundRouter does) |
| `AuditModule` | append-only `audit_log`, PII allowlist applied **before** serialisation | Ever throw into the request path |
| `BuilderModule` | App-Builder API composition: app CRUD orchestration, publish validation (circular-share detection FR-X-5, index creation FR-D-5), preview sandbox | Write to data collections |
| `InboundRouter` | the §7.1 pipeline, executed in `worker` from `im.inbound` | Be reachable over HTTP |

### Trust Boundaries

Direction is explicit; every arrow crossing a `T` line is untrusted or credential-bearing.

| # | From → To | What crosses | Rule |
|---|-----------|--------------|------|
| T1 | Internet → Ingress | TLS-terminated HTTP | IP rate limit and body-size cap at nginx; **no application logic** |
| T2 | Ingress → `api` | IM webhook bodies | **Untrusted.** Verified HMAC over `req.rawBody` → Zod-parsed into `InboundEvent` → *then* handed to a queue. No domain code sees an unverified body. |
| T3 | `api`/`worker` → Mongo / Redis | queries | Trusted infrastructure. But **no domain module may construct a raw client** — only `PlatformModule` exports one. |
| T4 | `worker` → external systems | connector calls + credentials | Egress. `credential_ref` is unwrapped by `ConnectorsModule` **only**, with a 60 s in-process cache. Never in Redis (honours PRD §15.3 "Redis: no PII stored"). |
| T5 | `worker` → IM platforms | outbound messages | Egress. Never on the request path — always via `im.outbound`. |
| T6 | any → KMS/Vault | secret unwrap | `PlatformModule.CryptoService` only. Enforced by the boundaries lint rule. |
| T7 | Browser (form renderer) → `api` link endpoints | JWT in URL | The JWT is the **entire** credential. No cookies ⇒ CSRF class removed structurally. Issuer applies NFR-SEC-10 (5 failed validations / IP / 10 min) before any crypto work. |
| T8 | Browser (App Builder) → `api` builder endpoints | SSO session + MFA | Separate origin, `SameSite=Strict` cookie **here only**. |
| T9 | External systems → `api /webhooks/inbound` | HMAC-signed notifications | Identical ingest contract to T2. Replay guard: timestamp window + nonce. |

**The single rule that keeps this coherent:** every inbound HTTP entry point terminates in `queue.add(...)` or a pure crypto check. No inbound HTTP handler ever reaches Mongo for domain data. That is what makes the 200 ms ack achievable *and* keeps the untrusted-input blast radius at one adapter file per platform.

---

## Recommended Project Structure

npm workspaces (per `.planning/PROJECT.md`: nx/turbo rejected as unjustified at 4 packages). The boundary lint rule is what makes "modular monolith" enforceable rather than aspirational.

```
akane/
├── apps/
│   ├── api/                     # NestFactory.create(), rawBody:true, listens :3000
│   ├── worker/                  # NestFactory.createApplicationContext() — no HTTP
│   ├── scheduler/               # NestFactory.createApplicationContext() — no HTTP
│   ├── form-renderer/           # Vite + React 19 + @formio/js 5 (read/write/view/query)
│   └── app-builder/             # Vite + React 19 + @formio/js 5 builder
├── packages/
│   ├── platform/                # config, mongo, redis(×2 profiles), queue, crypto, otel, http
│   ├── kernel/                  # shared zod schemas + types. ZERO I/O, ZERO deps.
│   ├── domain/                  # the 12 domain modules (below)
│   └── contract/                # JevProvider iface, Connector iface, InboundEvent/OutboundMessage
└── tooling/
    ├── boundaries.config.mjs    # eslint-plugin-boundaries policies
    └── tsconfig.base.json
```

```
packages/domain/src/
├── identity/     ├── authz/       ├── registry/   ├── forms/
├── links/        ├── decision/    ├── connectors/ ├── submissions/
├── datarouter/   ├── adapters/    ├── audit/      └── builder/
│                     ├── im/slack/{inbound,outbound}/
│                     ├── im/teams/{inbound,outbound}/
│                     ├── im/zalo/{inbound,outbound}/
│                     └── im/telegram/{inbound,outbound}/
└── pipeline/     # InboundRouter — composes the modules above, lives in worker only
```

### Structure Rationale

- **`kernel/` has no `dependencies` field at all.** If it needs a library, that's the signal the type belongs somewhere else. This is the cheapest possible cycle-breaker and it makes the boundary graph trivially acyclic at the base.
- **`adapters/<platform>/{inbound,outbound}/` is split per direction**, not per platform, because `api` needs only `inbound` and `worker` needs only `outbound`. A platform-shaped folder would force both entrypoints to load both halves.
- **`pipeline/` is its own module**, separate from the modules it calls. It is the only place allowed to import `identity + authz + decision + registry + links` simultaneously. Putting the orchestration inside `authz` (where the PRD's §7.1 implies it) would make the largest module the one with the widest fan-in — the exact shape that makes "extract a service later" impossible.
- **`builder/` is a composition module, not a domain module.** It owns no collections; it orchestrates `registry` + `forms` + `authz` + `connectors` and adds publish-time validation. This keeps the App Builder a thin, replaceable skin over APIs that already exist — which is what makes it safe to build late.

### Boundary rules — what talks to what

Enforced by `eslint-plugin-boundaries` (v5.3.1, MIT, 253k weekly downloads, actively published). v5 uses a single `boundaries/dependencies` rule with `default: "disallow"` and an allow-list of policies — the modern form of the rule; do not copy the older `boundaries/element-types` examples you'll find in search results.

**Element types** (`boundaries/elements`):

| Type | Pattern | Notes |
|------|---------|-------|
| `kernel` | `packages/kernel/src/**` | |
| `platform` | `packages/platform/src/**` | |
| `identity` `authz` `registry` `forms` `links` `decision` `connectors` `submissions` `datarouter` `audit` | `packages/domain/src/<type>/**` | |
| `adapters` | `packages/domain/src/adapters/**` | |
| `pipeline` | `packages/domain/src/pipeline/**` | |
| `builder` | `packages/domain/src/builder/**` | |
| `entrypoint` | `apps/{api,worker,scheduler}/src/main.ts` | composition roots |
| `entrypoint` | `apps/*/src/app.module.ts` | |

**Allowed edges** (`default: "disallow"` — everything not listed is an error):

```
kernel      → (nothing)
platform    → kernel
identity    → platform, kernel
authz       → platform, kernel, identity          (authz needs to know who the user is; NOT vice-versa)
registry    → platform, kernel, authz             (publish-time permission sanity), forms
forms       → platform, kernel
links       → platform, kernel, registry, authz   (issuing a link requires knowing the form + permission)
decision    → platform, kernel
connectors  → platform, kernel
submissions → platform, kernel, identity, authz, forms, links, registry, audit
datarouter  → platform, kernel, registry, connectors(config only), audit
adapters    → platform, kernel, contract          # inbound + outbound only. NOTHING else.
pipeline    → platform, kernel, identity, authz, registry, forms, links, decision, adapters, audit
builder     → platform, kernel, registry, forms, authz, connectors, audit
entrypoint  → (everything)
*           → NOT entrypoint                     # composition roots are leaves
```

**The three rules that do the real work** (these are the ones worth writing as `boundaries/files` category policies, because they are not expressible as element-type edges):

| Rule | Enforces | Why |
|------|----------|-----|
| **R1 — entrypoint exclusivity** | Only `apps/api/src/app.module.ts` may import `**/adapters/**/inbound/**` and `**/http/**`. Only `apps/worker/src/app.module.ts` may import `**/bullmq/workers/**` and `**/adapters/**/outbound/**`. Only `apps/scheduler/src/app.module.ts` may import `**/scheduler/**`. | Makes the three-way split a real boundary. Without it, `api` can `import { Worker } from 'bullmq'` and the ack budget dies silently. |
| **R2 — secret containment** | Only `packages/platform/src/crypto/**` and `packages/domain/src/connectors/**` may import `@opengsd/…kms`, `jose` signing helpers, or `AES-256-GCM` primitives. | NFR-SEC-3 and PROJECT's "no plaintext env secrets" become lint errors rather than review comments. |
| **R3 — no direct Mongo outside data-access files** | `mongodb` driver imports allowed only in `packages/platform/src/mongo/**` and `packages/domain/src/**/data-access/**`. | Forces repositories. Stops `collection.insertOne()` from appearing in a service, which is how transaction-scoped `session` threading gets skipped. |

**Enforcement is only half the story.** Add a boot-time assertion as well: each entrypoint declares its allowed provider set, and `main.ts` walks `ModuleRef` providers in an `OnApplicationBootstrap` hook and fails fast if a provider from a forbidden module is instantiated. NestJS resolves providers lazily by default (`strict: false` semantics), so an import that a module never uses may never instantiate — the lint rule catches that statically; the runtime check catches dynamic `ModuleRef.get(..., {strict:false})` escapes. Belt and braces, ~40 lines, and it turns a subtle production-only failure into a startup crash.

### What each entrypoint loads

| Module | `api` | `worker` | `scheduler` |
|--------|:-----:|:-------:|:----------:|
| `platform` (all) | ✅ | ✅ | ✅ |
| `kernel` | ✅ | ✅ | ✅ |
| `identity` `authz` `registry` `forms` `links` | ✅ | ✅ | ✅ |
| `decision` | ✅ (providers) | ✅ | ✅ (health probes) |
| `adapters/*/inbound` + HTTP controllers | ✅ | ❌ | ❌ |
| `adapters/*/outbound` | ❌ | ✅ | ✅ |
| `pipeline` (InboundRouter) | ❌ | ✅ | ❌ |
| `connectors` HTTP client | ❌ | ✅ | ✅ (health) |
| `submissions` `datarouter` | ✅ (HTTP path only) | ✅ | ✅ (relay only) |
| `bullmq/workers/*` | ❌ | ✅ | ❌ |
| `scheduler/jobs/*` | ❌ | ❌ | ✅ |
| `builder` controllers | ✅ | ❌ | ❌ |

Two details that matter and are easy to get wrong:

- **All three entrypoints call `app.enableShutdownHooks()`.** Without it, `onModuleDestroy` never fires on SIGTERM and a rolling deploy (NFR-A-6) kills in-flight submissions mid-transaction. `createApplicationContext()` fires `onModuleInit`/`onApplicationBootstrap` for you (verified: NestJS lifecycle docs), so `worker` and `scheduler` get their init hooks — but not their shutdown hooks without the explicit call.
- **OTel initialises before any instrumented import.** The SDK bootstrap must be the first statement in `main.ts`, imported via `require`/dynamic import *before* `AppModule` is even imported. Importing `AppModule` statically at the top of the file is the single most common way to lose NFR-O-1 end-to-end traces, and it fails silently.

---

## Architectural Patterns

### Pattern 1: Epoch-keyed cache keys (replaces Pub/Sub invalidation)

**What:** Put a monotonically increasing version *in the cache key*, so a version bump makes every prior entry unreachable in one atomic step. No `DEL`, no scan, no event, no race.

**When to use:** Whenever a cache entry encodes a permission-bearing fact. Here: identity mapping and RBAC resolution.

**Trade-offs:** Old keys become garbage until TTL expiry (bounded, and free). A version read that misses falls back to the source of truth. In exchange you get *unconditional* correctness — there is no window in which a dropped message serves a revoked permission.

**Why it replaces Pub/Sub:** Redis Pub/Sub is at-most-once. redis.io states plainly it must be paired with a durable mechanism; a subscriber reconnecting after a blip silently misses every message published during the gap. FR-I-6 and FR-R-9 both say "immediate invalidation," but the only way to make that true is to make stale reads *structurally impossible*, not to make them unlikely.

```typescript
// ONE primitive serves both the cache AND the 90-day read-link check (FR-L-7, NFR-SEC-4).

// Write path — the SOLE place perm_version is ever incremented.
async bumpPermissionVersion(appId: string, realUserId: string): Promise<number> {
  const { value } = await this.userPerms.updateOne(
    { app_id: appId, real_user_id: realUserId },
    { $inc: { perm_version: 1 } },          // sparse: absent doc ⇒ perm_version 0
    { upsert: true, returnDocument: 'after' },
  );
  await this.cache.set(`ak:pv:${appId}:${realUserId}`, value, { ttl: 300 });
  await this.pubsub.publish('perm.changed', { appId, realUserId }); // OPTIMISATION ONLY
  return value;                              // callers that cache a link must use this value
}

// Hot read — one GET, no Mongo, unconditionally fresh.
async resolveToolset(appId: string, realUserId: string): Promise<PermissionSet> {
  const pv = await this.cache.get(`ak:pv:${appId}:${realUserId}`) ?? '0';
  const key = `ak:rbac:${appId}:${realUserId}:${pv}`;   // ← version is IN the key
  const hit = await this.cache.get(key);
  if (hit) return deserialize(hit);
  const fresh = await this.repo.load(appId, realUserId); // Mongo fallback
  await this.cache.set(key, serialize(fresh), { ttl: 300 });
  return fresh;
}

// Read-link access — compare against the CURRENT version, not a cached one.
async assertPermissionsAtVersion(u: string, app: string, perm: string, expectedPv: number) {
  const actual = await this.currentVersion(app, u);   // ak:pv → Mongo fallback
  if (actual !== expectedPv) throw new StaleLink(actual, expectedPv);
  const set = await this.resolveToolset(app, u);      // keyed by `actual`, so it's current
  if (!set.has(perm)) throw new PermissionDenied(perm);
}
```

**Consequence for latency (this is what buys NFR-P-1 and NFR-P-2).** Identity and RBAC each become **one Redis GET on the hit path**, and correctness no longer depends on cache TTL at all — the 5-minute TTL is a memory bound, not a staleness bound. A revoked permission takes effect at the next `perm_version` bump, not up to 5 minutes later. The system is *more* correct than the PRD specifies and *faster* than the PRD requires.

**Same pattern for identity** — `ak:ident:{identity_epoch}:{im}:{chat_user_id}` → `{ real_user_id }`, epoch bumped by any mapping create/update/deactivate (FR-I-6). Deactivation is just an epoch bump, so it propagates instantly without a scan of that user's keys.

---

### Pattern 2: Pure-ingest receiver (the 200 ms ack contract)

**What:** The HTTP receiver verifies a signature and enqueues. It performs zero domain I/O. Ack immediately, compute in the consumer.

**When to use:** Any inbound that a third party retries. This is exactly the Slack 3-second/3-retry and Teams 429/502-with-jitter situation PROJECT.md already identifies.

**Trade-offs:** The receiver cannot reject "meaningless" traffic cheaply — every valid-signature request costs one queue write. That is a deliberate exchange: a cheap write beats a lost submission, and per-user rate limiting (FR-I-10's 10 req/min) moves into the consumer where `real_user_id` is known. Abuse is handled at the ingress by IP rate limiting, which needs no application state.

**The receiver's responsibilities, exhaustively:**

1. Reject oversized bodies at nginx. **No** application logic here.
2. Verify the platform signature over **`req.rawBody`** — raw bytes, not re-serialised JSON. NestJS: `NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true })`, typed via `RawBodyRequest<Request>`. Verified constraint: this works **only if the built-in body parser is enabled** — do not pass `bodyParser: false`. Default parsers cover both `json` and `urlencoded`, which is what Slack slash commands send.
3. Replay guard: timestamp window (5 min) + nonce. **If Redis is unreachable, fail open here** and let the enqueue's `jobId` idempotency plus the consumer handle it. A receiver that blocks on Redis is a receiver that loses submissions.
4. Parse and Zod-validate into `InboundEvent`. **This is the only place an unverified byte string becomes a typed value.**
5. `queue.add('im.inbound', event, { jobId: <platform event id>, attempts: 5, backoff, removeOnComplete: { age: 86400, count: 100000 }, removeOnFail: { age: 604800 } })`.
6. Return `200` with an empty body.

**Everything else is forbidden in the receiver.** No identity resolution. No RBAC. No Mongo. No JEV. No message formatting. The PRD's §7.1 puts `[Rate Limiter]` immediately after `[IM Adapter Layer]` — that is wrong for an async receiver and must move into the consumer, after identity resolution, keyed on `real_user_id`.

**Why `jobId` is a valid idempotency primitive *here*, when it is not one for connector calls.** The docs are explicit that dedup lapses once a job is removed. For inbound webhooks that is acceptable **because the retention window is chosen from the platform's own retry horizon**: Slack retries 3 times over minutes; Teams retries with jitter. A 24-hour `removeOnComplete` retention is 2–3 orders of magnitude more than any platform will retry, and after that window the request is dead regardless of whether we still remember it. Contrast the connector case, where a stalled job can be reprocessed days later (§ Pattern 3) — there the retention window is *not* a bound on anything, so it cannot be the guarantee.

**Slash-command variant.** Slack's 3-second ack and its `response_url` (usable up to 5 times within 30 minutes) make the design obvious: **ack empty immediately; deliver the link via `response_url` or `chat.postMessage` from the worker.** The routing pipeline takes up to 2 s (NFR-P-5) and would otherwise consume most of the 3-second budget while holding the connection — and any platform-side retry would duplicate the whole pipeline run. Moving delivery off the request makes the 2 s and 3 s budgets non-interfering. Verify at implementation time whether the delivery should prefer `response_url` (ephemeral, single-recipient, 30-min window) over `chat.postMessage` (durable, threadable) per message class; the PRD's FR-IM-8 threading requirement points at `chat.postMessage`.

**Replay path — three distinct mechanisms, not one:**

| Replay source | Mechanism |
|---|---|
| Slack/Teams retry the same event | Same `jobId` → BullMQ ignores the add → `200`. Zero downstream effect. |
| Operator re-drive after a DLQ hit | Admin endpoint re-adds with `jobId: replay:{n}:{original}` — deliberately *not* deduped — against the retained job payload (`removeOnFail: { age: 7d }` keeps it). |
| Full redelivery from scratch | Platform-side replay (Slack event replay / manual resend). Treated as a brand-new event, new `jobId`. Correct behaviour: it *is* a new user action. |

**Non-retryable vs retryable failures in the consumer** must be distinguished explicitly, or retries amplify permanent errors: malformed payload / unknown IM user / revoked signature → throw `UnrecoverableError` → straight to DLQ, zero retries. Mongo timeout / Redis blip / plugin outage → throw → backoff retry.

---

### Pattern 3: Transactional outbox (the hybrid consistency boundary)

**What:** Never write to MongoDB and Redis/BullMQ "at the same time." Write the intent to MongoDB inside the same transaction as the data, then relay it. Redis is the transport; MongoDB is the record of truth.

**When to use:** Whenever a synchronous write must be paired with an asynchronous side effect. This is precisely hybrid mode (FR-D-4) and precisely the case the PRD specifies as "internal synchronous + external async via BullMQ" without saying what happens in between.

**Trade-offs:** One extra collection and one extra read per routing attempt; a relay loop to build and operate. In exchange, a crash between the commit and the enqueue loses nothing — the outbox row survives, and the relay republishes.

**Why not just `queue.add()` after the commit:** the window between `COMMIT` and `queue.add` returning is exactly the crash window. A crash there leaves a submission confirmed to the user whose external side effect will never fire, silently. The PRD's FR-A-3 ("connector failures MUST NOT block internal writes") is satisfied by the outbox; the outbox is *also* what makes that guarantee true under process death rather than only under connector failure.

**The relay needs MongoDB change streams** — the PRD's §7.4 already lists change streams as a MongoDB capability, and they require a replica set, which NFR-A-4 mandates. So the prerequisite is already satisfied by the committed topology. Fallback for environments without change streams: a polling relay on `state: 'pending'` with a `findOneAndUpdate` claim — implement both, select by config.

```
API (synchronous, inside ONE Mongo transaction)      RELAY (scheduler)      WORKER
─────────────────────────────────────────────         ─────────────────      ──────
insert submissions { status:'pending_external' }
insert <app collection> doc  (internal write)
insert outbox {
    submission_id, kind:'connector_call',
    connector_id, operation, field_mapping,
    state:'pending' }
insert audit_log { submission.created }
COMMIT (writeConcern: majority) ──────────────▶  change stream / poll
  │                                                 claim row (atomic)
  │                                                 queue.add('connector.execute',
  │                                                   { jobId: `ext-${submission_id}` })
  │                                                   mark outbox.state='enqueued'
  │                                                                       ▼
  │                                                            (retry w/ backoff, DLQ)
  │                                                                       │
  │                                                                    external call
  │                                                              ┌────────┴────────┐
  │                                                        success                permanent fail
  │                                                    update status:'completed'  → DLQ
  │                                                    + external_ref.system_id   status stays
  │                                                                       'pending_external'
  ▼
user is already told "saved"; status is an implementation detail
```

**Status lifecycle, stated unambiguously.** `pending_external` → `completed` | `partial` | `failed`.
- **Internal mode** — `completed` written in the same transaction. Never enters `pending_external`.
- **External mode** — identical transaction minus the app-collection insert. The outbox row *is* the delivery record.
- **Hybrid mode** — the internal write is what makes the submission confirmable (FR-D-4). External failure moves it to `partial`, **never** back to `failed`, because the user's data is durably stored. `failed` means *nothing* was stored — which only happens when the transaction itself aborted.
- **At-least-once → exactly-once.** The connector receives `Idempotency-Key: submission_id` (FR-C-5, FR-D-12) on every attempt. Write-once semantics hold at the *destination* even though delivery is at-least-once. This is the standard resolution and it is the only one available when the external system honours an idempotency key.

**What a crash between the two leaves behind — the complete table:**

| Crash point | Left behind | User-visible | Recovery |
|---|---|---|---|
| Before Mongo `COMMIT` | Nothing. Transaction aborts; no submission, no data, no outbox. | Yes — a 5xx. Retry is safe; nothing was written. | None needed. |
| After `COMMIT`, before `queue.add` | Submission + data committed. No outbox row (it's in the same transaction — so this is unreachable *by construction*). | No | None needed — this is the entire point |
| After `COMMIT`, before the relay claims the outbox row | Everything committed. Outbox row `pending`. | No | Relay republishes within one poll interval (or on the next scheduler boot — see Pattern 5). |
| Relay claimed the row, then died | Row may be stuck `enqueued` with no job. | No | Stale-claim sweeper resets rows whose `enqueued_at` exceeds a threshold back to `pending`. |
| Worker crashes mid-connector-call | Job `active`, lock expires → BullMQ **stalled-job** detection reprocesses it. | No | The external system may have received the call. Idempotency key + connector-side dedup makes reprocessing safe. |
| Redis loses the queue entirely (failover) | BullMQ state gone. Mongo untouched. | No | Outbox and `submissions` rows in Mongo are intact; relay rebuilds the queue. **This is the load-bearing property of the outbox.** |

**The row that surprises people:** if the Mongo transaction *fails* after the token was consumed, the user has burned a one-time link for nothing. FR-L-9's "request a new one" path covers this — but the failure message must be actionable ("your link was used but we could not save your request; reply `/leave request` again"), not a bare 500.

---

### Pattern 4: Aggregate the tool set, don't fan out

**What:** FR-R-9 specifies RBAC resolution cached **per user per app**. A user with roles in 10 apps therefore costs 10 cache lookups on every inbound message — and the PRD's scale ceiling is 200 apps. Fan-out of 10–50 Redis GETs is the single largest avoidable cost on the hot path, and it lands directly on NFR-P-2.

**When to use:** Whenever a per-entity cache must be assembled into a whole before the next stage consumes it.

**Trade-offs:** One more cache layer with its own invalidation trigger. In exchange the hot path becomes **one** `GET`, and adding apps does not change per-message latency.

```
ak:toolset:{user_epoch}:{real_user_id}   →  ToolDescriptor[]
     ▲                             ▲
     │                             └── rebuilt when per-app perm_version changed
     └── a single per-USER monotonic counter,
         bumped when ANY of that user's app memberships change
```

Invalidate by bumping `user_epoch`. A permission change in one app bumps one `perm_version` *and* the one `user_epoch`; the aggregate key becomes unreachable, the next request rebuilds it from the (still-correct) per-app keys. **One bump, two caches, no scan, no stale window.** This is the same epoch-keying primitive as Pattern 1 applied one level up — one idea, three uses (RBAC cache, read-link check, toolset cache).

The JEV response cache (FR-J-4, keyed `hash(text + sorted(tool_ids) + locale)`) is then correct *by construction* under this change, because a tool set that changed produces a different `sorted(tool_ids)` and therefore a different key. The PRD's cache key is already sound; this note records **why** it stays sound when the tool set is rebuilt.

---

### Pattern 5: Durable scheduler registration

**What:** Every BullMQ Job Scheduler is registered with `upsertJobScheduler()` on **every boot of every replica**, not once at deploy.

**When to use:** Whenever durable scheduling is chosen over in-memory cron — which `.planning/PROJECT.md` has already decided (rejecting `@nestjs/schedule` for durable work).

**Trade-offs:** N replicas × M schedulers = N×M idempotent registrations at boot. `upsert` is documented as the right primitive for exactly this ("ensures the scheduler is updated or created without duplications"), so the cost is a few Redis round trips per boot. The alternative is a schedule that silently stops existing after a Redis failover — a key rotation that doesn't run is a **security** failure (NFR-SEC-9), which is precisely why PROJECT.md rejected `@nestjs/schedule`.

```typescript
// src/scheduler/registrations.ts — called from apps/scheduler/src/main.ts
export async function registerAllSchedules(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler('connector-health', { every: 60_000 }, HEALTH_TEMPLATE);
  await queue.upsertJobScheduler('jev-health',       { every: 60_000 }, JEV_TEMPLATE);
  await queue.upsertJobScheduler('outbox-relay',      { every: 2_000 },  RELAY_TEMPLATE);
  await queue.upsertJobScheduler('jwt-key-rotation',  { every: 86_400_000 }, ROTATE_TEMPLATE);
  await queue.upsertJobScheduler('retention-purge',   { pattern: '17 3 * * *', tz: 'UTC' }, PURGE_TEMPLATE);
}
```

Four v6-specific constraints the implementation must respect, all verified against the docs:
- **`tz: 'UTC'` in scheduler options.** The legacy `utc` option was **removed**. A retention job that runs at local time will drift across regions and violate data-residency expectations.
- **Custom `jobId` is impossible for scheduler-produced jobs** — BullMQ assigns a special ID to guarantee the repeat rate. Design job payloads accordingly; do not attempt to control the ID.
- **A busy queue silently reduces the effective interval.** "The scheduler will only generate new jobs when the last job begins processing." At 50 events/s the outbox relay at 2 s may be stretched — size the relay's batch limit against measured queue depth, not against the nominal interval.
- **`Queue.resume()` is now async** and must be awaited.

**Job Schedulers also replace the PRD's `@nestjs/schedule`-flavoured retention and health loops.** FR-C-9 (connector health every 60 s) and FR-J-10 (JEV health every 60 s) are durable jobs here, not in-memory intervals.

---

### Pattern 6: DI is the contract seam — and its limits

**What:** AD-2 ("JEV-compatible spec as a swappable seam") is achieved by NestJS DI: `JevProvider` is an injection token, providers self-register, and `DecisionModule` selects by config.

**When to use:** For every pluggable boundary — JEV providers, connectors, IM adapters, data-routing strategies.

**Trade-offs:** DI gives compile-time-ish safety and a clean seam. It does **not** give you runtime provider health, which is what FR-J-10 actually requires. Those are different concerns and need different mechanisms.

```typescript
export const JEV_PROVIDER = Symbol('JEV_PROVIDER');

@Module({
  providers: [
    { provide: JEV_PROVIDER, useClass: RuleBasedProvider },   // offline default
    { provide: JEV_PROVIDER, useClass: OpenJevProvider },
    { provide: JEV_PROVIDER, useClass: OpenAiCompatibleProvider },
    CompositeProvider,                                        // FR-J-3 fallback chain
  ],
  exports: [JEV_PROVIDER],
})
export class DecisionModule {}
```

**Three gaps in the PRD's §11 that the implementation must close:**

1. **The provider registry needs runtime health state.** FR-J-10 says unhealthy providers are skipped. In-memory circuit-breaker state (PR-6.3 `failure_threshold: 5`) is **per replica**, so with 3 API replicas the effective threshold is 15, and the chain may hit a known-dead provider 3× before tripping. **Put the circuit-breaker state in Redis** (a hash keyed by provider name, `INCR` + TTL), so all replicas share one view. This is a small change and it is the difference between §11.4 working and not working.
2. **`RuleBasedProvider` is not optional — it is load-bearing.** §11.4 gives it a 50 ms budget and it is the terminal fallback. If it is unavailable (dependency not installed, regex misconfigured), the *entire* system has no routing path. Give it its own contract test and a startup assertion that it is registered and functional. It is also the reason `RuleBasedProvider` runs in-process while `OpenJevProvider` is HTTP.
3. **The conformance suite (§17.3, 50 intents, ≥85% accuracy) is a contract test, not a unit test.** Run it against every registered provider in CI. It is the only thing that makes AD-2's "provider swap without core changes" claim verifiable rather than aspirational — a provider can pass the type signature and still return malformed `alternatives`.

---

## Data Flow

### Flow 1 — IM message → link in chat (the NFR-P-5 path, ≤ 2 s p95)

Direction is left-to-right; each hop names its store and whether it blocks the user.

```
Slack / Teams / Zalo / Telegram
      │  HTTPS POST  ────────────────────────────────────────  UNTRUSTED
      ▼
[IM adapter · inbound]                       api process
      │  ① verify HMAC over req.rawBody            ~0.1 ms   pure crypto
      │  ② Zod-validate → InboundEvent             ~0.3 ms   pure
      │  ③ rate-limit by IP                          —       at ingress, not here
      │  ④ queue.add('im.inbound', …, jobId)       ~1 ms     1 Redis round trip
      ▼  ⑤ HTTP 200 (≤ 200 ms target; measured ~5 ms)
════════════════════════════ process boundary ════════════════════════════
[InboundRouter]                               worker process
      │  ⑥ GETDEL-style nonce + enqueue dedup → skip duplicate   ~1 ms   Redis
      │  ⑦ identity: ak:ident:{epoch}:{im}:{chat_user_id}         ~1 ms   Redis  ← NFR-P-1 <10 ms
      │     └─ miss → Mongo query → SET epoch-key                 ~15 ms   Mongo (cold)
      │     └─ unmapped → onboarding prompt → im.outbound → return
      │  ⑧ aggregate toolset: ak:toolset:{user_epoch}:{uid}      ~1 ms   Redis  ← NFR-P-2 <30 ms
      │     └─ miss → per-app ak:rbac:* → rebuild → SET           ~20 ms   Mongo (cold)
      │  ⑨ JEV cache: ak:jev:{sha256(text+tools+locale)}           ~1 ms   Redis
      │     └─ miss → decide(text, tools) with DEADLINE           ≤500 ms  HTTP
      │        └─ chain: openjev → openai → rule-based, budget-aware
      │     └─ confidence < app threshold → clarification via im.outbound → return
      │  ⑩ resolve app+form (in-process LRU, version-pinned)      ~0 ms   memory
      │  ⑪ FRESH permission re-check at link issuance             ~1 ms   Redis   ← AD-1 2nd point
      │  ⑫ sign link (EdDSA/ES256, kid from keyring)             ~2 ms   jose
      │     └─ create/edit → also SET ak:tok:{jti} w/ TTL        ~1 ms   Redis
      │  ⑬ queue.add('im.outbound', rendered link)                ~1 ms   Redis
      ▼
[ImDispatcher] → chat.postMessage / response_url                ~300 ms  HTTP (T5 egress)
      ▼
user sees the link
```

**Latency budget against NFR-P-5 (2000 ms p95):**

| Segment | p50 | p95 (cold cache) | Store |
|---|---:|---:|---|
| ①–④ receiver | 3 ms | 8 ms | Redis |
| queue handoff | 1 ms | 5 ms | Redis |
| ⑦ identity | 1 ms | 15 ms | Redis / Mongo |
| ⑧ toolset | 1 ms | 25 ms | Redis / Mongo |
| ⑨ JEV (cached) | 1 ms | 1 ms | Redis |
| ⑨ JEV (miss) | 180 ms | 500 ms | HTTP |
| ⑩–⑫ app load + sign + token | 4 ms | 10 ms | memory + Redis |
| ⑬ enqueue | 1 ms | 3 ms | Redis |
| **Total to link delivered** | **~192 ms** | **~567 ms** | |
| **Headroom vs 2000 ms** | **10×** | **3.5×** | |

This clears NFR-P-5 with genuine margin *provided the deadline in ⑨ is enforced*. Without it the fallback chain alone can consume 1550 ms (§11.4: 500 + 1000 + 50) and the budget collapses. **The deadline is the difference between a 3.5× margin and a coin flip.**

### Flow 2 — the two hottest paths, specified

The project's stated rationale for a modular monolith over microservices is that "a network hop plus a distributed transaction on the two hottest paths is not worth it at 1,000 concurrent users." **That claim is correct, but the stated reason is the weaker one.** The load-bearing reason is transactional co-location, not latency:

> A microservice split would put the RBAC resolver behind a network call — real, but 1–2 ms, and cacheable, so not decisive. The *decisive* cost is that splitting the permission store from the link issuer turns "check permission and mint a token" from two in-process steps into a distributed transaction. In a modular monolith both live in the same failure domain and the whole operation is two Redis GETs on one connection.

**Path A — permission re-read (every inbound message, every link access).**

```
api/worker  →  AuthzModule.assertPermissionsAtVersion(user, app, perm, expectedPv)
                  │
                  ├─ GET ak:pv:{app}:{user}            1 round trip   (Redis, cluster)
                  ├─ current !== expected → 403 STALE_LINK (read link) / re-route (routing)
                  └─ current === expected
                       └─ GET ak:rbac:{app}:{user}:{current}          (Redis, cluster)
                          └─ miss → 1 Mongo find on user_app_permissions, indexed
                             → SET with TTL 300
```

What it must do to hit **NFR-P-2 (<30 ms cached)**:
- **Two Redis GETs maximum on the hit path, pipelined into one `MULTI`** if the version is not already in the aggregate toolset entry. Note `GETDEL`-class Lua is unnecessary here — plain `GET` is correct because the version is *in the key*.
- **Never join against other collections.** `authz` reads exactly one collection, `user_app_permissions`. Role definitions, users, and apps are resolved by the caller's own module. A `$lookup` here is how a 30 ms budget becomes 400 ms.
- **One index, always present:** `{ app_id: 1, real_user_id: 1 }` unique. Declared at migration time, not at first assignment — a missing index on the permission path is an outage, not a slowdown.
- **Never `SCAN` for invalidation.** Pattern 1 exists precisely to make this impossible.
- **Budget a Redis-connection pool large enough that a 50 msg/s burst does not queue.** ioredis multiplexes over one connection; 2 connections (commands + pub/sub) per process is ample at this scale.
- **On Redis failure, fall through to Mongo and accept the latency spike.** Do not fail the request. A degraded path that answers in 60 ms beats a 503 at 5 ms.

What it must **not** do: resolve permissions from the JWT claims, trust a cached tool set without its version, or read a second store to assemble the answer.

**Path B — one-time token consume (every form submission).**

```
browser ──POST /s/:token──▶ api
      ① jwtVerify(token) + exp + typ=='create'|'edit'         ~2 ms   jose (public key)
      ② resolve app + form version PINNED at link creation     ~0 ms   memory LRU
      ③ GETDEL ak:tok:{jti}                                   ~1 ms   Redis, atomic
         └─ null → 409 ALREADY_SUBMITTED or 410 EXPIRED (distinguish via JWT exp)
      ④ validate payload against the pinned FormIO schema     ~5 ms   pure
      ⑤ assertPermissionsAtVersion(user, app, required_perm, claim.perm_version)
      ─────────── MONGO TRANSACTION (writeConcern majority) ───────────
      ⑥ insert submissions   { submission_id, status, jti, … }
      ⑦ insert <app collection> doc   ← the synchronous internal write
      ⑧ insert outbox row (external+hybrid only)
      ⑨ insert audit_log
      ─────────── COMMIT ───────────
      ⑩ queue.add('im.outbound', confirmation)               ~1 ms   Redis
      ▼
      201 { submission_id, status, internal_ref }
```

What it must do to be safe:

| Requirement | Mechanism | Why it is sufficient |
|---|---|---|
| **Atomic consumption** (NFR-SEC-1, FR-L-1) | `GETDEL` on `ak:tok:{jti}` — single key, single round trip, atomic in Redis. | A double-click loses the race deterministically; the loser gets 409. No Lua script is needed because the value carries no logic — verification already happened in ① and ⑤. |
| **Write-once across restarts** (FR-D-12) | **Unique index on `submissions.link_jti`.** | Redis is a cache tier and can lose an acknowledged `GETDEL` on failover. Mongo cannot. This is the guarantee; `GETDEL` is the fast path. |
| **Two independent guards** | `GETDEL` (network/UX level) + `jti` unique index (durability level) | Neither alone suffices: `GETDEL` alone fails open on failover; the index alone allows wasted concurrent work but is never wrong. |
| **Edit links are loadable many times** (FR-L-2) | Split `GET` (peek) from `GETDEL` (consume). Peek validates without destroying. | The PRD's "consumed on submit, loadable before" needs two verbs on one key. Implement both explicitly; do not let `edit` accidentally reuse the `create` path. |
| **No token in Redis outlives its TTL** | 30 min (create) / 4 h (edit), configurable per app (FR-L-6). | Bounded Redis memory; no cleanup job needed because TTL is the eviction. |

**A note the PRD does not make:** `GETDEL` requires Redis ≥ 6.2.0 (verified against redis.io command metadata). The committed stack is Redis 8.2, so this is satisfied with four major versions of headroom — but it means **no Redis 5 compatibility path exists**, and the App Builder's "test connection" screen must not advertise one.

### Flow 3 — read-link verification sequence (AD-11 / FR-L-3, FR-L-4, FR-L-7, NFR-SEC-4)

A `View`/`Query` link is a stateless, asymmetrically-signed JWT up to 90 days old. **Every check below is server-side and mandatory.** The renderer may pre-validate in the browser for UX; that is never a security control.

**Where each check lives:**

| # | Check | Lives in | Failure |
|---|---|---|---|
| 0 | **Brute-force throttle** — 5 failed validations per IP per 10 min → block | Edge guard, before routing | `429` |
| 1 | **Header shape & algorithm allowlist** — exactly 3 segments; `alg ∈ {EdDSA, ES256}`; reject `none` and every HMAC algorithm | `LinksModule` — before any key lookup | `401` |
| 2 | **`kid` present and resolvable** against the live keyring (NFR-SEC-9 dual-key window) | `KeyringService` | `401` |
| 3 | **Signature** — `jose.jwtVerify` | `LinksModule` | `401` |
| 4 | **Registered claims** — `exp > now`; `nbf`; `iat` not in the future (clock-skew tolerance, 60 s); `iss` == this deployment; `aud` == the renderer origin; `typ ∈ {view, query, notification}` | `LinksModule` | `401` / `410` |
| 5 | **Payload schema (Zod)** — only opaque IDs permitted: `real_user_id`, `app_id`, `form_id`, `target_id`, `perm_version`, `jti`, `typ`. **Any PII field → reject** (NFR-SEC-2, PROJECT constraint) | `LinksModule` | `400` |
| 6 | **Identity still active** — `real_users.status == 'active'`. A deactivated employee must lose access immediately, *independent of `perm_version`* | `IdentityModule` via a narrow `StatusPort` interface | `403` |
| 7 | **App lifecycle permits the action** — `published`/`deprecated` allow reads; `archived` allows reads only (FR-LC-3); `draft`/`purged` deny | `RegistryModule` | `410` |
| 8 | **`perm_version` comparison** — claim value vs `ak:pv:{app}:{user}` (Mongo fallback) | `AuthzModule` — `assertPermissionsAtVersion` | `403` + "ask in <IM> for a fresh link" |
| 9 | **Fresh permission re-check** — the form's `required_permission` against the *current* permission set, not the claim | `AuthzModule` | `403` |
| 10 | **Data scope** — `view`: load exactly `target_id` and assert ownership or `view_all`. `query`: execute through the Query DSL with `real_user_id` auto-injected unless `view_all` (FR-D-7). **Raw Mongo is never reachable from this path** (FR-D-6) | `DataRouterModule` | `403` / empty result |
| 11 | **Access audit** — append `{jti, real_user_id, action, ip, user_agent, ts}` (FR-L-8). Append-only, must never fail the request | `AuditModule` | — (swallow + alert) |
| 12 | **Response** — the FormIO schema + data, or the query result set. Renderer switches to read-only mode | `FormsModule` + `DataRouterModule` | — |

**Ordering rationale.** Throttle first (cheapest, blocks enumeration). Algorithm allowlist second, **before** the key lookup — this is the classic JWT-confusion defence: accepting `HS256` and then verifying with a *public* key lets an attacker sign arbitrary tokens with a key the server published. Signature before claims (never trust unverified input). Claims before Zod (reject malformed before schema work). Identity-status *before* `perm_version` because deactivation must work even if a bug prevented the version bump. `perm_version` before the full permission resolution because it is one GET versus a larger read, and a stale link should fail on the cheapest available signal.

**What this sequence buys.** The claim is treated as a *hint about the past*, never as present-tense authority. Checks 6–9 are the reason AD-11 is safe: the token proves only that the user was permitted when it was minted. Between minting and use, every one of four independent facts can change — identity deactivated, role revoked, app unpublished, permission narrowed — and each has a check. That is a genuine defence-in-depth argument rather than an appeal to token expiry.

**The gap the PRD leaves, and the fix.** `perm_version` is only as good as its coverage. Every mutation that changes effective permissions **must** bump it. The PRD names role assignment and permission changes (FR-R-8) but not the rest. The complete set:

| Mutation | Bumps `perm_version`? |
|---|---|
| Role assignment added/removed | ✅ FR-R-8 |
| Role's permission set edited | ✅ (not named in the PRD) |
| Role deleted | ✅ (not named in the PRD) |
| **User deactivated** (FR-I-7) | ✅ **(not named in the PRD)** — backstopped by check 6 |
| **App unpublished / archived / purged** | ✅ **(not named in the PRD)** — backstopped by check 7 |
| **App's `required_permission` changed on a form** | ✅ **(not named in the PRD)** |
| Ownership transfer (FR-R-6) | ✅ (not named in the PRD) |

**Make this structural, not procedural.** One function — `AuthzModule.invalidateAll(appId, realUserId)` — is the *only* permitted writer of `perm_version`. Every mutation in the table routes through it. Add a test that enumerates every write path touching `user_app_permissions` and asserts the bump. A missed bump is a 90-day security hole; a code-review convention is not a sufficient control.

### Flow 4 — state and cache topology

Every piece of state in the system, with its invalidation mechanism. **Trust the table, not the prose.**

| State | Store | Key / location | TTL | Invalidation | On Redis loss |
|---|---|---|---|---|---|
| Identity mapping | Redis cache | `ak:ident:{identity_epoch}:{im}:{chat_user_id}` → `{real_user_id}` | 1 h (FR-I-4) | **Epoch bump** — old keys unreachable, no scan | Falls back to Mongo. Safe. |
| Identity epoch | Mongo (source) + Redis mirror | `identity_mappings_meta.identity_epoch`; `ak:meta:identity_epoch` | none | `$inc` on create/update/deactivate | Read Mongo once, repopulate. Self-heals. |
| RBAC resolution | Redis cache | `ak:rbac:{app_id}:{real_user_id}:{perm_version}` → `PermissionSet` | 5 min (FR-R-9) | **`perm_version` bump** — the version is *in the key* | Falls back to Mongo. Safe. |
| `perm_version` | Mongo (source) + Redis mirror | `user_app_permissions.perm_version`; `ak:pv:{app}:{user}` | none | Sole writer: `invalidateAll()` | Read Mongo. Safe. |
| Aggregate toolset | Redis cache | `ak:toolset:{user_epoch}:{real_user_id}` → `ToolDescriptor[]` | 5 min | `user_epoch` bump on any membership change | Falls back to per-app keys. Safe. |
| JEV response | Redis cache | `ak:jev:{sha256(text ⊕ sorted(tool_ids) ⊕ locale)}` | 5 min (FR-J-4) | **None needed.** A changed tool set changes the key, so a stale response is unreachable by construction. | Calls the provider. Safe. |
| One-time token (create/edit) | Redis | `ak:tok:{jti}` → `{real_user_id, app_id, form_id, submitted:false}` | 30 min / 4 h | `GETDEL` on consume | **Fails closed** — the link stops working. User re-requests. Safe. |
| Edit-link peek state | Redis | same key, `GET` without delete | 4 h | consumed by `GETDEL` on submit | Fails closed. Safe. |
| Durable anti-double-submit | **MongoDB** | `unique index { link_jti: 1 }` on `submissions` | permanent | never | N/A — survives by design |
| Submission status | MongoDB | `submissions.status` | 3 y (FR-AU-3) | state machine only | N/A |
| Outbox | **MongoDB** | `outbox` collection | until `state='done'` + 7 d | relay claims atomically | **N/A — this is why the relay recovers** |
| Connector delivery record | **MongoDB** | `deliveries` `{connector_id, submission_id, …}` | 3 y | never | N/A |
| Delivery log (IM) | **MongoDB** | `delivery_log` `{submission_id, seq, state}` | 3 y | relay re-drives `pending` | N/A |
| Inbound queue | BullMQ (Redis) | `im.inbound`, `jobId` = platform event id | 24 h completed / 7 d failed | n/a | Platform retries; after 3 retries the event is lost → **alert on `im.inbound` DLQ depth** |
| Outbound queue | BullMQ (Redis) + `delivery_log` | `im.outbound` | 24 h / 7 d | `delivery_log` relay | Relay republishes from Mongo. Safe. |
| Connector queue | BullMQ (Redis) + `outbox` | `connector.execute`, `jobId` = `ext-{submission_id}` | 24 h / 7 d | `outbox` relay | Outbox row intact → republished. Safe. |
| Rate-limit counters | Redis | `ak:rl:{scope}:{id}:{window}` | window + 10% | TTL only | **Fails open** — counters reset. Brief over-admission is acceptable; a hard failure would be worse. |
| JEV circuit-breaker state | Redis | `ak:cb:{provider}` hash | 30 s | TTL | Counters reset; chain re-probes. Safe. |
| OTP attempts | Redis | `ak:otp:{real_user_id}` | 10 min (FR-I-8) | TTL | Fails closed (onboarding retries). Safe. |
| JWT keyring | KMS (source) + Redis + in-process | `ak:jwks`, refetched on unknown `kid` | 5 min | rotation job | Fetch from KMS. Safe. |
| App definitions | In-process LRU | by `(app_id, version)` | LRU | publish bumps version | Rebuild on demand. Safe. |
| Form schemas | In-process LRU | by `(form_id, version)` | LRU | version bump | Rebuild on demand. Safe. |

**What breaks under a Redis Cluster failover — the honest list.** Four distinct failure classes, because they have different severities and the system's response should differ for each:

| Failure | Behaviour | System response | Severity |
|---|---|---|---|
| **In-flight commands fail** during the failover window | ioredis retries; commands that exhaust retries reject | Fall through to Mongo on read paths. **Latency spikes** on identity/RBAC/JEV-cache — NFR-P-1 goes from 1 ms to ~50 ms. Alert, do not crash. | Degraded, recoverable |
| **Acknowledged writes are lost** (async replication — *"acknowledged writes can still be lost during a failover"*) | A consumed token can come back; a rate-limit increment can vanish; OTP attempt counters rewind | **Token: fails open** → double submission possible → **backstopped by the Mongo `jti` unique index** (Pattern: this is precisely why it exists). Rate limit: fails open, brief over-admission. OTP: brute-force window reopens, bounded by 10 min TTL. | Security-relevant, mitigated |
| **BullMQ job state lost** | Enqueued and delayed jobs vanish; schedulers vanish; stalled-job detection may mis-fire and reprocess | Outbox and `delivery_log` rows are in Mongo and survive → relays rebuild the queue. Reprocessing is safe because connector calls carry `Idempotency-Key: submission_id`. | Self-healing |
| **`maxmemory` exhausted with `noeviction`** | Writes **fail**; BullMQ stalls; submissions cannot be routed | This is the *dangerous* one, and it is why the queue Redis is a separate deployment with headroom. Alert at 80% (NFR-O-4) is the mitigation. | **High — this is why cache and queue must not share an instance** |

**The architectural conclusion that falls out of this table:** every state that *must not* be lost (idempotency, outbox, delivery log, submissions, audit) lives in MongoDB. Redis holds only what is either reconstructible, bounded by TTL, or *backed by a MongoDB record*. That is a clean invariant, it is what makes the AD-9 "stateless services" claim true in practice rather than aspirationally, and it is not how the PRD currently frames Redis.

### Flow 5 — the release of a BullMQ-against-Redis-Cluster constraint

BullMQ's internals require atomic operations spanning multiple keys, which "breaks Redis's rules for cluster configurations." The documented fix is a **hash-tag queue prefix** (`prefix: '{akane}'`), which places all keys for that prefix in one hash slot — **one cluster node**.

Consequences to record explicitly in the deployment runbook:

- **Queue throughput does not shard across the cluster.** All BullMQ keys live on one node. That node is a throughput and memory ceiling. Acceptable at NFR-S-2 (50 events/s); a documented limit, not an accident.
- **Give each queue family a distinct prefix** so they distribute: `{akane-q}` for queues, and let application cache keys hash freely (they are single-key `GET`/`GETDEL`, which need no co-location).
- **Never use ioredis `keyPrefix`** — it is incompatible with BullMQ, which has its own prefixing. Use BullMQ's `prefix` option. Two prefixing layers silently corrupting each other is a genuinely nasty bug to debug.
- **BullMQ requires `maxmemory-policy=noeviction`** (docs: `DANGER`). Combined with the PRD's runbook entry *"Redis OOM → evict expired keys"* and its 80%-memory alert, this is a direct contradiction. **Recommendation: two Redis deployments** — `cache` with an evicting policy, `queue+tokens` with `noeviction` and 3× memory headroom. Logical databases on one instance do **not** solve it: `maxmemory-policy` is instance-wide.
- **`maxRetriesPerRequest`** must be `null` for worker connections (BullMQ throws otherwise) and a **finite** value (1–3) for request-path producers, so an HTTP handler fails fast rather than hanging when Redis is down. This is the one place where "share the Redis connection everywhere" must be abandoned: **two connection profiles, not one.**

---

## Build Order — the combinatorial surface is the real threat

### The problem with a layer-by-layer build

The system presents **4 IM platforms × 3 routing modes × 6 link types × 5 app lifecycle states = 360 nominal combinations**, before counting per-platform webhook quirks, per-link-type token lifecycles, and the connector field-mapping language. A layer-by-layer build (adapters → identity → RBAC → JEV → forms → links → routing → UI) produces no demonstrable capability until the last layer lands, and the first integration test — "ask in Slack, get a link, submit, confirm" — arrives at the very end. Every architectural assumption stays unvalidated until it is simultaneously discovered and load-bearing.

**Three mitigations, in order of value.**

**1. Cut the input surface before you cut the output surface.** FR-J-11 already licenses this: slash commands bypass JEV entirely. Build the pipeline against `/leave request` first. It is deterministic, needs no provider, no confidence threshold, and no model latency — which makes it the *only* sensible thing to use as the first integration test. It also produces the harness the JEV path later plugs into, so the work is not throwaway.

**2. Make the test matrix a property of the code, not of the schedule.** The 360 combinations should collapse through shared abstractions *before* anyone counts them:
- All 6 link types reduce to **two** token mechanics: *one-shot* (create, edit — Redis + `GETDEL`) and *stateless-read* (view, query, notification — signed JWT + fresh permission check). Two implementations, not six.
- All 4 IM platforms reduce to **one** inbound controller shape (`verify → validate → enqueue`) and **one** outbound shape (`render → send`). Verified signature mechanics differ per platform; the surrounding contract does not.
- All 5 lifecycle states are **one state machine** consulted at four points (trigger registration, link issuance, read access, submission). Not five code paths.

That is roughly **360 → 2 × 4 × 5 = 40** real cases, of which maybe 12 are genuinely distinct. The `InboundEvent`/`OutboundMessage` contract (FR-IM-2/3) is what makes this collapse possible — it is the single highest-leverage abstraction in the PRD and it should be built first, not alongside the first adapter.

**3. Ship the narrowest vertical slice that a real user could actually use.**

### Recommended phasing

| Slice | Contents | Demonstrable capability | Why here |
|---|---|---|---|
| **S0 — Foundations** | Repo, 3 entrypoint skeletons, `platform/`, `kernel/`, boundary lint config, OTel, health endpoints, testcontainers | `GET /health/ready` on all three processes; CI fails on a boundary violation | The lint rule has to exist before the first module, or it will be retrofitted across 200 files. Cheap now, expensive later. |
| **S1 — The vertical slice** ★ | `adapters/slack/inbound`, `pipeline/`, `identity` (CSV pre-provision only), `authz`, `registry` (one app, `published`, seeded), `forms` (one FormIO schema, pinned version), `links` (create only), `submissions` (internal mode only), form-renderer, `adapters/slack/outbound`, `audit` | **A user types `/leave request` in Slack, receives a link, fills the form, submits, gets a confirmation with a `submission_id`.** | The smallest thing that proves the core value proposition end-to-end. Internal-only routing removes the entire connector/BullMQ/outbox surface from the first proof. Deterministic (no JEV) removes the model from the critical path. |
| **S2 — Natural-language routing** | `decision/` — `RuleBasedProvider` first (offline, in-process, 50 ms), JEV interface + HTTP adapter, fallback chain, deadline propagation, circuit state in Redis, cache | Type *"I want to request leave"* instead of using a slash command | The provider seam cannot be validated without a real provider, but `RuleBasedProvider` must ship first: it is the terminal fallback and its absence means the system has no routing path at all. |
| **S3 — Read path** | Read-link signing + verification, `perm_version` enforcement, Query DSL with auto-injected user filter, renderer view/query mode | A 90-day view/query link that dies the moment permission is revoked | **The highest-risk, highest-value work.** Security model, dual token mechanics, Query DSL scoping. Doing it while the codebase is small and the domain is fresh is right; doing it after the Builder means designing it in a hurry. |
| **S4 — Integration & async** ★ | `connectors/` (REST), `datarouter/`, **transactional outbox**, BullMQ workers + DLQ, external + hybrid modes, `partial` status, `Idempotency-Key`, edit links | Hybrid submission: internal write confirms instantly, external sync lands asynchronously, failures surface as `partial` | Depends on S1's submission record and S3's permission checks. Must not precede S1. |
| **S5 — App Builder UI** | `builder/`, form builder, RBAC management, routing config UI, submission viewer, publish validation | A non-developer builds and publishes a working app without an engineering ticket | **This is the self-sustaining mechanism — it is the product.** But it is a CRUD skin over APIs that are already stable by S4, so it is the *lowest*-risk slice despite being the highest-value one. Building it early means designing UI against APIs that are still moving. |
| **S6 — Multi-IM + observability** | Teams, Zalo, Telegram adapters, full OTel suite, dashboards, alerts, runbooks, inbound webhooks (two-way sync), load test at 1,000 users | An employee on Teams/Zalo/Telegram gets the identical experience | Adapter is now a *known* shape — S1 defined the contract. Adding platforms is additive. |
| **S7 — Post-MVP** | Cross-app collection sharing, group RBAC, i18n, AI-assisted builder, single-step approvals | — | Explicitly out of scope per PROJECT.md. |

★ **S1 and S4 are the two slices that must not be reordered.** S1 proves the value proposition; S4 is the hardest correctness surface in the system. The PRD's §20 puts hybrid in Phase 2 and read links in Phase 4; this plan keeps hybrid where it is but moves the **read path from Phase 4 to S3** — it shares the `perm_version` primitive with the cache (Pattern 1) and the permission path, so it is cheaper to build adjacent to them than to return to later.

**One scope correction for S1.** The PRD's Phase 1 includes OTP onboarding. For the vertical slice, **CSV pre-provisioning alone is enough** (FR-I-2 permits it as a first-class path). Lazy OTP onboarding adds a Redis state machine, a brute-force policy, and a lockout flow to the first slice — none of which the demonstrable capability needs. Ship CSV in S1, OTP in S5 alongside the admin surfaces where it belongs.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|------------------------|
| **0–1k users** (NFR-S-1 — the target) | Modular monolith as designed. 3 entrypoints. Single Mongo replica set, single Redis cache + single Redis queue. **No change.** |
| **1k–10k users** | First split candidates, in order: (1) `worker` scales independently on connector throughput — already a separate process; (2) Mongo per-app collections get a read-replica for Builder queries; (3) Redis cache grows past one node's memory → add a cache node. |
| **10k–100k users** | `decision/` becomes the bottleneck (JEV is a third-party network call). Extract it behind its existing interface — no domain refactor. Mongo per-app collections (up to 200 × 20 = 4,000) start needing index discipline and possibly sharding. |

### Scaling Priorities

1. **First bottleneck: Redis round trips on the hot path, not CPU.** At 50 events/s (NFR-S-2), CPU is nowhere near a limit. What matters is *serialized* round trips. Pattern 1 (one GET per check) + Pattern 4 (one GET for the aggregate toolset) collapse the routing path to ~4 Redis GETs. Add a `MULTI`/pipeline where two are on the same path. **Measure round-trip count, not CPU.** A regression that adds one Redis call to the permission path is a 30 ms budget breach and a 100% CPU increase would look like nothing.
2. **Second bottleneck: JEV latency.** NFR-P-3 is 500 ms of a 2,000 ms budget (NFR-P-5). The cache (FR-J-4) handles repeats; the first call does not. The deadline mechanism is what keeps the *fallback chain* from becoming the problem — a chain of 500 + 1000 + 50 ms can consume the entire end-to-end budget on its own, and every provider after a timeout must be attempted within the *remaining* budget or skipped to `RuleBasedProvider`.
3. **Third: Mongo query shapes on the permission path.** A `$lookup` or an unindexed `{app_id, real_user_id}` turns 2 ms into 400 ms under load. The unique index is not optional and should be asserted in a startup migration check.

**What is deliberately *not* optimized:** microservices for identity/RBAC/links (a network hop for 1–2 ms at 1,000 users), read replicas for the write path, caching app definitions in Redis (they are already in-process LRU and change rarely), or a distributed cache tier (Redis *is* the distributed cache tier).

---

## Anti-Patterns

### Anti-Pattern 1: Pub/Sub as the invalidation mechanism

**What people do:** Publish a `permission.changed` event on role change; subscribers delete their cache entries.

**Why it's wrong:** Redis Pub/Sub is at-most-once. A subscriber that is reconnecting — during a failover, a pod restart, a network blip — silently misses every message published in the gap. The user keeps a permission they lost, for up to the full TTL, with nothing in the logs. FR-R-9's "immediate invalidation on change" is a best-effort promise dressed as a guarantee.

**Do this instead:** Pattern 1 — put the version in the cache key. Staleness becomes structurally impossible rather than statistically unlikely. Keep pub/sub only for warming caches after a version bump, where a lost message costs latency and nothing else.

### Anti-Pattern 2: Trusting BullMQ `jobId` as a durable idempotency key

**What people do:** Set `jobId: submission_id` and rely on BullMQ to enforce write-once (FR-D-12).

**Why it's wrong:** Verified against the docs — *"Jobs that are removed from the queue (either manually, or when using settings such as `removeOnComplete`/`removeOnFailed`) will **not** be considered as duplicates."* The moment retention cleanup runs, the same `jobId` can be added again. For inbound webhooks that is fine (the retention window bounds the platform's retry horizon); for connector calls it is not, because a stalled job can be reprocessed days later. **A queue is a transport, not a ledger.**

**Do this instead:** Pattern 3 — a MongoDB unique index. `{connector_id: 1, submission_id: 1}` on `deliveries` plus `{link_jti: 1}` on `submissions`. Use `jobId` for convenience and for the inbound-dedup case where the bound genuinely holds; use the database for the guarantee.

### Anti-Pattern 3: Doing work inside the webhook receiver

**What people do:** Verify the signature, resolve the user, check permissions, call JEV, then `200`. It works in staging and fails in production when the ack budget runs out and the platform retries — re-running the entire pipeline per attempt.

**Why it's wrong:** Slack gives 3 seconds and 3 retries; Teams retries with 429/502 jitter. Every retry duplicates identity resolution, RBAC aggregation, and a **billable JEV call**. At 50 events/s with a 2 s pipeline, the failure mode is a self-inflicted thundering herd.

**Do this instead:** Pattern 2. The receiver verifies and enqueues, full stop. Target 200 ms; measure ~5 ms.

### Anti-Pattern 4: Making the form renderer the security boundary for read links

**What people do:** Ship the public key to the browser, verify the JWT client-side, and serve the data because "the token was valid."

**Why it's wrong:** The client-side check proves the token was *signed*, not that the user is *currently* permitted. A 90-day-old link from before a termination would pass. Every "did you get fired?" question becomes a browser-side check an attacker controls.

**Do this instead:** Asymmetric signing *and* server-side authority. The browser gets the **public** key — safe to publish, which is the whole reason AD-11 specifies asymmetric over HS256 — and uses it only to fail fast on expiry and render an expired-link message. Checks 6–10 of the verification sequence run server-side, every time, regardless of what the browser concluded.

### Anti-Pattern 5: A single Redis instance with an evicting policy

**What people do:** One Redis cluster for cache, tokens, and BullMQ, with `allkeys-lru` so memory pressure self-heals — and the PRD's own runbook says *"Redis OOM → evict expired keys."*

**Why it's wrong:** BullMQ documents `maxmemory-policy=noeviction` as a `DANGER`-level requirement. Under an evicting policy, Redis can silently evict **queue state** — pending jobs, delayed jobs, schedulers. A submission confirmed to the user can lose its connector delivery with no error anywhere except a DLQ-depth alert hours later. "Self-healing" cache eviction becomes silent job loss.

**Do this instead:** Two deployments. `cache` evicting, `queue+tokens` `noeviction` with headroom. At 1,000 users both are small; the separation costs one instance and removes an entire class of silent corruption.

### Anti-Pattern 6: Letting the three entrypoints drift into the same process

**What people do:** Add a `@Cron` in a service that the API imports "just for now," or import a BullMQ `Worker` into an API module because the queue is already configured. All three entrypoints become the same process and the ack budget quietly dies.

**Why it's wrong:** `@nestjs/schedule` runs **in-memory and per-instance** — a JWT key rotation scheduled on one pod silently does not run on another. That is a **security failure** (NFR-SEC-9), not a bug. PROJECT.md already rejected it for durable work; the boundary rule (R1) exists to stop it creeping back in through a different door.

**Do this instead:** Boundary rule R1 plus the boot-time provider audit. `@nestjs/schedule` is permitted only for sub-minute local ticks with no correctness meaning.

---

## Integration Points

### External Services

| Service | Integration Pattern | Gotchas |
|---------|---------------------|---------|
| **Slack** | Inbound: POST controller with `rawBody: true`, HMAC-SHA256 over `v0:{ts}:{body}`, 5-min timestamp window. Outbound: `@slack/web-api` `chat.postMessage`. Slash-command replies via `response_url`. | **3-second ack, 3 retries.** `response_url` valid for up to 5 responses within 30 minutes. Ack empty, compute async. Webhook URL verification (`url_verification` challenge) must be handled without touching Redis. |
| **Microsoft Teams** | `@microsoft/agents-hosting`; Bot Framework is retired (support ended 2025-12-31) | **429/502 with jitter** — retries must be honoured *and* absorbed by the queue, never propagated to the sender. Activity `id` is the `jobId`. |
| **Zalo OA** | Hand-rolled ~200-line client over `undici`. No official Node SDK exists. | Zalo publishes PHP-only SDK docs; every npm wrapper self-describes as unofficial. **Highest adapter risk — sequence it last, and keep it behind the same `InboundEvent` contract.** |
| **Telegram** | `node-telegram-bot-api` 2.x | Explicit `update_id` → natural `jobId`. Per-chat rate limits are stricter than Slack's. |
| **JEV providers** | HTTP `/decide` + `/health`, behind the `JevProvider` interface | `RuleBasedProvider` runs **in-process** (no HTTP) — a network hop would blow its 50 ms budget and it is the terminal fallback. Circuit state must be shared across replicas (§11.4 currently implies per-instance). |
| **Connector targets** (Redmine, HR, ERP) | `undici` with per-connector timeout (30 s default), retry, rate limit, health check | `Idempotency-Key: submission_id` on **every** attempt — a stalled job reprocesses the call. Credentials unwrapped from KMS per call with a 60 s in-process cache, **never** persisted to Redis. |
| **KMS / Vault** | Secret unwrap, AES-256-GCM at rest | Called only from `platform/crypto` and `connectors` (boundary rule R2). JWT signing keys need `kid` keyring + 90-day dual-key rotation (NFR-SEC-9). |
| **OTel Collector** | OTLP/HTTP traces + metrics + Prometheus scrape | `sdk-node` must initialise **before any instrumented import**, including `AppModule`. Getting this wrong silently loses NFR-O-1's end-to-end trace and nothing fails. |

### Internal Boundaries

| Boundary | Communication | Notes |
|---|---|---|
| `adapters` → `pipeline` | **Queue only** (`im.inbound`) | The hard trust boundary. An `InboundEvent` crosses it; raw platform payloads never do. |
| `pipeline` → `identity` `authz` `decision` `registry` `links` | Direct, in-process | Same process, one DI container — no serialisation, no network hop. This co-location *is* the AD-9 benefit. |
| `submissions` → `datarouter` | Direct call **inside** the Mongo transaction | They share a `ClientSession`. Splitting this pair is what would force a distributed transaction. |
| `datarouter` → `connectors` | **Queue only** (`connector.execute`) | Never a direct HTTP call from the request path. This is what makes `partial` status possible at all. |
| `datarouter` → BullMQ | **Outbox only** — never `queue.add` directly | Pattern 3. A direct `queue.add` after commit reintroduces the loss window. |
| `api` → Mongo/Redis | Direct | No service mesh, no internal HTTP. §13.1's "internal API (service-to-service)" describes a *future* extraction boundary, not a current one — nothing inside the monolith calls it over HTTP today. |
| `worker` → `api` | **None** | The worker never calls the API. If it appears to need to, the logic is in the wrong module — reach for the shared service, not the HTTP endpoint. |

---

## Verdict on the PRD's §7.3 decisions

| # | Decision | Verdict | Amendment required |
|---|----------|---------|---------------------|
| AD-1 | Permission-first routing (Identity → RBAC → Tool Filter → JEV) | ✅ **Keep** | Also: the PRD's §7.1 places the rate limiter *before* identity and the whole pipeline *before* the response. Both are only correct for a synchronous request — with a pure-ingest receiver, the pipeline runs in the consumer. **§7.1 needs a second diagram distinguishing ingest from processing.** |
| AD-2 | JEV-compatible spec as a swappable seam | ✅ **Keep** — the best decision in the PRD | **§11 needs completion, not change.** Add the wire-level framing this document specifies: algorithm allowlist, `iss`/`aud` binding, opaque-ID payload only. Also: circuit-breaker state must be shared across replicas. |
| AD-3 | FormIO.js as sole form engine | ✅ **Keep** | None. `@formio/js` 5 is MIT and ships the OSS drag-and-drop builder; `formiojs` 4 is in maintenance mode. |
| AD-4 | MongoDB as a *primary* destination, not a fallback | ✅ **Keep**, and **strengthen the reasoning** | The real load-bearing reason for the monolith is not latency — it is that the Mongo transaction and the token/permission checks live in **one failure domain**. Splitting them is what would force a distributed transaction. Amend PROJECT.md's rationale accordingly. |
| AD-5 | Shared connector credentials | ✅ **Keep** | None. One more constraint: per-connector rate limiting is *shared across all apps* referencing it (FR-C-4), so it belongs in `connectors`, not in the app config. |
| AD-6 | Per-app RBAC | ✅ **Keep** | None. Note the scale: 1,000 users × 200 apps is 200k `perm_version` values, but only for *assigned* users — sparse writes, `{app_id, real_user_id, roles, permissions, perm_version}` indexed on `(app_id, real_user_id)`. Comfortably within NFR-S-1. |
| AD-7 | Real-user-only RBAC in v1 | ✅ **Keep** | None. Groups are v2 and correctly deferred. |
| AD-8 | Atomic token consumption via Redis | ⚠️ **Keep the mechanism, amend the claim** | `GETDEL` is atomic and correct for the interactive double-submit race (NFR-SEC-1). It is **not** the durability guarantee — an acknowledged `GETDEL` can be lost on Redis Cluster failover (async replication). Add the Mongo `unique index {link_jti: 1}` as the actual guarantee. **Amend NFR-SEC-1's wording**: "atomic consumption" is the race guard; "exactly-once submission" is the index. |
| AD-9 | Stateless application services | ✅ **Keep** — verified genuinely stateless | None needed. No session, no sticky sessions, no in-process cache that must survive. Per-process LRU (app definitions, form schemas) is a rebuildable cache, not state. This holds. |
| AD-10 | BullMQ for async external calls | ✅ **Keep**, but **incomplete without the outbox** | BullMQ alone leaves a loss window between the Mongo commit and `queue.add`. Add the transactional outbox (Pattern 3): the queue becomes a transport, Mongo the ledger. Also: BullMQ on Redis Cluster needs a hash-tag `prefix` (`{akane}`) and `noeviction`. |
| AD-11 | Signed stateless read links (no Redis) | ✅ **Keep** — correct and well-chosen | Verify the verification sequence (Flow 3) is implemented in full, in that order. The 90-day TTL is safe *because* of checks 6–9, not instead of them. Asymmetric signing is right for AD-11's reasons. |
| AD-12 | NestJS as the framework | ✅ **Keep** | Requires `rawBody: true` on the API entrypoint (and it only works with the default body parser enabled — do not set `bodyParser: false`). `enableShutdownHooks()` on all three entrypoints. OTel must initialise before any instrumented import. |

---

## Sources

**Primary (authoritative inputs)**
- `PRD.md` v2.0 §7 (System Architecture), §10 (Data Models), §11 (JEV-Compatible Specification), §12 (User Flows), §13 (API Design Principles), §18.2 (Deployment Topology), §20 (MVP Roadmap), §6.6 (Link Types), §8 (FR-I/R/J/F/L/D/C/N/LC/IM/AU), §9 (NFRs)
- `.planning/PROJECT.md` — adopted decisions, AD-1…AD-12 amendments, constraints

**BullMQ v6 — verified against official docs (HIGH confidence)**
- `docs/gitbook/guide/jobs/job-ids.md` — custom `jobId` deduplication; **jobs removed via `removeOnComplete`/`removeOnFail` are no longer duplicates**
- `docs/gitbook/guide/jobs/deduplication.md` — Simple / Throttle / Debounce modes; manual `job.remove()` disables dedup
- `docs/gitbook/guide/connections.md` — `maxRetriesPerRequest: null` required for workers, finite for request-path producers; **`maxmemory-policy=noeviction` required (DANGER)**; **do not use ioredis `keyPrefix`** (DANGER); `getBackend().client` replaces `Queue#client`; graceful shutdown order
- `docs/gitbook/patterns/redis-cluster.md` — *"Bull internals require atomic operations that span different keys. This behavior breaks Redis's rules for cluster configurations"* → hash-tag prefix required; separate prefixes to distribute queues
- `docs/gitbook/guide/job-schedulers.md` — `upsertJobScheduler` idempotency; special job IDs prevent custom `jobId`; **`tz: 'UTC'` (legacy `utc` removed)**; production rate degrades under queue pressure
- `docs/gitbook/guide/architecture.md` — job lifecycle states
- `docs/gitbook/patterns/idempotent-jobs.md` — jobs must be atomic and idempotent by design

**NestJS — verified against official docs (HIGH confidence)**
- `content/faq/raw-body.md` — `rawBody: true`; `RawBodyRequest<Request>`; **works only if the built-in body parser is enabled**; default `json` + `urlencoded` parsers; `useBodyParser('json', { limit })`
- `content/fundamentals/lifecycle-events.md` — `createApplicationContext()` initialises the app and fires `onModuleInit`/`onApplicationBootstrap`; shutdown hooks require `enableShutdownHooks()`

**MongoDB (HIGH confidence)**
- `mongodb.com/docs/manual/core/transactions/` — ACID multi-document transactions; **replica set required**; `withTransaction` callback API with automatic retry on `TransientTransactionError` / `UnknownTransactionCommitResult`; single-document writes are already atomic; transactions create collections implicitly

**Redis (HIGH confidence)**
- `redis.io` replication docs — **asynchronous replication; acknowledged writes can still be lost during failover**
- `redis.io` pub/sub docs — Redis 7.0 sharded Pub/Sub (`SPUBLISH`/`SSUBSCRIBE`); plain `PUBLISH` propagates across the cluster bus; Pub/Sub is **at-most-once**
- `redis.io` command reference — `GETDEL` introduced in **6.2.0**

**Slack (HIGH confidence)**
- `docs.slack.dev` interactivity docs — **ack must be HTTP 200 within 3 seconds**; `response_url` usable **up to 5 times within 30 minutes**; must ack even when sending composed responses; `trigger_id` expires in 3 seconds

**Tooling (HIGH confidence)**
- `eslint-plugin-boundaries` v5.3.1 (MIT, ~253k weekly downloads, published within the last month) — v5 uses `boundaries/dependencies` with `default: "disallow"` and element/file/module classification; `boundaries/strict` preset enables all rules

**Confidence summary**

| Area | Level | Notes |
|---|---|---|
| Component boundaries & DI wiring | HIGH | All BullMQ/NestJS/MongoDB claims verified against official docs |
| Transactional boundary (hybrid) | HIGH | MongoDB transaction semantics + BullMQ job-id limits both verified |
| Read-path verification | HIGH | Directly derivable from NFR-SEC-2/4, FR-L-3/7/8 and jose's verified-kid API |
| Webhook ingest contract | HIGH | Slack ack/`response_url` limits verified; Teams/Zalo limits are MEDIUM (platform docs not re-verified in this pass) |
| Redis Cluster failure behaviour | MEDIUM-HIGH | Mechanism verified; blast radius at *this* scale is reasoned, not load-tested |
| JEV fallback latency budget | MEDIUM | Derived arithmetic from the PRD's own §11.4 timeouts; needs a load test to confirm |

**Gaps this research could not close**
- Zalo OA webhook signature scheme and rate limits — no official Node SDK and PHP-only docs; verify during the Zalo adapter phase, not before.
- Teams 429 backoff envelope specifics — must be absorbed by the queue regardless, but the exact limits were not re-verified here.
- Whether the FormIO server-side validation path (`@formio/js` in Node) is performant enough for NFR-P-4 (<800 ms); the SSR path may need a lighter validator. Worth a spike.
- MongoDB connection-pool sizing under 1,000 concurrent users with the transaction path — reason from the driver's defaults and load-test in S6.

---

*Architecture research for: IM-Driven App Builder & Integration Gateway*
*Researched: 2026-10-01*