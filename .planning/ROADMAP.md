# Roadmap: IM-Driven App Builder & Integration Gateway

## Overview

v1 is built as **vertical slices, not layers**. The first demonstrable capability is
`/leave request` in Slack producing a signed link, a rendered form, a submission with a
`submission_id`, and a chat confirmation â€” internal routing only, no decision model, no
connectors. Each subsequent phase adds one complete capability on top of a working slice:
plain-language routing, the read path, external + hybrid integration, the self-service App
Builder, platform expansion, and finally production hardening. The route mirrors
`research/SUMMARY.md`'s S0â€“S7 shape with its own numbering (research S0â€“S6 â†’ Phase 1â€“7).

**v1 scope** (per `.planning/REQUIREMENTS.md`): Slack Ã— (internal routing + exactly one external
connector â€” Redmine), the self-service App Builder, Microsoft Teams as the first platform
expansion, plus full compliance and observability tooling. Zalo, Telegram, and all 29 v2
requirements are out of this roadmap.

**Ordering is a correctness constraint, not a preference.** Four things had to be decided before
the first feature existed because retrofitting them is impossible: the log field allowlist, the
decoupled trace ID, the read-link JWT claim shape, and the JEV wire contract. Two slices must
not be reordered: the vertical slice (Phase 2) precedes integration/async (Phase 5), because
Phase 2's submission record is the precondition for the transactional outbox; and Phase 4's read
path depends on Phase 2's `perm_version` epoch primitive.

---

## Granularity: stated deviation from `coarse`

`config.json` sets `granularity: coarse` (nominally 3â€“5 phases). **This roadmap has 9 phases.**
The deviation is deliberate and is honoured through phase *breadth*, not phase *count*:

- **Breadth honoured.** Phases 2 and 6 are complete vertical capabilities carrying 47 and 25
  requirements respectively. No phase is a technical layer: there is no "all models" phase, no
  "all API endpoints" phase, and no phase whose output cannot be demonstrated to a user.
- **Count not compressed.** `coarse` was treated as a preference about phase size, not a hard cap
  on phase count. Compressing to 3â€“5 would require collapsing the research's order, and that order
  is load-bearing:
  1. Phase 2 (vertical slice) must precede Phase 5 (integration/async). Reversing them destroys
     either the demo or the correctness model.
  2. Four contracts must be frozen in Phase 1 â€” there is no Phase-2 version of that pitfall.
  3. Phase 2's `perm_version` epoch is a hard, irreversible precondition for Phase 4's read path.
     Building the read path after the App Builder means designing a security model in a hurry on a
     schema surface that already exists.
  4. All four researchers independently concluded build order is the project's dominant risk. An
     ordering that survives a phase-count target at the cost of that risk is a bad trade.

Four researchers converged on this shape; the deviation is stated rather than silently shipped.

---

## Phases

**Phase Numbering:**

- Integer phases (1–9): the whole of v1, executed in numeric order.

- [x] **Phase 1: Foundations & Platform** - Three pinned entrypoints, build-failing module boundaries, and the four irreversible contracts + three conflict rulings encoded in code (completed 2026-10-03)
- [x] **Phase 2: The Vertical Slice â€” Slack + Internal Routing** - `/leave request` in Slack â†’ signed link â†’ rendered form â†’ audited submission in chat, with identity, per-app RBAC, and one-time link security (completed 2026-10-06)
- [x] **Phase 3: Natural-Language Routing** - A user gets the right app by describing it; the system still routes with every decision provider down (completed 2026-10-08)
- [x] **Phase 4: Read Path & Query DSL** - 90-day stateless view/query links that die the instant permission changes, with auto-injected authorization filters (plans created)
- [x] **Phase 5: Integration & Async Execution** - Connectors, transactional outbox, hybrid routing, three-state outbound model, and visible `partial` status (completed 2026-10-11)
- [x] **Phase 6: Self-Service App Builder** - A department admin builds and publishes a working app with no engineering ticket and no platform admin (completed 2026-10-17)
- [x] **Phase 7: Multi-Form Apps & Per-Form Triggers** - One app, many forms (submit/list/view/edit) over a shared collection, shared roles and a single routing destination, each form activated by its own trigger (completed 2026-10-18)
- [ ] **Phase 8: Multi-IM Expansion & Two-Way Sync** - Teams parity plus signed inbound webhooks that notify the original submitter
- [ ] **Phase 9: Production Readiness â€” Compliance, Observability & Load** - 3-year auditable trail, erasure/purge workflows, full metric + alert suite, 1,000-user load test

## Phase Details

### Phase 1: Foundations & Platform

