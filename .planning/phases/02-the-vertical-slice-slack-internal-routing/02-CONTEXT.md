# Phase 2: The Vertical Slice — Slack + Internal Routing - Context

**Gathered:** 2026-10-05
**Status:** Ready for planning

<domain>
## Phase Boundary

One demonstrable loop, end to end: an employee types `/leave request` in Slack, receives a signed link, fills a rendered form in a browser, submits, and gets a distinct confirmation **in the same Slack thread** carrying the submission ID — with `chat_user_id` resolved to `real_user_id`, permissions enforced twice, one-time link security, an internal MongoDB write, and an append-only audit entry.

**Internal routing only.** The connector / BullMQ-outbox / DLQ surface is deliberately excluded — that is Phase 5.

### What this phase does NOT own, confirmed against the requirement traceability

| Not in Phase 2 | Where it lands | Consequence for the plan |
|---|---|---|
| JEV / natural-language routing (`RTE-01`…`RTE-09`) | Phase 3 | Routing here is **deterministic**: a slash command resolves to an app by declaration. No decision-model call exists to place, so `ACL-06`'s *first* check ("before any decision-model call") has no model to precede. `ACL-06`'s **second** check, at the execution boundary, is the one that binds. |
| Edit links (`LNK-02`), draft-save (`FRM-12`) | Phase 5 | `create` is the **only** write link this phase emits. |
| Read links (`LNK-05`, `LNK-06`, `LNK-08`) | Phase 4 | The `action`-branching verifier in D-39 exists so read links can be added without revisiting the frozen claim set. |
| OTP self-onboard (`IDN-05`), SSO identity mapping (`IDN-08`) | Phase 6 | Identity is CSV-only, by design, not by omission. |
| Conditional logic / validation authoring (`FRM-05`), form preview (`FRM-09`) | Phase 6 | `FRM-05` being Phase 6 means the seeded form schemas ship with whatever validation they need inline; the authoring surface is not built. |
| Connector execution (`CON-01`…`CON-10`), external data routing (`DAT-01`, `DAT-03`…`DAT-07`) | Phase 5 | `DAT-03`'s `{{real_user.attribute}}` mapping has no consumer yet, which is part of why D-43's profile store matters. |
| Ownership transfer (`ACL-05`), attribute-based role assignment (`ACL-12`) | Phase 6 / v2 | No permission path may read a profile attribute. See the prohibition below. |

</domain>

<decisions>
## Implementation Decisions

Numbering continues from Phase 1's `D-01`…`D-30`.

### Pre-provisioning surface

Phase 2 has no App Builder (Phase 6) and — decisively — **no admin authentication at all**: `D-30` ruled OIDC the plan of record and `BLD-12` puts the first SSO surface in Phase 5. Yet `SC#1` starts from "a pre-provisioned employee" and `IDN-02`, `IDN-07`, `ACL-01`…`ACL-03`, `APP-01`…`APP-04` and `FRM-01` all need data to exist.

