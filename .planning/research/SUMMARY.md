# Project Research Summary

**Project:** IM-Driven App Builder & Integration Gateway
**Domain:** Chat-driven enterprise workflow gateway — IM adapters → permission-first routing → signed one-time links → FormIO.js forms → hybrid data routing (MongoDB / connector / both)
**Milestone context:** Greenfield. `PRD.md` v2.0 is the baseline; `.planning/PROJECT.md` carries adopted amendments.
**Researched:** 2026-10-01
**Confidence:** MEDIUM-HIGH overall (HIGH on stack, architecture mechanics, and pitfall mechanisms; MEDIUM on JEV routing accuracy and App Builder adoption)

---

## Executive Summary

This is an integration-gateway product that happens to have a chat front door, and the research is unanimous that the PRD's §20 sequencing treats it as the opposite — a form tool with chat bolted on. All four researchers independently reached the same headline: **the dominant risk in this project is build order, not technology.** Nobody proposed a new dependency or a new pattern; the stack spine (Node 24 / NestJS 12 / Express / native MongoDB driver / ioredis + BullMQ / Zod 4 Standard Schema / `jose` / manual OpenTelemetry / `@formio/js` 5) survived a hard audit with only patch-level corrections. What changed is the plan. Four concrete ordering defects (FEATURES DH-1…DH-4), seven architecture findings that contradict PRD §7's execution model (ARCHITECTURE), and 19 critical pitfalls of which three are genuine requirement conflicts with a named winner (PITFALLS) all converge on the same conclusion: **the 2,000 ms chat-to-link path, the one-time-token lifecycle, and the log-serialisation allowlist must be designed in the first phase even though the features they support ship in phases 3–5.** The 26–34 week estimate already in PROJECT.md is a consequence of the PRD's ordering, not a disagreement about velocity.

The recommended shape is a **vertical-slice build, not a layer-by-layer build**, and it is genuinely different from PRD §20 in three ways. First, the first demonstrable capability is `/leave request` in Slack producing a signed link, a rendered form, a submission with a `submission_id`, and a chat confirmation — using CSV pre-provisioned identity, no OTP, and no decision model. That single slice collapses the combinatorial surface from 360 nominal combinations (4 IM platforms × 3 routing modes × 6 link types × 5 lifecycle states) down to roughly 12 genuinely distinct cases, and it makes every architectural assumption load-bearing while the codebase is still small. Second, **the read path moves from Phase 4 to immediately after the vertical slice**, because it shares the `perm_version` epoch primitive with the RBAC cache and because a Phase-3 submission viewer with no read path cannot open anything. Third, **v1 ships one IM platform (Slack), not four** — FEATURES is explicit that a 4-platform v1 costs +8–12 weeks of variance against a stated target of 26–34 weeks, and Teams/Zalo/Telegram all carry separate webhook-verification, retry, and threading surfaces for zero gain against the core value proposition.

The risks that survive research are all things that cannot be fixed by writing more code later. Redis `GETDEL` is atomic but not durable, so a consumed one-time link can reappear after a failover — the real anti-double-submission guarantee is a MongoDB unique index. BullMQ's `jobId` deduplication lapses on `removeOnComplete`, so it cannot carry `FR-D-12`'s write-once promise, and that promise is additionally unimplementable against most enterprise downstreams and must be **amended, not implemented**. Three requirement conflicts need an explicit ruling before implementation starts: per-IP brute-force limiting (NFR-SEC-10) loses to availability (NFR-SEC-10 vs NFR-A-1/FR-R-10), `trace_id = submission_id` (NFR-O-1) loses to the audit/erasure contract (FR-AU-5/§15.4), and the 3-year immutable audit log (FR-AU-3/5) wins — meaning §15.4's erasure promise must be narrowed to what the code actually delivers. None of these are technical risks. They are decisions that must be recorded once, early, or the code will encode the losing side of a contradiction by accident.

---

## Key Findings

### Recommended Stack

Source: `STACK.md` (1138 lines, verified 2026-10-01 against the npm registry, vendor docs, and `endoflife.date`). **This document supersedes PRD §7.4 entirely — do not revert any pin from it.** The prior research pass was audited rather than re-derived, and the corrections were 14 patch-level drifts plus four findings that change conclusions. The load-bearing items:

