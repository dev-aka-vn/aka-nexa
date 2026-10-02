---
phase: 1
phase_name: Foundations & Platform
researched: 2026-10-02
domain: scaffold / monorepo boundary enforcement / boot contracts
confidence: HIGH
inputs_authoritative: [01-CONTEXT.md (D-01…D-33, locked), AGENTS.md ## Project + ## Technology Stack (embeds STACK.md, supersedes PRD §7.4), REQUIREMENTS.md (FND-01…FND-10, LNK-07, RTE-10, AUD-10, DAT-13, OBS-01)]
inputs_treated_as_verified: .planning/research/STACK.md §14 ledger, §4.1–§10.2, §12, §14.1 EOL timeline
method: greenfield — external registry + npm-tarball verification only; no in-repo patterns exist
---

<user_constraints>
## User Constraints (from CONTEXT.md, D-01…D-33 — LOCKED)

The planner holds `01-CONTEXT.md`; this is a digest of what the research *touched*, not a substitute. Nothing here was re-litigated. Three entries are **refined** by registry evidence, marked ⚠ (never overturned): D-15 → B-1, D-32 → P1.0, D-03 → P1.6.

**Locked and load-bearing for Phase 1:** D-01 four packages + three apps · D-02 element types + `default: "disallow"` · D-03 R1/R2/R3 + boot assertion · D-04 three server workspaces only · D-05 `build` depends on `lint` · D-06 dedicated deleted-lockfile CI job · D-07 Vitest 5 + three containers · D-08 GitHub Actions · D-09 `NestFactory.create()` on all three + `enableShutdownHooks()` · D-10 per-dependency readiness · D-11 K8s out of scope · D-12 two required Redis URLs, distinct hosts = boot failure · D-13 durability-class key split · D-14 `{akane-q}` prefix, no ioredis `keyPrefix` · ⚠D-15 `LoggerPort` + pre-serialise strip (**mechanism — see B-1**) · D-16 closed allowlist, `cause` dropped · D-17 the three-level PII test · D-18 frozen span-attribute allowlist · D-19 trace↔log asymmetry · D-20 OTel bootstrap + one metrics path · D-21 frozen read-link claims · D-22 `action: "draft"` reserved and never emitted · D-23 JEV v1 frozen + two additions · D-24 mechanical frozen-key-set tests · D-25 `{v,alg,kid,iv,tag,ct}` envelope · D-26 `KeyProvider` + `LocalKeyProvider` + prod guard · D-27 **KMS vendor NAMED BLOCKER** · D-28 no real secret in Phase 1 · D-29 Form.io File out · D-30 SAML = customer question · D-31 MongoDB 9.0 deferred · ⚠D-32 re-verify the boundaries pin (**resolved — 7.2.0**) · D-33 out of scope.

**Discretion / human eye before planning:** D-27 (KMS vendor — genuine unknown); D-09 (health topology deliberately contradicts `ARCHITECTURE.md`'s `createApplicationContext()` — overturning it means amending FND-05). **Deferred, out of scope:** `FRM-11`/`FRM-13`/`DAT-17`, `FRM-12`, KMS adapter, SAML, MongoDB 9.0, K8s manifests, decision-model AI-SPEC, "legitimate interest" legal framing.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Requirement (abridged) | Research support |
|----|------------------------|------------------|
| FND-01 | Clean checkout builds with `npm ci`; Node 24 / NestJS 12 / TS 6.0.3 | P1.0 ledger; B-5 (Node 24.15.0, npm 11.12.1 present) |
| FND-02 | `package-lock.json` in first commit; `.nvmrc` pins Node major | P3 GitHub Actions; C1 |
| FND-03 | Three independently runnable entrypoints that never drift | P1.6 boot guard; P3 OTel loader; B-4 open question (ESM) |
| FND-04 | Lint rule fails the build on a boundary violation | **P1.0–P1.5** — the full config |
| FND-05 | `/health/live` + `/health/ready` on all three; readiness = Mongo + both Redis | P2.3 (`getJobScheduler` probe), **P2.4** (distinct-instance check) |
| FND-06 | JSON logs exclude PII by allowlist **before serialisation** | **P2.1** — `formatters.log`; D-17 test map |
| FND-07 | Trace ID independent of `submission_id`, not correlatable | P3 (wrapping `SpanExporter`) |
| FND-08 | Scheduled work on BullMQ Job Schedulers, registered once per replica | **P2.3** — `upsertJobScheduler` |
| FND-09 | Zod boot validation; invalid value fails startup with a **named** error | P3 (`validate:` + throw named code) |
| FND-10 | AES-256-GCM under a KMS master key; no plaintext secrets | P3 (verified ALGORITHM) + **B-3** (KMS vendor blocker) |
| LNK-07 | Read-link claim shape frozen in foundations | **P2.6** — every D-21 claim expressible |
| RTE-10 | Decision wire frozen incl. `choice.verified` + `state.force_clarification` | P2.5 + Validation Architecture row (D-24) |
| AUD-10 | Rate-limit per **user** and per link `jti`, never per IP; block only on signature failure | **Phase 1 = record the ruling as code** (token-class config table + frozen constant); enforcement is Phase 8 per REQUIREMENTS.md's conflict table |
| DAT-13 | Single-*send* guarantee amended; connectors declare `supports_idempotency_key`, surfaced at publish | **Phase 1 = record the ruling** (`Connector` interface field in `packages/contract`); enforcement is Phase 5 |
| OBS-01 | One metric path — OTel metrics API + Prometheus exporter | D-20 (locked); P3 OTel bootstrap |

**⚠ Phase-1 scope note for AUD-10 and DAT-13.** Both are tagged `Phase 1` in REQUIREMENTS.md and both are **rulings whose enforcement lands later** (AUD-10 with `AUD-04`/`AUD-08` in Phase 8; DAT-13 with `CON-01`/`CON-09` in Phase 5). The phase goal is that "all three requirement-conflict rulings exist in code before a single feature is written" — so Phase 1's deliverable for these two is the **frozen constant / interface field that makes the losing side unrepresentable** (e.g. the rate-limit key-shape constant naming `jti` and `user`, and `Connector.supports_idempotency_key` in `packages/contract`), not a rate limiter or a connector. Do not let the planner build the throttler here.
</phase_requirements>

## Project Constraints (from AGENTS.md)

Directives carry the same authority as locked decisions. Research does not contradict these.

| # | Directive | Source block |
|---|-----------|--------------|
| C1 | Node.js **24 LTS**; `.nvmrc` contains `24`; pinned in `.nvmrc` + Dockerfile + CI matrix, all three | Project·Constraints |
| C2 | NestJS **12**, TypeScript **hard-pinned 6.0.3**, `package-lock.json` committed in the first commit | Project·Constraints |
| C3 | HTTP adapter **Express, not Fastify** (Bolt 5 bundles `express@^5`; OTel bundles `instrumentation-express` not `-fastify`) | Project·Constraints |
| C4 | MongoDB **8.0.x** with the **native `mongodb` driver, not Mongoose** (app-builder schemas are runtime-defined) | Project·Constraints |
| C5 | Redis **≥8.2 floor**, **ioredis 6**; never pin 8.0.x (EOL 2026-12-01); never ioredis 5.x (recursion advisory) | Project·Constraints |
| C6 | **Modular monolith** — three process entrypoints (`api`/`worker`/`scheduler`), one DI graph, **a lint rule that fails the build on a boundary violation** | Project·Constraints |
| C7 | Webhooks ack **<200 ms and enqueue**; all logic in the consumer | Project·Constraints |
| C8 | App services stateless, all session state in Redis, no sticky sessions (AD-9) | Project·Constraints |
| C9 | Secrets **KMS-backed, AES-256-GCM**; no secrets in code, config files, or plaintext env vars | Project·Constraints |
| C10 | **PII never in JWTs** — opaque IDs only (`real_user_id`, `app_id`, `jti`) | Project·Constraints |
| C11 | Rate limits: per-user 10/min, per-app 100/min, per-connector per config (NFR-SEC-6) | Project·Constraints |
| C12 | 99.9% uptime, RPO ≤1 h, RTO ≤4 h, **zero-downtime rolling deploys** | Project·Constraints |
| C13 | Data residency configurable + region-locked per deployment | Project·Constraints |
| C14 | **3-year minimum audit retention**; GDPR erasure requires a **field allowlist applied before log serialisation** | Project·Constraints |
| C15 | Dependency scanning in CI; **critical vulns block deploy** (NFR-SEC-12) | Project·Constraints |
| C16 | Admin surfaces authenticate via OIDC/SAML SSO with MFA; service-to-service mTLS or internal tokens | Project·Constraints |
| C17 | **GSD workflow enforcement** — no direct repo edits outside a GSD command | AGENTS.md |

**Not re-litigated here:** every D-01…D-33 in `01-CONTEXT.md`. Two CONTEXT decisions are *refined* (not overturned) by registry evidence — flagged in "Blockers & Open Items" B-1 and B-2.

## Package Legitimacy Audit

Run via `gsd-tools query package-legitimacy check --ecosystem npm`.

| Package | Registry | Age signal | Downloads/wk | Source repo | Verdict | Disposition |
|---------|----------|-----------|--------------|-------------|---------|-------------|
| `eslint-plugin-boundaries` | npm | published 2026-08-09 | 2,097,261 | github.com/javierbrea/eslint-plugin-boundaries | **OK** | Approved |
| `pino` | npm | — | 61,081,395 | — | **OK** | Approved |
| `typescript` | npm | — | 348,005,389 | — | **OK** | Approved |
| `bullmq`, `jose`, `vitest`, `eslint`, `typescript-eslint`, `@nestjs/core`, `@nestjs/config`, `zod` | npm | resolved version published recently | 10.6 M–365 M | first-party repos where declared | **SUS** (`too-new`) | Flagged — see note |

**SLOP verdicts:** none.

**⚠ Heuristic caveat (read this before adding 9 checkpoints).** `too-new` fires on the *publish date of the resolved version*, not on package age — it fired for `zod` (365 M dl/wk) and `eslint` (190 M dl/wk). Every flagged package also shows `exists: true`, `deprecated: false`, `postinstall: null`, and a first-party repo. Every pin above is already carried in **STACK.md §14**, the project's authoritative ledger, which verified each against `registry.npmjs.org` on 2026-10-01 and which AGENTS.md declares authoritative (`supersedes PRD §7.4`). **Recommendation:** treat STACK.md §14 as satisfying the human-verify intent for the *version pins*, and reserve `checkpoint:human-verify` for any package the planner adds that is *not* in §14.

## P1 — Boundary enforcement: `eslint-plugin-boundaries@7.2.0` (D-02, D-03, D-04, FND-04)

### P1.0 D-32 is RESOLVED — 7.2.0 is real, current, and the correct pin

| Fact | Value | Evidence |
|------|-------|----------|
| `latest` | **`7.2.0`** | `[VERIFIED: npm view eslint-plugin-boundaries version]` → `version = '7.2.0'` |
| Published | `time.modified = '2026-08-09T18:46:08.766Z'` | same command |
| License | `MIT` | same command |
| `engines` / `peerDependencies` | `{ node: '>=18.18' }` / `{ eslint: '>=6.0.0' }` | `[VERIFIED: npm view eslint-plugin-boundaries engines]` + same command |
| Version list contains both **5.3.1** and **7.2.0** | — | `npm view … versions` ends `…"5.3.1","5.4.0","6.0.0",…,"7.1.0","7.2.0"` |

**Ruling:** `PROJECT.md`'s **7.2.0 is correct**; `ARCHITECTURE.md`'s `5.3.1` is stale. Pin **7.2.0**. No blocker.

### P1.1 Rule form — the v7 config has TWO structural differences from ARCHITECTURE.md's v5 description

`[VERIFIED: eslint-plugin-boundaries@7.2.0 npm tarball, `package/README.md` and `package/dist/Shared/Settings.types.d.ts`]`

1. **`boundaries/files` is a SETTING, not a rule.** In v7 the only rules are:
   `boundaries/dependencies`, `boundaries/entry-point`, `boundaries/external`, `boundaries/no-ignored-dependencies`, `boundaries/no-private`, `boundaries/no-unknown-files`, `boundaries/no-unknown-dependencies`.
   File categories live under `settings["boundaries/files"]: [{ category, pattern }]`. There is **no `Rules/Files.js` in the tarball**.
   D-32's wording "`boundaries/dependencies` … plus `boundaries/files` category policies" is *directionally right, mechanically wrong* — categories are settings, consumed by `boundaries/dependencies` policies via `to: { file: { categories: … } }`.
2. **`checkAllOrigins` defaults to `false`** — "Whether to check dependencies from all origins (including external and core) or only from local elements (default: `false`, only local)." Load-bearing: R2 (`jose`) and R3 (`mongodb`) select **external** modules as their *target*, which the default supports; only a policy whose **source** is external needs `checkAllOrigins: true`. R2/R3 sources are local elements → **do not set it**; setting it would widen the rule.

### P1.2 Selector grammar (verbatim, all from the 7.2.0 tarball)

| Selector key | Sub-keys | Verbatim source |
|--------------|----------|-----------------|
| `element` | `type`, `types` (`{ anyOf\|allOf\|noneOf\|equalsTo\|atIndex\|hasLength }`), `category`, `path`, `fileInternalPath`, `filePath`, `parent`, `parents` | `@boundaries/elements@3.1.1 index.d.ts` `ElementSingleSelector`; `ARRAY_QUERY_KEYS = readonly ["anyOf","allOf","noneOf","equalsTo","atIndex","hasLength"]` |
| `file` | `categories`, `path` | `FileSingleSelector = BaseSingleSelector & { categories?: MicromatchPatternNullable \| StringArrayQuery }` |
| `module` | `source`, `origin`, `internalPath` | `ModuleSingleSelector = { source?; origin?; internalPath? }` |
| origins | `local` \| `external` \| `core` | `ORIGINS_MAP` |
| negation | `type: "!controller"` | README quick example, verbatim `{ from: { element: { type: "!controller" } }, disallow: { to: { module: { origin: "external", source: "axios" } } } }` |

**Two constraints the planner must design around:**

- **`module` selectors match the module SPECIFIER, not a named binding.** `ModuleSingleSelector` has only `source`/`origin`/`internalPath`. `import { Worker } from 'bullmq'` is indistinguishable from `import { Queue } from 'bullmq'` at this layer. → **R1's `Worker` extension is NOT expressible in `eslint-plugin-boundaries`.** Use ESLint core `no-restricted-imports` with `importNames` (P1.4).
- **`ElementDescriptor.partialMatch` defaults to `true`** — "the pattern is matched using right-to-left incremental segment accumulation, so it only needs to match the end of the path". A pattern like `src/mongo/**` therefore also matches `apps/api/src/mongo/**`. Set `partialMatch: false` on every element descriptor for a monorepo, or accept suffix matching knowingly. **Recommend `partialMatch: false`.**

### P1.3 The three file categories D-03 needs (settings block)

```js
// tooling/boundaries.config.mjs   [pattern shapes VERIFIED: README quick example + FileDescriptor]
export const boundariesSettings = {
  "boundaries/elements": [
    { type: "kernel",    pattern: "packages/kernel/src/**",    partialMatch: false },
    { type: "platform",  pattern: "packages/platform/src/**",  partialMatch: false },
    { type: "contract",  pattern: "packages/contract/src/**",  partialMatch: false },
    // one type per domain subdirectory (D-02: the domain ROOT is not an element type)
    { type: "identity",    pattern: "packages/domain/src/identity/**",    partialMatch: false },
    { type: "authz",       pattern: "packages/domain/src/authz/**",       partialMatch: false },
    { type: "registry",    pattern: "packages/domain/src/registry/**",    partialMatch: false },
    { type: "forms",       pattern: "packages/domain/src/forms/**",       partialMatch: false },
    { type: "links",       pattern: "packages/domain/src/links/**",       partialMatch: false },
    { type: "decision",    pattern: "packages/domain/src/decision/**",    partialMatch: false },
    { type: "connectors",  pattern: "packages/domain/src/connectors/**",  partialMatch: false },
    { type: "submissions", pattern: "packages/domain/src/submissions/**", partialMatch: false },
    { type: "datarouter",  pattern: "packages/domain/src/datarouter/**",  partialMatch: false },
    { type: "adapters",    pattern: "packages/domain/src/adapters/**",    partialMatch: false },
    { type: "pipeline",    pattern: "packages/domain/src/pipeline/**",    partialMatch: false },
    { type: "builder",     pattern: "packages/domain/src/builder/**",     partialMatch: false },
    { type: "audit",       pattern: "packages/domain/src/audit/**",       partialMatch: false },
    // three separate app types — required for R1's per-app negation (D-02 names one "entrypoint")
    { type: "app-api",       pattern: "apps/api/src/**",       partialMatch: false },
    { type: "app-worker",    pattern: "apps/worker/src/**",    partialMatch: false },
    { type: "app-scheduler", pattern: "apps/scheduler/src/**", partialMatch: false },
  ],
  "boundaries/files": [
    { category: "inbound-adapter",  pattern: "packages/domain/src/adapters/**/inbound/**" },
    { category: "outbound-adapter", pattern: "packages/domain/src/adapters/**/outbound/**" },
    { category: "http",            pattern: "packages/**/http/**" },
    { category: "bullmq-worker",   pattern: "packages/**/bullmq/workers/**" },
    { category: "scheduler-job",   pattern: "packages/**/scheduler/**" },
    { category: "crypto-owner",    pattern: "packages/platform/src/crypto/**" },
    { category: "connector-owner", pattern: "packages/domain/src/connectors/**" },
    { category: "mongo-owner",     pattern: "packages/platform/src/mongo/**" },
    { category: "data-access",     pattern: "packages/domain/src/**/data-access/**" },
  ],
};
```

**Deviation flagged (D-02 refinement, not overturn):** D-02 lists a single `entrypoint` element type. R1 needs `api` ≠ `worker` ≠ `scheduler` in a `from:` selector. Two verified options — (a) three app types as above (uses the README's `type: "!controller"` negation form directly), or (b) one `entrypoint` type plus `from: { element: { type: "entrypoint", path: "apps/api/**" } }` (`path` is a real `ElementSingleSelector` key). **(a) recommended** — it needs no `path`+`type` conjunction semantics to be proven. Either is a ~4-line config edit; flag for the planner, do not re-open D-02's domain-type list.

### P1.4 The `boundaries/dependencies` rule — R1, R2, R3

Rule-options shape is verbatim: `{ default?: RuleEffect; message?: string; policies?: DependenciesPolicy[]; checkAllOrigins?: boolean; checkUnknownLocals?: boolean; checkInternals?: boolean }`. Policy shape is verbatim: `{ dependency?, from?, to?, allow?, disallow?, importKind?, message? }`.

```js
// tooling/boundaries.config.mjs  (rule body; policy keys VERIFIED: DependenciesRuleOptions + DependenciesPolicy)
export const boundariesDependenciesRule = ["error", {
  default: "disallow",
  policies: [
    // ---- element-type edges (D-02). Default-deny means only these exist. ----
    { from: { element: { type: "platform" } },
      allow: { to: { element: { types: { anyOf: ["kernel"] } } } } },
    { from: { element: { type: "contract" } },
      allow: { to: { element: { types: { anyOf: ["kernel"] } } } } },
    { from: { element: { type: "entrypoint" } },   // placeholder — replace with app-api/app-worker/app-scheduler
      allow: { to: { element: { types: { anyOf: ["kernel", "platform", "contract", "identity", "authz",
        "registry", "forms", "links", "decision", "connectors", "submissions", "datarouter",
        "adapters", "pipeline", "builder", "audit"] } } } } },
    // … remaining edges copied verbatim from ARCHITECTURE.md's allowed-edges table (D-02) …

    // Everything except an entrypoint/composition root may NOT import an entrypoint (roots are leaves)
    { from: { element: { type: "!(app-api|app-worker|app-scheduler)" } },
      disallow: { to: { element: { types: { anyOf: ["app-api", "app-worker", "app-scheduler"] } } } } },

    // ---- R1: entrypoint exclusivity (file categories) ----
    { from: { element: { type: "!(app-api)" } },
      disallow: { to: { file: { categories: { anyOf: ["inbound-adapter", "http"] } } } } },
    { from: { element: { type: "!(app-worker)" } },
      disallow: { to: { file: { categories: { anyOf: ["outbound-adapter", "bullmq-worker"] } } } } },
    { from: { element: { type: "!(app-scheduler)" } },
      disallow: { to: { file: { categories: "scheduler-job" } } } },

    // ---- R2: secret containment (external module targets) ----
    { from: { file: { categories: { noneOf: ["crypto-owner", "connector-owner"] } } },
      disallow: { to: { module: { origin: "external", source: "jose" } } } },
    { from: { file: { categories: { noneOf: ["crypto-owner", "connector-owner"] } } },
      disallow: { to: { module: { origin: "external", source: "@aws-sdk/client-kms" } } } },
    { from: { file: { categories: { noneOf: ["crypto-owner", "connector-owner"] } } },
      disallow: { to: { module: { origin: "external", source: "@google-cloud/kms" } } } },

    // ---- R3: no direct Mongo outside the data-access layer ----
    { from: { file: { categories: { noneOf: ["mongo-owner", "data-access"] } } },
      disallow: { to: { module: { origin: "external", source: "mongodb" } } } },
  ],
}];
```

**Verified mechanics used above:** negation `type: "!(app-api)"` and `categories` array-query `{ anyOf: […] }` / `{ noneOf: […] }` — `ARRAY_QUERY_KEYS = readonly ["anyOf","allOf","noneOf","equalsTo","atIndex","hasLength"]`; `categories?: MicromatchPatternNullable | StringArrayQuery`. **Day-1 smoke test required:** assert one real violation per category fires (a `!(…)` string and a `{ noneOf: […] }` object are the two syntaxes the README does *not* demonstrate together). Fallback if `{ noneOf }` misbehaves: two `from: { file: { categories: "X" } }, allow: { to: … }` policies plus the `default: "disallow"`.

### P1.5 R1's `Worker` extension — ESLint core, not boundaries

`boundaries` module selectors cannot see named bindings (P1.2). Use `no-restricted-imports`, scoped by `files`:

```js
// apps/api + apps/scheduler only
{
  files: ["apps/api/src/**/*.ts", "apps/scheduler/src/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      paths: [{
        name: "bullmq",
        importNames: ["Worker"],
        message: "R1: BullMQ Worker may only be constructed in apps/worker — a Worker in the request path breaks the <200 ms ack budget.",
      }],
    }],
  },
}
```

This is the enforcement FND-04/D-03 asked for and the only precise mechanism available. `[VERIFIED: rule-name set and ModuleSingleSelector sub-keys from the 7.2.0 tarball — no named-binding selector exists]`

### P1.6 D-03's boot-time `ModuleRef` assertion — runtime, and NOT via `ModuleRef.get()`

**It is a runtime assertion, not a lint rule.** D-03 already says "belt and braces": lint is the static control (P1.4/P1.5); the assertion is the runtime control.

**D-03's phrasing "`main.ts` walks `ModuleRef` providers" is not implementable as written.** Verified against `@nestjs/core@12.1.2`:

| API | What it actually does | Evidence |
|-----|----------------------|----------|
| `ModuleRef.introspect(token)` | returns **`{ scope }` only** — not instantiation state | `[VERIFIED: @nestjs/core@12.1.2 injector/module-ref.js:29-39 — `return { scope };`]` |
| `ModuleRef.get(token, { strict: false })` | resolves *or instantiates on demand* — probing with it creates the provider it is checking for | `[VERIFIED: @nestjs/core@12.1.2 injector/module-ref.d.ts — overload carries `options?: { strict?: boolean; each?: undefined \| false }`]` |
| `NestContainer.getModules(): ModulesContainer` → `Module.providers` | `ModulesContainer extends Map<string, Module>`; `get providers(): Map<InjectionToken, InstanceWrapper<Injectable>>` | `[VERIFIED: @nestjs/core@12.1.2 injector/container.d.ts:43, modules-container.d.ts:3, module.d.ts:30]` |
| `InstanceWrapper.isResolved` | `isResolved?: boolean` — the flag to read | `[VERIFIED: @nestjs/core@12.1.2 injector/instance-wrapper.d.ts:25]` |

**Recommended mechanism (and its cost):**

```ts
// apps/<app>/src/bootstrap/provider-boundary.guard.ts — one file, ~40 lines
// Runs in OnApplicationBootstrap (after all providers are instantiated).
// 1. Each guarded domain/platform module exports a `BoundaryManifest` const:
//    { allowedTokens: InjectionToken[], forbiddenTokens: InjectionToken[] }
// 2. The guard reads `(app as any).container.getModules()` (no public API exists),
//    walks Module.providers, and fails boot if any InstanceWrapper.isResolved === true
//    for a forbidden token. Throw a named error → boot aborts.
```

Two caveats the planner must record: **(1)** it reaches into `app.container` — **undocumented internals**; isolate it in one file behind a small `ProviderBoundaryGuard` interface so a Nest minor bump is a one-file fix (the *only* place in Phase 1 that touches Nest internals). **(2)** A zero-internals alternative exists: a Vitest build-output import-graph test asserting the forbidden module specifiers are absent from each app's `require`/`import` closure — same conversion of the "dynamic escape" risk into a CI failure, at the cost of not catching runtime-only `require()` inside a function body. D-03 chose internals + ~40 lines; both satisfy FND-04. **Flag for the planner; do not re-open D-03 without a reason.**

## P2 — High-value seams

### P2.1 pino drop-before-serialise (D-15, D-16, D-17) — **D-15's stated mechanism is not implementable; use `formatters.log`**

**Finding, and it is compliance-material.** D-15 says the layer-2 control is "a pino custom destination stream that parses each record against a per-level Zod object schema with unknown keys **stripped**, immediately before `JSON.stringify`." A pino destination is downstream of serialisation — by the time bytes reach a stream, `JSON.stringify` has already run. Verified, verbatim:

- `hooks.streamWrite?: (s: string) => string` — "Allows for manipulating the **stringified JSON** log output just before writing to various transports." Too late.
- `formatters.log?: (object: Record<string, unknown>) => Record<string, unknown>` — "Changes the shape of the log object. This function will be called every time one of the log methods (such as `.info`) is called. All arguments passed to the log method, except the message, will be pass to this function."
  `[VERIFIED: pino@10.3.1 `pino.d.ts` lines 674–681 (`hooks`), 715–719 (`formatters`); `docs/api.md` lines 438–451]`

**Correct mechanism:** `formatters.log` is the drop-before-serialise hook. It receives the merged log object and **its return value is what gets serialised**:

```ts
// packages/platform/src/logging/log-allowlist.formatter.ts
const ALLOWLIST = new Set(["ts","level","msg","service","env","pid","trace_id","span_id","request_id","jti",
  "app_id","form_id","action","status","duration_ms","error_code","provider","queue","attempt","count","reason"]);
export const log = (object: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(object)) if (ALLOWLIST.has(k)) out[k] = object[k];
  if (object.err) out.error_code = toErrorCode(object.err);   // err REPLACED, never passed through
  return out;                                                 // ← what JSON.stringify sees
};
```

- **Nested `err.cause` chains:** the mechanism is the same one — `err`/`cause` are simply **not on the allowlist**, so they never survive the rebuild. Do not rely on a serializer to prune them; *rebuilding the object from the allowlist* is structurally immune to `cause` depth. `[VERIFIED: allowlist keys are D-16's verbatim list; the rebuild is the mechanism pino's own `formatters.log` contract enables]`
- **`pino.multistream` and a custom `Writable` destination are both wrong for layer 2** — both operate post-serialisation. `multistream` is fine only for fan-out by level (hot/cold sinks, OBS-07).
- **⚠ Not verified this session:** whether pino 10's default `err` serializer (`pino.stdSerializers.err`) walks `Error.cause`. I found no `cause` handling in pino's own `lib/`; `pino-std-serializers` was not opened. **The allowlist-rebuild makes the answer moot, and D-17's three-level test must assert it empirically anyway.** Treat this as a test to write, not a fact to assume.
- **`redact` is correctly rejected by D-15** — it is path-based and denylist-shaped.

### P2.2 Vitest 5 + `@nestjs/testing@12.1.2` — override shape

- Vitest pin: **`5.0.3`** `[VERIFIED: npm view vitest version]`. `[ASSUMED]` that `nest new` v12 scaffolds Vitest — I did not run the CLI this session (STACK.md claims it; treat as inherited). NestJS 12's own packages ship `vitest.config.mts` — **verified**: `@nestjs/config@12.0.1`'s tarball contains `vitest.config.mts` alongside `dist/` `[VERIFIED: @nestjs/config@12.0.1 npm tarball listing]`. That is strong corroboration that the framework tests with Vitest, not proof about the scaffold.
- `@nestjs/testing@12.1.2` pins to the same family as `@nestjs/core@12.1.2` (STACK.md §14 / C1); the provider-override shape (`Test.createTestingModule().overrideProvider(TOKEN).useValue(...)`) is the classic API, **not re-verified this session** (unchanged across Nest 10→12). `[ASSUMED — low risk]`
- **Integration tests use `testcontainers`, not `@nestjs/testing` mocks** (D-07), because `GETDEL` atomicity (NFR-SEC-1) and BullMQ retry/DLQ semantics are the two highest-risk behaviours and both are Redis-semantics-dependent.

### P2.3 BullMQ 6 Job Schedulers (FND-08) — `upsertJobScheduler`, and `resume()` is async

```ts
// Queue method, verbatim signature
upsertJobScheduler(jobSchedulerId: NameType, repeatOpts: Omit<RepeatOptions, "key">,
  jobTemplate?: { name?: NameType; data?: DataType; opts?: JobSchedulerTemplateOptions }): Promise<Job<…>>;
```
`[VERIFIED: bullmq@6.3.11 `dist/esm/classes/queue.d.ts:205`]`

- **`upsert` is the whole answer to FND-08.** One idempotent call per boot on every replica converges on a single registered scheduler — no leader election, no "am I the scheduler pod" flag. `repeat: { every }` / `repeat: { pattern, tz, immediately, offset, endDate, limit }` are the `RepeatOptions` fields; **`add(..., { repeat })` is gone in v6** — `job-options.d.ts:54` verbatim: *"use `Queue.upsertJobScheduler` to schedule repeating jobs."* `[VERIFIED: bullmq@6.3.11 `dist/esm/interfaces/repeat-options.d.ts`, `types/job-options.d.ts:54`]`
- **`resume()` is async — confirmed for both classes:** `Queue.resume(): Promise<void>` and `Worker.resume(): Promise<void>`. `[VERIFIED: bullmq@6.3.11 `dist/esm/classes/queue.d.ts:239`, `dist/esm/classes/worker.d.ts:252`]`
- **Readiness probe for D-10's scheduler check:** `Queue.getJobScheduler(id): Promise<JobSchedulerJson<DataType> | undefined>` `[VERIFIED: queue.d.ts:253]`, plus `JobScheduler.getScheduler(id)`, `getJobSchedulers(start?, end?, asc?)`, `getSchedulersCount()`, `Json.removeJobScheduler(id)`. `[VERIFIED: `dist/esm/classes/job-scheduler.d.ts:20,40,41,43,44]`

### P2.4 Two-Redis discrimination (D-12) + ioredis options

**Boot check — pure `new URL()`, no DNS, no connection:**

```ts
// packages/platform/src/config/redis.schema.ts — cross-field refinement
const distinctHosts = (cfg: { REDIS_CACHE_URL: string; REDIS_QUEUE_URL: string }) =>
  new URL(cfg.REDIS_CACHE_URL).host !== new URL(cfg.REDIS_QUEUE_URL).host;  // host:port, not hostname alone
// superRefine → issue code "REDIS_INSTANCES_NOT_DISTINCT" → ZodError at boot
```
- Compare **`hostname` AND `port`** — two deployments on one host with different ports is the local-dev and single-node-cluster case, and a hostname-only check would reject it. `[ASSUMED — design choice, not a registry fact]`
- `new URL()` is Node stdlib and performs **no DNS resolution** — it is a syntactic parse only. `[VERIFIED: Node 24.15.0 runtime available this session]`
- **`DATABASE` (logical DB) must not be the discriminator** — `maxmemory-policy` is instance-wide, which is D-12/D-13's whole rationale.

**ioredis 6 options:**

| Setting | Producer connection (api, cache, queue-add) | Worker blocking connection |
|---------|--------------------------------------------|---------------------------|
| `maxRetriesPerRequest` | `1`–`3` — fail fast so an HTTP handler 5xx's instead of hanging | **`null`** — BullMQ *throws* otherwise |
| `keyPrefix` / BullMQ `prefix` | **never set `keyPrefix`**; BullMQ `prefix = "{akane-q}"` | **never set `keyPrefix`**; same `prefix` |
| cache profile | free to shard across slots — single-key `GET`/`GETDEL` needs no co-location | n/a |

`[VERIFIED: D-14 locks the prefix and the `maxRetriesPerRequest` split; ioredis 6.0.0 and the `Redis.Cluster` path are STACK.md §4.4 / §14 pins]`

**Why ioredis `keyPrefix` must never be used alongside BullMQ:** BullMQ computes key names from its own `prefix` and *also* reads them back with Lua scripts that embed those literal key strings. `keyPrefix` is applied by ioredis at the command layer, so the Lua scripts' key arguments get prefixed while the script's internal literal key names do not — producing two prefixing layers that disagree about where keys live. That is D-14's "genuinely nasty bug". **Belt-and-braces:** add `no-restricted-syntax` or a unit assertion that no `RedisOptions` object in the repo carries `keyPrefix`. `[ASSUMED — mechanism explanation is training knowledge; D-14's prohibition is locked]`

### P2.5 `StandardSchemaValidationPipe` (NestJS 12.1.2, D-24)

**Import path:** `@nestjs/common` → `pipes/standard-schema-validation.pipe` (re-exported from `pipes/index.js` → `index.js`). Class name verbatim: `export declare class StandardSchemaValidationPipe implements PipeTransform`.

**Constructor, verbatim:**

```ts
constructor(options?: StandardSchemaValidationPipeOptions | undefined);
interface StandardSchemaValidationPipeOptions {
  transform?: boolean;                  // @default true
  validateCustomDecorators?: boolean;   // @default false
  validateOptions?: Record<string, unknown>;
  errorHttpStatusCode?: ErrorHttpStatusCode;   // @default HttpStatus.BAD_REQUEST
  exceptionFactory?: (issues: readonly StandardSchemaV1.Issue[]) => any;
}
```
`[VERIFIED: @nestjs/common@12.1.2 `pipes/standard-schema-validation.pipe.d.ts`]`

**How the schema reaches the pipe — this is the part that is easy to get wrong.** It is **parameter metadata**, not a global `useGlobalPipes` schema. Verbatim:

`export interface ParameterDecoratorOptions { schema?: StandardSchemaV1; pipes?: (Type<PipeTransform> | PipeTransform)[] }`
`[VERIFIED: @nestjs/common@12.1.2 `decorators/http/route-params.decorator.d.ts:10-19`; `assignCustomParameterMetadata(..., schema?: StandardSchemaV1, ...)` in `utils/assign-custom-metadata.util.d.ts`]`

So: `@Body({ schema: CreateLinkSchema, pipes: [StandardSchemaValidationPipe] })` — plus the pipe registered where the handler's pipes are resolved.

**Does a `.strict()` Zod 4 schema survive it, and does `.strict()` give D-24's assertion?**
- **Yes to both**, with one split of responsibility the planner must encode:
  - `.strict()` gives *rejection of unknown keys* on the request path. That is the D-21 "any claim not on this list is rejected … a PII-shaped claim is a `400`" behaviour, and it is Zod's contract, not Nest's.
  - **`.strict()` does NOT give "the exact sorted top-level key set as a literal array."** That assertion is a *test* on `Object.keys(schema.shape).sort()` compared to a literal frozen array (D-24's "test names the version (`1.0`)"). `.strict()` rejects *extra runtime keys*; it cannot detect that a *known* key was **removed** from the schema at author time. **Only the frozen-key-set test catches a removal.** Both are required and they catch opposite failure modes.
  `[ASSUMED — Zod 4 `.strict()` semantics are training knowledge, not opened this session; the test-vs-runtime split is a logical consequence, not a registry fact]`
- **`z.toJSONSchema()` is the published artifact** (D-23) — Zod 4 native, no `zod-to-json-schema` (STACK.md §12). `[ASSUMED — STACK.md §4.2 asserts native `z.toJSONSchema()`; not re-verified]`
- **Serializer side:** `@SerializeOptions({ standardSchema })` accepts `StandardSchemaSerializerContextOptions` (`serializer/decorators/serialize-options.decorator.d.ts`) — useful if a JEV response is validated on the way out too.

### P2.6 `jose@6.2.12` (D-21) — every frozen claim is expressible

| D-21 requirement | jose API | Evidence |
|------------------|----------|----------|
| generate signing keypair | `generateKeyPair(alg, options?): Promise<{ privateKey, publicKey }>` — algs include `'Ed25519' \| 'EdDSA' \| 'ES256' \| 'ES384' \| 'ES512' \| …` | `[VERIFIED: `dist/types/key/generate_key_pair.d.ts:33`, algs `:3`]` |
| publish JWKS | `exportJWK(key): Promise<t.JWK>` (also `exportSPKI`, `exportPKCS8`) | `[VERIFIED: `dist/types/key/export.d.ts:19`]` |
| `kid` on the protected header | `setProtectedHeader(protectedHeader: t.JWTHeaderParameters): this` — "Must contain an `alg` … property" | `[VERIFIED: `dist/types/jwt/sign.d.ts:12`]` |
| registered claims | `setIssuer` (`iss`), `setSubject` (`sub`), `setAudience` (`aud`), `setJti` (`jti`), `setNotBefore` (`nbf`), `setExpirationTime` (`exp`), `setIssuedAt` (`iat`) — all `: this` | `[VERIFIED: `dist/types/types.d.ts` `ProduceJWT` at :682, setters at :688–:735]` |
| domain claims (`action`, `app_id`, `form_id`, `form_version`, `app_version`, `perm_version`, `target_id`, `query_version`) | `new SignJWT({ …domainClaims })` — "Initial JWT Claims Set. Defaults to an empty object" | `[VERIFIED: `dist/types/jwt/sign.d.ts:3`]` |
| `sub = real_user_id` | `setSubject(real_user_id)` — opaque ID only, satisfies C10 | `[VERIFIED]` |
| `keyResolver` by `kid` | `jwtVerify(jwt, getKey: JWTVerifyGetKey, options?)` overload returns `JWTVerifyResult & ResolvedKey` | `[VERIFIED: `dist/types/jwt/verify.d.ts:26`]` |
| `≤ 90 d` | `setExpirationTime("90d")` — "duration relative to now using the same formats as setNotBefore" | `[VERIFIED: `dist/types/types.d.ts:726`]` |
| module system | `"type": "module"` in package.json → **ESM-only** | `[VERIFIED: `jose@6.2.12 package.json`]` |

**Design consequences the planner must carry:**
- **Payload-shape decisions.** The discriminant `action` lives in the payload (`setProtectedHeader` sets only the JOSE header `alg`/`kid`/`typ`); the namespaces do not collide — which is why D-21 chose `action`. `perm_version` is on read links only (D-21): two payload Zod schemas (`ReadLinkClaims`, later `WriteLinkClaims` without `perm_version`), each with its own frozen-key-set test. **D-22's `action: "draft"`** stays in the enum and is asserted absent at issuance by a token-class config table (`{ action, ttl, consume }`), not by a second schema.
- **ESM-only** means the `main.ts` bootstrap must be ESM or use dynamic `import()`; this is the "decide ESM once, early" item STACK.md §13.5 flags. **Phase 1 decides it, for all three apps.**

## P3 — Brief answers

**OTel decoupling (D-18/19/20).** The span-attribute allowlist cannot be enforced in `SpanProcessor.onStart` — signature is `onStart(span: Span, parentContext: Context): void` and `Span` exposes only `setAttribute`/`setAttributes`, with **no read or delete** (`[VERIFIED: @opentelemetry/sdk-trace@2.11.0 build/src/SpanProcessor.d.ts:18`, `Span.d.ts:61-62`]); enforce it in a **wrapping `SpanExporter`** passed as `traceExporter` to `NodeSDK` — `export(spans: ReadableSpan[], resultCallback)`, and `ReadableSpan.attributes: Attributes` is readable (`[VERIFIED: sdk-trace `export/SpanExporter.d.ts:15`, `export/ReadableSpan.d.ts:13`]), so map each span to `{...span, attributes: allowlisted}` and delegate; `NodeSDKConfigurationOptions` really does accept `spanProcessors?: SpanProcessor[]` and `traceExporter?: SpanExporter` (`[VERIFIED: sdk-node@0.222.0 build/src/types.d.ts:36-37, :31]`). **`--import` supersedes the in-`main.ts` call for the loader half:** `NodeSDK`'s own README still shows `sdk.start()` in-file, but Node 24's `--import ./otel.mjs` runs the SDK before any app module is loaded, which is the property D-20 is buying; keep **both** (loader entry *and* `await import('./app.module.js')` after `sdk.start()`) so a forgotten flag degrades instead of silently losing traces.

**testcontainers 12.2.0, three sibling containers (D-07/D-08).** Modules moved out of core in v12: use **`@testcontainers/redis@12.2.0`** (`RedisContainer extends GenericContainer`, so `withCommand([...])` is inherited; `getConnectionUrl()`, `executeCliCmd(cmd, flags?)` — assert `CONFIG GET maxmemory-policy` returns `noeviction` vs `allkeys-lru`) and **`@testcontainers/mongodb@12.2.0`**; `GenericContainer` itself carries `withCommand(command: string[]): this`, `withExposedPorts(...)`, `withWaitStrategy(...)`, `start(): Promise<StartedTestContainer>` (`[VERIFIED: testcontainers@12.2.0 build/generic-container/generic-container.d.ts:47,62,67,39; @testcontainers/redis@12.2.0 build/redis-container.d.ts; npm view @testcontainers/redis|mongodb version → 12.2.0]`). **Cluster-mode Redis is not practically testable under testcontainers** — `--cluster-enabled yes` needs a pre-written `redis.conf` and all cluster hosts published on one address family, so the honest choice is to run **standalone Redis 8.10.x containers** and cover the cluster-slot behaviour (`{akane-q}` hash tag, D-14) with a **unit-level key-slot assertion** (`cluster-key-slot` is already an ioredis dep per STACK.md §4.4) rather than an integration container. `[ASSUMED — not empirically attempted this session]`

**Zod boot validation with a NAMED error (FND-09).** `@nestjs/config@12.0.1` supports both paths, verbatim: `validate?: (config: Record<string, any>) => Record<string, any>` — *"If exception is thrown in the function it would prevent the application from bootstrapping"* — and `validationSchema?: StandardSchemaV1` — *"Environment variables validation schema (Standard Schema, e.g. Zod, Arktype)"* (`[VERIFIED: @nestjs/config@12.0.1 dist/interfaces/config-module-options.interface.d.ts:40, :58]`). **Use `validate:` with a Zod `safeParse` that throws `new Error(\`CONFIG_INVALID: ${issue.path} ${issue.code}\`)`** — `validationSchema` gives the Standard Schema hook but no named error of your own, and FND-09 says *named*. Use `superRefine` for D-12's distinct-host check and D-27's production-KMS assertion inside the same schema, so all three boot guards fail with distinct, greppable codes.

**AES-256-GCM envelope (D-25/D-26).** Verified end-to-end against Node **v24.15.0** stdlib, **no package**: key 32 B, iv 12 B random, `createCipheriv('aes-256-gcm', …)`, `getAuthTag()` 16 B, `{ v: 1, alg: 'A256GCM', kid, iv, tag, ct }` all `.toString('base64url')`, and a decrypt round-trip returning the plaintext; a corrupted tag **threw** rather than returning garbage (`[VERIFIED: ran /tmp/opencode/gcm.mjs this session — envelope \`{"v":1,"alg":"A256GCM","kid":"k1","iv":"O8VopBBhTMYBWoYE","tag":"mHwTCY3GvHixb61CZgCIJg","ct":"p20diBfATbhyXWlZ"}\`, `ROUNDTRIP s3cret-value`, \`TAMPER DETECTED\`]`). **Nonce discipline is the whole security argument** — 12 random bytes per encryption under the same key; a counter or a random-12 is fine, a 96-bit nonce reuse is catastrophic, so assert `iv` uniqueness in the round-trip test and store `iv` beside `ct` (it already is).

**GitHub Actions (D-06/D-08).** Node 24 matrix: `actions/setup-node@v4` with `node-version: [24.x]` (or `node-version-file: .nvmrc`), `cache: npm` — pin the **same minor** in the matrix that `.nvmrc` names, because C1 requires all three of `.nvmrc`/Dockerfile/matrix to agree. `[ASSUMED — standard GitHub Actions usage, not verified this session]` Install guard, verbatim shape, as its **own job** so it cannot be skipped and its failure is a distinct red X: `rm -f package-lock.json && npm install --no-audit --no-fund && npm run build && npm test`. The peer-dependency failure is loud because npm 11 exits non-zero on `ERESOLVE` **without** `--legacy-peer-deps` — **do not add `--force` or `--legacy-peer-deps` to this job; adding either turns the guard into a no-op.** Assert the build artifact exists too (a `dist/main.js` per app), so a silently-resolved TS 7.0.2 that *fails to compile* still fails the job. `[ASSUMED — npm 11's ERESOLVE exit behaviour is training knowledge; npm 11.12.1 is present this session]`

## Validation Architecture

`workflow.nyquist_validation` is **`false`** in `.planning/config.json` (`[VERIFIED: .planning/config.json:24 → "nyquist_validation": false]`), so the Nyquist test-map section is omitted per its skip condition. Test requirements still exist and are owned by decisions, not by Nyquist — the planner must carry these forward as plan tasks:

| Test | Required by | Shape |
|------|-------------|-------|
| PII never reaches serialised output — email at 3 levels (typed field, computed key, nested `cause`) | **D-17**, FND-06 | unit, against `formatters.log` (P2.1) |
| Frozen top-level key set — JEV v1 schemas (RTE-10) + `ReadLinkClaims` (LNK-07) | **D-24** | literal sorted array `=== Object.keys(shape).sort()`, test named `v1.0` |
| Span-attribute exported set ⊆ allowlist; `submission_id` absent | **D-18**, FND-07 | after the wrapping exporter |
| Both Redis URLs → different host:port | **D-12** | unit on the Zod schema; plus integration asserting queue reports `noeviction` |
| AES-GCM round-trip; key + plaintext absent from every log record | **D-26** | unit |
| Boundary enforcement — one violation per category fails lint; per-app import-graph (or `InstanceWrapper.isResolved`) negative assertion | **D-03**, FND-04 | CI `--no-ignore` lint over a violating fixture; see P1.6 |

## Blockers & Open Items

### B-1 — BLOCKER (report, do not silently resolve): **D-15's layer-2 mechanism is not implementable as written**

D-15 specifies "a pino custom destination stream that parses each record … immediately before `JSON.stringify`". pino destinations consume **already-serialised bytes**; `hooks.streamWrite` is documented as receiving the "stringified JSON". The prefix "before serialisation" is unachievable at a destination. **`formatters.log` is the verified hook and satisfies D-15's *intent* exactly** (D-15's two stated properties — "before serialisation" and "unknown keys stripped" — both hold), so this is a **mechanism correction, not a decision reversal**. The planner should implement P2.1 and record the wording correction against D-15. **Escalate to the user only if they want the wording of D-15 amended.** Verified evidence is in P2.1.

### B-2 — Correction (not a reversal): D-32's `boundaries/files` "rule" is a **setting** in v7

`boundaries/dependencies` + an allow-list + `default: "disallow"` is exactly right and stable. Category policies live under `settings["boundaries/files"]` and are consumed via `to: { file: { categories: … } }`. There is no `boundaries/files` rule in 7.2.0. **7.2.0 is the correct pin** — D-32's "re-verify, do not guess" instruction is discharged by P1.0.

### B-3 — **D-27 KMS vendor: still a NAMED BLOCKER** (unchanged, deliberately not picked)

Phase 1 shape (per D-26/D-27): `KeyProvider` interface + `LocalKeyProvider` (reads a key file, **refuses to boot when `NODE_ENV=production`**) + a boot assertion that `NODE_ENV=production` without `CRYPTO_KEY_PROVIDER=kms` fails. **Shape of one concrete adapter, so naming the cloud later is a small step — no vendor chosen:**

```ts
// packages/platform/src/crypto/key-provider.ts
export interface KeyProvider {
  /** Stable identifier recorded in the envelope's `kid`. */
  keyId(): Promise<string>;
  /** Wrap a fresh 32-byte DEK. Returns key material ONLY — never a plaintext secret. */
  wrapDek(dek: Buffer): Promise<{ wrapped: Buffer; kid: string }>;
  /** Unwrap. MUST fail loudly on auth failure (B-3 note below). */
  unwrapDek(wrapped: Buffer, kid: string): Promise<Buffer>;
}

// AWS KMS adapter:      new KMSClient({}) → EncryptCommand({ KeyId, Plaintext: dek }) / DecryptCommand
// GCP KMS adapter:      new KeyManagementServiceClient() → encrypt({ name }) / decrypt({ name, ciphertext })
// Vault transit:        POST /v1/transit/encrypt/<key> { plaintext: base64(dek) } → .data.ciphertext
```

Every KMS wraps the *DEK*, and AES-256-GCM still does the bulk work with the DEK from D-25 — so the envelope shape `{ v, alg, kid, iv, tag, ct }` does not change when the vendor is named. **Two adapter-level failure modes to bake into the interface contract now:** (1) an unwrap that returns a wrong-length key must throw, not truncate/pad; (2) Vault's transit ciphertext is a **string** (`vault:v1:…`) while AWS/GCP return **bytes** — the `wrapped: Buffer` type must tolerate a UTF-8-encoded Vault string, or the interface needs a `wrappedIsText: boolean`-class distinction. Flag for the planner; do not resolve without the cloud. `[ASSUMED — vendor API shapes are training knowledge; the interface is the part D-27 says must not change]`

### B-4 — Not researchable here (recorded so the planner skips them)

- **D-30 SAML:** customer question with a deadline before Phase 5 planning; OIDC (`openid-client@6.8.8`, ESM-only) is the plan of record. Phase 1 needs no SSO. No work.
- **D-31 MongoDB 9.0 / D-29 Form.io File / D-33 decision-model accuracy + legal framing:** out of Phase 1 by decision.
- **D-11 Kubernetes manifests:** out of v1 scope — the planner must not invent them.

### B-5 — Environment availability

| Dependency | Required by | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | All three entrypoints (C1) | ✓ | **v24.15.0** | — |
| npm | workspaces, install guard (D-06) | ✓ | **11.12.1** | — |
| Docker (for testcontainers) | D-07 integration tests | **not probed this session** | — | none — testcontainers requires a working Docker daemon; verify before Wave 0 |

**Missing with no fallback:** Docker availability is unverified. If the dev machine or CI runner has no daemon, **every D-07 integration test blocks**. The planner should make "Docker daemon reachable" a Wave-0 precondition task.

### Open question for the planner (one only)

**D-20 vs ESM.** `jose` (P2.6) and `openid-client` are both **ESM-only**, and STACK.md §13.5 says "make the ESM decision once, early" — but D-09 requires `NestFactory.create()` on all three apps and D-20 requires an OTel loader entry. **What we know:** ESM is effectively forced by the dependency set; `--import` is the ESM-native loader flag. **What's unclear:** whether the three `apps/*` should be `"type": "module"` outright or remain CJS with dynamic `import()` of the ESM-only deps. **Recommendation:** make all three apps ESM in Phase 1, with `main.ts` doing `sdk.start()` then `await import('./app.module.js')`; a CJS/ESM mix across three entrypoints is the drift FND-03 forbids.

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | `nest new` v12 scaffolds Vitest | P2.2 | Cosmetic — Vitest 5.0.3 is pinned regardless; Corroborated by `@nestjs/config` shipping `vitest.config.mts` |
| A2 | `Test.createTestingModule().overrideProvider().useValue()` is unchanged in 12.1.2 | P2.2 | Low — stable API since Nest 8; a version bump would surface at typecheck |
| A3 | Compare Redis `hostname` **and** `port`, not hostname alone | P2.4 | Low-medium — a hostname-only check would fail local dev where both run on `localhost` with different ports |
| A4 | `keyPrefix`+BullMQ corruption mechanism (Lua literal keys vs command-layer prefix) | P2.4 | Low — D-14 locks the prohibition; the mechanism is explanatory |
| A5 | Zod 4 `.strict()` rejects unknown keys but cannot detect a **removed** known key | P2.5 | **Medium** — if wrong, the frozen-key-set test is redundant; the test is cheap either way and D-24 mandates it |
| A6 | `z.toJSONSchema()` is native in Zod 4 | P2.5 | Low — STACK.md §4.2 states it; fallback is the rejected `zod-to-json-schema` |
| A7 | Cluster-mode Redis not practically testable under testcontainers; unit-test key slots instead | P3 | **Medium** — if a cluster test is feasible, D-07's three-container topology may want a fourth; verify in Wave 0 |
| A8 | GitHub Actions `actions/setup-node@v4` + `node-version-file: .nvmrc` | P3 | Low — standard; only the Node *major* matters |
| A9 | npm 11 exits non-zero on `ERESOLVE` without `--legacy-peer-deps`, making the install guard loud | P3 | **Medium** — D-06's entire value depends on this; smoke-test the guard once by temporarily bumping TS to 7.x in a scratch branch |
| A10 | AWS/GCP/Vault KMS adapter API shapes | B-3 | Low right now — explicitly blocked and deliberately unscheduled |

## Sources

### Primary (HIGH confidence — opened or run this session)
- `npm view` against `registry.npmjs.org`: `eslint-plugin-boundaries` (version/engines/peerDeps/versions), `eslint`, `typescript-eslint`, `bullmq`, `jose`, `vitest`, `testcontainers`, `pino`, `zod`, `@testcontainers/{redis,mongodb}`, `@nestjs/{core,config,testing}`
- **npm tarballs, unpacked:** `eslint-plugin-boundaries@7.2.0` (README, `dist/Shared/Settings.types.d.ts`, `dist/Public/Rules.types.d.ts`); `@boundaries/elements@3.1.1` (`dist/index.d.ts` — selectors, `ORIGINS_MAP`, `ARRAY_QUERY_KEYS`); `@nestjs/{common,core}@12.1.2` + `@nestjs/{config,testing}@12.x` (StandardSchema pipe, route-params decorator, `injector/{module-ref.js,modules-container,module,instance-wrapper,container}.d.ts`, `config-module-options.interface.d.ts`); `pino@10.3.1`; `bullmq@6.3.11` (`queue`/`worker`/`job-scheduler`/`repeat-options`/`job-options`); `jose@6.2.12` (`key/{generate_key_pair,export}`, `jwt/{sign,verify}`, `types`); `testcontainers@12.2.0` + `@testcontainers/redis@12.2.0`; `@opentelemetry/{sdk-node@0.222.0,sdk-trace@2.11.0}` (`types.d.ts`, `SpanProcessor`, `Span`, `export/{SpanExporter,ReadableSpan}`)
- **Executed this session:** `/tmp/opencode/gcm.mjs` on Node v24.15.0 (AES-256-GCM round-trip + tamper); `gsd-tools query package-legitimacy check --ecosystem npm`
- In-repo reads: `01-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/config.json`, `.planning/research/ARCHITECTURE.md`, `AGENTS.md`

### Secondary (MEDIUM confidence)
- `.planning/research/STACK.md` §4.4, §6, §9, §10, §12, §13.5, §14, §14.1 — treated as a verified input per the phase brief; **not independently re-verified** for the pins this document did not re-query.

### Tertiary (LOW confidence — marked `[ASSUMED]` in place)
- Zod 4 `.strict()` semantics + native `z.toJSONSchema()`; pino 10 default `err` serializer's `Error.cause` handling; AWS/GCP/Vault KMS adapter shapes; npm 11 `ERESOLVE` exit behaviour + `actions/setup-node@v4` usage; testcontainers cluster-mode limitation

*Research date: 2026-10-02. Valid until: 2026-11-01 (pin ledger is point-in-time; re-verify any version not in STACK.md §14 before pinning).*
