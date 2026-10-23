# Phase 10: Outbound Delivery Seam & Event Contract — Context

**Gathered:** 2026-10-22
**Status:** Ready for planning
**Phase:** 10 of 17 (v2.0)
**Requirements:** OUT-01 through OUT-14 (14 requirements)

## Phase Boundary

The inbound pipeline already computes the correct answer (`link` / `clarify` / `skipped` / `otp_*`) but discards it — `InboundEventProcessor.process()` returns `ProcessorOutcome` and BullMQ drops the return value. Phase 10 builds the **outbound delivery seam** so messages actually get delivered back to the originating IM conversation, adds a durable **platform-event ledger** with reconcile/sweep, generalizes the conversation reference key to be platform-scoped, amends both envelopes with threading fields (once, via a written **decision memo**), replaces the Slack placeholder with a real HMAC-verified receiver, and asserts at boot that every platform has exactly one inbound and one outbound.

## Implementation Decisions

### Envelope contract (the memo)
- **Both envelopes, same threading fields.** Add `thread_id?: string`, `reply_to_message_id?: string`, `native_event_id?: string`, `platform_metadata?: Record<string, unknown>` to **both** `InboundEventSchema` and `OutboundMessageSchema`. Both remain `.strict()`. Update `packages/contract/src/events/events.spec.ts` in the **same commit** as the amendment (a half-done `.strict()` amendment causes `safeParse` to fail and `InboundEventProcessor` to return `{kind:'skipped'}`, silently dropping messages).
- **`native_event_id`:** The platform's native message/event id (Slack `ts`/event id, Teams activity id, Telegram `update_id`+`message_id`, Zalo `msg_id`). The platform-event ledger uses a **unique index on `(platform, native_event_id)`** for deduplication (OUT-09). If an adapter cannot derive one, it must derive a stable fallback and treat it as exceptional.
- **`platform_metadata`:** Adapter-scoped, **non-PII only**, must never be logged or added to span attributes, must never leak past the adapter boundary. Constrain to depth-1 primitives (not `z.record(z.unknown())`). D-17 PII tests are the model for enforcement.
- **Threading:** `thread_id`/`reply_to_message_id` ride on both envelopes; adapters can set them on replies without re-inferring thread context from the conversation reference alone.

### Outbound identity & addressing
- **`message_id` is producer-generated and retry-stable.** Amend `packages/contract/src/events/outbound-message.ts:33` doc to say "Producer-generated, unique per outbound message, stable across delivery retries." The processor must **never** regenerate `message_id` on retry. Use a deterministic `jobId` on enqueue (e.g. `${platform}:${channel_id}:${message_id}`) for queue-level deduplication.
- **Addressing comes from the inbound event.** Build the `OutboundMessage` inside `InboundEventProcessor.process()` while keeping the original `InboundEvent` in scope, copying `platform`, `channel_id`, `chat_user_id` directly from it. `ProcessorOutcome` does **not** gain addressing fields.
- **`attempt`:** Sourced from BullMQ's `attemptsMade` at delivery time (not frozen on the message in a way that gets incremented incorrectly). The `notification.processor.ts` failure-notice pattern (new `message_id`) is correct only for a *different* message — do not copy it to retries.
- **Threading context:** Populate `thread_id`/`reply_to_message_id` from the inbound event/context when available; pass the real `thread_id` to clarification sessions.

### Where the delivery port lives (boundaries)
- **Port interface** in `packages/domain/src/adapters/<p>/outbound/` (matches `outbound-adapter` category / OUT-12). The interface only imports `@akane/contract` types.
- **Concrete implementation** in `apps/worker/src/adapters/<p>/outbound/` (app-worker element). The worker implementation does the `ConversationReferenceRepository` lookup and calls the platform SDK. This is necessary because `adapters` element may only import `platform`/`kernel`/`contract` (`tooling/boundaries.config.mjs:180`).
- **API must not import delivery impls.** The uncalled `apps/api/src/adapters/teams/teams.outbound.service.ts` must be **deleted** in the same commit as creating the new structure (along with its module export/import wiring). R1 (`tooling/boundaries.config.mjs:371-381`) forbids the api from importing `outbound-adapter` paths.

