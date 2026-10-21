---
phase: 01-foundations-platform
plan: 04
subsystem: infra
tags: [pino, logging, pii, allowlist, gdpr, erlang, structured-logging, zod]

requires:
  - phase: 01-foundations-platform (plan 01)
    provides: npm workspaces, TS 6.0.3 pin, Zod-validated boot config, `api` /health/live
  - phase: 01-foundations-platform (plan 02)
    provides: `AppConfigSchema` + `APP_CONFIG_KEYS`, from which this plan takes `NODE_ENV` and `SERVICE_NAME`
  - phase: 01-foundations-platform (plan 03)
    provides: the boundary graph — `platform` may import `kernel` only, so the new `logging/` module is `platform`-local
provides:
  - "LOG_FIELD_ALLOWLIST: the exact 21 D-16 fields, frozen, plus a derived AllowlistedField union"
  - "ErrorCode: a closed 12-member error enum plus toErrorCode, which never returns a raw message"
  - "log(): the formatters.log rebuild hook that is the only object pino serialises"
  - "LoggerPort: a typed info/warn/error/debug surface whose field names ARE the allowlist"
  - "createPinoOptions + createChildLogger: one logging configuration per process"
  - "D-17's three-level PII test, asserted against the serialised string"
actuals:
  tokens: 13400
  tasks: 3
  commits: 3
commits: 3
plan_head_before: dfd7e55e79f5812cf6dae2b2cab66420ea9168a1
plan_head_after: 2d6f1ce1fd294d1a1ed7407d8ec6ba8dc1b3fb9f

tech-stack:
  added:
    - "pino@10.3.1 (exact STACK.md §14 pin) — the serialiser the allowlist gate is attached to"
  patterns:
    - "Rebuild, do not prune: the hook allocates a fresh object and copies allowlisted keys, so an unknown key cannot survive at any depth and the input is never mutated"
    - "The gate is attached to pino's `formatters.log`, whose return value is what `JSON.stringify` sees — a destination stream is downstream of serialisation and cannot be the control"
    - "Inert config is worse than no config: a pino option that upstream discards is removed and the test asserts its absence"

key-files:
  created:
    - packages/platform/src/logging/log-allowlist.ts
    - packages/platform/src/logging/error-codes.ts
    - packages/platform/src/logging/log-allowlist.formatter.ts
    - packages/platform/src/logging/log-allowlist.formatter.spec.ts
    - packages/platform/src/logging/logger.port.ts
    - packages/platform/src/logging/logger.port.spec.ts
    - packages/platform/src/logging/pino.config.ts
    - packages/platform/src/logging/pino.config.spec.ts
    - packages/platform/src/logging/index.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "D-15's layer-2 mechanism is CORRECTED, not reversed: `formatters.log`, not a destination stream. A pino destination receives already-serialised bytes (`hooks.streamWrite` is documented as receiving \"the stringified JSON\"), so \"immediately before JSON.stringify\" is unachievable there. RESEARCH B-1's mechanism correction is implemented as written and the D-15 wording is hereby amended."
  - "Allowlisted values are restricted to primitives. Without this, `reason: { detail: { email } }` is 'allowlisted' by key and the three-level guarantee holds only for non-allowlisted containers. No D-16 field is defined to hold a composite value, so the restriction costs nothing and closes the bypass."
  - "`error_code` is normalised through the enum on every record. The key is allowlisted, so without normalisation a caller could pass any string in it — including an email — and the gate would pass it through."
  - "`base: null` is load-bearing, not cosmetic: pino's default prepends a pre-serialised `{pid, hostname}` chunk that never reaches `formatters.log`, and `hostname` is not on D-16's list."
  - "There is deliberately NO `formatters.bindings`; `createChildLogger` pre-rebuilds child bindings instead. pino's `child()` fast path replaces the bindings formatter with an identity function, so the option would be dead config that reads as protective, and `logger.child({user_email})` leaks verbatim."
  - "The pino timestamp is emitted as `ts` (allowlisted) rather than pino's default `time` (not allowlisted). The timestamp function is concatenated as a raw prefix and never passes through the formatter, so the key must be chosen correctly at configuration time."
  - "`msg` is documented as the one channel the allowlist cannot filter. pino emits the message verbatim after the formatter ran; the control is layer 1 plus convention. Claiming otherwise would be false."
  - "Timestamps use a raw `TimeFn` returning epoch ms; the allowlist is a field-name contract and the epoch form is a bare number, where `z.iso.datetime()` would have been a new, unused dependency."

