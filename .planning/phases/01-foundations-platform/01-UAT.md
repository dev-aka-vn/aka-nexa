---
status: partial
phase: 01-foundations-platform
source: 01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-03-SUMMARY.md, 01-04-SUMMARY.md, 01-05-SUMMARY.md, 01-06-SUMMARY.md, 01-07-SUMMARY.md, 01-08-SUMMARY.md, 01-09-SUMMARY.md, 01-10-SUMMARY.md
started: 2026-10-04T17:02:18Z
updated: 2026-10-05T03:00:00Z
---

## Current Test

[testing paused — 2 items outstanding, both awaiting a human decision rather than a test run]

## Tests

> **How this session was run.** The user delegated execution to the orchestrator
> ("You can run yourself and report to me"), so every runnable checkpoint below was
> exercised directly against live processes rather than handed to the user. Each
> `result` reflects an observed outcome, not an inference from reading code.
>
> **MVP-mode ordering.** Section A is the user-flow walk-through derived from the phase
> user story. Section B holds technical checks, deferred until Section A passed — it did,
> so they ran. Section C is the goal-backward coverage check plus the two items this
> phase deliberately left to a human.

### Section A — User-flow walk-through

### 1. Cold Start Smoke Test
expected: |
  A developer can start the processes from a clean checkout using only the project's
  own documented instructions. `npm run start:api` boots with no errors beyond the
  normal Nest boot lines, and `GET /health/live` answers `{"status":"ok"}`.
result: issue
severity: major
reported: |
  [orchestrator] The boot half passes: api came up clean, all modules initialised, all
  three routes mapped, /health/live -> {"status":"ok"}, /health/ready -> all three
  dependencies up, /metrics returned a real Prometheus exposition, SIGTERM exited cleanly
  and released the port. The documented-instructions half fails: there are none. No
  .env.example, no compose file, no run documentation anywhere in the repo. Booting
  required reverse-engineering six environment variables out of config.schema.ts and
  redis.schema.ts, including CRYPTO_LOCAL_KEY_FILE naming a file of exactly 32 bytes.
  Two traps gave actively misleading errors — see gap G1 below.
gap: G1

### 2. Three processes, three ports
expected: |
  api, worker and scheduler each start as separate OS processes and each listens on its
  own port, with no shared in-process state.
result: pass
source_d: D6 (FND-03)
observed: |
  All three booted simultaneously as distinct PIDs on distinct ports. Each reported its
  own service_name in target_info — api, worker, scheduler — which is the observable
  proof that these are three processes rather than one process with a name.

### 3. Each process answers both health endpoints
expected: |
  Every process answers /health/live (which reads no dependency) and /health/ready
  (which names each dependency separately).
result: pass
source_d: D10 (FND-05)
observed: |
  Verified across all three, including the negative case. With Mongo deliberately
  unreachable, ready reported {"status":"error", "error":{"mongo":{"status":"down"}}}
  while still reporting redis_cache and redis_queue as up — it names the failed
  dependency instead of collapsing to one boolean. With Mongo reachable, all three read
  up. This is the per-dependency behaviour T-1-17 and T-1-18 claim, exercised for real
  rather than only asserted in a unit test.

### 4. worker joins and consumes
expected: |
  The worker process reports itself ready and shows an active consumer on the queue.
result: pass
source_d: D14 (FND-08)
observed: |
  Worker readiness included "bullmq_workers":{"workers":1,"status":"up"} — one consumer
  attached to the live queue.

### 5. scheduler joins and registers its heartbeat
expected: |
  The scheduler process reports itself ready and shows its heartbeat job scheduler
  registered.
result: pass
source_d: D14 (FND-08)
observed: |
  Scheduler readiness included "job_schedulers":{"scheduler":"platform-heartbeat",
  "status":"up"} — registered under the expected name.

### 6. Per-app boundary manifests are wired and enforced
expected: |
  Each app supplies its forbidden-token manifest and the guard runs at application
  bootstrap. A forbidden provider present in an app is refused.