### Ack path & the platform-event ledger
- **Interpretation of OUT-10:** "No database read" is read narrowly (no *read*). The dedupe **write** (ledger `insert` with unique index) stays in the receiver so duplicates return `200 OK` with no enqueue.
- **Tight timeouts:** All Mongo timeouts on the ack path must be **< 50 ms** (well under 200 ms). Keep a dedicated `MongoClient` for the ledger with fail-closed timeouts and register a shutdown hook.
- **Ledger location:** Generalize from `packages/domain/src/adapters/teams/inbound/data-access/teams-event.repository.ts` to a neutral location (e.g. `packages/domain/src/platform-events/platform-event.repository.ts`) so both api and worker can access it without crossing `adapters/*/inbound/` (which R1 would forbid the worker from importing). Schema becomes platform-agnostic: `platform`, `platform_event_id`, unique composite `(platform, platform_event_id)`, `state` (`pending`/`dispatched`), timestamps. Add `markDispatched()`, reconciler job (OUT-09), and 30-day retention sweep (OUT-11).
- **Platform-scoped conversation key:** Change `ConversationReferenceRepository.key()` to `${platform}:${channel_id}::${chat_user_id}` (OUT-07). Migrate existing Teams rows (infer platform as `teams` since Slack has never written rows). The conversation reference upsert stays on the ack path but must be bounded.

### Slack receiver & verification
- **Replace placeholder.** `apps/api/src/adapters/slack/slack-webhook.controller.ts` and `slack-commands.controller.ts` must become real receivers. `rawBody: true` is already global in `apps/api/src/main.ts:52` and the placeholders already declare `@RawBody()`.
- **Slack HMAC:** New Slack-specific verifier (not the connector `WebhookHmacService` which uses `sha256=` over body-only). Slack signs `v0:{timestamp}:{body}` with `v0:<hex>` header; the `x-slack-request-timestamp` header must be inside signed material and a replay window enforced. Compute over the **raw** buffer, constant-time compare.
- **Pure ingest contract:** Verify → validate shape → deduplicate (ledger write) → enqueue → 200. No DB read, no KMS decrypt, no outbound call.

### Boot-time assertion (OUT-03)
- Extend `INBOUND_ADAPTER_REGISTRATIONS` / `process-capabilities.ts` to cover **both** inbound and outbound, or add a parallel `OUTBOUND_DELIVERY_REGISTRATIONS` token. `apps/api/src/bootstrap/boundary-manifest.ts` must list them as allowed exceptions. Assert at boot that every `ImPlatform` has exactly one inbound adapter and exactly one outbound delivery port; mismatch fails startup.

### Queue & DLQ
- Add outbound queue constant(s) to `packages/platform/src/queue/queue.constants.ts` (e.g. `IM_OUTBOUND_QUEUE`). Register as producer where needed following the `registerQueue` const rule (`apps/api/src/queue/api-queue.module.ts:34-43`).
- Reuse `notificationJitterBackoff` (`apps/worker/src/processors/notification.processor.ts:21-34`) for backoff strategy.
- Add the outbound processor to `WORKER_CONSUMERS` in `apps/worker/src/app.module.ts:177-190` and wire metrics/readiness.
- Extend `packages/cli/dlq.ts` to surface the outbound DLQ (OUT-14); import shared constants rather than hardcoding queue names.

### OTP handling
- **OTP delivery stays on the direct port.** The plaintext OTP code must never be placed in an `OutboundMessage` queued for later delivery (`otp-delivery.port.ts` exists for exactly this reason). The OTP outcomes remain handled outside the generic outbound-queue path, or the processor explicitly routes them to `OtpDeliveryPort`.

## Specific Ideas

- Follow `TeamsActivityService` pattern for the receiver: verify/auth → normalize to `InboundEvent` with `InboundEventSchema.parse` → ledger dedupe (`insert` → `'duplicate'` returns 200 with no enqueue) → conversation-ref upsert (platform-scoped) → enqueue to outbound/inbound queue → return ack.
- Follow `outbox-relay.processor.ts` + `reconciliation.processor.ts` patterns for `pending → dispatched` and crash recovery.
- Follow `OtpDeliveryPort` (`packages/domain/src/identity/otp/otp-delivery.port.ts`) as the template for the per-platform outbound delivery port interface.

## Deferred Ideas

- **Slack URL verification challenge / interactivity payload shapes** — details will be discovered during implementation against real Slack docs, but the verification pattern must follow Teams' urlVerification short-circuit (no writes).
- **Zalo/Telegram outbound implementations** — deferred to Phases 12-13; Phase 10 only needs the seam, ports, and at least Teams wired through the new path (or the structure to support them).
- **Full three-tier throttler cost measurement** — noted in OPS-07 (Phase 17).

## Canonical Refs

