---
phase: 10-outbound-delivery-seam-event-contract
plan: 05
subsystem: api-adapters / platform
tags: [slack, webhook, hmac, receiver, OUT-04, T-10-07, T-10-08]
requires: [packages/platform/src/slack/slack-webhook-verifier.ts, packages/domain/src/platform-events/platform-event.repository.ts, packages/domain/src/notifications/data-access/conversation-reference.repository.ts]
provides: [Slack Events API receiver, Slack slash-command receiver]
affects: [apps/api/src/adapters/slack/*]
key-files:
  - packages/platform/src/slack/slack-webhook-verifier.ts
  - packages/platform/src/slack/slack-webhook-verifier.spec.ts
  - apps/api/src/adapters/slack/slack-webhook.controller.ts
  - apps/api/src/adapters/slack/slack-commands.controller.ts
  - apps/api/src/adapters/slack/slack.module.ts
  - apps/api/src/adapters/slack/slack.receiver.integration.spec.ts
key-decisions:
  - "Slack signing verified over raw bytes with v0:{ts}:{body}, timestamp inside the MAC"
  - "url_verification challenge echoed only after verification, no writes"
  - "Ledger failure fails closed to 503; duplicate is a no-op success"
requirements-completed: [OUT-04]
duration: ~2h (interrupted mid-run by usage limit; completed inline)
completed: 2026-10-22
---

# Phase 10 Plan 05 — Slack HMAC receivers

## What changed

Both Slack receivers now do real transport authentication, then follow the
Teams pure-ingest contract (verify → parse from the signed raw bytes → ledger
dedupe → conversation-reference upsert → enqueue → 200).

| File | Change |
|------|--------|
| `packages/platform/src/slack/slack-webhook-verifier.ts` | New. `verifySlackSignature()` + injectable `SlackWebhookVerifier`, 12 unit tests |
| `apps/api/src/adapters/slack/slack-webhook.controller.ts` | Placeholder replaced with the Events API receiver |
| `apps/api/src/adapters/slack/slack-commands.controller.ts` | Placeholder replaced with the slash-command receiver (urlencoded raw body) |
| `apps/api/src/adapters/slack/slack.module.ts` | Wired verifier, ledger, conversation-reference repo, producer queue |
| `apps/api/src/adapters/slack/slack.receiver.integration.spec.ts` | New — 16 integration tests over both controllers |

## Security properties now enforced

- **T-10-07 (spoofing, critical):** `v0:{timestamp}:{raw body}` HMAC-SHA256,
  `timingSafeEqual`, length compared first. Malformed-header, malformed-timestamp,
  stale-timestamp and missing-secret each return a *distinct* reason so the
  receiver maps operator faults to 503 and caller faults to 401.
- **T-10-08 (repudiation/replay, high):** replay window by `Math.abs` on the
  signed timestamp (not `now - ts`), so a far-future timestamp cannot stay inside
  the window; ledger dedupe collapses a redelivery to a no-op 200.
- **Loop prevention:** bot messages (`bot_id` / `subtype: 'bot_message'`) are
  acked without enqueue.
- **Ack budget:** no KMS, no outbound call; the two writes are the ledger insert
  (dedicated 40 ms `MongoClient`, 10-03) and the bounded conv-ref upsert.
- **No PII in `platform_metadata`:** only `team_id`, depth-1 primitives.

## Verification

| Check | Result |
|-------|--------|
| `npx tsc -b` | exit 0 |
| `npx eslint apps/api/src/adapters/slack packages/platform/src/slack --max-warnings=0` | exit 0 |
| `slack-webhook-verifier.spec.ts` | 12/12 pass |
| `slack.receiver.integration.spec.ts` | 16/16 pass |
| `tooling/boundaries.fixture.spec.ts` | 9/9 pass |

## Deviations

1. **Rule 1 (bug fix):** two type errors were left by the interrupted prior
   commit — `string[][]` is not a `URLSearchParams` init (fixed with an explicit
   `[string, string]` tuple annotation) and `Response.type()` does not exist on
   this tree's Express types (no `@types/express` installed — replaced with
   `setHeader('Content-Type', 'text/plain')`). Both repaired in `71766bab`.
2. **Rule 2:** plan had no api-side test task; the security-critical verify →
   dedupe → enqueue contract was asserted with 16 tests, since OUT-04 is a
   critical-severity threat item and an untested receiver is an unverified
   mitigation.

## Deferred

- Slack outbound delivery implementation (needs a bot token and the worker
  adapter) — 10-06 wires the queue; the delivery adapter is D-10-04-2.
- Slack interactive payloads — Phase 10 only covers Events API + slash commands.
