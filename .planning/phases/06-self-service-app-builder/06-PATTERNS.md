# Phase 6: Self-Service App Builder - Pattern Map

**Mapped:** 2026-10-11
**Files analyzed:** 31 new/modified files
**Analogs found:** 26 / 31 (5 no-analog — all documented in RESEARCH.md patterns)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/api/src/auth/auth.module.ts` | config (Nest module) | request-response | `apps/api/src/read/read.module.ts` | exact |
| `apps/api/src/auth/auth.controller.ts` | controller | request-response | `apps/api/src/read/read.controller.ts` | exact |
| `apps/api/src/auth/oidc.service.ts` | service | request-response | RESEARCH Pattern 4 (`openid-client` v6 flat API) — no in-repo analog (first OIDC usage) | no-analog |
| `apps/api/src/auth/session.middleware.ts` | middleware | request-response | `packages/platform/src/redis/redis.provider.ts` (Redis client seam) — cookie issuance is new | role-match |
| `apps/api/src/app-builder/app-builder.module.ts` | config (Nest module) | CRUD | `apps/api/src/read/read.module.ts` | exact |
| `apps/api/src/app-builder/app-builder.controller.ts` | controller | CRUD | `apps/api/src/read/read.controller.ts` | exact |
| `apps/api/src/submissions/submissions.controller.ts` | controller | CRUD | `apps/api/src/read/read.controller.ts` | exact |
| `apps/api/src/submissions/submission-export.service.ts` | service | batch/transform | `apps/api/src/read/status-projection.ts` | exact |
| `apps/api/src/users/users.module.ts` | config (Nest module) | CRUD | `apps/api/src/read/read.module.ts` | exact |
| `apps/api/src/users/users.controller.ts` | controller | CRUD | `apps/api/src/read/read.controller.ts` + `packages/domain/src/identity/identity.service.ts` | exact |
| `packages/domain/src/builder/app-definition.repository.ts` | model (repository) | CRUD | `packages/domain/src/registry/app.repository.ts` | exact |
| `packages/domain/src/builder/app-definition.service.ts` | service | CRUD + event-driven (AUD-01) | `app.repository.ts` + `packages/domain/src/audit/audit.repository.ts` | exact |
| `packages/domain/src/builder/publish-gate.service.ts` | service | transform | `apps/api/src/read/status-projection.ts` (pure function over inputs) | exact |
| `packages/domain/src/builder/connector-request/connector-request.repository.ts` | model (repository) | CRUD | `packages/domain/src/registry/app.repository.ts` | exact |
| `packages/domain/src/builder/connector-request/connector-request.service.ts` | service | event-driven | `packages/cli/connector.ts` (`ConnectorSeed` + `upsertConnector`) + `audit.repository.ts` | exact |
| `packages/domain/src/builder/template/template.seed.ts` + `seeds/*.json` | config | file-I/O | `packages/domain/src/seeds/saved-queries.seed.json` + `seed-saved-query.lookup.ts` | exact |
| `packages/domain/src/builder/saved-query.repository.ts` (G-11 replacement) | model (repository) | CRUD | `packages/domain/src/links/seed-saved-query.lookup.ts` (implements `SavedQueryLookup`) | exact |
| `packages/domain/src/builder/routing-share/routing-share.metrics.ts` | utility (OTel metrics) | event-driven | `apps/api/src/common/metrics/read-deny.metrics.ts` | exact |
| `apps/worker/src/processors/builder-events.processor.ts` | service (processor) | event-driven | `apps/worker/src/processors/connector-delivery.processor.ts` | exact |
| `apps/app-builder/src/main.browser.ts` | entry (SPA) | request-response | `apps/renderer/src/read/edit.ts` (browser-only entry) | role-match |
| `apps/app-builder/src/form-designer/FormioBuilderField.tsx` | component | event-driven (builder `change`) | `apps/renderer/src/read/edit.ts:309-312` + RESEARCH Pattern 1/2 | role-match |
| `apps/app-builder/src/auth/session.client.ts` | utility | request-response (cookie) | `apps/renderer/src/read/edit.ts:328` (`credentials: 'same-origin'`) | role-match |
| `apps/app-builder/src/tokens.css` | config (design tokens) | n/a | `prototypes/mockup.html:47-84` | exact |
| `apps/app-builder/src/wizard/*` | component | request-response | `prototypes/mockup.html:1603-1628` | exact |
| `packages/contract/src/builder/*.ts` | config (zod contracts) | transform | `packages/contract/src/connector/connector.ts` | exact |
| `tooling/boundaries.config.mjs` (MODIFIED) | config | n/a | itself — `ALLOWED_EDGES.builder` lines 179-187 | exact |
| `packages/cli/provision.ts` (MODIFIED) | utility (CLI) | event-driven | itself — extend to consume `connector_requests` | exact |
| `packages/domain/src/links/seed-saved-query.lookup.ts` (superseded) | model | CRUD | `read-verifier.service.ts` `SavedQueryLookup` interface stays | exact |
| `apps/api/src/*/*.module.spec.ts` (wiring guards) | test | n/a | `apps/api/src/read/read.module.spec.ts` | exact |
| `apps/api/src/submissions/submission-export.spec.ts` | test | n/a | `apps/api/src/read/status-projection.spec.ts` | exact |
| `apps/api/src/*/*.integration.spec.ts` | test | n/a | `apps/api/src/read/status-surface.integration.spec.ts` | exact |

## Pattern Assignments

### `apps/api/src/auth/auth.module.ts` (config, request-response)

**Analog:** `apps/api/src/read/read.module.ts`

**Config reader with named boot failure** (lines 35-92) — the OIDC env vars (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, redirect URI) get the same treatment as `READ_LINK_CONFIG_KEYS`:

```typescript
export const READ_LINK_CONFIG_KEYS = [
  'JWT_ISSUER',
  'JWT_AUDIENCE',
  'JWT_READ_PUBLIC_KEY',
  'RENDERER_ORIGIN',
] as const;

export function readReadLinkConfig(): ReadLinkConfig {
  const missing = READ_LINK_CONFIG_KEYS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error('READ_LINK_CONFIG_INVALID: must set ' + missing.join(', '));
  }
  // …expandPem for multi-line PEM values (lines 72-74):
  // value.replace(/\\n/g, '\n') — .env.example is single-line shell
}
```

**Factory-provider module shape** (lines 146-227) — every new module mirrors this; note the two factory idioms: token factories with `inject`, and class-token factories where the class takes an optional param (lines 188-194, the `SeedSavedQueryLookup` case — "letting Nest reflect that would make it try to inject an Array"):

```typescript
@Module({
  imports: [MongoModule],
  controllers: [ReadController],
  providers: [
    redisCacheProvider,
    {
      provide: 'READ_LINK_CONFIG',
      useFactory: (): ReadLinkConfig => readReadLinkConfig(),
    },
    {
      provide: 'READ_LINK_JWT_VERIFIER',
      useFactory: (config: ReadLinkConfig): ReadLinkJwtVerifier =>
        new ReadLinkJwtVerifierImpl(config.publicKey, config.issuer, config.audience, config.previousPublicKey),
      inject: [{ token: 'READ_LINK_CONFIG', optional: false }],
    },
    // …
    {
      provide: SeedSavedQueryLookup,
      useFactory: (): SeedSavedQueryLookup => new SeedSavedQueryLookup(),
    },
    {
      provide: ReadVerifierService,
      useFactory: (jwt, permissionCheck, submissions, savedQueries, denyService, revisions, tokenStore) =>
        new ReadVerifierService(jwt, permissionCheck, submissions, savedQueries, denyService, revisions, tokenStore),
      inject: [
        { token: 'READ_LINK_JWT_VERIFIER', optional: false },
        PermissionCheckService,
        SubmissionRepository,
        SeedSavedQueryLookup,
        ReadDenyService,
        SubmissionRevisionsRepository,
        LinkTokenStore,
      ],
    },
  ],
})
export class ReadModule {}
```

**Imports convention** (lines 1-24): `@akane/domain` and `@akane/platform` barrel imports first, then relative `./controller.js` (NodeNext `.js` extension on relative imports — the boundary resolver requires it, `boundaries.config.mjs:25-28`).

---

### `apps/api/src/auth/auth.controller.ts` + `app-builder.controller.ts` + `submissions.controller.ts` + `users.controller.ts` (controller)

**Analog:** `apps/api/src/read/read.controller.ts`

**Imports + DI** (lines 1-16, 40-55) — constructor injection with `@Inject(TOKEN)` for factory tokens and `@Res()` for raw Express responses:

```typescript
import { Controller, Get, Post, Query, Param, Body, Res, Logger, Inject } from '@nestjs/common';
import type { Response } from 'express';

import { ReadDenyReason, type RateLimitScope } from '@akane/contract';
import { ReadVerifierService, type ReadVerifyResult, /* … */ } from '@akane/domain';
import type { ReadLinkConfig } from './read.module.js';

