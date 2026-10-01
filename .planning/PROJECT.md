# IM-Driven App Builder & Integration Gateway

## What This Is

An enterprise platform that turns the Instant Messaging systems employees already use
(Slack, Microsoft Teams, Zalo, Telegram) into the front door for the internal and external
systems they already need — Redmine, HR, ERP, ticketing, procurement, asset management.
A user types a plain-language request or slash command in chat; a permission-first routing
pipeline resolves their identity, filters tools by RBAC, asks a swappable JEV-compatible
decision model to pick the right app, and replies with a signed link to a FormIO.js form.
The submitted data is then routed to internal document storage, an external system through
a connector, or both. Department admins build and own their own apps — forms, roles, routing
destinations — through a self-service App Builder, without engineering tickets.

**Core Value:** An employee can complete a cross-system task entirely through chat plus a single rendered
form, without ever logging into — or learning — the downstream system.

The product is deliberately **not** a chatbot. The chatbot is the entry point; the
form-plus-integration pair is the product, and the App Builder is what makes the platform
self-sustaining.

## Requirements

### Validated

(None yet — ship to validate)

### Active

All Active requirements are **hypotheses** until shipped and validated.

- [ ] **Identity resolution** — every inbound chat message resolves `chat_user_id` → `real_user_id`
  before anything else happens, via pre-provisioned CSV import or lazy OTP onboarding
- [ ] **Per-app RBAC on real users** — each app owns its roles, permissions, and assignments;
  enforcement at two points (pre-JEV tool filter, pre-execution re-check)
- [ ] **JEV-compatible decision layer** — a swappable provider interface (`/decide`, `/health`)
  with a configurable fallback chain, so no vendor lock-in and decisions survive provider outage
- [ ] **FormIO.js as the sole form engine** — drag-and-drop builder in the App Builder, renderer
  as a separate stateless web app; no IM-native form rendering
- [ ] **One-time create/edit links** — JWT + Redis, atomically consumed on submit
- [ ] **Signed read links** — stateless 90-day view/query links with a fresh permission check and
  `perm_version` comparison on every access
- [ ] **Data routing: internal / external / hybrid** — MongoDB collections, connector calls, or both
  (internal synchronous, external async via BullMQ)
- [ ] **Connector layer** — shared, globally managed credentials with rate limiting, retries, DLQ,
  and `submission_id` idempotency
- [ ] **Slack adapter** — inbound/outbound normalization, slash commands, webhook verification
- [ ] **Teams / Zalo / Telegram adapters** — same normalized `InboundEvent`/`OutboundMessage` contract
- [ ] **App Builder UI** — app CRUD, triggers, RBAC, form design, routing config, lifecycle,
  submission viewer, preview before publish
- [ ] **Audit trail** — immutable, append-only, 3-year minimum retention, every state change
- [ ] **Observability** — trace ID = `submission_id` end to end, Prometheus metrics, alerts,
  `/health/live` + `/health/ready`
- [ ] **Inbound webhooks for two-way sync** — HMAC-signed notifications back to the original submitter

### Out of Scope

- **General-purpose conversational AI assistant** — task-oriented routing, not open-ended chat
- **Becoming system of record for downstream data** — we route, we don't own (P3)
- **Native IM form rendering (adaptive cards, block kits)** — FormIO.js everywhere, one engine
- **Multi-step workflow engine (BPMN, approval chains with branching)** — single-step submissions in v1
- **Group-based / attribute-based RBAC** — real-user-only in v1; group sync is v2
- **Real-time multi-user form collaboration** — deferred
- **Mobile-native applications** — responsive web is sufficient
- **Offline mode / client-side caching** — network connectivity assumed
- **Cross-organization multi-tenancy** — single enterprise deployment in v1
- **Cross-app collection sharing** — PRD Phase 5, post-MVP
- **Form i18n (multi-language labels)** — PRD Phase 5
- **AI-assisted form builder** — PRD Phase 5
- **Telegram adapter** — PRD Phase 5 (Slack is P0; the other three are P1)

## Context

**Source document.** `PRD.md` (v2.0, 2026-09-30) is the authoritative input and is committed at the
repo root. It is a complete, unusually specific PRD — 21 sections covering architecture, 130
functional requirements with P0/P1/P2 priorities, 40+ NFRs, data models, the JEV wire spec,
user flows, security, observability, testing, and a 5-phase MVP roadmap.

