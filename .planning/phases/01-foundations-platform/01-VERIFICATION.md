---
phase: 01-foundations-platform
verified: 2026-10-04T12:26:40Z
status: passed
score: 5/5 ROADMAP success criteria verified · 15/15 requirement IDs accounted for (12 delivered, 3 pending by design and honestly recorded) · 1/1 metadata-consistency truth verified · 16 test files / 202 tests re-run green
covered_files:
  - .github/workflows/ci.yml
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
  - .planning/phases/01-foundations-platform/01-ASSUMPTIONS.md
  - .planning/phases/01-foundations-platform/01-CONTEXT.md
  - .planning/phases/01-foundations-platform/01-REVIEW-DISPOSITION.md
  - .planning/phases/01-foundations-platform/01-REVIEW.md
  - .planning/phases/01-foundations-platform/01-VALIDATION.md
  - apps/api/otel.mjs
  - apps/api/src/app.module.ts
  - apps/api/src/bootstrap/boundary-manifest.ts
  - apps/api/src/main.ts
  - apps/scheduler/otel.mjs
  - apps/scheduler/src/app.module.ts
  - apps/scheduler/src/bootstrap/boundary-manifest.ts
  - apps/scheduler/src/main.ts
  - apps/worker/otel.mjs
  - apps/worker/src/app.module.ts
  - apps/worker/src/bootstrap/boundary-manifest.ts
  - apps/worker/src/main.ts
  - apps/worker/src/processors/platform-heartbeat.processor.ts
  - eslint.config.mjs
  - package-lock.json
  - package.json
  - packages/contract/src/connector/connector.spec.ts
  - packages/contract/src/connector/connector.ts
  - packages/contract/src/index.ts
  - packages/contract/src/jev/jev-v1.frozen.spec.ts
  - packages/contract/src/jev/v1/index.ts
  - packages/contract/src/jev/v1/jev-request.ts
  - packages/contract/src/jev/v1/jev-response.ts
  - packages/contract/src/links/rate-limit-key.spec.ts
  - packages/contract/src/links/rate-limit-key.ts
  - packages/contract/src/links/read-link-claims.frozen.spec.ts
  - packages/contract/src/links/read-link-claims.ts
  - packages/contract/src/links/token-classes.ts
  - packages/kernel/src/index.ts
  - packages/platform/src/bootstrap/boundary-manifest.ts
  - packages/platform/src/bootstrap/provider-boundary.guard.ts
  - packages/platform/src/config/config.module.ts
  - packages/platform/src/config/config.schema.ts
  - packages/platform/src/config/redis.schema.ts
  - packages/platform/src/crypto/crypto.module.ts
  - packages/platform/src/crypto/envelope.ts
  - packages/platform/src/crypto/index.ts
  - packages/platform/src/crypto/key-provider.ts
  - packages/platform/src/crypto/local-key-provider.ts
  - packages/platform/src/crypto/production-guard.ts
  - packages/platform/src/health/health.controller.ts
  - packages/platform/src/health/mongo.indicator.ts
  - packages/platform/src/health/redis.indicator.ts
  - packages/platform/src/index.ts
  - packages/platform/src/logging/error-codes.ts
  - packages/platform/src/logging/log-allowlist.formatter.spec.ts
  - packages/platform/src/logging/log-allowlist.formatter.ts
  - packages/platform/src/logging/log-allowlist.ts
  - packages/platform/src/logging/logger.port.ts
  - packages/platform/src/logging/pino.config.spec.ts
  - packages/platform/src/logging/pino.config.ts
  - packages/platform/src/metrics/metrics.controller.ts
  - packages/platform/src/metrics/metrics.module.ts
  - packages/platform/src/mongo/mongo.service.ts
  - packages/platform/src/otel/allowlist-span-exporter.spec.ts
  - packages/platform/src/otel/allowlist-span-exporter.ts
  - packages/platform/src/otel/index.ts
  - packages/platform/src/otel/otel.bootstrap.ts
  - packages/platform/src/otel/otel.constants.ts
  - packages/platform/src/otel/span-attribute-allowlist.spec.ts
  - packages/platform/src/otel/span-attribute-allowlist.ts
  - packages/platform/src/queue/job-scheduler.ts
  - packages/platform/src/queue/platform-heartbeat.job.ts
  - packages/platform/src/queue/queue-indicators.ts
  - packages/platform/src/queue/queue.provider.ts
  - packages/platform/src/redis/redis.provider.ts
  - test/setup-env.ts
  - tooling/boundaries.config.mjs
  - tooling/boundaries.fixture.spec.ts
  - tooling/deployment-shape.spec.ts
  - tooling/entrypoint-drift.spec.ts
  - tooling/import-resolver.cjs
  - tooling/toolchain-pin.spec.ts
