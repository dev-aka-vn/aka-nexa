# Phase 03: Natural-Language Routing - Pattern Map

**Mapped:** 2026-10-07
**Files analyzed:** ~12 new/modified files (per 03-RESEARCH.md §Recommended Project Structure)
**Analogs found:** 9 / 12 (3 are new-surface stubs with only role-level ancestors)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/domain/src/decision/rule-based.provider.ts` | service (JevProvider impl) | transform | `packages/contract/src/jev/jev-provider.ts` (interface) + `jev-provider.spec.ts` stub | role-match |
| `packages/domain/src/decision/routing-orchestrator.ts` | service | request-response | `packages/domain/src/authz/permission-check.service.ts` | role-match |
| `packages/domain/src/decision/decision-cache.service.ts` | service | CRUD (Redis) | `packages/domain/src/authz/rbac-cache.service.ts` | exact |
| `packages/domain/src/decision/clarification-session.service.ts` | service | CRUD (Redis) | `packages/domain/src/authz/rbac-cache.service.ts` | role-match |
| `packages/domain/src/decision/published-app-loader.ts` | repository | CRUD | `packages/domain/src/identity/identity-mapping.repository.ts` | exact |
| `packages/domain/src/decision/redaction.ts` | utility | transform | none (no analog — free-text redaction is new) | none |
| `apps/worker/src/processors/inbound-event.processor.ts` | processor | event-driven (BullMQ) | `apps/worker/src/processors/platform-heartbeat.processor.ts` | role-match |
| `apps/worker/src/worker.module.ts` | config (Nest module) | — | `apps/worker/src/worker.module.ts` (existing) | exact (modify) |
| `packages/domain/src/decision/*.spec.ts` (conformance/routing/cache) | test | — | `packages/contract/src/jev/jev-provider.spec.ts`, `packages/platform/src/redis/redis.integration.spec.ts` | exact |
| `apps/worker/src/processors/inbound-event.processor.spec.ts` | test | — | `apps/worker/src/processors/platform-heartbeat.processor.spec.ts` | role-match |
| OTel stage spans (OBS-02) in processor | instrumentation | event-driven | `packages/platform/src/otel/span-attribute-allowlist.ts` + `otel.bootstrap.ts` | role-match |

## Pattern Assignments

### `packages/domain/src/decision/rule-based.provider.ts` (service, transform)

**Analog:** `packages/contract/src/jev/jev-provider.ts` (interface) and `packages/contract/src/jev/jev-provider.spec.ts` (satisfiability stub)

**Imports pattern** (from jev-provider.spec.ts lines 1-9):
```typescript
import { describe, expect, it } from 'vitest';
import {
  JevRequestSchema,
  JevResponseSchema,
  JEV_ABSTENTION_REQUIRES_CLARIFICATION,
  JEV_ABSTENTION_REQUIRES_NULL_CHOICE,
} from './v1/index.js';
import { JevProvider, RULE_BASED_PROVIDER_NAME } from './jev-provider.js';
```

**Core pattern** — implement the frozen seam directly, self-validate both boundaries:
```typescript
const stubProvider: JevProvider = {
  name: 'stub',
  spec_version: '1.0',
  capabilities: ['tool_selection', 'clarification', 'multi_turn'],
  async decide() {
    return JevResponseSchema.parse({
      spec_version: '1.0',
      request_id: 'req_01',
      choice: { tool_id: null, confidence: 0, verified: null },
      alternatives: [],
      clarification_needed: true,
      clarification_prompt: 'Which app did you mean?',
      provider: 'stub',
      latency_ms: 1,
    });
  },
  async healthCheck() {
    return { status: 'healthy', model_version: 'stub-0.0.0', ... };
  },
};
```

Interface contract (jev-provider.ts lines 36-62): `HealthStatus` shape, `JevProvider` (`name`, `spec_version`, `capabilities`, `decide`, `healthCheck`), terminal `RULE_BASED_PROVIDER_NAME` constant. Rule-based provider must validate input with `JevRequestSchema.parse` and output with `JevResponseSchema.parse` (see 03-RESEARCH.md §Code Examples for the full adapted skeleton, including negation guard and `verified === true` only on a sole match).

**Error handling:** no try/catch — invalid input fails via Zod `parse` and the orchestrator converts to clarification. Abstention uses the tri-state `verified: null` + `clarification_needed: true` (jev-response.ts lines 52-87, `refineAbstentionIsTotal`).

---

### `packages/domain/src/decision/routing-orchestrator.ts` (service, request-response)

**Analog:** `packages/domain/src/authz/permission-check.service.ts`

**Imports / DI pattern** (lines 1-10):
```typescript
import { Injectable } from '@nestjs/common';
import { RbacService } from './rbac.service.js';
import { RbacCacheService } from './rbac-cache.service.js';

@Injectable()
export class PermissionCheckService {
  constructor(
    private readonly rbac: RbacService,
    private readonly cache: RbacCacheService,
  ) {}
```

**Core pattern** — check cache/epoch first, delegate to the authoritative source, re-check at every hop:
```typescript
async check(app_id: string, real_user_id: string, permission: string, perm_version = 0): Promise<boolean> {
  const cached = await this.cache.get(app_id, real_user_id, perm_version);
  if (cached !== null) {
    return cached.includes(permission);
  }
  const has = await this.rbac.hasPermission(app_id, real_user_id, permission, perm_version);
  if (has) {
    const perms = await this.rbac.getPermissions(app_id, real_user_id);
    await this.cache.set(app_id, real_user_id, perm_version, perms);
  }
  return has;
}
```

Orchestrator additionally follows the gate from research §Pattern 1/Code Examples: `JevRequestSchema.safeParse` → provider chain with absolute `deadlineEpochMs = IM_receipt + 2000` → `JevResponseSchema.safeParse` → match `spec_version`/`request_id`/deadline → gate on `verified === true`, `!clarification_needed`, permitted `id`, confidence in threshold, no competing permitted alternative, `canOpenNow`, remaining budget. Any failure → worker-owned localized clarification template, never the provider's raw `clarification_prompt`.

---

### `packages/domain/src/decision/decision-cache.service.ts` (service, CRUD over Redis)

**Analog:** `packages/domain/src/authz/rbac-cache.service.ts`

**Core pattern** (lines 1-24):
```typescript
export class RbacCacheService {
  private cache = new Map<string, { permissions: string[]; expires: number }>();

  private key(app_id: string, real_user_id: string, perm_version: number) {
    return `ak:rbac:${app_id}:${real_user_id}:${perm_version}`;
  }

  async get(app_id: string, real_user_id: string, perm_version: number) {
    const k = this.key(app_id, real_user_id, perm_version);
    const v = this.cache.get(k);
    if (v && v.expires > Date.now()) return v.permissions;
    return null;
  }

  async set(app_id: string, real_user_id: string, perm_version: number, permissions: string[]) {
    const k = this.key(app_id, real_user_id, perm_version);
    this.cache.set(k, { permissions, expires: Date.now() + 60000 });
  }

  async invalidate(app_id: string, real_user_id: string, perm_version: number) { ... }
}
```

Difference: production implementation targets `REDIS_CACHE` ioredis client (`packages/platform/src/redis/redis.provider.ts` — `createRedisClient({url, profile: 'producer'})`, `lazyConnect`, no `keyPrefix`), not the in-memory Map. RTE-09 key shape: `` `jev:decision:${real_user_id}:${conversation_id}:${perm_epoch}:${pub_threshold_version}:${sha256(text|sortedToolIds|locale)}` `` via Node 24 `crypto.createHash`; configurable TTL; never log the plaintext or raw hash. A single-turn cache entry must never satisfy a multi-turn follow-up.

---

### `packages/domain/src/decision/clarification-session.service.ts` (service, CRUD/session)

**Analog:** `packages/domain/src/authz/rbac-cache.service.ts` (keying/TTL shape) + Redis provider wiring (`redis.provider.ts`)

Same key-prefix pattern (`ak:...` → e.g. `jev:clarify:${real_user_id}:${channel_id}:${thread_ts}`), TTL bounded by the longer of 2×2s routing budget and the thread-interaction window, ≤2 user replies before escalating to authorized examples + slash commands (D-51). Re-filter authorized tools on every reply (D-50). Stateless workers only — no in-process session map (AD-9, per research Anti-Pattern row).

---

### `packages/domain/src/decision/published-app-loader.ts` (repository, CRUD)

**Analog:** `packages/domain/src/identity/identity-mapping.repository.ts`

**Core pattern** (lines 1-39): plain class, interface for the record, async methods returning null-on-miss, no Mongoose model:
```typescript
export interface IdentityMapping {
  platform: string;
  chat_user_id: string;
  real_user_id: string;
  email?: string;
  deactivated_at?: Date | null;
}

export class IdentityMappingRepository {
  async findByChat(platform: string, chat_user_id: string): Promise<IdentityMapping | null> {
    const m = this.mappings.find((x) => x.platform === platform && x.chat_user_id === chat_user_id);
    if (!m) return null;
    if (m.deactivated_at) return null;
    return m;
  }
  ...
}
```

Load only **published** apps' declared intents/descriptions/aliases for **authorized** apps (D-52: a deprecated app gains no new triggers). Current placeholder is `packages/domain/src/registry/app.repository.ts` (`export class AppRepository {}`) — replace stub behind the same path or a new decision-local file, per Pitfall 5 (stubs are replaced, not wired over).

---

### `apps/worker/src/processors/inbound-event.processor.ts` (processor, event-driven BullMQ)

**Analog:** `apps/worker/src/processors/platform-heartbeat.processor.ts` (worker construction) and `inbound-event.processor.ts` itself (decorator shape)

**Decorator/skeleton** (current placeholder):
```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';

@Injectable()
@Processor('inbound-events')
export class InboundEventProcessor extends WorkerHost {
  async process(): Promise<any> {
    // Placeholder implementation for Plan 02-01
    return { ok: true };
  }
}
```

**Worker-construction discipline** (platform-heartbeat.processor.ts lines 38-125): `Worker` may only be built inside `apps/worker`; use `blockingConnectionOptions` + `BULLMQ_PREFIX`; build at `onApplicationBootstrap`, close in `onApplicationShutdown`, record `error` events instead of throwing; readiness reports `#lastError`. For the new processor, replace the placeholder body with: validate `InboundEventSchema` → branch on `action` (`slash_command` → Phase 2 deterministic path, JEV bypass — RTE-02) → identity → RBAC authorized candidate list → `JevRequest` → `RoutingOrchestrator` → gate → Phase 2 link issuer → Slack same-thread reply. Absolute deadline from `occurred_at`. Cache Redis from `REDIS_CACHE` token.

**OBS-02 stage spans:** fixed stage names `receive→identity→rbac→decision→link→form→submit→route→respond`; attributes only from the frozen allowlist (`packages/platform/src/otel/span-attribute-allowlist.ts` lines 49-91 — `app_id`, `form_id`, `action`, `attempt`, `messaging.*`, `duration_ms`); never `submission_id`, `user_email`, raw question text (FORBIDDEN_SPAN_ATTRIBUTES lines 105-113).

**Event envelope** (`packages/contract/src/events/inbound-event.ts` lines 27-66): `.strict()` Zod, `action: 'message' | 'slash_command' | 'interaction' | 'event'`, opaque IDs, `occurred_at` ISO-8601 for deadline base.

---

### `packages/domain/src/decision/*.spec.ts` and integration specs (test)

**Analog:** `packages/contract/src/jev/jev-provider.spec.ts` (unit) and `packages/platform/src/redis/redis.integration.spec.ts` (testcontainers)

**Unit spec skeleton:**
```typescript
import { describe, expect, it } from 'vitest';
```
Self-contained stub providers satisfying `JevProvider`; assert abstention tokens (`JEV_ABSTENTION_REQUIRES_CLARIFICATION`, `JEV_ABSTENTION_REQUIRES_NULL_CHOICE`) and never-routable-on-`verified:false` gate.

**Integration spec skeleton** (redis.integration.spec.ts lines 1-50):
```typescript
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startThreeContainers, type ThreeContainers } from '../../../../tooling/containers.js';

describe('...', () => {
  let containers: ThreeContainers;
  beforeAll(async () => { containers = await startThreeContainers(); }, 300_000);
  afterAll(async () => { await containers?.stop(); }, 300_000);
});
```
Decision-cache integration spec (RTE-09) uses the same `tooling/containers.ts` harness against a real Redis with the cache policy (`allkeys-lru`). Conformance spec (RTE-11) runs the labelled ≥50-intent fixture set from `packages/domain/src/decision/fixtures/` against every registered provider, with Wilson intervals per app.

**Worker processor spec analog:** `apps/worker/src/processors/platform-heartbeat.processor.spec.ts` — asserts worker options/prefix; the new `inbound-event.processor.spec.ts` asserts the slash-bypass (RTE-02) and wiring.

---

### `apps/worker/src/worker.module.ts` (config, modify)

**Analog:** existing file (lines 1-7):
```typescript
import { Module } from '@nestjs/common';
import { InboundEventProcessor } from './processors/inbound-event.processor.js';

@Module({
  providers: [InboundEventProcessor],
})
export class WorkerModule {}
```
Extend `providers` with the decision services + registry token wiring; boundary element type `decision` already declared in `tooling/boundaries.config.mjs` lines 38-52.

## Shared Patterns

### Frozen JEV validation at both boundaries
**Source:** `packages/contract/src/jev/v1/jev-request.ts`, `jev-response.ts`, `jev-provider.spec.ts`
**Apply to:** `rule-based.provider.ts`, `routing-orchestrator.ts`, every conformance/unit spec
```typescript
const parsedReq = JevRequestSchema.safeParse(draft);
if (!parsedReq.success) return clarify();
...
const parsedRes = JevResponseSchema.safeParse(decision);
```
Never edit the v1 schemas or `jev-v1.frozen.spec.ts`.

### Worker-side thread clarification, worker-owned copy
**Source:** 03-RESEARCH.md Anti-Patterns + D-48…D-63
**Apply to:** `routing-orchestrator.ts`, `clarification-session.service.ts`, processor reply path
Every displayed alternative ID re-passes fresh RBAC + `canOpenNow`; templates are localized (en/vi) and live in the worker, never relay provider `clarification_prompt` raw; ≤2 replies then authorized examples/slash commands.

### Deadline as absolute epoch
**Source:** 03-RESEARCH.md Pattern 2 / Pitfall 2
**Apply to:** processor, orchestrator, any future hosted adapter (`AbortSignal.timeout(remaining)`)
`deadlineEpochMs = IM_receipt + 2000` once; never a fresh 2000ms per provider.

### PII-free telemetry
**Source:** `packages/platform/src/otel/span-attribute-allowlist.ts`, `packages/platform/src/logging/log-allowlist.ts`
**Apply to:** processor stage spans, routing event logs
Fixed stage names, enum reasons, opaque IDs; never free text, never provider payloads, never unredacted turns (D-57, D-18).

### Cache/session on cache Redis, queue on queue Redis
**Source:** `packages/platform/src/redis/redis.provider.ts` (lines 54-79: `REDIS_CACHE` vs `REDIS_QUEUE`, producer vs blocking profile, `lazyConnect`, no shared `keyPrefix`)
**Apply to:** `decision-cache.service.ts`, `clarification-session.service.ts`, provider-health probe store

### Boundary enforcement via eslint-plugin-boundaries
**Source:** `tooling/boundaries.config.mjs` lines 38-52
**Apply to:** all new `packages/domain/src/decision/**` files importing only `contract`, `platform`, `domain` siblings through declared rules.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/domain/src/decision/redaction.ts` | utility | transform | No existing free-text PII redaction code; D-57 best-effort strip + deny-by-default is new. Implement minimally (email/phone/employee-ID patterns) with an uncertainty→skip-hosted fail-safe. |
| `packages/domain/src/decision/published-app-loader.ts` (Phase 2 dependency) | repository | CRUD | `app.repository.ts` is a stub; the authorized-candidate list API is a Phase 2 verification handoff — plan must gate on it (Pitfall 5). |
| `packages/domain/src/decision/routing-orchestrator.ts` chain/health/deadline superstructure | service | request-response | `PermissionCheckService` is the closest structural analog but no existing provider-chain/deadline/health-probe service exists; compose per RESEARCH.md §§Pattern 2, Pattern 4. |

## Metadata

**Analog search scope:** `packages/contract/src`, `packages/domain/src`, `packages/platform/src`, `apps/worker/src`, `tooling/`
**Files scanned:** ~20 (jev v1 contract + specs, authz services, identity repo, redis provider + integration spec, otel allowlist, inbound event, heartbeat processor + module, boundaries config, config schema, worker module)
**Pattern extraction date:** 2026-10-07
