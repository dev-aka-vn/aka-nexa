# Requirements: IM-Driven App Builder & Integration Gateway

**Defined:** 2026-10-01
**Core Value:** An employee can complete a cross-system task entirely through chat plus a single
rendered form, without ever logging into — or learning — the downstream system.
**Baseline:** `PRD.md` v2.0 (2026-09-30) + `.planning/PROJECT.md` + `.planning/research/SUMMARY.md`

**Scoping decision (auto mode).** v1 is scoped by the research calibration, not by the PRD's
priority labels: **v1 = Slack × (internal routing + exactly one external connector)**, plus the
self-service App Builder, plus Teams as the first platform expansion. Four IM platforms in v1
costs +8–12 weeks of variance against a 26–34 week target and buys nothing against the core
value. Shipping `internal` routing only would make this a form-forwarder rather than a gateway,
so one external connector (Redmine) is mandatory. Zalo and Telegram defer past v1.

The PRD marks 14 requirements P0 whose cost contradicts the priority label. Those are moved to
**v2** here, with the reason recorded, rather than silently carried.

---

## Resolved Requirement Conflicts

Three genuine contradictions exist between PRD requirements. Research named a winner for each.
**Code written before these rulings will encode the losing side by accident.** These rulings
are v1 requirements in their own right, and they amend the PRD.

| # | Conflict | Ruling | Consequence to implement |
|---|----------|--------|-------------------------|
| 1 | `NFR-SEC-10` per-IP brute-force cap vs `NFR-A-1` / `FR-R-10` availability | **`NFR-SEC-10` loses.** Six legitimate users behind one corporate NAT would trip the cap and lock out the whole office. | Rate-limit per **user** and per **link `jti`**, not per IP. Block only on *signature* failures — never on expired, consumed, or stale-but-benign outcomes. Alert on `block>0 ∧ signature_invalid≈0`, which means a false positive. |
| 2 | `NFR-O-1` `trace_id = submission_id` vs `FR-AU-5` / §15.4 erasure | **`NFR-O-1` loses.** A stable, correlatable trace ID *is* a 3-year un-purgeable activity map in a store with no per-app RBAC. | Decouple trace ID from `submission_id`. Make `actor_ref` **tombstoneable** so erasure can null the reference without breaking the row. |
| 3 | `FR-AU-3`/`FR-AU-5` 3-year immutable audit vs §15.4 right-to-erasure | **`FR-AU-3`/`FR-AU-5` win.** 3-year audit retention is a hard compliance obligation. | **Narrow the §15.4 erasure promise** to what the code delivers: PII excluded from logs by field allowlist *before* serialisation + tombstone of the actor reference + defined purge windows for submission bodies. Do not promise full erasure of the audit record. Confirm the "legitimate interest" framing with counsel — that is a legal question, not a research question. |

Additionally, `FR-D-12`'s write-once guarantee is **unimplementable as written** against most
enterprise downstreams. It is **amended, not implemented** — see `DAT-11`.

---

## v1 Requirements

Requirements for the initial release. Each maps to exactly one roadmap phase.

### Foundations & Platform

- [x] **FND-01**: A clean checkout builds and runs with `npm ci` without breaking, on Node 24 LTS, NestJS 12, and a hard-pinned TypeScript 6.0.3
- [x] **FND-02**: The repository commits `package-lock.json` in its first commit, and `.nvmrc` pins the Node major
- [x] **FND-03**: The codebase contains three independently runnable process entrypoints — `api`, `worker`, and `scheduler` — that never drift into a single process
  - **(01-10) Complete — verified by booting, not by inspection.** Three `dist/main.js`
    entrypoints, three `otel.mjs` loaders, three `app.module.ts` composition roots, three
    per-app `BoundaryManifest`s, and three ports (3000/3001/3002, derived from `SERVICE_NAME`
    by `DEFAULT_PORT_BY_SERVICE` in the boot schema rather than written next to `listen()`).
    All three boot for real against MongoDB + two Redis deployments and answer `/health/live`,
    `/health/ready` and `/metrics` on their own ports, each reporting its own `service_name`
    on its own exporter. Three independent controls hold them apart: the lint gate
    (`boundaries/dependencies` with `checkAllOrigins: true`, plus a scoped
    `no-restricted-imports` on the `Worker` binding), the boot-time `ProviderBoundaryGuard`
    (aborts in `OnApplicationBootstrap`, before `listen()` binds), and
    `tooling/entrypoint-drift.spec.ts` (an import-closure walk from each `main.ts`). Each has
    been negatively controlled by planting the violation it exists to catch.
- [x] **FND-04**: A lint rule fails the build when a module imports across a declared component boundary
  - **(01-03 delivered; re-verified by 01-10 against the real `npm run build`.)** `npm run build`
    is `npm run lint && tsc -b`, so a violation fails a local build and CI identically. 01-10
    planted a real cross-component import and confirmed the build exits non-zero, and planted a
    `Worker` binding in `apps/api` and confirmed `no-restricted-imports` fires. Two of the
    rule's silent non-enforcement modes are pinned by executable assertions rather than trusted
    by inspection: `checkAllOrigins` (without it R2/R3 are dead configuration) and the custom
    import resolver (without it every relative import is invisible and the rule reports zero).
