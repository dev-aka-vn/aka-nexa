---
phase: "01"
slug: "foundations-platform"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: validated
nyquist_compliant: true
wave_0_complete: false
created: "2026-10-04"
validated: "2026-10-04"
# Every requirement in this phase's DELIVERED scope has automated verification.
# Three requirements are partial BY DESIGN and are deferred to a named phase —
# they are listed in `deferred_requirements` below and in Manual-Only, not hidden.
# FND-10 is the load-bearing one: its KMS half is unmet and blocked on naming a
# deployment cloud (B-3 / D-27). `nyquist_compliant: true` must not be read as
# "FND-10 is fully delivered" — it is not, and REQUIREMENTS.md says so.
deferred_requirements:
  - id: FND-10
    missing: "KMS-backed master key"
    owner: "blocker B-3 / decision D-27 — gate for Phase 5"
  - id: AUD-10
    missing: "'blocks only on signature failure' behaviour"
    owner: "Phase 3/4"
  - id: DAT-13
    missing: "App Builder surfacing of supports_idempotency_key"
    owner: "Phase 6"
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> **Reconstructed, not authored.** This phase was executed before Nyquist validation
> was enabled (`workflow.nyquist_validation` was `false`). State B of
> `validate-phase.md` — the map below was rebuilt from 10 PLAN + 10 SUMMARY artifacts,
> then the two gaps it found were filled. See *Validation Audit* at the foot.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 5.0.3 (NestJS 12's ESM default; aligns with `nest new` output) |
| **Config file** | `vitest.config.mts` |
| **Quick run command** | `npm test -- <spec-path>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | quick ~4 s · full ~700 s (34→36 files, 346 tests) |

**Why the full suite is slow, and why that matters.** Many specs start real MongoDB +
Redis containers via `testcontainers`, because mocks would not catch `GETDEL`
atomicity or BullMQ retry semantics — the two highest-risk Redis-dependent behaviours
in the system. So the suite's cost is deliberate. It also means a *targeted* green run
is not sufficient evidence: a defect can pass in isolation and fail under 36-way
worker contention. Plan 01-07 found exactly that (`serverSelectionTimeoutMS` failing
~50% of full-suite runs while its isolated spec passed every time). **Run the full
suite before claiming a task done.**

---

## Sampling Rate

- **After every task commit:** `npm test -- <the task's spec path>` (~4 s)
- **After every plan wave:** `npm test` (full, ~700 s)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 4 s targeted · 700 s full-suite

---

## Per-Task Verification Map

Tasks within a plan share that plan's `<automated>` verify command and spec set, so
rows are collapsed per plan rather than repeated 32 times. Task counts and `tracer`/
`tdd` markers are exact; threat IDs are the plans' own.

| Plan | Wave | Tasks | Requirement | Threat Ref | Test Type | Automated Command | Status |
|------|------|-------|-------------|------------|-----------|-------------------|--------|
| 01-01 | 1 | 5 (1 `tracer`) | FND-01, FND-02, FND-03 | T-1-01…03, T-1-SC | install + build + CI | `npm ci` · `npm run build && npm test` · CI `build` + `install-guard` jobs | ✅ |
| 01-02 | 2 | 3 | FND-09, FND-05 | T-1-04…06, T-1-SC | unit | `npm test -- config.schema.spec.ts redis.schema.spec.ts redis.provider.spec.ts` | ✅ |
| 01-03 | 2 | 3 | FND-04, FND-03 | T-1-07, T-1-08, T-1-SC | build-gate + unit | `npm run build` · `npm test -- provider-boundary.guard.spec.ts boundaries.fixture.spec.ts` | ✅ |
| 01-04 | 2 | 3 | FND-06 | T-1-09, T-1-10, T-1-SC | unit | `npm test -- log-allowlist.formatter.spec.ts logger.port.spec.ts pino.config.spec.ts` | ✅ |
| 01-05 | 3 | 3 | FND-10 | T-1-11…13, T-1-SC | unit | `npm test -- envelope.spec.ts local-key-provider.spec.ts production-guard.spec.ts key-provider.contract.spec.ts` | ✅ (contract half) |
| 01-06 | 2 | 3 (all `tdd`) | LNK-07, RTE-10, AUD-10, DAT-13 | T-1-14…16, T-1-SC | contract | `npm test -- jev-v1.frozen.spec.ts read-link-claims.frozen.spec.ts rate-limit-key.spec.ts connector.spec.ts events.spec.ts` | ✅ (2 contract halves) |
| 01-07 | 2 | 3 (2 `tdd`) | FND-05 | T-1-17, T-1-18, T-1-SC | integration (real containers) | `npm test -- health.controller.spec.ts health.indicators.spec.ts mongo.service.spec.ts redis.integration.spec.ts` | ✅ |
| 01-08 | 3 | 3 (2 `tdd`) | FND-08, OBS-01 | T-1-19, T-1-20, T-1-SC | integration | `npm test -- queue.spec.ts queue.integration.spec.ts business-metrics.spec.ts` | ✅ |
| 01-09 | 4 | 3 (2 `tdd`) | FND-07, OBS-01 | T-1-21, T-1-22, T-1-SC | unit + subprocess | `npm test -- otel.bootstrap.spec.ts span-attribute-allowlist.spec.ts allowlist-span-exporter.spec.ts metrics.controller.spec.ts otel.bootstrap.ordering.spec.ts` | ✅ |
| 01-10 | 5 | 3 (1 `tracer`) | FND-03, FND-05, FND-08, OBS-01 | T-1-23, T-1-24, T-1-SC | build-gate + boot | `npm run build` · `npm test -- entrypoint-drift.spec.ts health.controller.spec.ts deployment-shape.spec.ts` | ✅ |
| **—** | — | **added by this audit** | **FND-01, FND-02** | *(closes WR-10)* | manifest + CI-shape | `npm test -- tooling/toolchain-pin.spec.ts` | ✅ **new** |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Requirement coverage: 15/15 accounted for** — 12 fully covered, 3 partial by design
(deferred, see Manual-Only).

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — Wave 0 was not required and
`wave_0_complete: false` is accurate rather than an omission. The phase was executed
against pre-existing Vitest infrastructure that plan 01-01 pinned.

---

## Manual-Only Verifications

These are **not** gaps in Phase 1. Each is either blocked or owned by a named later
phase. Filling them here would mean building later-phase behaviour.

| Behavior | Requirement | Why Manual / Deferred | Owner |
|----------|-------------|------------------------|-------|
| A KMS-backed master key actually encrypts secrets at rest | FND-10 | **Blocked** — no deployment cloud named. The envelope, `KeyProvider` and fail-closed production guard all exist and are proven; the KMS half cannot be written without a vendor. | Blocker B-3 / D-27 — **gate for Phase 5** |
| An audit scope "blocks only on signature failure" | AUD-10 | Phase 3/4 behaviour. Phase 1 delivered the scope type only. | Phase 3/4 |
| `supports_idempotency_key` surfaced in the App Builder | DAT-13 | Phase 6. Phase 1 delivered it as a *required* boolean, so absent cannot read as `false`. | Phase 6 |
| A ruling on whether `msg` may carry interpolated values | FND-06 (partial) | `msg` is emitted by pino *after* `formatters.log` runs, so it is the one channel the allowlist cannot filter. Needs a human decision plus likely a lint rule. | **WINDOWS #5 — human ruling** |
| Whether a `.mjs` loader entry belongs to the `app-<name>` boundary element | FND-04 (residual) | Measured: widening the rule's `files` to `**/*.mjs` still yields 0 diagnostics even for a planted violation, and `checkUnknownLocals` governs unknown *targets*, not unknown *origins*. Closing it is an element-graph decision. | **WINDOWS #16 — D-02 scoping** |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — 32/32
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] All MISSING references filled — 2 gaps found, 2 resolved, 0 escalated
- [x] No watch-mode flags
- [x] Feedback latency < 5 s targeted (4 s measured)
- [x] `nyquist_compliant: true` set, with the 3 deferred requirements enumerated in
      frontmatter and Manual-Only rather than omitted
