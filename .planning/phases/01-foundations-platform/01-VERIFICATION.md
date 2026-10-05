---
phase: 01-foundations-platform
verified: 2026-10-05T18:30:00Z
status: passed
score: "13/13 goal-achievement truths verified (9 plan truths + 2 gap-closure truths + 2 deviation truths) · 5/5 ROADMAP success criteria · 4/4 irreversible contracts · 3/3 requirement-conflict rulings · 15/15 requirement IDs accounted for (12 delivered, 3 pending by design)"
covered_files:
  - .env.example
  - .github/workflows/ci.yml
  - .gitignore
  - .nvmrc
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/STATE.md
  - .planning/WINDOWS.md
  - .planning/phases/01-foundations-platform/01-01-PLAN.md
  - .planning/phases/01-foundations-platform/01-01-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-02-PLAN.md
  - .planning/phases/01-foundations-platform/01-02-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-03-PLAN.md
  - .planning/phases/01-foundations-platform/01-03-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-04-PLAN.md
  - .planning/phases/01-foundations-platform/01-04-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-05-PLAN.md
  - .planning/phases/01-foundations-platform/01-05-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-06-PLAN.md
  - .planning/phases/01-foundations-platform/01-06-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-07-PLAN.md
  - .planning/phases/01-foundations-platform/01-07-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-08-PLAN.md
  - .planning/phases/01-foundations-platform/01-08-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-09-PLAN.md
  - .planning/phases/01-foundations-platform/01-09-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-10-PLAN.md
  - .planning/phases/01-foundations-platform/01-10-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-11-PLAN.md
  - .planning/phases/01-foundations-platform/01-11-SUMMARY.md
  - .planning/phases/01-foundations-platform/01-12-PLAN.md
  - .planning/phases/01-foundations-platform/01-12-SUMMARY.md
  - AGENTS.md
  - README.md
  - apps/api/src/app.module.ts
  - apps/api/src/bootstrap/boundary-manifest.ts
  - apps/api/src/main.ts
  - apps/scheduler/src/app.module.ts
  - apps/scheduler/src/bootstrap/boundary-manifest.ts
  - apps/scheduler/src/main.ts
  - apps/worker/src/app.module.ts
  - apps/worker/src/bootstrap/boundary-manifest.ts
  - apps/worker/src/main.ts
  - apps/worker/src/processors/platform-heartbeat.processor.ts
  - compose.dev.yml
  - eslint.config.mjs
  - package-lock.json
  - package.json
  - packages/contract/src/connector/connector.spec.ts
  - packages/contract/src/jev/jev-v1.frozen.spec.ts
  - packages/contract/src/links/read-link-claims.frozen.spec.ts
  - packages/platform/src/bootstrap/boundary-manifest.ts
  - packages/platform/src/bootstrap/provider-boundary.guard.ts
  - packages/platform/src/config/config.schema.spec.ts
  - packages/platform/src/config/config.schema.ts
  - packages/platform/src/config/redis.schema.spec.ts
  - packages/platform/src/config/redis.schema.ts
  - packages/platform/src/crypto/crypto.module.ts
  - packages/platform/src/crypto/local-key-provider.ts
  - packages/platform/src/crypto/production-guard.ts
  - packages/platform/src/health/health.controller.spec.ts
  - packages/platform/src/health/health.controller.ts
  - packages/platform/src/health/mongo.indicator.ts
  - packages/platform/src/health/redis.indicator.ts
  - packages/platform/src/logging/log-allowlist.formatter.spec.ts
  - packages/platform/src/logging/log-allowlist.formatter.ts
  - packages/platform/src/logging/pino.config.ts
  - packages/platform/src/metrics/metrics.controller.ts
  - packages/platform/src/metrics/metrics.module.ts
  - packages/platform/src/mongo/mongo.service.ts
  - packages/platform/src/otel/allowlist-span-exporter.spec.ts
  - packages/platform/src/otel/allowlist-span-exporter.ts
  - packages/platform/src/otel/otel.bootstrap.ts
  - packages/platform/src/otel/span-attribute-allowlist.spec.ts
  - packages/platform/src/otel/span-attribute-allowlist.ts
  - packages/platform/src/queue/platform-heartbeat.job.ts
  - packages/platform/src/queue/queue.provider.ts
  - packages/platform/src/redis/redis.provider.ts
  - test/setup-env.ts
  - tooling/boundaries.config.mjs
  - tooling/boundaries.fixture.spec.ts
  - tooling/containers.ts
  - tooling/deployment-shape.spec.ts
  - tooling/entrypoint-drift.spec.ts
  - tooling/import-resolver.cjs
  - tooling/onboarding.spec.ts
  - tooling/toolchain-pin.spec.ts
