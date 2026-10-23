# Phase 9: Production Readiness — Compliance, Observability & Load - Research

**Researched:** 2026-10-20
**Domain:** Durable audit trail & retention (MongoDB), erasure/tombstone mechanics, OTel→Prometheus observability as code, alert-rule and dashboard testing, load testing, zero-downtime key rotation, rate limiting
**Confidence:** MEDIUM-HIGH (stack: HIGH; external mechanisms: HIGH; two requirement-reading reconciliations: MEDIUM — see Open Questions)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

Copied verbatim from `.planning/phases/09-production-readiness/09-CONTEXT.md` §Implementation Decisions.

#### Audit trail durability & retention

- **D-01 (Store)**: The audit trail moves to a **Mongo `audit_entries` collection**. `AuditRepository`
  keeps its existing `append` / read interface and delegates to
  `MongoService.db().collection<T>()` — the same lazy-access pattern
  `app-definition.repository.ts` already uses — so no call site changes.
  — **Reversibility:** costly — undoing means reimplementing a durable store and abandoning every
  row written while Mongo was the store.
- **D-02 (Retention ownership)**: The **3-year window lives in deployment config**, with a hard
  3-year floor; the operator may *extend* it, never shorten it. AUD-03's "configurable" is that
  extend-only knob. The per-app `retention_policy` (already in the app-definition contract, currently
  `null`) governs that app's **submission data only** — it never governs the audit trail.
- **D-03 (Boundary sweep)**: When a row crosses the retention boundary it is deleted by a
  **BullMQ Job Scheduler sweep**, and the sweep **appends its own audit entry** (cutoff date, row
  count, `operator: system`). The deletion is therefore itself evidence. BullMQ Job Schedulers are
  the only durable scheduling mechanism — `@nestjs/schedule` is banned for durable work because a
  purge that silently does not run is a compliance failure, not a missed tick.
- **D-04 (Preserving AUD-01)**: AUD-01's "append-only by construction" survives by giving the
  delete capability a **single named owner**: a retention service that is the only thing in the
  repository permitted to call `deleteMany` on `audit_entries`, enforced by a guard test that fails
  if any other module mutates or deletes audit rows. The guarantee stops being an *absence* of
  methods and becomes *one greppable exception*.

#### Erasure and `actor_ref`

- **D-05 (Indirection, not nulling)**: Audit rows carry an **opaque `actor_ref`**, never a user id.
  An `actor_identities` mapping collection resolves `actor_ref → real_user_id`, mirroring the
  existing `identity-mapping.repository.ts` shape. An erasure deletes **one mapping row** and writes
  **no audit row**, so AUD-01 needs no erasure exception at all. The erasure act is itself
  state-changing and appends an `erasure.executed` entry carrying the ref — that entry is the proof.
  AUD-05's search-by-user resolves through the mapping, so an erased subject resolves to nothing,
  which is the intended outcome.
  — **Reversibility:** one-way — undoing requires rewriting every audit row and back-filling
  identities that the erasure was performed to destroy.
- **D-06 (Closed entry shape)**: The entry's `[key: string]: unknown` index signature is **removed**;
  the entry carries an explicit field set. Identity-bearing fields are named `*_ref`
  (`actor_ref`, `from_user_ref`, `to_user_ref`, `updated_by_ref`), and erasure redacts **every field
  matching `*_ref`** by name convention. Free-text `changeSummary` is replaced by a structured,
  non-identifying summary. This is what makes D-05's promise mechanically complete rather than a
  list someone has to remember to extend.
  — **Reversibility:** costly — every append site must be updated and the type is exported.
- **D-07 (Execution)**: Erasure is an **operator CLI command in `packages/cli`**, following the
  existing CLI harness (`rebind.ts`, `provision.ts` already inject an `AuditRepository`). The
  operator supplies the `real_user_id` and a ticket reference; the command redacts every `*_ref`,
  deletes the mapping row, purges submission bodies inside the app's retention window, and appends
  `erasure.executed`. Erasure is rare, deliberate and irreversible, so it does not get a console
  button.
- **D-08 (Reach)**: Erasure in this phase reaches **the audit refs and the submission bodies** —
  exactly the narrowed promise frozen in REQUIREMENTS' conflict table row 3 (allowlist before
  serialisation + tombstone of the actor reference + defined purge windows for submission bodies).
  `ProfileRepository` and `IdentityMappingRepository` hold email/name/employee_code but are
  in-memory, so they are **not** durably erasable in this phase; that is recorded as a **named
  limitation** in the verification report, never left as a silent gap.

#### Compliance operator surfaces

- **D-09 (The `ip` field — correcting a stale justification)**: `GET /audit` **serves `ip`**.
  `audit.controller.ts:37` and `AuditPage.tsx` both justify dropping it by citing D-43, but D-43's
  `LOG_FIELD_ALLOWLIST` **includes** `ip` and `user_agent` (the "actor/context fields (D-43, LNK-09)"
  group in `packages/platform/src/logging/log-allowlist.ts`), AUD-02 already requires the entry to
  record IP, and the mockup renders an IP column. The shipped projection is narrower than both the
  contract and the design; the projection wins and the stale comments are corrected in the same
  change. `user_agent` stays store-only.
- **D-10 (Search)**: AUD-05 is delivered by **extending `GET /audit`** with `user`, `app_id`,
  `action`, `from` and `to` filters pushed into a Mongo query with supporting compound indexes —
  not by a second endpoint, and not by filtering the loaded page. **`app_id` becomes a first-class
  entry field**, which fixes a second mockup-vs-contract gap: the audit table renders an **App**
  column but the view has no app field, and `target` is an app id for some actions and a
  transfer/connector id for others.
- **D-11 (Export)**: AUD-06 ships **JSON Lines only**, matching the mockup's single
  "Export JSON Lines" button. AUD-06's wording is "CSV **or** JSON Lines", so one format satisfies
  it, and JSONL is lossless for the optional fields the trail carries with no dependency and no
  flattening decisions. (`csv-stringify` is already a dependency via the submissions export —
  a CSV sibling is cheap if an operator ever asks, but it is not built now.)
- **D-12 (Access review)**: AUD-07 is a **quarterly BullMQ Job Scheduler job** that computes who
  holds which role on which app, stores the report, and appends an `access_review.generated` audit
  entry — plus a **new global-admin console route** rendering the latest report and offering the same
  JSON Lines download. This route is **not depicted in the mockup** (its nav is Dashboard / Apps /
  Submissions / Connectors / Audit Log / User Management / Settings); the mockup is amended rather
  than treated as licence to improvise, and no acceptance criteria come from it.
  — **Reversibility:** costly — adds a nav surface and a stored artifact shape that later phases read.
- **D-13 (Purge is a lifecycle state)**: **`purged` is added to the lifecycle enum**
  (`packages/contract/src/builder/publish.contract.ts:82`, currently
  `draft|published|deprecated|archived`) as the **single permitted exit from `archived`**, which
  `app-lifecycle.ts` currently refuses outright. A purge record carries the grace-period fields
  (`requested_at`, `execute_after`, `executed_at`, `operator_id`); the console Purge button performs
  **only the soft delete**, and the Job Scheduler sweep performs the hard delete after 30 days. The
  audit entry carries operator ID and timestamp. The console button is safe precisely because it is
  not the irreversible act. This matches the mockup, whose state list already reads
  `["draft","published","deprecated","archived","purged"]`.
  — **Reversibility:** one-way — amends a frozen published contract enum that consumers switch on.
- **D-14 (AUD-09)**: Archived (not yet purged) apps stay in the **global admin's existing
  Submissions scope**, marked "Archived". No new compliance read surface. Purged data disappears on
  schedule — the honest reading of AUD-08 and AUD-09 together is *archived is queryable, purged is
  not*.

#### Observability

- **D-15 (Alert set is eight, not seven)**: The alert set is **OBS-06's seven plus
  `submission_status{status="partial"}`**. SC#5 says "each of the seven named alert conditions fires
  in a test — including `submission_status{status="partial"}` and all decision providers unhealthy",
  but `partial` is not in OBS-06's seven (it is OBS-04, already complete). A partial hybrid
  submission is otherwise invisible — OBS-04's own stated rationale. Implementing the union
  satisfies both readings, and the divergence in the requirement wording is **recorded, not
  rewritten**.
- **D-16 (How "fires in a test" is proven)**: Alert rules are **Prometheus rule files committed
  in-repo**, each with a **`promtool test rules` case run in CI** against the official Prometheus
  image (Docker is already available through the testcontainers harness in `tooling/`). This uses
  Prometheus's own evaluation semantics, so the test proves the *rule* fires — not merely that a
  metric crossed a threshold, which would let a typo in an `expr` pass.
- **D-17 (Load test)**: OBS-08 is a **k6** scenario set committed in-repo — 1,000 concurrent VUs and
  50 IM events/s — run on demand and in a dedicated CI job against a containerized stack. k6 is an
  external binary, so `node_modules` does not grow, and it can hold 1,000 VUs where a single-threaded
  Node process cannot. The **throttler's Redis cost is measured** from `INFO commandstats` deltas
  sampled before and after, broken out per Redis command, so the three round-trips per request
  become a number rather than the currently-unmeasured note in the ledger.
- **D-18 (Metric coverage)**: **Every signal OBS-03 names** — JEV latency, JEV confidence, RBAC
  resolution latency, token issue, token consume (success/failure), connector success/failure, queue
  depth, queue age, form load time, active IM connections — gets a **real instrument *and* a real
  emit site**, with a completeness test asserting every declared instrument name appears in a scrape.
  This deliberately closes the `queue.oldest.item.age` precedent (a name constant with nothing behind
  it), which is the exact failure OBS-03 exists to prevent.
- **D-19 (Dashboards)**: OBS-09 is **Grafana dashboard-as-code committed in-repo**, with a test
  asserting every panel query references only metric names the app actually emits (the same canonical
  registry D-16 and D-18 use). It consumes the `/metrics` endpoint that already exists, so there is
  no new app surface, no second auth boundary and no console-to-Prometheus credential story.
- **D-20 (Retention and runbooks as guarded artifacts)**: OBS-07's log retention is committed
  **deploy values** (Loki 30-day hot retention, 1-year cold in object storage) with a test asserting
  the numbers match the requirement, so the configuration cannot drift from it. OBS-10's five
  runbooks live at `docs/runbooks/<incident>.md`, each referenced by its alert rule's `runbook_url`
  annotation, with a test asserting every `runbook_url` resolves to a real file and that all five
  named incidents are covered. Neither claim depends on a running log stack.

#### Key rotation — the ROADMAP note is currently unsatisfiable

- **D-21 (Close WINDOW 7 here, then verify)**: WINDOW 7 is closed **in this phase** by persisting the
  wrapped DEK beside the envelope — explicitly additive, since D-25's five envelope fields do not
  change (that is D-25's own note). Only then can **both** the JWT link-signing keyring (additive by
  construction: `jwt-verifier.ts` resolves `kid → key`) **and** envelope rotation be verified as
  genuinely zero-downtime. Leaving WINDOW 7 open while shipping a "production readiness" phase would
  be self-contradictory: the window's own text says *no real credential may be stored before it is*.
  Verification runs against the local key provider; **FND-10's KMS vendor stays Pending** exactly as
  ruled, and this decision does not touch it.
  — **Reversibility:** costly — changes envelope storage, though additively by design.

#### Findings recorded during discussion (not decisions)

- **F-1**: `audit.controller.ts` and `AuditPage.tsx` cite D-43 as the reason `ip` is dropped, but
  D-43 allowlists `ip`. The justification is stale, not the behaviour's intent.
- **F-2**: The mockup's audit table renders an **App** column with no backing field on the entry or
  the view.
- **F-3**: The mockup's lifecycle state list already includes `purged`, ahead of the frozen contract
  enum — so the mockup is currently the *stricter* artifact, and D-13 moves the contract to match
  rather than the mockup to match the contract.
- **F-4**: SC#5 names seven alert conditions but lists `submission_status{status="partial"}`, which
  is not among OBS-06's seven. Recorded; D-15 resolves it by superset.

### the agent's Discretion

Copied verbatim from `.planning/phases/09-production-readiness/09-CONTEXT.md` §the agent's Discretion.

- Whether `user_agent` also joins `ip` on the audit view (the D-43 allowlist permits it; the mockup
  does not depict it).