result: pass
source_d: D9
observed: |
  Verified both ways. Positive: all three apps booted without a BOUNDARY_VIOLATION
  abort, so the manifests are wired and the guard is not firing spuriously. The manifests
  are real — API_BOUNDARY_MANIFEST forbids QUEUE_PRODUCER_TOKEN, WORKER_CONSUMERS and
  JOB_SCHEDULER_REGISTRATIONS. Negative: provider-boundary.guard.spec.ts passed 8/8,
  including a case that boots a real Nest application with a forbidden token resolved and
  asserts the guard throws BOUNDARY_VIOLATION naming the app. entrypoint-drift.spec.ts
  passed 18/18, including 8 per-app BoundaryManifest wiring assertions and one confirming
  every app composes CryptoModule so the production key guard is reachable.

### Section B — Technical checks

### 7. OTel is initialised before the app module is imported
expected: |
  Each entrypoint starts telemetry before importing its app module, so the boot span is
  not orphaned and actually reaches a collector.
result: pass
source_d: D14 (FND-07)
observed: |
  Tested against a real collector rather than inferred. Stood up a minimal OTLP/HTTP
  collector stub, booted api with OTEL_EXPORTER_OTLP_ENDPOINT pointed at it, and
  generated traffic. The stub received POST /v1/traces carrying 5,899 bytes of real trace
  payload and POST /v1/metrics carrying 15,785 bytes. This also empirically confirmed
  T-1-24: on SIGTERM the SDK pushed a final, larger metrics payload (17,495 bytes)
  before exiting, which is the flush-on-shutdown behaviour the threat register claims.

### 8. Metrics reachable from all three, with a non-flat series
expected: |
  /metrics answers on every process and exports a series whose value changes rather than
  a flat zero.
result: pass
source_d: D13 + D15 (OBS-01)
observed: |
  All three answered /metrics carrying their own service_name. On api,
  http_server_request_duration_count advanced with real probe traffic, so the series is
  driven by real requests. The Prometheus-exporter half of OBS-01 is therefore genuinely
  deployed, which is what justified keeping OBS-01 unchecked in REQUIREMENTS.md.

### 9. CI install-guard fails loudly on a bad resolve
expected: |
  A lockfile-free install that resolves TypeScript 7.x fails the install-guard job, and
  a peer-dependency bypass flag fails the guard before the install runs.
result: pass
source_d: D5 (FND-01)
observed: |
  The bypass assertion was exercised directly against all three bypass forms and is
  correct: --legacy-peer-deps, --force, and --strict-peer-deps=false were each BLOCKED,
  including when appended after other flags, while the clean command was allowed.
  toolchain-pin.spec.ts passes 16/16 covering the exact pin, the lockfile root entry and
  the installed compiler.
correction: |
  The mechanism D-06 and T-1-02 state is not what actually happens. I reproduced a
  lockfile-free resolve in a scratch tree with the TypeScript pin wildcarded away
  entirely — a strictly harsher test than CI runs, since CI keeps the exact pin and only
  deletes the lockfile. It resolved to 6.0.3, not 7.x. The reason is that
  typescript-eslint@8.71.0 carries a non-optional peer range of
  typescript ">=4.8.4 <6.1.0", which caps the resolve before npm can choose 7.
  So the guard's assertion is a tripwire confirming the peer constraint held, not the
  thing that prevents a bad resolve. STACK.md §3 already documents this correctly as
  "enforcer 1"; only the threat register's phrasing implies the assertion is load-bearing.
  Nothing to fix — recorded so the rationale is not overstated.

### 10. The `msg` channel residual risk
expected: |
  A human decides whether it is acceptable that pino appends `msg` after the allowlist
  formatter runs, making the message string the one channel the allowlist cannot filter.
result: pending
source_d: D7 (FND-06)
observed: |
  Not a test — a decision, and it is genuinely open. Every other log channel is provably
  closed; this one rests on convention (LoggerPort fixes the message as a first argument).
  A developer can write logger.info('failed for ' + userInput) and every automated test
  still passes. Tracked as WINDOWS #5 and as AR-2 in 01-SECURITY.md. Needs a human ruling
  before Phase 2, and the ruling constrains whether a lint rule banning interpolation in
  log calls gets added.

### Section C — Coverage check and deferred decisions

### 11. Auto-covered deliverables
expected: |
  Confirm that the 87 deliverables already covered by passing automated tests do not need
  a human checkpoint.