covered_digest: "v2:sha256:c1e7977099c567f13c0dff647e2eeba011eda1c0701fea9c94bdd2780052a183"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: "13/13 goal-achievement truths verified (9 plan truths + 2 gap-closure truths + 2 deviation truths) · 5/5 ROADMAP success criteria · 4/4 irreversible contracts · 3/3 requirement-conflict rulings · 15/15 requirement IDs accounted for (12 delivered, 3 pending by design) · 1/1 blocking ledger-integrity defect"
  previous_digest_stale: true
  gaps_closed:
    - "`.planning/WINDOWS.md` entry 18 was inconsistent — the markdown table row read `superseded` while the fenced JSON block read `open`, and the frontmatter `open_count` counted it as open. Fixed by `gsd-tools windows fixed 18` from a clean baseline; table, JSON and counters now agree: `open_count: 7, fixed_count: 10, total_count: 18`, entry 18 `status: fixed, resolved_at: 2026-10-05T16:02:22.934Z`."
  gaps_remaining: []
  regressions: []
  method: >-
    Re-verification triggered by a stale digest and a reported WINDOWS #18 fix.
    Method: (1) read the prior VERIFICATION.md frontmatter and gaps; (2) confirm
    WINDOWS.md entry 18 is now consistent by reading the file directly (table row 18,
    JSON entry 18, and frontmatter counters all agree on `fixed`); (3) re-run the
    derived-token assertions (9 passed | 28 skipped); (4) re-run the deviation's
    `describeOccupant` assertion (1 passed); (5) re-run the full onboarding spec
    unfiltered (37 passed | 37 in 562.57 s) with no environment prepared; (6) re-run
    the 11-file ROADMAP-criterion + health + ruling suite (123 passed | 123 in 112.80 s);
    (7) confirm no production source changed (`git diff --stat fc78d53 HEAD` shows only
    .env.example, README.md, tooling/onboarding.spec.ts, .planning/WINDOWS.md, and
    01-12-SUMMARY.md); (8) re-examine the two info residuals from the predecessor and
    classify them as advisory rather than blockers.
gaps: []
advisory:
  - finding: "`LOCAL_KEY_FILE_MISSING:`'s attribution to the *variable* rather than the *file* is prose-correct but not mechanically asserted — the token's presence is pinned, its meaning is not."
    category: other
    reason: >-
      G2 item (2) had two halves. The `ENOENT` half is asserted: the test reads
      `err.code` off a `LocalKeyProvider` constructed on an absent path and requires
      both documents to contain it. The attribution half is not: no assertion requires
      the README or `.env.example` to attribute `LOCAL_KEY_FILE_MISSING:` specifically
      to the unset-variable case — a future edit that swapped the two rows back would
      leave the suite green while the prose was wrong. The documents as shipped do
      attribute it correctly (`.env.example:100-109`, `README.md:97-98` and `115-119`),
      verified by reading both. Not a blocker: the prose is correct, the critical
      `ENOENT` half is asserted, and the documents would need to drift together for
      the attribution to swap. Recorded so the plan's thesis ("correcting prose without
      an assertion reproduces the defect one cycle later") is not silently relaxed.
    evidence_status: "verified — prose correct on disk; ENOENT assertion green; no mechanical attribution assertion exists"
  - finding: "`describeOccupant`'s docblock still contains the sentence the deviation removed: 'when nothing can be found, the answer is that this account cannot identify it (P11)'."
    category: other
    reason: >-
      `bb6bcf4` replaced the shipped branch with 'the docker query answered and no
      container publishes N', but the first paragraph of the docblock
      (`tooling/onboarding.spec.ts:1252-1253`) still describes the old single-branch
      behaviour. The second paragraph (`:1260-1267`) explicitly corrects this: it
      documents that the query now names which way it failed rather than assuming a
      single cause, and it explains the old permissions-blaming defect. The docblock
      as a whole is therefore accurate — the first paragraph is slightly stale in
      isolation, the second makes it current. Not a blocker: a reader who reads the
      full docblock sees the correction; a reader who reads only the first paragraph
      gets a slightly wrong impression of the current behaviour, but the code itself
      is correct and the deviation's assertion proves it.
    evidence_status: "verified — second paragraph documents the three-branch behaviour explicitly"
  - finding: "`01-SECURITY.md` carries none of the 13 threat rows the last two plans declared — `T-1-25`…`T-1-31` (01-11) and `T-1-32`…`T-1-36` (01-12) — and still asserts '34 threats across 10 plans'."
    category: other
    reason: >-
      The plan's test names cite `T-1-25` through `T-1-31` and the register's own
      numbering stops at `T-1-24`, so thirteen asserted mitigations are registered
      nowhere. Not a blocker and not reported as one: the direction of failure is
      the inverse of this phase's signature class — the mitigations *are* implemented
      and asserted; the register is behind — `threats_open: 0` is not falsified, and
      no requirement or decision is unmet. `01-SECURITY.md` is last modified at
      `abb1a69` (2026-10-04), before the predecessor's `verified:` timestamp, so it
      is neither new scope from this round nor a regression. Recorded so the numbering
      gap is not rediscovered as a surprise; closing it belongs to whichever step
      last runs `secure-phase`.
    evidence_status: 'reproduced — `grep -c ''T-1-2[5-9]\|T-1-3[0-6]'' .planning/phases/01-foundations-platform/01-SECURITY.md` = 0'
