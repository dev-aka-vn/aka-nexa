# Phase 1: Foundations & Platform - Context

**Gathered:** 2026-10-01
**Status:** Ready for planning
**Mode of gathering:** `--auto` — all 9 gray areas auto-selected, each resolved to its recommended option. See `01-DISCUSSION-LOG.md` for the alternatives that were considered and rejected.

<domain>
## Phase Boundary

**This phase delivers the floor the other seven phases stand on, and nothing else.**

In scope:

- An npm-workspaces monorepo that installs and builds reproducibly on the pinned stack (Node 24 LTS, NestJS 12, TypeScript 6.0.3 hard-pinned, committed lockfile).
- Three independently runnable process entrypoints — `api`, `worker`, `scheduler` — plus the `kernel` / `platform` / `contract` / `domain` package skeletons.
- A build-failing component-boundary rule plus the boot-time assertion that backs it.
- `/health/live` and `/health/ready` on all three processes, with readiness depending on MongoDB and **both** Redis deployments.
- The OpenTelemetry bootstrap, the structured-logging allowlist, and the decoupled trace ID.
- Zod-validated configuration at boot, and the AES-256-GCM secret-envelope mechanism.
- The two frozen contracts: the read-link JWT claim shape and the JEV-compatible wire contract, each with a mechanical frozen-field test.

Explicitly **not** in this phase: any user-facing capability. No Slack adapter, no form, no link issuance, no submission, no App Builder, no decision provider. Phase 1's deliverable is a set of commitments that are cheap now and impossible to change later — which is precisely why it is a phase rather than a ticket.

</domain>

<decisions>
## Implementation Decisions

### Repository topology & component boundary model

- **D-01:** npm workspaces with **exactly four packages** — `packages/kernel` (shared Zod schemas and types; zero I/O, zero `dependencies` field at all), `packages/platform` (config, mongo, two redis profiles, queue, crypto, otel, http, logging), `packages/contract` (JEV provider interface, connector interface, `InboundEvent`/`OutboundMessage`), `packages/domain` (the 12 domain modules) — plus `apps/api`, `apps/worker`, `apps/scheduler`. `nx`/`turbo` stay rejected. One package per domain module (12 packages) was considered and rejected: it makes the boundary graph acyclic by construction, which is exactly what the boundary rule exists to prevent it from being. — **Reversibility:** costly — moving a module between packages rewrites every import that reaches it, and the `boundaries` element-type patterns are keyed on the path.

- **D-02:** The boundary model is `eslint-plugin-boundaries` v5+ form: `boundaries/dependencies` with `default: "disallow"` and an explicit allow-list of edges, plus `boundaries/files` category policies. Element types are `kernel`, `platform`, `contract`, `identity`, `authz`, `registry`, `forms`, `links`, `decision`, `connectors`, `submissions`, `datarouter`, `adapters`, `pipeline`, `builder`, `entrypoint`. **Two amendments to the research table:** (i) `contract` is a first-class element type — `ARCHITECTURE.md` names the package and gives `adapters → contract` but omits `contract` from the edge table, which under `default: "disallow"` would make every contract import a lint error; (ii) the `domain` root is **not** an element type, only its 12 subdirectories are, so a new subdirectory is an explicit config change rather than silently inheriting a permissive parent. — **Reversibility:** costly — an edge baked into 100 files is a refactor, though an edge that turns out to be missing is a one-line config add.

