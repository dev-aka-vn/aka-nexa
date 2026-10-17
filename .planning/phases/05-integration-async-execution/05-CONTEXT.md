# Phase 5: Integration & Async Execution - Context

**Gathered:** 2026-10-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Make a submission **land in a downstream enterprise system** through a globally-managed, shared
connector — synchronously to internal storage, asynchronously externally, or both — with a failure
that is **visible rather than silent**. This phase delivers: the three data modes
(`internal`/`external`/`hybrid`, DAT-01), the internal write + external call split (DAT-02/03/04/05),
the exactly-three-state outbound model `not_sent | sent_unconfirmed | confirmed` (DAT-06), the
`not_sent`-only reconciliation (DAT-07), the amended single-send guarantee (DAT-13), the
user-facing status surface (DAT-14), the connector interface/management/async machinery
(CON-01…CON-10), the edit link (LNK-02), and connector observability (OBS-04).

**Not this phase:** the App Builder authoring UI, saved-query authoring, and admin SSO
(BLD-12) — all Phase 6; additional IM adapters — Phase 7; the purge flow that *writes*
`deleted_at` — Phase 8; notification / two-way sync — later. The frozen contracts from
earlier phases (the read-link claim set D-21, the JEV v1 wire contract) are **consumed, not
changed**.

</domain>

<decisions>
## Implementation Decisions

### Submission status surface (DAT-14)
- **D-80:** The status surface is a **per-app "My submissions" list**, reached by the **frozen
  `query` read-link action** carrying a per-user saved query. DAT-11's auto-injected
  `real_user_id` + `deleted_at: null` is the ownership filter — **no new token claim and no new
  action**. Cross-app listing is explicitly out of scope. — **Reversibility:** one-way — the
  read-link action enum is frozen (D-21/D-24, LNK-07); adding a cross-app action later means a
  second published token contract, and a claim added then is a `400` on every link issued now.
- **D-81:** A `partial` submission is **read-only** on the status surface: it names the outstanding
  destination (e.g. *"Internal saved · Redmine: retrying"*) and carries **no user-facing retry**.
  Retry stays with the admin/DLQ path (CON-04 / D-83–D-85). — **Reversibility:** reversible.
- **D-82:** Each row/detail shows app, form, submitted time, status; for a **confirmed** external
  call the **downstream reference**; for a failure a **user-safe reason** mapped from the connector
  error taxonomy. Raw HTTP bodies, credentials, and PII never surface (allowlist discipline,
  D-43 / W-22). — **Reversibility:** reversible.

### Admin surfaces without admin auth (CON-02/04/08)
- **D-83:** Phase 5 ships an **operator CLI mirroring D-31** — connector upsert from committed
  files, `dlq list` / `dlq retry`, and the connector-ref rebind (D-86). **No admin HTTP surface**;
  admin auth is Phase 6 (BLD-12), which replaces the files with real authoring. — **Reversibility:**
  costly — the CLI shape and its audit events are what Phase 6's UI must reproduce.