**Goal**: As a platform engineer, I want to run the api, worker, and scheduler processes from a clean checkout on pinned versions, so that every irreversible design commitment and requirement-conflict ruling is proven in code before any user-facing feature is written.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08, FND-09, FND-10, LNK-07, RTE-10, AUD-10, DAT-13, OBS-01
**Success Criteria** (what must be TRUE):

  1. A fresh clone runs `npm ci` with no peer-dependency error, and `.nvmrc` plus the committed `package-lock.json` pin Node 24 LTS and TypeScript 6.0.3 â€” a deliberate install with the lockfile deleted is what the guard exists for, not routine installs.
  2. `api`, `worker`, and `scheduler` each start as separate processes and each answers `/health/live` (checks no dependency) and `/health/ready` (checks MongoDB plus **both** Redis deployments); a Redis blip fails readiness without restarting a healthy pod.
  3. A module that imports across a declared component boundary fails the build; a compliant tree passes, and the three entrypoints cannot drift into one process.
  4. A log line carrying a user email is dropped by the serialiser, and no `submission_id` is recoverable from the OpenTelemetry trace ID â€” both proven by test, because neither is fixable once production logs exist.
  5. The read-link JWT claim shape and the decision wire contract (including `choice.verified` and `state.force_clarification`) are published as versioned schemas with a frozen-field test, so adding a claim is a failing test rather than a deploy that breaks every outstanding link.

**Plans:** 11/11 plans complete (10 shipped + 1 gap closure)
**Gap closure (2026-10-05):** UAT on the shipped phase found **G1** â€” no `.env.example`, no compose file, and no run documentation, while `01-10-SUMMARY.md:402` records D-11 as a "documented local full-stack run". Closed by `01-11-PLAN.md` (`gap_closure: true`), delivered and reviewed at 0 blockers. Reconciled as `resolved` in `01-UAT.md`. `phase.complete` was deliberately **not** run â€” see WINDOWS #17, which records it clobbering the FND-10 / AUD-10 / DAT-13 deferrals. Two UAT items remain human decisions, not verification tasks: the pino `msg` ruling (WINDOWS #5) and the KMS vendor (B-3 / D-27, which holds FND-10 Pending and gates Phase 5).
**Verification (2026-10-03):** `gaps_found` â€” SC#3 failed on the subpath import form (gap G-1) and one advisory on `CryptoModule` composition. **Both closed the same day** (`44b0619`, `f813f64`); the verifier re-runs before Phase 2. FND-10 remains **pending** â€” composing `CryptoModule` makes the guard reachable from a real boot, it does not produce a KMS-backed key.
**Wave 1**

- [x] 01-01-PLAN.md â€” Workspaces scaffold, pinned toolchain, CI install guard, and the `api` boot tracer

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md â€” Zod boot config, the two-deployment Redis split, and the ioredis connection profiles
- [x] 01-03-PLAN.md â€” Build-failing module boundaries and the per-app boot boundary assertion
- [x] 01-04-PLAN.md â€” PII-safe structured logging with a frozen allowlist enforced before serialisation
- [x] 01-06-PLAN.md â€” Frozen JEV v1 wire contract, read-link claim schema, and contract skeletons

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-05-PLAN.md â€” `KeyProvider`, the AES-256-GCM envelope, and the production key guard
- [x] 01-07-PLAN.md â€” Three-container test harness, native-driver Mongo, and per-dependency readiness
- [x] 01-08-PLAN.md â€” BullMQ queue registration, `{akane-q}` prefix, heartbeat scheduler, and business metrics

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-09-PLAN.md â€” OTel bootstrap, span-attribute allowlist, and the single Prometheus metrics path

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 01-10-PLAN.md â€” Compose the three app graphs, the ESM bootstrap shape, and the entrypoint-drift test

**Wave 6** *(gap closure â€” blocked on Waves 1â€“5 completion; ran on the shipped tree)*

- [x] 01-11-PLAN.md â€” Document the boot contract: `.env.example`, `compose.dev.yml`, run section, and a spec that performs the documented start for real (G1)

**Notes**: Two Redis deployments are split from day one â€” BullMQ requires `maxmemory-policy=noeviction` while the cache wants eviction, and the policy is instance-wide. Rate limiting is **per user and per link `jti`, never per IP**, and blocks only on signature failure (`NFR-SEC-10` loses). `FR-D-12` write-once is **amended** to a single-send guarantee plus a per-connector `supports_idempotency_key` flag. The Â§15.4 erasure promise is narrowed to PII-excluded-by-allowlist + tombstonable `actor_ref` + defined purge windows.
**Discovery required in this phase**: (a) resolve the Form.io `File` component licensing question â€” it is premium while the renderer is MIT â€” and drop `FR-F-10` plus its dependent object-storage gap if it cannot be rendered unlicensed; (b) decide the draft-save token model, since a resumable draft needs a second, longer-lived token class incompatible with the stateless one-time-token SPA.
**Spike**: S3 â€” SAML need confirmation. This is a **customer** question, not a technical one: which IdP, and does it support OIDC? OIDC covers Entra ID, Okta, Auth0, Google Workspace, Keycloak. If SAML is genuinely required, add 2â€“3 weeks for `@node-saml/node-saml`.

### Phase 2: The Vertical Slice â€” Slack + Internal Routing