covered_digest: "v2:sha256:b51ad6476ce87b1d07769f27d702384ed307ea9c3d37363247019c942f533445"
behavior_unverified: 0
overrides_applied: 0
human_verification: []
advisory:
  - finding: "AUD-10 and DAT-13 lack the in-place deferral sub-note FND-10 carries — the prior gap's second `missing:` item, not executed by 0fb56b1."
    category: other
    reason: >-
      The gap's truth now holds: both read `- [ ]` and both agree with their coverage-table
      rows and their bodies, so nothing contradicts anything. The harm the item described was
      "three bare **checked** boxes" silently asserting delivery; a bare `[ ]` asserts
      non-delivery, which is true of all three. The reason-for-deferral is not lost — it sits
      in the coverage table, whose cell for both requirements carries a longer explanation than
      an inline sub-note would. Documentation ergonomics, not a status defect. Blocking on this
      would create an unbounded remediation loop (the next pass could object that the sub-notes
      are not worded identically to FND-10's) without the truth ever being at stake. Not fixed:
      the hard constraint forbids editing REQUIREMENTS.md. Overrule me if you read it as a blocker.
    evidence_status: "reproduced — REQUIREMENTS.md lines 212 and 239 are bare `- [ ]`; lines 413 and 414 carry the reason"
  - finding: "`STATE.md` `Pending Todos` holds stale plan-handoff notes, including one that now contradicts FND-05's delivered status."
    category: other
    reason: >-
      The entry reads "`FND-05` is still PENDING and must stay that way until plan 10 mounts the
      controller"; plan 10 mounted it and FND-05 is `- [x]` / `Complete (01-10)`. Likewise "Plan 10
      must wrap both readiness indicators" (plan 10 wrapped them), the `package.json` `exports`
      hand-off ("now recurred FOUR times" — gap G-1, closed at `44b0619`), and the plan-09
      heartbeat note. The section already has a `[CLOSED by 01-08]` convention applied to one item
      and not to these. Downgraded rather than blocking: these are narrative notes, explicitly
      plan-scoped (`[Phase 1] (01-07)`), in a file no tooling reads for requirement status — not a
      machine-consumed field like the REQUIREMENTS.md checkbox. STATE.md is unmodified since the
      predecessor's `verified:` timestamp, so not a regression. The FND-10 entry in the same
      section is still true, which is why the section is partly stale rather than wrong. Reported,
      not fixed, per the hard constraint.
    evidence_status: "reproduced — STATE.md line 178 vs REQUIREMENTS.md line 66 and coverage table line 403; `git log --since` on STATE.md is empty"
  - finding: "Six root dependencies are absent from the STACK.md §14 version ledger, which T-1-SC makes the human-checkpoint trigger for supply-chain additions."
    category: other
    reason: >-
      `@opentelemetry/sdk-metrics`, `@opentelemetry/sdk-trace`, `@nestjs/testing`,
      `@testcontainers/mongodb`, `@testcontainers/redis`, `@types/node`. Each is provably the
      module-package companion of an already-ledgered parent — sdk-metrics/sdk-trace of
      `@opentelemetry/sdk-node`, the testcontainers drivers of `testcontainers`, `@nestjs/testing`
      the test sibling of `@nestjs/core`, `@types/node` type definitions only. None is an unvetted
      technology, and no assertion fails. Recorded because an incomplete ledger weakens the control
      even when its omissions are benign — the next genuinely new dependency would be judged against
      a ledger that already has gaps. package.json is unmodified since the predecessor's pass.
    evidence_status: "reproduced — 33 root deps+devDeps, 6 absent from .planning/research/STACK.md; each parent verified present in the ledger; no failing assertion"
  - finding: "The NestJS version is asserted by nothing, and package.json does not even pin it exactly."
    category: other
    reason: >-
      Carried forward with sharper evidence than the predecessor had: `package.json` carries
      `"@nestjs/core": "^12.1.2"`, a caret range, whereas `typescript` is pinned to the exact string
      `"6.0.3"` and both Node declarations are guarded. `tooling/toolchain-pin.spec.ts` guards
      `typescript` and Node only; `deployment-shape.spec.ts:163,197` asserts `typescript` and
      `vitest` are *members* of the build-tooling set — presence, not version. STACK.md §4.1 and §14
      record 12.1.2; AGENTS.md's constraints name "NestJS 12" as a family, so unlike the TypeScript
      pin there is no stated exact-pin requirement to violate and nothing fails. The asymmetry
      deserves a deliberate decision rather than silence.
    evidence_status: "reproduced — package.json `\"@nestjs/core\": \"^12.1.2\"`; grep of toolchain-pin.spec.ts finds no @nestjs assertion"
  - finding: "The `install-guard` TypeScript-version step has never executed on a real GitHub Actions runtime."
    category: other
    reason: >-
      Carried forward. There is no Actions runtime here, so `ci.yml` line 77
      (`node -e \"…node_modules/typescript/package.json…\"`) has not run. It should be satisfiable:
      the root manifest pins `typescript` to the exact string `6.0.3`, so a lockfile-free
      `npm install` has exactly one admissible resolution, and `npm ls --all` reports zero
      invalid/peer-dependency findings against the current tree. Recorded because an unexecuted CI
      step is an unexecuted CI step — its first execution will be the first push after this report.
    evidence_status: "reasoned from the manifest pin; step not executed"
  - finding: "WINDOWS #5 (`msg` is the one channel the log allowlist cannot filter) is open and blocks /gsd-ship. Correction: the blocking count is 7, not the 6 the predecessor reported."
    category: other
    reason: >-
      pino emits `msg` verbatim *after* `formatters.log` runs, so no field allowlist can filter it;
      this needs a human ruling, not engineering. The count is corrected by parsing all 17 WINDOWS
      entries: status census `{fixed: 9, waived: 1, open: 7}` against a declared `open_count: 7` —
      a match. `git show` at both `90615b3` and `1f239f0` reads `open_count: 7`, so `0fb56b1` did not
      change it and the predecessor's figure was an off-by-one, not a regression. Open entries:
      #5, #7, #13, #14, #15, #16, #17. With `workflow.windows_enforce`, `/gsd-ship` blocks while
      `open_count > 0`.
    evidence_status: "reproduced — WINDOWS.md frontmatter open_count: 7 vs 7 open entries parsed from the JSON block"
  - finding: "WINDOWS #16 — the three apps/{api,worker,scheduler}/otel.mjs loaders sit outside both boundary controls."
    category: other
    reason: >-
      Carried forward. The rule's `files` block covers `**/*.{ts,mts,cts}` and every element pattern
      is `apps/<app>/src/**`, so the D-20 loader entrypoints are ungated. Accepted recorded residual
      (WR-02) with an owner; not re-measured this pass.
    evidence_status: "carried forward — not re-measured this pass"
  - finding: "The `test/setup-env.ts` forward trap — it seeds `CRYPTO_KEY_PROVIDER` but not `CRYPTO_LOCAL_KEY_FILE`."
    category: other
    reason: >-
      Carried forward. Composing `CryptoModule` makes the provider eager, so a process selecting
      `local` must name a key file (a path, never the key); a test that boots a real process must set
      the second itself. Intended and recorded in STATE.md's Blockers/Concerns, not a defect.
    evidence_status: "carried forward — not re-measured this pass"
  - finding: "CONTEXT.md decision drift — D-15 `formatters.log` wording; D-01/D-02 say '12 domain modules' against 13 shipped."
    category: other
    reason: >-
      Carried forward. Recorded in STATE.md and 01-ASSUMPTIONS.md with an owner. Not re-measured
      this pass; no phase artifact changed.
    evidence_status: "carried forward — not re-measured this pass"
  - finding: "ROADMAP declares `Mode: mvp` for Phase 1 while the phase goal is a technical statement, not a user story."
    category: other
    reason: >-
      Carried forward. `query user-story.validate` returns `valid: false` with all three slot errors
      ("must start with As a [user role]", "must include , I want to", "must include , so that"), so
      under the MVP-mode rules verification would normally refuse outright. Not refused, for the same
      two stated reasons as the predecessor: the phase carries five explicit technical success
      criteria that are fully verifiable and all five were verified, and a roadmap metadata
      inconsistency is not a phase-goal failure. Recorded rather than silently ignored; the developer
      may overrule and demand a re-plan with a user-story goal.
    evidence_status: "reproduced this pass — valid: false, errors[] populated"
  - finding: "`dist/` retains build artifacts whose sources no longer exist: `packages/kernel/dist/zz-demo-violation.d.ts` and `packages/platform/dist/__probe__/probe.spec.d.ts`."
    category: other
    reason: >-
      Carried forward. Not a repository defect — `dist` is gitignored and `git ls-files packages/*/dist`
      is empty — but it matters because two open findings concern what `dist/` ships (WR-03,
      WINDOWS #8). No action taken; this run modifies nothing outside 01-VERIFICATION.md.
    evidence_status: "carried forward — untracked, outside the digest"
  - finding: "The predecessor's `gaps_found` verification report was never committed."
    category: other
    reason: >-
      Recorded so the orchestrator is not surprised. `git log -- 01-VERIFICATION.md` shows the file last
      committed at `0cab61f`, which still contains the older `passed` 15/15 report; the working tree
      held the uncommitted `gaps_found` version until this rewrite replaced it. Consequence: the gap and
      its fix are visible only through `90615b3` and `0fb56b1`, not through this file's history. This
      report supersedes the uncommitted predecessor in a single step.
    evidence_status: "reproduced — `git log --oneline -3 -- 01-VERIFICATION.md` returns 0cab61f, 4642e17, 5266acb"
re_verification:
  previous_status: gaps_found
  previous_score: "5/5 ROADMAP criteria · 15/15 requirements · 1 blocking metadata defect"
  gaps_closed:
    - "REQUIREMENTS.md reports each requirement's delivery status without contradicting the requirement's own body or its coverage-table row — the carried-forward blocker. 0fb56b1 set FND-10 (line 109), DAT-13 (line 212) and AUD-10 (line 239) back to `- [ ]`, and a 142-vs-142 sweep finds zero remaining disagreement between any checkbox and its coverage-table row."
  gaps_remaining: []
  regressions: []
  method: >-
    Re-verification scoped to the single carried-forward gap. The fix was tested three
    ways rather than read: (a) the three checkboxes were read in place and cross-read
    against their requirement bodies; (b) a deterministic sweep parsed ALL 142 checkboxes
    and ALL 142 coverage-table rows and compared them in both directions, plus a
    body-contradiction scan over every checked requirement; (c) the sweep was falsified by
    replaying it against the pre-fix tree at 1f239f0, where it reproduces exactly the
    three defects and FND-10's `STAYS PENDING` body contradiction — so "clean" is a
    finding, not a vacuous pass. Regression risk was bounded structurally rather than by
    re-reading: every one of the 104 covered files was checked against git history since
    the predecessor's `verified:` timestamp, and ZERO non-planning files changed, so no
    code truth could have regressed. The Nyquist work (7566f99, 1f239f0) predates that
    timestamp and needed no re-audit; it was kept green by targeted runs only. The full
    suite was NOT run and that is stated rather than implied. The digest was regenerated
    from the tool, three times, and matches the predecessor's value byte-for-byte.
---

# Phase 1: Foundations & Platform — Verification Report

**Phase goal:** A clean checkout builds three independently runnable processes on the pinned stack, and every irreversible design commitment plus all three requirement-conflict rulings exist in code before a single feature is written.
**Verified:** 2026-10-04T12:26:40Z
**Status:** `passed` — the carried-forward blocker is closed; **no code truth regressed**.
**Re-verification:** Yes — against a prior `gaps_found` with exactly one blocking metadata defect.

---

## Blocker Closure — the reason this pass exists

The predecessor reported one blocker: commit `90615b3`, titled *"revert phase.complete's over-claim of FND-10, AUD-10, DAT-13"*, had reverted **only the REQUIREMENTS.md coverage table** and left the machine-consumed `- [x]` **checkboxes** still asserting delivery. Commit `0fb56b1` addresses this. Verified as follows.

### 1. The three checkboxes, read in place

| Requirement | Line | Checkbox now | Table row | Body | Agrees? |
|---|---|---|---|---|---|
| **FND-10** | 109 | `- [ ]` | line 410 `**Pending — do not close until a KMS vendor is named (B-3/D-27).**` | "**STAYS PENDING.** … no KMS-backed master key exists yet" | ✓ |
| **DAT-13** | 212 | `- [ ]` | line 414 `**Pending — contract half only.**` | requirement statement describes behaviour Phase 6 must surface | ✓ |
| **AUD-10** | 239 | `- [ ]` | line 413 `**Pending — contract half only.**` | requirement statement describes Phase 3/4 behaviour | ✓ |

### 2. Full sweep — every checkbox against every coverage-table row

A deterministic parser swept the whole file, not just the three named IDs:

```
checkboxes parsed = 142   coverage-table rows parsed = 142
=== CLEAN: every checkbox agrees with its coverage-table row ===
=== table rows with NO checkbox: 0 ===
=== body-contradiction scan over CHECKED requirements ===
  CLEAN: no checked requirement's own body declares it pending
census: checked (12) = FND-01..FND-09, LNK-07, OBS-01, RTE-10
        unchecked (130)
```

The mapping is **bijective** — no orphan in either direction, and no requirement outside the three previously flagged is in the same class. The 12 checked IDs are exactly Phase 1's delivered set minus the three deliberate deferrals, and all 142 are mapped to a phase (the file's own census says `Mapped to phases: 142 · Unmapped: 0`).

### 3. The sweep was falsified against the pre-fix tree

A sweep that reports clean is worthless unless it can report dirty. Replaying the identical logic against `REQUIREMENTS.md` as of `1f239f0` (the parent of the fix):

```
=== DISAGREEMENTS (checkbox vs coverage-table row) ===
  AUD-10: checkbox line 239 = [x]  VS  table line 413 = **Pending — contract half only.** …
  DAT-13: checkbox line 212 = [x]  VS  table line 414 = **Pending — contract half only.** …
  FND-10: checkbox line 109 = [x]  VS  table line 410 = **Pending — do not close until a KMS vendor is named…
=== body-contradiction scan ===
  !! FND-10 line 110 [STAYS PENDING]: **STAYS PENDING. Nothing in plan 10 touches it and nothing could.** …
census: checked (15) → 12 delivered + the 3 over-claimed
```

It reproduces the predecessor's finding exactly, and reports clean on the current tree. **The scanner is load-bearing; the clean result is a finding.**

### 4. Downstream claims that depended on the fix are now true again

- `01-VALIDATION.md` line 15 — *"`nyquist_compliant: true` must not be read as 'FND-10 is fully delivered' — it is not, and REQUIREMENTS.md says so."* — **true again.** The checkbox no longer contradicts it. The predecessor logged the falsity of this clause as a separate advisory; it is now resolved by the same fix, not by anything else.
- **WINDOWS #17** was widened as claimed, in both the markdown row (line 34) and the JSON block, with a `SCOPE CORRECTION 2026-10-04` recording that *"phase.complete writes TWO machine-consumed fields per requirement — the `- [x]` checkbox and the coverage-table Status cell … Any revert of this class must change BOTH fields."* This addresses the third `missing:` item and — more valuably — records the **class** of defect, so the next occurrence is recognisable without a verifier.
- The gap's root cause is understood and documented: `phase.complete` keys the status write on **phase completion**, not per-requirement evidence. Any requirement deferred past its phase is structurally at risk. WINDOWS #17 stays `open` on that basis.

### 5. One remediation sub-item was not executed — recorded, not fixed

The prior gap listed three `missing:` items. Items 1 (the checkboxes) and 3 (widen WINDOWS #17) are done. **Item 2 — "Give AUD-10 and DAT-13 the same in-place sub-note FND-10 already carries" — was not done:** both remain bare `- [ ]` lines.

I am treating this as an **advisory, not a blocker**, and stating the reasoning so it can be overruled:

- The gap's **truth** — *"REQUIREMENTS.md reports each requirement's delivery status without contradicting the requirement's own body or its coverage-table row"* — is satisfied. Nothing contradicts anything.
- The harm item 2 described was *"rather than seeing three bare **checked** boxes"*. That specific harm — bare unchecked boxes silently asserting delivery — is eliminated. A bare `[ ]` asserts non-delivery, which is true of all three.
- The reason-for-deferral is not lost. It is in the coverage table, which for AUD-10 and DAT-13 carries a **longer** explanation than an inline sub-note would (which half shipped, which phase owns the rest).
- Blocking on this would create an unbounded remediation loop: the next pass could object that the sub-notes are not worded identically to FND-10's, and so on, without ever reaching a state where the *truth* is at stake.

**Left unfixed per the hard constraint — reported here, not edited.**

---

## No Regression

### Structural bound — stronger than re-reading

Every one of the 104 covered files was checked against git history since the predecessor's `verified: 2026-10-04T11:45:27Z`:

| File | Committed since predecessor's verification |
|---|---|
| `.planning/REQUIREMENTS.md` | `0fb56b1` |
| `.planning/WINDOWS.md` | `0fb56b1` |
| `.planning/STATE.md` | *(none)* |
| `.planning/ROADMAP.md` | *(none)* |
| `.github/workflows/ci.yml` | *(none)* |
| `.planning/phases/01-…/01-VALIDATION.md` | *(none)* |
| **all 89 covered non-planning files** | **none — zero changed** |

This confirms the dispatch's premise about the Nyquist work: `7566f99` (toolchain-pin spec + `ci.yml` install-guard) and `1f239f0` (`01-VALIDATION.md`) both landed **before** the predecessor's own run and were already verified by it. Nothing needs re-auditing there. And because **zero covered implementation files changed**, a code regression is not merely unobserved — it is structurally impossible. The targeted runs below are a green check, not the load-bearing evidence.

### Targeted test runs (full suite deliberately NOT run)

| Scope | Command | Result |
|---|---|---|
| Nyquist + build/deploy shape | `vitest run tooling/{toolchain-pin,deployment-shape,boundaries.fixture,entrypoint-drift}.spec.ts` | ✅ 4 files / **49 tests** |
| 4 frozen contracts + crypto + log allowlist | `vitest run packages/contract/src/{jev/jev-v1.frozen,links/read-link-claims.frozen,links/rate-limit-key,connector/connector}.spec.ts packages/platform/src/logging/log-allowlist.formatter.spec.ts packages/platform/src/crypto` | ✅ 9 files / **116 tests** |
| OTel allowlists + pino (rulings 2 & 3) | `vitest run packages/platform/src/otel/{span-attribute-allowlist,allowlist-span-exporter}.spec.ts packages/platform/src/logging/pino.config.spec.ts` | ✅ 3 files / **37 tests** |
| FND-05 state transition (single named test) | `vitest run packages/platform/src/health/health.controller.spec.ts -t 'returns 200 with { status: "ok" } while every dependency is failing'` | ✅ 1 test (6 skipped by the `-t` filter) |
| **Total re-run** | | ✅ **16 files / 202 tests** |

**The full suite was not run.** The predecessor recorded 36 files / 346 tests green; nothing in the covered implementation set changed since, and the dispatch asked for targeted verification. Stated plainly rather than implied.

### Debt-marker gate

`TBD|FIXME|XXX` across all 89 covered non-planning files yields **one** match: `package-lock.json:7099`, the substring `XXX` inside a base64 SHA-512 `integrity` value. Not a debt marker. **Clean — no unreferenced debt markers, so no blocker under the marker gate.**

### The 5 ROADMAP success criteria — 5/5

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | `npm ci` clean; `.nvmrc` + lockfile pin Node 24 / TS 6.0.3; lockfile-free install guarded | ✓ VERIFIED | `.nvmrc` = `24`; `package.json` has exact `"typescript": "6.0.3"`; `toolchain-pin.spec.ts` guards both (green above) |
| 2 | Three processes; each answers `/health/live` (no deps) and `/health/ready` (Mongo + **both** Redis); a Redis blip fails readiness without restarting a healthy pod | ✓ VERIFIED | named test passes: `health.controller.spec.ts` liveness returns 200 *while every dependency is failing*, and `returns 503 naming redis_queue when only the queue deployment is down` |
| 3 | Boundary-crossing import fails the build; entrypoints cannot drift into one process | ✓ VERIFIED | `boundaries.fixture.spec.ts` + `entrypoint-drift.spec.ts` green |
| 4 | A log line carrying a user email is dropped by the serialiser; no `submission_id` recoverable from the trace ID | ✓ VERIFIED | `log-allowlist.formatter.spec.ts` — `expect(out).not.toContain('user_email')` and a 3-level nested `err.cause` case; `span-attribute-allowlist.spec.ts` — `expect(SPAN_ATTRIBUTE_ALLOWLIST).not.toContain('submission_id')`, and a plant test proving `submission_id` cannot be smuggled in |
| 5 | Read-link claim shape + decision wire contract published as versioned schemas with frozen-field tests | ✓ VERIFIED | `read-link-claims.frozen.spec.ts` + `jev-v1.frozen.spec.ts` green; `jev-response.ts` carries `choice.verified` and `state.force_clarification` |

### The 4 irreversible contracts — 4/4 present and enforced

| Contract | Enforcement artifact | Status |
|---|---|---|
| Read-link claims (D-21) | `packages/contract/src/links/read-link-claims.ts` + frozen spec | ✓ |
| JEV wire contract (D-23) | `packages/contract/src/jev/v1/` + frozen spec | ✓ |
| Connector contract | `packages/contract/src/connector/connector.ts` + spec | ✓ |
| Log field-allowlist before serialisation (D-17) | `log-allowlist.ts` + `log-allowlist.formatter.spec.ts` | ✓ |

### The 3 requirement-conflict rulings — 3/3 enforced in code

| Ruling | Enforced by | Status |
|---|---|---|
| 1 — per-IP loses (`AUD-10`) | `rate-limit-key.ts`: the scope union has exactly two members, so an address cannot *be* a scope | ✓ |
| 2 — trace ID loses (`FND-07`) | `span-attribute-allowlist.ts` / `allowlist-span-exporter.ts`: default-deny attribute allowlist; `submission_id` is neither a span attribute nor a trace seed (D-18) | ✓ |
| 3 — audit wins, erasure narrowed (`FND-06`) | `log-allowlist.ts` default-deny field allowlist applied **before** serialisation | ✓ |

### Requirement accounting — 15/15

Phase 1 owns FND-01…FND-10, LNK-07, RTE-10, AUD-10, DAT-13, OBS-01.

- **12 delivered and checked**: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08, FND-09, LNK-07, OBS-01, RTE-10.
- **3 pending by design, honestly recorded**: FND-10 (KMS vendor adapter blocked on B-3/D-27), AUD-10 and DAT-13 (contract halves shipped; behaviour halves belong to Phase 3/4 and Phase 6). All three now read `- [ ]` **and** `**Pending**` in the table, and all three carry a written reason. This is the state the blocker was about, and it is now the state.

---

## Digest

Regenerated with `gsd_run query verification.fingerprint`, **three consecutive runs, identical output**:

```
"covered_digest": "v2:sha256:b51ad6476ce87b1d07769f27d702384ed307ea9c3d37363247019c942f533445"
```

**This is byte-identical to the predecessor's `covered_digest`.** That is the expected and correct result, and it is itself the proof of the digest-inertness claim:

- The tool's own rule confirms it — passing only planning documents returns *"could not compute fingerprint — every covered file is a repo-wide planning document (direct children of `.planning` never enter the digest)"*. `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md` and `WINDOWS.md` are direct children of `.planning`, so `0fb56b1`'s edits to two of them cannot move the digest.
- Confirmed empirically: `0fb56b1` changed exactly two files, both planning documents, and the digest did not move.
- Determinism confirmed: 3/3 identical runs.

**`01-VERIFICATION.md` is deliberately excluded from `covered_files`** — a verifier cannot fingerprint a file it is about to overwrite. `covered_files` holds 104 entries; all 20 phase PLAN/SUMMARY files are present; no nested `plans/` directory exists. Five phase-local documents are excluded as inputs rather than deliverables — `01-DISCUSSION-LOG.md`, `01-PATTERNS.md`, `01-RESEARCH.md`, `COVERAGE.md`, `SKELETON.md`. The list is held **stable** from the predecessor so the digest remains a comparable series; widening it now would silently reset the baseline.

---

## Advisory (New Scope, Unevidenced)

Reported, not blocking. None of these reverts a completed must-have; none is a carried-forward gap; every file involved is unmodified since the predecessor's `verified:` timestamp, so none is a regression either.

| # | Finding | Category | Why Advisory |
|---|---|---|---|
| 1 | **AUD-10 and DAT-13 lack the in-place deferral sub-note FND-10 carries** (prior gap `missing:` item 2, not executed) | other | The gap's truth now holds — nothing contradicts anything, and the reason lives in a *longer* coverage-table cell. Documentation ergonomics, not a status defect. Blocking would create an unbounded wording loop. **Deliberately not fixed** — hard constraint. |
| 2 | **`STATE.md` `Pending Todos` holds stale plan-handoff notes.** The FND-05 entry reads *"`FND-05` is still PENDING and must stay that way until plan 10 mounts the controller"* — plan 10 mounted it and FND-05 is `[x]` / `Complete (01-10)`. Likewise *"Plan 10 must wrap both readiness indicators"* (plan 10 wrapped them), the `package.json` `exports` hand-off (*"now recurred FOUR times"* — gap G-1, closed at `44b0619`), and the plan-09 heartbeat note. The section already has a `[CLOSED by 01-08]` convention that was applied to one item and not these. | other | Narrative handoff notes, explicitly plan-scoped (`[Phase 1] (01-07)`), in a file no tooling reads for requirement status — not a machine-consumed field like the REQUIREMENTS.md checkbox. `STATE.md` unmodified since the prior pass. The FND-10 entry in the same section is still **true**, which is why the section as a whole is not wrong, only partly stale. Reported, not fixed. |
| 3 | **Six root dependencies are absent from the `STACK.md` §14 version ledger**, which T-1-SC makes the human-checkpoint trigger for supply-chain additions: `@opentelemetry/sdk-metrics`, `@opentelemetry/sdk-trace`, `@nestjs/testing`, `@testcontainers/mongodb`, `@testcontainers/redis`, `@types/node` | other | Each is provably the module-package companion of an already-ledgered parent — `sdk-metrics`/`sdk-trace` of `@opentelemetry/sdk-node`, the testcontainers drivers of `testcontainers`, `@nestjs/testing` the test sibling of `@nestjs/core`, `@types/node` type defs only. None is an unvetted technology. No failing assertion; `package.json` unmodified since the prior pass. Worth closing because it weakens the ledger as a control, not because any of the six is wrong. |
| 4 | **The NestJS version is asserted by nothing.** `package.json` carries `"@nestjs/core": "^12.1.2"` — a **caret range**, so `12.1.2` is not even an exact pin in the manifest, while `typescript` is pinned exactly and both Node declarations are guarded. | other | Carried forward, now with sharper evidence than the predecessor had. `toolchain-pin.spec.ts` guards `typescript` and Node only; `deployment-shape.spec.ts:163,197` asserts `typescript` and `vitest` are *members* of the build-tooling set — presence, not version. STACK.md §4.1 and §14 record `12.1.2`; AGENTS.md's constraints name "NestJS 12" as a family. No stated exact-pin requirement to violate, hence no failure — the asymmetry deserves a deliberate decision rather than silence. |
| 5 | **The `install-guard` TypeScript-version step has never executed on a real Actions runtime** (`ci.yml` line 77, `node -e "…node_modules/typescript/package.json…"`). | other | Carried forward. There is no GitHub Actions runtime here. It should be satisfiable: the root manifest pins `typescript` to the exact string `6.0.3`, so a lockfile-free install has exactly one admissible resolution. Recorded because an unexecuted CI step is an unexecuted CI step. |
| 6 | **WINDOWS #5 (`msg` is the one channel the log allowlist cannot filter) is open and blocks `/gsd-ship`.** | other | Carried forward, needs a human ruling — pino emits `msg` verbatim *after* `formatters.log` runs, so no field allowlist can filter it. **Correction to the predecessor:** the blocking count is `open_count: 7`, not 6. Verified by parsing all 17 WINDOWS entries — status census `{fixed: 9, waived: 1, open: 7}` against a declared `open_count: 7` (**match**). `git show` at `90615b3` and `1f239f0` both read `open_count: 7`, so `0fb56b1` did not change it and the predecessor's figure was simply an off-by-one. Open entries: #5, #7, #13, #14, #15, #16, #17. |
| 7 | **WINDOWS #16** — the three `apps/{api,worker,scheduler}/otel.mjs` loaders sit outside both boundary controls (the `files` block covers `**/*.{ts,mts,cts}`, every element pattern is `apps/<app>/src/**`). | other | Carried forward; accepted recorded residual (WR-02), owner assigned. |
| 8 | **The `test/setup-env.ts` forward trap** — seeds `CRYPTO_KEY_PROVIDER` but not `CRYPTO_LOCAL_KEY_FILE`, so a test that boots a real process must set the latter itself. | other | Carried forward. Intended per STATE.md's Blockers/Concerns entry (eager provider ⇒ every process must name a key file; a path, never the key). |
| 9 | **CONTEXT.md decision drift** — D-15 `formatters.log` wording; D-01/D-02 say "12 domain modules" against 13 shipped. | other | Carried forward, not re-measured. Recorded in STATE.md / `01-ASSUMPTIONS.md` with an owner. |
| 10 | **ROADMAP declares `Mode: mvp` for Phase 1 while the goal is a technical statement, not a user story.** `query user-story.validate` returns `valid: false` with all three slot errors. | other | Carried forward. Under the MVP-mode rules verification would normally refuse outright. **Not refused, for the same two stated reasons as the predecessor:** the phase carries five explicit technical success criteria that are fully verifiable and all five were verified, and a roadmap metadata inconsistency is not a phase-goal failure. Recorded rather than silently ignored, and the developer may overrule this. |
| 11 | **`dist/` retains build artifacts whose sources no longer exist:** `packages/kernel/dist/zz-demo-violation.d.ts`, `packages/platform/dist/__probe__/probe.spec.d.ts`. | other | Carried forward. Not a repository defect — `dist` is gitignored and `git ls-files packages/*/dist` is empty — but it matters because two open findings concern what `dist/` ships (WR-03, WINDOWS #8). |
| 12 | **The predecessor's `gaps_found` report was never committed.** `git log` shows `01-VERIFICATION.md` last committed at `0cab61f` (which still contains the older `passed`, 15/15 report); the working tree held the uncommitted `gaps_found` version until this rewrite. | other | Recorded so the orchestrator is not surprised: the gap and its fix are both visible only through `90615b3` and `0fb56b1`, and this file supersedes the uncommitted predecessor in one step. Not a phase defect. |

---

## Human Verification

**N/A — infrastructure/foundation phase with no user-facing elements.** Per the infrastructure-phase gate: the goal and all five success criteria describe only technical artifacts (files exist, builds pass, schemas frozen, boundaries enforced). No UI, no user-visible CLI output, no real-time behaviour to observe.

No `⚠️ PRESENT_BEHAVIOR_UNVERIFIED` truths and no `⚠️ insufficient_spec` abstentions arose this pass, so the gate's exception does not apply and `human_verification` is `[]`. Specifically, the one behaviour-dependent truth in this phase — FND-05's *"a Redis blip fails readiness without restarting a healthy pod"* — is backed by a **named test that was executed and passed** this pass, not by symbol presence.

No planner-deferred `<human-check>` blocks exist: `grep -rn 'human-check'` across all 10 phase PLANs returns nothing. The single `human-verify` mention is inside `01-01-PLAN.md`'s threat-model table (T-1-SC, the STACK.md-ledger checkpoint rule), which is a plan-time escalation rule rather than a deferred verification item — addressed in advisory #3.

---

## Gate Record

| Gate | Result |
|---|---|
| Observable truths | 5/5 ROADMAP criteria VERIFIED · 15/15 requirement IDs accounted for · 1/1 metadata-consistency truth VERIFIED (the blocker) |
| Artifacts | 104 covered files, all present and substantive; no MISSING, no STUB |
| Key links | 4 contracts, 3 rulings, 3 entrypoints — all WIRED; no NOT_WIRED, no PARTIAL |
| Data-flow | N/A — no rendering surface in this phase |
| Debt-marker gate | Clean (single `XXX` match is a base64 integrity hash) |
| Test-quality audit | No `it.skip`/`describe.skip`/`xit`/`test.todo` found in the re-run specs; assertions are value- and behavioural-level (`not.toContain`, exact-match scope unions, HTTP status codes), not existence-level |
| Behavioural spot-checks | 16 files / 202 tests green, plus 1 named FND-05 transition test. Full suite **not** run |
| Probe execution | N/A — no `scripts/*/tests/probe-*.sh` in this phase |
| Decision coverage | Carried in advisory #9; non-blocking by design |
| Digest | Regenerated 3×, byte-identical to predecessor |
| File writes | `01-VERIFICATION.md` only |

---

## Status Derivation

Applying the decision tree in order:

1. **Any FAILED truth / MISSING or STUB artifact / NOT_WIRED link / 🛑 blocker?** No. The carried-forward gap is closed and proven by a falsified sweep. All Step 7 findings are new-scope on unmodified files with no deterministic evidence, so each is downgraded to advisory rather than blocking. No self-evidencing debt markers. → rule 1 does not fire.
2. **Any human verification items?** No. Infrastructure phase, `human_verification: []`, no behaviour-unverified truth, no abstained truth, no deferred `<human-check>`. → rule 2 does not fire.
3. **All truths verified, all artifacts pass, all links wired, no blockers, no human items?** Yes.

→ **`status: passed`**

---

## Housekeeping

**Files written by this run:** `01-VERIFICATION.md`, and nothing else. `git status --porcelain` is unchanged apart from that one already-modified file — the pre-existing untracked entries (`.gsd/` holding a `dispatch-isolation-sentinel.json` from 2026-10-02, `.planning/state.json`, `prototypes/`) were present before this run and were not touched. Sweep scripts were written to `/tmp/opencode/`, outside the repository, so no instrument of verification can perturb the digest it measures.

**Nothing was committed.** The orchestrator owns committing.

**Note for the committer:** this report supersedes the predecessor's uncommitted `gaps_found` report (advisory #12). `0fb56b1` is the fix it describes, and `WINDOWS` #17 stays open on the underlying root cause — `phase.complete` writes requirement status on phase completion rather than per-requirement evidence, so any requirement deliberately deferred past its phase remains structurally at risk of the same overwrite. The WINDOWS #17 scope correction records the shape of that risk; it does not remove it.

---

_Verified: 2026-10-04T12:26:40Z_
_Verifier: the agent (gsd-verifier), re-verification_