- [x] **FND-05**: `api`, `worker`, and `scheduler` each expose `/health/live` and `/health/ready`, where liveness checks no dependency and readiness checks MongoDB and both Redis deployments
  - **(01-10) Complete — verified against running processes.** Booted evidence, each process
    from its own `dist` entrypoint through its own `otel.mjs` loader: `/health/live` → 200
    `{"status":"ok"}`; `/health/ready` → 200 with `mongo: up`, `redis_cache: up`,
    `redis_queue: up` on all three, plus `bullmq_workers: {workers: 1, status: "up"}` on the
    worker and `job_schedulers: {scheduler: "platform-heartbeat", status: "up"}` on the
    scheduler. Liveness reads no dependency by construction — its body is a fixed literal, so
    a Redis blip fails readiness without triggering a restart loop. The tracer's app-local
    live-only controller was **deleted**, so exactly one definition of each route exists in
    the repository. The same boot run also produced a negative control worth recording:
    `/health/ready` reported `bullmq_workers: up` while the worker was listening on the wrong
    queue prefix and consuming nothing, which is why "every registered Worker is listening"
    (D-10) is now backed by a prefix assertion and not by `Worker.isRunning()` alone.
- [x] **FND-06**: Structured JSON logs exclude PII by a **field allowlist applied before serialisation**, not a denylist filter
- [x] **FND-07**: The OpenTelemetry trace ID is generated independently of `submission_id` and is not correlatable back to it
  - **(01-09) Delivered and proven.** `SPAN_ATTRIBUTE_ALLOWLIST` is a frozen constant enforced by
    `AllowlistSpanExporter` at the export boundary — the only point where it *can* be enforced, since
    `SpanProcessor.onStart` receives a `Span` with no read and no delete. Five spans carrying one
    `submission_id` through a real `TracerProvider` get five distinct trace ids, and no exported span's
    attributes match `/submission/i`. Fourteen URL/address attributes the HTTP instrumentation emits on
    every span are named and excluded, because a URL path carries the submission id. **Deployed by
    01-10:** all three entrypoints start the SDK through `apps/*/otel.mjs` before any application
    module is loaded, and again defensively at the top of `main.ts` before the dynamic
    `import('./app.module.js')` — the ordering 01-09 measured (7 spans vs 1) is now the shape
    every process actually runs, not a counterfactual.
- [x] **FND-08**: Long-running scheduled work runs on BullMQ Job Schedulers, so a task registered once runs on every replica
  - **(01-08) Mechanism delivered. (01-10) Complete — verified against running processes.** The
    requirement has two halves and both are now demonstrated on live Redis rather than asserted.
    *Registered once, runs on every replica:* `apps/scheduler` calls `registerPlatformHeartbeat`
    (an idempotent `upsertJobScheduler`) from `onApplicationBootstrap` on **every** boot with no
    leader election, and a booted scheduler's `/health/ready` reads the scheduler back **out of
    Redis** (`job_schedulers: {scheduler: "platform-heartbeat", status: "up"}`) rather than
    reporting a cached flag. *The work actually runs:* `apps/worker` is the only process that
    constructs a `Worker`, and after 75 s of a booted worker+scheduler pair Redis held
    `{akane-q}:platform-heartbeat:completed` and the worker's own `/metrics` served
    `platform_heartbeat_total{otel_scope_name="akane"} 2` — the plan-08 instrument moved, on the
    OTel meter, through the one Prometheus exporter. **This needed a boot to get right:** 01-10's
    draft worker was constructed without `prefix`, so it listened on BullMQ's default
    `bull:platform-heartbeat` while the producer and scheduler used D-14's `{akane-q}` — and
    `/health/ready` still reported `bullmq_workers: up`, because `Worker.isRunning()` asks only
    whether the blocking loop is alive. `platformHeartbeatWorkerOptions()` is now one assertable
    value pinned against `queueRootOptions`' prefix.
- [x] **FND-09**: All configuration is validated at boot by Zod; an invalid or missing required value fails startup with a named error
- [ ] **FND-10**: Secrets are encrypted at rest with AES-256-GCM under a KMS-backed master key, and no secret appears in code, config files, or plaintext env vars
  - **STAYS PENDING. Nothing in plan 10 touches it and nothing could.** The AES-256-GCM envelope,
    the `KeyProvider` interface and the production guard (`NODE_ENV=production` without
    `CRYPTO_KEY_PROVIDER=kms` refuses to boot) all landed in 01-05 and are proven. The one part
    that is not delivered is the **KMS vendor adapter**, which D-27 names as blocked on naming the
    deployment cloud (blocker B-3 / D-27). The requirement says "under a KMS-backed master key",
    and no KMS-backed master key exists yet — only a local one, correctly refused in production.
    Phase 1 also stores no real secret (D-28), so nothing is currently exposed by the gap; the
    *first* stored secret is a connector credential in Phase 5, and WINDOWS.md entry 7 is open
    against that point.

### Identity & User Resolution