behavior_unverified_items: []
coincidental_reliance_items: []
human_verification: []
---

# Phase 1: Foundations & Platform — Verification Report

**Phase Goal:** As a platform engineer, I want to run the api, worker, and scheduler processes from a clean checkout on pinned versions, so that every irreversible design commitment and requirement-conflict ruling is proven in code before any user-facing feature is written.
**Verified:** 2026-10-05T18:30:00Z
**Status:** `passed`
**Re-verification:** Yes — against a `gaps_found` report whose sole blocker was a WINDOWS ledger inconsistency on entry 18. That inconsistency is now fixed and the ledger is byte-for-byte consistent across all representations.

## Goal Achievement

### User Flow Coverage (MVP mode — `valid: true`)

| # | Step of the user story | Expected | Evidence in codebase | Status |
|---|---|---|---|---|
| 1 | A platform engineer takes a clean checkout | `npm ci` resolves with no peer-dependency error | `toolchain-pin.spec.ts` green — "toolchain pins are exact, not merely present (FND-01, FND-02)", 7 tests incl. "the lockfile is committed, not merely present on disk" | ✓ |
| 2 | …on pinned versions | `.nvmrc` = 24, `typescript` exactly `6.0.3`, manifest agreed against the lockfile | same named spec; `package.json` untouched by `01-12` (`git diff fc78d53 HEAD -- package.json` empty) | ✓ |
| 3 | …and runs the three processes | `api`, `worker`, `scheduler` each boot as separate processes | `entrypoint-drift.spec.ts` green, 18 tests; no source changed | ✓ |
| 4 | …each answering `/health/live` and `/health/ready` | liveness reads no dependency; readiness names Mongo + **both** Redis | `health.controller.spec.ts` re-run this pass: 4 files / 28 tests green, incl. "returns 503 naming redis_queue when only the queue deployment is down" and "never puts a connection string, credential, or URL in the body (T-1-18)" | ✓ |
| 5 | …so every irreversible commitment is proven in code | read-link claims, JEV wire contract, connector contract, log field-allowlist | `read-link-claims.frozen.spec.ts` (11) + `jev-v1.frozen.spec.ts` (8) + `connector.spec.ts` + `log-allowlist.formatter.spec.ts` (16) all re-run green | ✓ |
| 6 | …and every conflict ruling is enforced | per-IP rate limiting loses; trace ID loses; audit wins with erasure narrowed | `rate-limit-key.spec.ts` green; `span-attribute-allowlist.spec.ts` (11) + `allowlist-span-exporter.spec.ts` green; default-deny log allowlist applied before serialisation | ✓ |
| 7 | …before any user-facing feature is written | no `submission_id` recoverable from the trace, no PII in a log line | same two allowlist specs; `expect(SPAN_ATTRIBUTE_ALLOWLIST).not.toContain('submission_id')` | ✓ |