- **D-31:** Pre-provisioning is **committed seed files plus an idempotent CLI loader** — no HTTP admin surface in this phase. Identity CSV, app definitions, FormIO schemas and role seeds live under a committed `provisioning/` tree; a command upserts them into MongoDB. Diffable and reviewable in git, reusable by CI and testcontainers, and it sidesteps the missing admin auth instead of working around it. `IDN-07`'s "an admin can search mappings" is a read-only query in the same command, not a product surface.
  *Rejected:* a platform-admin HTTP API (real and reusable by Phase 6, but new surface with **no authentication behind it in this phase**, every mutation needing an `AUD-01` entry, plus rate limits and an OpenAPI contract before anything else in the phase is finished). One-shot seeding with no capability (cheapest, but marks `IDN-02`/`IDN-07` delivered without shipping what they describe — the pattern Phase 1's verifier was written to catch). — **Reversibility:** costly. Phase 6 replaces the files with real authoring, so the *loader* must be separable from the *file format* or Phase 6 inherits a bespoke parser.

- **D-32:** An identity mapping is uniquely keyed on **`{platform, chat_user_id}`**, with `real_user_id` as payload. Resolution direction stays `chat → real`, which is what `IDN-01` requires and what the `ak:rbac:{app_id}:{real_user_id}:{perm_version}` cache key is built on. Re-importing a corrected CSV therefore **deliberately rebinds** a chat account, and that rebind is an explicit, audited operator action rather than a side effect. Historical submissions are unaffected: `AUD-02` stores the user's own `real_user_id` on the audit row, so a rebind never rewrites history.
  *Rejected:* `{real_user_id, platform}` as the key — reads `IDN-03` most literally but does not stop one `chat_user_id` appearing against two `real_user_id`s, which is precisely the case resolution must never allow. Both directions indexed (strictest, but makes `IDN-03`'s multi-platform case a load-time failure before Phase 7 needs it). — **Reversibility:** costly. The unique index is the dedupe guarantee for resolution.

- **D-33:** The loader **never un-deactivates**. It upserts creates and rebinds but will not clear a non-null `deactivated_at`; deactivation is a distinct operator action that stamps the field and writes an `AUD-01` entry. Re-running the loader is safe by construction, and `SC#3`'s "a deactivated mapping stops future resolution while that user's historical submissions remain readable" becomes a runtime behaviour with a test rather than a file convention. Mirrors `AUD-04`'s tombstoneable `actor_ref` — deactivate the reference, keep the row.
  *Rejected:* the CSV carrying an explicit `active` column as complete desired state (trivially reviewable, but deactivation becomes a file edit plus a reload, so there is no runtime path to revoke someone, and an off-by-one row edit in a 500-line CSV is a real way to get it wrong). Loader-creates-never-rebinds (strict, but makes ordinary CSV corrections a two-step `--force` operation). — **Reversibility:** reversible; the field is additive.

- **D-34:** The loader **drives the app lifecycle**. The file declares the desired `status`; the loader performs the transition and treats *reaching* `published` as the publish event — creating the collection's declared indexes (`DAT-09`) and writing an `AUD-01` entry per transition with the operator as actor. This makes `APP-01`, `APP-02` and `DAT-09` demonstrable in Phase 2 rather than untested until Phase 6, and `APP-04`'s slash commands go live at publish, which is what `SC#1` needs.
  *Rejected:* files describe only published state (least code, `DAT-09`'s "publish time" becomes "load time", but `APP-01`/`APP-02`/`APP-05`/`APP-06` all stay undelivered and Phase 6 builds a lifecycle on a codebase that has never run one). Indexes on load with the lifecycle deferred (gets index creation without a transition engine, at the cost that it can no longer be audited as a publish). — **Reversibility:** costly; the transition engine becomes the lifecycle Phase 6 extends.

- **D-35:** The CSV loader also populates the **profile store** introduced in D-43. One file, one loader, one lifecycle — the mapping CSV already has to carry the search email `IDN-07` requires, so this is the same ingestion path with two more columns, not a second provisioning mechanism.

### What the webhook receiver does before it acknowledges

`IM-02` (verify the signature on the raw body, exactly once, and do nothing else), `IM-03` (ack under 200 ms, enqueue, all logic in the consumer) and `IM-04` (idempotent enqueue guaranteed by a **MongoDB unique index** on the platform event ID, explicitly *not* a BullMQ `jobId` flag) pull against each other. A unique index means an insert, and an insert inside the ack window spends budget on a Mongo round-trip.

- **D-36:** The receiver does **verify → insert → enqueue → ack**, all inside the 200 ms budget. The insert's unique index is the dedupe gate: a duplicate delivery produces no second row and no second job, and is answered with the same 200 as the original so Slack does not retry. The receiver reads nothing — no identity lookup, no permission check.
  *Rejected:* ack first and dedupe in the consumer (keeps the ack path to a signature check, but moves `IM-04`'s guarantee off the ingest boundary and loses any event that crashes between ack and enqueue, with no record it arrived). A durable hand-off with a reconciliation sweeper (strongest durability, and the most machinery — it adds a reconciliation loop in a phase that deliberately excludes the outbox surface). — **Reversibility:** reversible; the ordering is local to the receiver.

- **D-37:** The inbound queue's BullMQ producer token becomes **one named exception** in `API_BOUNDARY_MANIFEST`. Today `QUEUE_PRODUCER_TOKEN` is `getQueueToken(PLATFORM_HEARTBEAT_QUEUE)` — a *specific* queue — so nothing currently stops `api` producing to a different queue, and the manifest's own docblock says the concern is a producer that has "no reason to exist on a process that never enqueues". `IM-03` requires the receiver to enqueue, and the receiver is in `api`.
  **`BoundaryManifest` therefore needs to grow an exception list.** Today it is `{ app, forbidden: readonly InjectionToken[] }` with no allow mechanism, so "one named exception" cannot be expressed by omission — an exception nobody can see is not an exception, it is the absence of a guard. The inbound producer must be named and declared, and the heartbeat token must stay forbidden. `INBOUND_ADAPTER_REGISTRATIONS` is allowed in `api` by the same logic and should be declared explicitly rather than left to the docblock.
  `worker` runs the consumer, retaining BullMQ retry semantics that `IM-05` needs. — **Reversibility:** reversible; adding a field to `BoundaryManifest` and honouring it in `ProviderBoundaryGuard`.

- **D-38:** When Slack delivery fails, the consumer performs **bounded inline retry with backoff**; on exhaustion the event/submission record moves to a terminal `delivery_failed` status and an `AUD-01` entry is written. "Not silent" is satisfied by making the failure durable, auditable and visible — not by attempting to deliver a message through the channel that just failed. **No outbound delivery queue in Phase 2**, so Phase 5's outbox is not pulled backwards.
  *Rejected:* also telling the user on their next inbound message (friendlier, but needs session-shaped per-user state with its own retention ruling). A dedicated outbound queue with DLQ (strongest, but introduces the outbox/DLQ surface this phase's scope note excludes, and Phase 5 must then adopt or replace it). — **Reversibility:** reversible; adding an outbound queue later is additive.

- **D-39:** The receiver's Mongo client gets **its own short timeouts**, separate from the general `MongoService` defaults, because the ack path is a different SLO from the rest of the request path. On insert timeout the receiver returns a **non-2xx and fails closed**, letting Slack's own retry budget be the recovery path.
  **Measured basis:** `DEFAULT_CONNECT_TIMEOUT_MS` and `DEFAULT_SERVER_SELECTION_TIMEOUT_MS` are both `3_000` (`packages/platform/src/mongo/mongo.service.ts:51,54`), and that file's own docblock records that `connectTimeoutMS` — not `serverSelectionTimeoutMS` — is what bounds an operation. 3 s is 15× the entire ack budget, so under Mongo degradation the insert cannot complete in time and the receiver must choose what it sacrifices. `MongoService` already accepts per-instance overrides, so the mechanism exists.
  *Rejected:* ack first and insert after the response is flushed (cleanest ack path, but a lost event leaves no row, no job, no audit entry, and Slack never learns to retry because it was told 200). Ack regardless and reconcile later (keeps the budget inviolate, but the event row *is* the durable record, so a failed insert leaves the reconciliation pass nothing to find). — **Reversibility:** reversible; the timeout is configuration.

### Write links, `perm_version`, and token transport

**`D-21` has already settled the semantics** and this section does not revisit them: `perm_version` "appears on **read links only**", and a write link "consumes on submit and receives a fresh permission check at the execution boundary (`ACL-06`'s second check)". What remains open is narrower, and `01-06-SUMMARY.md:356` flagged exactly one piece of it.

- **D-40:** The write-link issuer writes a **literal sentinel `perm_version: 0`**, and the link verifier **branches on `action`** — read actions compare the epoch against live, write actions ignore it. This makes `D-21`'s stated intent structurally true rather than merely documented: there is no issuance-time epoch to be misread as a guarantee, because there isn't one. `versionNumber = z.number().int().nonnegative()`, so `0` is schema-legal. A test can assert `perm_version === 0` on every emitted `create` link, and any future shared epoch check fails closed and is caught immediately rather than silently invalidating outstanding links.
  `01-06`'s alternative — mint the live epoch — is "harmless" only for as long as the `action` branch exists in the verifier; drop it and every permission change starts invalidating create links already sitting in someone's Slack DM.
  The frozen key set forbids removing the claim without a version bump, so removing it is not an option. — **Reversibility:** reversible; the issuer writes a constant.

- **D-41:** The one-time JWT rides in the **URL fragment** (`#t=`). It therefore never reaches a server: not the static host's access log, not a `Referer`, and not Slack's link-preview fetch when someone pastes the link into a channel (`IM-09`). The SPA verifies it with the **public key** — which is the reason `STACK.md` §5 chose asymmetric EdDSA/ES256, "so the Form Renderer — a static web app — can verify without ever holding the signing key" — reads `app_id`/`form_id`/`form_version` from the claims, fetches the schema, and forwards the token in an auth header on submit. `LNK-10` is unaffected: the token *value* is a 256-bit random `jti`, and unguessability is a property of the value, not the transport.
  Cost accepted: the page is blank until JS runs, and a JS failure is a blank page rather than an error page. — **Reversibility:** reversible at any deploy; outstanding links' format changes, so do it early.

- **D-42:** Token-bearing **reads do not consume** the link. On submit the order is `DAT-08` validation → `GETDEL` → write. `LNK-04` still holds exactly: two concurrent submits both validate, both reach `GETDEL`, one wins and one loses, so the kill-Redis-mid-submit integration test still produces one submission, and `LNK-03`'s Mongo unique index on the token id backs it if Redis loses an acknowledged write during failover. A mistyped field costs the user nothing — fix it and resubmit inside the 30-minute TTL.
  *Rejected:* consume before validation (strict reading of `LNK-01`, but it turns `LNK-11`'s "request a new one" message from a convenience into the normal path for an ordinary user mistake). Consume on first presentation (kills the link on the schema load, so a refresh, a Back, or reopening the DM burns it with no error shown anywhere). — **Reversibility:** reversible; ordering is local to the submit path.

- **D-43:** `LNK-09` is satisfied by adding **`real_user_id`** and **`user_agent`** to `LOG_FIELD_ALLOWLIST` — each with the written justification `D-16` requires in the same commit — and by satisfying the IP element with a **truncated address: /24 for IPv4, /48 for IPv6**. Burst detection from one network still works; re-identification does not. This is a recorded narrowing of `LNK-09`, on the same precedent as conflict 1 (`NFR-SEC-10` per-IP cap loses) and conflict 3 (the erasure promise is narrowed) — narrowing is a ruling to be recorded, not drift to be absorbed.
  **Measured basis:** the delivered `LOG_FIELD_ALLOWLIST` (`packages/platform/src/logging/log-allowlist.ts:30`) contains `jti`, `action`, `app_id`, `form_id`, `reason` and `error_code` — but **not** `real_user_id`, `ip` or `user_agent`, so `LNK-09` is currently unsatisfiable as written. `D-16`'s friction is deliberate ("Adding a field requires a written justification in the same commit; that friction is the control"), so each addition is a visible, reviewable act.
  Non-submitting accesses stay out of the append-only audit trail, where they do not belong — submits get an `AUD-01` entry on their own. See the erasure exposure recorded under *Open Questions* for what this does **not** solve. — **Reversibility:** reversible; the allowlist is one frozen list plus a formatter.

### The profile `FRM-04` pre-fills from

`FRM-04` (Phase 2, P0) requires server-side pre-fill "from the resolved real-user profile", and `PRD` §6.4 / `FR-F-7` (P0) names `real_user` profile attributes — *employee code, department*. But `PRD` §6.2 defines the Real User as `real_user_id` (UUID, platform-generated) and states "Groups, attributes, and IM-side roles are **not** used in v1"; `ACL-02` forbids attribute-based assignment and `ACL-12` defers it to v2. **No requirement in the 142-requirement v1 set creates a profile store.** This was a genuine gap, not a preference.

- **D-44:** A **closed `real_user_profiles` collection keyed by `real_user_id`**, populated by the same CSV loader as the mapping (D-35). Satisfies `FRM-04` and `FR-F-7` literally, gives Phase 5's `DAT-03` `{{real_user.attribute}}` mapping a real source, and leaves `ACL-02` intact because attributes exist without roles being assigned by them.
  **This amends `PRD` §6.2 and must be recorded as an amendment, not absorbed silently.** The accepted cost is honest: this is a small shadow HR directory that will drift, and that Phase 5's connectors eventually supersede.
  *Rejected:* ship the capability and defer the data (zero new PII store, but a P0 requirement becomes a visible no-op in the phase that ships the feature — the user opens the leave form and it is blank, so the product's front door looks like it does less than it does). Attributes on the identity mapping document (one file, one loader — but the mapping is keyed on `{platform, chat_user_id}` while pre-fill is keyed on `real_user_id`, and `IDN-03` says one real user holds several chat identities, so it means a non-unique lookup on the resolution hot path, which has a 200 ms budget). — **Reversibility:** costly. A new collection with PII, referenced by submissions and audit entries.

- **D-45:** Pre-fill is a **per-form declaration**, and the server-side pre-fill endpoint serves **only the named set**. The declaration lives inside the FormIO schema, so it is versioned with the form per `FRM-02` and reviewed like any other field. Publishing an IT ticket form cannot surface department or email into a system those values were never meant to reach, and when the profile grows an attribute no form silently starts showing it — there is a diff to review.
  This is `AD-6`'s isolation promise made testable: *"HR app permissions don't leak into IT ticketing."*
  *Rejected:* any published app pre-fills any attribute (least machinery, but an app can reach into the HR profile on demand and profile growth is itself a leak — no declaration, no boundary to point at in review). A fixed platform-wide set (trivially auditable, but leakage is symmetric — a form that does not want department still gets it, and a form that wants a value outside the set cannot pre-fill at all). — **Reversibility:** reversible; the declaration is schema data.

- **D-46:** The attribute vocabulary is a **closed typed enum** — employee code, department, and the search email `IDN-07` already requires — and a form's declaration can only name one of them. Adding a fourth is a schema change and a loader change, which is the same deliberate friction `D-16` applies to log fields: visible, reviewable, hard to do casually. The profile cannot drift into an open bag.
  *Rejected:* an open attribute map (any string keys, no migrations, but it is the shadow-directory problem with no reviewable boundary — and combined with D-45 it becomes a channel through which any stored value can be surfaced into any form that names it). Enum **plus** a per-app allowlist (narrowest, but a second permission surface in a phase already carrying `ACL-01`…`ACL-11`, answering the scoping question a second time in a different place, which is how boundary drift starts). — **Reversibility:** costly; the enum is the profile's schema.

- **D-47:** The form declaration carries a **mode per field**: `prefill` renders the server value read-only, `prefill-editable` lets the user override it. The mode is genuinely per field, not per form — a leave request's department is a fact about the user, while an expense form's cost centre may need picking from a list the user belongs to. Decided where the field is defined, so it appears in the form's schema diff under `FRM-02`.
  *Rejected:* always read-only (strongest integrity, but a field that genuinely needs user choice becomes a support ticket and the author must model it as a plain select with no default). Always editable (most flexible, and it makes department user-writable on every form that declares it — a user in one department could set their own department to another and anything downstream keyed on that value would follow, which is the exact value per-app isolation rests on). — **Reversibility:** reversible; the mode is schema data.

### Prohibitions

These are not preferences. Each is a failure mode this phase has already been bitten by, stated so a reviewer can check it.

- **No permission path may read a profile attribute.** `ACL-02` scopes every role to `real_user_id`. A pre-fill capability sitting next to an RBAC evaluation is exactly the temptation `if (profile.department === 'HR') grant(...)` represents. Worth a test that asserts permission resolution never touches `real_user_profiles`.
- **The signature is verified exactly once, on the raw body** (`IM-02`). A body that has been parsed and re-serialised has a different signature. Never re-read the stream, and never add a second verification path.
- **`draft` is reserved and must not be emitted** (`D-22`). The `create`-link issuer calls `isEmittableInV1()` and owns the `TokenClass.ttl` → seconds resolver — a hand-off recorded in `01-06`.
- **No secret value crosses into a log line.** `D-15`/`D-16` require the allowlist to be applied *before* serialisation; `msg` is the one channel it cannot filter (**WINDOWS #5 — still a pending human ruling**). A token, a Redis key holding one, or a signed URL must never reach `msg`.

### The agent's Discretion

Areas where the discussion deliberately stopped short, and the planner/implementer should choose:

- Directory layout under `provisioning/`, and whether the loader is an npm script, a package `bin`, or a Nest standalone-application context.
- Exact MongoDB collection names for the event log, identity mappings, profiles, and the audit trail.
- The `FORM_VERSION` pin mechanics for `FRM-02` / `FRM-03` beyond the contract's existing `form_version` claim.
- FormIO component property names carrying the D-45 declaration and the D-47 mode.
- Retry bounds and backoff curve numbers under D-38; the specific `/24` and `/48` truncation helper's shape.
- Copy for `SC#3`'s unmapped-user onboarding prompt, `IM-08`'s success/failure messages, and `LNK-11`'s expired-link message.
- Whether profile reads are cached, and in which of the two Redis profiles.

</decisions>

<specifics>
## Specific Ideas

- **The receiver's signature check is the one thing on the ack path that must never be skipped for latency.** `IM-02` says "exactly once" — a second verification path using a re-serialised body is a silent bypass, and it is cheap to add by accident.
- **The Mongo insert is a dedupe gate, not bookkeeping.** Treating it as an optimisation to move behind the ack is the mistake `IM-04`'s "guaranteed by a MongoDB unique index … not by a BullMQ `jobId` flag" is written to prevent.
- **`WORKER_CONSUMERS` and `JOB_SCHEDULER_REGISTRATIONS` must stay forbidden in `api`.** `worker` runs the consumer; the boot assertion is what keeps a `Worker` from being imported into the request path where "the 200 ms ack budget dies silently".
- **The pre-fill endpoint's response set is bounded by what the form declares** — the natural place for an assertion is that a form declaring `{department}` receives exactly `department` and nothing else, even as the profile document grows.
- **A pre-filled `department` rendered `prefill` (read-only) is the concrete case** that distinguishes D-47 from both alternatives; it is the field that makes "always editable" indefensible and "always read-only" merely inconvenient.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Frozen contracts this phase must honour without re-opening
- `.planning/phases/01-foundations-platform/01-CONTEXT.md` §"Frozen contracts: read-link claims and JEV wire" (lines 85–100) — **D-21**'s claim set, the `action` discriminant, `perm_version`-on-read-links-only, no-PII, no version claim; and **D-22**'s reserved `draft`. **One-way:** adding or removing a claim invalidates every outstanding link on deploy.
- `.planning/phases/01-foundations-platform/01-CONTEXT.md` lines 29–84 — `D-01`…`D-20`: repository topology, the boundary model, the three process entrypoints, log-field discipline, token lifecycle.
- `packages/contract/src/links/read-link-claims.ts` — the delivered `.strict()` schema. `READ_LINK_CLAIMS_VERSION`, `MAX_READ_LINK_TTL_SECONDS` (90 d), `ReadLinkActionSchema`, `READ_LINK_TARGET_RULES` (`action` → what `target_id` means and whether it is present at all). **This is the single source of truth for what a link may carry.**
- `packages/contract/src/links/token-classes.ts` — `TOKEN_CLASSES` as a config table of `{ action, ttl, consume }`, and `isEmittableInV1()`. `create` is 30 m and consumes; `edit` is 4 h; `view` is up to 90 d with no Redis entry and a fresh permission check on every access; `draft` is reserved and unemitted.
- `packages/contract/src/events/inbound-event.ts` — the only shape an adapter may hand the platform. `.strict()`, no PII attributes, field names drawn from the frozen log vocabulary (D-16). Note its own wording on `event_id`: "Adapter-assigned, unique per delivery attempt chain" — see the open question on the slash-command dedupe key.
- `.planning/phases/01-foundations-platform/01-06-SUMMARY.md` line 356 — the Phase 1 hand-off that D-40 answers.
- `.planning/phases/01-foundations-platform/01-10-SUMMARY.md` — the boot-assertion rationale and the `Worker`-in-`api` hand-off behind D-37.

### Platform surfaces this phase builds on
- `packages/platform/src/bootstrap/process-capabilities.ts` — `QUEUE_PRODUCER_TOKEN`, `WORKER_CONSUMERS`, `JOB_SCHEDULER_REGISTRATIONS`, `INBOUND_ADAPTER_REGISTRATIONS`, and the `BoundaryManifest` shape D-37 must extend.
- `apps/api/src/bootstrap/boundary-manifest.ts` — `API_BOUNDARY_MANIFEST`, currently `{ app, forbidden: [QUEUE_PRODUCER_TOKEN, WORKER_CONSUMERS, JOB_SCHEDULER_REGISTRATIONS] }`. Its docblock is the rationale D-37 extends.
- `packages/platform/src/bootstrap/provider-boundary.guard.ts` — the boot assertion that turns a forbidden token into a crash.
- `packages/platform/src/logging/log-allowlist.ts` — `LOG_FIELD_ALLOWLIST` as delivered; the list D-43 widens, and `log-allowlist.formatter.ts` as the pre-serialisation control.
- `packages/platform/src/mongo/mongo.service.ts` — `DEFAULT_CONNECT_TIMEOUT_MS` / `DEFAULT_SERVER_SELECTION_TIMEOUT_MS` (both `3_000`, lines 51 and 54), the per-instance overrides D-39 needs, and the docblock recording that `connectTimeoutMS` is the binding one.
- `packages/platform/src/bootstrap/otel.ts` — the one deep subpath export; every composition root otherwise imports the root barrel.
- `.planning/phases/01-foundations-platform/01-SECURITY.md` — the guard contracts and the `T-1-25`…`T-1-36` threat rows the plans declared but the register does not yet carry.

### Requirements and specifications
- `.planning/ROADMAP.md` §"Phase 2: The Vertical Slice — Slack + Internal Routing" — scope anchor, success criteria `SC#1`…`SC#5`, and the ordering constraints that make Phase 2 a precondition for Phase 5 (the submission record) and Phase 4 (`perm_version` as an epoch primitive).
- `.planning/REQUIREMENTS.md` — the 47 Phase 2 requirements, plus three sections that change how this phase is read: **"Resolved Requirement Conflicts"** (conflict 1 → `AUD-10`, per-IP loses; conflict 2 → `FND-07`, trace ID loses; conflict 3 → `FND-06`, erasure narrowed), **"Out of Scope"**, and **"Traceability"** (the phase mapping table this phase's boundary table above is derived from).
- `PRD.md` §6.2 (Real User vs Chat User — and the "attributes are not used in v1" sentence D-44 amends), §6.4 (Submission), §6.6 (Link Types), §6.7 (`perm_version` semantics), §7.3 (AD-1…AD-12, including `AD-6` isolation and `AD-11` opaque IDs), §9.3 (security NFRs), §9.4 (observability NFRs), §10.4 (submission model), §10.6 (audit entry), §12.2 (view/query flow).
  ⚠️ **`PRD.md` §7.4 is superseded in full by `.planning/research/STACK.md`** — do not revert a pin from §7.4. ⚠️ The PRD's TOC lists §22–§25; those sections were never written.
- `.planning/research/ARCHITECTURE.md` — lines 140–250 (project structure, element types, allowed edges, rules R1–R3, the per-entrypoint load matrix behind D-01/D-02/D-03/D-09); **lines 602–641** (the read-link verification sequence and the `perm_version` bump table behind D-21); lines 642–693 (the state/cache topology, including `ak:ident` and `ak:rbac:{app_id}:{real_user_id}:{perm_version}`).
- `.planning/research/STACK.md` §5 (why `jose` and asymmetric EdDSA/ES256 — the reason the renderer can verify without the signing key, which D-41 relies on), §8.2 (why the throttler storage is hand-written), §13.1 (the webhook receiver contract).

### UI
- `.planning/ROADMAP.md` §Phase 2 — "UI hint: yes" for the form renderer.
- `prototypes/mockup.html` — ⚠️ **does not cover this phase.** It is the Phase 6 App Builder admin console. See *Deferred Ideas*.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`packages/domain/src/*`** — all twelve module directories exist and are **empty** (`.gitkeep` only). This phase is the first to fill `identity`, `authz`, `adapters`, `links`, `forms`, `submissions`, `audit`, `registry`. `builder`, `connectors`, `datarouter`, `decision` and `pipeline` stay empty.
- **`packages/platform/src/{config,crypto,health,logging,metrics,mongo,otel,queue,redis}`** — the whole platform layer is delivered and is what this phase builds on rather than re-deriving. Two Redis profiles exist, split from day one because BullMQ needs `maxmemory-policy=noeviction` while the cache wants eviction.
- **`packages/contract/src/{events,jev,links,connector}`** — the frozen wire shapes. `packages/contract/src/jev/v1/` is D-23's frozen JEV contract and is **untouched** by this phase.

### Established Patterns
- **Every envelope is a `.strict()` Zod schema with a docblock arguing why each field is or is not present.** The delivered contract files set the bar: `inbound-event.ts` explains why there is no `user_email` and why field names are log-allowlist-safe on purpose. New domain schemas should match that standard — the docblock *is* the review artefact.
- **Boundaries are enforced twice**: `eslint-plugin-boundaries` `boundaries/dependencies` with `default: "disallow"` refuses the import, and `ProviderBoundaryGuard` refuses the *registration* at boot. D-37 adds an exception to the second layer.
- **Data access is the native `mongodb` driver with a thin typed repository per collection** — no Mongoose. Runtime-defined app-builder schemas are the reason.
- **Atomic commits, one per plan**, with deviation handling. Phase 1 shipped 12 plans this way.

### Integration Points
- **`INBOUND_ADAPTER_REGISTRATIONS`** — declared, reserved, and currently resolving to nothing. It is where Phase 2's Slack adapter mounts in `api`.
- **`API_BOUNDARY_MANIFEST`** — gains the inbound producer exception (D-37).
- **`apps/worker/src/processors/`** — where the inbound-event consumer registers. `WORKER_CONSUMERS` is the token.
- **`MongoService`** — the ack path's first and only write, on a client configured per D-39.
- **`crypto`** — the local signing key. `FND-10` (KMS vendor, B-3/D-27) is **pending** and gates Phase 5, not this phase; Phase 2 signs with the local key from the file whose `LOCAL_KEY_FILE_MISSING` error token was corrected during Phase 1's `01-12`.
- **The form renderer** — a new static web app at its own origin (`aud`). Two web apps plus the API plus the worker; `nx`/`turbo` stay rejected.

</code_context>

<deferred>
## Deferred Ideas

- **Form-renderer visual design.** `prototypes/mockup.html` is the Phase 6 App Builder admin console and carries **no** design for the renderer this phase must ship (`FRM-06`…`FRM-08`, including `FRM-07`'s CSP and `FRM-08`'s WCAG 2.1 AA). Per `AGENTS.md` rule 3, absence is not permission — the renderer's visual language needs confirming rather than inheriting or improvising. This is the one place where `AGENTS.md`'s "read the mockup first" instruction has nothing to read.
- **Expired-link affordance (`LNK-11`)** — see *Open Questions*.
- **Connector / outbox / DLQ** — Phase 5, deliberately excluded (D-38 respects this).
- **Read paths, edit links, draft-save** — Phases 4 and 5; `draft` stays reserved and unemitted (D-22).
- **Conditional show/hide logic and validation authoring (`FRM-05`), form preview (`FRM-09`)** — Phase 6. Note `FRM-05` being Phase 6 means seeded form schemas must carry whatever validation they need inline.
- **SAML (`S3` in `STACK.md` §15.1)** — a customer question, not a technical one, and Phase 6's `BLD-12` territory. OIDC covers Entra ID, Okta, Auth0, Google Workspace and Keycloak.

</deferred>

<open_questions>
## Open Questions

Raised during discussion and deferred to the planner by explicit choice. Each is a real fork, not a formatting question — none can be resolved by reading the existing documents.

1. **Identity cache coherence.** `ACL-07`'s `perm_version` epoch has **no identity-side equivalent** in `REQUIREMENTS.md`, and `D-13` reserves `ak:ident` for the identity cache. So a deactivated mapping (`IDN-06`, D-33) can be served from cache, and `D-13`'s failover argument — a Redis `DEL` can be lost during async replication — is the same argument that made Mongo the guarantee for tokens. Fork: introduce an identity epoch mirroring `perm_version`; delete-on-deactivate and accept the loss window; or rely on a short TTL. **The first is most consistent with `ACL-08`** ("a stale cached permission entry is never served after an epoch bump, with or without a Pub/Sub message"), which currently has an identity-shaped hole.

2. **Slash-command dedupe key.** Slack's Events API carries a stable `event_id` across redeliveries; a slash command delivery has **no equivalent**. `IM-04`'s Mongo unique index therefore has no stable value to sit on for the exact flow `SC#1` exercises, and `inbound-event.ts`'s own wording — `event_id` is "adapter-assigned, unique per delivery attempt chain" — leaves it open. A per-attempt assignment makes retries collide-free and dedup dead; a chain-stable assignment needs a derivation the requirements do not supply.

3. **Expired-link affordance (`LNK-11`).** "Request a new one **via IM**" has to be a Slack deep link, because the renderer is a static SPA on its own origin with no IM access (`IM-09` covers Slack's URI handling). Open: whether the expired page offers a one-tap deep link into the right Slack conversation, and **how the renderer learns which conversation** when the token carries only opaque ids (`D-21` forbids a `chat_user_id` claim). These interact — a deep link needs a conversation reference the frozen claim set deliberately does not carry.

4. **`LNK-09`'s visibility narrowing — a consequence of D-41, not yet ratified.** With the token in the fragment, the platform never sees the static page load, so "every link access" is only observable for requests that reach `api`: the schema load and the submit. **A link opened in a Slack DM and abandoned before submitting is invisible to the platform.** That is a real loss of the abandoned-link signal, and it should be recorded as a narrowing of `LNK-09` on the same footing as the IP truncation in D-43, rather than discovered later as a surprise.

5. **The profile's erasure story, and `AUD-02`'s raw IPs.** The profile (D-44) is new PII arriving in Phase 2, while `AUD-04`'s tombstoneable `actor_ref` — the mechanism that would have to reach it — is **Phase 8**. Six phases of collecting before anything can erase.
   Compounding it: **`AUD-02` states an audit entry records "timestamp, actor, action, target, previous state, new state, IP, and request ID"**, and `FR-AU-2` marks it P0. So raw IPs land in the append-only audit collection with its 3-year minimum retention **regardless** of D-43's log-stream truncation. D-43's option text underweighted this when it was chosen; it is stated here so the planner inherits the corrected picture rather than the optimistic one. The erasure promise is already narrowed by conflict 3, and `AGENTS.md` requires erasure to apply a field allowlist **before** log serialisation — the audit trail needs its own equivalent rule, and Phase 2 is where the raw IP enters.

</open_questions>

---

*Phase: 02-the-vertical-slice-slack-internal-routing*
*Context gathered: 2026-10-05*