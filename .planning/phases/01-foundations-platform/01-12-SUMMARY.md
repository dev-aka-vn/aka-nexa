---
phase: 01-foundations-platform
plan: 12
subsystem: infra
tags: [onboarding, docs-accuracy, vitest, ports, eaddrinuse, docker, diagnostics]

requires:
  - phase: 01-foundations-platform
    provides: "the five onboarding files 01-11 produced, and the guard contracts in 01-SECURITY.md that this plan documents rather than changes"
provides:
  - "G2 closed — every corrected error token is derived by invoking its emitter inside the spec, not hand-written into prose"
  - "G3 closed — the onboarding spec's outcome no longer depends on the host's api default port; identity is proved by acquire/re-bind/teardown"
  - "describeOccupantQueryFailure — a pure, assertable rendering of the three ways the occupant query can fail, none of which is assumed"
affects: [onboarding, developer-experience, phase-02]

actuals:
  tasks: 2
  commits: 3
  deviation: 1

---

# 01-12 — G2 and G3 gap closure

## What this plan set out to do

`01-11` shipped five onboarding files. Post-execution review found two gaps against
them, both recorded in `01-UAT.md` with filled `root_cause` / `artifacts` / `missing`:

- **G2 (major)** — the documentation asserts three things that are false about the
  system's own behaviour, plus one security-relevant silence.
- **G3 (blocker)** — `tooling/onboarding.spec.ts` fails 4 of 27 in the machine's
  normal state, and can pass for the wrong reason.

## The design decision that mattered

G2's fix is **not prose correction**. Correcting prose with nothing asserting it
reproduces the identical defect one cycle later — which is the failure class this
phase has now produced five times. So each corrected claim is derived by calling the
code that emits it inside the assertion, then requiring the *caught* value to appear
in the documents. This is the `tooling/toolchain-pin.spec.ts` two-source idiom
applied to error strings.

`EBADENGINE` is the single named exception: no in-repo emitter produces it, because
npm does. `P7` is scoped — not weakened — so the ban is on restating a token *the
system emits*, and a tool-produced token must be named literally, with the derivation
obligation transferring to the repository-side condition that makes it the right
token to expect (no `.npmrc` sets `engine-strict`, which is *why* npm warns).

Four corrections that previously had no assertion now have one.

## Files changed

Three, exactly as planned. No source edits, no `package.json`, no other spec.

| File | Change |
|---|---|
| `.env.example` | greppable D-12 refusal; ENOENT-vs-`LOCAL_KEY_FILE_MISSING` split; `NODE_ENV` disclosed as the switch that arms the crypto guard, with the deployment-copy and sourcing consequences named |
| `README.md` | npm warns (`EBADENGINE`) rather than refuses on non-24 Node, scoped to this repository; `<root>` added to the generic token row and defined; key-file row split in two; sourcing hazard warned at both recipes |
| `tooling/onboarding.spec.ts` | 10 new container-free assertions deriving documented tokens from `validateConfig` / `createKeyProvider` / `LocalKeyProvider` / `assertKeyProviderAllowed`; all six boot sites moved off the derived default port |

## Verify commands — real results

| # | Command | Result |
|---|---|---|
| 1 | `npm run build` | exit 0 |
| 2 | `npm test -- tooling/onboarding.spec.ts -t 'derived from the code that emits them'` | 9 passed, 28 skipped |
| 3 | `npm run build` | exit 0 |
| 4 | `npm test -- tooling/onboarding.spec.ts` (unfiltered, closing gate) | **37 passed / 37**, 637 s |
| 5 | bind probe | **exit 2 — `PORT_OCCUPIED 3000`** |
| 6 | documented-path shell command | **NOT RUN — see below** |

### Bind-probe outcome, as the plan required it recorded

**Exit 2** — the port is held. `pms-2026` (Redmine) holds `0.0.0.0:3000` and was
**Up 9 hours** both before and after every run in this plan. Nothing was stopped.

This is the outcome that matters. `01-11`'s executor had reported 27/27 *only*
because it stopped that container first and restarted it afterwards. This plan's
acceptance evidence is the machine's normal state, and the file is green there.

### Command 6 could not be executed here — stated, not worked around

The documented-path shell command begins `set -a; . ./.env.example; set +a`. The
verifying harness refuses `source` / `.` at command position regardless of
allowlist, so the command cannot run in this environment at all. Recorded as **unrun**
rather than reported green. Its change from `01-11` is a single character range
(`N=30` → `N=120`) and it is otherwise byte-identical.

## Deviation — one, and it was found by verification rather than review

`bb6bcf4` fixes a defect in this plan's own delivered work.

`describeOccupant` sent three different failures down one branch whose message
asserted a **permissions** cause: *"not identifiable from this account — a
container-published port is held by a root-owned `docker-proxy` this user cannot
enumerate."* Only the absent-CLI case is a permissions fact.

Reproduced on this host. The bind probe printed:

```
PORT_OCCUPIED 3000 (the OS did not name the holder)
```

while `docker ps --filter publish=3000` returned `pms-2026` immediately afterwards.
Cause: the 5 s query budget. `docker ps` answers in ~2.3 s warm, and under the load
this host carries, the budget is defeated, `execFileSync` throws `ETIMEDOUT`, and a
bare `catch {}` swallows it into the permissions claim. Re-running the identical call
succeeded — which is what distinguishes a timeout from a visibility limit.

So a developer whose port collision is already a bad morning was told a cause the
query never established. That is this phase's signature failure, and the one place
it reaches someone who is already stuck.

Fix: `describeOccupantQueryFailure` is now pure, takes the error *code* rather than
the error, and branches on CLI-absent / query-slow / query-errored — plus the distinct
case where the query ran and found nothing, which is not the same fact as never having
run. `DOCKER_QUERY_TIMEOUT_MS` went 5 s → 15 s, still bounded, no longer defeated by a
loaded machine. One container-free assertion pins each branch, including that **no**
branch may contain `from this account`, so the lie cannot return silently.

Also corrected: `overwrites an \`NODE_ENV=production\`` → `a`, in README.md.

## WINDOWS #18 — supersession carried here, as the plan required

`.planning/WINDOWS.md` is not in this plan's `files_modified`, so the plan
delegated this edit to the SUMMARY. Applied to entry 18: status `superseded`,
recording both halves — the `N=30`→`N=120` budget (D-5) and, the half entry 18 never
recorded, that a busy port 3000 was a **hard failure of 4 of 27 tests** rather than a
slow-boot timing issue. The entry records command 6 as unrun.

## Human-check answers (non-gating, recorded as required)

**(1) Are the tokens attributed to the failure mode each actually belongs to, and
would a reader who grepped have found what happened?**

Yes, and this is the point of G2. Before, a developer hitting a fresh checkout's
missing `.dev-local-key` would grep `LOCAL_KEY_FILE_MISSING:` and find a
documentation line promising it — but the system had actually thrown a raw `ENOENT`
from a bare `readFileSync`. The grep returns nothing, because nothing printed it. Now
the README carries the `ENOENT` row explicitly, and states that grepping for
`LOCAL_KEY_FILE_MISSING:` after an `ENOENT` finds nothing. The `<root>` segment is
documented as part of the token rather than omitted, so the D-12 refusal is greppable.

On P5 (`verification: judgment`, no deployment-topology framing): the added
`NODE_ENV` material is about a local-development footgun, not about deploying. It
names a consequence for someone copying the file into a manifest, but it does not
describe a deployment topology, and the document's shape is unchanged — still
prerequisites, run commands, infrastructure, configuration.

**(2) Does the `NODE_ENV` material read as a warning rather than reassurance — and
should `NODE_ENV` be commented out as `SERVICE_NAME` is?**

It reads as a warning. The wording is "THIS VALUE IS THE SWITCH THAT ARMS THE CRYPTO
GUARD", followed by two named consequences and the instruction *"Declare your
environment deliberately. Do not let a development convenience decide it for you."*
No reassurance is offered.

On the structural half (D-4): this plan ships the disclosure unconditionally and
leaves the change as an operator decision, correctly. For the record, the measured
consequence is that commenting `NODE_ENV` out makes `validateConfig` throw on
`issues[0]` with nothing else supplied, which is `CONFIG_INVALID: NODE_ENV
invalid_value` — and that turns the existing green assertion at
`onboarding.spec.ts:592` red, removes the premise of the `T-1-27` "keeps `NODE_ENV`
active" assertion, and makes the sourcing-hazard test's conditional vacuous. Three
assertions move. It is a defensible change; it is not a one-liner, and the disclosure
is what ships.

## What this plan did not do

- Did not run `phase.complete` (WINDOWS #17 — it would flip FND-10 / AUD-10 /
  DAT-13 from Pending to Complete). `current_phase` stays 2.
- Did not touch `compose.dev.yml` or `.gitignore`; declared untouched with reasons.
- Did not fix WR-07, WR-08, WR-09 — deferred in `01-UAT.md` with reasons. WR-09 in
  particular needs a decision to widen scope to `package.json`, which this plan cannot
  authorise.
- Did not restore a live bind on the derived default port. That was traded away
  deliberately (D-7): `SERVICE_NAME=api` with no `PORT` implying `listen(3000)` stays
  proven in `config.schema.spec.ts` and a README port-pairing assertion, not by a live
  bind. Restoring one would reintroduce the host coupling G3 exists to remove.

## Commits

| Commit | Scope |
|---|---|
| `ea9a538` | G2 — derived error tokens, README and `.env.example` corrections, 9 container-free assertions |
| `6f5e1cf` | G3 — port acquisition and identity proof across all six boot sites, Trap A assertiveness, README Trap A derived from Node's actual output |
| `bb6bcf4` | deviation — occupant diagnostic names the failure instead of blaming the account |