---
phase: 01-foundations-platform
plan: 11
reviewed: 2026-10-05T06:21:09Z
depth: standard
scope: "gap-closure output of plan 01-11 only (git diff 6bbcfdb1..HEAD)"
files_reviewed: 5
files_reviewed_list:
  - .env.example
  - compose.dev.yml
  - README.md
  - .gitignore
  - tooling/onboarding.spec.ts
findings:
  critical: 0
  warning: 9
  info: 10
  total: 19
status: issues_found
---

# Plan 01-11: Code Review — onboarding gap closure

**Reviewed:** 2026-10-05T06:21:09Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

The claim of "zero source edits" is **true and verified**: `git diff --name-status 6bbcfdb1..HEAD`
lists exactly `A .env.example`, `M .gitignore`, `M README.md`, `A compose.dev.yml`,
`A tooling/onboarding.spec.ts`, plus `.planning/WINDOWS.md` and the SUMMARY (planning metadata).
No `packages/**`, no `apps/**`, no `package.json`, no existing spec.

The work is well made. The P6 asymmetry is genuinely asserted in both directions and the surviving
assertion is **not** tautological — see the explicit assessment below. The child-environment
construction discipline is real and correctly reasoned. The `yaml` import is honestly flagged.

Nine warnings remain. Three are **factual errors in the documentation about the system's own
error tokens and guards** — the exact class of error this plan exists to eliminate. Two are
**tests that can pass for the wrong reason**, the shape this phase has already shipped twice. The
rest are quality and completeness gaps.

Nothing found is a blocker: no live bug, no security vulnerability, no data-loss risk. The
security-relevant findings are documentation defects that misdescribe existing fail-closed guards,
not bypasses of them.

## Blockers

None.

## Warnings

### WR-01: `.env.example` does not disclose that `NODE_ENV=development` is the switch that disarms the crypto guard

**File:** `.env.example:19-22` (with `README.md:56-58`, `README.md:133-138`)
**Type:** security / compliance risk (documentation)
**Issue:** The comment above `NODE_ENV=development` explains only that the key has *no default*.
The comment above `CRYPTO_KEY_PROVIDER=local` (lines 48-56) states "a production boot selecting it
is refused with `CRYPTO_KEY_PROVIDER_REQUIRED:`". That reads as though the *provider choice* is
the gate. It is not — `production-guard.ts:179` refuses because `NODE_ENV === 'production'`, and
`localKeyProviderAllowed` returns `true` for `development`. A deployment that takes values from
`.env.example` into a manifest inherits `NODE_ENV=development` + `CRYPTO_KEY_PROVIDER=local` and
**boots successfully on a plaintext key file**, because the one value that would have refused it was
overwritten.

This matters more here than it would elsewhere because P2 excluded `CRYPTO_LOCAL_KEY_ALLOWED` on
exactly this reasoning: "an onboarding file is exactly where it would get adopted by someone who
does not know what it disables." The same reasoning applies to `NODE_ENV=development` and the plan
did not apply it.

Compounding: `README.md:58` and `README.md:135` instruct `set -a; . ./.env.example; set +a`. In a
shell where the operator had exported `NODE_ENV=production`, sourcing the file **silently rewrites
the exported `NODE_ENV` to `development`** for every subsequent child process in that shell. The
documented recipe mutates the security-relevant variable with no warning.
**Why it matters:** the artifact's job is to be the boot contract; the one line in it that governs
whether the key guard fires is undocumented as such.
**Fix:**
```sh
# `NODE_ENV` is REQUIRED and has no default. It is also the variable the crypto
# guard keys on: `CRYPTO_KEY_PROVIDER=local` is refused only while this reads
# `production`. Sourcing this file therefore ARMS the guard (development is an
# allowed environment) — it does not weaken production, but it does mean a value
# copied from here into a deployment manifest boots on a plaintext key.
NODE_ENV=development
```
And make the overwrite visible in the README snippet by stating `NODE_ENV=development` explicitly on
the `SERVICE_NAME=api npm run start:api` line.

### WR-02: The documented token for a collapsed Redis pair is a string the system never emits