- [ ] **IDN-01**: Every inbound chat message resolves `chat_user_id` → `real_user_id` before any other processing
- [ ] **IDN-02**: An admin can bulk-import identity mappings from a CSV file
- [ ] **IDN-03**: One real user can hold multiple chat identities across different IM platforms
- [ ] **IDN-04**: An unmapped user receives an onboarding prompt with instructions, never a raw system error
- [ ] **IDN-05**: A user can self-onboard by verifying an OTP sent through their IM account, expiring after 10 minutes with max 3 attempts and a 30-minute lockout
- [ ] **IDN-06**: Deactivating a mapping stops future resolution without deleting that user's historical submissions
- [ ] **IDN-07**: An admin can search mappings by email, `real_user_id`, or `chat_user_id`
- [ ] **IDN-08**: An admin can map an SSO identity to a `real_user_id` without the user performing OTP verification

### Per-App Access Control

- [ ] **ACL-01**: Each app defines its own roles and permissions, and a role in one app grants nothing in another
- [ ] **ACL-02**: Roles are assignable only to `real_user_id`; no group or attribute-based assignment exists
- [ ] **ACL-03**: Every app ships with the default roles `owner`, `admin`, `manager`, and `user`
- [ ] **ACL-04**: An app has exactly one `owner` at all times
- [ ] **ACL-05**: Ownership transfer requires global admin approval and auto-cancels after 7 days if unapproved
- [ ] **ACL-06**: A user's permissions are checked twice per request — once to filter the tool list before any decision-model call, and again at the execution boundary
- [ ] **ACL-07**: Any permission change bumps a per-user-per-app `perm_version` epoch, and the epoch is embedded in the RBAC cache key
- [ ] **ACL-08**: A stale cached permission entry is never served after an epoch bump, with or without a Pub/Sub message
- [ ] **ACL-09**: A permission denial returns a clear user-facing message naming the missing permission, not a generic error
- [ ] **ACL-10**: An app owner can view and modify all role assignments in their app except ownership transfer
- [ ] **ACL-11**: There is no superuser bypass for app-level permissions; only platform operations use global admin

### Routing Decision

- [ ] **RTE-01**: A user can trigger an app by plain-language message and have the correct app selected
- [ ] **RTE-02**: A user can trigger an app by slash command with deterministic routing that bypasses the decision model entirely
- [ ] **RTE-03**: The decision model receives only the tool set the requesting user is authorized for, never the global catalogue
- [ ] **RTE-04**: Decision providers are pluggable through a configuration-driven registry, so swapping one requires no change to routing logic
- [ ] **RTE-05**: A rule-based provider answers offline with no external dependency and is the terminal link in the fallback chain
- [ ] **RTE-06**: The fallback chain is ordered by config and each provider's timeout is derived from a deadline that propagates down the chain rather than a fixed per-attempt timeout
- [ ] **RTE-07**: Provider health is checked every 60 seconds and unhealthy providers are skipped in the chain
- [ ] **RTE-08**: A decision below the app's configured confidence threshold produces a clarification prompt rather than a wrong action
- [ ] **RTE-09**: Decision responses are cached by `hash(text + sorted(tool_ids) + locale)` with a configurable TTL
- [x] **RTE-10**: The decision wire contract is frozen before any provider is integrated, including `choice.verified` and `state.force_clarification`
- [ ] **RTE-11**: Every provider passes a conformance suite of 50 labelled intents and degrades gracefully on an empty tool list, unknown input, and a malformed request

### App Registry & Lifecycle

- [ ] **APP-01**: An app moves through `draft` → `published` → `deprecated` → `archived`
- [ ] **APP-02**: A draft app is not reachable by any link, trigger, or route
- [ ] **APP-03**: An app definition is versioned and the last 20 versions are retained for rollback
- [ ] **APP-04**: A published app declares intents and slash commands that activate it
- [ ] **APP-05**: A deprecated app stays functional, shows the owner-supplied deprecation notice to users, and registers no new triggers
- [ ] **APP-06**: An archived app accepts no new submissions, but existing view links still resolve
- [ ] **APP-07**: Publishing runs a routing dry-run against the labelled intent set and blocks if any existing app's routing share drops by more than 5 points
- [ ] **APP-08**: Publishing rejects an app whose description collides with an existing published app's
- [ ] **APP-09**: An app can be tagged and filtered by tag, and the platform ships roughly 10 seed template apps

### Form Engine & Renderer

- [ ] **FRM-01**: Every form is a FormIO.js JSON schema; no other form engine is used anywhere in the product
- [ ] **FRM-02**: Form schemas are versioned with an incrementing integer, and a submission records the `form_version` in effect when its link was issued
- [ ] **FRM-03**: Editing a published form does not affect an in-flight submission
- [ ] **FRM-04**: The renderer pre-fills fields server-side from the resolved real-user profile
- [ ] **FRM-05**: A form author can define conditional show/hide logic and validation rules (required, pattern, min/max, custom)
- [ ] **FRM-06**: The renderer is a separate stateless web app that authenticates by JWT in the URL and sets no cookies
- [ ] **FRM-07**: The renderer enforces a CSP of `default-src 'self'; script-src 'self'` and sanitizes all input
- [ ] **FRM-08**: The renderer meets WCAG 2.1 AA and is usable on desktop, tablet, and mobile browsers
- [ ] **FRM-09**: A form author can preview a draft form in the App Builder, with sandbox submissions, before publishing

### Links & Token Security

