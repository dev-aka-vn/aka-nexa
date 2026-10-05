# Phase 1: Foundations & Platform - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-01
**Phase:** 1-Foundations & Platform
**Areas discussed:** Repository topology & component boundary model, Build/install guard & test harness, Health & readiness topology, Two-Redis topology, Log PII allowlist mechanism, Trace-ID decoupling & OTel bootstrap, Frozen contracts (read-link claims + JEV wire), Secrets envelope & KMS master key, Discovery rulings carried out of Phase 1
**Gathering mode:** `--auto` — all 9 areas auto-selected; each question resolved to its recommended option without prompting. No user input was taken. "Notes" below are the agent's reasoning, not user feedback.

---

## Repository topology & component boundary model

| Option | Description | Selected |
|--------|-------------|----------|
| npm workspaces, 4 packages + 3 server apps | `kernel`/`platform`/`contract`/`domain`; one build unit per concern | ✓ |
| Single package, three `main.ts` entrypoints | No workspaces; `src/<component>/` inside one package | |
| npm workspaces, one package per domain module (12) | Maximum structural isolation | |

**Choice:** 4 packages + 3 server apps.
**Notes:** 12 packages makes the boundary graph acyclic *by construction*, which is exactly what the boundary rule exists to prevent it from being — the rule would never fire and nobody would notice. One `domain` package with 12 element types gives identical enforcement with one build unit. `kernel` ships with no `dependencies` field at all: needing a library there is the signal that the type belongs elsewhere.

| Option | Description | Selected |
|--------|-------------|----------|
| Adopt `ARCHITECTURE.md`'s element/edge tables verbatim | As researched | |
| Verbatim + `contract` as an element type + `domain` root excluded | Two amendments | ✓ |
| Ad-hoc per-module `no-restricted-imports` | No element model | |

**Choice:** Verbatim, with two amendments.
**Notes:** The research table names `packages/contract/` and gives `adapters → contract`, but omits `contract` from the allowed-edges list. Under `default: "disallow"` that makes every contract import a lint error — a copy-paste bug that would surface as a wall of failures. Second amendment: the `domain` root is not an element type, so a new subdirectory is an explicit config change rather than silently inheriting a permissive parent.

| Option | Description | Selected |
|--------|-------------|----------|
| Element-type edges only | R1–R3 not expressible as element edges | |
| R1–R3 category policies only | No boot-time check | |
| R1–R3 **plus** a boot-time `ModuleRef` provider assertion | Static + dynamic | ✓ |

**Choice:** All three, with R1 extended.
**Notes:** NestJS resolves providers lazily, so a module that imports something it never uses may never instantiate it — and a dynamic `ModuleRef.get(token, { strict: false })` is completely invisible to ESLint. The lint rule catches the static case; the boot assertion catches the escape. R1 was extended to forbid BullMQ's `Worker` in both `api` and `scheduler`: without that, `api` can import a `Worker` and the 200 ms ack budget dies with no test failing.

| Option | Description | Selected |
|--------|-------------|----------|
| Create all 5 app workspaces now | Including both Vite apps | |
| Create only `api`/`worker`/`scheduler` now | Web apps added when they ship | ✓ |

**Choice:** Three server workspaces only.
**Notes:** `package-lock.json` is a Phase 1 deliverable (FND-02) and a smaller one is easier to audit. The boundaries config tolerates absent element types.

---

## Build, install guard & test harness

| Option | Description | Selected |
|--------|-------------|----------|
| CI-only lint job | Build locally succeeds regardless | |
| `npm run build` depends on `npm run lint` | Same gate locally and in CI | ✓ |
| Git pre-commit hook | Fast feedback | |

**Choice:** Build depends on lint.
**Notes:** FND-04 says *fails the build*, and a pre-commit hook is bypassable and absent in CI. ESLint over NestJS 12's oxlint scaffold because `eslint-plugin-boundaries` is ESLint-only — already a recorded key decision.

| Option | Description | Selected |
|--------|-------------|----------|
| Local npm script developers run by hand | Documented in the README | |
| Dedicated CI job: delete lockfile → install → build → test | Guard cannot be forgotten | ✓ |
| Rely on the committed lockfile alone | No guard | |

**Choice:** Dedicated CI job.
**Notes:** The whole point of the guard is that a *deliberate* install with the lockfile deleted must not resolve TypeScript 7.0.2 and break the build. A script nobody runs is not a guard.

| Option | Description | Selected |
|--------|-------------|----------|
| Jest + one shared Redis container | Conventional | |
| Vitest 5 + testcontainers with mongo, cache Redis, queue Redis | Three containers | ✓ |
| Vitest + docker-compose for local dev only | No integration coverage | |