**Core technologies:**
- **Node.js 24.21.0 LTS** (EOL 2028-04-30) — amends PRD "Node 20+". Node 20 hit EOL 2026-04-30 and cannot carry a deployment whose critical-vuln scan gates releases.
- **NestJS 12.1.2 + Express (not Fastify)** — v12 ships Standard Schema, so Zod 4 is first-class and `class-validator`/`class-transformer` are gone. Express because `@slack/bolt@5` bundles `express@^5` in-process and OpenTelemetry's auto-bundle contains `instrumentation-express` but **not** `instrumentation-fastify` (which is now itself deprecated in favour of `@fastify/otel`).
- **TypeScript 6.0.3, hard-pinned, with the lockfile committed in the first commit** — npm `latest` is 7.0.2 and breaks the build. Correction to the prior pass: the hard `ERESOLVE` comes from **`typescript-eslint@8.71.0`** (peer `>=4.8.4 <6.1.0`), *not* `@nestjs/swagger` — Swagger's TS peer is optional and only warns. Pin TS regardless of Swagger.
- **Zod 4.6.5 + `StandardSchemaValidationPipe`** — one schema validates at runtime *and* infers the handler type. Rejects `nestjs-zod@5.5.0` and both community Redis throttler storages: all declare peers against `@nestjs/common ^10 || ^11` and are incompatible with NestJS 12.
- **MongoDB 8.0.x with the native `mongodb` 7.7.0 driver, not Mongoose** — Mongoose's compile-time schema model has no value when App Builder authors define fields at runtime (up to 200 apps × 20 forms). `instrumentation-mongodb` covers the raw driver identically. **MongoDB 8.2 is already EOL (2026-07-31) — never pin it.** 8.0.x and 8.3.x are both valid; 9.0 (released four days before verification, EOL 2031-10-31) is deliberately not adopted yet.
- **Redis ≥8.2 floor, developed against 8.10.x, via `ioredis` 6.0.0 + BullMQ 6.3.11** — never pin 8.0.x (EOL 2026-12-01, 62 days out). `GETDEL` for atomic token consumption (since Redis 6.2.0). Never pin `ioredis` 5.x (High *Uncontrolled Recursion* advisory).
- **`jose` 6.2.12, not `@nestjs/jwt`** — `@nestjs/jwt` wraps `jsonwebtoken`, which has no JWKS and no `kid` keyring; NFR-SEC-9's zero-downtime dual-key rotation would become hand-rolled. `jose` gives `kid` → keyring resolution natively, which also lets the static Form Renderer verify read links with a **public** key (asymmetric EdDSA/ES256, per AD-11).
- **`@formio/js` 5.6.1, not `formiojs` 4.x** — the 4.x package is in official maintenance mode. The OSS build is MIT, includes the drag-and-drop builder (`dragula` bundled), and there is no `@formio/vanilla`, so plain `@formio/js` is the only way builder and renderer share one engine. Bundle from npm; never CDN.
- **Manual OpenTelemetry** — `@opentelemetry/auto-instrumentations-node@0.80.0` + OTLP exporters to a collector. **`@nestjs/observe` is definitively rejected**: it has no OTLP exporter, it routes to NestJS's own hosted backend (`observe.nestjs.com`, `serviceId`/`appSecret`), and it is documented as *"not a replacement for OpenTelemetry"*. The prior pass's "re-evaluate in Phase 4" is **cancelled**; it would also break data residency.
- **ESLint, not NestJS 12's new oxlint scaffold** — `eslint-plugin-boundaries@7.2.0` is required by the "boundary violation fails the build" constraint and is ESLint-only.
- **`ua-parser-js` is AGPL-3.0-or-later — hard do-not-use.** Under an enterprise OSS posture and a CI dependency gate this is disqualifying, and it is an easy transitive landmine.

**Testing:** Vitest 5.0.3 (NestJS 12's own scaffold default), Playwright 1.63.0 (also the only practical way to UAT FormIO's drag-and-drop), testcontainers for real MongoDB + Redis — mocks would not catch the `GETDEL`/BullMQ behaviour NFR-SEC-1 depends on.

### Expected Features

Source: `FEATURES.md` (470 lines). The opinionated calibration: **v1 = Slack × (internal routing + exactly one external connector, Redmine).** Internal-only would make this a form-forwarder, so one external connector is mandatory; four adapters built in parallel produce four special cases with no generalisation and +8–12 weeks of variance.

**Must have (table stakes):**
- Identity resolution → internal user UUID, and **permission-filtered tool list before any model call** (the sharpest edge in the design — no competitor filters by RBAC before the model)
- One-time signed link → rendered form, with atomic single-use consumption
- Submission persisted to a per-app dynamic collection; at least one external connector with retry + DLQ
- Chat notification on success **and** failure (two different code paths, two different message shapes)
- Audit trail keyed by `submission_id` — a precondition of sale, not a usability feature
- Webhook ack <200 ms, all logic in the consumer

**Should have (differentiators):** self-service App Builder for department admins (largest build, largest differentiator); stateless signed read links verifiable without the signing key; confidence-gated handoff with an explicit no-model fallback; 90-day zero-downtime dual-key rotation; delegated ownership (owner transfer, workflow-manager role); PII excluded from logs by allowlist *before* serialisation.

