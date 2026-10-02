---
gsd_state_version: "1.0"
current_phase: 01
current_phase_name: Foundations & Platform
status: executing
stopped_at: Completed 01-02-PLAN.md
last_updated: "2026-10-02T08:35:33.000Z"
last_activity: 2026-10-02
last_activity_desc: Plan 01-02 complete - boot config contract + two Redis deployments + ioredis profiles
state_head: e949602e221f418a2007a8f3957954cd314b34d9
progress:
  total_phases: 8
  completed_phases: 0
  total_plans: 10
  completed_plans: 2
  percent: 20
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-01)

**Core value:** An employee can complete a cross-system task entirely through chat plus a single
rendered form, without ever logging into — or learning — the downstream system.
**Current focus:** Phase 01 — Foundations & Platform

## Current Position

Phase: 01 (Foundations & Platform) — EXECUTING
Plan: 3 of 10 (01-03 — next)
Status: Ready to execute
Last activity: 2026-10-02 — Plan 01-02 complete (boot config contract, two-distinct-Redis gate, ioredis profiles)

Progress: [██░░░░░░░░] 20%

## Performance Metrics

**Velocity:**
- Total plans completed: 2
- Average duration: 45min
- Total execution time: 1.5 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 2 | 2 | 45min |

**Recent Trend:**
- Last 5 plans: 01-01 (38min), 01-02 (52min)
- Trend: —

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 38min | 5 tasks | 48 files |
| Phase 01 P02 | 52min | 3 tasks | 15 files |

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
- [Phase 1]: **Log allowlist and trace decoupling are enforced mechanically** (D-15, D-18). A typed `LoggerPort` plus a Zod-parsing pino destination that strips unknown keys *before* serialisation; a frozen span-attribute allowlist plus a subset test proving `submission_id` is not recoverable from a trace ID. `submission_id` may appear in logs and the audit trail — both have defined purge windows; the trace backend does not, and that asymmetry is the erasure property.
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

Last session: 2026-10-02T08:35:33.000Z
Stopped at: Completed 01-02-PLAN.md
Resume file: None
