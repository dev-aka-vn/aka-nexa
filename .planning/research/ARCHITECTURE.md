# Architecture Research — v2 (Platform Expansion & Advanced Capabilities)

**Domain:** Chat-driven enterprise workflow gateway — IM adapters → permission-first routing → signed one-time links → FormIO.js forms → hybrid data routing (MongoDB / connector / both)
**Milestone context:** **v1 shipped 2026-10-21** (9 phases, 72 plans). v2 starts at **Phase 10** and adds: Zalo OA + Telegram adapters, two-way IM sync, group/directory sync RBAC, and a permission-first open-ended AI guard.
**Scope of this document:** **the v2 delta only.** The v1 architecture is shipped, running, and documented in `.planning/milestones/v1.0-ROADMAP.md` and the v1 research set. This document does not re-derive it — it states only what v2 adds, what v2 modifies, and what v2 must *not* touch.
**Researched:** 2026-10-21
**Confidence:** **HIGH** on component boundaries, the contract delta, the idempotency design, the group-revocation model, and the AI-guard placement — every claim below was read out of the shipped source, not inferred from the PRD. **MEDIUM** on the Zalo webhook signature semantics and on the Telegram group-membership limitation (both platform-side facts that need a spike; see §11).

---

## Verdict — the nine findings that shape v2

| # | Finding | Consequence for the roadmap |
|---|---------|------------------------------|
| **1** | **The contract already knows about Zalo and Telegram.** `ImPlatformSchema = z.enum(['slack','teams','zalo','telegram'])` (`packages/contract/src/events/inbound-event.ts:27`). FR-IM-1's platform list and FR-IM-2/FR-IM-3's normalization requirement are satisfied by **reusing the shipped envelope** — no new event schema, no new outbound schema, no new spec version. | The adapters are **additive, not inventive** (the same conclusion Phase 8 reached for Teams). Budget accordingly. |
| **2** | **Nothing is ever delivered back to the chat.** `InboundEventProcessor.process()` returns `{kind:'link', appId, url}` (`apps/worker/src/processors/inbound-event.processor.ts:194`) — but BullMQ discards a processor's return value. `TeamsOutboundService` exists (`apps/api/src/adapters/teams/teams.outbound.service.ts:70`) and **has no caller anywhere in the repo**. The only outbound path that works today is `NOTIFICATION_SEND_QUEUE`, and `NotificationProcessor` hardcodes `TeamsDeliveryService` (`apps/worker/src/processors/notification.processor.ts:87`). | **The v2 platform work is blocked on an outbound seam that does not exist.** This is Phase 10 and it precedes the adapters. Shipping Zalo before it produces a bot that receives perfectly and never answers. |
| **3** | **The clarification session is keyed on a field the envelope cannot carry.** `ClarificationSessionService.sessionKey(realUserId, channelId, threadTs)` (`packages/domain/src/decision/clarification-session.service.ts:73`) takes a `threadTs`; the processor passes `event.channel_id` for **both** arguments as a placeholder (`inbound-event.processor.ts:203`, `:282`). The shipped envelope has no thread field. | FR-IM-8 (threading) needs `thread_id` / `reply_to_message_id` on the envelopes. The v1 code is already reaching for them. This is a **contract minor amendment**, not a redesign. |
| **4** | **RBAC is a stub.** `RbacService.hasPermission` returns `true` for `'leave:request'` unconditionally and `getRoles` returns `['employee']` (`packages/domain/src/authz/rbac.service.ts`). The real authorization is an inline closure in `apps/worker/src/app.module.ts:53-65` that reads `def.role_assignments` as a `Record<string, unknown>`. The RBAC cache is an in-process `Map` (`rbac-cache.service.ts`), and the identity mapping repository is an in-process array (`packages/domain/src/identity/identity-mapping.repository.ts:11`). | **v1 shipped a product where every user can use every app, and where a worker restart forgets every identity mapping.** This is a v1 correctness defect, not a v2 feature — and group RBAC is *impossible* on top of a stub. Fix it **before** the group feature. |
| **5** | **The dedupe precedent is Mongo, not Redis and not BullMQ.** `TeamsEventRepository` (`packages/domain/src/adapters/teams/inbound/data-access/teams-event.repository.ts`) owns a `MongoClient` with 500 ms fail-closed timeouts (D-39) and a **unique index on `platform_event_id`**; the v1 ROADMAP records the reason: BullMQ `jobId` dedup lapses on `removeOnComplete`. | v2's dedupe is the **same mechanism, generalised**. Redis `GETDEL` is the fast path, not the guarantee. |
| **6** | **The receiver has a message-loss window.** The order is insert-dedupe-row → upsert-conversation-ref → `queue.add` (`teams-activity.service.ts:68-90`). A crash between the insert and the enqueue leaves the dedupe row saying "seen" and the event **never queued** — and because the platform got a 2xx, it will not retry. Slack retries 3×; Telegram retries on non-2xx; Zalo's behaviour is undocumented. | v2 must close this with a **pending → dispatched** state on the dedupe row plus a scheduler-driven reconciler. This is cheap, and it is the difference between "at-least-once" and "best-effort". |
| **7** | **Conversation references are keyed without the platform.** `ConversationReferenceRepository.key(channelId, chatUserId)` = `${channelId}::${chatUserId}` (`packages/domain/src/notifications/data-access/conversation-reference.repository.ts:32`). A Telegram `chat_id` of `123` and a Zalo `conversation_id` of `123` and a Slack channel `C123` can collide. The stored row is also Teams-shaped (`serviceUrl`, `tenantId`). | The key **must** become platform-scoped and the row must carry a platform discriminator before the second platform ships. This is a data migration on a small collection. |
| **8** | **Telegram bots cannot enumerate group members.** The Bot API exposes `getChat`, `getChatAdministrators`, `getChatMemberCount` and `getChatMember` (one user) — there is no `getChatMembers`. Membership is observable only through `new_chat_members` / `chat_member` events, i.e. only for users who interact with the bot. | **Telegram group→role sync is not implementable with the Bot API.** Zalo *can* list members (`GET /v3.0/oa/group/listmember`) but only with the "quản lý thông tin nhóm" permission and a paid GMF package. v2's group feature must be **directory-sourced first**, Zalo second, Telegram **not at all**. See §6.4. |
| **9** | **The permission-first guarantee already holds, and the AI guard must be built around it, not beside it.** `RoutingOrchestrator.route` builds `permitted` from `authorizedTools` and passes `tools: [...input.authorizedTools]` — never the global catalogue — and filters `app_hints` by `permitted` (`packages/domain/src/decision/routing-orchestrator.ts:50-59`). `canOpenNow` is the fresh re-check at the execution boundary (`:20`). | **FR-J-6 is already implemented.** The v2 AI guard is a **decorator on a provider**, not a new pipeline stage. It must not become a place where the tool set is widened. |

### The one non-negotiable

> **The v2 platform work is not "add two adapters".** It is "add an outbound seam, fix a stubbed RBAC, then add the adapters." A Zalo adapter shipped on top of finding #2 produces a bot that reads messages and never replies; a group feature shipped on top of finding #4 produces a group binding that grants everything.

---

## Standard Architecture

### System Overview

The v1 topology is unchanged — three NestJS entrypoints, one DI graph, one DI-enforced boundary model, three BullMQ queues. What changes is **where the new work attaches**.

```
        ┌──────────────────────────────────────────────────────────────────┐
  T1    │  INTERNET  (Slack · Teams · Zalo OA · Telegram · browsers ·      │
        │            external systems)                                     │
        └───────────────────────────────┬──────────────────────────────────┘
                                        │ TLS at LB / ingress
  T2    ┌───────────────────────────────▼──────────────────────────────────┐
        │  INGRESS  nginx / ALB   — IP rate limit, body-size cap          │
        └───────┬──────────────────────────────────────────┬───────────────┘
                │ webhook POST (4 platforms)                │ HTTPS (browsers)
                │ untrusted                                 │ untrusted
                ▼                                          ▼
  ┌──────────────────────────────────┐      ┌──────────────────────────────┐
  │  PROCESS: api                   │      │  STATIC: form-renderer /     │
  │  ├─ IM receivers (4)      [NEW]  │      │  builder  (Vite → CDN)       │
  │  │   slack / teams / zalo / tg  │      │  no secrets, no cookies      │
  │  │   verify → dedupe → enqueue   │      └──────────────┬───────────────┘
  │  │   <200 ms ack (D-13)         │                     │ bearer in URL
  │  ├─ Link / Submission / Builder  │◄────────────────────┘
  │  └─ NO connector HTTP, NO Worker│
  └───────────────┬──────────────────┘
                  │ enqueue only
  T3              │ 'inbound-events'
        ┌─────────▼────────────────────────────────────────────────────────┐
        │  PROCESS: worker                                                 │
        │  ├─ InboundEventProcessor  (identity → RBAC filter → JEV → link) │
        │  │        └─ NEW: enqueue OutboundMessage to 'im-outbound'       │
        │  ├─ OutboundMessageProcessor [NEW] → OutboundDispatcher [NEW]    │
        │  │        → slack / teams / zalo / telegram delivery clients     │
        │  ├─ NotificationProcessor (MODIFIED: platform-dispatched)        │
        │  ├─ GroupSyncProcessor   [NEW]                                   │
        │  └─ PlatformEventDispatchProcessor [NEW] (pending→dispatched)    │
        └───────────────┬──────────────────────────────────────────────────┘
                        │
  T4    ┌───────────────▼──────────────────────────────────────────────────┐
        │  PROCESS: scheduler  (BullMQ Job Schedulers — the only writer)  │
        │  ├─ reconciliation      (v1)                                    │
        │  ├─ audit-retention / purge-sweep / access-review (v1)          │
        │  ├─ group-sync          [NEW]  — every N min, per source         │
        │  └─ platform-event-dispatch [NEW] — re-dispatch pending rows    │
        └─────────────────────────────────────────────────────────────────┘

  STORES   MongoDB 8.0.x  (apps · submissions · platform_events · groups ·
                           group_role_assignments · user_app_epochs ·
                           identity_mappings · conversation_references)
           Redis ≥8.2    (clarify sessions · rbac cache · one-time tokens ·
                           BullMQ queue)
           KMS           (read-link keys · connector creds · IM platform creds)
```

**Trust boundaries that v2 must not blur**

