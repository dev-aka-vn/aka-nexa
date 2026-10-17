# Phase 5: Integration & Async Execution - Pattern Map

**Mapped:** 2026-10-09
**Files analyzed:** 30 (18 new, 12 modified/extended) + Wave-0 tests
**Analogs found:** 22 strong / 30 (8 have no close analog — see §No Analog Found)

> All analog paths below are **git-tracked source** (verified with `git ls-files --`; every
> path printed non-empty). No gitignored mirror paths are referenced.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/contract/src/connector/connector.ts` (EVOLVE, D-89) | contract | request-response | itself + `packages/contract/src/links/read-link-claims.ts` | exact (self) |
| `packages/domain/src/connectors/rest-core.ts` | service | request-response | *(none in src — adapters/ empty)* | none |
| `packages/domain/src/connectors/redmine.adapter.ts` | adapter | request-response / transform | `packages/domain/src/decision/rule-based.provider.ts` (transform) | partial |
| `packages/domain/src/connectors/connector.registry.ts` | service/provider | CRUD | `packages/domain/src/decision/provider-registry.ts` | role-match |
| `packages/domain/src/connectors/data-access/connector-credentials.repository.ts` | repository | CRUD | `packages/domain/src/submissions/submission.repository.ts` + `platform/src/crypto/envelope.ts` | role+data-match |
| `packages/domain/src/connectors/data-access/outbound-state.repository.ts` | repository | CRUD | `packages/domain/src/submissions/submission.repository.ts` | role-match |
| `packages/domain/src/connectors/connectors.module.ts` | module | — | `apps/api/src/read/read.module.ts` | role-match |
| `packages/domain/src/datarouter/data-router.service.ts` | service | batch / event-driven | `packages/domain/src/dsl/dsl.service.ts` (+ RESEARCH skeleton) | partial |
| `packages/domain/src/datarouter/data-access/outbox.repository.ts` | repository | CRUD | `packages/domain/src/submissions/submission.repository.ts` | role-match |
| `packages/domain/src/datarouter/datarouter.module.ts` | module | — | `apps/api/src/read/read.module.ts` | role-match |
| `packages/domain/src/submissions/data-access/submission-revisions.repository.ts` | repository | CRUD (append-only) | `submission.repository.ts` + `audit/audit.repository.ts` | role+data-match |
| `packages/cli/connector.ts` (NEW) | CLI/utility | batch | *(stub `packages/cli/provision.ts`)* | none |
| `packages/cli/dlq.ts` (NEW) | CLI/utility | batch | *(same — no CLI pattern in repo)* | none |
| `packages/cli/rebind.ts` (NEW) | CLI/utility | batch | *(same)* | none |
| `apps/worker/src/processors/outbox-relay.processor.ts` | processor | event-driven | `apps/worker/src/processors/platform-heartbeat.processor.ts` | role+data-match |
| `apps/worker/src/processors/connector-delivery.processor.ts` | processor | event-driven | `apps/worker/src/processors/inbound-event.processor.ts` | role+data-match |
| `apps/scheduler/src/reconciliation.registration.ts` | registration | batch | `apps/scheduler/src/app.module.ts` + `platform/src/queue/platform-heartbeat.job.ts` | exact (mechanism) |
| `apps/api/src/read/read.controller.ts` (EXTEND, DAT-14/D-93) | controller | request-response | itself (`query` action) | exact (self) |
| `apps/api/src/read/read.module.ts` (EXTEND) | module | — | itself | exact (self) |
| `apps/api/src/common/throttler/throttler-storage-redis.ts` (REPLACE stub) | utility | request-response | itself (stub shape) + `platform/src/redis/redis.provider.ts` | role-match |
| `apps/api/src/submissions/submissions.controller.ts` (EXTEND) | controller | request-response | `apps/api/src/read/read.controller.ts` | role-match |
| `packages/platform/src/metrics/business-metrics.ts` (EXTEND, OBS-04/CON-06) | config | — | itself + `apps/api/src/common/metrics/read-deny.metrics.ts` | exact (self) |
| `config/connectors/redmine.<env>.json` (NEW seed) | config | — | `packages/domain/src/seeds/saved-queries.seed.json` | role-match |
| `tooling/boundaries.config.mjs` (MODIFY, CON-01) | config | — | itself | exact (self) |
| `apps/renderer/src/read/*.ts` + edit page (EXTEND, LNK-02) | component | request-response | `apps/renderer/src/read/view.ts` / `view.browser.ts` / `prefill.ts` | role-match |
| `packages/renderer` manifest (ADD `@formio/js@5.6.1`) | config | — | `apps/renderer/src/read/view.browser.ts:1` (already imports it) | exact |
| Wave-0 integration specs (12 files, RESEARCH §Validation) | test | integration | `packages/platform/src/queue/queue.integration.spec.ts` + `tooling/containers.ts` | role-match |

---

## Pattern Assignments

### `packages/contract/src/connector/connector.ts` (contract, EVOLVE — D-89)

**Analog:** itself (`packages/contract/src/connector/connector.ts`) + the frozen-contract discipline in `packages/contract/src/links/read-link-claims.ts`.

**Contract discipline to copy** (present at `connector.ts:1-47`) — Zod `.strict()` + a docblock that states *why each field is required*, then `z.infer` for the type:

```typescript
import { z } from 'zod';

export const ConnectorDescriptorSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    supports_idempotency_key: z.boolean(),   // required, never absent (DAT-13)
  })
  .strict();
export type ConnectorDescriptor = z.infer<typeof ConnectorDescriptorSchema>;
```

**The seam D-89 grows** (present at `connector.ts:54-85`): `ConnectorExecuteInput` (`submissionId`, `appId`, `formId`, `idempotencyKey: string | null`, `data`) and `ConnectorExecuteOutcome.status` (`'succeeded' | 'rejected' | 'failed_transient' | 'failed_permanent'`). D-89 adds `testConnection()`, `getCapabilities()`, and widens `execute(operation, payload, context)`. Keep the existing rule from `connector.ts:79-83`: **the connector does exactly one attempt; retry/backoff/DLQ belong to BullMQ.**

**Frozen-vs-versioned distinction** to preserve (`packages/contract/src/index.ts:15-25`): `connector/` and `events/` are ordinary versioned contracts — `.strict()` but **no** key-set freeze test. Do not add a key-set test here; adding a descriptor field must not invalidate a deployed connector.

---

### `packages/domain/src/connectors/rest-core.ts` (service, request-response)

**Analog:** none in `packages/domain/src/` (the `adapters/` dir is `.gitkeep` only). Use the RESEARCH code example (05-RESEARCH.md §Code Examples "Redmine create") plus the platform module shape below.

**Module shape to mirror** (`packages/platform/src/queue/queue.provider.ts:1-51`): a **pure, dependency-injected-at-call-site** module — no Nest decorators, no I/O at import, narrow structural types. This is how a transport core should be written so it is testable with `msw`/`undici` mock and needs no container:

```typescript
// narrow structural seam, not a concrete client import at module scope
export function producerConnectionOptions(queueUrl: string): QueueConnectionOptions { … }
```

**The outbound call shape** (RESEARCH §Code Examples) — single `undici`/global-`fetch` path (instrumented; STACK §12 forbids axios):

```typescript
const resp = await core.request({
  method: 'POST',
  url: `${baseUrl}/issues.json`,
  headers: { 'Content-Type': 'application/json' },   // R1: MUST be application/json
  credential: { header: 'X-Redmine-API-Key', value: decryptedKey },
  body: { issue: mappedIssueHash },                  // R2 attribute set
});
```

**Error handling:** map transport failures to the taxonomy **before** returning — `endpoint_unreachable` (5xx/timeout/network) vs `credential_rejected` (401/403/412). Never log the credential or raw body (see §Shared → Redaction).

**SSRF guard (Security §):** `base_url` is operator-seeded, never user-supplied — validate/allowlist at this core.

---

### `packages/domain/src/connectors/redmine.adapter.ts` (adapter, transform)

**Analog:** `packages/domain/src/decision/rule-based.provider.ts` (pure transform: input → mapped output, no I/O of its own) — role-match on "pure mapping function component".

**The three responsibilities (D-90):** endpoint paths, `{{form.field}}` / `{{real_user.attribute}}` mapping, and HTTP-status → taxonomy. Classify mapping errors as **`failed_permanent` BEFORE transport** (Pitfall 5).

**Natural-key pre-check (DAT-13 / D-84)** (RESEARCH §Code Examples):

```typescript
const found = await core.request({
  method: 'GET',
  url: `${baseUrl}/issues.json`,
  credential: { header: 'X-Redmine-API-Key', value: decryptedKey },
  query: { [`cf_${correlationCfId}`]: `${submission_id}:${revision}` },
});
// found.issues.length > 0 → already landed → confirmed; else safe to (re)send
```

Desired-field-mapping reference table is RESEARCH §R2; taxonomy table is RESEARCH §R4 (401/403/412 → `credential_rejected`; 422/404-on-create/406 → permanent; 5xx/timeout/network → `endpoint_unreachable`; **no 429**).

---

### `packages/domain/src/connectors/connector.registry.ts` (service, registry)

**Analog:** `packages/domain/src/decision/provider-registry.ts` — the registry pattern (construct one map from a single authoritative source, expose a resolution method that fails closed).

**Domain-service shape** (`packages/domain/src/dsl/dsl.service.ts:15-45`) — a small `@Injectable()` with one public resolution method and a private deps constructor:

```typescript
import { Injectable } from '@nestjs/common';

@Injectable()
export class DslService {
  compile(json: unknown, ctx: QueryCtx): DslCompileResult {
    const parsed = parseQueryDsl(json);
    if (!parsed.ok) return { ok: false, issues: parsed.issues };
    return { ok: true, query: compileQuery(parsed.dsl, ctx) };
  }
}
```

Resolve `connector_ref` → adapter + descriptor; unknown ref **fails closed** (return/throw a named error), mirroring the fail-closed style above.

---

### `packages/domain/src/connectors/data-access/connector-credentials.repository.ts` (repository, CRUD)

**Analog:** `packages/domain/src/submissions/submission.repository.ts` (repository shape) **plus** the envelope/`KeyProvider` store it reuses.

**Repository skeleton** (`submission.repository.ts:90-113`) — a constructor-injected dependency, private collection handle, explicit insert/read methods, and a class docblock recording the invariant:

```typescript
export class SubmissionRepository {
  private readonly submissions = new Map<string, Submission>();

  constructor(private readonly dsl: DslService) {}

  upsert(submission: Submission): void {
    this.submissions.set(submission._id, submission);
  }
```

> **R3 discipline (mandatory):** the `mongodb` specifier is allowed only under `packages/platform/src/mongo/**` and `packages/domain/src/**/data-access/**` (`tooling/boundaries.config.mjs:384-397`). Any new repository that imports the driver **must** live under a `data-access/` subdirectory. The RESEARCH `Recommended Project Structure` names `connectors/connector-credentials.repository.ts` directly under `connectors/`; the planner must relocate it to `connectors/data-access/` (and likewise the datarouter outbox and the submissions revisions repositories) or R3 fails the build.

**Credential crypto — reuse, never hand-roll** (`packages/platform/src/crypto/envelope.ts:118-157`, `169-219`): seal with `encryptSecret(plaintext, keyProvider)` → five-field `SecretEnvelope` `{v, alg, kid, iv, tag, ct}`; open with `decryptSecret(envelope, keyProvider)`. The auth tag is stored **and verified**; the nonce is a fresh `randomBytes(12)` per encryption. Store the envelope in `connector_credentials` keyed by `credential_ref`.

**Provider injection** (`packages/platform/src/crypto/crypto.module.ts:186-194`): inject the `CRYPTO_KEY_PROVIDER` token (`Symbol('CRYPTO_KEY_PROVIDER')`, `key-provider.ts:39`); `CryptoModule` already runs the FND-10 production guard. Do **not** construct a provider locally.

---

### `packages/domain/src/connectors/data-access/outbound-state.repository.ts` (repository, CRUD)

**Analog:** `packages/domain/src/submissions/submission.repository.ts`.

**The state axis** to store per revision: exactly `not_sent | sent_unconfirmed | confirmed` (D-96). Do **not** put these on `Submission.status` — that enum is `completed | partial | failed | pending_external` (`submission.repository.ts:24`). The load-bearing update shape (RESEARCH §Code Examples):

```typescript
await submissionRevisions.update(
  { submission_id, revision },
  { $set: { outbound: 'sent_unconfirmed' } },   // BEFORE the call (DAT-06)
);
```

Guard every read with `if (rec.outbound !== 'not_sent') return;` (DAT-07: never auto-resend `sent_unconfirmed`).

---

### `packages/domain/src/datarouter/data-router.service.ts` (service, batch/event-driven)

**Analog:** `packages/domain/src/dsl/dsl.service.ts` (service shape) — plus the RESEARCH §Pattern 1 transaction skeleton (this is the phase's core ordering).

**Transaction pattern (CON-10)** — one Mongo session, both writes commit or neither:

```typescript
await session.withTransaction(async () => {
  revision = await submissionRevisions.insert(
    { ...sub, outbound: 'not_sent' as const }, { session },
  );
  await outbox.insert(
    { revisionRef: { submission_id: sub.submission_id, revision: revision.revision },
      connectorRef: sub.connector_ref, payload: buildPayload(sub), published: false },
    { session },
  );
});
return revision!;   // caller returns 201/202 only after this resolves
```

**Mongo handle** (`packages/platform/src/mongo/mongo.service.ts:85-115`): inject `MongoService`; use `mongo.client` for `startSession()`/`withTransaction` and `mongo.db()` for collections. The client is exposed precisely "so repositories can reach driver features (sessions, transactions) the service does not wrap" (`mongo.service.ts:86-88`). A replica set is required (test harness starts `rs0`).

**Mode decision (DAT-01):** `internal` → synchronous write only; `hybrid` → transaction + enqueue; `external` → enqueue only.

---

### `packages/domain/src/submissions/data-access/submission-revisions.repository.ts` (repository, append-only CRUD)

**Analog:** `submission.repository.ts` (shape) + `packages/domain/src/audit/audit.repository.ts` (append-only discipline).

**Append-only rule to copy** (`audit/audit.repository.ts:13-33`): provide **only** append + read methods; no update/delete. The class comment enforces the invariant structurally:

```typescript
export class AuditRepository {
  async append(entry: AuditEntry): Promise<void> { … }
  async findAll(): Promise<AuditEntry[]> { … }
  // AUD-01: append-only - no update or delete operations
  // This is enforced structurally by not providing update/delete methods
}
```

Key `{submission_id, revision}` (D-94); submission points to latest; outbound state lives here.

---

### `packages/domain/src/{connectors,datarouter}/*.module.ts` (modules)

**Analog:** `apps/api/src/read/read.module.ts` (the one worked example of a Nest module with `useFactory` providers + injected seams) and `packages/platform/src/crypto/crypto.module.ts` (exporting a token).

**Module shape** (`read.module.ts:104-153`): providers wired with explicit `inject` seams; a token exported for cross-module use:

```typescript
@Module({
  controllers: [ReadController],
  providers: [
    { provide: 'READ_LINK_JWT_VERIFIER',
      useFactory: (config: ReadLinkConfig) => new ReadLinkJwtVerifierImpl(...),
      inject: [{ token: 'READ_LINK_CONFIG', optional: false }] },
    PermissionCheckService, RbacService, DslService, SubmissionRepository,
  ],
})
export class ReadModule {}
```

**Cross-boundary seam pattern** (`packages/domain/src/links/read-verifier.service.ts:21-78`): when a domain element cannot import another element's type (boundary edge absent), declare a **local structural interface** (`SubmissionLookup`, `SavedQueryLookup`, `ReadLinkJwtVerifier`) and let the app module supply the concrete implementation. `datarouter` and `connectors` must use this same technique rather than importing each other's modules.

---

### `apps/worker/src/processors/outbox-relay.processor.ts` (processor, event-driven)

**Analog:** `apps/worker/src/processors/platform-heartbeat.processor.ts` — the canonical BullMQ `Worker` lifecycle (the **only** place a `Worker` may be constructed; R1).

**Lifecycle pattern to copy** (`platform-heartbeat.processor.ts:75-146`):

```typescript
@Injectable()
export class PlatformHeartbeatProcessor
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  #worker: Worker | undefined;
  constructor(config: ConfigService) { this.#queueUrl = config.getOrThrow('REDIS_QUEUE_URL'); }

  async onApplicationBootstrap() {
    this.#worker = new Worker(id, async () => processX(), {
      connection: blockingConnectionOptions(this.#queueUrl),
      prefix: BULLMQ_PREFIX,                       // ← missing prefix = silent dead consumer
    });
    this.#worker.on('error', (e) => { this.#lastError = e; });   // never let an error event throw
  }
  async onApplicationShutdown() { await this.#worker?.close(); }
  isRunning(): boolean { return this.#worker?.isRunning() ?? false; }
}
```

**Registration wiring** (`platform-heartbeat.processor.ts:165-171`): export a `WORKER_CONSUMERS` provider and append one line to `apps/worker/src/app.module.ts` (`app.module.ts:75-94`). The readiness check `workerListeningIndicator(workers)` gets stricter automatically (D-10).

**Relay body (CON-10 relay):** poll outbox rows where `published: false` → `queue.add(name, data, { jobId: '${submission_id}:${revision}' })` → mark published. Never publish inside the webhook receiver (PROJECT constraint).

---

### `apps/worker/src/processors/connector-delivery.processor.ts` (processor, event-driven)

**Analog:** `apps/worker/src/processors/inbound-event.processor.ts` — `@Processor(...)` + `WorkerHost`, `process(job)`, Zod-validate `job.data` first, then branch.

**Job-processing pattern to copy** (`inbound-event.processor.ts:46-68`):

```typescript
@Injectable()
@Processor('inbound-events')
export class InboundEventProcessor extends WorkerHost {
  constructor(private readonly identity: IdentityService, ... ) { super(); }

  async process(job: Job): Promise<ProcessorOutcome> {
    const parsed = InboundEventSchema.safeParse(job.data);
    if (!parsed.success) return { kind: 'skipped', reason: 'invalid_event' };
    ...
  }
}
```

**The three-state ordering (DAT-06)** — commit `sent_unconfirmed` **before** the transport call, advance to `confirmed` on 2xx, leave ambiguous on error (RESEARCH §Code Examples):

```typescript
const rec = await submissionRevisions.find({ submission_id, revision });
if (rec.outbound !== 'not_sent') return;               // DAT-07 guard
await submissionRevisions.update({ submission_id, revision },
  { $set: { outbound: 'sent_unconfirmed' } });          // (a) BEFORE the call
const outcome = await connector.execute(rec.operation, buildPayload(rec), {
  idempotencyKey: `${submission_id}:${revision}`,       // D-92 composite
  correlationField: redmineCorrelationField,
});
if (outcome.status === 'ok') { /* advance to confirmed + downstreamRef */ }
```

**Retry/backoff/DLQ** is BullMQ job options, not code (CON-03): `{ attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnFail: false }`; the failed set is the DLQ.

---

### `apps/scheduler/src/reconciliation.registration.ts` (registration, batch — DAT-07)

**Analog:** `apps/scheduler/src/app.module.ts:106-114` + `packages/platform/src/queue/platform-heartbeat.job.ts:48-57`.

**Idempotent registration pattern (copy verbatim in shape):**

```typescript
export async function registerPlatformHeartbeat(queue: JobSchedulerTarget): Promise<RegisteredJob> {
  return registerJobScheduler(
    queue, PLATFORM_HEARTBEAT_ID,
    { every: PLATFORM_HEARTBEAT_EVERY_MS },
    { name: PLATFORM_HEARTBEAT_ID },
  );
}
```

Add the reconciliation scheduler the same way; wire it in `apps/scheduler/src/app.module.ts` `onApplicationBootstrap` (`app.module.ts:112-114`) and register its id in `JOB_SCHEDULER_REGISTRATIONS` (`app.module.ts:80-83`). **BullMQ 6:** use `upsertJobScheduler`; `resume()` is async (`packages/platform/src/queue/job-scheduler.ts:117-121`). The sweep query is `{ outbound: 'not_sent' }` only — never `sent_unconfirmed` (Pitfall 2).

---

### `apps/api/src/read/read.controller.ts` + `read.module.ts` (EXTEND — DAT-14, D-80, D-93, D-95)

**Analog:** itself — the status surface is a new path on the **same** controller/module, reusing the frozen `query` action.

**Controller pattern to extend** (`read.controller.ts:76-114`): verify → branch → on denial redirect to dead-link; the `query` path already calls `queryWithDsl` with the auto-injected ownership ctx:

```typescript
const result: ReadVerifyResult = await this.verifier.verify(token);
const queryResult = await this.submissions.queryWithDsl(
  result.savedQuery?.dsl ?? {},
  { viewerId: result.claims.sub, hasViewAll: false, appId: result.claims.app_id },
);
res.status(200).json({ claims: result.claims, savedQuery: ..., result: ... });
```

**Verifier to mirror for edit issuance (D-93)** (`packages/domain/src/links/read-verifier.service.ts:138-266`): verify signature → `ReadLinkClaimsSchema.safeParse` → branch on `action` → `findByIdOwned(targetId, claims.sub)` (D-79 owner-only) → live `permissionCheck.check(app_id, sub, perm, claims.perm_version)` (LNK-06). The **consumed-token branch (D-95)** goes where the action switch is (`read-verifier.service.ts:159-168`): `create` → "already submitted"; `edit` → idempotent replay of the original confirmation.

**Module wiring to extend** (`read.module.ts:104-153`): add the status/edit providers alongside the existing ones; inject the domain seams (`SubmissionLookup`, `SavedQueryLookup`) the same way.

**Ownership filter (D-80)** comes free from `SubmissionRepository.queryWithDsl` (`submission.repository.ts:141-171`), which roots the compiled filter under `{app_id}` and gets `{real_user_id, deleted_at: null}` injected by the compiler (DAT-11).

---

### `apps/api/src/common/throttler/throttler-storage-redis.ts` (REPLACE stub — CON-05)

**Analog:** itself (`throttler-storage-redis.ts:1-22`) for the interface; `packages/platform/src/redis/redis.provider.ts` for the real ioredis connection.

**The stub to replace** (it is an in-memory `Map`, not Redis — Pitfall 3):

```typescript
export interface ThrottlerStorage {
  increment(key: string, ttl: number): Promise<{ totalHits: number; timeToExpire: number }>;
}
export class ThrottlerStorageRedis implements ThrottlerStorage {
  private storage = new Map<...>();   // ← must become real Redis (shared api↔worker)
```

Reuse the existing ioredis connection (`REDIS_CACHE` provider). Key on the **connector instance**, not `app_id`/user (CON-05). Both community storages are dead — hand-write it (STACK §8.2).

---

### `packages/platform/src/metrics/business-metrics.ts` (EXTEND — OBS-04, CON-06)

**Analog:** itself (`business-metrics.ts:72-85`) + `apps/api/src/common/metrics/read-deny.metrics.ts` (the worked example of a labelled instrument on the same meter).

**Instrument-registration pattern** (`read-deny.metrics.ts:56-69`) — memoised, single meter, attributed counters:

```typescript
const meter = metrics.getMeter(METER_NAME);              // METER_NAME = 'akane'
const denials: Counter = meter.createCounter(READ_LINK_DENIALS_METRIC, { description: '…' });
cached = Object.freeze({
  recordDenial: (reason, action) => { denials.add(1, { reason, action }); },
});
```

Add `submission_status` (with a `status` attribute; `partial` is the required series) and the connector counter with an `app_id` **attribute** and a taxonomy-code attribute. **One meter only** — no second registry, no `prom-client` (STACK §6). Memoise; obtain the meter per call, never at import (D-20).

---

### `config/connectors/redmine.<env>.json` (seed — D-83/D-86)

**Analog:** `packages/domain/src/seeds/saved-queries.seed.json` (a committed JSON, validated by a colocated spec) and its spec `packages/domain/src/seeds/saved-queries.seed.spec.ts`.

Seed shape carries `base_url`, `credential_ref`, `timeout`, `retry`, rate limit, and the mapping/taxonomy config. Committed files are the source of truth (D-86); the idempotent loader detects the diff and writes the AUD-01 before→after transition.

---

### `apps/renderer/src/read/*` + edit page (EXTEND — LNK-02)

**Analog:** `apps/renderer/src/read/view.ts`, `view.browser.ts`, `prefill.ts`.

**Render/verify pattern** (`view.browser.ts:1-54`): import `{ Formio } from '@formio/js'`, fetch `GET /l/.../...?token=`, handle 302 → dead page, then render read-only:

```typescript
const res = await fetch(`${apiOrigin}/l/view/${jti}?token=${encodeURIComponent(token)}`, {
  credentials: 'same-origin',
});
if (res.status === 302) { window.location.href = res.headers.get('location')!; return; }
```

**Prefill pattern** (`prefill.ts:17-38`): `PrefillService.buildPrefill(profile, config)` builds a partial data object from a field list — reuse for the edit page pre-filling from the latest revision. `@formio/js@5.6.1` must be added to the renderer manifest and **self-hosted** (no CDN — Security §, STACK §9.2). Gate behind the `SUS` `checkpoint:human-verify` + spike S1 (05-RESEARCH.md Package Legitimacy Audit).

---

### `tooling/boundaries.config.mjs` (MODIFY — CON-01, **required before the first connector file**)

**Analog:** itself. Current edge (`boundaries.config.mjs:146`):

```javascript
connectors: Object.freeze(['platform', 'kernel']),
```

D-89 needs the `Connector` seam from `@akane/contract` → add `'contract'`:

```javascript
connectors: Object.freeze(['platform', 'kernel', 'contract']),
```

**Also verify (Pattern 6):** `datarouter` (`boundaries.config.mjs:158-164`) currently allows `['platform','kernel','registry','connectors','audit']` — it may import `connectors` but **not** `submissions`/`contract`. `submissions` (`:147-157`) must not import `connectors`/`datarouter`. Because policies are **last-match-wins** (`:15-20`), any new edge must be a deliberate edit here — an unlisted edge is a build failure (`default: 'disallow'`, `:283`).

---

## Shared Patterns

### 1. Boundary/local-seam discipline (applies to connectors, datarouter, submissions, links)
**Source:** `packages/domain/src/links/read-verifier.service.ts:21-78`. When element A may not import element B, declare a **local structural interface** in A and let the app module inject the concrete class:

```typescript
export interface SubmissionLookup {
  findByIdOwned(submissionId: string, realUserId: string): Promise<SubmissionRecord | null>;
}
```
Apply to the connector registry (adapter lookup) and the data router (revision/outbox access).

### 2. Credential crypto (applies to connector-credentials.repository, redmine.adapter, rest-core)
**Source:** `packages/platform/src/crypto/envelope.ts` + `key-provider.ts` + `crypto.module.ts`.
- `encryptSecret(plaintext, provider)` / `decryptSecret(envelope, provider)` — five-field `SecretEnvelope` (auth tag stored+verified; fresh 12-byte nonce).
- Inject the `CRYPTO_KEY_PROVIDER` symbol; never construct a provider (FND-10 guard runs in `CryptoModule`).
- Never log plaintext or the decrypted key (the envelope does no logging at all).

### 3. Single OTel→Prometheus metrics path (applies to business-metrics, connector counters, delivery/relay processors)
**Source:** `packages/platform/src/metrics/business-metrics.ts:26-84`, `apps/api/src/common/metrics/read-deny.metrics.ts:56-69`.
`METER_NAME = 'akane'`; memoise; get the meter per call; attributes not new registries; `_total` suffix for new counters.

### 4. Durable queue retry + Job Schedulers (applies to delivery/relay processors, scheduler registration, CLI dlq retry)
**Source:** `packages/platform/src/queue/job-scheduler.ts`, `platform-heartbeat.job.ts`, `queue.provider.ts`.
- `registerJobScheduler` / `upsertJobScheduler` (idempotent); `await resume()`.
- `blockingConnectionOptions` for workers (`maxRetriesPerRequest: null`); `producerConnectionOptions` for producers.
- Retry = `{ attempts: 5, backoff: { type: 'exponential', delay: 2000 } }`; the failed set is the DLQ.

### 5. Append-only audit + redaction-before-serialisation (applies to CLI dlq output, rebind, delivery logs)
**Source:** `packages/domain/src/audit/audit.repository.ts` (append-only, no update/delete — AUD-01); `packages/domain/src/links/read-deny.service.ts:22-33` (the `ReadDenyContext` allowlist discipline; `LoggerPort.warn` only accepts `LogFields`).
DLQ output is redacted by default under the same field allowlist; `--show-payload` is opt-in **and audited** (D-85). Never surface raw HTTP bodies, credentials, or PII (D-82, D-43/W-22).

### 6. Redis (cache vs queue) — do not cross the streams
**Source:** `packages/platform/src/queue/queue.provider.ts:70-90` + `redis.provider.ts`.
`REDIS_QUEUE_URL` for BullMQ (noeviction); `REDIS_CACHE_URL` for cache + throttler (`GETDEL` for one-time consume). Never point the queue at the evicting cache deployment (D-12/D-13).

### 7. Frozen contracts are consumed, never reshaped (applies to read links D-80/D-93, LNK-02)
**Source:** `packages/contract/src/links/read-link-claims.ts:38-67` — the six-action enum and `READ_LINK_TARGET_RULES` are frozen. Reuse `query` (status list) and `edit` (edit link); do **not** add a claim or action. `packages/contract/src/links/read-link-claims.frozen.spec.ts` must stay green.

---

## No Analog Found

Files with no close match in the codebase (planner must use RESEARCH.md patterns / build net-new; keep them small and injectable):

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `packages/domain/src/connectors/rest-core.ts` | service | request-response | `packages/domain/src/adapters/` is empty (`.gitkeep` only); no HTTP transport exists in the repo. Use RESEARCH §Code Examples + `undici`, injectable seam for `msw` tests. |
| `packages/domain/src/connectors/redmine.adapter.ts` | adapter | request-response/transform | No outbound adapter exists; nearest is the pure-transform style of `decision/rule-based.provider.ts`. |
| `packages/cli/connector.ts` | CLI | batch | `packages/cli/provision.ts` is a one-line empty stub — no CLI/arg-parsing pattern exists in the repo. |
| `packages/cli/dlq.ts` | CLI | batch | Same — no CLI pattern. Redaction default derives from Shared §5. |
| `packages/cli/rebind.ts` | CLI | batch | Same — no CLI pattern. AUD-01 transition derives from Shared §5 + audit repository. |
| `packages/domain/src/datarouter/data-router.service.ts` | service | batch/event-driven | No transactional-outbox code exists; the skeleton is RESEARCH §Pattern 1. |
| Wave-0 `tooling/` Redmine stub server | test support | request-response | No external-API test double exists; use `msw`/`undici` per RESEARCH §Wave 0. |

---

## Metadata

**Analog search scope:** `packages/contract/src`, `packages/domain/src` (all 13 element dirs), `packages/platform/src` (crypto, queue, metrics, mongo, redis), `apps/{api,worker,scheduler,renderer}/src`, `packages/cli`, `tooling/`, `tests/`.
**Files scanned:** ~35 (all reads were tracked source; verified with `git ls-files --`).
**Strong-match analogs reused:** `submission.repository.ts`, `read-verifier.service.ts`, `read-deny.service.ts`/`read-deny.metrics.ts`, `dsl.service.ts`, `envelope.ts`/`key-provider.ts`/`crypto.module.ts`, `job-scheduler.ts`/`platform-heartbeat.job.ts`/`queue.provider.ts`, `business-metrics.ts`, `platform-heartbeat.processor.ts`, `inbound-event.processor.ts`, `apps/scheduler/src/app.module.ts`, `read.controller.ts`/`read.module.ts`, `audit.repository.ts`, `view.browser.ts`/`prefill.ts`, `boundaries.config.mjs`.
**Critical planner note (R3):** new repositories importing the `mongodb` driver must live under a `data-access/` subdirectory, not directly under `connectors/`, `datarouter/`, or `submissions/` — otherwise `tooling/boundaries.config.mjs:384-397` fails the build.
**Pattern extraction date:** 2026-10-09