**File:** `.env.example:40`, `README.md:86`
**Type:** real bug (documentation)
**Issue:** Both files tell the reader that collapsing the two Redis URLs "fails boot with
`CONFIG_INVALID: REDIS_INSTANCES_NOT_DISTINCT`". The actual emitted string is
`CONFIG_INVALID: <root> REDIS_INSTANCES_NOT_DISTINCT` — `formatConfigError` (`config.schema.ts:147-151`)
joins the issue path, and an object-level `superRefine` issue has `path === []`, which renders as
`<root>`. `redis.schema.spec.ts:68` already pins this exact literal:
`/^CONFIG_INVALID: <root> REDIS_INSTANCES_NOT_DISTINCT$/`.

`CONFIG_INVALID: REDIS_INSTANCES_NOT_DISTINCT` is **not a substring** of the real output.
**Why it matters:** this is the D-12 refusal — the one guard this whole phase exists to keep
load-bearing — and the README's own promise is "Every failure is greppable and names the offending
key". A developer who greps for the documented token finds nothing and concludes the guard did not
fire. Note the contrast: `CONFIG_INVALID: SERVICE_NAME` (also documented) *is* a valid prefix, so
the spec's assertion on it passes — the inconsistency is invisible from the green suite.
**Fix:** `.env.example:40` → `fails boot with \`CONFIG_INVALID: <root> REDIS_INSTANCES_NOT_DISTINCT\``.
`README.md:86` → same, and add `<root>` to the first row's `<KEY>` column so the table matches
`formatConfigError` exactly.

### WR-03: `LOCAL_KEY_FILE_MISSING:` is documented for a case that produces a raw `ENOENT`

**File:** `.env.example:66-67`, `README.md:89`, `tooling/onboarding.spec.ts:28-33`
**Type:** real bug (documentation) — the first-run experience
**Issue:** All three claim an absent key file fails with `LOCAL_KEY_FILE_MISSING:`.
`.env.example:66` says "The file is absent on a fresh checkout, and a boot that finds it missing
fails with `LOCAL_KEY_FILE_MISSING:`" — i.e. it tells the reader what to expect in the *exact*
situation they are in on a clean checkout. `README.md:89` says the token means "names a file that
is not there, or is not set."

Neither is true for "not there". `LOCAL_KEY_FILE_MISSING:` is thrown only from
`crypto.module.ts:126`, which fires when the variable is **unset or empty**
(`resolveLocalKeyFilePath`). When the path *is* set and the file is absent,
`local-key-provider.ts:115` is a bare `readFileSync(keyFilePath)` with no `try`/`catch` — the
developer gets `Error: ENOENT: no such file or directory, open './.dev-local-key'`.

The spec's docblock (`onboarding.spec.ts:29-30`) repeats the same false premise as the stated
justification for provisioning a tmpdir key: "`CryptoModule`'s factory … throws
`LOCAL_KEY_FILE_MISSING:` when `CRYPTO_LOCAL_KEY_FILE` names an absent file."
**Why it matters:** the conclusion (provision the file) is still right; the stated reason is wrong.
A reader who trusts the token table greps for `LOCAL_KEY_FILE_MISSING:` on a fresh checkout, does
not find it, and has no way to know the raw `ENOENT` is the expected first-run failure. The
token table is the artifact's contract for the FND-09 named-error guarantee, and half its rows are
unverifiable as written.
**Fix:** split the row and correct the premise:
```
| `LOCAL_KEY_FILE_MISSING:` | `CRYPTO_LOCAL_KEY_FILE` is unset or empty. |
| `ENOENT: … open '<path>'` | `CRYPTO_LOCAL_KEY_FILE` is set but the file is absent — run the
  `head -c 32 /dev/urandom > .dev-local-key` recipe. |
```
Correct `.env.example:66-67` and the spec docblock the same way. (Fixing the *emission* so an
absent file yields `LOCAL_KEY_FILE_MISSING:` would be the better repair, but that is a
`local-key-provider.ts` change and therefore out of scope for this plan.)

### WR-04: Trap A's squatter swallows its own `EADDRINUSE` and nothing asserts it bound