| Boundary | Rule | v2 consequence |
|----------|------|----------------|
| IM platform → receiver | Untrusted input. Verify, then ack <200 ms, then enqueue. **No logic in the receiver.** | Zalo and Telegram have **no challenge handshake** (see §11, S2/S3). Verification is signature/secret-based, and the receiver stays a pure ingest contract. |
| Receiver → worker | Queue boundary. The only shared contract is the `InboundEvent` envelope. | v2's dedupe ledger is the **write-once record** that survives the at-least-once delivery the queue guarantees. |
| Worker → decision | The RBAC filter runs **before** the provider. | The AI guard is a **provider decorator**. It never sees an unfiltered tool set. |
| Decision → read link | `perm_version` epoch check at verification. | Group RBAC folds into the **one existing** `perm_version` claim. D-21 is not touched. |

### Component Responsibilities

| Component | New / Modified | Responsibility | Typical Implementation |
|-----------|----------------|----------------|------------------------|
| `apps/api/src/adapters/<platform>/` — receiver | **NEW** (zalo, telegram) · **MODIFIED** (slack) | Verify the platform's signature/secret, normalise to `InboundEvent`, insert the dedupe row, upsert the conversation reference, enqueue, ack <200 ms | Controller → `<Platform>ActivityService` → `PlatformEventRepository.insert()` → `ConversationReferenceRepository.upsert()` → `queue.add(INBOUND_EVENTS_QUEUE, event)` — the shipped Teams shape, generalised |
| `packages/domain/src/adapters/<platform>/inbound/data-access/` | **MODIFIED** (generalise) | The write-once platform-event ledger. Unique index per platform on the platform's own event id | One `PlatformEventRepository` class, collection name parameterised by platform (`${platform}_events`), unique index on `platform_event_id`, 500 ms fail-closed timeouts |
| `packages/domain/src/adapters/<platform>/outbound/` | **NEW** (zalo, telegram) · **MOVED** (teams, slack) | The platform's outbound client: build the platform call, enforce the platform's text/rate limits, map the thread/reply reference | A `send(message, context)` method behind a `PlatformDeliveryPort`; transport is `undici` (Zalo, hand-rolled) or `node-telegram-bot-api` (Telegram) |
| `packages/domain/src/adapters/data-access/platform-credential.repository.ts` | **NEW** | Store the Zalo OA secret / access token and the Telegram bot token as `SecretEnvelope`s | `upsert(ref, headerName, plaintext)` seals via `sealSecret`; `get(ref)` returns the envelope; the reader calls `openSecret` from `packages/platform/src/crypto/**` |
| `apps/worker/src/adapters/outbound-dispatcher.ts` | **NEW** | Resolve `platform → PlatformDeliveryPort` and route an `OutboundMessage` to it | App-layer composition. It may import both `notifications` and `adapters`; **no domain element may** (R1) |
| `apps/worker/src/processors/outbound-message.processor.ts` | **NEW** | Consume `im-outbound`; retry with jittered backoff; DLQ on terminal failure | `@Processor(IM_OUTBOUND_QUEUE, { backoffStrategy: notificationJitterBackoff })` — the shipped `NotificationProcessor` shape |
| `apps/worker/src/processors/notification.processor.ts` | **MODIFIED** | Stop hardcoding `TeamsDeliveryService`; resolve the platform and delegate to the dispatcher | Inject the dispatcher instead of the Teams service |
| `apps/worker/src/processors/inbound-event.processor.ts` | **MODIFIED** | On `{kind:'link'}` / `{kind:'clarify'}`, **enqueue an `OutboundMessage`** instead of returning it | `queue.add(IM_OUTBOUND_QUEUE, message)` with a stable `message_id` so retries do not duplicate the send |
| `packages/domain/src/authz/rbac.service.ts` | **MODIFIED (was a stub)** | Evaluate the real effective permission set for `(app, user)` from direct assignments ∪ group-derived assignments | Read `role_assignments` + `group_role_assignments` + `roles_permissions` from the app definition; expand the user's groups; return the permission set |
| `packages/domain/src/authz/rbac-cache.service.ts` | **MODIFIED** | Move from an in-process `Map` to Redis, keeping the **epoch-keyed** key | `ak:rbac:{app_id}:{real_user_id}:{perm_version}` — the key already exists. A `perm_version` bump creates a *new* key, so the stale entry is never read again: the epoch makes the cache self-invalidating |
| `packages/domain/src/authz/permission-check.service.ts` | **MODIFIED** | `perm_version` must come from a real store, not the `= 0` default | Read the user's epoch from `user_app_epochs`; pass it to the cache and to the link issuer |
| `packages/domain/src/identity/identity-mapping.repository.ts` | **MODIFIED (was in-memory)** | Persist identity mappings; keep the Redis cache + immediate invalidation (FR-I-4, FR-I-6) | Mongo-backed repository behind the same interface, with a Redis read-through cache |
| `packages/domain/src/groups/` | **NEW element** | The group model, membership sync, group→app role bindings, and the revocation bump | `group_memberships`, `group_role_assignings`, `user_app_epochs` collections; a `GroupSyncService` |
| `packages/domain/src/decision/guarded-provider.ts` | **NEW** | The permission-first open-ended AI guard, as a **decorator** around a hosted provider | Implements `JevProvider`; runs the inbound guard, calls the inner provider, runs the outbound guard, re-validates the choice against `permitted` |
| `packages/domain/src/decision/clarification-session.service.ts` | **MODIFIED** | Key on the real thread id; raise the turn bound for open-ended disambiguation | `sessionKey(realUserId, channelId, thread_id)` — the signature already takes a `threadTs`; the caller just starts passing the right value |
| `packages/contract/src/events/inbound-event.ts` | **MODIFIED (minor)** | Add `thread_id?` and `reply_to_message_id?` | Two **optional** fields on a `.strict()` schema — backward compatible; update the strictness spec |
| `packages/contract/src/events/outbound-message.ts` | **MODIFIED (minor)** | Add `thread_id?` and `reply_to_message_id?` | Same |
| `packages/platform/src/logging/log-allowlist.ts` | **MODIFIED (additive, one commit)** | Add `app_id`, `perm_version`, `group_id` | Each with a written justification in the same commit — the file's own rule. `event_id` and `channel_id` stay out |
| `packages/platform/src/queue/queue.constants.ts` | **MODIFIED** | Add `IM_OUTBOUND_QUEUE = 'im-outbound'` and `GROUP_SYNC_QUEUE` / `PLATFORM_EVENT_DISPATCH_QUEUE` | Same frozen-constant discipline as the existing two |
| `tooling/boundaries.config.mjs` | **MODIFIED** | Add the `groups` element type and its allowed edges | **One** element addition. See §7 for why the outbound seam needs none |

---

## Recommended Project Structure

```
apps/api/src/adapters/
├── slack/                          # MODIFIED — replace the {ok:true} stub
│   ├── slack.controller.ts         #   NEW: events + url_verification challenge
│   ├── slack-signature.service.ts  #   NEW: v0: HMAC-SHA256 over ts+body
│   └── slack-activity.service.ts   #   NEW: normalise + dedupe + enqueue
├── teams/                          # v1 — reference implementation, unchanged
│   ├── teams.controller.ts
│   ├── teams-auth.guard.ts
│   ├── teams-activity.service.ts
│   └── teams.outbound.service.ts   # REMOVED — moves to packages/domain/.../outbound
├── zalo/                           # NEW
│   ├── zalo.controller.ts           #   POST /zalo/events, no challenge handshake
│   ├── zalo-signature.service.ts   #   X-ZEvent-Signature: sha256(appId+body+ts+secret)
│   ├── zalo-activity.service.ts    #   normalise (incl. quote_msg_id) + dedupe + enqueue
│   └── zalo.module.ts
└── telegram/                       # NEW
    ├── telegram.controller.ts       #   POST /telegram/events, no challenge handshake
    ├── telegram-secret.service.ts   #   X-Telegram-Bot-Api-Secret-Token, constant-time
    ├── telegram-activity.service.ts #   normalise (incl. message_thread_id/reply_to) + dedupe
    └── telegram.module.ts

packages/domain/src/adapters/
├── <platform>/inbound/data-access/
│   └── platform-event.repository.ts # MODIFIED — generalised from teams-event.repository.ts
├── <platform>/outbound/
│   ├── <platform>-delivery.port.ts  # NEW — the port every platform implements
│   ├── zalo-client.ts                # NEW — hand-rolled ~200 lines over undici
│   ├── zalo-delivery.ts              # NEW — quota (8/48h), 2 000-char limit, quote reply
│   ├── telegram-delivery.ts          # NEW — node-telegram-bot-api 2.1.0
│   ├── teams-delivery.ts             # MOVED from apps/api/src/adapters/teams/
│   └── slack-delivery.ts             # NEW
├── data-access/
│   └── platform-credential.repository.ts  # NEW — SecretEnvelope-backed IM credentials
└── adapter.registry.ts              # NEW — platform → inbound/outbound descriptor

packages/domain/src/groups/          # NEW ELEMENT TYPE — requires a boundaries.config.mjs edit
├── data-access/
│   ├── group-membership.repository.ts
│   ├── group-role-assignment.repository.ts
│   └── user-app-epoch.repository.ts
├── group-sync.service.ts            # diff membership, bump epochs
├── group-binding.service.ts         # group → per-app role resolution
└── directory-source.port.ts         # the pluggable upstream (AD/LDAP, IM group API)

packages/domain/src/decision/
├── guarded-provider.ts              # NEW — the AI guard as a JevProvider decorator
├── prompt-guard.service.ts          # NEW — inbound/outbound guard rules
├── routing-orchestrator.ts          # UNCHANGED — FR-J-6 already holds
├── provider-registry.ts             # MODIFIED — capability filter already supports multi_turn
└── clarification-session.service.ts # MODIFIED — real thread key, raised turn bound

apps/worker/src/adapters/
├── outbound-dispatcher.ts           # NEW — platform → delivery port (app layer only)
├── zalo/zalo-delivery.service.ts    # NEW — app-layer wiring
├── telegram/telegram-delivery.service.ts
└── slack/slack-delivery.service.ts

apps/worker/src/processors/
├── outbound-message.processor.ts    # NEW — consumes 'im-outbound'
├── group-sync.processor.ts          # NEW — consumes the group-sync queue
└── platform-event-dispatch.processor.ts  # NEW — re-dispatches pending rows

apps/scheduler/src/
├── group-sync.registration.ts       # NEW — Job Scheduler, every N minutes
└── platform-event-dispatch.registration.ts  # NEW — Job Scheduler, every M minutes
```

