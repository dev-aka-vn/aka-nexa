---
phase: 08-multi-im-expansion-two-way-sync
verified: 2026-10-19T08:28:54Z
status: gaps_found
score: 0/6 requirements verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/08-multi-im-expansion-two-way-sync/08-01-PLAN.md"
  - ".planning/phases/08-multi-im-expansion-two-way-sync/08-02-PLAN.md"
  - ".planning/phases/08-multi-im-expansion-two-way-sync/08-03-PLAN.md"
  - ".planning/phases/08-multi-im-expansion-two-way-sync/08-04-PLAN.md"
  - ".planning/phases/08-multi-im-expansion-two-way-sync/08-01-SUMMARY.md"
  - ".planning/phases/08-multi-im-expansion-two-way-sync/08-02-SUMMARY.md"
  - ".planning/phases/08-multi-im-expansion-two-way-sync/08-03-SUMMARY.md"
  - ".planning/phases/08-multi-im-expansion-two-way-sync/08-04-SUMMARY.md"
  - "apps/api/src/adapters/teams/teams.controller.ts"
  - "apps/api/src/adapters/teams/teams.module.ts"
  - "apps/api/src/adapters/teams/teams.outbound.service.ts"
  - "apps/api/src/adapters/teams/teams-auth.guard.ts"
  - "apps/api/src/webhooks/external/external-webhook.controller.ts"
  - "apps/api/src/webhooks/external/external-webhook.module.ts"
  - "apps/api/src/webhooks/external/external-webhook.service.ts"
  - "apps/api/src/webhooks/external/external-webhook.consumer.ts"
  - "apps/api/src/webhooks/external/nonce-store.service.ts"