@Controller('l')
export class ReadController {
  private readonly rendererOrigin: string;

  constructor(
    private readonly verifier: ReadVerifierService,
    private readonly submissions: SubmissionRepository,
    // …
    @Inject('READ_SIGNATURE_BLOCKS') private readonly signatureBlocks: SignatureBlockRecorder,
    @Inject('READ_LINK_CONFIG') config: ReadLinkConfig,
  ) {
    this.rendererOrigin = config.rendererOrigin;
  }
```

**Request-response handler shape** (lines 57-86) — guard-clause validation first, service call, branch on result, `res.status().json()` or redirect; denial logging by named reason:

```typescript
@Get('view/:jti')
async view(@Param('jti') routeJti: string, @Query('token') token: string, @Res() res: Response): Promise<void> {
  if (!token) {
    this.redirectToDead(res, ReadDenyReason.bad_signature);
    return;
  }
  const result: ReadVerifyResult = await this.verifier.verify(token);
  if (result.ok) {
    logger.log(`view access granted: jti=${result.claims.jti} app=${result.claims.app_id} sub=${result.claims.sub}`);
    res.status(200).json({ claims: result.claims, submission: result.submission ?? null });
    return;
  }
  logger.warn(`view access denied: reason=${result.reason}`);
  await this.denyResult(res, routeJti, result.reason);
}
```

---

### `apps/api/src/auth/session.middleware.ts` (middleware, request-response)

**Analog:** `packages/platform/src/redis/redis.provider.ts` (Redis client seam) — the session store rides the existing ioredis producer profile; no `express-session` (RESEARCH "Don't Hand-Roll #5": the D-101 semantics — pre-login PKCE verifier, IdP-session-lifetime tracking, OIDC-subject linkage — are bespoke).

**Redis producer client** (lines 34-63) — reuse `redisCacheProvider`'s connection profile, never a second prefix layer:

```typescript
export function buildRedisOptions(profile: RedisProfile): RedisOptions {
  return { maxRetriesPerRequest: profile === 'blocking' ? null : PRODUCER_MAX_RETRIES_PER_REQUEST };
}
export function createRedisClient({ url, profile }: RedisClientConfig): IORedis {
  return new IORedis(url, { ...buildRedisOptions(profile), lazyConnect: true });
}
export const redisCacheProvider: Provider = {
  provide: REDIS_CACHE,
  inject: [ConfigService],
  useFactory: (config: ConfigService): IORedis =>
    createRedisClient({ url: config.getOrThrow<string>('REDIS_CACHE_URL'), profile: 'producer' }),
};
```

**Cookie issuance contract (D-101, from RESEARCH Pattern 4):** `Set-Cookie: __Host-akane_sid=<opaque-id>; Path=/; HttpOnly; Secure; SameSite=Strict` — all five attributes asserted in an E2E test (Pitfall 5). The SPA never reads `document.cookie`.

---

### `apps/api/src/auth/oidc.service.ts` (service, request-response) — NO ANALOG

**Pattern source:** RESEARCH Pattern 4 (`openid-client` 6.8.8 v6 flat API, verified from official v6 README). First OIDC usage in the repo. Flow: `discovery` at module init → `randomPKCECodeVerifier` + `calculatePKCECodeChallenge` at begin (verifier+state stashed in the Redis session) → `buildAuthorizationUrl` → `authorizationCodeGrant(config, currentUrl, { pkceCodeVerifier, expectedState })` at callback → `tokens.id_token.claims()` → MFA gate on `acr`/`amr` (D-102: refuse with `AUTH_MFA_REQUIRED`) → auto-provision `real_user` keyed to `sub` (D-104) → **never mint the OIDC subject into our own JWT** (PII-in-JWT constraint). ESM-only package (`type: module`) — same constraint as `jose`, no migration cost.

---

### `packages/domain/src/builder/app-definition.repository.ts` + `connector-request.repository.ts` + `saved-query.repository.ts` (model, CRUD)

**Analog:** `packages/domain/src/registry/app.repository.ts`

**Repository shape** (lines 1-34) — `MongoService` injected, private `collection` getter, `findOne`/`updateOne` with `$set` + `$setOnInsert` upsert:

```typescript
import { MongoService } from '@akane/platform';

export interface AppDocument {
  readonly app_id: string;
  readonly connector_ref: string;
  readonly updatedAt?: Date;
}

export class AppRepository {
  constructor(private readonly mongo: MongoService) {}