**Choice:** Vitest + three testcontainers.
**Notes:** Three containers is a correctness requirement, not tidiness. `maxmemory-policy` is instance-wide, so a single Redis container cannot express the two-deployment split this phase commits to — a one-container harness would let D-12's split pass CI while being untestable.

| Option | Description | Selected |
|--------|-------------|----------|
| GitHub Actions | Stated default, swappable | ✓ |
| Defer to a later phase | No CI in Phase 1 | |

**Choice:** GitHub Actions.
**Notes:** Cannot be deferred — both D-05's build gate and D-06's install guard live there.

---

## Health & readiness topology

| Option | Description | Selected |
|--------|-------------|----------|
| `createApplicationContext()`, no HTTP on worker/scheduler | `ARCHITECTURE.md` recommendation | |
| All three `NestFactory.create()`; worker/scheduler mount health + metrics only | Satisfies FND-05 literally | ✓ |
| Health served only by `api` | One HTTP surface | |

**Choice:** All three use `create()`.
**Notes:** **This contradicts a research recommendation, deliberately.** FND-05 is a v1 requirement that each of the three processes expose `/health/live` and `/health/ready`; "the worker has no HTTP surface" is a research preference, not a requirement. One bootstrap path across three processes is worth more than a marginally smaller surface, and R1 is the mechanism that actually prevents surface creep. A reviewer who disagrees should amend FND-05, not just this decision.

| Option | Description | Selected |
|--------|-------------|----------|
| One aggregate "dependencies ok" readiness check | Simple | |
| Per-dependency indicators with per-process additions | Names which dependency failed | ✓ |
| Readiness identical on all three | Uniform | |

**Choice:** Per-dependency indicators.
**Notes:** Separate Redis indicators are what make the two-deployment split diagnosable — a single `redis: down` tells an operator nothing about which deployment is unreachable. Liveness checks no dependency and stays 200 during a Redis blip, so a cache outage does not K8s-restart healthy pods.

| Option | Description | Selected |
|--------|-------------|----------|
| Include K8s manifests and probe wiring | Deployable | |
| Out of scope for Phase 1 | No deployment manifests in v1 scope | ✓ |

**Choice:** Out of scope. Recorded so the planner does not invent them.

---

## Two-Redis topology

| Option | Description | Selected |
|--------|-------------|----------|
| One `REDIS_URL` + logical-database suffix | One connection | |
| Two required URLs with a boot check that they differ | Two DI tokens, Zod-validated | ✓ |
| One URL + a config-declared role | Role from config | |

**Choice:** Two required URLs with a host-inequality boot check.
**Notes:** Logical DBs cannot express the split — `maxmemory-policy` is instance-wide. The boot check is the load-bearing part: without it, the split silently regresses into one instance six phases from now and nothing notices until a `noeviction` OOM stalls the queues.

| Option | Description | Selected |
|--------|-------------|----------|
| All application keys on cache, BullMQ on queue | Simple split | |
| Split by durability class | Reconstructible/TTL on cache, BullMQ on queue | ✓ |
| Everything on the queue instance | One instance | |

**Choice:** Split by durability class.
**Notes:** One-time *write* tokens sit deliberately on the evicting side. Losing one only breaks a link the user can re-request, and a lost `GETDEL` is backstopped by the MongoDB `unique { link_jti: 1 }` index — so evicting them is safe, and putting them on `noeviction` would grow the instance that must not OOM. The governing invariant: **no durable state in either Redis instance.** Everything that must not be lost lives in MongoDB, which is what makes AD-9's statelessness claim true rather than aspirational.

| Option | Description | Selected |
|--------|-------------|----------|
| No prefix; default ioredis `keyPrefix` | Unconfigured | |
| BullMQ `prefix: "{akane-q}"`; no ioredis `keyPrefix`; `maxRetriesPerRequest` null on worker / 1–3 on producers | Hash tag, explicit retry split | ✓ |

**Choice:** Hash-tag prefix with an explicit retry split.
**Notes:** The hash tag pins all queue keys to one cluster node, so queue throughput does not shard and that node is a documented ceiling. Acceptable at NFR-S-2's 50 events/s, but it must be a conscious choice recorded in the runbook, not an accident discovered in production. Never ioredis `keyPrefix` alongside BullMQ — two prefixing layers silently corrupting each other. `maxRetriesPerRequest` must be `null` for the worker's blocking connection or BullMQ throws, and finite for request-path producers so an HTTP handler fails fast instead of hanging when Redis is down. This is the one place "share the connection everywhere" is abandoned: two profiles, not one.

