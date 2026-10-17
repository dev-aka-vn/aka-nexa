# Phase 5: Integration & Async Execution - Research

**Researched:** 2026-10-09
**Domain:** Transactional outbox + async connector execution (NestJS 12 / BullMQ 6 / MongoDB 8.0 / Redis 8.10), plus the mandated Redmine REST contract research
**Confidence:** HIGH on architecture and stack (existing, verified code + STACK.md); MEDIUM on the Redmine contract detail; LOW on a small number of labelled absence-claims (see Assumptions Log)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Submission status surface (DAT-14)**
- **D-80:** The status surface is a **per-app "My submissions" list**, reached by the **frozen `query` read-link action** carrying a per-user saved query. DAT-11's auto-injected `real_user_id` + `deleted_at: null` is the ownership filter — **no new token claim and no new action**. Cross-app listing is explicitly out of scope. — **Reversibility:** one-way — the read-link action enum is frozen (D-21/D-24, LNK-07); adding a cross-app action later means a second published token contract, and a claim added then is a `400` on every link issued now.
- **D-81:** A `partial` submission is **read-only** on the status surface: it names the outstanding destination (e.g. *"Internal saved · Redmine: retrying"*) and carries **no user-facing retry**. Retry stays with the admin/DLQ path (CON-04 / D-83–D-85). — **Reversibility:** reversible.
- **D-82:** Each row/detail shows app, form, submitted time, status; for a **confirmed** external call the **downstream reference**; for a failure a **user-safe reason** mapped from the connector error taxonomy. Raw HTTP bodies, credentials, and PII never surface (allowlist discipline, D-43 / W-22). — **Reversibility:** reversible.

