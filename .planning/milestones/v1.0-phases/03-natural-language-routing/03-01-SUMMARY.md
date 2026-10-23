---
phase: 03-natural-language-routing
plan: 01
subsystem: decision-routing
tags: [jev, rule-based-provider, routing-orchestrator, rbac-filtering, worker]
dependency_graph:
  requires: [packages/contract/src/jev, packages/domain/src/identity, packages/domain/src/authz]
  provides: [RuleBasedProvider, RoutingOrchestrator, PublishedAppLoader, InboundEventProcessor routing path]
  affects: [apps/worker, packages/domain]
tech_stack:
  added: []
  patterns: [frozen-schema-gate-at-both-boundaries, rbac-filter-before-provider, absolute-deadline, provider-chain-terminal-rule-based]
key_files:
  created:
    - packages/domain/src/decision/rule-based.provider.ts
    - packages/domain/src/decision/routing-orchestrator.ts
    - packages/domain/src/decision/published-app-loader.ts
    - packages/domain/src/decision/rule-based.provider.spec.ts
    - packages/domain/src/decision/decision-routing.integration.spec.ts
    - apps/worker/src/processors/inbound-event.processor.spec.ts
  modified:
    - apps/worker/src/processors/inbound-event.processor.ts
    - apps/worker/src/worker.module.ts
    - packages/domain/src/index.ts
    - packages/domain/src/links/link-issuer.service.ts
    - packages/domain/tsconfig.json
    - apps/worker/tsconfig.json, apps/api/tsconfig.json
    - packages/contract/src/jev/jev-v1.frozen.spec.ts
    - tooling/boundaries.config.mjs
decisions:
  - "verified === true is the only routable state; verified:false and verified:null never produce a link (D-23 reconciliation; AI-SPEC §2 prose superseded, recorded in commit message b21b2e9, not source prose)"
  - "Decision module imports @akane/contract; decision's boundary allow-edge extended to include contract"
  - "@akane/domain root barrel exports decision/identity/links; worker + api tsconfig project-reference domain (api previously deep-imported a domain source path without a reference, breaking tsc -b)"
  - "LinkIssuerService stub replaced with a deterministic tracer stand-in; the seam (issue({appId, realUserId}) -> url) is what slash and message paths share"
  - "WorkerModule seeds PublishedAppLoader/RuleBasedProvider via useFactory with the seeded leave-request app; 03-02 replaces the seams with real per-app RBAC list and RTE-09 cache"
metrics:
  duration_minutes: ~45
  completed: 2026-10-07
  tasks: 3
  files: 15
status: complete
actuals:
  tokens: 10164
  tasks: 3
  commits: 3
plan_head_before: 08653c915d94e32115c6469195da01c2444004a8
plan_head_after: 8acfe164c5ffb1b9a16852a86d0702c5f4c2e24e
---

# Phase 03 Plan 01: Natural-Language Routing Vertical Slice Summary

One thin vertical slice of plain-language routing: EN and VI messages reach the same signed-link path as `/leave request`, RBAC filters the provider payload, and every abstention/threshold/ambiguity path clarifies instead of linking.

## What Was Built

