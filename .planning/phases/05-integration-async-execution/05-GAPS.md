# Phase 05 — Verification Gaps

Recorded 2026-10-11, after an ad-hoc verification pass over phase 05 (all nine plans
had SUMMARYs, but no `05-VERIFICATION.md` existed and `05-VALIDATION.md` was never
completed from its `draft` seed).

This file is the finding, not the fix. Each gap names its evidence, what it blocks,
and — where a gap is a **product decision** rather than a missing mechanic — says so
explicitly, because inventing a threshold here would be inventing policy.

**Nothing in this file was caused by the phase-05 execution session**; these are
pre-existing gaps the pass surfaced, several of which the SUMMARYs claim as done.

---

## Substantive gaps (code does not do what the phase claims)

### G-1 — CON-05: the connector rate limiter does not exist — ✅ CLOSED 2026-10-11

**Blocks:** success criterion 5 (*"one app's spike fails that app and not every app
sharing the connector"*), CON-05.

**Resolution (commit `CON-05`):** the primitive moved to
`packages/platform/src/redis/redis-rate-counter.ts` (`incrementFixedWindow`, one Lua
`INCR`+`PEXPIRE` script — the same atomicity implementation for both CON-05 and AUD-10,
since `connectors` and `links` cannot import each other). The policy lives in
`packages/domain/src/connectors/connector-rate-limiter.ts` (`ConnectorRateLimiter`,
keyed `ak:rl:connector:<ref>`, 60/min `DEFAULT_CONNECTOR_LIMIT`), reachable by the
worker. The delivery processor resolves the registry **first** (unknown `connector_ref`
throws before the limiter — fail-closed), then consults the limiter, then calls out;
over budget throws `ConnectorRateLimitedError`, a transient condition BullMQ's backoff
retries. The app-local orphan `apps/api/src/common/throttler/throttler-storage-redis.ts`
and its spec were deleted. `packages/domain/src/connectors/rate-limit.integration.spec.ts`
is now 5 real assertions over real Redis, including the `shared connector budget` name
the validation map cites. The three decisions the gap named are made explicitly (see
the file headers): budget = the seed's `rate_limit.requests_per_minute`, else 60/min;
over-budget = transient retry; placement = domain.

**Evidence**

- `apps/api/src/common/throttler/throttler-storage-redis.ts` defines a **local**
  `ThrottlerStorage` interface and an `@Injectable` implementation. Nothing imports
  it: the only importer in the repo is its own spec.
- There is no `ThrottlerModule`, no `ThrottlerGuard`, and `@nestjs/throttler` is not a
  dependency of any workspace.
- The connector delivery path
  (`apps/worker/src/processors/connector-delivery.processor.ts`) never consults a
  budget before calling out.
- Plan 05-05's `<action>` instructs *"keep the existing interface shape so it drops
  into the existing throttler wiring"*. That wiring has never existed, so the
  assumption in the plan was false before the plan ran.
- 05-05-SUMMARY.md claims `Deviations from Plan: None` and `Self-Check: PASSED` while
  its task-3 deliverable, `packages/domain/src/connectors/rate-limit.integration.spec.ts`,
  was three `expect(true).toBe(true)` cases. It has since been reduced to `it.skip`
  with the blocking reason (commit `57d91430`).
- The validation map seeded **before** execution cites
  `rate-limit.integration.spec.ts -t "shared connector budget"`; no test of that name
  was ever written.
- **Placement is also wrong:** the storage sits in `apps/api` but its only plausible
  consumer is the worker's delivery processor, which cannot import app code.

**What a fix needs** — a product decision the plan does not make:

1. The per-connector budget and window (the plan only says "conservative default,
   never unlimited", with no number).
2. What an over-budget call does to the submission: treat as transient and retry
   (status stays `partial`), or fail the submission for that app.
3. Where the limiter lives — domain (reachable by worker) rather than `apps/api`.

**Interim state:** the vacuous spec no longer reports green. *(Superseded — the spec is
now 5 real assertions and the limiter is wired; see the resolution above.)*

### G-2 — AUD-10 / LNK: the read path enforces no rate limit

**Blocks:** AUD-10, NFR-SEC-6 (per-user 10/min, per-app 100/min).

**Evidence**

- `packages/contract/src/links/rate-limit-key.ts` is a **frozen phase-1 contract**: a
  key scoped to `user` or `link` `jti`, *"never per IP"*, with *"block only on
  signature failure"* documented as its second half. Its only consumer in the repo is
  its own spec.
- `apps/api/src/read/read.controller.ts` performs no rate-limit check on any route.
- The address scope is deliberately absent from the union, so the limiter this contract
  describes cannot be the `@nestjs/throttler` default (which tracks by IP).

**What a fix needs:** the threshold and window for signature failures per user and per
jti — again a policy value. The key shape and the block rule are already pinned by the
frozen contract, so the *mechanic* is specified; only the numbers are not.

### G-3 — `LinkTokenStore.consume()` has no caller (recorded, not a defect)

`packages/domain/src/links/link-token.store.ts` implements `consume()` via Redis
`GETDEL`, and its spec covers single-use. No product code calls it: the edit link's
single-use claim is the **partial unique index on `edit_jti`**, enforced at the insert
inside `DataRouterService.routeEdit`. Recorded because the file header for the edit path
describes the claim as token consumption, which overstates what the token store does.
Not changed — the index is the stronger mechanism (it holds under concurrency, which a
read-then-consume would not).

### G-4 — six api source files are unreachable from `main.ts`

**Blocks:** FND-03 (the `entrypoint-drift` spec asserts this and is the suite's only
failure: 1 failed / the rest passed).

```
apps/api/src/adapters/slack/slack-commands.controller.ts
apps/api/src/adapters/slack/slack-webhook.controller.ts
apps/api/src/adapters/slack/slack.module.ts
apps/api/src/common/filters/link-error.filter.ts
apps/api/src/common/guards/permission.guard.ts
apps/api/src/submissions/submissions.controller.ts
```

*(Was seven. `apps/api/src/common/throttler/throttler-storage-redis.ts` was the one file
fixable in phase-5 scope; it closed with G-1 and was deleted rather than left orphaned.)*

**Root cause:** phase 2 (identity + IM ingress) was never wired. `AppModule` imports
`ReadModule`, the platform modules and `HealthController`, and nothing else.

**Why they were not wired to satisfy the test** — wiring the Slack surface as it stands
would be a **security regression**. Both controllers are:

```ts
// Placeholder implementation for Plan 02-01
return { ok: true };
```

They verify no signing secret, so registering them would expose `/slack/events` and
`/slack/commands` as unauthenticated endpoints that answer 200 to anyone — while still
violating Slack's 3-second ack contract. `submissions.controller.ts` is an empty class.
The honest state is that these files are phase-2 scaffolding, and the test is right to
fail on them.

- `link-error.filter.ts` is **not** a NestJS filter — it is a static utility holding
  `LinkErrorCode` and `READ_DENY_REASON_COPY`, duplicated by
  `read.controller.ts`'s own `redirectToDead`. Consolidating it is a behaviour choice.
- `permission.guard.ts` depends on `PermissionCheckService`; it has no route to guard
  until the phase-2 submission surface exists.

**What a fix needs:** phase 2. Not bounded; do not bolt on.

---

## Bookkeeping gaps (the record disagrees with the repo)

### G-5 — `STATE.md` is incoherent

`current_phase: 04` while `current_phase_name: "Integration & Async Execution"` (that
name is phase 5, and phase 4 is the read path); `completed_phases: 3` with
`total_plans: 37 / completed_plans: 37`; `current_plan: 7` against the same file's
"Total Plans in Phase: 9"; `status: shipped`. Reconciled in commit TODO-STATE.

### G-6 — `ROADMAP.md` phase statuses disagree with the plans

- Phase 4 is `[x]` and qualified *"(plans created)"*, but its plan `04-06` still has an
  unticked checkbox.
- Phases 2 and 3 are `[ ]` although all their plan checkboxes are ticked — and their
  code is unwired (G-4), so the `[ ]` is the *accurate* half of that disagreement.
- Phase 5 is `[ ]`: correct. It is not complete (G-1, G-2).

### G-7 — `05-VALIDATION.md` was never completed

`status: draft`, `nyquist_compliant: false`, `wave_0_complete: false`, and every row of
its requirement→test map still reads `File Exists? ❌ Wave 0`. Two of its cited commands
named tests that did not then exist (`-t "shared connector budget"`,
`-t "consume replay ttl"`); **both names now exist** (`rate-limit.integration.spec.ts`
and `edit-link.integration.spec.ts` respectively), so those two rows are runnable. It is
still a pre-execution seed, not a record: the remaining rows have not been executed and
the status/wave flags are unchanged.

### G-8 — `05-05-SUMMARY.md` overstates its result

`deviations: []`, `Self-Check: PASSED`, and the body describes the CON-05 behaviour as
delivered. It was not (G-1). Recorded so the SUMMARY is not relied on as evidence.

### G-9 — phase 05 has no verification artifact

No `05-VERIFICATION.md` and no UAT record. `/gsd-verify-work` (or
`/gsd-validate-phase`) has not been run for this phase.

---

## What the pass did find verified

Stated so this file is not read as "nothing works":

- **SC#4 / LNK-02 is now genuinely verified** against real MongoDB and Redis —
  `apps/api/src/read/edit-link.integration.spec.ts`, 5 passed (commit `57d91430`).
- **CON-05 is now genuinely implemented and verified** — `ConnectorRateLimiter` wired
  into the worker delivery path, `rate-limit.integration.spec.ts` 5 passed over real
  Redis including the two-process shared-budget case (commit `CON-05`). G-1 closed.
- The remaining phase-05 integration suites assert real behaviour:
  `outbox.integration.spec.ts` (transaction atomicity + rollback),
  `connector-delivery.integration.spec.ts`, `reconciliation.integration.spec.ts`,
  `dlq.integration.spec.ts`, `redmine.contract.spec.ts` (A2 live-gated, documented).
- `npx tsc -b`, `npx eslint .` and `npm run build` are clean.
- Full suite: the single failure is G-4 (six orphans).
