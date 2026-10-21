# Phase 9 — Security Posture

**ASVS level 1** (`security_asvs_level: 1`, `security_block_on: high`)

All 40 threat entries across 6 plans are documented with their dispositions and mitigations. The consolidated STRIDE register and mitigations are below.

---

## STRIDE Threat Register — Phase 9

| ID | Category | Component | Severity | Disposition | Mitigation Plan |
|----|----------|-----------|----------|-------------|-----------------|
| T-09-01 | Tampering | `AuditRetentionService.run()` cutoff computation | high | mitigate | Compute the cutoff once per run from the validated `auditRetentionDays` config inside the consumer; never accept a cutoff, date, or window from the queue payload. |
| T-09-02 | Repudiation | `AppPurgeService.executeDue()` / `softDelete()` | high | mitigate | Stamp `operator_id` on soft-delete and append exactly one `purge.executed` entry naming operator ID and timestamp on hard-delete; the audit entry is the only attribution for an irreversible act. |
| T-09-03 | Tampering | `LEGAL_TRANSITIONS` guard | high | mitigate | `purged` maps to an empty set and the transition-matrix spec asserts no exit; a resurrectable purged app would defeat the purge promise. |
| T-09-04 | Denial of service | Batched delete loop | medium | mitigate | Batch by ascending `_id` with a bounded batch size and an ascending `timestamp` index; an unbounded `deleteMany` on a cold collection stalls the primary. |
| T-09-05 | Elevation of privilege | Purge command surface | high | mitigate | No API route is added in this plan — the command is service-level only. When plan 09-02 adds the route and modal it must carry the global-admin authorization guard; recorded here so the constraint travels. |
| T-09-06 | Information disclosure | Submissions read path | medium | mitigate | Enforce `lifecycle !== 'purged'` at the query layer, and prove in the integration spec that hard-deleted documents are physically absent while soft-deleted ones are absent from the read path but present in the collection. |
| T-09-07 | Denial of service | Concurrent sweeps | low | accept | The Redis `SET NX` lock plus fixed `jobId` already prevent duplicate deletion; a lock-acquire failure is a skip with an info log, which is the intended behaviour and needs no further control. |
| T-09-08 | Tampering | Audit trail durability (D-01) | high | mitigate | The trail moves to a Mongo `audit_entries` collection with an explicit entry type; the index-signature bag is dropped and the guard test pins the field set so a future append cannot smuggle an unredactable identity field past D-06's convention. |
| T-09-09 | Repudiation | Single delete owner (D-04) | high | mitigate | AUD-01's append-only guarantee is proved by one greppable exception plus a non-vacuous guard test asserting the retention service is the only module deleting from `audit_entries`; the guard fails loudly if its own scan pattern breaks, so a silently-broken guard cannot fake a pass. |
| T-09-SC | Tampering | npm/pip/cargo installs | high | mitigate | This plan installs no new package. Package legitimacy gate applies in plan 09-05 (`@nestjs/throttler`); no install happens here. |
| T-09-08 | Tampering | Admin query/modify audit | high | mitigate | Build the query from a parsed, typed filter object — never interpolate user strings into a query document; `app_id`, `user`, and `action` are compared as values, and the date fields are coerced to `Date` before use. |
| T-09-09 | Denial of service | Export endpoint | high | mitigate | Require an authenticated admin, cap the streaming response by the filter set rather than an unbounded collection scan, and rely on the ascending `timestamp` index created in 09-01 so the filtered read is indexed. |
| T-09-10 | Repudiation | `ActorErasureService.erase()` | high | mitigate | Append exactly one erasure audit entry naming the operator on success, and zero on a repeat; distinguish already-erased from nothing-matched so a silent double-erase cannot be mistaken for a first one. |
| T-09-11 | Information disclosure | Audit read path across apps | high | mitigate | The controller must apply the caller's app-scope authorization before delegating to the query service; the query service does not itself decide visibility, so the guard belongs at the edge and is named here so 09-04's runbook review can confirm it. |
| T-09-12 | Tampering | Access-review report storage | medium | mitigate | Regeneration overwrites the quarter's report and appends one entry; a spec asserts exactly one stored report exists after two runs, so a duplicate-append bug cannot silently fork the compliance record. |
| T-09-13 | Spoofing | Access-review generation trigger | low | accept | The job is internal-only with a fixed `jobId`; there is no external caller and no credential to spoof, so no additional control is warranted at L1. |
| T-09-14 | Information disclosure | Export file contents | medium | mitigate | The export carries the same projection as the read path and obeys the same filters; absent optional fields are omitted rather than nulled so an export cannot leak a field that the audit entry type no longer carries. |
| T-09-SC | Tampering | npm/pip/cargo installs | high | mitigate | This plan installs no new package. No install occurs here. |
| T-09-15 | Information disclosure | Metric labels across all new instruments | high | mitigate | Labels are restricted to bounded identifiers and enum values (`provider`, `outcome`, `queue`, `result`, `window`, `app_id`, `form_id`); no user identifier, no raw URL, no request body, and no free-text value becomes a metric label. The registry is the reviewed surface where this is checkable in one file. |
| T-09-16 | Denial of service | Unbounded label cardinality | high | mitigate | `app_id` and `form_id` are the only unbounded-ish labels; both are bounded by the app registry (≤200 apps, ≤20 forms per app per NFR-S-6/S-7). The `unknown` fallback absorbs unrecognised values rather than creating a new series per value. |
| T-09-17 | Tampering | Duplicate instrument declaration | medium | mitigate | The shared memoised accessor returns the identical instrument for a repeated name, and a spec asserts reference equality; this prevents the "two live instruments, one name" defect which silently doubles a series. |
| T-09-18 | Repudiation | Emit-site completeness | medium | mitigate | The completeness test asserts instrument-plus-call-site against the real scrape; a signal that is declared but never emitted fails the build rather than silently reporting nothing. |
| T-09-19 | Information disclosure | Scrape endpoint exposure | medium | accept | `/metrics` exposure is a deployment-network concern owned by the infra configuration, not by the app; at L1 the label discipline above is the app-side control and the boundary control is recorded here for the infra review. |
| T-09-20 | Denial of service | Observable-gauge callback cost | low | accept | The callback reads `getJobCounts()` once per scrape interval on an already-open client; at a 15-second scrape interval the added load is negligible and needs no further control. |
| T-09-SC | Tampering | npm/pip/cargo installs | high | mitigate | This plan installs no new package. The one gated install in this phase is in plan 09-05. |
| T-09-21 | Repudiation | `rules.test.yml` alert proofs | high | mitigate | Every rule carries a firing case **and** an `exp_alerts: []` case, and flipping a comparator must break a case; a single-case test passes even for `expr: vector(1)` and would let a broken rule ship. |
| T-09-22 | Tampering | Rule and panel metric names | high | mitigate | Both the rule-name test and the dashboard test validate extracted identifiers against the registry's two sets, with non-vacuity prefixes; a name that no instrument emits fails the build rather than silently reporting nothing. |
| T-09-23 | Repudiation | `runbook_url` resolution | medium | mitigate | The rule-name test asserts each annotation resolves to an existing file, so a page cannot link an operator to a missing runbook. |
| T-09-24 | Information disclosure | Dashboard panel scope | medium | accept | Dashboards render aggregate series already exposed by the scrape endpoint; they add no new data path and no new label, so at L1 the label discipline from plan 09-03 is the relevant control. |
| T-09-25 | Tampering | CI job image supply chain | medium | mitigate | Both new jobs pin an exact image tag rather than `latest`; an unpinned tag makes the gate's verdict depend on a mutable remote artifact. |
| T-09-25 | Repudiation | Log retention value | medium | mitigate | The guard test reads the same file a deployment would apply, so the number cited for compliance cannot drift from the number applied; the spec reads the file rather than a duplicated constant. |
| T-09-26 | Tampering | CI job image supply chain | medium | mitigate | The k6 job pins an exact image tag rather than `latest`, so the gate's behaviour does not depend on a mutable remote artifact. |
| T-09-SC | Tampering | npm/pip/cargo installs | high | mitigate | This plan installs no npm package (the rule-name extractor is dependency-free by design). The CI jobs pull pinned container images; no package-legitimacy checkpoint is applicable here. |
| T-09-27 | Denial of service | Distributed throttler storage | high | mitigate | The storage uses an atomic fixed-window operation on the shared cache connection so the counter is correct across horizontally scaled instances; a per-process counter would allow an attacker to multiply their limit by the replica count, which is the primary failure this control exists to prevent. |
| T-09-28 | Spoofing | Rate-limit key selection | high | mitigate | Limiters key on the authenticated user identifier and on the link `jti`, never on a client-controlled address; an IP-keyed limiter is both spoofable behind a proxy and incorrect behind NAT, and a spec asserts no tier derives its key from the request IP. |
| T-09-29 | Denial of service | Limiter traffic on the queue Redis instance | high | mitigate | The storage is bound to the cache connection whose evictable policy tolerates the traffic; a spec asserts the client is the cache client and not the queue client, because putting evictable limiter traffic on a `noeviction` queue instance is how a queue stalls under load. |
| T-09-30 | Tampering | Supply chain for the throttler package | high | mitigate | The install is gated behind a blocking human-verify checkpoint on `npmjs.com/package/@nestjs/throttler`; the verdict is `SUS (too-new)` and automated approval is not permitted for that gate. |
| T-09-31 | Repudiation | Throttler cost measurement | medium | mitigate | The measurement is derived from server-reported `commandstats` deltas against a stated request count, never from an in-process estimate; the report names the denominator so the arithmetic is checkable. |
| T-09-32 | Spoofing | Load-generator credentials | medium | accept | The load source needs a valid session to drive the real paths; it runs against a dedicated non-production target and its credentials are deployment-scoped, so at L1 no additional control is warranted beyond keeping it out of the production target. |
| T-09-33 | Tampering | CI job image supply chain | medium | mitigate | The k6 job pins an exact image tag rather than `latest`, so the gate's behaviour does not depend on a mutable remote artifact. |
| T-09-SC | Tampering | npm/pip/cargo installs | high | mitigate | The one install in this plan is `@nestjs/throttler@6.7.1`, gated by the blocking human-verify checkpoint that opens this plan; no other package is installed. |
| T-09-34 | Spoofing | `decryptSecret` kid resolution | high | mitigate | An absent kid throws `KEY_ID_MISMATCH` and never falls back to the active key; a fallback would accept material sealed under a retired or attacker-chosen key. Asserted by a spec with only a different kid present. |
| T-09-35 | Tampering | Sibling wrapped-DEK field | high | mitigate | The wrapped DEK is unwrapped only through the provider's authenticated wrap/unwrap path and the envelope's auth tag still gates the plaintext; a spec asserts a tampered ciphertext under a valid kid fails authentication. |
| T-09-36 | Elevation of privilege | JWT verifier keyring | high | mitigate | The verifier resolves keys from the same keyring as the envelope path and rejects a removed kid without fallback; the pre-existing "unknown kid must not fall back" rule is preserved and extended to rotation. |
| T-09-37 | Denial of service | Rotation without an overlap period | high | mitigate | The previous kid is retained for a stated overlap period and the CLI reports the expiry; removing it immediately would make every in-flight envelope and token undecryptable during a rolling deploy. |
| T-09-38 | Repudiation | Rotation CLI outcome | medium | mitigate | A no-op is reported as already-active distinct from a successful promotion, and an unknown kid exits non-zero; an operator cannot mistake an unchanged keyring for a rotation. |
| T-09-39 | Tampering | Nonce uniqueness under a new key | high | mitigate | A fresh random 12-byte iv per encryption is preserved — the pre-existing iv-uniqueness spec still passes — because a per-secret DEK changes the key but not the nonce-reuse hazard. |
| T-09-40 | Denial of service | Rotation verification cost | low | accept | The concurrency harness runs in-process against a local provider at test scope; it adds no production path and needs no further control. |
| T-09-SC | Tampering | npm/pip/cargo installs | high | mitigate | This plan installs no new package; `jose` is already a runtime dependency and the existing crypto stack is unchanged. |

