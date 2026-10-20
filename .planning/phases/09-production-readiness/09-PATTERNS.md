# Phase 9: Production Readiness — Pattern Map

**Mapped:** 2026-10-20
**Files analyzed:** 41 (17 modify, 24 new)
**Analogs found:** 35 / 41 rows have a codebase analog; 6 rows are greenfield artifacts (use RESEARCH patterns C1–C6 / P1–P14 instead)

**Tracked-source gate:** every analog path below was verified with `git ls-files` (all tracked, zero untracked/mirror paths).

---

## File Classification

| # | New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|-------------------|------|-----------|----------------|---------------|
| 1 | `packages/domain/src/audit/audit.repository.ts` (M, D-01/D-06) | repository | CRUD (append-only) | itself + `packages/domain/src/builder/data-access/app-definition.repository.ts` | exact |
| 2 | `packages/domain/src/audit/retention.service.ts` (N, D-03/D-04 single mutator; name per planner) | service | batch delete | `app-definition.repository.ts` (`findOneAndDelete`, memoised indexes) | exact |
| 3 | `packages/domain/src/audit/actor-identity.repository.ts` (N, D-05; name per planner) | repository | CRUD | `packages/domain/src/identity/identity-mapping.repository.ts` (shape) + `app-definition.repository.ts` (Mongo form) | exact |
| 4 | guard test for the two named audit mutators (N, D-04; location per planner) | test | static/lexical | `tooling/entrypoint-drift.spec.ts` | role-match |
| 5 | `packages/platform/src/config/config.schema.ts` (M, D-02 retention knob) | config | config-validation | itself | exact |
| 6 | `apps/scheduler/src/audit-retention.registration.ts` (N, research names it) | job registration | scheduled/event-driven | `apps/scheduler/src/reconciliation.registration.ts` | exact |
| 7 | `apps/worker/src/processors/audit-retention.processor.ts` (N) | processor | batch/event-driven | `apps/worker/src/processors/reconciliation.processor.ts` | exact |
| 8 | `apps/scheduler/src/access-review.registration.ts` (N, D-12) | job registration | scheduled | `reconciliation.registration.ts` | exact |
| 9 | `apps/worker/src/processors/access-review.processor.ts` (N, D-12) | processor | batch | `reconciliation.processor.ts` | exact |
| 10 | `packages/cli/erase.ts` (N, D-07; name per planner) | CLI command | batch + transform | `packages/cli/rebind.ts` | exact |
| 11 | `apps/api/src/audit/audit.controller.ts` (M, D-09/D-10/F-1/F-2) | controller | request-response | itself | exact |
| 12 | `apps/api/src/audit/audit-query.schema.ts` (N, research names it) | validation schema | request-response | `packages/contract/src/builder/publish.contract.ts` (`.strict()` zod) | role-match |
| 13 | `apps/api/src/audit/audit-export.service.ts` (N, D-11) | service | streaming export | `apps/api/src/submissions/submission-export.service.ts` | exact |
| 14 | access-review read route (N, D-12; new controller or extend `audit.controller.ts` — planner's call) | controller | request-response | `apps/api/src/audit/audit.controller.ts` | exact |
| 15 | `apps/app-builder/src/access-review/AccessReviewPage.tsx` (N, D-12) | component/page | request-response | `apps/app-builder/src/audit/AuditPage.tsx` | exact |
| 16 | `packages/contract/src/builder/publish.contract.ts` (M, D-13 enum) | contract | schema | itself | exact |
| 17 | `packages/domain/src/builder/app-lifecycle.ts` (M, D-13 edge) | domain state machine | — | itself | exact |
| 18 | `apps/api/src/app-builder/app-builder.controller.ts` (M, purge endpoint) | controller | request-response | its own `deprecate`/`archive` endpoints | exact |
| 19 | purge grace-period record + repository (N, D-13/P8a; `requested_at`/`execute_after`/`executed_at`/`operator_id`) | repository | CRUD | `app-definition.repository.ts` | exact |
| 20 | `apps/scheduler/src/app-purge.registration.ts` (N) | job registration | scheduled | `reconciliation.registration.ts` | exact |
| 21 | `apps/worker/src/processors/app-purge.processor.ts` (N) | processor | batch | `reconciliation.processor.ts` | exact |
| 22 | `apps/app-builder/src/audit/AuditPage.tsx` (M, UI-SPEC Fix 1) | component | request-response | itself | exact |
| 23 | `apps/app-builder/src/api/audit.ts` (M, Fix 2) | API client/schema | request-response | itself | exact |
| 24 | `apps/app-builder/src/apps/AppsPage.tsx` (M, Fix 3 + Purge button) | component | request-response | itself | exact |
| 25 | `apps/app-builder/src/api/definition.ts` (M, Fix 4) | API client/schema | schema | itself | exact |
| 26 | `apps/app-builder/src/App.tsx` (M, Fix 5) | router/shell | routing | itself | exact |
| 27 | `apps/app-builder/src/editor/EditorPage.tsx` (M, Fix 6) | component | form edit | itself (named-control branch) | exact |
| 28 | `apps/app-builder/src/sections.ts` (M, Fix 6) | config/vocabulary | — | itself | exact |
| 29 | canonical metric registry — **naming conflict: see note below** (`observability/metric-names.ts` vs `packages/platform/src/metrics/metric-registry.ts`) | config/registry | — | `packages/platform/src/metrics/business-metrics.ts` (name-constant block) | role-match |
| 30 | `packages/platform/src/metrics/metric-registry.spec.ts` (N, research names it) | test | completeness | `tooling/entrypoint-drift.spec.ts` (non-vacuity discipline) | role-match |
| 31 | `packages/platform/src/metrics/business-metrics.ts` (M, D-18 instruments) | metrics | — | itself + `apps/api/src/common/metrics/read-deny.metrics.ts` | exact |
| 32 | D-18 emit sites across `apps/api`, `apps/worker`, `apps/scheduler` (M/N) | metrics emit | event-driven | `apps/api/src/common/metrics/read-deny.metrics.ts` | exact |
| 33 | `observability/prometheus/rules/*.yml` + `observability/prometheus/tests/rules.test.yml` (N ×6) | config/alert | — | **no analog** → RESEARCH C3, P10 | no analog |
| 34 | `observability/grafana/dashboards/akane-overview.json` (N) | dashboard | — | **no analog** → RESEARCH D-19, P14 | no analog |
| 35 | `observability/deploy/log-retention.yml` (N) | config | — | **no analog** → RESEARCH P11 | no analog |
| 36 | `docs/runbooks/*.md` (N ×5) | docs | — | **no analog** → RESEARCH P10/OBS-10 | no analog |
| 37 | `apps/api/src/common/throttler/redis-throttler.storage.ts` (N, C1) + possibly `packages/platform/src/redis/redis-rate-counter.ts` (M) | middleware/storage | request-response | `packages/platform/src/redis/redis-rate-counter.ts` | exact |
| 38 | `.github/workflows/ci.yml` (M — add promtool + k6 jobs) | CI config | batch | itself (2-job structure) | exact |
| 39 | `load/k6/{inbound-events,concurrent-users}.js`, `load/k6/lib/redis-commandstats.js` (N ×3) | load harness | load test | **no analog** → RESEARCH C-`P12`/`P13`, `tooling/containers.ts` for the stack | no analog |
| 40 | `packages/platform/src/crypto/envelope.ts` (M, D-21 wrapped DEK) | crypto | — | itself (+ `jwt-verifier.ts` kid-keyed precedent) | exact |
| 41 | `packages/platform/src/crypto/envelope-rotation.spec.ts` (N, research names it) | test | rotation verification | RESEARCH C5 + `jwt-verifier.ts` reject-unknown-kid behavior | role-match |

### ⚠ Naming conflict the planner must resolve (rows 29–30)

RESEARCH names the canonical emitted-metric registry **two different places**: `observability/metric-names.ts` (Recommended Project Structure, L447) and `packages/platform/src/metrics/metric-registry.ts` (Code Example C4, L1245+, with `metric-registry.spec.ts`). Pick one before planning — the rule-file test, dashboard test and scrape-completeness test all import it. **Recommendation:** `packages/platform/src/metrics/metric-registry.ts`, because `observability/` holds consumer-side artifacts (rules/dashboards), the registry must be importable by `packages/platform`'s own tests, and `packages/` is already a workspace boundary the lint rules understand. (This is an agent recommendation inside a research-internal discrepancy, not a locked decision.)

### ⚠ Sweep execution: research text vs shipped guard test (rows 6–7, 8–9, 20–21)

Pitfall R6 (RESEARCH L1032) says "register **and** consume in `apps/scheduler` only". The shipped guard test forbids that: `tooling/entrypoint-drift.spec.ts:500` — *"the scheduler closure contains no BullMQ Worker binding (R1)"* (and `:484` the same for `api`). Every existing job follows the split — register in `apps/scheduler` (`reconciliation.registration.ts`), consume via `new Worker(...)` in `apps/worker` (`reconciliation.processor.ts:38`). **The guard test wins**: assign sweeps as scheduler-registration + worker-processor, exactly like reconciliation. R6's real warning sign stands — never put a registration under `apps/api/`.

---

## Pattern Assignments

### 1. `packages/domain/src/audit/audit.repository.ts` (repository, CRUD append-only → Mongo) — D-01, D-06

**Analog:** itself (interface to keep) + `packages/domain/src/builder/data-access/app-definition.repository.ts` (Mongo form)

Keep `append`/`findAll`/`count` signatures; replace the in-memory array with Mongo delegation. Current shape (L1-34):

```typescript
export interface AuditEntry {
  timestamp: Date;
  actor: string;
  action: string;
  target: string;
  previous_state?: string;
  new_state?: string;
  ip?: string;
  request_id?: string;
  [key: string]: unknown;   // ← D-06 REMOVES this; explicit field set, identity fields named *_ref
}

export class AuditRepository {
  private entries: AuditEntry[] = [];   // ← replaced by MongoService delegation

  async append(entry: AuditEntry): Promise<void> { ... }
  async findAll(): Promise<AuditEntry[]> { ... }
  async count(): Promise<number> { ... }

  // AUD-01: append-only - no update or delete operations
  // This is enforced structurally by not providing update/delete methods
}
```

**Mongo lazy-access pattern** — `app-definition.repository.ts:161-189` (copy this skeleton):

```typescript
export class AppDefinitionRepository {
  constructor(private readonly mongo: MongoService) {}

  private get collection() {
    return this.mongo.db().collection<AppDefinitionDocument>('apps');
  }

  private ensureIndexPromise: Promise<void> | null = null;

  /**
   * The unique `app_id` index — the duplicate-create guard.
   * Idempotent and memoised: a second call reuses the first
   * promise, so a boot storm cannot race index creation.
   */
  private ensureIndex(): Promise<void> {
    if (this.ensureIndexPromise === null) {
      this.ensureIndexPromise = this.collection
        .createIndex({ app_id: 1 }, { unique: true, background: true })
        .then(() => undefined)
        .catch(() => undefined);
    }
    return this.ensureIndexPromise;
  }
```

**Index precedent for AUD-05's compound set** — `app-definition.repository.ts:421-434`:

```typescript
private versionsIndexPromise: Promise<void> | null = null;

private ensureVersionsIndex(): Promise<void> {
  if (this.versionsIndexPromise === null) {
    this.versionsIndexPromise = this.versions
      .createIndex({ app_id: 1, version: 1 }, { unique: true, background: true })
      .then(() => undefined)
      .catch(() => undefined);
  }
  return this.versionsIndexPromise;
}
```

Copy the memoised-index discipline exactly; the AUD-05 index shape (equality prefix first, sort/range last) comes from RESEARCH Pattern P3. Query-filter parsing analog: RESEARCH C6 (`audit-query.schema.ts` + pushed-down filters).

---

### 2. `packages/domain/src/audit/retention.service.ts` (service, batch delete) — D-03/D-04

**Analog:** `app-definition.repository.ts` for the delete call shape + `tooling/entrypoint-drift.spec.ts` for the guard test that makes it the *single named mutator*.

This is the only class permitted to `deleteMany` on `audit_entries`; the D-04 guard test greps for any other mutation site. Delete primitive precedent (`app-definition.repository.ts:406-412`):

```typescript
return this.versions.findOneAndDelete(
  { app_id: appId, version: { $lte: cutoffVersion } },
  { sort: { version: 1 } },
);
```

The sweep **appends its own audit entry** (cutoff date, row count, `operator: system`) — use the append call shape from `submission-export.service.ts:130-142` (below). Watch RESEARCH Pitfall R5 (unbounded `updateMany`/`deleteMany` on a large collection — batch it).

---

### 3. `packages/domain/src/audit/actor-identity.repository.ts` (repository, CRUD) — D-05

**Analog:** `packages/domain/src/identity/identity-mapping.repository.ts` (mirror the shape) in its Mongo form per `app-definition.repository.ts`.

```typescript
export interface IdentityMapping {
  platform: string;
  chat_user_id: string;
  real_user_id: string;
  channel_id?: string;
  email?: string;
  deactivated_at?: Date | null;
}
```
— `identity-mapping.repository.ts:1-8`. New collection `actor_identities`: `actor_ref → real_user_id`, same upsert/findBy-key surface, one row deleted per erasure.

---

### 6/8/20. `apps/scheduler/src/*-registration.ts` (job registration, scheduled) — D-03, D-12, D-13

**Analog:** `apps/scheduler/src/reconciliation.registration.ts` (full file, 22 lines):

```typescript
import {
  JobSchedulerTarget,
  type RegisteredJob,
  registerJobScheduler,
  resumeJobScheduler,
} from '@akane/platform';

export const RECONCILE_OUTBOUND_ID = 'reconcile-outbound';
export const RECONCILE_INTERVAL_MS = 300_000; // 5 minutes

export async function registerReconciliation(
  queue: JobSchedulerTarget & { resume(): Promise<void> },
): Promise<RegisteredJob> {
  const result = await registerJobScheduler(
    queue,
    RECONCILE_OUTBOUND_ID,
    { every: RECONCILE_INTERVAL_MS },
    { name: RECONCILE_OUTBOUND_ID },
  );
  await resumeJobScheduler(queue);
  return result;
}
```

**Wiring — `apps/scheduler/src/app.module.ts`, three touchpoints per new job:**

```typescript
// L85-92: add the ID to the frozen registration list
{
  provide: JOB_SCHEDULER_REGISTRATIONS,
  useValue: Object.freeze([
    PLATFORM_HEARTBEAT_ID,
    RECONCILE_OUTBOUND_ID,
    TRANSFER_AUTO_CANCEL_ID,
  ]),
},
// L145-149: register on bootstrap
async onApplicationBootstrap(): Promise<void> {
  await registerPlatformHeartbeat(this.queue);
  await registerReconciliation(this.queue);
  await registerTransferAutoCancel(this.queue);
},
```

…and add a `jobSchedulerReadyIndicator(queue, <NEW_ID>)` entry to the `EXTRA_HEALTH_INDICATORS` factory (L93-137), which answers `session.up/down` with the full scheduler ID list. BullMQ Job Schedulers only — `@nestjs/schedule` is banned for durable work (CONTEXT D-03).

---

### 7/9/21. `apps/worker/src/processors/*.processor.ts` (processor, batch) — D-03, D-12, D-13

**Analog:** `apps/worker/src/processors/reconciliation.processor.ts` (the consumption half):

```typescript
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';
import { blockingConnectionOptions, BULLMQ_PREFIX, WORKER_CONSUMERS } from '@akane/platform';

@Injectable()
export class ReconciliationProcessor
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  readonly #queueUrl: string;
  #worker: Worker | undefined;

  constructor(config: ConfigService, /* injected repos */) {
    this.#queueUrl = config.getOrThrow<string>('REDIS_QUEUE_URL');
  }

  async onApplicationBootstrap(): Promise<void> {
    this.#worker = new Worker(
      RECONCILE_OUTBOUND_ID,
      async (job: Job) => { await this.process(job); },
      reconciliationWorkerOptions(this.#queueUrl),   // { connection: blockingConnectionOptions(url), prefix: BULLMQ_PREFIX }
    );
    this.#worker.on('error', (error: Error) => { this.#lastError = error; });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.#worker?.close();
    this.#worker = undefined;
  }
}

export const reconciliationWorkersProvider = {
  provide: WORKER_CONSUMERS,
  inject: [ReconciliationProcessor],
  useFactory: (processor: ReconciliationProcessor) => [processor],
};
```
(lines 1-87). Register each new processor in the `WORKER_CONSUMERS` provider list. **`new Worker(` outside `apps/worker` fails `tooling/entrypoint-drift.spec.ts:484/:500`.**

---

### 10. `packages/cli/erase.ts` (CLI command, batch) — D-07

**Analog:** `packages/cli/rebind.ts` (full file, 65 lines) — deps-injected harness, audit-append-before-mutation:

```typescript
export async function rebindConnectorRef(
  seed: AppSeed,
  appRepo: AppRepository,
  auditRepo: AuditRepository,
): Promise<{ changed: boolean }> {
  ...
  // Write AUD-01 before applying change
  await auditRepo.append({
    timestamp: new Date(),
    actor: 'cli:rebind',
    action: 'app_connector_ref_change',
    target: seed.app_id,
    previous_state: oldRef || 'none',
    new_state: newRef,
  });

  await appRepo.updateConnectorRef(seed.app_id, newRef);
  return { changed: true };
}

export async function runRebind(
  args: string[] = process.argv.slice(2),
  deps?: { appRepo: AppRepository; auditRepo: AuditRepository },
): Promise<void> {
  if (!deps) { throw new Error('Dependencies required'); }
  ...
}
```

Copy: `runErase(args, deps)` signature, explicit throw when `deps` absent, `actor: 'cli:erase'`, append `erasure.executed` (D-05: the erasure act is itself the proof entry). Order per D-07: redact every `*_ref` (`updateMany` on `audit_entries` — the second named mutator, see Q1), delete the mapping row, purge submission bodies, then append.

---

### 11. `apps/api/src/audit/audit.controller.ts` (controller, request-response) — D-09, D-10, F-1, F-2

**Analog:** itself — extend, don't replace. Key excerpts:

**Gate** (L130-186):

```typescript
@Controller('audit')
@UseFilters(new BuilderExceptionFilter())
export class AuditController {
  constructor(private readonly audit: AuditRepository) {}

  @Get()
  async browse(@Query() query: unknown, @Req() req: Request): Promise<AuditBrowseResponse> {
    this.assertGlobalAdmin(req);
    const { limit, offset } = this.parsePagination(query);
    const all = await this.audit.findAll();
    ...
  }

  private assertGlobalAdmin(req: Request): void {
    const user = (req as Request & { user?: { role?: string } }).user;
    if (user?.role !== 'global-admin') { throw new AuditForbiddenError(); }
  }
}
```

**D-10 changes:** replace the in-memory `findAll()` + sort + slice (L151-167) with a pushed-down Mongo query + compound indexes (P3); parse `user`, `app_id`, `action`, `from`, `to` alongside `parsePagination` (L189-226 shows the existing validate-and-name-the-field style → extend `AuditValidationError` or the new `audit-query.schema.ts`). **D-09 changes:** add `ip` (and `app_id`) to `AuditEntryView` (L112-120) and to `toAuditEntryView` (L235-256); `user_agent` stays store-only.

**Stale D-43 comments to correct in the same change (F-1):** file header L30-41 (*"The repository's `ip` field ... unreachable in the response by construction"*) and `toAuditEntryView`'s docblock L229-234 (*"`ip` and every non-allowlisted key the append carried are dropped here — before serialization"*). Both must now say `ip` **is** served (AUD-02 + `log-allowlist.ts:58-61` allowlists it).

Error classes to reuse: `AuditForbiddenError` → `GLOBAL_ADMIN_REQUIRED`, `AuditValidationError` → `AUDIT_VALIDATION` (L81-98); pagination constants `AUDIT_DEFAULT_LIMIT = 20` / `AUDIT_MAX_LIMIT = 100` (L101-104).

---

### 13. `apps/api/src/audit/audit-export.service.ts` (service, streaming export) — D-11 (JSONL)

**Analog:** `apps/api/src/submissions/submission-export.service.ts` (full file, 150 lines) — projection-before-serialization + audited export:

```typescript
export const SUBMISSION_EXPORT_COLUMNS = [
  'submission_id', 'app_id', 'form_id', 'status', 'submitted_at', 'downstream_reference', 'reason',
] as const;                                        // L43-51 — the export allowlist

export class SubmissionExportService {
  constructor(
    private readonly submissions: SubmissionRepository,
    private readonly revisions: SubmissionRevisionLookup,
    private readonly audit: AuditRepository,
  ) {}
  ...
  async exportSubmissions(filter, actor, connectorName?) {
    const rows = await this.listRows(filter, connectorName);
    const csv = await stringifyCsv(rows);

    await this.audit.append({
      timestamp: new Date(),
      actor,
      action: 'submissions.exported',
      target: filter.app_id,
      filters: { status: ..., from: ..., to: ..., form: ... },
      row_count: rows.length,
    } satisfies AuditEntry);

    return { csv, rowCount: rows.length, columns: SUBMISSION_EXPORT_COLUMNS };
  }
}                                                 // L122-149
```

JSONL variant: same class shape (`AuditExportService`, injected `AuditRepository`), serialize with `JSON.stringify(entry)` per line — no writer dependency needed (D-11 deliberately drops `csv-stringify` for this surface). Keep the terminal `audit.append({action:'audit.exported', filters, row_count})`. The controller route that triggers it follows `audit.controller.ts`'s gate + `AuditBrowseSchema` filter parsing (RESEARCH C6).

---

### 16/17/18/19. Purge lifecycle (contract → domain → controller → repository) — D-13

**Contract enum** — `packages/contract/src/builder/publish.contract.ts:82`:

```typescript
lifecycle: z.enum(['draft', 'published', 'deprecated', 'archived']),   // → add 'purged'
```
`.strict()` discipline throughout the file (L12-14: *"an unlisted field is rejected inline with the offending field named"*).

**State machine** — `packages/domain/src/builder/app-lifecycle.ts:70-78`, the exact line that currently refuses the exit:

```typescript
const LEGAL_TRANSITIONS: ReadonlyMap<AppLifecycleState, ReadonlySet<AppLifecycleState>> = new Map([
  ['draft', new Set(['published', 'archived'])],
  ['published', new Set(['deprecated', 'archived'])],
  ['deprecated', new Set(['published', 'archived'])],
  ['archived', new Set()],        // ← D-13 adds 'purged' as the single permitted exit
]);
```
Plus: `AppLifecycleState` union L44, `APP_LIFECYCLE_STATES` array L46-51, and the refusal `LifecycleTransitionError extends BuilderError` (`code: 'LIFECYCLE_ILLEGAL_TRANSITION'`, L81-91) — add purge to `assertTransition` (L128-135). `acceptsSubmissions` (L144-146: `lifecycle !== 'archived'`) must also refuse `purged`.

**Endpoint** — `apps/api/src/app-builder/app-builder.controller.ts`, copy the lifecycle-transition endpoint shape:

```typescript
@Post('apps/:id/deprecate')            // L192 — new: @Post('apps/:id/purge')
async deprecate(@Param(...) appId, @Req() req) {
  const deprecated = await this.definitions.deprecate(appId, actorOf(req));   // L200-202
  return toDefinitionResponse(deprecated);
}

@Post('apps/:id/archive')              // L209
async archive(...) {
  const archived = await this.definitions.archive(appId, actorOf(req));       // L215
  return toDefinitionResponse(archived);
}
```
Class is annotated `@UseFilters(new BuilderExceptionFilter())` (L82); `actorOf(req)` (L268-271) supplies the operator ID; `builderErrorStatus(error: BuilderError): HttpStatus` (L274) maps named errors to statuses. **The console purge button performs only the soft delete** (grace record + audit entry with operator ID/timestamp); the hard delete is job 20/21 after 30 days (P8a: the grace period is a *record*, not a timer).

---

### 22. `apps/app-builder/src/audit/AuditPage.tsx` (component) — UI-SPEC Fix 1

**Analog:** itself. Current defects the fix targets:

- **Client-side filter (D-10 rejects this)** — L92-104:
```tsx
const filtered =
  entries === null ? null
    : entries.filter((entry) => {
        if (query.trim().length === 0) { return true; }
        const haystack = `${entry.actor} ${entry.action} ${entry.target}`.toLowerCase();
        return haystack.includes(query.trim().toLowerCase());
      });
```
Replace with five server-side filter params pushed into `client.get('/audit?...', AuditBrowseSchema)` (L66-69 is the request shape to extend).
- **7 columns → 9** — L169-176 `<th>` list; insert `App` after `Target` and `IP` before `Request` (UI-SPEC fixed order: Timestamp, Actor, Action, Target, App, Previous, New state, IP, Request).
- `min-width: 920` → `1100` (L164).
- Move the `immutable · append-only` pill from `.page-actions` (L122-126) into `.toolbar` (L128+); add `Export JSON Lines` button to `.page-actions`.
- **Stale D-43 comment (F-1)** — file header L5-16.

Reuse the already-shipped pieces named in CONTEXT: `InlineError` (L37, used L152-157), `Skeleton` (L38, used L159), pager block (L226-261).

---

### 23. `apps/app-builder/src/api/audit.ts` (API client/schema) — UI-SPEC Fix 2

**Analog:** itself. Add `ip` and `app_id` to `AuditEntryView` (L30-38) **and** `ENTRY_ALLOWLIST` (L49-57) — the structural parse *rejects any key not on the allowlist* (L91-97), so adding the field without the allowlist entry makes every response throw:

```typescript
const ENTRY_ALLOWLIST = new Set([
  'timestamp', 'actor', 'action', 'target', 'previous_state', 'new_state', 'request_id',
]);
...
for (const key of Object.keys(record)) {
  if (!ENTRY_ALLOWLIST.has(key)) {
    throw new Error(`audit entry carries a non-allowlisted field: ${key}`);
  }
}
```
Update the stale doc comment L23-28 (*"`ip` and any non-allowlisted key are unreachable by construction"*).

---

### 24/25/26/27/28. UI-SPEC Fixes 3–6

**Fix 3 — `apps/app-builder/src/apps/AppsPage.tsx:52-67`** (add the missing case):
```typescript
function lifecycleTone(lifecycle: AppDefinition['lifecycle']): string {
  switch (lifecycle) {
    case 'published':  return 'badge-published';
    case 'draft':      return 'badge-draft';
    case 'deprecated': return 'badge-deprecated';
    case 'archived':   return 'badge-archived';
    // ← add:  case 'purged': return 'badge-purged';
    default:           return 'badge-draft';
  }
}
```
`.badge-purged` **already exists** in `apps/app-builder/src/chrome.css:166` (next to `.badge-archived` L165) — no CSS change needed. The Purge button goes here too (mockup `mockup.html:1251`, writes `action: "app.purge"`).

**Fix 4 — `apps/app-builder/src/api/definition.ts:21-26`:**
```typescript
export const APP_LIFECYCLE_STATES = [
  'draft', 'published', 'deprecated', 'archived',   // ← add 'purged'
] as const;
```

**Fix 5 — `apps/app-builder/src/App.tsx`, three touchpoints:**
```typescript
// L102-114: RouteName union — add 'access-review'
type RouteName = 'dashboard' | 'apps' | ... | 'audit' | /* new */ | 'settings' | 'unknown';

// L183-185: parseRoute branch — copy this exact shape
if (head === 'audit') { return { name: 'audit' }; }
// ← add: if (head === 'access-review') { return { name: 'access-review' }; }

// L572-578: nav link after Audit Log — copy this markup
<a className="btn btn-ghost btn-sm" href="#/audit" data-testid="nav-audit">Audit Log</a>
// ← add sibling: href="#/access-review" data-testid="nav-access-review"

// L608-650: RoutedPage switch — copy the case shape
case 'audit': return <AuditPage />;    // L639-640
// ← add: case 'access-review': return <AccessReviewPage />;
```

**Fix 6 — `EditorPage.tsx` + `sections.ts`:** today `lifecycle` renders as a JSON textarea because `isJsonSection` (L64-66) returns true for everything but `general`/`metadata`:
```typescript
function isJsonSection(section: string): boolean {
  return section !== 'general' && section !== 'metadata';
}
```
The fix adds `lifecycle` to the named-control branch — copy the branch structure of the section card shell (L729-762):
```tsx
<section className="card">
  <div className="card-head">
    <h2>{sectionLabel(activeSection)}</h2>
    <span className="spacer" />
    <span className="pill-mono">{activeSection}</span>
  </div>
  <div className="card-body">
    {activeSection === 'general' ? ( /* named controls, L736-762 */ )
     : activeSection === 'metadata' ? ( /* named controls, L763-795 */ )
     : ( /* JSON fallback, L796+ — lifecycle moves OUT of here */ )}
  </div>
</section>
```
New `lifecycle` branch renders the mockup's rail + callout + action row (Purge/Deprecate/Archive); `lifecycle_prefs` editing stays below (it is the section's `SECTION_FIELDS` entry — `sections.ts:60`: `lifecycle: ['lifecycle_prefs']`; label at L32: `lifecycle: 'Lifecycle state'`). `retention` and `deprecation-notice` sections stay as-is.