**File:** `tooling/onboarding.spec.ts:814-817` (with `820-827`)
**Type:** real bug (test can pass for the wrong reason)
**Issue:**
```ts
await new Promise<void>((resolve) => {
  listener.once('error', () => resolve());
  listener.listen(DEFAULT_PORT_BY_SERVICE.api, '127.0.0.1', () => resolve());
});
```
The `error` handler resolves instead of rejecting. If something else already holds port 3000 the
squatter never binds, and `afterAll` explicitly tolerates that (`if (!squatter.listening) resolve()`).
No test asserts `squatter.listening`. The trap test then boots an api that fails with `EADDRINUSE`
**from the foreign holder** and passes — asserting `EADDRINUSE` and
`Nest application successfully started`, both of which a foreign squatter produces identically.
**Why it matters:** the plan records this exact host condition as a live risk — SUMMARY deviation #2
("Port 3000 was occupied by an unrelated service … `pms-2026`"). Any developer with a leftover
process on 3000 gets a green Trap A that proved nothing. This is the "control documented,
assertion absent" shape named in the plan's own disposition section.
**Fix:** make the bind a precondition and let failure be red:
```ts
await new Promise<void>((resolve, reject) => {
  listener.once('error', reject);
  listener.listen(DEFAULT_PORT_BY_SERVICE.api, '127.0.0.1', resolve);
});
expect(squatter?.listening, 'the api default port must be free before this trap is meaningful').toBe(true);
```

### WR-05: `bootUntilLive` accepts the first healthy responder on the port without proving it is the spawned child

**File:** `tooling/onboarding.spec.ts:394-429` (predicate at `406-419`)
**Type:** real bug (test can pass for the wrong reason)
**Issue:** The poll accepts `status === 200 && body.status === 'ok'` from *any* listener on the
port. `if (api.hasExited()) return false` guards against a dead child but not against a foreign
responder: the check happens before the fetch, so while the child is still booting a pre-existing
api answering on 3000 satisfies the predicate immediately.