**Known gap in the PRD.** The table of contents lists §22 Risk Assessment, §23 Open Questions,
§24 Glossary, and §25 Appendices, but the document body ends at §21 Success Metrics & KPIs. Those
four sections were never written. Risk and open-question analysis must be derived during research
rather than read from the PRD.

**PRD's own timeline vs. credible estimate.** PRD §20 proposes 5 phases totalling 19–28 weeks,
with Phase 5 explicitly post-MVP. A stack-research pass put the credible v1 estimate at
**26–34 weeks**, on the grounds that the PRD's sequencing defers the *read* path and the *App
Builder* past several things that depend on them. That figure has since been **superseded**: the
roadmap re-derived the estimate bottom-up against the actual 8-phase structure and landed at
**~43 weeks P50 (range 38–49)**, assuming one engineer plus one implementer agent. The delta is
+9 to +17 weeks, driven by v1 now containing Teams *and* the App Builder *and* Redmine *and* full
compliance tooling, the read path moving into v1, and a bottom-up estimate from per-phase
surfaces rather than the PRD's 5-phase layer sequence. **ROADMAP.md → Timing** is the number to
plan against. Contingency not yet included: 2–3 weeks if the customer genuinely requires SAML
rather than OIDC.

**The PRD's stack table is stale in seven places.** A version-verification pass (npm registry
`dist-tags`, `peerDependencies`, `engines`, `time.modified`; redis.io command metadata;
endoflife.date; Microsoft Learn; Slack changelog) found that seven of the PRD §7.4 rows
are wrong or unsatisfiable as written. These are recorded as Key Decisions below and are
load-bearing — they are not cosmetic upgrades. Research (`STACK.md`) is the evidence base.

**Two PRD constraints are unsatisfiable as literally written**, and the amendments are
deliberate rather than accidental:
- *"Official IM SDKs only"* cannot be honored for two of four platforms (Teams' Bot Framework SDK
  is retired and the package the PRD names does not exist on npm; Zalo publishes no Node SDK at all).
- *"Erasure / GDPR right-to-be-forgotten"* is broken by construction unless PII is excluded from
  logs *before* serialisation via a field allowlist — a denylist regex always misses, and a
  1-year cold log retention makes the promise unachievable.

**Scale target drives the architecture, not the reverse.** 1,000 concurrent users, 200 apps max,
20 forms per app, ~1M submissions per app before archival. This is small enough that a modular
monolith beats microservices: microservices would add a network hop and a distributed transaction
to the two hottest paths (permission re-read, token consume) for no benefit at this size.

**Consequence for the read path.** `View`/`Query` links are stateless signed JWTs with **no Redis
storage**, checked fresh on every access, and invalidated by a monotonically increasing
`perm_version` per user-per-app. This scales to millions of outstanding read links without
memory pressure, and it is the reason `jose` (with `kid`-keyed keyring resolution) was chosen
over `@nestjs/jwt`.

**Research is complete and it changed the plan, not the stack.** `.planning/research/` (four
researchers + synthesis, 2026-10-01) audited the stack spine and found only patch-level drift —
what it changed was the *ordering*. All four researchers independently reached the same headline:
**the dominant risk in this project is build order, not technology.** The stack survived; the
PRD's §20 phase sequence did not. See `.planning/REQUIREMENTS.md` for the three resolved
requirement conflicts and the v1 scope calibration, and `research/SUMMARY.md` for the
cross-research disagreements that were resolved rather than averaged.

**Three decisions must be recorded before Phase 1 code is written**, because code written
against the PRD as written will encode the losing side of each contradiction by accident:
the per-IP rate-limit ruling, the trace-ID/erasure ruling, and the `FR-D-12` write-once
amendment. All three are in Key Decisions below.

## Constraints

- **Runtime**: Node.js **24 LTS** — Node 20 hit EOL 2026-04-30, and NFR-SEC-12 (critical vulns block
  deploy) is unachievable on an EOL runtime. Node 22 expires 2027-04-30 (too soon); Node 26 only
  enters LTS 2026-10-28 (too new to pin)
- **Framework**: NestJS **12** — ships Standard Schema, so Zod 4 is first-class and
  class-validator/class-transformer are dead weight. CommonJS apps keep working: no ESM migration tax
