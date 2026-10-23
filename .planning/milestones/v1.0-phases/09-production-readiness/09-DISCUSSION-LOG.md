# Phase 9: Production Readiness — Compliance, Observability & Load - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-20
**Phase:** 9-production-readiness
**Areas discussed:** Audit durability & retention, Erasure & actor_ref, Compliance operator surfaces, Observability deliverables, Key rotation

---

## Area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Audit durability & retention | The AUD-01 store is an in-memory `AuditEntry[]`, so "3-year retention" is a no-op. Durable store? Where does the window live? What happens at the boundary? | ✓ |
| Erasure & actor_ref | AUD-04 tombstoneability; `actor` holds a raw `real_user_id` today. Rename+null, or opaque ref + mapping? Scope, and what executes an erasure? | ✓ |
| Compliance operator surfaces | AUD-05 search, AUD-06 export, AUD-07 access review, AUD-08 purge, AUD-09 archived queryability — incl. mockup-vs-contract conflicts (IP column, App column, `purged` state). | ✓ |
| Observability deliverables | OBS-03 metric coverage, OBS-06 alerts, OBS-07 log retention, OBS-08 load test, OBS-09 dashboards, OBS-10 runbooks. | ✓ |

**User's choice:** All four selected. A fifth area (key rotation) surfaced later from the ROADMAP's Phase 9 notes and was discussed too.

**Notes:** Working state was a 2-line `CONTEXT.md` stub from an earlier kickoff step (no decisions in it). The user chose **Update it** — the stub was treated as placeholder and the canonical artifact written as `09-CONTEXT.md`; the stub was removed so one phase has one CONTEXT file.

---

## Audit durability & retention

### Question 1 — Where should the audit trail live after Phase 9?

| Option | Description | Selected |
|--------|-------------|----------|
| Mongo `audit_entries` collection | Durable *and* cross-process; call sites unchanged (interface preserved); matches the lazy `MongoService.db().collection<T>()` pattern already in `app-definition.repository.ts`. | ✓ |
| External WORM / object-lock store | Strongest tamper-evidence, but infra this phase does not own, breaks one-data-access-style, forces a second read path for AUD-05. | |
| Leave in-memory, document gap | Build surfaces on the array; leaves success criterion 1 unachievable. | |
| You decide | Agent picks. | |

**User's choice:** Mongo `audit_entries` collection
**Notes:** Scout finding that drove it — the array is per-process, shared by api *and* CLI (`packages/cli/rebind.ts`, `provision.ts`, `dlq.ts`), so the api and CLI never see each other's entries and nothing survives a restart.

### Question 2 — Where does the 3-year window live, and does it also govern per-app data?

| Option | Description | Selected |
|--------|-------------|----------|
| Deployment config, 3y floor, app data separate | "Configurable" = operator may extend, never shorten. Per-app `retention_policy` stays about submission data. Sweep runs as a BullMQ Job Scheduler job. | ✓ |
| Per-app audit retention, clamped to 3y | Departments could shorten audit retention; needs clamping; more ways to delete evidence early. | |
| Hardcode 3 years, never delete | Answers storage but leaves "configurable" unanswered. | |
| You decide | Agent picks. | |

**User's choice:** Deployment config, 3y floor, app data separate

### Question 3 — What happens when an audit row crosses the retention boundary?

| Option | Description | Selected |
|--------|-------------|----------|
| Sweep job that audits its own deletion | Job Scheduler sweep deletes and appends its own audit entry (cutoff, count, operator=system) — the deletion is itself evidence. | ✓ |
| Mongo TTL index from config | Declarative and zero-code, but deletions are invisible and a window change needs a `collMod` migration rather than a config edit. | |
| Never delete — retain forever | No boundary behaviour; unbounded growth. | |
| You decide | Agent picks. | |

**User's choice:** Sweep job that audits its own deletion

### Question 4 — How do we keep AUD-01's "append-only by construction" true once something must delete?

