# Phase 8: Multi-IM Expansion & Two-Way Sync - Context

**Gathered:** 2026-10-19
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase extends the platform from Slack-only to **Slack + Microsoft Teams** (both on the same normalized event contract), and adds **inbound signed webhooks** from external systems to deliver notifications back to the **original submitter**.

### What changes (additive, not a rewrite)
- **Teams adapter**: implement Teams webhook/agents endpoints following `@microsoft/agents-hosting@1.9.1` + `-msteams`. No Teams-specific logic in the kernel; the kernel consumes only `InboundEvent`/`OutboundMessage` (IM-01, IM-10, IM-11).
- **Inbound webhooks**: an authenticated, signed webhook path that allows external systems (e.g. Redmine) to push status updates mapped to `submission_id`, with replay protection (NOT-01..NOT-05).
- **Notifications**: outbound IM notifications to the original submitter (thread-aware where supported) when status changes, with retry semantics.
- **Contract reuse**: `packages/contract/src/events/*` already defines the IM envelope vocabulary. We reuse opaque IDs, strict schemas, and the existing action taxonomy for outbound messages.

### What does not change (out of scope)
- Zalo and Telegram — explicitly v2 (per ROADMAP).
- General-purpose conversational features, multi-step workflows, group sync.
- Core routing, JEV, App Builder, read/edit links (they remain as-is).
</domain>

<spec_lock>
## Requirements (locked by Phase 8)
- **IM-10**: The Microsoft Teams adapter delivers the identical experience via `@microsoft/agents-hosting` + `-msteams`
- **NOT-01**: An external system can push a signed inbound webhook that maps an external entity ID to a `submission_id`
- **NOT-02**: An inbound webhook is protected against replay by timestamp and nonce validation
- **NOT-03**: A notification is delivered via IM to the original submitter with a deep link bound to that user
- **NOT-04**: Notification delivery retries 3 times if IM delivery fails
- **NOT-05**: An external system that cannot sign its webhooks has a documented alternative trust mechanism, recorded per connector

Additional IM requirements relevant: IM-01, IM-02, IM-03, IM-04, IM-05, IM-07, IM-08, IM-09, IM-11.
</spec_lock>

<decisions>
## Implementation Decisions