**Goal**: An employee completes a real cross-system task entirely from Slack plus one rendered form, with identity resolved, permissions enforced twice, and an auditable submission record.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: IDN-01, IDN-02, IDN-03, IDN-04, IDN-06, IDN-07, ACL-01, ACL-02, ACL-03, ACL-04, ACL-06, ACL-07, ACL-08, ACL-09, ACL-11, IM-01, IM-02, IM-03, IM-04, IM-05, IM-06, IM-07, IM-08, IM-09, IM-11, APP-01, APP-02, APP-04, FRM-01, FRM-02, FRM-03, FRM-04, FRM-06, FRM-07, FRM-08, LNK-01, LNK-03, LNK-04, LNK-09, LNK-10, LNK-11, LNK-12, DAT-02, DAT-08, DAT-09, AUD-01, AUD-02
**Success Criteria** (what must be TRUE):

  1. A pre-provisioned employee types `/leave request` in Slack, receives a signed link, fills the rendered form, and gets a confirmation **in the same thread** carrying the submission's ID â€” without ever opening another system.
  2. Replaying the submit request produces exactly one submission, and an integration test that **kills Redis mid-submit** also produces exactly one submission â€” the MongoDB unique index is the guarantee, `GETDEL` is only the fast path.
  3. An unmapped user receives plain-language onboarding instructions in chat, never a raw system error; a deactivated mapping stops future resolution while that user's historical submissions remain readable.
  4. Removing a user's permission from an app takes effect on the very next request â€” with no restart and no dependence on a cache-invalidation message arriving â€” and a denial names the missing permission. No user exceeds 10 requests/minute and no app exceeds 100 requests/minute without a clear rate-limit message.
  5. Every state change writes an append-only audit entry recording actor, action, target, previous state, and new state; success and failure produce two **distinct**, actionable Slack messages; a duplicate platform delivery produces one processing job.

**Plans**: TBD

- [x] 02-01-PLAN.md
- [x] 02-02-PLAN.md
- [x] 02-03-PLAN.md

**UI hint**: yes
**Notes**: The largest phase by requirement count and the one that makes every architectural assumption load-bearing while the codebase is small. Internal routing only â€” the connector/BullMQ/outbox surface is deliberately excluded. Identity is **CSV pre-provisioning only**; OTP onboarding adds a Redis state machine, brute-force policy, and lockout flow that the demonstrable capability does not need, so it moves to Phase 6. `perm_version` is embedded in the RBAC cache key so the epoch primitive serves both the cache and (later) the read path; Pub/Sub becomes a latency optimisation, never the correctness mechanism. Enqueue idempotency is a **MongoDB unique index on the platform event ID**, not a BullMQ `jobId` flag, because `jobId` dedup lapses on `removeOnComplete`. Slash commands ack **empty** and deliver via `response_url` â€” Slack permits only 5 responses per 30 minutes.
**Research**: not required â€” every component is a single well-documented pattern. Large but unambiguous.

### Phase 3: Natural-Language Routing

**Goal**: A user reaches the right app by describing what they want in plain language, and the system still routes correctly when every hosted decision provider is down.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: RTE-01, RTE-02, RTE-03, RTE-04, RTE-05, RTE-06, RTE-07, RTE-08, RTE-09, RTE-11, OBS-02
**Success Criteria** (what must be TRUE):

  1. A user types "I want to request leave" and receives the same signed form link they would get from `/leave request`.
  2. A user without permission on an app never sees it offered, and the decision provider's request payload contains only the apps that user can actually open â€” never the global catalogue.
  3. When the hosted provider is unreachable or slow, the request still returns a routing decision inside the 2-second chat-to-link budget by propagating a deadline down the fallback chain to a local rule-based provider. The user never sees an error.
  4. A request whose best match falls below the app's confidence threshold produces a clarifying question rather than the wrong app's form, and an ambiguous or malformed request degrades gracefully.
  5. Every provider â€” including the rule-based one â€” passes a conformance suite of 50 labelled intents and degrades gracefully on an empty tool list, unknown input, and a malformed request; accuracy is reported **per app with a confidence interval**, never as a single number.

**Plans**: 3/3 plans executed

- [x] 03-01-PLAN.md â€” Tracer: RBAC-filtered local routing slice through the worker, rule-based provider, verified===true gate
- [x] 03-02-PLAN.md â€” Config-ordered provider chain, absolute deadline, 60s health probes, RTE-09 cache
- [x] 03-03-PLAN.md â€” Clarification sessions, redaction fail-safe, RTE-11 conformance suite, OBS-02 stage spans

**Needs**: **`AI-SPEC.md` via `/gsd-ai-integration-phase 3`** â€” this phase introduces an AI system. The provider choice, host, and cost profile were explicitly out of scope for stack research and were never covered.
**Research (highest need in the roadmap)**: `/gsd-plan-phase 3 --research-phase`. Tool-selection accuracy at 100â€“800 candidates was **not retrievable**; the PRD's ">90% accuracy" and "p95 <500 ms" targets are not jointly achievable as specified. A 50-item conformance set cannot cover a 600-tool catalogue. Report measured behaviour against the contract in Phase 1 (`RTE-10`), not against the PRD's headline numbers.
**Notes**: `RuleBasedProvider` ships **first** and is the terminal link in the chain â€” the system has no routing path at all without it. No third-party call, confidence threshold, or model latency goes on the critical path of the Phase 2 slice; the slice's deterministic routing is upgraded, not retrofitted. Swap any provider by config only. The trace's stage list becomes final here, so `OBS-02` is verified now rather than after Phase 5's work lands.

