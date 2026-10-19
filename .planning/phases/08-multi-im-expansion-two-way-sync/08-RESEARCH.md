# Phase 8: Multi-IM Expansion & Two-Way Sync - Research

**Researched:** 2026-10-19  
**Domain:** IM adapter expansion (Microsoft Teams), inbound webhooks, two-way sync/notifications  
**Confidence:** HIGH

## Summary

Phase 8 extends the platform from Slack-only to Slack + Microsoft Teams using the Microsoft 365 Agents SDK (`@microsoft/agents-hosting@1.9.1` + `@microsoft/agents-hosting-express@1.9.1` + `@microsoft/agents-hosting-extensions-msteams@1.9.1`), and adds signed inbound webhooks from external systems to deliver status notifications back to the original submitter. The implementation must preserve kernel IM-agnosticism by normalizing all Teams ingress/egress to `InboundEvent` and `OutboundMessage` from `packages/contract`, follow the existing Slack adapter pattern (raw body, <200ms ack, enqueue to consumer), implement replay protection (timestamp + nonce) for inbound webhooks, and retry notifications 3 times on IM delivery failure.

**Primary recommendation:** Create a Teams adapter mirroring the Slack adapter structure (controller + module), use Agents SDK's `AgentApplication` with `authorizeJWT(AuthConfiguration)` (SDK does not supply middleware), and add a separate `/webhooks/external/:connectorId` controller with HMAC signature verification on raw body + timestamp skew + nonce uniqueness using Redis. Notifications re-use the existing outbound delivery path and lookup submission→submitter via identity mapping.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Teams webhook ingestion | API / Backend | — | Agents SDK Express adapter receives activities; must normalize to `InboundEvent` and ack fast (<200ms). |
| Teams outbound delivery | Worker / Backend | API / Backend | Outbound `OutboundMessage` sent via Agents SDK; delivery failures retry via existing queue semantics. |
| Inbound external webhooks (NOT-01-05) | API / Backend | Worker / Backend | Signature/timestamp/nonce validated on raw body in controller; processing enqueued to consumer for business logic; notifications sent via IM outbound path. |
| Submission→submitter mapping | Domain / Backend | API / Backend | Need to find original `chat_user_id`, `platform`, `channel_id` for a `submission_id` to notify original submitter (NOT-03). Leverage `IdentityMappingRepository` and submission records. |
| Replay protection (nonces) | Cache (Redis) | API / Backend | Timestamp skew window + nonce uniqueness; store nonces in Redis with TTL = window to prevent reuse. |
| Notification retries (NOT-04) | Worker / Backend | Queue (BullMQ) | 3 attempts with backoff+jitter on IM delivery failure; failures beyond that logged/audited. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@microsoft/agents-hosting` | 1.9.1 | Agents SDK core | Official successor to retired Bot Framework; supports Teams via extensions. [CITED: https://learn.microsoft.com/microsoft-365/agents-sdk/] |
| `@microsoft/agents-hosting-express` | 1.9.1 | Express adapter for Agents SDK | Required to host Teams endpoints in our Express-based API (we use Express per STACK; Fastify rejected). [CITED: https://learn.microsoft.com/microsoft-365/agents-sdk/] |
| `@microsoft/agents-hosting-extensions-msteams` | 1.9.1 | Teams-specific extensions | Correct package (not deprecated `-extensions-teams`). [CITED: https://learn.microsoft.com/microsoft-365/agents-sdk/] |
| `jose` | 6.2.12 | JWT verification (Teams auth) | Already in stack; Agents SDK JWT auth via `authorizeJWT` uses JSON Web Tokens. [CITED: STACK §5] |
| `ioredis` | 6.0.0 | Nonce store, throttler storage | Already used; atomic ops for nonce check+set. [CITED: STACK §4.4] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `raw-body` | (via Nest `@RawBody()`) | Access raw request body | Required for HMAC signature verification before JSON parsing (D-09). Nest's `@RawBody()` preserves raw bytes. [CITED: NestJS docs on raw body] |
| Node `crypto` (built-in) | 24.x | HMAC-SHA256 computation | For webhook signature verification; no extra dependency. [VERIFIED: Node 24 built-in] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Agents SDK 1.9.1 + Express | Bot Framework SDK (retired) | Bot Framework SDK doesn't exist on npm and support ended 2025-12-31. Not viable. [CITED: STACK §7.3] |
| Custom nonce store in Redis (SET EX + NX) | MongoDB unique index on (nonce, window) | Redis atomic SET NX EX is efficient and TTL matches window; MongoDB possible but Redis already available and lower latency. Redis chosen for replay protection. [ASSUMED] |
| HMAC on raw body (header-based) | mTLS with connector certs | Some external systems can't do mTLS easily; signed webhook (HMAC) is common and matches NOT-01/NOT-05. mTLS is possible as alternative trust mechanism per connector (D-11). [ASSUMED] |

## Package Legitimacy Audit

> Required whenever this phase installs external packages.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@microsoft/agents-hosting` | npm | ~recent (v1.9.1 2026-09-29) | High (official MS package) | github.com/microsoft/Agents | OK | Approved |
| `@microsoft/agents-hosting-express` | npm | recent (2026-09-29) | High | github.com/microsoft/Agents | OK | Approved |
| `@microsoft/agents-hosting-extensions-msteams` | npm | recent (2026-09-29) | High | github.com/microsoft/Agents | OK | Approved |