- **D-03:** Adopt the three file-category rules, extended, **plus** the boot-time assertion:
  - **R1 entrypoint exclusivity** — only `apps/api/src/app.module.ts` may import `**/adapters/**/inbound/**` and `**/http/**`; only `apps/worker` may import `**/bullmq/workers/**` and `**/adapters/**/outbound/**`; only `apps/scheduler` may import `**/scheduler/**`. **Extended:** neither `apps/api` nor `apps/scheduler` may import BullMQ's `Worker` — without this, `api` can import a `Worker` and the 200 ms ack budget dies silently.
  - **R2 secret containment** — only `packages/platform/src/crypto/**` and `packages/domain/src/connectors/**` may import KMS primitives, `jose` signing helpers, or AES-256-GCM primitives. Makes "no plaintext secrets" a lint error rather than a review comment.
  - **R3 no direct Mongo outside data-access** — the `mongodb` driver may be imported only in `packages/platform/src/mongo/**` and `packages/domain/src/**/data-access/**`. Forces repositories, and is what stops transaction-scoped `session` threading from being skipped.
  - **Boot assertion** — each entrypoint declares its allowed provider set, and `main.ts` walks `ModuleRef` providers in `OnApplicationBootstrap`, failing fast if a provider from a forbidden module was instantiated. NestJS resolves providers lazily, so a dynamic `ModuleRef.get(..., { strict: false })` escape is invisible to static lint. Belt and braces, ~40 lines, and it converts a production-only failure into a startup crash. — **Reversibility:** reversible — lint config and one bootstrap hook.

- **D-04:** Phase 1 creates **only** the three server workspaces. `form-renderer` and `app-builder` are added as workspaces when they first ship. `package-lock.json` is a Phase 1 deliverable and a smaller one is easier to audit; the boundaries config is written to tolerate absent element types. — **Reversibility:** reversible.

### Build, install guard, and test harness

- **D-05:** `npm run build` depends on `npm run lint`, so a boundary violation fails a local build and CI identically. ESLint, not NestJS 12's oxlint scaffold — `eslint-plugin-boundaries` is ESLint-only. Not a git pre-commit hook: hooks are bypassable and absent in CI, and FND-04 says *fails the build*, not *warns on commit*. — **Reversibility:** reversible.

- **D-06:** The install guard is a **dedicated CI job**: delete `package-lock.json`, `npm install`, `npm run build`, `npm test`. The committed lockfile stays authoritative for every other job. The guard exists to prove that a *deliberate* install without a lockfile does not resolve TypeScript 7.0.2 and break the build — running it in CI means it cannot be forgotten locally, which is the whole point of FND-01/FND-02. — **Reversibility:** reversible.