**Admin surfaces without admin auth (CON-02/04/08)**
- **D-83:** Phase 5 ships an **operator CLI mirroring D-31** — connector upsert from committed files, `dlq list` / `dlq retry`, and the connector-ref rebind (D-86). **No admin HTTP surface**; admin auth is Phase 6 (BLD-12), which replaces the files with real authoring. — **Reversibility:** costly — the CLI shape and its audit events are what Phase 6's UI must reproduce.
- **D-84:** `dlq retry` **re-enqueues through the same outbox path** automatic retry uses. Only `not_sent` is retriable by default; a `sent_unconfirmed` item requires an explicit `--force` that first runs the **DAT-13 natural-key pre-check** — never a blind resend (SC#3). — **Reversibility:** costly — this is the SC#3 safety rule; loosening it is a silent double-send.
- **D-85:** DLQ CLI output is **redacted by default** (ids, outbound state, error-taxonomy code, attempt count, timestamps) under the same field allowlist that governs logs; `--show-payload` is opt-in **and is itself written to the audit trail**. — **Reversibility:** reversible.
- **D-86:** An app's `connector_ref` change is a **seed-file edit + idempotent reload** (D-31); the loader detects the diff and writes a dedicated **AUD-01 before → after transition**. Committed files stay the source of truth — no DB-vs-file divergence. — **Reversibility:** costly — Phase 6 authoring inherits this reconciliation model.

**Connector credentials, interface & Redmine (CON-01/02/09, FND-10, W-24)**
- **D-87:** **Both credential gates stay open.** FND-10 / D-27 (no KMS vendor named) and WINDOWS #7 / W-24 (the envelope's wrapped-DEK is not persisted beside the envelope) are **not** resolved here. Phase 5 ships the full connector capability but keeps `LocalKeyProvider` + the production guard intact (prod still refuses to boot without `CRYPTO_KEY_PROVIDER=kms`) and stores only **local/test credentials**. Storing a *production* credential stays blocked. — **Reversibility:** reversible — deliberately deferred; unblocks wholesale the day the deployment cloud is named.
- **D-88:** The first connector credential is stored as the existing **five-field AES-256-GCM envelope via the `KeyProvider` abstraction**, in a `connector_credentials` collection keyed by `credential_ref`. The identical resolution path works unchanged once the KMS adapter lands. — **Reversibility:** reversible.
- **D-89:** The shared contract `Connector` interface **evolves to CON-01's full shape** — `testConnection()`, `getCapabilities()`, and `execute(operation, payload, context)`. One interface everywhere; Phase 6's publish-time `supports_idempotency_key` surface and Phase 7 adapters build on it. — **Reversibility:** one-way — `packages/contract/src/connector/connector.ts` is a published seam; once Phase 5 consumers and the Phase 6 builder exist, changing its shape is a migration across every connector and the builder surface.
- **D-90:** The Redmine connector is a **generic REST transport core** (base_url, auth from `credential_ref`, timeout, retry, rate limit) **plus a thin Redmine adapter** supplying endpoint paths, `{{form.field}}` / `{{real_user.attribute}}` mapping, and the HTTP-status → **error-taxonomy** mapping (including the CON-07 `credential_rejected` vs `endpoint_unreachable` split). — **Reversibility:** costly — the mapping/taxonomy contract is what Phase 7 adapters reuse.

**Edit links & the single-send guarantee (LNK-02 / DAT-06 / DAT-13)**
- **D-91:** An edit is a **new revision with a new send** — the correction **does reach the external system**. DAT-13's guarantee is reworded from *"a single send per submission"* to **"a single send per revision"**. — **Reversibility:** one-way — this amends a v1 requirement (DAT-13) and FR-D-12's amendment; reverting re-litigates write-once and invalidates stored revisions.
- **D-92:** The downstream idempotency key is the composite **`{submission_id}:{revision}`** — this **amends FR-C-5's literal `submission_id`**. The same revision re-attempted is idempotent; a new revision is a distinct downstream operation. — **Reversibility:** one-way — the key is what downstream systems dedupe on; changing it later can create duplicate downstream records.
- **D-93:** An edit link is issued **from the per-app status/view surface, owner-only** (`real_user_id`), with a **live app-permission + `perm_version` re-check on access** mirroring the view link; it pre-fills from the **latest revision**; 4-hour TTL, consumes on submit (LNK-02). — **Reversibility:** costly — shares the view-link verifier and the confirmation/status surfaces.
- **D-94:** Revisions are **append-only immutable records** in a `submission_revisions` collection keyed by `{submission_id, revision}`; the submission document points to the latest. The outbox's `not_sent | sent_unconfirmed | confirmed` state is tracked **per revision**. — **Reversibility:** costly — the revision schema is the per-revision outbox unit and the status-page data source.
- **D-95:** A **consumed edit link submitted a second time returns the original confirmation** for the revision that consumed that `jti` — an idempotent replay, no new revision, no error, no duplicate record (SC#4). The consumed-token path **branches by link action**: `create` → *"already submitted"* (PRD §12.1 step 14); `edit` → replay. — **Reversibility:** costly — the consumed-link behaviour is user-visible and shared across both link types.

**Locked by requirement (recorded, not open)**
- **D-96:** The outbound state is **exactly** `not_sent | sent_unconfirmed | confirmed`, committed as `sent_unconfirmed` **before** the outbound call (DAT-06); the reconciliation job retries **only `not_sent`** and never auto-resents `sent_unconfirmed` (DAT-07). Connectors are **globally managed** and an app never owns a credential (CON-02); `app_id` is a first-class label on connector metrics (CON-06); a failed call retries with exponential backoff base 2 s, max 5 attempts, then DLQ (CON-03).

### the agent's Discretion
- **CON-10 transactional-outbox implementation** — Mongo change stream on the committed write vs an outbox collection polled by a BullMQ Job Scheduler. The guarantee (outbound never sent for a write that did not commit) is fixed; the mechanism is open.
- **CON-03 backoff/DLQ cadence** — the base 2 s / max 5 attempts budget is required; the scheduler mechanics and the reconciliation-job interval are discretionary.
- **CON-05/06 wiring** — per-connector-instance limiter over the hand-written `ThrottlerStorage` (D-8.2, STACK) and the `app_id` metric label (single OTel→Prometheus path, STACK §6).
- **DAT-03 field-mapping evaluation** — how `{{form.field}}` / `{{real_user.attribute}}` expressions are parsed and resolved, and where mapping errors are classified.
- **DLQ retention window, connector health-check cadence, stuck-`sent_unconfirmed` staleness handling, seed-file layout, metric naming, exact copy strings.**

### Deferred Ideas (OUT OF SCOPE)
- **Cross-app "My submissions" list** — deferred (D-80 chose per-app reuse of `query`); would require a second, small token contract outside the frozen read-link claim set.
- **User-facing "Retry now"** on a `partial` submission — excluded (D-81); retry is admin/DLQ-only.
- **Retry telemetry on the status page** (attempt count, next-retry time) — excluded (D-82).
- **Runtime `app rebind` CLI into the DB** — deferred (D-86 chose seed-file edit + audited reload).
- **Early authenticated admin HTTP surface (pull OIDC forward)** — deferred to Phase 6 (BLD-12).
- **Redmine contract detail** (field mapping values, idempotency-key support, error taxonomy) — routed to **required research** per the ROADMAP note, not decided here.
- **KMS vendor adapter + the W-24 envelope upgrade** — deferred and still blocking a *production* connector credential (D-87); unblocks when the deployment cloud is named.
- Reviewed Todos: none folded. Nothing else beyond the above — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DAT-01 | Each app selects one data mode: `internal`, `external`, or `hybrid` | Data-mode enum belongs on the app/registry record; drives whether the data router writes internally, enqueues externally, or both. See Architecture Patterns §"Data-mode routing". |
| DAT-03 | In `external` mode a submission is pushed through a referenced connector using `{{form.field}}` / `{{real_user.attribute}}` mapping | Template grammar + resolver design (Discretion). `{{real_user.attribute}}` resolves against `real_user_profiles` (Phase 2 D-44). See Architecture Patterns §"Field mapping". |
| DAT-04 | In `hybrid` mode the internal write is synchronous and must succeed for the submission to be confirmed | Internal write commits inside one Mongo transaction with the outbox record (CON-10); confirmation is emitted only after commit. |
| DAT-05 | In `hybrid` mode the external call is asynchronous through BullMQ, and an external failure leaves the submission in `partial` with a retry queued | Three-state outbound + BullMQ retry/backoff (CON-03). Status `partial` set from the outbound outcome projection. |
| DAT-06 | Outbound state is exactly `not_sent` \| `sent_unconfirmed` \| `confirmed`, committed as `sent_unconfirmed` **before** the outbound call | State machine design — see Architecture Patterns §"Three-state outbound". The pre-call commit is the load-bearing ordering. |
| DAT-07 | A reconciliation job retries only `not_sent`; nothing in `sent_unconfirmed` is ever auto-resent | Reconciliation sweep via BullMQ Job Scheduler over the outbox/`submission_revisions` `not_sent` set only. See Architecture Patterns §"Reconciliation". |
| DAT-14 | An end user can see the current status of their own submissions without asking in chat | Extends the Phase 4 read surface (`read.controller.ts` `query` action) — see D-80 and Code Examples. |
| CON-01 | A connector implements one common interface — `testConnection()`, `execute(operation, payload, context)`, `getCapabilities()` | Evolves `packages/contract/src/connector/connector.ts` (D-89). Boundary edge `connectors → contract` must be added (see Architecture Patterns §"Boundary change"). |
| CON-02 | Connector instances managed globally; an app references a connector and never owns its credentials | Global `connectors` collection + `connector_credentials` keyed by `credential_ref`; app holds only `connector_ref`. |
| CON-03 | Failed external call retries with exponential backoff (base 2 s, max 5 attempts) then routes to a DLQ | BullMQ per-job `{ attempts: 5, backoff: { type: 'exponential', delay: 2000 } }`; DLQ = terminal failed set surfaced by the CLI. |
| CON-04 | A DLQ item is viewable and manually retryable by a global admin | Operator CLI `dlq list` / `dlq retry` (D-83/D-84). |
| CON-05 | Rate limits enforced per connector instance, shared across every app referencing it | Per-connector limiter keyed on connector instance over the hand-written `ThrottlerStorage` (Discretion). See Architecture Patterns §"Rate limiting". |
| CON-06 | `app_id` is a first-class label on connector metrics | OTel instrument attribute `app_id` on the single `akane` meter (OBS-01/STACK §6). Adds the connector instrument names. |
| CON-07 | `credential_rejected` alerts separately from `endpoint_unreachable` | Redmine HTTP-status → error-taxonomy mapping (see Redmine Contract §). Distinct OTel counter attributes drive distinct alert rules. |
| CON-08 | Changing an app's `connector_ref` is a separately audited mutation | Seed-file edit + idempotent reload writes an AUD-01 before→after transition (D-86). |
| CON-09 | A Redmine connector (field mapping + error taxonomy) is the first and only v1 external integration | Generic REST core + thin Redmine adapter (D-90); contract below. |
| CON-10 | A hybrid submission's internal write commits through a transactional outbox | Mongo multi-document transaction (replica set) + outbox relay (Discretion). See Architecture Patterns §"Transactional outbox". |
| LNK-02 | An edit link loads repeatedly but consumes on submit, expiring after a configurable TTL (default 4 h) | `edit` action already in the frozen enum; consume-on-submit + idempotent replay (D-93/D-95). |
| OBS-04 | `submission_status{status="partial"}` is exported | New OTel counter/up-down-counter with `status` attribute registered in `business-metrics.ts`. |

> **Deferred, not in this phase:** DAT-13's App-Builder surface stays Phase 6 (contract half already shipped in Phase 1). FND-10 stays **Pending** (D-87). AUD-10 / DAT-13 contract-half notes remain as recorded in `REQUIREMENTS.md`.
</phase_requirements>

## Summary

Phase 5 is the system's hardest correctness surface: it must make an external write *land* without ever double-sending, and make a failure *visible* without ever lying about it. The work splits into four independent, well-understood mechanisms that already have verified scaffolding in the repo:

1. **A three-state outbound model** (`not_sent | sent_unconfirmed | confirmed`) committed as `sent_unconfirmed` *before* the outbound call. This is the DAT-06 ordering that makes the whole phase safe — the PRD cannot express the gap between "sent" and "confirmed", so the platform commits the ambiguous state first and reconciles only from the unambiguous one.
2. **A transactional outbox** (`hybrid` mode): the internal write and an outbox record commit together in one MongoDB transaction (CON-10), and a relay publishes to BullMQ. The two candidate relays — a Mongo change stream on the outbox collection vs a polled outbox collection driven by a BullMQ Job Scheduler — are both viable on the existing test harness (Mongo 8.0 starts as a replica set), and the mechanism is the agent's discretion.
3. **A global connector seam** with a generic REST transport core plus a thin Redmine adapter (D-89/D-90), a per-connector-instance rate limiter, and an error taxonomy that splits `credential_rejected` from `endpoint_unreachable` (CON-07).
4. **The status + edit surfaces**, which are extensions of the Phase 4 read surface — the per-app "My submissions" list reuses the frozen `query` action with a per-user saved query (D-80), and the edit link reuses the frozen `edit` action and the view-link verifier (D-93).

**The mandated Redmine research is resolved** (see the dedicated section): field mapping is a thin transformation into `POST /issues.json` with `Content-Type: application/json`; **Redmine exposes no idempotency-key header**, so the connector declares `supports_idempotency_key: false` and uses a **natural-key pre-check** via a Redmine custom field (`cf_<id>`) — which is exactly the path `ConnectorDescriptorSchema` already models. The taxonomy maps 401/403 → `credential_rejected`, 422/404-on-create → permanent, and 5xx/timeout/network → `endpoint_unreachable`; Redmine has **no built-in rate limiting and no 429**, so CON-05's limiter is entirely platform-side.

**Primary recommendation:** Implement the outbox as a **dedicated outbox collection polled by a BullMQ Job Scheduler** rather than a Mongo change stream for the v1 path. Rationale: it is re-drivable by construction (the same query drives automatic retry, reconciliation, and the DLQ CLI — SC#3's "same path" rule falls out for free), it survives restarts without a resume-token store, its at-least-once semantics are explicit rather than incidental, and the `not_sent`-only reconciliation requirement (DAT-07) is a plain query predicate. A change stream is a legitimate low-latency upgrade later, but it buys latency this phase does not need and adds a resume-token durability requirement (persist the token only *after* the side effect) that the polled design does not have. Either way the CON-10 guarantee — never send for a write that did not commit — is delivered by the **transaction**, not the relay.

### Key Findings (at a glance)

- **`connectors` cannot import `contract` today.** `tooling/boundaries.config.mjs` `ALLOWED_EDGES.connectors = ['platform','kernel']`. D-89 requires the `Connector` seam from `packages/contract`, so the plan **must add `'contract'` to that edge** (a one-line, reviewed boundary change) — otherwise the first connector file fails lint. `datarouter` and `submissions` also need review: `datarouter` may import `connectors` (good) but neither may import the other's new modules; the outbox repository must live so that `submissions` and the worker can both reach it without a forbidden edge.
- **The three-state model needs a per-revision home.** `Submission.status` is `completed | partial | failed | pending_external`; the outbound state is a *different* axis and must live per revision (D-94). Do not overload `Submission.status` with `not_sent|sent_unconfirmed|confirmed`.
- **`@formio/js` is referenced by `apps/renderer/src/read/view.browser.ts` but is not in any `package.json` and is not installed.** Phase 5 is where the renderer is extended (edit form) and made CSP-compliant (self-hosted, no CDN per UI-SPEC Known Drift). See Package Legitimacy Audit.
- **`ThrottlerStorageRedis` is a stub.** `apps/api/src/common/throttler/throttler-storage-redis.ts` is an in-memory `Map`, not Redis. CON-05's per-connector limiter will be the real implementation over the ioredis connection.
- **`connectors`, `datarouter` domain dirs are empty; `packages/cli/` is a stub** (`provision.ts` exports an empty function). The operator CLI (D-83) and both domain modules are net-new.
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Data-mode decision (`internal`/`external`/`hybrid`) | Domain: `datarouter` | — | Pure routing policy over the app's mode; no I/O of its own. |
| Internal write + outbox commit (CON-10) | Domain: `submissions` | Platform: `mongo` | The transaction spans the submission write and the outbox record; must be one driver session. |
| Outbox relay (publish to BullMQ) | Worker (`app-worker`) | Domain: `datarouter` | R1: only `app-worker` may import the outbound-adapter/bullmq-worker category. The relay runs in the consumer, never the receiver (PROJECT constraint). |
| Connector `execute()`/`testConnection()`/`getCapabilities()` | Domain: `connectors` (+ `connector-owner` category) | Platform: `crypto` | R2: only `connectors`/`crypto` may touch the KMS/JWT/crypto surface (credential decryption). |
| Redmine HTTP transport + mapping + taxonomy | Domain: `connectors` | Shared contract: `contract` | Generic core + thin adapter (D-90); the `Connector` interface is the published seam. |
| Per-connector-instance rate limit | Domain: `connectors` | Platform: queue/redis | Shared across every app referencing the connector; keyed on connector instance, backed by ioredis. |
| Retry / backoff / DLQ | Worker (`app-worker`) + platform queue | — | BullMQ owns retry (CON-03); connector does exactly one attempt. |
| Reconciliation sweep (DAT-07, `not_sent` only) | Scheduler (`app-scheduler`) registers the Job Scheduler | Worker consumes | Registration is idempotent `upsertJobScheduler`; the work runs in the consumer. |
| Outbound-state / revision persistence | Domain: `submissions` (data-access) | Platform: `mongo` | `submission_revisions` keyed `{submission_id, revision}`; R3 restricts the `mongodb` import to `platform/mongo` + `domain/**/data-access`. |
| Status surface (DAT-14) | API (`app-api`) via Phase 4 read module | Domain: `submissions`/`links`/`dsl` | Reuses the frozen `query` action; no new token claim or action. |
| Edit link issue + consume + replay (LNK-02/D-95) | API (`app-api`) via read module | Domain: `links` | Mirrors the view-link verifier; branch by link action on the consumed-token path. |
| Connector management CLI (D-83/D-86) | Operator CLI (`packages/cli`) | Domain: `connectors`/`registry`, `audit` | No admin HTTP surface in Phase 5; mirrors the D-31 seed loader. |
| Connector metrics + `submission_status` (OBS-04, CON-06) | Platform: `metrics` | Worker | Single OTel→Prometheus path; `app_id`/`status` are attributes, not new registries. |
| Credential storage/resolution (D-88) | Platform: `crypto` | Domain: `connectors` | Five-field AES-256-GCM envelope via `KeyProvider`; `LocalKeyProvider` + prod guard stay intact. |

## Standard Stack

Phase 5 introduces **no new server-side runtime dependency**. Every primitive it needs is already pinned in `package.json` and verified in `STACK.md`. The one renderer dependency (`@formio/js`) is already referenced by existing code but missing from the manifest.

### Core (all already installed — do not re-add)
| Library | Version (installed) | Purpose in Phase 5 | Provenance |
|---------|--------------------|--------------------|------------|
| `mongodb` (native driver) | 7.7.0 | Outbox transaction, `submission_revisions`, `connector_credentials`, `connectors` collections; change-stream API if chosen | `[VERIFIED: package.json:41]` (exact spec) + STACK §4.3 |
| `bullmq` | 6.3.11 | Delivery queue, exponential backoff, DLQ (failed set), Job Scheduler for reconciliation | `[VERIFIED: package.json:38]` + STACK §4.4 |
| `@nestjs/bullmq` | 12.0.0 | `InjectQueue` wiring, `getQueueToken` (already used in `scheduler/app.module.ts`) | `[VERIFIED: package.json:23]` |
| `ioredis` | 6.0.0 | Real `ThrottlerStorage` for the per-connector limiter (naive `Map` today) | `[VERIFIED: package.json:39]` |
| `zod` | ^4.6.5 | Connector config / field-mapping / taxonomy schemas in `packages/contract` | `[VERIFIED: package.json:45]` |
| `jose` | ^6.2.12 | Edit-link signing/verification (ES256) — reuses the read-link path | `[VERIFIED: package.json:40]` + R2 `crypto-owner` |
| `@opentelemetry/api` | 1.9.1 | Connector + `submission_status` instruments on the `akane` meter | `[VERIFIED: package.json:29]` + `business-metrics.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@testcontainers/mongodb` / `@testcontainers/redis` | 12.2.0 | Real Mongo 8.0 (replica set) + Redis 8.10 for the Nyquist integration tests | `[VERIFIED: package.json:50-51]`; harness in `tooling/containers.ts` |
| `@formio/js` | 5.6.1 | Editable FormIO form on the edit page (already imported by `apps/renderer/src/read/view.browser.ts:1`) | `[VERIFIED: npm view @formio/js version → 5.6.1; MIT; no postinstall]` — **add to the renderer manifest and self-host (no CDN)** |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Polled outbox collection (recommended) | Mongo change stream on the outbox/write | Lower latency, but at-least-once by resume token + a token-durability requirement; not needed at this phase's volume. Both are discretion; see Architecture Patterns §"Transactional outbox". |
| Hand-written JSONata/`jsonata` for mapping | Small purpose-built `{{...}}` resolver | `jsonata` (2.2.2) is already a sanctioned dependency (STACK §10.2) and could express mapping, but the `{{form.field}}` / `{{real_user.attribute}}` grammar is strictly narrower and security-relevant (template injection); a tiny resolver is less attack surface. See Don't Hand-Roll for the counter-argument. |
| Native `mongodb` driver change streams | — | Kept; requires the replica set the harness already provides. |

**Installation (renderer only — run in the renderer workspace once it exists; do not add to the root manifest if the renderer is a separate workspace):**
```bash
# The renderer already imports @formio/js but no manifest declares it.
npm install @formio/js@5.6.1 --workspace apps/renderer
```

**Version verification:**
```bash
npm view @formio/js version        # → 5.6.1  (verified this session)
npm view @formio/js license        # → MIT
npm view @formio/js scripts.postinstall   # → (empty)
```

## Package Legitimacy Audit

> Phase 5 installs exactly **one** package: `@formio/js` (renderer). Everything else is already in the tree.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@formio/js` | npm | package line since 4.x→5.x rename; **v5.6.1 published 2026-09-22** | ~52.9K/wk | github.com/formio/formio.js | **SUS** (`too-new` — publish recency) | **Flagged — planner must add `checkpoint:human-verify` before install.** |

**Seam verdict detail:** `gsd-tools query package-legitimacy check --ecosystem npm @formio/js` → `{"verdict":"SUS","reasons":["too-new"]}`.

**Assessment:** the `too-new` signal is triggered by the *latest patch* publish date (2026-09-22), not by the package's provenance. `@formio/js` is the current, official successor to `formiojs` 4.x (verified: MIT license, no `postinstall`, active source repo `formio/formio.js`, ~53K weekly downloads), and it is **already imported by shipped code** at `apps/renderer/src/read/view.browser.ts:1`. `STACK.md` §9.2/§14 records it as HIGH-confidence on packaging after direct tarball inspection (builder + renderer present, dual CJS/ESM, `dragula` dep). The residual risk is the documented **5.x migration risk** (STACK §9.3/§9.4, spike **S1**), not legitimacy. Per protocol a `SUS` verdict is kept but gated: the planner inserts a `checkpoint:human-verify` task before the install, and the install is coupled to resolving spike **S1** (Bootstrap-5 template port; `component.errors`, `EditGrid.validateRows`).

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `@formio/js` (planner inserts `checkpoint:human-verify` before the install; pair with spike S1).

*No package in this phase was discovered via WebSearch or training data alone; all are already-verified registry entries or the existing manifest.*

## Redmine Connector Contract (MANDATED RESEARCH)

The ROADMAP (`:198`) mandates contract research for Redmine: field mapping, idempotency-key support, and error taxonomy. Findings below; provenance tags reflect what was confirmed **this session** from authoritative sources.

### R1. Authentication & transport
- Auth via the **`X-Redmine-API-Key`** HTTP header (alternatives: `key` query param, or Basic). `[CITED: redmine.org/projects/redmine/wiki/Rest_api]` — verbatim: *"passed in as a "X-Redmine-API-Key" HTTP header (added in Redmine 1.1.0)"*.
- **`Enable REST API`** must be checked in `Administration → Settings → API`. `[CITED: Rest_api]`.
- Create issue requires **`Content-Type: application/json`** and `POST /issues.json` with body `{"issue": { ... }}`. `[CITED: Rest_api]` — *"the `Content-Type` of the request **MUST** be specified … for JSON content, it must be set to `Content-Type: application/json`."*
- Other documented headers: `X-Redmine-Switch-User` (admin impersonation; **412** if the login is inactive/absent), `X-Redmine-Nometa`. `[CITED: Rest_api]`.
- No auth-cookie/session path is needed; the transport core is stateless per call. Connector config: `base_url`, `credential_ref`, `timeout`, `retry`, rate limit (D-90).

### R2. Field mapping (create issue)
`POST /issues.json` accepts a hash of issue attributes. `[CITED: redmine.org/projects/redmine/wiki/Rest_Issues]`:

| Redmine attribute | Notes |
|---|---|
| `project_id` | numeric project **id** (not the identifier slug) |
| `tracker_id` | numeric |
| `status_id` | numeric |
| `priority_id` | numeric |
| `subject` | string (required) |
| `description` | string |
| `category_id` | numeric |
| `fixed_version_id` | numeric (Target Versions) |
| `assigned_to_id` | **ID only — "currently no mechanism to assign by name"** (so mapping by e-mail/name is not supported; the connector must resolve an id or reject) |
| `parent_issue_id` | numeric |
| `custom_fields` | `[{ "id": <cfid>, "value": <v> }]` |
| `watcher_user_ids` | array of numeric ids (since 2.3.0) |
| `is_private` | boolean |
| `estimated_hours` | number |

- **Custom fields** are read/written as `custom_fields: [{ "id": N, "value": "..." }]`; the `value` may be an array when the field is multiselect. `[CITED: Rest_api §Working with custom fields]`.
- **Custom-field filtering** for the natural-key pre-check: `GET /issues.json?cf_<id>=<value>` (substring: `cf_4=~foo`), and the field **must have "used as a filter" checked**. `[CITED: Rest_Issues]` — verbatim: *"`cf_x`: get issues with the given value for custom field with an ID of `x`. (Custom field must have 'used as a filter' checked.)"*.
- Response for a created issue is `201` with `{"issue": {"id": N, ...}}` — the `id` is the **downstream reference** shown to the user (D-82).
- **Create vs update:** `POST /issues.json` creates; `PUT /issues/[id].json` updates. D-91/D-92 ship **one new send per revision via `POST` (create)** — a revision is a new downstream operation, not an in-place correction. `[CITED: Rest_Issues]`.

### R3. Idempotency-key support — **NO native header**
- The official docs enumerate the request headers the API documents (`X-Redmine-API-Key`, `X-Redmine-Switch-User`, `X-Redmine-Nometa`, `Content-Type`) and describe no idempotency/deduplication header or mechanism. `[CITED: Rest_api]`.
- **This is an absence claim** (the doc's header list is not stated to be exhaustive). It is **not** `[VERIFIED]` and no falsification probe is possible without a live Redmine. → The connector declares **`supports_idempotency_key: false`** and uses the **natural-key pre-check**, which is exactly the path `ConnectorDescriptorSchema.supports_idempotency_key: false` describes (`packages/contract/src/connector/connector.ts:38-43`). `[ASSUMED — see A1]`.
- **D-92's consequence:** because there is no downstream dedupe key, the composite `{submission_id}:{revision}` is carried **as connector-owned correlation data** (e.g. a dedicated Redmine custom field value) so the adapter can *pre-check* before a re-send and reconcile an ambiguous timeout. A `sent_unconfirmed` revision is resolved by a **read** (`GET /issues.json?cf_<id>=<value>`), never by a blind `POST`. `[CITED: Rest_Issues]` for the `cf_` filter; the field-to-key binding is the adapter's design (D-90, Discretion).

### R4. HTTP-status → error taxonomy (CON-07 split)

| Redmine response | Taxonomy | Retry? | Evidence |
|---|---|---|---|
| **401 Unauthorized** (bad/absent credential) | `credential_rejected` | no | `[CITED: redmine.org/issues/32315]` — 4.1.0 returns 401 only when the credential is incorrect. |
| **403 Forbidden** (REST API disabled, **or** lacking permission) | `credential_rejected` | no | `[CITED: redmine.org/issues/30086]` — *"Use HTTP status code 403 instead of 401 when REST API is disabled"* (Redmine 4.1; `Changelog_4_1`). Both causes are credential/permission-owner-actionable → same bucket per CON-07. |
| **422 Unprocessable Entity** (validation/missing attribute) | `failed_permanent` | no | `[CITED: Rest_api §Validation errors]` — body `{"errors":[...]}`. |
| **404 Not Found on `POST /issues.json`** | `failed_permanent` | no | A missing required DB row (bad `project_id`/`tracker_id`/`status_id`). **NOT** `endpoint_unreachable` — a retry cannot fix it. `[ASSUMED — see A2]` (the semantic is Redmine-community-known; the docs do not state the create-time 404 explicitly). |
| **5xx** (500/502/503/504) | `endpoint_unreachable` | yes (backoff) | Transient server-side. |
| **Network error / timeout / connect refused** | `endpoint_unreachable` | yes (backoff) | Transport failure. |
| **406 Not Acceptable** | `failed_permanent` | no | Bad upload content type. `[CITED: Rest_api §Attaching files]`. |
| **412 Precondition Failed** (`X-Redmine-Switch-User` inactive) | `credential_rejected` | no | `[CITED: Rest_api §User Impersonation]`. |
| **No 429 / no core rate limiting** | n/a | n/a | `[CITED: redmine.org/issues/43881]` — *"No request rate limiting — There is no built-in protection against brute-force attacks on API keys or bulk data extraction."* → CON-05's limiter is **entirely platform-side**; the connector never needs to react to a downstream 429. |

**CON-07 alert separation:** the taxonomy code is an attribute on the connector OTel counter (single `akane` meter). `credential_rejected` and `endpoint_unreachable` become separate alert rules over that attribute — the split is data, not control flow.

### R5. Redmine versions (as of this session)
Current releases: **6.0.11 (2026-08-26)**, **6.1.5 (2026-09-30)**, **7.0.2 (2026-09-30)**; **7.1.0** adds `reactions`/`Documents` and changes attachment content-type detection (r24959). `[CITED: redmine.org/projects/redmine/wiki/Rest_api (latest-releases block) + Rest_Issues]`. The connector targets the stable `Rest_Issues` CRUD surface, which is unchanged across these lines.

### R6. Open item that research could **not** close
Real-Redmine behaviour of a **create-time 404** and the **exact status of a custom-field pre-check when the field lacks "used as a filter"** are community-known but not documented verbatim. Both are cheap to pin with a contract test against a real instance (see Validation Architecture Wave 0 / Open Questions). `[ASSUMED — A2]`.

## Architecture Patterns

### System Architecture Diagram

The phase's core flow is **submission → commit → relay → consume → downstream**, with the three-state outbound model wrapping the downstream call. Trace the primary `hybrid` use case top-to-bottom; the `internal` path stops at the transaction, and the `external` path skips the internal write.

```
                       IM webhook (Slack/Teams/Zalo/Telegram)
                                    │  ack <200 ms, enqueue only (PROJECT)
                                    ▼
                     ┌──────────────────────────────┐
   INGEST ──────────▶│  BullMQ ingest queue          │
                     └──────────────┬───────────────┘
                                    ▼
                     ┌──────────────────────────────┐
   CONSUMER ────────▶│ identity → RBAC → JEV route   │  (Phases 2–4, done)
                     └──────────────┬───────────────┘
                                    ▼
                   form submitted → data router (DAT-01 mode)
                                    │
              ┌─────────────────────┼──────────────────────┐
              │ internal            │ hybrid               │ external
              ▼                     ▼                      ▼
    ┌───────────────────┐  ┌──────────────────────────────────────┐
    │ internal write     │  │ ONE Mongo transaction (CON-10):       │
    │ (synchronous)      │  │   • submission_revision{revision,     │
    │                    │  │       outbound:'not_sent'}            │
    │                    │  │   • outbox{cursor, revision,          │
    │                    │  │       connector_ref, payload}         │
    └─────────┬─────────┘  └──────────────────┬───────────────────┘
              │                               │ commit → 201/202
              │                               ▼
              │                 ┌──────────────────────────────┐
              │                 │ OUTBOX RELAY (worker):        │
              │                 │  poll outbox where not yet    │
              │                 │  published → add delivery job  │
              │                 │  (jobId = submission:revision) │
              │                 └──────────────┬───────────────┘
              │                                ▼
              │                 ┌──────────────────────────────┐
              │                 │ DELIVERY QUEUE (BullMQ)       │
              │                 │  attempts:5 backoff:exp 2s    │
              │                 └──────────────┬───────────────┘
              │                                ▼
              │                 ┌──────────────────────────────────────────┐
              │   CONNECTOR ───▶│ connector consumer (worker):              │
              │   CONSUMER      │  1. resolve credential_ref (crypto)       │
              │                 │  2. rate limit (per connector instance)    │
              │                 │  3. commit outbound='sent_unconfirmed' ◀──┐│
              │                 │  4. adapter.execute(operation,payload,ctx) ││
              │                 └──────────────┬─────────────────────────────┘│
              │                                ▼                             │
              │                 ┌──────────────────────────────┐            │
              │                 │ generic REST core → Redmine    │            │
              │                 │ POST /issues.json (X-API-Key)  │            │
              │                 └──────┬──────────────┬─────────┘            │
              │                        │ 2xx          │ 4xx/5xx/error        │
              │                        ▼              ▼                     │
              │          ┌──────────────────┐  ┌───────────────────────┐   │
              │          │ confirmed        │  │ map status→taxonomy   │   │
              │          │ (+ ref id)       │  │ permanent→DLQ         │   │
              │          └──────────────────┘  │ retryable→backoff ────┘   │
              │                                │ credential_rejected       │
              │                                │   vs endpoint_unreachable │
              │                                └────────────┬──────────────┘
              │                                             ▼
              │                        ┌──────────────────────────────┐
              │                        │ DLQ (terminal failed set)     │
              │                        │  CLI: dlq list / dlq retry    │
              │                        └──────────────────────────────┘
              ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ RECONCILIATION (scheduler registers Job Scheduler;               │
   │ worker consumes): sweep submission_revisions where               │
   │ outbound='not_sent' → re-enqueue through the SAME outbox path.   │
   │ NEVER touches 'sent_unconfirmed' (DAT-07).                       │
   └──────────────────────────────────────────────────────────────────┘

   STATUS / EDIT surfaces extend Phase 4 read module:
     GET /l/query/:jti   (frozen 'query' action, per-user saved query)  → My submissions
     POST edit-link issue (frozen 'edit' action, owner-only, 4h TTL)     → pre-fill latest revision
```

**Reading the diagram:** the transaction boundary (CON-10) is the vertical join between "internal write" and "outbox record" — they commit or roll back together. The `sent_unconfirmed` commit *before* the downstream call is the loop marked `◀──`; it is the single ordering that makes a crash between steps recoverable without a double-send (DAT-06). The reconciliation sweep and the DLQ CLI both re-enter through the *same* authenticated publish path (SC#3), so there is exactly one code path that ever calls a downstream system.

### Recommended Project Structure

Net-new directories (existing dirs are noted where a module is *extended*, not created):

```
packages/
├── contract/src/connector/
│   └── connector.ts                 # EVOLVE (D-89): Connector full shape; add descriptor/capabilities
├── domain/src/
│   ├── connectors/                  # NEW (currently empty)
│   │   ├── rest-core.ts             # generic HTTP transport (undici): base_url, timeout, retry
│   │   ├── redmine.adapter.ts       # thin adapter: paths, field mapping, status→taxonomy
│   │   ├── connector.registry.ts    # resolves connector_ref → adapter + descriptor
│   │   ├── connector-credentials.repository.ts   # data-access: connector_credentials
│   │   ├── outbound-state.repository.ts          # data-access: submission_revisions outbound state
│   │   └── connectors.module.ts
│   ├── datarouter/                  # NEW (currently empty)
│   │   ├── data-router.service.ts   # DAT-01 mode decision; owns the CON-10 transaction
│   │   ├── outbox.repository.ts     # data-access: outbox collection (insert in txn; poll; mark published)
│   │   └── datarouter.module.ts
│   └── submissions/                 # EXTEND
│       └── submission-revisions.repository.ts    # append-only {submission_id, revision} (D-94)
├── cli/                             # EXTEND (currently a stub: provision.ts is empty)
│   ├── connector.ts                 # connector upsert from committed files (D-83)
│   ├── dlq.ts                       # dlq list / dlq retry [--force] (D-83/D-84/D-85)
│   └── rebind.ts                    # connector_ref rebind + AUD-01 before→after (D-86)
apps/
├── worker/src/processors/
│   ├── outbox-relay.processor.ts    # poll outbox → enqueue delivery job
│   └── connector-delivery.processor.ts   # the outbound consumer (via WORKER_CONSUMERS)
└── scheduler/src/
    └── reconciliation.registration.ts     # upsertJobScheduler for the not_sent sweep
apps/api/src/
├── read/                            # EXTEND: status endpoint, edit issuance (frozen actions)
└── common/throttler/
    └── throttler-storage-redis.ts   # REPLACE stub Map with real ioredis ThrottlerStorage
config/connectors/
└── redmine.<env>.json               # committed connector definitions + credential_ref (seeds)
```

### Pattern 1: Transactional outbox (CON-10) — polled, not change-stream

**What:** The internal write and an outbox record are written in **one** MongoDB transaction. A relay polls un-published outbox rows and enqueues delivery jobs. A crash after commit but before publish loses nothing — the next poll picks the row up.

**When to use:** The `hybrid` (and `external`) data modes. The guarantee is: *no outbound call is ever made for a write that did not commit.*

**Why a polled collection over a change stream (recommendation):**
- **Re-drivable by construction.** Automatic retry (CON-03), reconciliation (DAT-07), and the DLQ CLI (D-84) can all re-drive the *same* outbox row. SC#3's "same path" rule is a query predicate, not a second mechanism.
- **No resume-token durability requirement.** A change stream is at-least-once only if you persist the resume token *after* the durable side effect; get that ordering wrong and you can drop or duplicate. The polled design has no token to lose.
- **`not_sent`-only reconciliation is a plain query** (`{ 'outbound': 'not_sent' }`), which is exactly DAT-07's predicate.
- Change streams remain a legitimate **later** low-latency upgrade; they buy latency this phase does not need.

**Example (skeleton — the transaction is the point):**
```typescript
// packages/domain/src/datarouter/data-router.service.ts  (Discretion: exact shape)
// Source: CON-10 (D-96) + MongoDB manual, "Transactions" (replica-set requirement).
import type { MongoService } from '@akane/platform';

async function commitHybridSubmission(sub: SubmissionDraft) {
  const session = mongo.startSession();
  try {
    let revision: SubmissionRevision | undefined;
    await session.withTransaction(async () => {
      // 1. append-only revision, outbound starts unambiguous (D-94/DAT-06)
      revision = await submissionRevisions.insert(
        { ...sub, outbound: 'not_sent' as const },
        { session },
      );
      // 2. the outbox row commits with it — or neither commits (CON-10)
      await outbox.insert(
        { revisionRef: { submission_id: sub.submission_id, revision: revision.revision },
          connectorRef: sub.connector_ref, payload: buildPayload(sub), published: false },
        { session },
      );
    });
    return revision!;   // caller returns 201/202 only after this resolves
  } finally {
    await session.endSession();
  }
}
```
> The MongoDB transaction requires a **replica set**; the test harness starts Mongo 8.0 with `--replSet rs0` + `directConnection=true` (`tooling/containers.ts`). Production uses the 3-node replica set NFR-A-4 already specifies.

### Pattern 2: Three-state outbound (DAT-06) — commit the ambiguous state first

**What:** `not_sent | sent_unconfirmed | confirmed` is stored **per revision**. `sent_unconfirmed` is committed **before** the HTTP call; on a 2xx the record advances to `confirmed` with the downstream reference; on a terminal error it stays `sent_unconfirmed` (or moves to a DLQ marker) and is **never auto-resent**.

**When to use:** Every outbound call. This is the phase's correctness core.

**Why it matters:** HTTP has no "sent exactly once" primitive. If you wrote `sent` only after a 2xx you would, on a crash mid-call, have no record that a request may have reached Redmine — and the retry would double-send. By committing the ambiguous state *first*, a crash leaves a `sent_unconfirmed` record that reconciliation deliberately **does not** retry (DAT-07); a human resolves it via the natural-key pre-check (D-84 `--force`).

### Pattern 3: Reconciliation sweep (DAT-07) — `not_sent` only

**What:** A BullMQ **Job Scheduler** (not `Queue.add({repeat})` — removed in BullMQ 6) periodically enqueues a reconciliation job. The job queries `submission_revisions` for `outbound = 'not_sent'` and re-publishes each through the outbox path.

**When to use:** Always-on, interval is Discretion (start modest, e.g. 1–5 min; measure).

**Example (registration mirrors the existing `platform-heartbeat` pattern):**
```typescript
// apps/scheduler/src/reconciliation.registration.ts  — mirror of registerPlatformHeartbeat
// Source: apps/scheduler/src/app.module.ts (existing) + packages/platform/src/queue/job-scheduler.ts
await upsertJobScheduler(queue, 'reconcile-outbound', {
  every: RECONCILE_INTERVAL_MS,          // Discretion — measure, do not guess
  // job template → worker's reconciliation consumer
});
```
> BullMQ 6: `Queue.add({ repeat })` / `getRepeatableJobs()` are gone; use Job Schedulers (`upsertJobScheduler`). `Queue.resume()` is **async** — await it.

### Pattern 4: Field mapping (DAT-03) — narrow template grammar

**What:** `{{form.field}}` and `{{real_user.attribute}}` expressions are resolved against the form submission payload and the `real_user_profiles` record, then shaped into the Redmine issue hash (R2). Unresolved/empty values are classified as a **permanent mapping error** (DLQ), not a transport failure.

**When to use:** Every `external`/`hybrid` send.

**Discretion:** whether to build a tiny parser or use `jsonata` (already a sanctioned dep, STACK §10.2). Recommendation: a **purpose-built resolver** — the grammar is strictly narrower than JSONata and template injection is a real risk (see Don't Hand-Roll).

### Pattern 5: Rate limiting (CON-05) — per connector *instance*, shared across apps

**What:** A limiter keyed on the **connector instance** (not the app, not the user) so every app referencing a connector shares one budget. Backed by the real ioredis connection via a `ThrottlerStorage`.

**When to use:** Every connector instance; the published NFR-SEC-6 per-user/per-app limits stay at the API tier, this one is connector-scoped.

**Status:** `apps/api/src/common/throttler/throttler-storage-redis.ts` is **an in-memory `Map`, not Redis** — it does not work across the `api`/`worker` processes. CON-05 must replace it with a real Redis-backed `ThrottlerStorage` (discretion: reuse the hand-written D-8.2 approach over the ioredis connection; both community storages are dead, see STACK §8.2).

### Pattern 6: Boundary change (REQUIRED before the first connector file)

**What:** `tooling/boundaries.config.mjs` defines `ALLOWED_EDGES.connectors = ['platform', 'kernel']`. D-89 requires the `Connector` seam from `packages/contract`, so **`'contract'` must be added to that edge** or the first connector file fails `eslint-plugin-boundaries`.

**Also verify:** `datarouter` may import `connectors` (needed to resolve the adapter) but must not import `contract`/`submissions`/`dsl`; `submissions` must not import `connectors`/`datarouter`. Place the outbox repository in `datarouter` and the revision repository in `submissions` so both the worker and the router reach them without a forbidden edge. R3 already restricts the `mongodb` import to `packages/platform/src/mongo/**` and `packages/domain/src/**/data-access/**` — the new repositories must live under a `data-access/` dir.

### Anti-Patterns to Avoid

- **Overloading `Submission.status`** with `not_sent|sent_unconfirmed|confirmed`. Those are a *different axis*; the status enum is `completed | partial | failed | pending_external`. Outbound state lives per revision (D-94).
- **Publishing to BullMQ inside the webhook receiver.** The receiver acks <200 ms and enqueues only (PROJECT). All logic, including the outbox relay, runs in a consumer.
- **Writing the outbox row outside the transaction.** That is exactly the gap CON-10 closes — a write can commit and the outbox row can be lost (or vice-versa).
- **Blind `POST` on a `sent_unconfirmed` revision.** Never resend without the DAT-13 natural-key pre-check (D-84 `--force` path).
- **Putting the limiter key on `app_id` or the user.** CON-05 is per *connector instance*; keying it per app defeats "shared across every app referencing it".
- **Treating a create-time 404 as `endpoint_unreachable`.** A missing `project_id`/`tracker_id` row does not heal with retries — it is permanent (`failed_permanent`).
- **Adding a CDN `<script>` for FormIO.** UI-SPEC Known Drift requires self-hosting (`@formio/js` bundled from npm); a third-party CDN breaks NFR-SEC-3 and adds an availability dependency.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| At-least-once delivery with retry/backoff and a terminal DLQ | A bespoke retry loop over `setTimeout` / an in-process queue | **BullMQ 6** `{ attempts, backoff: { type: 'exponential', delay: 2000 }, removeOnFail: false }` + the failed set as the DLQ | Retry state must survive process restarts; BullMQ already provides exponential backoff, DLQ retention, and the Job Scheduler. Hand-rolled in-memory retry dies on redeploy — a security/financial failure for outbound writes. |
| Multi-document atomicity (write + outbox) | Compensating writes / "write then mark published" without a transaction | **MongoDB multi-document transaction** via `session.withTransaction` | CON-10's guarantee *is* atomicity; anything less re-opens the crash window the outbox exists to close. |
| One-time-token atomic consume (edit link) | A read-then-delete pair | **Redis `GETDEL`** (≥6.2.0, verified STACK §4.4) | Read-then-delete races under concurrency; `GETDEL` is atomic. Already the pattern for create links. |
| Per-connector rate limiting | A new rate-limit library / another Redis client | The **hand-written `ThrottlerStorage`** over the existing ioredis connection (STACK §8.2) | Both community Redis storages are unusable (405/unpublished; peers NestJS ≤11; or peers node-redis). One client type across app + workers. |
| Credential encryption | A bespoke cipher / storing plaintext | The **five-field AES-256-GCM envelope** via `KeyProvider` (`packages/platform/src/crypto`) | Nonce reuse and auth-tag handling are the classic failure modes; the envelope already enforces both. |
| JWT/link signing with key rotation | A hand-rolled `kid` resolver over `jsonwebtoken` | **`jose`** keyResolver (already the read-link path) | NFR-SEC-9 rotation already works through `jose`; reusing it for edit links needs no new primitive. |
| Template expression evaluation over arbitrary JSON | `eval` / `new Function` / a general expression engine | A **narrow `{{...}}` resolver** (or `jsonata` with a fixed grammar) | Arbitrary evaluation is template injection; the `{{form.field}}` grammar does not need Turing-completeness. |

**Key insight:** Every deceptively-hard problem in this phase (retry durability, transaction atomicity, atomic token consume, credential crypto, rate-limit storage) already has a sanctioned, verified primitive in the tree. The phase's job is **wiring and ordering**, not invention — the biggest risk is a plausible-looking custom loop that silently loses the exactly-once/at-least-once property.

## Common Pitfalls

### Pitfall 1: The pre-call commit is written *after* the HTTP call
**What goes wrong:** A crash or timeout between the call and the commit leaves no `sent_unconfirmed` record; reconciliation sees `not_sent` and re-sends → duplicate downstream issue.
**Why it happens:** It is natural to write "success" only after a success. DAT-06 inverts the instinct.
**How to avoid:** Commit `sent_unconfirmed` inside a step that *precedes* the transport call; treat a 2xx as advancing that record to `confirmed`. The pre-call commit is the load-bearing ordering.
**Warning signs:** Any code path where a 2xx response can arrive before the state write; a retry that does not read outbound state first.

### Pitfall 2: Reconciliation retries `sent_unconfirmed`
**What goes wrong:** A timed-out call that *did* reach Redmine is retried → duplicate issue.
**Why it happens:** "It didn't confirm, so retry" is intuitive and wrong.
**How to avoid:** Reconciliation's predicate is **`outbound = 'not_sent'` only** (DAT-07). A `sent_unconfirmed` item moves through the human `--force` path, which runs the natural-key pre-check first (D-84).
**Warning signs:** A reconciliation query that filters on "anything not confirmed"; a `sent_unconfirmed` row auto-transitioning to `not_sent`.

### Pitfall 3: `ThrottlerStorageRedis` looks done but is an in-memory Map
**What goes wrong:** CON-05's limiter passes a single-process test but does nothing in production, where `api` and `worker` are separate processes.
**Why it happens:** The class name is convincing; the stub is a `Map`.
**How to avoid:** Replace it with a real Redis-backed `ThrottlerStorage` over the ioredis connection; test it with Testcontainers (real Redis) across two client instances.
**Warning signs:** A limiter test that never touches Redis; limits that hold at `concurrency=1` but not at `concurrency=2`.

### Pitfall 4: BullMQ 6 API drift (`repeat`, `resume`)
**What goes wrong:** Reconciliation registration silently no-ops or throws on an API that was removed.
**Why it happens:** Examples online are BullMQ ≤5.
**How to avoid:** Use `upsertJobScheduler` (idempotent); `await` `resume()`. Mirror the existing `registerPlatformHeartbeat` helper (`packages/platform/src/queue/job-scheduler.ts`).
**Warning signs:** `getRepeatableJobs is not a function`; a scheduler job that fires once and never again.

### Pitfall 5: Field-mapping failure classified as transport-retryable
**What goes wrong:** A missing/empty mapped value (e.g. `subject` resolves to empty, a numeric `project_id` is non-numeric) retries 5× then lands in the DLQ as if the endpoint were down — and populates the wrong alert.
**Why it happens:** The mapping step and the HTTP step are conflated.
**How to avoid:** Classify mapping errors as `failed_permanent` (DLQ) *before* the transport attempt; the retry budget is for transport failures only.
**Warning signs:** `endpoint_unreachable` alerts for a payload-shape problem; retries that re-send an identical, deterministic 422.

### Pitfall 6: Credential-rejected and endpoint-unreachable collapse into one alert
**What goes wrong:** CON-07 fails — operators cannot tell "the key is wrong" from "Redmine is down", so a bad credential pages a network team for a week.
**Why it happens:** Both are "the call failed".
**How to avoid:** Keep the taxonomy code as a distinct attribute on the connector counter; two alert rules. 401/403/412 → `credential_rejected` (no retry); 5xx/timeout/network → `endpoint_unreachable` (retry).
**Warning signs:** One alert fires for both; a `credential_rejected` item burning the 5-attempt budget.

### Pitfall 7: Change stream used without a replica set (if the discretion picks it)
**What goes wrong:** `streaming` errors on a standalone Mongo.
**Why it happens:** Change streams require a replica set or sharded cluster.
**How to avoid:** The harness already starts `rs0`; production uses the 3-node set. If chosen, persist the resume token **only after** the durable side effect.
**Warning signs:** `The $changeStream stage is only supported on replica sets`; duplicate publishes after a restart.

## Code Examples

### Three-state outbound around one transport call
```typescript
// apps/worker/src/processors/connector-delivery.processor.ts  (Discretion: exact shape)
// Source: DAT-06/D-96 (state enum), CON-03 (retry), D-89 connector seam.
import { Connector } from '@akane/contract';

async function deliver(job: DeliveryJob) {
  const { submission_id, revision } = job.data;
  const rec = await submissionRevisions.find({ submission_id, revision });
  if (rec.outbound !== 'not_sent') return;             // DAT-07: never auto-resend

  // (a) commit the ambiguous state BEFORE the call (DAT-06)
  await submissionRevisions.update(
    { submission_id, revision },
    { $set: { outbound: 'sent_unconfirmed' } },
  );

  try {
    // (b) exactly one attempt; BullMQ owns retries
    const outcome = await connector.execute(rec.operation, buildPayload(rec), {
      idempotencyKey: `${submission_id}:${revision}`,   // D-92 composite
      correlationField: redmineCorrelationField,        // natural-key pre-check handle
    });
    if (outcome.status === 'ok') {
      await submissionRevisions.update(
        { submission_id, revision },
        { $set: { outbound: 'confirmed', downstreamRef: outcome.reference } },
      );
    }
  } catch {
    // leave the ambiguity in place; a terminal failure routes to the DLQ
  }
}
```
> The `if (rec.outbound !== 'not_sent') return;` guard is what makes a re-delivered BullMQ job safe; combined with the composite key it is the per-revision idempotency guarantee.

### Redmine create via the generic REST core
```typescript
// packages/domain/src/connectors/redmine.adapter.ts  (thin adapter, D-90)
// Source: R1/R2 — POST /issues.json, Content-Type: application/json, {"issue": {...}}
const resp = await core.request({
  method: 'POST',
  url: `${baseUrl}/issues.json`,
  headers: { 'Content-Type': 'application/json' },   // R1: MUST be application/json
  credential: { header: 'X-Redmine-API-Key', value: decryptedKey },
  body: { issue: mappedIssueHash },                  // R2 attribute set
});
// 201 → { issue: { id } } → downstreamRef (D-82)
```

### Natural-key pre-check (DAT-13) before any force-resend
```typescript
// GET /issues.json?cf_<id>=<correlationValue>  (R2/R3; field needs "used as a filter")
const found = await core.request({
  method: 'GET',
  url: `${baseUrl}/issues.json`,
  credential: { header: 'X-Redmine-API-Key', value: decryptedKey },
  query: { [`cf_${correlationCfId}`]: `${submission_id}:${revision}` },
});
// found.issues.length > 0 → already landed → mark confirmed; else safe to (re)send
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Queue.add({ repeat })` / `getRepeatableJobs()` | **Job Schedulers** (`upsertJobScheduler`) | BullMQ 6 | Reconciliation must register via Job Schedulers; `Queue.resume()` is now async. |
| In-process / `setTimeout` retry loops | **Durable queue retry** with backoff + failed set | BullMQ | Retries survive redeploy; the DLQ is the failed set, not a bespoke table. |
| Polling a status column on the primary document | **Outbox / revision-per-record projection** | — | The outbound state is per revision; the submission points to the latest (D-94). |
| Hand-rolled JWT with `jsonwebtoken` | **`jose` keyResolver** | Phase 1 (STACK §5) | Rotation and the edit-link signing reuse the read-link path. |

**Deprecated/outdated:**
- `formiojs` 4.x — official maintenance mode; Phase 5 uses `@formio/js` 5.x (STACK §9.2).
- Community Redis throttler storages — both dead (`405`/unpublished; peers NestJS ≤11). Hand-write it (STACK §8.2).
- `Queue.add({ repeat })`, `getRepeatableJobs()` — removed in BullMQ 6.

## Assumptions Log

> Claims tagged `[ASSUMED]` in this research. Each needs user/plan acknowledgement — they are not locked facts.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| **A1** | **Redmine exposes no idempotency-key header or dedupe mechanism**, so the connector declares `supports_idempotency_key: false` and relies on a **natural-key pre-check**. | Redmine Contract §R3; Standard Stack | If Redmine *does* offer an idempotent write (undocumented), the platform-side pre-check is redundant but still correct (the pre-check finds the prior issue). Risk is *extra* correlation-field usage, not double-send. **Governed absence** (the docs' header list is not stated exhaustive) → cannot earn `[VERIFIED]`. |
| **A2** | **A create-time `404` on `POST /issues.json` is `failed_permanent`** (missing required DB row), **and** a custom field used for the pre-check must have *"used as a filter"* enabled or the `cf_<id>` query silently ignores it. | Redmine Contract §R4/§R6; Open Questions Q7 | If the 404 semantic differs (e.g. routing-level 404), a permanent-failure classification could drop a retriable case. If the pre-check field is unfilterable, DAT-13's safety net is inert. Both are cheap to pin with a contract test against a real instance (Wave 0). |
| **A3** | **The polled-outbox mechanism meets CON-10 without a change stream** at this phase's volume/intervals. | Summary; Architecture Patterns §Pattern 1 | Latency and relay cadence are bounded by the poll interval; if set too coarse, `not_sent` items wait longer than desired. Tunable, not a correctness risk. **Discretion** (CON-10). |
| **A4** | **`@formio/js` 5.x is the correct renderer dependency**, gated behind spike S1 for the 5.x migration risk. | Package Legitimacy Audit; Standard Stack | Seam rates it `SUS` (`too-new`). If S1 shows the migration is ugly, the sanctioned fallback is `formiojs@4.21.7` (MIT, maintenance mode) — an explicit decision, not a drift. |

**If this table were empty:** it is not — A1/A2 are genuine absence-claims that cannot be falsified without a live Redmine, and A3/A4 are discretion-derived recommendations.

## Open Questions (RESOLVED)

Each item below is either resolved in this research or explicitly carried as an assumption requiring confirmation. No item is left silently open.

1. **CON-10 outbox mechanism — change stream or polled outbox?** — **RESOLVED (recommendation).** Polled outbox collection driven by a BullMQ Job Scheduler. Both are viable; the polled design is re-drivable, survives restarts without a resume token, and makes DAT-07's `not_sent`-only predicate a plain query (SC#3's "same path" falls out). A change stream is a later low-latency upgrade. Discretion (CON-10).
2. **CON-03 reconciliation/scheduler mechanics & interval** — **RESOLVED (mechanism) / assumption (interval).** Registration via idempotent `upsertJobScheduler` mirroring `registerPlatformHeartbeat`; the interval is Discretion and must be **measured** (start ~1–5 min). See Environment Availability.
3. **CON-05 rate limiter wiring** — **RESOLVED.** Replace the in-memory `ThrottlerStorageRedis` with a real Redis-backed `ThrottlerStorage` over the ioredis connection; key on the connector instance. See Anti-Patterns and STACK §8.2.
4. **CON-06 `app_id` metric label** — **RESOLVED.** Add `app_id` as an OTel instrument **attribute** on the single `akane` meter (`packages/platform/src/metrics/business-metrics.ts`); no new meter/registry.
5. **OBS-04 `submission_status{status="partial"}`** — **RESOLVED.** New counter/up-down-counter with a `status` attribute on the same meter, registered beside the existing business metrics.
6. **DAT-03 template parse/resolve** — **RESOLVED (recommendation).** A purpose-built `{{form.field}}` / `{{real_user.attribute}}` resolver; mapping errors classify as `failed_permanent` before transport. See Don't Hand-Roll.
7. **Redmine create-time 404 semantics + `cf_` "used as a filter" requirement** — **UNRESOLVED — carried as assumption A2.** The docs state neither explicitly; pin with a contract test against a real instance (Wave 0). Falsification requires a live Redmine, unavailable here.
8. **Error-taxonomy → user-facing copy** — **UNRESOLVED in UI-SPEC (⚠).** UI-SPEC marks the taxonomy-to-copy table unresolved; this research supplies the **taxonomy codes** (R4) but the exact strings are Discretion/copy → resolve at plan time (a `checkpoint:human-verify` or a copy task). D-82 requires *user-safe* reasons mapped from the taxonomy.
9. **DLQ retention window, health-check cadence, stuck-`sent_unconfirmed` staleness, seed-file layout, metric naming** — **RESOLVED (Discretion, explicitly deferred to planning).** Recommendation: default DLQ retention to a bounded window serviced by the reconciliation sweep; `sent_unconfirmed` staleness surfaces in `dlq list` (count + age) rather than an auto-reaper; connector seed files live under `config/connectors/*.json` (mirroring the D-31 seed model).

## Environment Availability

> Probed this session on the build machine; phases that depend on external tools document availability so a plan can include fallbacks.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime floor | ✓ | 24.x (`.nvmrc`) | — |
| npm workspaces | Monorepo install | ✓ | (repo uses `workspaces`) | — |
| Docker (for Testcontainers) | Integration tests (Mongo 8.0 replica set, Redis 8.10) | ✓ (repo already ships an integration harness) | harness in `tooling/containers.ts` | Documented skip path for unit-only CI |
| MongoDB 8.0 | Outbox transaction, change streams | ✓ via Testcontainers (`--replSet rs0`, `directConnection=true`) | 8.0.x | — |
| Redis 8.10 | BullMQ, `GETDEL`, real throttler storage | ✓ via Testcontainers (`cache` allkeys-lru / `queue` noeviction) | 8.10.x | — |
| Live Redmine instance | Pinning A2 (create-time 404; `cf_` filter) | ✗ | — | **None** — carried as assumption A2; resolve with a contract test against a real instance, or accept A2 as documented. |
| KMS provider | Production connector credential | ✗ (by design, D-87) | — | `LocalKeyProvider` for local/test only; prod guard refuses to boot without `CRYPTO_KEY_PROVIDER=kms`. |

**Missing dependencies with no fallback:**
- **Live Redmine instance** — blocks only the *verification* of A2, not the implementation. The connector ships with the documented mapping; A2's two sub-claims are pinned by a Wave-0 contract test when an instance is available.

**Missing dependencies with fallback:**
- **KMS provider** — deliberately deferred (D-87); `LocalKeyProvider` + prod guard is the sanctioned path. Storing a *production* credential stays blocked.

## Validation Architecture

> `workflow.nyquist_validation: true` (`.planning/config.json`). Framework: **Vitest** (`vitest.config.mts`). Substrate: **Testcontainers** — real MongoDB 8.0 replica set + Redis 8.10 via `tooling/containers.ts` `startThreeContainers()`. Mocks are explicitly insufficient here: `GETDEL` atomicity, BullMQ retry/DLQ, and multi-document transactions are Redis/Mongo-semantics-dependent (STACK §10.1).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.3 |
| Config file | `vitest.config.mts` (`include: packages/**/*.spec.ts`, `apps/**/*.spec.ts`, `tooling/**/*.spec.ts`; `setupFiles: ./test/setup-env.ts`; timeouts 30 s) |
| Quick run command | `npx vitest run <file>` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CON-10 / DAT-04 | Internal write + outbox row commit together; a rollback leaves neither | integration | `npx vitest run packages/domain/src/datarouter/outbox.integration.spec.ts -t "transaction atomicity"` | ❌ Wave 0 |
| DAT-06 | Outbound state committed as `sent_unconfirmed` **before** the transport call | integration | `npx vitest run apps/worker/src/processors/connector-delivery.integration.spec.ts -t "pre-call commit"` | ❌ Wave 0 |
| DAT-07 | Reconciliation retries only `not_sent`; `sent_unconfirmed` never auto-resent | integration | `npx vitest run apps/worker/src/processors/reconciliation.integration.spec.ts -t "not_sent only"` | ❌ Wave 0 |
| D-92 / DAT-13 | Same `{submission_id}:{revision}` re-delivered is idempotent (guard short-circuits) | unit | `npx vitest run apps/worker/src/processors/connector-delivery.spec.ts -t "per-revision idempotency"` | ❌ Wave 0 |
| CON-03 | Exponential backoff base 2 s, max 5 attempts, then terminal failed set (DLQ) | integration | `npx vitest run apps/worker/src/processors/connector-delivery.integration.spec.ts -t "backoff dlq"` | ❌ Wave 0 |
| CON-05 | Per-connector-instance limit shared across two apps; real Redis storage | integration | `npx vitest run packages/domain/src/connectors/rate-limit.integration.spec.ts -t "shared connector budget"` | ❌ Wave 0 |
| CON-07 | 401/403/412 → `credential_rejected`; 5xx/timeout/network → `endpoint_unreachable`; distinct alert attributes | unit + integration | `npx vitest run packages/domain/src/connectors/redmine-taxonomy.spec.ts` | ❌ Wave 0 |
| CON-09 / A2 | Redmine create maps fields correctly; create-time 404 → permanent; `cf_` pre-check | integration (needs live instance for A2) | `npx vitest run packages/domain/src/connectors/redmine.contract.spec.ts` | ❌ Wave 0 (A2 gated) |
| CON-08 / D-86 | `connector_ref` rebind writes an AUD-01 before→after transition | integration | `npx vitest run packages/cli/rebind.integration.spec.ts -t "audited rebind"` | ❌ Wave 0 |
| CON-04 / D-84 | `dlq retry` re-enqueues via the same path; `sent_unconfirmed` requires `--force` + pre-check | integration | `npx vitest run packages/cli/dlq.integration.spec.ts -t "retry path"` | ❌ Wave 0 |
| OBS-04 / CON-06 | `submission_status{status="partial"}` and connector counter carry `app_id` | unit | `npx vitest run packages/platform/src/metrics/business-metrics.spec.ts -t "submission_status app_id"` | ⚠ extend existing |
| LNK-02 / D-93 / D-95 | Edit link consume-on-submit; replay returns original confirmation; expires at 4 h | integration | `npx vitest run apps/api/src/read/edit-link.integration.spec.ts -t "consume replay ttl"` | ❌ Wave 0 |
| DAT-14 / D-80 | Per-app "My submissions" list via frozen `query` action (no new claim) | integration | `npx vitest run apps/api/src/read/status-surface.integration.spec.ts -t "my submissions"` | ❌ Wave 0 |
| DAT-01/03/05 | Data-mode routing; `{{form.field}}`/`{{real_user.attribute}}` resolution; `partial` on external failure | unit | `npx vitest run packages/domain/src/datarouter/data-router.spec.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched-spec>` (quick run).
- **Per wave merge:** `npx vitest run` (full suite; Testcontainers-backed integration included).
- **Phase gate:** Full suite green before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tooling/` extension — connector/redmine test doubles + a Redmine stub server (e.g. an `undici`/`msw` handler) for transport-level tests, so most of the map runs without a live Redmine.
- [ ] `packages/domain/src/datarouter/outbox.integration.spec.ts` — CON-10/DAT-04 transaction atomicity.
- [ ] `apps/worker/src/processors/connector-delivery.integration.spec.ts` — DAT-06 + CON-03.
- [ ] `apps/worker/src/processors/reconciliation.integration.spec.ts` — DAT-07.
- [ ] `packages/domain/src/connectors/redmine-taxonomy.spec.ts` — CON-07 split.
- [ ] `packages/domain/src/connectors/redmine.contract.spec.ts` — CON-09/A2 (live-instance-gated for A2).
- [ ] `packages/domain/src/connectors/rate-limit.integration.spec.ts` — CON-05.
- [ ] `packages/cli/{dlq,rebind}.integration.spec.ts` — CON-04/CON-08.
- [ ] `apps/api/src/read/{edit-link,status-surface}.integration.spec.ts` — LNK-02/DAT-14.
- [ ] Framework install: none — Vitest + Testcontainers already present.
- [ ] Metrics spec extension — `business-metrics.spec.ts` for OBS-04/CON-06.

## Security Domain

> `security_enforcement: true` (ASVS level 1) per `.planning/config.json`.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Outbound uses `X-Redmine-API-Key` resolved from the encrypted envelope; edit links are signed `jose` ES256 (reusing the read-link path); consumed-token replay is idempotent (D-95). |
| V3 Session Management | partial | Edit-link `jti` consume-on-submit with a 4 h TTL and `GETDEL` atomicity; no new server session. |
| V4 Access Control | yes | Edit issuance is owner-only (`real_user_id`) with a live app-permission + `perm_version` re-check (D-93); status list is scoped by the auto-injected ownership filter (D-80). |
| V5 Input Validation | yes | Zod 4 schemas for connector config, field-mapping, descriptor, and taxonomy (`packages/contract`); mapping values validated before transport. |
| V6 Cryptography | yes | Five-field AES-256-GCM envelope via `KeyProvider` (never hand-roll); `jose` for signing; `LocalKeyProvider` + prod guard intact (D-87/D-88). |
| V7 Error Handling & Logging | yes | DLQ CLI output redacted by default under the log field allowlist; `--show-payload` is audited (D-85); raw HTTP bodies/credentials/PII never surface (D-82, D-43/W-22). |
| V8 Data Protection | yes | PII never in tokens/logs; erasure-relevant fields excluded before serialisation (PROJECT); credential material only ever in the envelope. |
| V9 Communications | yes | Outbound TLS to Redmine; `undici` (instrumented) is the single HTTP path. |
| V13 API & Web Service | yes | Outbound honors `Content-Type: application/json`; no CSRF surface (form renderer origin never holds a cookie). |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Double-send on retry (duplicate downstream record) | Tampering / Repudiation | Three-state outbound (DAT-06) + `not_sent`-only reconciliation (DAT-07) + composite idempotency key (D-92) + natural-key pre-check (D-84). |
| Credential exfiltration via logs/DLQ | Information Disclosure | Field allowlist before serialisation; DLQ redacted by default; `--show-payload` opt-in + audited (D-85). |
| Template injection in field mapping | Tampering | Narrow `{{...}}` resolver; no `eval`/`new Function` (Don't Hand-Roll). |
| Replay of a consumed edit link | Spoofing | `GETDEL` atomic consume + idempotent replay returning the original confirmation (D-95); 4 h TTL. |
| Stolen/leaked API key used from a foreign host | Spoofing | SSRF egress control at the transport core (allowlist/config-only `base_url`); credential-rejected taxonomy surfaces the misuse. |
| Forged/expired edit token | Spoofing | `jose` verification + live `perm_version` re-check (D-93). |
| Inactive user impersonation (`X-Redmine-Switch-User`) | Elevation of Privilege | 412 → `credential_rejected` (R4); the connector does not impersonate by default. |
| SSRF via connector `base_url` | Tampering | `base_url` is operator-seeded (CLI/seed file), never user-supplied; validate/allowlist at the transport core. |

## Sources

### Primary (HIGH confidence)
- In-repo source read this session (verbatim discrete values quoted in-file): `packages/contract/src/connector/connector.ts` (`ConnectorDescriptorSchema`, `ConnectorExecuteOutcome.status`), `packages/domain/src/submissions/submission.repository.ts` (`Submission.status`), `apps/api/src/common/throttler/throttler-storage-redis.ts`, `packages/platform/src/metrics/business-metrics.ts` (`METER_NAME='akane'`), `packages/platform/src/crypto/{envelope,key-provider}.ts`, `packages/platform/src/queue/job-scheduler.ts`, `apps/scheduler/src/app.module.ts`, `apps/worker/src/processors/platform-heartbeat.processor.ts`, `tooling/boundaries.config.mjs`, `tooling/containers.ts`, `vitest.config.mts`, `package.json`, `.planning/config.json`.
- `STACK.md` (audited stack, verified 2026-10-01) — §4.4 (BullMQ 6), §5 (`jose`), §8.2 (throttler storage), §9 (FormIO), §10.1 (testcontainers), §14 (version ledger).

### Secondary (MEDIUM confidence)
- `redmine.org/projects/redmine/wiki/Rest_api` — auth header, content type, switch-user, custom fields, validation errors, attaching files (R1/R2/R4). `[CITED]`.
- `redmine.org/projects/redmine/wiki/Rest_Issues` — attribute list, `cf_<id>` filter + "used as a filter", create/update semantics (R2). `[CITED]`.
- `redmine.org/issues/30086` (403-instead-of-401) and `redmine.org/issues/32315` (401 semantics) — the CON-07 credential split (R4). `[CITED]`.
- `redmine.org/issues/43881` — no built-in rate limiting (R4). `[CITED]`.
- Research-plan seam digests (keys K1–K5, provider `websearch`); `classify-confidence --provider websearch` → **LOW** for those digests.

### Tertiary (LOW confidence)
- Redmine absence-claims (A1 no idempotency header; A2 create-time 404 / `cf_` filter behaviour) — governed absences, unresolvable without a live instance.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — all server deps already pinned and verified; one renderer dep flagged `SUS` with a spike gate.
- Architecture: **HIGH** — the outbox/reconciliation/three-state patterns reuse verified scaffolding; the mechanism recommendation is a judgement call (A3) but the CON-10 guarantee is transaction-delivered.
- Redmine contract: **MEDIUM** — confirmed-doc facts are `[CITED]`; idempotency and 404 semantics are governed absences carried as A1/A2.
- Pitfalls: **HIGH** — derived from verified BullMQ-6/Mongo/Redis semantics and existing repo code.
- Validation architecture: **HIGH** — Vitest + Testcontainers substrate already exists; the map is concrete.

**Research date:** 2026-10-09
**Valid until:** 2026-11-08 (30 days) — stable stack; re-verify only the Redmine contract against a live instance before pinning A2.