- **TypeScript hard-pinned to 6.0.3**, lockfile committed in the first commit — npm `latest` is
  7.0.2, which violates `@nestjs/swagger@12`'s peer range `^5.5 || ^6.0` and breaks a fresh
  `npm install`. This is a trap for any install without a lockfile
- **HTTP adapter: Express, not Fastify** — `@slack/bolt@5` bundles `ExpressReceiver` on
  `express@^5`, so Fastify means running a second HTTP stack in one process; and
  `auto-instrumentations-node` bundles `instrumentation-express` but **not**
  `instrumentation-fastify`, so NFR-O-2 would lose the instrumented path
- **MongoDB 8.0.x with the native `mongodb` driver, not Mongoose** — app-builder schemas are
  runtime-defined, so a compile-time `Schema` model has no value here; one data-access style
  everywhere beats two
- **Redis 8.2 cluster with ioredis 6** — do **not** pin 8.0.x (EOL 2026-12-01); do **not** pin
  ioredis 5.x (High *Uncontrolled Recursion* advisory, fixed only in 6.0.0). BullMQ ships ioredis,
  so sharing one client halves the connection surface
- **Modular monolith, not microservices** — one NestJS codebase, three process entrypoints
  (`api` / `worker` / `scheduler`), one DI graph enforcing component boundaries at wiring time,
  backed by a lint rule that fails the build on a boundary violation
- **Webhooks ack in <200 ms and enqueue; all logic runs in the consumer** — Slack's 3-second
  ack/3-retry limit and Teams' 429/502 retry-with-jitter make the receiver a pure ingest
  contract; a slow permission lookup inside the receiver is how submissions get lost
- **State**: application services stateless, all session state in Redis, no sticky sessions
  (PRD AD-9) — required for horizontal scaling
- **Secrets**: KMS-backed (Vault / AWS / GCP KMS) with AES-256-GCM. No secrets in code, config
  files, or plaintext env vars
- **Single enterprise deployment in v1** — no cross-org isolation work (PRD NG8)
- **PII never in JWTs** — opaque IDs only (`real_user_id`, `app_id`, `jti`)
- **Rate limits** (NFR-SEC-6): per-user 10 req/min, per-app 100 req/min, per-connector per config
- **Availability**: 99.9% uptime, RPO ≤ 1 h, RTO ≤ 4 h, zero-downtime rolling deploys
- **Data residency**: configurable and region-locked per deployment
- **Compliance**: 3-year minimum audit retention; GDPR-aligned erasure and export. Erasure
  requires a **field allowlist applied before log serialisation**
- **Dependency scanning in CI**, critical vulnerabilities blocking deployment
- **Access**: admin surfaces authenticate via OIDC/SAML SSO with MFA; service-to-service uses
  mTLS or internal tokens

## Key Decisions