result: pass
observed: |
  uat classify-coverage returned mode `coverage` for all 10 SUMMARY files with no malformed
  blocks: 87 entries auto-passed, 11 presented as human checkpoints. Every one of those 11
  is represented in this file (tests 2-7, 9, 10 and 12). Separately, commit-claim
  reconciliation found 3 SUMMARYs with bounded windows all CONSISTENT, 7 legacy SUMMARYs
  reported as warnings, and 0 blockers.

### 12. FND-10 KMS vendor, and the D-09 topology override
expected: |
  Confirm FND-10 stays Pending until a deployment cloud is named, and confirm or overturn
  D-09's deliberate override of ARCHITECTURE.md's createApplicationContext() guidance for
  worker/scheduler.
result: pending
source_d: D11 + D8
observed: |
  Not a test — two decisions, and the only genuinely open items in the phase. FND-10 cannot
  be closed by any amount of code: no deployment cloud has been named, so no KMS adapter
  exists (D-27 / blocker B-3). D-09 can be overturned with a one-line change, which would
  amend FND-05. Both are recorded and neither was resolved during this session.

## Summary

total: 12
passed: 9
issues: 1
pending: 2
skipped: 0
blocked: 0

## Gaps

- truth: "A developer can start the three processes from a clean checkout using only the project's own documented instructions."
  status: resolved
  resolved_by: 01-11-PLAN.md
  resolved_at: "2026-10-05"
  resolution: |
    All five `missing:` items were delivered by a named artifact with a named assertion:
    `.env.example` (all nine boot keys, as a shell-sourceable reference), the
    `?directConnection=true` note, `compose.dev.yml` with two distinct Redis instances per
    D-12, a README run section with the three commands and their ports, and the
    "successfully started precedes bind failure" note. `tooling/onboarding.spec.ts` performs
    the documented start for real rather than grepping the prose.

    Reconciled here rather than by `close_parent_artifacts`, which is decimal-phase-only
    (`X.Y`) and therefore skipped for Phase 01.

    Not folded in: a post-execution code review of those five files returned 0 blockers and
    9 warnings, three of which are factual inaccuracies *in the new documentation* about the
    system's own error tokens (`CONFIG_INVALID: REDIS_INSTANCES_NOT_DISTINCT` is missing its
    `<root>` segment; `LOCAL_KEY_FILE_MISSING:` fires only on an unset variable, not an absent
    file; `npm ci` warns rather than fails on non-24 Node). Those are new findings against
    delivered work, not part of G1's original scope, and they are tracked as WR-01/WR-02/WR-03
    in `01-11-REVIEW-DISPOSITION.md` rather than being used to keep G1 open.
  reason: |
    Found by the orchestrator while executing test 1. The phase has no .env.example, no
    compose file, and no run documentation of any kind. Booting the api required
    reverse-engineering six environment variables out of config.schema.ts and
    redis.schema.ts, including CRYPTO_LOCAL_KEY_FILE naming a file holding exactly 32
    bytes. Two traps cost real time and produced actively misleading errors:
    (1) the default api port 3000 is occupied by an unrelated service on this machine,
    and the process dies with a bare EADDRINUSE *after* logging "Nest application
    successfully started" — so the last line a reader sees claims success;
    (2) a plain mongodb://host:port/db URL reports mongo down in readiness even though
    mongo is healthy, because the container runs --replSet rs0 and the driver needs
    ?directConnection=true — the same trap tooling/containers.ts already handles for
    tests. Neither is a product defect; both are onboarding failures.
  severity: major
  test: 1
  contradiction: |
    01-10-SUMMARY.md:402 records the deployment decision as "documented local full-stack
    run, no dev-environment deploy (D-11)" and points at npm run start:api|worker|scheduler.
    No such documentation exists in the repository.
  root_cause: |
    D-11 scoped out Kubernetes manifests and probe wiring, and the "documented local
    full-stack run" was treated as satisfied by the existence of the three npm scripts plus
    the testcontainers harness. Nothing owned writing the env contract down, and nothing
    tested that a human could actually perform the documented start.
  artifacts:
    - path: ".planning/phases/01-foundations-platform/01-10-SUMMARY.md"
      issue: "line 402 claims a documented local full-stack run that does not exist"
    - path: "packages/platform/src/config/config.schema.ts"
      issue: "the only place the env contract exists — 6 keys split across two files, with no example file and no comment presenting them as a set"
    - path: "packages/platform/src/config/redis.schema.ts"
      issue: "second half of the env contract (REDIS_CACHE_URL, REDIS_QUEUE_URL)"
  missing:
    - "An .env.example listing the full boot contract: NODE_ENV, SERVICE_NAME, PORT, MONGO_URL, REDIS_CACHE_URL, REDIS_QUEUE_URL, CRYPTO_KEY_PROVIDER, CRYPTO_LOCAL_KEY_FILE"
    - "A note that a single-node --replSet Mongo needs ?directConnection=true, which otherwise surfaces only as a misleading readiness 'down'"
    - "Either a compose file for the local Mongo + two-Redis topology, or a documented expected-topology section — D-12 requires two distinct Redis instances and a single URL will not boot at all"
    - "A short run section naming the three commands and their default ports"
    - "A guard against the misleading boot-order message, or at minimum documenting that a successful-start line can precede a bind failure"
  debug_session: ""