covered_digest: "v2:sha256:0324afd43b5b2208dc133e898f955b321e821ecfe5439554894c89787972edbb"
gaps:
  - truth: "SC#1 — Teams employee gets the identical experience (same normalized contract, same signed link, no Teams-specific kernel path)"
    status: failed
    reason: "The build does not compile and the inbound queue name mismatches the worker consumer. TeamsController enqueues to queue 'im:inbound' (teams.controller.ts:37,48), but the only inbound consumer is InboundEventProcessor registered on 'inbound-events' (apps/worker/src/processors/inbound-event.processor.ts:67). No worker listens on 'im:inbound', so a Teams activity is enqueued and never processed — no routing, no signed link, no confirmation. Additionally `tsc -b` fails with 14 errors in Phase 8 files (non-existent module paths, AgentApplication API misuse), so no Teams path runs at all."
    artifacts:
      - path: "apps/api/src/adapters/teams/teams.controller.ts"
        issue: "Enqueues to 'im:inbound'; worker consumes 'inbound-events'. Also TS2307 (bad imports), TS2314/TS2693/TS2353 (AgentApplication/AuthConfiguration misuse)."
      - path: "apps/api/src/adapters/teams/teams.outbound.service.ts"
        issue: "deliverToTeams() is a no-op (`void message;`) — nothing is ever sent to Teams; same TS errors as controller."
      - path: "apps/api/src/adapters/teams/teams-auth.guard.ts"
        issue: "canActivate() returns true unconditionally; no authorizeJWT wiring despite STACK §7.3 requiring it."
    missing:
      - "Fix imports to the real export surfaces (`@akane/contract` root export; queue/cache tokens from '@akane/platform') and the AgentApplication generic/auth API."
      - "Enqueue Teams events to the 'inbound-events' queue (or rename consistently) so InboundEventProcessor consumes them."
      - "A real Teams send path (conversation reference storage + activity send) replacing the no-op deliverToTeams."
      - "Enable raw-body capture (`NestFactory.create(AppModule, { rawBody: true })`) — @RawBody() is undefined otherwise, breaking both Teams SDK processing and webhook HMAC."
      - "Register a BullMQ Queue provider for the token TeamsController injects — api currently has no Queue provider, and API_BOUNDARY_MANIFEST forbids QUEUE_PRODUCER_TOKEN in the api process (D-03); the enqueue-from-request-path design itself needs a ruling."
  - truth: "SC#2 / NOT-01 — signed inbound webhook maps external entity ID to a submission_id, submitter receives IM notification with a user-bound deep link (NOT-03)"
    status: failed
    reason: "No HMAC verification is performed — the controller only regex-validates the signature FORMAT (sha256=<64 hex>) and never compares against a per-connector secret (external-webhook.controller.ts:64). There is no external-entity-ID → submission_id mapping anywhere. processNotification() builds an OutboundMessage with hardcoded platform='teams', channel_id='general', chat_user_id='user', validates the schema, and returns without looking up the submitter, generating a deep link, or sending anything (external-webhook.service.ts:31-56)."
    artifacts:
      - path: "apps/api/src/webhooks/external/external-webhook.controller.ts"
        issue: "Signature format check only; no HMAC over raw body, no secret lookup per connector, no entity-ID→submission_id mapping."
      - path: "apps/api/src/webhooks/external/external-webhook.service.ts"
        issue: "processNotification validates a schema and drops the message; no submitter lookup, no deep link, no delivery (NOT-03 not implemented)."
    missing:
      - "Per-connector secret store + crypto.timingSafeEqual HMAC verification over the raw body."
      - "External-entity → submission_id resolution (repository/query) and submitter identity lookup."
      - "Deep-link generation bound to the original submitter, delivered via the platform outbound path."
  - truth: "SC#3 / NOT-02 — replayed webhook (stale timestamp or reused nonce) is rejected and logged; NOT-04 — IM delivery failure retries three times"
    status: failed
    reason: "NOT-02 logic exists (±300s skew + Redis SET NX EX nonce in nonce-store.service.ts) but the file imports `RedisCache` from '@akane/platform/cache/redis-cache.js', an export path that does not exist (platform package.json exports only '.', './otel', './crypto'), so it cannot compile; the existing token is REDIS_CACHE from the package root. NOT-04 retry options (attempts:3, exponential backoff) are set on queue.add, but no BullMQ Worker/Processor ever consumes 'notification:send' — ExternalWebhookConsumer is a plain @Injectable not registered with the worker process, so retries never run."
    artifacts:
      - path: "apps/api/src/webhooks/external/nonce-store.service.ts"
        issue: "TS2307: imports from non-existent '@akane/platform/cache/redis-cache.js'; also its RedisCache.set(key,'1',seconds,'NX') signature must be checked against the real cache API."
      - path: "apps/api/src/webhooks/external/external-webhook.consumer.ts"
        issue: "Not a @Processor/WorkerHost; not registered in apps/worker. Jobs on 'notification:send' are never consumed."
      - path: "apps/api/src/main.ts"
        issue: "NestFactory.create(AppModule) without rawBody: true — @RawBody() is undefined, so the signature check (and skew input) has no body to protect."
    missing:
      - "Fix the RedisCache import to the REDIS_CACHE token from '@akane/platform' root and verify the set-NX API."
      - "Register the notification consumer as a BullMQ Worker on 'notification:send' in the worker process."
      - "A test proving stale-timestamp and reused-nonce rejection."
  - truth: "SC#4 / NOT-05 — connector that cannot sign has a documented alternative trust mechanism recorded per connector and visible to the platform admin"
    status: failed
    reason: "Nothing exists beyond a comment. processNotification has a placeholder sentence ('connector-specific validation would be implemented based on connector configuration'); there is no per-connector trust record, no documentation, and no admin visibility surface."
    artifacts:
      - path: "apps/api/src/webhooks/external/external-webhook.service.ts"
        issue: "NOT-05 reduced to a comment; no trust-mechanism data model, storage, or admin endpoint."
    missing:
      - "Per-connector trust-mechanism record (config schema + storage) and an admin-visible listing."
  - truth: "SC#5 — Teams outage queues and retries the user's request; no failure is silent to the user"
    status: failed
    reason: "Nothing queues or retries a Teams user request on outage. The outbound service swallows everything (no-op deliver), the inbound path is on a dead queue, and there is no failure notification path back to the user."
    artifacts:
      - path: "apps/api/src/adapters/teams/teams.outbound.service.ts"
        issue: "No-op delivery; isRetryableError() is defined but unreachable in any meaningful send path."
    missing:
      - "Outbox/retry-backed Teams send with a user-visible failure message."
  - truth: "Build gate — `npm run build` (eslint + tsc -b) succeeds"
    status: failed
    reason: "npm run build exits non-zero. ESLint: 7 errors in Phase 8 files (no-explicit-any ×4, unused vars ×3). tsc -b: 14 errors, all in Phase 8 files (TS2307 bad module paths ×6, AgentApplication generic/auth misuse ×6, TS7053 ×1, TS2693 ×2). All four SUMMARYs claim 'TypeScript compiles (tsc --noEmit passes)' — that claim is false; no SUMMARY ran lint or the real build."
    artifacts:
      - path: "apps/api/src/adapters/teams/teams.controller.ts"
        issue: "6 tsc errors + 1 lint error."
      - path: "apps/api/src/adapters/teams/teams.outbound.service.ts"
        issue: "6 tsc errors + 3 lint errors."
      - path: "apps/api/src/webhooks/external/external-webhook.service.ts"
        issue: "3 tsc errors."
      - path: "apps/api/src/webhooks/external/external-webhook.consumer.ts"
        issue: "2 tsc errors + 2 lint errors."
      - path: "apps/api/src/webhooks/external/nonce-store.service.ts"
        issue: "1 tsc error."
      - path: "apps/api/src/webhooks/external/external-webhook.controller.ts"
        issue: "1 lint error (unused crypto import — the import that was presumably meant for HMAC)."
    missing:
      - "Fix all 14 tsc errors and 7 eslint errors; re-run the full `npm run build`."