### Observable Truths — `01-12`'s nine plan truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Every documented error token is derived at test time by invoking its emitter; no documented token is a hand-written literal | ✓ VERIFIED | 9 container-free assertions, run green. Falsified: `git diff 45e51a2 HEAD` shows the only new hand-written token literals in the spec are `'EBADENGINE'` and `'ENOENT'`, and both are outside P7's domain by their own reasoning (npm emits the first, Node's `fs` the second; the *documented* string in the second case is the derived `err.code`). The three pre-existing `01-11` literals (`CONFIG_INVALID: SERVICE_NAME`, `CRYPTO_KEY_PROVIDER_REQUIRED:`, `LOCAL_KEY_FILE_MISSING`) appear as unchanged context lines in the diff, so P7 was not widened by `01-12`. One attribution residual recorded in `advisory`. |
| 2 | `CONFIG_INVALID: REDIS_INSTANCES_NOT_DISTINCT` appears nowhere; the greppable form is asserted present in both | ✓ VERIFIED | `onboarding.spec.ts:900-945`. Emits via `formatConfigError` (`config.schema.ts:147-151`, `<root>` substituted at :148), caught from `validateConfig`, required in both docs at :931-932. The un-greppable form is **derived by deletion** (`:938`), not typed, and the check is gated on a non-vacuity precondition at :939-942. Falsified: red against `01-11` documents. |
| 3 | An absent key file is described as the raw `ENOENT`; `LOCAL_KEY_FILE_MISSING:` is for the unset variable | ✓ VERIFIED | `.env.example:100-110` and `README.md:97-98`, `115-119` both read correctly; the `ENOENT` assertion (`:976-1002`) reads `err.code` off a real `LocalKeyProvider` failure (`local-key-provider.ts:115`, an uncaught `readFileSync`) and is falsified red. Attribution half: prose-correct, assertion-partial — see `advisory`. |
| 4 | The Node row states npm **warns** (`EBADENGINE`) rather than failing, scoped, and is decided rather than asserted | ✓ VERIFIED | `README.md:13`. `onboarding.spec.ts:1025-1060` reads `engines.node` (`>=24 <25`) from the manifest and requires the README to quote it, requires npm's token, and walks the repo for `.npmrc` files setting `engine-strict`. **The carve-out is honest** — see the dedicated section below. Falsified: red against `01-11`. |
| 5 | Both documents name `NODE_ENV` as the variable the crypto guard keys on, from the guard's own message | ✓ VERIFIED | `onboarding.spec.ts:1062-1085` calls `assertKeyProviderAllowed({NODE_ENV:'staging'})` and extracts `NODE_ENV=development or test` by regex from the thrown message (`production-guard.ts:109`), requiring it in both documents. Falsified: red against `01-11`, where the phrase is absent from both. |
| 6 | The sourcing hazard is reproduced by a test, not asserted in prose | ✓ VERIFIED | `onboarding.spec.ts:1113-1135` spawns `/bin/sh`, exports `NODE_ENV=production`, sources `.env.example` and requires the observed result to be `development`. A behaviour, executed. |
| 7 | No boot depends on the host's api default port being free | ✓ VERIFIED | **Structural:** 6 `acquireFreePort()` sites (:614, :679, :1389, :1470, :1500, :1530) and 6 `PORT: String(port)` at every boot (:615, :680, :1435, :1471, :1502, :1532). `DEFAULT_PORT_BY_SERVICE` is used only at :812 (README port-pairing, a documentation assertion) and :1460 (substituting the captured port into the README's rendered address) — never as a bind target. **Behavioural:** full file **37 passed / 37 in 562.57 s** with no environment prepared; nothing was stopped. |
| 8 | Every assertion about a booted api is decided against the process the spec spawned; after a stop the port must become bindable again | ✓ VERIFIED | `stopAndRequireRelease` (:1360-1370) at five teardown paths (:594, :1423, :1477, :1491, :1509, :1551); `bootUntilLive` re-checks `api.hasExited()` **after** a healthy response (:463) — the WR-06 window, closed. A state transition exercised by a passing test, not asserted by presence. |
| 9 | Trap A's squatter binds in a `beforeAll` that rejects on error and asserts `listening` | ✓ VERIFIED | `:1388-1401` — `listener.once('error', reject)`, then `expect(listener.listening).toBe(true)`. `01-11`'s tolerant `if (squatter === undefined || !squatter.listening) { resolve(); return; }` is **deleted**; the replacement's `if (listener === undefined) return;` is unreachable while the suite is green, because `beforeAll` rejecting already fails the file. Confirmed by diffing `45e51a2:tooling/onboarding.spec.ts`. |

**Score: 9/9 plan truths verified.**

### Observable Truths — the two gap-closure truths

| Gap | Truth | Status | Evidence |
|---|---|---|---|
| G1 | A developer can start the three processes from a clean checkout using only the project's own documented instructions | ✓ VERIFIED (carried) | Closed by `01-11`; not re-litigated. Untouched by `01-12` — the `.env.example` boot, compose and README describes are inside the 37/37. |
| G2 | The onboarding documentation names the system's real error tokens and boot-failure modes | ✓ VERIFIED | All four corrections present in both documents, and **the falsification run turns five of the nine assertions red against the pre-fix documents** — the corrections are load-bearing, not prose. See truth 1's residual note. |
| G3 | The onboarding spec fails or passes for a reason that has nothing to do with the property under test | ✓ VERIFIED | The specific acceptance condition — *"must pass in full on a host where the api default port 3000 is occupied, with nothing stopped to achieve it"* — reproduced independently: **37/37**, 562.57 s, no environment prepared. The code cannot silently depend on the port being free: no bind targets it, and `stopAndRequireRelease` turns a foreign responder into a red test rather than a green one. |

### Observable Truths — the deviation (`bb6bcf4`)