  private get collection() {
    return this.mongo.db().collection<AppDocument>('apps');
  }

  async findByAppId(appId: string): Promise<AppDocument | null> {
    return this.collection.findOne({ app_id: appId });
  }

  async upsert(appId: string, connectorRef: string): Promise<void> {
    await this.collection.updateOne(
      { app_id: appId },
      { $set: { connector_ref: connectorRef, updatedAt: new Date() }, $setOnInsert: { app_id: appId } },
      { upsert: true },
    );
  }
}
```

**R3 boundary rule:** repositories live in `packages/domain/src/**/data-access/**` (or are injected via `MongoService`) — only `mongo-owner` and `data-access` categories may import the `mongodb` driver (`boundaries.config.mjs` R3, lines 384-397).

**G-11 replacement specifics** (`saved-query.repository.ts`): implements the **same `SavedQueryLookup` interface** — "replaced by a repository-backed implementation of the same interface, with no change to the verifier" (`seed-saved-query.lookup.ts:25-27`). The interface and frozen record shape come from `read-verifier.service.ts`:

```typescript
// packages/domain/src/links/read-verifier.service.ts:48-54
export interface SavedQueryRecord {
  readonly query_id: string;
  readonly query_version: number;
  readonly dsl: unknown;      // validated at load by DslService.parse — stored contract, not trusted
  readonly intents: readonly string[];
  readonly app_id: string;
}
// findSavedQuery(queryId, appId) — keys on (app_id, query_id), NEVER query_id alone
// (seed-saved-query.lookup.ts:29-34: a query_id-only lookup lets app A's link resolve app B's query)
```

**Keying rule** (`seed-saved-query.lookup.ts:50-53`): `recordKey = \`${appId}:${queryId}\`` — carry it into the repository's unique index.

---

### `packages/domain/src/builder/app-definition.service.ts` + `connector-request.service.ts` (service, CRUD + event-driven)

**Analog:** `packages/domain/src/audit/audit.repository.ts` (every mutation is an audited transition, Pitfall 7)

**Append-only audit entry** (lines 1-34) — `append` is the only write; no update/delete exists structurally:

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
  [key: string]: unknown;
}
export class AuditRepository {
  async append(entry: AuditEntry): Promise<void> { /* push a copy */ }
  // AUD-01: append-only - no update or delete operations
  // This is enforced structurally by not providing update/delete methods
}
```

**D-98 transition shape** (RESEARCH Code Example 4): every `connector_requests` transition appends — `audit.append({ timestamp, actor, action: 'connector_request.provisioned', target: request_id, previous_state: 'pending', new_state: 'provisioned' })`. Publish/deprecate/archive/transfer are first-class service methods, never bare `$set`s (Pitfall 7 warning sign: "a repository method that `$set`s lifecycle fields without an accompanying `append`").

**D-99 request document** mirrors `ConnectorSeed` minus the secret (`packages/cli/connector.ts:11-22`):

```typescript
export interface ConnectorSeed {
  readonly connector_ref: string;
  readonly connector_id: string;
  readonly name: string;
  readonly base_url: string;
  readonly credential_ref: string;
  readonly timeout_ms?: number;
  readonly retries?: number;
  readonly rate_limit?: Record<string, unknown>;
  readonly mapping?: Record<string, unknown>;
  readonly taxonomy?: Record<string, unknown>;
}
// ConnectorRequestDocument = the above minus the secret value, plus:
// request_id, app_id, requested_by, state: 'pending' | 'provisioned' | 'rejected',
// reason?, credential_ref? (set by operator), requestedAt, resolvedAt?
```

**Operator provision path** (`packages/cli/connector.ts:38-95` `upsertConnector` + `packages/cli/provision.ts:1-13`): the CLI reads the pending request, the operator supplies the credential value, then `credsRepo.upsert(credential_ref, headerName, plaintext)` → `registry.register(...)` → request state `provisioned` + AUD-01 append. D-110 trims the identity-admin roles out of the CLI — it keeps read/DLQ/reconcile only.

---

### `packages/domain/src/builder/publish-gate.service.ts` (service, transform)

**Analog:** `apps/api/src/read/status-projection.ts` (pure function over an input interface, no I/O)

**Pure-projection shape** (lines 36-142) — typed input interface, exhaustive branch on state, user-safe reason mapping, and the field allowlist discipline the export also needs:

```typescript
export interface StatusProjectionInput {
  submission?: { app_id?: string; form_id?: string; created_at?: Date | string; status?: string; [key: string]: unknown };
  queryRow?: QueryRow;
  latestRevision: SubmissionRevisionDocument | null;
  connectorName?: string;
  taxonomyCode?: TaxonomyCode;
}
export function projectSubmissionStatus(input: StatusProjectionInput): StatusRow { /* … */ }
```

**Publish gate result** (RESEARCH Code Example 5): `{ allowed, shareDrops: [{app_id, points}], descriptionCollisionWith: string | null, changeSummary: [{field, from, to}] }`. Behaviour fixed by APP-07/APP-08: dry-run through the **real** Phase-3 `RoutingOrchestrator`/`PublishedAppLoader` read-only; block if any existing app's `routing_share` drops >5 points; block on description collision; the BLD-06 change summary is built from the same comparison. Gate executes **before** any state change (Pitfall 8).

---

### `packages/domain/src/builder/routing-share/routing-share.metrics.ts` (utility, event-driven)

**Analog:** `apps/api/src/common/metrics/read-deny.metrics.ts`

**OTel instrument registration** (lines 74-119) — memoised registration (a second `createCounter` on the same name yields a second live instrument and double-counts), one meter (`METER_NAME` from `@akane/platform`), low-cardinality labels fixed by code:

```typescript
import { metrics, type Counter } from '@opentelemetry/api';
import { METER_NAME } from '@akane/platform';

