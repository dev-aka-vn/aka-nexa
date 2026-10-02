# Phase 1 — Planner Assumptions & Coverage-Edge Resolutions

**Phase:** 01-foundations-platform
**Generated:** 2026-10-02
**Purpose:** record every place where the planner made a decision the source artifacts left open,
resolved a research assumption, or explicitly closed one of the 28 unresolved coverage edges from
`/tmp/opencode/coverage.json`. Each entry names where the resolution landed so a reviewer can
overturn it in one place.

---

## 1. Planner decisions that resolve a source conflict or gap

| # | Decision | Source tension | Resolution | Landed in |
|---|----------|----------------|------------|-----------|
| PD-1 | **Domain module count = 13, including `audit`** | CONTEXT D-01 says "12 domain modules"; RESEARCH P1.3 and `research/ARCHITECTURE.md` list 13 with `audit`; FND-08/AUD-10 place an audit module in the boundary graph. | Thirteen tracked directories including `audit`. A missing directory would force a boundary-config change later; the graph already needs the node. | 01-01 task 2 (`DOMAIN_DIRS_OK 13` assertion) |
| PD-2 | **`entrypoint` element type split into `app-api` / `app-worker` / `app-scheduler`** | ARCHITECTURE's element model has one `entrypoint` type; the three apps need different allowed-edge policies (R1 forbids BullMQ `Worker` in api/scheduler; worker-only providers). | Three distinct element types so each app's manifest and lint policy are expressible without a shared, weaker type. | 01-03 (`tooling/boundaries.config.mjs`), 01-10 (per-app `BoundaryManifest`) |
| PD-3 | **D-15 mechanism wording corrected — `formatters.log`, not a destination stream** | D-15 says "a pino custom destination stream that parses each record … immediately before `JSON.stringify`". pino serialises **before** a destination receives the object; a destination stream sees an already-serialised string, so it cannot drop fields. | Implement the before-serialisation drop in a **pino `formatters.log`** hook, whose return value *is* what pino serialises. The security intent (before serialisation, allowlist, unknown keys stripped) is preserved exactly; only the mechanism is corrected. | 01-04 (`log-allowlist.formatter.ts`) |
| PD-4 | **`wrapped: Buffer` tolerates UTF-8-encoded Vault text** | A Vault-transit adapter returns wrapped material as base64 **text**; a cloud-KMS adapter returns bytes. The interface must not fork. | `KeyProvider.wrapDek/unwrapDek` use `wrapped: Buffer`; the future KMS adapter base64url-decodes text into `Buffer`. **No `wrappedIsText` discriminator is added** — a discriminator would leak the vendor into the interface. | 01-05 (`key-provider.ts`) |
| PD-5 | **All three `apps/*` are ESM (`"type": "module"`)** | RESEARCH flags the ESM/CJS choice as "make it once"; `jose` and `openid-client` are ESM-only; FND-03 forbids entrypoint drift. | ESM everywhere. `main.ts` calls `startOtel()` then `await import('./app.module.js')`; each app ships an `otel.mjs` loader. | 01-01, 01-10 |
| PD-6 | **A7 relaxed: assert the `{akane-q}` hash tag in sampled queue key names, not a live cluster slot computation** | Cluster-mode Redis is not practically testable under `testcontainers`; adding a real cluster would add a fourth container whose value is low, and pulling `cluster-key-slot` adds a dependency STACK.md does not carry. | The queue test samples real BullMQ keys from the queue Redis and asserts every one contains the `{akane-q}` hash tag (the property that makes them co-located); no cluster and no new dependency. | 01-08 task 1 |
| PD-7 | **A9 is smoke-tested, not assumed** | D-06's install-guard value depends on npm 11 exiting non-zero on `ERESOLVE` without `--legacy-peer-deps`. | 01-01 keeps the guard asserting on the presence of `--force`/`--legacy-peer-deps`; the plan's `<verify>` runs the lockfile-free install in CI. A Wave-0 manual smoke test (temporarily bump TS to 7.x on a scratch branch) is recorded in the task's acceptance criteria. | 01-01 task 3 |
| PD-8 | **A5 recorded: `.strict()` cannot detect a removed known key** | D-24 requires a frozen-key-set test for both frozen schemas precisely because `.strict()` is removal-blind. | Both RTE-10 and LNK-07 schemas carry a separate `Object.keys(shape).sort()` equality test named `v1.0`. | 01-06 tasks 1–2 |
| PD-9 | **D-32 resolved to `eslint-plugin-boundaries@7.2.0`; `boundaries/files` is a SETTING, `checkAllOrigins` left false, `partialMatch: false` on every descriptor** | PROJECT.md said 7.2.0; ARCHITECTURE.md said 5.3.1 and described a v5 rule form. | Pin 7.2.0 (verified real and current in RESEARCH P1.0). File categories live under `settings["boundaries/files"]`; only `boundaries/dependencies` is a rule; do **not** set `checkAllOrigins` (R2/R3 sources are local); `partialMatch: false` everywhere so a shortened path cannot silently match. | 01-03 |
| PD-10 | **D-03 boot assertion via `app.container.getModules()` + `InstanceWrapper.isResolved` walk** | ARCHITECTURE's boot-assertion rationale names no API; `ModuleRef.get()` would *instantiate* the provider being checked and `ModuleRef.introspect()` returns only `{ scope }`. | Walk resolved `InstanceWrapper`s through `getModules()` behind a one-file `ProviderBoundaryGuard` so Nest internals are touched in exactly one place. | 01-03 (`provider-boundary.guard.ts`), 01-10 (wiring) |
| PD-11 | **R1 enforced with ESLint core `no-restricted-imports` (`importNames: ["Worker"]`), scoped to `apps/api` + `apps/scheduler`** | `eslint-plugin-boundaries` module selectors cannot see *named* import bindings, so they cannot express "no `Worker`". | Core `no-restricted-imports` is the only mechanism that sees named bindings; scoped to the two apps via flat-config `files`. | 01-03 |
| PD-12 | **KMS vendor = NAMED BLOCKER (B-3)** | FND-10 requires KMS-backed key material; no deployment cloud is named (D-27). | Ship `KeyProvider` + `LocalKeyProvider` (refuses `NODE_ENV=production`) + boot assertion that production without `CRYPTO_KEY_PROVIDER=kms` fails; `kms` selection throws `KMS_PROVIDER_BLOCKED:` until a vendor is chosen. **No cloud is picked.** | 01-05 tasks 1, 3 |
| PD-13 | **MVP user-story deviation recorded, story not invented** | `MVP_MODE=true` asks for a user story sourced from the ROADMAP `**Goal:**` line; Phase 1's goal is not in `As a / I want / so that` form (it is an operator/platform outcome). | Each plan restates the operator-facing capability in its `<objective>` and this deviation is recorded; no story is fabricated. Resolve by running `/gsd-mvp-phase 1` only if a story is genuinely required. | all plans (objectives) |

