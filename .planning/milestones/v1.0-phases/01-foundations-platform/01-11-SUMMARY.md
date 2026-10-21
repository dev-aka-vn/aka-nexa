---
phase: 01-foundations-platform
plan: 11
subsystem: infra
tags: [docker-compose, onboarding, env-config, zod, redis, mongodb, vitest, testcontainers]

requires:
  - phase: 01-foundations-platform
    provides: "the Zod boot contract (config.schema.ts, redis.schema.ts), the eager CryptoModule production guard, the three-container test harness, and the three entrypoints"
provides:
  - ".env.example — the boot contract as a shell-sourceable reference, asserted against APP_CONFIG_KEYS"
  - "compose.dev.yml — local MongoDB 8.0 (no --replSet) plus two distinct Redis on loopback ports"
  - "README.md — prerequisites, the three run commands with their ports, the local-infrastructure section, and both UAT traps with exact remedies"
  - "tooling/onboarding.spec.ts — 27 tests proving the documented boot path by booting real processes, including both traps"
  - ".gitignore entry for .dev-local-key"
affects: [phase-02, onboarding, deployment, environment-contract]

actuals:
  tokens: 326
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Child processes are spawned with a fully constructed env (PATH/HOME named, never `...process.env`), so an inherited NODE_ENV/PORT/CRYPTO_LOCAL_KEY_FILE cannot change what a boot under test does."
    - "Documentation agreements are decided against code-derived constants (APP_CONFIG_KEYS, SERVICE_NAMES, DEFAULT_PORT_BY_SERVICE, MONGO_IMAGE, REDIS_IMAGE, CACHE/QUEUE_MAXMEMORY_POLICY) rather than string literals."
    - "Two-source asymmetry is asserted in both directions rather than harmonised: the harness MONGO_URL carries directConnection=true, the documented one must not."

key-files:
  created:
    - ".env.example"
    - "compose.dev.yml"
    - "tooling/onboarding.spec.ts"
  modified:
    - "README.md"
    - ".gitignore"

key-decisions:
  - "Commented keys count as documented but not active, which is what lets SERVICE_NAME be discoverable without being defaulted — omitting it must produce CONFIG_INVALID: SERVICE_NAME, not a second process contending for port 3000."
  - "README is asserted only by token agreement (start:<service>, the service/port pair on one line, EADDRINUSE, directConnection=true); no phrase or heading match, so a good edit does not turn the test red."
  - "The `.env`-is-not-loaded claim is proved by booting with a decoy `.env` in cwd rather than by grepping the README for a sentence."
  - "Trap B's failing arm deletes the `directConnection` search param via URL/searchParams rather than string surgery, and the passing arm is rebuilt through the project's own mongoUrl() helper."

requirements-completed: [FND-03, FND-09]