- Index shape for `audit_entries` (AUD-05's filter set is known; cardinality is not).
- The `access_reviews` collection shape and the report's JSON Lines schema.
- Whether the retention window is expressed as a duration or an absolute cutoff in config.
- PromQL specifics, recording-rule choice, Grafana panel layout and the alert `for:` durations
  beyond those OBS-06 states.
- The internal section structure of each runbook (a common spine is expected, not mandated).
- Mechanical details of amending `prototypes/mockup.html` for the App/IP columns and the new Access
  Review nav entry.
- Semantics of the mockup's per-app **"Export to JSON Lines before purge"** switch — it is real
  behaviour the mockup depicts but no requirement names.
- **If it proves cheap, close WINDOW 5** (pino's `msg` is allowlisted *verbatim*, so free prose is
  the one remaining channel into a 1-year cold log) with a lint rule forbidding interpolated `msg`.
  It is compliance-relevant to this phase's own promise, but it is not one of the thirteen
  requirements, so it is the planner's call, not a locked decision.

### Deferred Ideas (OUT OF SCOPE)

Copied verbatim from `.planning/phases/09-production-readiness/09-CONTEXT.md` §Deferred Ideas.

- **Make `ProfileRepository` and `IdentityMappingRepository` durable** so an erasure can also clear
  the email/name/employee_code those stores hold. They are in-memory today, so D-08 records the limit
  rather than pretending the promise is complete. Belongs in a later phase (or a Phase 9 gap-closure
  plan if the planner finds the move cheap).
- **CSV export alongside JSON Lines** for the audit trail — cheap (D-11), not asked for.
- **A dedicated compliance read surface for archived apps**, and a `source`/`ip`-reveal affordance on
  the audit view — both considered under AUD-09 and D-09 and deliberately not adopted (new surfaces
  with nothing in the mockup to design from).
- **FND-10 / the KMS vendor (B-3/D-27)** — stays Pending. D-21 verifies rotation against the local
  key provider and makes no claim about a KMS-backed master key.
- **WINDOW 13** (auto-instrumentation un-narrowed — a tracing-cost exposure rather than a
  correctness one), **WINDOW 17** (`phase.complete` overwriting deliberately-deferred requirements,
  relevant to how this phase is closed), **WINDOW 26** (the entrypoint-drift orphan, D-08-05-1, out of
  scope since Phase 8 and still open). None is a Phase 9 requirement; the planner may fold one if it
  is cheap, otherwise they stay in the ledger.
- **Legal review of the "legitimate interest" framing** for 3-year audit retention — explicitly a
  question for counsel, not a research or engineering task (ROADMAP notes).

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUD-03 | Audit logs are retained for a minimum of 3 years, configurable | §Architecture Patterns P1 (durable store) + P2 (extend-only config + `audit.retention.swept`). Config key must be **added** to `AppConfigShape` (`config.schema.ts:51-88`) — no retention key exists today. |
| AUD-04 | `actor_ref` is tombstoneable, so an erasure request can null the actor reference without deleting the audit row | §Architecture Patterns P4. **Requirement conflict found**: AUD-04's "null the actor reference" is a field-level `$set`, i.e. an update to an audit row — so D-05's "AUD-01 needs no erasure exception at all" is only true if redaction is a *second named single owner* alongside D-04's retention delete. See §Pitfalls R1 and Open Question Q1. |
| AUD-05 | A global admin can search the audit trail by user, app, action, and date range | §P3 index set (`{actor_ref,timestamp}`, `{app_id,timestamp}`, `{action,timestamp}`) + §P5 extension of the existing `GET /audit`. `app_id` is a new first-class field (D-10). |
| AUD-06 | A global admin can export the audit trail as CSV or JSON Lines | §P6 JSONL streaming export reusing the `submission-export.service.ts` shape; D-11 rules JSONL only. |
| AUD-07 | A quarterly access-review report is auto-generated showing who holds access to what | §P7 Job Scheduler `access-review-quarterly` + `access_reviews` collection + derived-from-`apps.roles` computation (no new RBAC store). |
| AUD-08 | A purge is soft-delete first, then hard delete after a 30-day grace period, and every purge is logged with operator ID and timestamp | §P8 purge record + second sweep + the `purged` lifecycle edge. |
| AUD-09 | Archived app data stays queryable by a global admin for compliance | D-14: no new surface. Verification is a query test against archived-but-unpurged submissions, plus the negative (purged is gone). |
| OBS-03 | JEV latency and confidence, RBAC resolution latency, token issue/consume, connector success/failure, queue depth and **queue age**, form load time, and active IM connections are all exported as metrics | §P9 the instrument table maps each named signal to a concrete instrument type, name, labels and emit site. Note the **name-namespace trap** (`submission.status` today vs `submission_status` in OBS-06's alert) — see §Pitfalls R3. |
| OBS-06 | Alerts fire on connector failure >5% over 5 min, token consume failure >10/min, average decision confidence <0.6 over 10 min, DLQ depth >50, Redis memory >80%, MongoDB replication lag >5 s, and all decision providers unhealthy | §P10 eight rule files + `promtool test rules` (D-16). Thresholds are `expr` text; the alert *names* are a new namespace. |
| OBS-07 | Logs are retained 30 days hot (searchable) and 1 year cold | §P11 committed deploy values + drift test. No log stack exists in-repo → the deliverable is a config artifact plus a test, not a running Loki. |
| OBS-08 | A load test demonstrates 1,000 concurrent users and 50 IM events/sec, and measures the 3-tier throttler's Redis cost rather than assuming it | §P12 k6 scenario set + §P13 `INFO commandstats` delta harness. **Blocking finding**: the 3-tier throttler does not exist yet (see §Pitfalls R2) — the tiers are build work inside this phase. |
| OBS-09 | Dashboards show active users, submissions/min, decision accuracy, and connector health | §P14 dashboard-as-code + the shared emitted-metric registry. Note `decision accuracy` has no metric today and is **not** in OBS-03's list — see Open Question Q3. |
| OBS-10 | Runbooks exist for decision-provider outage, connector timeout spike, Redis OOM, IM webhook failure, and double-submission reports | §P15 five files + `runbook_url` resolution test. `runbook_url` is a Prometheus **annotation** convention, not a first-class rule field. |

</phase_requirements>

## Summary

Phase 9 is 13 requirements in two clusters plus two verification-only obligations, and the research
turns up one fact that changes the shape of the plan: **almost none of the substrate exists**, and
two of the thirteen requirements name things that are currently only *documented* rather than
implemented.

The audit cluster moves off `AuditRepository`'s per-process in-memory array
(`packages/domain/src/audit/audit.repository.ts:13-14`, `private entries: AuditEntry[] = []`) into a
Mongo `audit_entries` collection. The single most important discovery here is a **requirement-level
tension the CONTEXT did not resolve**: D-05 claims AUD-01 "needs no erasure exception at all", but
AUD-04's own words — *"can **null the actor reference** without deleting the audit row"* — describe a
field-level update to an audit row, and D-06's *"erasure redacts every field matching `*_ref`"*
confirms it. So erasure is an `updateMany` on `audit_entries`, not a pure mapping-row delete. The
honest reading is that AUD-01 has **two** named single owners (the retention sweep's `deleteMany`,
the erasure command's `updateMany` on `*_ref` fields only) rather than zero or one. Two designs are
defensible and the planner must pick one deliberately — see Open Question Q1. Everything else in the
audit cluster (index set, JSONL export, access review, purge lifecycle) is additive and follows
patterns already in the repo.

The observability cluster is greenfield: no rule files, no dashboards, no `docs/runbooks/`, no load
harness, and no retention configuration anywhere (verified by `ls` — all four directories are
absent). The Prometheus path itself is already complete and must not be extended: one
`PrometheusExporter` with `preventServerStart: true`
(`packages/platform/src/otel/otel.constants.ts`) rendered by `MetricsController` at `GET /metrics`
(`packages/platform/src/metrics/metrics.controller.ts:35-56`). D-18's instruments go on the one
`akane` meter (`business-metrics.ts:27`). The load test and the alert tests both lean on the Docker
daemon that `tooling/containers.ts` already requires — Docker 29.8.0 is present and the `mongo:8.0` /
`redis:8.10-alpine` images are already pulled locally.

Two reconciliations the planner must not silently paper over. **(1)** `docs/API.md:74-82` and
`docs/ARCHITECTURE.md:47` both document three named `@nestjs/throttler@6.7.1` throttlers
(`perUser` 10/min, `perApp` 100/min, `perConnector` per config) with a hand-written
`ThrottlerStorage` — but `@nestjs/throttler` is **not in the dependency tree at all**
(`package.json:26-59`), and the only real rate limiting is the hand-rolled fixed-window counter in
`packages/platform/src/redis/redis-rate-counter.ts`, used per read-link `jti`
(`signature-failure-limiter`) and per connector (`connector-rate-limiter`). OBS-08 says the load test
"measures the 3-tier throttler's Redis cost" — there is nothing to measure yet, so building the
tiers is in scope for this phase or OBS-08's wording has to be re-read. **(2)** OBS-03's
`form load time`, `RBAC resolution latency` and `active IM connections` have no emit site anywhere;
`queue.oldest.item.age` is explicitly a **name constant with no instrument behind it**
(`business-metrics.ts:35-46`), which D-18 exists to close.

**Primary recommendation:** Treat Phase 9 as **three parallel tracks with one shared artifact**
(a canonical emitted-metric registry, a TypeScript module listing every instrument name, that the
rule-file test, the dashboard test and the scrape-completeness test all read). Track A = audit
durability + retention + erasure + purge lifecycle (Mongo, no external tooling). Track B =
observability as code (rule files + `promtool test rules` via the Prometheus image, dashboards-as-JSON,
retention config files, five runbooks — all files and tests, no running stack). Track C = load and
rotation proof (k6 via `grafana/k6` image, `INFO commandstats` deltas, both keyrings rotated under
traffic). Resolve Open Question Q1 before writing the audit plans, and Q2 before writing OBS-08's
plan, because both change task counts.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| `audit_entries` persistence, indexes, TTL-free retention | Database (MongoDB) | API/Backend (repository shape) | Retention is a data-layer concern; the repository keeps the same `append`/read interface so no call site learns about Mongo. |
| Retention sweep execution | Scheduler process | Database (the `deleteMany`) | D-03: BullMQ Job Scheduler in `apps/scheduler`. The *sweep trigger* is scheduler; the *delete* is Mongo. Never `api` or `worker` — a sweep that runs once per replica would race. |
| Erasure execution | Operator CLI (`packages/cli`) | Database | D-07: no console button, no HTTP route. The CLI already injects `AuditRepository`. |
| Audit search (AUD-05) | API/Backend | Database (compound index) | Query is pushed down to Mongo; `apps/app-builder` only renders the filter toolbar. Filtering the loaded page is explicitly rejected by D-10. |
| Audit export (AUD-06) | API/Backend | Browser (download button) | Streaming JSONL from the API; the browser only triggers the download. |
| Access-review report (AUD-07) | Scheduler process | API (read route) + Browser (new route) | Generation is a durable scheduled job; serving the stored report is a read route; rendering is the app-builder console. |
| Purge lifecycle + grace period (AUD-08) | API (soft delete + audit) | Database (hard delete via second sweep) | The console button is deliberately *not* the irreversible act; the irreversible act is the scheduler sweep. |
| Metric instruments (OBS-03) | All three processes (per emit site) | Platform (`packages/platform/src/metrics`) | Instruments are declared once on the `akane` meter; each signal is emitted where the event actually happens (api / worker / scheduler). |
| Alert rules (OBS-06) | Repo artifact + CI (Prometheus image) | — | Rules are evaluated by Prometheus, not by the app; the app only emits the metrics they read. |
| Log retention (OBS-07) | Deployment config artifact | CI (drift test) | The app emits to stdout; retention is the log stack's configuration. |
| Load test (OBS-08) | CI + on-demand (external binary) | Redis (measurement surface) | k6 holds the VUs; Redis `commandstats` is the measurement. Never in-process Node. |
| Dashboards (OBS-09) | Repo artifact (Grafana JSON) | CI (query-vs-registry test) | Dashboard-as-code; consumes the existing `/metrics` endpoint. |
| Runbooks (OBS-10) | Repo artifact (`docs/runbooks/`) | CI (`runbook_url` resolution test) | Plain markdown files, linked from alert annotations. |
| Zero-downtime key rotation | Platform (`packages/platform/src/crypto`) | Deployment (rolling restart) | `kid`-keyed keyring resolution is already the design in `jwt-verifier.ts`; envelope rotation needs the additive wrapped-DEK field. |
| Rate limiting / throttler tiers | API/Backend | Redis (counter storage) | Guards live in `apps/api`; the counter lives on the shared cache connection, never the queue connection. |

## Standard Stack

### Core — already installed, **no new runtime dependency required**

| Library | Version | Purpose | Why Standard |
|---|---|---|---|
| `mongodb` (native driver) | 7.7.0 | `audit_entries`, `actor_identities`, `access_reviews` collections | `[VERIFIED: package.json:51]`. The repo-wide data-access shape (no Mongoose). |
| `bullmq` | 6.3.11 | Retention sweep, purge sweep, access-review Job Schedulers | `[VERIFIED: package.json:47]`. D-03/D-12: the only durable scheduling mechanism. |
| `ioredis` | 6.0.0 | Throttler counter storage, `INFO commandstats` sampling | `[VERIFIED: package.json:49]`. BullMQ ships ioredis; one client type. |
| `@opentelemetry/exporter-prometheus` | 0.222.0 | The single `/metrics` path | `[VERIFIED: package.json:42]`. Already wired in `otel.constants.ts` / `otel.bootstrap.ts`. |
| `@opentelemetry/sdk-metrics` | 2.11.0 | Completeness test reads instruments in-process | `[VERIFIED: package.json:44]`. Already a direct dependency (unusual and useful: it lets a Vitest test bind a `MeterProvider` + `InMemoryMetricReader` without importing the whole SDK). |
| `@opentelemetry/api` | 1.9.1 | Instrument construction | `[VERIFIED: package.json:38]`. |
| `jose` | ^6.2.12 | JWT `kid` keyring resolution for rotation verification | `[VERIFIED: package.json:50]`. `keyResolver` already implemented in `jwt-verifier.ts`. |
| `zod` | ^4.6.5 | Config schema for the retention/deploy values | `[VERIFIED: package.json:58]`. Retention config keys go in `AppConfigShape`. |
| `csv-stringify` | ^6.9.0 | (available, unused this phase) CSV sibling for audit export | `[VERIFIED: package.json:48]`. D-11 says JSONL only; leaving this unused is correct. |

### Supporting — new, only if the throttler tiers are built

| Library | Version | Purpose | When to Use |
|---|---|---|---|
| `@nestjs/throttler` | 6.7.1 | `perUser` / `perApp` / `perConnector` named throttlers | `[VERIFIED: npm registry]` — `npm view @nestjs/throttler version` → `6.7.1`. Peers accept NestJS 12: `'@nestjs/core': '^7.0.0 \|\| ^8.0.0 \|\| ^9.0.0 \|\| ^10.0.0 \|\| ^11.0.0 \|\| ^12.0.0'`, same for `@nestjs/common`; `engines: { node: '^20.19.0 \|\| ^22.12.0 \|\| >=24.0.0' }` `[VERIFIED: npm registry]`. **⚠ Stage-1 legitimacy verdict `SUS` (`too-new`)** — see §Package Legitimacy Audit; the planner must gate the install behind `checkpoint:human-verify`. |
| `yaml` | 2.9.1 | Parsing committed Prometheus rule files in the metric-name test | Optional. `[ASSUMED]` provenance (training knowledge; `npm view yaml version` → `2.9.1`, `license` → `ISC`; legitimacy verdict `OK`, 133M weekly downloads `[VERIFIED: gsd-tools package-legitimacy check]`). **Prefer not to add it** — see §Don't Hand-Roll and §P14 for a dependency-free alternative. If added, it is `devDependencies` only (test-reachable, never runtime-reachable — the `tooling/deployment-shape.spec.ts` rule). |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|---|---|---|
| `@nestjs/throttler` named throttlers | Extend the existing hand-written `incrementFixedWindow` (`packages/platform/src/redis/redis-rate-counter.ts`) with two more call sites | **Genuinely competitive.** The repo already owns an atomic fixed-window primitive and two consumers. Adding `@nestjs/throttler` brings a guard, `@Throttle` decorators, a documented `ThrottlerStorage` contract (`[VERIFIED: github.com/nestjs/throttler@v6.7.1 src/throttler-storage.interface.ts]`) and `x-ratelimit-*` headers; the hand-rolled route brings zero new deps but no header conventions and a custom guard anyway (AUD-10's per-`jti` key is not the default IP tracker). See Open Question Q2. |
| `promtool test rules` (D-16, locked) | Vitest assertions against a hand-written PromQL evaluator | Not viable — testing the rule's `expr` with your own evaluator proves nothing about Prometheus's evaluation. `promtool` is locked by D-16 and is the right call. |
| `yaml` for rule-file parsing | A strict regex over `expr:`/`alert:` lines in the test | No new dependency; slightly fragile but bounded, because the same files are separately validated by `promtool check rules`. Recommended. |
| In-process Node load generator | k6 (D-17, locked) | A single-threaded Node process cannot hold 1,000 VUs. Locked. |
| `@nestjs/schedule` for the sweeps | BullMQ Job Schedulers (locked, D-03) | In-memory, per-instance; a silently-absent purge is a compliance failure. Locked. |

**Installation (only if the throttler tiers are built):**

```bash
npm install @nestjs/throttler@6.7.1
```

No other package is required by this phase. `k6` and `promtool` are external binaries (see
§Environment Availability) and deliberately do not enter `node_modules`.

**Version verification:** performed this session for the one new runtime package and the one
optional dev package.

```bash
npm view @nestjs/throttler version        # → 6.7.1
npm view @nestjs/throttler peerDependencies engines
npm view yaml version license             # → 2.9.1 / ISC
```

## Package Legitimacy Audit

Run this session via `gsd-tools query package-legitimacy check --ecosystem npm <pkg>`.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---|---|---|---|---|---|---|
| `@nestjs/throttler` | npm | published `2026-09-24T11:17:33.213Z` (patch `6.7.1`) | 2,659,780/wk | `git+https://github.com/nestjs/throttler.git` | **SUS** — reason `too-new` | **Flagged** — planner must add `checkpoint:human-verify` before installing. The `too-new` reason fires on the *release date of 6.7.1*, not on package age: it is the official `nestjs` org package, already named in `docs/API.md:74`, `docs/ARCHITECTURE.md:47` and STACK §14 as the pinned choice. Treat as a **freshness** flag, not a slopsquat signal — but the gate still applies, and the alternative in Q2 avoids the install entirely. |
| `yaml` | npm | published `2026-09-11T20:30:10.905Z` | 133,252,983/wk | `git+https://github.com/eemeli/yaml.git` | **OK** | Approved (dev-dependency only), but its **provenance is `[ASSUMED]`** — the package name came from training knowledge, not from official docs or Context7 in this session. Prefer the dependency-free parsing route (§P14). |

**Packages removed due to `SLOP` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** `@nestjs/throttler` — planner inserts `checkpoint:human-verify` before any install.

No other package is installed by this phase. `prom-client` remains banned (STACK §12) and is not
reintroduced by the alert/dashboard work — the whole observability cluster reads the existing
`/metrics` endpoint.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌──────────────────────────────────────────────┐
  global admin ──HTTP──▶ │ apps/api                                     │
  (app-builder console)  │  GET /audit    (AUD-05 filters)              │
                         │  GET /audit/export  ─▶ JSONL stream (AUD-06) │
                         │  GET /access-reviews/latest (AUD-07 read)    │
                         │  POST /apps/:id/purge  ─ soft delete only    │
                         └───────┬───────────────────────┬──────────────┘
                                 │ audit.append          │ (AUD-01 path)
                                 ▼                       ▼
                      ┌──────────────────────────────────────────────┐
                      │ MongoDB                                      │
                      │  audit_entries   ← append-only, 1 deleteMany │
                      │                    owner + 1 updateMany owner│
                      │  actor_identities  actor_ref ⇄ real_user_id  │
                      │  access_reviews    quarterly snapshots       │
                      │  apps / app_definition_versions (lifecycle)  │
                      │  submission_revisions (data — purge target)  │
                      └───────▲───────────────────────▲──────────────┘
                              │ deleteMany            │ $set *_ref = tombstone
                              │ (retention)           │ (erasure)
                      ┌───────┴───────────┐   ┌───────┴────────────────┐
                      │ apps/scheduler    │   │ packages/cli  (erase)  │
                      │ Job Schedulers:   │   │  operator + ticket ref │
                      │  audit-retention  │   │  + erasure.executed    │
                      │  purge-execute    │   └────────────────────────┘
                      │  access-review-q  │
                      └───────┬───────────┘
                              │ emits instruments (one `akane` meter)
                              ▼
   api / worker / scheduler ─ each process ─▶ PrometheusExporter
                              (preventServerStart) ─▶ GET /metrics
                                                            │
                       ┌────────────────────────────────────┼──────────────────────┐
                       ▼                                    ▼                      ▼
        observability/prometheus/rules/*.rules.yml   observability/grafana/*.json   load/k6/*.js
        (8 alerts, runbook_url annotation)            (panels; query-vs-registry)    (1000 VUs, 50 ev/s)
                       │                                     │                      │
                       ▼                                     ▼                      ▼
        CI: promtool test rules (prom/prometheus)   CI: metric-name registry test   CI: k6 + INFO commandstats
```

Reading the primary use case: an operator runs `erase` → the CLI redacts `*_ref` fields and deletes
the `actor_identities` row → appends `erasure.executed`. The admin's `GET /audit?user=…` then resolves
`actor_ref → real_user_id` through `actor_identities` and finds nothing, while every audit row is
still present. Three years later the retention sweep deletes the row and appends
`audit.retention.swept` — the deletion is itself evidence.

### Recommended Project Structure

```
observability/
├── prometheus/
│   ├── rules/
│   │   ├── connector.rules.yml        # connector failure >5% over 5m
│   │   ├── tokens.rules.yml           # token consume failure >10/min
│   │   ├── decision.rules.yml         # confidence <0.6 over 10m; all providers unhealthy
│   │   ├── queue.rules.yml            # DLQ depth >50; submission_status{status="partial"}
│   │   └── infrastructure.rules.yml   # Redis memory >80%; Mongo replication lag >5s
│   └── tests/
│       └── rules.test.yml             # promtool test rules input (one case per alert)
├── grafana/
│   └── dashboards/
│       └── akane-overview.json        # dashboard-as-code
├── deploy/
│   └── log-retention.yml              # Loki 30d hot / 1y cold — committed values (OBS-07)
└── metric-names.ts                    # the canonical emitted-metric registry (shared artifact)

load/
└── k6/
    ├── inbound-events.js              # constant-arrival-rate 50/s
    ├── concurrent-users.js            # ramping-vus → 1000
    └── lib/redis-commandstats.js      # INFO commandstats delta harness

docs/runbooks/
├── decision-provider-outage.md
├── connector-timeout-spike.md
├── redis-oom.md
├── im-webhook-failure.md
└── double-submission-reports.md
```

In-repo placement rationale: `observability/` and `load/` are new top-level directories because both
mix artifacts that no single workspace owns (the rule files are consumed by CI, the registry by
`packages/platform`, the runbooks by the alert annotations). They sit beside the existing
`tooling/` directory, which is the repo's precedent for cross-cutting non-shipping content.

### Pattern P1 — `audit_entries` as an append-only collection with a single named mutator

**What:** `AuditRepository` keeps `append` / `findAll` / `count` and gains a filter-aware read; the
backing store becomes `MongoService.db().collection<AuditEntry>('audit_entries')`, following the
memoised-`ensureIndex` pattern of `app-definition.repository.ts`.

**Why this shape:** the wrapper `AuditEntry` interface is exported from `packages/domain/src/index.ts`
and injected by ~12 append sites across `api`, `worker` and the CLI. D-01's promise ("no call site
changes") holds only if the *method signatures* stay. `findAll()` today takes no arguments
(`audit.repository.ts:24`), so AUD-05's filters must arrive as an optional parameter, not a new
method — otherwise the ~3 CLI call sites and the controller each need different handling.

**Example (shape, following `app-definition.repository.ts:165-189`):**

```ts
// Source: pattern copied from packages/domain/src/builder/data-access/app-definition.repository.ts:163-190
private get collection() {
  return this.mongo.db().collection<AuditEntryDocument>('audit_entries');
}

private ensureIndexPromise: Promise<void> | null = null;
private ensureIndex(): Promise<void> {
  if (this.ensureIndexPromise === null) {
    this.ensureIndexPromise = Promise.all([
      this.collection.createIndex({ timestamp: -1 }, { background: true }),
      this.collection.createIndex({ actor_ref: 1, timestamp: -1 }, { background: true }),
      this.collection.createIndex({ app_id: 1, timestamp: -1 }, { background: true }),
      this.collection.createIndex({ action: 1, timestamp: -1 }, { background: true }),
    ]).then(() => undefined).catch(() => undefined);
  }
  return this.ensureIndexPromise;
}
```

### Pattern P2 — retention is an extend-only config value with a hard floor

**What:** the window lives in `AppConfigShape` (it does not exist today — `[VERIFIED:
packages/platform/src/config/config.schema.ts:51-88]` enumerates `NODE_ENV`, `PORT`, `SERVICE_NAME`,
`MONGO_URL`, `...REDIS_URL_FIELDS`, `CRYPTO_KEY_PROVIDER`, `OTEL_EXPORTER_OTLP_ENDPOINT` and nothing
else). A Zod refinement enforces the floor:

```ts
// AUDIT_RETENTION_DAYS: extend-only. The floor is a constant, not a comment.
AUDIT_RETENTION_DAYS: z.coerce.number().int().min(AUDIT_RETENTION_FLOOR_DAYS).default(AUDIT_RETENTION_FLOOR_DAYS),
```

with `export const AUDIT_RETENTION_FLOOR_DAYS = 365 * 3;` in the same module. **Discretion item
resolved:** express it as a **duration in days**, not an absolute cutoff — an absolute cutoff cannot
be defaulted at boot without freezing the deployment date into config, and a duration is what the
Zod `min()` floor is expressible against. The sweep computes `cutoff = now - retentionDays`.

### Pattern P3 — the AUD-05 index set (equality prefix first, sort/range last)

**What:** four indexes. `{ timestamp: -1 }` for the unfiltered browse (today's only query),
plus `{ <field>: 1, timestamp: -1 }` for `actor_ref`, `app_id` and `action`.

**Why this order:** the filter set is *equality* on one of `actor_ref` / `app_id` / `action` plus a
*range* on `timestamp`, returned *sorted* by `timestamp` descending — the exact case MongoDB's ESR
guideline covers, where equality fields precede the sort/range field so a single index serves both
the match and the ordering `[CITED: mongodb.com/docs/manual/tutorial/equality-sort-range-guideline/]`.
Because the browse is not always sorted by `timestamp`, the plan must assert the sort explicitly;
an index only serves a sort whose direction matches or inverts it.

**Note on cardinality (discretion item, unresolved by research):** `action` and `app_id` are
low-cardinality relative to `timestamp`; `actor_ref` is high-cardinality. If index count becomes a
write-amplification concern, drop `{ action: 1, timestamp: -1 }` first — the `action` filter alone
is the least selective. This is unmeasurable without production-volume data; state it as an
assumption rather than deriving it.

### Pattern P4 — `actor_ref` indirection and the erasure algorithm

**What:** an opaque `actor_ref` on the audit row; an `actor_identities` collection mapping
`actor_ref → real_user_id`, mirroring the existing mapping shape
(`[VERIFIED: packages/domain/src/identity/identity-mapping.repository.ts:1-8]`):

```ts
export interface IdentityMapping {
  platform: string;
  chat_user_id: string;
  real_user_id: string;
  channel_id?: string;
  email?: string;
  deactivated_at?: Date | null;
}
```

The `actor_identities` analogue is `{ actor_ref, real_user_id, created_at }` with
`createIndex({ real_user_id: 1 })` (the erasure lookup direction) and
`createIndex({ actor_ref: 1 }, { unique: true })` (the resolution direction).

**Erasure algorithm (order is load-bearing):**

1. Resolve `actor_ref`(s) for the supplied `real_user_id` from `actor_identities`.
2. `audit_entries.updateMany({ $or: [{actor_ref: {$in}}, {from_user_ref: {$in}}, {to_user_ref: {$in}}, {updated_by_ref: {$in}}] }, { $set: { <each field>: ACTOR_TOMBSTONE } })`.
3. `actor_identities.deleteMany({ real_user_id })`.
4. Purge submission bodies inside the app's retention window (`submission_revisions.data` — see P8a).
5. `audit_entries.insertOne({ action: 'erasure.executed', actor_ref: REF, ... })`.

Step **2 before 3** so the ref values are still resolvable while the redaction runs; step **5 after 3**
so the `erasure.executed` row is the last thing written. The tombstone is a single constant
(`'erased'`), not `null` — a `null` is indistinguishable from "this entry never had an actor", and
AUD-04's "null the actor reference" is satisfied by a constant that carries no identity.

### Pattern P5 — extend `GET /audit`; do not add a second endpoint

Today's controller exposes one browse route with a page-local projection
(`[VERIFIED: apps/api/src/audit/audit.controller.ts:100-120]`):

```ts
/** The default page size. */
export const AUDIT_DEFAULT_LIMIT = 20;

/** The page-size ceiling — a bounded read. */
export const AUDIT_MAX_LIMIT = 100;

/**
 * One served audit entry — the D-43
 * allowlist and nothing else. Optional
 * fields are present only when the append
 * carried them.
 */
export interface AuditEntryView {
  readonly timestamp: string;
  readonly actor: string;
  readonly action: string;
  readonly target: string;
  readonly previous_state?: string;
  readonly new_state?: string;
  readonly request_id?: string;
}
```

Note the projection carries `actor` **and no `ip`** — the D-09/F-1 finding, confirmed verbatim: the
view type has no `ip` member. D-09 adds `ip`; D-10 adds `app_id`. Both are one-field edits to this
interface plus `toAuditEntryView` (`audit.controller.ts:235-256`). Validated filter inputs go through
Zod and surface as the existing `AUDIT_VALIDATION` error code.

### Pattern P6 — JSONL export beside the CSV export service

`apps/api/src/submissions/submission-export.service.ts` is the shape to follow: an explicit column
allowlist (`[VERIFIED: apps/api/src/submissions/submission-export.service.ts:41-51]`:

```ts
export const SUBMISSION_EXPORT_COLUMNS = [
  'submission_id',
  'form_id',
  'submitted_at',
  'downstream_reference',
  'reason',
] as const;
```

), a streaming writer, and a terminal audit append that records the *export act*
(`submission-export.service.ts:125-142` appends `submissions.exported` with `filters` and
`row_count`). The JSONL writer does the same three things with `JSON.stringify` per line instead of
`stringifyCsv`, and appends `audit.exported`. **Do not import `csv-stringify` here** — D-11 is JSONL
only.

### Pattern P7 — access review computed from the existing app definition, not a new RBAC store

Roles already live on `apps.roles` (`z.record(z.string(), z.unknown())` in
`[VERIFIED: packages/contract/src/builder/publish.contract.ts:86]`). The quarterly job enumerates
apps → for each, `Object.keys(roles)` × the role's member list → emits one report document. This
avoids inventing an access model: "who holds access to what" is answerable entirely from
`apps.roles` plus platform-level role assignments already in the users surface.

Report shape is a discretion item. Recommended minimal `access_reviews` document:

```ts
{
  report_id: string;          // crypto.randomUUID()
  period: string;             // e.g. '2026-Q4'
  generated_at: Date;
  rows: Array<{
    app_id: string;
    app_name: string;
    role: string;
    members: string[];        // *_ref or real_user_id — see Open Question Q1
  }>;
}
```

`generate` must emit an `access_review.generated` audit entry (D-12) with `period` and `row_count`.
**Do not store member emails** — the report is a read artifact of the same allowlist regime.

### Pattern P8 — `purged` as the single exit from `archived`

The lifecycle union is frozen today (`[VERIFIED: packages/contract/src/builder/publish.contract.ts:82]`):

```ts
lifecycle: z.enum(['draft', 'published', 'deprecated', 'archived']),
```

and the transition table refuses every exit from `archived` (`[VERIFIED:
packages/domain/src/builder/app-lifecycle.ts:69-78]`):

```ts
/** `draft → published` via the plan-05 gate's commitPublish seam, `published → deprecated`, `deprecated → published` re-activation, any → archived, archived terminal. */
const LEGAL_TRANSITIONS: ReadonlyMap<
  AppLifecycleState,
  ReadonlySet<AppLifecycleState>
> = new Map([
  ['draft', new Set(['published', 'archived'])],
  ['published', new Set(['deprecated', 'archived'])],
  ['deprecated', new Set(['published', 'archived'])],
  ['archived', new Set()],
]);
```

The change is exactly one edge — `['archived', new Set(['purged'])]` — plus the state in the union
(`app-lifecycle.ts:44`) and in `APP_LIFECYCLE_STATES` (`app-lifecycle.ts:46-51`) and in the contract
enum. `purged` is **terminal** (no exits) and must never be reachable from `draft`/`published`/
`deprecated` — an app has to be archived before it can be purged.

### Pattern P8a — the purge grace period is a *record*, not a timer

**What:** the soft delete writes the grace-period fields; a second Job Scheduler sweep does the hard
delete. This is the same two-step shape as P2 and the same "the scheduler is the only durable
trigger" rule (D-03).

**Where the purge data actually is:** there is **no `submissions` collection in this repo**. The
submission *bodies* live in `submission_revisions.data`
(`packages/domain/src/submissions/data-access/submission-revisions.repository.ts:6-17`
`SubmissionRevisionDocument { submission_id, revision, outbound, data, … }`), and the `Submission`
interface carries a `deleted_at` soft-delete marker
(`packages/domain/src/submissions/submission.repository.ts:26-31`). So:

- **Soft delete at the console** = set the app's lifecycle to `purged` + write the purge record.
- **Hard delete at the sweep** = `submission_revisions.deleteMany({ submission_id: { $in: … } })`
  for the app's submissions, after `execute_after` has passed. This is a *second* named single owner
  of a `deleteMany` (alongside the audit retention sweep) — see Pitfalls R1's owner inventory.

### Pattern P9 — the OBS-03 instrument table (every signal, one instrument, one emit site)

All instruments are created from the one meter
(`[VERIFIED: packages/platform/src/metrics/business-metrics.ts:27]` → `export const METER_NAME = 'akane';`)
and follow the memoisation discipline already documented in that module and in
`apps/api/src/common/metrics/read-deny.metrics.ts` (a second `createCounter` call of the same name
produces two live instruments with one name and the exporter emits the series twice).

| OBS-03 signal | Recommended instrument | Type | Labels | Emit site |
|---|---|---|---|---|
| JEV latency | `jev_decision_duration_ms` | Histogram | `provider`, `outcome` | decision provider call path in `packages/domain/src/decision/` |
| JEV confidence | `jev_decision_confidence` | Histogram | `provider` | same call path |
| RBAC resolution latency | `rbac_resolution_duration_ms` | Histogram | `outcome` | ACL/RBAC resolution in `packages/domain/src/acl/` |
| Token issue | `read_link_tokens_issued_total` | Counter | `window` (`create`/`edit`/`view`) | link issuance in `apps/api/src/read/` |
| Token consume (success/failure) | `read_link_token_consume_total` | Counter | `result` (`ok`/`expired`/`replayed`/`bad_signature`) | `GETDEL` consumer path |
| Connector success/failure | `connector.outcome` (**exists**) | Counter | `app_id`, `outcome`, `taxonomy_code` | already emitted |
| Queue depth | `queue.depth` | ObservableGauge | `queue` | BullMQ `getJobCounts()` callback |
| Queue age | `queue.oldest.item.age` (**name exists, no instrument**) | ObservableGauge | `queue` | same callback; `getJobs`/`getWaiting` oldest `timestamp` |
| Form load time | `form_load_duration_ms` | Histogram | `app_id`, `form_id` | form renderer request in `apps/api` (or a client-side beacon — see Q4) |
| Active IM connections | `im_active_connections` | UpDownCounter | `provider` | adapter connect/disconnect in `packages/domain/src/adapters/` |
| Submission status (OBS-04, exists) | `submission.status` | Counter | `status` | already emitted |
| Partial submissions (D-15 alert #8) | — (reads `submission.status{status="partial"}`) | — | — | no new instrument needed |

**Naming trap — read this before writing an alert rule.** The existing instruments use **dotted**
names (`submission.status`, `connector.outcome`) while newer instruments use **underscored +
`_total`** (`read_link_denials_total`). OTel's Prometheus exporter converts `.` to `_` in the
exposition output, so `submission.status` is scraped as `submission_status`. OBS-06's alert text
already writes `submission_status{status="partial"}` — i.e. it is written against the *scraped*
name. **Alert `expr` fields must use scraped names; the OTel instrument names are not valid PromQL
identifiers when they contain a dot** (a dot in PromQL is parsed as a float/decimal point). The
canonical registry must therefore hold **both** the instrument name and its Prometheus-exported
name — see Pitfalls R3.

### Pattern P10 — eight Prometheus alert rules, each proven by `promtool test rules`

**Rule file shape** (the unit-test input format is documented at
`[CITED: prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/]`):

```yaml
# observability/prometheus/rules/connector.rules.yml
groups:
  - name: akane.connector
    rules:
      - alert: AkaneConnectorFailureRate
        expr: |
          sum(rate(connector_outcome_total{outcome="failure"}[5m]))
            /
          sum(rate(connector_outcome_total[5m])) > 0.05
        for: 0m
        labels:
          severity: page
        annotations:
          summary: "Connector failure rate above 5% for 5 minutes"
          runbook_url: "docs/runbooks/connector-timeout-spike.md"
```

**Test file shape** — `rule_files` + `tests[].input_series` (expanding notation `a+bxn`) +
`alert_rule_test[].eval_time`/`alertname`/`exp_alerts`. Two things that decide whether the test is
real:

1. **A test case with `exp_alerts: []` asserts the alert is NOT firing.** So every alert needs *two*
   cases — one above threshold that fires, one below that does not. A single firing case passes even
   if the `expr` is `expr: vector(1)`.
2. **`for:` changes what `eval_time` sees.** An alert with `for: 5m` is *pending* before 5 minutes and
   fires after; the test's `eval_time` and `interval` must place the evaluation past the `for` window
   or `exp_alerts` will be empty and the case reads as a false negative. Prefer `for: 0m` where
   OBS-06's window is already encoded in the `rate(...[5m])` — the "over 5 min" is a rate window, not
   a `for` duration, and conflating them makes the test harder to reason about.

`promtool test rules` is run against the official Prometheus image
(`docker run --rm -v $PWD:/w -w /w prom/prometheus:<pinned> promtool test rules observability/prometheus/tests/rules.test.yml`).
Pin the image tag — an unpinned `latest` makes the alert suite's pass/fail depend on a moving base.

**The eight rules (D-15 = OBS-06's seven ∪ SC#5's `partial`):**

| # | Alert | Condition | PromQL sketch (scraped names) |
|---|---|---|---|
| 1 | `AkaneConnectorFailureRate` | connector failure >5% over 5m | `sum(rate(connector_outcome_total{outcome="failure"}[5m])) / sum(rate(connector_outcome_total[5m])) > 0.05` |
| 2 | `AkaneTokenConsumeFailure` | consume failure >10/min | `sum(rate(read_link_token_consume_total{result!="ok"}[1m])) * 60 > 10` |
| 3 | `AkaneDecisionConfidenceLow` | avg confidence <0.6 over 10m | `sum(rate(jev_decision_confidence_sum[10m])) / sum(rate(jev_decision_confidence_count[10m])) < 0.6` (histogram; a `Recording rule` may be clearer than an inline `_sum`/`_count` ratio) |
| 4 | `AkaneDlqDepthHigh` | DLQ depth >50 | `max(queue_dlq_depth) > 50` (or `sum(queue_depth{queue="…dlq"})`) |
| 5 | `AkaneRedisMemoryHigh` | Redis memory >80% | `redis_memory_used_bytes / redis_memory_max_bytes > 0.8` — **not emitted by the app**; requires a Redis exporter. See Open Question Q5. |
| 6 | `AkaneMongoReplicationLag` | replication lag >5s | `mongodb_mongod_replset_member_replication_lag > 5` — **not emitted by the app**; requires the MongoDB exporter. See Open Question Q5. |
| 7 | `AkaneDecisionProvidersAllDown` | all decision providers unhealthy | `sum(provider_health{state="healthy"}) == 0` (an UpDownCounter per provider) — needs the instrument from P9 |
| 8 | `AkanePartialSubmissions` | `submission_status{status="partial"}` present/rising (D-15) | `increase(submission_status_total{status="partial"}[10m]) > 0` |

Rules 5 and 6 are the two OBS-06 conditions the *application* cannot satisfy on its own. This is a
genuine research finding, not a detail: nothing in this repo emits Redis or MongoDB server metrics.
See Open Question Q5.

### Pattern P11 — log retention as a guarded deploy value (OBS-07)

No log stack exists in the repo, so the deliverable is a **committed configuration artifact plus a
test**, exactly as D-20 states. Recommended: `observability/deploy/log-retention.yml` with explicit
`hot_retention_days: 30` and `cold_retention_days: 365`, and a Vitest test in
`observability/deploy/log-retention.spec.ts` asserting `hot === 30 && cold >= 365`. The test reads the
same file a Loki deployment would — so the number the compliance story cites is the number a deploy
applies. The 1-year cold value must be `>= 365` for the same reason the audit floor is extend-only:
shortening it is what makes erasure a lie (`log-allowlist.ts:18` already says so in prose).

### Pattern P12 — k6 scenario set: open model for events, closed model for users

Two scenarios, because they test different things:

```js
// Source: k6 constant-arrival-rate docs — grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/
// Source: k6 ramping-vus executor for the 1,000-user scenario
export const options = {
  scenarios: {
    // 50 IM events/sec — an OPEN model: starts iterations independently of
    // system response, which is what a webhook fan-in actually looks like.
    inbound_events: {
      executor: 'constant-arrival-rate',
      exec: 'postInboundEvent',
      duration: '5m',
      rate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 400,
    },
    // 1,000 concurrent users — a CLOSED model: VUs hold a session.
    concurrent_users: {
      executor: 'ramping-vus',
      exec: 'browseAndSubmit',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 1000 },
        { duration: '5m', target: 1000 },
        { duration: '1m', target: 0 },
      ],
    },
  },
};
```

`constant-arrival-rate` is the right executor for the 50 events/s half precisely because it is an
**open model** — "iterations start independently of system response", so a slow platform shows up as
`dropped_iterations`/rising latency rather than silently reducing the offered load
`[CITED: grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/]`. A
closed-model `constant-vus` would throttle itself when the platform slows, which is the failure mode
the test exists to expose. Also from the same source: do **not** put a `sleep()` at the end of an
iteration in an arrival-rate scenario — the executor already paces it.

**The webhook ack budget is the load-test's real assertion.** IM-03 requires a sub-200 ms ack. So the
scenario must assert `http_req_duration{scenario:inbound_events} p(95)<200` as a k6 threshold, not
just report it. A 1,000-VU run that passes latency but fails the ack budget has failed the phase.

### Pattern P13 — measuring the throttler's Redis cost from `INFO commandstats`

`commandstats` reports, per command, `calls`, `usec`, `usec_per_call`, `rejected_calls` and
`failed_calls`, as lines like
`cmdstat_evalsha:calls=…,usec=…,usec_per_call=…,rejected_calls=…,failed_calls=…`
`[CITED: redis.io/docs/latest/commands/info/]`.

```js
// load/k6/lib/redis-commandstats.js
export function parseCommandStats(info) {
  const out = {};
  const section = info.split('# Commandstats')[1] ?? '';
  for (const line of section.split('\n')) {
    const m = /^cmdstat_([a-zA-Z0-9_|]+):(.+)$/.exec(line.trim());
    if (!m) continue;
    const fields = Object.fromEntries(
      m[2].split(',').map((kv) => kv.split('=')).filter((p) => p.length === 2),
    );
    out[m[1]] = { calls: Number(fields.calls), usec: Number(fields.usec) };
  }
  return out;
}
```

Take a snapshot **before** the run, one **after**, and compute deltas — then subtract a
no-throttler baseline run. Only the delta is meaningful: absolute `calls` includes every prior
command since the server started. Report per-command deltas so "three round-trips per request"
becomes `evalsha`/`incr`/`pexpire` call counts divided by request count. `CONFIG RESETSTAT` before
each run is the cleaner option and yields the same number without a baseline run.

### Pattern P14 — one emitted-metric registry, three consumers

`observability/metric-names.ts` exports:

```ts
export interface EmittedMetric {
  /** The OTel instrument name, as passed to meter.create*(). */
  readonly instrument: string;
  /** The name the Prometheus exporter renders — dots become underscores. */
  readonly scraped: string;
  /** 'counter' | 'histogram' | 'gauge' | 'updowncounter' */
  readonly kind: 'counter' | 'histogram' | 'gauge' | 'updowncounter';
}
export const EMITTED_METRICS: readonly EmittedMetric[] = [ /* … */ ];
export const SCRAPED_NAMES: ReadonlySet<string> = new Set(EMITTED_METRICS.map((m) => m.scraped));
```

Three tests read it: (a) **completeness** — a Vitest test binds a `MeterProvider` with a
`@opentelemetry/sdk-metrics` `InMemoryMetricReader` (already a direct dependency:
`[VERIFIED: package.json:44]`), calls the register functions, and asserts every `instrument` in the
registry exists in the collected metrics — this is the test that closes the
`queue.oldest.item.age` precedent; (b) **rule-file** — every metric identifier appearing in an
`expr:` in `observability/prometheus/rules/*.yml` is in `SCRAPED_NAMES` (or in an explicit
`EXTERNAL_SCRAPED` allowlist for the Redis/Mongo exporter metrics from Q5); (c) **dashboard** — every
`expr` in every panel in `observability/grafana/dashboards/*.json` is in `SCRAPED_NAMES`, parsed with
plain `JSON.parse` (Grafana dashboards are JSON, so no YAML dependency is needed for this half).

For (b), a **targeted line scan** is sufficient and dependency-free: match `/^\s*(expr|record):\s*(.+)$/`
and extract identifiers with `/[a-zA-Z_:][a-zA-Z0-9_:]*/g`, ignoring a small keyword set
(`sum`, `rate`, `by`, `increase`, `avg`, `max`, `min`, `histogram_quantile`, `on`, `and`, `or`,
`unless`, `le`, `job`, `instance`, `queue`, `status`, …). Because `promtool check rules` validates the
files' syntax separately, this scan never has to be a correct YAML parser — it only has to be a
correct *name extractor*. That is why `yaml` is optional rather than required.

### Anti-Patterns to Avoid

- **Filtering the loaded page client-side.** `AuditPage.tsx` does exactly this today (page-local
  filter over the 20 loaded rows). D-10 explicitly rejects carrying that pattern into AUD-05 — the
  filter must go into the Mongo query, or "search the last three years" silently means "search the
  current page".
- **A second scrape endpoint / a second meter / `prom-client`.** Banned (STACK §12). The alert and
  dashboard tests exist to make a name mismatch fail loudly *instead of* someone adding a workaround.
- **Evaluating an alert by testing the metric instead of the rule.** D-16's whole point: a test that
  asserts "a counter went over 5%" passes even when the rule file's `expr` has a typo.
- **`@nestjs/schedule` for the sweeps.** Banned for durable work (D-03).
- **Reaching for a second Redis connection from the throttler.** The counter must stay on
  `REDIS_CACHE`; BullMQ's `noeviction` queue instance must not carry evictable limiter traffic
  (`redis-rate-counter.ts:24-31`).
- **`DELETE` the audit row to satisfy an erasure.** AUD-04 forbids it in words. The erasure is a
  field-level tombstone; only the retention sweep deletes rows at the boundary.
- **Adding a `type: purge` shortcut from `published`.** Purge is reachable from `archived` only
  (P8).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Alert-rule evaluation semantics | A PromQL evaluator, or a "did the metric cross the threshold" assertion | `promtool test rules` against the official Prometheus image (D-16) | Only Prometheus's own engine proves the *rule* evaluates as written — including `for:`, label matching and template expansion. |
| Histogram quantile / rate arithmetic | Manual `_sum`/`_count` division in every panel | A Prometheus **recording rule** for the decision-confidence average, referenced by both the alert and the dashboard | One definition, two consumers — the same argument that made the metric registry necessary. |
| Load generation at 1,000 concurrent connections | A Node script spawning workers/`undici` pools | k6 (D-17) | Node is single-threaded for JS; holding 1,000 open sessions plus an event-rate generator is not what it is for. |
| Redis per-command cost attribution | Instrumenting the app around every Redis call | `INFO commandstats` deltas (D-17) | The server already counts `calls`/`usec` per command; sampling it once before and once after is both cheaper and unfalsifiable by app-level timing bugs. |
| `audit_entries` index creation | An ad-hoc `createIndex` on boot in the controller | The memoised `ensureIndex()` pattern from `app-definition.repository.ts` | Boot-time index creation in the request path is the drift this repo already avoids; the memoised promise pattern is the local convention. |
| JSONL framing/streaming | A hand-rolled string builder into the HTTP response | Node's `Readable`/async-generator → the same streaming shape `submission-export.service.ts` uses | Backpressure and error handling on a large export are exactly where a hand-rolled writer leaks or truncates silently. |
| Parse ISO date-range inputs | `new Date(str)` with try/catch | Zod `z.coerce.date()` in the existing validation pipe | The repo's single validation language; and `new Date('garbage')` yields `Invalid Date` rather than an error. |
| A YAML parser (for the rule-file name test) | `yaml` as a new dependency | A regex name-extractor over `expr:`/`record:` lines (P14) | `promtool check rules` already validates the YAML; the test only needs names, and the scan keeps `node_modules` unchanged. |

**Key insight:** every "don't hand-roll" item here is a case where the *authoritative* engine already
exists and the temptation is to approximate it in TypeScript. In a compliance phase the approximation
is the failure: a hand-rolled alert evaluator and a hand-rolled retention clock both pass their own
tests and mean nothing to an auditor.

## Common Pitfalls

### Pitfall R1 — AUD-01's append-only guarantee now has *two* mutators, not zero (or one)
**What goes wrong:** the phase ships with D-04's single `deleteMany` owner carefully guarded, and the
erasure command's `updateMany` on `audit_entries` is written unremarked — so the guard test that
"proves" append-only has a hole exactly the width of the erasure path.
**Why it happens:** D-05's phrasing ("AUD-01 needs no erasure exception at all") reads as if erasure
touches only `actor_identities`. It does not: AUD-04 says the reference is **nulled on the audit
row**, and D-06 says erasure "redacts every field matching `*_ref`". Both are writes to
`audit_entries`.
**How to avoid:** enumerate the mutators explicitly — (1) retention sweep `deleteMany` on
`audit_entries`; (2) purge sweep `deleteMany` on `submission_revisions`; (3) erasure `updateMany` on
`audit_entries` restricted to `*_ref` fields; (4) erasure `deleteMany` on `actor_identities` — and
write **one guard test per mutator** that fails if any other module performs that operation on that
collection. Restate AUD-01's guarantee as "no row is deleted outside the two sweeps, and no field is
ever overwritten except a `*_ref` field by the erasure command".
**Warning signs:** a guard test whose allowlist is a *module name* rather than a *collection +
operation*; a grep for `deleteMany` with no corresponding grep for `updateMany`.

### Pitfall R2 — OBS-08 measures a 3-tier throttler that does not exist
**What goes wrong:** the load-test plan assumes three throttler tiers to measure; the measurement
finds `cmdstat_*` deltas for the two hand-rolled limiters and nothing resembling a per-user 10/min or
per-app 100/min tier.
**Why it happens:** `docs/API.md:74-82` and `docs/ARCHITECTURE.md:47` describe the tiers as though
they ship, and STACK §8.1 records the same. But `@nestjs/throttler` is **absent** from
`package.json:26-59` (verified by reading the manifest), and `apps/api/src/common/throttler/` does not
exist in source. The only real limiter is `incrementFixedWindow`
(`packages/platform/src/redis/redis-rate-counter.ts:54-60`, `FIXED_WINDOW_SCRIPT`), consumed by the
per-link signature-failure limiter and the per-connector limiter.
**How to avoid:** decide Q2 **before** planning OBS-08, and pick one of: (a) build the two missing
tiers and then measure three; (b) re-read OBS-08 as "measures the Redis cost of the platform's rate
limiting as deployed" and measure the two existing limiters, naming the discrepancy in the
verification report. Do **not** quietly measure two and report three.
**Warning signs:** an OBS-08 plan with no install step for `@nestjs/throttler`; a load report whose
per-request Redis rounds are `< 1`.

### Pitfall R3 — dotted OTel instrument names are not valid PromQL identifiers
**What goes wrong:** alert and dashboard `expr` strings copy the OTel instrument name
(`submission.status`, `connector.outcome`, `queue.oldest.item.age`) and `promtool` rejects the rule —
or worse, a dot is parsed as a decimal point and the expression silently evaluates something else.
**Why it happens:** the repo has instruments with **both** naming styles: dotted
(`business-metrics.ts:30,33,46,49,63`) and underscored-with-`_total`
(`read-deny.metrics.ts` → `read_link_denials_total`). OBS-06's requirement text itself writes
`submission_status{status="partial"}` — the *scraped* form — which is the hint that the alert layer
works in a different namespace than the instrument layer.
**How to avoid:** the registry (P14) carries both names; the rule-file and dashboard tests validate
against `SCRAPED_NAMES`. Add a test that asserts no `expr` contains a `.` inside a metric identifier
position. Prefer underscored names for every **new** instrument.
**Warning signs:** a rule file that passes `promtool check rules` but whose `expr` references a series
that never appears in `GET /metrics`.

### Pitfall R4 — a `promtool` alert test that can only pass
**What goes wrong:** each alert has one test case with a firing `exp_alerts`, so an `expr: vector(1)`
would pass the suite; and an alert with a `for: 5m` never reaches firing at the chosen `eval_time`, so
its case asserts an empty expectation that passes by accident.
**Why it happens:** the permissive direction of the format. `exp_alerts: []` is an assertion, but it
is easy to write the case so the assertion is vacuous.
**How to avoid:** two cases per alert (fires above threshold, silent below), and either `for: 0m` with
the time window encoded in `rate(...[5m])`, or an `eval_time` past the `for` window. Additionally
assert the *reverse*: temporarily mutate one threshold and confirm the suite goes red before
committing — a one-time manual check that the test is load-bearing.
**Warning signs:** a rule test file with exactly eight `alert_rule_test` entries.

### Pitfall R5 — `updateMany` on a large audit collection under an unbounded filter
**What goes wrong:** the erasure's `updateMany({ $or: [ ...refs ] })` and the retention sweep's
`deleteMany({ timestamp: { $lt: cutoff } })` both run as single unbounded operations. On a 3-year
collection the first night's sweep locks a large portion of the collection; on a partition with no
index on `timestamp` it is a full scan.
**Why it happens:** the natural implementation is one call.
**How to avoid:** the sweep must have `{ timestamp: 1 }` (ascending — the range index) available, and
should batch: select a bounded page of `_id`s by `{ timestamp: { $lt: cutoff } }` sorted ascending,
`limit` it, delete by `_id: { $in: page }`, repeat until empty, with the row count accumulated for the
audit entry. `deleteMany` has no `limit`, so batching is a find-then-delete loop, not a limit option.
**Warning signs:** a sweep plan with a single `deleteMany` and no page loop; no ascending `timestamp`
index in P3's set.

### Pitfall R6 — running the sweeps in `api` or `worker`
**What goes wrong:** the retention sweep is registered in `apps/api` (because that is where the audit
repository is already injected), so every api replica runs it, and the sweep's own audit entry is
appended N times with N different row counts.
**Why it happens:** `upsertJobScheduler` is deliberately safe to call from every replica
(`job-scheduler.ts:42-55`), which invites the conclusion that the *execution* is safe anywhere too.
Registration is idempotent; **execution** still belongs to whichever process has exactly one worker
consuming the queue.
**How to avoid:** follow the existing `apps/scheduler/src/*.registration.ts` pattern — register **and**
consume in `apps/scheduler` only, alongside `RECONCILE_OUTBOUND_ID` and `TRANSFER_AUTO_CANCEL_ID`.
**Warning signs:** a sweep registration file under `apps/api/`.

### Pitfall R7 — rotation "verified" by restarting, not by rotating under traffic
**What goes wrong:** the phase adds the wrapped-DEK field, restarts the process, sees traffic succeed,
and checks off "zero-downtime key rotation verified". Nothing was rotated and nothing proved that a
retired key still decrypts.
**Why it happens:** the additive change makes the naive test pass.
**How to avoid:** the verification must (1) seal a secret under `kid=A`; (2) introduce `kid=B` as the
active key while `A` remains in the keyring; (3) decrypt the `A`-sealed envelope **with the process
running** and no restart; (4) re-wrap; (5) remove `A`; (6) confirm an `A`-sealed envelope now fails
with `KEY_ID_MISMATCH` (the guard already exists — `envelope.ts:197-206`). For the JWT keyring, sign
with `kid=A`, verify while `B` is active, then remove `A` and confirm an unknown-`kid` token is
**rejected rather than falling back** (also already the implemented behaviour:
`jwt-verifier.ts:125-131`, "An unknown `kid` must NOT fall back to another key").
**Warning signs:** a verification report whose evidence is a successful restart.

### Pitfall R8 — treating the mockup as a spec for the Access Review route
**What goes wrong:** the new global-admin route is built with invented copy, columns and states, and
nobody notices it contradicts the console's established patterns.
**Why it happens:** D-12 says the route is not in the mockup, and the AGENTS.md UI rule says absence
is not permission.
**How to avoid:** amend `prototypes/mockup.html` (App + IP audit columns, the Access Review nav entry)
**in the same change** as the route, so the design surface and the implementation stay one artifact.
Reuse the existing tokens (`--accent`, `--ink`, `--line`, spacing) and the existing
`InlineError`/`Skeleton` components. No acceptance criteria come from the mockup.
**Warning signs:** a plan that adds a nav entry with no mockup edit; new hex colours in the route's CSS.

## Code Examples

Verified patterns. Each is anchored to a source read **this session** or to official
documentation fetched this session.

### C1 — Hand-written Redis `ThrottlerStorage` (D-19 substrate, OBS-08 §8.2)

The interface is not guessed. Fetched from the tagged release source this session. The
five-argument signature and the four-field record are exact.

```
// Source: github.com/nestjs/throttler @ v6.7.1,
//   src/throttler-storage.interface.ts
increment(
  key: string,
  ttl: number,
  limit: number,
  blockDuration: number,
  throttlerName: string,
): Promise<ThrottlerStorageRecord>;

// Source: github.com/nestjs/throttler @ v6.7.1,
//   src/throttler-storage-record.interface.ts
export interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}
```

`ttl` and `blockDuration` are **milliseconds** (`throttler-module-options.interface.ts`:
`@default 60000` alongside `ttl: number; // milliseconds`). The implementation reuses the
`RedisEvalSeam` already in the repo rather than creating a second Redis client:

```typescript
// apps/api/src/common/throttler/redis-throttler.storage.ts (new)
// Reuses `RedisEvalSeam` — the same seam `redis-rate-counter.ts:35` declares —
// so the throttler and the existing fixed-window limiters share one connection.
import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';

/** Mirrors `FIXED_WINDOW_SCRIPT` (redis-rate-counter.ts:54) but returns the record shape. */
const THROTTLE_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { hits, ttl }
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisEvalSeam) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const storageKey = `throttle:{${throttlerName}}:${key}`;
    const [hits, rawTtl] = (await this.redis.eval(
      THROTTLE_SCRIPT,
      1,
      storageKey,
      String(ttl),
    )) as [number, number];

    const timeToExpire = Math.max(0, Math.ceil(rawTtl / 1000));
    const isBlocked = hits > limit;
    // Only set a block key once the limit is exceeded; a blocked request's
    // remaining block time is the blockDuration minus the elapsed window.
    return isBlocked
      ? { totalHits: hits, timeToExpire, isBlocked: true, timeToBlockExpire: Math.ceil(blockDuration / 1000) }
      : { totalHits: hits, timeToExpire, isBlocked: false, timeToBlockExpire: 0 };
  }
}
```

**Cost note (OBS-08, P13):** three named throttlers = three `increment` calls = three Redis
round-trips per request. That is a *prediction*; the phase measures it from
`INFO commandstats` deltas, never from the shape of the code.

### C2 — Retention sweep registered as a BullMQ Job Scheduler (D-03)

Mirrors `apps/scheduler/src/reconciliation.registration.ts:1-22` exactly, including the
`await resumeJobScheduler(queue)` that BullMQ 6's async `resume()` now requires
(`job-scheduler.ts:108-120`).

```typescript
// apps/scheduler/src/audit-retention.registration.ts (new)
import {
  JobSchedulerTarget,
  type RegisteredJob,
  registerJobScheduler,
  resumeJobScheduler,
} from '@akane/platform';

