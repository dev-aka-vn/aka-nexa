---
phase: "01"
slug: "foundations-platform"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (high)
threats_open: 0
asvs_level: 1
created: "2026-10-04"
verified: "2026-10-04"
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| config → key provider selection | An env value could select a dev provider in production if unguarded. | Provider choice (selects the encryption key source) |
| plaintext secret → stored envelope | The envelope is the only place a secret rests; the auth tag is the integrity boundary. | Secret plaintext → ciphertext + 16-byte tag |
| KMS/DEK → key material | A wrong-length or text-shaped unwrap is an adapter boundary that must fail loudly. | Wrapped key bytes → 32-byte DEK |
| log record → serialised output | The allowlist must be applied *before* serialisation, or PII reaches cold storage and the erasure SLA becomes a lie. | Arbitrary log fields → serialised JSON |
| span → trace backend | The trace backend has no purge window, so anything written to a span must be independently erasable. | Span attributes → OTLP exporter |
| module → module (build time) | A cross-boundary import is a component-graph violation; it must fail the build, not be caught in review. | Import specifier → element graph |
| process → process (shutdown) | SIGTERM must drain in-flight work and flush buffered spans rather than sever them. | In-flight requests + buffered spans |
| chat webhook → receiver | Ack under 200 ms and enqueue; all logic runs in the consumer. | Inbound platform event → queue |
| npm registry → dependency tree | A package not carried in the version ledger has not had its provenance verified. | Registry tarball → `node_modules` |

---

## Threat Register

