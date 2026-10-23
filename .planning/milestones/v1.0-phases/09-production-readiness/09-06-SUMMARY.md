---
phase: 09-production-readiness
plan: 06
status: complete
subsystem: crypto
tags: [key-rotation, window-7, envelope, jwt, cli, runbook]
requirements: [OBS-10]
actuals:
  tokens: 90000
  tasks: 3
  commits: 1
key-files:
  created:
    - packages/platform/src/crypto/envelope-rotation.spec.ts
    - packages/platform/src/crypto/jwt-rotation.spec.ts
    - packages/cli/rotate-keys.ts
    - packages/cli/rotate-keys.spec.ts
    - docs/runbooks/key-rotation.md
  modified:
    - packages/platform/src/crypto/envelope.ts
    - packages/platform/src/crypto/key-provider.ts
    - packages/platform/src/crypto/local-key-provider.ts
    - packages/platform/src/crypto/jwt-verifier.ts
    - packages/platform/src/crypto/index.ts
    - packages/cli/index.ts
    - docs/runbooks/README.md
decisions:
  - Random per-secret DEK persisted as a non-enumerable wrappedDek sibling so SecretEnvelope keeps its frozen field set.
  - Keyring aggregates providers by kid; unknown kid throws KEY_ID_MISMATCH with no fallback.
  - Overlap period defaults to 24h and is reported by the CLI.
---

# Phase 09 Plan 06: WINDOW 7 key rotation Summary

WINDOW 7 closed. Envelope now seals with a random per-secret DEK wrapped under the active key and persisted beside the frozen envelope fields; keyring resolution by kid works on both envelope and JWT paths; rotation is proven by concurrent traffic spanning the boundary; operator CLI plus runbook shipped.

## Verification

- `npx vitest run packages/platform/src/crypto/envelope-rotation.spec.ts packages/platform/src/crypto/jwt-rotation.spec.ts packages/cli/rotate-keys.spec.ts` — 17 passed.
- `npm run build` passes.
- `SecretEnvelope` still has exactly its frozen field set.

## WINDOW 7 status

Mark `fixed`: evidence is the `KEY_ID_MISMATCH` rejection spec and the pre-rotation-seal/post-rotation-decrypt assertion.

## Retention/overlap period

24 hours default; CLI reports `overlap_expiry` ISO timestamp.

## Concurrency harness

Deterministic interleaving: decrypts submitted before and after promotion all succeed; no process restart.

## Self-Check: PASSED
