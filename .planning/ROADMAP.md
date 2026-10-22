# Roadmap: IM-Driven App Builder & Integration Gateway

## Overview

v2.0 **completes** the chat loop rather than extending it. v1 shipped a front door - Slack and
Teams users could raise a request, get a signed link, fill a FormIO.js form, and receive a
confirmation - but two structural gaps make every v2 capability meaningless until they are
closed. First, **the outbound half of the product does not exist**: `InboundEventProcessor.process()`
returns a link that BullMQ discards, `TeamsOutboundService` has no caller, and the Slack receiver
is a placeholder that returns `{ok:true}`. Second, **v1 shipped an authoriser that grants
everything**: `RbacService.hasPermission` returns `true` unconditionally and `perm_version`
defaults to `0`.

So v2 is **foundations-first**. Phase 10 builds the outbound delivery seam and the event contract
so a platform can finally answer. Phase 11 replaces the stub authoriser with real, persistent,
epoch-backed RBAC. Only then do the capabilities land: Telegram and Zalo OA as two-sided
plug-ins on the shared seam (12-13), two-way synchronisation with external systems (14),
directory and group RBAC sync (15), the permission-first open-ended AI guard (16), and the
operational hardening that makes four platforms survivable (17).

**Ordering is a correctness constraint, not a preference.** Phase 10 gates everything: no adapter
is demonstrable without the outbound seam, and the envelope amendment cannot be retrofitted once
adapters ship. Phase 11 gates the two security-bearing phases: group RBAC binds to roles, and the
AI guard's candidate set *is* the authorised set - both are theatre over a stub authoriser. The
guard's permitted set is the union of app-scoped and group-scoped permissions, so building it
before the group axis exists means building it against a stub.

**Frozen contracts are not edited.** D-21 (read-link claims), D-23 (JEV v1 wire) and D-43 (audit
field allowlist) are worked around, not rewritten: the shorter notification TTL is expressed by
the *issuer*, the notification destination is resolved from `real_user_id` to a conversation
reference at send time, and the AI guard is a `JevProvider` **decorator** with zero contract
footprint. The single deliberate exception is the D-16/D-18 allowlist widening in Phase 11
(`app_id`, `perm_version`, `group_id` - opaque ids only, never names), with the written
justification in the same commit.

---

## Milestones

- ✅ **v1.0 - IM-Driven App Builder & Integration Gateway** - Phases 1-9, shipped 2026-10-21
  (9 phases / 72 plans). Archived: `.planning/milestones/v1.0-ROADMAP.md` and
  `.planning/milestones/v1.0-REQUIREMENTS.md`.
- 🚧 **v2.0 - Platform Expansion & Advanced Capabilities** - Phases 10-17 (planned).

**v2.0 scope** (per `.planning/REQUIREMENTS.md`): 97 requirements in 8 categories - OUT 14,
AUT 10, TGA 11, ZAL 15, SYNC 11, GRP 13, AIG 13, OPS 10. Every requirement maps to exactly one
phase.

**v1.0 archive pointer:** `.planning/milestones/v1.0-ROADMAP.md` (shipped phases 1-9), requirements
at `.planning/milestones/v1.0-REQUIREMENTS.md`.

---

## Granularity: stated deviation from `coarse`

`config.json` sets `granularity: coarse` (nominally 2-4 phases). **This roadmap has 8 phases.**
The deviation is deliberate and is honoured through phase *breadth*, not phase *count*:

- **Breadth honoured.** Phase 10 carries 14 requirements and Phase 13 carries 15 - each is a
  complete, independently demonstrable capability, not a technical layer. There is no "all
  models" phase, no "all API endpoints" phase, and no phase whose output cannot be shown to a
  user.
- **Count not compressed.** `coarse` was treated as a preference about phase size, not a hard cap
  on phase count. Compressing to 2-4 would require collapsing a load-bearing order that four
  independent research passes converged on:
  1. The outbound seam must precede every adapter. Shipping a Zalo adapter first produces a bot
     that receives perfectly and answers nothing.
  2. Real RBAC must precede group RBAC and the AI guard. "Permission-first" over a stub
     authoriser is a claim, not a guarantee.
  3. The envelope amendment (`thread_id?`, `reply_to_message_id?`, `native_event_id?`) cannot be
     retrofitted once adapters ship - every later phase inherits it.
  4. The guard's permitted set is the union of app-scoped and group-scoped permissions, so the
     group axis must exist first.
  5. The phase structure is the reconciled outcome of four independent research passes
     (`research/SUMMARY.md`), which disagreed among themselves on 6 vs 7 vs 5 phases and settled
     on 8 (10-17).

---

## Phases

**Phase Numbering:**

- Integer phases (10-17): the whole of v2.0, executed in numeric order.
- v1.0's phases 1-9 are shipped and archived. Numbering **continues**; it never resets.