let cached: ReadDenyRecorder | undefined;

export function registerReadDenyMetrics(): ReadDenyRecorder {
  if (cached === undefined) {
    const meter = metrics.getMeter(METER_NAME);
    const denials: Counter = meter.createCounter(READ_LINK_DENIALS_METRIC, { description: '…' });
    cached = Object.freeze({
      recordDenial: (reason: ReadDenyReason, action: ReadDenyAction): void => {
        denials.add(1, { reason, action });
      },
    });
  }
  return cached;
}
```

**OBS-05 specifics:** `routing_share{app_id}` is a **distribution over the labelled intent set** (Pitfall 9 — "a metric that can only go up" is the warning sign), not a counter; the publish dry-run consumes the same per-intent outcome records so gate and exported metric cannot disagree. Single metrics path: OTel metrics API → `exporter-prometheus` (OBS-01).

---

### `apps/worker/src/processors/builder-events.processor.ts` (service, event-driven)

**Analog:** `apps/worker/src/processors/connector-delivery.processor.ts`

**Processor shape** (lines 1-32) — Zod job schema, `WorkerHost` extension, constructor injection with `@Inject` tokens, `process(job)` parsing then branching on state:

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { z } from 'zod';

const DeliveryJobSchema = z.object({
  submissionId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  connectorRef: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});
export type DeliveryJobData = z.infer<typeof DeliveryJobSchema>;

@Injectable()
@Processor('connector-delivery')
export class ConnectorDeliveryProcessor extends WorkerHost {
  constructor(
    private readonly revisionsRepo: SubmissionRevisionsRepository,
    private readonly connectorRegistry: ConnectorRegistry,
    private readonly rateLimiter: ConnectorRateLimiter,
    @Inject(BUSINESS_METRICS_RECORDER) private readonly metrics: BusinessMetricsRecorder,
  ) { super(); }

  async process(job: Job<DeliveryJobData>): Promise<void> {
    const data = DeliveryJobSchema.parse(job.data);
    // …state-machine branches; throw for transient failure (BullMQ backoff retries),
    // return for terminal outcomes
  }
}
```