Concrete scenario: a developer has `SERVICE_NAME=api npm run start:api` already running against the
compose stack (exactly the situation Trap A and `.env.example:79-80` warn about). Three onboarding
assertions — "reports every core dependency up", "ignores a `.env` file", and Trap A's remedy —
poll port 3000, get the developer's process, assert against *its* readiness, then `api.stop()`
SIGTERMs a child that never bound.
**Why it matters:** `.env.example:79-80` explicitly names this hazard ("a reader who starts a second
process silently contends for the api's port 3000 and **reads the wrong process's health endpoint**")
and the spec is the artifact that is supposed to make that class of error loud. It currently absorbs
it instead. A slower boot makes it *more* likely, not less.
**Fix:** the cheap precondition is to require the port free before any boot that uses a derived
default (the `freePort()`-based Trap A remedy is already immune). The robust fix is to distinguish
the responder — assert on a value the spec controls, e.g. boot with a unique
`OTEL_SERVICE_NAME=akane-onboarding-<pid>` and read the service name back from `/health/ready`, or
run these boots on a `freePort()` and assert the derived default separately.

### WR-06: `yaml` is imported undeclared, and has no `STACK.md §14` provenance row

**File:** `tooling/onboarding.spec.ts:67` (docblock `79-93`)
**Type:** quality problem + supply-chain compliance gap
**Assessment (the executor asked for a direct judgement):** the reasoning is **partly sound and
partly not**, and the unsound part is the one that matters.

Sound: `yaml@2.9.1` is genuinely hoisted to the root with an integrity hash, and it has *two*
independent chains — production via `@opentelemetry/configuration` (`@opentelemetry/sdk-node`) and
dev via `docker-compose` (testcontainers). So availability risk is low, and the ESM failure mode is
loud (`ERR_MODULE_NOT_FOUND` at module load), not silent. The executor's "fails loudly at test time"
claim is accurate.

Not sound: T-1-SC's operative rule is not "is it in the lockfile", it is 01-01's ledger rule —
**"every package carried in `STACK.md §14` has verified provenance."** `grep -n 'yaml'
.planning/research/STACK.md` returns **zero matches**. This phase has been remediated for exactly
this twice: T-1-SC (01-07) closed only after `@testcontainers/*` got ledger rows, and T-1-SC (01-09)
closed only after `@opentelemetry/sdk-metrics` / `sdk-trace` got rows — both because "the gate did
not fire". Presenting lockfile presence as satisfying T-1-SC sets a weaker standard than the phase
has applied to itself twice already.

Also: the plan said "no manifest changes", which blocked the honest fix. That is a **plan conflict**
and belongs in Deviations, not in a docblock justifying a workaround.

**Direct answer to the question asked: no, this should be a declared `devDependency` (plus a
`STACK.md §14` row).** But the better fix needs no new package at all, and is stronger:
```sh
docker compose -f compose.dev.yml config --format json
```
That is already in the plan's verify set. It returns compose's own **resolved** document — merged
`command`, normalised port bindings, validated against compose's schema — and Docker is already a hard
test prerequisite via testcontainers. Dropping `parseYaml` for it removes the phantom import and
strengthens every compose assertion at the same time. That is the YAGNI-ladder answer: use the
platform's own capability instead of adding a dependency.

### WR-07: The README ↔ `package.json` link — declared `critical: true` — is currently decided by nothing green

**File:** `tooling/onboarding.spec.ts:329-337`; `README.md:28-32`
**Type:** quality problem (declared link unverified)
**Issue:** `key_links` declares `README.md → package.json`, `critical: true`, "decided" by the Task 2
documented-path command because it executes `npm run start:api`. The spec itself spawns
`process.execPath` with two **absolute** paths (`API_MAIN`, `API_OTEL_LOADER`) — it never touches
`package.json`. The README assertions check only that the token `start:api` appears in the prose.

So the sole check that would catch a renamed or deleted `start:api` script is the shell command
that SUMMARY deviation #1 records as **exit 1** and WINDOWS entry 18 tracks as `unrun-verify`.
Renaming `start:api` today turns nothing red.
**Why it matters:** a `critical: true` key_link is a claim that a decision exists. Right now it is
carried by a red check and a prose substring.
**Fix:** one assertion closes it — read `package.json` and assert each `start:<name>` the README
names is a real script whose argv matches the files the spec spawns:
```ts
const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};
for (const name of SERVICE_NAMES) {
  expect(pkg.scripts?.[`start:${name}`], `package.json must define start:${name}`).toContain('./apps/');
}
```

### WR-08: T-1-26's mitigation is a hand-rolled reimplementation of git's ignore engine

**File:** `tooling/onboarding.spec.ts:271-306` (`globToRegExp`, `isIgnored`)
**Type:** quality problem on a security assertion
**Issue:** `isIgnored` re-implements gitignore anchoring, last-match-wins, negation and globbing
(~35 lines, with a docblock conceding it is "a deliberately small subset"). It is the entire
mitigation for T-1-26: "`.dev-local-key` must be ignored or the recipe can commit a plaintext key."

The non-vacuity checks at `779-780` are a genuine improvement and I credit them. But the engine
underneath still diverges from git in at least one direction I can demonstrate by reading: `/build/`
is anchored to the repo root in git, while this matcher reduces it to the basename `build` and
matches at any depth — i.e. it can report "ignored" for a path git tracks. I could not construct a
fail-*open* case for the current `.dev-local-key` pattern, so this is not a live bypass — but the
guard against a plaintext key commit is now a second implementation of a well-specified algorithm,
carrying its own divergence surface.
**Why it matters:** `git` is already a documented prerequisite (`README.md:16`) and the answer is one
command. Reimplementing git here is the one place in the file where "reuse the stdlib/native
capability" beats "write the minimum code".
**Fix:**
```ts
import { execFileSync } from 'node:child_process';
const ignored = (p: string): boolean => {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', p], { cwd: REPO_ROOT });
    return true;
  } catch { return false; }
};
```
Delete `globToRegExp` and `isIgnored`. Keeps the two non-vacuity assertions (git answers correctly
for `README.md` and `.env.example`).

### WR-09: `README.md` states `npm ci` fails on the wrong Node version, for the wrong reason

**File:** `README.md:13`
**Type:** real bug (documentation)
**Issue:** "`npm ci` fails on anything else — `typescript-eslint` carries a hard peer range that caps
TypeScript below 6.1, and the build is TypeScript 6.0.3."

Two errors in one cell. (1) `engines` is `{"node": ">=24 <25"}` (`package.json:7-9`) and npm only
**warns** `EBADENGINE` unless `engine-strict=true`. There is no `.npmrc` anywhere in the repo
(`find . -name '.npmrc' -not -path './node_modules/*'` → empty), so `npm ci` on Node 22 succeeds.
(2) The cited mechanism — the `typescript-eslint` peer range — constrains the **TypeScript** version,
not the Node version; it is the reason TypeScript is pinned, an unrelated fact stapled onto a Node
claim.
**Why it matters:** it is the first substantive sentence in the prerequisites table of a document
whose entire purpose is to be correct, and it tells a Node-22 developer both that they will be
stopped (they will not be) and why (for the wrong variable).
**Fix:** `| Node.js | **24.x LTS** | The pinned runtime. \`engines\` is \`>=24 <25\`; npm only *warns* (\`EBADENGINE\`) on a mismatch, so the floor is a convention, not an enforced gate. TypeScript is hard-pinned to 6.0.3 for an unrelated reason — \`typescript-eslint@8.71.0\` peers \`>=4.8.4 <6.1.0\`. |`

## Info

### IN-01: A test name claims a boot that does not happen

**File:** `tooling/onboarding.spec.ts:548-556`
**Quality.** `it('boots against the harness Mongo URL, …')` spawns nothing; it parses
`containers.urls.mongo` and asserts one search param. A reader scanning test output will believe a
process was booted. Rename to what it does — e.g. `'the harness Mongo URL carries directConnection=true'` — or fold it into the static P6 test at `722`.

### IN-02: A vacuous assertion that reads like a real one

**File:** `tooling/onboarding.spec.ts:574`
**Quality.** `expect(Object.keys(statuses)).toEqual([...CORE_HEALTH_INDICATOR_KEYS])` can never fail:
`dependencyStatuses` (`445-455`) iterates `[...CORE_HEALTH_INDICATOR_KEYS]` and assigns every key
unconditionally. It *appears* to assert that readiness names three dependencies; the following
`expect(statuses).toEqual(...'up')` is what actually carries the assertion. Delete line 574 or
derive `Object.keys(statuses)` from `ready.body` instead.

### IN-03: The `.env.example` shape assertion does not check shell safety

**File:** `tooling/onboarding.spec.ts:114`, `474-486`
**Quality.** `ACTIVE_LINE = /^[A-Z0-9_]+=\S+$/` rejects spaces but accepts `A=$(id)`,
`` A=`id` ``, or `A=x;rm -rf /`. `.env.example` is a file developers **execute** in their shell
(`set -a; . ./.env.example`), and the assertion's own message claims "`. ./.env.example` would
break". No current value is unsafe — this is a gap in the guard, not a live injection — but the
check can be made honest for one extra character class: `expect(value).not.toMatch(/[$`;&|<>()]/)`.

### IN-04: `compose.dev.yml` has no healthchecks and the README documents `up -d` without `--wait`

**File:** `compose.dev.yml:33-70`; `README.md:116`, `134`
**Quality.** `MongoService` connects lazily (`mongo.service.ts` — nothing connects in the
constructor; `ping()` is the only probe), so an early api boot does not crash — readiness simply
reports `mongo: down` for a few seconds. That transient has the same *symptom* as Trap B
(`README.md:170-196`), which is a poor first impression for the newcomer the document is written
for. The plan's own verify used `up -d --wait`; the README documents plain `up -d`. Add
`healthcheck:` blocks to the mongo/redis services and change the README snippet to
`docker compose -f compose.dev.yml up -d --wait`.

### IN-05: The README presents the API as loopback while it binds the wildcard

**File:** `README.md:29-31`, `43-44`, `137`
**Quality.** Every URL is `http://127.0.0.1:3000`, but `main.ts:75` is `app.listen(port)` with no
host, so Node binds the wildcard. The plan applied a loopback discipline to compose ports (P4 /
T-1-28) and none to the api process, and the README's uniform `127.0.0.1` could be read as "the API
is loopback-only". Pre-existing behaviour from 01-10 — out of scope to change — but the README
should say the entrypoint listens on all interfaces so nobody builds a false assumption on it.