coverage:
  - id: D1
    description: ".env.example enumerates every APP_CONFIG_KEYS member plus CRYPTO_LOCAL_KEY_FILE, and every active line is a real shell assignment"
    requirement: FND-09
    verification:
      - kind: unit
        ref: "tooling/onboarding.spec.ts — 'names every key APP_CONFIG_KEYS declares' / 'makes every active line a shell assignment'"
        status: pass
    human_judgment: false
  - id: D2
    description: "A real api process boots from .env.example's active lines and answers /health/live and /health/ready with all three dependencies up"
    requirement: FND-03
    verification:
      - kind: integration
        ref: "tooling/onboarding.spec.ts — 'boots an api process and reports every core dependency up'"
        status: pass
    human_judgment: false
  - id: D3
    description: "Booting the unmodified active env fails with the named CONFIG_INVALID: SERVICE_NAME; a production boot on a local key is refused with CRYPTO_KEY_PROVIDER_REQUIRED:"
    requirement: FND-09
    verification:
      - kind: integration
        ref: "tooling/onboarding.spec.ts — 'refuses the same file unmodified' / 'refuses a production boot on a local key'"
        status: pass
    human_judgment: false
  - id: D4
    description: "compose.dev.yml defines MongoDB 8.0 without --replSet and two Redis with distinct loopback ports and distinct maxmemory policies, pinned to the harness image constants"
    requirement: FND-03
    verification:
      - kind: unit
        ref: "tooling/onboarding.spec.ts — 'compose.dev.yml — the local Mongo + two-Redis topology' (7 tests)"
        status: pass
      - kind: other
        ref: "docker compose -f compose.dev.yml config --quiet"
        status: pass
    human_judgment: false
  - id: D5
    description: "compose published addresses equal the host:port values in .env.example, so a reader edits nothing; the documented MONGO_URL carries no directConnection while the harness URL does"
    requirement: FND-09
    verification:
      - kind: unit
        ref: "tooling/onboarding.spec.ts — 'publishes exactly the addresses .env.example points at' / 'runs MongoDB without --replSet' / 'boots against the harness Mongo URL'"
        status: pass
    human_judgment: false
  - id: D6
    description: ".dev-local-key is gitignored, so the documented key recipe cannot commit a plaintext key"
    requirement: FND-09
    verification:
      - kind: unit
        ref: "tooling/onboarding.spec.ts — '.gitignore — the local key file is not committable'"
        status: pass
    human_judgment: false
  - id: D7
    description: "Trap A: an occupied api default port yields a bare EADDRINUSE after 'successfully started', and a PORT override boots to /health/live"
    requirement: FND-03
    verification:
      - kind: integration
        ref: "tooling/onboarding.spec.ts — 'Trap A — port collision, and the \"successfully started\" lie'"
        status: pass
    human_judgment: false
  - id: D8
    description: "Trap B: the same --replSet Mongo reports mongo up with directConnection=true and not-up with that one parameter deleted"
    requirement: FND-03
    verification:
      - kind: integration
        ref: "tooling/onboarding.spec.ts — 'Trap B — a replica-set MongoDB reported as `mongo: down`'"
        status: pass
    human_judgment: false
  - id: D9
    description: "The documented path executes end to end: compose up, source .env.example, SERVICE_NAME=api npm run start:api, /health/ready reports all three dependencies up"
    requirement: FND-03
    verification:
      - kind: other
        ref: "Task 2 documented-path command (verbatim)"
        status: fail
    human_judgment: true
    rationale: "The command's probe budget is 30x500ms = 15s, and on this host the api needs ~29s to reach readiness under external load. It was NOT edited to pass. A diagnostic run of the identical boot with a 120s window printed READY_OK mongo,redis_cache,redis_queue after 28.8s, so the artifacts are correct and only the budget is host-dependent — but that conclusion is a human's to accept, not a green check. See Deviations #1 and WINDOWS.md entry 18."
  - id: D10
    description: "The README presents the local stack as a development convenience rather than a deployment topology, and a newcomer can complete the boot from it alone (P5)"
    requirement: FND-03
    verification:
      - kind: manual_procedural
        ref: "Task 2 <human-check> — judgement, answered in this SUMMARY under Human Checks"
        status: pass
    human_judgment: true
    rationale: "P5 is declared `verification: judgment` in the plan precisely because 'does this prose read as a deployment topology' has no mechanical reduction. A README can satisfy every token assertion while still implying production intent."

duration: 110min
completed: 2026-10-05
status: complete
commits: 3
plan_head_before: 6bbcfdb1f3d4f49662e8b058e310bd8b5960567e
plan_head_after: 1c235b1026c6ca795785027697198bbee75a96b4
---

# Phase 01 Plan 11: Onboarding — the boot contract written down and proven Summary

**A developer can now start the three processes from a clean checkout using only the project's own words — and `tooling/onboarding.spec.ts` proves it by actually doing so, including reproducing both UAT traps and demonstrating their remedies.**

## Performance

- **Duration:** ~110 min (06:03Z → 07:53Z)
- **Tasks:** 3 of 3
- **Files modified:** 5 (+1 planning ledger entry)
- **Commits:** 3

## Accomplishments

- **The G1 gap is closed with an executable artifact, not prose.** `.env.example` is asserted to name every `APP_CONFIG_KEYS` member plus `CRYPTO_LOCAL_KEY_FILE` in both directions (missing *and* invented), and a real `api` process boots from its active lines against live containers and answers `/health/live` with `{"status":"ok"}` and `/health/ready` with `mongo`, `redis_cache` and `redis_queue` all `up`.
- **`SERVICE_NAME` fails closed.** Booting the file exactly as shipped — nothing removed, nothing added — exits non-zero with `CONFIG_INVALID: SERVICE_NAME`. That is T-1-31 discharged end to end rather than asserted through the schema, and it is the only thing between a reader and two processes silently contending for port 3000.
- **Both UAT traps are now executable.** Trap A binds the api default port and proves the boot dies with a bare `EADDRINUSE` *after* logging `Nest application successfully started`, then proves a `PORT` override reaches `/health/live`. Trap B's two arms differ only in the `directConnection` search param of `urls.mongo`.
- **The P6 asymmetry is pinned in both directions.** The documented `MONGO_URL` carries no `directConnection` (asserted against the parsed `URL.search`), and the harness URL the same spec boots against does — read from the live container, not restated as a literal.

## Task Commits

1. **Task 1: `.env.example` + README run section + executable proof that it boots a real process** — `6a4911b` (docs)
2. **Task 2: `compose.dev.yml` — the local Mongo + two-Redis topology, with the two traps documented** — `56b11bd` (docs)
3. **Task 3: Make the documented path executable — prove the traps and the boot in an automated spec** — `1c235b1` (test)