| Option | Description | Selected |
|--------|-------------|----------|
| Separate retention service owns the only delete | Repository stays append/read; one dedicated service owns the single `deleteMany`; guard test fails if any other module mutates or deletes audit rows. | ✓ |
| Add `purgeOlderThan()` to `AuditRepository` | Simpler wiring, but every existing injector silently gains a delete capability — the guarantee becomes a convention again. | |
| DB validator + separate delete owner | Mongo validators apply to inserts/updates but **not** deletes, so it only half-helps. | |
| You decide | Agent picks. | |

**User's choice:** Separate retention service owns the only delete
**Notes:** The guarantee moves from an *absence of methods* to *one named, greppable exception*.

---

## Erasure & actor_ref

### Question 1 — How should `actor_ref` be made tombstoneable?

| Option | Description | Selected |
|--------|-------------|----------|
| Opaque `actor_ref` + identities mapping | Audit rows carry a surrogate, never a user id. Erasure deletes one mapping row; no audit row is ever updated. Erasure appends `erasure.executed` as the proof. | ✓ |
| `actor_ref` = `real_user_id`, nulled in place | Literal reading of AUD-04; adds a bulk-update exception to append-only and misses `from_user_id`/`to_user_id`/`updatedBy` unless each is named. | |
| Opaque ref + tombstoned mapping row | Same as opaque, but the mapping row is rewritten to a tombstone instead of deleted — provable erasure at the cost of a permanent residual row. | |

**User's choice:** Opaque `actor_ref` + identities mapping

### Question 2 — How does the erasure operation know which audit fields to clear?

| Option | Description | Selected |
|--------|-------------|----------|
| Close the shape, redact `*_ref` by convention | Drop `[key: string]: unknown`; identity fields named `*_ref`; erasure redacts every `*_ref` — mechanically complete, no list to maintain. | ✓ |
| Hardcoded redaction list on the open shape | Works for today's 19 keys, silently misses the next ad-hoc key — exactly how `from_user_id` got there. | |
| Redact `actor_ref` only | Truest to AUD-04's literal text; leaves the other identity fields in the trail. | |

**User's choice:** Close the shape, redact `*_ref` by convention
**Notes:** Scout finding behind it — 19 distinct keys are appended today including `from_user_id`, `to_user_id`, `updatedBy` and free-text `changeSummary`; an open index signature makes the erasure scope unenumerable.

### Question 3 — What executes an erasure request?

| Option | Description | Selected |
|--------|-------------|----------|
| Operator CLI command in `packages/cli` | Named `erase` command following the existing CLI harness; erasure is rare, deliberate and irreversible, so it does not get a console button. | ✓ |
| Builder-console action on the Users page | Discoverable, but undepicted in the mockup and puts an irreversible act one click from the console. | |
| Both — CLI mechanism + console request intake | Adds a queue and a second surface for the same rare operation. | |

**User's choice:** Operator CLI command in `packages/cli`

### Question 4 — How far does the erase command reach in Phase 9?

| Option | Description | Selected |
|--------|-------------|----------|
| Audit refs + submission purges, per the frozen ruling | Matches REQUIREMENTS conflict table row 3 exactly; in-memory profile/identity stores recorded as a **named limitation**, not a silent gap. | ✓ |
| Expand: make profile + identity durable too | Completes the promise end-to-end but adds two durable stores to a phase already carrying thirteen requirements. | |
| Audit refs only; purges stay separate | Erasure and data purge become two unrelated events. | |

**User's choice:** Audit refs + submission purges, per the frozen ruling

---

## Compliance operator surfaces

### Question 1 — SC#1 says "who changed what, when, and *from where*". What does the audit view expose?

| Option | Description | Selected |
|--------|-------------|----------|
| Serve `ip` on the audit view | Aligns code with the D-43 allowlist (which includes `ip` and `user_agent`), AUD-02 and the mockup's IP column; the stale D-43 citation is corrected. | ✓ |
| New `source` column instead of IP | The only option that answers "from where" for system actors with no IP — but needs plumbing at every append site and invalidates the mockup's IP column. | |
| Both — `source` visible, IP on reveal | Richest, but the reveal affordance is undepicted and needs a further design ruling. | |

