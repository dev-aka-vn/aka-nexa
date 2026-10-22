---
phase: 10-outbound-delivery-seam-event-contract
plan: 06
subsystem: worker queue + processors / cli
tags: [outbound-seam, im-outbound-queue, dlq, OUT-01, OUT-02, OUT-14, T-10-09]
requires: [packages/platform/src/queue/queue.constants.ts, packages/domain/src/platform-events/platform-event.repository.ts, apps/worker/src/adapters/teams/outbound/teams-delivery.adapter.ts]
provides: [IM_OUTBOUND_QUEUE, OutboundDeliveryProcessor, OutboundDeliveryRegistry, WorkerQueueModule, dlq --queue]
affects: [apps/worker/src/**, packages/cli/dlq.ts, packages/platform/src/queue/queue.constants.ts]
key-files:
  - packages/platform/src/queue/queue.constants.ts
  - apps/worker/src/processors/inbound-event.processor.ts
  - apps/worker/src/processors/outbound-delivery.processor.ts
  - apps/worker/src/processors/outbound-delivery.registry.ts
  - apps/worker/src/queue/worker-queue.module.ts
  - packages/cli/dlq.ts
key-decisions:
  - "message_id is a digest of (platform, event_id, action), never randomUUID — retry-stability requires it"
  - "WorkerQueueModule is worker-local; platform's QueueModule registers only the heartbeat queue"
  - "OutboundDeliveryRegistry maps platform → port so Phase 12/13 add a line, not a processor branch"
  - "Slack outbound implementation still absent (no bot token); Teams is the only registered port"
requirements-completed: [OUT-01, OUT-02, OUT-14]
duration: ~2h (interrupted mid-run by usage limit; completed inline)
completed: 2026-10-22
---

# Phase 10 Plan 06 — Close the outbound delivery seam

## What changed

| File | Change |
|------|--------|
| `packages/platform/src/queue/queue.constants.ts` | `IM_OUTBOUND_QUEUE`, `CONNECTOR_DELIVERY_QUEUE` (new shared constants) |
| `apps/worker/src/queue/worker-queue.module.ts` | New — producer/consumer registration for the outbound queue |
| `apps/worker/src/processors/inbound-event.processor.ts` | Enqueues one `OutboundMessage` per routable outcome |
| `apps/worker/src/processors/outbound-delivery.processor.ts` | New — the delivery consumer |
| `apps/worker/src/processors/outbound-delivery.registry.ts` | New — platform → port map + attempt budget |
| `apps/worker/src/app.module.ts` | Wires the queue, registry, processor, `WorkerModule`, `WORKER_CONSUMERS` |
| `packages/cli/dlq.ts` | `--queue` flag, outbound row shape, shared constants |
| `apps/worker/src/processors/connector-delivery.processor.ts` | Uses `CONNECTOR_DELIVERY_QUEUE` instead of a literal |

## The three bugs this plan closed

1. **The outcome was discarded.** `InboundEventProcessor.process()` returned
   `ProcessorOutcome`; BullMQ drops a processor's return value. Every
   `link` / `clarify` / OTP reply the pipeline computed died with the job.
2. **`WorkerModule` was an orphan.** It was imported by `app.module.ts` for
   decorator side-effects only, never in `@Module.imports`, so
   `InboundEventProcessor` was never instantiated and *nothing consumed
   `INBOUND_EVENTS_QUEUE`*. Now imported.
3. **The DLQ CLI hardcoded `'connector-delivery'` in five places**, none of
   them shared with the producer's constant.

## Retry-stability (the load-bearing decision)

`message_id` is `sha256(outbound:{platform}:{event_id}:{action})[0..32]`, not
`randomUUID()`. A digest means a BullMQ retry of the same inbound job enqueues
the **same** id, and `jobId` (`{platform}:{channel_id}:{message_id}`) makes
the enqueue itself de-duplicated. `attempt` is filled by the delivery
processor from `job.attemptsMade` — never frozen on the message.

Only the failure notice mints a new id, because it is a different message.

## T-10-09 (OTP never queued)

`otp_requested` and `skipped` produce no outbound job. Asserted in
`otp-onboarding.integration.spec.ts`, whose new test walks the queue with the
delivered code and confirms it never appears.

## Verification

| Check | Result |
|-------|--------|
| `npm run build` (lint + `tsc -b`) | exit 0 |
| boundary fixtures | 9/9 |
| `inbound-event.processor.spec.ts` | 21/21 |
| `inbound-event.processor.teams.spec.ts` | pass |
| `outbound-delivery.processor.spec.ts` | 11/11 |
| `dlq.integration.spec.ts` | 4/4 |
| Slack receiver + verifier specs | 28/28 |

## Deviations

1. **[Rule 1]** The plan asked me to "look up how the processor is wired" —
   the answer was *not at all*. `WorkerModule` was never in
   `AppModule.imports`. Fixing that was required for the seam to function.
2. **[Rule 2]** The plan left `attempt`-semantics ambiguous; resolved per
   CONTEXT (from `attemptsMade`) and asserted in a test.
3. **[Rule 4]** Slack outbound is still unimplemented — no bot token and no
   conversation-reference writer for Slack until a real Slack app exists.
   `SlackOutboundPort` ships; the registry registers Teams only.
   (D-10-04-2 carries this.)
4. **[Rule 3]** `@Processor(CONNECTOR_DELIVERY_QUEUE)` now uses the shared
   constant, because the plan made the CLI import constants and leaving one
   literal would recreate the class of drift it names.

## Deferred

- **No runtime proof.** All tests are unit/in-memory. Nothing here has run
  against a live Redis: the 10-08 integration plan (or 10-07's boot
  assertion) should boot the worker and observe one job traverse
  `inbound-events → im-outbound → delivered`.
- Slack delivery implementation (Phase 10 leaves the port only).
- `teams_events` collection is now unwritten and `teamsEventId` was never
  migrated — flagged in 10-03's summary for 10-08.