deferred: []
---

# Phase 8 — Verification

**Goal (ROADMAP):** A Microsoft Teams employee gets the identical experience, and an external system can push status back to the person who originally submitted.
**Verified:** 2026-10-19T08:28:54Z
**Status:** gaps_found (0/6 requirements verified)
**Re-verification:** No — initial verification

## Plan summaries

| Plan | SUMMARY exists | Self-check | Commit | Verdict |
|---|---|---|---|---|
| 08-01 | yes | PASSED | 9f9c9c1d ✓ | Files exist, but do not compile |
| 08-02 | yes | PASSED | 8d78975e ✓ | Files exist; delivery is a no-op |
| 08-03 | yes | PASSED | f76f32a4 ✓ | Files exist; no real HMAC verify |
| 08-04 | yes | PASSED | 30457998 ✓ | Files exist; consumer never runs |

All four commits exist and the working tree is clean (`git status` empty). Every SUMMARY claims "tsc --noEmit passes" — falsified below.

## Requirements coverage

| Requirement | Source | Status | Evidence |
|---|---|---|---|
| IM-10 | 08-01, 08-02 | ✗ BLOCKED | Adapter files exist but `tsc -b` fails (14 errors); enqueues to dead queue 'im:inbound' vs consumer 'inbound-events'; outbound send is `void message` |
| NOT-01 | 08-03 | ✗ BLOCKED | Signature format regex only; no HMAC verification; no entity→submission_id mapping |
| NOT-02 | 08-03 | ✗ BLOCKED | Logic present (skew + nonce) but imports non-existent module path — uncompilable |
| NOT-03 | 08-04 | ✗ BLOCKED | processNotification validates schema then drops the message; no submitter lookup, no deep link, no send |
| NOT-04 | 08-04 | ✗ BLOCKED | attempts:3 + backoff set on enqueue, but no worker consumes 'notification:send'; retries never execute |
| NOT-05 | 08-04 | ✗ BLOCKED | Placeholder comment only; no trust-mechanism record, doc, or admin surface |