---

### 29/31/32. Metric registry + D-18 instruments + emit sites

**Analog (declaration):** `packages/platform/src/metrics/business-metrics.ts` — the single meter and the discipline docblocks:

```typescript
export const METER_NAME = 'akane';                                    // L27

/** The precedent D-18 closes: a name with nothing behind it. */
export const QUEUE_OLDEST_ITEM_AGE_METRIC = 'queue.oldest.item.age';  // L46 (L35-45 explains why)

let cached: BusinessMetrics | undefined;

export function registerBusinessMetrics(): BusinessMetrics {
  if (cached === undefined) {
    const meter = metrics.getMeter(METER_NAME);
    cached = Object.freeze({
      platformHeartbeat: meter.createCounter(PLATFORM_HEARTBEAT_METRIC, { description: '...' }),
      ...
    });
  }
  return cached;
}                                                                      // L93-112
```

**Analog (emit site):** `apps/api/src/common/metrics/read-deny.metrics.ts` — copy this file's shape for each new emit-site module:

```typescript
export const READ_LINK_DENIALS_METRIC = 'read_link_denials_total';    // L47 (name + why, incl. _total vs dotted)

let cached: ReadDenyRecorder | undefined;

export function registerReadDenyMetrics(): ReadDenyRecorder {
  if (cached === undefined) {
    const meter = metrics.getMeter(METER_NAME);                        // per-call, never at import (D-20)
    const denials: Counter = meter.createCounter(READ_LINK_DENIALS_METRIC, { description: '...' });
    cached = Object.freeze({
      recordDenial: (reason, action): void => { denials.add(1, { reason, action }); },
    });
  }
  return cached;
}                                                                      // L82-96
```
Its docblocks also encode the two rules D-18 inherits: **label-cardinality budget** (L28-34 — labels fixed by code, never user input) and **memoisation, not "create if absent"** (L36-45 — a second `createCounter` on one name makes the exporter emit the series twice). For a testable seam, mirror `BusinessMetricsRecorder` + DI token `BUSINESS_METRICS_RECORDER` (`business-metrics.ts:172-193`).

