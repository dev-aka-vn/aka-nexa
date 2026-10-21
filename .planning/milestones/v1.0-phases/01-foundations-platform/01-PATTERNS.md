# Phase 1: Foundations & Platform - Pattern Map

**Mapped:** 2026-10-02
**Files analyzed:** ~70 planned targets (new/modified)
**Analogs found:** 0 / 70

## Greenfield Notice

This repository contains **no application source**. `git ls-files` returns only:
`.gitignore`, `.planning/**`, `AGENTS.md`, `PRD.md`, `README.md`. There is no `src/`,
`package.json`, `node_modules`, `packages/`, `apps/`, or CI config.

**Therefore there are zero in-repo analogs and no pattern excerpts can be extracted.**
Planning documents (`PRD.md`, `AGENTS.md`, `.planning/**`) are **not** source analogs.
Phase 1 *is* the pattern-defining phase: it establishes `kernel → platform → domain →
entrypoint`, the typed `LoggerPort` + allowlist formatter, the OSDK-first `main.ts`
bootstrap, and the `.strict()` Zod + frozen-key-set tests that every later phase copies.

**Concrete pattern sources for the planner are the RESEARCH.md code blocks (P1.3/P1.4/P1.5,
P1.6, P2.1, P2.3, P2.4, P2.5, P2.6, P3), not an existing file.** Analog column below is
`none (new)` throughout.

## File Classification

