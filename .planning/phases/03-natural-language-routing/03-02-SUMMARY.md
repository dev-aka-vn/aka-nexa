---
phase: 03-natural-language-routing
plan: 02
subsystem: decision-routing
tags: [provider-registry, provider-health, deadline-propagation, decision-cache, jev, rbac-gate]
dependency_graph:
  requires: [packages/contract/src/jev, packages/domain/src/authz, packages/platform/src/redis]
  provides: [ProviderRegistry, ProviderHealthService, DecisionCacheService, deadline-budgeting RoutingOrchestrator]
  affects: [apps/worker]
tech_stack:
  added: []
  patterns: [config-ordered-provider-chain, absolute-deadline-budget, skip-until-healthy-60s, canonical-cache-key-scoped-by-epoch]
key_files:
  created:
    - packages/domain/src/decision/provider-registry.ts
    - packages/domain/src/decision/provider-registry.spec.ts
    - packages/domain/src/decision/provider-health.service.ts
    - packages/domain/src/decision/provider-health.spec.ts
    - packages/domain/src/decision/decision-cache.service.ts
    - packages/domain/src/decision/decision-cache.integration.spec.ts
    - packages/domain/src/decision/routing-orchestrator.spec.ts
  modified:
    - packages/domain/src/decision/routing-orchestrator.ts
    - packages/domain/src/index.ts
    - packages/domain/tsconfig.json
    - apps/worker/src/worker.module.ts
decisions:
  - "Terminal-link invariant is a construction-time throw naming the expected rule-based provider; dropping a hosted entry never touches the terminal link (a post-filter assertion catches a hosted-tagged rule-based entry)"
  - "Budget is budget = min(deadline - now, provider cap); the race keeps the chain inside the shared epoch even when a provider hangs — a losing provider's late rejection is swallowed so it cannot surface as an unhandledRejection"
  - "isSkipped is false for never-probed providers (fail-open until the first probe records a failure); assertLocalHealthy throws only on a recorded failed/stale result — unprobed presence is the boot assertion's job, not the probe loop's"
  - "DecisionCacheService keys are computed only — the RBAC re-filter and permission gate still run on every hit; the cache is an input to the gate, never an authority"
metrics:
  duration_minutes: ~20
  completed: 2026-10-07
  tasks: 3
  files: 11
status: complete
actuals:
  tokens: 10291
  tasks: 3
  commits: 3
plan_head_before: f40ca215128ef8bcc17c38c8353dd32e659726eb
plan_head_after: bee63e6
---

# Phase 03 Plan 02: Provider Chain Superstructure Summary

The tracer's single-provider gate is expanded into the full routing superstructure: config-ordered provider registry with the rule-based terminal link asserted at construction, a shared absolute deadline threaded through every chain hop, 60-second provider health probes with skip-until-healthy semantics, and the RTE-09 decision cache keyed to canonical same-thread context — all without touching the frozen v1 wire shape.

## What Was Built

- `ProviderRegistry` — DI-registered providers in config order. Every chain must end with `RULE_BASED_PROVIDER_NAME` or construction throws (RTE-05 boot failure, not a runtime surprise). A `hosted: true` entry is admitted only with both halves of the D-56/D-58 attestation (named region approval + no-training/no-retention commitment); otherwise it is dropped with a loud boot log. Zero hosted providers is a fully supported local-only mode (D-59), never a boot failure. Capability-gated conversation shapes filter the chain per provider (a `multi_turn` shape skips a provider not advertising it). Per-attempt caps are exposed keyed by provider name.
- `ProviderHealthService` — a 60-second, unref'd `setInterval` sampling `provider.healthCheck()` (injection-point `now` for staleness pinning). A provider is usable only while its latest probe succeeded and is fresh; a failed or stale last probe is a skip signal. `assertLocalHealthy` throws `LOCAL_PROVIDER_UNHEALTHY` for the terminal rule-based link — its health is the only guarantee.
- `RoutingOrchestrator` — one absolute `deadlineEpochMs` from IM receipt; each hop computes `remaining = deadline - now`, and each provider attempt gets `min(remaining, cap)` from the same epoch via `Promise.race` — never a fresh 2000 ms. A stalled or hung provider degrades to the next link; budget exhaustion mid-chain yields clarify and the next provider is never invoked. Rule-based unhealthiness throws loudly; hosted-only outages still route locally. The 03-01 gate contract is unchanged: frozen schema in/out, `verified === true` only, permitted tool, threshold, fresh `canOpenNow`, no competing alternative, remaining budget.
- `DecisionCacheService` — `jev:decision:<user>:<conversation>:<perm_epoch>:<pub_threshold_version>:<sha256(canonicalText|sortedToolIds|locale)>` over the REDIS_CACHE ioredis client (cache deployment, no `keyPrefix`, TTL configurable). `canonicalSameThreadText` is the full bounded same-thread context (question + clarification replies), so a single-turn entry can never satisfy a multi-turn follow-up. An epoch bump makes old keys unreachable by construction; `invalidate()` is the explicit belt. Neither plaintext nor raw hash is logged (D-57).
- `WorkerModule` — providers wired through the registry; `ProviderHealthService` starts on `onApplicationBootstrap` and stops on shutdown; orchestrator gets the registry chain, health service, and attempt caps.

## Deviations from Plan

- **[Harness adaptation]** `decision-cache.integration.spec.ts` starts a single Redis container from the same `REDIS_IMAGE` / `CACHE_MAXMEMORY_POLICY` constants in `tooling/containers.ts` instead of `startThreeContainers()` — mongo:8.0 does not boot on this host's kernel (6.19+, JIRA SERVER-121912), which would take the whole suite down with it for testing zero Mongo behavior. Same root cause as the deferred onboarding container failures in 03-01.
- **[Placement]** `provider-health.service.ts` landed in the Task 1 commit (a660837): `worker.module.ts` and the domain barrel (both committed there) import it, so the Task 1 commit would not have compiled standalone. Its spec moved to the Task 2 commit.

## Threat Surface Scan

No new network endpoints or schema changes beyond the plan's threat_model. T-03-06 (deadline DoS) is mitigated by one absolute epoch threaded through every hop; T-03-07 (cache elevation of privilege) by user/conversation/perm-epoch/publication-version scoping plus fresh RBAC re-filtering and schema re-validation on every hit; T-03-08 (information disclosure) by the no-plaintext/no-raw-hash logging discipline; T-03-09 (hosted tampering) by the D-56/D-58 construction gate; T-03-10 (health DoS) by the 60s probe cadence and loud local-provider failure. No new packages installed (T-03-SC).

## Self-Check: PASSED

- All 11 files exist at the recorded paths.
- Commits a660837, 51d3535, bee63e6 are ancestors of HEAD.
- `npm test -- packages/domain/src/decision` → 44 passed (6 files); `npx tsc -b` green; boundary lint clean (22 pre-existing lint errors in untouched Phase-2 files remain, per 03-01's deferred list). `npm run build`'s lint stage still fails on those pre-existing errors — the new code introduces zero new violations.