**User's choice:** Serve `ip` on the audit view
**Notes:** Finding recorded as F-1 — `audit.controller.ts:37` and `AuditPage.tsx` justify dropping `ip` by citing D-43, but `LOG_FIELD_ALLOWLIST` includes `ip` and `user_agent`. The projection is narrower than the contract, and the justification is stale.

### Question 2 — How should AUD-05's search be delivered?

| Option | Description | Selected |
|--------|-------------|----------|
| Extend `GET /audit` + first-class `app_id` | Filter params pushed into a Mongo query with compound indexes; `app_id` becomes a real entry field, fixing the mockup's unbacked App column and `target`'s overloaded meaning. | ✓ |
| Extend `GET /audit`, filter on `target` | Zero new fields, but `target` is an app id for some actions and a transfer/connector id for others, so the filter silently mismatches. | |
| Separate `GET /audit/search` endpoint | Two routes serving the same projection, two places to keep the allowlist in sync. | |

**User's choice:** Extend `GET /audit` + first-class `app_id`

### Question 3 — Which export format should AUD-06 ship?

| Option | Description | Selected |
|--------|-------------|----------|
| JSON Lines only, matching the mockup | One button, matching the mockup's label; lossless for optional fields; no new dependency. | ✓ |
| CSV only, reusing `csv-stringify` | Least new code (the submissions export already uses it), but the mockup's button label must change. | |
| Both CSV and JSON Lines | Satisfies the requirement unambiguously; second writer and second button on a rarely used surface. | |

**User's choice:** JSON Lines only, matching the mockup
**Notes:** `csv-stringify@^6.9.0` is already a dependency (`apps/api/src/submissions/submission-export.service.ts`), so a CSV sibling stays cheap if an operator asks.

### Question 4 — Where does the quarterly access-review report live and how is it delivered?

| Option | Description | Selected |
|--------|-------------|----------|
| Quarterly job + stored report + new console route | Job Scheduler job computes entitlements, stores the report, appends `access_review.generated`; a new global-admin route renders it and offers the same JSON Lines download. | ✓ |
| Quarterly job + artifact reachable from Audit Log | Fewer surfaces, but entitlements stay buried behind a browse that is about actions, not access. | |
| Quarterly job + outbound delivery, no UI | No console surface; delivery becomes the only way to see it. | |

**User's choice:** Quarterly job + stored report + new console route
**Notes:** AUD-07 has **no depicted surface** in `prototypes/mockup.html` (nav = Dashboard / Apps / Submissions / Connectors / Audit Log / User Management / Settings). Per the project rule that absence is not permission, this was raised explicitly and the mockup will be amended rather than improvised from.

### Question 5 — How is AUD-08's purge modelled — does `purged` become a lifecycle state?

| Option | Description | Selected |
|--------|-------------|----------|
| Amend the contract: add `purged`, one exit from `archived` | `archived → purged` is the single permitted exit; a purge record carries the grace fields; the console button soft-deletes only and the sweep hard-deletes after 30 days; audit entry carries operator ID + timestamp. | ✓ |
| Keep the enum frozen; purge as a separate record | No frozen-enum change, but the mockup's 5-state list is wrong and "is this app purged?" becomes a join. | |
| CLI-only purge; remove the console button | Consistent with the `erase` decision, but the mockup's button, badge and retention callout become dead markup. | |

**User's choice:** Amend the contract: add `purged`, one exit from `archived`
**Notes:** Mockup is explicit — `states = ["draft","published","deprecated","archived","purged"]`, Purge button writes `action: "app.purge"` with operator IP, retention modes `purge_after_days` / `purge_immediately_on_archive`, callout "Purge operations are written to the immutable audit trail with operator ID and timestamp." The frozen enum (`publish.contract.ts:82`) and `app-lifecycle.ts` (which refuses every exit from `archived`) are the things that move. The console button is safe because it is **not** the irreversible act.

