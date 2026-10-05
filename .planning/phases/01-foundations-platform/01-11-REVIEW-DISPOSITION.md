# Phase 01-11: Code Review Disposition

Scope: gap-closure plan `01-11` only — the five files it produced
(`.env.example`, `compose.dev.yml`, `README.md`, `tooling/onboarding.spec.ts`,
`.gitignore`). Subject review: `01-11-REVIEW.md`. The prior phase's review and
disposition are `01-REVIEW.md` and `01-REVIEW-DISPOSITION.md`, left untouched.

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| WR-01 | warning | open | Documented error token `CONFIG_INVALID: REDIS_INSTANCES_NOT_DISTINCT` does not match the emitted string. `redis.schema.spec.ts:68` pins `/^CONFIG_INVALID: <root> REDIS_INSTANCES_NOT_DISTINCT$/` — the `<root>` segment is missing from the docs, so the documented token is not greppable. Independently re-verified by the orchestrator against `redis.schema.ts:46` and `redis.schema.spec.ts:68`. This is the D-12 refusal, the guard this phase exists to keep load-bearing. |
| WR-02 | warning | open | `LOCAL_KEY_FILE_MISSING:` documented for an absent key file. That token only fires when the *variable* is unset (`crypto.module.ts:126`). An absent file throws a raw `ENOENT` from a bare `readFileSync` at `local-key-provider.ts:112` with no try/catch. Independently re-verified by the orchestrator. `tooling/onboarding.spec.ts`'s own docblock repeats the false premise as its justification. |
| WR-03 | warning | open | `README.md:13` claims `npm ci` fails on non-24 Node. No `engine-strict` in `package.json` and no `.npmrc` anywhere, so npm warns rather than fails. Independently re-verified by the orchestrator. |
| WR-04 | warning | open | Security-relevant: `NODE_ENV=development` is the switch that disarms `CRYPTO_KEY_PROVIDER_REQUIRED:`, and no documentation says so. P2 excluded `CRYPTO_LOCAL_KEY_ALLOWED` on exactly this reasoning. Compounding: the documented `set -a; . ./.env.example` silently rewrites an operator's exported `NODE_ENV=production` in their own shell. |
| WR-05 | warning | open | Trap A's port squatter swallows its own `EADDRINUSE` with no `listening` assertion, so the test can pass without the squatter ever having bound. Port 3000 was occupied on this host during execution. False-green risk — the shape this plan failed plan-review three times for. |
| WR-06 | warning | open | `bootUntilLive` accepts the first healthy responder on the port, so a developer's already-running api makes three assertions pass against a foreign process. This is the exact hazard `.env.example:79-80` warns about. |
| WR-07 | warning | open | The `critical: true` README↔`package.json` link is decided only by the red shell command, not by the spec. |
| WR-08 | warning | open | T-1-26's mitigation re-implements git's ignore engine in ~35 lines when `git check-ignore` is one call away and git is already a documented prerequisite. |
| WR-09 | warning | open | `tooling/onboarding.spec.ts` imports `yaml` with no manifest entry. Availability argument is sound (hoisted, integrity-hashed, two independent chains, loud ESM failure on removal) but T-1-SC's rule is STACK.md §14 provenance and `grep 'yaml' .planning/research/STACK.md` returns zero — the same gap this phase remediated twice before (01-07, 01-09). Reviewer's preferred fix needs no new package: `docker compose config --format json` is already in the verify set and returns compose's own resolved document. |
| IN-01 | info | open | |
| IN-02 | info | open | |
| IN-03 | info | open | |
| IN-04 | info | open | |
| IN-05 | info | open | |
| IN-06 | info | open | |
| IN-07 | info | open | |
| IN-08 | info | open | |
| IN-09 | info | open | |
| IN-10 | info | open | |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run. Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.

**Verified sound, recorded so it is not re-litigated:** P6 is genuinely not tautological — three assertions across two independent sources (compose `command` vs `.env.example` parsed `search`; `containers.urls.mongo` built by `mongoUrl()` from the live container; a behavioural boot pair differing in exactly one query param). The removed first draft was a real fabrication; what replaced it is not. The zero-source-edit claim holds: `git diff --name-status 6bbcfdb1..HEAD` is exactly the five in-scope files plus two planning artifacts.

**Note on WR-09.** Its disposition interacts with the plan's own constraint. Declaring a devDependency requires editing `package.json`, which `01-11` explicitly does not authorise ("Do not modify … `package.json`"). The reviewer's alternative — assert against `docker compose config --format json` — needs no new package and no manifest change, so it is reachable inside the plan's constraints. That is the route to prefer if WR-09 is actioned.