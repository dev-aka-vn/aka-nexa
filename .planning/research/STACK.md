# Technology Stack — IM-Driven App Builder & Integration Gateway

**Project:** aka-nexa (working title)
**Milestone:** v1 — credible enterprise MVP
**Document type:** Verification-and-gap-closure pass over the existing PROJECT.md `## Key Decisions` baseline
**Verified:** 2026-10-01 (all version numbers re-checked live against the npm registry, `endoflife.date`, and official vendor docs on this date)
**Overall confidence:** HIGH for the framework/data/queue/security spine; MEDIUM for Zalo and the SAML/SSO edge; LOW for anything in §15 (Open items, gaps, and spikes)

---

## 0. How to read this document, and what it supersedes

### 0.1 This is not a fresh derivation — it is an audit

`.planning/PROJECT.md` already carries a ~30-row `## Key Decisions` table. That table was produced by a
prior research pass and **its substance is confirmed correct by this pass.** Nothing in it is reversed here.
This document does three things the prior pass did not:

1. **Re-verifies every load-bearing version pin live** (2026-10-01). Training-data recall is never used as a
   source for a version number anywhere in this document; every pin in §4–§10 and in the Version Verification
   Ledger (§16) was resolved against `registry.npmjs.org` metadata (`dist-tags.latest`, `time.modified`,
   `peerDependencies`, `engines`, `license`, `deprecated`) on the verification date.
2. **Records 14 drift corrections** where the prior pass's *number* had moved on by one or more patch
   releases (§2). These are version-number drift, not architecture changes — but they are corrections, and they
   are called out loudly rather than silently rewritten.
3. **Closes the open questions** the prior pass left hanging: OTel → Tempo/Jaeger OTLP capability,
   `@nestjs/observe`'s OTLP support, the SSO library question, the test-toolchain question, and the BullMQ 6
   telemetry route. Two of those closed *against* the prior pass's tentative leanings.

### 0.2 PRD §7.4 IS SUPERSEDED — DO NOT REVERT FROM IT

`PRD.md` §7.4 (lines 306–320) contains a stack table. **That table is stale and is superseded in full by this
document and by the `## Key Decisions` table in `.planning/PROJECT.md`.** It is retained in the PRD as
historical context only. Concretely, every one of these PRD §7.4 statements is **wrong** as of 2026-10-01 and
must not be used to re-derive a pin:

| PRD §7.4 says | Reality (verified 2026-10-01) | Source of truth |
|---------------|-------------------------------|-----------------|
| Node.js "20+" | Node 20 **hit EOL 2026-04-30**. Use Node **24 LTS**. | `endoflife.date/nodejs` |
| NestJS "10+" | NestJS is on **12.x** (v12.0.0 released 2026-08-28). | `registry.npmjs.org/@nestjs/core` |
| MongoDB "7+" | 7.0 EOL **2027-08-31**. Use **8.0.x**. **MongoDB 8.2 is EOL 2026-07-31 — already dead.** | `endoflife.date/mongodb` |
| Redis "7+" | Redis **8.0.x goes EOL 2026-12-01** — two months out. Use **≥8.2, develop on 8.10.x**. | `endoflife.date/redis` |
| `class-validator` + `class-transformer` | Superseded by **Standard Schema**. `class-transformer` last published **2021-11-22**. | npm `time` |
| `formiojs` (4.x) | 4.x is in **official maintenance mode**. Use **`@formio/js` 5.x**. | FormIO README |
| `@nestjs/jwt` | Wraps `jsonwebtoken` — no JWKS, no `kid` keyring. Use **`jose`**. | `registry.npmjs.org/@nestjs/jwt` |
| Bot Framework SDK (`botframework-sdk`) | **The package does not exist** (registry 404). Bot Framework is retired; support ended **2025-12-31**. | npm 404 + Microsoft Learn |
| TypeScript (unpinned) | Must be **hard-pinned to 6.0.3**. npm `latest` (7.0.2) **breaks the build**. | peer-dependency analysis, §3 |
| Mongoose | Rejected — schemas are runtime-defined. Use the **native `mongodb` driver**. | architecture, §4.3 |

**Rule for the roadmap:** any future phase that reads a version out of PRD §7.4 is reading a stale number.
Phase plans must source versions from this file or `PROJECT.md`. If they disagree, this file wins until a
newer verification pass supersedes it.

### 0.3 The one non-negotiable

> ### ⚠️ TypeScript is hard-pinned to **6.0.3**, and `package-lock.json` is committed in the **first commit**.
>
> `npm i -D typescript` resolves `latest` = **7.0.2**, which is the native-Go TypeScript port and **fails
> `npm install` with `ERESOLVE`** against the dependency tree this project requires. A missing lockfile does
> not "work eventually" — it makes `npm ci` impossible, which means CI cannot pin, which means the build is
> non-reproducible, which fails NFR-SEC-12 (dependency scanning with critical vulns blocking deploy).
>
> **Concretely, the first commit contains:** `package.json` with `"typescript": "6.0.3"` (**exact, no `^`/`~`**),
> plus `package-lock.json`. `.nvmrc` pins Node `24`. If you are reading this and the lockfile is not in the
> first commit, stop and fix it before writing any application code.

Three independent enforcers of this pin exist (§3). Any one of them alone is sufficient reason to pin.

---

## 1. Executive summary — what changed vs. the prior pass, in one screen

| # | Finding | Action |
|---|---------|--------|
| 1 | **14 version pins had drifted** since the prior pass (`@nestjs/*` 12.1.1→**12.1.2**, `bullmq` 6.3.10→**6.3.11**, `vite` 8.3.1→**8.3.2**, `vitest` 5.0.2→**5.0.3**, `@nestjs/observe` 0.3.3→**0.3.5**, node-redis 6.2.1→**6.3.0**, `turbo` 2.11.5→**2.11.6**). | Apply §2. Baseline table is right; its numbers are one patch behind. |
| 2 | **MongoDB 8.2 is not "inconsistent EOL" — it is definitively EOL 2026-07-31**, i.e. already dead. 8.0 and 8.3 both run to 2029-10-31. | Keep **8.0.x**. **8.3.x is equally valid.** Never 8.2. |
| 3 | **Redis "8.2 is the line" is stale.** Current trains are 8.4 / 8.6 / 8.8 / 8.10, all `eol:false`. 8.0.x EOL 2026-12-01. | Express as **floor ≥8.2, develop/test against 8.10.x**. Never pin 8.0.x. |
| 4 | **The TypeScript pin mechanism is sharper than the prior pass stated.** The hard `ERESOLVE` comes from **`typescript-eslint@8.71.0`** (peer `>=4.8.4 <6.1.0`, *not* marked optional). `@nestjs/swagger`'s TS peer is **optional** — it warns, it does not fail. | Conclusion unchanged, **mechanism corrected**. Pin TS regardless of Swagger. |
| 5 | **`@nestjs/observe` is definitively rejected — and the prior pass's open question is answered: it has no OTLP exporter.** It is a vendor APM agent with its own hosted backend (`observe.nestjs.com`, `serviceId`/`appSecret`), explicitly documented as *"not a replacement for OpenTelemetry."* | **Remove from the candidate list entirely.** Do not re-evaluate in Phase 4 as the prior pass suggested. |
| 6 | **OTel → Tempo/Jaeger is CONFIRMED (HIGH).** `exporter-trace-otlp-http@0.222.0`, `exporter-metrics-otlp-http@0.222.0`, `exporter-logs-otlp-http@0.222.0`, `exporter-jaeger@2.11.0`, `exporter-zipkin@2.11.0` all published 2026-08-31. | Prior gap **CLOSED**. Vendor-neutral OTLP path is real; no vendor lock-in. |
| 7 | **NestJS 12's new scaffold defaults to oxlint + Vitest. We should choose ESLint explicitly** — `eslint-plugin-boundaries@7.2.0` is required by the "boundary violation fails the build" constraint and is **ESLint-only**. | Add ESLint deliberately (§10.2), overriding the scaffold default. |
| 8 | **Three NEW deprecations reinforce existing decisions:** `@opentelemetry/instrumentation-fastify@0.57.0` is **deprecated** ("use `@fastify/otel`"); `prom-client@15.1.3` is **deprecated** ("replaced by `@prometheus-io/client`"); the Redis throttler community storage (`kkoomen/throttler-storage-redis`) is **405/unpublished** and the throttler README calls it deprecated. | Express + hand-written Redis throttler storage is now the *only* clean path (§8.2). |
| 9 | **`@formio/js` 5.x weekly downloads (52K) are *lower* than `formiojs` 4.x (57K)** despite 5.x being current and 4.x in maintenance mode. 5.x adoption is still early. | **Spike required** before Phase 3 (§15.1). Not a blocker — both are MIT and both render — but template/CSS migration risk is real. |
| 10 | **SSO: OIDC first via `openid-client@6.8.8`** (16.7M dl/week, maintained, depends on `jose` + `oauth4webapi`). **ESM-only** — same constraint as `jose`, so no new migration cost. SAML deferred; `@node-saml/node-saml@5.1.0` last published **2025-07-21** → MEDIUM confidence, open item. | Ship OIDC in v1; treat SAML as a Phase-6+ spike gated on customer IdP inventory. |
| 11 | **An AGPL landmine exists in the IM-parser ecosystem:** `ua-parser-js@2.0.10` is **AGPL-3.0-or-later**. | Hard do-not-use. NFR-SEC-12 + enterprise OSS posture make AGPL disqualifying. |
| 12 | **A real NestJS 12 + Zod trap:** `nestjs-zod@5.5.0` and `@nest-lab/throttler-storage-redis@1.2.0` both declare peers against `@nestjs/common ^10 \|\| ^11` — **incompatible with NestJS 12**. | Do-not-use list, §12. These fail or warn on install. |

**Nothing in this pass reverses a prior decision.** The stack spine (Node 24 / NestJS 12 / Express / MongoDB
native driver / ioredis + BullMQ / Zod 4 Standard Schema / jose / manual OTel / `@formio/js` 5 / the four IM
adapters) is confirmed and hardened. This pass's contribution is precision, three closed gaps, three new
deprecation-driven confirmations, and an honest spikes list.

---

## 2. Corrections to the prior pass — READ THIS BEFORE WRITING ANY CODE

Fourteen pins drifted. All are **patch-level drift on an otherwise-correct baseline.** They are corrections,
not rewrites: the architecture choice in each row stands; only the number moved.

| # | Package | Prior pass said | **Verified 2026-10-01** | Impact |
|---|---------|-----------------|--------------------------|--------|
| C1 | `@nestjs/core`, `/common`, `/platform-express`, `/testing` | 12.1.1 | **12.1.2** | Low. Keep the `12.1.2` family consistent across all four. |
| C2 | `bullmq` | 6.3.10 | **6.3.11** | Low. Verify v6 breaking-change list unchanged from what §6 records. |
| C3 | `vite` | 8.3.1 | **8.3.2** | Low. |
| C4 | `vitest` | 5.0.2 | **5.0.3** | Low. |
| C5 | `@nestjs/observe` | 0.3.3 | **0.3.5** | **Moot — package rejected outright (§2.1 X1 and §6.4).** Recorded so nobody "upgrades to it later". |
| C6 | `redis` (node-redis) | 6.2.1 | **6.3.0** | **Moot — node-redis rejected (§11).** Number recorded so the rejection doesn't get re-litigated as "it's newer now". |
| C7 | `turbo` | 2.11.5 | **2.11.6** | **Moot — turbo rejected (§11).** npm workspaces is the decision. |
| C8 | `@nestjs/terminus` | 12.1.0 | **12.0.0 → 12.1.0** | None. 12.1.0 is correct and current. |
| C9 | `class-transformer` "published 2022-12-09" | 2022-12-09 | **First published 2021-11-22** | **Correction of a method error, not a version.** The prior pass read npm's `time.modified` field and labelled it "published". For a package that has had exactly one release, `modified` ≈ `published`; the distinction matters only because the claim is now 5 years stale, not 4. |
| C10 | `passport` "last published 2025-01-10" | 2025-01-10 | **First published 2023-11-27** | Same method correction. The staleness argument for rejecting `passport` is **stronger** than the prior pass claimed, not weaker. |
| C11 | `formiojs@4.21.7` (maintenance-mode evidence) | "published 2026-09-28" | **`time.modified` 2026-09-28; first published earlier** | Method correction again. The maintenance-mode claim rests on the README, not the date, so the conclusion is unaffected. |
| C12 | `node-telegram-bot-api` (activity evidence) | "published 2026-09-07" | `time.modified` 2026-09-07 | Method correction. Still actively maintained — conclusion unaffected. |