patterns-established:
  - "Backstop tests: a claim that a configuration is protective gets a test that asserts its ABSENCE when the configuration is inert (01-03's rule, applied to pino options and to `@ts-expect-error` directives)"
  - "Compliance assertions read the SERIALISED STRING, never the object handed to the hook — a filter applied after serialisation would satisfy the latter"
  - "Layer 1 and layer 2 are tested independently: the port spec's in-memory double routes through the real rebuild hook, so the tests exercise the composition rather than a mock"

requirements-completed: [FND-06]

coverage:
  - id: D1
    description: "Every structured log record is rebuilt from a frozen 21-field allowlist before serialisation; an email at a typed field, a computed key, or inside a nested err.cause never reaches the output string"
    requirement: FND-06
    verification:
      - kind: unit
        ref: "packages/platform/src/logging/log-allowlist.formatter.spec.ts#formatters.log rebuild hook — D-17 three-level PII test (FND-06)"
        status: pass
    human_judgment: false
  - id: D2
    description: "LOG_FIELD_ALLOWLIST is exactly the twenty-one fields D-16 names, frozen, and a test reads it back"
    requirement: FND-06
    verification:
      - kind: unit
        ref: "packages/platform/src/logging/log-allowlist.formatter.spec.ts#LOG_FIELD_ALLOWLIST (D-16)"
        status: pass
    human_judgment: false
  - id: D3
    description: "An err value becomes an enum-valued error_code; the error object and its cause chain are not carried through"
    requirement: FND-06
    verification:
      - kind: unit
        ref: "packages/platform/src/logging/log-allowlist.formatter.spec.ts#level 3: an email inside a nested err.cause chain never serialises"
        status: pass
    human_judgment: false
  - id: D4
    description: "LoggerPort accepts only allowlisted field names — an unlisted field, a free-form bag, a base field, and a raw Error are all compile errors"
    requirement: FND-06
    verification:
      - kind: unit
        ref: "packages/platform/src/logging/logger.port.spec.ts#LoggerPort — closed at compile time (T-1-10)"
        status: pass
      - kind: other
        ref: "npx tsc -p packages/platform/tsconfig.json --noEmit — exit 0, and TS2578 verified to fire when a directive goes unused"
        status: pass
    human_judgment: false
  - id: D5
    description: "A real pino instance built from createPinoOptions emits only allowlisted keys, and no path-based redaction list is registered"
    requirement: FND-06
    verification:
      - kind: unit
        ref: "packages/platform/src/logging/pino.config.spec.ts#createPinoOptions — a real pino instance emits only allowlisted keys"
        status: pass
    human_judgment: false
  - id: D6
    description: "A child logger's bindings are gated — pino's own child() fast path is not, which a failing test found and createChildLogger closes"
    requirement: FND-06
    verification:
      - kind: unit
        ref: "packages/platform/src/logging/pino.config.spec.ts#gates a child logger's bindings through createChildLogger"
        status: pass
    human_judgment: false
  - id: D7
    description: "Human review of the residual risk that `msg` is emitted verbatim by pino and is therefore not filterable by the allowlist — every other channel is provably closed, this one is a convention"
    requirement: FND-06
    verification: []
    human_judgment: true
    rationale: "The residual risk is a design property of pino, not a defect automation can detect: a developer can write `logger.info('failed for ' + userInput)` and every automated test will pass, because the message is outside the gate by pino's own design. Judging whether the convention is acceptable for an enterprise erasure promise is a human call, and the answer constrains plan 10's wiring (a lint rule banning interpolation in log calls, or an eslint-restricted-template-expressions entry, is the likely follow-up)."

duration: 159min
completed: 2026-10-02
status: complete
---