34 threats across 10 plans: `T-1-01` … `T-1-24` plus one supply-chain entry per plan
sharing the id `T-1-SC` (10 distinct entries, each covering that plan's package set).
24 high · 10 medium · all disposition `mitigate`.

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-1-01 | Tampering | `package.json` / `package-lock.json` | high | mitigate | Exact `typescript: "6.0.3"` pin, committed lockfile, and a CI job asserting the *resolved* pin | closed |
| T-1-02 | Tampering | `.github/workflows/ci.yml` install-guard | high | mitigate | Lockfile-free `npm install`, with an assertion that fails on `--force` / `--legacy-peer-deps` / `--strict-peer-deps=false` **before** the install runs | closed |
| T-1-03 | Denial of Service | `apps/api` `/health/live` | medium | mitigate | Liveness reads no dependency, so a downed Mongo/Redis cannot cascade into a restart loop | closed |
| T-1-04 | Spoofing | `AppConfigSchema` / boot hook | high | mitigate | `.strict()` + named `CONFIG_INVALID:`; unknown or missing keys abort boot before any provider instantiates | closed |
| T-1-05 | Tampering | `redis.schema.ts` distinct-host check | high | mitigate | `superRefine` on `new URL(...).host` → `REDIS_INSTANCES_NOT_DISTINCT`; a logical-DB suffix cannot satisfy it | closed |
| T-1-06 | Denial of Service | `redis.provider.ts` producer profile | medium | mitigate | Finite `maxRetriesPerRequest` on the request path, so a downed Redis errors instead of hanging the handler | closed |
| T-1-07 | Elevation of Privilege | `tooling/boundaries.config.mjs` | high | mitigate | `default: "disallow"` + explicit allow-list; R1/R2/R3 file-category policies; per-category violation fixtures prove each policy fires | closed |
| T-1-08 | Elevation of Privilege | `provider-boundary.guard.ts` | medium | mitigate | Runtime walk of resolved providers; a forbidden token aborts boot with `BOUNDARY_VIOLATION:` | closed |
| T-1-09 | Information Disclosure | `log-allowlist.formatter.ts` | high | mitigate | Rebuild-from-allowlist in `formatters.log`; computed keys and nested `err.cause` chains cannot survive because only allowlisted keys are copied | closed |
| T-1-10 | Information Disclosure | `logger.port.ts` | medium | mitigate | Typed allowlist-only surface; an unlisted field is a compile error and there is no free-form bag | closed |
| T-1-11 | Information Disclosure | `key-provider.ts` / `local-key-provider.ts` | high | mitigate | Key material only across the interface; `LocalKeyProvider` refuses production. Fails **closed**: `NODE_ENV` required, opt-in cannot open production | closed |
| T-1-12 | Tampering | `envelope.ts` | high | mitigate | AES-256-GCM auth tag stored and verified on decrypt; a corrupted or missing tag throws; fresh 12-byte `iv` per encryption, never a counter | closed |
| T-1-13 | Elevation of Privilege | `crypto.module.ts` production guard | high | mitigate | Production without `CRYPTO_KEY_PROVIDER=kms` aborts boot with `CRYPTO_KEY_PROVIDER_REQUIRED:`; `kms` surfaces `KMS_PROVIDER_BLOCKED:`. Composed into all three entrypoints so the guard is reachable from a real boot | closed |
| T-1-14 | Spoofing | `read-link-claims.ts` | high | mitigate | `.strict()` rejects unlisted claims; the frozen-key-set test catches a *removed* claim (opposite failure mode); no PII claim is expressible | closed |
| T-1-15 | Tampering | `jev-response.ts` | high | mitigate | `.strict()` + `verified === null ⇒ tool_id === null && clarification_needed === true`, so an abstaining provider cannot smuggle a confident choice | closed |
| T-1-16 | Elevation of Privilege | `rate-limit-key.ts`, `token-classes.ts` | medium | mitigate | Scope union admits only `user` and `link`; reserved `draft` class excluded from v1 emission | closed |
| T-1-17 | Denial of Service | `health.controller.ts` | medium | mitigate | Liveness reads no dependency; readiness is per-dependency, so one slow dependency is named rather than collapsed into a restart loop | closed |
| T-1-18 | Information Disclosure | `health.controller.ts` / indicators | medium | mitigate | Response carries status keys and flags only; connection strings and credentials never enter the body (asserted by test) | closed |
| T-1-19 | Denial of Service | `queue.module.ts` / `queue.provider.ts` | high | mitigate | Worker blocking connection sets `maxRetriesPerRequest: null` (BullMQ requires it); producers set 1–3 so the request path fails fast | closed |
| T-1-20 | Tampering | queue key layout | medium | mitigate | All queue keys carry the `{akane-q}` hash tag (one cluster slot); no client sets `keyPrefix`, so two disagreeing prefix layers cannot arise | closed |
| T-1-21 | Information Disclosure | `allowlist-span-exporter.ts` | high | mitigate | Wrapping exporter filters to the frozen allowlist. Subtractive (iterates the *span's* keys), so computed/nested/HTTP-instrumentation attributes have no path to the wire. `submission_id` appears zero times in `packages/*/src` and `apps/*/src` | closed |
| T-1-22 | Information Disclosure | `otel.bootstrap.ts` / `metrics.controller.ts` | medium | mitigate | `preventServerStart: true`; exactly one `/metrics` route; counters carry **no attributes**, so no PII can ride a series | closed |
| T-1-23 | Elevation of Privilege | `apps/*/src/bootstrap/boundary-manifest.ts` + guard | high | mitigate | Each app declares forbidden provider tokens; guard aborts boot on a forbidden token; the drift test independently asserts forbidden specifiers are absent from each app's import closure | closed |
| T-1-24 | Denial of Service | `main.ts` shutdown path | medium | mitigate | `enableShutdownHooks()` on all three so SIGTERM drains in-flight work; OTel SDK stopped on shutdown so buffered spans flush | closed |
| T-1-SC (01-01) | Tampering | npm installs | high | mitigate | Generic ledger rule: every package carried in `STACK.md §14`; anything else requires `checkpoint:human-verify` against npmjs.com/package | closed |
| T-1-SC (01-02) | Tampering | npm installs | high | mitigate | `ioredis@6.0.0` ledgered; no new package introduced | closed |
| T-1-SC (01-03) | Tampering | npm installs | high | mitigate | `eslint-plugin-boundaries@7.2.0` ledgered; a spec asserts the installed version, so a silent upgrade is a red test | closed |
| T-1-SC (01-04) | Tampering | npm installs | high | mitigate | `pino@10.3.1`, `pino-http@11.0.0`, `nestjs-pino@5.2.1` ledgered | closed |
| T-1-SC (01-05) | Tampering | npm installs | high | mitigate | No new package — AES-256-GCM is Node stdlib. No cloud KMS SDK installed, so the vendor remains an open decision | closed |
| T-1-SC (01-06) | Tampering | npm installs | high | mitigate | No new package — Zod 4 is native. No `zod-to-json-schema` | closed |
| T-1-SC (01-07) | Tampering | npm installs | high | mitigate | `@testcontainers/{mongodb,redis}@12.2.0` **were asserted ledgered and were not** — no `STACK.md` row existed. **Remediated:** rows added, both verified MIT / 2026-09-28 against the registry | closed |
| T-1-SC (01-08) | Tampering | npm installs | high | mitigate | `bullmq@6.3.11`, `@nestjs/bullmq@12.0.0`, `ioredis@6.0.0`, `@opentelemetry/api@1.9.1` ledgered | closed |
| T-1-SC (01-09) | Tampering | npm installs | high | mitigate | `@opentelemetry/sdk-metrics` and `@opentelemetry/sdk-trace@2.11.0` are **direct production imports with no ledger row** — the gate did not fire. **Remediated:** rows added, both verified Apache-2.0 / 2026-09-21 | closed |
| T-1-SC (01-10) | Tampering | npm installs | high | mitigate | No new package; every import workspace-local or already pinned | closed |

*Status: open · closed*
*Severity: critical > high > medium > low — only open threats at or above `block_on` (high) count toward `threats_open`*
*Disposition: mitigate · accept · transfer*

---

## Accepted Risks Log

No threat was waived to reach `threats_open: 0` — both open findings were **fixed**, not accepted.
Two residuals are recorded here because they are genuinely accepted for now and should not
resurface as audit noise:

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|-----------|-----------|-------------|------|
| AR-1 | T-1-07, T-1-23 | `apps/*/otel.mjs` is invisible to **both** boundary controls — outside the rule's `files` block and outside every element pattern. Measured: widening `files` to `**/*.mjs` still yields 0 diagnostics even for a planted violation, and `checkUnknownLocals` governs unknown *targets*, not unknown *origins*. Closing it requires deciding whether a loader entry belongs to the `app-<name>` element, which is D-02's explicit scoping. Tracked as **WINDOWS #16**. | orchestrator | 2026-10-04 |
| AR-2 | T-1-09 | `msg` is appended by pino **after** `formatters.log` runs, so it is the one channel the allowlist cannot filter. Mitigated by convention (`LoggerPort` fixes the message as a first argument) plus WINDOWS #4's waived `.child()` handoff. Needs a **human ruling**, and likely a lint rule against interpolation. Tracked as **WINDOWS #5**. | orchestrator | 2026-10-04 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|-----------|---------------|--------|------|--------|
| 2026-10-04 | 34 | 32 | 2 | `gsd-security-auditor` (ASVS L1, mechanism-level) |
| 2026-10-04 | 34 | 34 | 0 | remediation pass — see note |

**Why an auditor ran at all.** The workflow's short-circuit rule would have permitted an L1
grep-level pass to write this file directly (`register_authored_at_plan_time: true`,
`asvs_level: 1`). That was declined because the shortcut demonstrably produces a false
`CLOSED` verdict on this register: `T-1-02`'s named component is the `install-guard` job,
which existed both before and after its assertion did — the pre-fix file
(`7566f99^:.github/workflows/ci.yml`) contains **zero** `grep -Eq` enforcing checks. That is
the exact shape of both phantom controls this phase shipped (code-review `WR-10`, and the
boundary rule being blind to workspace subpath imports — verification gap `G-1`). Component
existence is not evidence that a stated mitigation exists.

**The two open findings.** Both were `T-1-SC` provenance failures: four packages imported by
the implementation with no `STACK.md` ledger row, so the rule *"every package is carried in
`STACK.md §14` … anything not in that ledger requires `checkpoint:human-verify` before
install"* did not fire for them. Two were production imports
(`@opentelemetry/sdk-metrics` → `otel/bootstrap.ts`, `@opentelemetry/sdk-trace` →
`otel/allowlist-span-exporter.ts`); two were test-harness imports. All four were exact-pinned
with a committed lockfile, so this was **not live exposure** — it was the control failing to
fire, which is the property the control exists to protect.

**Remediation and its honest scope.** All four were added to `STACK.md` (§6, §10.1 and §14)
and verified against the npm registry: Apache-2.0 / 2026-09-21 for the OTel pair, MIT /
2026-09-28 for the testcontainers pair — no AGPL, no deprecation, versions matching what is
installed. Sweeping **all 33** declared dependencies (not only the four reported) surfaced two
further gaps: `@types/node` had no row despite being a recorded plan 01-01 deviation, and
`@nestjs/testing` was written as a `/testing` shorthand in the §14 ledger, which makes that
row ungreppable and would fail any automated `T-1-SC` gate with a false positive. Both now
carry a literal row. Post-fix sweep: **33/33 deps ledgered, 0 gaps.**

⚠️ **These two closures rest on orchestrator evidence, not a fresh independent auditor pass.**
The evidence is registry-verified and mechanically swept, but a subsequent `/gsd-secure-phase`
would stamp it independently. Recorded so this verdict is not read as auditor-confirmed when
it is remediation-confirmed.

**Caveats on what was executed rather than read.** (1) `T-1-09`/`T-1-10` are *total over every
record the code emits* but **not yet load-bearing in production** — `createPinoOptions` has no
production call site and `nestjs-pino` is not installed, so no live logger exists. Declared
scope decision, recorded so this verdict is not read as "the PII control is live". (2) `T-1-19`
/ `T-1-20`'s live-Redis assertions need Docker and were not run; the *mechanism* (prefix
constant, no `keyPrefix`, the two connection profiles) was verified by execution. (3) The
exact-pin discipline is delivered by exact pins + committed lockfile + `npm ci`, not by exact
pins on every package — several `@nestjs/*` and `zod` entries are caret ranges.

---

## Sign-Off

- [x] All 34 threats have a disposition (`mitigate`)
- [x] Two accepted residuals documented (AR-1, AR-2) with owning WINDOWS entries
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-04

**Not verified by this audit:** KMS vendor selection (blocker B-3 / D-27). `T-1-13`'s guard
holds and fails closed, but no KMS-backed key exists — FND-10 stays Pending, and Phase 5 must
not store a connector credential before a vendor is named.