- `.planning/ROADMAP.md` §"Phase 10: Outbound Delivery Seam & Event Contract" (goal, success criteria, notes)
- `.planning/REQUIREMENTS.md` — OUT-01 through OUT-14
- `.planning/research/ARCHITECTURE.md:380-688` — target architecture (inbound/outbound envelopes, ledger, platform-scoped keys)
- `.planning/research/PITFALLS.md` — gotchas relevant to this phase
- `packages/contract/src/events/inbound-event.ts` — envelope schema (`.strict()`)
- `packages/contract/src/events/outbound-message.ts` — envelope schema (`.strict()`)
- `packages/contract/src/events/events.spec.ts` — strictness guard
- `packages/contract/src/links/read-link-claims.ts`, `read-link-claims.frozen.spec.ts` — D-21 (must not edit)
- `packages/contract/src/jev/jev-v1.frozen.spec.ts` — D-23 (must not edit)
- `packages/platform/src/logging/log-allowlist.ts`, `log-allowlist.formatter.spec.ts` — D-43
- `packages/platform/src/otel/span-attribute-allowlist.ts` — span attributes (must not admit thread ids/event ids)
- `apps/worker/src/processors/inbound-event.processor.ts` — outcome producer (currently discarded)
- `apps/worker/src/processors/notification.processor.ts` — jittered backoff precedent, failure-notice pattern
- `apps/worker/src/processors/outbox-relay.processor.ts`, `reconciliation.processor.ts` — ledger state machine precedent
- `apps/api/src/adapters/teams/*` — receiver/guard/activity service pattern
- `apps/api/src/adapters/slack/*` — placeholder to replace
- `packages/domain/src/adapters/teams/inbound/data-access/teams-event.repository.ts` — Teams-shaped ledger to generalize
- `packages/domain/src/notifications/data-access/conversation-reference.repository.ts` — key to make platform-scoped
- `packages/domain/src/identity/otp/otp-delivery.port.ts` — port pattern
- `tooling/boundaries.config.mjs` — R1/outbound-adapter category/adapters-element rules
- `tooling/boundaries.fixture.spec.ts` — boundary fixture gate
- `apps/api/src/main.ts` — `rawBody: true` already enabled

## Code Context

### Reusable assets
- `notificationJitterBackoff` (worker notification processor) — reuse for OUT-02
- `TeamsActivityService` / `TeamsAuthGuard` / `TeamsController` — receiver pattern
- `outbox-relay.processor.ts` + `reconciliation.processor.ts` — `pending → dispatched` + crash recovery
- `OtpDeliveryPort` — interface/DI pattern for per-platform ports
- `INBOUND_ADAPTER_REGISTRATIONS` / boundary manifest / boot guard patterns
- `AuditRepository.append` — for `im.outbound.failed` etc.
- `webhook-hmac.service.ts` structure (fast-fail → constant-time) — template, not Slack-implementation

### Established patterns
- Receivers are pure ingest: verify → validate `.strict()` → dedupe → enqueue → 200, no DB read/KMS/outbound
- Dedupe via unique index on platform event id; duplicates return 200 with no enqueue
- Worker-only consumers: add to `WORKER_CONSUMERS`, follow `@Processor` or `OnApplicationBootstrap` raw-Worker patterns
- Boundary rules are last-match-wins; add categories/elements first, permissive edges before restrictive rules
- `registerQueue` built once and used in both imports/exports
- Three entrypoints (api/worker/scheduler) with separate boundary manifests

### Integration points
- `InboundEventProcessor` — wire outcome → `OutboundMessage` construction
- `api-queue.module.ts` / `queue.constants.ts` — outbound queue registration
- `worker.module.ts` / `app.module.ts` — processor registration + DI
- `apps/api/src/app.module.ts` — remove/delete Slack placeholder wiring once replaced; delete Teams outbound API copy
- Contract barrel exports, boundaries config, CLI DLQ

## Gotchas
- **Silent drop:** adding fields to `.strict()` schemas without updating `events.spec.ts` causes `safeParse` to fail → `{kind:'skipped'}` in the processor. Amend schemas + spec together.
- **Boundary flip:** creating `adapters/*/outbound/` makes R1 live and forbids api imports; deleting `apps/api/.../teams.outbound.service.ts` in the same commit is mandatory.
- **R1 blocks worker reading inbound adapters:** put the generalized ledger in a neutral location (`platform-events/` or similar), not under `adapters/*/inbound/`.
- **Adapters element constraint:** domain adapters may only import `platform`/`kernel`/`contract` — implementations that need DB repos live in `apps/worker/src/adapters/`.
- **Key collision:** `ConversationReferenceRepository.key()` must become platform-scoped; migrate existing rows before writing a second platform.
- **Ack budget:** 500ms ledger timeout is wrong for 200ms budget — tighten to <50ms, bound conv-ref upsert, consider dedicated client + shutdown hook.
- **Message id:** doc says platform-assigned but requirement says producer-generated and retry-stable — fix the doc and never regenerate on retry.
- **OTP:** never queue plaintext OTP in `OutboundMessage`; use `OtpDeliveryPort`.
- **PII:** `platform_metadata`, `thread_id`, `reply_to_message_id`, `native_event_id` must not go to logs or span attributes.
- **Slack raw body:** use `@RawBody()` with `rawBody: true` (already enabled) and sign `v0:{timestamp}:{body}` with replay window.
- **Deterministic jobId:** prevents double-enqueue on retries/re-enqueues.
- **WORKER_CONSUMERS:** new outbound processor must be added or readiness will miss it.
