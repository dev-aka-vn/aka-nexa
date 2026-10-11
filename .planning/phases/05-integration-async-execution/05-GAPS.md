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

### G-2 — AUD-10: the read path enforces no rate limit — ✅ CLOSED 2026-10-11

**Blocks:** AUD-10, NFR-SEC-6 (per-user 10/min, per-app 100/min).

**Evidence**

- `packages/contract/src/links/rate-limit-key.ts` is a **frozen phase-1 contract**: a
  key scoped to `user` or `link` `jti`, *"never per IP"*, with *"block only on
  signature failure"* documented as its second half. Its only consumer in the repo was
  its own spec.
- `apps/api/src/read/read.controller.ts` performs no rate-limit check on any route.

**Resolution (commit `AUD-10`):** no new policy number was invented after all —
NFR-SEC-10 already pins one (*"max 5 failed link validations per 10 minutes"*). The
AUD-10 ruling changes its **scope**, from per-IP to per-user and per-link-`jti`; the
number carries over. `packages/domain/src/links/signature-failure-limiter.ts` implements
`SignatureFailureLimiter` over the shared `incrementFixedWindow` primitive (the same one
CON-05 uses), keyed per `RateLimitKey` (`ak:rl:sigfail:<scope>:<id>`), 5 failures per
10 minutes per key. The controller calls it **only** for a `bad_signature` denial and
answers 429 + `Retry-After` once a key is exhausted
(`apps/api/src/read/read.controller.ts#denyResult`); every benign reason
(`expired`/`consumed`/`wrong_version`/`deactivated_user`/`denied`/… ) redirects to the
dead-link page exactly as before and is never counted. A `!token` request — no token to
have a signature — is likewise neither counted nor blocked.

Two things the plan did not anticipate, resolved here and worth recording:

1. **The `user` key is not derivable on a failure path.** `ReadVerifyFailure` carries a
   reason and nothing else, and reading the `sub` off an *unverified* token would let a
   forger drive a chosen victim's counter to the block threshold. The read path therefore
   supplies the `link` key only (the `:jti` route segment, which already matched the
   token's `jti` for logging). The `user` scope remains part of the contract for callers
   that hold a *verified* identity. This is a limitation of what a failure path can know,
   not of the limiter.
2. **The counter is the `signature_invalid` series.** AUD-10's alert rule is
   `block > 0 ∧ signature_invalid ≈ 0`. `signature_invalid` is already
   `read_link_denials_total{reason="bad_signature"}`; the block half is the new
   `read_link_signature_blocks_total` counter (label `scope` only), added in
   `apps/api/src/common/metrics/read-deny.metrics.ts` on the same single meter path.

**Verified:** `apps/api/src/read/read.controller.spec.ts` — 5 benign failures never
touch the limiter, a `bad_signature` failure is counted under `link` and answered 429
when the budget is exhausted; `packages/domain/src/links/signature-failure-limiter.integration.spec.ts`
— 4 real over-Redis cases (5th failure blocks, per-`jti`/per-user independence, any-key
blocks, an invalid/empty key throws rather than coalescing callers);
`read-deny.metrics.spec.ts` — block counter naming, scope label, independent memoisation.

### G-10 — OBS-04 / CON-06: the metric instruments exist but nothing emits them — ✅ CLOSED 2026-10-11

**Blocks:** OBS-04 (*"`submission_status{status="partial"}` is exported"*), CON-06
(*"`app_id` is a first-class label on connector metrics"*), CON-07 (the alert split).

**Evidence (as found)**

- `packages/platform/src/metrics/business-metrics.ts` registers
  `submission.status` (`SUBMISSION_STATUS_METRIC`) and `connector.outcome`
  (`CONNECTOR_OUTCOME_METRIC`) as counters on the one `akane` meter, memoised and
  obtained per call — the *registry* half of plan 05-05 task 2 is done.
- **No call site called `.add()` on either.** The only instrument ever
  incremented was `platformHeartbeat`
  (`packages/platform/src/queue/platform-heartbeat.job.ts`). An OTel/Prometheus
  counter with no `add()` and no label combination emits **no series at all**, so
  `submission_status{status="partial"}` was not exported and the `app_id` label
  was carried by nothing. The requirement is stated as *"is exported"*, not
  *"an instrument of that name exists"*, and it is the second half that failed.
- Plan 05-05 task 2 also required extending `business-metrics.spec.ts` to assert
  `submission_status{status="partial"}` and the `app_id`/taxonomy labels. That
  assertion was never written: `-t "submission_status app_id"` matched **no test**.

**Resolution (commit `OBS-04`).** The plan's open assumption — *"emitted at
status transition points only (not polled) … flagged, pending confirmation"* — is
decided here as **emit at the transition**, and the transition the phase already
has is in the worker's `ConnectorDeliveryProcessor`, which is the only place a
`submission_revisions` row moves through `not_sent → sent_unconfirmed →
confirmed`. No new state machine was invented; the emit points are the existing
writes.

- `createBusinessMetricsRecorder()` in `packages/platform/src/metrics/business-metrics.ts`
  is the write seam: `recordSubmissionStatus({appId, status})` and
  `recordConnectorOutcome({appId, outcome, taxonomyCode})`. It holds no state and
  calls `registerBusinessMetrics()` per write, so it always targets the current
  provider rather than a closure-captured instrument (the same reason the meter
  is obtained per call).
- **Why the label vocabulary lives in `platform`:** `platform` may import
  `kernel` and nothing else (`tooling/boundaries.config.mjs`), so it cannot see
  `@akane/contract`. The label unions are declared locally and are structurally
  identical to the contract's `ConnectorErrorCode` / execute `status`, so the
  worker passes its own values with no cast and no new boundary edge.
- **`connector.outcome` carries three labels, not one.** `app_id` (CON-06),
  `outcome` (so a spike of *successful* calls is attributable — CON-06 says
  "traffic spike", not "failure spike"), and `taxonomy_code` (CON-07's split).
  `taxonomy_code` is always present, `none` on a non-failure, so an alert rule
  never has to be written against an absent label. The instrument's own docblock
  previously named only `app_id`/`taxonomy_code` and was updated.
- **`app_id="unknown"` rather than dropping the series** on an attempt with no
  resolvable app — plan 05-05's other flagged assumption, resolved in favour of
  emitting.
- The worker emits `partial` on the two retrying paths and `none` of a connector
  outcome on the rate-limited path: a rate-limited attempt made **no call**, so
  recording a connector outcome would attribute a failure to a connector that
  never ran.

**Verified:** `business-metrics.spec.ts` — the recorder writes
`submission_status{app_id,status}` (the row-11 command now matches exactly one
test), the `partial` series exists, `connector.outcome` carries all three labels,
`credential_rejected` and `endpoint_unreachable` are separable at the metric
layer, and two seams do not double-register the instrument.
`connector-delivery.spec.ts` — the processor writes `sent → partial` on a
transient failure (with `taxonomy_code="none"`), carries a terminal
`credential_rejected` code, and records `app_id="unknown"` rather than nothing.
`connector-delivery.integration.spec.ts` — 2 passed over real MongoDB + Redis.

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

### G-11 — the `query` action is denied unconditionally: `SavedQueryLookup` has no production implementation

**Found by:** `05-VERIFICATION.md` (G-9), then confirmed by reading the code.
**Blocks:** SC#1's second clause (*"the submission shows as `partial` on the user's own
status page"*), **DAT-14**. Not previously recorded — phase-4 and phase-5 verification both
missed it.

**Evidence (each step traced in the code, not inferred)**

- `packages/domain/src/links/read-verifier.service.ts:65` declares the D-73 seam
  `interface SavedQueryLookup { findSavedQuery(queryId, appId) }`. Its fourth constructor
  parameter is **optional** (`savedQueries?: SavedQueryLookup`).
- `verifyQuery` (`read-verifier.service.ts:276-290`) is
  `queryId === undefined || this.savedQueries === undefined ? null : await …` — so with the
  seam absent, `saved === null`, and the very next branch returns
  `{ ok: false, reason: wrong_version }`. There is no fall-through that could succeed.
- `apps/api/src/read/read.module.ts` builds the service as
  `new ReadVerifierService(jwt, permissionCheck, submissions, undefined, denyService, revisions, tokenStore)`
  — the fourth argument is a **hardcoded `undefined`**.
- The dispatch is unconditional: `verify()` switches on `claims.action` and sends every
  `'query'` link straight to `verifyQuery` (`read-verifier.service.ts:201-203`), and
  `ReadController.query` calls `this.verifier.verify(token)` (`read.controller.ts:99`).
  So **every** `query` read link — including the "My submissions" one the status page uses —
  is answered `wrong_version` in production.
- **No production `SavedQueryLookup` exists.** `grep -rn SavedQueryLookup` finds the
  interface, `apps/api/src/read/read.module.ts`, and four **test doubles**
  (`TestSavedQueryLookup` / `makeSavedQueries`). There is no saved-query collection, no
  repository, and no seed anywhere in the repo.
- **The spec masks it.** `apps/api/src/read/status-surface.integration.spec.ts` is named
  "integration" but provides `{ provide: ReadVerifierService, useValue: verifier }` with a
  canned `verify` that already returns `ok: true` **and a populated `savedQuery`** (lines
  31-47). It never constructs the real verifier, never reaches `verifyQuery`, and would pass
  with `savedQueries` wired or not. The validation map's DAT-14 row cites this spec's
  `-t "my submissions"` filter, so that row proves the *projection*, not reachability.

**What a fix needs — a decision, then work that may belong to phase 6**

The read link's `query` action resolves a **saved query** (`SavedQueryRecord`:
`query_id`, `query_version`, `dsl`, `intents`, `app_id`). Nothing in the platform creates a
saved query *at runtime* today — the shape is frozen and seeded
(`packages/domain/src/seeds/saved-queries.seed.json`), but the App Builder that would write
those records is **phase 6**.

`05-VERIFICATION.md` records this as a `gaps_found` item; no code was changed.

**And the lookup is only half of it — see G-13.** Wiring `savedQueries` alone would change
nothing observable: no production component mints a signed read link, so no `query` link can
ever reach the verifier in the first place.

### G-11 addendum — why the lookup was **not** wired, given it is bounded

The seam *is* bounded: `SavedQueryLookup` is declared in `read-verifier.service.ts:65` with a
docblock that explicitly expects "the API module provides the concrete store", and the record
shape is frozen and seeded at `packages/domain/src/seeds/saved-queries.seed.json` (asserted by
`saved-queries.seed.spec.ts`, whose own comment calls it "a *stored contract* — Phase 6's App
Builder writes the same records"). A seed-backed implementation is therefore ~30 lines using
only frozen artefacts, and inventing **no** schema.

It was not written, on purpose: with G-13 unfixed, wiring it is *unobservable* in production
and would let a spec assert "the query action works" against a chain that still mints no
token — the same false confidence that `status-surface.integration.spec.ts` already provides.
Half-wiring a chain is how the next reader concludes it is whole.

### G-13 — nothing mints a signed read link, so the whole read path is verification-only

**Found by:** tracing G-11 to its root. **Blocks:** every read-path requirement end-to-end —
DAT-14's list (`query`), LNK-05/FRM-06 (`view`) and LNK-02 (`edit`). **Not a phase-5 defect to
patch:** it is a deliberate stand-in that was never re-examined for reachability.

**Evidence**

- `packages/domain/src/links/link-issuer.service.ts` is the only `*issuer*` file in the repo.
  Its body returns an **unsigned path fragment** (`/l/<appId>?u=<realUserId>`), with a header
  that says so: *"Trace stand-in for the Phase 2 signed-link issuer (01-CONTEXT D-21 frozen
  claim set, jose ES256) … Real KMS-backed signing replaces this body without changing the
  seam."* It is used only by the worker's `inbound-event.processor.ts`.
- The frozen claim set is **never constructed** anywhere in non-test source. Searching for
  `target_id:` matches only the Zod schema that *parses* it
  (`packages/contract/src/links/read-link-claims.ts:117`); `perm_version:` likewise (`:108`).
  No call site builds a `ReadLinkClaims` value, signs it, and emits a URL.
- `ReadController` therefore has token-gated routes (`view/:jti`, `query/:jti`, `GET`+`POST
  edit/:jti`) that **only a test can exercise** — which is exactly how the phase-4 and phase-5
  suites do exercise them, by hand-crafting tokens in the specs.

**Why this is a deferral and not a bug to fix here**

The stand-in is anchored to **FND-10**, the KMS credential gate this project deliberately keeps
open with local/test credentials only (W-24). A real issuer is a KMS-backed ES256 signer with a
`kid` keyring — the same machinery NFR-SEC-9's rotation needs. Building a test-key stand-in to
"close" DAT-14 would put an unrotated signing key on the critical path of a 90-day-lived token,
which is a security regression, not a fix. So: **recorded, deliberately not implemented.**

**Consequence for the record:** the phase's observable entry points (`/l/*`) are correct
subsystems behind a missing door. Any future claim that a read-path requirement is reachable
end-to-end should first answer "who mints the link?" — for now, nobody.

### G-12 — SC#5(a) and CON-05 state opposite requirements (needs a ruling)

**Found by:** `05-VERIFICATION.md` (G-9). **Blocks:** either SC#5(a) or CON-05, whichever
wins. **This is an escalation, not a missing mechanic — no code change is safe without a
ruling.**

The two texts are not reconcilable:

| Source | Says |
|--------|------|
| `REQUIREMENTS.md:221` — **CON-05** | "Rate limits are enforced per connector **instance, shared across every app referencing it**" |
| `ROADMAP.md:193` — **SC#5(a)** | "One app's traffic spike fails **that app and not every app** sharing the connector" |
| `REQUIREMENTS.md:222` — CON-06 | "`app_id` is a first-class label on connector metrics, so one app's traffic spike can be attributed and **budgeted separately**" |

CON-06 sides with SC#5(a) ("budgeted separately"), CON-05 says the opposite in as many
words ("shared across every app"), and the phase's own `05-05-PLAN.md` reflects the same
split.

**What is implemented today follows CON-05**, deliberately, and the reasoning is recorded in
`packages/domain/src/connectors/connector-rate-limiter.ts`'s header: the key is
`ak:rl:connector:<ref>`, carrying no `app_id`, *because* a per-app key would give each app a
private budget while the downstream system still saw the sum — which the docblock argues is
the failure CON-05 exists to prevent. The behaviour is pinned by a test,
`rate-limit.integration.spec.ts > "shared connector budget — two apps, two processes, one
budget"`, which asserts the **opposite** of SC#5(a) on purpose.

So the suite cannot be made green by a code change alone: whichever way this is ruled, one
of the two statements is wrong and must be amended first. CON-05 was chosen because a
requirement ID is the authority the mockup/contract rules point at, and because
"shared across every app" is the more specific statement — but that is a defensible reading,
not a resolution.

**Evidence**

- `rate-limit.integration.spec.ts:47` — the test name states the implemented semantics.
- `connector-rate-limiter.ts` header — the design note arguing keying on the connector.
- `05-VERIFICATION.md` — scores SC#5 as "(a) FAILED — app-scoped isolation not implemented".

---

## Bookkeeping gaps (the record disagrees with the repo)

### G-5 — `STATE.md` is incoherent — ✅ CLOSED 2026-10-11

`current_phase: 04` while `current_phase_name: "Integration & Async Execution"` (that
name is phase 5, and phase 4 is the read path); `completed_phases: 3` with
`total_plans: 37 / completed_plans: 37`; `current_plan: 7` against the same file's
"Total Plans in Phase: 9"; `status: shipped`. Reconciled by hand in commit `803c8f27`
(`current_phase: 05`, `current_plan: 9`, `completed_phases: 4`, `percent: 50`,
`status: verifying`); `gsd-tools state validate` reports `valid: true`.

### G-6 — `ROADMAP.md` phase statuses disagree with the plans

- Phase 4 is `[x]` and qualified *"(plans created)"*, but its plan `04-06` still has an
  unticked checkbox.
- Phases 2 and 3 are `[ ]` although all their plan checkboxes are ticked — and their
  code is unwired (G-4), so the `[ ]` is the *accurate* half of that disagreement.
- Phase 5 is `[ ]`: still correct, but the reason has changed. G-1 and G-2 (the two
  substantive gaps) are closed; what remains is the missing verification artifact (G-9)
  and the six phase-2 orphans (G-4), neither of which is phase-5 work.

### G-7 — `05-VALIDATION.md` was never completed — ✅ CLOSED 2026-10-11

`status: draft`, `nyquist_compliant: false`, `wave_0_complete: false`, and every row of
its requirement→test map still read `File Exists? ❌ Wave 0`. Two of its cited commands
named tests that did not then exist (`-t "shared connector budget"`,
`-t "consume replay ttl"`); **both names now exist** (`rate-limit.integration.spec.ts`
and `edit-link.integration.spec.ts` respectively), so those two rows are runnable. It was
a pre-execution seed, not a record.

**Resolution:** the map was executed end to end and the file flipped to
`status: validated`, `wave_0_complete: true`, `nyquist_compliant: true`, with every row's
`File Exists?` ✅ and the cited `-t` filters each confirmed to resolve to at least one
test. Row 11 (`OBS-04 / CON-06`) was the last ❌; it closed with commit `OBS-04` (G-10).
Sign-off is APPROVED and is scoped to the *validation map* — see the approval note in the
file, which names G-4 and G-9 as still-open phase-level items.

### G-8 — `05-05-SUMMARY.md` overstates its result

`deviations: []`, `Self-Check: PASSED`, and the body describes the CON-05 behaviour as
delivered. It was not at the time (G-1) — the storage stub was app-local and nothing
imported it. Recorded so the SUMMARY is not relied on as evidence of *how* CON-05 landed:
the real implementation is commit `CON-05`, which puts the primitive in `platform` and
the policy in `domain`. The SUMMARY's claim is now true of the repo, but it was not true
when written, and the deviation it omits is the whole reason CON-05 needed redoing.

### G-9 — phase 05 has no verification artifact — ✅ CLOSED 2026-10-11

No `05-VERIFICATION.md` and no UAT record; `/gsd-verify-work` (or
`/gsd-validate-phase`) had not been run for this phase.

**Resolution:** `05-VERIFICATION.md` now exists (`status: gaps_found`), produced by the
`gsd-verifier` goal-backward pass. It verified 9 of 12 must-have truths and is the source
of G-11 and G-12 below. `/gsd-verify-work` (conversational UAT, which needs a human) is
still not run, so there is still no UAT record — recorded, not hidden.

---

## What the pass did find verified

Stated so this file is not read as "nothing works":

- **SC#4 / LNK-02 is now genuinely verified** against real MongoDB and Redis —
  `apps/api/src/read/edit-link.integration.spec.ts`, 5 passed (commit `57d91430`).
- **CON-05 is now genuinely implemented and verified** — `ConnectorRateLimiter` wired
  into the worker delivery path, `rate-limit.integration.spec.ts` 5 passed over real
  Redis including the two-process shared-budget case (commit `CON-05`). G-1 closed.
- **AUD-10 is now genuinely implemented and verified** — the signature-failure limiter
  is wired into the read controller, benign outcomes are never counted, and a block is
  observable as `read_link_signature_blocks_total` (commit `AUD-10`). G-2 closed.
- **OBS-04 / CON-06 / CON-07 are now genuinely delivered** — the business counters have a
  write seam (`createBusinessMetricsRecorder`) and the worker's delivery processor writes
  `submission_status{app_id,status}` and `connector.outcome{app_id,outcome,taxonomy_code}`
  at the transitions it already performs (commit `OBS-04`). G-10 closed.
- The remaining phase-05 integration suites assert real behaviour:
  `outbox.integration.spec.ts` (transaction atomicity + rollback),
  `connector-delivery.integration.spec.ts`, `reconciliation.integration.spec.ts`,
  `dlq.integration.spec.ts`, `redmine.contract.spec.ts` (A2 live-gated, documented).
- `npx tsc -b`, `npx eslint .` and `npm run build` are clean.
- Full suite (2026-10-11): **892 passed / 1 failed / 0 skipped, 84 files**. The single
  failure is G-4 (six orphans). The three formerly-skipped CON-05 placeholders are now
  real tests, and the +8 over the previous 884 is this pass's OBS-04 work (5 recorder
  assertions in `business-metrics.spec.ts`, 3 emission assertions in
  `connector-delivery.spec.ts`).
