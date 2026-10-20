# API Coverage — Phase 9: Production Readiness — Compliance, Observability & Load

> Full coverage by default. Opt-outs are explicit, reasoned decisions. This phase declares
> **no external API integration**; the declaration below is the reasoned decision, not a bypass.

No external API integration: Phase 9 adds no third-party API host, SDK, or hosted-service client. Its one new runtime dependency is a first-party NestJS package used in-process, and every remaining surface is a local service already carried by the pinned stack (MongoDB 8.0, Redis, the OTel exporter, BullMQ) or a repository artifact (Prometheus rules, Grafana dashboards, runbooks, a deploy config file).

## Why this is a declaration, not a matrix

Phase 9's work is entirely inward-facing:

| Surface | What it actually is | Why it is not an external-API row |
|---|---|---|
| Audit retention, purge, erasure, query, export, access review | MongoDB collections through the already-pinned native driver | Infrastructure dependency of every phase, reached through a package in `STACK.md §14`; no vendor contract, no capability matrix |
| Throttler storage | The already-owned ioredis cache connection | Same client the platform already uses; no new endpoint, no credential |
| Metric exporters | The already-wired OTLP/Prometheus exporters | Single scrape endpoint, already present; Phase 9 adds instruments, not transports |
| Prometheus alert rules and Grafana dashboards | Files committed to this repository | Evaluated by a Prometheus instance the deployment owns; the repository ships configuration, not a client |
| k6 load scenarios | Scenarios committed to this repository, executed by an external binary against this system's own endpoints | The load generator is a test client for the platform's own API, not an integration with a third party |
| Key rotation | The local `KeyProvider` keyring plus a CLI | The KMS-backed provider remains the Phase-1 recorded blocker below; no cloud KMS is selected here either |

The two container images the new CI jobs pull (`prom/prometheus`, `grafana/k6`) are build-time tooling executed against files in this repository. They are not called by the running application and carry no runtime credential, so they are not an integration surface.

## Deliberately out of scope, and already recorded elsewhere

Phase 9 does **not** re-open the two integration blockers that earlier phases recorded, and it must not be read as closing them:

- **KMS-backed master key** (FND-10, D-27, `WINDOWS.md` row 7's neighbours). Still blocked on naming a deployment cloud (AWS KMS / GCP KMS / Vault transit). Phase 9's rotation work is deliberately written against the `KeyProvider` interface and the `LocalKeyProvider`, so it is correct for whichever vendor is later selected and requires no rework when that decision lands. Selecting `kms` still throws `KMS_PROVIDER_BLOCKED:`.
- **External connector APIs** (Redmine and the other downstream systems). Those belong to the phases that own them; Phase 9 only observes connector *outcomes* through metrics and alerts, which requires no connector client.

## Redis and MongoDB server metrics — a named limitation, not a coverage hole

OBS-06's fifth and sixth conditions (Redis memory above 80%, MongoDB replication lag above 5 s) cannot be satisfied by application instruments: nothing in this repository emits Redis or MongoDB server metrics. Phase 9 handles this by registering those names in an explicit `EXTERNAL_SCRAPED` tier in the emitted-metric registry and by having the infrastructure alert test assert the exporter's presence, so a rule that is silent because the series cannot exist cannot pass green.

This is the same shape as the Phase 1 blocked-integration record: a **named, accepted limitation** rather than a silent hole. Which `redis_exporter` / MongoDB exporter the deployment runs is an infrastructure choice, not an application integration; the repository's obligation is to declare the dependency and make its absence loud, which plan 09-03 and plan 09-04 do.

## Relationship to the Phase 1 declaration

`.planning/phases/01-foundations-platform/COVERAGE.md` declares the same position for the foundations phase and records the KMS blocker. Phase 9 is consistent with it: no external-API row is added, the KMS blocker is carried forward unchanged rather than quietly closed, and the one server-metrics dependency is declared explicitly instead of being absorbed into an application-metric claim.