- `RuleBasedProvider` (terminal offline provider, RTE-05) — NFC-normalized, case-folded substring matching over published declared aliases for EN and VI; negation guard (`not|don't|không|đừng`), `state.force_clarification`, and unsupported locale all force abstention; a sole match yields `confidence: 1, verified: true`; multiple matches yield ≤3 alternatives and clarification; self-validates both frozen boundaries with `JevRequestSchema.parse` / `JevResponseSchema.parse`. `healthCheck()` reports `healthy` with `model_version: 'rules-v1'`.
- `RoutingOrchestrator` — the AI-SPEC §4 gate: `JevRequestSchema.safeParse` before any provider call (fail → clarify, no rejected-field logging), single-provider chain for now (03-02 expands), `JevResponseSchema.safeParse` after, matching `spec_version`/`request_id`, absolute deadline check, and a link only when `choice.verified === true` AND `!clarification_needed` AND permitted tool AND finite confidence in `[0,1]` AND `>= threshold(id)` AND no permitted alternative AND `canOpenNow` AND budget remains. Clarify outcome lists ≤3 authorized, reauthorized alternatives.
- `PublishedAppLoader` — published, non-deprecated apps filtered to the requesting user's currently authorized set; owner declarations are the intent/alias source of truth (D-52); no central phrase catalogue.
- `InboundEventProcessor` — `InboundEventSchema` validation; `slash_command` takes the deterministic Phase 2 path and never constructs a `JevProvider` (RTE-02, spy-verified); `message` resolves identity → fresh per-app RBAC candidate list → `RoutingOrchestrator` → link through the shared `LinkIssuerService` seam or clarification. `occurred_at + 2000ms` seeds the absolute deadline (T-03-04).
- `LinkIssuerService` — stub replaced with a deterministic tracer stand-in behind the same seam (real jose ES256 signing from Phase 2 replaces the body without touching call sites).

## D-23 Reconciliation

AI-SPEC §2's "false = confident choice" prose is superseded by the frozen schema behavior and the AI-SPEC §4 gate. The tested implementation treats only `verified === true` as routable; `verified: false` still parses at the schema boundary (legal wire state) but the orchestrator gate never routes it; `verified: null` with a real `tool_id` is rejected by the frozen schema's total-abstention refinement. Documented in commit b21b2e9 and here — not in source prose.

## Deviations from Plan

- **[Rule 3 - Blocking]** `apps/api` deep-imported `packages/domain` source without a project reference, so `tsc -b` failed. Added `apps/api/tsconfig.json → packages/domain` reference.
- **[Rule 3 - Blocking]** `packages/domain` imported `@akane/contract` without a reference, and the boundary `decision` element disallowed the `contract` edge. Added tsconfig reference and the `decision → contract` allow-edge in `tooling/boundaries.config.mjs`.
- **[Rule 3 - Blocking]** The workspace's `node_modules` had drifted to a partial pnpm layout (no `@akane/*` links, no project references resolvable). Restored with `npm ci` from the committed `package-lock.json`; removed untracked `pnpm-lock.yaml`/`pnpm-workspace.yaml` strays.
- **[Deviation]** `LinkIssuerService` stub body replaced (Pitfall 5: stubs are replaced, not wired over). The plan precondition accepts an injectable seam; slash and message paths share this one seam, which is what the parity test proves.

## Deferred Items

- Pre-existing lint failures (22 errors) in Phase-2 files (`apps/api/src/adapters/slack/*`, `permission.guard.ts`, `apps/renderer/src/prefill.ts`, `packages/domain/src/audit`, `rbac.service.ts`) — untouched, out of scope.
- `tooling/onboarding.spec.ts` boot tests fail on MongoDB replica-set container health checks in this environment (Docker infra, unrelated to this plan's changes). Reproduces on the plan's base.
- 03-02 owns chain expansion (health probes, RTE-09 cache, per-provider deadlines), clarification sessions, and the conformance suite.

## Threat Surface Scan

No new network endpoints, auth paths, file access, or schema/trust-boundary changes beyond the plan's threat_model. The provider payload is RBAC-filtered (T-03-01), response is Zod-gated with `verified === true` only (T-03-02), clarification copy is worker-owned and ≤3 authorized alternatives (T-03-03), absolute deadline from `occurred_at` (T-03-04), negation/force_clarification/unsupported-locale abstention (T-03-05). No new packages installed (T-03-SC).

## Self-Check: PASSED

- All 15 files exist at the recorded paths (created/modified via this plan).
- Commits 67bc107, b21b2e9, 8acfe16 are ancestors of HEAD.
- Automated verifies: `npm test -- packages/domain/src/decision apps/worker/src/processors` → 29 passed; frozen-spec + integration spec → 17 passed; rule-based spec → 9 passed; `tsc -b` green; boundaries fixture + onboarding non-container tests green.