**Completeness test** (`metric-registry.spec.ts`, C4): assert every declared registry name appears in a scrape of the existing `GET /metrics` (`packages/platform/src/metrics/metrics.controller.ts` — single endpoint, `preventServerStart: true`). Non-vacuity discipline from `tooling/entrypoint-drift.spec.ts:439-454`:

```typescript
it('each closure reaches its app module and the platform source, not just main.ts', () => {
  for (const app of APPS) {
    const files = relativeFiles(app);
    expect(files, `${app} closure`).toContain(`apps/${app}/src/main.ts`);
    ...
    expect(
      files.filter((file) => file.startsWith('packages/platform/src/')).length,
      `${app} closure should reach well past the platform barrel`,
    ).toBeGreaterThan(5);
  }
});
```
i.e. the registry test must first prove the registry is *populated and reachable* before any "every rule references a real name" assertion — otherwise a broken resolver yields an empty set and every check passes vacuously.

---

### 37. `apps/api/src/common/throttler/redis-throttler.storage.ts` (ThrottlerStorage, request-response) — C1

**Analog:** `packages/platform/src/redis/redis-rate-counter.ts` — the shipped hand-rolled fixed-window counter (`FIXED_WINDOW_SCRIPT`, `RedisEvalSeam`, used per read-link `jti` and per connector). Copy its Redis seam (never a second client, never the queue connection). Test analog: `tests/unit/throttler.spec.ts`. Research C1 has the full interface conformance sketch; note the `@nestjs/throttler` install is flagged `SUS (too-new)` in the legitimacy audit → gate behind `checkpoint:human-verify`.