- [ ] **LNK-01**: A create link is single-use, expires after a configurable TTL (default 30 minutes), and cannot be submitted twice
- [ ] **LNK-02**: An edit link can be loaded repeatedly but consumes on submit, expiring after a configurable TTL (default 4 hours)
- [ ] **LNK-03**: A one-time token is consumed atomically, and a MongoDB unique index on the token ID makes double consumption impossible even if Redis loses an acknowledged write during failover
- [ ] **LNK-04**: An integration test that kills Redis mid-submit produces exactly one submission
- [ ] **LNK-05**: A view or query link is a stateless signed JWT with no Redis entry, verifiable with a public key alone
- [ ] **LNK-06**: A read link re-checks permission and compares `perm_version` on every access, and is rejected when they diverge
- [x] **LNK-07**: The read-link JWT claim shape — including `form_version`, `app_version`, and the epoch — is frozen in the foundations phase, because adding a claim later invalidates every outstanding link
- [ ] **LNK-08**: A read-link denial is counted per reason across all seven revocation events, not a single aggregate counter
- [ ] **LNK-09**: Every link access is logged with `jti`, `real_user_id`, action, IP, and User-Agent
- [ ] **LNK-10**: Link URLs are unguessable and contain no sequential identifier
- [ ] **LNK-11**: An expired link returns a clear "link expired" message offering to request a new one via IM
- [ ] **LNK-12**: Signing keys rotate every 90 days with a zero-downtime dual-key window, and a new key can be added without invalidating live links

### Submissions & Data Routing

- [ ] **DAT-01**: Each app selects one data mode: `internal`, `external`, or `hybrid`
- [ ] **DAT-02**: In `internal` mode a submission is written to the app's MongoDB collection, which is created on first write
- [ ] **DAT-03**: In `external` mode a submission is pushed through a referenced connector using `{{form.field}}` and `{{real_user.attribute}}` field mapping
- [ ] **DAT-04**: In `hybrid` mode the internal write is synchronous and must succeed for the submission to be confirmed
- [ ] **DAT-05**: In `hybrid` mode the external call is asynchronous through BullMQ, and an external failure leaves the submission in `partial` status with a retry queued
- [ ] **DAT-06**: The outbound state is modelled as exactly `not_sent` | `sent_unconfirmed` | `confirmed`, committed as `sent_unconfirmed` *before* the outbound call
- [ ] **DAT-07**: A reconciliation job retries only `not_sent`; nothing in `sent_unconfirmed` is ever auto-resent
- [ ] **DAT-08**: A submission is validated against its pinned form schema before it is routed
- [ ] **DAT-09**: An internal collection's declared indexes are created at publish time
- [ ] **DAT-10**: A Query DSL reads internal data; raw MongoDB query syntax is never exposed to an app builder
- [ ] **DAT-11**: A Query DSL result auto-injects a `real_user_id` filter and a `deleted_at: null` filter unless the user holds `view_all`, and one filter builder emits both so neither can be omitted
- [ ] **DAT-12**: Every DSL construct has a test asserting the injected filters survive it
- [ ] **DAT-13**: `FR-D-12`'s write-once guarantee is **amended**: the platform guarantees a single *send* per submission, and write-once against the downstream additionally requires either downstream idempotency-key support or a natural-key pre-check, with each connector declaring `supports_idempotency_key` and the flag surfaced in the App Builder at publish time
- [ ] **DAT-14**: An end user can see the current status of their own submissions without asking in chat

### Connectors & Async Execution

- [ ] **CON-01**: A connector implements one common interface — `testConnection()`, `execute(operation, payload, context)`, `getCapabilities()`
- [ ] **CON-02**: Connector instances are managed globally by platform admins; an app references a connector and never owns its credentials
- [ ] **CON-03**: A failed external call retries with exponential backoff (base 2 s, max 5 attempts) and then routes to a dead letter queue
- [ ] **CON-04**: A dead-letter-queue item is viewable and manually retryable by a global admin
- [ ] **CON-05**: Rate limits are enforced per connector instance, shared across every app referencing it
- [ ] **CON-06**: `app_id` is a first-class label on connector metrics, so one app's traffic spike can be attributed and budgeted separately
- [ ] **CON-07**: `credential_rejected` alerts separately from `endpoint_unreachable`
- [ ] **CON-08**: Changing an app's `connector_ref` is a separately audited mutation
- [ ] **CON-09**: A Redmine connector ships as the first and only v1 external integration, including field mapping and its error taxonomy
- [ ] **CON-10**: A hybrid submission's internal write commits through a transactional outbox, so the outbound request is never sent for a write that did not commit

### Audit, Compliance & Data Protection

- [ ] **AUD-01**: Every state-changing action writes an append-only audit entry; no update or delete operation on the audit log is permitted
- [ ] **AUD-02**: An audit entry records timestamp, actor, action, target, previous state, new state, IP, and request ID
- [ ] **AUD-03**: Audit logs are retained for a minimum of 3 years, configurable
- [ ] **AUD-04**: `actor_ref` is tombstoneable, so an erasure request can null the actor reference without deleting the audit row
- [ ] **AUD-05**: A global admin can search the audit trail by user, app, action, and date range
- [ ] **AUD-06**: A global admin can export the audit trail as CSV or JSON Lines
- [ ] **AUD-07**: A quarterly access review report is auto-generated showing who holds access to what
- [ ] **AUD-08**: A purge is soft-delete first, then hard delete after a 30-day grace period, and every purge is logged with operator ID and timestamp
- [ ] **AUD-09**: Archived app data stays queryable by a global admin for compliance
- [ ] **AUD-10**: Rate limiting is applied per user and per link `jti` — never per IP — and blocks only on signature failure