---

## Log PII allowlist mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| pino `redact` paths | Denylist | |
| Typed `LoggerPort` + a Zod-parsing destination stream that strips unknown keys before stringify | Two layers, allowlist | ✓ |
| Regex value-scrubbing formatter | Denylist by another name | |

**Choice:** Typed port + allowlist-stripping stream.
**Notes:** Layer 1 (types) catches the ordinary case at compile time. Layer 2 (the stream) is the actual security control, because it catches computed keys like `obj[userInput]` where the type system cannot help. `redact` is a denylist and a denylist always misses — that is the entire reason the §15.4 erasure promise was narrowed rather than kept.

| Option | Description | Selected |
|--------|-------------|----------|
| Allowlist + a free-form `meta` object for anything else | Escape hatch | |
| Closed allowlist, no escape hatch; `error_code` is a closed enum; error `cause` chains dropped | Maximum friction | ✓ |

**Choice:** Closed allowlist, no escape hatch.
**Notes:** A free-form bag is a denylist with extra steps — it re-opens the hole the allowlist closes. Adding a field requires a written justification in the same commit; that friction is the control. Error `cause` chains are dropped rather than serialised because a cause can carry PII straight out of a downstream HTTP body, which is precisely the kind of field a hand-written logger passes through without thinking.

| Option | Description | Selected |
|--------|-------------|----------|
| Documentation only | A comment saying "no PII" | |
| A test that emits PII as a typed field, a computed key, and a nested `cause`, asserting none reaches the output | Proves the ruling | ✓ |

**Choice:** The test.
**Notes:** The conflict ruling that made the log allowlist mandatory is worthless without this. Three attack shapes, because a single test proves only the case its author imagined.

---

## Trace-ID decoupling & OTel bootstrap

| Option | Description | Selected |
|--------|-------------|----------|
| Convention: do not set the trace id from `submission_id` | A code comment | |
| Frozen span-attribute allowlist + a test asserting the exported attribute set is a subset | Mechanical | ✓ |
| Hash `submission_id` into the trace context | Deterministic correlation | |

**Choice:** Frozen allowlist + subset test.
**Notes:** Hashing is rejected: a hash of `submission_id` is still correlatable by anyone holding the submission list, and the whole point of conflict #2's ruling is that the trace store must not become a multi-year activity map. Convention is not a control — this is the same reasoning that produced the boundary lint rule.

| Option | Description | Selected |
|--------|-------------|----------|
| Nowhere | Maximum safety | |
| Logs and the MongoDB audit trail only | Both have defined purge windows | ✓ |

**Choice:** Logs and audit trail.
**Notes:** A log line carries `trace_id`, so an operator goes trace → logs; the reverse is not derivable. That asymmetry *is* the erasure property. Logs are 30 d hot / 1 y cold; the audit trail is 3 y with a tombstoneable `actor_ref`. The trace backend is the one store with no per-app RBAC and no erasure path, so it is the one store that must not accumulate the correlation.

| Option | Description | Selected |
|--------|-------------|----------|
| Traces only; metrics later | Smaller Phase 1 | |
| `NodeSDK` as the first statement of each `main.ts` before `AppModule` import; OTLP trace + OTLP metrics + Prometheus now | One metrics path | ✓ |

**Choice:** Full bootstrap in Phase 1.
**Notes:** A static top-of-file `AppModule` import is the single most common way to lose end-to-end traces, and it fails *silently* — no error, just missing spans. One metrics path only (OBS-01): a second `prom-client` path means two scrape endpoints, two naming conventions, and split alert rules. Business metric registration starts here even though the counters land later, so the exporter path is proven before anything depends on it.

---

## Frozen contracts: read-link claims & JEV wire

| Option | Description | Selected |
|--------|-------------|----------|
| PRD §6.6 link types with a `typ` discriminant | Reuses the JOSE header name | |
| Explicit claim set with an `action` discriminant, including `query_version` frozen now | Named, complete | ✓ |

**Choice:** The explicit set with `action`.
**Notes:** The JOSE header already owns `typ`; reusing it for a domain discriminant in the payload is a collision that costs more later than it saves now. `query_version` is frozen in Phase 1 even though the read path is Phase 3 — a saved query is versioned exactly the way a form is (FRM-02), so a Phase 3 query link is *unrepresentable* without it, and adding a claim later is the exact break this phase exists to prevent. `perm_version` is on read links only: a write link consumes on submit and gets a fresh check at the execution boundary, so an issuance-time version there would imply a guarantee it does not provide. No version claim in the token — the schema version is a code constant plus the published JSON Schema `$id`, and spending a claim on self-description buys nothing when a frozen test already governs the set.