- truth: "The onboarding documentation names the system's real error tokens and boot-failure modes."
  id: G2
  status: failed
  severity: major
  test: 1
  reason: |
    Found by code review of the five files `01-11` produced, and independently re-verified by
    the orchestrator against source. The new documentation asserts three things that are FALSE
    about the system's own behaviour — the same class of defect G1 existed to eliminate:
    (1) `CONFIG_INVALID: REDIS_INSTANCES_NOT_DISTINCT` is missing its `<root>` segment;
    `redis.schema.spec.ts:68` pins `/^CONFIG_INVALID: <root> REDIS_INSTANCES_NOT_DISTINCT$/`, so
    the documented token is not greppable. This is the D-12 refusal, the guard this phase exists
    to keep load-bearing. (2) `LOCAL_KEY_FILE_MISSING:` is documented for an absent key file,
    but that token only fires when the *variable* is unset (`crypto.module.ts:126`); an absent
    file throws a raw `ENOENT` from a bare `readFileSync` at `local-key-provider.ts:112`, which
    has no try/catch. `tooling/onboarding.spec.ts`'s own docblock repeats the false premise as
    its justification. (3) `README.md:13` claims `npm ci` fails on non-24 Node; there is no
    `engine-strict` in `package.json` and no `.npmrc` anywhere, so npm warns rather than fails.
    Additionally WR-04: `NODE_ENV=development` is the switch that disarms
    `CRYPTO_KEY_PROVIDER_REQUIRED:` and nothing documents that — while the documented
    `set -a; . ./.env.example` silently rewrites an operator's exported `NODE_ENV=production`
    in their own shell.
  root_cause: |
    The documentation was written from the intent of each guard rather than from its emitted
    string, and nothing asserted any of the four claims against the code. This is the third
    instance of this phase's recurring failure mode — a control asserted in a document that
    nothing verifies (after `01-VERIFICATION.md` gap G-1 and `01-SECURITY.md`'s T-1-02).
  artifacts:
    - path: ".env.example"
      issue: "wrong REDIS_INSTANCES_NOT_DISTINCT token; wrong LOCAL_KEY_FILE_MISSING trigger; NODE_ENV disarms CRYPTO_KEY_PROVIDER_REQUIRED undocumented"
    - path: "README.md"
      issue: "line 13 claims npm ci fails on non-24 Node; it warns"
    - path: "tooling/onboarding.spec.ts"
      issue: "docblock repeats the false LOCAL_KEY_FILE_MISSING premise as justification"
  missing:
    - "Assert each documented error token against the code that emits it, so a drift in either direction reddens a test"
    - "Correct the REDIS_INSTANCES_NOT_DISTINCT string to CONFIG_INVALID: <root> REDIS_INSTANCES_NOT_DISTINCT"
    - "Describe the absent-key-file failure as the ENOENT it is, and reserve LOCAL_KEY_FILE_MISSING: for the unset-variable case"
    - "State that npm warns rather than fails on a non-24 Node, or add engine-strict so the claim becomes true"
    - "Document that NODE_ENV=development disarms CRYPTO_KEY_PROVIDER_REQUIRED:, and warn that sourcing .env.example rewrites an exported production NODE_ENV"
  debug_session: ""

- truth: "The onboarding spec fails or passes for a reason that has nothing to do with the property under test."
  id: G3
  status: failed
  severity: blocker
  test: 1
  reason: |
    Reproduced by the orchestrator, not inferred. An independent run of the plan's own
    acceptance proof gave `4 failed | 23 passed (27)`, exit 1, in 882s. All four failures share
    one root cause: `Error: listen EADDRINUSE: address already in use :::3000`.

    The executor reported 27/27 because it had stopped the `pms-2026` (Redmine) container to
    free port 3000 first, then restarted it. So the green result was real but conditional on an
    artificial condition that does not hold in the machine's normal state. `pms-2026` is Up and
    holds `0.0.0.0:3000`.

    The spec boots api on `DEFAULT_PORT_BY_SERVICE.api` — hardcoded 3000, no override. It also
    cannot distinguish "my process failed to bind" from "a foreign process already owns the
    port", so both report the same error. WR-05 sharpens this: Trap A's port squatter swallows
    its own EADDRINUSE with no `listening` assertion, so that test can pass without the squatter
    ever having bound. WR-06: `bootUntilLive` accepts the first healthy responder on the port, so
    a developer's already-running api makes three assertions pass against a foreign process.

    This is a false-green-and-false-red pair in the same helper, and it is the exact hazard the
    documentation it ships warns about.
  root_cause: |
    The spec assumed the documented default port is available on any machine, and used "did
    something answer /health/live on 3000" as its success signal — which conflates the system's
    behaviour with whatever else happens to hold the port. G1 identified port 3000 as a trap in
    the documentation; the spec that documents the traps then inherited it.
  artifacts:
    - path: "tooling/onboarding.spec.ts"
      issue: "boots api on hardcoded DEFAULT_PORT_BY_SERVICE.api; bootUntilLive accepts any healthy responder; Trap A squatter has no listening assertion"
    - path: "WINDOWS.md"
      issue: "entry 18 recorded only the 15s probe budget, not that 4 of 27 tests fail outright when port 3000 is occupied"
  missing:
    - "Obtain a free port for the spec's own api boots instead of assuming 3000 is available"
    - "Assert the squatter actually reached `listening` before using it as a collision (closes WR-05)"
    - "Bind-check the port before booting, and fail with a message naming the occupying process rather than a bare EADDRINUSE (closes WR-06)"
    - "Widen WINDOWS entry 18 to record that this is a hard failure on a busy port, not only a slow-boot timing issue"
  debug_session: ""

## Deferred, recorded so they are not lost

These three code-review warnings are **not** in scope for the next gap plan. Each is either
debatable or has a route that needs a decision beyond "make it correct":

- **WR-07** — the `critical: true` README↔`package.json` link is decided only by the red shell
  command, not by the spec. Arguably fine: the shell command IS the thing that runs the
  documented command. Worth a ruling on whether a `critical: true` link must be decided by the
  spec specifically.
- **WR-08** — T-1-26 re-implements git's ignore engine in ~35 lines where `git check-ignore` is
  one call. A simplification, not a defect.
- **WR-09** — `tooling/onboarding.spec.ts` imports `yaml` with no manifest entry. Availability
  is sound (hoisted, integrity-hashed, loud ESM failure on removal) but T-1-SC's rule is STACK.md
  §14 provenance and `yaml` is not there. Declaring it requires editing `package.json`, which
  `01-11` does not authorise — so this needs an explicit decision to widen scope rather than a
  fix. The reviewer's alternative (assert against `docker compose config --format json`, already
  in the verify set) needs no new package and would resolve it inside the current constraints.

## Notes

- **Post-execution gaps.** The Summary counts above track *test results*: test 1 was the only
  test whose result is `issue`, and its gap G1 is now `resolved`. Two further gaps (G2, G3) were
  opened after UAT, by code review of `01-11`'s output and by an independent re-run of its
  acceptance spec. They are not counted in `issues:` because no UAT test produced them.
- Test 9 carries a correction to the stated rationale of D-06 / T-1-02. The bypass
  assertion is correct and verified, but it is a tripwire rather than the mechanism that
  prevents a bad resolve — typescript-eslint's non-optional peer range does that. Recorded
  so the threat register's phrasing is not read as overstating the control.
- Two items remain pending (tests 10 and 12). Both are human decisions, not verification
  tasks, so this session cannot advance them.