- **D-84:** `dlq retry` **re-enqueues through the same outbox path** automatic retry uses. Only
  `not_sent` is retriable by default; a `sent_unconfirmed` item requires an explicit `--force` that
  first runs the **DAT-13 natural-key pre-check** — never a blind resend (SC#3). — **Reversibility:**
  costly — this is the SC#3 safety rule; loosening it is a silent double-send.
- **D-85:** DLQ CLI output is **redacted by default** (ids, outbound state, error-taxonomy code,
  attempt count, timestamps) under the same field allowlist that governs logs; `--show-payload` is
  opt-in **and is itself written to the audit trail**. — **Reversibility:** reversible.
- **D-86:** An app's `connector_ref` change is a **seed-file edit + idempotent reload** (D-31); the
  loader detects the diff and writes a dedicated **AUD-01 before → after transition**. Committed
  files stay the source of truth — no DB-vs-file divergence. — **Reversibility:** costly — Phase 6
  authoring inherits this reconciliation model.

### Connector credentials, interface & Redmine (CON-01/02/09, FND-10, W-24)
- **D-87:** **Both credential gates stay open.** FND-10 / D-27 (no KMS vendor named) and
  WINDOWS #7 / W-24 (the envelope's wrapped-DEK is not persisted beside the envelope) are **not
  resolved here**. Phase 5 ships the full connector capability but keeps `LocalKeyProvider` + the
  production guard intact (prod still refuses to boot without `CRYPTO_KEY_PROVIDER=kms`) and stores
  only **local/test credentials**. Storing a *production* credential stays blocked. — **Reversibility:**
  reversible — deliberately deferred; unblocks wholesale the day the deployment cloud is named.
- **D-88:** The first connector credential is stored as the existing **five-field AES-256-GCM
  envelope via the `KeyProvider` abstraction**, in a `connector_credentials` collection keyed by
  `credential_ref`. The identical resolution path works unchanged once the KMS adapter lands. —
  **Reversibility:** reversible.
- **D-89:** The shared contract `Connector` interface **evolves to CON-01's full shape** —
  `testConnection()`, `getCapabilities()`, and `execute(operation, payload, context)`. One interface
  everywhere; Phase 6's publish-time `supports_idempotency_key` surface and Phase 7 adapters build on
  it. — **Reversibility:** one-way — `packages/contract/src/connector/connector.ts` is a published
  seam; once Phase 5 consumers and the Phase 6 builder exist, changing its shape is a migration
  across every connector and the builder surface.
- **D-90:** The Redmine connector is a **generic REST transport core** (base_url, auth from
  `credential_ref`, timeout, retry, rate limit) **plus a thin Redmine adapter** supplying endpoint
  paths, `{{form.field}}` / `{{real_user.attribute}}` mapping, and the HTTP-status →
  **error-taxonomy** mapping (including the CON-07 `credential_rejected` vs `endpoint_unreachable`
  split). — **Reversibility:** costly — the mapping/taxonomy contract is what Phase 7 adapters reuse.

### Edit links & the single-send guarantee (LNK-02 / DAT-06 / DAT-13)
- **D-91:** An edit is a **new revision with a new send** — the correction **does reach the external
  system**. DAT-13's guarantee is reworded from *"a single send per submission"* to **"a single send
  per revision"**. — **Reversibility:** one-way — this amends a v1 requirement (DAT-13) and FR-D-12's
  amendment; reverting re-litigates write-once and invalidates stored revisions.
- **D-92:** The downstream idempotency key is the composite **`{submission_id}:{revision}`** — this
  **amends FR-C-5's literal `submission_id`**. The same revision re-attempted is idempotent; a new
  revision is a distinct downstream operation. — **Reversibility:** one-way — the key is what
  downstream systems dedupe on; changing it later can create duplicate downstream records.
- **D-93:** An edit link is issued **from the per-app status/view surface, owner-only**
  (`real_user_id`), with a **live app-permission + `perm_version` re-check on access** mirroring the
  view link; it pre-fills from the **latest revision**; 4-hour TTL, consumes on submit (LNK-02). —
  **Reversibility:** costly — shares the view-link verifier and the confirmation/status surfaces.
- **D-94:** Revisions are **append-only immutable records** in a `submission_revisions` collection
  keyed by `{submission_id, revision}`; the submission document points to the latest. The outbox's
  `not_sent | sent_unconfirmed | confirmed` state is tracked **per revision**. — **Reversibility:**
  costly — the revision schema is the per-revision outbox unit and the status-page data source.
- **D-95:** A **consumed edit link submitted a second time returns the original confirmation** for
  the revision that consumed that `jti` — an idempotent replay, no new revision, no error, no
  duplicate record (SC#4). The consumed-token path **branches by link action**: `create` →
  *"already submitted"* (PRD §12.1 step 14); `edit` → replay. — **Reversibility:** costly — the
  consumed-link behaviour is user-visible and shared across both link types.

### Locked by requirement (recorded, not open)
- **D-96:** The outbound state is **exactly** `not_sent | sent_unconfirmed | confirmed`, committed as
  `sent_unconfirmed` **before** the outbound call (DAT-06); the reconciliation job retries **only
  `not_sent`** and never auto-resents `sent_unconfirmed` (DAT-07). Connectors are **globally managed**
  and an app never owns a credential (CON-02); `app_id` is a first-class label on connector metrics
  (CON-06); a failed call retries with exponential backoff base 2 s, max 5 attempts, then DLQ
  (CON-03).

### the agent's Discretion
- **CON-10 transactional-outbox implementation** — Mongo change stream on the committed write vs an
  outbox collection polled by a BullMQ Job Scheduler. The guarantee (outbound never sent for a write
  that did not commit) is fixed; the mechanism is open.
- **CON-03 backoff/DLQ cadence** — the base 2 s / max 5 attempts budget is required; the scheduler
  mechanics and the reconciliation-job interval are discretionary.
- **CON-05/06 wiring** — per-connector-instance limiter over the hand-written `ThrottlerStorage`
  (D-8.2, STACK) and the `app_id` metric label (single OTel→Prometheus path, STACK §6).
- **DAT-03 field-mapping evaluation** — how `{{form.field}}` / `{{real_user.attribute}}` expressions
  are parsed and resolved, and where mapping errors are classified.
- **DLQ retention window, connector health-check cadence, stuck-`sent_unconfirmed` staleness
  handling, seed-file layout, metric naming, exact copy strings.**

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase & requirement sources
- `.planning/ROADMAP.md` — Phase 5 block: goal, 5 success criteria, dependency on Phase 4 and on
  Phase 2's submission record, the three-state outbound ruling, and the note that DAT-14 lands here
  because `partial` is unreachable before it.
- `.planning/REQUIREMENTS.md` — DAT-01, DAT-03…DAT-07, DAT-13, DAT-14; CON-01…CON-10; LNK-02;
  OBS-04; AUD-01/02; the FND-10 body + coverage-table row (line ~410, **STAYS PENDING**).
- `.planning/WINDOWS.md` **#7 (W-24)** — the envelope's fixed-label DEK derivation and the "no real
  credential may be stored before" the wrapping upgrade. **#17** — the FND-10 revert and why the
  requirement must stay Pending.
- `.planning/PRD.md` §6.4 (Submission), §6.5 (Connector), §8.6 (Data Routing), §8.8 (Connectors),
  §10.4 (Submission JSON), §10.5 (Connector Definition), §12.1 (Create Flow).

### Frozen / shared contracts (consume, do not change)
- `packages/contract/src/connector/connector.ts` — the connector seam (`ConnectorDescriptor` with
  required `supports_idempotency_key`; `ConnectorExecuteInput.idempotencyKey`). **D-89 evolves this.**
- `packages/contract/src/links/read-link-claims.ts` — the **frozen** six-action enum
  (`create|edit|view|query|notification|draft`) and `READ_LINK_TARGET_RULES`; D-80 reuses `query`.
- `packages/contract/src/links/read-link-claims.frozen.spec.ts` — D-24 key-set test; must stay green.

### Prior phase context (decisions carried forward)
- `.planning/phases/01-foundations-platform/01-CONTEXT.md` — D-25 (five-field envelope), D-27
  (KMS vendor blocked), D-28 (no real secret in Phase 1), D-31 (seeds + idempotent loader), D-21
  (frozen claims), D-24 (frozen test).
- `.planning/phases/02-the-vertical-slice-slack-internal-routing/02-CONTEXT.md` — D-31 loader, D-38
  (no outbound queue), D-40 (action-branching verifier), D-42 (reads never consume), D-43 (log
  allowlist fields), D-44 (`real_user_profiles` for `{{real_user.attribute}}`).
- `.planning/phases/04-read-path-query-dsl/04-CONTEXT.md` — D-64…D-79: the DSL compiler with
  structural auth injection, saved queries (D-73), the read verifier, `view_all` scope (D-76/78),
  own-record-only view (D-79) — all reused by the status surface and edit issuance.

### Research & stack
- `.planning/research/STACK.md` §4.4 (Redis/ioredis/BullMQ), §6 (single OTel metrics path), §8.4
  (AES-256-GCM: auth tag stored+verified, nonce never reused), §11 (installation), §12 (do-not-use).
- ROADMAP Phase 5 research note — **Redmine contract research is required**: field mapping,
  idempotency-key support, error taxonomy.

### Existing code to read before planning
- `packages/domain/src/submissions/submission.repository.ts` — `Submission` shape + `status`
  union; the Phase 5 record grows from here.
- `packages/domain/src/dsl/` (`dsl.service.ts`, `compiler.ts`, `filter-builder.ts`, `ast.ts`) — the
  DSL the status list reuses.
- `packages/domain/src/links/read-verifier.service.ts` + `packages/platform/src/crypto/jwt-verifier.ts`
  — the verifier D-93 mirrors.
- `packages/platform/src/crypto/envelope.ts` + the `KeyProvider` implementation — the store D-88
  reuses (and W-24 flags).
- `apps/api/src/read/read.controller.ts` + `read.module.ts` — the read-surface composition the status
  endpoint extends.
- `packages/domain/src/registry/` and the seed loader (`D-31`) — the pattern D-86 extends.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Connector seam** (`packages/contract/src/connector/connector.ts`): `ConnectorDescriptor`,
  `ConnectorExecuteInput.idempotencyKey`, `supports_idempotency_key` — the base D-89/D-92 extend.
- **Envelope + `KeyProvider`** (`packages/platform/src/crypto/`): five-field AES-256-GCM with the
  production guard — the credential store D-88 reuses.
- **`DslService` + filter builder** (`packages/domain/src/dsl/`): validate → compile → structural
  `real_user_id` + `deleted_at: null` injection — the ownership filter for the status list (D-80).
- **Read verifier** (`packages/domain/src/links/read-verifier.service.ts`) + the renderer read pages:
  the pattern the edit link and status surface mirror (D-93).
- **Submission repository** (`packages/domain/src/submissions/`): `Submission.status` already carries
  `completed|partial|failed|pending_external` — the status page reads it; revisions (D-94) extend it.
- **Idempotent seed loader (D-31)**: the mechanism D-86's audited rebind rides.

### Established Patterns
- **D-31 seeds + idempotent CLI loader**, no HTTP admin surface until BLD-12 — D-83/D-86 follow it.
- **Frozen contracts are consumed, never reshaped in-place** (D-21/D-24) — D-80 avoids a new action
  for exactly this reason; D-89 is flagged `one-way` because it *is* a seam change.
- **Single metrics path**: OTel API → `exporter-prometheus` (STACK §6) — CON-05/06 wire here.
- **Append-only audit (AUD-01)** and the **field allowlist before serialisation** (D-43/W-22) —
  D-85's redaction and D-86's transition event both use them.
- **All logic in the consumer**, not the receiver (PROJECT constraint) — the connector worker owns
  backoff/DLQ; the CLI must not call connectors inline.

### Integration Points
- `packages/domain/src/connectors/` and `packages/domain/src/datarouter/` — **currently empty**; the
  phase's core new modules.
- `apps/worker/src/` — the connector/outbox consumer + reconciliation (new processors).
- `apps/scheduler/src/` — the reconciliation Job Scheduler (DAT-07) and backoff sweeps.
- `apps/api/src/read/` — the status endpoint and edit-link issuance extend the read module.
- `apps/api/src/submissions/` — the submission write path (`internal` sync) connects the data router.

</code_context>

<specifics>
## Specific Ideas

- **Copy**: the status list row language is *"Internal saved · Redmine: retrying"*; the confirmed
  external reference is shown to the user (e.g. the Redmine issue id).
- **"My submissions"** is the surface name; the partial is read-only and never offers a user retry.
- The DLQ experience is explicitly an **operator/CLI** experience in Phase 5, with the redacted view
  as the default and the raw payload behind an audited flag.
- Edits are framed to downstream systems as **revisions**, not corrections-in-place.

</specifics>

<deferred>
## Deferred Ideas

- **Cross-app "My submissions" list** — deferred (D-80 chose per-app reuse of `query`); would require
  a second, small token contract outside the frozen read-link claim set.
- **User-facing "Retry now"** on a `partial` submission — excluded (D-81); retry is admin/DLQ-only.
- **Retry telemetry on the status page** (attempt count, next-retry time) — excluded (D-82).
- **Runtime `app rebind` CLI into the DB** — deferred (D-86 chose seed-file edit + audited reload).
- **Early authenticated admin HTTP surface (pull OIDC forward)** — deferred to Phase 6 (BLD-12).
- **Redmine contract detail** (field mapping values, idempotency-key support, error taxonomy) —
  routed to **required research** per the ROADMAP note, not decided here.
- **KMS vendor adapter + the W-24 envelope upgrade** — deferred and still blocking a *production*
  connector credential (D-87); unblocks when the deployment cloud is named.

### Reviewed Todos (not folded)
None — the phase had no matching todos.

None beyond the above — discussion stayed within phase scope.

</deferred>

---

*Phase: 5-Integration & Async Execution*
*Context gathered: 2026-10-09*