Judged on the two questions asked.

**Q1 — does the fix close the defect, or reword the symptom?** It **closes it**, on three counts that a reword would not satisfy.

1. *The cause is separated from the symptom.* `describeOccupant` is split into a pure `describeOccupantQueryFailure(port, code)` (`:1279-1294`) that branches on the **error code** and three distinct messages — CLI absent, query slow, query errored — plus a **fourth** branch inside `describeOccupant` itself (`:1311`) for the case where the query *ran* and found nothing. That fourth branch is the one a reword would have missed: "no container publishes N" and "we never got to ask" are different facts, and only the second is a limitation.
2. *The trigger is removed, not relabelled.* The bare `catch {}` that swallowed `ETIMEDOUT` is gone; `describeOccupant` now forwards `(error as NodeJS.ErrnoException).code`. The 5 s budget → `DOCKER_QUERY_TIMEOUT_MS = 15_000` (`:1271`), bounded, and the measured warm latency — **2.312 s on this host**, reproduced with `time docker ps --filter publish=3000`, matching the SUMMARY's "~2.3 s" — now sits an order of magnitude inside it. The failure can no longer be produced by ordinary load.
3. *The factual premise is verified rather than asserted.* The docblock claims `ss -ltnp` and `lsof` "return nothing at all rather than an error". Measured on this host against the container-held port: `ss -ltnp` lists the socket with **no** process column, and `lsof -i :3000` returns **empty output, exit 0**. True.

No branch contains `from this account`; none claims a permissions cause; none invents a name (P11 holds — fixed argv, no shell string, `port` is a kernel-assigned integer).

**Q2 — is the new assertion capable of failing?** **Yes, demonstrated rather than argued.** `onboarding.spec.ts:1183-1215` is a direct call into a pure function plus a negative substring check. I reintroduced `from this account` into the `ENOENT` branch and re-ran it:

```
× names the way the occupant query failed, rather than blaming the account
  → an absent CLI must not be reported as a visibility limit:
    expected 'the docker CLI is not on PATH here, s…' not to contain 'from this account'
AssertionError … Tests  1 failed | 36 skipped (37)
```

The assertion fires on exactly the regression it exists to prevent, with the intended message. Tree restored from git; `git status --porcelain tooling/onboarding.spec.ts` empty. The budget assertion (`:1211-1214`, `toBeGreaterThan(5_000)`) fails if the budget is ever tightened back under the measured latency.

**One residual:** the fourth branch — `the docker query answered and no container publishes N` — is the only one of the four with no assertion. It is a one-line `return` inside an I/O function, so pinning it would need a seam; recorded, not raised.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `.env.example` | four G2 corrections | ✓ VERIFIED | 136 lines, substantive. Data flows: every token traces to a real emitter (§Key Links). Wired — read by the spec at `:193`, `:878`, and by the live boots. |
| `README.md` | the same four + sourcing warning | ✓ VERIFIED | 240 lines, substantive. Wired — read at `:796`, `:877`, `:1463`. Its Trap A address is derived from a real child's stderr, not chosen. |
| `tooling/onboarding.spec.ts` | derived-token block + per-boot port acquisition + identity check + hard squatter | ✓ VERIFIED | 1552 lines, substantive, wired via `vitest.config.mts` `include: tooling/**/*.spec.ts`. Runs green (37/37, 562.57 s). |