### Structure Rationale

- **`packages/domain/src/adapters/<platform>/outbound/`** — the `outbound-adapter` file category (`packages/domain/src/adapters/**/outbound/**`) already exists in `tooling/boundaries.config.mjs` and R1 already restricts it to `apps/worker`. **It currently matches nothing**, because the Teams delivery service was placed in `apps/api/src/adapters/teams/` — an app directory, which no category covers. Putting the outbound clients in the category that was designed for them means (a) R1 finally enforces that only the worker can send, and (b) the api stops shipping a delivery service it never calls.
- **The delivery port takes the conversation reference as a parameter** — because the `adapters` element may import only `platform, kernel, contract`, and the conversation reference lives in `notifications`. The app-layer dispatcher resolves the reference and passes it in. This keeps `notifications → adapters` out of the graph.
- **`packages/domain/src/groups/` as its own element type** — the `domain` root is deliberately *not* an element type, so a new subdirectory is an **explicit config change** rather than a silent inheritance. Group sync touches identity, authz, audit and Mongo; giving it its own element makes the edges reviewable.
- **The credential repository lives in `packages/domain/src/adapters/data-access/`** — the `data-access` category pattern is `packages/domain/src/**/data-access/**`, so this path is already covered by R3 (Mongo allowed) and needs no config change. It sits in `adapters` rather than `notifications` because a credential is a platform concern, not a notification concern.

---

## Architectural Patterns

### Pattern 1: The platform adapter is a **pair of plug-ins**, not a module

**What:** Every platform contributes exactly two things: an **inbound normaliser** (app layer, `apps/api/src/adapters/<p>/`) and an **outbound delivery port** (domain layer, `packages/domain/src/adapters/<p>/outbound/`). The platform is registered once, in `packages/domain/src/adapters/adapter.registry.ts`, and everything else is platform-neutral.

**When to use:** Always, for a platform that has no official SDK (Zalo) as well as one that does (Telegram). The registry is what makes FR-IM-1 a configuration fact rather than a code fact.

**Trade-offs:**
- *Pro:* a new platform touches one registry entry and one directory pair. The worker, the decision layer, and the notification path never learn a platform's name.
- *Pro:* the two directions have genuinely different trust shapes — inbound is unverified-then-verified, outbound is authenticated-then-rate-limited — and the split makes that asymmetry structural.
- *Con:* the registry is a place where a platform can be half-registered. Mitigation: the registry's constructor asserts that every `ImPlatform` value has exactly one inbound descriptor and one outbound port, and **throws at boot** otherwise. A missing platform must be a startup failure, not a runtime 500.

**Example:**
```typescript
// packages/domain/src/adapters/adapter.registry.ts
export interface InboundAdapterDescriptor {
  readonly platform: ImPlatform;
  /** The platform's own event id — the dedupe key. */
  readonly eventIdOf: (payload: unknown) => string;
  /** The collection holding this platform's write-once event ledger. */
  readonly ledgerCollection: string;
}

export interface OutboundDeliveryPort {
  readonly platform: ImPlatform;
  send(message: OutboundMessage, context: DeliveryContext): Promise<DeliveryResult>;
}

export class AdapterRegistry {
  constructor(
    private readonly inbound: readonly InboundAdapterDescriptor[],
    private readonly outbound: readonly OutboundDeliveryPort[],
  ) {
    const every = ImPlatformSchema.options;               // ['slack','teams','zalo','telegram']
    for (const p of every) {
      if (this.inbound.filter((d) => d.platform === p).length !== 1) {
        throw new Error(`ADAPTER_REGISTRY_INBOUND: ${p} must have exactly one inbound descriptor`);
      }
      if (this.outbound.filter((d) => d.platform === p).length !== 1) {
        throw new Error(`ADAPTER_REGISTRY_OUTBOUND: ${p} must have exactly one delivery port`);
      }
    }
  }
}
```

### Pattern 2: The platform-event ledger is the **write-once record**, with a pending → dispatched state

**What:** One MongoDB collection per platform, with a **unique index on the platform's own event id** and a `dispatch_state` field. The receiver inserts the row (`pending`), enqueues, then flips the row to `dispatched`. A scheduler-driven reconciler re-dispatches rows still `pending` after a grace period.

**When to use:** Any platform that delivers **at-least-once** and retries on a non-2xx. All three of Slack (3 retries), Telegram (retries on non-2xx) and Zalo (undocumented) qualify.

**Trade-offs:**
- *Pro:* the unique index is the **durable** idempotency guarantee. It survives `removeOnComplete`, Redis failover, and process death — which is exactly why v1 chose it over BullMQ `jobId`.
- *Pro:* closing the crash window costs one indexed update and one reconciler.
- *Con:* the reconciler can double-enqueue (the crash happened *after* the enqueue). That is acceptable **only if the consumer is idempotent** — so the consumer must check the ledger row's state before processing. At-least-once delivery + an idempotent consumer = effectively-once processing.
- *Con:* the ledger grows forever. It needs a retention sweep (the shipped `audit-retention` / `purge-sweep` Job Schedulers are the pattern) aligned to each platform's retry horizon: **keep 30 days** — comfortably past Telegram's 24 h update retention and Slack's 3× retry window, and short enough to bound growth.

**Dedupe key per platform (verified):**