### IN-06: `freePort()` is a TOCTOU race

**File:** `tooling/onboarding.spec.ts:790-800`, used at `851`
**Quality.** Bind `:0` → read the assigned port → `close()` → the child binds it. Another process can
take the port in between. Test-only and unlikely; noted for completeness, not for action.

### IN-07: The decoy-`.env` temp directory leaks on failure

**File:** `tooling/onboarding.spec.ts:620-635`
**Quality.** `rmSync(decoyDir, …)` is the last statement of the test body, so any failed assertion
leaves the directory in `os.tmpdir()`. `afterAll` already removes `KEY_DIR` at module scope
(`129-131`); do the same for `decoyDir`.

### IN-08: `readComposeFile()` casts without a shape check

**File:** `tooling/onboarding.spec.ts:227-229`
**Quality.** `parseYaml(...) as ComposeFile` — a valid-YAML-but-not-a-mapping `compose.dev.yml`
yields `Object.keys(undefined)` and a `TypeError` at `642` instead of a named assertion failure.
A `expect(doc).toBeTypeOf('object')` in the first compose test, or a guard in the reader, gives a
message a reader can act on.

### IN-09: `01-SECURITY.md` has no `T-1-SC` row for plan 01-11

**File:** `.planning/phases/01-foundations-platform/01-SECURITY.md`
**Compliance.** The register still says "34 threats across 10 plans" and its `T-1-SC` table ends at
`01-10`. Plan 01-11 declared its own `T-1-SC` (two new container images plus the `yaml` import) and
added neither a row nor the `yaml` provenance row that row would have demanded. This is the third
instance of the same gap; the first two were remediated, this one is recorded only in the SUMMARY's
Threat Flags table.

