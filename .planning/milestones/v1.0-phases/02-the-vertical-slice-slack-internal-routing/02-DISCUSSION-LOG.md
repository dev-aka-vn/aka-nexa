# Phase 2: The Vertical Slice — Slack + Internal Routing - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-05
**Phase:** 02-the-vertical-slice-slack-internal-routing
**Areas discussed:** Pre-provisioning surface, What the receiver does before it acks, Write-link `perm_version` + token transport, The profile `FRM-04` pre-fills from
**Gathering mode:** `discuss` (interactive). All four offered areas were selected; each question resolved by explicit user choice. "Notes" below are the agent's reasoning, not user feedback.
**Questions asked:** 16. **Deferred to planner by choice:** 3 (identity cache coherence, slash-command dedupe key, expired-link affordance). **Deferred with a stated reason:** 1 (profile erasure).
**Framing correction:** Area 3 was initially presented as if `perm_version`'s meaning on write links were open. It was not — `D-21` had already ruled it. The area was re-scoped to what Phase 1 actually left open (`01-06-SUMMARY.md:356`) before any question was asked. See *Corrections during the discussion* below.

---

## Pre-provisioning surface

Phase 2 has no App Builder (Phase 6) and no admin authentication at all — `D-30` puts OIDC as plan of record and `BLD-12` puts the first SSO surface in Phase 5. Yet `SC#1` starts from "a pre-provisioned employee" and `IDN-02`, `IDN-07`, `ACL-01`…`ACL-03`, `APP-01`…`APP-04` and `FRM-01` all need data to exist.

### Q1 — What is the pre-provisioning surface?

| Option | Description | Selected |
|--------|-------------|----------|
| Seed files + CLI loader | Committed files under `provisioning/`, idempotent loader upserts to Mongo | ✓ |
| Platform-admin HTTP API | Endpoints on `api` behind a global-admin check | |
| One-shot seeding, no capability | Script run once; `IDN-02`/`IDN-07` satisfied off-product | |

**Choice:** Seed files + CLI loader.
**Notes:** The decisive argument is not the missing App Builder — it is that Phase 2 has **no admin auth at all**, so an HTTP surface would have no identity story to hang on while needing auth, audit and rate limiting before anything else in the phase finished. The files also make `SC#1`'s starting state reviewable in a git diff, and the loader is reusable by CI and testcontainers. The third option was flagged as the pattern Phase 1's verifier exists to catch: marking `IDN-02`/`IDN-07` delivered without shipping the capability they describe.

### Q2 — Identity mapping key; may a re-run rebind?

| Option | Description | Selected |
|--------|-------------|----------|
| Chat identity is the key | `{platform, chat_user_id}` unique; `real_user_id` is payload; rebind allowed and audited | ✓ |
| Real user is the key | `{real_user_id, platform}` unique — "one chat identity per platform per person" | |
| Both directions indexed | Chat→real functional, real+platform→chat declared alongside | |

**Choice:** Chat identity is the key.
**Notes:** `IDN-01`'s resolution direction is chat→real and the `ak:rbac:{app_id}:{real_user_id}:{perm_version}` cache key is built on it, so the functional constraint has to be that direction. The `real_user_id`-first reading sounds more faithful to `IDN-03` but permits one `chat_user_id` against two people — the one case resolution must never allow. Rebinding is safe for history because `AUD-02` stores the user's own `real_user_id` on the audit row.

### Q3 — Where does deactivation live?

| Option | Description | Selected |
|--------|-------------|----------|
| Loader never un-deactivates | Loader upserts creates/rebinds; never clears non-null `deactivated_at`; deactivation is an operator action + `AUD-01` | ✓ |
| CSV is the whole truth | Explicit `active` column; re-run always produces exactly the file | |
| Loader creates, never rebinds | Rebinding needs `--force` plus an audit entry with operator identity | |

**Choice:** Loader never un-deactivates.
**Notes:** This closes a live bug class rather than a hypothetical. An idempotent loader treating the CSV as desired state will hand a deactivated employee their permissions back on the next run, and the CSV has no way to record a runtime revocation. Keeping deactivation out of the file makes re-running safe by construction and turns `SC#3` into a testable runtime behaviour. The `AUD-04` tombstone is the sibling concept — deactivate the reference, keep the row.

### Q4 — Does the loader drive the app lifecycle?

| Option | Description | Selected |
|--------|-------------|----------|
| Loader drives the lifecycle | File declares `status`; reaching `published` creates `DAT-09` indexes and writes `AUD-01` | ✓ |
| Only published state exists | No draft/deprecated/archived in Phase 2; "publish time" = "load time" | |
| Indexes on load, lifecycle deferred | Indexes created regardless of status; transitions are Phase 6's | |