export const AUDIT_RETENTION_SWEEP_ID = 'audit-retention-sweep';
export const AUDIT_RETENTION_SWEEP_INTERVAL_MS = 86_400_000; // daily

export async function registerAuditRetentionSweep(
  queue: JobSchedulerTarget & { resume(): Promise<void> },
): Promise<RegisteredJob> {
  const result = await registerJobScheduler(
    queue,
    AUDIT_RETENTION_SWEEP_ID,
    { every: AUDIT_RETENTION_SWEEP_INTERVAL_MS },
    { name: AUDIT_RETENTION_SWEEP_ID },
  );
  await resumeJobScheduler(queue);
  return result;
}
```

**Why not `Queue.add(name, data, { repeat })`:** BullMQ 6 removed it, along with
`getRepeatableJobs()` and `getRepeatableJobsCount()` (`job-scheduler.ts:59-68`, quoting
`job-options.d.ts`: *"use `Queue.upsertJobScheduler` to schedule repeating jobs"*). A
scheduler created through a removed API path is invisible to `getJobScheduler`, so a
readiness probe reports "no scheduler" while jobs still fire.

### C3 — Prometheus rule file + `promtool test rules` pair (D-16)

Verified against `prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/`
(fetched this session). The test file's `exp_alerts: []` asserts **not firing** — that is
the assertion that catches an over-broad `for:` or a mis-scoped `rate()`.

```yaml
# observability/prometheus/rules/audit-retention.rules.yml
groups:
  - name: audit-retention
    rules:
      - alert: AuditRetentionSweepStale
        # The sweep appends an audit entry per run (D-03); absence of that
        # entry is the only signal that distinguishes "sweep is dead" from
        # "nothing to delete". Alert on the signal's absence, not a counter.
        expr: increase(platform_heartbeat[25h]) == 0
        for: 0m
        labels:
          severity: critical
          team: platform
        annotations:
          summary: "Audit retention sweep has not run in 25h"
          runbook_url: "https://internal/runbooks/audit-retention-stalled"