---

## 2. Coverage-edge resolutions (28 unresolved edges from `/tmp/opencode/coverage.json`)

The Nyquist coverage probe emitted **28 unresolved edges** (5 unclassified + 23 categorised). None is
a silent gap: each is resolved by a specific test or explicitly out of Phase-1 scope. `nyquist_validation`
is `false` for this project, so these are recorded rather than enforced as a gate.

| Req | Edge | Resolution / assumption | Proof |
|-----|------|-------------------------|-------|
| FND-01 | unclassified | A clean checkout builds reproducibly under Node 24 / TS 6.0.3. | 01-01: `npm ci` + TS-pin test + CI install-guard job. |
| FND-02 | unclassified | The lockfile is committed and TypeScript resolves to exactly `6.0.3`. | 01-01: `TS_PIN_OK 6.0.3` + `package-lock.json` presence. |
| FND-03 | concurrency | Three entrypoints cannot drift into one process; each has an independent bootstrap and import closure. | 01-10: per-app import-closure test + runtime boundary guard. |
| FND-04 | boundary | A cross-boundary import fails the build exactly at each declared category edge. | 01-03: per-category boundary-violation specs (compliant tree passes). |
| FND-04 | precision | N/A in Phase 1 — FND-04 is lint-enforced module boundaries; there is no arithmetic or rounding dimension. | Recorded N/A; no numeric contract exists yet. |
| FND-05 | adjacency | Two Redis URLs are "equal" (fail) only when host **and** port match; different ports separate cleanly (local-dev case). | 01-02: `REDIS_INSTANCES_NOT_DISTINCT` test. |
| FND-05 | empty | A missing/empty required URL is a boot failure, not a degraded readiness. | 01-02: required-key + `.min(1)` schema tests. |
| FND-05 | ordering | Readiness aggregation is order-independent all-of: every indicator must pass. | 01-07: readiness test asserts all-of semantics. |
| FND-05 | concurrency | Concurrent process boot is safe; the container harness uses unique ports and isolated networks. | 01-07: `startThreeContainers()` with dynamic host ports. |
| FND-06 | unclassified | The logging requirement's only adversarial edge is the 3-level PII test (typed field, computed key, nested `cause`). | 01-04: D-17 three-level drop test. |
| FND-07 | unclassified | The span requirement's only edge is attribute-set ⊆ allowlist. | 01-09: exported-attribute subset test. |
| FND-08 | adjacency | Every BullMQ key shares the `{akane-q}` hash tag, so all queue keys are exactly equal in cluster slot. | 01-08: key-tag assertion over sampled keys. |
| FND-08 | empty | Zero registered workers / zero job schedulers is a *failing* readiness state, not a pass. | 01-08: worker-listening and scheduler-registered indicators. |
| FND-08 | ordering | Job-scheduler registration is idempotent regardless of call order or repetition. | 01-08: repeated `upsertJobScheduler` leaves exactly one scheduler. |
| FND-09 | adjacency | The config boundary *is* the Redis host:port equality rule; adjacent values are handled by the same test. | 01-02: shared `superRefine`. |
| FND-09 | empty | Missing or empty env values abort boot with a named code. | 01-02: `CONFIG_INVALID:` tests. |
| FND-09 | ordering | Key iteration order is not significant; frozen key sets (where required) are compared sorted. | 01-06 sorted-key tests (config schema is not frozen). |
| FND-10 | concurrency | Under concurrent boot in production, the local-key refusal and the KMS requirement fail deterministically. | 01-05: production-guard test. |
| LNK-07 | adjacency | TTL / `nbf==iat` value semantics are **not** Phase-1 scope; Phase 1 freezes claim **shape** only. | 01-06 task 2; value semantics deferred to Phase 4 (recorded). |
| LNK-07 | empty | A missing claim is rejected because every D-21 claim is required in the `.strict()` schema. | 01-06: schema parse-failure test. |
| LNK-07 | ordering | The fifteen-claim key set is compared sorted, so order is irrelevant. | 01-06: frozen-key-set `v1.0` test. |
| RTE-10 | unclassified | The JEV request/response wire contract is frozen with the D-23 additions. | 01-06 task 1. |
| AUD-10 | boundary | The `audit` domain module exists in the boundary graph and is reachable only on allowed edges. | 01-01 `DOMAIN_DIRS_OK 13` + 01-03 boundary config. |
| AUD-10 | precision | Audit timestamp/field precision is **not** implemented in Phase 1 (only the module boundary and rate-limit key land). | Deferred to Phase 2/8; recorded here, not a gap. |
| DAT-13 | adjacency | `supports_idempotency_key` is strictly boolean; equality/touch at `true`/`false` is total. | 01-06 task 3: descriptor test. |
| DAT-13 | empty | A connector descriptor without the flag defaults it to `false`. | 01-06 task 3. |
| DAT-13 | ordering | The descriptor is runtime data, not a frozen wire schema in Phase 1; ordering is irrelevant. | 01-06 task 3. |
| OBS-01 | concurrency | Exactly one metrics path under concurrent scrapes; the Prometheus exporter is a singleton. | 01-09: single-path assertion + `preventServerStart`. |