No ORPHANED requirements (all six are claimed by plans).

## Build / typecheck (the hard gate)

- `npm run build` → **FAIL** (exit non-zero; lint stops the run).
  - ESLint: **7 errors**, all in Phase 8 files: `no-explicit-any` ×4, unused-vars ×3 (incl. `crypto` import in external-webhook.controller.ts — the import that should have done the HMAC).
- `npx tsc -b` → **FAIL**, 14 errors, all in Phase 8 files:
  - TS2307 ×6: `@akane/contract/events/inbound-event.js`, `@akane/contract/events/outbound-message.js`, `@akane/platform/queue/queue.js`, `@akane/platform/cache/redis-cache.js` — none of these subpath exports exist (contract exports only `.`; platform exports `.`, `./otel`, `./crypto`).
  - TS2314 ×2 `AgentApplication` requires type argument; TS2693 ×2 `AuthConfiguration` used as value (it is a type); TS2353 ×2 unknown `auth` property.
  - TS7053: implicit any index in external-webhook.service.ts:48.

## Wiring findings beyond the build

1. **Dead inbound queue:** `im:inbound` (teams.controller.ts) vs `inbound-events` (inbound-event.processor.ts:67) — no consumer.
2. **No Queue provider in api:** TeamsController and ExternalWebhookService inject `Queue`, but api's composition root provides `REDIS_QUEUE` (IORedis) only; `API_BOUNDARY_MANIFEST` deliberately forbids `QUEUE_PRODUCER_TOKEN` in api (D-03). The enqueue-in-request-path design needs a boundary ruling, not just a provider.
3. **No raw body:** `NestFactory.create(AppModule)` (main.ts:52) without `rawBody: true` → `@RawBody()` is undefined for both the Teams SDK path and webhook HMAC.
4. **Notification consumer orphaned:** ExternalWebhookConsumer is a plain `@Injectable`, not registered in apps/worker and not a BullMQ `@Processor`.
5. **No tests:** zero spec files for teams adapter or external webhooks.

## Anti-patterns

| File | Line | Pattern | Severity |
|---|---|---|---|
| teams.outbound.service.ts | 44 | `void message;` no-op delivery | 🛑 Blocker (stub) |
| external-webhook.controller.ts | 64 | format-only signature check presented as verification | 🛑 Blocker (security) |
| external-webhook.service.ts | 35-37 | hardcoded platform/channel/user placeholders | 🛑 Blocker (stub) |
| external-webhook.service.ts | 31-33, controller.ts:61 | "for tracer E2E / foundation" comments deferring real logic | 🛑 Blocker (unresolved debt markers) |
| teams-auth.guard.ts | 15 | unconditional `return true` | ⚠️ Warning (scaffold) |

## Human verification required

None — failures are deterministic and observable from the build output and queue-name comparison. No runtime testing is warranted until the build passes.

## Gaps summary

Every one of the six requirements is blocked. The phase produced structure — modules, controllers, a nonce store — but (a) the code does not compile under either lint or `tsc -b`, falsifying all four SUMMARYs' self-check claims; (b) the Teams inbound path enqueues to a queue no worker consumes, and the outbound path is a literal no-op, so SC#1 and SC#5 cannot hold; (c) webhook signature verification checks only the string format, NOT-03 does not deliver anything, and NOT-05 is a comment. Re-verification should run `npm run build` (full, with lint) and compare queue names against `@Processor(...)` registrations before claiming self-check PASSED.

**Not committed** — per verification contract, the orchestrator bundles this report. Working tree is otherwise clean.

---

_Verified: 2026-10-19T08:28:54Z_
_Verifier: the agent (gsd-verifier)_