---

### `apps/app-builder/src/main.browser.ts` + `form-designer/FormioBuilderField.tsx` (entry/component, event-driven)

**Analog:** `apps/renderer/src/read/edit.ts:309-312` — the browser-guarded dynamic import (Pitfall 1: a static import of `@formio/js` in any Node-executed file throws `document is not defined`):

```typescript
const { Formio } = (await import('@formio/js')) as {
  Formio: { createForm: (el: HTMLElement, schema: unknown, opts?: unknown) => Promise<{ setSubmission: (s: unknown) => void; on: (ev: string, cb: () => void) => void }> };
};
await import('@formio/js/dist/formio.full.min.css');
```

**Builder surface** (RESEARCH Pattern 1) — same guard, `Formio.builder()` instead of `createForm()`:

```typescript
const { Formio } = await import('@formio/js');
const builder = await Formio.builder(containerEl, existingSchema ?? {}, {});
builder.on('change', (form) => { /* form === current schema */ });
// builder.schema — always the current form definition
// builder.setForm(schema) — restores a form (the undo/redo restore path)
```

**React ↔ FormIO DOM ownership** (Pitfall 4): mount in a ref'd `<div>` treated as a **leaf** — React never renders children inside it; updates flow only through `builder.setForm()`/builder API calls in effects. RESEARCH Code Example 1 gives the full component shape (`useEffect` + `cancelled` flag + mount-once `[]` deps).

**BLD-04 undo/redo** (RESEARCH Pattern 2): FormIO 5.6.1 has **no builder undo/redo API** — schema-snapshot history: debounced (300 ms) `builder.schema` captures on `change`, 50-entry ring buffer, restore via `builder.setForm(snapshot)`. RESEARCH Code Example 2 is the `SchemaHistory` class verbatim.

**5.x breaking changes** (Pitfall 2): `component.error` → `component.errors` (array, read `.errors[0].message`); `EditGrid.validateRows` returns an **array** (`isValid = validateRow(...).length === 0`); Bootstrap 5 is the default template (Bootstrap-4-era templates need porting — S1 spike verifies).

---

### `apps/app-builder/src/auth/session.client.ts` (utility, request-response)

**Analog:** `apps/renderer/src/read/edit.ts:328` — the fetch posture the SPA copies (`credentials: 'same-origin'`; the httpOnly cookie rides along automatically):

```typescript
const res = await fetchImpl(`${deps.apiOrigin}/l/edit/${deps.jti}?${tokenQuery}`, {
  method: 'POST',
  credentials: 'same-origin',
  redirect: 'manual',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify((submission as { data?: Record<string, unknown> })?.data ?? {}),
});
```

**D-101 posture:** the SPA holds **no token** — only the `__Host-` cookie; CSRF is SameSite=Strict plus an origin/double-submit check on state-changing calls. Warning sign (Pitfall 5): any `document.cookie` read in the SPA.

---

### `apps/app-builder/src/tokens.css` + `wizard/*` (config/component)

**Analog:** `prototypes/mockup.html:47-84` — the `:root` token set, reused verbatim (AGENTS.md: a new color or typeface not derived from these is a defect):

```css
:root{
  --ink:#0e1420; --ink-2:#151d2e; --ink-3:#1e283c;
  --canvas:#f6f8fa; --surface:#ffffff; --surface-2:#f0f3f7;
  --line:#e2e8f0; --line-strong:#cbd5e1;
  --text:#101828; --text-2:#475467; --muted:#667085;
  --accent:#0f9d8f; --accent-strong:#0b7d72; --accent-soft:#e4f5f2;
  --amber:#b7791f; --amber-soft:#fdf5e6;
  --red:#c0392b; --red-soft:#fdecea;
  --green:#2f855a; --green-soft:#e8f5ee;
  --blue:#2b6cb0; --blue-soft:#eaf2fb;
  --violet:#6b5bd2; --violet-soft:#eeebfb;
  --radius-xs:6px; --radius:8px; --radius-lg:12px;
  --shadow-sm:0 1px 2px rgba(16,24,40,.06);
  --shadow:0 4px 14px rgba(16,24,40,.08);
  --shadow-lg:0 24px 48px rgba(16,24,40,.20);
  --sans:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --display:"Space Grotesk","IBM Plex Sans",system-ui,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --topbar-h:60px; --side-w:250px; --od-gap:8px;
}
```