---

### 38. `.github/workflows/ci.yml` (CI config) — D-16, D-17

**Analog:** itself — currently exactly two jobs (`build` L12-26, `install-guard` L45-89). New jobs (`promtool`, `k6`) copy the checkout/setup-node/`npm ci` header (L16-22) and the failure-style convention: every assertion emits `::error::` with the decision ID, and non-vacuity guards run *before* the thing they guard:

```yaml
- name: Assert the install carries no peer-dependency bypass (D-06, WR-10)
  run: |
    if [ -z "$INSTALL_CMD" ]; then
      echo "::error::the guarded install command did not resolve — this assertion would be vacuous (D-06)."
      exit 1
    fi
```
(L57-69). Docker is available (testcontainers harness in `tooling/`); `promtool` runs against the official Prometheus image, k6 against `grafana/k6` — no `node_modules` growth.

---

### 40/41. Envelope wrapped-DEK + rotation verification — D-21 / WINDOW 7

**Analog:** `packages/platform/src/crypto/envelope.ts` itself. The fix site is documented in-file (L40-54):

```
* The consequence is recorded rather than hidden: rotating `kid` makes
* previously sealed envelopes undecryptable until the store lands and a per-secret
* wrapped DEK can be persisted, at which point `encryptSecret` grows a sibling
* field and the envelope's five fields do not change. That upgrade is additive,
* which is the entire reason `kid` is in v1.
```