```

```yaml
# observability/prometheus/rules/audit-retention.rules.test.yml
rule_files:
  - audit-retention.rules.yml
evaluation_interval: 1m
tests:
  - interval: 1m
    input_series:
      - series: 'platform_heartbeat'
        values: '0+0x120'   # flat for 2h — sweep never ran
    alert_rule_test:
      - eval_time: 2h
        alertname: AuditRetentionSweepStale
        exp_alerts:
          - exp_labels:
              severity: critical
              team: platform
            exp_annotations:
              summary: "Audit retention sweep has not run in 25h"
              runbook_url: "https://internal/runbooks/audit-retention-stalled"
  - interval: 1m
    input_series:
      - series: 'platform_heartbeat'
        values: '0+1x120'   # one per minute — healthy; must NOT fire
    alert_rule_test:
      - eval_time: 2h
        alertname: AuditRetentionSweepStale
        exp_alerts: []
```

CI: `promtool check rules observability/prometheus/rules/*.rules.yml` then
`promtool test rules observability/prometheus/rules/*.rules.test.yml`. `promtool` is
**missing on the host** (probed) → the CI job must run it from the
`prom/prometheus` image, not a host binary.

### C4 — Emitted-metric registry completeness test (D-18, D-19, P14)

The test is the mechanism that makes "every OBS-03 signal has a real emit site" enforceable
rather than aspirational.

```typescript
// packages/platform/src/metrics/metric-registry.spec.ts (new)
import { describe, expect, it } from 'vitest';
import { EMITTED_METRICS } from './metric-registry';
import * as business from './business-metrics';

describe('emitted-metric registry', () => {
  it('every registered instrument has a name constant declared in business-metrics', () => {
    const declared = new Set(
      Object.entries(business)
        .filter(([k, v]) => k.endsWith('_METRIC') && typeof v === 'string')
        .map(([, v]) => v as string),
    );
    const missing = EMITTED_METRICS
      .filter((m) => m.tier === 'APP')
      .map((m) => m.instrument)
      .filter((name) => !declared.has(name));
    expect(missing, `instruments with no name constant: ${missing.join(', ')}`).toEqual([]);
  });

  it('records both the dotted instrument name and the scraped Prometheus name', () => {
    // The OTel Prometheus exporter renders `submission.status` as
    // `submission_status`; OBS-06's alert text is written against the SCRAPED
    // name. A registry holding only one of the two cannot satisfy both.
    for (const m of EMITTED_METRICS) {
      expect(m.instrument).not.toBe(m.scraped);
      expect(m.scraped).toBe(m.instrument.replaceAll('.', '_'));
    }
  });
});
```

The registry entry shape this asserts against:

```typescript
// packages/platform/src/metrics/metric-registry.ts (new)
export type MetricTier = 'APP' | 'EXTERNAL_SCRAPED';

export interface EmittedMetric {
  /** The OTel instrument name, as passed to `.createCounter` etc. */
  readonly instrument: string;
  /** The Prometheus-scraped name the exporter renders. */
  readonly scraped: string;
  readonly tier: MetricTier;
  /** Source of truth for the emit site — a path:line the test can re-check. */
  readonly emitSite: string;
  /** The OBS-03/OBS-06 signal this satisfies, or `null` for supporting signals. */
  readonly satisfies: string | null;
}