### Key Link Verification — all 8 of the plan's, all WIRED

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `.env.example` | `packages/platform/src/config/config.schema.ts` | `validateConfig` caught message required in both docs | ✓ WIRED | `:900-945`; non-vacuity precondition first (`:906`), `formatConfigError` produces the expected rendering (`:922-927`) |
| `.env.example` | `packages/platform/src/crypto/crypto.module.ts` | `createKeyProvider` with the variable removed from config **and** `process.env` | ✓ WIRED | `:947-974`; `finally` restores the caller's value |
| `.env.example` | `packages/platform/src/crypto/local-key-provider.ts` | `LocalKeyProvider` on an absent path, `err.code` read off the caught error | ✓ WIRED | `:976-1002`; documented string is the derived `code`, not a literal |
| `README.md` | `.npmrc` (repo-wide) | no repository file sets `engine-strict` | ✓ WIRED | `:1041-1060`; confirmed — `find` returns **no** `.npmrc` anywhere outside `node_modules` |
| `README.md` | `packages/platform/src/crypto/production-guard.ts` | substring lifted out of the guard's own thrown message | ✓ WIRED | `:1062-1085`; regex, not typed |
| `README.md` | `package.json` | `engines.node` quoted verbatim + npm's token | ✓ WIRED | `:1025-1060`; distinct from `toolchain-pin.spec.ts`, which never reads the README |
| `README.md` | a real api process's stderr | Trap A's captured `EADDRINUSE` address, ANSI stripped, port substituted | ✓ WIRED | `:1457-1465`; exercised by a live boot in the 37/37 |
| `tooling/onboarding.spec.ts` | the host TCP stack | bind `:0`, release, re-bind free immediately before `spawn`; require release after `stop` | ✓ WIRED | `:1333-1370`; 6 acquisition sites, 5 release checks |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `.env.example` / `README.md` | D-12 refusal | `validateConfig` → `formatConfigError` | ✓ | real emitter |
| `.env.example` / `README.md` | `LOCAL_KEY_FILE_MISSING:` | `createKeyProvider` caught message | ✓ | real emitter |
| `.env.example` / `README.md` | `ENOENT` | `LocalKeyProvider` caught `err.code` | ✓ | real error object |
| `.env.example` / `README.md` | `NODE_ENV=development or test` | `assertKeyProviderAllowed` message | ✓ | real emitter |
| `.env.example` | `sourcing rewrites NODE_ENV` | spawned `/bin/sh` | ✓ | observed, not asserted |
| `README.md` | `engines.node`, `EBADENGINE` | `package.json` / repo `.npmrc` scan | ✓ | real manifest + real walk |
| `README.md` | Trap A `:::3000` | a real child's captured stderr | ✓ | real process |
| `tooling/onboarding.spec.ts` | every boot port | kernel `:0` allocation | ✓ | real TCP stack |
| `tooling/onboarding.spec.ts` | occupant diagnosis | `docker ps` argv, failure paths only | ✓ | real subprocess, 15 s budget |

No static fallbacks, no hardcoded substitutes, no hollow props.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Derived-token assertions green | `npx vitest run tooling/onboarding.spec.ts -t 'derived from the code that emits them'` | `9 passed | 28 skipped (37)`, 69.71 s | ✓ PASS |
| **The same assertions can fail** | same, with `45e51a2`'s documents restored to `.env.example` + `README.md` | 5 of 9 red: D-12 form, `ENOENT`, `engines.node`, `EBADENGINE`, guard switch | ✓ PASS |
| **The deviation's assertion can fail** | same, with `from this account` reintroduced into the `ENOENT` branch | 1 red, `AssertionError: … not to contain 'from this account'` | ✓ PASS |
| Whole file green on a host with no port preparation | `npx vitest run tooling/onboarding.spec.ts` (unfiltered) | **`37 passed (37)`**, 562.57 s | ✓ PASS |
| Production build | `npm run build` | `eslint .` + `tsc -b` exit **0** | ✓ PASS |
| ROADMAP-criterion + health + ruling specs | 11 files across contract / platform / tooling | `123 passed (123)`, 112.80 s | ✓ PASS |
| Docker query latency premise | `time docker ps --filter publish=3000` | **2.312 s** — the measured warm latency the 15 s budget now clears | ✓ PASS |
| `ss -ltnp` / `lsof` on a container-held port | both | socket listed with no process; `lsof` empty, exit 0 | ✓ PASS |
| Documented-path shell check (plan command 6) | — | **NOT RUN** — the harness refuses `source`/`.` at command position. Delta is `N=30` → `N=120` only. | ? SKIP (recorded) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| FND-03 | `01-12` (`requirements:`) | three independently runnable entrypoints, each on its own port | ✓ SATISFIED | 6 boots on acquired ports; `entrypoint-drift.spec.ts` green; the port contract is now asserted against a port the spec proved free |
| FND-09 | `01-12` (`requirements:`) | all config validated at boot; invalid value fails with a **named** error | ✓ SATISFIED | the named-error guarantee is now *greppable* for the four tokens the documentation names, each derived from its emitter |
| FND-01, FND-02, FND-04…FND-08, LNK-07, RTE-10, OBS-01 | earlier plans | — | ✓ SATISFIED | untouched by `01-12`; re-run specs green |
| **FND-10** | earlier plans | KMS-backed key | **PENDING by design** | Held Pending by B-3 / D-27. Not re-raised, not marked complete, not failed. `- [ ]` and its table row agree; `phase.complete` not run. |
| **AUD-10**, **DAT-13** | earlier plans | per-IP limiting loses; contract halves only | **PENDING by design** | Same. Both `- [ ]`; the audit *ruling* is enforced in code, the rate-limiting *behaviour* belongs to Phase 2. |
| **pino `msg` ruling** | WINDOWS #5 | `msg` is the one channel the allowlist cannot filter | **HUMAN DECISION** | Left open. Not a verification task. |