- **D-07:** Vitest 5.0.2 (NestJS 12's ESM default; the framework team migrated its own repos off Jest) with `testcontainers` 12.2.0 for integration tests, against **three** containers: MongoDB 8.0.x, cache Redis, queue Redis. Three is a correctness requirement, not tidiness: `maxmemory-policy` is instance-wide, so a single Redis container cannot express the two-deployment split this phase commits to. One test asserts the two clients resolve to different instances and that the queue instance reports `noeviction` while the cache instance reports an evicting policy. — **Reversibility:** reversible.

- **D-08:** CI provider is **GitHub Actions**, as a stated default that can be swapped. It cannot be deferred past Phase 1 because D-05's build gate and D-06's install guard both live there. — **Reversibility:** reversible.

### Health & readiness topology across three processes

- **D-09:** All three entrypoints use `NestFactory.create()`; `worker` and `scheduler` mount **only** `HealthController` and `MetricsController`, on their own configurable ports (`api` 3000, `worker` 3001, `scheduler` 3002 — config, not hardcoded). **This deviates from `ARCHITECTURE.md`'s `createApplicationContext()` recommendation, deliberately.** FND-05 is a v1 requirement that each of the three processes expose both endpoints; "no HTTP on the worker" is a research preference, not a requirement. One bootstrap path across three processes is worth more than a marginally smaller attack surface, and R1 is what actually prevents surface creep. Consequences: `app.enableShutdownHooks()` is required on all three, or SIGTERM never fires `onModuleDestroy` and a rolling deploy kills in-flight submissions mid-transaction. — **Reversibility:** costly — the port and probe contract becomes an operational contract that manifests and runbooks reference.

- **D-10:** Readiness is **per-dependency**, not one aggregate check. All three: `Mongo` ping, `RedisCache` ping, `RedisQueue` ping. `worker` adds "every registered BullMQ `Worker` is listening". `scheduler` adds "at least one Job Scheduler registered and running". Separate Redis indicators are what make the two-deployment split diagnosable — a single "redis: down" tells an operator nothing about which deployment. **Liveness checks no dependency and returns 200 whenever the process is up**, so a Redis blip fails readiness without K8s restarting a healthy pod (FND-05, NFR-O-7). — **Reversibility:** reversible.

- **D-11:** Kubernetes manifests and probe wiring are **out of scope** for Phase 1 — no deployment manifests are in v1 scope. Recorded so the planner does not invent them. — **Reversibility:** reversible.

### Two-Redis topology

- **D-12:** Two separately-required configuration values — `REDIS_CACHE_URL` and `REDIS_QUEUE_URL` — bound to DI tokens `REDIS_CACHE` and `REDIS_QUEUE`. Never one URL with a logical-database suffix: `maxmemory-policy` is instance-wide, so logical DBs cannot express the split. The Zod config schema (FND-09) **requires both and requires them to resolve to different hosts** — same host in both is a boot failure, not a warning. That single check is what stops the split silently regressing into one instance six phases from now. — **Reversibility:** reversible.

- **D-13:** Keys are split by **durability class**. Cache instance (evicting policy): `ak:tok:*`, `ak:otp:*`, `ak:jwks`, `ak:rl:*`, `ak:cb:*`, and the epoch / `ak:pv` / `ak:ident` / `ak:rbac` / `ak:toolset` / `ak:jev` caches. Queue instance (`noeviction`, 3× memory headroom): BullMQ's own keys only. One-time **write** tokens sit deliberately on the evicting side — losing one only breaks a link the user can re-request, and a lost `GETDEL` is backstopped by the MongoDB `unique { link_jti: 1 }` index. The governing invariant, which later phases must not break: **no durable state in either Redis instance.** Everything that must not be lost lives in MongoDB, which is what makes AD-9's statelessness claim true rather than aspirational. — **Reversibility:** costly — merging the instances back means moving live queue state.

- **D-14:** BullMQ uses a hash-tag prefix `"{akane-q}"`, so all queue keys occupy one cluster slot. Accepted, with the runbook note that queue throughput therefore does not shard and that node is a documented throughput and memory ceiling — acceptable at NFR-S-2's 50 events/s, but a conscious choice, not an accident. **Never ioredis `keyPrefix`** alongside BullMQ; two prefixing layers silently corrupting each other is a genuinely nasty bug. `maxRetriesPerRequest` is `null` for the worker's blocking connection (BullMQ throws otherwise) and finite `1–3` for request-path producers on both profiles, so an HTTP handler fails fast instead of hanging when Redis is down. This is the one place where "share the Redis connection everywhere" is abandoned: two connection profiles, not one. Application cache keys on the cache profile hash freely — single-key `GET`/`GETDEL` needs no co-location. — **Reversibility:** one-way — the prefix determines where every live queue key lives in the cluster; changing it orphans in-flight job state.

### Log PII allowlist mechanism

- **D-15:** Two enforcement layers, both **before serialisation**. (1) A typed `LoggerPort` in `packages/platform/src/logging` whose methods accept only allowlisted field names, so an unlisted field is a TypeScript compile error. (2) A pino custom destination stream that parses each record against a per-level Zod object schema with unknown keys **stripped**, immediately before `JSON.stringify`. Layer 2 is the security control — it catches values arriving as computed keys (`obj[userInput]`) where the type system cannot help. pino `redact` paths are **not** used: that is a denylist, and a denylist regex always misses. — **Reversibility:** one-way — the mechanism is replaceable, but once production logs exist, the PII already in them cannot be recalled. The allowlist is what makes §15.4's narrowed erasure promise true.

- **D-16:** Closed allowlist, **no escape hatch**: `ts`, `level`, `msg`, `service`, `env`, `pid`, `trace_id`, `span_id`, `request_id`, `jti`, `app_id`, `form_id`, `action`, `status`, `duration_ms`, `error_code`, `provider`, `queue`, `attempt`, `count`, `reason`. No email, no name, no chat text, no submission body, and **no free-form `data`/`meta` object** — a free-form bag is a denylist with extra steps. Adding a field requires a written justification in the same commit; that friction is the control. `error_code` is a closed enum. Error `cause` chains are **dropped, not serialised**, because a cause can carry PII out of a downstream HTTP body. — **Reversibility:** one-way — same reason as D-15.

- **D-17:** The ruling ships with the test that proves it: emit an email at three levels — as a typed field, as a computed key, and inside a nested `cause` — and assert none reaches the serialised output. The conflict ruling is worthless without this test. — **Reversibility:** reversible.

### Trace-ID decoupling and OTel bootstrap

- **D-18:** `submission_id` is **never a span attribute** and **never** seeds a trace context. The OTel SDK generates a random W3C `trace_id`; nothing in the codebase may set it. Enforcement is a **frozen span-attribute allowlist**: a Phase 1 constant listing every permitted attribute name, plus a test asserting the exported attribute set is a subset of it, so adding `submission_id` fails CI. Hashing `submission_id` into the trace context is rejected — a hash of `submission_id` is still correlatable. — **Reversibility:** one-way — the trace backend already holds whatever attributes were exported, and it is the one store with no per-app RBAC and no erasure path.

- **D-19:** `submission_id` **may** appear in logs and in the MongoDB audit trail, both of which have defined purge windows (logs 30 d hot / 1 y cold per OBS-07; audit 3 y with a tombstoneable `actor_ref` per AUD-04). A log line carries `trace_id`, so an operator can go trace → logs; the reverse is not derivable. **That asymmetry is the erasure property conflict #2 ruled for.** The trace backend is precisely the store that must not accumulate a correlatable multi-year activity map. — **Reversibility:** costly — the logging and audit shapes are depended on by the compliance story.

- **D-20:** Full OTel bootstrap in Phase 1: `NodeSDK` initialised as the **first statement** of each `main.ts` via `require`/dynamic import, before `AppModule` is even imported — a static top-of-file import is the single most common way to lose end-to-end traces and it fails silently. Exporters: OTLP trace, OTLP metrics, and the Prometheus exporter. **One metrics path only** (OBS-01) — no `prom-client`, or there are two scrape endpoints, two naming conventions, and split alert rules. Business metric *registration* starts in Phase 1 even though the counters themselves land in later phases. — **Reversibility:** costly — the bootstrap ordering is load-bearing in every entrypoint and invisible when it breaks.

### Frozen contracts: read-link claims and JEV wire

- **D-21:** The frozen read-link claim set is:
  - *Registered* — `iss` (deployment id), `aud` (form-renderer origin), `sub` = `real_user_id`, `jti`, `iat`, `nbf`, `exp` (≤ 90 d).
  - *Domain* — `action`, `app_id`, `form_id`, `form_version`, `app_version`, `perm_version`, `target_id`, `query_version`.
  - The discriminant is named **`action`**, not `typ`: the JOSE header already owns `typ`, and reusing it for a domain discriminant in the payload is a collision that costs more later than it saves now. Values: `create | edit | view | query | notification | draft`.
  - `target_id` is the `submission_id` for `view` and for `edit`, the `query_id` for `query`, absent otherwise.
  - `query_version` is frozen **now** even though the read path is Phase 3: a saved query is versioned exactly the way a form is (FRM-02), so a Phase 3 query link is unrepresentable without it, and adding a claim later is the precise break this phase exists to prevent.
  - `perm_version` appears on **read links only**. A write link consumes on submit and receives a fresh permission check at the execution boundary (ACL-06's second check); embedding an issuance-time version in it would imply a guarantee it does not provide.
  - No PII, ever — opaque IDs only. Any claim not on this list is rejected by a `.strict()` schema, and a PII-shaped claim is a `400`.
  - **No version claim in the token.** The schema version is a code constant plus the published JSON Schema `$id`. Spending a claim on self-description, when a frozen test already governs the claim set, buys nothing. — **Reversibility:** one-way — adding or removing a claim invalidates every outstanding link on deploy. A 90-day link outlives most deploy cycles, so "we'll add it later" is not available.

- **D-22:** The draft-save token blocker is resolved by **deferring the state machine and reserving the shape**. `action: "draft"` is defined in the frozen enum and **must not be emitted in v1**. The Redis key namespace `ak:tok:draft:{jti}` is reserved. Token classes are modelled as a config table of `{ action, ttl, consume }`, so a future class is a config entry rather than a schema change. The draft state machine, the resumable-form store, and the second token lifetime are **not** built. This is the highest-value decision in the phase: research flagged it as a blocker on Phase 2's token model, and it is removed for the cost of one enum value and one table row. — **Reversibility:** reversible — removing an enum value nobody emits is trivial.

- **D-23:** The JEV wire contract lives in `packages/contract/src/jev/v1/` as `.strict()` Zod schemas, with `z.toJSONSchema()` output as the published artifact. Baseline is PRD §11.1/§11.2 verbatim with `spec_version: "1.0"` retained, plus **exactly two additions**:
  - `choice.verified: boolean | null` — `false` = confident and choosing; `null` = abstaining. Abstention is a *different signal* from low confidence, so the platform routes it to clarification **regardless of the confidence score**. Cross-field refinement: `verified === null` ⇒ `tool_id === null` **and** `clarification_needed === true`.
  - `state.force_clarification: boolean` — lets the **platform** force clarification for its own reasons (non-`en`/`vi` locale, input under N characters, tool set changed in the last hour), not only the provider.
  - `choice` becomes **required** in the response; abstention is expressed through the refinement rather than by omitting the object, so the conformance suite has one shape to test.
  - Published as a **first-party named interface** (`JevProvider`), not as a vendor wire protocol: "JEV" is a hosted vendor model with no industry standard, and the PRD's "OpenJev" reference implementations are unofficial reconstructions. `RuleBasedProvider` is named in the contract as the terminal fallback, so its absence is a startup assertion failure rather than a runtime surprise. — **Reversibility:** one-way — providers are built against this contract and the PRD's §17.3 conformance suite tests whatever contract exists when it runs. That is why it is frozen in foundations rather than in the routing phase.

- **D-24:** "Frozen" is mechanical, not a promise. For every frozen schema: a `.strict()` Zod object plus a test asserting the **exact sorted top-level key set** as a literal array, so adding a claim fails CI with a diff. The test names the version (`1.0`), making a deliberate breaking change a visible edit to a versioned constant rather than an accident. — **Reversibility:** reversible.

### Secrets envelope and KMS master key

- **D-25:** The envelope is versioned JSON: `{ v: 1, alg: "A256GCM", kid, iv, tag, ct }`, all base64url, stored beside the ciphertext in MongoDB. `kid` is present from v1 so rotation is additive — a secret encrypted under a retired key is **re-wrapped**, never re-encrypted from plaintext the system will not have. — **Reversibility:** costly — every stored secret depends on the envelope; changing it needs a re-wrap migration.

- **D-26:** Phase 1 ships a `KeyProvider` interface in `packages/platform/src/crypto` (the only place R2 permits touching KMS primitives), a `LocalKeyProvider` that reads a key file and **refuses to boot when `NODE_ENV=production`**, and the AES-256-GCM envelope implementation with a round-trip test asserting that neither the key nor the plaintext appears in any log record. — **Reversibility:** reversible.

- **D-27:** **Named blocker, not a guess.** FND-10 requires a KMS-backed master key and **no deployment cloud has been named**. Phase 1 therefore ships a startup assertion that `NODE_ENV=production` without `CRYPTO_KEY_PROVIDER=kms` fails boot, so production can never silently fall back to a local key. The concrete vendor adapter (AWS KMS / GCP KMS / Vault transit) is a Phase 1 task **blocked on naming the deployment target**, budgeted separately. The interface is the part that must not change later; a guessed vendor produces an adapter that is untested against a real KMS and has to be rewritten. — **Reversibility:** one-way — the interface shape is depended on by every stored secret from Phase 4 onward.

- **D-28:** Phase 1 stores **no** real secret. The first one is a connector credential in the integration phase. Phase 1 delivers the mechanism and the guard, not a secret store. — **Reversibility:** reversible.

### Discovery rulings carried out of Phase 1

- **D-29:** **Form.io `File` component licensing → out of v1, no Phase 1 work, no spike.** The licensing question gates only file upload, which is already v2 (`FRM-11`, with `FRM-13` object storage and `DAT-17` dependent on it). AD-3's open-source claim is preserved by *not shipping* the premium component — there is nothing to license. **This deviates from `ROADMAP.md` Phase 1's "Discovery required (a)";** the deviation is recorded here and in `STATE.md`. Precondition recorded for whenever `FRM-11` enters a phase: either a spike confirms `@formio/js` renders a `file` component unlicensed, or a Form.io Library Licence is purchased. Two unresolved sub-questions attach to that future phase and should travel with it: Form.io's server-generated PUT URL needs S3-class object storage plus a token endpoint the PRD never specifies, and uploads persist *regardless of submit* — a documented storage leak with no owner in the PRD. — **Reversibility:** reversible — it is a scope decision.

- **D-30:** **Spike S3 (SAML vs OIDC) → OIDC is the plan of record; SAML is not implemented in v1.** OIDC covers Entra ID, Okta, Auth0, Google Workspace, and Keycloak. S3 stops being a technical spike and becomes a **customer question with a deadline before Phase 5 planning** — `BLD-12` (App Builder OIDC SSO with MFA) is the first surface that needs it, and Phase 1 needs no SSO at all. If SAML is genuinely required: `@node-saml/node-saml` has been quiet since 2025-07-21, needs its own spike, and adds 2–3 weeks that are **not** in the ~43-week estimate. — **Reversibility:** reversible.

- **D-31:** **MongoDB 9.0 → defer.** 8.0.x is the committed pin and 9.0 was four days old at verification. Revisit once it has a track record, before the 3-year retention window makes a migration expensive. A milestone item, not a Phase 1 one. — **Reversibility:** reversible.

- **D-32:** **`eslint-plugin-boundaries` version conflict → re-verify, do not guess.** `PROJECT.md` records 7.2.0; `ARCHITECTURE.md` records 5.3.1. Both cannot be right and the rule *form* differs between them. The pin is resolved against `registry.npmjs.org` at install time and recorded; the rule form is `boundaries/dependencies` with `default: "disallow"` plus `boundaries/files` category policies, which is the modern form and stable across v5 → v7. A wrong pin here means silent under-enforcement of the phase's headline constraint, so this is a verification task with a recorded result, not a plan-time assumption. — **Reversibility:** reversible.

- **D-33:** **Two items confirmed out of Phase 1 scope.** Tool-selection accuracy at 100–800 candidates needs an `AI-SPEC.md` for the routing phase — it does not touch foundations. The "legitimate interest" legal framing for 3-year audit retention needs **counsel, not research**. Recorded so the planner does not open either here. — **Reversibility:** reversible.

### the agent's Discretion

`--auto` mode resolved every area to its recommended option without prompting. No user input was taken. Two areas deserve a human eye before planning, and are flagged here rather than buried:

- The **KMS vendor (see D-27)** is a genuine unknown, not a judgement call. The interface and the production guard are the right answer to an unnamed deployment target, but "blocked on naming the cloud" means Phase 1 cannot be fully closed until someone answers it.
- The **health topology (see D-09)** contradicts a research recommendation. `ARCHITECTURE.md` says `createApplicationContext()` for the worker and scheduler; this phase mounts HTTP on all three to satisfy FND-05 literally. The reasoning is recorded in D-09 so a reviewer can overturn it with one line — but overturning it means amending FND-05.

Everything else is a mechanism choice with a documented reason, and a reviewer disagreeing with any of them can edit CONTEXT.md directly before planning.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The authoritative spec and the frozen decisions

- `PRD.md` — the original 21-section spec. Read **§6.6** (link types and TTLs), **§6.7** (`perm_version` semantics), **§7.3** (AD-1…AD-12), **§9.3** (security NFRs), **§9.4** (observability NFRs), **§10.4** (submission model), **§10.6** (audit entry), **§11.1–§11.2** (the JEV wire contract and provider interface that D-23 freezes), **§11.4** (fallback chain), **§12.2** (view/query flow). ⚠️ **`PRD.md` §7.4 is superseded in full by `.planning/research/STACK.md`** — do not revert a pin from §7.4. ⚠️ The PRD's TOC lists §22–§25; those sections were never written.
- `.planning/PROJECT.md` — Core Value, Constraints, and the full Key Decisions table (AD-1…AD-12 plus ~30 audited amendments). This is where every ruling in D-15, D-18, D-21 and D-23 originates. **Note the two corrections recorded late in that table:** the TypeScript-pin enforcer is `typescript-eslint`, not `@nestjs/swagger`; and MongoDB 8.2 is already EOL.
- `.planning/REQUIREMENTS.md` — the 15 Phase 1 requirements (`FND-01`…`FND-10`, `LNK-07`, `RTE-10`, `AUD-10`, `DAT-13`, `OBS-01`) and, critically, the **Resolved Requirement Conflicts** table near the top. Also `LNK-03` (Mongo unique index as the anti-double-submit guarantee), `LNK-12` (90-day dual-key rotation), `AUD-04` (tombstoneable `actor_ref`), `OBS-07` (log retention), and the v2 lists that D-29 and D-22 depend on.
- `.planning/ROADMAP.md` — Phase 1's goal, the five success criteria this context is written against, the per-phase research flags, and the timing table. **Read the Phase 1 "Notes" and "Discovery required" lines alongside D-29, which supersedes discovery item (a).**

### Research — the evidence base for these decisions

- `.planning/research/ARCHITECTURE.md` — **lines 140–250**: the project structure, element types, allowed edges, rules R1–R3, the boot-assertion rationale, and the per-entrypoint load matrix that D-01/D-02/D-03/D-09 implement. **Lines 602–641**: the read-link verification sequence and the `perm_version` bump table behind D-21. **Lines 642–693**: the state/cache topology (Flow 4) and the BullMQ-against-Redis-Cluster constraint (Flow 5) behind D-12/D-13/D-14. **Lines 754–802**: the six anti-patterns, including "a single Redis instance with an evicting policy" and "letting the three entrypoints drift into the same process".
- `.planning/research/STACK.md` — the version ledger. Every pin in `package.json` comes from here. **Supersedes `PRD.md` §7.4 entirely.** Includes the seven corrections to the earlier analysis (ioredis 6, MongoDB 8.0.x not 8.2, `ua-parser-js` AGPL disqualification, `nestjs-zod` and community Redis throttler storages peer-broken on NestJS 12, `@nestjs/observe` rejected outright).
- `.planning/research/PITFALLS.md` — **lines 383–384, 401, 913**: the `choice.verified` tri-state and `state.force_clarification` additions that D-23 freezes, and their phase mapping. **Pitfalls 1, 15, 17**: the `GETDEL` durability trap, the compliance-vs-observability conflict, and the Pub/Sub invalidation trap.
- `.planning/research/SUMMARY.md` — the **Phase 0: Foundations** section (the roadmapper's primary input), the three ruled requirement conflicts, the cross-research disagreements that were resolved rather than averaged, the research flags, and spikes S1–S3 (S1 and S2 are out of v1 scope; S3 is ruled in D-30).
- `.planning/research/FEATURES.md` — the NG13 licensing entry behind D-29, and the DH-1…DH-4 sequencing hazards the phase order resolves.
- `.planning/STATE.md` — the blockers list. Three of its Phase 1 blockers are closed by D-22, D-29 and D-30; the KMS-vendor blocker is now D-27.
- `AGENTS.md` — the generated project guide (embeds the project, stack, and workflow sections). Useful as a single-file orientation, but `.planning/` is the source of truth.

### No SPEC.md

No `*-SPEC.md` exists for this phase, so nothing is locked beyond `ROADMAP.md` and `REQUIREMENTS.md`. The two discovery questions `ROADMAP.md` asked Phase 1 to resolve are answered in D-29 and D-30 rather than deferred.

</canonical_refs>

<code_context>
## Existing Code Insights

**This is a greenfield repository.** As of 2026-10-01 the working tree contains only `PRD.md`, `README.md`, `AGENTS.md`, and `.planning/`. There is no `src/`, no `package.json`, no CI configuration, and no `.planning/codebase/*.md` map. A scout pass over the phase-goal keywords (`entrypoint`, `boundary`, `health`, `redis`, `jwt`, `log`, `trace`, `kms`) found nothing to reuse.

### Reusable Assets

None. Phase 1 defines the patterns rather than inheriting them — which is the point of the phase, and the reason the boundary lint rule has to exist before the first module rather than after.

### Established Patterns

None yet. The four patterns every later phase depends on are established *here*:

- the `kernel → platform → domain → entrypoint` dependency direction
- the typed `LoggerPort` + allowlist-stripping destination stream
- the OSDK-first-statement bootstrap in each `main.ts`
- `.strict()` Zod contracts with exact-key-set frozen tests

### Integration Points

The seams later phases connect to, all created in this phase:

- `packages/kernel` — shared Zod schemas. Zero I/O, zero dependencies. If it needs a library, the type belongs somewhere else.
- `packages/platform` — the two Redis profiles, Mongo access, the queue, crypto, OTel, logging, and Zod-validated config. Every domain module depends on this and nothing else infrastructural.
- `packages/contract` — `JevProvider`, the connector interface, `InboundEvent`/`OutboundMessage`, and the frozen JEV v1 wire schemas.
- `packages/domain` — 12 module directories created empty in Phase 1, filled from Phase 2 onward.
- `apps/{api,worker,scheduler}` — three composition roots with the load matrix already fixed by R1.

</code_context>

<specifics>
## Specific Ideas

- **The JEV contract is a first-party invention, not a vendor integration.** "JEV" is a hosted vendor model and the PRD's "OpenJev" reference implementations are unofficial reconstructions. The seam is published as a named first-party interface so no downstream agent treats a nonexistent standard as a dependency.
- **Epoch-keyed cache keys, not Pub/Sub, are the correctness mechanism.** `perm_version` is embedded in the RBAC cache key (`ak:rbac:{app_id}:{real_user_id}:{perm_version}`), so a stale entry is unreachable by construction. Pub/Sub becomes a latency optimisation only — it is at-most-once, so a dropped message must not be able to serve a stale permission. Phase 1 owns the key shape, not the RBAC logic.
- **`GETDEL` is the fast path; a MongoDB unique index is the guarantee.** Redis replication is asynchronous, so an acknowledged write can be lost on failover and a consumed one-time link can return to life. `LNK-03` makes the guarantee structural.
- **The `{akane-q}` hash tag is a conscious cost**, accepted in Phase 1 and documented in the runbook rather than discovered later.
- **No cookies on the form-renderer origin** — the structural CSRF defence. Recorded here because it constrains the renderer's deployment from day one, even though the renderer ships in Phase 2.

</specifics>

<deferred>
## Deferred Ideas

Nothing was raised in Phase 1 discussion that belongs to another phase as a *new* capability — the discussion stayed inside the foundations boundary. The following were considered and explicitly routed elsewhere, and are recorded so they are not re-opened:

- **File upload (`FRM-11`), object storage (`FRM-13`), save-and-continue (`DAT-17`)** — v2, with the licensing precondition in D-29.
- **Draft save & resume state machine (`FRM-12`)** — v2. Only the reserved `action: "draft"` enum value and the `ak:tok:draft:{jti}` namespace land in Phase 1 (D-22).
- **KMS vendor adapter** — blocked on naming the deployment cloud (D-27). Phase 1 ships the interface and the production guard.
- **SAML support** — a customer question, not a planning question, with a deadline before Phase 5 planning (D-30).
- **MongoDB 9.0 re-evaluation** — a milestone item (D-31).
- **Kubernetes manifests and probe wiring** — not in v1 scope (D-11).
- **Decision-model provider, host, and cost profile** — needs `AI-SPEC.md` in the routing phase (D-33).
- **"Legitimate interest" legal framing for 3-year audit retention** — needs counsel (D-33).

</deferred>

---

*Phase: 1-Foundations & Platform*
*Context gathered: 2026-10-01*