# Phase 01 Plan 04: PII-Safe Structured Logging Summary

**Every log record rebuilt from a frozen 21-field allowlist inside pino's `formatters.log`, so no email — at a typed field, a computed key, or inside an `err.cause` — reaches the serialised string, with a `LoggerPort` that makes the same mistake a compile error**

## Performance

- **Duration:** 159 min
- **Started:** 2026-10-02T12:26:07Z
- **Completed:** 2026-10-02T15:05:00Z
- **Tasks:** 3 (3/3 complete, no checkpoints in this plan)
- **Files modified:** 11 (9 created, 2 modified)
- **Suite:** 10 test files / 72 tests green (was 7 / 36); `npm run build` (= `npm run lint && tsc -b`) exit 0

## Accomplishments

- **The drop-before-serialise control exists and is provable.** The D-17 three-level test asserts against `JSON.stringify(log(record))` — the bytes that would be written to disk — and finds none of the three seeded emails. A test that inspected the returned object could have been satisfied by a downstream filter, which is precisely the control that does not exist.
- **D-15's layer-2 wording is corrected, not reversed.** The plan called for "a pino custom destination stream … immediately before `JSON.stringify`". That is not implementable: `hooks.streamWrite` is documented as receiving "the stringified JSON", and a destination is downstream of serialisation. `formatters.log` is the hook whose return value is what gets serialised (verified in `node_modules/pino/lib/tools.js` `_asJson`), and it satisfies both of D-15's stated properties — before serialisation, unknown keys stripped — exactly. This implements RESEARCH blocker B-1 as written.
- **A real PII leak was found and closed.** pino's `child()` takes a fast path that replaces `formatters.bindings` with an identity function, so `logger.child({ user_email })` serialises the email verbatim with nothing in the way. The test failed with the email in the output; `createChildLogger` now rebuilds bindings *before* pino sees them, relying on no pino internal.
- **The allowlist is total, not partial.** Three of pino's four key sources never pass through `formatters.log`. `level` and `ts` are configured to route through the same gate (`formatters.level`, a custom `TimeFn` emitting the allowlisted name `ts`); the fourth, a default `{pid, hostname}` bindings chunk, is suppressed with `base: null` because `hostname` is not on D-16's list.
- **The type layer is closed and tested by construction.** Ten `@ts-expect-error` directives cover an unlisted field, three free-form bag names, all three base fields, and a raw `Error` in place of the enum. `tsc` was verified to fail with TS2578 when a directive goes unused, so the surface cannot silently loosen.

## Task Commits

Each task was committed atomically:

1. **Task 1: Rebuild-from-allowlist log formatter and the three-level PII test** — `81c6194` (feat)
2. **Task 2: Typed allowlist-only `LoggerPort` with a compile-time rejection test** — `7d7f117` (feat)
3. **Task 3: Pino options factory that wires the rebuild hook and omits path redaction** — `2d6f1ce` (feat)

**Plan ledger:** `dfd7e55` → `2d6f1ce`, 3 commits.

## Files Created/Modified

- `packages/platform/src/logging/log-allowlist.ts` — the frozen 21-field D-16 list, the derived `AllowlistedField` union, and the O(1) membership `Set`
- `packages/platform/src/logging/error-codes.ts` — the closed `ErrorCode` enum, `isErrorCode`, and `toErrorCode` (never returns a raw message)
- `packages/platform/src/logging/log-allowlist.formatter.ts` — the `formatters.log` rebuild hook: fresh object, allowlisted keys only, `err` replaced by an enum code
- `packages/platform/src/logging/log-allowlist.formatter.spec.ts` — D-17's three-level test plus depth, purity, and round-trip backstops (16 tests)
- `packages/platform/src/logging/logger.port.ts` — `LoggerPort`, `LogFields`, `CallerLogField`; no bag, no raw `Error`
- `packages/platform/src/logging/logger.port.spec.ts` — the in-memory double routing through the real hook, plus the compile-time closure assertions (6 tests)
- `packages/platform/src/logging/pino.config.ts` — `createPinoOptions` and `createChildLogger`, with the four-key-source table and the pino source citations
- `packages/platform/src/logging/pino.config.spec.ts` — a real `pino@10.3.1` instance writing to a capture destination, asserted key-by-key (14 tests)
- `packages/platform/src/logging/index.ts` — the logging barrel, so plan 10 does not edit the platform barrel
- `package.json` / `package-lock.json` — `pino@10.3.1` added (exact pin)