Five-field shape (L80-93) stays; the wrapped DEK is the **additive sibling field**. `DEK_DERIVATION_LABEL` (L77) is what `deriveDek` (L102-108) wraps today:

```typescript
const DEK_DERIVATION_LABEL = Buffer.from('akane.dek.v1.envelope-derivation', 'utf8');

async function deriveDek(keyProvider: KeyProvider): Promise<{ dek: Buffer; kid: string }> {
  const { wrapped, kid } = await wrapDekChecked(keyProvider, DEK_DERIVATION_LABEL);
  const dek = await unwrapDekChecked(keyProvider, wrapped, kid);
  return { dek, kid };
}
```
— replaced by reading the envelope's persisted wrapped DEK (falling back to the label only for pre-existing rows, if planner chooses).

**Verification (`envelope-rotation.spec.ts`)** must follow RESEARCH C5/R7 — rotate **under traffic, no restart**: seal under `kid=A`, activate `B` with `A` still in keyring, decrypt the `A`-envelope live, re-wrap, remove `A`, assert `KEY_ID_MISMATCH` (the guard already exists at `envelope.ts:197-206`). JWT half: `jwt-verifier.ts:125-131` — *"An unknown `kid` must NOT fall back to another key"* — assert rejection, not fallback. Evidence that is "a successful restart" fails R7.

