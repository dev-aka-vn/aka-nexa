---
phase: 01-foundations-platform
reviewed: 2026-10-03T00:00:00Z
review_path: 01-REVIEW.md
blocker: 2
warning: 12
info: 9
total: 23
blockers_fixed: 2
---

# Code Review Disposition — Phase 01

> **Sibling artifact, not part of REVIEW.md on purpose.** `--auto`'s re-review loop rewrites REVIEW.md on every
> iteration, so a ledger kept inside it would not survive the next pass — a
> phase could reach `phase.complete` with a Critical standing and no trace it
> was ever seen. REVIEW.md has a single writer (`gsd-code-reviewer`); this file has
> another (`code_review_gate`). Advisory throughout: it never blocks.

## Disposition

Both BLOCKERs are fixed. The 12 WARNINGs and 9 INFOs are **deferred to a later
phase** — none is exploitable today, and fixing them inside the blocker-fix pass
would have widened the diff the review was scoped to.

| ID | Severity | Disposition | Commit | Note |
|----|----------|-------------|--------|------|
| CR-01 | BLOCKER | **fixed** | `4732c30` | See below. |
| CR-02 | BLOCKER | **fixed** | `a458258` | See below. |
| WR-01 | WARNING | deferred | — | Vacuous `QUEUE_PRODUCER_TOKEN` assertion. Belongs with the `api`/`QueueModule` boundary work. |
| WR-02 | WARNING | deferred | — | `.mjs` loader entries escape the R1 controls. |
| WR-03 | WARNING | deferred | — | 33 spec modules compiled into `dist/`. |
| WR-04 | WARNING | deferred | — | `crypto.module.ts` docblock contradicts `config.module.ts`. **Note:** CR-01 required editing both files, so this comment is now stale for a second reason and should be picked up early. |
| WR-05 | WARNING | deferred | — | kernel zero-dependency invariant unenforced. |
| WR-06 | WARNING | deferred | — | Five domain element types have no fixture. |
| WR-07 | WARNING | deferred | — | The "constructor backstop" test does not test the constructor. **Note:** CR-01 added direct constructor coverage in `local-key-provider.spec.ts`, which substantially closes this; the stale case in `production-guard.spec.ts` remains. |
| WR-08 | WARNING | deferred | — | `#lastError` latch never cleared. |
| WR-09 | WARNING | deferred | — | Read-link claim ordering invariant. **Frozen-contract edit — needs an explicit version bump.** |
| WR-10 | WARNING | deferred | — | CI `install-guard` comment promises an assertion. |
| WR-11 | WARNING | deferred | — | `AppConfigObjectSchema` exported with a `PORT` trap. |
| WR-12 | WARNING | deferred | — | `/metrics` scrape has no timeout. |
| IN-01 | INFO | deferred | — | Stale barrel docblocks. |
| IN-02 | INFO | deferred | — | Dangling `otel.bootstrap.too-late.spec.ts` citations. |
| IN-03 | INFO | deferred | — | Dead type exports. |
| IN-04 | INFO | deferred | — | Folds into WR-08. |
| IN-05 | INFO | deferred | — | "Verbatim" entrypoints differ by quote style. |
| IN-06 | INFO | deferred | — | Shutdown-hook ordering is an implementation detail. |
| IN-07 | INFO | deferred | — | `shutdownOtel` `stopped` latch. |
| IN-08 | INFO | deferred | — | CI runs the container suite twice per change. |
| IN-09 | INFO | deferred | — | `otel.mjs` is outside `dist/`. |

### CR-01 — what changed and why the state is now unreachable

The finding was that the refusal keyed on `NODE_ENV === 'production'` while every
caller substituted `'development'` for an absent value, so a container that never
declared its environment booted on a plaintext key. With `kms` blocked in every
environment (B-3), that was the only remaining route to the local key in
production.

The fix inverts the default rather than reordering the same conditional:

- **`config.schema.ts`** — `NODE_ENV` is now required, no `.default()`. An
  undeclared environment is `CONFIG_INVALID: NODE_ENV` before any module
  resolves.
- **`production-guard.ts`** — the local key is permitted only where it is
  expected (`development`/`test`) or where an operator explicitly set
  `CRYPTO_LOCAL_KEY_ALLOWED=true`. Unset, empty, and misspelled environments are
  all refused, and `production` is kms-only with the opt-in unable to relax it.
- **`local-key-provider.ts`** — the constructor backstop reads the live
  `NODE_ENV` with no `?? 'development'` substitution, so a directly-constructed
  provider cannot be the weak link.

Both refusal sites now share one exported predicate
(`localKeyProviderAllowed`), so the guard and the backstop cannot drift apart.

**Counterfactual, run not asserted:** reverting the four source files while
keeping the new tests fails 11 assertions across
`production-guard.spec.ts`, `local-key-provider.spec.ts`,
`config.schema.spec.ts` and `config.module.spec.ts`, including a boot-path test
that compiles `CryptoModule` with `NODE_ENV` deleted from `process.env` and
demands the refusal. `readKeyProviderEnv({})` returning `NODE_ENV: 'development'`
is now itself a failing assertion.

### CR-02 — what changed

`RedisShutdown` (`packages/platform/src/redis/redis.provider.ts`) takes both
clients and `QUIT`s them in `onModuleDestroy`, mirroring
`MongoService.onModuleDestroy`. It is registered in all three entrypoints via
`redisShutdownProvider` and exported from the platform barrel.

`Promise.allSettled` is deliberate: a shutdown hook that throws aborts the
remaining `onModuleDestroy` hooks in the process, and Mongo's close and the OTel
flush both run after this one.

**Counterfactual, run not asserted:** removing the provider fails 5 assertions —
2 lifecycle and 3 per-app registration — plus the live-container drain test in
`redis.integration.spec.ts`, which asserts the server answers `OK` (the
observable difference between a drain and a sever) and the client reaches `end`.

### Verification

- `npm test` — 35 files, 326 tests, exit 0.
- `npm run build` (`eslint . && tsc -b`) — exit 0.
- `NODE_ENV` is now seeded explicitly in `test/setup-env.ts`. Plan 01-02's
  executor flagged exactly this concern in `STATE.md`: every spec that resolves
  `ConfigModule` needs a complete environment. It turned out to be the only
  adjustment the required key needed — `test/setup-env.ts` already filled the
  other required keys, and vitest sets `NODE_ENV=test` on its own, so the seed
  is belt-and-braces rather than a new dependency.

_Fixer: gsd-code-fixer_
_Fixed at: 2026-10-03_

---

_Reviewed: 2026-10-03_
_Reviewer: the agent (gsd-code-reviewer)_