| New/Modified File | Role | Data Flow | Analog | Match |
|-------------------|------|-----------|--------|-------|
| `package.json` (root, workspaces) | config | n/a | none (new) | — |
| `package-lock.json` (first-commit deliverable, FND-02) | config | n/a | none (new) | — |
| `.nvmrc` (contents `24`) | config | n/a | none (new) | — |
| `.gitignore` (extend existing) | config | n/a | none (new) | — |
| `tooling/tsconfig.base.json` | config | n/a | none (new) | — |
| `tooling/boundaries.config.mjs` (settings + R1/R2/R3) | config | n/a | none (new) | — |
| `eslint.config.mjs` (flat; boundaries + `no-restricted-imports` P1.5) | config | n/a | none (new) | — |
| `vitest.config.mts` (root; 3-container setup) | config | n/a | none (new) | — |
| `.github/workflows/ci.yml` (build gate + **separate** install-guard job, D-06) | config | n/a | none (new) | — |
| `packages/kernel/package.json` (no `dependencies` field) | config | n/a | none (new) | — |
| `packages/kernel/tsconfig.json` | config | n/a | none (new) | — |
| `packages/kernel/src/index.ts` | module | transform | none (new) | — |
| `packages/platform/package.json`, `tsconfig.json`, `src/index.ts` | config/module | n/a | none (new) | — |
| `packages/platform/src/config/config.schema.ts` (Zod; named `CONFIG_INVALID:` errors) | config | request-response | none (new) | — |
| `packages/platform/src/config/redis.schema.ts` (distinct host:port superRefine, P2.4) | config | transform | none (new) | — |
| `packages/platform/src/config/config.module.ts` (`validate:` hook, FND-09) | config | request-response | none (new) | — |
| `packages/platform/src/mongo/mongo.module.ts`, `mongo.service.ts` | service | CRUD | none (new) | — |
| `packages/platform/src/redis/redis.constants.ts` (`REDIS_CACHE`/`REDIS_QUEUE` tokens, D-12) | config | n/a | none (new) | — |
| `packages/platform/src/redis/redis.provider.ts` (two profiles; `maxRetriesPerRequest` split, D-14) | provider | request-response | none (new) | — |
| `packages/platform/src/queue/queue.module.ts` (BullMQ `{akane-q}` prefix, D-14) | provider | event-driven | none (new) | — |
| `packages/platform/src/crypto/key-provider.ts` (`KeyProvider` iface, B-3) | interface | transform | none (new) | — |
| `packages/platform/src/crypto/local-key-provider.ts` (prod-refusal guard, D-26) | service | file-I/O | none (new) | — |
| `packages/platform/src/crypto/envelope.ts` (AES-256-GCM `{v,alg,kid,iv,tag,ct}`, D-25) | utility | transform | none (new) | — |
| `packages/platform/src/otel/otel.bootstrap.ts` (`NodeSDK` first statement, D-20) | config | event-driven | none (new) | — |
| `packages/platform/src/otel/span-attribute-allowlist.ts` (frozen constant, D-18) | config | n/a | none (new) | — |
| `packages/platform/src/otel/allowlist-span-exporter.ts` (wrapping `SpanExporter`, P3) | middleware | streaming | none (new) | — |
| `packages/platform/src/logging/logger.port.ts` (typed allowlisted fields, D-15) | interface | transform | none (new) | — |
| `packages/platform/src/logging/log-allowlist.formatter.ts` (`formatters.log`, P2.1) | utility | transform | none (new) | — |
| `packages/platform/src/logging/pino.config.ts` | config | streaming | none (new) | — |
| `packages/platform/src/http/http.module.ts` (category target of R1) | config | request-response | none (new) | — |
| `packages/platform/src/health/health.controller.ts` (`/health/live` + `/health/ready`) | controller | request-response | none (new) | — |
| `packages/platform/src/health/mongo.indicator.ts`, `redis.indicator.ts` (per-dependency, D-10) | service | request-response | none (new) | — |
| `packages/platform/src/metrics/metrics.controller.ts` (Prometheus scrape, OBS-01) | controller | request-response | none (new) | — |
| `packages/contract/package.json`, `tsconfig.json`, `src/index.ts` | config/module | n/a | none (new) | — |
| `packages/contract/src/jev/v1/*.ts` (`.strict()` request/response schemas, D-23) | model | transform | none (new) | — |
| `packages/contract/src/jev/jev-provider.ts` (`JevProvider` iface; `RuleBasedProvider` fallback named) | interface | request-response | none (new) | — |
| `packages/contract/src/connector/connector.ts` (`supports_idempotency_key`, DAT-13) | interface | request-response | none (new) | — |
| `packages/contract/src/events/inbound-event.ts`, `outbound-message.ts` (IM-01) | model | event-driven | none (new) | — |
| `packages/contract/src/links/read-link-claims.ts` (frozen D-21 claim schema) | model | transform | none (new) | — |
| `packages/contract/src/links/token-classes.ts` (`{action,ttl,consume}` table, D-22/AUD-10) | config | n/a | none (new) | — |
| `packages/domain/package.json`, `tsconfig.json`, `src/index.ts` | config/module | n/a | none (new) | — |
| `packages/domain/src/{identity,authz,registry,forms,links,decision,connectors,submissions,datarouter,adapters,pipeline,builder,audit}/` (empty skeletons) | module | n/a | none (new) | — |
| `apps/api/{package.json,tsconfig.json,otel.mjs}` | config | n/a | none (new) | — |
| `apps/api/src/main.ts` (OTel first, `NestFactory.create()`, `enableShutdownHooks()`, port 3000) | entrypoint | request-response | none (new) | — |
| `apps/api/src/app.module.ts` (sole importer of `**/adapters/**/inbound/**` + `**/http/**`, R1) | entrypoint | request-response | none (new) | — |
| `apps/api/src/bootstrap/provider-boundary.guard.ts` (P1.6, ~40 lines) | guard | event-driven | none (new) | — |
| `apps/worker/{package.json,tsconfig.json,otel.mjs}` | config | n/a | none (new) | — |
| `apps/worker/src/main.ts` (`NestFactory.create()`, port 3001) | entrypoint | event-driven | none (new) | — |
| `apps/worker/src/app.module.ts` (sole importer of `**/bullmq/workers/**` + `**/adapters/**/outbound/**`) | entrypoint | event-driven | none (new) | — |
| `apps/worker/src/bootstrap/provider-boundary.guard.ts` | guard | event-driven | none (new) | — |
| `apps/scheduler/{package.json,tsconfig.json,otel.mjs}` | config | n/a | none (new) | — |
| `apps/scheduler/src/main.ts` (`NestFactory.create()`, port 3002) | entrypoint | batch | none (new) | — |
| `apps/scheduler/src/app.module.ts` (sole importer of `**/scheduler/**`) | entrypoint | batch | none (new) | — |
| `apps/scheduler/src/bootstrap/provider-boundary.guard.ts` | guard | batch | none (new) | — |
| `packages/domain/src/**/scheduler/jobs/*.ts` (`upsertJobScheduler`, P2.3, FND-08) | job | batch | none (new) | — |
| `*.spec.ts` — PII 3-level test (D-17) | test | transform | none (new) | — |
| `*.spec.ts` — frozen top-level key set, JEV v1 (RTE-10) + `ReadLinkClaims` (LNK-07) (D-24) | test | n/a | none (new) | — |
| `*.spec.ts` — span-attribute set ⊆ allowlist; `submission_id` absent (D-18) | test | n/a | none (new) | — |
| `*.spec.ts` — both Redis URLs → different host:port (D-12) | test | n/a | none (new) | — |
| `*.spec.ts` — AES-GCM round-trip; key+plaintext absent from logs (D-26) | test | n/a | none (new) | — |
| `*.spec.ts` — boundary violation per category (`--no-ignore`); install-guard smoke (D-03/FND-04) | test | n/a | none (new) | — |
| `*.spec.ts` (testcontainers) — Mongo + cache Redis + queue Redis; queue `noeviction` (D-07) | test | n/a | none (new) | — |