## Files Created/Modified

- `.env.example` (new, 95 lines) — the boot contract. Six active keys, three documented-but-inactive, every active line matching `^[A-Z0-9_]+=\S+$` so `. ./.env.example` is a real shell command. Verified shell-sourceable: `set -a; . ./.env.example; set +a` exports exactly the six intended keys.
- `compose.dev.yml` (new, 70 lines) — `mongo:8.0` with no `--replSet` on `127.0.0.1:27017`, `redis-cache` on `6379` with `allkeys-lru`, `redis-queue` on `6380` with `noeviction`. Every published port bound to loopback.
- `tooling/onboarding.spec.ts` (new, 930 lines, 27 tests) — the executable proof.
- `README.md` (rewritten from a 2-line stub) — prerequisites, the three `SERVICE_NAME=<name> npm run start:<name>` commands with ports 3000/3001/3002, the "config comes from `process.env` only" statement, the local-infrastructure section, and both traps.
- `.gitignore` (+6 lines) — `.dev-local-key`, so the documented key recipe cannot commit a plaintext key.

## Verification Results

| Command | Result |
|---|---|
| `npm run build` (Tasks 1, 2, 3, and final) | exit 0, no `error TS` |
| `npm test -- tooling/onboarding.spec.ts` (Task 1) | **10 passed**, exit 0 |
| `npm test -- tooling/onboarding.spec.ts` (Task 2) | **23 passed**, exit 0 |
| `docker compose -f compose.dev.yml config --quiet` | exit 0; no `error`/`invalid`/`undefined` in output |
| Task 2 documented-path command (verbatim) | **exit 1** — `NOT_READY: /health/ready never reported three healthy dependencies` |
| Same boot, 120 s diagnostic window | `READY_OK mongo,redis_cache,redis_queue after 28.8s` |
| `npm test -- tooling/onboarding.spec.ts` (Task 3) | **27 passed**, exit 0 |
| `npm test` (full suite, plan's closing requirement) | **37 files / 373 tests passed**, 1041 s, exit 0 |

## Human Checks (Task 2, non-blocking)

**(1) Does the README present the local compose stack as a development convenience rather than a deployment topology, with Kubernetes named as out of scope (P5, D-11)? — Yes.**
A `## Deployment` section states outright that there are no Kubernetes manifests, no Helm chart and no image build, and that `compose.dev.yml`'s shape (one Mongo, two Redis, no authentication, no replicas) "is not a deployment topology"; the "Local infrastructure" section links straight to it. `compose.dev.yml`'s own header repeats "Development only — not a deployment topology". Nothing in the file reads as deployment guidance.

**(2) Would a developer who has never seen the repository complete the boot from it alone? — Yes, with no unstated step.**
Node 24 / npm / Docker / `npm ci` are listed as prerequisites; the three run commands are given with their `SERVICE_NAME` inline and their ports; the key-file recipe is given; and the README states explicitly that `cp .env.example .env` does *not* configure anything, so the sourcing step (`set -a; . ./.env.example; set +a`) is the one thing it does insist on. The one thing worth watching is that `SERVICE_NAME` must be supplied per command — the README says so, and `.env.example` documents it as commented, but a reader who skims will hit `CONFIG_INVALID: SERVICE_NAME`. That is the intended fail-closed behaviour, not a gap.

## Deviations from Plan

### Not fixed — recorded instead

**1. [Environment, not a plan defect] Task 2's documented-path verify command fails on this host.**
- **Command run:** verbatim, unmodified, with its `cleanup`/`trap` teardown intact.
- **Observed:** `NOT_READY: /health/ready never reported three healthy dependencies`, exit 1.
- **Diagnosis:** the probe budget is `30 × 500 ms = 15 s`. This machine is under heavy external load (load average 7.7–16.9, ~1 GB free of 7.9 GB), and Nest plus the OTel-instrumented drivers now take ~29 s to reach readiness instead of ~0.3 s. The same `docker compose up -d --wait`, the same sourced `.env.example`, the same `SERVICE_NAME=api npm run start:api`, observed for 120 s, printed `READY_OK mongo,redis_cache,redis_queue after 28.8s`.
- **Action taken:** none to the command. Editing `N` to make a verify pass, or relaxing its `<fails_when>`, is exactly what the plan and the execution instructions forbid. Logged as WINDOWS.md entry 18 (`unrun-verify`) and as coverage item D9 with `status: fail`.
- **What this means:** the documented path is correct and works; the check that times it is host-sensitive. Re-run on an idle host, or widen `N` deliberately as a planning decision.

**2. [Environment] Port 3000 was occupied by an unrelated service.**
`pms-2026` (`redmine:alpine`) held `0.0.0.0:3000`, which is the api default port — so Task 1's spec item 2, Task 2's decoy-`.env` boot, Task 2's documented-path command and Task 3's Trap A all assume a free port. Surfaced before writing any code; the user authorised stopping that container for the duration. It was restarted after the final verification (`docker start pms-2026`, container `running`, `restarts=0`, port 3000 re-bound). No other change to the user's environment.

### Implementation detail the plan did not enumerate

**3. `yaml` is imported by the spec without being declared in `package.json`.**
The plan requires `compose.dev.yml` to "parse as valid YAML", forbids new packages and forbids manifest changes (T-1-SC). `yaml@2.9.1` is already in the committed lockfile as a **production** transitive of `@opentelemetry/configuration` (a direct root dependency via `@opentelemetry/sdk-node`), with an integrity hash — the "already pinned" the threat row permits. The dependency chain and its failure mode are documented in the spec's import docblock. Logged as a Threat Flag below.

**4. Poll budgets and per-test timeouts raised.**
`bootUntilLive` polls 120 × 500 ms (60 s) and the boot tests carry a 300 s timeout. This is an implementation parameter the plan leaves open; the plan only mandates long `beforeAll`/`afterAll` hook timeouts, which are set to `300_000`. Reason recorded in a comment at the call site: the same boot measures ~0.3 s idle and ~29 s under this host's load, and a budget tuned to the idle number reports a slow machine as a broken entrypoint.

### Corrected before commit

**5. A fabricated assertion, removed.**
The first draft of the P6 check compared a locally-constructed literal URL against itself — a control documented with no assertion behind it, the exact shape this phase has shipped twice before. It was replaced with two real checks: the documented side against the parsed `.env.example` URL, and the harness side against `containers.urls.mongo` read from the live container.

## Issues Encountered

- **Every boot assertion failed at first with empty child output.** Root cause was not the code: a 30 s poll budget against a ~29 s boot under external load. Diagnosed by reproducing outside vitest, then by a probe matrix (no `--import` vs `--import`, raw vs `setEncoding`, trivial child vs api child) which isolated the cause to timing rather than to stdio, `--import`, or the environment construction.
- **A debug spec was created and deleted** during that diagnosis (`tooling/_debug.spec.ts`, 13 KB) and never committed — `git status` is clean apart from pre-existing untracked paths.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: supply-chain | `tooling/onboarding.spec.ts` | Imports `yaml` as an **undeclared direct dependency** — resolved only because it is a pinned production transitive of `@opentelemetry/configuration`. No manifest change (T-1-SC forbids one). If that dependency chain is ever broken the import fails loudly at test time, and `docker compose config --quiet` remains an independent authority on the file's validity. Promoting `yaml` to a declared devDependency would make the arrangement honest but requires a manifest change this plan does not authorise. |

## Known Stubs

None. No `TODO`/`FIXME`/placeholder content and no unrun `<verify>` other than deviation #1 above (recorded in WINDOWS.md).

## Self-Check: PASSED

- All five declared artifacts exist on disk (`.env.example`, `compose.dev.yml`, `README.md`, `tooling/onboarding.spec.ts`, `.gitignore`), plus this SUMMARY.
- All three task commits exist: `6a4911b`, `56b11bd`, `1c235b1`.
- `git diff --name-only <plan_head_before>..HEAD` lists exactly those five files and nothing else — **no source file, no `package.json`, and no existing spec was modified**, which is success criterion 6.
- Measured commit count from the plan ledger: `git rev-list --count 6bbcfdb1..HEAD` = **3**, matching the three task commits. No tracked file was deleted by any of them.

## User Setup Required

None. The plan declares `user_setup: []` and nothing in it needs a human to configure an external service.

## Next Phase Readiness

- **G1 is closed on the artifact side.** The contradiction in `01-10-SUMMARY.md:402` ("documented local full-stack run") is now backed by files that exist and tests that run. `01-10-SUMMARY.md` was deliberately **not** edited — this plan is additive — so that line is now stale rather than false; a follow-up could amend the earlier summary to point at `01-11`.
- **One verify command is host-sensitive** (deviation #1). It should be re-run on an idle host, or `N` widened deliberately, before anyone treats D9 as green.
- **FND-03 / FND-09 remain Complete.** Nothing here re-opened them; the plan closes the half of each that UAT found missing.
- **`STATE.md` and `ROADMAP.md` were not touched** — the orchestrator owns those writes after the wave.

---
*Phase: 01-foundations-platform · Plan: 11 · Completed: 2026-10-05*