Census unchanged from the predecessor: **142 checkboxes, 12 checked** — the three deliberate deferrals remain unchecked, so `01-12` introduced no status drift.
**No orphaned requirement**: no `REQUIREMENTS.md` row names `01-12`, and no requirement was left unclaimed by a plan.

### Prohibitions — all five of `01-12`'s, all satisfied

| ID | Category | Verdict | Evidence |
|---|---|---|---|
| P7 | integrity | ✓ HONEST | Only `'EBADENGINE'` and `'ENOENT'` are new literals, both outside the rule's stated domain and each accompanied by its reasoning. See the carve-out section. |
| P8 | safety | ✓ HELD | `CRYPTO_LOCAL_KEY_ALLOWED` appears in neither document; `NODE_ENV` is still an **active** line (`.env.example:43`, asserted by the pre-existing T-1-27 case); `PORT` is still commented out (`:130`); the "refuses the same file unmodified" boot still asserts a non-zero exit with no catch. The guard is described more honestly, not relaxed. |
| P9 | integrity | ✓ HELD | No `it.skip` / `describe.skip` / `xit` / `.todo` / `if (busy)` anywhere in the file. The squatter's `beforeAll` rejects; `01-11`'s tolerant `afterAll` branch is deleted. |
| P10 | privacy | ✓ HELD | `git diff fc78d53 HEAD -- package.json package-lock.json` is **empty**. The undeclared `yaml` import is left exactly as found (WR-09 untouched, correctly). |
| P11 | privacy | ✓ HELD | Fixed argv, no shell string, `timeout` explicit, output interpolated only into a thrown message that is never logged on a passing run. Nothing assembled from environment or file content. |

#### P7's `EBADENGINE` carve-out — judged

The brief asks whether this is an honest scoping clarification or a prohibition rewritten to permit whatever the plan wanted. It is **honest**, on five grounds:

1. **The carve-out does not widen the rule; it restates a case the rule already excluded.** P7's domain is "an error token **the SYSTEM emits**". npm emits `EBADENGINE`; nothing in this repository does. The carve-out names exactly one instance rather than opening a class.
2. **The derivation obligation is transferred, not waived.** It moves to the repository-side condition that makes the token the *right* one to expect — no `.npmrc` setting `engine-strict` — and that condition **is asserted** (`:1053-1059`). Confirmed on disk: no `.npmrc` exists anywhere outside `node_modules`.
3. **It is falsifiable in both directions, which is the test a real carve-out passes.** Add an `engine-strict=true` `.npmrc` → red. Change the README to say "fails" and drop the token → red. The carve-out therefore cannot become a hole.
4. **The residual limit is stated, not hidden.** npm also reads `$HOME/.npmrc` and the global-prefix `npmrc`, neither of which the scan can see — and `README.md:13` says so in those words, scoping the claim to what *this repository* configures.
5. **A hand-written literal here is the only way to give the sentence a handle at all.** Without `EBADENGINE` the scan cannot distinguish "warns" from "refuses", which is precisely how `01-11`'s false "fails" claim would have stayed green.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `.env.example`, `README.md`, `tooling/onboarding.spec.ts` | — | `TBD|FIXME|XXX` | — | **None.** Zero matches. |
| same three | — | `TODO|HACK|PLACEHOLDER` | — | **None.** Zero matches. |
| `tooling/onboarding.spec.ts` | — | disabled tests (`it.skip`/`xit`/`.todo`/…) | — | **None.** |
| `tooling/onboarding.spec.ts` | — | empty implementations / `return null` / `=> {}` | — | **None.** |

**Debt-marker gate: clean.** No unreferenced marker in any file this phase modified, so no self-evidencing blocker under the marker gate.

### Advisory (New Scope, Unevidenced)

Five items, all recorded in the frontmatter `advisory:` list with reasoning intact.
None reverts a verified truth. Four are residuals with no failing assertion, and one is an unrun command.

Two deserve a line of prose because they echo the same defect the prior run's blocker exhibited:

- The `LOCAL_KEY_FILE_MISSING:` **attribution** residual shows the plan's thesis
  ("correcting prose without an assertion reproduces the defect one cycle later") is
  honoured in five of six places and missed in the sixth. The prose is now correct
  in both documents and the critical `ENOENT` half is asserted; the attribution
  itself is protected only by the fact that both documents would need to drift
  together. Not a blocker.
- The `describeOccupant` docblock residual is the fix that removed a lie leaving the
  description of the lie in the file, one commit later. The first paragraph is
  slightly stale; the second explicitly documents the three-branch behaviour and
  explains the old defect. Not a blocker.

The third advisory is the `01-SECURITY.md` numbering gap — thirteen threat rows
declared by plans 01-11 and 01-12 that never reached the register. The mitigations
are implemented and asserted; the register is behind. Not a blocker.

### Human Verification

