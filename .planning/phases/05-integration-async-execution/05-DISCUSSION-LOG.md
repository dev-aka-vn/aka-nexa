# Phase 5: Integration & Async Execution - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-09
**Phase:** 5-Integration & Async Execution
**Areas discussed:** Submission status surface, Admin surfaces without admin auth, Connector credentials & the two gates, Edit links & single-send guarantee

---

## Submission status surface (DAT-14)

**Q1 — How should a user browse their submissions to check status?**

| Option | Description | Selected |
|--------|-------------|----------|
| Per-submission page from the confirmation | Each confirmation links to a status page for that one record; smallest surface | |
| A "My submissions" list | A signed page listing the user's own submissions with statuses, rows linking to detail | ✓ |
| Both — list plus per-submission detail | List entry point + per-record detail page | |

**User's choice:** A "My submissions" list
**Notes:** DAT-14 says "submissions" (plural); the list gives the `partial` a durable home.

---

**Q2 — Should "My submissions" be one cross-app list, or scoped per app?**

| Option | Description | Selected |
|--------|-------------|----------|
| Cross-app, one list | Everything the user submitted, any app; needs a token model outside the frozen read-link claims | |
| Per-app, reuse query link | Scoped to one app; reuses the frozen `query` action with a per-user saved query; DAT-11 injects ownership | ✓ |
| Per-app now, cross-app later | Ship the reuse now, defer the second token contract | |

**User's choice:** Per-app, reuse query link
**Notes:** Avoids touching the frozen six-action claim set (D-21).

---

**Q3 — When a hybrid submission is `partial`, what should the user see and can they act on it?**

| Option | Description | Selected |
|--------|-------------|----------|
| Read-only status + pending destination | Names the outstanding destination; retry stays admin/DLQ | ✓ |
| Add a user "Retry now" (not_sent only) | User-triggered reconciliation, only for `not_sent` | |
| Status word only | Just the status word, no destination breakdown | |

**User's choice:** Read-only status + pending destination
**Notes:** Keeps the user out of the send loop; no duplicate-send risk.

---

**Q4 — How much detail should each submission row/detail show beyond the status word?**

| Option | Description | Selected |
|--------|-------------|----------|
| Standard: ref + safe reason | App/form/time/status + downstream ref on success + mapped safe failure reason | ✓ |
| Minimal | App/form/time/status only | |
| Maximal: include retry telemetry | Standard + attempt count, next-retry time, last attempt | |

**User's choice:** Standard: ref + safe reason
**Notes:** Never a raw HTTP body, credential, or PII.

---

## Admin surfaces without admin auth (CON-02/04/08)

**Q1 — How should global admins view/retry the DLQ and change a connector_ref in Phase 5?**

| Option | Description | Selected |
|--------|-------------|----------|
| CLI/operator tool, audited | Mirrors D-31; connector upsert, `dlq list`/`retry`, rebind; audited; no new auth surface | ✓ |
| Domain capability now, surface deferred | Build services + audit, no operator surface; tests only | |
| Early authenticated admin surface | Pull OIDC SSO forward from Phase 6 | |

**User's choice:** CLI/operator tool, audited
**Notes:** Consistent with Phase 2's D-31; Phase 6 replaces files with real authoring.

---

**Q2 — When a global admin retries a DLQ item by hand, what should actually happen?**

| Option | Description | Selected |
|--------|-------------|----------|
| Same path, guard + --force | Re-enqueue through the outbox path; only `not_sent` by default; `--force` runs the DAT-13 pre-check | ✓ |
| Unconditional re-enqueue | Re-enqueue anything; can double-send a `sent_unconfirmed` | |
| Synchronous inline replay | Call the connector inline, bypassing the queue | |

**User's choice:** Same path, guard + --force
**Notes:** SC#3 — nothing in `sent_unconfirmed` is ever blindly resent.

---

**Q3 — What does the DLQ CLI show, given the payload can contain PII?**

| Option | Description | Selected |
|--------|-------------|----------|
| Redacted by default, opt-in audit-logged payload | Allowlisted summary by default; `--show-payload` is opt-in and audited | ✓ |
| Print full payload | Verbatim payload; pushes PII into scrollback | |
| Ids + error code only | No payload or field values ever | |

**User's choice:** Redacted by default, opt-in audit-logged payload
**Notes:** Same field allowlist that governs logs (D-43/W-22).

---

**Q4 — How is an app's `connector_ref` changed (CON-08), and where does that config's source of truth live?**

| Option | Description | Selected |
|--------|-------------|----------|
| Seed-file edit + audited reload | Loader detects the diff and writes an AUD-01 before→after; files stay the source of truth | ✓ |
| Runtime CLI rebind into the DB | Runtime mutation; DB becomes the source of truth; seeds become create-if-absent | |
| Both, with a precedence rule | Seeds create-if-absent + CLI rebind, explicit precedence | |

**User's choice:** Seed-file edit + audited reload
**Notes:** No DB-vs-file divergence.

---

## Connector credentials & the two gates

**Q1 — How should Phase 5 handle the two credential gates (FND-10/D-27 and W-24)?**