---

## Shared Patterns

### Authentication — global-admin gate (apply to: audit controller, access-review read route, purge endpoint)
**Source:** `apps/api/src/audit/audit.controller.ts:177-186` — gate lives at the API surface, never in the page:
```typescript
private assertGlobalAdmin(req: Request): void {
  const user = (req as Request & { user?: { role?: string } }).user;
  if (user?.role !== 'global-admin') { throw new AuditForbiddenError(); }
}
```

### Error handling — named `BuilderError` + `BuilderExceptionFilter`
**Source:** `audit.controller.ts:81-98` / `app-builder.controller.ts:42-49, 274` — apply to every new API surface:
```typescript
export class AuditForbiddenError extends BuilderError {
  constructor() { super('GLOBAL_ADMIN_REQUIRED', 'global-admin session required'); }
}
export class AuditValidationError extends BuilderError {
  constructor(field: string, constraint: string) {
    super('AUDIT_VALIDATION', `invalid audit pagination field: ${field} (${constraint})`);
  }
}
```
Rendered as `{error: {code, message}}` by `BuilderExceptionFilter` via `builderErrorStatus`. Domain-side: `BuilderError(code, message)` base (`app-lifecycle.ts:59-67`).

### Validation — Zod `.strict()` at the contract; structural parse at the SPA
**Source:** `packages/contract/src/builder/publish.contract.ts` (`.strict()` throughout, L12-14) for server contracts; `apps/app-builder/src/api/audit.ts:68-136` for the SPA boundary (allowlist-reject + field-type checks). New `audit-query.schema.ts` follows the contract style; D-02 config key goes into `AppConfigShape` (`config.schema.ts:51-91`, then `.strict()` at L104-107, boot failure rendered as `CONFIG_INVALID: <path> <code>` by `formatConfigError` L147-151).