**Choice:** Loader drives the lifecycle.
**Notes:** `DAT-09` needs *some* event to hang index creation off, and "publish" is the one the requirements already name. Making it real in Phase 2 means `APP-02`'s "a draft is unreachable" has a guard before Phase 6 can create drafts at all. The middle option leaves `APP-01`/`APP-02`/`APP-05`/`APP-06` undelivered and gives Phase 6 a lifecycle to invent rather than extend.

---

## What the receiver does before it acks

`IM-02` (verify signature on the raw body, exactly once, do nothing else), `IM-03` (ack < 200 ms, enqueue, all logic in the consumer) and `IM-04` (idempotent enqueue guaranteed by a MongoDB unique index on the platform event ID, explicitly **not** a BullMQ `jobId` flag) pull against each other: a unique index means an insert, and the insert spends the ack budget on a Mongo round-trip.

### Q1 — What happens between signature verification and the ack?

| Option | Description | Selected |
|--------|-------------|----------|
| Verify, insert, enqueue, ack | The unique-index insert is the dedupe gate, inside the 200 ms budget | ✓ |
| Ack first, dedupe in the consumer | Ack path is signature-only; duplicates collapse downstream | |
| Durable hand-off with a sweeper | Event row is the queue's source of truth; reconciliation recovers lost enqueues | |

**Choice:** Verify, insert, enqueue, ack.
**Notes:** This buys `IM-04`'s *structural* guarantee rather than a probabilistic one, and the receiver still reads nothing — so the ack path spends budget on one write, not a permission lookup. A duplicate is answered with the same 200 as the original, so Slack does not retry into a loop. The sweeper option was strongest on durability and worst on scope: it adds a reconciliation loop to a phase whose scope note deliberately excludes the outbox surface.

### Q2 — The receiver must enqueue, but lives in `api`

`QUEUE_PRODUCER_TOKEN` is `getQueueToken(PLATFORM_HEARTBEAT_QUEUE)` — a *specific* queue's token — so nothing currently stops `api` producing to a different queue. The manifest's own docblock says the concern is a producer that has "no reason to exist on a process that never enqueues". `IM-03` requires the receiver to enqueue, and the receiver is in `api`.

| Option | Description | Selected |
|--------|-------------|----------|
| One named producer exception | Inbound queue's producer token is the single declared exception; heartbeat stays forbidden | ✓ |
| Redis list, not BullMQ | Push a wake-up onto a plain Redis list; consumer is not a BullMQ `Worker` | |
| Drop the producer guard in `api` | Manifest stops forbidding queue producers; keep only `Worker`/scheduler bans | |

**Choice:** One named producer exception.
**Notes:** This required a change to `BoundaryManifest` itself: today it is `{ app, forbidden: readonly InjectionToken[] }` with no allow mechanism, so "one named exception" cannot be expressed by omission — an exception nobody can see is not an exception, it is the absence of a guard. The Redis-list option is cheaper in the ack window (no Lua scripts on the request path) but discards `IM-05`'s queue-and-retry and the shared retry/DLQ vocabulary. Dropping the guard discards the exact control whose docblock says the ack budget "dies silently" — invisible until a webhook times out in production.

### Q3 — When Slack delivery fails, what makes it non-silent?

`IM-05` requires that an unreachable IM platform "never produces a silent failure the user cannot see" — but if Slack is unreachable, the message telling the user cannot be delivered either. The requirement is self-referential, and Phase 5 (which owns the outbox and DLQ surface) is excluded.

| Option | Description | Selected |
|--------|-------------|----------|
| Bounded retry, terminal status | Bounded inline retry with backoff; exhaustion → terminal `delivery_failed` + `AUD-01` | ✓ |
| Bounded retry plus next-message notice | Also tell the user on their next inbound message | |
| Outbound queue with DLQ now | BullMQ retry + DLQ for outbound, mirroring Phase 5 | |

**Choice:** Bounded retry, terminal status.
**Notes:** "Not silent" is satisfied by making the failure durable, auditable and visible — not by attempting delivery through the channel that just failed. The next-message notice is friendlier and closer to `IM-08`'s intent, but it needs session-shaped per-user state with its own retention ruling, in a phase that has none. The outbound queue is strongest on delivery and worst on scope: it imports Phase 5's surface early and leaves Phase 5 to adopt or replace it.

### Q4 — Under Mongo degradation the insert cannot fit the budget