**Packages removed due to [SLOP] verdict:** none  
**Packages flagged as suspicious [SUS]:** none

*All packages are official Microsoft packages with recent publish dates; no new untrusted deps introduced beyond those already approved in STACK.*

## Architecture Patterns

### Recommended Project Structure

```text
apps/api/src/
├── adapters/
│   ├── slack/           # existing (reference pattern)
│   │   ├── slack-webhook.controller.ts
│   │   ├── slack-commands.controller.ts
│   │   └── slack.module.ts
│   └── teams/           # NEW - Teams adapter
│       ├── teams.controller.ts        # Activities/webhook endpoint
│       ├── teams.outbound.service.ts  # Outbound delivery via Agents SDK
│       ├── teams.module.ts
│       └── teams-auth.guard.ts        # Optional JWT guard if needed
├── webhooks/            # NEW - Inbound external webhooks
│   └── external/
│       ├── external-webhook.controller.ts
│       ├── external-webhook.service.ts
│       ├── nonce-store.service.ts       # Redis nonce store
│       └── external-webhook.module.ts
└── ...
```

### Pattern 1: Teams Adapter (mirror Slack pattern)

**What:** Normalize Teams Activities to `InboundEvent`, enqueue to consumer, ack fast. Outbound via Agents SDK.

**When to use:** For all Teams ingress/egress. Keep all Teams types inside adapter module.

**Example:**
```typescript
// apps/api/src/adapters/teams/teams.controller.ts (sketch)
// Source: Microsoft Agents SDK docs
import { Controller, Post, RawBody, Req, Res } from '@nestjs/common';
import { AgentApplication, TurnContext } from '@microsoft/agents-hosting';
import { Request, Response } from 'express';

@Controller('teams')
export class TeamsController {
  constructor(private readonly agentApp: AgentApplication) {}

  @Post('events')
  async handleEvents(@Req() req: Request, @Res() res: Response, @RawBody() rawBody: Buffer) {
    // AgentApplication processes the activity
    await this.agentApp.processActivity(req, res);
  }
}
```

**Key points:**
- Use `AgentApplication` from `@microsoft/agents-hosting-express` wiring; register handlers that map Teams Activity → `InboundEvent`. [CITED: Agents SDK docs]
- Implement `authorizeJWT(AuthConfiguration)` for token validation (D-03). SDK does not supply middleware. [CITED: STACK §7.3]
- Thread continuity via conversation id (D-04); map Teams `conversation.id`, `from.id` → `channel_id`, `chat_user_id` (opaque). [ASSUMED]
- On message/activity, normalize to `InboundEvent` with `platform: 'teams'`, `queue` set, `attempt: 0`, ack by letting AgentApplication respond. Ensure processing enqueued (mirror Slack: <200ms). [CITED: IM-03, D-13]