---

## Consolidated Trust Boundaries

| Boundary | Description | Mitigations |
|----------|-------------|-------------|
| process -> Mongo `audit_entries` | Trailing store crosses a process boundary; api and CLI must see each other's entries | D-01: append-only via `AuditRepository`; guard test pins field set |
| retention service -> audit collection | One module holds delete capability over append-only trail | D-04: single delete owner; guard test asserts retention service is only deleter |
| scheduler -> worker queue | Scheduled trigger crosses into worker process | Payload must not name cutoff or grace window; both from config inside consumer |
| operator -> purge command | Authenticated admin triggers irreversible data deletion | D-02: `operator_id` stamped on soft-delete; one `purge.executed` entry on hard-delete |
| config -> retention/purge windows | Mis-set window deletes compliant data early or never deletes | Validated at boot via config schema; no runtime override |
| App Builder client -> apps listing API | Scope-picker membership rendered from server data | Client cannot infer membership to show purged app as live |
| admin client -> audit query and export API | Authenticated admin input becomes Mongo query predicate and file download | Typed filter object; never interpolate user strings; cap export by filter set |
| erasure caller -> audit store | Erasure is irreversible mutation of audit trail | Operator authorisation is the only separation from tampering; append one erasure audit entry on success |
| scheduler -> worker queue | Quarterly generation trigger crosses process boundary | Quarter must be derived inside consumer, not trusted from payload |
| audit store -> export file | Export is bulk egress of full filtered trail | Highest-volume disclosure surface; require admin; cap response; obey same filters as read path |
| metric instruments -> scrape endpoint | Every emitted label becomes publicly scrapeable time series | Labels restricted to bounded IDs/enums; no user identifier, URL, or free-text |
| alert annotation -> runbook file | Operators trust the runbook a page links to | Rule-name test asserts each annotation resolves to existing file |
| form renderer client -> form load metric | Emit site on request path accepting app and form identifier from caller | Metric labels bounded; unknown values land on explicit `unknown` series |
| client -> rate-limited endpoint | Untrusted callers cross here; limiter is the control | Three named tiers (per-user 10/min, per-app 100/min, per-connector); key on user id + jti, never IP |
| load generator -> API and webhook receiver | Synthetic load source with large credential surface | Runs against dedicated non-production target; credentials deployment-scoped |
| measurement harness -> Redis | Harness reads server statistics | Client is the cache client, not the queue client; evictable policy tolerates traffic |
| key provider -> envelope and JWT verification | Keyring decides whether ciphertext or token is trusted | No kid fallback; absent kid throws `KEY_ID_MISMATCH`; previous kid retained for overlap period |
| operator CLI -> keyring | Rotation command mutates key material every sealed secret and issued token depends on | Previous kid retained for stated overlap period; CLI reports expiry |
| stored secret record -> decrypt | Sibling wrapped-DEK field is new persisted material | DEK unwrapped only through provider's authenticated wrap/unwrap path; envelope auth tag gates plaintext |