- [ ] **Phase 10: Outbound Delivery Seam & Event Contract** - The missing half of the product: the bot finally answers, every platform becomes a two-sided plug-in, and the event envelopes gain the optional threading fields that later phases inherit.
- [ ] **Phase 11: Real Authorization & Persistent Identity** - A v1 correctness fix, not a v2 feature: real effective permissions, a required permission version, a Redis-backed cache every replica shares, and persistent identity - so group RBAC and the AI guard are not built on a stub.
- [ ] **Phase 12: Telegram Adapter** - The lowest-risk platform proves the shared seam: verified webhook, threaded replies, authorisation on every command, bounded inline keyboards, and a boot-time check of the bot's own configuration.
- [ ] **Phase 13: Zalo OA Adapter** - The milestone's headline and highest-risk item: a verified 2-second receiver, a hand-written OA client, single-flight token rotation, quota-aware sends, and big-int-safe identifiers.
- [ ] **Phase 14: Two-Way Synchronisation & Delivery Semantics** - An external system can push status back to the person who asked - verified, replay-protected, exactly-once, and landing in the right thread.
- [ ] **Phase 15: Directory & Group RBAC Sync** - An app owner grants a role to a whole team, and the grant and its revocation behave correctly even when the directory is stale, rate-limited, or failing.
- [ ] **Phase 16: Permission-First Open-Ended AI Guard** - The model chooses; it never invokes. A wider input space, a narrower action space, and a bounded clarification instead of a guess.
- [ ] **Phase 17: Security, Compliance & Operations** - Four platforms, survivable: a platform-side webhook disable cannot hide, every credential has a recovery runbook, and the performance claims are measured rather than assumed.

## Phase Details

### Phase 10: Outbound Delivery Seam & Event Contract

**Goal**: A user who sends a request in any IM platform receives the answer back in that same
conversation, and every platform becomes a two-sided plug-in with a durable, reconcilable
delivery ledger.

**Depends on**: Nothing (first phase of v2.0; builds on shipped v1.0)

**Requirements**: OUT-01, OUT-02, OUT-03, OUT-04, OUT-05, OUT-06, OUT-07, OUT-08, OUT-09,
OUT-10, OUT-11, OUT-12, OUT-13, OUT-14

**Success Criteria** (what must be TRUE):

1. **A user gets an answer, not silence.** A message produced by the inbound pipeline is
   delivered back to the originating IM conversation instead of being discarded, and the delivery
   runs asynchronously on a queue worker with jittered exponential backoff and a dead-letter
   queue - so a platform outage delays the reply without blocking the request that caused it.
2. **The platform refuses to start if an IM platform is half-registered.** Every IM platform has
   exactly one inbound adapter and exactly one outbound delivery port, asserted at boot; a
   missing or duplicate registration fails startup rather than failing silently at runtime.
3. **A Slack event is verifiably Slack's, and a reply lands in the thread it answers.** The
   Slack inbound receiver verifies the `v0:` HMAC-SHA256 signature over the raw request body
   before accepting an event, and the placeholder receiver that returned `{ok:true}` is removed.
   An inbound event carries an optional `thread_id`, an optional `reply_to_message_id`, and an
   optional `native_event_id`; the outbound message identifier is generated by the producer and
   stays stable across every delivery retry.
4. **Two platforms cannot collide, and platform payload cannot leak.** A conversation reference
   records the platform, the platform-scoped conversation identifier, and a validated
   per-platform payload; the inbound envelope accepts an optional non-PII `platform_metadata`
   record; and the outbound delivery implementation for each platform lives under that
   platform's adapter directory, so the architecture boundary rule applies to outbound code as
   well as inbound.
5. **A delivery cannot vanish.** The receiver verifies, validates the envelope shape,
   deduplicates, enqueues, and returns - it performs no database read, no credential decryption,
   and no outbound call. A platform event is recorded in a platform-scoped ledger with a unique
   index on the platform event identifier and moves through `pending -> dispatched`, so a crashed
   delivery is reconciled by a scheduled job rather than lost; the ledger is swept of entries
   older than 30 days. The inbound trace context propagates into the delivery attempt, so a
   reply is traceable to the message that caused it - and a dead-lettered message is visible on
   an operator surface with its failure reason and the platform event that produced it.

**Plans**: 3/8 plans executed
- [x] 10-01-PLAN.md
- [x] 10-02-PLAN.md
- [x] 10-03-PLAN.md
- [ ] 10-04-PLAN.md
- [ ] 10-05-PLAN.md
- [ ] 10-06-PLAN.md
- [ ] 10-07-PLAN.md
- [ ] 10-08-PLAN.md

**UI hint**: yes

**Notes**: The single highest-leverage phase in the milestone, and independently demonstrable:
**the bot finally answers.** Every pattern is already in-repo - the Teams receiver, the
`TeamsEventRepository` ledger, the notification processor's backoff/DLQ, the `registerJobScheduler`
pattern - so this phase needs no external research.

**Planning task, not a research pass**: a short written **decision memo** on the four contract
questions before the amendment lands once - envelope field names, `native_event_id` semantics,
`platform_metadata` shape, and the notification-link TTL policy.

Also in this phase: the uncalled `apps/api/.../teams.outbound.service.ts` is deleted and the
Teams and Slack delivery ports move to `packages/domain/src/adapters/<platform>/outbound/`, so the
existing `outbound-adapter` boundary category finally matches something and R1 enforces "only the
worker may send". The `groups` element is declared ahead of use in `tooling/boundaries.config.mjs`.
The `events.spec.ts` strictness test is updated with the envelope amendment. The platform-scoped
conversation reference replaces the `unknown` payload type and the v1 Teams-shaped rows are
migrated.