### Audit-before-mutation (apply to: purge, erasure, export, retention sweep)
**Source:** `packages/cli/rebind.ts:38-48` and `submission-export.service.ts:130-142` — the append happens with a fixed `actor` vocabulary (`'cli:rebind'`, `'cli:erase'`, `'system'`) and carries `filters`/`row_count` as structured extras.

### One meter, memoised instruments, per-call `getMeter` (apply to: every D-18 instrument/emit site)
**Source:** `business-metrics.ts:27, 93-112` + `read-deny.metrics.ts:82-96` (both docblocks quote the double-registration failure and the pre-bootstrap no-op provider trap).

### Job Scheduler registration trio (apply to: retention, access-review, purge sweeps)
**Source:** `reconciliation.registration.ts` (register+resume) + `app.module.ts` (frozen list L85-92, readiness indicator L93-137, bootstrap call L145-149) + `reconciliation.processor.ts` (`new Worker` in `apps/worker` only, `WORKER_CONSUMERS` provider).

### Guard-test style (apply to: D-04 mutator guard, D-18 completeness, D-19 dashboard, D-20 runbook/retention tests)
**Source:** `tooling/entrypoint-drift.spec.ts` — (1) non-vacuity first test (L432-454), (2) explicit negative controls (L548-561), (3) owner lists as frozen data (e.g. `CAPABILITY_OWNERS` L401-406), (4) assertions on bindings/closures rather than file existence. Every new test in this phase should be shaped this way — a guard that passes when its own resolver breaks is the failure mode this file exists to prevent.

