---
gsd_state_version: "1.0"
current_phase: 01
current_phase_name: Foundations & Platform
status: executing
stopped_at: Completed 01-06-PLAN.md
last_updated: "2026-10-02T15:58:00.000Z"
last_activity: 2026-10-02
last_activity_desc: Plan 01-06 complete - JEV v1 wire contract and read-link claim set frozen (RTE-10, LNK-07)
state_head: 0546099
progress:
  total_phases: 8
  completed_phases: 0
  total_plans: 10
  completed_plans: 5
  percent: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-01)

**Core value:** An employee can complete a cross-system task entirely through chat plus a single
rendered form, without ever logging into — or learning — the downstream system.
**Current focus:** Phase 01 — Foundations & Platform

## Current Position

Phase: 01 (Foundations & Platform) — EXECUTING
Plan: 5 of 10 complete (01-05 — next)
Status: Ready to execute
Last activity: 2026-10-02 — Plan 01-06 complete (JEV v1 + read-link contracts frozen, RTE-10/LNK-07/DAT-13/AUD-10)

Progress: [█████░░░░░] 50%

## Performance Metrics

**Velocity:**
- Total plans completed: 5
- Average duration: 51min
- Total execution time: 6.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 5 | 5 | 51min |

**Recent Trend:**
- Last 5 plans: 01-01 (38min), 01-02 (52min), 01-03 (62min), 01-04 (159min), 01-06 (38min)
- Trend: 01-04 remains the outlier (159min, spent reading `node_modules/pino/lib` rather than writing). 01-06 came in at 38min — the cheapest plan so far — and the pattern is consistent: a plan whose correctness comes from **reading installed source** (pino internals, the boundaries plugin) is expensive, and a plan whose correctness comes from **asserting a contract** is not. Budget accordingly.

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 38min | 5 tasks | 48 files |
| Phase 01 P02 | 52min | 3 tasks | 15 files |
| Phase 01 P03 | 62min | 3 tasks | 31 files |
| Phase 01 P04 | 159min | 3 tasks | 11 files |
| Phase 01 P06 | 38min | 3 tasks | 17 files |

## Accumulated Context

### Decisions

Full log in PROJECT.md Key Decisions. Decisions that shape the roadmap order:

- **Vertical-slice build order, not PRD §20 layer order.** The dominant project risk is build order, not technology — four researchers converged on this independently.
- **Phase 2 (vertical slice) must precede Phase 5 (integration/async).** Phase 2's submission record is the precondition for the transactional outbox.
- **Read path moved from PRD Phase 4 to Phase 4 (immediately after routing).** It shares the `perm_version` epoch primitive with the RBAC cache; building it after the App Builder means designing a security model in a hurry.
- **App Builder stays at Phase 6.** The DH-2 tension is resolved by not moving it — by then the APIs are stable, making it the lowest-risk slice despite being the highest-value one. The seed-template gallery (`APP-09`) is what makes the pre-builder story credible.
- **Granularity deviation:** 8 phases against `granularity: coarse`. Breadth honoured (Phase 2 = 47 reqs, Phase 6 = 25), count not compressed, because the dependency order is a correctness constraint.
- **Timing superseded:** ~43 weeks P50 (38–49) replaces the inherited 26–34 weeks, which was never re-derived against an 8-phase structure.
- [Phase 1]: **Read-link claim shape frozen in Phase 1** (01-CONTEXT.md D-21). The discriminant is `action`, not `typ` — the JOSE header already owns that name. `query_version` is frozen in foundations even though the read path is Phase 3, because a saved query is versioned the way a form is and adding a claim later invalidates every outstanding link.
- [Phase 1]: **JEV wire contract frozen in foundations** (D-23). PRD §11.1 plus exactly two additions: `choice.verified: boolean | null` (abstention is a different signal from low confidence, with a cross-field refinement forcing clarification) and `state.force_clarification: boolean` (the platform can force clarification, not only the provider). Frozen by a `.strict()` schema plus an exact-key-set test, not by a comment.
- [Phase 1]: **Log allowlist and trace decoupling are enforced mechanically** (D-15, D-18). A typed `LoggerPort` plus a pino `formatters.log` rebuild hook that strips unknown keys *before* serialisation (D-15's original "destination stream" wording is not implementable — see the 01-04 amendment below); a frozen span-attribute allowlist plus a subset test proving `submission_id` is not recoverable from a trace ID. `submission_id` may appear in logs and the audit trail — both have defined purge windows; the trace backend does not, and that asymmetry is the erasure property.
- [Phase 01]: [Phase 1 / 01-04]: **D-15's layer-2 wording is AMENDED (RESEARCH B-1 implemented): the control is pino's `formatters.log`, not a destination stream.** A pino destination receives already-serialised bytes — `hooks.streamWrite` is documented as receiving "the stringified JSON" — so "immediately before `JSON.stringify`" is unachievable there. `_asJson` in `lib/tools.js` runs `obj = formatters.log(obj)` *before* the serialisation loop, so the hook's return value is the object that gets written. Both of D-15's stated properties hold; only the mechanism changed. **Read `_asJson` before trusting any other pino security claim — the same function shows three of four key sources never reach the hook.**
- [Phase 01]: [Phase 1 / 01-04]: **pino emits four key sources and only one passes through `formatters.log`.** `level` comes from `formatters.level` (cached into a raw `{"level":30` prefix), `ts` from the `timestamp` function, child bindings from `asChindings` — all three are concatenated as raw prefixes *before* the formatter runs. `createPinoOptions` therefore routes `formatters.level` through the same gate, supplies a custom `TimeFn` that emits the allowlisted name `ts` (pino's default key `time` is NOT allowlisted), and sets `base: null` — because the default `{pid, hostname}` bindings chunk would emit `hostname`, which is not on D-16's list, on every single record.
- [Phase 01]: [Phase 1 / 01-04]: **`logger.child(bindings)` leaks PII and `formatters.bindings` cannot fix it.** `child()` in `lib/proto.js` takes a deliberate fast path that rebuilds the instance's formatters with `resetChildingsFormatter` (the identity function), so a root `formatters.bindings` is honoured only for the root's `base` chunk — which is `null`. Found by a failing test: `"user_email":"anna.pino@example.com"` in the output. `createChildLogger(logger, bindings)` rebuilds the bindings *before* pino sees them and touches no pino option or internal, so it survives a version bump. **Plan 10 wires `nestjs-pino`, which creates child loggers for requests — it must route them through `createChildLogger` or wrap the instance in a `LoggerPort` adapter that exposes no `child()`.**
- [Phase 01]: [Phase 1 / 01-04]: **`msg` is the one channel the allowlist cannot filter.** pino appends the message string *after* `formatters.log` has run, so `logger.info('failed for ' + userInput)` passes every automated test. The control is layer 1 plus convention (`LoggerPort` takes the message as a fixed first argument). Documented in the module and routed to human review as coverage entry D7; plan 10 should consider a lint rule against interpolating values into a log call. Claiming the allowlist covers `msg` contents would be false.
- [Phase 01]: [Phase 1 / 01-04]: **An allowlisted key with an object value is a depth bypass, so allowlisted values are primitives only.** The rebuild closes nesting under a *non-allowlisted* container, but `reason: { detail: { email } }` is allowlisted by key and would serialise the subtree. No D-16 field is defined to hold a composite value, so restricting copied values to finite numbers, strings, booleans, and `null` is free and makes the three-level guarantee total. Non-finite numbers are dropped rather than allowed to serialise as an invented `null`. Likewise `error_code` is normalised through the closed enum on every record — the key is allowlisted, so without normalisation a caller could pass any string in it.
- [Phase 01]: [Phase 1 / 01-04]: **`LoggerPort`'s call-site surface is the allowlist MINUS the factory trio.** `CallerLogField = Exclude<AllowlistedField, 'service' | 'env' | 'pid'>`, derived from the same frozen list, and `createPinoOptions` spreads the base fields *after* the caller's object so they win even if a caller reaches the seam. Ten `@ts-expect-error` directives cover an unlisted field, three bag names, three base fields, and a raw `Error`; `tsc` fails with TS2578 when one goes unused, so the surface cannot silently loosen.
- [Phase 01]: [Phase 1 / 01-04]: Added `pino@10.3.1` (exact STACK.md §14 pin, `--save-exact`) as a root **dev** dependency — a missing stack dependency, not a new one; the plan's `files_modified` omitted `package.json`. `pino-http@11.0.0` and `nestjs-pino@5.2.1` are NOT installed and plan 10 owns adding them.
- [Phase 01]: [Phase 1 / 01-04]: `packages/platform/src/logging/index.ts` is a deliberate separate barrel so plan 10 does not edit `packages/platform/src/index.ts`. **`packages/platform/package.json`'s `exports` map still declares only `"."`, so a cross-package deep import (`@akane/platform/logging`) will not resolve** — the first plan that needs it must add an `exports` entry.
- [Phase 01]: [Phase 1 / 01-06]: **D-24's freeze needs TWO assertions, not one, and only the second catches a removal.** `.strict()` rejects an ADDED key at runtime; it is blind to a key REMOVED at author time, because the schema that lost `question` still rejects everything unknown and now accepts nothing where a question belongs. Every frozen schema therefore ships with a test asserting `Object.keys(schema.shape).sort()` against a literal version-named array. The split is applied to the JEV request, the JEV response, and the read-link claims — and deliberately **not** to `connector/` and `events/`, where a new field invalidates nothing already deployed.
- [Phase 01]: [Phase 1 / 01-06]: **`JevResponse.choice` is REQUIRED, overriding PRD §11.2's `choice?`.** An optional object makes abstention expressible twice (an absent `choice`, or a `choice` with no tool), and PRD §17.3's conformance suite would then have two shapes to test for one signal. D-23 picks one shape; abstention is the `verified === null` state. The refusal is a `.superRefine` emitting two named tokens, so a provider cannot pair `verified: null` with a real `tool_id` and `clarification_needed: false`.
- [Phase 01]: [Phase 1 / 01-06]: **Zod's `toJSONSchema` `override` hook is mutation-only in `zod@4.6.5` and runs per-subschema.** `ctx.override(...)`'s return value is discarded (`core/to-json-schema.js:460`), so the documented `{ ...ctx.jsonSchema, $id }` pattern silently drops the `$id`; and because it fires for every subschema, a mutation-based `$id` would land on each property unless guarded by `path.length === 0`. `toJsonSchema` therefore spreads the generated document and appends `$id` after the call. Separately, the `metadata` option throws `ctx.metadataRegistry.get is not a function` in this version — use `.meta()` on the schema, not `metadata`.
- [Phase 01]: [Phase 1 / 01-06]: **A negative rule needs an unexpressible bad state, not a discouraged one.** Three of D-22/AUD-10 are now types: the rate-limit scope union has exactly two members so an address cannot be a scope; `TOKEN_CLASSES` is keyed by the `ReadLinkAction` union with `satisfies` so a widened enum without a row is a compile error; `draft` carries `emittedInV1: false` and `isEmittableInV1()` is the gate a Phase 2 issuer must pass. `TokenClass.ttl` is an opaque token (`'30m' | '4h' | '90d' | 'configurable' | 'reserved'`), not a parsed duration — the resolver belongs to the link-issuing phase, and putting it here would be a second source of truth for time.
- [Phase 01]: [Phase 1 / 01-06]: **The boundary graph absorbed the whole contract package with no config change.** `packages/contract/src/**` is element type `contract`, allowed edge `['kernel']`, plus the position-0 third-party allow — so `zod` and intra-package relative imports were already legal. `tooling/boundaries.config.mjs`, `eslint.config.mjs`, `package.json` and `package-lock.json` are byte-identical after this plan (T-1-SC: no new package). No rule was relaxed to make these files pass.
- [Phase 01]: [Phase 1 / 01-06]: **`perm_version` is a REQUIRED claim on the frozen set even though D-21 scopes it to read links.** The set is one `.strict()` schema; a write link does not need the epoch to mean anything, and making it optional would weaken exactly the read guarantee it exists for. **Open question for the Phase 2 link-issuing service:** a write link has no epoch value, so either it mints the current epoch (keeps the claim set single-shaped) or D-21's ruling is revisited — and the frozen key set forbids the second without a version bump. Likewise `READ_LINK_TARGET_RULES` is documentation as data; nothing yet *enforces* "no `target_id` on a `create` link", and the read-link verification service is its natural home.

- [Phase 1]: **Draft-save blocker removed by reserving shape, not building machinery** (D-22). `action: "draft"` is in the frozen enum and must not be emitted in v1; `ak:tok:draft:{jti}` is reserved; token classes are a `{action, ttl, consume}` config table. Research flagged this as a structural blocker on Phase 2's token model — one enum value and one table row close it.
- [Phase 1]: **Form.io File licensing and SAML are out of Phase 1** (D-29, D-30). File upload is already v2, so the licensing question gates a deferred feature and AD-3's open-source claim holds by not shipping the premium component — no spike. SAML is a *customer* fact, not a technical unknown: OIDC is the plan of record, and the question carries a deadline before Phase 5 planning (`BLD-12` is the first SSO surface). +2–3 weeks if SAML is required, which is not in the ~43-week estimate.
- [Phase 1]: **Health topology deviates from research in favour of FND-05** (D-09). All three entrypoints use `NestFactory.create()`; `worker` and `scheduler` mount only HealthController and MetricsController. `ARCHITECTURE.md` recommended `createApplicationContext()`, but FND-05 requires each of the three to expose both endpoints. Readiness is per-dependency (Mongo, RedisCache, RedisQueue, plus per-process additions); liveness checks nothing, so a Redis blip fails readiness without restarting a healthy pod.
- [Phase 01]: [Phase 1 / 01-01]: All workspace tsconfigs set composite:true in tooling/tsconfig.base.json so project references typecheck (TS6306) and `tsc -b` can build in dependency order.
- [Phase 01]: [Phase 1 / 01-01]: Added @types/node@^24 as a root devDependency (not in STACK.md §14) — required for tsc to typecheck Node globals; it is the canonical DefinitelyTyped package, not a substitution.
- [Phase 01]: [Phase 1 / 01-01]: Added a root solution tsconfig.json referencing all seven workspaces — required by `npm run build` = `npm run lint && tsc -b`; it is a deviation from the plan's files_modified list.
- [Phase 01]: [Phase 1 / 01-02]: Named boot failures use `ConfigModule.forRoot({ validate: namedValidate })`, not `validationSchema:` — the Standard Schema option cannot carry a caller-defined message and FND-09 requires a greppable `CONFIG_INVALID: <path> <code>` line. The hook narrows `process.env` to `APP_CONFIG_KEYS` before parsing, because `.strict()` against the raw env would reject every unrelated OS/toolchain key and fail every boot.
- [Phase 01]: [Phase 1 / 01-02]: Zod `superRefine` issues always carry `code: 'custom'`, so machine-readable refinement tokens (e.g. `REDIS_INSTANCES_NOT_DISTINCT`) ride in `issue.message` and `formatConfigError` substitutes them. Without that, the distinct-Redis failure would be logged as the useless `CONFIG_INVALID: REDIS_CACHE_URL custom`.
- [Phase 01]: [Phase 1 / 01-02]: D-12's two-deployment check compares `new URL(x).host` — host **and** port, a purely syntactic parse with no DNS — so same-host/different-port local dev passes while a single instance fails. A logical-database path suffix is never a discriminator: `maxmemory-policy` is instance-wide, so `/0` vs `/1` on one instance is still one deployment (D-12).
- [Phase 01]: [Phase 1 / 01-02]: The D-14 retry split is one argument, not two code paths: `createRedisClient({ url, profile })` with `buildRedisOptions(profile)` as the pure, testable options object. Assertions target `buildRedisOptions` rather than `client.options` because ioredis normalises `keyPrefix: ""` into the client, which would make a "never sets keyPrefix" test vacuously pass. Clients use `lazyConnect: true` so module compilation never opens a socket.
- [Phase 01]: [Phase 1 / 01-02]: Added `ioredis@6.0.0` (exact STACK.md §14 pin, never 5.x) as a root **dev** dependency — nothing constructs a client until Nest resolves the providers in plan 07/10. Its default export is not constructable under NodeNext; import the named class (`import { Redis as IORedis, type RedisOptions } from 'ioredis'`).
- [Phase 01]: [Phase 1 / 01-03]: **`checkAllOrigins: true` is REQUIRED and overrides 01-03-PLAN's prohibition.** The installed `eslint-plugin-boundaries@7.2.0` gates the whole evaluation on the *target's* origin (`checkAllOrigins || isLocalDependency`), so at the default the rule returns before evaluating any policy for `jose`/`mongodb` — R2 and R3 are dead config. Measured 6/6 blocking cases silent without the flag. RESEARCH P1.1's premise ("R2/R3 select external targets, which the default supports") was backwards. A spec asserts the flag's presence *and* that stripping it silences R2/R3, so it cannot be removed as cleanup.
- [Phase 01]: [Phase 1 / 01-03]: **`tooling/import-resolver.cjs` is load-bearing, not optional.** The default Node resolver does not map NodeNext's `./foo.js` onto `./foo.ts`, so without it every relative import in this repo is unresolvable and `boundaries/dependencies` reports zero problems on a tree full of violations. It also maps `@akane/<pkg>` to the workspace's `src/index.ts`; without that mapping cross-workspace imports follow the `exports` map into `node_modules/dist` and are classified `external`, escaping the element graph. Verified with/without: 3 of 4 relative-import probes flip to silence.
- [Phase 01]: [Phase 1 / 01-03]: **Policies are LAST-MATCH-WINS, not first-match-wins** (`evaluatePolicies` in `dist/Rules/Dependencies.js`), and within one policy `disallow` beats `allow`. `tooling/boundaries.config.mjs` therefore declares the broad third-party allow and the permissive element edges FIRST and the R1/R2/R3 restrictions LAST. Reordering the array silently re-enables everything.
- [Phase 01]: [Phase 1 / 01-03]: **R2/R3 use an inverted disallow/allow pair, not `from: { file: { categories: { noneOf: [...] } } }`.** The plan's `noneOf` selector never matches a file with no category — the array query runs against an empty candidate list — so a non-owner file satisfied neither the disallow nor anything else. RESEARCH P1.4's documented fallback shape ("two `from: { file: { categories: "X" } }, allow` policies plus `default: disallow`") is the one that works; it is implemented as one origin-unconstrained disallow plus one owner-category allow per source.
- [Phase 01]: [Phase 1 / 01-03]: **D-02's single `entrypoint` element type is split into `app-api`/`app-worker`/`app-scheduler`** so R1's `from: { element: { type: "!(app-api)" } }` can distinguish the origins. Refinement recorded in 01-ASSUMPTIONS.md §5. Option (b) (one type plus a `path` conjunction) was rejected because it depends on `type`+`path` conjunction semantics the plugin README does not demonstrate.
- [Phase 01]: [Phase 1 / 01-03]: **`InstanceWrapper.isResolved` does not exist in `@nestjs/core@12.1.2`.** RESEARCH P1.6 cited `injector/instance-wrapper.d.ts:25`, which belongs to `interface InstancePerContext`, not the class — `wrapper.isResolved` is `undefined` for every provider. The per-context fallback is no better: `getInstanceByContextId(STATIC_CONTEXT)` *synthesises* `{ instance: null, isResolved: true }`. `createProviderBoundaryGuard` reads `wrapper.instance` instead. A guard built on either signal is permanently silent, which is worse than no guard because it looks like enforcement.
- [Phase 01]: [Phase 1 / 01-03]: The boundary graph's element types are keyed on paths, so a 14th `packages/domain/src/<type>/` directory is **silently ignored**, not reported (`checkUnknownLocals` defaults to `false`). Adding a domain module means adding an element type, and `partialMatch: false` must stay on every descriptor or `packages/platform/src/**` also suffix-matches `apps/api/src/platform/**`.

### Pending Todos

None yet.

### Blockers/Concerns

- **[Phase 3]** Tool-selection accuracy at 100–800 candidates is **unmeasured**. The PRD's ">90% accuracy" and "p95 <500 ms" are not jointly achievable as specified. Needs AI-SPEC.md + `--research-phase` before planning.
- **[Phase 3]** Decision provider, host, and cost profile were explicitly out of scope for stack research.
- **[Cross-phase]** The "legitimate interest" framing for 3-year audit retention needs counsel, not research. Do not treat it as settled.
- **[Cross-phase]** MongoDB 9.0 deliberately not adopted (4 days old at verification). Revisit before the 3-year retention window bites.
- **[Phase 8]** The 3-tier throttler's Redis cost is unmeasured — measure it in the load test, do not assume it.
- **[Phase 1]** KMS vendor adapter is blocked on naming the deployment cloud. FND-10 requires a KMS-backed master key, but no cloud has been named. Phase 1 ships the `KeyProvider` interface, a `LocalKeyProvider` that refuses to boot in production, and a startup assertion that `NODE_ENV=production` without `CRYPTO_KEY_PROVIDER=kms` fails boot. Ruling: 01-CONTEXT.md D-27.
- **[Phase 1]** The production `NODE_ENV=production` ⇒ `CRYPTO_KEY_PROVIDER=kms` boot guard is still absent — deliberately owned by plan 05 inside `crypto/**`, not by this plan's config `validate:` hook (plan 01-02 prohibitions). Plan 05 must add it and must not assume the config hook already covers it.
- **[Phase 1]** `test/setup-env.ts` now seeds the full required boot surface globally for Vitest, because `ConfigModule.forRoot({ validate })` aborts any spec that resolves it without those keys. When plan 05 adds a required field, that file must grow with it; a spec asserting the *absence* of that field must delete it explicitly rather than rely on it being unset.
- **[Phase 1]** `vitest.config.mts` now includes `tooling/**/*.spec.ts`. Any future spec placed outside `packages/` or `apps/` will not run until that glob is extended — the boundary fixture spec is the only one today.
- **[Phase 1]** The boundary graph does not yet reach the apps' composition roots. Plan 10 must provide `BOUNDARY_MANIFEST` per app, call `createProviderBoundaryGuard(manifest).assert(app)` in `OnApplicationBootstrap`, and add the two `export *` lines for `bootstrap/boundary-manifest.js` and `bootstrap/provider-boundary.guard.js` to `packages/platform/src/index.ts` (deliberately left out of plan 03's `files_modified`).
- **[Phase 1]** An empty `BoundaryManifest.forbidden` makes the runtime guard permanently silent. `provider-boundary.guard.spec.ts` documents this; plan 10 must supply the manifest explicitly rather than relying on a default.
- **[Phase 1]** (01-06) **Plan 01-05 owns the production `NODE_ENV=production` ⇒ `CRYPTO_KEY_PROVIDER=kms` boot guard and must not assume the config hook already covers it.** Unchanged from 01-04's note; re-listed because 01-05 is now the next plan to execute.
- **[Phase 1]** (01-06) **`READ_LINK_TARGET_RULES` and the frozen-key-set machinery extend to one place only — do not add key-set tests to `connector/` or `events/`.** A connector descriptor gaining a field invalidates nothing already deployed, which is the property that makes the two frozen schemas different in *kind*. Freezing the non-frozen ones turns every future connector field into a version bump.
- **[Phase 1]** (01-06) **The Phase 2 link-issuing service must call `isEmittableInV1(action)` and must own the `TokenClass.ttl` token→seconds resolver.** Both are deliberate hand-offs recorded in 01-06-SUMMARY.md; neither has an enforcement point inside the contract package.
- **[Phase 1]** (01-06) **`packages/contract/src/index.ts` now re-exports the full surface, so later phases import from `@akane/contract`, never from deep paths.** Its `exports` map declaring only `"."` is therefore correct. The sibling problem is unchanged and still open: `packages/platform/package.json`'s `exports` map declares only `"."`, so `@akane/platform/logging` will not resolve cross-package.
- **[Phase 1]** (01-06) **`z.toJSONSchema()`'s `metadata` option throws in `zod@4.6.5`** (`ctx.metadataRegistry.get is not a function`), and its `override` hook discards its return value while running per-subschema. Any later plan wanting `$id`/`title`/`description` on a published document must use `.meta()` on the schema or post-process the returned document, as `toJsonSchema` does.
- **[Phase 1]** `pino`'s `msg` is emitted verbatim *after* `formatters.log` runs, so the log message is the one channel the allowlist cannot filter. `LoggerPort` fixes it as a fixed first argument so interpolation is visible at the call site, but no test can catch one. Human review is pending (01-04 coverage entry D7); plan 10 should consider a lint rule against interpolating values into a log call, or accept the convention explicitly and record it.
- **[Phase 1]** `pino-http@11.0.0` and `nestjs-pino@5.2.1` are STACK.md §14 pins that are **not installed** — only `pino@10.3.1` is. Plan 10 owns adding them, with the exact versions.
- **[Phase 1]** `packages/platform/package.json`'s `exports` map declares only `"."`, so `@akane/platform/logging` will not resolve cross-package. 01-04 created the barrel so plan 10 would not have to edit the platform index; the first plan that imports it cross-package must add an `exports` entry.

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| Multi-IM | Zalo adapter (`IM-12`), Telegram adapter (`IM-13`), Zalo callback signature spike (`IM-14`) | v2 | Init | v1 |
| Data | Cross-app collection sharing (`DAT-15`, `DAT-16`) | v2 | Init | v1 |
| Forms | File upload (`FRM-11`), draft save & resume (`FRM-12`), object storage (`FRM-13`), i18n (`FRM-10`) | v2 / blocked | Init | v1 |
| Routing | Disambiguation options (`RTE-12`), confidence-gated abstention (`RTE-13`) | v2 | Init | v1 |

*(Full v2 list: 29 requirements in REQUIREMENTS.md — not in this roadmap.)*

## Session Continuity

Last session: 2026-10-02T15:58:00.000Z
Stopped at: Completed 01-06-PLAN.md
Resume file: None