## Shared Patterns (to be established in Phase 1)

No source analogs exist; the **RESEARCH.md snippets are the copy source** for each:

| Cross-cutting concern | Source snippet | Applies to |
|-----------------------|----------------|------------|
| Boundary config (element types, categories, R1/R2/R3) | RESEARCH P1.3 + P1.4 + P1.5 | all `eslint.config.mjs`, `tooling/boundaries.config.mjs`, every package/app |
| Pre-serialise PII allowlist | RESEARCH P2.1 (`formatters.log` rebuild) | all logging, all processes |
| Boot-time named config failure + distinct-host guard | RESEARCH P2.4 + P3 | `config.schema.ts`, `redis.schema.ts` |
| OTel-first bootstrap + wrapping `SpanExporter` | RESEARCH P3 (OTel paragraph) + D-20 | every `main.ts`, `allowlist-span-exporter.ts` |
| AES-256-GCM envelope + `KeyProvider` | RESEARCH P3 (AES) + B-3 | `crypto/**` only (R2) |
| `.strict()` Zod + exact-key-set frozen test | RESEARCH P2.5 + D-24 | all `packages/contract/**` schemas |
| `upsertJobScheduler` idempotent registration | RESEARCH P2.3 | scheduler job registration |
| Runtime `ProviderBoundaryGuard` via `app.container` internals | RESEARCH P1.6 | all three `bootstrap/provider-boundary.guard.ts` |

## Planning Flags (not analog gaps)

- **12 vs 13 domain modules.** CONTEXT D-01 says "12 domain modules"; D-02's element list
  omits `audit`, while RESEARCH P1.3 and ARCHITECTURE's structure include `packages/domain/src/audit/**`
  as a 13th. Planner should confirm the directory count before scaffolding.
- **`entrypoint` element type.** D-02 names one type; R1 needs three distinguishable app types.
  RESEARCH P1.3 recommends `app-api` / `app-worker` / `app-scheduler`. Planner should pick a form
  before writing `tooling/boundaries.config.mjs`.
- **D-27 KMS vendor is a named blocker** — ship interface + production guard only (B-3).
- **ESM decision (open question)** — RESEARCH recommends all three apps `"type": "module"`.
- **Docker availability is unverified** (B-5) — make "Docker daemon reachable" a Wave-0 precondition.

## Metadata

**Analog search scope:** whole repo (`git ls-files`) — returned only planning/docs.
**Files scanned:** 17 tracked files; 0 source files.
**Pattern extraction date:** 2026-10-02
