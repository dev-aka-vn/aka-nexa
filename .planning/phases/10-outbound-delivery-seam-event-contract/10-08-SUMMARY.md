---
phase: 10-outbound-delivery-seam-event-contract
plan: 08
subsystem: platform otel / worker processors / planning
tags: [trace-propagation, OUT-13, integration-proof, teams_events, phase-complete]
requires: [packages/platform/src/otel/trace-context.ts, apps/worker/src/processors/inbound-event.processor.ts, apps/worker/src/processors/outbound-delivery.processor.ts]
provides: [OUT-13 trace propagation, end-to-end seam integration spec, teams_events disposition]
affects: [packages/platform/src/otel/**, apps/worker/src/processors/**, .planning/REQUIREMENTS.md]
key-files:
  - packages/platform/src/otel/trace-context.ts
  - packages/platform/src/otel/trace-context.spec.ts
  - apps/worker/src/processors/outbound-delivery.integration.spec.ts
  - apps/worker/src/worker.module.ts
key-decisions:
  - "Trace context rides in BullMQ job options, not the frozen OutboundMessage envelope"
  - "Hand-roll the W3C encoding over already-installed @opentelemetry/api rather than add bullmq-otel"
  - "teams_events ages out — no backfill migration, the sweep already expires its dedupe value"
  - "unwiredPlatforms() reports zalo/telegram for the roadmap instead of failing boot"
requirements-completed: [OUT-13]
duration: ~4h
completed: 2026-10-22
---

# Phase 10 Plan 08 — Trace propagation + phase completion

## OUT-13: the requirement that was never implemented

`10-VERIFICATION.md` marked OUT-13 COVERED on the strength of plan 06's text.
Nothing implemented it. `grep -rn "traceparent\|traceContext"` over `apps/`
and `packages/` returns nothing, and no processor imports the OTel API at all.
Every outbound delivery attempt was an orphan span — present, with no path
back to the message that caused it, which is exactly what NFR-O-1 rules out.

**Decision — hand-roll over `@akane/platform`, not `bullmq-otel`:**
`@opentelemetry/instrumentation-bullmq` does not exist on npm (STACK.md) and
`bullmq-otel` was never installed. This phase's dependency budget covers only
`node-telegram-bot-api` and the AI SDK. `@opentelemetry/api` **is** already in
the tree — `packages/platform` imports it for `metrics/` — so the W3C encoding
is ~90 lines over what is already there.

**Decision — job options, not the envelope:** `OutboundMessage` is frozen by
D-21/D-23/D-43 and Phase 11 may only widen it with justification. An internal
trace id on the wire would also be visible to every platform the port reaches.
BullMQ's job options are persisted with the job in Redis and no contract
enumerates them.

**Scope of the restore:** the whole job, not just `send()` — the failure
notice, the audit write and `markDispatched` all belong to the same causal
chain, and wrapping only the transport call would leave those three orphaned.

## The integration proof Phase 10 lacked

`outbound-delivery.integration.spec.ts` (4 tests, real Redis + Mongo) is the
first thing to exercise the seam as a system: a job placed on
`IM_OUTBOUND_QUEUE` is delivered by the platform port, and the ledger row it
answers is flipped `dispatched` so the reconciler does not re-deliver it. Every
prior suite asserted the pieces in memory.

### A real bug it surfaced

`WorkerModule` declared `InboundEventProcessor` — which injects
`@InjectQueue(IM_OUTBOUND_QUEUE)` — while importing only `MongoModule`. Nest
lets a provider inject only tokens from modules **it** imports, so the queue
registration living in `app.module` alone compiled cleanly and then failed boot
with `UnknownDependenciesException`, after routing had already run, so the reply
was lost. `tsc` cannot see this class of error; only a real boot can.

### A testability fix

`PlatformEventRepository`'s 40 ms timeouts (the ack-path budget, CONTEXT) cannot
finish a freshly mapped container's first TCP connect, so the seam was
structurally un-testable. `PlatformEventRepositoryOptions` now mirrors
`MongoService`'s `MongoServiceOptions` — widened in the spec, default everywhere
else.

## `teams_events`: aged out, not migrated

Nothing in the codebase reads or writes it. Its only job was suppressing a
redelivery, so its value expires on the same 30-day schedule the sweep already
runs. A backfill would add code, tests and failure modes to preserve a bounded
dedupe window across a deploy. Recorded at `sweepOlderThan` where an operator
deploying will see it.

## Verification

| Check | Result |
|---|---|
| `npm run build` (lint + `tsc -b`) | exit 0 |
| `trace-context.spec.ts` | 13/13 |
| `outbound-delivery.integration.spec.ts` | 4/4 |
| Full affected suite (24 files) | 178/179 |

The one failure is **pre-existing**: `otp-onboarding.integration.spec.ts`
'self-onboards…' expects a `link` and gets `clarify`. Verified against the
Phase-09 base `70527a9e`. Not caused by this phase; left for Phase 11.

## Deviations

1. **OUT-13 was unverified when the plan said otherwise.** `10-VERIFICATION.md`
   claimed COVERED on plan intent. Implemented here (2 commits).
2. **`bullmq-otel` not installed.** Hand-rolled the W3C encoding over the
   already-present `@opentelemetry/api`.
3. **[Rule 1] Fixed the `WorkerQueueModule` import gap** — a boot failure, not
   a style issue.
4. **[Rule 4]** Added `PlatformEventRepositoryOptions` — the seam could not be
   proven at all otherwise.

## Phase 10 done

All 14 `OUT-*` requirements are complete. Deferred, and why:

| Item | Reason |
|---|---|
| Slack delivery implementation | No Slack bot token (D-10-04-2). `SlackOutboundPort` ships; the registry registers Teams only. |
| Zalo / Telegram rows in `IM_ADAPTER_WIRING` | Phases 12 / 13. |
| OTP onboarding test | Pre-existing failure, out of scope. |