| Option | Description | Selected |
|--------|-------------|----------|
| Build the draft token class in Phase 1 | Full support | |
| Defer the state machine; reserve `action: "draft"` in the frozen enum, reserve `ak:tok:draft:{jti}`, model token classes as a `{action, ttl, consume}` config table | Shape now, machinery later | ✓ |
| Ignore it; redesign the token model in Phase 2 | Free | |

**Choice:** Reserve the shape, defer the machinery.
**Notes:** The highest-value decision in the phase. Research flagged draft-save as a structural blocker on Phase 2's token model — a resumable draft needs a second, longer-lived token class incompatible with the stateless one-time-token SPA. Reserving one enum value and one table row removes the blocker for essentially no cost. The alternative (build it now) drags a Redis state machine, a resumable-form store, and a second token lifetime into a foundations phase that needs none of them.

| Option | Description | Selected |
|--------|-------------|----------|
| PRD §11.1 verbatim | Faithful | |
| Verbatim plus `choice.verified: boolean \| null` with a cross-field refinement, and `state.force_clarification: boolean` | Two additions | ✓ |

**Choice:** Verbatim plus two additions.
**Notes:** `verified: null` (abstention) is a *different signal* from low confidence, so the platform routes it to clarification regardless of score — the refinement makes that structural: `verified === null` ⇒ `tool_id === null` **and** `clarification_needed === true`. `force_clarification` exists because clarification is not only the provider's call; the platform has its own reasons (locale, input length, tool-set churn). `choice` becomes required so the conformance suite has one shape to test rather than two. Published as a first-party named interface, not a vendor protocol: "JEV" is a hosted vendor model with no industry standard and the PRD's "OpenJev" references are unofficial reconstructions. `RuleBasedProvider` is named in the contract as the terminal fallback so its absence is a startup failure, not a runtime surprise.

| Option | Description | Selected |
|--------|-------------|----------|
| Documented as a comment | "Do not change without a migration" | |
| `.strict()` Zod + a test asserting the exact sorted top-level key set | Adding a claim fails CI | ✓ |

**Choice:** Mechanical freeze.
**Notes:** This is the phase's success criterion #5 stated as a mechanism rather than a promise. The test names the version, so a deliberate breaking change becomes a visible edit to a versioned constant instead of an accident that ships.

---

## Secrets envelope & KMS master key

| Option | Description | Selected |
|--------|-------------|----------|
| Opaque concatenated string | Compact | |
| `{v, alg:'A256GCM', kid, iv, tag, ct}` base64url beside the ciphertext | Versioned, rotatable | ✓ |

**Choice:** Versioned JSON envelope.
**Notes:** `kid` from v1 makes rotation additive: a secret under a retired key is re-wrapped, never re-encrypted from plaintext the system will not have. Cheap now, and it is the difference between a rotation and a migration later.

| Option | Description | Selected |
|--------|-------------|----------|
| A concrete AWS/GCP/Vault adapter now | Complete | |
| `KeyProvider` interface + `LocalKeyProvider` + envelope implementation + round-trip test | Mechanism now | ✓ |
| Plaintext env-var master key for now | Simplest | |

**Choice:** Interface + local provider + envelope.
**Notes:** `LocalKeyProvider` refuses to boot when `NODE_ENV=production`, so it cannot become the production path by accident. The round-trip test asserts neither the key nor the plaintext reaches a log record — which is where the log allowlist from the previous area and this one meet.

| Option | Description | Selected |
|--------|-------------|----------|
| Pick AWS and move on | Unblocks the task | |
| Startup assertion that `NODE_ENV=production` without `CRYPTO_KEY_PROVIDER=kms` fails boot; vendor adapter is a named blocked task | Honest | ✓ |

**Choice:** The guard plus a named blocker.
**Notes:** FND-10 requires a KMS-backed key and **no deployment cloud has been named**. The guard is what makes Phase 1 honest: production can never silently fall back to a local key. Guessing a vendor now yields an adapter that is untested against a real KMS and has to be rewritten — and the interface, which is the part that must not change later, is unaffected either way. This is the one area where a decision was deferred to a human, and it is recorded as a blocker rather than an assumption.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, seed one secret | Exercises the store | |
| No — mechanism and guard only | First real secret is a connector credential later | ✓ |

**Choice:** No secret stored in Phase 1.

---

## Discovery rulings carried out of Phase 1