### 2.1 Corrections that are **not** version drift — these change conclusions

These matter more than C1–C12. Each one corrects or closes something the prior pass stated with more
confidence than the evidence supported.

| # | Correction | Prior pass said | **Verified** | Why it matters |
|---|------------|----------------|--------------|----------------|
| **X1** | **`@nestjs/observe` has no OTLP exporter** | "MEDIUM — OTLP-export capability unconfirmed. Re-evaluate Phase 4." | **It is a vendor APM agent with its own hosted backend.** Requires `observe.nestjs.com` + `serviceId` + `appSecret`. Its own README: *"not a replacement for OpenTelemetry."* No OTLP exporter exists in the package. | **Prior gap CLOSED — negatively.** The package is not a candidate. This also means the vendor-neutrality argument for manual OTel is now fully proven rather than asserted. |
| **X2** | **OTel → Tempo/Jaeger works** | Listed as an open item. | **CONFIRMED (HIGH).** `exporter-trace-otlp-http`, `exporter-metrics-otlp-http`, `exporter-logs-otlp-http` at 0.222.0; `exporter-jaeger`, `exporter-zipkin` at 2.11.0. All published 2026-08-31. | **Prior gap CLOSED.** NFR-O-2 is satisfiable with zero vendor lock-in. Tempo/Jaeger are a collector-side choice, not an app-side one. |
| **X3** | **The TypeScript-pin mechanism** | "`@nestjs/swagger@12.0.2` peers `^5.5 \|\| ^6.0` → ERESOLVE." | **`@nestjs/swagger`'s TS peer is `peerDependenciesMeta: { typescript: { optional: true } }` — it warns, it does not fail.** The **hard** failure comes from **`typescript-eslint@8.71.0`**, whose peer is `typescript: ">=4.8.4 <6.1.0"` with **no optional marking**. Separately, `@nestjs/cli@12.0.8` has a hard `dependencies: { typescript: "~6.0.2" }`. | Conclusion identical, **mechanism corrected**. If someone later removes `@nestjs/swagger` and wonders why the pin still matters, this is why: three independent enforcers, only one of which is Swagger. |
| **X4** | **NestJS 12 scaffold defaults** | Not mentioned. | v12 `nest new` scaffolds **oxlint + Vitest** (ESM-first). | Changes a real decision: we **override to ESLint** because `eslint-plugin-boundaries@7.2.0` is ESLint-only and is required by the boundary-violation-fails-the-build constraint (§3.5, §10.2). |
| **X5** | **`ua-parser-js` is AGPL-3.0-or-later** | Not mentioned. | `ua-parser-js@2.0.10` `license: "AGPL-3.0-or-later"`. | **New do-not-use entry.** Several IM/user-agent parsing helpers pull this in transitively. Under NFR-SEC-12 and a plain-OSS enterprise posture, AGPL is disqualifying. |

### 2.2 New deprecations found in this pass (they reinforce, not change, decisions)

| Package | `deprecated` field says | Effect on this stack |
|---------|------------------------|----------------------|
| `@opentelemetry/instrumentation-fastify@0.57.0` | *"use `@fastify/otel`"* | **Removes the last argument for Fastify.** The prior pass declined Fastify because OTel's auto-bundle doesn't include `instrumentation-fastify`. That package is now deprecated in favour of a different package family entirely. Express decision is now **unambiguous**, not merely preferred. |
| `prom-client@15.1.3` | *"replaced by `@prometheus-io/client`"* | **Confirms the single-metrics-path decision.** Had we chosen `prom-client`, we'd be starting a migration on day one. One path: OTel metrics API → `exporter-prometheus` → one scrape endpoint. |
| `kkoomen/throttler-storage-redis` | **405 / unpublished upstream**; `@nestjs/throttler` README marks it deprecated | **Confirms the hand-written `ThrottlerStorage` decision** (~40 lines over the ioredis connection we already own). Both community alternatives are now dead. See §8.2. |
| `cache-manager-redis-yet` | deprecated | Do-not-use. We have no cache-manager requirement. |
| `express-async-errors@3.1.1` | last release **2018** | Do-not-use. Express 5 forwards rejected promises from handlers natively — the package is a no-op at best. |
| `ts-node@10.9.2`, `zod-nestjs@1.9.2` | 2023 vintage | Do-not-use. NestJS 12 + Standard Schema make both redundant. |
| `zalo-oa` | deprecated → `@zaloapi/oa` | Do-not-use; and see §7.3 — we hand-roll anyway. |

---

## 3. The TypeScript pin, in full — because getting this wrong breaks the build on day one

This is the single most load-bearing mechanical decision in the stack. It is documented at length because
the failure mode is *silent-ish*: `npm i -D typescript` appears to work in some environments, then the build
breaks elsewhere, or peer warnings get suppressed with `--legacy-peer-deps` and nobody notices until a fresh
clone cannot install at all.

### 3.1 What npm resolves by default

`registry.npmjs.org/typescript` → `dist-tags.latest` = **7.0.2** (the native-Go port). The newest version in
the range this project's tooling accepts is **6.0.3**.

### 3.2 The three independent enforcers of `<6.1.0`

| # | Enforcer | Declaration | Failure mode |
|---|----------|-------------|--------------|
| **1** | **`typescript-eslint@8.71.0`** | `peerDependencies: { typescript: ">=4.8.4 <6.1.0" }`, **no `peerDependenciesMeta`** | 🔴 **Hard `ERESOLVE`. This is the one that actually blocks install.** |
| **2** | `@nestjs/swagger@12.0.2` | `peerDependencies: { typescript: "^5.5.0 \|\| ^6.0.0" }` **with `peerDependenciesMeta.typescript.optional = true`** | 🟡 Warning only. Corrected from the prior pass, which described this as a hard failure. |
| **3** | `@nestjs/cli@12.0.8` | `dependencies: { typescript: "~6.0.2" }` (a real dependency, not a peer) | 🟡 Its own nested copy is `~6.0.2`. A root pin of 7.x means **two different TypeScript compilers** in one tree — the CLI compiles against one, your editor/tests against the other. Decorator metadata behaviour can differ. Silent until it isn't. |

### 3.3 Why the failures are worse than they look

- **Enforcer 1** means `npm install` fails outright on a clean checkout with no lockfile. That kills `npm ci`,
  which kills reproducible CI, which fails NFR-SEC-12.
- **Enforcer 3** means a *partial* mitigation (pinning in some places but not others) produces a tree with two
  compilers. `emitDecoratorMetadata` is exactly the kind of feature where two compiler majors can disagree
  without a type error — the failure surfaces as a runtime `undefined` on an injected dependency, which is far
  harder to diagnose than an install error.
- The prior pass's instinct — pin and commit a lockfile — is right. This section only makes **why** precise so
  that no future phase "helpfully" relaxes it.

### 3.4 The rule

```jsonc
// package.json — exact, no caret, no tilde
"devDependencies": {
  "typescript": "6.0.3",
  "@typescript-eslint/eslint-plugin": "…",
  "@typescript-eslint/parser": "…"   // resolve the typescript-eslint pair to one version; 8.71.0 as verified
}
```

And, in the **first commit**:
- `package-lock.json` — committed.
- `.nvmrc` — contains `24` (matches the Node floor, §4.1).
- Dockerfile `FROM node:24.x-slim` pinned to a digest or a patch tag.
- CI matrix pinned to the same Node patch.

**Verification step before the first commit closes:** clone the repo fresh, `rm -rf node_modules`, run
`npm ci`, confirm zero `ERESOLVE` and zero peer warnings about TypeScript. If `npm ci` succeeds, the pin and
the lockfile are both correct. If it doesn't, fix before writing a line of application code.

### 3.5 ESLint over oxlint (see also §10.2)

NestJS 12's scaffold offers **oxlint**. We take **ESLint** deliberately, for two reasons that both have hard
constraints attached:

1. **`eslint-plugin-boundaries@7.2.0` is ESLint-only.** The PROJECT constraint "a lint rule that fails the
   build on a boundary violation" (modular-monolith enforcement) has no oxlint equivalent. This is not a
   preference — it is the enforcement mechanism for a load-bearing architecture decision.