### Observability & Operations

- [x] **OBS-01**: One metric path exists — the OpenTelemetry metrics API with a Prometheus exporter — not a second `prom-client` path
  - **(01-08) Half delivered.** The *instruments* were on the OTel meter `akane` and a second path was
    proven absent; the Prometheus exporter did not exist, so the requirement stayed unchecked.
  - **(01-09) Complete — 01-08's blocker is discharged.** `startOtel()` builds one `NodeSDK` carrying
    the allowlist trace exporter, an OTLP metrics reader and the one `PrometheusExporter`; the exporter
    is created only by `createPrometheusExporter()`, always `preventServerStart: true`, and a test binds
    port 9464 to prove nothing is listening. `MetricsController` serves `GET /metrics` from that
    singleton over real HTTP, and the spec finds the plan-08 counters **with the values recorded** —
    the end-to-end proof of plan 08's meter hand-off. A process that never started OTel refuses to
    compose the module with a named `OTEL_NOT_STARTED` rather than serving a permanently empty page.
    A second registry was negatively controlled: substituting a fresh exporter turns 3 of 5 tests red.
  - **(01-10) Residual discharged — all three processes serve it.** `MetricsModule` is now mounted
    by `api`, `worker` and `scheduler`, so `GET /metrics` answers 200 on 3000, 3001 and 3002. Each
    process owns its own registry and each reports its own `target_info{service_name=…}` — three
    registries, not three views of one — which is the reason all three must serve the endpoint
    rather than one aggregating for the others. The `OTEL_NOT_STARTED` refusal was observed for
    real by booting a process that skipped `startOtel()`, and the plan-08 instrument was observed
    moving in a booted worker: `platform_heartbeat_total{otel_scope_name="akane"} 2`.
- [ ] **OBS-02**: A trace spans IM receive → identity → RBAC → decision → link → form → submit → route → respond
- [ ] **OBS-03**: JEV latency and confidence, RBAC resolution latency, token issue/consume, connector success/failure, queue depth and **queue age**, form load time, and active IM connections are all exported as metrics
- [ ] **OBS-04**: `submission_status{status="partial"}` is exported, because a partial hybrid submission is otherwise invisible
- [ ] **OBS-05**: `routing_share{app_id}` is exported so routing traffic theft is detectable
- [ ] **OBS-06**: Alerts fire on connector failure >5% over 5 min, token consume failure >10/min, average decision confidence <0.6 over 10 min, DLQ depth >50, Redis memory >80%, MongoDB replication lag >5 s, and all decision providers unhealthy
- [ ] **OBS-07**: Logs are retained 30 days hot (searchable) and 1 year cold
- [ ] **OBS-08**: A load test demonstrates 1,000 concurrent users and 50 IM events/sec, and measures the 3-tier throttler's Redis cost rather than assuming it
- [ ] **OBS-09**: Dashboards show active users, submissions/min, decision accuracy, and connector health
- [ ] **OBS-10**: Runbooks exist for decision-provider outage, connector timeout spike, Redis OOM, IM webhook failure, and double-submission reports

### IM Adapters

- [ ] **IM-01**: Every adapter normalizes inbound events to one `InboundEvent` schema and outbound messages to one `OutboundMessage` schema
- [ ] **IM-02**: The webhook receiver verifies the request signature on the raw body, exactly once, and does nothing else
- [ ] **IM-03**: The webhook receiver acknowledges in under 200 ms and enqueues; all logic runs in the consumer
- [ ] **IM-04**: Enqueue is idempotent — a duplicate delivery produces one processing job, guaranteed by a MongoDB unique index on the platform event ID, not by a BullMQ `jobId` flag
- [ ] **IM-05**: An unreachable IM platform causes messages to queue and retry, and never produces a silent failure the user cannot see
- [ ] **IM-06**: Rate limiting is per user (10 req/min) and per app (100 req/min), implemented as a hand-written `ThrottlerStorage` over ioredis
- [ ] **IM-07**: A slash command acks empty and delivers its response asynchronously, because Slack's `response_url` permits only 5 responses per 30 minutes
- [ ] **IM-08**: The user sees a distinct, actionable message on both submission success and submission failure
- [ ] **IM-09**: The Slack adapter supports inbound events, outbound messages, slash commands, and Slack's URL-verification challenge
- [ ] **IM-10**: The Microsoft Teams adapter delivers the identical experience via `@microsoft/agents-hosting` + `-msteams`
- [ ] **IM-11**: An adapter's responses appear in the same thread as the user's message where the platform supports it

### App Builder