| Option | Description | Selected |
|--------|-------------|----------|
| Spike it in Phase 1 to confirm `@formio/js` renders `file` unlicensed | Answers the question | |
| Rule it out of v1 with no Phase 1 work; record a v2 precondition | Scope discipline | ✓ |

**Choice:** Out of v1, no spike.
**Notes:** **Deviates from `ROADMAP.md` Phase 1's "Discovery required (a)".** The licensing question gates only file upload, which is already v2 (`FRM-11`, with `FRM-13` and `DAT-17` dependent). AD-3's open-source claim is preserved by *not shipping* the premium component — there is nothing to license. Spending foundations time on a question about a deferred feature is the wrong trade. The precondition travels with `FRM-11`: a spike confirming unlicensed rendering, or a purchased Library Licence. Two unresolved sub-questions attach to that future phase — the PUT URL needs S3-class object storage plus a token endpoint the PRD never specifies, and uploads persist regardless of submit.

| Option | Description | Selected |
|--------|-------------|----------|
| Run a technical spike in Phase 1 | Phase 1 decides | |
| OIDC is the plan of record; convert S3 into a customer question with a deadline before Phase 5 planning | Right kind of question | ✓ |

**Choice:** Customer question, not a spike.
**Notes:** Which IdP the customer uses is a fact about the customer, not a technical unknown — no amount of local work answers it. OIDC covers Entra ID, Okta, Auth0, Google Workspace, and Keycloak. `BLD-12` is the first surface that needs SSO and Phase 1 needs none, so this does not block anything. If SAML is required: `@node-saml/node-saml` has been quiet since 2025-07-21, needs its own spike, and adds 2–3 weeks that are **not** in the ~43-week estimate.

| Option | Description | Selected |
|--------|-------------|----------|
| Re-evaluate MongoDB 9.0 in Phase 1 | Attractive EOL (2031-10-31) | |
| Defer — 8.0.x is the committed pin | Four days old at verification | ✓ |

**Choice:** Defer to a milestone item. Revisit before the 3-year retention window makes a migration expensive, not before Phase 1.

| Option | Description | Selected |
|--------|-------------|----------|
| Take `PROJECT.md`'s 7.2.0 | Later document | |
| Take `ARCHITECTURE.md`'s 5.3.1 | Research doc | |
| Re-verify against the registry at install time; do not guess in the plan | Neither is confirmed | ✓ |

**Choice:** Re-verify and record.
**Notes:** The two research outputs disagree and the rule *form* differs between the versions. A wrong pin means silent under-enforcement of the phase's headline constraint — exactly the failure mode the phase exists to prevent. The form used is `boundaries/dependencies` with `default: "disallow"` plus `boundaries/files` category policies, stable across v5 → v7.

| Option | Description | Selected |
|--------|-------------|----------|
| Open tool-selection accuracy and the audit-retention legal framing in Phase 1 | Thorough | |
| Confirm both out of scope | Correct altitude | ✓ |

**Choice:** Both out of scope. Accuracy needs an `AI-SPEC.md` in the routing phase; the "legitimate interest" framing needs counsel, not research.

---

## the agent's Discretion

`--auto` mode resolved all 9 areas to their recommended option with no prompting. Two deserve human review before planning:

- **KMS vendor (D-27)** — a genuine unknown, not a judgement call. The interface and production guard are the right answer to an unnamed deployment target, but "blocked on naming the cloud" means Phase 1 cannot be fully closed until someone answers it.
- **Health topology (D-09)** — contradicts an `ARCHITECTURE.md` recommendation. Satisfies FND-05 literally at the cost of a health-only HTTP listener on two processes. Overturning it means amending FND-05, not just this decision.

Everything else is a mechanism choice with a recorded reason; a reviewer disagreeing with any of them can edit `01-CONTEXT.md` directly before planning.

## Deferred Ideas

- File upload (`FRM-11`), object storage (`FRM-13`), save-and-continue (`DAT-17`) — v2, with the licensing precondition.
- Draft save & resume state machine (`FRM-12`) — v2; only the reserved enum value and key namespace land in Phase 1.
- KMS vendor adapter — blocked on naming the deployment cloud.
- SAML support — customer question, deadline before Phase 5 planning; +2–3 weeks if required.
- MongoDB 9.0 re-evaluation — milestone item.
- Kubernetes deployment manifests and probe wiring — not in v1 scope.
- Decision-model provider, host, and cost profile — needs `AI-SPEC.md` in the routing phase.
- "Legitimate interest" legal framing for 3-year audit retention — needs counsel.