2. **typescript-eslint is the enforcer of the TS pin** (§3.2 #1). Keeping the pin *mechanically enforced*
   rather than merely documented means a bad `npm i typescript@latest` fails CI immediately, not six weeks
   later.

This is the one place we knowingly override a framework default. It is documented in the phase plan for
scaffolding so it doesn't look like an oversight.

---

## 4. Recommended stack

### 4.1 Core framework

| Technology | Version | Purpose | Why this one | Confidence |
|------------|---------|---------|--------------|------------|
| **Node.js** | **24.x LTS** (EOL 2028-04-30) | Runtime | **Amends PRD "Node 20+".** Node 20 hit **EOL 2026-04-30** — an enterprise runtime with NFR-SEC-12 (critical vulns block deploy) cannot run an EOL line. Node 22 LTS expires 2027-04-30 (too little runway for a 26–34 week build plus 3-year retention obligations). Node 26 only enters LTS 2026-10-28 (too new to pin). Node 24 is the only line with ≥18 months of runway. | HIGH |
| **NestJS** | **12.1.2** | App framework | Satisfies "NestJS 10+". v12.0.0 released 2026-08-28. Ships **Standard Schema** validation (which is why Zod replaces class-validator), ESM-first packages, Rspack, and `@nestjs/observe`. Existing CommonJS keeps working — no ESM migration tax. | HIGH |
| **TypeScript** | **6.0.3 — exact pin** | Language | See §3 in full. npm `latest` (7.0.2) breaks the install. | HIGH |
| **`@nestjs/platform-express`** | **12.1.2** (depends on `express@5.2.1`) | HTTP adapter | **Stay on Express.** (a) `@slack/bolt@5` ships `ExpressReceiver` built on `express@^5` and depends on `express: ^5.0.0` — Bolt on a Fastify host means a second HTTP stack in one process. (b) `@opentelemetry/auto-instrumentations-node@0.80.0` bundles `instrumentation-express` and **not** `instrumentation-fastify`. (c) **New in this pass:** `instrumentation-fastify@0.57.0` is itself now **deprecated**. (d) `@microsoft/agents-hosting-express@1.9.1` is the supported Teams host. Four independent reasons; Express is not a close call at 1,000 concurrent users. | HIGH |
| `rxjs` | ^7.8 | Reactive core | Peer of `@nestjs/core@12`. | HIGH |
| `reflect-metadata` | ^0.2 | Decorator metadata | Peer of `@nestjs/core@12`. | HIGH |

**Amended constraint text for the roadmap:**
> Tech stack: Node.js **24 LTS** / NestJS **12.1.2** / MongoDB **8.0.x** with the native `mongodb` driver
> (not Mongoose) / Redis **≥8.2** (develop on **8.10.x**) with `ioredis` 6 / BullMQ **6.3.11** Job Schedulers /
> **`@formio/js` 5.6.1** / Zod **4.6.5** via `StandardSchemaValidationPipe` / `jose` 6.2.12 / Express, not Fastify.
> **TypeScript hard-pinned to 6.0.3 with `package-lock.json` committed in the first commit.**

### 4.2 Configuration & validation

| Technology | Version | Purpose | Why this one | Confidence |
|------------|---------|---------|--------------|------------|
| **Zod** | **4.6.5** | All runtime validation — request DTOs, env, JEV provider payloads, link claims, connector configs | **Replaces class-validator/class-transformer.** NestJS 12's built-in `StandardSchemaValidationPipe` accepts any Standard Schema; Zod is the reference implementation. One schema is the single source of truth: validates at runtime *and* infers the handler's TypeScript type. Zod 4 is dual CJS/ESM, so it works inside either module system we end up with. | HIGH |
| `@nestjs/config` | 12.0.1 | Env loading + Zod-backed config validation | Ships `@standard-schema/spec@1.1.0` as a declared dep — env validation uses the *same* Zod dialect as request bodies. One validation language across the codebase. | HIGH |
| `@nestjs/swagger` | 12.0.2 | OpenAPI for internal API + connector contracts | Reads Standard Schema, so Zod DTOs document themselves. **Wiring correction vs. the prior pass:** it is `SwaggerModule.createDocument(app, config, { standardSchemaConverter: standardSchemaModelConverter })` plus `@ApiCreatedResponse({ standardSchema: schema })` — **not** calling `z.toJSONSchema()` yourself. Its TS peer is optional (warns only, §3.2 #2). | HIGH |

### 4.3 Database

| Technology | Version | Purpose | Why this one | Confidence |
|------------|---------|---------|--------------|------------|
| **MongoDB** | **8.0.x** (EOL 2029-10-31) | Primary store | **Amends PRD "MongoDB 7+".** 7.0.43 is supported but EOL 2027-08-31. Satisfies NFR-A-4 (3-node replica set) and enables the change streams named in PRD §7.4 | HIGH |
| **`mongodb`** (native driver) | **7.7.0** | Data access — **replaces Mongoose** | **The load-bearing judgment call in the data layer.** Mongoose's value is a compile-time `Schema` + document middleware over a *statically known* model. This product stores **per-app runtime-defined collections** — App Builder authors define fields at runtime, up to 200 apps × 20 forms (NFR-S-6/S-7). Under Mongoose that means compiling and caching a `Schema` per app at runtime, capturing **none** of Mongoose's benefits, plus a second serialization layer between the DB and the wire. The native driver with a thin typed repository per collection is strictly less code for this shape. `instrumentation-mongodb` (bundled in `auto-instrumentations-node`) traces the raw driver exactly as it traces Mongoose, so **NFR-O-2 costs nothing by dropping Mongoose**. | HIGH |
| `mongoose` | ~~9.10.3~~ | — | **Rejected.** Wrong abstraction for runtime-defined schemas. Also has a stricter engine floor (`>=20.19.0`) than the driver. `@nestjs/mongoose@12.0.0` dropped with it. | HIGH |

**MongoDB EOL table (from `endoflife.date/mongodb`, verified 2026-10-01):**

| Line | Latest | EOL | Verdict |
|------|--------|-----|---------|
| 7.0 | 7.0.43 | 2027-08-31 | Too little runway. |
| **8.0** | **8.0.x** | **2029-10-31** | ✅ **Recommended.** |
| 8.2 | — | **2026-07-31** | 🔴 **Already EOL. Never pin.** *(Corrects the prior pass's "inconsistent across sources" — it is not inconsistent, 8.2 is simply dead.)* |
| 8.3 | 8.3.x | 2029-10-31 | ✅ Equally valid alternative; same EOL as 8.0. |
| 9.0 | 9.0 (released 2026-09-30) | 2031-10-31 | Too new to pin (4 days old at verification). Revisit if the deployment outlives 2029. |

**Recommendation:** pin **8.0.x** in the compose file and CI. Note 8.3.x as an equally acceptable choice if the
infrastructure team prefers the newest maintenance line. **Never 8.2** — it looks like "the latest 8.x" to
anyone reading quickly, and it is already unsupported.

### 4.4 Cache, tokens & queue

| Technology | Version | Purpose | Why this one | Confidence |
|------------|---------|---------|--------------|------------|
| **Redis** | **≥8.2 floor, develop/test on 8.10.x** | Cache, one-time tokens, identity mapping, BullMQ backing, throttler storage | **Amends PRD "Redis 7+".** *Correction:* the prior pass's "8.2 is the line" is **stale** — current trains are **8.4 / 8.6 / 8.8 / 8.10**, all `eol:false`. ⚠️ **Do not pin 8.0.x: EOL 2026-12-01**, two months from verification. 8.2 is EOL 2030-09-01; 7.4.11 (EOL 2029-12-01) is the conservative fallback. Expressing this as a **floor** rather than a pin is deliberate: it lets the platform team upgrade the cluster on their own cadence without a code change, which is what an enterprise deployment needs. | HIGH |
| **`GETDEL`** | Redis ≥ **6.2.0** | Atomic one-time token consumption | **Verified against redis.io command metadata: `"since": "6.2.0"`.** Satisfies NFR-SEC-1 (atomic consumption, no race) for the create/edit write links. The floor of 8.2 gives ~4 major versions of headroom. | HIGH |
| **`ioredis`** | **6.0.0** | Redis client — **rejects node-redis** | (a) **BullMQ ships ioredis** — one client type across app and workers halves the connection surface. (b) Cluster mode is the committed topology (PRD §18.3) and `Redis.Cluster` is ioredis's mature path; verified `cluster-key-slot` among its deps. (c) OTel bundles `instrumentation-ioredis`; node-redis needs a separately-added `instrumentation-redis`. 🔴 **Never pin 5.x** — ioredis 6.0.0 (2026-07-31) fixes a High-severity *Uncontrolled Recursion* advisory affecting all `<6.0.0-beta.1`. | HIGH |
| **BullMQ** | **6.3.11** | Async connector execution | Satisfies PRD. Redis-backed, retries, DLQ (FR-C-*), flows. Carries `cron-parser` for Job Schedulers, and an **optional** peer on `bullmq-otel >=2.0.0`. | HIGH |
| `bullmq-otel` | 2.0.1 | OTel trace propagation **into** workers | Peer `bullmq >= 6.0.0`. ⚠️ **`@opentelemetry/instrumentation-bullmq` does not exist on npm** (registry 404, verified) — this package or BullMQ's own built-in `docs/guide/telemetry` are the only two routes. Use this one: it keeps trace continuity (NFR-O-1) across the queue boundary, which is precisely the hop where trace IDs usually get lost. | HIGH |
| `@nestjs/bullmq` | 12.0.0 | NestJS DI wiring for BullMQ | Peer `bullmq: ^3 \|\| ^4 \|\| ^5 \|\| ^6` — clean fit. | HIGH |

**BullMQ v6 API changes the implementation must respect** (from the official v5→v6 migration guide):
- `Queue.add(..., { repeat })`, `getRepeatableJobs()`, `Queue.resume()` are **gone** → **Job Schedulers** replace them.
- `Queue.resume()` in the Job Schedulers API is **async** — must be awaited.
- `debounce` option **removed** → deduplication via TTL / replace / extend modes. This is the right primitive for
  NFR-SEC-1's "same submission twice" protection.
- `Queue#client`, `Queue#redisVersion`, `Queue#databaseType`, `Worker#blockingClient` are new accessors.

**On scheduling (`@nestjs/schedule`):** the prior pass's rejection stands and gets stronger. `@nestjs/schedule`
is in-memory and per-instance. A JWT key rotation that silently fails to run on one pod is a **security
failure** (NFR-SEC-9 requires 90-day dual-key rotation with zero downtime). Keep `@nestjs/schedule@12.0.2` only
for sub-minute local ticks where durability is irrelevant.

---

## 5. JWT & link tokens

| Technology | Version | Purpose | Why this one | Confidence |
|------------|---------|---------|--------------|------------|
| **`jose`** | **6.2.12** | **All** JWT signing/verification + OIDC token verification | **Replaces `@nestjs/jwt`.** `@nestjs/jwt@12.0.2` is a thin wrapper over **`jsonwebtoken@9.0.3`**, which has **no JWKS support and no `kid`-keyed keyring resolution**. NFR-SEC-9 (90-day dual-key rotation, zero downtime) would then mean hand-rolling key selection. `jose` does it natively: `generateKeyPair()`, `exportJWK()`, `SignJWT.setProtectedHeader({ kid })`, and `jwtVerify(token, key, { keyResolver })` where the resolver maps `kid` → live keyring entry. **The rotation requirement is exactly the shape `jose`'s keyResolver exists for.** | HIGH |
| **Asymmetric algs — EdDSA / ES256** | — | Link signing | HS256 (the only practical option with `@nestjs/jwt`/`jsonwebtoken`) is the wrong primitive for a **90-day-lived stateless read link** (AD-11): a symmetric link token means anyone holding the verify key can *mint* one. Asymmetric signing also means the Form Renderer — a **static web app** — can verify without ever holding the signing key. | HIGH |
| `openid-client` | **6.8.8** | OIDC authorization-code + PKCE for admin SSO | PRD §15.1 requires OIDC/SAML SSO with MFA. 16.7M downloads/week, actively maintained, and depends on `jose` + `oauth4webapi` — the same primitives already chosen. **ESM-only**, same constraint as `jose`, so **no new migration cost**. See §8.6 for the SAML side. | HIGH |
| `@node-saml/node-saml` | 5.1.0 | SAML 2.0 — **deferred** | Last published **2025-07-21** as of verification. That is ~14 months of silence for a security-critical parser. Confidence **MEDIUM**. Do not put it on the v1 critical path without a spike. | MEDIUM |

**ESM note carried forward:** both `jose` and `openid-client` are **ESM-only**. NestJS 12 is ESM-first but
existing CommonJS apps keep working, so this is not a blocker — it does mean the auth module is the natural
place to run `await import()` behind a CommonJS façade if we stay CJS, or to commit to ESM for the whole
service early. **Decide once, in the scaffolding phase, and record the choice** — a half-ESM codebase where
only auth is ESM is a known source of confusing `ERR_REQUIRE_ESM` bugs.

---

## 6. Observability — the manual-OTel decision, now fully justified

NFR-O-1 (trace ID == `submission_id`, end-to-end through routing → form render → submission → connector) and
NFR-O-2 (OpenTelemetry) are the requirements this section serves.

| Technology | Version | Purpose | Confidence |
|------------|---------|---------|------------|
| `@opentelemetry/sdk-node` | **0.222.0** | NodeSDK entry point. **Must be initialised before any instrumented module is imported** — use `--import`/a loader entry, not an in-app call. | HIGH |
| `@opentelemetry/api` | **1.9.1** | Traces/metrics/logs API. Stable 1.x; instrumentation packages peer on `^1.4.1`. | HIGH |
| `@opentelemetry/core` | **2.11.0 — install explicitly** | Shared OTel core | HIGH |
| `@opentelemetry/auto-instrumentations-node` | **0.80.0** | Auto-instrumentation bundle (49 instrumentations) | HIGH |
| `@opentelemetry/exporter-trace-otlp-http` | 0.222.0 | Traces → OTel Collector | HIGH |
| `@opentelemetry/exporter-metrics-otlp-http` | 0.222.0 | Metrics → collector | HIGH |
| `@opentelemetry/exporter-prometheus` | 0.222.0 | Prometheus scrape endpoint — **the single metrics path** | HIGH |
| `@opentelemetry/semantic-conventions` | 1.43.0 | Attribute names — required for NFR-O-1's `submission_id` to be queryable | HIGH |
| `pino` / `pino-http` | **10.3.1** / **11.0.0** | Structured JSON logs (NFR-O-5) | HIGH |
| `nestjs-pino` | **5.2.1** | NestJS ↔ pino bridge. Peers `@nestjs/core ^11.0.8 \|\| ^12.0.2` — clean fit. | HIGH |
| `@nestjs/terminus` | **12.1.0** | `/health/live` + `/health/ready` (NFR-O-7) | HIGH |

### 6.1 Instrumentation bundle — what is and isn't in it

**Confirmed present** in `auto-instrumentations-node@0.80.0`: `nestjs-core` (0.68.0), `http`, `undici`,
`mongodb` (0.75.0), `mongoose`, **`ioredis`** (0.70.0), `pino` (0.68.0), `express` (0.70.0), `socket.io`,
`runtime-node`, `host-metrics`.

**Confirmed absent:** `fastify`. (And the standalone `instrumentation-fastify@0.57.0` is now **deprecated**.)

This is the mechanical reason the Express decision holds: NFR-O-2 requires OTel, the instrumented path exists
for Express and not for Fastify, and taking the instrumented path is worth more than Fastify's throughput
headroom at a 1,000-concurrent-user target (NFR-S-1).

`instrumentation-pino` being bundled means **trace_id correlation in logs with zero glue code** — a
meaningful fraction of NFR-O-5's value for free.

### 6.2 ⚠️ PII must be excluded from logs *before* serialisation — a compliance requirement, not a nicety

The PROJECT constraint on GDPR-aligned erasure says: *"Erasure is broken by construction unless PII is excluded
from logs **before** serialisation via a field allowlist — a denylist regex always misses, and a 1-year cold
log retention makes the right-to-erasure promise unachievable."*

Concrete implementation consequence for the stack:
- pino serializers must implement an **allowlist** (known-safe fields pass; everything else is dropped or
  hashed). Never a denylist.
- The redaction must happen in the pino **serializer hook**, which runs before serialisation — not in a log
  shipper, not in a Grafana dashboard, not in a regex over the final line.
- Cold log retention must be ≤ the erasure SLA, or erasure is a lie.

This is called out here because it is a **stack decision with a compliance consequence**, and it is the single
easiest thing in this document to get wrong by accident.

### 6.3 CLOSED GAP — OTLP export to Tempo/Jaeger is available (HIGH)

The prior pass flagged "OTLP-export capability unconfirmed" as an open item. **Verified 2026-10-01:**

| Package | Version | Published |
|---------|---------|-----------|
| `@opentelemetry/exporter-trace-otlp-http` | 0.222.0 | 2026-08-31 |
| `@opentelemetry/exporter-metrics-otlp-http` | 0.222.0 | 2026-08-31 |
| `@opentelemetry/exporter-logs-otlp-http` | 0.222.0 | 2026-08-31 |
| `@opentelemetry/exporter-jaeger` | 2.11.0 | 2026-08-31 |
| `@opentelemetry/exporter-zipkin` | 2.11.0 | 2026-08-31 |

**Implication:** NFR-O-2 is satisfiable with a **fully vendor-neutral** path — the app emits OTLP to a
collector; Tempo/Jaeger/Grafana Cloud/any APM is a collector-side decision. No application code changes if the
backend changes. The prior pass's Medium-confidence hedge on this point can be retired.

### 6.4 `@nestjs/observe` — CLOSED GAP, rejected definitively

| Question | Answer |
|----------|--------|
| Does it export OTLP? | **No.** |
| What is it, then? | A **vendor APM agent** with its own hosted backend (`observe.nestjs.com`), configured with `serviceId` + `appSecret`. |
| Does it replace OpenTelemetry? | **No** — its own README says it is *"not a replacement for OpenTelemetry."* |
| Verdict | **Rejected. Remove from the candidate list.** |

The prior pass said "re-evaluate in Phase 4." **That re-evaluation is cancelled.** Adopting it would mean
routing enterprise submission traces to a NestJS-operated SaaS backend, which is a procurement and data-
residency question the PROJECT constraints ("configurable and region-locked per deployment") should not have to
answer. Manual OTel is the answer, and §6.3 proves it is complete.

**One metrics path, not two.** Business metrics (token issue/consume counts, JEV confidence distribution,
queue depth, connector success rate) go through the **OTel metrics API** and out via `exporter-prometheus` to a
single scrape endpoint. 🔴 Do **not** add `prom-client` alongside it — it is now **deprecated** in favour of
`@prometheus-io/client`, and two scrape endpoints means two naming conventions and split alert rules. One path.

**Health endpoints:** keep `/health/live` **free of dependency checks** and `/health/ready` dependent on
Mongo/Redis. If liveness touches Redis, a Redis blip makes Kubernetes restart healthy pods — turning a
dependency blip into a full outage, which violates 99.9% uptime.

---

## 7. IM bot SDKs

### 7.1 Summary matrix

| Platform | Package | Version | Status | Confidence |
|----------|---------|---------|--------|------------|
| **Slack** | `@slack/bolt` | **5.1.0** | ✅ Active (published 2026-09-02) | HIGH |
| **Microsoft Teams** | `@microsoft/agents-hosting` + `@microsoft/agents-hosting-express` + `@microsoft/agents-hosting-extensions-msteams` | **1.9.1** each | ✅ Active (published 2026-09-29) | HIGH |
| **Zalo OA** | *none — hand-rolled client* | — | ⚠️ No official Node SDK exists | HIGH (see §7.4) |
| **Telegram** | `node-telegram-bot-api` | **2.1.0** | ✅ Active (modified 2026-08-24) | MEDIUM |

**The PRD's "official SDKs only" constraint is unsatisfiable as written for two of four platforms** and is
relaxed accordingly in `.planning/PROJECT.md`. Slack and Telegram have maintained community-standard libraries;
Teams has a *first-party successor* to its retired SDK; Zalo has **nothing official at all**.

### 7.2 Slack — `@slack/bolt@5.1.0`

Bolt v5 (released 2026-07-15) requires **Node ≥ 20** — satisfied by our Node 24 floor. Two changes matter to us:

1. **`axios` → native `fetch`.** This *independently confirms* our §9 HTTP-client decision: Slack's own SDK made
   the same move we are making, and OTel's bundle already instruments `undici` (which backs `fetch`). Running
   axios inside Bolt would have created an un-instrumented HTTP path — exactly where NFR-O-1's end-to-end trace
   would break.
2. **`ExpressReceiver` built on `express@^5`**, and `@slack/bolt@5` depends on `express: ^5.0.0`. This is the
   mechanical reason the NestJS app must be Express (§4.1).

**Enterprise proxy support is a real requirement here, not a hypothetical.** Corporate Slack installs commonly
sit behind an egress proxy, as do Redmine and ERP connectors. Bolt 5 supports both `NODE_USE_ENV_PROXY=1` /
`HTTPS_PROXY` and an explicit `undici.ProxyAgent` via `clientOptions.fetch`. Since we already standardise on
`undici`, wiring the same `ProxyAgent` into our own connector HTTP client is **one shared helper** — plan for it
rather than discovering it during Phase 4 integration.

**Also relevant:** Slack signs requests. Request-signature verification must happen **before** the 3-second ack
window is spent on anything else — see §16, webhook receiver contract.

### 7.3 Microsoft Teams — `@microsoft/agents-hosting@1.9.1`

Three facts establish this choice:

- 🔴 **The package literally named in the PRD, `botframework-sdk`, does not exist on npm** (registry 404).
  The PRD names a package that was never published under that name.
- 🔴 **The Bot Framework SDK is retired.** Its GitHub repository is **archived and no longer updated**, and
  Microsoft states **support ended 2025-12-31**. `botbuilder`'s last npm publish was **2025-08-27**.
- ✅ **The successor is the Microsoft 365 Agents SDK.** `@microsoft/agents-hosting@1.9.1` plus the extension
  packages, all published 2026-09-29.

**Required sub-packages** (all 1.9.1): `@microsoft/agents-hosting` (host), `@microsoft/agents-hosting-express`
(**the Express host — this is the one we need, given §4.1**), `@microsoft/agents-activity` (message contracts),
`@microsoft/agents-hosting-extensions-msteams` (Teams channel), and optionally
`@microsoft/agents-hosting-extensions-slack`, `-dialogs`, `-telemetry`.

🔴 **Deprecation trap:** `@microsoft/agents-hosting-extensions-teams@1.9.1` is **deprecated by its own
publisher** on npm. The correct package is `-extensions-**msteams**`. The two names differ by four characters and
npm will happily install the deprecated one. Verify the exact package name in the phase plan.

**Teams-specific gotchas from Microsoft's own migration guidance** — each is a silent-wrong-answer trap:

| Gotcha | Consequence if missed |
|--------|----------------------|
| `AgentApplication` is the recommended base class; `ActivityHandler` is deprecated | Deprecated API surface; removal on a future SDK bump |
| **The Agents SDK does NOT provide JWT middleware** — you must call `authorizeJWT(AuthConfiguration)` yourself | Bot Framework's `BotFrameworkAuthentication` middleware silently does not exist; tokens go unvalidated |
| Env vars renamed to `connections__serviceConnection__settings__clientId` / `clientSecret` / `tenantId` | Old Bot Framework env names are ignored; bot fails to authenticate with a confusing error |
| **"Legacy Application Insights middleware" is an explicit Decision item — do NOT add it** | Conflicts with our manual OTel path and double-instruments; §6 is the single telemetry route |

Dependency note: the Agents SDK pulls `zod@3.25.75` and `jsonwebtoken@9.0.3`. Our app uses **Zod 4** — both major
versions can coexist, but do **not** let an import resolve the wrong one inside SDK-facing code.

### 7.4 Zalo OA — hand-rolled, ~200 lines over `undici`

Zalo publishes **no official Node.js SDK**. Its own SDK documentation is **PHP-only**. Every npm wrapper
self-describes as unofficial. Verified multiple ways; confidence HIGH.

What exists and why we still hand-roll:

| Candidate | Finding | Verdict |
|-----------|---------|---------|
| `node-zalo-bot@0.1.6` | Linked from docs.zaloplatforms.com, but **277 weekly downloads, no `license` field, no repository, single maintainer, axios-based** | 🔴 No. Unlicensed, unmaintained, axios (un-instrumented → breaks NFR-O-1). |
| `zca-js@2.2.0` | MIT-licensed, but its own description says **"Unofficial"** | 🔴 Supply-chain risk under NFR-SEC-12. |
| `@warriorteam/redai-zalo-sdk`, n8n community nodes | Community wrappers | 🔴 Same class of risk. |
| `zalo-oa` | **deprecated** → `@zaloapi/oa` | 🔴 Deprecated; and still unofficial. |

**Recommendation: hand-roll a ~200-line OA client over `undici`.** The Zalo OA surface we need is narrow (send
message, receive webhook), `undici` is already a dependency, OTel already instruments it, and ~200 lines of code
we own is a smaller total risk than an unlicensed 277-downloads-per-week package in a security-scanned enterprise
build.

⚠️ **This is the highest-risk item in the stack and should be treated as a spike, not an implementation task.**
Zalo's OA API has no official Node reference, no official changelog discipline, and a real chance of undocumented
behaviour changes. See spike S2 in §15.1.

### 7.5 Telegram — `node-telegram-bot-api@2.1.0`

Both mainstream options are acceptable; this is a genuine near-tie, hence **MEDIUM** confidence.

| Package | Version | Note |
|---------|---------|------|
| **`node-telegram-bot-api`** | **2.1.0** | ✅ **Recommended.** Actively published (modified 2026-08-24), v2 is a TypeScript rewrite. |
| `grammy` | 1.46.0 | Solid, good framework ergonomics — but still depends on `node-fetch@^2.7.0`, which means an **un-instrumented HTTP path** (OTel bundles `undici`, not node-fetch). That is the deciding factor. |

The deciding argument is instrumentation continuity, not API quality: NFR-O-1 requires the trace to survive
every hop, and node-fetch sits outside the auto-instrumentation bundle.

---

## 8. Security primitives

### 8.1 Rate limiting — `@nestjs/throttler@6.7.1`

Satisfies **NFR-SEC-6**'s three named tiers directly, because Throttler v6 has **named throttlers**:

| Tier (NFR-SEC-6) | Suggested named throttler | Limit |
|------------------|---------------------------|-------|
| Per-user | `perUser` | 10 / min |
| Per-app | `perApp` | 100 / min |
| Per-connector | `perConnector` | per-connector policy |

Version: **6.7.1** (published 2026-09-24), engines `^20.19.0 || ^22.12.0 || >=24.0.0` — satisfied by Node 24.

**Two implementation gotchas that must be in the phase plan:**

1. 🔴 **`ttl` is in MILLISECONDS** in v6, not seconds. `ttl: 60` is 60 *milliseconds* — a throttle that appears
   to do nothing. This is the single most common Throttler v6 migration bug.
2. ⚠️ **`handleRequest()` runs once per named throttler.** Three tiers = **three Redis round-trips per
   request**. That is acceptable at NFR-S-1's 1,000 concurrent users, but it must be measured, not assumed —
   fold it into the load test in the performance phase.

### 8.2 Distributed throttler storage — hand-written (BOTH community options are unusable)

| Option | Status | Verdict |
|--------|--------|---------|
| `kkoomen/throttler-storage-redis` | **405 / unpublished upstream**; `@nestjs/throttler`'s own README marks it deprecated | 🔴 Dead. |
| `@nest-lab/throttler-storage-redis@1.2.0` | Peers `@nestjs/common ^7..^11` — **incompatible with NestJS 12** | 🔴 Fails on install. |
| `@nestjs-redis/throttler-storage@2.0.1` | Does support NestJS 12, **but peers `redis ^5 \|\| ^6` = node-redis**, which contradicts our ioredis decision (§4.4) | 🔴 Would force a second Redis client into the process. |
| **Hand-written `ThrottlerStorage`** | ~40 lines over the ioredis connection we already own | ✅ **Recommended.** |

`ThrottlerStorage`'s interface is `increment(key, ttl)` returning `{ totalHits, timeToExpire }` — a single
`INCR` + `EXPIRE`/`PEXPIRE` pipeline over ioredis. Forty lines we own, zero new supply-chain surface under
NFR-SEC-12, and no second client.

### 8.3 Password & OTP hashing — `@node-rs/argon2@2.2.1`

| Package | Version | Verdict |
|---------|---------|---------|
| **`@node-rs/argon2`** | **2.2.1** | ✅ **Recommended.** Ships **prebuilt N-API binaries** — no `node-gyp` in CI or in the K8s image. Engines `>=10`. |
| `argon2` | 0.45.1 | Rejected: requires native compilation. |
| `bcrypt` | 6.0.0 | Rejected: has the **72-byte input truncation** limit — a silent security-relevant behaviour that will bite on a long passphrase. |

Prebuilt binaries are the deciding factor: a `node-gyp` step in a locked-down enterprise CI image is a
recurring operational tax, and it fails differently on every glibc/musl combination.

### 8.4 Secret & token encryption — KMS-backed, AES-256-GCM

Per PROJECT constraints: **HashiCorp Vault or AWS/GCP KMS, AES-256-GCM. No secrets in code, config files, or
plaintext env vars.** No npm package is recommended for the KMS half — the SDK comes from the chosen cloud
provider. AES-256-GCM is available from **Node's stdlib `crypto`** (`createCipheriv('aes-256-gcm', …)`), which
means **zero additional dependencies** for the symmetric layer. Per the efficiency ladder in AGENTS.md, this is a
stdlib-and-native solution, not a dependency question.

Two implementation requirements that follow:
- **Every GCM encryption needs an auth tag stored and verified.** Losing the tag must fail the decrypt, loudly.
- **Never reuse a nonce with the same key.** Enforce a counter or a random 12-byte IV persisted alongside the
  ciphertext.

### 8.5 Webhook request verification (all four platforms)

| Platform | Mechanism | Note |
|----------|-----------|------|
| Slack | Signing secret (`v0:` HMAC-SHA256 over timestamp + body) | Must verify **before** ack |
| Teams | JWT validation via `authorizeJWT()` | SDK does not supply middleware (§7.3) |
| Telegram | Secret token header (per-bot) | Simple header compare |
| Zalo | OA-provided verification field | ⚠️ **Spike — the weakest-documented of the four.** See spike S2 in §15.1 |

**Uniform rule for all four:** verify the signature, ack in <200 ms, enqueue, and do all logic in the consumer
(§16). Verification is cheap; it happens first; nothing else runs on the request path.

### 8.6 SSO — OIDC in v1, SAML deferred

| Path | Package | Version | Confidence | Decision |
|------|---------|---------|------------|----------|
| **OIDC (authorization code + PKCE)** | **`openid-client`** | **6.8.8** | **HIGH** | ✅ **v1.** 16.7M downloads/week, actively maintained, depends on `jose` + `oauth4webapi` — primitives already chosen. **ESM-only**, same constraint as `jose` (§5), so no new cost. |
| **SAML 2.0** | `@node-saml/node-saml` | 5.1.0 | **MEDIUM** | ⚠️ **Defer.** Last published **2025-07-21** — ~14 months of silence for a security-critical parser. Do not put on the v1 critical path. |

**The decision hinges on the customer's IdP inventory, which is not known.** OIDC covers Entra ID, Okta, Auth0,
Google Workspace, Keycloak, and most modern enterprise IdPs — which is the large majority. SAML is mainly
needed for legacy on-prem ADFS/ADFS-era stacks. **Gate this on a customer-facing question in Phase 1
discovery**, not on a technical preference: "what IdP do you use?" determines whether SAML is a v1 blocker.

⚠️ **MFA:** PRD §15.1 requires OIDC/SAML SSO **with MFA**. MFA is enforced by the IdP in the OIDC model — the
app must honour `acr`/`amr` claims and reject insufficient assurance. Do not try to implement MFA in the app.

### 8.7 RBAC — `@casl/ability@7.0.1`

| Package | Version | Verdict |
|---------|---------|---------|
| `casl` | — | 🔴 **Deprecated** → use `@casl/ability` directly. |
| **`@casl/ability`** | **7.0.1** | ✅ **Recommended.** |

Permission-first routing (§1 of the product description: resolve identity → filter tools by RBAC → route) makes
RBAC a hot path on every inbound message, so the ability model must be cheap. `@casl/ability` is a pure
composable rule engine with no Mongo coupling — the subject/conditions resolve against data the routing pipeline
already fetched.

**Enforcement point discipline:** the RBAC check must run **inside the BullMQ consumer**, not in the webhook
receiver (which must ack fast). Both points need the check — the receiver only to reject obviously-unauthorized
requests early, the consumer authoritatively — but only the consumer's check is load-bearing. Any route that
enforces RBAC in only one of the two places is a security finding.

---

## 9. Frontend — Form Renderer & App Builder

### 9.1 Core

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| **React** | **19.3.0** | Both web apps | Current stable | HIGH |
| **Vite** | **8.3.2** | Build/dev server | Current stable (corrected from 8.3.1) | HIGH |
| `@vitejs/plugin-react` | 6.1.1 | React plugin | Has optional peers (`oxc-transform-react`, `@rolldown/plugin-babel`) — harmless | HIGH |
| **`@formio/js`** | **5.6.1** | Form engine + **drag-and-drop builder** | See §9.2 | HIGH (packaging) / MEDIUM (migration — spike S1) |
| `react-hook-form` | 7.89.0 | App Builder **chrome** forms only | **Never** for rendered forms — FormIO owns its own form state, and re-rendering it through RHF fights the engine. App Builder chrome is app name, trigger config, role picker — plain inputs, no shared state with the rendered form. | HIGH |
| `@tanstack/react-query` | 5.104.0 | Server state | Standard | HIGH |

### 9.2 The `@formio/js` decision — the single most important packaging choice in the frontend

| Question | Answer | Evidence |
|----------|--------|----------|
| **`formiojs` or `@formio/js`?** | **`@formio/js` 5.6.1** | Official README: *"The `formiojs` namespace changes from `formiojs` (4.x) to `@formio/js` (5.x)"*. `formiojs@4.21.7` is in **official maintenance mode**: *"No new features will be added to version 4.x. Only bug fixes and security updates will be provided."* |
| **Is the drag-and-drop builder in the OSS build?** | **Yes.** | Official README: *"**Complete Form Builder** which creates the JSON schema used to render the forms"*, with a `Formio.builder(el, {}, {})` example. Verified directly in the **npm tarball**: contains `dist/formio.builder.min.css`, `lib/cjs/FormBuilder.js`, `lib/mjs/FormBuilder.js`, `WebformBuilder.js`, `builders/Builders.js`, and declares `dragula@^3.7.3` as a direct dependency — that *is* the drag-and-drop engine. |
| **License?** | **MIT** (registry `license` field) | ✅ No Form.io server or premium component required. **AD-3 / PRD §7.4 "open source" holds.** |
| **Framework wrapper or plain JS?** | **Plain `@formio/js`** | There is **no `@formio/vanilla` package** (registry 404, verified) — so plain `@formio/js` is the only framework-neutral option and the only way builder and renderer share one engine. `@formio/react@6.2.1` exists and supports React 19, but couples the renderer to a React major for zero benefit. |
| **CDN builds?** | **No — bundle from npm** | `cdn.form.io/js/formio.full.min.js` is builder+renderer; `formio.embed.js` is ~10 KB render-only. Referenced here only to explain the split. SRI-pinning a third-party CDN breaks NFR-SEC-3 and adds an external availability dependency. |
| **Module system?** | Dual CJS/ESM | Verified: tarball ships both `lib/cjs` and `lib/mjs`. No ESM-migration problem. |

### 9.3 ⚠️ FormIO 5.x breaking changes the prior pass did not record

These are the things that surface as "the form renders wrong" three weeks into Phase 3:

| Change | Consequence |
|--------|-------------|
| **Bootstrap 5 is now the default** | Any custom CSS written against Bootstrap 4 grid/utilities breaks silently. Templates from the FormIO template library may need updating. |
| **Templates moved to a separate repository** | `bootstrap` is now a **direct dependency** of the package rather than something templates carried. Verify which templates are reachable and pinned. |
| **`component.error` → `component.errors` (array)** | Any custom validation logic reading the old single-value field silently stops firing — or throws on undefined. |
| **`EditGrid.validateRows` now returns an array** | Custom validators written against the old boolean return break. |

### 9.4 ⚠️ Adoption signal — 5.x is early, and that warrants a spike

| Package | Weekly downloads |
|---------|------------------|
| `formiojs` 4.x (maintenance mode) | **57K** |
| **`@formio/js` 5.x (current)** | **52K** |

**5.x has fewer weekly downloads than the maintenance-mode 4.x it replaces.** That is not a reason to reject 5.x —
4.x is EOL for features and shipping 5.x now is cheaper than a migration later — but it *is* a reason to assume the
5.x ecosystem (templates, community components, docs examples, Stack Overflow answers) is thinner than it looks.
**This is the basis for spike S1 in §15.1.** Do not let it block Phase 3, but do not skip the spike either.

### 9.5 Zero-downtime deploys and route diagnostics (NestJS 12)

NFR requires **zero-downtime rolling deploys**. Two NestJS 12 features support it, both worth opting into:

- **Express adapter now drains in-flight requests on shutdown.** This is what makes a rolling deploy actually
  zero-downtime rather than "usually zero-downtime". Enable it; verify the grace period exceeds the p99
  connector timeout.
- **Opt-in route diagnostics:** `{ duplicate: 'error', shadow: 'warn' }` plus
  `route: { strategy: 'specificity' }`. Worth enabling **on webhook routes specifically** — a shadowed
  webhook route means one platform's messages are being silently handled by a handler meant for another, which
  is exactly the class of bug that survives to production because nothing errors.

---

## 10. Testing & dev tooling

### 10.1 Test stack

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| **`vitest`** | **5.0.3** | Unit + integration tests (server) | NestJS 12's ESM projects default to **Vitest**; the framework team migrated all repos off Jest. Aligns with `nest new` output. (Corrected from 5.0.2.) | HIGH |
| **`@playwright/test`** | **1.63.0** | E2E — UI **and** API | PRD §17.1 already commits to Playwright. Also **the only practical way to UAT FormIO's drag-and-drop builder** — you cannot assert "an admin can drag a field onto a form" with unit tests. | HIGH |
| **`testcontainers`** | **12.2.0** | Real MongoDB + Redis in integration tests | 🔴 Mocks would not catch the `GETDEL` atomicity (NFR-SEC-1) or BullMQ retry/DLQ behaviour that FR-C-* depends on. Those are the two highest-risk behaviours in the system and both are Redis-semantics-dependent. Engines `>=22.22` — satisfied. | HIGH |
| `fast-check` | 4.10.2 | Property-based testing | Valuable for the JEV routing layer: "no input produces a routing decision that bypasses RBAC" is a property, not an example. | HIGH |
| `msw` | 3.0.1 | HTTP mocking for connector tests | Where testcontainers is not warranted (third-party APIs) | HIGH |
| `@faker-js/faker` | 10.6.0 | Fixture data | Standard | HIGH |

### 10.2 Dev tooling

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| **ESLint** `10.11.0` | 10.11.0 | Linting + **architecture enforcement** | **Chosen over the NestJS 12 scaffold default (oxlint).** See §3.5 and §10.2: `eslint-plugin-boundaries@7.2.0` is ESLint-only and is required by the boundary-violation-fails-the-build constraint; and typescript-eslint is the *hard* enforcer of the TypeScript pin. `typescript-eslint@8.71.0` supports ESLint `^8.57 \|\| ^9 \|\| ^10`. | HIGH |
| `eslint-plugin-boundaries` | **7.2.0** | Enforces modular-monolith boundaries at lint time | The PROJECT constraint is "a lint rule that fails the build on a boundary violation". This is it. | HIGH |
| `typescript-eslint` | **8.71.0** | TS-aware lint | Its peer `typescript: ">=4.8.4 <6.1.0"` **without** `peerDependenciesMeta` is the hard ERESOLVE in §3.2. | HIGH |
| npm **workspaces** | — | Monorepo | **2 web apps + 1 API + 1 worker.** Workspaces are enough; a build-graph tool is unjustified overhead at this size. See §12. | HIGH |
| `csv-parse` | 7.0.3 | Bulk import/export | Audit exports, submission CSV | HIGH |
| `jsonata` | 2.2.2 | Transformation for connector payloads | Field mapping without code | HIGH |
| `helmet` | 8.3.0 | HTTP security headers | Standard | HIGH |

---

## 11. Installation

Two things must be true on a fresh clone before any application code is written. Both are verifiable in one command.

```bash
# ---- 0. Node floor: .nvmrc contains 24 ------------------------------------
cat .nvmrc            # -> 24
node --version        # -> v24.x

# ---- 1. Core framework ----------------------------------------------------
npm i @nestjs/core@12.1.2 @nestjs/common@12.1.2 @nestjs/platform-express@12.1.2
npm i @nestjs/config@12.0.1 @nestjs/swagger@12.0.2
npm i zod@4.6.5
npm i rxjs@^7.8 reflect-metadata@^0.2

# ---- 2. Data --------------------------------------------------------------
# MONGO: 8.0.x ONLY. 8.2 is EOL 2026-07-31. 8.3.x is an acceptable alternative.
npm i mongodb@7.7.0          # NOT mongoose - schemas are runtime-defined

# ---- 3. Queue + Redis -----------------------------------------------------
npm i bullmq@6.3.11 bullmq-otel@2.0.1 @nestjs/bullmq@12.0.0
npm i ioredis@6.0.0          # NOT 5.x (High advisory), NOT node-redis

# ---- 4. Security ----------------------------------------------------------
npm i jose@6.2.12            # NOT @nestjs/jwt (no JWKS, no kid keyring)
npm i openid-client@6.8.8    # OIDC. ESM-only. SAML deferred - see S3
npm i @node-rs/argon2@2.2.1
npm i @casl/ability@7.0.1
npm i @nestjs/throttler@6.7.1 helmet@8.3.0
# AES-256-GCM: Node stdlib `crypto`. No package.
# Rate-limit storage: hand-written `ThrottlerStorage` over ioredis. No package.

# ---- 5. Observability -----------------------------------------------------
npm i @opentelemetry/sdk-node@0.222.0 \
     @opentelemetry/api@1.9.1 \
     @opentelemetry/core@2.11.0 \
     @opentelemetry/auto-instrumentations-node@0.80.0 \
     @opentelemetry/exporter-trace-otlp-http@0.222.0 \
     @opentelemetry/exporter-metrics-otlp-http@0.222.0 \
     @opentelemetry/exporter-prometheus@0.222.0 \
     @opentelemetry/semantic-conventions@1.43.0
# @opentelemetry/core MUST be listed explicitly - the auto-bundle only peers on ^2.0.0
npm i pino@10.3.1 pino-http@11.0.0 nestjs-pino@5.2.1
npm i @nestjs/terminus@12.1.0
# prom-client is DEPRECATED. One metrics path only.

# ---- 6. HTTP (undici already ships with Node 24 via global fetch) ---------
npm i undici@8.11.2

# ---- 7. IM adapters -------------------------------------------------------
npm i @slack/bolt@5.1.0
npm i @microsoft/agents-hosting@1.9.1 \
     @microsoft/agents-hosting-express@1.9.1 \
     @microsoft/agents-hosting-activity@1.9.1 \
     @microsoft/agents-hosting-extensions-msteams@1.9.1
# Zalo (Phase 4): no dependency. Hand-rolled ~200-line client over undici. See S2.
# Telegram (Phase 5): npm i node-telegram-bot-api@2.1.0

# ---- 8. Frontend (Form Renderer + App Builder) ---------------------------
npm i -w apps/web-form-renderer @formio/js@5.6.1 react@19.3.0 react-dom@19.3.0
npm i -D -w apps/web-form-renderer vite@8.3.2 @vitejs/plugin-react@6.1.1
npm i -w apps/web-app-builder react@19.3.0 react-dom@19.3.0 \
     react-hook-form@7.89.0 @tanstack/react-query@5.104.0
npm i -D -w apps/web-app-builder vite@8.3.2 @vitejs/plugin-react@6.1.1

# ---- 9. Dev + test --------------------------------------------------------
npm i -D typescript@6.0.3          # EXACT PIN. No caret. No tilde. See section 3.
npm i -D eslint@10.11.0 \
     eslint-plugin-boundaries@7.2.0 \
     @typescript-eslint/eslint-plugin@8.71.0 \
     @typescript-eslint/parser@8.71.0
npm i -D vitest@5.0.3 @playwright/test@1.63.0 \
     testcontainers@12.2.0 fast-check@4.10.2 msw@3.0.1 @faker-js/faker@10.6.0
npm i csv-parse@7.0.3 jsonata@2.2.2
```

### 11.1 The two-step verification that proves the pin

```bash
git add package.json package-lock.json .nvmrc
git commit -m "chore: pin Node 24, NestJS 12.1.2, TypeScript 6.0.3; commit lockfile"

# Prove it on a clean tree, exactly as CI will see it:
rm -rf node_modules
npm ci                    # must succeed with ZERO ERESOLVE and ZERO TS peer warnings
npx tsc --version         # must print 6.0.3, and must be the ONLY tsc in the tree
npm ls typescript         # must show exactly one 6.0.3, no 7.x, no duplicate
```

**If `npm ci` fails, the pin or the lockfile is wrong. Fix that before writing any application code.**
If `npm ls typescript` shows two versions, enforcer #3 from §3.2 has been tripped — a nested copy arrived
via `@nestjs/cli`'s `~6.0.2` dependency and the root pin is not being honoured.

### 11.2 Infrastructure floors for local dev and CI

| Service | Version | Hard rule |
|---------|---------|-----------|
| MongoDB | **8.0.x** | Never 8.2 (EOL 2026-07-31). |
| Redis | **≥8.2**, dev on **8.10.x** | Never 8.0.x (EOL 2026-12-01). |
| Node | **24.x** | Pinned in `.nvmrc`, Dockerfile, and the CI matrix — all three. |

Local dev runs these in containers via `testcontainers` (integration tests) and a compose file (day-to-day).
CI must use the same major/minor lines as production; a version drift between CI and prod is how
`GETDEL`-dependent and BullMQ-dependent behaviour passes in CI and fails in production.

---

## 12. Rejected alternatives — the consolidated list

Everything the prior pass rejected **plus** this pass's additions. Kept in one table so a future phase does not
re-litigate a decision without reading why it was made.

| Category | Rejected | Why not |
|----------|----------|---------|
| Language | **TypeScript 7.0.2** (npm `latest`) | `typescript-eslint@8.71.0` peers `>=4.8.4 <6.1.0` — hard ERESOLVE. **Pin 6.0.3.** §3. |
| Validation | **`class-validator@0.15.1`** | Last published 2026-02-26. Superseded by Standard Schema. Also now an **optional** peer of `@nestjs/common` — not installed unless needed. |
| Validation | **`class-transformer@0.5.1`** | First published **2021-11-22**. Four-plus years stale; `ValidationPipe` depends on it. |
| Validation | **`nestjs-zod@5.5.0`** | 🔴 **Peers `@nestjs/common ^10 \|\| ^11` — incompatible with NestJS 12.** The framework now does this natively; the package's own docs already deprecate `ZodGuard`. |
| Validation | **`zod-nestjs@1.9.2`**, **`@anatine/zod-dto`** (404) | 2023 vintage / does not exist. |
| JSON Schema | **`zod-to-json-schema`** | Zod 4 ships `z.toJSONSchema()` natively. Redundant. |
| MongoDB access | **`mongoose@9.10.3`** | Schema model is compile-time; our schemas are runtime-defined. `instrumentation-mongodb` covers the raw driver. |
| Redis client | **`redis` (node-redis) 6.3.0** | BullMQ ships ioredis; cluster is the mature path; OTel bundles `instrumentation-ioredis` but not node-redis's. |
| Redis client | **`ioredis` 5.x** | 🔴 High *Uncontrolled Recursion* advisory, fixed in 6.0.0. **Never pin 5.x.** |
| HTTP adapter | **`fastify` / `@nestjs/platform-fastify` 5.12.5** | Bolt 5 bundles `express@^5`; OTel bundles `instrumentation-express` but **not** `instrumentation-fastify`; `instrumentation-fastify@0.57.0` is **deprecated**; and `@microsoft/agents-hosting-express` is the supported Teams host. No benefit at 1,000 users. |
| Rate limiting | **`@fastify/rate-limit`** | Fastify-only — dies with the Express decision. |
| Rate limiting | **community Redis throttler storages** | `kkoomen/throttler-storage-redis` **405/deprecated**; `@nest-lab/throttler-storage-redis` peers NestJS ≤11; `@nestjs-redis/throttler-storage` peers node-redis. **Hand-write it** — §8.2. |
| CSRF | **`csurf@1.11.0`** | npm metadata: *"archived and no longer maintained."* We use a **structural** mitigation instead: the form-renderer origin never receives a cookie. |
| Auth (app tokens) | **`@nestjs/jwt@12.0.2`** | Wraps `jsonwebtoken@9.0.3` — no JWKS, no `kid` keyring. NFR-SEC-9 rotation becomes hand-built. |
| Auth (SSO) | **`@nestjs/passport` + `passport`** | `passport@0.7.0` first published **2023-11-27**. Also would wrap the `jsonwebtoken` we just rejected. `openid-client` is the better fit. |
| Teams SDK | **`botbuilder@4.23.3`** | Bot Framework **retired**: archived repo, support ended **2025-12-31**, last publish 2025-08-27. |
| Teams SDK | **`botframework-sdk`** | 🔴 **Does not exist on npm** (404). The PRD names a phantom package. |
| Teams SDK | **`-extensions-teams`** | 🔴 **npm-deprecated by its own publisher.** Use `-extensions-msteams`. |
| Zalo SDK | `zca-js`, `node-zalo-bot`, `@warriorteam/redai-zalo-sdk`, n8n nodes | No official Node SDK exists. Unofficial/unlicensed/community wrappers are supply-chain risk under NFR-SEC-12. **Hand-roll over `undici`.** |
| Telegram SDK | **`grammy@1.46.0`** | Depends on `node-fetch@^2.7.0` — **un-instrumented HTTP path**, breaks NFR-O-1 continuity. |
| Scheduling | **`@nestjs/schedule@12.0.2`** for durable jobs | In-memory, per-instance. A JWT rotation that silently doesn't run on one pod is a **security failure**. BullMQ Job Schedulers only, except sub-minute local ticks. |
| HTTP client | **`axios` / `@nestjs/axios`** | OTel bundles `instrumentation-undici`, not axios. A second, un-instrumented HTTP path is exactly where NFR-O-1 breaks. **Slack's own Bolt 5 made this same change.** |
| Metrics | **`prom-client@15.1.3`** | 🔴 **Now deprecated** ("replaced by `@prometheus-io/client`"). Also: two scrape endpoints = two naming conventions = split alerts. **One path:** OTel metrics API → `exporter-prometheus`. |
| Observability | **`@nestjs/observe`** | 🔴 **No OTLP exporter.** Vendor APM with its own hosted backend; its README says *"not a replacement for OpenTelemetry."* Data-residency problem under our region-lock constraint. **Closed gap — cancelled re-evaluation.** |
| Observability | **`instrumentation-fastify`** | Deprecated ("use `@fastify/otel`"). Moot — we use Express. |
| Sessions | **`@fastify/session`** | AD-9: application services are stateless, all session state in Redis. Nothing to gain. |
| IDs | **`uuid` / `nanoid`** | PRD IDs are UUID-shaped (`map_uuid`). `crypto.randomUUID()` is **Node stdlib** — zero dependencies. |
| Password hashing | **`argon2` (node-gyp)**, **`bcrypt`** | Native build tax in CI; bcrypt's 72-byte truncation limit. → `@node-rs/argon2`. |
| RBAC | **`casl`** | Deprecated → `@casl/ability@7.0.1` directly. |
| Misc | **`express-async-errors@3.1.1`** | 2018 vintage; Express 5 forwards rejected promises natively. No-op at best. |
| Misc | **`ts-node@10.9.2`**, **`cache-manager-redis-yet`**, **`zalo-oa`** | Deprecated or years stale. |
| Misc | **`turbo@2.11.6`**, **`nx@23.2.1`** | Build-graph tooling is unjustified at 2 web apps + 1 API + 1 worker. npm workspaces. |
| Licensing | 🔴 **`ua-parser-js@2.0.10`** | **`AGPL-3.0-or-later`.** Disqualifying for this enterprise/OSS posture, and several IM/UA-parsing helpers pull it in transitively. **Pin-exclude it** in CI dependency scanning. |

---

## 13. Architecture-critical patterns this stack implies

The full architecture is in `ARCHITECTURE.md`. These are the stack-level facts a phase plan must not violate,
because violating them causes rewrites rather than bugs.

### 13.1 The webhook receiver contract (ack <200 ms, enqueue, nothing else)

```
IM platform ──HTTP──▶ Receiver ──▶ [verify signature] ──▶ [ack] ──▶ BullMQ ──▶ Consumer
                        (≤200 ms)     (cheap, no I/O)                   (all logic)
```

- **Nothing expensive runs in the receiver.** No permission lookup. No DB read. No LLM call. No connector call.
  Slack's limit is a 3-second ack with 3 retries; Teams returns 429/502 and the platform retries with jitter. A
  slow permission lookup inside the receiver is precisely how submissions get lost.
- **The receiver is a pure ingest contract.** It enqueues a message ID and returns.
- **All logic runs in the consumer** — identity resolution, RBAC filter, JEV routing, form issuance, submission
  handling.
- **RBAC is enforced authoritatively in the consumer** (§8.7). An early check in the receiver is an optimisation,
  not the control.
- **The trace starts at the receiver** (NFR-O-1) and propagates into the consumer via `bullmq-otel`. This is the
  hop where trace IDs are usually lost, and the reason that package exists.

### 13.2 Token lifecycle — `GETDEL`, no exceptions

```
Consumer: SET one-time-token <jti> EX <ttl>        (issue, after form render)
Browser:  GET one-time-token <jti>                 → value
          GETDEL one-time-token <jti>               (atomic consume — Redis ≥6.2.0)
```

`GETDEL` is atomic server-side, which is what makes NFR-SEC-1 ("atomic consumption, no race conditions")
true by construction. **Never implement this as `GET` then `DEL`** — that is a TOCTOU race, and under the
read/write link load of a busy app it will double-consume.

Write links (create/edit) use the same mechanism with a shorter TTL. Read links (90-day AD-11) are **stateless
signed JWTs** — asymmetric, so the static Form Renderer can verify without holding the signing key (§5).

### 13.3 Dynamic collections, one repository shape

App Builder authors define fields at runtime → **one MongoDB collection per app** (or per app+form), with a thin
typed repository over the native driver. Do **not** introduce a per-app Mongoose `Schema`, and do not introduce a
generic EAV schema — the second would make every submission write a join.

The per-app schema definition itself is stored as a first-class document; it is the contract the App Builder UI
edits and the connector layer validates against.

### 13.4 Monorepo layout (three entrypoints, one DI graph)

```
apps/
  api/        NestJS HTTP — webhook receivers, form rendering API, admin API
  worker/     BullMQ consumers — routing, connectors, submissions
  scheduler/  BullMQ Job Schedulers — key rotation, archival, retention sweeps
  web-form-renderer/   Vite + React + @formio/js   (static; verifies JWTs)
  web-app-builder/     Vite + React               (admin UI)
packages/
  shared/     Zod schemas, RBAC types, IM adapter contracts, link-token helpers
```

One codebase, one DI graph, three processes. **The lint rule is what keeps `api` from importing BullMQ worker
code** — which is the specific boundary whose violation turns a modular monolith into an undeployable tangle.
`@nestjs/bullmq` registers processors, so a worker-only provider accidentally imported into `api` fails to
resolve at boot in `api` but works in `worker`. That asymmetry is precisely why the boundary needs a *build-time*
check rather than a runtime one.

### 13.5 ESM decision — make it once, early

`jose` and `openid-client` are **ESM-only**. NestJS 12 is ESM-first but CommonJS still works. **Decide CJS-vs-ESM
once in the scaffolding phase and record it in CONVENTIONS.md.** A half-ESM codebase is a reliable source of
`ERR_REQUIRE_ESM` bugs that surface at the worst possible time.

### 13.6 Proxy-aware HTTP as a shared helper

Because Slack, Redmine, ERP connectors, and webhook callbacks all plausibly sit behind a corporate egress proxy,
build **one** `undici`-based HTTP client module with optional `ProxyAgent` support, and inject it everywhere. Do
not let each connector grow its own fetch wrapper — that is how you get inconsistent timeouts, inconsistent
retries, and inconsistent trace propagation.

---

## 14. Version verification ledger

Every row resolved live against `registry.npmjs.org` on **2026-10-01**. Nothing here comes from recall.

| Package | Version | Verified via | `time.modified` | Confidence |
|---------|---------|--------------|-----------------|------------|
| `@nestjs/core`, `/common`, `/platform-express`, `/testing` | **12.1.2** | npm `dist-tags` | 2026-09-28 | HIGH |
| `@nestjs/config` | 12.0.1 | npm registry | 2026-09-22 | HIGH |
| `@nestjs/swagger` | 12.0.2 | npm registry + TS peer `^5.5 \|\| ^6.0` (**optional**) | 2026-09-23 | HIGH |
| `@nestjs/jwt` | 12.0.2 | npm registry (+ dep on `jsonwebtoken@9.0.3`) | 2026-09-14 | HIGH |
| `@nestjs/throttler` | 6.7.1 | npm registry + engines `^20.19.0 \|\| ^22.12.0 \|\| >=24.0.0` | 2026-09-24 | HIGH |
| `@nestjs/terminus` | 12.1.0 | npm registry | 2026-09-20 | HIGH |
| `@nestjs/event-emitter` | 12.0.1 | npm registry | 2026-09-14 | HIGH |
| `@nestjs/schedule` | 12.0.2 | npm registry | 2026-09-14 | HIGH |
| `@nestjs/mongoose` | 12.0.0 | npm registry (peer `mongoose ^7\|\|^8\|\|^9`) | 2026-08-27 | HIGH |
| `@nestjs/bullmq` | 12.0.0 | npm registry (peer `bullmq ^3–^6`) | 2026-08-27 | HIGH |
| `@nestjs/passport` | 12.0.0 | npm registry | 2026-08-27 | HIGH |
| `@nestjs/cli` | 12.0.8 | npm registry + hard dep `typescript@~6.0.2` | 2026-09-28 | HIGH |
| `@nestjs/observe` | 0.3.5 | npm registry — **rejected, no OTLP** | 2026-09-28 | HIGH |
| `bullmq` | **6.3.11** | npm registry (optional peer `bullmq-otel >=2.0.0`; dep `cron-parser`) | 2026-09-29 | HIGH |
| `bullmq-otel` | 2.0.1 | npm registry (peer `bullmq >=6.0.0`) | 2026-08-18 | HIGH |
| `ioredis` | 6.0.0 | npm registry + Snyk advisory table (dep `cluster-key-slot`) | 2026-07-31 | HIGH |
| `redis` (node-redis) | 6.3.0 | npm registry — **rejected** | 2026-09-28 | HIGH |
| `mongodb` | 7.7.0 | npm registry | 2026-09-30 | HIGH |
| `mongoose` | 9.10.3 | npm registry (engines `>=20.19.0`) — **rejected** | 2026-09-29 | HIGH |
| `zod` | 4.6.5 | npm registry (dual CJS/ESM) | 2026-09-25 | HIGH |
| `class-validator` | 0.15.1 | npm registry — **optional peer** of `@nestjs/common` | 2026-02-26 | HIGH |
| `class-transformer` | 0.5.1 | npm registry, first published **2021-11-22** | — | HIGH |
| `jose` | 6.2.12 | npm registry (**ESM-only**) | 2026-09-05 | HIGH |
| `jsonwebtoken` | 9.0.3 | npm registry (as `@nestjs/jwt` and Agents SDK dep) | 2026-07-08 | HIGH |
| `passport` | 0.7.0 | npm registry, first published **2023-11-27** | — | HIGH |
| `openid-client` | 6.8.8 | npm registry (**ESM-only**; 16.7M dl/wk) | 2026-09-05 | HIGH |
| `@node-saml/node-saml` | 5.1.0 | npm registry — last published **2025-07-21** → deferred | 2025-07-21 | MEDIUM |
| `@casl/ability` | 7.0.1 | npm registry | — | HIGH |
| `@slack/bolt` | 5.1.0 | npm registry + Slack v5 release note (2026-07-15) | 2026-09-02 | HIGH |
| `@slack/web-api` | 8.1.1 | npm registry (dep of Bolt 5) | 2026-08-27 | HIGH |
| `botbuilder` | 4.23.3 | npm registry — **retired SDK** | 2025-08-27 | HIGH |
| `botframework-sdk` | **does not exist** | npm registry → **HTTP 404** | — | HIGH |
| `@microsoft/agents-hosting` | 1.9.1 | npm registry (deps: `zod@3.25.75`, `jsonwebtoken@9.0.3`) | 2026-09-29 | HIGH |
| `@microsoft/agents-hosting-express` | 1.9.1 | npm registry — **required Express host** | 2026-09-29 | HIGH |
| `@microsoft/agents-hosting-extensions-msteams` | 1.9.1 | npm registry — ✅ the correct one | 2026-09-29 | HIGH |
| `@microsoft/agents-hosting-extensions-teams` | 1.9.1 | npm registry, **`deprecated` field set** | 2026-09-29 | HIGH |
| `@microsoft/agents-activity` | 1.9.1 | npm registry | 2026-09-29 | HIGH |
| `node-zalo-bot` | 0.1.6 | npm registry — 277 dl/wk, **no license field**, no repo | — | HIGH |
| `zca-js` | 2.2.0 | npm registry — MIT but self-described "Unofficial" | — | HIGH |
| `node-telegram-bot-api` | 2.1.0 | npm registry (modified 2026-08-24) | 2026-09-07 | MEDIUM |
| `grammy` | 1.46.0 | npm registry (dep `node-fetch@^2.7.0`) | 2026-08-26 | MEDIUM |
| `@formio/js` | 5.6.1 | npm registry — **MIT**, dual CJS/ESM, dep `dragula@^3.7.3`; **tarball verified** to contain `dist/formio.builder.min.css`, `lib/{cjs,mjs}/FormBuilder.js`, `WebformBuilder.js`, `builders/Builders.js`; **52K dl/wk** | 2026-09-22 | HIGH |
| `formiojs` | 4.21.7 | npm registry + official README ("maintenance mode"); **57K dl/wk** | 2026-09-28 | HIGH |
| `@formio/vanilla` | **does not exist** | npm registry → **HTTP 404** | — | HIGH |
| `@formio/react` | 6.2.1 | npm registry (React 19 support) | 2026-06-03 | HIGH |
| `react` / `react-dom` | 19.3.0 | npm registry | 2026-09-29 | HIGH |
| `vite` | **8.3.2** | npm registry | 2026-09-24 | HIGH |
| `@vitejs/plugin-react` | 6.1.1 | npm registry (optional peers `oxc-transform-react`, `@rolldown/plugin-babel`) | 2026-09 | HIGH |
| `undici` | 8.11.2 | npm registry (engines `>=22.19.0`) | 2026-09-25 | HIGH |
| `helmet` | 8.3.0 | npm registry | — | HIGH |
| `@node-rs/argon2` | 2.2.1 | npm registry (engines `>=10`, prebuilt N-API) | 2026-09-10 | HIGH |
| `bcrypt` | 6.0.0 | npm registry (72-byte truncation limit) | — | HIGH |
| `pino` / `pino-http` / `nestjs-pino` | 10.3.1 / 11.0.0 / 5.2.1 | npm registry (`nestjs-pino` peers `@nestjs/core ^11.0.8 \|\| ^12.0.2`) | 2026-08/09 | HIGH |
| `@opentelemetry/sdk-node` + OTLP exporters | 0.222.0 | npm registry | 2026-09-21 | HIGH |
| `@opentelemetry/exporter-jaeger`, `-zipkin` | 2.11.0 | npm registry — **OTLP/Tempo path confirmed** | 2026-08-31 | HIGH |
| `@opentelemetry/api` | 1.9.1 | npm registry | 2026-05-01 | HIGH |
| `@opentelemetry/core` | **2.11.0** | npm registry — **must be installed explicitly** (auto-bundle peers `^2.0.0`) | 2026-09-21 | HIGH |
| `@opentelemetry/auto-instrumentations-node` | 0.80.0 | npm registry (49 deps enumerated; **no `fastify`**) | 2026-08-31 | HIGH |
| `@opentelemetry/instrumentation-nestjs-core` | 0.68.0 | npm registry | 2026-08-31 | HIGH |
| `@opentelemetry/instrumentation-pino` | 0.68.0 | npm registry | 2026-08-31 | HIGH |
| `@opentelemetry/instrumentation-ioredis` | 0.70.0 | npm registry | 2026-08-31 | HIGH |
| `@opentelemetry/instrumentation-mongodb` | 0.75.0 | npm registry | — | HIGH |
| `@opentelemetry/instrumentation-express` | 0.70.0 | npm registry | — | HIGH |
| `@opentelemetry/instrumentation-fastify` | 0.57.0 | npm registry — **DEPRECATED** ("use `@fastify/otel`"), **not** in auto-bundle | 2026-05-01 | HIGH |
| `@opentelemetry/semantic-conventions` | 1.43.0 | npm registry | — | HIGH |
| `prom-client` | 15.1.3 | npm registry — **DEPRECATED** ("replaced by `@prometheus-io/client`") | — | HIGH |
| `eslint` | 10.11.0 | npm registry (supported by typescript-eslint `^8.57\|\|^9\|\|^10`) | — | HIGH |
| `eslint-plugin-boundaries` | 7.2.0 | npm registry — **ESLint-only**; required for boundary enforcement | — | HIGH |
| `typescript-eslint` | **8.71.0** | npm registry — peer `typescript: ">=4.8.4 <6.1.0"`, **no optional marking** | — | HIGH |
| `typescript` | 7.0.2 latest / **6.0.3 pinned** | npm registry `dist-tags` | 2026-09-30 | HIGH |
| `vitest` | **5.0.3** | npm registry | 2026-09-25 | HIGH |
| `@playwright/test` | 1.63.0 | npm registry | 2026-09-30 | HIGH |
| `testcontainers` | 12.2.0 | npm registry (engines `>=22.22`) | — | HIGH |
| `fast-check` | 4.10.2 | npm registry | — | HIGH |
| `msw` | 3.0.1 | npm registry | — | HIGH |
| `@faker-js/faker` | 10.6.0 | npm registry | — | HIGH |
| `csv-parse` | 7.0.3 | npm registry | — | HIGH |
| `jsonata` | 2.2.2 | npm registry | — | HIGH |
| `turbo` | 2.11.6 | npm registry — **rejected** | — | HIGH |
| 🔴 **`ua-parser-js`** | 2.0.10 | npm registry — **`AGPL-3.0-or-later`**. **Do not use.** | — | HIGH |
| **Redis `GETDEL`** | since **6.2.0** | redis.io command metadata, field `"since": "6.2.0"` | — | HIGH |
| **Node.js** | 24.x LTS | endoflife.date — **Node 20 EOL 2026-04-30** | — | HIGH |
| **MongoDB** | 8.0.x / EOL 2029-10-31 | endoflife.date — **8.2 EOL 2026-07-31**; 8.3 EOL 2029-10-31; 9.0 released 2026-09-30 | — | HIGH |
| **Redis** | ≥8.2 floor, 8.10.x current | endoflife.date — **8.0.x EOL 2026-12-01**; 8.2 EOL 2030-09-01; 8.4/8.6/8.8/8.10 `eol:false` | — | HIGH |
| Bot Framework retirement | support ended **2025-12-31** | Microsoft Learn / Azure Bot Service docs | — | HIGH |
| Slack Bolt 5 | released 2026-07-15, Node ≥20, axios→fetch | Slack Developer Docs changelog | — | HIGH |
| NestJS 12 | released 2026-08-28; Standard Schema, oxlint+Vitest scaffold | `nestjs/nest` GitHub v12.0.0 release notes | — | HIGH |
| FormIO 4.x maintenance mode | verbatim README statement | formio.js official README | — | HIGH |
| BullMQ v6 breaking changes | Job Schedulers; async `resume()`; `debounce` removed | docs.bullmq.io official migration guide | — | HIGH |
| Throttler v6 `ttl` in ms; `handleRequest()` per named throttler | official throttler docs | — | HIGH |

### 14.1 End-of-life timeline — the single most decision-relevant table here

| Component | Line | EOL | Days from 2026-10-01 |
|-----------|------|-----|---------------------|
| Node.js | 20 | **2026-04-30** | 🔴 **already EOL** |
| MongoDB | 8.2 | **2026-07-31** | 🔴 **already EOL** |
| Redis | 8.0.x | **2026-12-01** | 🔴 **62 days** |
| Node.js | 22 | 2027-04-30 | 546 |
| MongoDB | 7.0 | 2027-08-31 | 669 |
| Redis | 7.4 | 2029-12-01 | 1157 |
| Node.js | **24 (ours)** | **2028-04-30** | 942 |
| MongoDB | **8.0 (ours)** | **2029-10-31** | 1091 |

**Read the top three rows as a single warning.** Every one of them was a plausible-looking choice at some point in
the last two years, and every one of them is now — or within two months — — unsupported. **This is the
justification for expressing Redis as a floor (`≥8.2`) rather than a pin**, and for the NFR-SEC-12 requirement
that dependency scanning gate deployment rather than merely reporting.

---

## 15. Open items, gaps, and what could not be verified

**This section is the honest part of the document.** Three prior gaps are closed (§2.1). These remain open and
each has an explicit owner and a phase.

### 15.1 Spikes required before the phase that depends on them

| ID | Question | Blocks | Why it can't be resolved by reading | Suggested resolution |
|----|----------|--------|----------------------------------------|----------------------|
| **S1** | **`@formio/js` 5.6.1 migration spike.** Render + build a representative form; port one Bootstrap-4-era template; verify `component.errors` and `EditGrid.validateRows` changes. | Phase 3 (Form Renderer + App Builder) | 5.x has **fewer** weekly downloads than the 4.x it replaces (§9.4). Docs/examples/Stack Overflow are likely still 4.x. Breaking changes are documented (§9.3) but their *runtime* impact on a real template is empirical. | **Half-day spike.** Time-boxed: if the port is ugly, the fallback is `formiojs@4.21.7` (MIT, maintenance mode) — acceptable but must be an explicit decision, not a drift. |
| **S2** | **Zalo OA client spike.** Authenticate, send a message, receive + verify a webhook, against a real OA. | Phase 4 (Zalo) | **No official Node SDK and no official Node docs** (§7.4). Every implementation reference is community-authored and the API has no changelog discipline. Undocumented behaviour changes are likely. | **Two-day spike on a real OA account.** Budget contingency in Phase 4. Every alternative package is worse (§7.4), so this is a spike, not a choice. |
| **S3** | **SAML need confirmation — a *customer* question, not a technical one.** | Phase 1 discovery, not implementation | Whether SAML is a v1 blocker depends entirely on which IdPs the target enterprise uses. Unknowable from inside the repo. | **Ask in Phase 1 discovery:** "Which IdP do you use, and does it support OIDC?" OIDC covers Entra ID, Okta, Auth0, Google Workspace, Keycloak. SAML is legacy-IdP-only, and the only library (`@node-saml/node-saml@5.1.0`) has been quiet since 2025-07-21. |

### 15.2 Things that remain unverified or deliberately deferred

| Item | Status | Notes |
|------|--------|-------|
| **Zalo webhook signature verification** | ⚠️ **Unverified** | Weakest-documented of the four platforms. If Zalo offers no request-signing mechanism, the platform leg must be protected by network control + replay window rather than HMAC. **Must be answered in S2** — it changes the threat model for that adapter. |
| **Zalo OA API stability** | ⚠️ **Unknown** | No official changelog. The 200-line hand-rolled client is an *ongoing* maintenance liability, not a one-time cost. Flag for post-MVP: monitor Zalo for an official Node SDK. |
| **`@node-saml/node-saml@5.1.0`** | ⚠️ **MEDIUM confidence** | ~14 months since last publish. If S3 says SAML is needed, this needs its own spike **before** it enters a phase. |
| **Throttler 3-tier Redis cost** | ⚠️ **Unmeasured** | 3 named throttlers = 3 Redis round-trips/request (§8.1). Acceptable at NFR-S-1 but must be measured in the load test, not assumed. |
| **`@formio/js` template availability** | ⚠️ **Partially verified** | Templates moved to a separate repo in 5.x and `bootstrap` is now a direct dep (§9.3). Which templates are reachable and pinned needs S1. |
| **MongoDB 9.0** | ⏳ Deliberately not adopted | Released 2026-09-30 — four days old at verification. EOL 2031-10-31 is attractive for a 3-year-retention deployment; **revisit once it has a track record**, likely before the retention window bites. |
| **`@nestjs/observe` re-evaluation** | ✅ **Cancelled** | §2.1 X1 / §6.4. The prior pass said "re-evaluate in Phase 4". **That is cancelled** — it has no OTLP exporter and would break data residency. |
| **OTLP → Tempo/Jaeger** | ✅ **Closed, HIGH** | §6.3 Five exporter packages verified. |
| **EOL dates beyond 2029** | ⚠️ **Published schedules only** | `endoflife.date` reflects vendor-published dates. They can be extended. The 3-year retention obligation is the reason these dates matter at all — a component going EOL mid-retention-window creates a compliance problem, not just a security one. |

### 15.3 What this document does **not** cover

Deliberately out of scope (covered elsewhere or not yet knowable):
- The **JEV decision-model provider** — which model, which host, which cost profile. This is an
  `AI-SPEC.md` question, not a stack question, and it has its own research path.
- **Connector contracts** for Redmine/HR/ERP — per-system, per-phase.
- **Infrastructure-as-code** (Terraform/Helm manifests) — PRD §18 covers the intent; the tooling itself needs a
  platform-team decision, not a research decision.
- **Pricing/licensing** of any commercial service.

---

## 16. Confidence summary

| Area | Confidence | Why |
|------|------------|-----|
| Core framework (Node 24 / NestJS 12.1.2 / Express / TS 6.0.3) | **HIGH** | Four independent enforcers on the TS pin; four independent reasons for Express including a *new* deprecation. Every version resolved from the registry. |
| Data (MongoDB 8.0.x / native driver / ioredis 6 / BullMQ 6.3.11) | **HIGH** | EOL dates verified from `endoflife.date`; the 8.2 trap is now unambiguous; Mongoose rejection is architectural, not version-based. |
| Security (jose / argon2 / throttler / RBAC / AES-GCM) | **HIGH** | `jose` chosen for a *specific* requirement (NFR-SEC-9 `kid` rotation) it uniquely satisfies. All community alternatives for throttler storage are provably dead or incompatible. |
| Observability (manual OTel) | **HIGH** | The last open question (OTLP capability) is now closed with five verified exporter packages. `@nestjs/observe` rejection is documented from its own README. |
| IM adapters — Slack | **HIGH** | First-party SDK, actively maintained, two documented behaviours that reinforce our stack choices. |
| IM adapters — Teams | **HIGH** | First-party successor to a retired SDK, actively published; migration gotchas sourced from Microsoft's own guidance. |
| IM adapters — Telegram | **MEDIUM** | Genuine near-tie between two acceptable libraries; decided on instrumentation continuity, which is a judgement call. |
| IM adapters — Zalo | **HIGH on the decision / LOW on the outcome** | We are confident hand-rolling beats every available package. We are **not** confident the resulting client will be stable — no official docs exist. Hence S2. |
| Frontend (`@formio/js` 5) | **HIGH on packaging / MEDIUM on migration** | MIT, dual CJS/ESM, builder verified present in the tarball. Migration risk is real because 5.x adoption is early. Hence S1. |
| SSO | **HIGH on OIDC / MEDIUM on SAML** | OIDC is a mainstream, actively maintained library whose deps we already chose. SAML's only library has been quiet for ~14 months. |
| Future version numbers | **N/A by construction** | This document is a point-in-time verification (2026-10-01). Re-verify before any phase that pins a version not listed in §14. |

---

## 17. Sources

**Registry metadata (primary — every version in §16):**
- `registry.npmjs.org` — `dist-tags.latest`, `time.modified`, `time.created`/`time[version]`, `peerDependencies`,
  `peerDependenciesMeta`, `engines`, `license`, `deprecated`, `dependencies`
- `@formio/js@5.6.1` **npm tarball, unpacked and inspected directly** — confirmed presence of
  `dist/formio.builder.min.css`, `lib/cjs/FormBuilder.js`, `lib/mjs/FormBuilder.js`, `WebformBuilder.js`,
  `builders/Builders.js`, and the `dragula@^3.7.3` dependency

**End-of-life:**
- `endoflife.date/nodejs`, `endoflife.date/mongodb`, `endoflife.date/redis`
- Redis command reference for `GETDEL` — metadata field `"since": "6.2.0"`

**Official vendor documentation:**
- `docs.nestjs.com` — Validation (`StandardSchemaValidationPipe`), Pipes, Rate Limiting, Express adapter shutdown
  drain, route resolution strategies
- `docs.bullmq.io` — "Migrate from v5 to v6", Telemetry, Job Schedulers, Redis Cluster, deduplication
- `@nestjs/throttler` README — named throttlers, `ttl` units, deprecated storage packages
- formio.js official README + help.form.io developer guides — namespace change, 4.x maintenance mode, 5.x
  breaking changes, bootstrap/templates migration
- Microsoft Learn — "Azure Bot Framework SDK to Microsoft 365 Agents SDK migration guidance (nodejs)";
  Azure Bot Service docs, "What's new in the Bot Service SDKs" — repository archived, support ended
  2025-12-31
- `docs.slack.dev` — Bolt for JS v5 release note (2026-07-15) and v4→v5 migration guide
- `developers.zalo.me` / `docs.zaloplatforms.com` — Official Account API and webhook docs
- OpenID Connect — authorization code + PKCE flow (via `openid-client` docs)
- `@nestjs/observe` README — vendor backend, "not a replacement for OpenTelemetry"
- `@casl/ability` docs

**Press / release notes:**
- `nestjs/nest` GitHub v12.0.0 release notes (2026-08-28)
- InfoQ, "NestJS v12 Roadmap: Full ESM Migration, Standard Schema Validation and Modernised Toolchain"
- Snyk package-health pages (ioredis advisory history; community throttler storage publish age)

**Methodology note:** the `classify-confidence` seam was consulted but returns MEDIUM/LOW even for
registry-metadata claims. Where the seam and the evidence class disagreed, this document follows the
**evidence class** — a fact read directly from `registry.npmjs.org` on the verification date is HIGH confidence
regardless of what the seam says — and says so explicitly rather than silently downgrading a correct claim.

---

*End of document. Written by the GSD project researcher, 2026-10-01. Not committed — the orchestrator commits
after all researchers complete.*