---

## 3. Research assumptions (A1–A10) — status in the plans

| ID | Assumption | Risk | How the plans handle it |
|----|-----------|------|-------------------------|
| A1 | `nest new` v12 scaffolds Vitest | Low | Vitest 5.0.3 is pinned regardless; scaffold choice is cosmetic. |
| A2 | `Test.createTestingModule().overrideProvider().useValue()` unchanged in 12.1.2 | Low | Used in unit tests; a version change surfaces at typecheck. |
| A3 | Compare Redis host **and** port, not hostname alone | Low-med | Implemented exactly (`new URL(...).host`) in 01-02. |
| A5 | Zod 4 `.strict()` cannot detect a removed known key | **Medium** | Both frozen schemas carry a separate sorted-key-set test (PD-8). |
| A6 | `z.toJSONSchema()` is native in Zod 4 | Low | Published artifact path in 01-06; fallback `zod-to-json-schema` is rejected. |
| A7 | Cluster-mode Redis not testable under `testcontainers` | **Medium** | Relaxed to a key-tag property test (PD-6). |
| A8 | `actions/setup-node@v4` + `node-version-file: .nvmrc` | Low | CI shape in 01-01. |
| A9 | npm 11 exits non-zero on `ERESOLVE` without `--legacy-peer-deps` | **Medium** | Guard asserts on the absence of the weakening flags + Wave-0 smoke test (PD-7). |
| A10 | AWS/GCP/Vault KMS adapter API shapes | Low (blocked) | Interface only; vendor adapter deliberately unscheduled (PD-12). |