- [ ] **BLD-01**: A non-developer can create an app in 5 wizard steps or fewer without documentation
- [ ] **BLD-02**: An owner can edit an app's general settings, triggers, RBAC, forms, data routing, retention, and lifecycle from a tabbed editor
- [ ] **BLD-03**: An owner can create custom roles with arbitrary permission sets and assign users by name or email autocomplete
- [ ] **BLD-04**: An owner can design a form with drag-and-drop, including undo/redo over the last 50 actions
- [ ] **BLD-05**: Data-routing configuration shows a visual form-field → connector-field mapping
- [ ] **BLD-06**: Publishing shows a confirmation dialog summarising every change, and a save is possible with a keyboard shortcut
- [ ] **BLD-07**: Errors are inline, specific, and actionable — never a generic "something went wrong"
- [ ] **BLD-08**: A submission viewer lists an app's submissions with filters, detail view, and export
- [ ] **BLD-09**: The App Builder is responsive enough to be usable on a tablet, and shows loading skeletons for every async operation
- [ ] **BLD-10**: A department admin can request a connector and publish an external or hybrid app **without** a platform admin creating the connector for them
- [ ] **BLD-11**: A delegated "workflow manager" can operate an app without holding ownership
- [ ] **BLD-12**: The App Builder authenticates via OIDC SSO with MFA, and a user can only manage apps they own or administer

### Notifications & Two-Way Sync

- [ ] **NOT-01**: An external system can push a signed inbound webhook that maps an external entity ID to a `submission_id`
- [ ] **NOT-02**: An inbound webhook is protected against replay by timestamp and nonce validation
- [ ] **NOT-03**: A notification is delivered via IM to the original submitter with a deep link bound to that user
- [ ] **NOT-04**: Notification delivery retries 3 times if IM delivery fails
- [ ] **NOT-05**: An external system that cannot sign its webhooks has a documented alternative trust mechanism, recorded per connector

---

## v2 Requirements

Deferred beyond v1. Tracked, not in the current roadmap.

### Multi-IM Expansion

- **IM-12**: Zalo adapter via a hand-rolled OA client over `undici`
- **IM-13**: Telegram adapter via `node-telegram-bot-api` 2
- **IM-14**: Zalo callback signature verification answered as a spike before its adapter enters any phase

### Identity & Access

- **IDN-09**: SSO auto-mapping where the IM identity provider matches the corporate IdP
- **ACL-12**: Group- and attribute-based role assignment
- **ACL-13**: Bulk role assignment by CSV for apps with more than 50 users

### Data & Integration

- **DAT-15**: Cross-app collection sharing with an explicit, audited grant
- **DAT-16**: A cross-app read re-evaluates the *requesting* user's permissions against the *source* app, never the calling app's grant
- **CON-11**: `dry_run` connector mode for side-effect-free testing
- **CON-12**: Per-connector configurable timeout (default 30 s) and connector health alerting
- **CON-13**: Field-mapping transformations beyond templating — date format, string concatenation, lookup tables
- **CON-14**: Connectors for HR, ERP, ticketing, procurement, and asset management beyond Redmine

### Forms & UX