### Phase 4: Read Path & Query DSL

**Goal**: A 90-day view or query link lets a user read their own data with no stored session, and dies the instant their permission changes.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: LNK-05, LNK-06, LNK-08, DAT-10, DAT-11, DAT-12
**Success Criteria** (what must be TRUE):

  1. A user opens a view link in a browser with no cookie set and sees only their own submission; the link verifies with the **public key alone**, which is why signing is asymmetric.
  2. Revoking that user's permission makes the already-issued link fail on the next click, and the failure is recorded with a distinct reason â€” expired, consumed, revoked, wrong app, wrong version, deactivated user, or bad signature â€” not one aggregate counter.
  3. A manager holding `view_all` sees the whole team's records; a regular user never sees another user's records, including soft-deleted rows, and one filter builder emits both `real_user_id` and `deleted_at: null` so neither can be omitted.
  4. Rotating the signing key invalidates nothing: links signed by the previous key keep working through the zero-downtime dual-key window, and a new key can be added without touching live links.

**Plans**: TBD

- [x] 04-01-PLAN.md
- [x] 04-02-PLAN.md
- [x] 04-03-PLAN.md
- [x] 04-04-PLAN.md
- [x] 04-05-PLAN.md
- [x] 04-06-PLAN.md
- [x] 04-07-PLAN.md
- [x] 04-08-PLAN.md
- [x] 04-09-PLAN.md
- [x] 04-10-PLAN.md

**UI hint**: yes
**Notes**: Highest-risk, highest-value work in the roadmap, and the reason it is adjacent rather than later. Deliberately **not** merged with Phase 5 â€” a slip here must not consume the App Builder's slack. `perm_version` is the shared primitive with the Phase 2 RBAC cache; the JWT claim shape was frozen in Phase 1 for exactly this reason. The Query DSL is an **authorization surface with no test precedent** â€” raw MongoDB query syntax is never exposed to an app builder.
**Research**: `/gsd-plan-phase 4 --research-phase` â€” the Query DSL authorization surface and the seven revocation events. `DAT-12` mandates one test per DSL construct asserting the injected filters survive it.

### Phase 5: Integration & Async Execution