### Phase 11: Real Authorization & Persistent Identity

**Goal**: The platform's permission decisions are real, persistent, and identical on every
replica - an unassigned user has no access, and a revocation takes effect on the very next
check.

**Depends on**: Phase 10

**Requirements**: AUT-01, AUT-02, AUT-03, AUT-04, AUT-05, AUT-06, AUT-07, AUT-08, AUT-09, AUT-10

**Success Criteria** (what must be TRUE):

1. **An unassigned user cannot open an app, and a revocation bites immediately.** The effective
   permissions of a user for an app are resolved from the union of directly-assigned and
   group-derived role assignments; an unassigned user has no permission. The permission version
   is read from a persistent per-user-per-app epoch store, and a revoked assignment increments
   it.
2. **Every replica agrees on the same decision.** The authorisation decision cache lives in
   Redis, keyed by app, user, and permission version, so a revocation is seen everywhere; and
   resolved identity mappings and profiles persist in MongoDB behind a Redis read-through cache
   that is invalidated on change.
3. **A permission check cannot be written without a version, and there is only one
   authoriser.** A permission check with no explicit permission version is a compile error, not a
   silent default; and exactly one authorisation implementation exists in the codebase - the
   inline closure that duplicated the role check is removed.
4. **No adapter holds a secret in an environment variable.** A user's platform credentials are
   stored in a KMS-backed secret envelope; and the audit field allowlist is widened to carry the
   app identifier, the permission version, and the group identifier as opaque values, with the
   justification recorded in the same change.
5. **A denial says what was denied.** A permission denial produces a clear, user-facing message
   naming what was denied rather than a generic error; and a permission check is performed at
   both points the v1 design requires - before the decision model sees the tool set, and again
   immediately before execution.

**Plans**: TBD

**Notes**: A **v1 correctness fix**, not a v2 feature. `RbacService.hasPermission` returns `true`
unconditionally, `getRoles` returns `['employee']`, the RBAC cache is an in-process `Map`, and the
identity mapping is an in-memory array - so every pod has its own cache and a worker restart
forgets every identity mapping. Group RBAC and the AI guard are both meaningless until this is
fixed, which is exactly why this phase precedes them.

The `perm_version = 0` default is removed and `perm_version` becomes a **required** parameter -
the compile error is the point. The RBAC cache key becomes `ak:rbac:{app}:{user}:{perm_version}`,
so revocation is one write and zero cache deletes.

**No deep research needed** - the code is in-repo. Use codebase pattern analysis on
`packages/domain/src/authz/**` and `packages/domain/src/identity/**` instead, plus the inline
`authorize` closure in `apps/worker/src/app.module.ts` that must go.

**Frozen-set exception**: the D-16/D-18 allowlist widening (`app_id`, `perm_version`,
`group_id` - opaque ids only, never names) is the single deliberate exception in this milestone.
`event_id`, `channel_id`, `thread_id`, and `reply_to_message_id` stay out, and no identifier is
smuggled through `reason`. The written justification lands in the same commit. Boundary edges for
the new element are declared in the same commit that uses them, or the build fails.

### Phase 12: Telegram Adapter

**Goal**: A Telegram user gets the same request-and-answer experience as a Slack user - verified,
authorised, threaded, and respecting both the platform's limits and the platform's own.

**Depends on**: Phase 11 (and structurally on Phase 10's seam)

**Requirements**: TGA-01, TGA-02, TGA-03, TGA-04, TGA-05, TGA-06, TGA-07, TGA-08, TGA-09, TGA-10,
TGA-11

**Success Criteria** (what must be TRUE):

1. **A forged update is rejected; a real one is answered in its thread.** The webhook endpoint
   rejects any update whose `secret_token` header does not match the configured secret, compared
   in constant time. A Telegram message is normalised into the shared inbound envelope with the
   platform event identifier derived from the update and message identifiers, and is answered in
   the thread it arrived in using the platform's reply and topic parameters.
2. **A slash command is a convenience, never the authorisation boundary.** A command is rejected
   unless the sender is authorised for the target app, with a mandatory per-command permission
   check carrying an explicit epoch - every time, not only at registration.
3. **An inline keyboard never breaks the message.** A choice encodes an opaque server-side
   handle, and the encoded payload never exceeds 64 bytes - if it would, the message fails to
   send rather than being truncated. A callback query is answered with `answerCallbackQuery`
   before any other work, so the user's button never spins.
4. **The bot's own configuration is verified rather than assumed.** The set of subscribed update
   types is declared explicitly at boot and checked against the platform's live webhook
   configuration; a mismatch fails startup. When the bot cannot observe group messages, the user
   receives a diagnosis naming the exact administrative step required, rather than silence.
5. **The platform respects Telegram's limits and its own.** Delivery respects both the platform's
   per-chat rate limits and the platform's own per-user and per-app limits. A Telegram update
   identifier is used only as a deduplication key, never as an ordering cursor. A Telegram reply
   can be edited in place to replace an expiring link, rather than being re-sent as a second
   message.

**Plans**: TBD

**Notes**: The lowest-risk platform, deliberately placed **first among the adapters**: first-party
SDK, thorough first-party documentation, no approval gate, no region constraint, no live-account
dependency - so it proves the shared multi-platform seam from Phase 10 at minimum risk.

`apps/api/src/adapters/telegram/` - controller (`POST /telegram/events`, no challenge
handshake), activity service normalising to `InboundEvent` with
`native_event_id = update_id + message.message_id`, and the outbound delivery port using
`node-telegram-bot-api@2.1.0` hosted **inside the existing Express app** (the library as a typed
API client, not a second HTTP stack - gap G6). The inline keyboard has a single
`TelegramCallbackData` builder enforcing the 64-byte limit and opaque handles only.
`answerCallbackQuery` is called first, in a `finally`. `allowed_updates` is set explicitly
(`message`, `callback_query`, `chat_member`, `my_chat_member`) and asserted at boot via
`getWebhookInfo`.

**Research flag: YES** - `/gsd-plan-phase 12 --research-phase`. **Spike S3** (half-day, against a
real bot): `setWebhook` with a `secret_token`, post into a forum topic, reply with
`reply_parameters`, observe the delivered message shape. Gap **G6** - decide the webhook-hosting
idiom; the recommendation is to host it in the existing Express app (one HTTP stack, one OTel
path, one auth seam).

**Parallel human work starts here**: Zalo's OA approval request and spike (S2') begin during
this phase. Zalo's critical path is human - OA approval, permission grants, VN egress - so the
clock starts now even though the build lands in Phase 13.