**Measured:** `DEFAULT_CONNECT_TIMEOUT_MS` and `DEFAULT_SERVER_SELECTION_TIMEOUT_MS` are both `3_000` (`packages/platform/src/mongo/mongo.service.ts:51,54`), and that file's docblock records that `connectTimeoutMS` — not `serverSelectionTimeoutMS` — is what bounds an operation. 3 s is 15× the entire 200 ms ack budget.

| Option | Description | Selected |
|--------|-------------|----------|
| Separate short timeouts, fail closed | Receiver's Mongo client gets its own short deadlines; on timeout return non-2xx | ✓ |
| Ack first, insert after the response | Response flushed, then insert; budget never competed with | |
| Ack regardless, reconcile later | Ack in bounded time whatever the insert did | |

**Choice:** Separate short timeouts, fail closed.
**Notes:** The ack path is a different SLO from the rest of the request path and should not inherit 3 s. Failing closed puts recovery on Slack's own documented 3-retry ceiling, which is visible, rather than on a silent loss. The third option was rejected on a specific defect: the event row *is* the durable record, so a failed insert leaves a reconciliation pass nothing to find.

---

## Write-link `perm_version` + token transport

**Framing correction.** This area was first presented as if the meaning of `perm_version` on a write link were an open decision. Reading `D-21` before asking showed it is not: `perm_version` "appears on **read links only**", and a write link "consumes on submit and receives a fresh permission check at the execution boundary (`ACL-06`'s second check)". Re-asking would have re-litigated a frozen decision. The area was re-scoped to what `01-06-SUMMARY.md:356` actually left open — the write-link issuer has no value to put in the claim — plus the transport and consumption questions, which nothing in Phase 1 addresses.

### Q1 — What value does a write-link issuer put in `perm_version`?

| Option | Description | Selected |
|--------|-------------|----------|
| Sentinel `0`, verifier branches on `action` | Read actions compare the epoch; write actions ignore it | ✓ |
| Mint the live epoch | `01-06`'s own suggestion; keeps the claim looking meaningful | |
| Uniform epoch check on all links | One rule, no branching | |

**Choice:** Sentinel `0`, verifier branches on `action`.
**Notes:** This makes `D-21`'s stated intent structurally true rather than merely documented — there is no issuance-time epoch to be misread as a guarantee, because there isn't one. `z.number().int().nonnegative()` makes `0` schema-legal, and a test can assert it on every emitted `create` link, so a future shared epoch check fails closed and is caught immediately. `01-06` called minting the live epoch "harmless", which is true only while the `action` branch exists: drop it and every permission change starts invalidating create links sitting in someone's Slack DM. Uniform checking is simplest and has a consequence nobody asked for — revoking one permission invalidates forms the user may still legitimately submit. Removing the claim is not available; the frozen key set forbids it without a version bump.

### Q2 — Where in the URL does the JWT ride?

`D-21` sets `aud` to the form-renderer origin; the renderer is a static app. `LNK-10` requires unguessable links with no sequential identifier.

| Option | Description | Selected |
|--------|-------------|----------|
| URL fragment (`#t=`) | Never reaches a server: not the static access log, not a `Referer`, not Slack's unfurler | ✓ |
| Query parameter (`?t=`) | Simplest SPA; server-visible from the first byte | |
| Path segment (`/f/<token>`) | Readable; same exposure as the query plus an edge-rewrite surface | |

**Choice:** URL fragment.
**Notes:** The fragment is the transport the rest of the architecture already implies: `STACK.md` §5 chose asymmetric EdDSA/ES256 precisely so "the Form Renderer — a static web app — can verify without ever holding the signing key", which only pays off if the SPA is the verifier. `IM-09`'s unfurl behaviour is the tiebreaker — a query-parameter token is fetched by Slack's link preview when a user pastes the link into a channel. The accepted cost is that the page is blank until JS runs, and a JS failure is a blank page rather than an error page. `LNK-10` is unaffected either way: unguessability is a property of the 256-bit `jti` value, not the transport.

### Q3 — When is the single-use token spent?

| Option | Description | Selected |
|--------|-------------|----------|
| Consume on submit, after validation | Reads don't consume; `DAT-08` validation → `GETDEL` → write | ✓ |
| Consume on submit, before validation | `GETDEL` → validate → write; exactly one validation attempt ever | |
| Consume on first presentation | The schema GET spends the link; submit can never authenticate | |