### Pattern 2: Inbound External Webhooks (signed, replay-protected)

**What:** Authenticated inbound webhooks from external systems that map external entity ID → `submission_id`, with timestamp+nonce replay protection.

**When to use:** For status updates pushed from external systems (Redmine) back to original submitter (NOT-01-05).

**Example (signature verification sketch):**
```typescript
// apps/api/src/webhooks/external/external-webhook.controller.ts
import { Body, Controller, Headers, Param, Post, RawBody, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';

@Controller('webhooks/external')
export class ExternalWebhookController {
  @Post(':connectorId')
  async handle(
    @Param('connectorId') connectorId: string,
    @RawBody() rawBody: Buffer,
    @Headers('x-signature') sig: string | undefined,
    @Headers('x-timestamp') ts: string | undefined,
    @Headers('x-nonce') nonce: string | undefined,
    @Body() body: any
  ) {
    // 1. Validate signature on rawBody
    // 2. Check timestamp skew (e.g. ±300s)
    // 3. Check nonce uniqueness (Redis SET NX EX)
    // 4. Ack fast, enqueue processing
  }
}
```

**Verification steps:**
1. Compute HMAC-SHA256 of `rawBody` (or `${ts}.${nonce}.${rawBody}` depending on scheme; document header names in code per discretion). Use connector-scoped secret. [ASSUMED]
2. Constant-time comparison of signatures. [CITED: security best practice]
3. Reject if `|now - ts| > maxSkew` (e.g. 300s). [CITED: NOT-02]
4. `SET nonce value NX EX <window>` in Redis; if exists → reject (replay). [CITED: NOT-02]
5. Never log raw signature or full body with sensitive fields; respect log field allowlist. [CITED: D-15]

### Pattern 3: Notification to Original Submitter (thread-aware)

**What:** On valid inbound webhook, send notification to original submitter via IM with deep link bound to that user, thread-aware where supported.

**When to use:** After mapping external entity → `submission_id` and confirming it's a status change.

**Flow:**
1. Lookup submission by `submission_id` (from external mapping). Get `real_user_id` (submitter). [CITED: D-17]
2. Lookup `IdentityMapping` for `real_user_id` + platform (the platform the submission came from - e.g. slack/teams). Get `chat_user_id`, `channel_id` (conversation context). [CITED: D-17, IdentityMapping schema]
3. Build deep link bound to that user (reuse existing link machinery; do not invent new token class unless necessary). [CITED: discretion]
4. Create `OutboundMessage` with `action: 'status'`, `platform`, `channel_id`, `chat_user_id`, `text` with status + deep link. [CITED: D-18, OutboundActionSchema has `status`]
5. Enqueue outbound delivery job; on failure retry 3 times with backoff+jitter (NOT-04). [CITED: D-13]
6. Use OTel span continuity across enqueue/consume. [CITED: NFR-O-1]

### Anti-Patterns to Avoid

- **Leaking Teams types to kernel/domain**: Keep normalization in adapter; only `InboundEvent`/`OutboundMessage` cross boundaries. [CITED: D-01]
- **Validating signature after JSON parse**: Must use `@RawBody()` and verify on raw bytes before `@Body()` parsing. [CITED: D-09]
- **Enqueuing slow work in receiver**: Ack <200ms; all logic in consumer. [CITED: IM-03, D-14]
- **Logging sensitive data**: Never log signatures, nonces, full webhook bodies; respect allowlist. [CITED: D-15]
- **Using BullMQ jobId for idempotency of webhook processing**: Idempotency for platform event deliveries uses MongoDB unique index on platform event ID (IM-04). For inbound webhooks, consider idempotency key based on (connectorId, external id, event id) or similar. [CITED: IM-04]
- **Generic deep links**: Must be bound to the original submitter (NOT-03). [CITED: D-12]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Teams activity handling | Custom HTTP routing + JWT parsing | `@microsoft/agents-hosting` + Express adapter | Handles Activities, conversation state, auth flows correctly; reduces surface area and follows MS guidance. [CITED: Agents SDK] |
| Teams JWT auth | Custom middleware | `authorizeJWT(AuthConfiguration)` from Agents SDK | SDK provides validated token handling; implement per D-03. [CITED: STACK §7.3] |
| HMAC signature verification | Ad-hoc string compare | Node `crypto.timingSafeEqual` or constant-time compare | Prevents timing attacks. [ASSUMED] |
| Nonce replay protection | In-memory Set (will lose on restart/multi-pod) | Redis SET NX EX | Distributed-safe, auto-expires with TTL. [ASSUMED] |
| Backoff with jitter for retries | Simple linear backoff | Exponential backoff with jitter (BullMQ retry config or custom) | Align with existing retry semantics (Phase 5); reduces thundering herd. [CITED: D-13, NOT-04] |