- **FRM-10**: Form i18n via multi-language labels
- **FRM-11**: File upload in the form renderer — **blocked pending licensing resolution** (Form.io's `File` component is premium; renderer is MIT, engine is OSL 3.0)
- **FRM-12**: Draft save and resume — **blocked pending a token-model decision** (a resumable draft needs a second, longer-lived token class)
- **FRM-13**: Object storage, upload quota, and orphaned-upload cleanup — depends on `FRM-11`
- **DAT-17**: A user-facing "save and continue later" affordance, if `FRM-12` is approved
- **APP-10**: A publish-review gate for admin-authored apps
- **NOT-06**: User-subscribable notification topics per app
- **NOT-07**: Per-app notification mute/unmute
- **NOT-08**: A notification-cadence policy (PagerDuty publishes "too frequent status updates" as a named incident-response anti-pattern)
- **NOT-09**: Polling fallback for connectors that cannot send webhooks

### Routing

- **RTE-12**: Disambiguation options when multiple alternatives fall within 10% of the top confidence
- **RTE-13**: A confidence-gated abstention that declines to route rather than guessing

### Platform

- **OBS-11**: App-definition rollback as a self-service operation
- **DAT-18**: Retention automation — `keep_forever`, `purge_after_days`, and `purge_immediately_on_archive` executed on schedule
- **DAT-19**: Optional pre-purge export to JSON Lines or CSV at a configured target
- **AUD-11**: A single-step approval workflow
- **BLD-13**: AI-assisted form building

---

## Out of Scope

Explicitly excluded. Documented to prevent scope creep and re-litigation.

| Feature | Reason |
|---------|--------|
| Open-ended conversational AI assistant | PRD NG1. The decision layer returns a discrete `choice` + `confidence`; open generation produces no confidence signal to gate on, which breaks the permission-first guarantee |
| Becoming system of record for downstream data | PRD NG2 / P3. We route, we don't own it |
| Native IM form rendering (Block Kit, Adaptive Cards, modals) | PRD NG3. Slack's Input block holds exactly one element, a modal caps at 3 views, and `trigger_id` expires in 3 s. Slack itself recommends a link for long structured forms |
| Multi-step / BPMN approval engine with branching | PRD NG5. Even a single-approver action spans four documented Power Automate areas; >30-day approvals need Datastore plus a second flow |
| Real-time collaborative form editing | PRD NG4. No v1 value, real conflict-resolution cost |
| Native mobile client | PRD NG6. Responsive web is sufficient |
| Offline mode / client-side caching | PRD NG7. Requires connectivity by design |
| Cross-organization multi-tenancy | PRD NG8. Single enterprise deployment in v1 |
| Mongoose / `@nestjs/mongoose` | App-builder schemas are runtime-defined; a compile-time `Schema` model has no value. One data-access style everywhere |
| Fastify HTTP adapter | `@slack/bolt@5` bundles `express@^5` in-process; OTel's auto-bundle has no `instrumentation-fastify` |
| `@nestjs/jwt` / `jsonwebtoken` | No JWKS, no `kid` keyring — the 90-day dual-key rotation requirement would become hand-rolled |
| `axios` / `@nestjs/axios` | A second, un-instrumented HTTP path is exactly where end-to-end tracing breaks |
| `prom-client` | A second metrics path means two scrape endpoints, two naming conventions, split alert rules |
| `nestjs-zod`, community Redis throttler storages | All peer against `@nestjs/common ^10 \|\| ^11` and are incompatible with NestJS 12 |
| `ua-parser-js` | AGPL-3.0-or-later — disqualifying under an enterprise OSS posture with a CI dependency gate |
| `csurf` | npm-deprecated; a cookie-free form-renderer origin removes the CSRF class structurally instead |
| `nx` / `turbo` | 2 web apps + 1 API + 1 worker. A build-graph tool is unjustified overhead at this size |
| `@nestjs/observe` | No OTLP exporter; routes to a NestJS-hosted backend. Would also break data residency |
| MongoDB 8.2+ | **Already EOL (2026-07-31).** Stay on 8.0.x |
| Node.js 20 | EOL 2026-04-30. NFR-SEC-12 cannot be honored on an EOL runtime |
| TypeScript 7.x | npm `latest`; breaks the `typescript-eslint` peer range and the build |
| CDN-hosted FormIO bundles | SRI-pinning a third-party CDN breaks NFR-SEC-3 and adds an external availability dependency |
| Four IM platforms in v1 | +8–12 weeks of variance against a 26–34 week target, for zero gain against the core value. Slack only; Teams is the first expansion |

---

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 | Phase 1 | Complete |
| FND-02 | Phase 1 | Complete |
| FND-03 | Phase 1 | Complete (01-10) |
| FND-04 | Phase 1 | Complete (01-03, re-verified 01-10) |
| FND-05 | Phase 1 | Complete (01-10) |
| FND-06 | Phase 1 | Complete |
| FND-07 | Phase 1 | Complete (01-09) |
| FND-08 | Phase 1 | Complete (01-10) |
| FND-09 | Phase 1 | Complete |
| FND-10 | Phase 1 | Pending |
| LNK-07 | Phase 1 | Complete |
| RTE-10 | Phase 1 | Complete |
| AUD-10 | Phase 1 | Pending |
| DAT-13 | Phase 1 | Pending |
| OBS-01 | Phase 1 | Complete (01-09, mounted 01-10) |
| IDN-01 | Phase 2 | Pending |
| IDN-02 | Phase 2 | Pending |
| IDN-03 | Phase 2 | Pending |
| IDN-04 | Phase 2 | Pending |
| IDN-06 | Phase 2 | Pending |
| IDN-07 | Phase 2 | Pending |
| ACL-01 | Phase 2 | Pending |
| ACL-02 | Phase 2 | Pending |
| ACL-03 | Phase 2 | Pending |
| ACL-04 | Phase 2 | Pending |
| ACL-06 | Phase 2 | Pending |
| ACL-07 | Phase 2 | Pending |
| ACL-08 | Phase 2 | Pending |
| ACL-09 | Phase 2 | Pending |
| ACL-11 | Phase 2 | Pending |
| IM-01 | Phase 2 | Pending |
| IM-02 | Phase 2 | Pending |
| IM-03 | Phase 2 | Pending |
| IM-04 | Phase 2 | Pending |
| IM-05 | Phase 2 | Pending |
| IM-06 | Phase 2 | Pending |
| IM-07 | Phase 2 | Pending |
| IM-08 | Phase 2 | Pending |
| IM-09 | Phase 2 | Pending |
| IM-11 | Phase 2 | Pending |
| APP-01 | Phase 2 | Pending |
| APP-02 | Phase 2 | Pending |
| APP-04 | Phase 2 | Pending |
| FRM-01 | Phase 2 | Pending |
| FRM-02 | Phase 2 | Pending |
| FRM-03 | Phase 2 | Pending |
| FRM-04 | Phase 2 | Pending |
| FRM-06 | Phase 2 | Pending |
| FRM-07 | Phase 2 | Pending |
| FRM-08 | Phase 2 | Pending |
| LNK-01 | Phase 2 | Pending |
| LNK-03 | Phase 2 | Pending |
| LNK-04 | Phase 2 | Pending |
| LNK-09 | Phase 2 | Pending |
| LNK-10 | Phase 2 | Pending |
| LNK-11 | Phase 2 | Pending |
| LNK-12 | Phase 2 | Pending |
| DAT-02 | Phase 2 | Pending |
| DAT-08 | Phase 2 | Pending |
| DAT-09 | Phase 2 | Pending |
| AUD-01 | Phase 2 | Pending |
| AUD-02 | Phase 2 | Pending |
| RTE-01 | Phase 3 | Pending |
| RTE-02 | Phase 3 | Pending |
| RTE-03 | Phase 3 | Pending |
| RTE-04 | Phase 3 | Pending |
| RTE-05 | Phase 3 | Pending |
| RTE-06 | Phase 3 | Pending |
| RTE-07 | Phase 3 | Pending |
| RTE-08 | Phase 3 | Pending |
| RTE-09 | Phase 3 | Pending |
| RTE-11 | Phase 3 | Pending |
| OBS-02 | Phase 3 | Pending |
| LNK-05 | Phase 4 | Pending |
| LNK-06 | Phase 4 | Pending |
| LNK-08 | Phase 4 | Pending |
| DAT-10 | Phase 4 | Pending |
| DAT-11 | Phase 4 | Pending |
| DAT-12 | Phase 4 | Pending |
| DAT-01 | Phase 5 | Pending |
| DAT-03 | Phase 5 | Pending |
| DAT-04 | Phase 5 | Pending |
| DAT-05 | Phase 5 | Pending |
| DAT-06 | Phase 5 | Pending |
| DAT-07 | Phase 5 | Pending |
| DAT-14 | Phase 5 | Pending |
| CON-01 | Phase 5 | Pending |
| CON-02 | Phase 5 | Pending |
| CON-03 | Phase 5 | Pending |
| CON-04 | Phase 5 | Pending |
| CON-05 | Phase 5 | Pending |
| CON-06 | Phase 5 | Pending |
| CON-07 | Phase 5 | Pending |
| CON-08 | Phase 5 | Pending |
| CON-09 | Phase 5 | Pending |
| CON-10 | Phase 5 | Pending |
| LNK-02 | Phase 5 | Pending |
| OBS-04 | Phase 5 | Pending |
| BLD-01 | Phase 6 | Pending |
| BLD-02 | Phase 6 | Pending |
| BLD-03 | Phase 6 | Pending |
| BLD-04 | Phase 6 | Pending |
| BLD-05 | Phase 6 | Pending |
| BLD-06 | Phase 6 | Pending |
| BLD-07 | Phase 6 | Pending |
| BLD-08 | Phase 6 | Pending |
| BLD-09 | Phase 6 | Pending |
| BLD-10 | Phase 6 | Pending |
| BLD-11 | Phase 6 | Pending |
| BLD-12 | Phase 6 | Pending |
| APP-03 | Phase 6 | Pending |
| APP-05 | Phase 6 | Pending |
| APP-06 | Phase 6 | Pending |
| APP-07 | Phase 6 | Pending |
| APP-08 | Phase 6 | Pending |
| APP-09 | Phase 6 | Pending |
| FRM-05 | Phase 6 | Pending |
| FRM-09 | Phase 6 | Pending |
| IDN-05 | Phase 6 | Pending |
| IDN-08 | Phase 6 | Pending |
| ACL-05 | Phase 6 | Pending |
| ACL-10 | Phase 6 | Pending |
| OBS-05 | Phase 6 | Pending |
| IM-10 | Phase 7 | Pending |
| NOT-01 | Phase 7 | Pending |
| NOT-02 | Phase 7 | Pending |
| NOT-03 | Phase 7 | Pending |
| NOT-04 | Phase 7 | Pending |
| NOT-05 | Phase 7 | Pending |
| AUD-03 | Phase 8 | Pending |
| AUD-04 | Phase 8 | Pending |
| AUD-05 | Phase 8 | Pending |
| AUD-06 | Phase 8 | Pending |
| AUD-07 | Phase 8 | Pending |
| AUD-08 | Phase 8 | Pending |
| AUD-09 | Phase 8 | Pending |
| OBS-03 | Phase 8 | Pending |
| OBS-06 | Phase 8 | Pending |
| OBS-07 | Phase 8 | Pending |
| OBS-08 | Phase 8 | Pending |
| OBS-09 | Phase 8 | Pending |
| OBS-10 | Phase 8 | Pending |

**Phase distribution:**

| Phase | Name | Requirements |
|-------|------|--------------|
| 1 | Foundations & Platform | 15 |
| 2 | The Vertical Slice — Slack + Internal Routing | 47 |
| 3 | Natural-Language Routing | 11 |
| 4 | Read Path & Query DSL | 6 |
| 5 | Integration & Async Execution | 19 |
| 6 | Self-Service App Builder | 25 |
| 7 | Multi-IM Expansion & Two-Way Sync | 6 |
| 8 | Production Readiness — Compliance, Observability & Load | 13 |

**Coverage:**
- v1 requirements: 142 total
- Mapped to phases: 142
- Unmapped: 0 ✓
- Duplicates (mapped to more than one phase): 0 ✓
- v2 (deferred): 29
- Resolved requirement conflicts recorded as v1: 3
  - Conflict 1 (per-IP loses) → `AUD-10` → Phase 1
  - Conflict 2 (trace ID loses) → `FND-07` → Phase 1, enforced by `AUD-04` → Phase 8
  - Conflict 3 (audit wins, erasure narrowed) → `FND-06` → Phase 1, delivered with `AUD-04` + `AUD-08` → Phase 8
  - `FR-D-12` write-once amendment → `DAT-13` → Phase 1, enforced with `CON-01`/`CON-09` → Phase 5

---
*Requirements defined: 2026-10-01*
*Last updated: 2026-10-01 after initial definition*