## Decisions Made

1. **`formatters.log` replaces D-15's destination stream** (RESEARCH B-1). Mechanism correction, not a decision reversal — D-15's intent is fully satisfied and its *wording* is hereby amended. Recorded here because B-1 asked the executor to record the correction.
2. **Allowlisted values are primitives only.** Without it, the three-level guarantee holds only for non-allowlisted containers: `reason: { detail: { email } }` is allowlisted by key and would serialise the subtree. No D-16 field is defined to hold a composite value, so the restriction is free and closes the bypass. This is stricter than the plan specified.
3. **`error_code` is normalised through the enum on every record.** D-16 calls the field "a closed enum"; nothing enforced that, because the key is allowlisted. `toErrorCode` is now the normaliser, and it is why `logger.error({ error_code: 'anna@example.com' })` yields `UNKNOWN` rather than the email.
4. **`base: null` and a `ts` timestamp function.** Both are load-bearing for the same reason: pino concatenates them as raw prefixes that never reach the gate, and their default values (`hostname`, `time`) are not on D-16's list.
5. **No `formatters.bindings`; `createChildLogger` instead.** The option is provably inert (pino's child fast path discards it) and dead config that reads as protective is worse than none — 01-03's lesson, reapplied.
6. **`msg` is documented as unfilterable.** pino appends the message after the formatter has run. `LoggerPort` takes it as a fixed first argument so an interpolation is visible at the call site, but no test can catch one. Stated in the module doc and routed to human review as coverage entry D7 rather than quietly claimed.
7. **`pino@10.3.1` is a root devDependency.** It follows 01-01/01-02's convention (all deps at root) and the STACK.md §14 exact pin. It is a *missing stack dependency*, not a new one — T-1-SC's "no new package is introduced here" is satisfied in substance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed `pino@10.3.1`, which the plan's `files_modified` omits**
- **Found during:** Task 3 (pino options factory)
- **Issue:** Task 3's acceptance criteria require "a pino instance built from the options". No `pino` in the tree — `node_modules/pino` did not exist, and `packages/platform/package.json` declares no dependencies (01-01 put everything at the root).
- **Fix:** `npm install --save-dev --save-exact pino@10.3.1` at the root, matching 01-01/01-02's placement and the STACK.md §14 exact pin. No substitution and no version drift.
- **Files modified:** `package.json`, `package-lock.json`
- **Verification:** `node_modules/pino/package.json` reports 10.3.1; `npm run build` and the full suite are green on the resulting lockfile.
- **Committed in:** `2d6f1ce`

**2. [Rule 1 - Bug] Closed a PII leak through pino's `child()`**
- **Found during:** Task 3, by the plan's own "a pino instance built from the options yields no non-allowlisted key" test
- **Issue:** `logger.child({ app_id, user_email })` serialised `"user_email":"anna.pino@example.com"` verbatim. `child()` in `lib/proto.js` deliberately takes a fast path that rebuilds the instance's formatters with `resetChildingsFormatter` (the identity function), so `formatters.bindings` on the root is honoured only for the root's `base` chunk — which this config sets to `null`. A `formatters.bindings` gate would have been dead config that reviews as protective.
- **Fix:** Added `createChildLogger(logger, bindings)`, which rebuilds the bindings through the allowlist before handing them to pino. No pino option and no pino internal is involved, so the guarantee survives a version bump. Removed the inert `formatters.bindings` from the options and added a test asserting its absence.
- **Files modified:** `packages/platform/src/logging/pino.config.ts`, `packages/platform/src/logging/pino.config.spec.ts`
- **Verification:** `pino.config.spec.ts` — the child's line contains neither the email nor `user_email`, and a grandchild test proves the gate holds through nesting. The full 72-test suite is green.
- **Committed in:** `2d6f1ce`

**3. [Rule 2 - Missing Critical] Restricted allowlisted values to primitives**
- **Found during:** Task 1, while satisfying the must_have "a log object that nests a forbidden field two or three levels deep is still stripped"
- **Issue:** The rebuild closes nesting under a *non-allowlisted* container, but an allowlisted key with an object value would serialise its whole subtree — `reason: { detail: { email } }` is "allowlisted" by key. The depth guarantee would hold for one shape of input and not another.
- **Fix:** The hook copies an allowlisted value only if it is a finite number, a string, a boolean, or `null`; anything else is dropped. Non-finite numbers are dropped rather than allowed to serialise as an invented `null`.
- **Files modified:** `packages/platform/src/logging/log-allowlist.formatter.ts`, `packages/platform/src/logging/log-allowlist.formatter.spec.ts`
- **Verification:** `drops an object value even on an allowlisted key` and `drops a non-finite number rather than letting JSON invent a null`.
- **Committed in:** `81c6194`

**4. [Rule 2 - Missing Critical] Normalised `error_code` through the closed enum**
- **Found during:** Task 1
- **Issue:** `error_code` is on the allowlist, so the copy loop passed its value straight through. D-16 requires "a closed enum", but nothing enforced it — a caller could put any string, including an email, into the one field explicitly reserved for a code.
- **Fix:** The hook routes every `error_code` value through `toErrorCode`, which returns a member of the enum or `UNKNOWN`, and an `err`-derived code takes precedence over a caller-supplied one.
- **Files modified:** `packages/platform/src/logging/log-allowlist.formatter.ts`, `packages/platform/src/logging/error-codes.ts`, `packages/platform/src/logging/log-allowlist.formatter.spec.ts`
- **Verification:** `normalises an allowlisted error_code that is not a member of the enum`, plus two tests covering the `err`-derived precedence rules.
- **Committed in:** `81c6194`

**5. [Rule 1 - Bug] Excluded the three base fields from `LoggerPort`'s call-site surface**
- **Found during:** Task 2
- **Issue:** The plan typed the `fields` parameter as `Partial<Record<AllowlistedField, unknown>>` — the full 21 — while also requiring that `service`, `env`, and `pid` "are supplied by the factory, not the call site". The full allowlist would have let a call site relabel which process produced a line.
- **Fix:** `CallerLogField = Exclude<AllowlistedField, 'service' | 'env' | 'pid'>`, derived from the same frozen list. The factory spreads the base fields *after* the caller's object, so the trio wins even if a caller reaches the seam.
- **Files modified:** `packages/platform/src/logging/logger.port.ts`, `packages/platform/src/logging/logger.port.spec.ts`
- **Verification:** Three `@ts-expect-error` directives on the base fields; `pino.config.spec.ts#lets a call site overwrite a base field only by going around the port` proves the runtime side.
- **Committed in:** `7d7f117`

---

**Total deviations:** 5 auto-fixed (1 blocking, 2 missing critical, 2 bug)
**Impact on plan:** All five are correctness or security work inside the plan's own scope; no task was redirected. Deviations 2–5 are strict hardenings of a control whose whole point is that it cannot be repaired after the fact, and each is a test, not a comment.

## Threat Model Disposition

| Threat | Severity / disposition | Status |
|--------|------------------------|--------|
| T-1-09 — Information Disclosure, `log-allowlist.formatter.ts` | high / mitigate | **Mitigated.** Rebuild-from-allowlist in `formatters.log`; the D-17 three-level test asserts the absence of three seeded emails from the serialised string. Deviation 2 found and closed a second route (child bindings). |
| T-1-10 — Information Disclosure, `logger.port.ts` | medium / mitigate | **Mitigated.** Typed allowlist-only surface, no free-form bag, no raw-`Error` shortcut; ten consumed `@ts-expect-error` directives, with TS2578 verified to fire when one goes unused. |
| T-1-SC — Tampering, npm installs | high / mitigate | **Mitigated.** `pino@10.3.1` is the STACK.md §14 exact pin, installed with `--save-exact`; no other logging library was added and none of `pino-http@11.0.0` / `nestjs-pino@5.2.1` is needed until plan 10 wires them. |

## Issues Encountered

- **Two spec assertions were themselves wrong on the first run** and were fixed, not weakened: `expect(out).not.toContain('err')` also matches the substring inside `"error_code"` (now asserted on the quoted-key form), and a purity assertion expected `level: 30` on a record built with `level: 50`.
- **`structuredClone` on an `Error`** returns a `{}`-shaped value with no `cause`, so the first purity test could not compare snapshots. Replaced with object-identity checks, which is a stronger mutation assertion anyway.
- **pino's `Logger` overloads are `(obj, msg)`, not `(msg, obj)`.** Two calls in the first draft of `pino.config.spec.ts` had the arguments reversed; `tsc` caught both.

## Known Stubs

None. No placeholder values, no unwired data sources, no skipped tests, no `TODO`/`FIXME` in the nine created files.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| `threat_flag: ungated-channel` | `packages/platform/src/logging/pino.config.ts` | pino appends `msg` to the line *after* `formatters.log` has run, so the message string is never passed through the allowlist. The control is layer 1 plus convention (`LoggerPort` takes the message as a fixed first argument). Routed to human review as coverage entry D7; plan 10 should consider a lint rule against interpolating values into a log call. |
| `threat_flag: upstream-bypass` | `packages/platform/src/logging/pino.config.ts` | `logger.child(bindings)` is the *only* supported-API path that bypasses the gate, because pino discards `formatters.bindings` on the child fast path. `createChildLogger` is the sanctioned replacement, but nothing prevents a future call site from reaching for `.child()` directly. Plan 10 wires `nestjs-pino`, which creates child loggers for requests — it must route them through `createChildLogger`, or wrap the instance in the `LoggerPort` adapter that exposes no `child()`. |
| `threat_flag: import-surface` | `packages/platform/src/logging/index.ts` | The barrel exists so plan 10 can import the logging surface without editing `packages/platform/src/index.ts`, but `packages/platform/package.json`'s `exports` map declares only `"."`. A cross-package deep import (`@akane/platform/logging`) will not resolve until an `exports` entry is added. Not added here: no consumer exists yet, and changing the package's public resolution is a call for the plan that first needs it. |

## User Setup Required

None — no external service configuration required. `pino@10.3.1` is installed in the committed lockfile.

## Next Phase Readiness

- **Plan 10 can wire the logger** with `createPinoOptions` + `createChildLogger` + the `LoggerPort` types, importing from `packages/platform/src/logging/index.ts`. Read the two threat flags above first: `nestjs-pino`'s own child loggers are the one route that needs a decision.
- **`pino-http@11.0.0` and `nestjs-pino@5.2.1` are still uninstalled.** They are STACK.md §14 pins, not in the tree; plan 10 owns adding them and must use the exact versions.
- **Plan 09 (OTel) must not route log-derived fields into span attributes.** D-18's frozen span-attribute allowlist and this plan's field allowlist are two separate closed sets that happen to share names (`trace_id`, `span_id`, `request_id`); nothing here exports one from the other, and that separation should stay.
- **`test/setup-env.ts` already seeds `NODE_ENV` and `SERVICE_NAME`**, so the pino spec's `env: 'test'` level default is consistent with the rest of the suite.
- **No boundary work needed.** The new module is `platform`-local, imports only `pino` (an allowed external origin) and its own siblings, and `npm run lint` passes against the 01-03 graph unchanged — no reconfiguration of `eslint.config.mjs` or `tooling/boundaries.config.mjs` was required or performed.

## Self-Check: PASSED

- All nine created files exist on disk (verified via `git show --stat` across `dfd7e55..2d6f1ce`).
- All three commit hashes resolve: `81c6194`, `7d7f117`, `2d6f1ce`.
- `npm run build` (lint + `tsc -b`) exit 0; `npx tsc -p packages/platform/tsconfig.json --noEmit` exit 0; `npm test` 10 files / 72 tests passing.
- No tracked files deleted by any commit (`git diff --diff-filter=D` empty for all three).

---
*Phase: 01-foundations-platform*
*Completed: 2026-10-02*