**Choice:** Consume on submit, after validation.
**Notes:** `LNK-04`'s exactly-once guarantee is unaffected by ordering: two concurrent submits both validate, both reach `GETDEL`, one wins and one loses, so the kill-Redis-mid-submit test still produces one submission, and `LNK-03`'s Mongo unique index on the token id backs it if Redis loses an acknowledged write. Consuming before validation makes an ordinary user mistake the normal path through `LNK-11`'s "request a new one" message — a support burden for something the user did right. First-presentation consumption is only viable if the schema is served unauthenticated, which makes it public and means a refresh, a Back, or reopening the DM burns the link with no error shown anywhere.

### Q4 — How does `LNK-09` get satisfied?

**Measured:** the delivered `LOG_FIELD_ALLOWLIST` contains `jti`, `action`, `app_id`, `form_id`, `reason` and `error_code` — but **not** `real_user_id`, `ip` or `user_agent`. `LNK-09` requires all five. `D-16` makes each addition cost a written justification in the same commit.

| Option | Description | Selected |
|--------|-------------|----------|
| Truncate the IP, add the rest | Add `real_user_id` + `user_agent` with justifications; IP truncated to /24 (v4) or /48 (v6) | ✓ |
| Add all three, raw | Take `LNK-09` literally | |
| Audit collection, not the log stream | Leave the allowlist alone; write link accesses to the append-only audit store | |

**Choice:** Truncate the IP, add the rest.
**Notes:** Burst detection from one network still works; re-identification does not. This is a narrowing of a P0 requirement, on the same precedent as conflict 1 and conflict 3 — narrowing is a ruling to be recorded, not drift to absorb. Adding raw IPs would put personal data in a 3-year store with the erasure mechanism (`AUD-04`) six phases away. The audit-collection option is architecturally cleaner but keeps raw IPs at 3-year retention by another route.

**Correction recorded after the choice.** The option text argued that keeping IPs out of the 3-year store was a benefit of the selected option. That underweighted `AUD-02`, which states an audit entry records "timestamp, actor, action, target, previous state, new state, **IP**, and request ID" and is marked P0 by `FR-AU-2` — a Phase 2 requirement. Raw IPs therefore land in the append-only audit collection regardless of the log-stream truncation. Captured in CONTEXT.md's *Open Questions* §5 so the planner inherits the corrected picture.

---

## The profile `FRM-04` pre-fills from

`FRM-04` (Phase 2, P0) requires server-side pre-fill "from the resolved real-user profile"; `PRD` §6.4 / `FR-F-7` (P0) names `real_user` profile attributes — *employee code, department*. Against that: `PRD` §6.2 defines the Real User as `real_user_id` (UUID) and says "Groups, attributes, and IM-side roles are **not** used in v1"; `ACL-02` forbids attribute-based assignment; `ACL-12` defers it to v2; `IDN-05` and `IDN-08` are Phase 6. **No requirement in the 142-requirement v1 set creates a profile store.** This was a gap, not a preference.

### Q1 — What does `FRM-04` pre-fill from?

| Option | Description | Selected |
|--------|-------------|----------|
| Closed profile collection, keyed by `real_user_id` | New `real_user_profiles`, populated by the same CSV loader | ✓ |
| Ship the capability, defer the data | Pre-fill wired to an endpoint that returns nothing in v1 | |
| Attributes on the identity mapping | No new collection; attribute block on the mapping document | |

**Choice:** Closed profile collection, keyed by `real_user_id`.
**Notes:** Satisfies `FRM-04` and `FR-F-7` literally, gives Phase 5's `DAT-03` `{{real_user.attribute}}` a real source, and leaves `ACL-02` intact because attributes can exist without roles being assigned by them. **This amends `PRD` §6.2 and must be recorded as an amendment.** The accepted cost is honest: a small shadow HR directory that will drift and that Phase 5's connectors supersede. The capability-with-no-data option would make a P0 requirement a visible no-op in the phase that ships the feature — the user opens the leave form and it is blank. The mapping-document option is one file and one loader, but pre-fill is keyed on `real_user_id` while the mapping is keyed on `{platform, chat_user_id}`, so it means a non-unique lookup on the resolution hot path — the one with a 200 ms budget.

### Q2 — May any app pre-fill any attribute?

`AD-6`: *"Per-app RBAC | Supports multi-department isolation. HR app permissions don't leak into IT ticketing."*

| Option | Description | Selected |
|--------|-------------|----------|
| Per-form declaration, served set only | Form names what it pre-fills; endpoint serves only that set | ✓ |
| Any published app, any attribute | Form just names a field | |
| Fixed platform-wide set | Same set for every form | |

**Choice:** Per-form declaration, served set only.
**Notes:** The declaration lives inside the FormIO schema, so it is versioned with the form per `FRM-02` and reviewed like any other field. When the profile grows an attribute, no form silently starts showing it — there is a diff. Unrestricted access means an app can reach into the HR profile on demand and profile growth is itself a leak, with no boundary to point at in review. The fixed set makes leakage symmetric: a form that does not want department still gets it, and a form that wants a value outside the set cannot pre-fill at all.

