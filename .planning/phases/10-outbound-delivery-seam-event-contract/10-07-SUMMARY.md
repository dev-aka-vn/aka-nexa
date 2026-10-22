---
phase: 10-outbound-delivery-seam-event-contract
plan: 07
subsystem: platform bootstrap / domain adapters / api+worker composition roots
tags: [adapter-coverage, boot-assertion, OUT-03, T-10-06, boundary-manifest]
requires: [packages/platform/src/bootstrap/process-capabilities.ts, packages/domain/src/index.ts, apps/worker/src/processors/outbound-delivery.registry.ts]
provides: [IM_ADAPTER_WIRING, assertAdapterCoverage, ApiAdapterCoverageRunner, AdapterCoverageRunner, OUTBOUND_DELIVERY_REGISTRATIONS]
affects: [apps/api/src/app.module.ts, apps/worker/src/app.module.ts, apps/api/src/bootstrap/**, apps/worker/src/bootstrap/**, packages/domain/src/adapters/coverage/**, packages/platform/src/bootstrap/process-capabilities.ts]
key-files:
  - packages/domain/src/adapters/coverage/im-adapter-coverage.ts
  - packages/domain/src/adapters/coverage/im-adapter-coverage.spec.ts
  - apps/api/src/bootstrap/adapter-coverage.runner.ts
  - apps/api/src/bootstrap/adapter-coverage.boot.spec.ts
  - apps/worker/src/bootstrap/adapter-coverage.runner.ts
  - packages/platform/src/bootstrap/process-capabilities.ts
key-decisions:
  - "Assertion lives in domain/adapters/coverage, not platform-events — platform-events is a leaf with no dependency beyond the driver, and the module needs ImPlatformSchema from @akane/contract"
  - "It sits beside (not inside) adapters/**/inbound and adapters/**/outbound so R1's one-process-per-category restriction does not apply"
  - "IM_ADAPTER_WIRING is the single declaration both composition roots read; each process asserts only the direction it owns"
  - "Unwired platforms are reported, not fatal — failing boot for zalo/telegram would make the phase that wires Teams unshippable"
  - "Slack is recorded as inbound-wired / outbound-null rather than omitted"
requirements-completed: [OUT-03]
duration: ~1h
completed: 2026-10-22
---

# Phase 10 Plan 07 — Boot-time adapter coverage assertion

## What changed

| File | Change |
|---|---|
| `packages/platform/src/bootstrap/process-capabilities.ts` | New `OUTBOUND_DELIVERY_REGISTRATIONS` capability token |
| `packages/domain/src/adapters/coverage/im-adapter-coverage.ts` | New — `IM_ADAPTER_WIRING` + `assertAdapterCoverage` + `analyzeRegistrations` |
| `apps/api/src/bootstrap/boundary-manifest.ts` | Forbids `OUTBOUND_DELIVERY_REGISTRATIONS` (T-10-06) |
| `apps/worker/src/bootstrap/boundary-manifest.ts` | Names it as an allowed capability |
| `apps/api/src/bootstrap/adapter-coverage.runner.ts` | New — `ApiAdapterCoverageRunner` + `API_INBOUND_ADAPTERS` |
| `apps/api/src/bootstrap/adapter-coverage.boot.spec.ts` | New — four real Nest boots |
| `apps/worker/src/bootstrap/adapter-coverage.runner.ts` | New — `AdapterCoverageRunner` |
| `apps/worker/src/app.module.ts` | Provides the capability from the registry; registers the runner |
| `apps/api/src/app.module.ts` | Provides `INBOUND_ADAPTER_REGISTRATIONS`; registers the runner |
| `packages/domain/src/index.ts` | Exports the coverage surface |

## The failure modes this closes

Both are silent at runtime, which is why a test alone could not catch them:

1. **Missing adapter** — a platform nobody sends to drops every message with
   no error, because no route exists.
2. **Duplicate adapter** — worse, and code review passes it: neither adapter is
   individually wrong, but the two disagree about the shared conversation key,
   so events are double-processed or addressed to a row the other adapter never
   wrote.

## The declaration, and why one exists

`IM_ADAPTER_WIRING` is the pairing. `api` asserts inbound, `worker` asserts
outbound — neither process can see the other's registrations, which is the
boundary. The declaration is the thing both read, so the pair cannot drift
without one of the two assertions failing.

Slack is recorded as `inbound: 'SlackWebhookController', outbound: null`.
That is Phase 10's true state (D-10-04-2: no bot token), and writing it down
is the difference between a reviewed deferral and an invisible omission.

Zalo and telegram are `unwired` — Phase 12 and Phase 13 have not landed.
`wiredPlatforms()` scopes the assertion to declared platforms, so those two
are reported by `unwiredPlatforms()` for the roadmap rather than crashing the
process that wires Teams.

## Why not a runtime guard

A per-message guard would spend the ack budget on a registry lookup (D-13, T-10-06)
and would still only fire after the first message was lost. Boot is the only
point where the question is free — and both runners fire in
`onApplicationBootstrap`, the instant `ProviderBoundaryGuardRunner` uses, so a
violation aborts a process before it accepts any work.

## Verification

| Check | Result |
|---|---|
| `npm run build` (lint + `tsc -b`) | exit 0 |
| `im-adapter-coverage.spec.ts` | 13/13 |
| `adapter-coverage.boot.spec.ts` (real Nest boots) | 4/4 |
| `tooling/boundaries.fixture.spec.ts` | 9/9 |

## Deviations

1. **Plan's suggested location was wrong.** 10-07-PLAN asked for
   `OUTBOUND_DELIVERY_REGISTRATIONS` in `packages/platform/src/bootstrap/
   process-capabilities.ts` — that part is fine. The assertion itself was
   planned for `provider-boundary-guard.ts`, but `packages/platform` has no
   dependency on `@akane/contract` and cannot read `ImPlatformSchema`. The
   assertion moved to `packages/domain/src/adapters/coverage/`, which already
   imports `@akane/contract` for OUT-12's ports.
2. **Moved the boot spec out of `packages/domain`.** Its first home imported
   the api runner across a project reference, which broke `tsc -b`
   (`rootDir` violations). It now lives beside the runner it tests, in
   `apps/api`.
3. **Rule 2 (decision):** added `API_INBOUND_ADAPTERS` as an explicit list
   rather than deriving it. Nest offers no "which controllers are in the
   graph" query that is not this list rewritten, and the list's value is that
   editing it is what OUT-03 checks.

## Build hygiene note

`npx tsc -b --clean` after the initial move left stale `.d.ts` outputs that
TypeScript then treated as inputs (`TS5055`); `rm -rf packages/*/dist` and a
dependency-ordered rebuild (`contract` → `platform` → `domain`) resolved it.
No `dist/` artefact was committed.

## Deferred

- Slack outbound port implementation (D-10-04-2 — Phase 10 ships the port
  only; the registry registers Teams).
- Zalo/telegram adder rows in `IM_ADAPTER_WIRING` (Phase 12/13).