### Teams adapter
- **D-01 (Normalized contract)**: Keep kernel IM-agnostic. All Teams ingress/egress normalize to `InboundEvent` and `OutboundMessage` (IM-01). No Teams types leak beyond the Teams adapter module.
- **D-02 (Hosting stack)**: Use `@microsoft/agents-hosting@1.9.1`, `@microsoft/agents-hosting-express@1.9.1`, `@microsoft/agents-hosting-extensions-msteams@1.9.1`. Avoid deprecated `botframework-sdk` (doesn't exist; support ended). Do **not** add legacy AI/Telemetry middleware that would conflict with manual OTel (per STACK §7.3).
- **D-03 (Auth)**: Implement `authorizeJWT(AuthConfiguration)` in the Teams adapter (SDK does not supply middleware). Token validation must run before any processing and before enqueue.
- **D-04 (Threading/targets)**: Maintain thread continuity where Teams supports it (IM-11). Use opaque `channel_id`/`chat_user_id` semantics; never enrich envelope with display names/emails.
- **D-05 (Retries/backpressure)**: Treat Teams delivery failures as retryable per IM-05; respect platform retry hints. Acks are empty/slash-style semantics where applicable (IM-07 applies where Teams has "invoke/command" style responses).
- **D-06 (URL verification/challenges)**: Handle Teams-specific handshakes per official Agents SDK guidance; do not generalize to Slack's challenge format (keep platform-specific in adapter).
- **D-07 (Idempotency)**: Use MongoDB unique index on platform event ID for enqueue (IM-04), not BullMQ `jobId`. Duplicate deliveries produce one processing job.

### Inbound webhooks (two-way sync)
- **D-08 (Endpoint design)**: Introduce a new authenticated inbound webhook controller (separate from IM webhook receivers). Route path/name should be per-external system or generic under `/webhooks/external/:connectorId` (or similar) — keep namespaced to avoid collision with Slack/Teams webhook paths.
- **D-09 (Signature & timing)**: Require signed requests. Validate signature on **raw body** before any JSON parsing (defense-in-depth). Enforce **timestamp skew window** + **nonce** uniqueness (NOT-02). Replay attempts (stale/duplicate nonce) are rejected and audited.
- **D-10 (Mapping)**: Map external entity ID → `submission_id` (NOT-01). Mapping table/field must be configurable per connector (documented). The mapping is authoritative; never infer from arbitrary fields.
- **D-11 (Trust mechanism fallback)**: For external systems that cannot sign webhooks, record and enforce a **documented alternative trust mechanism** per connector (NOT-05). Must be explicit in connector config and surfaced to platform admins (audit the choice).
- **D-12 (Notification delivery)**: On valid inbound webhook (status change), send notification **to the original submitter** via IM (NOT-03). Deep link must be **bound to that user** (no generic/shared link that leaks across users). Thread in the original conversation where platform supports (IM-11).
- **D-13 (Retries)**: Notification delivery retries **3 times** on IM delivery failure (NOT-04). Failures beyond that are logged, produce distinct actionable audit/log entries, and do not silently disappear (IM-05). Use backoff with jitter.
- **D-14 (Ack semantics)**: Inbound webhooks ack fast (<200 ms) and enqueue processing (mirrors IM-03). All business logic in consumer. Reject early on signature/timestamp/nonce.
- **D-15 (Security boundaries)**: Never log raw signatures or full webhook bodies containing sensitive fields. Respect log field allowlist (D-16 from Phase 1). PII never in logs/traces.
- **D-16 (Connector-scoped config)**: Store webhook signing key/secret and trust mechanism per connector config (credentials managed per existing connector security model). Rotation path must be documented.

### Integration points & data model
- **D-17 (Submission lookup)**: To notify the original submitter, we need to map `submission_id` ↔ original `chat_user_id` + `platform` + `channel_id` (conversation context). Leverage existing submission/audit records (Phase 5). Do not create a new cross-cutting PII cache.
- **D-18 (Event model)**: Model notification as an outbound IM event (`action: 'status'` fits `OutboundActionSchema` — `status` already exists). No new action needed; text carries human-readable status and deep link.
- **D-19 (Queueing)**: Use existing BullMQ queues (shared infrastructure). Notification jobs must be idempotent and traceable (OTel span continuity across enqueue/consume per NFR-O-1).
- **D-20 (App/kernel boundary)**: Teams and inbound webhooks live in `apps/api/src/adapters/` and `apps/api/src/webhooks/` (or adapter-aligned modules). No domain/core changes that couple IM platforms to notification logic except contracts.

### the agent's Discretion
- Exact webhook route structure (`/webhooks/:connectorId/status` vs namespaced), request header names for signature/timestamp/nonce (document in code).
- Nonce store (Redis SET with TTL matching timestamp window is simplest; ensure atomic check+set to prevent race).
- Deep link format for "bound to that user" (read link variant or notification-specific deep link) — reuse existing link machinery where possible; do not invent a new token class unless necessary.
- Backoff strategy for NOT-04 (e.g. exponential with jitter, cap total attempts).
- Error response codes/body on rejection (keep minimal, avoid leaking details).
</decisions>

<canonical_refs>
## Canonical References

### Phase definition & requirements
- `.planning/ROADMAP.md` §"Phase 8: Multi-IM Expansion & Two-Way Sync" — goal, 5 success criteria, Teams stack note (retired Bot Framework; use Agents SDK), research note
- `.planning/REQUIREMENTS.md` — IM-10, NOT-01–NOT-05 (and IM-01–IM-05, IM-07–IM-09, IM-11 context)
- `.planning/PROJECT.md` — IM adapter contract, constraints (opaque IDs, PII never in logs/JWTs)

### Frozen contracts (must not reshape)
- `packages/contract/src/events/inbound-event.ts` — `InboundEventSchema`, `ImPlatformSchema` (`slack|teams|zalo|telegram`), `InboundActionSchema`, strict schema, opaque IDs
- `packages/contract/src/events/outbound-message.ts` — `OutboundMessageSchema`, `OutboundActionSchema` (`reply|form_link|confirmation|error|status`)
- `packages/contract/src/index.ts` — re-exports of event types
- `packages/contract/src/events/events.spec.ts` — existing schema validation (non-regression)

### Existing implementation (integration points)
- `apps/api/src/adapters/slack/slack-webhook.controller.ts` — webhook receiver pattern (raw body, ack shape, <200ms mindset)
- `apps/api/src/adapters/slack/slack.module.ts` — adapter module wiring pattern
- `apps/api/src/app.module.ts` — adapter registration, queue/bootstrap context (D-13: <200ms ack)
- `apps/api/src/adapters/slack/slack-commands.controller.ts` — slash command pattern (empty ack + async delivery per IM-07)
- `packages/domain/src/decision/*`, `packages/domain/src/builder/*` — submission/connector model context (for mapping submission_id → submitter)
- `packages/domain/src/queue/*`, `apps/worker/*` — BullMQ patterns for enqueue/consume, retry, OTel propagation

### Stack reference (explicit)
- **Microsoft Teams**: `@microsoft/agents-hosting@1.9.1`, `@microsoft/agents-hosting-express@1.9.1`, `@microsoft/agents-hosting-extensions-msteams@1.9.1` (STACK §7.3). Do not use `botframework-sdk` (404; retired). JWT auth via `authorizeJWT(AuthConfiguration)`.
- **Observability**: manual OTel, pino + allowlist (PII exclusion), span continuity across queue hop (bullmq-otel or built-in path). No `@nestjs/observe`.
- **Security**: HMAC/webhook signing on raw body, timestamp+nonce replay protection, rate limits (IM-06), log allowlist.

### Prior phases (carry forward)
- `.planning/phases/02-the-vertical-slice-slack-internal-routing/02-CONTEXT.md` — `InboundEvent`/normalization rationale, enqueue idempotency (MongoDB unique on platform event ID), ack semantics
- `.planning/phases/05-integration-async-execution/05-CONTEXT.md` — connector model, outbox/async, retry semantics, DLQ, three-state model (useful for NOT-04/IM-05)
- `.planning/phases/07-multi-form-apps-per-form-triggers/07-CONTEXT.md` — submission/form context, identity resolution

### Research/spike references (from roadmap)
- Microsoft Teams activity-delivery retry semantics beyond 429/502 — research area called out in Phase 8 notes
- Spike S2 context (Zalo hand-rolled client) is out of scope for Phase 8 (explicitly v2)
</canonical_refs>

<codebase_context>
## Codebase Context (reusable assets & patterns)

### Adapters & controllers (patterns to follow)
- **Slack controller pattern**: raw body preserved (`@RawBody()`), strict validation at contract boundary, <200ms ack, enqueue to consumer (IM-03). Reference: `slack-webhook.controller.ts`, `slack-commands.controller.ts`.
- **Module wiring**: adapter module exports controllers only; business logic in domain/worker. Reference: `slack.module.ts`.
- **Contract-first**: all inbound/outbound IM shapes come from `packages/contract` (D-01/D-02). No re-defining Zod schemas in adapter layer.
- **Opaque identifiers**: never leak PII; envelope is `.strict()`.

### Contracts & types
- `InboundEventSchema`/`OutboundMessageSchema` already include `teams` in `ImPlatformSchema` — schema is forward-compatible; adapter must populate correctly.
- `OutboundActionSchema` has `status` — perfect for notification deep links/status updates (D-18).

### Queueing, retries, idempotency
- BullMQ-backed processing; enqueue idempotency via MongoDB unique index on platform event ID (IM-04). Worker path uses structured logging + OTel.
- Retry semantics: 3 attempts for notification delivery (NOT-04) — align with existing retry policies (Phase 5). Backoff with jitter.

### Observability & security
- OTel bootstrap (Phase 1), span attribute allowlist, single Prometheus metrics path.
- Pino serializers with frozen log field allowlist; reject/strip non-allowlisted fields before serialization. Never log webhook bodies/signatures.
- Rate limits per user/app (IM-06), hand-written ThrottlerStorage over ioredis.

### Submission mapping
- Submissions carry submitter identity context (Phase 2/5). To satisfy NOT-03 (notify original submitter, deep link bound to that user), look up submission by `submission_id` and retrieve original `chat_user_id`, `platform`, `channel_id`. No new PII tables.
</codebase_context>

<deferred_ideas>
## Deferred Ideas (future phases, not in Phase 8)

- **Zalo adapter** (IM-12) — hand-rolled OA client over `undici`, explicitly v2 (per roadmap). Spike S2 context deferred.
- **Telegram adapter** — PRD Phase 5/v2; out of scope.
- **Group-based/attribute-based RBAC for notifications** — v2.
- **Notification templates/localization** — not specified; keep simple human-readable text.
- **Webhook transformation DSL** (JSONata) beyond simple field mapping — connectors can evolve later.
- **Per-connector webhook rate limits** (beyond global) — may be needed at scale; current per-user/per-app limits cover receivers.
- **Audit UI for inbound webhook rejections** (beyond log entries) — Phase 9 compliance UI can expand if needed.
</deferred_ideas>