### IN-10: Host-sensitivity in the spec is real but did not reproduce

**File:** `tooling/onboarding.spec.ts:401-419`, `919-926`
**Quality.** The known WINDOWS #18 / `unrun-verify` item is a *shell-command* budget problem
(`30 × 500 ms = 15 s` against a ~29 s boot) and **the spec does not share it** — `bootUntilLive`
allows `120 × 500 ms = 60 s`, roughly 2× the observed worst case, and Trap B's failing arm allows
`60 × 1 s`. Both are the same *class* of fixed wall-clock budget, so a materially worse host could
still flip them, and a slower boot slightly increases the WR-05 window. No action needed; recorded
so the two budgets are not confused later.

## Explicit assessments requested

### Is the surviving P6 check tautological?

**No. It is sound.** Verified against the source, not against the executor's account.

P6 is asserted in three places across two genuinely independent sources:

1. `onboarding.spec.ts:722-738` — compose's `mongo.command` contains no `--replSet` **and**
   `.env.example`'s parsed `MONGO_URL` has no `directConnection` (`searchParams.has` → false, plus
   `search === ''`). These are two different files compared against each other's implications, not
   a locally rebuilt literal. Change either side and it goes red.
2. `onboarding.spec.ts:548-556` — `containers.urls.mongo`, built by `mongoUrl()` from the live
   container (`containers.ts:69-73`, `139`), *does* carry `directConnection=true`. Independent of
   `.env.example`; catches a future edit to `mongoUrl()` that drops the parameter (which would break
   every boot in the file).
3. `onboarding.spec.ts:877-929` — the behavioural pair. Two boots whose envs differ in exactly one
   query param, one reporting `mongo: up` and one not, with an explicit precondition assertion at
   `900-903` and a string-inequality assertion at `904-906` guarding against the arms collapsing.

The removed first draft was indeed a control with no assertion behind it. What replaced it is not.
This is the one thing I checked hardest for, because the plan failed plan-review three times for
this shape.

### Does the spec avoid inheriting `PORT`/`NODE_ENV`?

**Yes, and correctly.** `childEnv` (`181-187`) names `PATH` and `HOME` and spreads only `overrides` —
no `...process.env`. `NODE_ENV` is set on every boot, `PORT` is absent unless a boot sets it, and
`OTEL_EXPORTER_OTLP_ENDPOINT` is never inherited. This is the right discipline and the reasoning in
the docblock earns its length. (WR-05 is a *different* hazard — a foreign responder on the port —
not an inheritance leak.)

### Is the decoy-`.env` boot a real assertion?

**Yes.** `613-636` boots a real process with `cwd` set to a directory containing
`MONGO_URL=mongodb://127.0.0.1:1/nowhere-listening`, with absolute `API_MAIN`/`API_OTEL_LOADER` so
the moved `cwd` cannot break the spawn, and requires `mongo: up`. A `ConfigModule.forRoot()` loader
added later turns it red. This is the strongest anti-tautology decision in the file: it asserts
behaviour, not the sentence. Note the README's claim at `64-79` is therefore decided mechanically,
as the plan intended.

### Verdict

`01-11` closes G1 with real artifacts and a real executable proof. The design reasoning is
consistently strong and the docblocks explain *why*, which is unusual and valuable. What is left is
documentation accuracy (WR-01, WR-02, WR-03, WR-09) and two tests that can pass for the wrong
reason (WR-04, WR-05) — both of the same class the plan itself named as this phase's recurring
failure mode. Fix the four token/guard descriptions and the two test preconditions and this is
done.

---

_Reviewed: 2026-10-05T06:21:09Z_
_Reviewer: the agent (gsd-code-reviewer) — gap-closure scope, plan 01-11_
_Depth: standard_
_`01-REVIEW.md` (599 lines, Phase 01 original execution) left untouched; scope is the five files listed in `files_reviewed_list`._