### Question 6 — AUD-09: how does a global admin reach an archived app's data?

| Option | Description | Selected |
|--------|-------------|----------|
| Existing Submissions view, archived included + marked | No new surface; archived is queryable, purged is not. | ✓ |
| Dedicated compliance read surface | Clearer separation, but a third new console route with nothing in the mockup to design from. | |
| You decide | Agent picks. | |

**User's choice:** Existing Submissions view, archived included + marked

---

## Observability deliverables

### Question 1 — How do we reconcile SC#5's `partial` mention with OBS-06's seven conditions?

| Option | Description | Selected |
|--------|-------------|----------|
| Take SC#5 seriously: eight conditions | OBS-06's seven plus `submission_status{status="partial"}` — satisfies both readings as a superset. | ✓ |
| OBS-06 wins: seven alerts, `partial` metric-only | Records the SC divergence rather than resolving it. | |
| Implement the union, record the divergence | Same implementation, but leaves the requirement wording untouched as a visible defect. | |

**User's choice:** Take SC#5 seriously: eight conditions
**Notes:** OBS-06 names seven (connector failure >5%/5 min, token-consume failure >10/min, avg decision confidence <0.6/10 min, DLQ depth >50, Redis memory >80%, Mongo replication lag >5 s, all decision providers unhealthy). SC#5 says "each of the seven named alert conditions fires in a test — including `submission_status{status=\"partial\"}` and all decision providers unhealthy", and `partial` is not in the seven (it is OBS-04, already complete). Recorded as F-4.

### Question 2 — Where do alert rules live, and how is "each alert fires in a test" proven?

| Option | Description | Selected |
|--------|-------------|----------|
| Rule files + `promtool test rules` in CI | Uses Prometheus's own evaluation semantics, so the test proves the *rule* fires; Docker is already available via `tooling/`. | ✓ |
| In-app rules + vitest threshold assertions | No external binary, but a typo in an `expr` would pass because nothing evaluates the rule. | |
| Live Prometheus stack, poll for Firing | Highest fidelity; slow, flaky, too heavy for every commit. | |

**User's choice:** Rule files + `promtool test rules` in CI

### Question 3 — What harness satisfies OBS-08?

| Option | Description | Selected |
|--------|-------------|----------|
| k6 scenario + Redis `commandstats` deltas | External binary so `node_modules` does not grow; can actually hold 1,000 VUs; Redis cost *measured* per command rather than assumed. | ✓ |
| autocannon + Node enqueue harness | Node-native, but one event loop weakens the 1,000-concurrent-user claim. | |
| In-process vitest load spec | No new tooling, but measures the test runner as much as the system. | |

**User's choice:** k6 scenario + Redis `commandstats` deltas

### Question 4 — How strict is OBS-03's metric coverage?

| Option | Description | Selected |
|--------|-------------|----------|
| Every named signal: real instrument + real emit site | Closes the `queue.oldest.item.age` precedent (a name constant with nothing behind it), which is the failure OBS-03 exists to prevent. | ✓ |
| All instruments declared; emit sites where natural | Preserves the gap deliberately rather than treating it as debt. | |
| Only signals an alert or dashboard consumes | Least code; leaves signals the requirement explicitly names with nothing behind them. | |

**User's choice:** Every named signal: real instrument + real emit site

### Question 5 — OBS-09's dashboards — where do they live?

| Option | Description | Selected |
|--------|-------------|----------|
| Grafana dashboard-as-code in-repo | Consumes the existing `/metrics` endpoint; no new app surface, no second auth boundary, panels verified against the emitted-metric registry. | ✓ |
| Extend the App Builder Dashboard page | Reuses the mockup's tokens and the phase's UI hint, but time-series panels need the console to query Prometheus — new credentials, CORS and SSO questions. | |
| Both Grafana and console tiles | Union of both costs. | |

**User's choice:** Grafana dashboard-as-code in-repo