- [ ] **Approval** — pending human sign-off

### Test files generated by this audit

| File | Assertions | Purpose |
|------|-----------|---------|
| `tooling/toolchain-pin.spec.ts` | 16 | Exact toolchain pins: `typescript` is literally `6.0.3` (root + lock + *installed*), `.nvmrc` is `24`, `engines.node` is `">=24 <25"`, the two Node declarations agree with each other, the lockfile exists **and** is git-tracked, both CI jobs read `.nvmrc` instead of hardcoding, and the `install-guard` install carries no peer-dependency bypass flag. |

`.github/workflows/ci.yml` was also modified — the `install-guard` job now extracts its
install command **once**, asserts it carries no bypass flag **before** executing it, and
resolves the actual TypeScript version. This makes a documented-but-absent control real,
closing code-review finding **WR-10**.

---

## Validation Audit 2026-10-04

| Metric | Count |
|--------|-------|
| Gaps found | 2 |
| Resolved | 2 |
| Escalated | 0 |
| Requirements audited | 15 |
| Fully covered | 12 |
| Deferred by design | 3 |
| New assertions | 16 |

**Method.** Coverage was classified by cross-referencing each requirement against the
plans' own `<automated>` verify commands and then against the spec files on disk —
34 spec files, 346 assertions at the time of the audit.

**Every new assertion was proven load-bearing**, not assumed: each condition was
temporarily reverted and the test observed RED, then restored. Examples — `typescript`
`6.0.3` → `^6.0.3` goes red; `.nvmrc` `24` → `22` goes red; `git rm --cached
package-lock.json` goes red; adding `--legacy-peer-deps` to the CI install goes red;
moving the assertion step to run *after* the install goes red.

**Why this audit was worth running.** Both gaps were the same shape as defects the phase
had already shipped and caught: a control documented as existing, absent in fact. The
TypeScript pin is the phase's central irreversible claim — `typescript-eslint@8.71.0`
peers `>=4.8.4 <6.1.0` with no optional marking, so npm's `latest` hard-fails install —
yet the exact string `6.0.3` appeared in no assertion anywhere, and a green suite would
have survived a silent bump. Separately, adding `--legacy-peer-deps` to CI would have
turned the install guard into a no-op **while producing a green job**.

**Gate status at audit time:** `npm run build` exit 0 · `npm test -- tooling/toolchain-pin.spec.ts`
16/16 exit 0 · `npm test` 36 files / 346 tests exit 0.