export const EMITTED_METRICS: readonly EmittedMetric[] = [
  {
    instrument: 'submission.status',
    scraped: 'submission_status',
    tier: 'APP',
    emitSite: 'packages/platform/src/...',
    satisfies: 'OBS-06 rule 4',
  },
  // ...
];
```

`metric-registry.ts` exists in intent only; `business-metrics.ts:20-24` already names the
same idea — *"Declaring them here makes the naming convention a Phase 1 decision and lets
the exporter in plan 09 validate against a known set."* This test is that validation.

### C5 — Key-rotation verification that cannot pass by accident (D-21, WINDOW 7)

The additive change is the easy part. The verification is what proves zero downtime, and it
must fail if rotation did not actually happen.

```typescript
// packages/platform/src/crypto/envelope-rotation.spec.ts (extend)
it('decrypts an envelope sealed under a retired kid, without a process restart', async () => {
  const keyA = await newLocalKeyProvider({ kid: 'A' });
  const sealed = await encryptSecret('credential', keyA);

  // B becomes the ACTIVE key; A stays in the keyring. No restart.
  const keyring = newKeyring({ active: 'B', retained: [keyA] });
  const opened = await decryptSecret(sealed, keyring);
  expect(opened.toString('utf8')).toBe('credential');

  // Re-wrap onto B, then retire A entirely.
  const rewrapped = await encryptSecret(opened, keyring);
  expect(rewrapped.kid).toBe('B');

  // A-sealed envelope must now fail LOUDLY, not silently fall back.
  await expect(decryptSecret(sealed, newKeyring({ active: 'B', retained: [] })))
    .rejects.toThrow(/KEY_ID_MISMATCH/);
});
```

The `KEY_ID_MISMATCH` guard already exists (`envelope.ts`, and the JWT side at
`jwt-verifier.ts:125-131`: *"An unknown `kid` must NOT fall back to another key"*). The
JWT keyring is verified the same way through `jose`'s `keyResolver` — sign with `kid=A`,
verify while `B` is active, then remove `A` and assert rejection rather than fallback.

**Anti-pattern this example exists to block (Pitfall R7):** restarting the process and
observing traffic succeed proves nothing about rotation.

### C6 — Marketed-as-queryable `GET /audit` filter parsing (D-10, AUD-05)

The filter set is validated with the same Zod dialect as every other boundary, and the
schema doubles as the contract the controller cannot drift from.

```typescript
// apps/api/src/audit/audit-query.schema.ts (new)
import { z } from 'zod';