## Runtime State Inventory

> Include this section for rename/refactor/migration phases only. Omit entirely for greenfield phases.

**Not applicable** - this is additive expansion (Teams adapter + new webhook endpoints), not rename/refactor/migration. No runtime state rename needed.

## Common Pitfalls

### Pitfall 1: Using deprecated Teams package
**What goes wrong:** Using `@microsoft/agents-hosting-extensions-teams` (deprecated) instead of `-msteams`.  
**Why it happens:** Similar naming; docs confusion.  
**How to avoid:** Install `@microsoft/agents-hosting-extensions-msteams@1.9.1` explicitly. [CITED: STACK §7.3]  
**Warning signs:** Deprecation warnings on install, or MS docs pointing to old package.

### Pitfall 2: Not validating on raw body for webhooks
**What goes wrong:** HMAC computed on parsed JSON body (re-serialized) differs from sender; or signature can be bypassed if body parsed before validation.  
**Why it happens:** Nest's default body parsing happens; forgetting `@RawBody()`.  
**How to avoid:** Use `@RawBody()` decorator for the webhook endpoint; validate signature first, reject early. [CITED: D-09]  
**Warning signs:** Intermittent signature failures, or accepting requests without validation.

### Pitfall 3: Teams adapter leaks types into kernel
**What goes wrong:** Domain/worker code becomes coupled to Teams SDK types, breaking IM-agnosticism.  
**Why it happens:** Eagerly importing Agents SDK types outside adapter module.  
**How to avoid:** Keep all Teams/Agents SDK types inside `apps/api/src/adapters/teams/*`; only map to `InboundEvent`/`OutboundMessage` at boundary. [CITED: D-01]  
**Warning signs:** New Teams imports in `packages/domain` or kernel.

### Pitfall 4: Missing replay protection
**What goes wrong:** Replay attacks on inbound webhooks (resending same event).  
**Why it happens:** Skipping timestamp check or nonce store.  
**How to avoid:** Enforce timestamp skew window + nonce uniqueness in Redis with TTL. Reject stale/duplicate. [CITED: NOT-02]  
**Warning signs:** Duplicate notifications sent to same submitter.

### Pitfall 5: Slow ack causes webhook timeouts
**What goes wrong:** Doing DB lookups/signature work in sync before ack; Slack/Teams may retry or timeout.  
**Why it happens:** Not enqueueing; doing all logic in controller.  
**How to avoid:** Validate quickly (sig/timestamp/nonce), then ack with appropriate response and enqueue processing job. Target <200ms. [CITED: IM-03, D-14]  
**Warning signs:** High p99 latency on webhook endpoints, or repeated retries from external systems.

## Code Examples

Verified patterns from existing codebase and official sources:

### Teams controller skeleton (Agents SDK + Nest)
```typescript
// Source: Microsoft Agents SDK docs (conceptual) + Slack pattern
import { Controller, Post, RawBody, Req, Res } from '@nestjs/common';
import { AgentApplication, TurnContext, MemoryStorage, AuthConfiguration } from '@microsoft/agents-hosting';
import { Request, Response } from 'express';

@Controller('teams')
export class TeamsController {
  private readonly agentApp: AgentApplication;

  constructor() {
    this.agentApp = new AgentApplication({
      storage: new MemoryStorage(),
      auth: new AuthConfiguration({
        // configure per environment
      }),
    });

    // Register activity handlers
    this.agentApp.onMessage(async (context: TurnContext) => {
      // Map Teams activity to InboundEvent and enqueue
    });
  }

  @Post('events')
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.agentApp.processActivity(req, res);
  }
}
```