| Option | Description | Selected |
|--------|-------------|----------|
| Resolve both gates in Phase 5 | Name the cloud, implement the vendor adapter, do the W-24 upgrade, store a real credential | |
| Ship capability, keep gates open | Ship connectors but keep `LocalKeyProvider` + prod guard; local/test credentials only | ✓ |
| Do W-24 now, defer the vendor adapter | Vendor-neutral upgrade now; KMS adapter later | |

**User's choice:** Ship capability, keep gates open
**Notes:** FND-10 and W-24 stay open; storing a production credential stays blocked.

---

**Q2 — With the gates kept open, how should Phase 5 store and resolve the first connector credential?**

| Option | Description | Selected |
|--------|-------------|----------|
| Encrypted store via KeyProvider, local creds | Five-field envelope + `KeyProvider`, `connector_credentials` keyed by `credential_ref` | ✓ |
| Dev env/config only | Plaintext env/config; no encrypted store | |
| Test stub only | Never resolve a real credential; always stubbed | |

**User's choice:** Encrypted store via KeyProvider, local creds
**Notes:** Same resolution path works once the KMS adapter lands.

---

**Q3 — How should the connector interface be reconciled with CON-01's three methods?**

| Option | Description | Selected |
|--------|-------------|----------|
| Evolve the contract interface | Add `testConnection()`, `getCapabilities()`, richer `execute(operation, payload, context)` | ✓ |
| Keep contract, richer domain interface | Leave the seam; define a richer internal interface; adapt at the boundary | |
| Additive only: capabilities + health | Add `getCapabilities()` + `testConnection()`; keep `execute(input)` | |

**User's choice:** Evolve the contract interface
**Notes:** One interface everywhere; Phase 6/7 build on it.

---

**Q4 — How should the Redmine connector (CON-09) be structured?**

| Option | Description | Selected |
|--------|-------------|----------|
| Generic REST core + thin Redmine adapter | Reusable transport + Redmine endpoints/mapping/error taxonomy | ✓ |
| Fully config-driven generic REST | Redmine purely config, zero code | |
| Redmine-specific class | Hand-coded Redmine connector | |

**User's choice:** Generic REST core + thin Redmine adapter
**Notes:** Reusable core, precise Redmine fit, incl. the CON-07 error split.

---

## Edit links & single-send guarantee (LNK-02/DAT-06/DAT-13)

**Q1 — What does an edit link change — and does the correction reach the external system?**

| Option | Description | Selected |
|--------|-------------|----------|
| New revision + new send | Update internal + re-send as a new revision; "single send per revision" | ✓ |
| Internal-only correction | Update internal only; external never re-called | |
| Same key, downstream upsert | Re-send with the same `submission_id`; needs downstream upsert | |

**User's choice:** New revision + new send
**Notes:** Rewords DAT-13 from "per submission" to "per revision".

---

**Q2 — How is an edit link issued, and who may use it?**

| Option | Description | Selected |
|--------|-------------|----------|
| From the status surface, owner-only | Issue a fresh 4h pre-filled link; owner + live perm/perm_version check | ✓ |
| In the chat confirmation only | Post-submit confirmation carries the only edit link | |
| Both entry points | Confirmation + status surface | |

**User's choice:** From the status surface, owner-only
**Notes:** Mirrors the view-link verifier.

---

**Q3 — What idempotency key is sent downstream now that edits are separate revisions?**

| Option | Description | Selected |
|--------|-------------|----------|
| Composite {submission_id}:{revision} | One idempotent op per revision; amends FR-C-5 wording | ✓ |
| Keep submission_id only | Literal FR-C-5; downstream dedupe collapses edits | |
| Fresh UUID per send | Distinct send; idempotency lost unless connector derives a key | |

**User's choice:** Composite {submission_id}:{revision}
**Notes:** Amends FR-C-5's literal `submission_id`.

---

**Q4 — How should revisions be stored, given edits create separate sends?**

| Option | Description | Selected |
|--------|-------------|----------|
| Append-only revision records | Immutable records keyed `{submission_id, revision}`; submission points to latest; outbox state per revision | ✓ |
| Overwrite in place | Overwrite `data`; only the audit log retains history | |
| Full snapshot per revision | New full Submission per revision, chained by `root_submission_id` | |

**User's choice:** Append-only revision records
**Notes:** Matches the append-only audit ethos and the per-revision outbox unit.

---

## the agent's Discretion

- CON-10 transactional-outbox implementation (Mongo change stream vs polled outbox collection).
- CON-03 backoff/DLQ cadence mechanics and the reconciliation-job interval.
- CON-05/06 per-connector rate-limit wiring and the `app_id` metric label.
- DAT-03 `{{form.field}}` / `{{real_user.attribute}}` mapping evaluation.
- DLQ retention window, connector health-check cadence, stuck-`sent_unconfirmed` staleness.
- Seed-file layout, metric naming, exact copy strings.

## Deferred Ideas

- Cross-app "My submissions" list (would need a second token contract).
- User-facing "Retry now" on `partial`.
- Retry telemetry on the status page.
- Runtime `app rebind` CLI into the DB.
- Early authenticated admin HTTP surface (OIDC) — Phase 6.
- Redmine contract detail — routed to required research.
- KMS vendor adapter + W-24 envelope upgrade — deferred; blocks a production credential.