export const AuditQuerySchema = z
  .object({
    user: z.string().min(1).max(128).optional(),
    app_id: z.string().uuid().optional(),
    action: z.string().min(1).max(64).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(AUDIT_MAX_LIMIT).default(AUDIT_DEFAULT_LIMIT),
    cursor: z.string().optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, 'from must not be after to');
```

`AUDIT_DEFAULT_LIMIT = 20` and `AUDIT_MAX_LIMIT = 100` are the existing constants
(`apps/api/src/audit/audit.controller.ts:101,104`) and are **reused, not re-declared**.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Queue.add(name, data, { repeat })` / `getRepeatableJobs()` | `Queue.upsertJobScheduler(id, repeatOpts, template)` | BullMQ 6 | Repeatable jobs created the old way are invisible to `getJobScheduler`; readiness probes lie |
| `passport` + `@nestjs/jwt` (wraps `jsonwebtoken`) | `jose` with `keyResolver` + `kid` keyring | Adopted in STACK.md | Zero-downtime rotation becomes native instead of hand-rolled |
| `prom-client` as a second metrics path | OTel metrics API → single `PrometheusExporter` | `prom-client` deprecated | One scrape endpoint, one naming convention, one alert surface |
| `formiojs` 4.x | `@formio/js` 5.x | FormIO maintenance mode on 4.x | Bootstrap 5 default; `component.error` → `component.errors` array |
| TTL index for retention | BullMQ Job Scheduler sweep that appends an audit entry | D-03 (this phase) | TTL has no audit trail and no "did it run" signal; a sweep documents itself |
| Free-text `changeSummary` on audit entries | Named `*_ref` identity fields | D-06 (this phase) | Erasure becomes a field-level operation with a bounded blast radius |

**Deprecated / superseded in this phase:**
- `[key: string]: unknown` on `AuditEntry` (`packages/domain/src/audit/audit.repository.ts:10`)
  — removed by D-06. An open index signature makes the erasure blast radius unbounded: you
  cannot enumerate what to redact because the type says anything may be there.
- The three community Redis throttler storages — all unusable (405/peers ≤ NestJS 11/node-redis
  only). The hand-written storage (C1) is the only clean path.
- `@nestjs/schedule` for the retention sweep — in-memory and per-instance. A retention sweep
  that silently does not run on one pod is a compliance failure, not a nuisance.

## Assumptions Log

Every claim below is `[ASSUMED]` — training knowledge or reasoning, not verified by a source
read this session. The planner and the discuss-phase should treat each as a confirmation
checkpoint, never as a locked fact.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@nestjs/throttler@6.7.1` compiles and runs against `@nestjs/core@12` as its peer range claims. Verified only from `npm view` peers + the v6.7.1 tagged source; **never installed or executed this session**. | C1, Standard Stack | The whole hand-written `ThrottlerStorage` is built on a module that will not install. Mitigated by the `[SUS]` gate → mandatory `checkpoint:human-verify` before install. |
| A2 | The OTel Prometheus exporter renders every `.` in an instrument name as `_`, so `submission.status` is scraped as `submission_status`. | C4, P14, Pitfall R3 | The registry's `scraped` derivation and every PromQL expression written against the scraped name would be wrong — alerts would silently never fire. **Not fetched this session.** The C4 test asserts the mapping, which converts this from a silent failure into a red test. |
| A3 | `INFO commandstats` deltas, read before and after a k6 run against a real Redis, isolate the throttler's per-request cost well enough to answer OBS-08's "measure the Redis cost" obligation. | P13, Q-note | The measured number includes the existing fixed-window limiters and BullMQ traffic. If it does not separate cleanly, the metric is directional, not attributable. |
| A4 | A k6 `constant-arrival-rate` scenario at `rate: 50, timeUnit: '1s'` with `preAllocatedVUs` sized from an initial ramp can hold 50 events/s against the real stack. The required VU count is **unknown** and must be measured, not chosen. | P12 | Under-provisioned VUs make k6 drop iterations and report a *lower* achieved rate as a pass. The scenario must assert `dropped_iterations == 0`, or the load result is meaningless. |
| A5 | Grafana dashboards-as-code are best committed as provisioned dashboard JSON (not Grafonnet or Grizzly). | D-19, P14 | A dashboard generator added without checking would be a new dependency the phase does not need. JSON is the lowest-commitment option; the panel-query test in OBS-07 works against either. |
| A6 | "Loki 30-day hot, 1-year cold" (D-20) is expressible as committed deployment config with a drift test, and is a deployment concern rather than an application-code one. | P11 | If Loki retention is immutable at deploy time, the drift test has nothing to read and the obligation must be evidenced by a deployment-manifest assertion instead. |
| A7 | AUD-04's erasure surface is the `*_ref` fields on `audit_entries` plus `submission_revisions.data` bodies — i.e. no other audit field carries direct PII after D-06. | P4, Q1 | If `target` or a future field carries a name or email, erasure is incomplete. The D-06 open-index-signature removal is what makes this enumerable; the assumption is that enumeration is now possible and was done. |
| A8 | The `access_reviews` collection shape and its stored JSONL report (D-12, discretion) can be designed freely without violating a frozen contract. | P7 | No frozen contract covers this collection, so the risk is design churn rather than contract breakage — but a shape that cannot answer "who had what role at time T" would have to be re-collected. |
| A9 | MongoDB compound indexes ordered `{actor_ref:1,timestamp:-1}` etc. serve the AUD-05 filter set efficiently under the ESR guideline. | P3 | Reasoning from the guideline, not an `explain()` against real cardinality. Must be confirmed with `explain('executionStats')` in the phase, not assumed. |
| A10 | `promtool` and `k6` run from Docker images in CI (`prom/prometheus`, `grafana/k6`) on the standard `ubuntu-latest` runner. Neither binary is present on this host, and no CI job exercises them today. | C3, P12, Env | If the runner cannot pull those images, D-16's `promtool test rules` gate has no home in CI. Verify the image pull in the same job that adds it. |
| A11 | The legal framing for retaining audit records past an erasure request (legitimate interest / legal obligation) is a **counsel question, not a research question**, and this phase implements the *mechanism* (bounded, configurable retention) without asserting the *justification*. | Summary, Security Domain, Q1 | The greatest risk in this phase is presenting a mechanism as a legal conclusion. Requirement AUD-04's "null the actor reference" wording already concedes that the record survives; the research must not upgrade that into "this is compliant". |
| A12 | A dependency-free regex name extractor over the `expr:`/`record:` lines of the rule files is sufficient to drive OBS-06's name-resolution test, making a `yaml` dependency unnecessary. | D-16, P10, Naming | A rule using multi-line YAML flow syntax or a template in a name position could evade a line-oriented extractor and pass vacuously. The C4 registry test is the backstop; if the extractor proves brittle, adding `yaml` is a small, already-legitimate dependency (`[OK]` by the legitimacy gate). |

**If any row above is wrong, the corresponding section is wrong.** A1 and A2 are the two
that would break silently rather than loudly; both have a named test that converts them into
a loud failure, which is why they are safe to leave pending.

## Open Questions

### Q1 — AUD-04's "null the actor reference" contradicts AUD-01's append-only guarantee. Who owns what?

- **What we know:** D-01 preserves AUD-01 (append-only; `audit.repository.ts:32-33` states
  *"append-only - no update or delete operations"*). D-05 says *"AUD-01 needs no erasure
  exception at all"*. AUD-04 says erasure must *"null the actor reference"* on audit
  records. D-06 says erasure *"redacts every field matching `*_ref`"*. A field-level
  redaction of a stored record **is** an update to an append-only collection.
- **What's unclear:** whether the requirement or the decision is authoritative where they
  conflict, and whether the redaction should instead be modelled as *appending* a
  redaction event and filtering at read time (which would preserve append-only literally).
- **Recommendation:** treat both as true and name **two single owners**, each with its own
  guard test — the retention sweep owns `deleteMany`, the erasure path owns an `updateMany`
  restricted to fields matching `*_ref`. Document in the plan that "append-only" therefore
  means *append-only for application code, with two named, guarded mutators*. **This is a
  contract-shape decision, so get it confirmed rather than assumed.** Append-only-plus-
  redaction-event is a defensible alternative and is strictly stronger cryptographically;
  it is not obviously worth the read-path complexity.

### Q2 — `docs/API.md` and `docs/ARCHITECTURE.md` document a 3-tier `@nestjs/throttler` that does not exist in the repo.

- **What we know:** `docs/API.md:74-82` and `docs/ARCHITECTURE.md:47` describe `perUser`
  (10/min), `perApp` (100/min) and `perConnector` named throttlers over a hand-written
  `ThrottlerStorage`. `@nestjs/throttler` is **not in `package.json`**, and
  `apps/api/src/common/throttler/` does not exist. The only rate limiting that runs today
  is `incrementFixedWindow` (`redis-rate-counter.ts`), used by `signature-failure-limiter.ts`
  (per-link `jti`) and `connector-rate-limiter.ts`.
- **What's unclear:** whether OBS-08's "measure the 3-tier throttler" obligation assumes an
  implementation that this phase must *also build*, or only an implementation that exists
  elsewhere in the roadmap.
- **Recommendation:** the phase must either (a) build C1 as part of this phase's scope, or
  (b) restate OBS-08's evidence against the throttle mechanisms that *do* exist. Building it
  here is a real scope increase. **Ask before planning.** The `[SUS]` verdict on
  `@nestjs/throttler` makes (b) cheaper and (a) gated on a human checkpoint.

### Q3 — `decision accuracy` (OBS-09) has no instrument, and is not on OBS-03's signal list.

- **What we know:** OBS-09 names "decision accuracy" as an observable. OBS-03 enumerates the
  eight signals that must have real instruments (D-18). `decision accuracy` is not among
  them, and no existing metric measures routing/JEV decision correctness — `routing_outcomes`
  is a collection, not a metric.
- **What's unclear:** whether decision accuracy is measurable at all from telemetry (it
  requires knowing the *correct* decision, which is ground truth the platform does not
  collect), or whether the intended signal is a proxy such as re-ask rate / no-match rate.
- **Recommendation:** do not invent a proxy and call it accuracy. Either OBS-09 is satisfied
  by a **documented measurement procedure** (sampled review against `routing_outcomes`)
  rather than an instrument, or it needs a proxy that the requirement's own author must
  choose. **Flag for the discuss-phase.** Presenting a re-ask-rate proxy as "accuracy" would
  be the most misleading claim this phase could make.

### Q4 — Where is `form load time` emitted?

- **What we know:** OBS-03 requires a `form load time` signal. The Form Renderer is a static
  web app; the API issues the link. A server-side histogram measures redirect/handshake
  latency, not render time.
- **What's unclear:** whether the requirement means time-to-first-render (client beacon
  required; new endpoint; new cardinality and privacy surface — the beacon carries a
  `app_id` and possibly a `real_user_id`) or server-side issuance latency.
- **Recommendation:** default to the **server-side** histogram unless the requirement's
  intent is explicitly render time, and state the interpretation in the plan. A client
  beacon adds a write endpoint to a surface that deliberately carries no cookie, and the
  privacy/shape cost is large enough that it deserves an explicit decision.

### Q5 — OBS-06 rules 5 and 6 cannot be satisfied by application instruments.

- **What we know:** two of OBS-06's seven alerts concern Redis memory (`>80%`) and MongoDB
  replication lag (`>5s`). Neither is observable from an OTel application instrument; both
  need `redis_exporter` / MongoDB exporter metrics scraped alongside the app.
- **What's unclear:** whether this phase's scope includes standing up those exporters (an
  infrastructure change) or whether the alerts may reference `EXTERNAL_SCRAPED` metrics
  that are assumed present.
- **Recommendation:** add an `EXTERNAL_SCRAPED` tier to the registry (P14 already carries
  the `tier` field for this) and treat rules 5–6 as alerts whose *rule* is in scope and
  whose *series* is out of scope but must be stated as a dependency. An alert rule over a
  series that never exists is a permanently-silent alert — exactly the failure OBS-06
  exists to prevent, so this must be an explicit, named limitation rather than a gap.

### Q6 — Close WINDOW 5 (pino `msg`) while this phase is already in the logging code?

- **What we know:** `LOG_FIELD_ALLOWLIST` (`log-allowlist.ts:30-67`) includes `msg` at line
  34 — the free-form message field, which is the widest possible channel for un-redactable
  PII. WINDOW 5 records this. D-20 puts log retention in scope this phase.
- **What's unclear:** whether removing `msg` from the allowlist breaks call sites that rely
  on it (the phase's own drift test would reveal this immediately).
- **Recommendation:** **discretion item.** Attempt it only if the allowlist drift test shows
  no call site depends on `msg`; otherwise leave WINDOW 5 open and record why. Do not expand
  scope to fix logging call sites in a production-readiness phase.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Everything | ✓ | v24.15.0 | — |
| npm | Workspaces, CI | ✓ | 11.12.1 | — |
| Docker (server) | testcontainers, k6, promtool | ✓ | 29.8.0 | — |
| `mongo:8.0` image (local) | Integration tests, purge-window tests | ✓ | 8.0 | — |
| `redis:8.10-alpine` image (local) | Throttler / `commandstats` harness | ✓ | 8.10 | — |
| `testcontainers/ryuk:0.14.0` image (local) | testcontainers teardown | ✓ | 0.14.0 | — |
| `quay.io/keycloak/keycloak:26.0` image (local) | SSO e2e (existing) | ✓ | 26.0 | — |
| `jq` | `INFO commandstats` parsing in the cost harness | ✓ | /usr/bin/jq | Parse in Node if absent |
| `promtool` | OBS-06 rule + rule-test gate (D-16) | ✗ | — | ✅ Run from `prom/prometheus` Docker image (not cached locally) |
| `k6` | OBS-08 load scenarios (D-17) | ✗ | — | ✅ Run from `grafana/k6` Docker image (not cached locally) |
| `docs/runbooks/` | OBS-10 five runbooks (D-20) | ✗ | — | None needed — create in Wave 0 |
| `observability/` | Prometheus rules, Grafana dashboards (D-16, D-19) | ✗ | — | None needed — create in Wave 0 |
| `load/` (`k6` scripts) | OBS-08 scenarios | ✗ | — | None needed — create in Wave 0 |
| `apps/api/src/common/throttler/` | OBS-08 3-tier throttler (Q2) | ✗ | — | See Q2 — in or out, decide first |

**Missing dependencies with no fallback:**
- None that block. The two missing binaries (`promtool`, `k6`) both have containerised
  fallbacks, but neither image is cached locally — the first run will pull them, and CI must
  be able to do the same (A10).

**Missing dependencies with fallback:**
- `promtool` → `docker run --rm -v "$PWD/observability:/w" -w /w prom/prometheus promtool …`
- `k6` → `docker run --rm -v "$PWD/load:/load" grafana/k6 run /load/<scenario>.js`
- `jq` is present but should not be a hard requirement of a Node repo; prefer parsing in the
  existing toolchain (`tooling/`) so the harness has one runtime (A3).

## Validation Architecture

> `workflow.nyquist_validation` is **absent** from `.planning/config.json` → treated as
> **enabled**. This section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.3 (`[VERIFIED: package.json devDeps]` in STACK.md §14) + `@playwright/test` 1.63.0 |
| Config file | `vitest.config.mts` (root, single config — `[VERIFIED: vitest.config.mts:7-45]`); `playwright.config.ts` |
| Quick run command | `npx vitest run <path/to/file.spec.ts>` |
| Full suite command | `npm test` → `vitest run` (`[VERIFIED: package.json scripts.test]`) |
| Suite size today | 162 `*.spec.ts` files across `packages/**`, `apps/**`, `tooling/**` (`[VERIFIED: shell find, this session]`) — **0** `*.e2e-spec.ts`; e2e lives in `apps/app-builder/e2e/**` and is excluded from Vitest by `vitest.config.mts:41` |
| Timeouts | `testTimeout` / `hookTimeout` = 120000 ms (`vitest.config.mts:43-44`) |
| setupFiles | `./test/setup-env.ts` (`vitest.config.mts:42`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| AUD-03 | Audit entries remain append-only; mutators are named and guarded | unit | `npx vitest run packages/domain/src/audit/audit-append-only.spec.ts` | ❌ Wave 0 |
| AUD-04 | Erasure nulls `*_ref` fields and appends an `erasure.executed` entry | integration | `npx vitest run packages/domain/src/audit/erasure.integration.spec.ts` | ❌ Wave 0 |
| AUD-05 | `GET /audit` accepts `user`/`app_id`/`action`/`from`/`to` and filters correctly | unit + integration | `npx vitest run apps/api/src/audit/audit-query.schema.spec.ts` | ❌ Wave 0 |
| AUD-06 | JSON Lines export emits one valid JSON object per line | unit | `npx vitest run apps/api/src/audit/audit-export.spec.ts` | ❌ Wave 0 |
| AUD-07 | Identity fields are named `*_ref`; no open index signature remains | unit (static) | `npx vitest run packages/domain/src/audit/audit-entry-shape.spec.ts` | ❌ Wave 0 |
| AUD-08 | Purge honours the window; archived app → `purged` → hard delete after grace | integration (clock-injected) | `npx vitest run packages/domain/src/audit/purge-window.integration.spec.ts` | ❌ Wave 0 |
| AUD-09 | Quarterly access review produces a stored report | unit | `npx vitest run apps/scheduler/src/access-review.spec.ts` | ❌ Wave 0 |
| OBS-03 | Every declared signal has a real instrument + emit site | unit | `npx vitest run packages/platform/src/metrics/metric-registry.spec.ts` | ❌ Wave 0 (see C4) |
| OBS-06 | Eight alert rules fire and stay silent as specified | **promtool** | `docker run --rm -v "$PWD/observability:/w" -w /w prom/prometheus promtool test rules rules/*.test.yml` | ❌ Wave 0 + **CI job** |
| OBS-07 | Every Grafana panel query resolves to a registered emitted metric | unit | `npx vitest run observability/dashboards/panel-query.spec.ts` | ❌ Wave 0 |
| OBS-08 | 50 events/s sustained at 1,000 users; throttler Redis cost measured | **load** | `docker run --rm -v "$PWD/load:/load" grafana/k6 run /load/inbound-50rps.js` (+ `INFO commandstats` harness) | ❌ Wave 0 |
| OBS-09 | `decision accuracy` measurable per the chosen interpretation | unit (blocked) | — | ❌ **blocked by Q3** |
| OBS-10 | Five runbooks exist and every `runbook_url` resolves to one | unit | `npx vitest run observability/runbook-url.spec.ts` | ❌ Wave 0 |

**Two of the thirteen (OBS-06, OBS-08) cannot be Vitest tests.** They are the two that are
"verification-only obligations" in the ROADMAP note, and they need their own CI job — not a
new spec file. `promtool test rules` is the only mechanism that asserts an alert *does not*
fire, and a k6 scenario is the only mechanism that produces a sustained arrival rate. A
unit test that mocks the queue and asserts a counter incremented does not evidence either.

### Sampling Rate

- **Per task commit:** `npx vitest run <touched paths>` — must be green before the commit.
- **Per wave merge:** `npm test` (full Vitest suite, 162 files and growing) — the existing
  `build` CI job runs exactly this.
- **Phase gate:** `npm test` **and** `promtool test rules` **and** the k6 scenario all green,
  plus the `install-guard` job still proving the TypeScript pin. Full suite green before
  `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `packages/platform/src/metrics/metric-registry.ts` + `metric-registry.spec.ts` — the
      registry (P14) is the dependency of OBS-03, OBS-06, OBS-07 and OBS-10. Nothing else
      can be verified until it exists.
- [ ] MongoDB `audit_entries` repository `deleteMany` owner + guard test — the single-owner
      constraint (D-04) has no enforcement until the guard test exists.
- [ ] `packages/domain/src/audit/` — append-only guard, entry-shape test, erasure path.
- [ ] `apps/api/src/audit/audit-query.schema.ts` + spec — D-10's filter contract.
- [ ] `apps/scheduler/src/audit-retention.registration.ts` + `access-review` sweeper.
- [ ] `observability/prometheus/rules/` — eight rules + their `.test.yml` pairs.
- [ ] `observability/dashboards/` — provisioned JSON + the panel-query resolution spec.
- [ ] `observability/runbook-url.spec.ts` + `docs/runbooks/*.md` — five runbooks.
- [ ] `load/` — k6 scenarios + the `INFO commandstats` cost harness.
- [ ] **CI job(s) for `promtool` and k6** — `.github/workflows/ci.yml` has exactly two jobs
      (`build`, `install-guard`) and neither installs or runs either tool.
- [ ] testcontainers fixtures for a real Mongo 8.0 + Redis 8.10 — the purge-window and
      erasure tests cannot be mocked (they assert the *effect* of a real `deleteMany` /
      `updateMany`, which a mock would trivially satisfy).
- [ ] **No framework install needed** — Vitest and Playwright are already configured.

## Security Domain

> `security_enforcement` is absent from config → **enabled**. This section is required.
> This phase is itself largely a security-compliance phase (retention, erasure, access
> review, key rotation), so most ASVS categories apply directly rather than peripherally.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | **yes** | Existing admin OIDC SSO is untouched; this phase touches the **JWT `kid` keyring** (`jose` `keyResolver`) — rotation must never weaken verification. No fallback on unknown `kid` (`jwt-verifier.ts:125-131`). |
| V3 Session Management | no | Stateless by design (AD-9); all session state is in Redis; no session change in this phase. |
| V4 Access Control | **yes** | `GET /audit` and the new Access Review route are **global-admin-only**. The gate is the control; a filter parameter must never widen visibility. |
| V5 Input Validation | **yes** | Zod 4 at every boundary — the audit filter set (`AuditQuerySchema`, C6) is the new boundary. Reused `AUDIT_MAX_LIMIT` bounds the response. |
| V6 Cryptography | **yes** | `SecretEnvelope` DEK rotation (D-21). **Never hand-roll** — `crypto` stdlib primitives already wrapped in `envelope.ts`; the phase adds a *persisted wrapped DEK*, not a new cipher. Nonce must never be reused under one key (`envelope.ts:88`). |
| V7 Logging & Monitoring | **yes** | The `LOG_FIELD_ALLOWLIST` **allowlist** applied in the pino serializer hook *before serialisation* (D-43). Retention is the other half of the same control: a log outliving the erasure SLA makes erasure a lie. |
| V8 Data Protection | **yes** | Erasure (`*_ref` redaction + `actor_identities` deletion), 3-year retention **floor** that is extend-only, PII never in JWTs. |
| V11 Business Logic | **yes** | The retention floor (`AUDIT_RETENTION_FLOOR_DAYS`) must be enforced such that a config value below the floor is a boot failure, not a silent truncation — otherwise "3-year retention" is a config typo away from being false. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Audit-record tampering or retroactive edit | Tampering | Append-only enforced by the repository interface plus **two named, guard-tested mutators only** (Q1). No general update/delete path. |
| Erasure that does not erase (PII survives in audit or submission bodies) | Information Disclosure | The erasure path must be asserted against a **real Mongo** — a mock `updateMany` always succeeds. AUD-08's purge covers `submission_revisions.data`, which is where submission bodies actually live. |
| PII reaching a log line through a free-form field | Information Disclosure | `LOG_FIELD_ALLOWLIST` is an allowlist, applied pre-serialisation. `msg` (line 34) is the residual hole — see Q6. |
| Records retained beyond the erasure SLA | Compliance / Information Disclosure | Retention floor is a boot-validated constant; the sweep emits a heartbeat so its failure is alertable (C3). Cold-log retention ≤ erasure SLA (A6). |
| Privilege escalation through the audit read surface | Elevation of Privilege | Global-admin gate on the route; `app_id`/`user` filters narrow, never widen. The Access Review route (D-12) is the same gate. |
| High-cardinality metric labels used as a DoS vector | Denial of Service | Label sets are bounded (`app_id`, `status`, `outcome`, `taxonomy_code` — `business-metrics.ts:52-63`). **Never** a `real_user_id` or a request id as a label. |
| A missing telemetry signal producing a permanently-silent alert | Repudiation | The metric-registry completeness test (C4) asserts instrumentation exists; `promtool test rules` asserts each rule *does* fire on its trigger series. A rule over a non-existent series is the failure both mechanisms catch. |
| Secret exposure during key rotation | Information Disclosure | The DEK is persisted **wrapped**, never plaintext; the KMS provider unwraps. Envelope `iv` is fresh per encryption (`envelope.ts:87`). `[key: string]: unknown` removal (D-06) also closes an accidental-PII-spread surface. |
| **Legal framing asserted as researched fact** | — | **Out of scope by decision.** The mechanism (bounded retention, configurable, floor-enforced) is implementable; the *justification* for retaining a record past an erasure request is a counsel question. RESEARCH.md must not present it as settled (A11). |

## Sources

### Primary (HIGH confidence)

- **Read this session, verbatim, with line ranges** — in-repo discrete values:
  - `packages/domain/src/audit/audit.repository.ts` — `AuditEntry`, the `[key: string]: unknown` line, the append-only comment.
  - `apps/api/src/audit/audit.controller.ts` — `AUDIT_DEFAULT_LIMIT`, `AUDIT_MAX_LIMIT`, `AuditEntryView`.
  - `packages/contract/src/builder/publish.contract.ts` — the four-value lifecycle enum.
  - `packages/domain/src/builder/app-lifecycle.ts:43-78` — `AppLifecycleState`, `APP_LIFECYCLE_STATES`, `LEGAL_TRANSITIONS` with the terminal `archived` edge.
  - `packages/platform/src/metrics/business-metrics.ts:26-74` — `METER_NAME`, the five metric name constants, `BusinessMetrics`.
  - `packages/platform/src/crypto/envelope.ts:70-129` — `DEK_DERIVATION_LABEL`, `SecretEnvelope`, `deriveDek`, `encryptSecret`.
  - `packages/platform/src/config/config.schema.ts:45-127` — `AppConfigShape`, `AppConfigObjectSchema`, `APP_CONFIG_KEYS`.
  - `packages/platform/src/logging/log-allowlist.ts:28-67` — `LOG_FIELD_ALLOWLIST`.
  - `packages/platform/src/queue/job-scheduler.ts:1-121` — the removed BullMQ 6 APIs, `registerJobScheduler`, `resumeJobScheduler`.
  - `apps/scheduler/src/reconciliation.registration.ts:1-22` — the registration pattern mirrored by C2.
  - `vitest.config.mts:1-46` — alias order, include/exclude globs, timeouts, setup file.
  - `.github/workflows/ci.yml` — the two existing jobs (`build`, `install-guard`).
  - `package.json` — the dependency manifest and script set.
- **Fetched from tagged source this session:**
  - `github.com/nestjs/throttler` @ `v6.7.1` — `src/throttler-storage.interface.ts`, `src/throttler-storage-record.interface.ts`, `src/throttler-module-options.interface.ts`, `src/throttler.decorator.ts`.
- **Official documentation fetched this session:**
  - `prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/` — the full test-file format, series-expanding notation, `alert_rule_test` with `exp_alerts: []` as a not-firing assertion.
  - `grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/` — open-model executor options.
  - `redis.io/docs/latest/commands/info/` — `commandstats` fields.
  - `mongodb.com/docs/manual/applications/indexes/` → ESR guideline page.
- `.planning/phases/09-production-readiness/09-CONTEXT.md` — D-01…D-21, F-1…F-4, discretion, deferred. The authoritative source for `<user_constraints>`.
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/WINDOWS.md` — requirement text, phase goal and success criteria, open windows.

### Secondary (MEDIUM confidence)

- `gsd_tools query package-legitimacy check` (this session): `@nestjs/throttler` → `[SUS]` (`too-new`, published 2026-09-24T11:17:33.213Z, 2,659,780 dl/wk); `yaml` → `[OK]` (2.9.1, ISC, 133,252,983 dl/wk).
- `npm view @nestjs/throttler version` → `6.7.1`; peers `@nestjs/core`/`@nestjs/common` `^12.0.0`; engines `^20.19.0 || ^22.12.0 || >=24.0.0`.
- STACK.md §4.4, §6, §8.1–8.2, §14 — the project's own verified version ledger (NestJS 12.1.2, ioredis 6.0.0, BullMQ 6.3.11, Vitest 5.0.3, `@opentelemetry/exporter-prometheus` 0.222.0, `@nestjs/throttler` 6.7.1, `jose` 6.2.12).

### Tertiary (LOW confidence)

- OTel Prometheus exporter dot→underscore renaming (**A2**) — reasoned from the naming rules, **not fetched this session**. The C4 test is the corrective.
- Grafana dashboards-as-code format choice (**A5**) — no Grafana docs fetched.
- k6 VU provisioning for 50 events/s (**A4**) — must be measured, not sourced.

## Metadata

**Confidence breakdown:**

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | **HIGH** | Every version and peer range in the stack is inherited from STACK.md's verified ledger; the one new package this phase might install (`@nestjs/throttler`) is verified from its tagged source, with the `[SUS]` verdict carried forward as a mandatory human checkpoint. |
| Architecture (audit/erasure/index shape) | **HIGH on mechanism / MEDIUM on contract shape** | The append-only, single-owner and erasure mechanics are read from the actual repository interface and the actual controller. The AUD-04-vs-AUD-01 conflict (Q1) is a genuine unresolved contract question, not an unknown — which is why it is an Open Question with a recommended resolution rather than an assumption. |
| Observability | **HIGH** | The single Prometheus path already exists in the repo (`MetricsController`, `preventServerStart: true`); `promtool`'s test format and k6's executor options are both verified from official docs. The only soft spot is the dotted-name rendering (A2), which has a named test. |
| Pitfalls | **HIGH** | R1–R8 are each anchored to a specific file and line read this session, or to a verified documentation statement. R2 (documented-but-absent throttler) is a direct code-plus-docs contradiction, not a speculation. |
| Load / scale evidence | **MEDIUM** | The *method* (k6 open-model arrival rate + `INFO commandstats` deltas) is verified; the *result* does not exist yet and cannot be researched — it must be measured in the phase. |
| Legal compliance posture | **LOW / out of scope** | Deliberately not researched. The phase implements mechanism, not justification (A11). |

**Research date:** 2026-10-20
**Valid until:** ~2026-11-19 (30 days) for the stack and architecture; **re-verify immediately
before use** any claim about `@nestjs/throttler` (a `[SUS]` verdict is age-sensitive) and any
Grafana/k6 option, which move faster than the 30-day window.