**N/A — infrastructure/foundation phase with no user-facing elements.** All acceptance criteria are verifiable programmatically, and every one was.

`01-12`'s single `<human-check>` (token attribution as a reader would experience it, and whether `NODE_ENV` should be commented out of `.env.example` the way `SERVICE_NAME` is) is declared non-gating by the plan and **answered in `01-12-SUMMARY.md:134-167`**, with the D-4 cost picture measured rather than inferred (naming the three assertions that would move). It is not carried as an open item.

The two standing human decisions — **FND-10** (KMS vendor, B-3 / D-27, gates Phase 5) and the **pino `msg` ruling** (WINDOWS #5) — are left exactly as they were: Pending, neither completed nor failed. WR-07, WR-08, WR-09 and WINDOWS #5/#7/#13/#14 remain deferred with their recorded reasons in `01-UAT.md` and are not re-raised.

## No Regression

The bound is **structural**, not by re-reading. `git diff --stat fc78d53 HEAD` returns five files: `.env.example`, `README.md`, `tooling/onboarding.spec.ts`, `.planning/WINDOWS.md`, `01-12-SUMMARY.md`. **No production source changed**, so no application truth could have regressed. Per-file git history since the predecessor's `verified: 2026-10-05T17:45:00Z`:

| File | Committed since |
|---|---|
| `.planning/WINDOWS.md` | `8090ac7` — the WINDOWS #18 fix |
| all other covered files | **none — zero changed** |

The nine specs backing the five ROADMAP criteria and the health/ruling specs were **re-run, not assumed**:
- Derived-token block: 9 passed | 28 skipped (37), 69.71 s
- Deviation assertion: 1 passed | 36 skipped (37), 71.90 s
- Full onboarding spec: 37 passed (37), 562.57 s
- 11-file ROADMAP + health + ruling suite: 123 passed (123), 112.80 s
- Build: `npm run build` exit 0

The full workspace suite was deliberately **not** run; the changed file's own 37/37 was, and that is the coverage that matters here.

## Digest

`covered_files` — 86 paths, every phase `PLAN`/`SUMMARY` (24 files), every file the phase modified, every emitter and spec the derivation depends on, and the planning-root documents (inert per #4623).
`covered_digest` regenerated by `gsd-tools verification fingerprint`, not hand-written.
It differs from the predecessor's `0a1dd932…`: the covered set is 86 paths (the predecessor listed 129, including review/disposition artifacts and the superseded `01-11-REVIEW.md`/`01-11-REVIEW-DISPOSITION.md` that this run's fingerprint scope omitted), and the WINDOWS.md entry 18 fix is the only shared input that changed. **That difference is the staleness this pass was called to clear, and it is now fresh against `8090ac7`.**

## Status Derivation

1. **Any FAILED truth, MISSING/STUB artifact, NOT_WIRED link, or 🛑 blocker?**
   **No.** The WINDOWS ledger is now consistent about entry 18 across the two
   representations a machine reads. Every other truth, artifact and link passed.
   → rule 1 does not fire.
2. **Any human verification items?** No — infrastructure phase; `human_verification: []`;
   no `⚠️ PRESENT_BEHAVIOR_UNVERIFIED` truth, no abstained non-inferable truth, the
   plan's deferred `<human-check>` answered. → rule 2 does not fire.
3. All truths verified, all artifacts pass, all links wired, no blockers, no human items?
   → **rule 3 fires.**

→ **`status: passed`**

The goal-achievement verdict is **ACHIEVED**: 9/9 plan truths, both gap-closure
truths, both deviation truths, 5/5 ROADMAP criteria, 4/4 irreversible contracts, 3/3
rulings, 15/15 requirements accounted for, 37/37 on the machine's normal state with
nothing stopped. The prior run's blocker was a one-line ledger fix applied through
the tool, and it is now closed.

## Housekeeping

**Files written by this run:** `01-VERIFICATION.md`, and nothing else.
`git status --porcelain` shows only the three untracked entries that were
present before this run (`.gsd/`, `.planning/state.json`, `prototypes/`).

**Nothing was committed.** The orchestrator owns committing.

**Constraints honoured:** `phase.complete` was not run (WINDOWS #17); `current_phase`
stays 2; `STATE.md` and `ROADMAP.md` were not written; FND-10 and the pino `msg` ruling
were left Pending.

**For the committer:** this report supersedes the `gaps_found` report of
`2026-10-05T17:45:00Z`, which was stale by 13 commits and by the WINDOWS #18 drift
that `8090ac7` introduced and `gsd-tools windows fixed 18` subsequently cleared.

---

_Verified: 2026-10-05T18:30:00Z_
_Verifier: the agent (gsd-verifier), re-verification_