### SPA page skeleton (apply to: `AccessReviewPage.tsx`, the AuditPage fix)
**Source:** `apps/app-builder/src/audit/AuditPage.tsx` — `useApiClient()` + `client.get(path, Schema)` + `useState` triad (`entries | null`, `error`, paging offset) + `InlineError` with `onRetry` + `Skeleton variant="block"` + `data-testid` per row/button + `.page-head`/`.toolbar`/`.table-wrap`/pager markup.

### CI assertion style (apply to: promtool job, k6 job)
**Source:** `.github/workflows/ci.yml:57-69` — `::error::` messages citing decision IDs; declare-once values asserted before use; empty-output non-vacuity guards.

---

## No Analog Found

Greenfield artifacts — no codebase precedent; build strictly from RESEARCH patterns (planner should inline the relevant pattern into the plan action):

| File(s) | Role | Data Flow | Reason | Use instead |
|---------|------|-----------|--------|-------------|
| `observability/prometheus/rules/*.yml` + `prometheus/tests/rules.test.yml` | config/alert | — | No rule files exist anywhere (verified) | RESEARCH **C3** (rule + promtool pair), **P10** (8 rules, incl. D-15's `submission_status{status="partial"}` superset), Pitfall R4 (a test that can only pass) |
| `observability/grafana/dashboards/akane-overview.json` | dashboard | — | No Grafana artifacts | RESEARCH **D-19 / P14** — every panel query must reference only registry names |
| `observability/deploy/log-retention.yml` | config | — | No retention config anywhere | RESEARCH **P11** — committed values + drift test (Loki 30d hot / 1y cold) |
| `docs/runbooks/*.md` (×5) | docs | — | `docs/runbooks/` does not exist (docs/ has only API/ARCHITECTURE/CONFIGURATION/DEPLOYMENT/DEVELOPMENT/GETTING-STARTED/TESTING) | RESEARCH **P10/OBS-10** — one file per named incident, each referenced by an alert's `runbook_url`, resolution test |
| `load/k6/*.js` + `lib/redis-commandstats.js` | load harness | load | No load harness of any kind | RESEARCH **P12** (open model for 50 IM events/s, closed/ramping for 1000 VUs), **P13** (`INFO commandstats` deltas per Redis command); stack via `tooling/containers.ts` precedent + `grafana/k6` image; Pitfall R2 (don't measure a 3-tier throttler that doesn't exist — build C1 first) |
| `packages/platform/src/metrics/metric-registry.ts` registry *concept* | registry | — | No canonical cross-consumer name registry yet (names live as constants inside `business-metrics.ts`) | RESEARCH **C4** + dual-naming note above |

Also greenfield but with **strong structural analogs already assigned above**: all `*.registration.ts` / `*.processor.ts` pairs (rows 6-9, 20-21), the erasure CLI (row 10), the guard tests (row 4).

**Known doc-vs-code gaps the planner must handle (RESEARCH Open Questions):** `docs/API.md:74-82` and `docs/ARCHITECTURE.md:47` document a 3-tier `@nestjs/throttler` that does not exist (Q2 — C1 builds it or the docs are corrected); `decision accuracy` (OBS-09) has no instrument and is not on OBS-03's list (Q3); `form load time` emit site unknown (Q4); OBS-06 rules 5-6 cannot be satisfied by application instruments (Q5); Q1 (AUD-04's "null the actor reference" vs AUD-01 append-only — one mutator or two?) **changes task counts and must be resolved before writing the audit plans**.

---

## Metadata

**Analog search scope:** `packages/domain/`, `packages/platform/`, `packages/contract/`, `packages/cli/`, `apps/api/`, `apps/worker/`, `apps/scheduler/`, `apps/app-builder/`, `tooling/`, `.github/workflows/`, `docs/`, `tests/`
**Files scanned / read for excerpts:** 30 code files read or grep-targeted; 33 analog paths tracked-gate verified (`git ls-files`)
**Frontend note:** `chrome.css` needs no edit (`.badge-purged` exists at L166); `sections.ts` is at `apps/app-builder/src/sections.ts` (not `editor/sections.ts`); `lifecycleTone` lives in `apps/app-builder/src/apps/AppsPage.tsx` (not `definition.ts`)
**Pattern extraction date:** 2026-10-20