**Wizard IA** (`prototypes/mockup.html:1603-1628`): 5-step rail **Basics → Triggers → RBAC → Form → Routing**; step 1 fields = App name, App ID ("Lowercase, hyphenated. Immutable after first publish."), Description, data-mode pills (internal/external/hybrid — "Chosen in step 5"); "Create app" → "Saved as a draft · continue through the wizard steps". Publish modal (lines ~1590-1601): change-summary rows + "Confirm publish". **The mockup is not a spec** (Pitfall 14) — behaviour comes from `REQUIREMENTS.md`; where the mockup's implied data shape disagrees with a frozen contract (D-21, D-73), **the contract wins**.

---

### `packages/contract/src/builder/*.ts` (config, transform)

**Analog:** `packages/contract/src/connector/connector.ts`

**Zod 4 contract shape** (lines 27-47) — `.strict()` schemas, opaque ids, required-not-optional booleans where absent must not default:

```typescript
import { z } from 'zod';

const opaqueId = z.string().min(1);

export const ConnectorDescriptorSchema = z
  .object({
    id: opaqueId,
    name: z.string().min(1),
    supports_idempotency_key: z.boolean(),
  })
  .strict();

export type ConnectorDescriptor = z.infer<typeof ConnectorDescriptorSchema>;
```

New builder contracts (app draft/version shapes, connector-request shape, mapping fixtures) are **added beside** the frozen ones — never modify `packages/contract/src/links/read-link-claims.ts` (D-21) or the D-73 record shape.

---

### `tooling/boundaries.config.mjs` (MODIFIED — config)

**Analog:** itself — `ALLOWED_EDGES.builder` (lines 179-187). The `builder` element type already exists (`DOMAIN_ELEMENT_TYPES`, lines 38-58) but its edges lack `identity`, `links`, `contract` — the builder domain needs those for D-104 auto-provision, the G-11 saved-query write, and builder-facing contracts. **Deliberate, reviewed change:**

```javascript
builder: Object.freeze([
  'platform',
  'kernel',
  'registry',
  'forms',
  'authz',
  'connectors',
  'audit',
  // Phase 6 additions (builder domain imports these):
  'identity',  // D-104 auto-provision
  'links',     // G-11 saved-query write (D-73 shape)
  'contract',  // builder-facing shapes
]),
```