### Q3 — Is the vocabulary a closed set or an open map?

| Option | Description | Selected |
|--------|-------------|----------|
| Closed typed enum | employee code, department, search email; each typed; declarations name one of them | ✓ |
| Open attribute map | Arbitrary string keys | |
| Enum plus a per-app allowlist | Two closed layers | |

**Choice:** Closed typed enum.
**Notes:** Adding a fourth attribute is a schema change plus a loader change — the same deliberate friction `D-16` applies to log fields: visible, reviewable, hard to do casually. The open map is the shadow-directory problem with no reviewable boundary, and combined with Q2's per-form declaration it becomes a channel through which any stored value can be surfaced into any form that names it. The enum-plus-allowlist option was rejected for answering the scoping question a second time in a second place — a second permission surface in a phase already carrying `ACL-01`…`ACL-11`, which is how boundary drift starts.

### Q4 — Can a user change a pre-filled value?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-field mode in the declaration | `prefill` (read-only) vs `prefill-editable` (user may override) | ✓ |
| Always read-only | Server value always wins | |
| Always editable | User may change any pre-filled value | |

**Choice:** Per-field mode in the declaration.
**Notes:** The mode is genuinely per **field**, not per form: a leave request's department is a fact about the user, while an expense form's cost centre may need picking from a list the user belongs to. Decided where the field is defined, so it appears in the form's schema diff. Always-editable is indefensible on the department field specifically — a user in one department could set their own department to another and anything downstream keyed on that value would follow, which is the exact value per-app isolation rests on. Always-read-only is safest but turns a field that genuinely needs user choice into a support ticket.

---

## Deferred to the planner by explicit choice

Raised and offered at each area's check; the user chose to move on in all three cases. Recorded rather than dropped.

| Deferred question | Why it matters |
|---|---|
| **Identity cache coherence** | `ACL-07`'s `perm_version` epoch has no identity-side equivalent, and `D-13` reserves `ak:ident`. A deactivated mapping can be served from cache, and `D-13`'s own failover argument says a Redis `DEL` can be lost. The closest precedent is `ACL-08`, which forbids serving a stale entry after an epoch bump "with or without a Pub/Sub message" — currently with an identity-shaped hole. |
| **Slash-command dedupe key** | Slack's Events API carries a stable `event_id` across redeliveries; a slash command delivery has no equivalent, so `IM-04`'s Mongo unique index has no stable value to sit on for the exact flow `SC#1` exercises. `inbound-event.ts`'s own wording — `event_id` is "adapter-assigned, unique per delivery attempt chain" — leaves it open. |
| **Expired-link affordance (`LNK-11`)** | "Request a new one via IM" must be a Slack deep link, since the renderer is a static SPA on its own origin with no IM access. Open: whether the expired page deep-links into the right conversation, and **how the renderer learns which conversation** when the token carries only opaque ids and `D-21` forbids a `chat_user_id` claim. Interacts with the fragment decision. |

## Deferred with a stated reason

| Deferred question | Why |
|---|---|
| **Profile erasure, and `AUD-02`'s raw IPs** | The profile is new PII in Phase 2 while `AUD-04`'s tombstoneable `actor_ref` is Phase 8 — six phases of collecting before anything can erase. Compounded by `AUD-02` putting raw IPs in the 3-year audit store regardless of the log-stream truncation. Deferred to planning, where the erasure surface and `AUD-04`'s eventual shape are both in view. |

---

## Corrections during the discussion

1. **Area 3's framing was wrong before any question was asked.** `perm_version`'s meaning on write links was presented as an open decision; `D-21` had already ruled it ("appears on read links only"). Caught by reading `01-CONTEXT.md` and the delivered `read-link-claims.ts` before asking. The area was re-scoped to the narrower open item Phase 1 flagged at `01-06-SUMMARY.md:356`, plus transport and consumption — neither of which Phase 1 addresses. No frozen decision was re-litigated.
2. **`AUD-02` was not accounted for in Q4 of Area 3.** The chosen option's text argued that keeping IPs out of the 3-year store was a benefit. `AUD-02` mandates raw IP in the audit entry and is a Phase 2 P0 requirement, so raw IPs land there regardless. Stated to the user at the Area 4 check and corrected in CONTEXT.md rather than left as an optimistic note in a log nobody reads.

---

*Phase: 02-the-vertical-slice-slack-internal-routing*
*Log written: 2026-10-05*