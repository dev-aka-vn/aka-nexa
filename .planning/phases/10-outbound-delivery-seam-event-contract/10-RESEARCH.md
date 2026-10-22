# Phase 10: Outbound Delivery Seam & Event Contract - Research

**Researched:** 2026-10-22
**Domain:** Outbound delivery seam, event contracts, platform event ledger, platform-scoped addressing, Slack webhook verification
**Confidence:** HIGH

## Summary

Phase 10 closes the "outbound half" gap: `InboundEventProcessor.process()` currently returns `ProcessorOutcome` but BullMQ drops it, Slack receivers are placeholders, and Teams has an uncalled outbound service in `apps/api`. The phase wires the outcome into an `OutboundMessage` constructed while the original `InboundEvent` is in scope, enqueues to a new outbound queue processed by a worker, introduces a generalized platform-event ledger with reconcile/sweep, makes conversation keys platform-scoped, amends both envelopes with threading fields (via a decision memo), moves outbound ports/impls to satisfy boundary rules (delete API's Teams outbound copy), adds real Slack HMAC verification, and asserts boot-time coverage for inbound+outbound per platform.

Primary recommendation: Do the contract amendment + events.spec.ts update in the same commit (strict schemas). Put the generalized ledger in a neutral location (e.g. `packages/domain/src/platform-events/`) accessible to both api/worker, tighten ledger timeouts to <50ms, make message_id producer-generated and retry-stable with deterministic jobId, and never put plaintext OTP into OutboundMessage (use OtpDeliveryPort).

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Both envelopes, same threading fields.** Add `thread_id?: string`, `reply_to_message_id?: string`, `native_event_id?: string`, `platform_metadata?: Record<string, unknown>` to both `InboundEventSchema` and `OutboundMessageSchema`. Both remain `.strict()`. Update `packages/contract/src/events/events.spec.ts` in the **same commit** as the amendment.
- **native_event_id:** platform's native id (Slack ts/event id, Teams activity id, Telegram update_id+message_id, Zalo msg_id). Ledger uses unique index on `(platform, native_event_id)`. If adapter cannot derive one, derive stable fallback and treat as exceptional.
- **platform_metadata:** adapter-scoped, **non-PII only**, never logged/span attributes, never leak past adapter boundary. Constrain to depth-1 primitives (not `z.record(z.unknown())`). D-17 PII tests model enforcement.
- **Threading:** ride on both envelopes; adapters can set on replies without re-inferring from conversation reference alone.
- **message_id is producer-generated and retry-stable.** Amend `OutboundMessageSchema` doc: "Producer-generated, unique per outbound message, stable across delivery retries." Processor must **never** regenerate on retry. Use deterministic `jobId` (e.g. `${platform}:${channel_id}:${message_id}`) for queue-level dedup.
- **Addressing from inbound.** Build `OutboundMessage` inside `InboundEventProcessor.process()` while keeping original `InboundEvent` in scope, copy `platform/channel_id/chat_user_id` directly. `ProcessorOutcome` does **not** gain addressing fields.
- **attempt:** from BullMQ's `attemptsMade` at delivery time (not frozen in a way that increments incorrectly). Failure-notice pattern (new message_id) only for *different* message.
- **Threading context:** populate from inbound/context when available; pass real thread_id to clarification sessions.
- **Port interface** in `packages/domain/src/adapters/<p>/outbound/` (matches `outbound-adapter` category). Interface only imports `@akane/contract`. **Concrete impl** in `apps/worker/src/adapters/<p>/outbound/` (needs DB repos). **API must not import delivery impls.** Delete uncalled `apps/api/src/adapters/teams/teams.outbound.service.ts` in same commit as new structure.
- **OUT-10 interpretation:** "no database read" read narrowly (no *read*). Dedupe **write** (ledger insert with unique index) stays in receiver so duplicates return 200 OK with no enqueue.
- **Tight timeouts:** all Mongo timeouts on ack path **< 50 ms** (well under 200ms). Dedicated MongoClient for ledger with fail-closed timeouts and shutdown hook.
- **Ledger location:** generalize from `packages/domain/src/adapters/teams/inbound/data-access/teams-event.repository.ts` to neutral (e.g. `packages/domain/src/platform-events/platform-event.repository.ts`) accessible to api and worker. Schema platform-agnostic: `platform`, `platform_event_id`, unique composite `(platform, platform_event_id)`, `state` (`pending`/`dispatched`), timestamps. Add `markDispatched()`, reconciler job (OUT-09), 30-day retention sweep (OUT-11).
- **Platform-scoped conversation key:** `ConversationReferenceRepository.key()` becomes `${platform}:${channel_id}::${chat_user_id}` (OUT-07). Migrate existing Teams rows (infer platform `teams`). Conv-ref upsert stays on ack path but bounded.
- **Slack receiver:** replace placeholders. `rawBody: true` already global in `apps/api/src/main.ts:52`. Slack HMAC: new Slack-specific verifier (not connector `WebhookHmacService` using `sha256=` over body-only). Sign `v0:{timestamp}:{body}` with `v0:<hex>` header; `x-slack-request-timestamp` inside signed material; replay window. Compute over **raw** buffer, constant-time compare.
- **Pure ingest:** verify → validate shape → dedupe (ledger write) → enqueue → 200. No DB read, no KMS decrypt, no outbound call.
- **Boot-time assertion (OUT-03):** extend `INBOUND_ADAPTER_REGISTRATIONS`/`process-capabilities.ts` to cover both inbound and outbound, or add parallel `OUTBOUND_DELIVERY_REGISTRATIONS`. `apps/api/src/bootstrap/boundary-manifest.ts` must list as allowed exceptions. Assert every `ImPlatform` has exactly one inbound and one outbound; mismatch fails startup.
- **Queue/DLQ:** add outbound queue constant(s) to `packages/platform/src/queue/queue.constants.ts` (e.g. `IM_OUTBOUND_QUEUE`). Register as producer where needed following `registerQueue` const rule. Reuse `notificationJitterBackoff`. Add outbound processor to `WORKER_CONSUMERS` in `apps/worker/src/app.module.ts`. Extend `packages/cli/dlq.ts` to surface outbound DLQ (OUT-14), import shared constants.
- **OTP:** never queue plaintext OTP in `OutboundMessage` (use `OtpDeliveryPort`). Route OTP outcomes outside generic outbound-queue path or processor routes to `OtpDeliveryPort`.

### the agent's Discretion
- Exact neutral ledger location/name (CONTEXT suggests `packages/domain/src/platform-events/platform-event.repository.ts`)
- How to structure outbound processor/job shape
- Specific deterministic jobId format as long as stable across retries
- Implementation details of Slack verifier/replay window
- Details of reconciler/sweep scheduling

### Deferred Ideas (OUT OF SCOPE)
- Slack URL verification challenge / interactivity payload shapes details (follow Teams urlVerification short-circuit pattern)
- Zalo/Telegram outbound implementations (Phase 10 only needs seam/ports/structure)
- Full three-tier throttler cost measurement (OPS-07 Phase 17)

## Phase Requirements
| ID | Description | Research Support |
|----|-------------|------------------|
| OUT-01 | Message produced by inbound pipeline delivered back to originating IM conversation, not discarded | Wire InboundEventProcessor outcome to build OutboundMessage from original event; enqueue to outbound queue; worker delivers via platform delivery port |
| OUT-02 | Outbound delivery async via queue worker with jittered exponential backoff and DLQ | Add IM_OUTBOUND_QUEUE, use notificationJitterBackoff, add processor to WORKER_CONSUMERS, extend DLQ |
| OUT-03 | Every IM platform has exactly one inbound and one outbound, asserted at boot | Extend process-capabilities/registrations (or add OUTBOUND_DELIVERY_REGISTRATIONS), update boundary manifests, boot-time check fails on mismatch |
| OUT-04 | Slack inbound verifies v0: HMAC-SHA256 over raw body before accepting; placeholder removed | Replace slack-webhook/commands controllers, Slack-specific verifier (v0:{ts}:{body}, header inside signed material, replay window), constant-time compare over raw buffer |
| OUT-05 | Inbound event carries optional thread_id, reply_to_message_id, native_event_id so replies route to thread | Amend InboundEventSchema + OutboundMessageSchema with these fields, both .strict(); update events.spec.ts same commit |
| OUT-06 | Inbound envelope accepts optional platform_metadata (non-PII) never leaking past adapter boundary | Add platform_metadata constrained to depth-1 primitives, non-PII only, never log/span attributes |
| OUT-07 | Conversation reference records platform, platform-scoped conversation identifier, validated per-platform payload; second platform never collides | Change ConversationReferenceRepository.key() to `${platform}:${channel_id}::${chat_user_id}`, migrate existing Teams rows to platform='teams' |
| OUT-08 | Outbound message identifier producer-generated and stable across every delivery retry | Amend OutboundMessage doc, processor never regenerates, deterministic jobId for dedup |
| OUT-09 | Platform event recorded in platform-scoped ledger with unique index on platform event id, moves pending→dispatched; crashed delivery reconciled by scheduled job | Generalize TeamsEventRepository to neutral ledger (platform, platform_event_id, unique (platform,platform_event_id), state, timestamps), add markDispatched(), reconciler job |
| OUT-10 | Receiver verifies signature, validates shape, deduplicates, enqueues, returns — no DB read, no credential decryption, no outbound call | Dedup write (ledger insert) stays on ack path (narrow read); all Mongo timeouts <50ms, dedicated client, shutdown hook |
| OUT-11 | Platform event ledger swept of entries older than 30 days | Add 30-day retention sweep job/logic |
| OUT-12 | Outbound delivery implementation for each platform lives under that platform's adapter directory (boundary rule applies) | Ports in packages/domain/src/adapters/<p>/outbound/; impls in apps/worker/src/adapters/<p>/outbound/; delete API Teams outbound copy and wiring |
| OUT-13 | Trace context of inbound event propagated into outbound delivery attempt | Ensure trace context propagated through queue/job to outbound delivery (BullMQ/OTel as per stack) |
| OUT-14 | Dead-lettered outbound message visible on operator surface with failure reason and platform event that produced it | Extend packages/cli/dlq.ts to surface outbound DLQ, import shared constants |

## Standard Stack
### Core (existing)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| NestJS | 12.1.2 | App framework | Already in use |
| BullMQ | 6.3.11 | Queues/workers/schedulers | Already used for inbound/notification/outbox |
| MongoDB (native driver) | 7.7.0 | Ledger/storage | Already used (TeamsEventRepository uses MongoClient directly) |
| Zod | 4.6.5 | Schema validation | Contract schemas use Zod, .strict() enforced |
| ioredis | 6.0.0 | Redis client | BullMQ/ioredis topology |

### Patterns to reuse
| Pattern | Location | Notes |
|---------|----------|-------|
| Teams receiver flow | apps/api/src/adapters/teams/teams-activity.service.ts | verify/auth → normalize to InboundEvent via InboundEventSchema.parse → ledger dedupe (insert) → conv-ref upsert (platform-scoped later) → enqueue → ack |
| Ledger with timeouts/index | packages/domain/src/adapters/teams/inbound/data-access/teams-event.repository.ts | Dedicated MongoClient, 500ms timeouts, ensureIndex unique on platform_event_id, duplicate detection |
| Jittered backoff + failure notice | apps/worker/src/processors/notification.processor.ts | notificationJitterBackoff, retryable vs terminal, audit + failure notice with new message_id |
| Outbox/reconciliation | apps/worker/src/processors/outbox-relay.processor.ts, reconciliation.processor.ts | pending→dispatched state machine, crash recovery |
| Port pattern | packages/domain/src/identity/otp/otp-delivery.port.ts | Interface for per-platform ports |
| Queue registration | apps/api/src/queue/api-queue.module.ts, packages/platform/src/queue/* | registerQueue const rule, root options, producer-only registration with exceptions |
| Boot assertions/manifests | packages/platform/src/bootstrap/*, apps/*/bootstrap/* | Boundary manifests, process capabilities, ProviderBoundaryGuard |

## Architecture Patterns

### System Architecture Diagram (conceptual)
```
IM Platform (Slack/Teams/...) 
  -> API Receiver (verify/signature/HMAC) 
      -> Platform Event Ledger (dedupe write, pending) [<50ms, dedicated client]
      -> ConversationReference upsert (platform-scoped, bounded)
      -> Enqueue InboundEvent to INBOUND_EVENTS_QUEUE
  <- 200 OK (no DB read/KMS/outbound)

Worker: InboundEventProcessor
  -> parse/validate InboundEventSchema
  -> route/handle (identity, routing, clarification, OTP)
  -> build OutboundMessage from original InboundEvent (copy platform/channel_id/chat_user_id, produce message_id, threading from event/context)
  -> enqueue OutboundMessage to IM_OUTBOUND_QUEUE (deterministic jobId) with trace context

Worker: OutboundDeliveryProcessor
  -> get conversation reference (from repo)
  -> call platform outbound delivery port impl (apps/worker/src/adapters/<p>/outbound/)
  -> mark ledger dispatched (reconciler handles crashes)
  -> on failure: retry with notificationJitterBackoff, DLQ on terminal
```

### Recommended Project Structure
```
packages/contract/src/events/
├── inbound-event.ts        # add thread_id, reply_to_message_id, native_event_id, platform_metadata
├── outbound-message.ts     # same + update message_id doc
└── events.spec.ts          # update in same commit

packages/domain/src/
├── platform-events/        # NEW: generalized ledger (neutral)
│   ├── platform-event.repository.ts
│   └── index.ts
├── adapters/<p>/outbound/  # NEW: port interfaces only
│   └── <p>.outbound.port.ts (or similar)
└── notifications/data-access/conversation-reference.repository.ts  # key() becomes platform-scoped

apps/worker/src/adapters/<p>/outbound/  # NEW: concrete impls (use repos, SDK)
apps/worker/src/processors/
├── inbound-event.processor.ts  # build+enqueue outbound
└── outbound-delivery.processor.ts  # NEW

apps/api/src/adapters/
├── slack/slack-webhook.controller.ts  # replace placeholder with real HMAC verify
├── slack/slack-commands.controller.ts # replace placeholder
└── teams/teams.outbound.service.ts    # DELETE
```

### Pattern 1: Receiver as pure ingest (Teams model)
**What:** verify → validate `.strict()` → dedupe ledger write → conv-ref upsert (bounded) → enqueue → 200. No DB read/KMS/outbound.
**When to use:** All platforms.
**Example:** See `TeamsActivityService.handle()` - dedupe via `teamsEventRepo.insert(eventId, activity)` returning 'duplicate' → return 'duplicate' with no enqueue.

### Pattern 2: Port in domain/adapters/<p>/outbound, impl in worker adapters
**What:** Interface in domain (imports only @akane/contract), concrete impl in apps/worker does repo lookups and SDK calls. Delete API impl.
**Why:** Respects `adapters` element constraint (domain adapters may only import platform/kernel/contract) and R1 forbids api from importing outbound-adapter paths.

### Pattern 3: Generalized ledger
**What:** Neutral location, platform-agnostic schema with unique `(platform, platform_event_id)`, states pending/dispatched, timestamps. Dedicated MongoClient with <50ms timeouts, shutdown hook, ensureIndex, markDispatched(), reconciler, 30-day sweep.
**Why:** Both api and worker need access; worker must not import from `adapters/*/inbound/` (R1 would forbid). Migrate Teams rows (infer platform 'teams').

### Anti-Patterns to Avoid
- **Adding fields to .strict() without updating events.spec.ts:** causes safeParse to fail → `{kind:'skipped'}` silently dropping messages
- **Putting API outbound impls:** violates R1 boundary rule
- **Putting ledger under adapters/*/inbound/:** blocks worker access
- **Regenerating message_id on retry:** must stay stable
- **Queueing plaintext OTP in OutboundMessage:** use OtpDeliveryPort
- **Reading from DB on ack path as "read" in a broad sense:** OUT-10 says no DB read; dedup write is OK if bounded and <50ms
- **Using connector WebhookHmacService for Slack:** Slack signs differently (v0:{ts}:{body})
- **Forgetting to add outbound processor to WORKER_CONSUMERS:** readiness will miss it

## Don't Hand-Roll
| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Jittered backoff | Custom retry logic | notificationJitterBackoff from notification.processor.ts | Already exists and tested pattern |
| Queue registration | Ad-hoc Queue injection | BullModule.registerQueue with const + registerQueue rule | Matches existing pattern, avoids token mismatches |
| Ledger dedupe/index | Manual checks | MongoDB unique index on (platform, platform_event_id) | Atomic, reliable |
| HMAC verification structure | From scratch | Follow TeamsAuthGuard/webhook patterns but Slack-specific | Teams shows pattern; Slack needs different scheme |
| Backoff/DLQ behavior | Custom | BullMQ retries + DLQ + extend DLQ CLI | Existing infrastructure |

## Common Pitfalls
### Pitfall 1: Silent drop from strict schema change
**What goes wrong:** Add fields to `.strict()` schemas without updating `events.spec.ts` → `safeParse` fails → `InboundEventProcessor` returns `{kind:'skipped'}`, silently dropping messages.
**Why it happens:** Forgetting spec update in same commit.
**How to avoid:** Amend both schemas and `events.spec.ts` together; add tests for new fields.
**Warning signs:** Messages start being skipped after contract change.

### Pitfall 2: Boundary flip breaks build
**What goes wrong:** Creating `adapters/*/outbound/` makes R1 live; forgetting to delete `apps/api/.../teams.outbound.service.ts` and wiring causes api to import outbound-adapter paths → lint/build fails.
**Why it happens:** Not deleting API copy in same commit.
**How to avoid:** Plan deletion + moves together.
**Warning signs:** boundaries lint errors about api importing outbound-adapter.

### Pitfall 3: Worker can't access ledger
**What goes wrong:** Putting generalized ledger under `packages/domain/src/adapters/*/inbound/` violates R1 assumption for worker.
**Why it happens:** Following Teams pattern too literally.
**How to avoid:** Put in neutral location like `packages/domain/src/platform-events/`.
**Warning signs:** Worker imports fail boundary lint.

### Pitfall 4: Ack budget blown
**What goes wrong:** Mongo timeouts 500ms+ on ack path, or slow conv-ref upsert causes >200ms ack.
**Why it happens:** Reusing existing repo timeouts without tightening.
**How to avoid:** Dedicated MongoClient for ledger with <50ms timeouts, bound conv-ref upsert, fail-closed.
**Warning signs:** Slow webhook responses/timeouts.

### Pitfall 5: message_id/regeneration issues
**What goes wrong:** Regenerating message_id on retry or freezing attempt incorrectly breaks retry-stability.
**Why it happens:** Copying notification.processor failure-notice pattern (which creates new message_id for different message).
**How to avoid:** message_id producer-generated and stable; attempt from attemptsMade at delivery time; only new message_id for different message (failure notice).
**Warning signs:** Duplicate sends or broken retry semantics.

### Pitfall 6: OTP leaked to queue
**What goes wrong:** Putting plaintext OTP in OutboundMessage queued for delivery.
**Why it happens:** Treating OTP like other messages.
**How to avoid:** Use OtpDeliveryPort; route OTP outcomes outside generic outbound queue.
**Warning signs:** OTP codes appear in queue/job data.

### Pitfall 7: Slack verification wrong
**What goes wrong:** Using connector WebhookHmacService (sha256= over body-only) or not using raw body/timestamp in signed material/replay window.
**Why it happens:** Reusing wrong verifier.
**How to avoid:** Slack-specific verifier: sign `v0:{timestamp}:{body}` with `v0:<hex>`, check `x-slack-request-timestamp` inside signed material, replay window, constant-time compare over raw buffer.
**Warning signs:** Valid Slack events rejected or invalid accepted.

## Code Examples

### Teams receiver pattern (to follow)
```typescript
// apps/api/src/adapters/teams/teams-activity.service.ts
const event = InboundEventSchema.parse({...});
let insertResult = await this.teamsEventRepo.insert(eventId, activity);
if (insertResult === 'duplicate') return 'duplicate';
// conv-ref upsert (bounded)
await this.convRefRepo.upsert(key, {...});
// enqueue
await this.queue.add(INBOUND_EVENTS_QUEUE, event);
return 'enqueued';
```

### Jittered backoff (reuse)
```typescript
// apps/worker/src/processors/notification.processor.ts
export function notificationJitterBackoff(attemptsMade: number, _type?: string, _err?: Error, job?: unknown): number {
  const backoff = (job as { opts?: { backoff?: unknown } } | undefined)?.opts?.backoff;
  const delay = typeof backoff === 'number' ? backoff : ((backoff as { delay?: number } | undefined)?.delay ?? 1000);
  const base = Math.min(delay * Math.pow(2, attemptsMade - 1), 30000);
  return Math.round(base * (0.5 + Math.random() * 0.5));
}
```

### Queue registration pattern
```typescript
// apps/api/src/queue/api-queue.module.ts
const inboundEventsQueue = BullModule.registerQueue({ name: INBOUND_EVENTS_QUEUE });
const notificationSendQueue = BullModule.registerQueue({ name: NOTIFICATION_SEND_QUEUE });
// use same const in imports and exports
```

## State of the Art
| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| InboundEventProcessor outcome discarded | Outcome wired to build OutboundMessage and enqueue | Phase 10 | Bot finally answers |
| Teams outbound only in API (uncalled) | Moved to worker impls under adapters/<p>/outbound/, API copy deleted | Phase 10 | Boundary compliance, proper architecture |
| Teams-specific ledger | Generalized platform-event ledger with reconcile/sweep | Phase 10 | Multi-platform support, crash recovery |
| Conversation key not platform-scoped | `${platform}:${channel_id}::${chat_user_id}` with migration | Phase 10 | No cross-platform collision |
| Slack placeholders | Real HMAC-verified receivers | Phase 10 | Proper Slack integration |
| No boot assertion for outbound coverage | Assert every platform has inbound+outbound | Phase 10 | Fail fast on misconfiguration |

## Assumptions Log
| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Neutral ledger location `packages/domain/src/platform-events/` is acceptable to boundaries | Architecture/Boundaries | Boundary lint may need adjustment |
| A2 | Dedicated MongoClient for ledger with <50ms timeouts is feasible without major refactor | Ack path | May need to adjust connection pooling |
| A3 | Deterministic jobId format `${platform}:${channel_id}:${message_id}` is sufficient for dedup | Queue | May need different format |
| A4 | Slack HMAC verification details match expected behavior | Slack receiver | May need to adjust to exact Slack signing scheme |
| A5 | Migrating existing Teams conversation reference rows to platform='teams' is safe | Migration | Data migration needed |

## Open Questions
1. **Ledger location details**
   - What we know: Must be neutral, accessible to api and worker, not under adapters/*/inbound/
   - What's unclear: Exact module structure and exports
   - Recommendation: Create `packages/domain/src/platform-events/` with repository, types, index exports

2. **Outbound processor/job shape**
   - What we know: Needs to deliver via platform port, use backoff, handle DLQ
   - What's unclear: Exact job data shape (OutboundMessage + context)
   - Recommendation: Pass OutboundMessage as job data, add trace context; use deterministic jobId

3. **Boot-time assertion mechanism**
   - What we know: Need to assert every ImPlatform has exactly one inbound and one outbound
   - What's unclear: How to track outbound registrations (parallel token or extend existing)
   - Recommendation: Add OUTBOUND_DELIVERY_REGISTRATIONS similar to INBOUND_ADAPTER_REGISTRATIONS

4. **Slack verifier implementation**
   - What we know: v0 HMAC over v0:{ts}:{body}, timestamp in header inside signed material, replay window, constant-time
   - What's unclear: Exact replay window duration, header names
   - Recommendation: Follow Slack docs patterns, make window configurable

## Environment Availability
> Phase involves code/config changes, queues, MongoDB, Redis. Dependencies expected to be available in dev environment.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| MongoDB | Platform event ledger, conversation refs | Assumed | 8.0.x per stack | — |
| Redis | BullMQ queues | Assumed | ≥8.2 per stack | — |
| Node.js | Runtime | Assumed | 24.x LTS | — |

## Validation Architecture
> workflow.nyquist_validation assumed enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 5.0.3 |
| Config file | vitest.config.* (see repo) |
| Quick run command | `pnpm test` or package-specific |
| Full suite command | `pnpm test` / CI suite |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OUT-01 | Inbound outcome delivered as OutboundMessage | integration/unit | vitest for InboundEventProcessor + outbound wiring | Check existing processor tests |
| OUT-04 | Slack HMAC verification | unit/integration | vitest for Slack verifier/controller | New tests needed |
| OUT-05/OUT-06 | Envelope amendments | unit | events.spec.ts updates | Exists - must update |
| OUT-07 | Platform-scoped conversation key | unit/migration | conv-ref repo tests + migration | Check existing tests |
| OUT-09/OUT-11 | Ledger state machine + sweep | integration/unit | platform-event repo tests | New tests needed |

### Wave 0 Gaps
- [ ] Update `packages/contract/src/events/events.spec.ts` for new fields
- [ ] Tests for Slack HMAC verifier (valid/invalid/replay/timestamp outside window)
- [ ] Tests for generalized ledger (dedupe, pending→dispatched, sweep)
- [ ] Tests for platform-scoped conversation key migration
- [ ] Tests for outbound processor/backoff/DLQ behavior

## Security Domain
> security_enforcement enabled (default).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Slack HMAC verification, Teams auth patterns |
| V3 Session Management | no | N/A |
| V4 Access Control | partial | OTP routing stays on OtpDeliveryPort (separate path) |
| V5 Input Validation | yes | Zod .strict() on both envelopes, shape validation |
| V6 Cryptography | yes | HMAC-SHA256 for Slack (constant-time), no secrets logged |

### Known Threat Patterns for stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged webhook events | Spoofing/Tampering | HMAC verification before any processing; raw body; replay window |
| Replay attacks | Repudiation/Elevation | Ledger dedup on platform event id; timestamp/replay window for Slack |
| PII leakage | Information Disclosure | platform_metadata non-PII only, never logged/span attributes; depth-1 primitives |
| Secret exposure | Information Disclosure | OTP never queued; credentials via KMS; no env secrets in logs |

## Sources

### Primary (HIGH confidence)
- `packages/contract/src/events/inbound-event.ts` - current envelope schema
- `packages/contract/src/events/outbound-message.ts` - current envelope schema  
- `packages/contract/src/events/events.spec.ts` - strictness guard
- `apps/worker/src/processors/inbound-event.processor.ts` - outcome producer (discarded currently)
- `apps/worker/src/processors/notification.processor.ts` - jittered backoff, failure notice pattern
- `apps/worker/src/processors/outbox-relay.processor.ts`, `reconciliation.processor.ts` - ledger state machine patterns
- `apps/api/src/adapters/teams/teams-activity.service.ts` - receiver pattern (verify→dedupe→enqueue→200)
- `packages/domain/src/adapters/teams/inbound/data-access/teams-event.repository.ts` - ledger pattern with timeouts/index
- `packages/domain/src/notifications/data-access/conversation-reference.repository.ts` - conversation refs
- `apps/api/src/adapters/slack/*` - placeholders to replace
- `apps/api/src/main.ts:52` - rawBody: true
- `tooling/boundaries.config.mjs` - R1/R2/R3 rules, outbound-adapter category
- `packages/platform/src/bootstrap/process-capabilities.ts` - capability tokens
- `apps/api/src/bootstrap/boundary-manifest.ts` - API boundary manifest

### Secondary (MEDIUM confidence)
- `.planning/ROADMAP.md` Phase 10 notes - architecture guidance
- `.planning/REQUIREMENTS.md` OUT-01 through OUT-14

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All patterns exist in codebase
- Architecture: HIGH - Clear patterns from Teams/notification/outbox processors
- Pitfalls: HIGH - Documented in CONTEXT.md gotchas
- Boundaries/migration: HIGH - Rules are explicit in config

**Research date:** 2026-10-22
**Valid until:** 2026-11-21 (30 days for stable patterns)