**Load-bearing facts** (lines 14-23): policies are **last-match-wins** and permissive edges must be declared before R1/R2/R3 restrictions, or the restrictions are overwritten. The SPA (`apps/app-builder/src/**`) matches **no** element pattern — it sits outside the graph, identical status to `apps/renderer` today (root `tsconfig.json:3-31` references only tooling, packages/*, apps/api, apps/worker, apps/scheduler).

---

### `apps/api/src/*/*.module.spec.ts` (test — wiring guards)

**Analog:** `apps/api/src/read/read.module.spec.ts` (lines 1-64) — asserts the DI graph itself via `Reflect.getMetadata`, because booting the real module needs Mongo+Redis+secrets and the failure mode is structural:

```typescript
import { describe, expect, it } from 'vitest';
import { ReadVerifierService, SeedSavedQueryLookup } from '@akane/domain';
import { ReadModule } from './read.module.js';

interface ProviderShape {
  readonly provide?: unknown;
  readonly inject?: unknown;
  readonly useFactory?: (...args: never[]) => unknown;
}

describe('ReadModule wiring (G-11)', () => {
  const providers = (Reflect.getMetadata('providers', ReadModule) ?? []) as ProviderShape[];
  const verifier = providers.find((p) => p.provide === ReadVerifierService);

  it('declares the production saved-query store', () => {
    expect(providers.some((p) => p.provide === SeedSavedQueryLookup)).toBe(true);
  });

  it('binds the store into the ReadVerifierService inject list', () => {
    expect(verifier).toBeDefined();
    expect(Array.isArray(verifier?.inject)).toBe(true);
    expect(verifier?.inject).toContain(SeedSavedQueryLookup);
  });

  it('places the store in the savedQueries position when the factory runs', () => {
    expect(typeof verifier?.useFactory).toBe('function');
    const store = new SeedSavedQueryLookup();
    const service = verifier!.useFactory!({} as never, {} as never, {} as never, store as never, {} as never, {} as never, {} as never);
    expect(service).toBeInstanceOf(ReadVerifierService);
    expect((service as unknown as { savedQueries?: unknown }).savedQueries).toBe(store);
  });
});
```

Apply to every new `apps/api` module (auth, app-builder, submissions, users): assert the seam is declared, bound into the consumer's inject list, and lands in the right factory position.

---

### `apps/api/src/submissions/submission-export.spec.ts` (test)

**Analog:** `apps/api/src/read/status-projection.spec.ts` — the allowlist test (lines 108-146) is the D-111 export discipline: project exactly the viewer's visible columns, and assert no extra keys:

```typescript
it('never includes non-allowlisted fields', () => {
  const row = projectSubmissionStatus({
    submission: { /* …, secretToken: 'should-not-appear', password: 'bad', piiEmail: 'test@test.com' } as any },
    latestRevision: { /* …, data: { sensitive: 'data' } */ },
    connectorName: 'Redmine',
  });
  const keys = Object.keys(row);
  expect(keys).toEqual(expect.arrayContaining(['app_id', 'form_id', 'submittedAt', 'status', 'destination']));
  expect((row as any).secretToken).toBeUndefined();
  expect((row as any).password).toBeUndefined();
  expect((row as any).piiEmail).toBeUndefined();
  expect((row as any).sensitive).toBeUndefined();
  expect((row as any).data).toBeUndefined();
});
```

**D-111 export:** visible columns = projected status, app/form, timestamps, downstream ref, safe reason; CSV via `csv-stringify` 6.9.0 (the *writer* — `csv-parse` only parses, Pitfall 11). Never spread `submission.data` into a CSV row (Pitfall 10).

---

### `apps/api/src/*/*.integration.spec.ts` (test)

**Analog:** `apps/api/src/read/status-surface.integration.spec.ts` (lines 20-44) — `Test.createTestingModule` with `useValue` stubs for domain services, a `createRes()` helper for Express responses:

```typescript
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

function createRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}
// …verifier/repo stubs as `{ method: vi.fn().mockResolvedValue(...) } as unknown as Service`
```

**State the spec's scope in its header** (lines 1-18): the status-surface spec documents that it stubs the verifier and "would pass whether or not the production saved-query store is wired" — that is exactly how G-11 hid. Wiring is proven separately by the `.module.spec.ts` guard; say which spec proves what.

---

### `packages/domain/src/builder/template/template.seed.ts` + seeds (config, file-I/O)

**Analog:** `packages/domain/src/seeds/saved-queries.seed.json` (lines 1-34) — the D-31/D-105 seed file shape (JSON array of records, idempotent loader, platform-owned):

```json
[
  {
    "query_id": "qry_pending_leave",
    "query_version": 1,
    "app_id": "leave-request",
    "intents": ["list pending leave requests", "what leave is awaiting approval"],
    "dsl": { "filters": { "op": "eq", "field": "data.status", "value": "pending" }, "sort": [{ "field": "created_at", "dir": "desc" }], "limit": 50 }
  }
]
```

**D-105/D-108:** ~10 template apps as seed files covering absence/leave, travel, procurement, asset, HR request, ticketing (mostly internal-only) + 1–2 external/hybrid examples. "Use template" **forks** a deep copy into a user-owned draft — a snapshot with **no origin reference**. Tags use the curated platform set (D-107) — free-form typing is rejected. Frontend-bundled catalogues are rejected (invisible to the registry, un-audited).

---

### Credential storage (cross-cutting — D-100)

**Analog:** `packages/platform/src/crypto/envelope.ts` + `production-guard.ts` + `packages/domain/src/connectors/data-access/connector-credentials.repository.ts`

**Envelope** (lines 80-93, 118-157) — frozen `{ v: 1, alg: "A256GCM", kid, iv, tag, ct }`; auth tag stored AND verified; fresh random 12-byte IV per encryption; plaintext and key never reach a log:

```typescript
export interface SecretEnvelope {
  readonly v: typeof ENVELOPE_VERSION;   // 1
  readonly alg: typeof ENVELOPE_ALG;     // 'A256GCM'
  readonly kid: string;
  readonly iv: string;                   // base64url, 12 bytes
  readonly tag: string;                  // base64url, 16 bytes — verified on every decrypt
  readonly ct: string;                   // base64url
}
export async function encryptSecret(plaintext: Buffer | string, keyProvider: KeyProvider): Promise<SecretEnvelope> { /* … */ }
export async function decryptSecret(envelope: SecretEnvelope, keyProvider: KeyProvider): Promise<Buffer> { /* … */ }
```

**Production guard** (`production-guard.ts:96-112`) — the fail-closed reference D-100 routes through, never around:

```typescript
export function assertKeyProviderAllowed(config: KeyProviderGuardConfig): void {
  if (config.NODE_ENV === 'production' && config.CRYPTO_KEY_PROVIDER !== 'kms') {
    throw new Error(`CRYPTO_KEY_PROVIDER_REQUIRED: production requires kms, got ${config.CRYPTO_KEY_PROVIDER}`);
  }
  if (!localKeyProviderAllowed(config)) {
    throw new Error(`CRYPTO_KEY_PROVIDER_REQUIRED: the local key provider requires NODE_ENV=development or test, or CRYPTO_LOCAL_KEY_ALLOWED=true; …`);
  }
}
```

**Credential repository** (`connector-credentials.repository.ts:25-52`) — the operator's provision target; `@Inject(CRYPTO_KEY_PROVIDER)` supplies the key provider:

```typescript
@Injectable()
export class ConnectorCredentialsRepository {
  constructor(private readonly mongo: MongoService, @Inject(CRYPTO_KEY_PROVIDER) private readonly keyProvider: KeyProvider) {}