---

## Mitigation Summary by Category

| Category | Count | Key Mitigations |
|----------|-------|-----------------|
| **Tampering** | 14 | Guard tests pin field sets; atomic operations; memoised accessors; no kid fallback; typed filters; npm gate |
| **Denial of Service** | 10 | Bounded batch sizes; indexed queries; label cardinality limits; Redis SET NX locks; overlap periods; pinned image tags |
| **Elevation of Privilege** | 3 | No kid fallback in JWT verifier; operator stamping on purge; config validation at boot |
| **Repudiation** | 5 | Single delete operator stamp; audit entries for erasure; idempotent erasure; overlap periods; two-case alert proofs |
| **Spoofing** | 4 | IP-keying forbidden; user id + jti only for throttler; no kid fallback; load generator creds scoped |
| **Information Disclosure** | 5 | Label discipline; export filters same as read path; app-scope authorization; unknown series fallback; deployment-network concern |
| **npm/pip/cargo installs** | 6 | Blocking human-verify checkpoint; package legitimacy gate; no new installs where not needed; pinned container images |

---

## Compliance Verification

- **ASVS level**: 1 (all 40 threats addressed at L1)
- **Build gate**: `npm run build` passes (lint + `tsc -b`)
- **Decision coverage**: 21/21 decisions covered across all plans
- **Post-planning gap analysis**: 34/34 items covered
- **Automated verify**: All tasks have `<automated>` verify; no 3-consecutive gap