**Goal**: A submission can land in a downstream enterprise system through a shared connector â€” synchronously to internal storage, asynchronously externally, or both â€” and a failure is visible rather than silent.
**Mode:** mvp
**Depends on**: Phase 4 (and structurally on Phase 2's submission record)
**Requirements**: DAT-01, DAT-03, DAT-04, DAT-05, DAT-06, DAT-07, DAT-14, CON-01, CON-02, CON-03, CON-04, CON-05, CON-06, CON-07, CON-08, CON-09, CON-10, LNK-02, OBS-04
**Success Criteria** (what must be TRUE):

  1. A hybrid submission confirms in chat the moment the internal write commits; the Redmine ticket appears seconds later; and if Redmine is down the submission shows as **`partial`** on the user's own status page rather than disappearing.
  2. A failed connector call retries with exponential backoff, then lands in a dead-letter queue a platform admin can view and retry by hand; the outbound request is never sent for an internal write that did not commit.
  3. Nothing in `sent_unconfirmed` is ever auto-resent â€” the reconciliation job retries only `not_sent`, because an unconfirmed send may already have reached Redmine.
  4. An edit link can be reopened repeatedly but consumes on submit, and a second submit returns the original confirmation rather than creating a duplicate record.
  5. A connector's rate limit is enforced **per connector instance and shared across every app referencing it** (CON-05), so one app's traffic spike cannot starve the other apps by exhausting a private budget â€” `app_id` is the *attribution* label on those metrics (CON-06), not a separate allowance; a rejected credential alerts separately from an unreachable endpoint; and changing an app's connector reference is a separately audited mutation. *(Amended 2026-10-11 â€” see `05-GAPS.md` G-12: the original clause read "one app's traffic spike fails that app and not every app sharing the connector", which contradicted CON-05; CON-05 was ruled authoritative and no code changed.)*

**Plans**: 9/9 plans executed
**Wave 1**

- [x] 05-01-PLAN.md â€” Tracer: connector seam, boundary edge, credential store, transactional outbox, relay + delivery

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 05-02-PLAN.md â€” Field-mapping resolver, HTTPâ†’taxonomy split, Redmine contract spec
- [x] 05-03-PLAN.md â€” Data-mode routing, `partial` outcome, atomic outbox commit + repository
- [x] 05-04-PLAN.md â€” Backoff/DLQ budget, per-revision idempotency, reconciliation sweep
- [x] 05-05-PLAN.md â€” Real Redis ThrottlerStorage + business metrics (`submission_status`, connector counter)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 05-06-PLAN.md â€” Operator CLI: connector seed, `dlq list`/`retry`, audited `connector_ref` rebind
- [x] 05-07-PLAN.md â€” "My submissions" status surface via the frozen query action

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 05-08-PLAN.md â€” Edit link: atomic consume-on-submit, new revision + D-95 replay

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 05-09-PLAN.md â€” Renderer surfaces Aâ€“D, self-hosted FormIO, package-legitimacy gate

**UI hint**: yes
**Notes**: The hardest correctness surface in the system. The outbound state is modelled as **exactly three** states â€” `not_sent | sent_unconfirmed | confirmed` â€” and `sent_unconfirmed` is committed *before* the outbound call, because the PRD cannot express the gap between "sent" and "confirmed" and puts the idempotency guarantee on the wrong side of the wire. `FR-D-12` is implemented as the amended single-send guarantee recorded in Phase 1, surfaced to the builder at publish time. Connectors are **globally managed** â€” an app references a connector and never owns its credentials. `DAT-14` lands here because `partial` is unreachable before this phase.
**Research**: `/gsd-plan-phase 5 --research-phase` â€” per-connector contract research for **Redmine**: field mapping, idempotency-key support, and error taxonomy. The transactional outbox pattern is well-understood; the Redmine contract is not.

### Phase 6: Self-Service App Builder

**Goal**: A department admin builds, secures, and publishes a working app end-to-end without an engineering ticket and without a platform admin's help.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: BLD-01, BLD-02, BLD-03, BLD-04, BLD-05, BLD-06, BLD-07, BLD-08, BLD-09, BLD-10, BLD-11, BLD-12, APP-03, APP-05, APP-06, APP-07, APP-08, APP-09, FRM-05, FRM-09, IDN-05, IDN-08, ACL-05, ACL-10, OBS-05
**Success Criteria** (what must be TRUE):

  1. A department admin signs in with corporate SSO (OIDC, MFA), creates a working app in **five wizard steps or fewer** without documentation, and publishes it â€” with the change-summary confirmation, the routing dry-run that blocks a >5-point routing-share drop for any existing app, and the description-collision check all enforced.
  2. A department admin publishes an **external or hybrid app after requesting a connector**, with no platform admin creating credentials for them. `FR-C-2` + `FR-C-10` + Â§12.4 otherwise mean the Redmine, HR, and ERP use cases that justify this product are unreachable by the people it is for â€” an org-chart dependency inside a self-service promise.
  3. An employee with no CSV mapping self-onboards by OTP from Slack â€” 10-minute expiry, 3 attempts, 30-minute lockout â€” and can immediately use an app they were granted; an admin can also map an SSO identity without the user verifying anything.
  4. A submission viewer lists an app's submissions with filters, a detail view, and an export; ownership transfer requires global admin approval and auto-cancels after 7 days; a delegated workflow manager operates the app without holding ownership.
  5. The builder is usable on a tablet, every async operation shows a loading skeleton, and every error is inline, specific, and actionable â€” never a generic "something went wrong".

**Plans**: 12/12 plans executed â€” 8 executed, 4 gap-closure pending

Plans:
**Wave 1**

- [x] 06-01-PLAN.md â€” Spike S1: FormIO 5.6.1 builder mount, snapshot undo/redo, 5.x shape verification, SPA shell, boundary extension (package-legitimacy gate)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 06-02-PLAN.md â€” Builder auth: OIDC authorization-code + PKCE login, Redis session with __Host- cookie, MFA claim gate, auto-provision, IDN-08 SSO mapping

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 06-03-PLAN.md â€” IDN-05 OTP self-onboarding: Redis state machine (10-min / 3-attempt / 30-min lockout) wired into the chat pipeline

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 06-04-PLAN.md â€” App definitions: draft CRUD, 20-version retention + rollback, lifecycle state machine, D-31 template gallery with snapshot forks, G-11 saved-query store replacement

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 06-05-PLAN.md â€” Publish gate: APP-07 routing dry-run through the real orchestrator (>5-point share drop blocks), APP-08 description collision, BLD-06 change summary, OBS-05 routing_share{app_id} metric

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 06-06-PLAN.md â€” Connector requests (BLD-10, D-97..D-100: definition minus secret, operator-provisioned terminal state), submissions viewer + visible-column CSV export (BLD-08/D-111), field-mapping endpoint (BLD-05)

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 06-07-PLAN.md â€” SPA core: 5-step wizard (BLD-01), tabbed editor (BLD-02), FormIO designer with undo/redo + conditional/validate + sandbox preview (BLD-04/FRM-05/FRM-09), roles + autocomplete + @casl/ability (BLD-03/ACL-10/BLD-11), skeletons + inline errors (BLD-07/BLD-09)

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 06-08-PLAN.md â€” SPA surfaces: live-data dashboard (D-112), submissions/connectors pages, users page (IDN-08 + ACL-05 transfer with 7-day auto-cancel), audit browse, template gallery + tag filter, settings stub (D-109)

**Gap closure** *(from 06-UAT.md: G-06-4, G-06-6, G-06-7, G-06-8)*

**Wave 9** *(depends on Wave 8)*

- [x] 06-09-PLAN.md â€” G-06-6: a scoped, selector-prefixed Bootstrap 5 stylesheet from a checked-in generator, consumed by the designer canvas and preview pane, with a computed-style layout guard (BLD-04, FRM-09)
- [x] 06-11-PLAN.md â€” G-06-4: one publish confirmation gate both the button and Ctrl/Cmd+S route through, plus the dirty-JSON guard that blocks the chord (BLD-06)
- [x] 06-12-PLAN.md â€” G-06-7: the designer's return path back to the wizard resuming the step left with in-progress input preserved, via a route-encoded step and a session-scoped snapshot (BLD-01)

**Wave 10** *(blocked on Wave 9)*

- [x] 06-10-PLAN.md â€” G-06-8: the signer renderer consumes the same scoped stylesheet, gains its own dev server and Playwright projects, and the UAT record gains renderer coverage (FRM-09)

**UI hint**: yes
**Notes**: Highest-value, lowest-risk slice: by now the APIs are stable, so this is a CRUD skin rather than a design against moving targets. Research explicitly resolved the DH-2 tension by **not** moving the builder earlier. The pre-builder story is made credible by shipping the **~10-app seed template gallery plus tag filtering** (`APP-09`) â€” do not drop it. Editing a published form must not disturb an in-flight submission.
**Spike**: S1 â€” **FormIO 5.6.1 migration, blocks this phase.** Half-day: render and build a representative form, port one Bootstrap-4-era template, verify `component.errors` and `EditGrid.validateRows` changes. `@formio/js` 5.x has *fewer* weekly downloads (52K) than the 4.x it replaces (57K), so most docs and examples online are still 4.x. Fallback is `formiojs@4.21.7` (MIT, maintenance mode) â€” acceptable, but it must be a decision, not drift.
**Research**: `/gsd-plan-phase 6 --research-phase` â€” FormIO builder integration (spike S1) and the connector-request workflow, which is a new flow with no PRD section.

### Phase 7: Multi-Form Apps & Per-Form Triggers

**Goal**: A department admin ships **one app that serves a full CRUD experience** — separate create, list, view and edit forms over one shared collection, one role set and one routing destination — with each form activated by its own trigger.
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: APP-11, APP-12, FRM-14
**Success Criteria** (what must be TRUE):

  1. An app declares **more than one form**, each with a declared kind — `submit` (new), `list`, `view` (show), `edit` — laid out independently and versioned independently, so one form's schema change never moves another form's version.
  2. A trigger (intent or slash command) resolves to **exactly one form**, not the app: two forms in one app can be activated by different triggers, and a trigger that resolves to more than one form is rejected at publish, not at routing time.
  3. Every form in an app reads from and writes to the **same collection**, with the **same role assignments** and the **same data-routing destination** — a record created through the `submit` form is visible through the `list`/`view` forms to the same users, with no per-form collection, per-form roles, or per-form connector.
  4. The read path stops being a separate link class: a `list` or `view` form's signed link is issued by the same form-driven path as a `submit` form's link, and a `view` link still dies the instant the user's `perm_version` changes.
  5. Editing a published form changes nothing for an in-flight submission of **that** form and nothing at all for the app's other forms; a submission records the `form_id` it was created through alongside that form's `form_version`.

**Plans:** 8/8 plans complete
**Plans list:**

**Wave 1**

- [x] 07-01-PLAN.md — Tracer: the atomic `forms[]` cutover — contract schemas + bijection, domain document/repository/service/gate, 10 seeds, SPA wizard/designer save path, forms-fixture, full-suite sweep
- [x] 07-05-PLAN.md — U-1…U-6 undepicted-surface design rulings (six blocking decision checkpoints; no auto-select)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 07-02-PLAN.md — retire the `triggers` section (13→12): contract enum + four mirror lists + drift-guard spec + editor/permission-matrix shrink
- [x] 07-03-PLAN.md — seed gallery goes multi-form: per-kind `config` validation, `list`/`show` forms in seeds, stale `provisioning/forms` artifact removed
- [x] 07-04-PLAN.md — two-collection idempotent migration (`apps` + `app_definition_versions` snapshots), role-grant rewrite, api + worker boot wiring

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 07-06-PLAN.md — Forms tab becomes the form manager (rows, add/remove by kind per U-3/U-4/U-6, Versioning card, submission-survival test, e2e)
- [x] 07-08-PLAN.md — publish-gate rules (≥1 submit, trigger→form uniqueness, D-08 kinds, config completeness) + form-derived catalog (RBAC-filter-before-projection) + worker de-hardcode + form-driven issuance (SC#2/SC#4)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 07-07-PLAN.md — per-form designer `?form=` + U-1 in-form trigger panel + U-2 `list`/`show` config surfaces + designer e2e

### Phase 8: Multi-IM Expansion & Two-Way Sync

**Goal**: A Microsoft Teams employee gets the identical experience, and an external system can push status back to the person who originally submitted.
**Mode:** mvp
**Depends on**: Phase 7
**Requirements**: IM-10, NOT-01, NOT-02, NOT-03, NOT-04, NOT-05
**Success Criteria** (what must be TRUE):

  1. A Teams employee requests leave through the same plain-language and slash-command paths as a Slack employee, and receives the same signed link and threaded confirmation â€” same normalized event contract, no Teams-specific code path in the kernel.
  2. Redmine pushes a signed status webhook mapped from its entity ID to a `submission_id`; the original submitter receives an IM notification whose deep link opens **only that person's** record.
  3. A replayed webhook â€” stale timestamp or reused nonce â€” is rejected and logged, and IM delivery failure retries three times rather than disappearing.
  4. A connector that cannot sign its webhooks has a documented alternative trust mechanism recorded per connector and visible to the platform admin.
  5. A Teams outage queues and retries the user's request; no failure is silent to the user.

**Plans**: 9/9 plans executed

Plans:
- [x] 08-01-PLAN.md — Teams adapter foundation: normalized contract parity with the Slack path (InboundEvent/OutboundMessage only across the boundary)
- [x] 08-02-PLAN.md — Teams adapter skeleton: controller, outbound service, auth guard scaffold
- [x] 08-03-PLAN.md — external webhook receiver: controller, nonce store, enqueue with retry options
- [x] 08-04-PLAN.md — notification enqueue path + consumer scaffold
- [x] 08-05-PLAN.md — gap closure (wave 1): full build gate green (21 ESLint + tsc errors in Phase 8 files)
- [x] 08-06-PLAN.md — gap closure (wave 3): real Teams receiver — D-06 urlVerification challenge handshake, authorizeJWT guard, Mongo unique-index dedupe on the platform event id, fail-closed short-timeout storage, <200 ms ack, consumer-side RBAC/routing spec
- [x] 08-07-PLAN.md — gap closure (wave 4, requires 08-06): timing-safe per-connector HMAC over the raw body, replay rejection proven against real Redis with logged rejections, entity-reference→submitter lookup chain with user-bound notification link
- [x] 08-08-PLAN.md — gap closure (wave 5): `notification:send` WorkerHost consumer in the worker, Teams delivery via stored conversation references with D-13 jittered retry + terminal-failure audit + user-visible failure notice, NOT-05 per-connector trust records with admin listing
- [x] 08-09-PLAN.md — gap closure (wave 2, split from 08-05): shared queue-name constants + api producer registration per D-37 named exception + rawBody capture + D-13 jittered notification enqueue options

**Notes**: The adapter is now a *known* shape â€” Phase 2 defined the `InboundEvent`/`OutboundMessage` contract â€” so adding a platform is additive rather than inventive. Teams uses `@microsoft/agents-hosting` 1.9.1 + `-msteams`; the Bot Framework SDK is retired (support ended 2025-12-31) and the package the PRD names does not exist on npm. **Zalo and Telegram are v2** â€” this phase does not include them, which is why spike S2 does not block the critical path.
**Research**: `/gsd-plan-phase 8 --research-phase` â€” Microsoft Teams activity-delivery retry semantics beyond retry-on-429/502; the relevant Microsoft Learn pages returned 404 during research.

### Phase 9: Production Readiness â€” Compliance, Observability & Load

**Goal**: The deployment is operable at target scale and can answer a compliance question about any action taken in the last three years.
**Mode:** mvp
**Depends on**: Phase 8
**Requirements**: AUD-03, AUD-04, AUD-05, AUD-06, AUD-07, AUD-08, AUD-09, OBS-03, OBS-06, OBS-07, OBS-08, OBS-09, OBS-10
**Success Criteria** (what must be TRUE):

  1. A global admin can answer "who changed what, when, and from where" for any of the last three years, searching by user, app, action, and date range, and can export that trail as CSV or JSON Lines. Archived apps' data stays queryable for compliance.
  2. An erasure request nulls the actor reference on audit rows **without deleting a single audit row**, and a purge soft-deletes first then hard-deletes after a 30-day grace period with operator ID and timestamp recorded.
  3. A quarterly access-review report is produced without manual work, naming who holds access to what.
  4. A load test at **1,000 concurrent users and 50 IM events/second** passes, and reports the **measured** Redis cost of the three-tier throttler rather than assuming it.
  5. Each of the seven named alert conditions fires in a test â€” including `submission_status{status="partial"}` and all decision providers unhealthy â€” and a runbook exists for each of the five named incidents.

**Plans**: 4/6 plans executed
Plans:
**Wave 1**
- [x] 09-01-PLAN.md — Durable audit store (Mongo `audit_entries`), single delete owner + guard test, retention sweep with self-audit entry, two-phase purge with terminal `purged` lifecycle, console archived/purged marking (AUD-03, AUD-08, AUD-09) — wave 1

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 09-02-PLAN.md — Closed audit-entry shape with `*_ref` fields, `GET /audit` search + `ip`, JSONL export, quarterly access review, `erase-actor` CLI erasure (AUD-04, AUD-05, AUD-06, AUD-07) — wave 2
- [x] 09-03-PLAN.md — Metric registry + OBS-03 instruments + five incident runbooks (OBS-03, OBS-10) — wave 2

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 09-04-PLAN.md — Eight alert rules with promtool fire/no-fire tests, Grafana dashboards, log retention (OBS-06, OBS-07, OBS-09) — wave 3
- [ ] 09-06-PLAN.md — WINDOW 7 key rotation: wrapped-DEK envelope, `kid` keyring, zero-downtime rotation CLI + runbook (OBS-10) — wave 3

**Wave 4** *(blocked on Wave 3 completion)*
- [ ] 09-05-PLAN.md — Three-tier throttler over hand-written Redis storage, k6 load test, measured Redis commandstats cost (OBS-08) — wave 4

**UI hint**: yes
**Notes**: `AUD-04` is the concrete encoding of conflict #2 â€” `actor_ref` is tombstoneable precisely because Phase 1 decoupled the trace ID from `submission_id`. Conflict #3's narrowed erasure promise is delivered *here* as the combination of Phase 1's log allowlist, `AUD-04`'s tombstone, and `AUD-08`'s defined purge windows. **Do not promise full erasure of the audit record**, and do not present the "legitimate interest" framing as settled â€” that is a legal question for counsel, not a research question. Zero-downtime rolling deploys and zero-downtime key rotation are verified here.

---

## Timing

**Total: ~47 weeks P50 (range 42–53).**

This **supersedes** the inherited 26â€“34 week figure in PROJECT.md. That figure was never re-derived
against an 8-phase structure â€” `research/SUMMARY.md` supports the *order* strongly but explicitly
did not estimate *durations*. Reusing it would have been dishonest.

| Phase | Name | P50 | Range |
|-------|------|-----|-------|
| 1 | Foundations & Platform | 3.5 wk | 3â€“4 |
| 2 | The Vertical Slice | 8 wk | 7â€“9 |
| 3 | Natural-Language Routing | 4.5 wk | 4â€“5 |
| 4 | Read Path & Query DSL | 3.5 wk | 3â€“4 |
| 5 | Integration & Async Execution | 7 wk | 6â€“8 |
| 6 | Self-Service App Builder | 9 wk | 8â€“10 |
| 7 | Multi-Form Apps & Per-Form Triggers | 4 wk | 3.5–4.5 |
| 8 | Multi-IM Expansion & Two-Way Sync | 3 wk | 3â€“4 |
| 9 | Production Readiness | 4.5 wk | 4â€“5 |

**Basis:**

- **Throughput assumption: one engineer + one implementer agent.** No team, no parallel human
  streams. `config.parallelization: true` parallelises plans and waves *within* a phase; it does not
  add people. This is the single largest driver of the total.
- Each figure includes planning, execution, verification, code review, and human UAT â€” not just
  coding. `human_verify_mode: end-of-phase` is assumed throughout.
- Phases 2 and 6 are sized by surface, not by requirement count: Phase 2 carries 47 requirements
  because a vertical slice touches identity, authz, adapters, a renderer SPA, links, submissions,
  audit, and throttling; Phase 6 carries 25 because the drag-and-drop form builder, admin SSO, and
  the connector-request flow are each substantial on their own.
- Phase 3 is sized for **unknown** provider cost, not for the requirement count (11). The AI-SPEC
  and the research pass land inside this phase.
- **Includes** spikes S1 (half-day, Phase 6) and S3 (Phase 1 discovery).
- **Excludes** all 29 v2 requirements, all Phase 8 post-MVP scope, and legal review time for the
  audit-retention framing.
- **Contingency, not included:** if spike S3 shows SAML is genuinely required, add **2â€“3 weeks**
  for `@node-saml/node-saml`, which has been unmaintained since 2025-07-21 and needs its own spike
  before entering any phase.
- **Delta vs the inherited 26â€“34 weeks** is +9 to +17, driven by: v1 scope now includes Teams *and*
  the App Builder *and* Redmine *and* full compliance tooling; the read path moved into v1; and the
  estimate is bottom-up from per-phase surfaces instead of the PRD's 5-phase layer sequence.

---

## Progress

**Execution Order:** Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundations & Platform | 10/10 | Complete    | 2026-10-03 |
| 2. The Vertical Slice | 3/3 | In Progress|  |
| 3. Natural-Language Routing | 3/3 | In Progress | - |
| 4. Read Path & Query DSL | 9/10 | In Progress|  |
| 5. Integration & Async Execution | 9/9 | In Progress|  |
| 6. Self-Service App Builder | 12/12 | Complete    | 2026-10-17 |
| 7. Multi-Form Apps & Per-Form Triggers | 8/8 | Complete    | 2026-10-18 |
| 8. Multi-IM Expansion & Two-Way Sync | 9/9 | In Progress|  |
| 9. Production Readiness | 4/6 | In Progress|  |

---
*Roadmap created: 2026-10-01 â€” v1, 145/145 requirements mapped across 9 phases*