**Six features that are absent from the PRD and should be added as new sections §22–§25** (the PRD's TOC lists §22–§25 but the body ends at §21): end-user submission status view (P0 — the #1 support question in any async integration tool); draft save & resume (P1, and structurally incompatible with a stateless one-time-token SPA — it needs a second, longer-lived token, so this is an explicit decision, not an omission); app tags/categories + a ~10-template seed gallery (P1, cheap day-90 usability); object storage, quota, and orphaned-upload cleanup (P1 conditional — Form.io uploads persist *regardless of submit*); publish-review gate for admin-authored apps (P3); notification-cadence policy (P2 — PagerDuty publishes "too frequent status updates" as a named incident-response anti-pattern).

**Fourteen requirements marked P0 in the PRD are recommended for deferral**, because the cost column disagrees with the priority label: `FR-R-4`, `FR-R-6`, `FR-LC-4`, `FR-LC-5`, `FR-LC-7`, `FR-C-8`, `FR-C-9`, `FR-C-11`, `FR-C-12`, `FR-D-11`, `FR-J-9`, `FR-J-11`, `FR-F-6`, `FR-F-10`.

**Anti-features to rule out of v1 explicitly** (evaluated against shipped behaviour, not intuition): open-ended conversational AI (NG1 — the decision model returns discrete `choice`/`confidence`; open generation has no confidence signal to gate on); group/channel RBAC (NG2 — a second identity system whose two sources of truth will disagree); native IM forms / modals / Adaptive Cards (NG3 — Slack's Input block holds exactly one element, a modal holds max 3 views, `trigger_id` expires in 3 s; Slack itself recommends links for long form); multi-step approval engine (NG4 — even one step spans four separate documented areas in Power Automate); real-time collaborative form editing (NG5); cross-app data sharing in v1 (NG6 — the most likely source of a silent authorization bug); native mobile client (NG7); a workflow engine (NG9).

### Architecture Approach

Source: `ARCHITECTURE.md` (904 lines). A **modular monolith with three process entrypoints** (`api` / `worker` / `scheduler`), one DI graph, npm workspaces, and a boundary lint rule that fails the build on violation. The single most consequential structural amendment: **PRD §7.1's linear pipeline is wrong as an execution model.** It places the rate limiter before identity and the whole pipeline before the response, which is only correct for a synchronous request. With a pure-ingest receiver none of that pipeline runs inside the ack window — the PRD needs a second diagram distinguishing *ingest* from *processing*.

**Major components:**
1. `platform/` — config (Zod-validated), logging with the PII allowlist, OTel bootstrap, KMS-backed AES-256-GCM secrets, HTTP with proxy awareness, health (`/health/live` + `/health/ready`)
2. `kernel/` — identity, RBAC (`@casl/ability`), app registry, form registry, links, submissions, audit; all stateless, all session state in Redis
3. `decision/` — the provider seam: `RuleBasedProvider` (terminal fallback) → JEV HTTP adapter, with a **deadline propagated down the chain**
4. `datarouter/` + `connectors/` — internal write, external push, transactional outbox for hybrid
5. `adapters/` — one inbound shape (`verify → validate → enqueue`) and one outbound shape (`render → send`) per IM platform, over a shared `InboundEvent`/`OutboundMessage` contract
6. `apps/form-renderer` + `apps/builder` — two Vite/React SPAs sharing one `@formio/js` engine

**Six patterns that must be followed:**
- **Epoch-keyed cache keys replace Redis Pub/Sub** as the correctness mechanism. Pub/Sub is at-most-once, so a dropped message means a stale permission read. One primitive (`perm_version` in the cache key) then serves *both* the RBAC cache and the read-link security check; Pub/Sub becomes a latency optimisation only.
- **Pure-ingest receiver** — ack <200 ms, enqueue, nothing else. Verify signature on the **raw** body, exactly once, in the receiver only.
- **Transactional outbox** is the hybrid consistency boundary.
- **Aggregate the tool set, don't fan out** — one Redis GET for the whole filtered set, not 800.
- **Durable scheduler registration** via BullMQ Job Schedulers, never `@nestjs/schedule` (in-memory, per-instance — a key rotation that silently doesn't run on one pod is a security failure).
- **DI is the contract seam**, and its limits are explicit: the three entrypoints must not drift into one process.

**Three operational constraints that force infrastructure decisions:**
- BullMQ requires `maxmemory-policy=noeviction` (documented as `DANGER`) while the PRD's Redis runbook says *"evict expired keys"*. The policy is instance-wide, so **cache and queue cannot share a Redis instance — two deployments, `noeviction` for queue+tokens and evicting for cache.** Non-negotiable, and it must be split *before* queues carry data.
- BullMQ's multi-key atomic operations "break Redis's rules for cluster configurations"; the documented `{hash-tag}` prefix workaround pins all queue keys to **one hash slot, i.e. one node**. Acceptable at 1,000 users, but it means cluster *memory* is the scaling axis, not queue parallelism.
- Redis Cluster replication is asynchronous and acknowledged writes can be lost on failover — which is why the MongoDB `unique` index, not `GETDEL`, is the anti-double-submission guarantee.

### Critical Pitfalls

Source: `PITFALLS.md` (978 lines, 19 critical pitfalls).

1. **`GETDEL` is atomic but not durable** — Redis replication is asynchronous and acknowledged writes can vanish on failover, so a consumed one-time link comes back to life. *Avoid:* a MongoDB `unique` index on `submissions.link_jti` as the real guarantee, `GETDEL` as the fast-path race closer, and an integration test that kills Redis mid-submit and asserts exactly one submission. Neither guard is load-bearing alone.
2. **Three Phase-1 design commitments whose features ship in Phase 3/4** — the read-link JWT claim shape (adding a claim in Phase 4 breaks every outstanding link on deploy), the JEV wire contract including `choice.verified: boolean | null` and `state.force_clarification`, and the log allowlist plus trace-ID decision (both are serialisation/wiring changes that are irreversible once production logs exist; **there is no Phase-2 version of this pitfall**). *Avoid:* fixing all three contracts in the foundations phase even though their features land later.
3. **Hybrid routing has an unrepresentable window** — the PRD cannot express the gap between "sent" and "confirmed", and it puts the idempotency guarantee on the wrong side of the wire. *Avoid:* commit `sent_unconfirmed` *before* the outbound call, model exactly three states (`not_sent | sent_unconfirmed | confirmed`), auto-retry only `not_sent`, and run a reconciliation job. Never auto-resend anything unconfirmed.
4. **`perm_version` covers one of seven revocation events, and there is no kill switch** — a user deactivated through a path that does not bump the epoch keeps a live read link. *Avoid:* per-user and per-app epochs bumped by one write, a default read-link TTL of 7 days rather than 90, and `read_link_denied_total{reason}` for all seven reasons.
5. **NFR-O-1's `trace_id = submission_id` conflicts with the audit-retention contract** — a stable trace ID that correlates submissions is itself a 3-year activity map that cannot be purged. *Avoid:* decouple the trace ID from `submission_id` and make `actor_ref` tombstoneable.
6. **A newly published app silently steals routing traffic, and publish is not a gate** — 200 apps, no collision check. *Avoid:* publish runs a routing dry-run against the labelled set and blocks on a >5-point drop for any existing app, plus a description-collision check and a `routing_share{app_id}` dashboard panel.
7. **Auto-injected Query-DSL filters leak soft-deleted rows**, and the DSL is an authorisation surface with no test. *Avoid:* one filter builder that emits both `real_user_id` (unless `view_all`) and `deleted_at: null`, with a test per DSL construct asserting the injected filter survives.
8. **One shared connector, N apps, no per-app budget** — `connector_call_total` has no `app_id` label, so one app's traffic spike fails every app at once and the alert cannot name the culprit. *Avoid:* `app_id` as a first-class label, `credential_rejected` alerting separately from `endpoint_unreachable`, and `connector_ref` changes as a separately audited mutation.

**App Builder adoption is structurally blocked, not merely risky:** `FR-C-2` + `FR-C-10` + §12.4 together mean **a department admin cannot publish any external or hybrid app without a platform admin**, because the connector credential lives on the platform side. That is an org-chart dependency inside a self-service promise. It needs a connector-request flow, and it needs to be stated plainly rather than discovered during Phase 3.

---

## Implications for Roadmap

The roadmap should be built as **vertical slices with a demonstrable capability per phase**, not layers. The recommended structure is ARCHITECTURE's S0–S7 shape with three deliberate adjustments, each of which resolves a disagreement between researchers rather than averaging it (see "Cross-research disagreements" below).

### Phase 0: Foundations
**Rationale:** The boundary lint rule has to exist before the first module or it gets retrofitted across 200 files. Cheap now, expensive later. This phase also carries every irreversible design commitment the pitfalls research identified.
**Delivers:** Repo with npm workspaces; three entrypoint skeletons (`api` / `worker` / `scheduler`); `platform/` and `kernel/` skeletons; `eslint-plugin-boundaries` config with the build-failing rule; OTel bootstrap; health endpoints; testcontainers harness; **two Redis deployments split correctly from day one**; **pinned `package.json` + committed `package-lock.json` (TypeScript 6.0.3) as the first commit**; and the four Phase-1 design commitments: log allowlist before serialisation, decoupled trace ID, read-link JWT claim shape (incl. `form_version`/`app_version`/epoch), and the JEV wire contract with `choice.verified` / `state.force_clarification`.
**Demonstrable capability:** `GET /health/ready` on all three processes; CI fails on a boundary violation; a deliberate `npm install` on a clean checkout does not break the build.
**Uses:** `@nestjs/*` 12.1.2, TypeScript 6.0.3, ESLint, `@opentelemetry/*` 0.222.0, `@nestjs/terminus`, testcontainers.
**Avoids:** Pitfalls 15 (compliance vs observability), 1 (`GETDEL` durability), 17 (Pub/Sub invalidation), and the MongoDB 8.2 / Redis 8.0.x / Node 20 EOL traps.

### Phase 1: The vertical slice ★
**Rationale:** Smallest thing that proves the core value proposition end-to-end. `/leave request` is the right first integration test because `FR-J-11` already licenses slash commands bypassing the decision model entirely — deterministic, no provider, no confidence threshold, no model latency. It also produces the harness the natural-language path later plugs into, so the work is not throwaway. Internal-only routing removes the entire connector/BullMQ/outbox surface from the first proof.
**Delivers:** `adapters/slack/inbound` + `outbound`; `pipeline/`; `identity` via **CSV pre-provisioning only**; `authz` with epoch-keyed cache; `registry` with one seeded `published` app; `forms` with one pinned FormIO schema; `links` (create only); `submissions` (internal mode only); Form Renderer SPA; `audit`.
**Demonstrable capability:** **A user types `/leave request` in Slack, receives a link, fills the form, submits, and gets a confirmation carrying a `submission_id`.**
**Scope correction:** the PRD's Phase 1 includes OTP onboarding. Lazy OTP adds a Redis state machine, a brute-force policy, and a lockout flow to the first slice — none of which the demonstrable capability needs. Ship CSV in Phase 1 (FR-I-2 permits it as first-class); OTP moves to Phase 5 alongside the admin surfaces it belongs to.
**Avoids:** Pitfalls 2, 3, 5, 6, 7, 8, 16, 18, 19 — most of the critical set is naturally Phase-1 work.

### Phase 2: Natural-language routing
**Rationale:** The provider seam cannot be validated without a real provider, but `RuleBasedProvider` must ship **first** — it is the terminal fallback, and its absence means the system has no routing path at all. This also discharges FEATURES' DH-3: the PRD's objection that Phase 1 "has no decision model yet ships link infrastructure" is answered by making routing deterministic from day one and upgrading the routing *input*, not retro-fitting a model into a link flow that was validated against manual app selection.
**Delivers:** `decision/` with `RuleBasedProvider` (offline, in-process, ~50 ms), the JEV interface + HTTP adapter, the fallback chain with **deadline propagation**, circuit state in Redis, the decision cache, and the §11.1 two-stage wire contract.
**Demonstrable capability:** A user types "I want to request leave" instead of using a slash command.
**Avoids:** Pitfalls 9, 10 — and note the 500 + 1000 + 50 ms chain overruns the 2 s budget on its own, so the deadline must skip to the next provider when the remaining budget cannot accommodate it and fall straight through to `RuleBasedProvider` when it cannot.

### Phase 3: Read path *(moved forward from PRD Phase 4)*
**Rationale:** This is the highest-risk, highest-value work in the roadmap, and it is adjacent to things already built. It shares the `perm_version` epoch primitive with the RBAC cache (Pattern 1) and the permission path, so building it next is materially cheaper than returning to it later. It also discharges FEATURES' DH-1: PRD Phase 1 ships an app registry with per-app RBAC and Phase 3 ships a submission viewer — a viewer with no read path cannot open anything. Doing the security model while the codebase is small and the domain is fresh is right; doing it after the App Builder means designing it in a hurry.
**Delivers:** Read-link signing + verification (asymmetric, public-key verifiable), `perm_version` enforcement on read, the Query DSL with auto-injected user filter, renderer view/query mode, `read_link_denied_total{reason}` for all seven reasons.
**Demonstrable capability:** A 90-day view/query link that dies the moment permission is revoked.
**Uses:** `jose` (asymmetric signing, `kid` keyring), `perm_version` epoch primitive from Phase 1.
**Avoids:** Pitfalls 4 (staleness + no revocation), 18 (soft-delete leak in the DSL).

### Phase 4: Integration & async ★
**Rationale:** Depends on Phase 1's submission record and Phase 3's permission checks; must not precede Phase 1. This is the hardest correctness surface in the system. Keep hybrid here at roughly its PRD Phase-2 position — the adjustment is that read links already left Phase 4, so Phase 4 no longer bundles four independent risks (FEATURES' DH-4) once Teams/Zalo/webhooks are pushed out.
**Delivers:** `connectors/` (REST); `datarouter/`; **transactional outbox**; BullMQ workers + DLQ; external + hybrid modes; `partial` status; `Idempotency-Key`; edit links; the **first and only v1 external connector — Redmine**; end-user submission status view; app tags + ~10 seed templates.
**Demonstrable capability:** A hybrid submission where the internal write confirms instantly, the external sync lands asynchronously, and failures surface as `partial`.
**Avoids:** Pitfalls 13 (hybrid window), 16 (connector blast radius), 2 (edit-link double submit — model it as one-shot *and* a natural-key pre-check, returning 200 with the original confirmation, not a 409).
**Amendments required here:** `FR-D-12`'s write-once guarantee is unimplementable against most enterprise downstreams. Amend the promise to: *the platform guarantees a single **send** per submission; write-once against the downstream additionally requires downstream idempotency-key support or a natural-key pre-check, and each connector instance declares `supports_idempotency_key`, surfaced to the App Builder at publish time.*

### Phase 5: Self-service App Builder
**Rationale:** This is the self-sustaining mechanism — it *is* the product. But it is a CRUD skin over APIs that are already stable by Phase 4, which makes it the **lowest-risk slice despite being the highest-value one**. Building it earlier means designing UI against APIs that are still moving. ARCHITECTURE's position is that the PRD defers it past the value proposition (FEATURES' DH-2); the honest resolution is not to move it, but to make the pre-builder demo credible by shipping the seed-template gallery and a fixture-seeded app in Phases 1 and 4.
**Delivers:** `builder/`; FormIO form builder; RBAC management; routing config UI; submission viewer; publish validation and dry-run; **OTP onboarding**; **connector-request flow**; delegated ownership (owner transfer, workflow-manager role).
**Demonstrable capability:** A non-developer builds and publishes a working app with zero platform-admin involvement.
**Avoids:** Pitfalls 11 (publish steals traffic) and 12 (adoption walls — including the `FR-C-2`/`FR-C-10`/§12.4 org-chart dependency, which the connector-request flow exists to solve).

### Phase 6: Multi-IM expansion + observability hardening
**Rationale:** The adapter is now a *known* shape — Phase 1 defined the `InboundEvent`/`OutboundMessage` contract — so adding platforms is additive rather than inventive. Scope to the v1 calibration: **Teams first** (required only if the target enterprise is Microsoft-based; the M365 Agents SDK is the correct, actively maintained package), **Zalo and Telegram deferred past v1**. Full OTel suite, dashboards, alerts, runbooks, two-way sync webhooks, and the load test at 1,000 users land here because they need a realistic multi-adapter traffic mix to be meaningful.
**Delivers:** Teams adapter (`@microsoft/agents-hosting` 1.9.1 + `-msteams`); inbound webhooks; OTel dashboards + alert rules; load test.
**Demonstrable capability:** An employee on Teams gets the identical experience.
**Note:** Zalo's adapter carries an open security question — if the OA callback offers no request-signing mechanism, that leg is protected by network control + replay window rather than HMAC. That is a spike answer, not a planning assumption.

### Phase 7: Post-MVP
**Rationale:** Explicitly out of scope per PROJECT.md.
**Contents:** Cross-app data sharing (the literal "gateway" claim — needs an explicit authorization rule: a cross-app read re-evaluates the *requesting* user's permissions against the *source* app, never the calling app's grant), group RBAC, Zalo and Telegram adapters, i18n, AI-assisted builder, single-step approval, publish-review gate, retention/purge automation, app-definition rollback.

### Requirement conflicts that must be ruled before Phase 1 starts

These are not implementation details. Each is a genuine contradiction between two requirements, and code written before the ruling will encode the losing side by accident. All three were raised independently by PITFALLS and should be recorded as AD amendments:

| # | Conflict | Winner | Consequence |
|---|----------|--------|-------------|
| 1 | NFR-SEC-10 per-IP brute-force cap vs NFR-A-1 / FR-R-10 availability | **NFR-SEC-10 loses.** A shared corporate NAT means 6 legitimate users behind one IP trip the cap and the whole office is locked out. | Rate-limit per *user* and per *link jti*, not per IP. Block only on **signature** failures, never on expired/consumed/stale-benign outcomes. Alert on `block>0 ∧ signature_invalid≈0` — that combination means a false positive. |
| 2 | NFR-O-1 `trace_id = submission_id` vs FR-AU-5 / §15.4 | **NFR-O-1 loses.** A stable trace ID is itself a 3-year un-purgeable activity map. | Decouple them; make `actor_ref` tombstoneable so erasure can null the reference without breaking the row. |
| 3 | FR-AU-3/5 3-year immutable audit vs §15.4 erasure | **FR-AU-3/5 wins.** 3-year audit retention is a hard compliance obligation. | **Narrow the §15.4 erasure promise** to the deliverable: exclusion from logs by allowlist before serialisation + tombstone of the actor reference + defined purge windows for submission bodies. Do not promise full erasure of the audit record. The legal framing of "legitimate interest" for audit retention should be confirmed by counsel, not by research. |

Additionally, `FR-J-9/11` (disambiguation and explicit no-JEV fallback) are marked P0 but are recommended for deferral — and note that `state.force_clarification` and `choice.verified` are **Phase-1 contract commitments regardless**, because the conformance suite in §17.3 will test against whatever contract exists when it runs.

### Phase Ordering Rationale

- **Dependencies, not layers.** Phase 1's submission record is a hard precondition for Phase 4's outbox; Phase 1's `perm_version` is a hard precondition for Phase 3's read path. Neither is reversible, so neither waits.
- **Design-in-first, feature-later.** Four things must be decided in Phase 0/1 because retrofitting them is impossible: the log allowlist, the trace ID, the read-link JWT claim shape, and the JEV wire contract. The pitfalls research is emphatic that "there is no Phase 2 version of this pitfall."
- **Two slices must not be reordered: Phase 1 (vertical slice) and Phase 4 (integration/async).** Phase 1 proves the value proposition; Phase 4 is the hardest correctness surface. Reversing either destroys either the demo or the correctness model.
- **Only Phase 5 and Phase 6 are safely swappable**, and even then Phase 6 before Phase 5 means designing a builder UI against APIs that are still moving.
- **This ordering resolves all four FEATURES sequencing hazards:** DH-1 (read path moved to Phase 3, ahead of the viewer), DH-2 (builder value gap mitigated by seed templates rather than by moving the builder), DH-3 (deterministic routing from Phase 1, JEV in Phase 2), DH-4 (Phase 4 unbundled — read links already moved, multi-IM pushed to Phase 6).

### Cross-research disagreements — resolved, not averaged

| Disagreement | Positions | Resolution and reasoning |
|---|---|---|
| **When the read path ships** | ARCHITECTURE: Phase 3 (ahead of the App Builder). FEATURES: v1.x, after validation. | **Phase 3.** FEATURES rated it v1.x on risk grounds, but PITFALLS independently maps the read-link epoch claim shape to *Phase 1 design* — so the work is paid for in v1 regardless. Deferring the feature while fixing its contract buys nothing and leaves DH-1 (viewer that cannot open anything) unresolved. Risk is contained by giving it its own phase so a slip does not consume the App Builder's slack. |
| **How much platform breadth in v1** | FEATURES: Slack only. ARCHITECTURE S6: all four adapters in one phase. | **Slack only in v1; Teams as first expansion; Zalo and Telegram deferred.** ARCHITECTURE never argued for breadth *in v1* — its S6 is post-core. FEATURES' +8–12 week variance estimate is the deciding input, and Zalo's unverified webhook signature support is an open security question, not a scheduling detail. |
| **When the decision model arrives** | FEATURES (DH-3): JEV should move into Phase 1. ARCHITECTURE: `RuleBasedProvider` in Phase 2, JEV after. | **ARCHITECTURE.** JEV in Phase 1 would put a third-party network call, a confidence threshold, and a latency budget on the critical path of the first vertical slice. DH-3's underlying complaint — "Phase 1 ships link infrastructure validated against manual app selection" — is fixed by Phase 2's deterministic provider, not by importing a model early. The link infrastructure is *not* wasted: Phase 1's `/leave request` path is the same path natural language eventually feeds. |
| **PRD §7.4 stack table vs STACK.md** | PRD vs audited registry data. | **STACK.md supersedes §7.4 in full.** Stated explicitly so no one reverts a pin from the PRD during implementation. |
| **Tool-selection accuracy evidence** | PITFALLS rates JEV accuracy MEDIUM: mechanism (catalog size, near-duplicate descriptions, uncalibrated confidence) is well-founded but the quantitative claim is **unmeasured**. | **Treated as unverified, not as consensus.** The research flag on Phase 2 is real: accuracy at 100–800 candidates was not retrievable, and the 50-item conformance set cannot cover a 600-tool catalogue. |
| **App Builder adoption** | PITFALLS: MEDIUM. The connector-dependency argument is structural and certain; the adoption-rate claims (~30 min to first value) are judgement from comparable tools. | **Do not present adoption thresholds as measured.** Only the structural wall (`FR-C-2` + `FR-C-10` + §12.4) is load-bearing enough to design against. |

### Research Flags

**Phases needing deeper research during planning (`/gsd-plan-phase --research-phase <N>`):**
- **Phase 2 (natural-language routing):** **highest research need.** Tool-selection accuracy at 100–800 candidates was not retrievable; the ">90% accuracy" and "p95 <500 ms" targets are not jointly achievable as specified. Needs a phase-specific pass on the decision model plus an `AI-SPEC.md` — the provider choice, host, and cost profile are explicitly *not* a stack question and were not covered.
- **Phase 3 (read path):** needs research on the Query DSL authorisation surface and the seven revocation events — the Query DSL is an authorisation boundary with no existing test precedent.
- **Phase 4 (integration/async):** needs per-connector contract research for Redmine (field mapping, idempotency-key support, error taxonomy). The outbox pattern is well-understood; the Redmine contract is not.
- **Phase 5 (App Builder):** needs `--research-phase` on FormIO builder integration (see spike S1 below) and on the connector-request workflow, which is a new flow with no PRD section.
- **Phase 6 (multi-IM):** needs research on Teams activity-delivery retry semantics — the relevant Microsoft Learn pages 404'd during research — and Zalo OA callback signature verification, which was unverified and changes the adapter's threat model.

**Phases with standard patterns (skip research-phase):**
- **Phase 0 (foundations):** the module layout, DI wiring, OTel bootstrap, and health endpoints are textbook NestJS 12. Risk here is version-pinning discipline, not design novelty.
- **Phase 1 (vertical slice):** every component is a single well-documented pattern. It is large but not ambiguous.

**Spikes required before the phase that depends on them:**
- **S1 — FormIO 5.6.1 migration (blocks Phase 5).** Half-day. Render + build a representative form, port one Bootstrap-4-era template, verify `component.errors` and `EditGrid.validateRows` changes. Justification: `@formio/js` 5.x has *fewer* weekly downloads (52K) than the 4.x it replaces (57K), so docs/examples/Stack Overflow are likely still 4.x. Fallback is `formiojs@4.21.7` (MIT, maintenance mode) — acceptable, but it must be a decision, not drift.
- **S2 — Zalo OA client (blocks Phase 6, and only if Zalo stays in scope).** Two days, on a real OA account: authenticate, send, receive + verify a webhook. Include the signature-verification question explicitly — if there is no request signing, the security model changes materially.
- **S3 — SAML need confirmation (blocks Phase 0/1 discovery).** This is a *customer* question, not a technical one: "which IdP do you use, and does it support OIDC?" OIDC covers Entra ID, Okta, Auth0, Google Workspace, Keycloak. If SAML is genuinely required, `@node-saml/node-saml@5.1.0` has been quiet since 2025-07-21 and needs its own spike before entering any phase.

**Open decision that blocks the frontend scope, not the phase order:** `FR-F-10` file upload carries a **licensing risk** — Form.io's `File` component is premium (requires a Library Licence key + `@formio/premium`), while the renderer is MIT and the engine is OSL 3.0. This directly threatens AD-3 / §7.4's "open source" claim. Resolve in Phase 0 discovery: either confirm `@formio/js` alone can render a `file` component unlicensed, or drop `FR-F-10` from v1 and drop the dependent object-storage/quota/orphan-cleanup gap with it. Related and unresolved: Form.io's server-generated PUT URL requires S3-class object storage plus a token endpoint the PRD never specifies, and uploads persist *regardless of submit* — a documented storage leak with no owner in the PRD.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** | Every version resolved from the npm registry and cross-checked against `endoflife.date`. Four independent enforcers on the TypeScript pin; four independent reasons for Express including a *new* deprecation. Mongoose rejection is architectural, not version-based. Three prior gaps closed (OTLP capability, `@nestjs/observe`, throttler storage). MEDIUM only on Telegram (a genuine near-tie) and SAML. |
| Features | **MEDIUM-HIGH** | Grounded in doc-verified competitor behaviour (Slack Workflow Builder limits, Form.io pricing/limits, Power Automate approval surface, n8n workflow reviews, PagerDuty notification policy). MEDIUM on the Jotform draft-save precedent and on anything inferred from "users expect this" rather than measured. The **JEV wire protocol is a PRD invention with no industry standard** — Jev is a hosted vendor model and "OpenJev" reference implementations are unofficial. Publish the seam as a named first-party interface; treat the unofficial references as a risk, not a dependency. |
| Architecture | **HIGH** | Component boundaries, the ingest contract, the hybrid transactional boundary, the read-path sequence, and all Redis/BullMQ operational constraints verified against official documentation. MEDIUM on the JEV fallback latency budget and the exact Redis Cluster failover blast radius for this workload. |
| Pitfalls | **HIGH on mechanism, MEDIUM on the two behaviour claims** | Link/token lifecycle, webhook ordering, hybrid routing, cache invalidation, version drift, and the compliance conflicts are all HIGH — the failure modes are mechanical or documentary. MEDIUM on **JEV routing** (mechanism sound; the accuracy figure is unmeasured) and **App Builder adoption** (the connector dependency is structural and certain; the adoption-rate thresholds are judgement). The legal framing of audit retention under "legitimate interest" needs counsel, not research. |

**Overall confidence:** MEDIUM-HIGH. High enough to plan and commit to this structure. The residual uncertainty is concentrated in exactly two places — the decision model's accuracy characteristics, and whether department admins will actually adopt the App Builder — and both are handled by scoping them out of the critical path rather than by resolving them in advance.

### Gaps to Address

- **Tool-selection accuracy at 100–800 candidates is unmeasured.** Pitfalls 9 and 10 rest on mechanism (catalogue size, near-duplicate descriptions, uncalibrated confidence, a 50-item conformance set that cannot cover a 600-tool catalogue), not on measurement. *Handle:* phase-specific research pass before Phase 2 planning; report per-app accuracy with an interval rather than a single number.
- **The provider, host, and cost profile of the decision model were explicitly out of scope for STACK research.** *Handle:* an `AI-SPEC.md` for Phase 2 via `/gsd-ai-integration-phase`, not a stack decision.
- **Zalo OA webhook signature verification is unverified** — the developers site returned a client-rendered shell. If Zalo offers no request signing, that adapter's security model becomes network control + replay window rather than HMAC. *Handle:* answer in spike S2 before the adapter enters a phase. Note that Zalo is deferred past v1, so this does not affect the critical path.
- **Microsoft Teams activity-delivery retry semantics beyond retry-on-429/502** — the relevant Microsoft Learn pages 404'd. *Handle:* verify against current M365 Agents SDK docs in Phase 6 research.
- **Form.io `File` component licensing is unresolved** and directly threatens the AD-3 open-source claim. *Handle:* Phase 0 discovery decision — confirm unlicensed rendering or drop `FR-F-10` plus its dependent object-storage requirements.
- **Draft save & resume is structurally incompatible with the stateless one-time-token SPA.** A resumable draft needs a second, longer-lived token type, which changes the token model that Phase 1 is about to build. *Handle:* decide in Phase 0 discovery — either scope it (a second token class, distinct TTL and consume semantics) or defer it explicitly and document why.
- **The 3-tier throttler's Redis cost is unmeasured** — three named throttlers means three round trips per request. Acceptable at NFR-S-1 but must be measured in the load test, not assumed. *Handle:* Phase 6 load test.
- **App Builder adoption thresholds (~30 min to first value) are judgement from comparable tools, not measured for this domain.** *Handle:* do not present them as evidence in Phase 5 planning; re-research against comparable deployments if the phase is at risk.
- **The three requirement conflicts (§ above) are unresolved as written in the PRD.** *Handle:* record as AD amendments in Phase 0 planning. Do not start Phase 1 code against the current text.
- **MongoDB 9.0 was deliberately not adopted** despite an attractive EOL (2031-10-31) for a 3-year-retention deployment, because it was four days old at verification. *Handle:* revisit once it has a track record — likely before the retention window bites, not before Phase 1.
- **PRD §22–§25 are listed in the TOC but do not exist** (the body ends at §21). Six feature gaps have no home in the current document. *Handle:* write them as new sections rather than folding them into §8, so the deferral decisions are recorded rather than implied.
- **The 26–34 week estimate is inherited from PROJECT.md and has not been re-derived bottom-up against this 8-phase structure.** *Handle:* re-estimate per phase during roadmap creation. The research supports the *order* strongly; it did not estimate the *durations*.

---

## Sources

### Primary (HIGH confidence — verified directly during research)
- **`registry.npmjs.org`** — `dist-tags.latest`, `time.modified`, `peerDependencies`, `engines`, `deprecated` and `license` fields for every package in the version ledger; the basis for all version pins and for four corrections to the prior pass
- **`redis.io` command reference and *Replication* docs** — `GETDEL` `since: 6.2.0`; asynchronous replication, "acknowledged writes can still be lost during a failover"; basis for Pitfall 1 and the two-Redis-deployment finding
- **`docs.bullmq.io`** — *Migrate from v5 to v6* (Job Schedulers replace repeatable jobs, `debounce` removed, async `resume()`), *Idempotent jobs*, *Stalled*, `maxmemory-policy=noeviction` (documented as `DANGER`), Redis Cluster `{hash-tag}` limitation; basis for Findings 1, 2, 3 and Pitfalls 7, 13
- **`docs.slack.dev`** — *Verifying requests from Slack* (v0 signature over the **raw** body, ±5 min timestamp window); Block Kit limits (Input block = one element, max 3 modal views, `trigger_id` expires in 3 s); Workflow Builder limits and delegated workflow managers; *Bolt for JS v5* release note — basis for Pitfalls 6, 19 and anti-features NG2/NG3
- **formio.js official README + help.form.io** — namespace change to `@formio/js` 5.x; 4.x maintenance mode; builder included in the OSS build (`dragula` bundled); MIT renderer vs OSL 3.0 engine vs premium `File` component; uploads persist regardless of submit — basis for the frontend stack decision and gaps 3–5
- **`docs.nestjs.com`** — `StandardSchemaValidationPipe`, pipes, rate limiting; **`@opentelemetry/*`** — the 49-package auto-instrumentation bundle (confirmed present: `express`, `mongodb`, `ioredis`, `undici`, `pino`; confirmed absent: `fastify`, which is also deprecated)
- **`endoflife.date`** — Node.js, MongoDB, Redis support matrices; basis for the EOL timeline and the MongoDB 8.2 / Redis 8.0.x / Node 20 warnings
- **Microsoft Learn** — "Azure Bot Framework SDK to Microsoft 365 Agents SDK migration guidance (nodejs)"; Azure Bot Service docs confirming the repository is archived and support ended 2025-12-31
- **`developers.zalo.me`** — Official Account API and webhook docs (returned a client-rendered shell; signature support unverified)
- **TypeSafe AI / Jev documentation** — structured `choice`/`probabilities`/`confidence` output; parallel-and-isolated question design; atomic-question decomposition guidance — basis for the decision-model contract and anti-feature NG1
- **Snyk package-health pages** — ioredis advisory history (`<6.0.0-beta.1` High *Uncontrolled Recursion*); `ua-parser-js@2.0.10` AGPL-3.0-or-later

### Secondary (MEDIUM confidence — multiple sources agree, or one source plus mechanism)
- **Competitor product documentation** (Slack Workflow Builder, Power Automate / Copilot Studio, n8n, ServiceNow, Retool / Zoho Creator, Jotform, Formstack, DocuSign, PagerDuty) — used for the feature-precedent and anti-feature analysis in FEATURES.md
- **`nestjs/nest` GitHub v12.0.0 release notes** (2026-08-28) and InfoQ's NestJS v12 roadmap — Standard Schema validation, ESM-first packages, oxlint scaffold
- **Jotform "Save and Continue Later"** — the draft-save baseline expectation; the single MEDIUM precedent in the Tier-2 table

### Tertiary (LOW confidence — needs validation during planning)
- **"JEV-compatible" as a protocol** — PRD-invented. There is no published industry standard; Jev is TypeSafe AI's hosted flagship model and the PRD's "OpenJev" reference points at an unofficial reconstruction. Publish the seam as a named first-party interface.
- **Tool-selection accuracy degradation vs candidate count** — benchmarks not retrievable; the quantitative claim rests on mechanism only.
- **App Builder adoption rates for departmental non-developers** — inferred from comparable-tool behaviour, not measured for this domain.
- **Published EOL dates beyond 2029** — vendor-published schedules can be extended, but a component going EOL mid-retention-window is a compliance problem, not just a security one. This is the direct reason the EOL timeline matters to this project.
- **Community Zalo wrappers** (`zca-js`, `@warriorteam/redai-zalo-sdk`, n8n nodes) — all self-describe as unofficial; supply-chain risk, not an alternative to the hand-rolled client.

---

*Research completed: 2026-10-01*
*Ready for roadmap: yes*