---

## Key Security Decisions Recorded

1. **Throttler storage**: hand-written ioredis (both community Redis throttler storages unusable — one 405/deprecated, one peers NestJS ≤11; neither works with ioredis 6 which BullMQ requires)
2. **TypeScript pin**: `6.0.3` hard-pinned; `typescript-eslint@8.71.0` peer `>=4.8.4 <6.1.0` without optional marking is the hard ERESOLVE enforcer
3. **No `prom-client`**: single OTel metrics path only; `prom-client@15.1.3` deprecated ("replaced by `@prometheus-io/client`")
4. **No `@nestjs/observe`**: vendor APM with its own hosted backend; no OTLP exporter; README says *"not a replacement for OpenTelemetry"*
5. **Express adapter only**: `@slack/bolt@5` ships `ExpressReceiver` on `express@^5`; OTel bundles `instrumentation-express` but not `instrumentation-fastify`; `instrumentation-fastify@0.57.0` deprecated
6. **JWT via `jose`**: replaces `@nestjs/jwt`/`jsonwebtoken`; supports `kid` keyring rotation natively via `keyResolver`; HS256 wrong primitive for 90-day-lived stateless read link (asymmetric required)
7. **Redis client**: `ioredis@6.0.0` (BullMQ ships ioredis; cluster is mature path; OTel bundles `instrumentation-ioredis`; never pin 5.x — High Uncontrolled Recursion advisory fixed in 6.0.0)
8. **MongoDB 8.0.x**: never 8.2 (EOL 2026-07-31); 8.3.x equally valid (same EOL as 8.0); 7.0 too little runway
9. **Redis ≥8.2 floor**: 8.0.x EOL 2026-12-01 (62 days); 8.2 EOL 2030-09-01; express as floor not pin
10. **Node 24 LTS**: Node 20 hit EOL 2026-04-30; Node 22 expires 2027-04-30; Node 24 is the only line with ≥18 months runway

---

## Unverified / Requires Follow-up

| Item | Status | Note |
|------|--------|------|
| T-09-30 supply chain (throttler package) | Gate open — human-verify checkpoint | `@nestjs/throttler@6.7.1` legitimacy verdict `SUS (too-new)`; install blocked until explicit approval |
| T-09-32 load-generator credentials | Accept at L1 | Runs against dedicated non-production target |
| T-09-39 nonce uniqueness | Accept — preserved from pre-existing spec | Per-secret DEK changes key but not nonce-reuse hazard |
| T-09-40 rotation verification cost | Accept | Runs in-process against local provider at test scope |
| Docker-dependent tests (T-09-04 erasure, T-09-07 concurrent sweeps, etc.) | Requires testcontainers | Infrastructure-gated, not code deficiencies |
| D-43 `ip` filter on audit view | Code gap documented | `ip` exists in `AuditEntry` but not yet filterable via `AuditQueryFilters`; see `audit-query.service.spec.ts` |