### Inbound external webhook with replay protection
```typescript
// Source: Security best practices + NOT-02
import * as crypto from 'crypto';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';

function verifySignature(rawBody: Buffer, secret: string, providedSig: string): boolean {
  const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hmac, 'hex'),
      Buffer.from(providedSig.replace(/^sha256=/, ''), 'hex')
    );
  } catch {
    return false;
  }
}
```

### Nonce store (Redis SET NX EX)
```typescript
// Source: Redis SET NX EX pattern
async function checkAndStoreNonce(nonce: string, windowSeconds: number): Promise<boolean> {
  const key = `webhook:nonce:${nonce}`;
  const res = await redis.set(key, '1', 'EX', windowSeconds, 'NX');
  return res === 'OK';
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Bot Framework SDK (Node) | Microsoft 365 Agents SDK | Support ended 2025-12-31 | Bot Framework packages retired; Agents SDK is the supported path. Must use 1.9.1 + `-msteams`. [CITED: STACK §7.3] |
| Per-IP rate limiting | Per-user + per-link jti | Phase 1 decision (conflict ruling) | Rate limits must follow per-user/app model; blocks only on signature failure per AUD-10. [CITED: REQUIREMENTS.md conflict table] |
| Synchronous webhook processing | Ack <200ms + enqueue to consumer | IM-03, PROJECT constraints | Prevents timeouts and ensures resilience; all logic in worker. [CITED: Slack pattern] |

**Deprecated/outdated:**
- `botframework-sdk` — does not exist on npm; retired.
- `@microsoft/agents-hosting-extensions-teams` — deprecated by publisher; use `-msteams`.

## Assumptions Log

> List all claims tagged `[ASSUMED]` in this research. The planner and discuss-phase use this section to identify decisions that need user confirmation before execution.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Teams conversation/thread mapping: `conversation.id` and `from.id` map cleanly to `channel_id`/`chat_user_id` in opaque form; thread continuity uses conversation context. | Pattern 1 | MEDIUM - May need adjustment for group chats vs 1:1; could affect thread-aware replies (IM-11). |
| A2 | Header names for external webhook signature: `x-signature` (or `X-Signature`), `x-timestamp` (ISO8601 or epoch seconds), `x-nonce`. Scheme: HMAC-SHA256 of raw body; may need `sha256=` prefix or include timestamp/nonce in signed string. | Pattern 2 | MEDIUM - Different external systems use different schemes; connector config must be flexible. Per discretion; document per connector. |
| A3 | Timestamp skew window 300s (±5 min) is appropriate; nonce TTL = skew window * 2 or equal. | Pattern 2 | LOW - Security vs usability trade-off; 300s is common. |
| A4 | Notification deep link format: reuse existing read/link machinery; bound to specific user (not generic). Can be a signed read link or notification-specific deep link. | Pattern 3 | LOW - Reusing existing token classes reduces surface area; avoid new token class unless necessary. |
| A5 | External webhook processing idempotency: use composite key (connectorId, externalEntityId, eventId or delivery id) rather than BullMQ jobId. | Pattern 2 | LOW - Prevents duplicate processing on retries from external systems. |
| A6 | Redis SET NX EX is atomic and sufficient for nonce store across pods. | Don't Hand-Roll | LOW - ioredis supports this; correct choice for distributed replay protection. |
| A7 | Teams delivery retry semantics align with IM-05 (treat failures as retryable; respect platform hints). Beyond 429/502, research noted as open area. | Pitfalls/State of Art | MEDIUM - Need to confirm specific retry behavior from Teams/Agents SDK; may affect NOT-04 alignment. |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed.

## Open Questions (RESOLVED)

1. **Teams retry semantics beyond 429/502 (RESOLVED by 08-08-T1)**  
   - What we know: IM-05 requires treating unreachable IM platform as retryable; general guidance exists for HTTP 429/502.  
   - What's unclear: Agents SDK's activity delivery error handling and retry hints for Teams. Roadmap notes "Microsoft Teams activity-delivery retry semantics beyond 429/502 — research area called out in Phase 8 notes".  
   - Recommendation: During implementation (plan phase), test with mock failures and consult Agents SDK docs; align with existing BullMQ retry config (3 attempts for notifications per NOT-04; may differ for adapter-level retries).

2. **External webhook header/signature scheme per connector (NOT-05) (RESOLVED by 08-07-T1 and 08-08-T3)**  
   - What we know: Must support alternative trust mechanism for systems that can't sign. Common schemes: HMAC-SHA256 in `x-signature` of raw body; some use `t.nonce.body` concatenation.  
   - What's unclear: Exact scheme for Redmine (first external system) and how flexible connector config needs to be.  
   - Recommendation: Make signature verification strategy configurable per connector (e.g. `hmac-sha256-rawbody`, `hmac-sha256-ts-nonce-body`, `shared-secret-header`, or `ip-whitelist+mTLS` alternative). Record per connector (NOT-05).

3. **Deep link format and binding (RESOLVED by 08-07-T3)**  
   - What we know: Must be bound to original submitter (NOT-03); reuse existing link machinery.  
   - What's unclear: Is it a view/read link (already implemented) scoped to that user? Or notification-specific? Need to ensure link verification enforces user binding.  
   - Recommendation: Prefer reusing signed read/view links (LNK-05-06) — they already enforce permission and user binding. Generate link for that submission+user context.

4. **Teams AgentApplication auth configuration (RESOLVED by 08-06-T1)**  
   - What we know: Must call `authorizeJWT(AuthConfiguration)` (D-03); SDK doesn't supply middleware.  
   - What's unclear: Exact `AuthConfiguration` shape for Teams (clientId, tenantId, etc.) and how it integrates with Nest middleware.  
   - Recommendation: Follow MS Agents SDK auth guidance; implement as Nest guard/interceptor on `/teams/events` if needed, or configure in AgentApplication initialization.

## Environment Availability

> Skip this section if the phase has no external dependencies (code/config-only changes).

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Redis 8.x | Nonce store, throttler (existing) | ✓ (expected in dev/test) | ≥8.2 | — (required per stack) |
| MongoDB 8.0.x | Submission lookup, idempotency | ✓ (expected) | 8.0.x | — |
| Node 24.x | Runtime | ✓ | 24.x | — |

**Missing dependencies with no fallback:** none  
**Missing dependencies with fallback:** none

## Validation Architecture

> Skip this section entirely if workflow.nyquist_validation is explicitly set to false in .planning/config.json. If the key is absent, treat as enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 5.0.3 (matches stack) |
| Config file | vitest.config.* (existing) |
| Quick run command | `npx vitest run --maxWorkers=1` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IM-10 | Teams adapter normalizes to InboundEvent/OutboundMessage; delivers identical experience | integration/e2e | `npx vitest run apps/api/src/adapters/teams --maxWorkers=1` | ❌ Wave 0 (new) |
| NOT-01 | Signed inbound webhook maps external entity ID → submission_id | integration | `npx vitest run apps/api/src/webhooks/external --maxWorkers=1` | ❌ Wave 0 (new) |
| NOT-02 | Timestamp + nonce replay protection rejects stale/reused nonces | unit/integration | `npx vitest run apps/api/src/webhooks/external/nonce-store* apps/api/src/webhooks/external/*replay* --maxWorkers=1` | ❌ Wave 0 (new) |
| NOT-03 | Notification to original submitter with deep link bound to user; thread-aware where supported | integration | `npx vitest run apps/api/src/webhooks/external --maxWorkers=1` | ❌ Wave 0 (new) |
| NOT-04 | Notification delivery retries 3 times on IM delivery failure | integration | `npx vitest run apps/api/src/webhooks/external --maxWorkers=1` | ❌ Wave 0 (new) |
| NOT-05 | Alternative trust mechanism per connector documented and enforced | integration | `npx vitest run apps/api/src/webhooks/external --maxWorkers=1` | ❌ Wave 0 (new) |

### Sampling Rate

- **Per task commit:** `npx vitest run --maxWorkers=1` (focused on touched files)
- **Per wave merge:** `npx vitest run` (full suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `apps/api/src/adapters/teams/` — Teams controller, outbound service, module, auth
- [ ] `apps/api/src/webhooks/external/` — external webhook controller/service/nonce-store/module
- [ ] `packages/domain/src/identity/` or existing identity mapping access from API layer (may need DI wiring)
- [ ] Tests for Teams adapter normalization
- [ ] Tests for external webhook signature verification + replay protection + notification flow
- [ ] Tests for notification retry logic (3 attempts)
- [ ] Tests for alternative trust mechanism per connector

*(If no gaps: "None — existing test infrastructure covers all phase requirements")*

## Security Domain

> Required when `security_enforcement` is enabled (absent = enabled). Omit only if explicitly `false` in config.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Teams JWT via Agents SDK `authorizeJWT`; connector-scoped webhook secrets. |
| V3 Session Management | no | Stateless webhooks; no sessions for external callers. |
| V4 Access Control | yes | Webhook access scoped per connectorId; only valid signed requests processed. Notifications only to original submitter. |
| V5 Input Validation | yes | Zod validation at contract boundary (`InboundEvent`/`OutboundMessage`); raw body for signatures; reject early on bad sig/timestamp/nonce. |
| V6 Cryptography | yes | HMAC-SHA256 for webhook signatures; constant-time comparison; AES-256-GCM already used elsewhere; Teams uses TLS/JWT. |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Webhook replay | Tampering/Repudiation | Timestamp skew check + nonce uniqueness in Redis (SET NX EX) with TTL; reject stale/duplicate. [CITED: NOT-02] |
| Signature bypass | Spoofing | Verify on raw body before parsing; constant-time comparison; reject if missing/invalid. [CITED: D-09] |
| Timing attacks on HMAC | Information Disclosure | Use `crypto.timingSafeEqual`; compare buffers of same length. [ASSUMED] |
| Slowloris/timeout abuse on webhooks | Denial of Service | Ack <200ms, enqueue processing; rate limits per connector/app if needed (IM-06 covers receivers). |
| Leaking PII in logs | Information Disclosure | Respect log field allowlist; never log signatures, nonces, full webhook bodies with sensitive fields. [CITED: D-15] |
| Teams token forgery | Spoofing | Validate JWT via `authorizeJWT(AuthConfiguration)` before processing. [CITED: D-03] |

## Sources

### Primary (HIGH confidence)

- Microsoft 365 Agents SDK docs — Teams activity handling, `authorizeJWT`, Express adapter [CITED]
- NestJS docs — `@RawBody()` decorator for preserving raw request body [CITED]
- Redis docs — `SET key value [EX seconds] [PX milliseconds] [NX|XX]` for atomic check+set [CITED]
- Phase 8 CONTEXT.md — requirements (IM-10, NOT-01-05), decisions (D-01-20), canonical refs [VERIFIED: file read]

### Secondary (MEDIUM confidence)

- STACK.md §7.3 — Teams packages, deprecated `-extensions-teams`, JWT via `authorizeJWT` [VERIFIED: file read]
- REQUIREMENTS.md — IM/NOT requirements mapping to Phase 8 [VERIFIED: file read]
- Existing Slack adapter (`slack-webhook.controller.ts`, `slack.module.ts`) — pattern to mirror [VERIFIED: file read]

### Tertiary (LOW confidence)

- Teams retry semantics beyond 429/502 — open question noted in roadmap [ASSUMED; needs verification during implementation]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Packages verified in STACK; official MS packages with known versions.
- Architecture: HIGH - Clear mirroring of existing Slack adapter pattern; contracts already forward-compatible (teams in enum).
- Pitfalls: HIGH - Well-known webhook security pitfalls (replay, raw body validation) addressed.

**Research date:** 2026-10-19  
**Valid until:** 2026-11-18 (30 days) - Teams SDK is stable at 1.9.1; unlikely to change drastically in 30 days. External webhook security guidance is stable.
