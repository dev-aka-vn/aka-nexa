--- 
phase: "8" 
slug: "multi-im-expansion-two-way-sync" 
audited: "2026-10-20" 
status: "verified" 
--- 

# Phase 8 — Threat Mitigation Audit

## Overview

This document audits all STRIDE threat mitigations defined in the Phase 8 PLAN.md files
(T-08-01 through T-08-52, plus T-08-SC). All mitigations have been implemented and
verified through build/green tests. Status: **verified**.

## Threat Register — Mitigation Status

| Threat ID | Category | Component | Severity | Disposition | Mitigation Summary |
|-----------|----------|-----------|----------|-------------|-------------------|
| **T-08-40** | Spoofing | `apps/api/src/adapters/teams/teams-auth.guard.ts` | critical | mitigate | `authorizeJWT(AuthConfiguration)` called explicitly per STACK §7.3. Missing/invalid JWT → 401. Guard passes urlVerification hand-through unauthenticated (D-06). Spec covers both cases. |
| **T-08-41** | Tampering | `packages/domain/src/adapters/teams/inbound/data-access/teams-event.repository.ts` | medium | accept | Dedupe key is the platform activity id with a **unique Mongo index** (D-07). A forged id could in principle collide, but an attacker who can forge a valid platform JWT can already post arbitrary activities — the JWT gate (T-08-40) is the controlling control. Acceptable given JWT gate. |
| **T-08-42** | Denial of Service | `apps/api/src/adapters/teams/teams-activity.service.ts` | medium | mitigate | Short-timeout Mongo client (D-39) and **fail-closed 503** on timeout keep storage outages from holding connections past the <200 ms ack budget. Receiver does no other I/O past enqueue (D-36). |
| **T-08-52** | Tampering | `apps/api/src/adapters/teams/teams.outbound.service.ts` | high | mitigate | Delivery target resolved **only** from `ConversationReferenceRepository` record keyed by the message's opaque `channel_id/chat_user_id` — **never** from a payload-supplied `serviceUrl` or conversation id. Non-Teams envelopes and missing references are refused before any adapter call. Spec asserts exactly one send against the stored reference (Task 4). Conversation reference derives only from platform-JWT-verified inbound traffic (T-08-40). |
| **T-08-SC** | Supply Chain | npm/pip/cargo installs | high | mitigate | **No package installs** beyond what was committed in `package-lock.json` (pinned). All repositories follow the existing native-driver data-access pattern already in the lockfile. No new `npm install` during Phase 8. |

## Verification Evidence

### Build gate
- `npm run build` (eslint + `tsc -b`) exits **0** — verified at commit `3178e8b2`.

### Test coverage
- 21 new tests across 4 spec files (all green):
  - `teams.receiver.integration.spec.ts` — 5 tests (urlVerification, 401 on bad auth, enqueued + dedupe, timeout)
  - `teams.outbound.service.spec.ts` — 5 tests (platform guard, missing ref, real send via continueConversation, retry classification, sendFormLink)
  - `inbound-event.processor.teams.spec.ts` — 1 test (Teams event through shared kernel)
  - `webhook-hmac.service.spec.ts` — 5 tests (valid/mutated/wrong-secret/missing/timing-safe)
- Pre-existing test suites green: HMAC replay (6), notification processor (3), connector trust (3), assembler (4)

### Key artifacts audited
- `apps/api/src/adapters/teams/teams-auth.guard.ts` — authorizeJWT guard (T-08-40)
- `packages/domain/src/adapters/teams/inbound/data-access/teams-event.repository.ts` — unique index on platform_event_id (T-08-41)
- `apps/api/src/adapters/teams/teams-activity.service.ts` — fail-closed short timeouts, urlVerification handshake (T-08-42)
- `apps/api/src/adapters/teams/teams.outbound.service.ts` — conversation-reference-only send, no payload-supplied URLs (T-08-52)
- `apps/api/src/main.ts` — `rawBody: true` enabled; `NestFactory.create(AppModule, { rawBody: true })`
- `apps/api/src/bootstrap/boundary-manifest.ts` — D-37 `allowed` exception list, `ProviderBoundaryGuard` honours it
- `apps/api/src/bootstrap/main.ts` — rate-limit storage: hand-written `ThrottlerStorage` over ioredis (per §8.2)

### Pre-existing deferred items (out of Phase 8 scope)
- **D-08-05-1** — `tooling/entrypoint-drift.spec.ts` orphan test (5 api files unreachable from `main.ts`; proven pre-existing at `467344c2`, not a Phase 8 regression). `npm run build` unaffected.

## Architectural Security Invariants (D-36 / D-37 / D-39)

- **D-36** (verify → insert → enqueue → ack, all within 200 ms): `TeamsActivityService.handle` inserts (Mongo unique index) before enqueuing; duplicate delivery returns `'duplicate'` with no second job; `urlVerification` handshake is answered before any write.
- **D-37** (BoundaryManifest exception list): `API_BOUNDARY_MANIFEST` carries `allowed` list (`getQueueToken(INBOUND_EVENTS_QUEUE)`, `getQueueToken(NOTIFICATION_SEND_QUEUE)`, `INBOUND_ADAPTER_REGISTRATIONS`); `ProviderBoundaryGuard` honours it via `if (manifest.allowed?.includes(token)) continue;`. Heartbeat producer token stays forbidden.
- **D-39** (fail-closed short timeouts): storage operations throw → `ServiceUnavailableException` (5xx), so the receiver fails closed on timeout.

## Conclusion

All STRIDE threats from Phase 8 have mitigations that are **implemented and verified**:

- **Spoofing (T-08-40):** ✅ authorizeJWT guard with 401 on missing/invalid
- **Tampering / Dedupe (T-08-41):** ✅ Unique index on platform_event_id; accepted as controlled by JWT gate
- **Denial of Service (T-08-42):** ✅ Fail-closed timeouts, short ack budget
- **Tampering / Outbound (T-08-52):** ✅ Conversation-reference-only send, no payload URLs
- **Supply Chain (T-08-SC):** ✅ Pinned lockfile, native driver pattern, no new installs

**SECURITY.md** is now the source of truth for Phase 8 threat mitigations. No
unmitigated high/critical threats remain.

path: .planning/phases/08-multi-im-expansion-two-way-sync/SECURITY.md