Architectural decisions AD-1 … AD-12 are the PRD's own (§7.3) and are adopted as-is. The rows
below are the **amendments** — decisions that override the PRD, each with the evidence that
forced it.

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| AD-1 Permission-first routing (Identity → RBAC → Tool Filter → JEV) | Shrinks JEV input space, prevents exposing unauthorized tools, cuts cost | ✓ Good |
| AD-2 JEV-compatible spec as a swappable seam | Provider swap without core changes; enables fallback chains, A/B, conformance tests | ✓ Good |
| AD-3 FormIO.js as sole form engine | One renderer, one builder, consistent UX, no IM-native fragmentation | ✓ Good |
| AD-4 MongoDB as a *primary* destination, not a fallback | Internal storage is a first-class mode, not a degraded one | ✓ Good |
| AD-5 Shared connector credentials (one service account, many projects) | Kills credential sprawl; mirrors the Redmine model | ✓ Good |
| AD-6 Per-app RBAC | Multi-department isolation; HR permissions cannot leak into IT ticketing | ✓ Good |
| AD-7 Real-user-only RBAC in v1 | No group-sync complexity. Groups are v2 | — Pending |
| AD-8 Atomic token consumption via Redis | Prevents double submission; race-condition safe | ✓ Good |
| AD-9 Stateless application services | Horizontal scaling, no sticky sessions | ✓ Good |
| AD-10 BullMQ for async external calls | Decouples submission latency from external API latency | ✓ Good |
| AD-11 Signed stateless read links (no Redis) | Millions of read links without memory pressure; fresh permission check compensates | ✓ Good |
| AD-12 NestJS as the application framework | TS, DI, module boundaries, OpenTelemetry support | ✓ Good |
| **Amend Node 20+ → Node 24 LTS** | Node 20 EOL 2026-04-30; only line with ≥18 months runway | — Pending |
| **Amend NestJS 10+ → NestJS 12.1.1** | v12 is current and ships Standard Schema, replacing class-validator | — Pending |
| **Hard-pin TypeScript 6.0.3** | npm `latest` (7.0.2) breaks `@nestjs/swagger@12` peer range and risks decorator-metadata breakage | — Pending |
| **Zod 4 + `StandardSchemaValidationPipe`, reject class-validator** | class-transformer last published 2022-12-09; `nestjs-zod` is deprecated by its own docs | — Pending |
| **Express, reject Fastify** | Bolt 5 bundles `express@^5`; OTel auto-bundle has no `instrumentation-fastify` | — Pending |
| **Native `mongodb` driver, reject Mongoose** | Runtime-defined schemas; Mongoose's compile-time model has no value here | — Pending |
| **ioredis 6, reject node-redis** | BullMQ ships ioredis; cluster path is mature; OTel bundles `instrumentation-ioredis` | — Pending |
| **BullMQ Job Schedulers, reject `@nestjs/schedule` for durable work** | In-memory per-instance scheduling means a JWT key rotation can silently not run on one pod — a security failure | — Pending |
| **`jose` 6, reject `@nestjs/jwt`** | `@nestjs/jwt` wraps `jsonwebtoken`, which has no JWKS and no `kid` keyring; 90-day dual-key rotation would be hand-rolled | — Pending |
| **Asymmetric link signing (EdDSA / ES256)** | HS256 is the wrong primitive for a 90-day stateless read link; asymmetry lets the static Form Renderer verify without holding the signing key | — Pending |
| **`@formio/js` 5, reject `formiojs` 4** | 4.x is in official maintenance mode. 5.x is MIT and **ships the drag-and-drop builder in the OSS build** (`dragula` is a direct dep) | — Pending |
| **Teams: Microsoft 365 Agents SDK, reject Bot Framework** | Bot Framework support ended 2025-12-31; `botframework-sdk` does not exist on npm. Also: `-extensions-teams` is npm-deprecated by its own publisher | — Pending |
| **Zalo: hand-rolled ~200-line client over `undici`** | No official Node SDK exists (Zalo's own SDK docs are PHP-only); every npm wrapper self-describes as unofficial | — Pending |
| **Telegram: `node-telegram-bot-api` 2** | Actively published TS rewrite; `grammy` still on `node-fetch@^2` | — Pending |
| **`undici` / global `fetch`, reject axios** | OTel already bundles `instrumentation-undici`; a second HTTP path is exactly where NFR-O-1's end-to-end trace breaks | — Pending |
| **Metrics: OTel API + `exporter-prometheus`, reject `prom-client`** | One scrape endpoint, one naming convention, one set of alert rules | — Pending |
| **Hand-written `ThrottlerStorage` over ioredis** | The interface is `increment` + set-TTL — ~40 lines over a connection already owned; both community Redis throttler packages are avoidable supply-chain surface | — Pending |
| **No cookies on the form-renderer origin (structural CSRF defense)** | `csurf` is npm-deprecated; a cookie-free origin removes the CSRF class rather than mitigating it | — Pending |
| **PII field allowlist before log serialization** | A denylist regex always misses; right-to-erasure is unachievable otherwise | — Pending |
| **Rate limit tiers map to `@nestjs/throttler` named throttlers** | The three NFR-SEC-6 tiers (per-user, per-app, per-connector) are exactly what named throttlers express | — Pending |
| **npm workspaces, reject nx / turbo** | 2 web apps + 1 API + 1 worker; a build-graph tool is unjustified overhead at this size | — Pending |
| **Planning estimate 26–34 weeks, not PRD's 19–28** | PRD sequencing defers the read path and App Builder past their dependents | ⚠️ Superseded — see the ~43-week bottom-up estimate in ROADMAP.md |
| **NFR-SEC-10 per-IP brute-force cap loses** to NFR-A-1 / FR-R-10 | Six legitimate users behind one corporate NAT would trip the cap and lock out an entire office. This is a self-inflicted outage | — Pending |
| **NFR-O-1 `trace_id = submission_id` loses** to FR-AU-5 / §15.4 | A stable, correlatable trace ID *is* a 3-year un-purgeable activity map living in a store with no per-app RBAC | — Pending |
| **FR-AU-3/5 (3-year immutable audit) wins** over §15.4 erasure | 3-year audit retention is a hard compliance obligation. §15.4's erasure promise is **narrowed to what the code delivers**: PII excluded from logs by allowlist before serialisation + tombstoneable `actor_ref` + defined purge windows for submission bodies | ⚠️ Revisit — the "legitimate interest" framing needs counsel, not research |
| **`FR-D-12` write-once is amended, not implemented** | Unimplementable against most enterprise downstreams. The platform guarantees a single *send* per submission; write-once additionally requires downstream idempotency-key support or a natural-key pre-check, declared per connector | — Pending |
| **v1 = Slack × (internal + one external connector)** | 4 platforms in v1 costs +8–12 weeks of variance against a 26–34 week target. Internal-only would make this a form-forwarder, not a gateway. Teams is the first expansion; Zalo and Telegram defer past v1 | — Pending |
| **Vertical-slice build order, not PRD §20's layer order** | All four researchers independently concluded the dominant project risk is build order, not technology. The read path moves from Phase 4 to immediately after the vertical slice; the App Builder stays put because building it earlier means designing UI against moving APIs | — Pending |
| **`GETDEL` is the fast path, a MongoDB unique index is the guarantee** | Redis replication is asynchronous — acknowledged writes can be lost on failover, so a consumed one-time link can return to life | — Pending |
| **Cache and queue use two separate Redis deployments** | BullMQ requires `maxmemory-policy=noeviction`; the PRD runbook says "evict expired keys". The policy is instance-wide, so one instance cannot safely be both. Split **before** queues carry data, not during a later phase | — Pending |
| **Epoch-keyed cache keys replace Redis Pub/Sub as the correctness mechanism** | Pub/Sub is at-most-once, so a dropped message means a stale permission read. Embedding `perm_version` in the cache key makes one primitive serve both the RBAC cache and the read-link check; Pub/Sub becomes a latency optimisation only | — Pending |
| **The `JEV-compatible` wire contract is published as a first-party named interface** | "JEV" is a hosted vendor model; the PRD's "OpenJev" reference implementations are unofficial reconstructions and no industry standard exists | — Pending |
| **`FR-F-10` file upload is blocked pending licensing resolution** | Form.io's `File` component is **premium** (Library Licence + `@formio/premium`) while the renderer is MIT and the engine is OSL 3.0 — this directly threatens AD-3's open-source claim. Resolve in Phase 0 discovery | ⚠️ Revisit |
| **Draft save & resume is blocked pending a token-model decision** | Structurally incompatible with the stateless one-time-token SPA; a resumable draft needs a second, longer-lived token class | ⚠️ Revisit |
| **TypeScript 6.0.3 enforcer is `typescript-eslint`, not `@nestjs/swagger`** | The prior analysis attributed the hard `ERESOLVE` to Swagger, whose TS peer is optional and only warns. `typescript-eslint@8.71.0` (peer `>=4.8.4 <6.1.0`, not optional) is the actual enforcer. Conclusion unchanged, reason corrected | ✓ Good |
| **MongoDB 8.2 is already EOL (2026-07-31) — stay on 8.0.x** | It was previously recorded as "inconsistent across sources". It is not inconsistent; it is dead | ✓ Good |
| **Redis ≥8.2 as a floor, 8.10.x as develop-against** | 8.0.x EOLs 2026-12-01 (62 days out). A floor survives a future minor release; a pin does not | — Pending |
| **ESLint over NestJS 12's new oxlint scaffold** | `eslint-plugin-boundaries@7.2.0` is required by the "boundary violation fails the build" constraint and is ESLint-only | — Pending |
| **`@nestjs/observe` is rejected, not deferred** | It has no OTLP exporter and routes to a NestJS-hosted backend. It would also break data residency. The earlier "re-evaluate in Phase 4" is cancelled | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-01 after initialization*
