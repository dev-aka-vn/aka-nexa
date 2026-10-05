# API Coverage — Phase 1: Foundations & Platform

> Full coverage by default. Opt-outs are explicit, reasoned decisions. This phase declares
> **no external API integration**; the declaration below is the reasoned decision, not a bypass.

No external API integration: Phase 1 is foundations-only and integrates no third-party API, SDK, or hosted service; it uses MongoDB and Redis via pinned official drivers and the pinned OTel exporters.

## Why this is a declaration, not a matrix

Phase 1 builds the monorepo scaffold, the pinned toolchain, boundary enforcement, three ESM process
entrypoints, and the frozen contracts. The only external software it touches — MongoDB 8.0, Redis,
and the OpenTelemetry OTLP/Prometheus exporters — is reached through packages already carried in
`STACK.md §14`; these are infrastructure dependencies of every phase, not an external integration
surface with a capability matrix.

## Blocked external integration carried forward (not a Phase 1 row)

The one genuine third-party-system integration on the Phase 1 requirement list — the **KMS-backed
master-key adapter** (FND-10, D-27) — is **deliberately not implemented** because no deployment cloud
has been named (AWS KMS / GCP KMS / Vault transit). Phase 1 delivers the `KeyProvider` interface, a
`LocalKeyProvider` that refuses to boot under `NODE_ENV=production`, and a startup assertion that
production without `CRYPTO_KEY_PROVIDER=kms` fails boot; selecting `kms` throws
`KMS_PROVIDER_BLOCKED:` until the vendor is chosen. This is a recorded, accepted blocker — not a
silent coverage hole. It must be re-decided before the first real secret is stored in Phase 5.

No other external-API row exists to opt out of at this stage. When the first connector (Redmine)
and the IM adapters (Slack, then Teams) enter their own phases, each starts from the **full-coverage
baseline** for its surface; this file is the durable record that Phase 1 itself had none.