A4 (`keyPrefix`+BullMQ corruption mechanism) is explanatory only — D-14 locks the prohibition and
01-02 has a test asserting no `keyPrefix` key is ever returned by the connection helper. That test
is the backstop; the exact Lua/prefix mechanism does not change the plan.

---

## 4. Named blocker carried out of planning

**FND-10 KMS vendor adapter is blocked on naming the deployment cloud** (D-27). This is an accepted,
recorded blocker — not a planning failure and not a scope reduction. Phase 1 delivers the parts that
must not change (the `KeyProvider` interface, the envelope, the production guard) and refuses to
guess a vendor. Selecting `kms` before the vendor is chosen throws `KMS_PROVIDER_BLOCKED:` and fails
boot under `NODE_ENV=production`. It must be resolved before Phase 5 stores the first real connector
credential (D-28).

---

## 5. Refinement to D-02 recorded during 01-03 execution

**D-02's single `entrypoint` element type is split into `app-api` / `app-worker` / `app-scheduler`.**
This is a refinement, not an overturn: the composition-root concept is unchanged, only its
representation in the boundary graph.

**Why it was necessary.** R1 is entrypoint *exclusivity* — "only `apps/api` may import inbound
adapters and `http`", "only `apps/worker` may import `bullmq/workers`". Expressing that as
`from: { element: { type: "!(app-api)" } }` requires `api`, `worker` and `scheduler` to be
distinguishable by type alone. With one shared `entrypoint` type the selector cannot say which one is
the origin.

**Why option (a) over option (b).** RESEARCH P1.3 recorded two options: (a) three app types, or
(b) keep `entrypoint` and add `from: { element: { type: "entrypoint", path: "apps/api/**" } }`.
Option (a) was taken because it uses only the negation form the plugin README documents, whereas (b)
depends on `type` + `path` conjunction semantics that the README does not demonstrate and that would
have needed its own smoke test. Three types costs three config lines; (b) costs a proof.

**Second, separate reason.** `tooling/boundaries.config.mjs` also adds `partialMatch: false` to every
element descriptor. Without it the plugin's default suffix matching would make `packages/platform/src/**`
also match `apps/api/src/platform/**`, silently promoting an app-local directory to the `platform`
element type — which would quietly widen every platform edge in the graph.