| Platform | Dedupe key | Source | Caveat |
|----------|-----------|--------|--------|
| Slack | `event_id` (the envelope's `event_id`) | Slack event envelope | Already an opaque string |
| Teams | `activity.id` | Activity `id` | **Shipped** — `TeamsEventRepository` |
| Zalo | `message.msg_id` | `message.msg_id` in the OA webhook payload (18-hex-char string) | **Message-level**, not event-level. A Zalo `event_name` can cover a multi-field message; key on `msg_id` |
| Telegram | `update_id` | The `Update` envelope | ⚠️ **Telegram re-randomises `update_id` after a week of inactivity.** A 6-month-old ledger row can therefore block a brand-new update. Mitigation: key on **`update_id` + `message.message_id`** (both are needed to be unique in practice), and/or expire the telegram ledger on the same 30-day sweep |

**Example:**
```typescript
// The receiver's ordering — the only ordering that is safe.
const inserted = await this.ledger.insert(platformEventId, rawPayload, 'pending');
if (inserted === 'duplicate') {
  // Already seen. 200 OK, no enqueue. The platform must not retry.
  return { status: 200, outcome: 'duplicate' };
}
await this.conversationRefs.upsert(platformScopedKey, reference);
await this.queue.add(INBOUND_EVENTS_QUEUE, event);
await this.ledger.markDispatched(platformEventId);   // ← if this line never runs, the reconciler retries
```

### Pattern 3: Permission epochs, **not** permission caches, are the correctness mechanism

**What:** A user's effective permission on an app is a function of a **monotonic integer** stored per `(real_user_id, app_id)`. Every cache key embeds the epoch. A permission change **increments** the epoch, which makes every previously-cached entry unreachable and every outstanding read link (which embeds its issuance-time epoch) fail its check.

**When to use:** Always — this is the v1 model's `perm_version` (PRD §6.7, FR-R-8, FR-L-7, NFR-SEC-4), and it is the mechanism that makes group revocation expressible without touching D-21.

**Trade-offs:**
- *Pro:* the epoch is the **only** invalidation primitive. Redis Pub/Sub (PRD FR-I-6's original design) is at-most-once and is therefore an optimisation, not a guarantee. The v1 research already reached this conclusion; v2 inherits it.
- *Pro:* revocation is a single `updateMany`, not a fan-out of per-user cache deletes.
- *Con:* a bulk epoch bump writes one document per affected `(user, app)` pair. For a 5 000-member group bound to 3 apps, that is 15 000 `$inc` updates. **Bulk `updateMany` makes it 3 queries**, but the write volume is real. Mitigation: the sync worker computes the *symmetric difference* (members added ∪ members removed) and bumps only those.
- *Con:* a read link issued at epoch *n* dies the moment *any* permission-affecting change occurs for that user on that app. That is the intended conservative behaviour ("mismatch → deny"), but it means a group churn rate directly determines link lifetime.

**The group epoch problem, and its resolution:**

Group membership is many-to-many and changes in bulk, so a naive "bump every member's epoch" is O(members × apps). The tempting optimisation is a **sum of epochs** — `perm_version = user_app_epoch + Σ group_epoch(G)` — computed rather than stored. **It is wrong**, and the reason matters:

> If a user *leaves* group `G` (epoch 3) and *joins* group `H` (also epoch 3), the sum is unchanged. The read link issued before the change still validates, and a permission that was revoked through `G` stays live. The sum is monotone in each term but **not injective over the states it summarises**.

**The resolution is a stored, per-`(user, app)` epoch, bumped in bulk.** The group epoch does not enter the read path at all; it only exists to let the sync worker tell "did anything change for this member?" cheaply.

```
group_memberships   { group_id, source, platform?, real_user_id, member_hash, synced_at }
group_role_assignings { app_id, group_id, role, permissions? }
user_app_epochs     { real_user_id, app_id, perm_version }     ← unique index (real_user_id, app_id)
```

On a sync tick:
1. Fetch the source's current membership.
2. Diff against `group_memberships` → `added` ∪ `removed`.
3. For each app bound to the group: `updateMany({ app_id, real_user_id: { $in: changed } }, { $inc: { perm_version: 1 } })`, plus an upsert for members with no epoch row yet.
4. The epoch bump invalidates the Redis cache (new key) and every outstanding read link for that `(user, app)` — **with no change to the D-21 claim set**.

### Pattern 4: The AI guard is a **provider decorator**, not a pipeline stage

**What:** `GuardedProvider` implements `JevProvider` and wraps a hosted provider. It runs the inbound guard on the composed request, calls the inner provider, runs the outbound guard on the response, and **re-validates the chosen tool against the permitted set** before returning. Because it is a `JevProvider`, the fallback chain, the health probe, the capability filter, the per-attempt budget, and the conformance suite all apply unchanged.

**When to use:** For the open-ended assistant, and for any future model call that touches user text.

**Trade-offs:**
- *Pro:* the guard cannot widen the tool set, because it never sees a tool set — `RoutingOrchestrator` has already replaced `tools` with `authorizedTools` before the provider is called. The guard's job is only to refuse bad text and bad output.
- *Pro:* the guard degrades like any provider. If the guard itself fails, `RoutingOrchestrator` catches the throw and **continues to the next provider** (`routing-orchestrator.ts:90-97`) — a guard failure becomes a degraded routing, never an unauthorised link.
- *Pro:* the fallback chain terminates in `RuleBasedProvider`, which is the terminal link (`provider-registry.ts:64`). A hosted-provider outage, a guard refusal, and a model timeout all land in the same place: the local, deterministic, permission-respecting answer.
- *Con:* a decorator cannot add capabilities the inner provider lacks. That is why `ProviderRegistry.chain(requiredCapabilities)` exists — the guard-wrapped provider must advertise **`multi_turn`** (`JevCapability` already includes it at `packages/contract/src/jev/jev-provider.ts:34`), and the chain is filtered on it.

**Where NG1 is contained.** PRD NG1 excludes "a general-purpose conversational AI assistant". v2 **amends** it, and the containment mechanism is the outbound vocabulary, not a policy document:

> The guard may only produce an `OutboundMessage` whose `action` is one of `reply | form_link | confirmation | error | status` (`OutboundActionSchema`). It may not emit free-form generated content as a new action, and it may not cause a link to be issued without a passing `canOpenNow` check at the execution boundary. **The decision layer decides *which tool*; the guard decides *whether this conversation may proceed*.** It never decides *what to say*.

**Example:**
```typescript
// packages/domain/src/decision/guarded-provider.ts
export class GuardedProvider implements JevProvider {
  readonly name: string;
  readonly spec_version: string;
  capabilities: JevCapability[];

  constructor(
    private readonly inner: JevProvider,
    private readonly guard: PromptGuardService,
    /** The set of tool ids the caller is allowed to choose from. */
    private readonly permitted: ReadonlySet<string>,
  ) {
    this.name = `guarded:${inner.name}`;
    this.spec_version = inner.spec_version;
    this.capabilities = inner.capabilities;
  }

  async decide(req: JevRequest): Promise<JevResponse> {
    const verdict = await this.guard.inspect(req);
    if (!verdict.allowed) throw new GuardRefusal(verdict.reason);

    const res = await this.inner.decide(req);

    // Defence in depth: even if the inner provider answers with a tool the
    // caller never authorised, the choice is dropped here — not at the link
    // issuer, where it would already be too late to matter.
    if (res.choice && !this.permitted.has(res.choice.tool_id)) {
      throw new GuardRefusal('tool_not_permitted');
    }
    return res;
  }

  async healthCheck(): Promise<HealthStatus> { return this.inner.healthCheck(); }
}
```

### Pattern 5: Scheduled sync writes; the worker performs them

**What:** A scheduled job **never performs the sync itself**. `apps/scheduler` registers a BullMQ **Job Scheduler** (`upsertJobScheduler` + `resumeJobScheduler`, per `packages/platform/src/queue/job-scheduler.ts` and the shipped `apps/scheduler/src/reconciliation.registration.ts` pattern) that enqueues a job; `apps/worker` consumes it and does the work.

**When to use:** Any periodic task that touches Mongo, a directory, or an external API. This is not a stylistic preference — it is R1: the `scheduler-job` file category may be imported only by `apps/scheduler`, and the `bullmq-worker` category only by `apps/worker`.

**Trade-offs:**
- *Pro:* `upsertJobScheduler` is idempotent and converges — every replica may call it at boot, concurrently, with no coordination. That is what makes a rolling deploy safe (the v1 research flagged "only the first replica registers" as the failure mode).
- *Pro:* the heavy work runs where the Mongo client, the credential access and the retry machinery already live.
- *Con:* a sync that takes longer than its interval will overlap with the next tick. The v1 `reconciliation` Job Scheduler already carries this shape; the group sync needs an explicit overlap guard (a Redis lock keyed on the source id, or a BullMQ job id that the scheduler cannot overlap).

---

## Data Flow

### Inbound — four platforms, one shape

```
Slack  POST /slack/events        Teams  POST /teams/events
        │ url_verification              │ urlVerification
        │ v0: HMAC-SHA256                │ JWT via authorizeJWT()
        ▼                               ▼
Zalo   POST /zalo/events        Telegram POST /telegram/events
        │ X-ZEvent-Signature            │ X-Telegram-Bot-Api-Secret-Token
        │ sha256(appId+body+ts+secret)   │ (shared secret, constant-time)
        │ NO challenge handshake         │ NO challenge handshake
        └───────────────┬────────────────┘
                        ▼
        ┌───────────────────────────────────────────────┐
        │  normalise → InboundEvent { platform, channel_id,│
        │    chat_user_id, text, action, thread_id?,      │
        │    reply_to_message_id?, queue, attempt, ... }  │
        └───────────────────┬───────────────────────────┘
                            ▼
        ┌───────────────────────────────────────────────┐
        │  PlatformEventRepository.insert(eventId)       │
        │    unique index → 'inserted' | 'duplicate'     │
        │    'duplicate' → 200 OK, NO enqueue            │
        └───────────────────┬───────────────────────────┘
                            ▼
        ┌───────────────────────────────────────────────┐
        │  ConversationReferenceRepository.upsert(       │
        │    key = `${platform}:${channel_id}::${user}`)  │  ← platform-scoped
        └───────────────────┬───────────────────────────┘
                            ▼
        ┌───────────────────────────────────────────────┐
        │  queue.add('inbound-events', event)           │
        │  markDispatched(eventId)                      │
        │  ── 200 OK to the platform (budget < 200 ms)   │
        └───────────────────────────────────────────────┘
```

**The thread/reply mapping per platform** — the reason for the two new envelope fields:

| Platform | Inbound thread reference | Inbound reply reference | Outbound thread reference | Outbound reply reference |
|----------|-------------------------|--------------------------|---------------------------|--------------------------|
| Slack | `event.thread_ts` (or `message.thread_ts`) | `message.ts` | `thread_ts` on the message | `thread_ts` |
| Teams | `conversation.id` + `replyToId` | `activity.id` | `conversation.id` | `replyToId` on the activity |
| Zalo | *(none — Zalo has no threads)* | `message.quote_msg_id` | *(none)* | `message.quote_message_id` |
| Telegram | `message.message_thread_id` (forum topic) | `message.reply_to_message.message_id` | `message_thread_id` | `reply_parameters: { message_id, chat_id }` |

`thread_id` and `reply_to_message_id` are **opaque platform ids**. Like `event_id` and `channel_id`, they are **not** on the D-43 log allowlist and must never be logged — the `inbound-event.ts` header comment's discipline extends to them.

### Outbound — the seam that does not exist yet

```
InboundEventProcessor (worker)
   │ outcome.kind === 'link' | 'clarify' | 'otp_*'
   ▼
build OutboundMessage {
   message_id:  <stable UUID, reused across retries>,
   platform:    event.platform,
   channel_id:  event.channel_id,
   chat_user_id:event.chat_user_id,
   thread_id?:  event.thread_id,
   reply_to_message_id?: event.reply_to_message_id,
   text:        <worker-owned copy, localised>,
   action:      'form_link' | 'reply' | 'confirmation' | 'error' | 'status',
   app_id?, form_id?, queue: 'im-outbound', attempt: 0
}
   ▼
queue.add('im-outbound', message)      ← the producer the v1 code lacks
   ▼
OutboundMessageProcessor (worker)
   │ attempts: 3, backoff: notificationJitterBackoff
   ▼
OutboundDispatcher (app layer)
   │ resolve platform → PlatformDeliveryPort
   ▼
┌──────────────┬──────────────┬───────────────┬──────────────┐
│ Slack        │ Teams        │ Zalo          │ Telegram     │
│ chat.postMessage │ continueConversation │ POST /v2.0/oa/message │ sendMessage │
│ {thread_ts}  │ {replyToId}  │ {quote_message_id} │ {message_thread_id,│
│              │              │ quota 8/48h   │  reply_parameters}│
│              │              │ ≤2 000 chars  │ 30/s global, 1/s chat│
└──────────────┴──────────────┴───────────────┴──────────────┘
   ▼
retry → DLQ → audit.append('im.outbound.failed') → user-visible failure notice
```

**The `message_id` stability rule.** `OutboundMessageSchema.message_id` is documented as "platform-assigned, unique per send attempt chain" — but the platform assigns it *after* the send. The producer therefore generates it, and **the same value must travel with every retry**. The queue job's data *is* the `OutboundMessage`; the processor must not regenerate the id per attempt. A regenerated id is a duplicated message in the user's chat.

### Group sync and revocation

```
apps/scheduler  ── Job Scheduler: group-sync, every N minutes
        │ enqueue { source_id }
        ▼
apps/worker  ── GroupSyncProcessor
        │
        ├─▶ fetch current membership from the source
        │     (directory connector | Zalo listmember | manual import)
        ├─▶ diff against group_memberships → added ∪ removed
        ├─▶ for each app bound to the group:
        │     updateMany({app_id, real_user_id: {$in: changed}},
        │                {$inc: {perm_version: 1}}, {upsert:true})
        ├─▶ RbacCacheService: nothing to delete —
        │     the epoch is in the cache key, so the old entry is unreachable
        └─▶ audit.append('group.membership.changed', {group_id, count})
                     │
                     ▼
        Next request: PermissionCheckService.check(app, user, perm, epoch)
          → Redis key ak:rbac:{app}:{user}:{epoch}  → miss
          → RbacService: direct assignments ∪ group-derived assignments
          → set at the new epoch
                     │
                     ▼
        Outstanding read links (D-21 `perm_version` claim):
          issued at epoch 7, current epoch 8 → MISMATCH → 403
          (the claim set is unchanged; the epoch moved)
```

### The AI guard

```
InboundEventProcessor
   │  authorized = loader.listAuthorized(realUserId)   ← RBAC filter FIRST
   ▼
RoutingOrchestrator.route({
   authorizedTools: authorized.map(a => a.tool),        ← the ONLY tool set
   threshold, canOpenNow, deadlineEpochMs
})
   │  permitted = new Set(authorizedTools.map(t => t.id))
   │  request.tools = [...authorizedTools]              ← never the catalogue
   ▼
ProviderRegistry.chain(['multi_turn'])
   ▼
GuardedProvider (the AI guard)
   ├─ guard.inspect(request)        → refuse? throw GuardRefusal → next provider
   ├─ inner.decide(request)
   └─ choice.tool_id ∈ permitted?   → no? throw GuardRefusal → next provider
   ▼
JevResponse → RoutingOrchestrator re-checks confidence, threshold, deadline,
              and `canOpenNow` (the fresh permission check at the execution
              boundary) → {kind:'link'} → link issued → OutboundMessage
```

**The guard sits between the RBAC filter and the model, and it does not widen anything.** If the guard is removed, the platform still refuses unauthorised apps. If the RBAC filter is removed, the guard cannot compensate — which is why the guard must never be given a tool set to filter.

---

## New vs Modified Components — explicit

### New

| Component | Location | Boundary impact |
|-----------|----------|-----------------|
| Zalo receiver (controller, signature service, activity service, module) | `apps/api/src/adapters/zalo/` | None — `app-api` may import everything |
| Telegram receiver (controller, secret service, activity service, module) | `apps/api/src/adapters/telegram/` | None |
| Slack receiver (replaces the `{ok:true}` stub) | `apps/api/src/adapters/slack/` | None |
| Zalo outbound client + delivery port | `packages/domain/src/adapters/zalo/outbound/` | Uses the existing `outbound-adapter` category (worker-only, R1) |
| Telegram outbound client + delivery port | `packages/domain/src/adapters/telegram/outbound/` | Same |
| Slack outbound client + delivery port | `packages/domain/src/adapters/slack/outbound/` | Same |
| Platform credential repository (SecretEnvelope-backed) | `packages/domain/src/adapters/data-access/` | Covered by the existing `data-access` category (R3) |
| `AdapterRegistry` (platform → descriptors) | `packages/domain/src/adapters/` | Within the `adapters` element |
| `IM_OUTBOUND_QUEUE`, `GROUP_SYNC_QUEUE`, `PLATFORM_EVENT_DISPATCH_QUEUE` | `packages/platform/src/queue/queue.constants.ts` | None |
| `OutboundMessageProcessor` | `apps/worker/src/processors/` | `bullmq-worker` category — worker-only (R1) |
| `OutboundDispatcher` | `apps/worker/src/adapters/` | App layer — may import `notifications` and `adapters` |
| `PlatformEventDispatchProcessor` | `apps/worker/src/processors/` | Same |
| `GroupSyncProcessor` | `apps/worker/src/processors/` | Same |
| `group-sync` + `platform-event-dispatch` registrations | `apps/scheduler/src/` | `scheduler-job` category — scheduler-only (R1) |
| `groups` element (model, sync service, binding service, directory port) | `packages/domain/src/groups/` | **Requires a `tooling/boundaries.config.mjs` edit** |
| `GuardedProvider` + `PromptGuardService` | `packages/domain/src/decision/` | Within the `decision` element (`platform, kernel, contract`) — no new edge |
| `PlatformEventRepository` (generalised) | `packages/domain/src/adapters/<p>/inbound/data-access/` | `data-access` category (R3) |

### Modified

| Component | Change | Risk |
|-----------|--------|------|
| `packages/contract/src/events/inbound-event.ts` | **Add `thread_id?` and `reply_to_message_id?`** (optional). Update the strictness spec. | Low — optional fields are backward compatible. The strictness test must be updated or the build fails. |
| `packages/contract/src/events/outbound-message.ts` | **Add the same two optional fields.** | Low — same. |
| `packages/platform/src/logging/log-allowlist.ts` | **Add `app_id`, `perm_version`, `group_id`.** Each with a written justification in the same commit. | Medium — this is the D-43 friction by design. Note: `inbound-event.ts`'s header comment already claims `app_id` is "drawn from the frozen log-field vocabulary" — **it is not on the list**. The comment is wrong; fix it or add the field. |
| `packages/domain/src/authz/rbac.service.ts` | Replace the hardcoded grant with a real evaluation over direct ∪ group assignments. | **High** — this is the v1 security stub. Every downstream guarantee depends on it. |
| `packages/domain/src/authz/rbac-cache.service.ts` | In-process `Map` → Redis, same epoch-keyed key. | Medium — a shared cache is required for cross-replica consistency. |
| `packages/domain/src/authz/permission-check.service.ts` | `perm_version` from a real store, not `= 0`. | **High** — with `perm_version = 0` everywhere, the read-link epoch check is vacuous. |
| `packages/domain/src/identity/identity-mapping.repository.ts` | In-memory array → Mongo-backed (+ Redis cache per FR-I-4/FR-I-6). | **High** — a worker restart currently forgets every mapping. |
| `apps/worker/src/app.module.ts` | Replace the inline `authorize` closure (lines 53-65) with a call to the real RBAC service. | High — the closure is a second, divergent authorization implementation. |
| `apps/worker/src/processors/inbound-event.processor.ts` | Enqueue an `OutboundMessage` on every outcome; pass the real `thread_id` to the clarification session. | Medium — the behaviour change users will notice first. |
| `apps/worker/src/processors/notification.processor.ts` | Inject the dispatcher instead of `TeamsDeliveryService`. | Low — mechanical. |
| `apps/worker/src/app.module.ts` | Register the new processors in `WORKER_CONSUMERS` (the readiness list). | Low — but the readiness indicator is how "the worker is listening" is proven. |
| `packages/domain/src/decision/clarification-session.service.ts` | Real thread key; raise the turn bound from 2 for open-ended disambiguation. | Low — the signature already takes a `threadTs`. |
| `packages/domain/src/notifications/data-access/conversation-reference.repository.ts` | Platform-scoped key (`${platform}:${channel_id}::${chat_user_id}`) + a `platform` discriminator on the row; make the row shape platform-neutral. | Medium — a data migration on a small collection, and the key change is **breaking** for existing rows. |
| `apps/api/src/adapters/teams/teams.module.ts` | Stop exporting `TeamsOutboundService`. | Low — it has no caller. |
| `tooling/boundaries.config.mjs` | Add `groups` to `DOMAIN_ELEMENT_TYPES` and `ALLOWED_EDGES`. | Low — one element, reviewed. |

### Removed

| Component | Why |
|-----------|-----|
| `apps/api/src/adapters/teams/teams.outbound.service.ts` | Superseded by `packages/domain/src/adapters/teams/outbound/`. It duplicates the worker's copy and has no caller. |

---

## Frozen-Contract Impact — D-21, D-23, D-43

> This is the section the roadmap planner should read before scheduling a phase that touches a contract.

### D-21 — the frozen read-link claim set: **MUST NOT BE TOUCHED**

**File:** `packages/contract/src/links/read-link-claims.ts` · **Guard:** `read-link-claims.frozen.spec.ts` (a mechanical key-set assertion — a comment cannot stop a schema edit; a frozen test can).

**v2's group RBAC does not need a new claim, and must not add one.** The claim set already carries exactly the right primitive:

```typescript
/**
 * The ACL-07 per-user-per-app permission epoch, captured at issuance.
 * …
 */
perm_version: versionNumber,
```

Group-derived permission is folded into that **single integer** by bumping the stored per-`(user, app)` epoch (Pattern 3). The read link's embedded epoch becomes stale on any membership change, and the existing "mismatch → 403" check (FR-L-7, NFR-SEC-4) does the rest.

**Explicitly forbidden for v2:**
- Adding `group_ids`, `group_versions`, `group_epoch` or any other claim to `ReadLinkClaimsSchema`.
- Adding a claim to distinguish a group-derived grant from a direct one.
- Changing `ReadLinkActionSchema` (the six D-21 actions) — v2 adds no new link kind.
- Changing `READ_LINK_TARGET_RULES` or `MAX_READ_LINK_TTL_SECONDS`.

**The v1 research's own line applies verbatim:** *"Never edit `read-link-claims.ts` or `read-link-claims.frozen.spec.ts` to add a claim — that invalidates every outstanding link."* v2 must not even add an **optional** claim: an optional claim is still a key-set change, and the frozen test asserts the exact key set.

### D-23 — the frozen JEV v1 wire spec: **MUST NOT BE TOUCHED**

**Files:** `packages/contract/src/jev/v1/*` · **Guard:** `jev-v1.frozen.spec.ts`.

The v2 AI guard is a **provider decorator** (Pattern 4). It implements the `JevProvider` seam (`packages/contract/src/jev/jev-provider.ts`) and passes the frozen `JevRequest` / `JevResponse` straight through. The request the inner provider sees is byte-identical to the request `RoutingOrchestrator` built.

**Explicitly forbidden for v2:**
- Adding a `guard` field, a `conversation_history` field, or any other key to `JevRequest` / `JevResponse`.
- Changing `JevCapability` — **`'multi_turn'` already exists** (`jev-provider.ts:34`) and is exactly the capability the open-ended provider must advertise. `ProviderRegistry.chain(requiredCapabilities)` already filters on it.
- Bypassing `RoutingOrchestrator` for guard traffic. The guard runs *inside* a provider call, so it inherits the deadline, the attempt cap, the health probe, the confidence gate, the competing-alternative check and the `canOpenNow` re-check **for free**. A guard that calls a model outside the orchestrator inherits none of them.
- Changing `RULE_BASED_PROVIDER_NAME` or the rule-based terminal link. The guard's failure path *is* the terminal link.

**What may change (and is enough):** `packages/domain/src/decision/*` — the provider registry's *composition* (which providers are in the chain, and with what attestation), not its contract. The `ProviderRegistry` constructor already drops an unattested hosted provider with a loud boot log (`provider-registry.ts:72-78`) — that is the mechanism that keeps a guard-wrapped hosted provider out of a deployment that cannot attest it.

### D-43 — the log field allowlist: **TOUCHED, additively, in exactly one commit**

**File:** `packages/platform/src/logging/log-allowlist.ts`. The file's own rule: *"Adding a field requires a written justification in the same commit; that friction is the control."*

**v2 needs three new allowlisted fields:**

| Field | Why | Justification shape |
|-------|-----|--------------------|
| `app_id` | Group RBAC denials, guard refusals, and per-app routing metrics are all app-scoped. `inbound-event.ts` already claims `app_id` is "drawn from the frozen log-field vocabulary" — **that claim is false; the field is not on the list.** | An opaque app id. Never a name. Fixes an existing doc/code drift. |
| `perm_version` | Revocation audit: "user U's epoch on app A moved 7 → 8" is the only way to explain why a read link 403'd. | An opaque monotonic integer. No PII. |
| `group_id` | Group-membership sync and revocation are group-scoped. | An opaque group id. **Never a group name** — a group name is human-identifying, exactly like a display name. |

**Explicitly forbidden:**
- `event_id`, `channel_id`, `thread_id`, `reply_to_message_id` — platform ids that correlate with a conversation. `event_id` and `channel_id` are already excluded; the two new fields join them.
- Any user-authored text, name, email, phone, or handle.
- Any group *name*, app *name*, or role *display name*.

**The allowlist stays an allowlist.** A deny-list addition is not an option: a computed key (`record[userInput]`) defeats a deny-list by construction, which is the reason the file's header gives for the inverted design.

### The event envelopes — a **versioned contract amendment**, not a frozen contract

The envelopes are **not** D-21 or D-23. They are ordinary versioned contracts that happen to be `.strict()`:

| Property | D-21 (read-link claims) | D-23 (JEV v1) | The event envelopes |
|----------|------------------------|---------------|----------------------|
| Declared frozen | Yes | Yes | **No** — but `.strict()` with strictness-rejection tests |
| Has a frozen key-set test | Yes (`read-link-claims.frozen.spec.ts`) | Yes (`jev-v1.frozen.spec.ts`) | Yes — `events.spec.ts` asserts unknown keys are rejected |
| Can it gain an optional field? | **No** — the key set is asserted exactly | **No** — same | **Yes** — an optional field is backward compatible for producers and consumers |

**The v2 amendment:**

```typescript
export const InboundEventSchema = z
  .object({
    event_id: opaqueId,
    platform: ImPlatformSchema,
    channel_id: opaqueId,
    chat_user_id: opaqueId,
    text: z.string(),
    action: InboundActionSchema,
    app_id: opaqueId.optional(),
    form_id: opaqueId.optional(),
    queue: z.string().min(1),
    attempt: z.number().int().nonnegative(),
    occurred_at: z.string().datetime(),

    // ── v2 addition: threading (FR-IM-8) ─────────────────────────────
    /**
     * The platform's thread or topic id, when the platform has one.
     * Slack `thread_ts` · Teams `replyToId` · Telegram `message_thread_id`
     * · Zalo — absent (Zalo has no threads; use `reply_to_message_id`).
     *
     * Opaque platform id. NOT on the log-field allowlist, like
     * `event_id` and `channel_id` — never serialised into a log record.
     */
    thread_id: opaqueId.optional(),
    /** The platform message id this message replies to, when it is a reply. */
    reply_to_message_id: opaqueId.optional(),
  })
  .strict();
```

**Why this is safe and why it still needs discipline:**
- *Safe:* both fields are **optional**. A v1 producer that omits them still parses; a v2 consumer that meets a v1 event sees `undefined`. No version bump is required, and no sibling `v2/` directory is needed.
- *Disciplined:* the `.strict()` schemas have tests that assert unknown keys are **rejected**. Adding a field therefore requires updating `events.spec.ts` in the same change — which is the mechanical guard that stops an accidental field from sliding in. The change must be recorded in the contract's changelog with the reason (FR-IM-8 + the clarification session's thread key), and the `inbound-event.ts` header comment must be extended to say that `thread_id` and `reply_to_message_id` are not loggable.

**Do not confuse this with D-21.** The read-link claim set is a *different* contract, it *is* frozen, and the two new fields have nothing to do with it. Nothing in v2's threading work touches a link.

---

## Scaling Considerations

| Scale | Architecture adjustments |
|-------|------------------------|
| **0–1k users** (the current v1 deployment) | One `api` + one `worker` + one `scheduler` replica. The in-process RBAC cache would *almost* work — but it is a correctness bug the moment a second replica exists, so it moves to Redis in the same phase as the real RBAC service, not later. Group sync runs on a 15-minute Job Scheduler; the bulk `updateMany` epoch bump is a handful of queries. |
| **1k–100k users** | The platform-event ledger becomes the largest collection. 30-day retention keeps it bounded (Slack + Teams + Zalo + Telegram at ~10 events/user/day ≈ 300k rows/month at 1k daily actives — comfortable). The group sync's epoch bump is the first thing to profile: a 5 000-member group churning 5 %/day is 250 members × N bound apps per day — bulk `updateMany` handles it, but the write volume must be measured, not assumed. The outbound queue becomes the throughput axis: Telegram's 1 msg/s per chat and Zalo's 8-replies-per-48h quota are **per-conversation platform limits**, not system limits, so the queue absorbs the burst and the platform is the bottleneck. |
| **100k+ users** | The `{akane-q}` BullMQ prefix pins every queue key to **one Redis Cluster slot** — queue throughput does not shard. The scaling axis is cluster *memory*, not queue parallelism. `upsertJobScheduler` makes a per-source group sync safe on every replica, but a sync whose duration approaches its interval needs a distributed lock. The RBAC cache becomes the hot path: `ak:rbac:{app}:{user}:{perm_version}` on a shared Redis is fine at this scale; the epoch key means a revocation does **not** need a fan-out delete. |

### Scaling priorities

1. **First bottleneck: the RBAC cache and the epoch store.** Every routing decision makes one `PermissionCheckService.check` call, which is one Redis GET on a hit and one Mongo read on a miss. The epoch-in-the-key design means a revocation costs one bulk `$inc` and **zero** cache deletes. This is the design that scales; the alternative (delete every affected cache entry) does not.
2. **Second bottleneck: the platform-event ledger's write amplification.** Every inbound event is one Mongo insert plus one update. At high volume the insert is the cost; the unique index is what makes it correct, so the index cannot be dropped. Batch the `markDispatched` update into the same round-trip as the insert where possible, or make the reconciler's window generous enough that the extra write is not on the hot path.
3. **Third bottleneck: per-platform outbound quotas.** Zalo's 8 replies per 48 hours per user and Telegram's 1 message per second per chat are *hard platform limits*. A retry storm against a rate-limited platform makes things worse, not better. The jittered backoff (already implemented for `notification-send`) plus a DLQ is the whole mitigation; do not add a second delivery path that bypasses it.

---

## Anti-Patterns

### Anti-Pattern 1: Adding a platform without adding its outbound side

**What people do:** Add `apps/api/src/adapters/zalo/` — controller, signature check, normalisation, enqueue — and declare the platform done, because the inbound path is the interesting half.

**Why it's wrong:** The v1 code already has this shape. `InboundEventProcessor` returns `{kind:'link', url}` and **nothing delivers it** (`inbound-event.processor.ts:194`). `TeamsOutboundService` sits in the api with **no caller** (`apps/api/src/adapters/teams/teams.outbound.service.ts:70`). A Zalo bot built the same way receives messages perfectly and answers nothing. FR-IM-3 (normalised `OutboundMessage`) is a separate requirement from FR-IM-2 and it is currently unmet for every platform.

**Do this instead:** Ship the outbound seam **first** (Phase 10): the `im-outbound` queue, the `OutboundMessageProcessor`, the platform-dispatched `OutboundDispatcher`, and the `InboundEventProcessor` enqueueing its own replies. Then every adapter is a two-sided change by construction, because the dispatcher already knows the shape.

### Anti-Pattern 2: Using Redis for platform-event dedupe

**What people do:** `SETNX ak:evt:{platform}:{id}` in the receiver, or a BullMQ `jobId`, and treat the "already seen" answer as the idempotency guarantee.

**Why it's wrong:** Two independent reasons, both established in v1. (a) **BullMQ `jobId` dedup lapses on `removeOnComplete`** — the official docs say removed jobs "will not be considered as duplicates", so the guarantee evaporates with the retention policy. (b) **Redis Cluster replication is asynchronous**; an acknowledged write can be lost on failover, so a consumed token can come back. The same property that makes `GETDEL` a fast path rather than a guarantee applies here.

**Do this instead:** A **MongoDB unique index on the platform's own event id**, in a collection per platform, with the fail-closed 500 ms timeouts the shipped `TeamsEventRepository` already uses. Redis may sit in front as a fast path; it may not be the record.

### Anti-Pattern 3: Filtering the tool set *inside* the AI guard

**What people do:** Add the guard as a stage in the pipeline, hand it the global tool catalogue, and let it decide which tools the user may see.

**Why it's wrong:** It relocates the permission boundary into a component that talks to a language model. The guarantee FR-J-6 states — *"JEV MUST receive only the filtered tool set for the requesting user, never the global tool list"* — is already implemented in the right place: `RoutingOrchestrator` builds `permitted` from `authorizedTools` and passes `tools: [...input.authorizedTools]` (`routing-orchestrator.ts:50-59`). A guard that filters is a guard that *can fail to filter*, and the failure mode is an unauthorised tool reaching the model — and from there, a link.

**Do this instead:** The guard is a **provider decorator** that never sees an unfiltered tool set. Its job is to refuse bad *text* and bad *output*; the tool set is already correct before it is called. If the guard must enforce a tool constraint, it enforces it by **re-validating the chosen tool against `permitted`** on the way out — a second gate on an already-filtered set, not a first gate on the catalogue.

### Anti-Pattern 4: A sum-of-epochs `perm_version` for group revocation

**What people do:** Compute `perm_version = user_app_epoch + Σ group_epoch(G)` at read time instead of storing one number per `(user, app)`.

**Why it's wrong:** The sum is monotone in each term but **not injective over the states it summarises**. A user who leaves group `G` (epoch 3) and joins group `H` (also epoch 3) produces the same sum. A read link issued before the change still validates, and a permission revoked through `G` stays live — a silent authorisation failure that looks correct in every test that only bumps one group at a time.

**Do this instead:** A **stored, monotonic, per-`(user, app)` epoch**, bumped in bulk with `updateMany` when membership changes. The group epoch is a sync-worker optimisation only; it never enters the read path. And the epoch-in-the-cache-key means revocation needs no cache fan-out at all.

### Anti-Pattern 5: A directory sync performed by the scheduler

**What people do:** Put the group-sync job body in `apps/scheduler/src/`, because the scheduler is the thing that "runs periodically".

**Why it's wrong:** R1. The `scheduler-job` file category may be imported only by `apps/scheduler`; the `bullmq-worker` category only by `apps/worker`. A scheduler that talks to Mongo, a directory, and an IM API accumulates the credential surface, the retry machinery and the connection pools in the process that has none of the worker's infrastructure. It also makes the sync's failures invisible to the worker's readiness indicator.

**Do this instead:** The scheduler **registers a Job Scheduler and enqueues**; the worker **consumes and performs**. The v1 `reconciliation.registration.ts` is the exact pattern: `registerJobScheduler(queue, ID, {every: ms}, {name: ID})` + `resumeJobScheduler(queue)`, with the work in `ReconciliationProcessor`.

### Anti-Pattern 6: Reading the IM platform's secret from the environment

**What people do:** `process.env.ZALO_OA_SECRET` in the receiver, and `process.env.TELEGRAM_BOT_TOKEN` in the sender.

**Why it's wrong:** NFR-SEC-3 forbids plaintext env secrets, and the v1 code already carries the smell: `TeamsDeliveryService` calls `loadAuthConfigFromEnv()` (`apps/api/src/adapters/teams/teams.outbound.service.ts:17,29,87`). A v2 adapter that copies that pattern adds a second and third plaintext secret to the process, and the Zalo OA secret is the one that authenticates inbound webhooks — a leaked secret means forged inbound events.

**Do this instead:** The `SecretEnvelope` path the connector credentials already use. `packages/domain/src/connectors/data-access/connector-credentials.repository.ts` stores `{ envelope: SecretEnvelope }`; `sealSecret` / `openSecret` in `packages/platform/src/crypto/envelope.ts` do the work. The `adapters` element may import `platform` (which contains the crypto module), and **R2 is not triggered** — R2 restricts the `jose` / KMS *modules* to the owner categories, and the caller never imports them. The Zalo OA secret and the Telegram bot token get the same treatment as a Redmine API key, at no boundary cost.

### Anti-Pattern 7: One "IM adapter" module per platform, growing without limit

**What people do:** Put the inbound normaliser, the signature service, the outbound client, the credential handling, the rate limiter and the group sync for a platform into one directory, then let the next platform copy it.

**Why it's wrong:** The two directions have different trust shapes (untrusted-and-unverified inbound vs authenticated-and-rate-limited outbound) and different owners (the api vs the worker). One module per platform collapses the `inbound-adapter` / `outbound-adapter` boundary categories that R1 already exists to enforce, and it makes "which process may send a message" a matter of reading the whole file.

**Do this instead:** The **pair of plug-ins** (Pattern 1). Inbound in `apps/api/src/adapters/<p>/`, outbound in `packages/domain/src/adapters/<p>/outbound/`, credentials in `packages/domain/src/adapters/data-access/`, and the platform registered once in `AdapterRegistry`.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **Zalo OA — inbound webhook** | `POST` to a registered URL. Verify `X-ZEvent-Signature: mac = sha256(appId + rawBody + timestamp + OAsecretKey)`. Then normalise → dedupe → enqueue → 200. | ⚠️ **This is a secret-suffix plain SHA-256, not an HMAC.** It must be computed over the **exact raw bytes** of the body, with `timestamp` taken from the payload. Compare in constant time. **There is no challenge handshake** (unlike Slack's `url_verification` and Teams' `urlVerification`), so FR-IM-6 is only partially satisfied for Zalo — see S2. |
| **Zalo OA — outbound** | `POST https://openapi.zalo.me/v2.0/oa/message` with header `access_token`. Two reply forms: `recipient: { user_id }` + `message: { text, quote_message_id }`, or `recipient: { message_id }` (the *reply-token* form, quota **8 per 48 h**). Consultation text: `POST /v3.0/oa/message/cs`. Group send: `POST /v3.0/oa/group/message`. | Text limit **2 000 characters** — truncate in the client, not in the contract. The reply-token form is the cheap one but it is **rate-limited per user**, so the client must fall back to the `user_id` + `quote_message_id` form rather than fail. Hand-rolled over `undici` (no official Node SDK). |
| **Zalo OA — group membership** | `GET /v3.0/oa/group/listmember?group_id&offset&count` | Requires the **"quản lý thông tin nhóm"** permission and a **paid GMF package**. Optional in v2; see §6.4. |
| **Telegram — inbound webhook** | `POST` to a registered URL. Verify `X-Telegram-Bot-Api-Secret-Token` against the configured `secret_token` (1–256 chars, `A–Z a–z 0–9 _ -`) in constant time. | A **shared secret, not an HMAC**. Telegram retries any non-2xx, so a 5xx on a transient failure is the platform's problem to retry — but only if we have not already recorded the update. The dedupe ledger is what makes the retry safe. |
| **Telegram — outbound** | `node-telegram-bot-api@2.1.0` → `sendMessage({ chat_id, text, message_thread_id?, reply_parameters? })`. | Rate limits: **~30 msg/s global, 1 msg/s per chat**. `grammy` is rejected (it depends on `node-fetch@^2`, an un-instrumented HTTP path that breaks OTel trace continuity). |
| **Telegram — group membership** | **Not available.** The Bot API has `getChat`, `getChatAdministrators`, `getChatMemberCount`, `getChatMember` (one user) — **no member enumeration**. | A bot observes only users who interact with it (`new_chat_members`, `chat_member`). Bulk enumeration needs MTProto (a userbot), which is out of scope. **Telegram groups are a documented v2 gap, not a feature.** |
| **Slack** | `url_verification` challenge + `v0:` HMAC-SHA256 over `timestamp + body`. Outbound via `chat.postMessage({ channel, text, thread_ts })`. | The shipped `slack-webhook.controller.ts` is a `{ok:true}` placeholder — v2 replaces it. |
| **Microsoft Teams** | JWT via `authorizeJWT()` (the Agents SDK ships **no** JWT middleware). Outbound via `continueConversation` with a stored `ConversationReference`. | v1 — **unchanged**. The conversation-reference store is the pattern the other platforms follow. |
| **Enterprise directory (new)** | A **connector** — the existing `packages/domain/src/connectors/` framework, with its credential store, retry, DLQ and three-state outbound. | The primary source of group membership in v2, because it is the only source that works on every platform. The connector's adapter is a new `rest-core` consumer, not a new framework. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `apps/api` ↔ `apps/worker` | **Queue** — `inbound-events` (in), `im-outbound` (out), `notification-send` (existing), `group-sync`, `platform-event-dispatch` | The only shared contract is the envelope. Both ends must reference the **constant** from `packages/platform/src/queue/queue.constants.ts` — the `'im:inbound'` vs `'inbound-events'` mismatch is a documented v1 incident. |
| `apps/scheduler` ↔ `apps/worker` | **Queue**, via a BullMQ **Job Scheduler** | The scheduler registers and enqueues; the worker performs. R1 enforces the direction. |
| `packages/domain/src/adapters/<p>/inbound/**` → `apps/api` | Direct import | `inbound-adapter` category — **api only** (R1). |
| `packages/domain/src/adapters/<p>/outbound/**` → `apps/worker` | Direct import | `outbound-adapter` category — **worker only** (R1). |
| `packages/domain/src/adapters/**` → `packages/domain/src/notifications` | ❌ **Not allowed** | `adapters` may import only `platform, kernel, contract`. The delivery port therefore takes the conversation reference **as a parameter**; the app-layer dispatcher resolves it. |
| `packages/domain/src/notifications` → `packages/domain/src/adapters` | ❌ **Not allowed today** | Adding it would be a new edge — and pointless, because R1 would still block `notifications` from importing an `outbound-adapter` file. The dispatcher belongs in the app layer. |
| `packages/domain/src/groups` → `identity`, `authz`, `audit` | Direct import | **Requires the new element type** in `tooling/boundaries.config.mjs`. |
| `packages/domain/src/decision` → `packages/domain/src/groups` | ❌ Not needed | The decision layer asks "what may this user use", which `PublishedAppLoader` already answers through the `authorize` seam. The group's answer is *behind* that seam, not in the decision layer. |
| `packages/domain/src/authz` → `packages/domain/src/groups` | ⚠️ **The one edge that needs deciding** | If the RBAC service expands group memberships itself, `authz` needs a `groups` edge. The alternative is to keep the expansion inside `groups` and have `authz` depend on a narrow `GroupPermissionResolver` **port** declared in `authz` and implemented in `groups` — which inverts the edge. **Recommend the port**: `authz` stays the security core and `groups` becomes an optional contributor. |

---

## Suggested Build Order

> Six phases. The order is driven by **what unblocks what**, not by platform preference. Phases 11 and 13 are independent of each other and can run in parallel.

```
   Phase 10 ──────────► Phase 11 ──────────► Phase 12 ──────────► Phase 14
   OUTBOUND SEAM        ZALO OA               TELEGRAM             OPEN-ENDED
   + THREADING          ADAPTER               ADAPTER              AI GUARD
   CONTRACT
        │                   │                    │                    │
        │                   └────────┬───────────┘                    │
        │                            │                                │
        │                            ▼                                │
        │                    Phase 13 ────────────────┐                │
        │                    GROUP / DIRECTORY SYNC   │                │
        │                    + REVOCATION             │                │
        │                            │                │                │
        └────────────────────────────┴────────────────┴────────────────┘
                     (Phase 12 and 13 are parallelisable)
```

| # | Phase | Why here | Depends on | Unblocks |
|---|-------|----------|-------------|----------|
| **10** | **Outbound delivery seam + threading contract** | Nothing is demonstrable without it, and the platform work is worthless without it (finding #2). The threading fields are the contract amendment everything else assumes (finding #3). | — | 11, 12, 14 |
| **11** | **Real RBAC + persisted identity** | This is a **v1 correctness fix**, not a v2 feature: `RbacService` grants everything, the RBAC cache is per-process, the identity map is per-process (finding #4). Group RBAC is impossible on top of it, and the AI guard's "permission-first" claim is meaningless until it holds. | 10 | 12, 13, 14 |
| **12** | **Zalo OA adapter** | The **hardest and least documented** platform: no official Node SDK, a secret-suffix signature rather than an HMAC, no challenge handshake, a reply quota, and an undocumented API surface. It should be attempted while the schedule has slack, not last. Spike **S2** gates it. | 10, 11 | 13 (Zalo group source) |
| **13** | **Group / directory sync + revocation** | Needs the real RBAC (11) to have anything to bind to, and the Zalo group APIs (12) for the IM-sourced variant. The directory connector is the primary source and is independent of Zalo, so the bulk of this phase can proceed while Zalo is in flight. | 11, 12 (for the Zalo source only) | 14 |
| **14** | **Telegram adapter** | The **easiest** platform: an official SDK, thorough documentation, a well-understood secret-token scheme. Deliberately late so that it lands on a working outbound seam and a real RBAC, and so its schedule is not the one at risk. | 10, 11 | — |
| **15** | **Open-ended AI guard** | The most speculative work, and it **amends NG1** — it should land on a proven substrate, not carry the risk of the milestone. It also depends on group RBAC (13) to be meaningful: "permission-first" over a stub RBAC is a claim, not a guarantee. | 10, 11, 13 | — |

**Two parallelisable tracks.** Phases **12 (Zalo)** and **13 (groups)** share only the directory connector; the directory-sourced half of 13 does not need Zalo at all. Phase **14 (Telegram)** can run alongside 13. A two-engineer team can compress 12–14 into roughly one phase's duration; a one-engineer team should follow the sequence above.

**What is deliberately *not* in v2's sequence:** a general-purpose assistant (NG1 stays), a Telegram group-membership feature (§6.4 — not implementable), native IM form rendering (out of scope), and a multi-step workflow engine (out of scope).

---

## Open Questions and Spikes

| ID | Question | Blocks | Why reading cannot settle it | Suggested resolution |
|----|----------|--------|----------------------------|----------------------|
| **S2** | **Zalo OA webhook signature + API semantics.** Is `sha256(appId + rawBody + timestamp + secret)` byte-exact? What is the exact `data` field? Does Zalo offer any replay protection beyond the timestamp? Is there an undocumented verification handshake? | Phase 12 | No official Node SDK and no official Node documentation. Every implementation reference is community-authored, and the API has no changelog discipline. | **Two-day spike on a real OA account**: register a webhook, capture the exact bytes, verify the signature offline, exercise a reply (both the `user_id`+quote form and the reply-token form), and read the group APIs. Budget contingency in Phase 12. |
| **S3** | **Telegram secret-token + threading behaviour.** Is the secret-token compare enough for FR-IM-6, given there is no challenge handshake? Does `message_thread_id` behave as expected in a forum supergroup? Does `reply_parameters` need `chat_id` alongside `message_id`? | Phase 14 | Documented, but the *deployment* shapes (forum vs plain group, private vs supergroup) are not exercised by the docs. | **Half-day spike** against a real bot: `setWebhook` with a `secret_token`, post into a forum topic, reply with `reply_parameters`, and observe the delivered message shape. |
| **S4** | **Telegram group membership — is the gap truly closed?** | The *decision* to exclude Telegram groups from v2 | The Bot API has no member enumeration, but confirming that against a live group (and confirming `chat_member` coverage) costs an hour and prevents a scope error. | **One-hour spike.** Already answered on paper (see §6.4) — this is the empirical confirmation, not an open question. |
| **S5** | **Which directory source?** Entra ID, LDAP/AD, or a CSV export? | Phase 13 | A product/customer question, not a technical one. It determines the connector type, the sync cadence, and whether group membership is authoritative or advisory. | **Ask in Phase 11 discovery**: "What is your system of record for group membership, and does it expose an API we can poll?" |
| **S6** | **Does the AI guard need a new `JevCapability`?** | Phase 15 | Probably not — `'multi_turn'` already exists and is the right one. But if the guard needs to advertise that it can *refuse*, or that it is safe for free-text, the capability list may need a new value. | **Resolve in Phase 15 planning**, not before. The chain filter (`ProviderRegistry.chain(requiredCapabilities)`) is already capability-driven, so a new value is a one-line addition to `JevCapability` — **which is not the frozen D-23 wire spec** and is therefore safe, but should still be a deliberate, recorded decision. |

---

## Sources

**Shipped source read directly (2026-10-21)**
- `packages/contract/src/events/inbound-event.ts` — `ImPlatformSchema` (line 27), `InboundEventSchema` (43–66), the log-allowlist discipline note (20–25)
- `packages/contract/src/events/outbound-message.ts` — `OutboundActionSchema` (19–25), `OutboundMessageSchema` (31–50)
- `packages/contract/src/links/read-link-claims.ts` — the frozen claim set, `perm_version` (98–108), `READ_LINK_TARGET_RULES` (59–67)
- `packages/contract/src/jev/jev-provider.ts` — `JevCapability` (34), the `JevProvider` seam (45–52), `RULE_BASED_PROVIDER_NAME` (62)
- `packages/contract/src/jev/v1/` + `jev-v1.frozen.spec.ts` — the frozen D-23 wire spec
- `packages/contract/src/builder/app-definition.contract.ts` — `SectionNameSchema` (61–74), the "frozen contracts are consumed, never reshaped" note (8–11)
- `packages/domain/src/decision/routing-orchestrator.ts` — the permitted-set filter (50–59), `canOpenNow` (20), the provider loop (67–120)
- `packages/domain/src/decision/published-app-loader.ts` — RBAC-before-projection (86–107)
- `packages/domain/src/decision/provider-registry.ts` — the attestation gate (53–87), `chain(requiredCapabilities)` (95–99)
- `packages/domain/src/decision/clarification-session.service.ts` — `sessionKey(realUserId, channelId, threadTs)` (73), the bounds (58–66)
- `packages/domain/src/authz/rbac.service.ts`, `rbac-cache.service.ts`, `permission-check.service.ts` — the stub grant, the in-memory epoch cache, the `perm_version = 0` default
- `packages/domain/src/authz/builder-ability.ts` — `createBuilderAbility` (119) and the derived-ability model (1–31)
- `packages/domain/src/identity/identity-mapping.repository.ts` — the in-memory mapping array
- `packages/domain/src/builder/data-access/app-definition.repository.ts` — `AppDefinitionDocument` (61–88), `SECTION_FIELDS` (97–112)
- `packages/domain/src/adapters/teams/inbound/data-access/teams-event.repository.ts` — the D-39 fail-closed timeouts, the unique index, `insert → 'inserted' | 'duplicate'`
- `packages/domain/src/notifications/data-access/conversation-reference.repository.ts` — the platform-less key (32–33)
- `packages/domain/src/connectors/data-access/connector-credentials.repository.ts` — the `SecretEnvelope` credential pattern
- `packages/platform/src/crypto/envelope.ts` — `sealSecret` / `openSecret` / `SecretEnvelope`
- `packages/platform/src/logging/log-allowlist.ts` — the frozen field set and the "written justification" rule
- `packages/platform/src/queue/queue.constants.ts` — `INBOUND_EVENTS_QUEUE`, `NOTIFICATION_SEND_QUEUE`, `BULLMQ_PREFIX = '{akane-q}'`
- `packages/platform/src/queue/job-scheduler.ts` — `registerJobScheduler` / `resumeJobScheduler` / `upsertJobScheduler` and the FND-08 convergence argument
- `apps/api/src/adapters/teams/teams.controller.ts`, `teams-activity.service.ts` — the reference receiver
- `apps/api/src/adapters/slack/slack-webhook.controller.ts` — the `{ok:true}` stub
- `apps/api/src/adapters/teams/teams.outbound.service.ts` — the uncalled delivery service, `loadAuthConfigFromEnv()`
- `apps/api/src/webhooks/external/external-webhook.controller.ts` — the existing nonce + timestamp + HMAC inbound pattern
- `apps/worker/src/app.module.ts` — the inline `authorize` closure (53–65), the provider wiring (69–104)
- `apps/worker/src/processors/inbound-event.processor.ts` — the unenqueued `{kind:'link'}` (194), the `channel_id`-as-`threadTs` placeholder (203, 282)
- `apps/worker/src/processors/notification.processor.ts` — the hardcoded `TeamsDeliveryService` (87–91), `notificationJitterBackoff` (21–33)
- `apps/worker/src/adapters/teams/teams-delivery.service.ts`, `apps/scheduler/src/reconciliation.registration.ts` — the delivery and scheduler patterns
- `tooling/boundaries.config.mjs` — `DOMAIN_ELEMENT_TYPES` (38–63), `ALLOWED_EDGES` (139–243), R1 (357–388), R2 (390–417), R3 (419–433), the last-match-wins and `checkAllOrigins` notes

**Product requirements**
- `PRD.md` §6.7 `perm_version` (203–205) · AD-7 (299) · G3 (108) · line 167 · FR-I-4/FR-I-6 (332/334) · FR-R-1…FR-R-12 (344–355) · FR-J-6 (366) · FR-L-7 (402) · FR-IM-1…FR-IM-8 (485–492) · NG1 (121) · "Group-based RBAC — Q2 post-MVP" (1401) · NFR-SEC-4 (542)
- `.planning/PROJECT.md` — v1 state, the v2 scope, the "29 additional IM platforms" deferral, the technical-debt list
- `.planning/milestones/v1.0-ROADMAP.md` — Phase 2's recorded reason for the Mongo unique index over a BullMQ `jobId`; Phase 8's "adding a platform is additive rather than inventive"

**Platform documentation**
- Zalo OA — Official Account API and webhook documentation (`developers.zalo.me`, `docs.zaloplatforms.com`): the `X-ZEvent-Signature` construction, the payload fields (`message.msg_id`, `message.quote_msg_id`, `message.conversation_id`, `user_send_group_*` event names, `oa_id`), the absence of a challenge handshake, the outbound endpoints (`/v2.0/oa/message`, `/v3.0/oa/message/cs`, `/v3.0/oa/group/message`), the reply quota (8 per 48 h), the 2 000-character text limit, the group-member APIs and their "quản lý thông tin nhóm" permission + paid GMF package requirement
- Telegram Bot API (`core.telegram.org/bots/api`): `Update.update_id` (including the *"if there are no new updates for at least a week, then identifier of the next update will be chosen randomly"* caveat), `setWebhook` + `secret_token`, the `X-Telegram-Bot-Api-Secret-Token` header, `Message.message_thread_id`, `Message.reply_to_message`, `sendMessage`'s `message_thread_id` and `reply_parameters`, the 30 msg/s global and 1 msg/s per-chat limits, and the **absence of any member-enumeration method** (`getChat`, `getChatAdministrators`, `getChatMemberCount`, `getChatMember` only) — cross-checked against the `node-telegram-bot-api` maintainer threads and the Telegram community consensus that bulk enumeration requires MTProto
- Slack — `docs.slack.dev` Bolt v5 release note and the v4→v5 migration guide (`url_verification`, `v0:` signing, `thread_ts`)
- Microsoft Learn — Azure Bot Framework → Microsoft 365 Agents SDK migration guidance (`authorizeJWT` is required; the SDK ships no JWT middleware)

---
*Architecture research for: IM gateway v2 — platform expansion, group RBAC, open-ended AI guard*
*Researched: 2026-10-21*