### Phase 13: Zalo OA Adapter

**Goal**: A Zalo OA user gets a verified, quota-aware, correctly-classed reply - the platform's
hardest integration, built to Zalo's actual rules rather than as a Slack-shaped clone.

**Depends on**: Phase 12 (and structurally on Phases 10-11)

**Requirements**: ZAL-01, ZAL-02, ZAL-03, ZAL-04, ZAL-05, ZAL-06, ZAL-07, ZAL-08, ZAL-09, ZAL-10,
ZAL-11, ZAL-12, ZAL-13, ZAL-14, ZAL-15

**Success Criteria** (what must be TRUE):

1. **A forged Zalo event is rejected before any work, and a real one is acknowledged inside the
   platform's deadline.** The webhook endpoint verifies the `X-ZEvent-Signature` digest computed
   over the exact raw request bytes using the OA Secret Key, compared in constant time; an invalid
   signature is rejected before any other work. The algorithm is implemented in exactly one
   module, and a captured real request is frozen as a regression test vector. The receiver
   acknowledges within the platform's 2-second deadline, having done nothing beyond verification,
   validation, deduplication, and enqueue.
2. **A redelivered event is not a second reply.** A Zalo event redelivered by the platform's
   retry ladder produces exactly one processing result, deduplicated on the platform's own
   message identifier.
3. **The OA never goes silently dark, and two users never merge into one.** The OA access token
   is refreshed ahead of expiry by a scheduled job, the refresh is single-flighted under a lock so
   concurrent workers cannot race, and the rotating refresh token is stored KMS-encrypted. A
   failure to refresh is surfaced to an administrator as an expiry countdown with a one-click
   re-authorisation path, not as a silent adapter failure. A Zalo identifier is carried as a
   string end to end, so two distinct users with 19-digit identifiers never collapse into one
   identity.
4. **The deployment fails loudly rather than lying about who a user is.** A deployment that
   cannot egress from the required region fails a typed startup check rather than silently
   resolving users as unknown. Before a consultation message is sent, the remaining quota for
   that user is read from the platform's quota API, and an exhausted quota is a distinct, visible
   outcome rather than a generic send failure - as is a user outside the platform's consultation
   window.
5. **The message arrives in the right shape, and nothing unsupported disappears quietly.** The
   three Zalo message classes - consultation, group, and broadcast - are sent through their
   correct class for the recipient (ZBS templates are explicitly out of scope). A non-text event
   (image, link, audio, video, sticker, location, business card, file) is acknowledged with a
   typed "unsupported" outcome listing the supported actions, not silently dropped. A follow and
   unfollow event is handled and reflected in who can be messaged. The client is hand-written over
   the platform's HTTP API with **no third-party Zalo package** - no unofficial, unlicensed, or
   deprecated Zalo dependency - and text is truncated to the platform's 2000-character limit inside
   the client rather than by silently widening the outbound contract.

**Plans**: TBD

**Notes**: The milestone's headline capability and its **highest-risk** item. It goes second only
because it carries a live-account dependency, an approval queue, a region constraint, and the
least-documented API surface in the set. Its *lead time* starts in Phase 12; its *build* starts
here.

`apps/api/src/adapters/zalo/` - controller, `ZaloWebhookVerifier` (the **single** module that
knows the algorithm: `sha256(app_id || rawBody || timeStamp || OAsecretKey)`, raw bytes, hex,
`timingSafeEqual`, OA Secret Key), and the activity service normalising `user_send_*` events with
`native_event_id = message.msg_id` and `quote_msg_id` as `reply_to_message_id`.

The **hand-rolled `undici` OA client** (~200 lines) covers the OAuth v4 token exchange, the
`openapi.zalo.me` send, and the quota check. Token lifecycle: KMS-encrypted rotating refresh
token, single-flight refresh under a Redis lock, ~20 h scheduled refresh on a BullMQ Job Scheduler
(**never** `@nestjs/schedule`), access token in a Redis cache with a TTL shorter than its own
lifetime. Identifiers are big-int-safe end to end - strings only, no `z.coerce.number()`, with
fixtures using the real 19-digit values.