  async upsert(credentialRef: string, headerName: string, plaintext: string): Promise<void> {
    const envelope = await encryptSecret(plaintext, this.keyProvider);
    await this.collection.updateOne({ _id: credentialRef }, { $set: { envelope, headerName, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  }
}
```

---

## Shared Patterns

### Factory-provider module composition
**Source:** `apps/api/src/read/read.module.ts:146-227`
**Apply to:** every new `apps/api` module (auth, app-builder, submissions, users)
- Token factories with `inject: [{ token: 'X', optional: false }]`; class-token factories when the class takes an optional param (Nest would otherwise try to inject an Array — lines 188-194).
- Config read at module init via a named-keys array + `missing.join(', ')` failure (`READ_LINK_CONFIG_INVALID:`); PEM values expanded from `\\n` (`.env.example` is single-line shell).
- Wiring guard spec per module (`read.module.spec.ts` pattern) asserting the seam is declared and lands in the right factory position.

### Audited transitions (D-86/D-98, Pitfall 7)
**Source:** `packages/domain/src/audit/audit.repository.ts:13-34`
**Apply to:** `app-definition.service.ts`, `connector-request.service.ts`, publish gate, lifecycle (deprecate/archive/transfer)
- Every mutation appends `AuditEntry { timestamp, actor, action, target, previous_state, new_state }`.
- Publish/deprecate/archive/transfer are first-class service methods, not field writes.

### Field allowlist before serialization (D-43/W-22, D-111)
**Source:** `apps/api/src/read/status-projection.ts` + `status-projection.spec.ts:108-146`
**Apply to:** submissions viewer/export, every list surface, the dashboard, audit log browse
- Project exactly the visible columns; assert no extra keys in the spec.

### Zod 4 Standard Schema validation
**Source:** `packages/contract/src/connector/connector.ts:27-47`; `apps/worker/src/processors/connector-delivery.processor.ts:12-19`
**Apply to:** all new DTOs, `connector_requests` shape, publish-gate inputs, session config, job payloads
- `.strict()` object schemas; `z.infer` for the handler type; job data parsed inside `process()`.

### Redis-backed state, stateless services (AD-9)
**Source:** `packages/platform/src/redis/redis.provider.ts:34-63`
**Apply to:** builder session store (D-101), PKCE verifier+state (pre-login), OTP state machine (IDN-05: 10-min TTL / 3 attempts / 30-min lockout)
- Reuse the `producer` profile connection (`redisCacheProvider`); no `keyPrefix` layering (D-14).

### Browser-guarded `@formio/js` import (Pitfall 1)
**Source:** `apps/renderer/src/read/edit.ts:309-312`
**Apply to:** every SPA file that touches FormIO (form designer, preview pane, any route rendering a form)
- Dynamic `await import('@formio/js')` inside a browser-only entry; never a static import in Node-executed files; FormIO container is a React leaf (Pitfall 4).

### Frozen contracts consumed, never reshaped
**Source:** `packages/contract/src/links/read-link-claims.ts` (D-21), `packages/domain/src/links/read-verifier.service.ts:48-54` (D-73)
**Apply to:** builder writes D-73 records keyed `(app_id, query_id)`; new builder contracts land **beside** frozen ones in `packages/contract/src/builder/`.

### Boundary graph discipline
**Source:** `tooling/boundaries.config.mjs:14-23, 134-207, 179-187`
**Apply to:** all new `packages/domain/src/builder/**` files
- `default: 'disallow'` — an unlisted edge is a build failure; policies last-match-wins; extend `ALLOWED_EDGES.builder` with `identity`, `links`, `contract` as a deliberate reviewed change; R3 keeps raw `mongodb` imports in `data-access/**` only.

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/api/src/auth/oidc.service.ts` | service | request-response | First `openid-client` usage — RESEARCH Pattern 4 (v6 flat API) is the source |
| `apps/api/src/auth/session.middleware.ts` | middleware | request-response | First hand-rolled session middleware — RESEARCH "Don't Hand-Roll #5" justifies bespoke over `express-session` |
| `apps/app-builder/**` (SPA) | component | request-response | First React app in repo — `apps/renderer` (vanilla TS) is the browser-entry analog; mockup is the IA/token source |
| `apps/app-builder/src/form-designer/*` | component | event-driven | `Formio.builder()` never used in-repo (renderer only mounts `createForm`) — RESEARCH Patterns 1/2 + S1 spike |
| `packages/domain/src/builder/routing-share/*` (computation) | utility | event-driven | `routing_share` computation is new — only the *registration* pattern exists (`read-deny.metrics.ts`) |
| `submission-export.service.ts` (CSV writer) | service | batch | First CSV writer — `csv-stringify` 6.9.0 is a new dep (Pitfall 11: `csv-parse` parses, it does not write) |

## Metadata

**Analog search scope:** `apps/api/src/**`, `apps/renderer/src/**`, `apps/worker/src/**`, `packages/domain/src/**`, `packages/contract/src/**`, `packages/platform/src/**`, `packages/cli/**`, `tooling/**`, `prototypes/**`
**Files scanned:** 30+ (all `git ls-files`-verified tracked; no gitignored mirrors)
**Pattern extraction date:** 2026-10-11