### Question 6 — OBS-07 and OBS-10 — how are they shipped and kept honest?

| Option | Description | Selected |
|--------|-------------|----------|
| Committed artifacts + drift tests for both | Retention values asserted against OBS-07; five runbooks linked by `runbook_url` with a test that every link resolves and all five incidents are covered. | ✓ |
| Documented only, verified by review | Nothing stops the numbers drifting or an alert pointing at a missing runbook. | |
| Runbooks as docs; retention as runnable infra | More real, but retention is time-based so behaviour still cannot be tested quickly. | |

**User's choice:** Committed artifacts + drift tests for both

---

## Key rotation (surfaced during discussion)

**How it arose:** The ROADMAP's Phase 9 notes claim "zero-downtime rolling deploys and zero-downtime key rotation are verified here." WINDOW 7 says the opposite for envelopes — the DEK is derived by wrapping a fixed 32-byte label because D-25's five-field envelope has nowhere to persist a per-secret wrapped DEK, so rotating `kid` makes previously sealed envelopes undecryptable, and *"no real credential may be stored before it is [fixed]."* FND-10 (KMS vendor) stays Pending. The JWT link keyring is different: `jwt-verifier.ts` resolves `kid → key` and is additive by construction.

### Question — How should Phase 9 handle the zero-downtime key-rotation obligation?

| Option | Description | Selected |
|--------|-------------|----------|
| Close WINDOW 7 in Phase 9, then verify both | Persist the wrapped DEK beside the envelope — additive, five fields unchanged; then both JWT keyring and envelope rotation verify as genuinely zero-downtime; FND-10 stays Pending. | ✓ |
| Verify the JWT keyring only; keep WINDOW 7 open and named | Scopes the claim to what is true; leaves production gated on the window. | |
| Declare rotation blocked on FND-10 | Verifies nothing; leaves the phase's own note unanswered. | |

**User's choice:** Close WINDOW 7 in Phase 9, then verify both
**Notes:** Rationale recorded in CONTEXT — a production-readiness phase that ships while a "no real credential may be stored" window is open would be self-contradictory.

---

## the agent's Discretion

- Whether `user_agent` also joins `ip` on the audit view (allowlist permits it; mockup does not depict it).
- Index shape for `audit_entries`.
- The `access_reviews` collection shape and report JSON Lines schema.
- Whether the retention window is a duration or an absolute cutoff in config.
- PromQL specifics, recording-rule choice, Grafana panel layout, and `for:` durations beyond those OBS-06 states.
- Internal section structure of each runbook.
- Mechanics of amending `prototypes/mockup.html` for the App/IP columns and the new Access Review nav entry.
- Semantics of the mockup's per-app "Export to JSON Lines before purge" switch.
- Whether to close WINDOW 5 (pino's `msg` allowlisted verbatim) if a lint rule proves cheap.

## Deferred Ideas

- Make `ProfileRepository` / `IdentityMappingRepository` durable so erasure can clear email/name/employee_code (D-08 records the limit).
- CSV export alongside JSON Lines (cheap per D-11, not asked for).
- A dedicated compliance read surface for archived apps, and a `source`/`ip`-reveal affordance on the audit view.
- FND-10 / KMS vendor selection — stays Pending.
- WINDOW 13 (un-narrowed auto-instrumentation, tracing cost), WINDOW 17 (`phase.complete` overwriting deferred requirements), WINDOW 26 (entrypoint-drift orphan D-08-05-1).
- Legal review of the "legitimate interest" framing for 3-year audit retention.

## Findings Recorded (not decisions)

- **F-1** — `ip` was dropped from the audit view on a stale D-43 citation; D-43 allowlists `ip`.
- **F-2** — The mockup's audit App column has no backing field on the entry or the view.
- **F-3** — The mockup's lifecycle state list already included `purged`, ahead of the frozen contract enum.
- **F-4** — SC#5 names seven alert conditions but lists `partial`, which is not among OBS-06's seven.