**Research flag: YES** - `/gsd-plan-phase 13 --research-phase`. **Spike S2'** (two days, real OA):
register a webhook, capture the exact bytes, verify the signature offline against a recorded
digest, exercise both reply forms, read the group APIs, deliberately exhaust a test quota. Must
resolve the two conflicting documented concatenations (OA form vs Mini-App form) and confirm
`timeStamp`'s location. Also **S5** - the VN-egress vs data-residency question is a
customer/deployment decision, not a code decision.

Gaps carried here: **G1** (signature byte-exactness), **G3** (OA vs Bot surface - build against
the OA), **G4** (approval lead time), **G5** (quota-exhaustion behaviour), **G6** (VN egress vs
residency).

### Phase 14: Two-Way Synchronisation & Delivery Semantics

**Goal**: An external system can push status back to the person who asked - verified,
replay-protected, exactly-once, and landing in the right thread of the right conversation.

**Depends on**: Phases 10-11 (and structurally on Phase 13's per-platform delivery semantics)

**Requirements**: SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05, SYNC-06, SYNC-07, SYNC-08, SYNC-09,
SYNC-10, SYNC-11

**Success Criteria** (what must be TRUE):

1. **Only the connector's own signed calls are accepted, and each one lands once.** An external
   system can post a signed notification, and the signature is verified against the connector's
   secret over the raw body before the payload is parsed. A replayed webhook - same signature,
   same timestamp, same nonce - is rejected. A redelivered external webhook produces exactly one
   notification.
2. **An unmappable notification is recorded, not ignored.** An external entity identifier is
   mapped to the submission it refers to, and an unmappable identifier produces a recorded
   rejection rather than a silent no-op.
3. **The notification reaches the right person, in the right place.** The notification reaches
   the person who submitted the request, resolved from the submitter's identity at send time -
   not from a stored chat identifier that may have changed. The submitting user's platform,
   conversation, and thread identity is bound to the submission at submit time (a submission
   created before this change cannot be retrofitted). The notification lands in the thread of the
   original request on platforms that support threading, and degrades to a new message in the
   conversation on platforms that do not.
4. **A notification link expires sooner than the maximum view-link lifetime, without changing
   the link schema.** The notification deep link carries a shorter expiry, expressed by the
   issuer - the link claim schema itself is unchanged.
5. **A failed notification is never silent, and a multi-turn request is never assembled out of
   order.** A failed delivery is retried and then dead-lettered, and the dead letter is visible
   with a metric and an operator surface. Turns within one conversation are ordered, so a
   multi-turn request is not assembled from out-of-order deliveries. A connector without webhook
   support can fall back to polling at a configurable interval of at least 60 seconds.

**Plans**: TBD

**UI hint**: yes

**Notes**: The capability that turns the gateway into a **two-way** integration surface, and the
"lands in the right thread, addressed to the right submitter" differentiator. The naive version
of this feature produces an orphan top-level message sent to a different person.

The ordering layer gives per-`(conversation, user)` turn ordering; the dedupe machinery uses
unique indexes on `(platform, native_event_id)` plus a second Slack key on the message `ts`
(Slack can deliver the same message with different `event_id`s - gap G9). Consumers are
idempotent by construction - upserts and version-keyed transitions, never "have I seen this?".
Per-platform reply semantics: Slack `thread_ts` + `reply_broadcast`, Telegram
`reply_parameters` / `message_thread_id`, Zalo quote-reply as a new message in the OA chat
window, Teams `replyToId`.

**Frozen contracts**: the shorter notification TTL is expressed by the **issuer** (the 90-day
ceiling is a maximum, already enforced by `.refine()`), and the notification destination is
resolved from `real_user_id` to a conversation reference at send time rather than by adding a
`target_id` claim. `git diff` on `read-link-claims.ts` must be empty.

**Research flag: NO** deep research - the platform mechanics are documented. What needs
per-phase discovery is the **per-connector external-system contract** (which downstream systems
push status back, and their webhook semantics); treat that as a connector-contract discovery task
inside the phase, not a research-phase.

**Parallelisation note**: this phase can run in parallel with Phase 13 once Phase 10 lands - they
touch different adapters and different queues.

### Phase 15: Directory & Group RBAC Sync

**Goal**: An app owner can grant a role to a whole team, and both the grant and its revocation
behave correctly even when the directory is stale, rate-limited, or failing.

**Depends on**: Phase 11 (the real resolver it binds to) and Phase 14 (the ordered delivery it
shares the conversation-reference model with)

**Requirements**: GRP-01, GRP-02, GRP-03, GRP-04, GRP-05, GRP-06, GRP-07, GRP-08, GRP-09, GRP-10,
GRP-11, GRP-12, GRP-13

**Success Criteria** (what must be TRUE):

1. **Binding a group grants the whole team, and only this app.** An app owner binds a group to a
   role for their app; the binding is app-scoped and does not affect any other app. A user's
   effective permissions include the union of the permissions of every group bound to the app
   that the user belongs to, and where a directly-assigned user role conflicts with a
   group-derived one, the direct assignment takes precedence.
2. **Membership is read from the platform that owns it, and absence is never confused with
   emptiness.** Slack group membership is read from the usergroups API including the member list.
   Microsoft Graph group membership is read, and a terminal directory-sync state triggers a full
   resync rather than an unbounded retry. Zalo group membership is read when the deployment
   holds the group-management permission; without it, the source reports as unavailable rather
   than as an empty group. Telegram group membership is not offered - the platform's Bot API
   cannot enumerate it - and this is documented rather than silently missing.
3. **Losing group membership revokes the permission, everywhere, on the next check.** A revoked
   group-derived permission is revoked across every replica and is effective on the next
   permission check.
4. **Staleness is bounded and observable, and a failed read never destroys good data.**
   Membership staleness is bounded by event-driven invalidation plus periodic full
   reconciliation plus a maximum-staleness window, and the bound is documented. A failed
   membership read never replaces a known-good membership set: the source is quarantined, the
   last good state is retained, and an alert fires.
5. **A synchronised grant is not mistaken for an unauthorised self-grant, and the directory is
   never written back to.** A group-derived grant and revocation are audited with the sync job
   as the actor and the group identity attached. Directory sources are read-only; the platform
   never writes membership back to a directory it reads from. A revoked app disappears from an
   open clarification session, preserving the v1 re-filtering invariant under the group axis.

**Plans**: TBD

**UI hint**: yes

**Notes**: Needs the real resolver (Phase 11) to have anything to bind to. Group binding is
worthless without knowing who is in the group - and the *real* version handles stale membership.

The new `groups` element (`packages/domain/src/groups/` - `group_memberships`,
`group_role_assignings`, `user_app_epochs`, `GroupSyncService`, `GroupBindingService`, and a
pluggable `DirectorySource` port whose `writeMembers` is `never` for read-only sources) is a
**new element type** in `tooling/boundaries.config.mjs` - declared in the same commit that uses
it, or the build fails.

`GroupSyncProcessor` runs in the **worker**; a BullMQ Job Scheduler registration runs in the
**scheduler** (R1: the scheduler registers and enqueues, the worker performs), with a Redis
overlap lock. The **group-aware epoch fan-out** is a bulk `updateMany` `$inc` over the symmetric
difference (added u removed) - never per-member cache deletes, never inline for a large group
(gap G11: a naive synchronous fan-out of 500 members x 20 apps can take down the sync worker, so
it is a queued, batched, idempotent job with its own rate limit).

Directory sources: Slack `usergroups.list` with `include_users` (read-only, Tier 2 ~20 req/min;
`plan_upgrade` / `missing_scope` surfaced as admin configuration errors, never as an empty list);
Microsoft Graph `/groups/{id}/transitiveMembers` and `/groups/delta` over `undici`, with
`syncStateNotFound` and `410 + empty $deltatoken` handled as **one terminal state** -> discard
cursor -> full resync, `Retry-After` honoured on 429, order-independent page merge, no narrow
`$select` on delta queries; Zalo `listmember` with explicit `count` (default is 5), the
group-management scope checked at onboarding, and pending members kept separate.

**Research flag: YES** - `/gsd-plan-phase 15 --research-phase`. **Spike S4** - which Graph
application permission (`GroupMember.ReadBasic.All` vs `Group.Read.All`) is grantable in the
target tenant, and whether admin consent is obtainable - a **customer** action, so it must be
asked during Phase 12/13 discovery. **Spike S5** - which directory source is the system of record
(Entra ID, LDAP/AD, or a CSV export)? That determines the connector type, the sync cadence, and
whether membership is authoritative or advisory. **Do not adopt a `<1.0` SCIM server library** to
answer this.

### Phase 16: Permission-First Open-Ended AI Guard

**Goal**: A user can describe what they want in plain language and the model narrows it to a
pre-authorised app - the model chooses, it never invokes, and it never guesses.

**Depends on**: Phase 15 (the permitted set is the union of app-scoped and group-scoped
permissions) and Phase 14 (the ordered multi-turn context)

**Requirements**: AIG-01, AIG-02, AIG-03, AIG-04, AIG-05, AIG-06, AIG-07, AIG-08, AIG-09, AIG-10,
AIG-11, AIG-12, AIG-13

**Success Criteria** (what must be TRUE):

1. **The model never sees what the user cannot open.** The decision model receives only the tool
   set the requesting user is authorised for - never the global catalogue.
2. **The model cannot act, and the platform re-checks before it does.** The model selects a
   tool; it has no mechanism to invoke one, and no tool is exposed with an executable handler. The
   platform re-validates the selected tool against the permitted set at execution time using the
   current permission version.
3. **Uncertainty produces a question, not a guess.** A request exceeding the tool-catalogue cap
   is rejected with a typed error rather than silently truncated - the catalogue is narrowed by
   relevance, never cut arbitrarily. When no permitted tool is offered, when the model's
   confidence falls below the configured threshold, when a competing permitted alternative is
   within the disambiguation window, or when the deadline expires, the system asks a bounded
   clarification instead of guessing.
4. **The guard is bounded, and every fallback is equally constrained.** The model runs at zero
   temperature with a bounded step count and an absolute deadline. Every fallback provider in the
   chain is subject to the same constraints, and every fallback returns a clarification on
   uncertainty - a fallback that guesses the most likely tool is a bypass. A cost and latency
   budget with a circuit breaker opens to clarification, never to a guess.
5. **Model-visible content cannot instruct the platform, and the guard's output is a closed
   set.** User text, form values, connector responses, and documents are treated as untrusted
   input and cannot instruct the platform to act. The guard may only produce a reply, a form
   link, a confirmation, an error, or a status - never free-form generated content. The
   clarification prompt is generated by the model but rendered as a bounded choice surface with
   at most three options, re-authorised at display time. The guard is a decorator on the existing
   decision provider, so the frozen decision wire contract is unchanged and no new pipeline stage
   is introduced - and the model never issues the request: the link always goes through the
   one-time-link form-consent path.

**Plans**: TBD

**Notes**: Last among the capabilities, and the one that must **not** be cut when the milestone
runs long. It depends on the RBAC filter being real, on the v1 clarification session, and on the
Phase 14 ordered-turn machinery - so it lands on a proven substrate rather than carrying the
milestone's risk.

`GuardedProvider` is a `JevProvider` **decorator**: inbound guard -> inner provider -> outbound
re-validation of the chosen tool against `permitted` -> a refusal degrades to the next provider
in the chain, terminating at the local rule-based provider. The `ai@7` adapter uses **exactly
one** `@ai-sdk/*` provider package selected through the JEV registry, `Output.object()` for
schema-constrained output, **no `execute` on any tool**, `temperature: 0`, and
`stopWhen: isStepCount(n)` with a small bound.

**NG1 is amended, not reversed** (gap G12): the model gains a wider *input* space (free-text
intent) while its *action* space stays narrower (select a pre-authorised app). The containment
mechanism is the action allowlist - `reply | form_link | confirmation | error | status`. A guard's
correctness is testable; a chatbot's is not.

The disambiguation interaction surface is **in chat, not web**: a Telegram inline keyboard with a
server-side opaque token, Slack buttons, a Zalo numbered list - each carrying a `choice_id`
resolved server-side. The `interaction` inbound action is reused rather than a new
`InboundAction` value added (gap G10 - decide before Phase 16).

**Research flag: YES** - `/gsd-plan-phase 16 --research-phase`. **Spike S6** - which provider,
which model, which host, and does it satisfy data residency? The tool-catalogue
accuracy-vs-size curve must be **measured on the v1 fixture set**, not guessed, before the cap is
chosen (gap G13). G12 must be framed explicitly for stakeholders.

### Phase 17: Security, Compliance & Operations

**Goal**: The four-platform deployment is operable and diagnosable - a silent platform failure is
impossible, every credential and region has a documented recovery path, and the performance
claims are measured rather than assumed.

**Depends on**: Phases 10-16

**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OPS-06, OPS-07, OPS-08, OPS-09, OPS-10

**Success Criteria** (what must be TRUE):

1. **A platform-side webhook disable cannot hide.** A readiness probe reports a registered OA that
   has received zero events for a configurable period - a platform-side webhook disable is
   otherwise invisible. The Zalo webhook re-enrolment procedure is documented as a runbook and
   surfaced as an administrator alert, not as a log line.
2. **The deployment's constraints are stated plainly.** The deployment documents plainly that
   Zalo support requires egress from Vietnam, and states the topology requirement for the
   region-locked data-residency constraint.
3. **Every credential has a recovery path.** Runbooks exist for OA refresh-token loss and
   one-click re-authorisation, Telegram bot-token rotation, Graph client-secret rotation, and
   for registering each platform's egress IP addresses with the platform.
4. **The performance claims are measured, not assumed.** The receiver acknowledgement latency is
   verified at the 99th percentile against the 1.2-second target on every platform, with an
   alert when it is exceeded. The cost of the three-tier rate limiter is measured now that it
   applies to four platforms, and the directory sync write volume is measured at target tenant
   size.
5. **The new identifiers are as auditable and erasable as the old ones.** The audit and erasure
   coverage is re-verified for every identifier introduced in this milestone. The outbound
   delivery failure rate and dead-letter depth are exposed as metrics with alerting. The
   allowlist governance record is updated so that each widening is attributable to a named
   requirement.

**Plans**: TBD

**UI hint**: yes

**Notes**: **Not optional cleanup** - the Zalo re-enrolment runbook, the egress/region matrix, and
the credential operations are the difference between a recoverable incident and a 90-day outage.
Several of these are *prerequisites discovered by the spikes* and must land in the same
milestone.

The **per-OA event-freshness probe** on the readiness surface (distinct from process liveness)
plus a scheduled probe for "OA registered but zero events for N hours" is the only way to learn
about a Zalo webhook disable - Zalo retries 5x (30 s / 5 m / 15 m / 30 m / 1 h) and then
**silently disables** the webhook with no email, no API, and no warning; re-enrolment is a manual
portal action. Alert at ack **p99 > 1.2 s**, not at the 2 s cliff.

The **VN egress / data-residency matrix** states plainly that Zalo support is VN-egress-only, with
the deployment topology requirement and the typed self-check. Telegram bot-token rotation is a
**hard cutover** - the platform offers no dual-key window, so the runbook is the mitigation, not
an invented rotation (gap G8).

**Research flag: NO** - these are the v1 Phase 9 operational patterns (metric registry, alert
rules, runbooks, promtool CI gate), applied. Real per-tenant IM credential volume - KMS reads per
request x tenant count x 3 platforms - determines whether a credential cache is needed and its
TTL; measure it here.

---

## Timing

**Not estimated in this roadmap.** `research/SUMMARY.md` supported the *order* strongly but
explicitly did not estimate durations, and inventing a figure here would be dishonest. The
bottom-up per-phase estimate (planning, execution, verification, code review, human UAT) must be
derived against this 8-phase structure before the milestone is committed to a date.

---

## Progress

**Execution Order:**

Phases execute in numeric order: 10 -> 11 -> 12 -> 13 -> 14 -> 15 -> 16 -> 17

**Parallelisation (2-engineer team):** Phases 13 (Zalo) and 14 (two-way sync) can run in
parallel once Phase 10 lands - they touch different adapters and different queues. Phase 15's
directory-sourced half (Slack + Graph) can also run alongside Phase 13, since it needs no Zalo. A
one-engineer team should follow the sequence.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 10. Outbound Delivery Seam & Event Contract | 3/8 | In Progress | - |
| 11. Real Authorization & Persistent Identity | 0/TBD | Not started | - |
| 12. Telegram Adapter | 0/TBD | Not started | - |
| 13. Zalo OA Adapter | 0/TBD | Not started | - |
| 14. Two-Way Synchronisation & Delivery Semantics | 0/TBD | Not started | - |
| 15. Directory & Group RBAC Sync | 0/TBD | Not started | - |
| 16. Permission-First Open-Ended AI Guard | 0/TBD | Not started | - |
| 17. Security, Compliance & Operations | 0/TBD | Not started | - |

---

## Milestone Summary

**Milestone:** v2.0 - Platform Expansion & Advanced Capabilities
**Status:** Planned - awaiting Phase 10
**Phase range:** 10-17 (8 phases)
**Requirements:** 97 total - OUT 14, AUT 10, TGA 11, ZAL 15, SYNC 11, GRP 13, AIG 13, OPS 10
**Coverage:** 97/97 mapped to exactly one phase - 0 unmapped, 0 duplicated

**What v2.0 delivers:** all four target platforms (Slack, Teams, Zalo OA, Telegram) as genuinely
two-sided plug-ins over one normalised contract; a real outbound delivery seam with a durable
reconcilable ledger; real, persistent, epoch-backed authorisation; two-way synchronisation from
external systems back to the original submitter; directory and group RBAC with bounded staleness
and revocation that actually revokes; a permission-first open-ended AI guard that chooses but
never invokes; and an operational surface that makes four platforms survivable.

**Research flags:** Phase 12 (S3), Phase 13 (S2'), Phase 15 (S4 + S5), Phase 16 (S6 + a
measurement pass on the v1 fixture set). Phases 10, 11, 14 and 17 need no deep research - the
patterns are in-repo; Phase 10 needs a **decision memo** on four contract questions, not a
research pass.

**Human actions on the critical path** (not code work - track these from Phase 12):
1. Zalo OA approval and creation, plus permission grants (gap G4).
2. The VN-egress vs data-residency deployment decision (gap G6, spike S5).
3. Microsoft Graph application-permission admin consent in the target tenant (spike S4).
4. The directory-source-of-record decision - Entra ID, LDAP/AD, or CSV export (spike S5).

**Non-negotiables carried into v2.0:**
1. The outbound seam precedes every adapter.
2. Real RBAC precedes group RBAC and the AI guard.
3. The AI guard is a `JevProvider` decorator, never a pipeline stage.
4. D-21 and D-23 are not edited - the notification TTL is expressed by the issuer, and the guard
   inherits the frozen JEV wire contract unchanged.
5. The receiver is a pure ingest contract: verify -> validate shape -> dedupe -> enqueue -> 200.
   This holds for all four platforms and is now a 2-second budget on Zalo.

**Frozen contracts:** D-21 (read-link claims), D-23 (JEV v1 wire), D-43 (audit field allowlist).
The single deliberate exception is the D-16/D-18 allowlist widening in Phase 11, with its
written justification in the same commit.

**Stack:** frozen. New runtime dependencies permitted: `node-telegram-bot-api@2.1.0`, `ai` +
exactly one `@ai-sdk/*` provider package, and **no Zalo package at all** (hand-rolled over
`undici`). OpenTelemetry is **not** bumped during this milestone - 3.0.0 shipped 2026-10-20 and
is breaking; it is scheduled as one isolated change afterwards.

**Deferred to v2.x / v3:** notification topic subscriptions (FR-N-5), per-app notification muting
(FR-N-7), Zalo GMF group targeting, Telegram forum-topic-aware threads, SCIM/Entra ID as an
authoritative directory upstream, the remaining 29 IM platforms, cross-app collection sharing,
multi-step approval workflows, and the OpenTelemetry 3.0.0 upgrade.

---

*Roadmap created: 2026-10-22 - v2.0, 97/97 requirements mapped across 8 phases (10-17)*
*v1.0 archived: 2026-10-21 - 9 phases, 72 plans, all complete*
*v1.0 archive: .planning/milestones/v1.0-ROADMAP.md and .planning/milestones/v1.0-REQUIREMENTS.md*
*Next: /gsd-plan-phase 10*
