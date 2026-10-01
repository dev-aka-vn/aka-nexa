# Pitfalls Research

**Domain:** Chat-driven enterprise workflow gateway — IM front door (Slack / Teams / Zalo / Telegram) to internal + external enterprise systems, self-service FormIO.js App Builder, per-app RBAC, pluggable LLM decision layer, connector fan-out.
**Researched:** 2026-10-01
**Confidence:** HIGH for the link/webhook/connector/version classes (anchored in the PRD text and in Redis / Slack / BullMQ primary docs). MEDIUM for the JEV-accuracy and App-Builder-adoption classes (reasons from mechanism and from comparable platforms, not from measurement of *this* system — those two classes need phase-specific research before their roadmap phases are committed).

**Scope note.** PRD §20 is a 5-phase roadmap (Phase 1 Core Foundation → Phase 5 Advanced, post-MVP). Phase references below use those PRD phase names, because the roadmapper will be reconciling against them. Where research says a pitfall must be designed in a phase *earlier* than the feature that triggers it, that is called out explicitly — the PRD's sequencing defers the read path and the App Builder past several things that depend on them, and three of the pitfalls below are consequences of exactly that deferral.

---

## Critical Pitfalls

### Pitfall 1: `GETDEL` is atomic, not durable — one-time create links come back to life

**What goes wrong:**
A create link is consumed by `GETDEL` on a Redis primary. Redis replication is **asynchronous** (verified, Redis replication docs: *"Redis uses by default asynchronous replication… the master does not wait every time for a command to be processed by the replicas"*). The docs are also explicit that even the synchronous escape hatch does not close the hole: *"`WAIT` … does not turn a set of Redis instances into a CP system with strong consistency: acknowledged writes can still be lost during a failover, depending on the exact configuration of the Redis persistence."*

So during a Redis Cluster failover, a `GETDEL` that was acknowledged on the demoted primary but not yet replicated **resurrects**: the new primary still has the key, the link is live a second time, and the user can submit twice. In cluster split-brain, two primaries both accept a `GETDEL` and whichever write is later discarded leaves a live key.

Quantify the window. At the PRD's peak of 10 form submissions/sec (NFR-S-3), **one second of replication lag is 10 un-drained consumed tokens; five seconds is 50.** A Redis OOM (the §16.4 runbook literally has a "Redis OOM → check token leak" scenario), a long GC pause in the API pod, or a `BGSAVE` fork stall all push lag into the seconds range — exactly the conditions under which a failover is also likely.

The PRD already suspects this: §16.4's runbook row is *"Double submission reports → Verify atomic consumption. Check Redis cluster split-brain."* That is diagnosis **after** the duplicate is in the external system. There is no prevention, because FR-L-1 / NFR-SEC-1 specify the mechanism but not its failure mode.

**Why it happens:**
`GETDEL` reads like an atomicity guarantee and is treated as a durability guarantee. It is neither. The mental model "one command, one key, done" has no notion of the replication stream behind it. This is the single most common mistake in one-time-token systems built on Redis.

**How to avoid:**
Make consumption a **two-tier operation with MongoDB as the durability backstop**, not a single Redis call:

1. Fast path: `GETDEL` (unchanged) — this keeps NFR-P-7 (<50 ms link generation) and NFR-SEC-1's "no race conditions" honest.
2. Durable path: insert `{ jti, submission_id, app_id, link_type, consumed_at }` into a `link_consumptions` collection with **`unique: { jti: 1 }`**. A duplicate-key error here means the Redis `DEL` was lost — treat the token as consumed and hard-fail the submission. The uniqueness constraint, not the distributed system, is now what prevents the double submission.
3. Order matters: `GETDEL` first, insert second. A crash between them loses the submission (user retries, gets "already submitted") — acceptable. The reverse order would allow two submissions.
4. Add `WAIT 1 50` after the `GETDEL` to shrink the lag window. Do not treat this as a fix; it is a mitigation for the case where the backstop write is also unavailable.
5. Define the third gate now: **`submission_id` unique index on the submissions collection.** `submission_id` must be generated server-side at link issuance (not at submit time) so it is the same across retries. This is what survives *both* a Redis failover and a BullMQ stalled-job reprocess (Pitfall 13).

**Warning signs:**
- `token_consumed_total` (§16.2) is labelled `link_type, app_id, result` — but the PRD **never defines the `result` values.** Define them now as `consumed | replayed | expired | conflict_mongo | already_submitted`. Without them the metric cannot detect anything.
- Add `link_consume_age_at_replay_seconds` — when a token is consumed a second time, how old was the first consumption? A large value (≫ the 30-min TTL) is the failover-resurrection signature, not a user double-click.
- Invariant to check on a schedule: `count(form_submission_total) == count(distinct jti in link_consumptions)`. A drift means documents exist with no consumption record — the reverse failure, which happens if the insert path is skipped.
- `mongodb replication lag > 5s` (§16.3 already alerts on this) — treat that alert as a *token-safety* alert too, not just a data-freshness alert.

**Severity if ignored:** HIGH — duplicate submissions into Redmine/ERP/HR, visible to a downstream team, and the PRD's connector idempotency does not save you (Pitfall 13).

**Phase to address:** **Phase 1.** One-time create links are a Phase 1 deliverable. The `link_consumptions` collection and the `submission_id` unique index are 3 days of work in Phase 1 and a migration of live submissions in Phase 4.

---

### Pitfall 2: Edit links are a double-submit machine *by design*

**What goes wrong:**
FR-L-2 inverts the create-link risk: edit links are **loadable multiple times, consumed once on submit, TTL 4 hours**. That is a much wider exposure than the 30-minute create link and it is easy to reason about incorrectly:

- The same user opens the edit link on a laptop and a phone (both GETs succeed — by design).
- Both render the same form. Both submit. Two POSTs race the `GETDEL`. One wins, one gets "already submitted".
- Worse: the user opens the link, edits for 40 minutes, gets distracted, and a colleague (or the same user on a second device) submits the same record from the older tab. The losing submit gets "already submitted" — indistinguishable, to the user, from a data-loss bug.
- The submit button is not disabled until the response lands. NFR-P-6 targets <1 s for submission → internal write confirmation; real p95 on a 20-field form over an office VPN is 1.5–3 s. That is a wide double-click window, and Slack/Teams users are on phones and trackpads.

**Why it happens:**
The PRD models the link as the unit of idempotency. But for edit links the link is *intentionally* replayable, so the idempotency key has to be the **record**, not the link. FR-L-2 does not say what happens to the second submit beyond "already submitted" (§12.1 step 14).

**How to avoid:**
- `submission_id` is minted **at link issuance** and embedded in the edit link's claims. The submit endpoint's idempotency key is `submission_id`, enforced by the Mongo unique index from Pitfall 1 — not the `jti`. `GETDEL` on `jti` stays as the anti-replay gate; the `submission_id` unique index is the anti-duplicate gate.
- **Make the duplicate a success, not an error.** If `submission_id` already exists and the incoming content is identical or the caller is the same `real_user_id`, return the existing record's confirmation (HTTP 200 + the original confirmation payload). This removes the entire UX class and makes the client's ambiguity disappear. Reserve the error path for a *conflicting* second write (different user, or materially different payload), which is genuinely worth an error.
- Client-side: disable the submit control on first click, show an in-flight state, and **do not re-enable on network error** — re-enable only on a 4xx that indicates a real validation problem. NFR-U-5 requires a loading indicator for >500 ms operations; extend that to "submit is in flight and will not be re-sent".
- Consider a per-`submission_id` short-lived Redis lock as a cheap pre-filter (SET NX, 10 s TTL) so the second submit gets an instant "already being saved" rather than waiting on the unique-index round trip. This is an optimisation, not the guarantee.

**Warning signs:**
- `form_submission_total{app_id, mode}` (§16.2) exceeding `token_consumed_total{link_type="edit", result="consumed"}` — direct double-submit evidence.
- `token_consumed_total{result="already_submitted"}` rate. A rate above ~1% of edit submissions means either aggressive double-clicking or a client bug; both are fixable and both are invisible without this label value.
- Duplicate-detection query on the submissions collection: count of `real_user_id` + `created_at` within 10 s for the same `app_id` > 1.

**Severity if ignored:** HIGH — duplicate records in the downstream system of record, reported by the department that owns the app, with no way to explain it.

**Phase to address:** **Phase 2** (edit links are a PRD Phase 2 deliverable), but the `submission_id`-at-issuance decision must be made in Phase 1 because create links set the precedent.

---

### Pitfall 3: NFR-SEC-10's brute-force cap and legitimate retries are in direct conflict — and it loses

**What goes wrong:**
NFR-SEC-10: *"Brute-force protection: max 5 failed link validations per IP per 10 minutes → temporary block."* The obvious implementation counts **any** failed validation. That bucket includes: expired token, wrong signature, already-consumed token, `perm_version` mismatch, and unknown `jti`. Those are not all the same kind of event.

The collision is concrete and it is an availability incident the platform causes itself:

- Corporate networks egress through a small NAT pool or a single VPN concentrator. An office of 200 people shares one source IP.
- Five people in that office hit a *benign* failure in a 10-minute window — a link is 31 minutes old (expired), someone double-clicked a consumed link (Pitfall 2), someone's role changed (perm_version mismatch), and one person fat-fingers a pasted URL.
- The whole office is blocked for 10 minutes. Nobody can submit anything. Every app on the platform is down for that office.
- Worse in Slack: if a bot's IP is rate-limited, Slack's own request retries (up to 3) each consume quota, and the block window extends under the platform's own retry pressure.

The security value of the control is close to zero, and that is the part worth stating: FR-L-10 already requires links be *"unguessable (UUID-based or signed token, no sequential IDs)"*. Against a 128-bit unguessable token or a signed EdDSA JWT, an IP-based 5-attempts-in-10-minutes cap provides essentially no protection — an attacker with the token does not need five attempts, and an attacker without it is not stopped by five. **The control buys a large availability liability for a negligible security gain.**

**Why it happens:**
Rate limits are written as a single number without a threat model attached. "5 per 10 minutes" was chosen as a round brute-force number and never checked against what legitimate failure actually looks like, or against the deployment's network topology (shared NAT is the norm in an enterprise, not the exception).

**Named conflict — which requirement loses:**
> **NFR-SEC-10 loses.** It is written as a single threshold against a category of events ("failed link validations") that mixes credential probing with ordinary user lateness and ordinary user mistakes.

The replacement, which should be adopted as the amendment:

1. **Split the failure taxonomy first.** Two tiers, different thresholds:
   - *Credential-probing class* — bad HMAC, unknown `kid`, malformed JWT, expired signature. In normal operation this counter is **zero**. A low threshold (5/10 min) is safe here because legitimate traffic never increments it.
   - *Consumption/authorization class* — already consumed, `perm_version` mismatch, app archived, purged. These are **not** probing. They get a much higher threshold (or none), and they are **never** counted against a shared-IP bucket.
2. **Move the counter off the shared IP.** A second counter keyed on `real_user_id` (from the link's claim, when the signature verifies) and on `jti` catches a user hammering a consumed token without punishing the 199 colleagues behind the same NAT. Note the ordering: the `real_user_id` is only trustworthy after signature verification, which is exactly the credential-probing case where you also want to rate-limit — so the two counters are naturally complementary.
3. **Behind a corporate proxy, per-IP is the wrong key anyway.** Add a trusted-proxy configuration; if the deployment cannot verify the real client IP, per-IP limiting is *more* wrong, not less, and should degrade to per-`real_user_id` + per-`jti` only.
4. **Every block must be observable.** Add `link_validation_block_total{reason,scope}` (scope = `ip|user|jti`) and `link_validation_failed_total{reason}`. The PRD currently has **no metric for link validation failures at all** — it has `token_consumed_total{result}` and an alert on ">10 failures/min", but no way to distinguish "attacker" from "expired link epidemic" from "we deployed a bug that rejects valid links".
5. **Cap the blast radius of a block.** A blocked IP must block link *validation*, not identity resolution, not slash commands, not read links. A single misconfigured counter should not take an office's entire interaction surface offline.

**Warning signs:**
- `link_validation_failed_total{reason}` — the *ratio* `expired / signature_invalid` is the diagnostic. If `expired` dominates, the limiter is punishing lateness, not attacks, and the threshold is wrong.
- `link_validation_block_total{scope="ip"}` > 0 while `link_validation_failed_total{reason="signature_invalid"}` ≈ 0 ⇒ **you are blocking legitimate users, not attackers.** This is the alert to add; it is the single most useful new alert in this document.
- Any block event with `scope="ip"` where the IP belongs to the corporate egress range (known CIDRs) ⇒ pager, not dashboard.
- A runbook entry that does not exist today: §16.4 has "IM webhook failing" and "Redis OOM" but **no "user reports 'this link does not work'" scenario**, which is exactly what a rate-limit false positive looks like at 09:00 on Monday.

**Severity if ignored:** HIGH — a self-inflicted, network-scoped, all-apps outage with no clear signal. This is the highest ratio of blast radius to implementation effort in the whole document: a few days of taxonomy work removes a class of 10-minute office-wide outages.

**Phase to address:** **Phase 1.** One-time links and the create flow are Phase 1. The failure taxonomy has to exist before the first alert rule is written, because alert rules encode the taxonomy.

---

### Pitfall 4: `perm_version` covers one of seven revocation events — and there is no kill switch

**What goes wrong:**
FR-L-7 / NFR-SEC-4: read links are stateless 90-day signed JWTs (§12.2 step 8: verify signature → check expiry → fresh RBAC check → compare `perm_version`). The `perm_version` is *"a monotonically increasing integer per user (or per user-per-app)"*. FR-R-8 scopes it to permission changes on that user in that app.

Enumerate the ways a stale read link still returns data:

| # | Event | Does `perm_version` catch it? | Consequence |
|---|---|---|---|
| 1 | Role revoked from the user | ✅ Yes — the bump | 403 |
| 2 | App `archived` | ❌ No | FR-LC-3 says archived apps are read-only but *"existing view links still work"*. **Archive is explicitly not a security control.** |
| 3 | App `purged` | ❌ No | Link validates; query runs against a soft-deleted collection (FR-LC-5). Either stale rows render, or — after hard delete at the 30-day grace — an empty page. |
| 4 | The *record* was deleted at source | ❌ No | Link validates, target is gone. For **query** links (FR-L-4, fresh execution) this is worse: the link returns a *different result set* than the one the user saw when it was issued. |
| 5 | The collection was re-shared to a different app | ❌ No | FR-X-4 executes under the *consumer app's* identity. Revoke the grant (FR-X-6, *"takes effect immediately"*) and the consumer app's links keep working, because the grant has no version counter of its own. |
| 6 | `perm_version` bumped on a *different* app | ❌ By construction | Per-app scoping means **there is no way to revoke a user's read access across all apps in one operation.** During an incident ("this account is compromised") you would have to bump 200 counters across N apps. Not operationally viable. |
| 7 | Clock skew | ❌ No | `exp` is checked against local time. A link is rejected up to ±skew early. Not a leak, but it generates "link expired" reports that read as outages. §18 has no NTP requirement and §9 has no skew NFR. |

And then the one the PRD does not name at all:

> **There is no revocation mechanism for a read link.** AD-11 chose stateless read links with *"no Redis storage"* (FR-L-3) precisely because that is what makes them scale. The cost is that a leaked link — forwarded in a chat channel, pasted into a ticket, sitting in browser history, in a corporate proxy log, in a Slack link unfurling preview — **cannot be revoked.** The only invalidation levers are role change, `perm_version` bump, and expiry (up to 90 days away).

For a platform that will hold leave requests, expense claims, and HR submissions, "we cannot withdraw a link we know was leaked" is not an acceptable answer, and the PRD's architecture currently gives that answer.

**Why it happens:**
`perm_version` was designed to answer one question — *did this user's permissions for this app change since the link was issued?* — and then treated as if it answered the broader question of *is this link still authorised*. Those are different questions, and the gap is invisible until someone tries to revoke a specific link.

**How to avoid:**
Four changes, in order of value:

1. **A read-link epoch, one Redis key per app and one per user.** This is the reconciliation between AD-11's scalability and operability, and it costs exactly one extra Redis `GET` per link access:
   - `readlink_epoch:app:{app_id}` — bumped on *any* change to the app's RBAC definitions, role assignments, `shared_with` grants, connector refs, or lifecycle state.
   - `readlink_epoch:user:{real_user_id}` — bumped on any change to the user's app memberships across all apps, and by an admin action for incident response. **This is the kill switch that closes leak #6.**
   - The epoch value is a claim in the read-link JWT (an opaque integer, consistent with NFR-SEC-2's "no PII in JWTs"). On access, compare against Redis. Mismatch → 403.
   - **Memory property preserved**: this is one key per app (≤200) and one per user (≤1,000), not one per outstanding link. The "millions of read links without memory pressure" property that justified AD-11 survives intact.
   - **The permission path for read links is not the hot path**: NFR-P-8 targets <1.5 s for view/query rendering, and NFR-P-2 budgets RBAC aggregation at <30 ms cached. One Redis GET is already inside that budget (the fresh RBAC check the PRD already mandates is at least as expensive).
2. **An explicit app-status gate on the read path**, evaluated before anything else: `status ∈ {published, deprecated, archived}` → allowed; `draft` / `purged` → 410 Gone with an explicit message. This closes leaks #3 and #5-adjacent, is one line, and is required regardless of epochs because "purged" is not a permission event.
3. **Shorten the default read-link TTL.** 90 days is the *ceiling* (FR-L-3 "up to 90 days"), not a requirement. Default to **7 days**, with 90 available only as a per-app opt-in (FR-L-6 already makes TTLs configurable per app). This reduces the exposure window of an unrevocable link by 13× at zero cost. If a stakeholder asks for 90 days, the honest framing is: "that link cannot be withdrawn for 90 days if it leaks."
4. **State the unrevocable-link limit in the security design and in the admin UI.** A per-app flag `read_links_revocable: false` when the app opts into 90-day TTLs, surfaced in the App Builder at publish time, plus documentation that a leaked long-lived link can only be neutralised by bumping every affected user's epoch.

**Warning signs:**
- Add `read_link_denied_total{reason}` with reasons `perm_version | epoch_app | epoch_user | app_archived | app_purged | grant_revoked | signature`. The PRD has **no metric for read-link denials at all** — §16.2 covers token issue/consume (write links) but nothing for the read path. That is the observability hole that lets a read-link leak go unnoticed.
- `read_link_denied_total{reason="app_purged"} > 0` ⇒ **a bug**: the read path is serving links against purged apps. Alert Critical.
- `read_link_denied_total{reason="epoch_*"} > 0` after any RBAC change ⇒ **the epoch mechanism is working**; any value is fine. This is the healthy-signal metric.
- Ratio of read-link accesses with `epoch_user` mismatch during an incident ⇒ the kill switch's actual reach. Measure it during a game day.
- Age distribution of read-link accesses. If the p99 age is near the TTL, the 7-day default is wrong for your traffic and you should find out now rather than after a leak.

**Severity if ignored:** HIGH — this is a security surface, and events #2–#6 plus the absence of revocation are all live under the PRD as written.

**Phase to address:** Read links ship in **PRD Phase 4**, but the epoch mechanism and the app-status gate are **link-service design decisions and must be built in Phase 1**. Retrofitting a new JWT claim after links with a 90-day TTL are in circulation means every outstanding link breaks on deploy. This is the clearest example of the PRD's sequencing working against itself.

---

### Pitfall 5: Ack-then-enqueue has an unobservable gap, and the PRD has no metric for it

**What goes wrong:**
The committed constraint is: *"Webhooks ack in <200 ms and enqueue; all logic runs in the consumer."* The failure is the space between those two actions:

1. The receiver verifies the signature, does its work, calls `queue.add()`, and returns 200.
2. **If the response is written before `queue.add()` resolves** — a `void queue.add()` without `await`, a response written in an interceptor/filter that runs before the handler, an `ack()` in a `finally`, or a NestJS exception filter that has already sent the response — the platform has told Slack "200, I got it" and then lost it.
3. Slack does not retry. The message is gone. No error, no exception, no metric.
4. The user's request simply never produces a link. From the platform's view everything is healthy.

This is the PRD's stated mechanism for not losing submissions, and it has a failure mode with **no detection at all**, because §16.2's metric list contains **no webhook receive or enqueue counter**. `active_im_connections{im_platform}` (§16.2) is the closest thing and it is structurally incapable of detecting this (see Pitfall 8).

Related but distinct: the `<200 ms` budget itself. The receiver must complete signature verification (HMAC over the raw body), identity resolution, enqueue, and the HTTP write in under 200 ms. Any of these can blow the budget — a cold TLS handshake, a slow KMS decrypt, a Redis blip — and a slow 200 ms response is *still* a failure from Slack's perspective (3 s limit, 3 retries), which means a partial outage presents as duplicate deliveries.

**Why it happens:**
Ordering bugs are invisible in code review because `queue.add()` returning a promise that is never awaited *looks* like it enqueued. And the ack-then-enqueue shape is easy to arrive at accidentally when the HTTP layer is a decorator, a middleware, or an exception filter rather than an explicit statement in the handler.

**How to avoid:**
- **Make the ordering a lintable code rule, not a convention.** One `WebhookIngestService.ingest(rawBody, headers)` method that (a) verifies the signature, (b) dedupes, (c) enqueues, (d) returns the parsed job id. The HTTP layer's *only* job is `res.status(200).json({ ok: true })` after that method resolves. No logic, no `await` on anything else, in the controller.
- **Add the two counters that make the gap observable**, from Phase 1:
  - `webhook_received_total{platform, outcome}` — incremented at the top of the receiver, `outcome ∈ {accepted | rejected_signature | rejected_replay | rejected_oversize | error}`.
  - `webhook_enqueued_total{platform}` — incremented only after `queue.add()` resolves.
  - **The invariant `received{accepted} − enqueued` must be flat.** A monotonically growing difference with no matching rise in `queue_depth` (§16.2) is the ack-without-enqueue signature. Alert on a 5-minute positive drift > a small constant.
- **`queue_depth` is the wrong signal for the ack path.** Depth rises for legitimate reasons (backlog) and is only sampled. The counter *difference* is the signal.
- **Never ack a signature failure.** §16.4's runbook row "IM webhook failing → Verify signing secret rotation" only makes sense if non-2xx on failure causes a platform retry. Return 401 and let them retry.
- **Bound the body before doing any work**: reject oversize bodies with 413 before signature verification, so a 10 MB payload cannot consume the 200 ms budget.
- **Startup-time dependency gate**: if Redis is unreachable, `/health/ready` must fail *and* the receiver must return 503 rather than 200 (NFR-O-7 already splits liveness from readiness — use it).

**Warning signs:**
- `webhook_received_total{outcome="accepted"}` − `webhook_enqueued_total` drift.
- `webhook_received_total{outcome="rejected_signature"}` rising after a signing-secret rotation ⇒ the keyset rotation gap (Pitfall 6).
- The PRD's existing "Token consume failure >10/min" alert is unrelated to this and should not be mistaken for coverage.

**Severity if ignored:** HIGH — silent, unrecoverable loss of user requests. This is the only pitfall in the document where the *default* failure mode is "the user asked for something and nothing happened, ever, and we cannot prove it."

**Phase to address:** **Phase 1** — before the Slack adapter ships. The metrics must exist when the first receiver does.

---

### Pitfall 6: Signature verification drifts — verifying twice, on the wrong body, or with one key

**What goes wrong:**
Slack's scheme (verified against Slack's docs) has three properties that generate three distinct bugs:

**(a) The raw body is mandatory.** The v0 signature is HMAC-SHA256 over `v0:{timestamp}:{raw_body}` where `raw_body` is *"without headers, before it has been deserialized from JSON or other forms"*. NestJS/Express `bodyParser` consumes the request stream by default. Without a `verify` hook or `express.raw()` on the webhook route, every signature check fails. The two common "fixes" are both worse: disabling verification with a log line, or re-serialising the parsed body (which never reproduces Slack's byte-for-byte payload because of key ordering, unicode escaping, and whitespace). This is a security-relevant pitfall, not just a bug, because the natural response to a broken verification is to turn it off.

**(b) Verifying twice breaks under queue delay.** The obvious reading of "all logic runs in the consumer" plus "defense in depth" is: verify in the receiver *and* verify in the consumer. Slack's docs require rejecting requests whose timestamp differs from local time by more than **five minutes** (*"The request timestamp is more than five minutes from local time. It could be a replay attack, so let's ignore it."*). Under any queue backlog over 5 minutes — which is exactly what happens when Redis is degraded, i.e. exactly when you most need the backlog — **every request fails verification in the consumer**. A performance problem converts into a total outage with a misleading error (`invalid signature`) that sends the on-call to the wrong system. This one is subtle, easy to introduce during a security review, and produces an incident signature that points nowhere near the cause.

**(c) Single-secret verification breaks rotation.** The signing secret rotates — by Slack's own lifecycle and by enterprise policy. Single-secret verification drops every in-flight request signed with the previous secret for the length of the rotation, and platforms retry on 5xx, so a rotation becomes a burst of 401/403-induced retries. The PRD has `webhook_secret_ref` (§10.3) — a *single* ref, no keyset, no `previous_ref`, no overlap window. Compare NFR-SEC-9, which explicitly requires a **90-day zero-downtime dual-key rotation window** for JWT signing keys. The same mechanism already exists in the design; the webhook path just was not wired to it.

**Why it happens:**
Each platform's signature scheme is a slightly different recipe, and the recipe lives in the platform's docs rather than in an abstraction. Teams uses JWT bearer validation against the bot registration rather than an HMAC; Zalo's OA callback model has its own constraints; Telegram uses a `secret_token` header. Four verification implementations that each look like "verify the signature" and are each subtly different is the definition of drift.

**How to avoid:**
- **Verify exactly once, at ingress. Never in the consumer.** Stamp the enqueued envelope with `{ verified_at, key_id, platform, native_event_id, raw_body_sha256 }` and have the consumer trust the envelope. If you want the consumer to be defensive, it re-verifies *the envelope's own signature* (platform-signed, platform-independent), not the platform's.
- **A raw-body-preserving hook registered before any global body parser**, applied only to the webhook routes, and covered by a test that asserts the raw bytes for a known fixture.
- **Keyset-based verification with an overlap window**, mirroring NFR-SEC-9: `kms://secrets/slack:{kid}` resolving to an active set plus a previous set, with an overlap of **at least 1 hour** — long enough to cover the platform's full retry horizon (Slack's 3 retries span tens of minutes; Teams' jittered retries longer). Refuse a `kid` outside the set rather than falling back to "try all secrets", because try-all is how you get an oracle.
- **Rotation is a scheduled job, not a runbook step.** The same BullMQ Job Scheduler that rotates JWT signing keys rotates webhook secrets, because an in-memory per-instance rotation silently not running on one pod is a security failure (PROJECT.md already makes this argument for JWT keys — extend it).
- **A synthetic signed probe.** A canary that signs a valid request with the *current active key* and posts it to the live endpoint every hour, asserting a 2xx. This catches "verification was disabled and nobody noticed" — which no metric catches, because a disabled verifier produces a *success* rate of 100%.

**Warning signs:**
- `webhook_signature_invalid_total{platform, reason}` with `reason ∈ { hmac_mismatch | expired_timestamp | unknown_kid | missing_raw_body }`. **This metric does not exist in the PRD.** The `expired_timestamp` reason is the double-verify bug's fingerprint: in healthy operation this must be exactly zero, because ingress verification happens within milliseconds.
- `unknown_kid` spiking during a rotation ⇒ the overlap set is too small or the rotation job ran without draining.
- The hourly probe result. This is the only mechanism that detects a *disabled* verifier.
- Count of receiver 401/403 responses vs `webhook_received_total` — during normal operation this ratio is zero.

**Severity if ignored:** HIGH — an outage whose logs point at cryptography when the cause is queue depth, or a silently disabled verifier that turns signature checking into a no-op.

**Phase to address:** **Phase 1** (Slack adapter). The keyset abstraction is shared with NFR-SEC-9's JWT rotation, so it should be built once and reused by Pitfall 14's rollback-invalidation.

---

### Pitfall 7: IM platforms deliver at-least-once and out of order; the consumers assume exactly-once, in-order

**What goes wrong:**
Slack retries up to 3 times when it does not get a 2xx within 3 seconds. Teams returns 429/502 with retry-with-jitter. Telegram redelivers on non-2xx. Zalo's OA callback retries on failure. Every one of these means the platform's contract is **at-least-once delivery with no ordering guarantee**, and jitter specifically guarantees that a retried event can *overtake* its successor.

Concretely, in this system:

- **Duplicate link issuance.** A duplicate inbound event runs the whole pipeline again: RBAC aggregate, JEV decide, link mint. The user gets **two** create links in chat, both valid, both live for 30 minutes. They click one; the other expires unused. Not a data bug — but it inflates `token_issued_total` (so the issued/consumed ratio becomes useless as an anomaly signal unless you dedupe on event id), doubles JEV spend, and produces a support question that has no answer.
- **Duplicate identity creation.** Two concurrent onboarding flows for the same email (FR-I-2 lazy onboarding) race on `chat_user_id → real_user_id`. Without a unique index on `(im, chat_user_id)` you get two mappings, two RBAC identities, and a user whose submissions split unpredictably.
- **Duplicate notifications.** FR-N-3 notifies the original submitter on inbound webhook; duplicate inbound webhooks (Pitfall 13's external counterpart) send duplicate IM messages with duplicate links.
- **Out-of-order conversation context.** FR-J-7 sends `previous_turns` and §11.1 sends `turn_count`. If turn 4 arrives before turn 3 (jittered retry), the context the model receives is wrong — and it is wrong *silently*, producing a confidently mis-routed request. FR-J-7's "conversation context (last N turns)" has no ordering or freshness contract at all.
- **Duplicate RBAC cache invalidation is harmless; missing one is not.** Duplicate pub/sub invalidation is idempotent. A *dropped* pub/sub message is not — see Pitfall 19.

**Why it happens:**
Queue consumers are written as if they will see each message once, in order, because in development they do. The duplication only appears under exactly the conditions you care about (retries during degradation), and it compounds with the failure it is responding to.

**How to avoid:**
- **Carry the platform's native event id in the normalized `InboundEvent`.** FR-IM-2 requires normalization but does not require an idempotency key. Add `native_event_id` (`event_id` for Slack, `activity.id` for Teams, Telegram `update_id`, Zalo's callback id) and make it mandatory in the schema — a normalized event without one is a schema violation, which makes the gap visible in review.
- **Dedupe at enqueue, not in the consumer.** `SETNX ingest_dedup:{platform}:{native_event_id}` with a TTL ≥ the platform's maximum retry horizon (use **1 hour**; Slack's 3 retries plus Teams' jitter can span tens of minutes). Doing it inside the same enqueue operation means dedupe and enqueue are one logical step, so there is no window where a dedupe hit drops a message that was never enqueued. **A dedupe hit must still return 200** — the platform must not retry a message we deliberately deduplicated.
- **Consumers must be idempotent anyway.** `submission_id`, `jti`, and `mapping_id` are natural keys; make every consumer's write path a single upsert keyed on one of them.
- **Unique indexes on the identity edge**: `unique: { im: 1, chat_user_id: 1 }` on mappings, and `unique: { email: 1 }` (or the corporate id) on real users. FR-I-2's two onboarding paths racing is a realistic first-week production bug.
- **Order conversation context explicitly.** Key the turn buffer on `(conversation_id, turn_count)` or the event timestamp, store the max-seen `turn_count` per conversation, and **drop** out-of-order turns rather than appending them. A missing turn is a small UX cost; a wrong context silently mis-routes a request, which is a data-quality cost.
- **Treat the delivery-failure path as first-class**: verify that a duplicate-suppressed event still produces the user-visible response (the link is already in chat from the first delivery — do not re-send it, and do not send nothing).

**Warning signs:**
- `ingest_duplicate_total{platform, stage}` as a first-class counter — **not in the PRD metric list.** The stage label matters: `stage=received` (platform retried us) vs `stage=consumer` (our own pipeline re-ran) have completely different causes.
- Ratio `token_issued_total` / unique `native_event_id` — anything > 1.0 is a duplicate-issuance bug. This is the cleanest single check.
- `jev_decision_total` rising without a matching `im_event_received_total` rise ⇒ the pipeline is re-running on its own (cache expiry, consumer retry, or a retry loop).
- `mapping_created_total` exceeding the number of distinct `(im, chat_user_id)` pairs ⇒ the unique index is missing.
- A "duplicate rate" that is *exactly zero* in production is itself a signal the dedupe counter was never wired, not that Slack never retried.

**Severity if ignored:** MEDIUM-HIGH — no direct data corruption once the `submission_id` unique index is in place, but duplicate link issuance and duplicate identity rows are user-visible and confusing, and duplicate JEV spend is a real line item.

**Phase to address:** **Phase 1** — `native_event_id` in the `InboundEvent` schema (FR-IM-2) and the unique indexes on mappings (FR-I-2) are Phase 1 identity work.

---

### Pitfall 8: "No silent failures" during an IM outage is unobservable as specified

**What goes wrong:**
FR-IM-7: *"If an IM platform is unreachable, messages MUST be queued and retried. Users MUST NOT see silent failures."* Two halves of that promise are both false under the design as written, in different ways.

**Inbound:** if Slack is down, no messages arrive — there is nothing to queue. Queuing our outbound does nothing for requests we never received. The platform's view is silence; the user's view is "I typed a request and Slack itself swallowed it". Neither the PRD's metrics nor its alerts distinguish this.

**Outbound — the case that actually bites.** The user gets a create link, fills the form, submits. The internal MongoDB write succeeds (FR-D-4: internal write must succeed). The confirmation IM message (§12.1 step 17) is enqueued and cannot be delivered. The user has **no idea the submission worked.** They will submit again, get "already submitted", and conclude the system is broken. FR-N-6's 3-attempt retry applies to *notifications*; the PRD never states a delivery policy for the *confirmation* message, which is the one message every user depends on.

Now compound it: the user also cannot use a link they did not save, because link delivery failed. So a 30-minute Slack outage produces: requests lost inbound, confirmations lost outbound, and links that were delivered once and are then unreachable because the user's client could not render the message. The 30-minute create-link TTL is measured from issuance, so a link delivered at the start of an outage may have materially less usable life than 30 minutes by the time the user sees it.

**Why it happens:**
"Queue and retry" is implemented as an internal queue concern. The user-facing state — *did the user learn the outcome?* — is never modelled as a first-class thing, so it is never measured.

**How to avoid:**
- **Delivery status is part of the submission's state, not a side effect.** Every outbound IM message (confirmation, notification, error) gets a `delivery` record with `{ status: pending | delivered | failed, attempts, last_attempt_at, platform_message_id }`. FR-D-9's `partial` status is about the *external* leg; this is a separate axis and the data model in §10.4 has no place for it. Add it.
- **The read link is the fallback channel, so make it work when the IM is down.** The Submission Viewer's read link (§12.2) and a `submission_status` view must show the confirmation outcome. If the user cannot get a read link (because the link message was lost), they can request one from IM later — FR-L-9's expired-link flow already does this. **Widen it**: a user with no outstanding link can always ask "status of my last request" via slash command, and the response goes through the same (broken) IM — so the honest answer is a **web fallback at a stable URL that does not require an IM-delivered link**. This is a real product requirement the PRD does not have.
- **Age, not depth, is the alerting metric.** §16.3 alerts on `DLQ depth > 50`. A queue holding 40 items that are 4 hours old is a far worse incident than 500 fresh items. Add `queue_oldest_item_age_seconds{queue_name}` and alert on age (e.g. >15 min for the notification/confirmation queue, >5 min for the connector queue). This is the single highest-value metric addition in this document: it is the only one that correlates with *user-visible* harm rather than with internal resource pressure.
- **Extend FR-N-6's 3-attempt retry to confirmations**, and add exponential backoff with jitter (the current "3 attempts" with no backoff spec means three immediate retries).
- **Extend create-link TTL to start from delivery, not issuance** where the platform supports it — or simply issue with a longer TTL and rely on `exp` for security, since the TTL is a UX convenience, not a security control.

**Warning signs:**
- `im_delivery_failed_total{platform}` (after all retries) — **not in the PRD metric list.**
- `queue_oldest_item_age_seconds` — **not in the PRD metric list.**
- `submission_confirmation_unseen_total` — submissions created while the corresponding delivery is still `pending` after 5 minutes. This is the only metric that directly measures "the user does not know it worked".
- `active_im_connections{im_platform}` — see below; this metric is structurally wrong for webhook platforms and its absence is telling.

**Severity if ignored:** MEDIUM-HIGH. Not a security or integrity issue, but it is the failure mode most likely to generate the "the system is broken" reports that kill adoption — and it is invisible to the PRD's entire alerting scheme.

**Phase to address:** **Phase 1** for the delivery-status model and the age metric (the metric must exist before the first queue does); **Phase 4** for the multi-IM breadth where this actually bites.

---

### Pitfall 9: JEV's ">90% accuracy" and "p95 <500 ms" are not jointly achievable as specified

**What goes wrong:**
NFR-P-3 sets the JEV decision budget at p95 < 500 ms. §11.4 configures the primary provider with `timeout_ms: 500`. **The configured timeout equals the entire SLA with zero headroom** for prompt construction, TLS, and response parsing. If the provider's p95 is above 500 ms — which for any tool-selection workload of this size is likely — then the primary provider *always* trips its own timeout and the fallback chain serves production traffic. §11.4's fallback is `rule-based` at `min_confidence: 0.5`. The platform silently degrades from a model to regex matching, and the only signal is a confidence drop that NFR-O-4 alerts on at <0.6 — i.e. the alert fires *after* the damage.

Now the accuracy number. FR-J-6 sends **only the user's authorised tool subset** (AD-1's permission-first routing — correct, and it does reduce cost and exposure). The problem is the size of that subset and the shape of the catalog:

- 200 apps (NFR-S-6) × 3–5 tools each (create/view/list/query per form, §10.3) ⇒ **600–1,000 platform-wide candidate tools**.
- Per-user, RBAC filtering does not shrink this to a handful. A department admin who belongs to 15 apps, or a platform engineer who is `admin` on several, sees **50–150 tools** in their filtered set. A line employee sees a handful — which is why average-case accuracy can look fine while the worst-case user is broken.
- Every candidate costs tokens in the `tools` array of §11.1. A `ToolDescriptor` (id + description + parameters) is 40–80 tokens. 150 tools is 6k–12k tokens of pure tool definition before the user's question, the locale, and `previous_turns` (FR-J-7). That is a large prefill and it is inside the 500 ms budget's scope or outside it depending on provider — which is the point.

And the accuracy number is measured two incompatible ways in the PRD:
- §17.3: **85% minimum** on **50 predefined intents**.
- §21: **>90%** JEV accuracy, measured by *"conformance tests + production sampling"*.

A 50-intent suite cannot cover a 600-tool catalog — it is roughly one intent per twelve tools. It is also trivially overfitted by whoever tunes the prompt against it, because the same 50 intents are the tuning set. **The conformance number and the production number are not measuring the same thing, and the roadmap should not treat §17.3 as evidence for §21.**

**The failure mode that matters most is not "doesn't understand" — it is "confidently picks the sibling."** The tool set in §11.1 already contains `hr-leave-request:create_leave` and `hr-leave-request:view_leave`. Add `cancel_leave`, `extend_leave`, and any *other* app's leave tool (IT's "leave request for laptop return", Finance's "leave budget") and you have near-identical descriptions. For near-identical tools, the model's confidence is high for whichever it picks. **High confidence and wrong coincide**, which means:

> **FR-J-5's confidence threshold cannot catch the dominant failure mode.** The threshold is the right mechanism for a *low-confidence* guess; it is structurally incapable of catching a *high-confidence* wrong answer.

**Named conflict — which requirement loses:**
> **NFR-P-3 / NFR-P-5 (p95 <500 ms, end-to-end <2 s) vs FR-J-7 (send the full filtered tool list + last N turns) vs NFR-S-6 (200 apps).** At 200 apps these three cannot all hold. One of them loses.

**The honest resolution — narrow the JEV's job.** Tiered routing:

1. **Stage 1: app disambiguation.** The candidate input is a compact catalog of *apps*, not tools: `{ app_id, name, one-line purpose, 3 trigger examples }` ≈ 15–25 tokens each. 200 apps ≈ 3k–5k tokens. Fast, and app-level decisions are much easier than tool-level ones because app names are distinctive.
2. **Stage 2: tool disambiguation within the winning app.** 3–8 tools, ~500 tokens. Near-trivially reliable, sub-100 ms, and — critically — `create_leave` and `view_leave` are only ever compared *against each other*, never against a similarly-named tool in another app. This structurally eliminates the dominant failure mode rather than trying to detect it.

This is the only structure that satisfies both numbers. It also composes with AD-1 (the permission filter still runs first, feeding both stages) and with FR-J-11 (slash commands bypass both stages).

**Why it happens:**
The PRD treats "JEV picks a tool" as one operation because that is the simplest thing to spec. Nobody asked how many tools there would be at the PRD's own stated scale until the catalog was full. The answer — 600–1,000 — is an order of magnitude past where flat tool selection is comfortable.

**How to avoid:**
- Ship the two-stage design as the JEV request schema (the `tools` array in §11.1 becomes `apps` + a second call). **This is a Phase 1 architecture commitment** — it determines the wire contract that §11.1 already fixes — even though JEV itself ships in Phase 4.
- **Make `description` and `triggers[].examples` first-class routing metadata with a publish-time floor.** The App Definition schema (§10.3) already has `examples`; make them mandatory, minimum-count, and reject publish when an app's description is too generic to disambiguate or collides with another app's. This is the same publish-time check family as FR-X-5's circular-share rejection.
- **Slash commands are the deterministic escape hatch and must be documented as a first-class path**, not a hidden v1 feature. FR-J-11 is P1 and buried; for a departmental app with 500 users, `/leave request` should be *the* advertised path in the app's deprecation/trigger text.
- **Measure per app, never globally.** `jev_confidence` is already labelled `app_id` (§16.2) — use that label. A global average is dominated by easy traffic.

**Warning signs:**
- Per-app `jev_confidence` p10 and p50 (not mean). One app's p10 collapsing while the global mean holds is the early signal.
- `jev_timeout_total{provider}` — if the primary provider's timeout rate is nonzero, the `timeout_ms: 500` budget is wrong and the platform is silently running on the fallback chain. **This metric is not in the PRD.**
- `jev_provider_used_total{provider}` — the share of decisions served by `rule-based` in production. A nonzero steady-state share means the model layer is decorative. This is the most honest single number for whether JEV works at all, and it does not exist.
- Fraction of decisions served by `openai-compatible` (dev/staging per §11.3) in production ⇒ a misconfiguration, not a design outcome.
- `app_tool_unused_total` — apps that never win a routing decision. Invisible to the PRD's whole alerting scheme and extremely diagnostic.

**Severity if ignored:** HIGH — the AI routing layer is the product's front door. If it confidently mis-routes, users conclude the platform is broken, and no amount of form quality recovers that.

**Phase to address:** **Phase 1** for the wire-contract decision (tiered routing), **Phase 4** for the provider integration itself.

---

### Pitfall 10: You cannot tell a wrong pick from an ambiguous one with the instruments the PRD defines

**What goes wrong:**
This is a separate failure from Pitfall 9's scale problem, and it is what makes ">90% accuracy" a number rather than a fact.

The PRD's instruments are: a confidence score (FR-J-8), a configurable per-app threshold (FR-J-5), top-3 alternatives (FR-J-8), a *"within 10% of top"* disambiguation rule (FR-J-9), and a global confidence-drop alert (NFR-O-4). Four problems:

1. **Confidence is not calibrated probability.** A correct decision and a confidently wrong decision both return 0.94. Averaging confidence (§16.3) is dominated by easy traffic — slash commands, unambiguous one-liners — so the global average stays comfortably above 0.6 while a specific hard subset is broken. **The alert can only fire on collapse, never on drift.** "JEV confidence average drop below 0.6" is a fire alarm, not a smoke detector.
2. **FR-J-9's relative rule is backwards for the case that matters.** Two tools at 0.30 and 0.28 trigger a clarification even though *both* are wrong — the user is asked to choose between two bad options. One tool at 0.95 with everything else at 0.02 does not trigger, even though the 0.95 is confidently wrong. There is **no absolute floor** on the alternatives and no absolute floor on the choice, only a relative comparison.
3. **`clarification_needed` has to come from the model.** The wire spec (§11.2) makes it a `JevResponse` field. That means the platform's most important safety lever — *ask instead of guess* — depends on the model's self-assessment. The platform cannot force a clarification based on its own knowledge (terse input, unfamiliar locale, a tool set it has seen change).
4. **There is no ground-truth collection mechanism.** §21 claims the accuracy measurement method is *"conformance tests + production sampling"* — but no sampling mechanism, no feedback channel, and no labelled set is specified. Without one, ">90%" is not measurable, and any number reported is an estimate of an estimate.

**Why it happens:**
Confidence thresholds are treated as a proxy for correctness, which they are not. The metric was available (FR-J-8 asked for it) so the threshold was built on it, and the gap between "the model said 0.94" and "it was right 94% of the time" was never closed.

**How to avoid:**
- **Add an explicit `abstain` to the wire spec.** `choice.verified: boolean | null`. `false` = the provider is confident and choosing. `null` = the provider is out of its depth (terse input, unfamiliar locale, unfamiliar token). The platform routes `null` to a clarification **regardless of the confidence score**, because abstention is a different signal from low confidence. This is a small spec addition to §11.1/§11.2 that materially improves the failure profile, and it is a conformance-suite requirement (§17.3) so every provider must implement it.
- **Make `clarification_needed` settable by the platform**, not only by the provider. Add it to the request as a hint (`state.force_clarification`) so the platform can force a clarification when *it* has a reason: non-`en`/`vi` locale, input under N characters, or the filtered tool set changed in the last hour (see Pitfall 11).
- **Collect ground truth from two free signals that already exist in the flows:**
  - *Positive*: the user picks an alternative from a clarification prompt. That is a labelled example of a decision the model got wrong.
  - *Negative*: the user issues a corrected message immediately after receiving a link (§12.1 step 11 → a follow-up message within ~2 minutes). That is a labelled example of a wrong pick.
  - Neither requires any UI work. Both need `jev_feedback_total{label, app_id}` and a store. Without them, ">90%" is unfalsifiable.
- **Build the regression gate before the second app is published.** A labelled set, run offline on every app publish and every provider/prompt change, with a **per-app accuracy floor** — a change that drops any individual app below its floor is blocked. This is the mechanism that catches Pitfall 11, and it is also the only way ">90%" becomes a property of the system rather than a number in a dashboard.
- **Report accuracy on the labelled set with a per-app breakdown and a confidence interval**, not as a single aggregate. A single number over a heterogeneous catalog hides exactly the failures that matter.

**Warning signs:**
- `jev_feedback_total{label="correction", app_id}` — **not in the PRD metric list.** A rising correction rate on one app is the earliest available signal that routing is subtly wrong for that app's vocabulary, and it precedes any confidence shift by hours.
- Share of decisions where the user selects `alternatives[0]` rather than `choice` — a per-app "model override rate". High override on one app = that app's descriptions are ambiguous or its examples are poor.
- `jev_abstain_total / jev_decision_total` — the abstention rate. Near-zero means providers are never abstaining (the capability is decorative). Very high means the model is out of its depth on real traffic.
- `jev_clarification_shown_total / jev_decision_total` — the user-friction rate. High values mean the platform is punting to users; this is a product-health metric disguised as a routing metric.
- Distribution of the *margin* between choice and runner-up, not just the choice's value. A bimodal margin distribution is the signature of near-duplicate tools (Pitfall 9).

**Severity if ignored:** HIGH — without this, the accuracy KPI is unfalsifiable and the team will discover the routing is broken from user complaints rather than from a metric.

**Phase to address:** **Phase 4** (JEV ships there) — but the wire-spec additions (`verified`, `force_clarification`) must be in the §11.1 contract from Phase 1, and the labelled-set store must exist before the second app is published in Phase 3.

---

### Pitfall 11: A newly published app silently steals traffic, and publish is not a gate

**What goes wrong:**
§12.4 step 8: publishing an app *"registers triggers"*. Trigger registration (§10.3: `intent` + `examples`) is what makes the app visible to JEV. **Nothing in the PRD requires any evaluation of the routing consequence of publishing.**

So: an HR coordinator publishes a new app called "Expense Claims" whose trigger is `intent: expense` with examples `["expense", "claim", "money request"]`. From the next message onward, that app competes for every expense-shaped message from every user who has a role in it. The existing Finance app — which was correctly picking those — now loses volume. **No error occurs. No alert fires. No metric moves on the Finance side.** The Finance app owner notices in the monthly submission count and has no mechanism to diagnose it.

This is not only a quality problem. A department admin with a broad `intent` description and a permissive role assignment has effectively **inserted themselves into every user's routing path**, and nothing in the publish flow notices. FR-R-1 makes apps independent, but AD-1's tool filter is per-user, not per-app — so a broadly-intentioned app is a cross-app traffic acquisition vector.

**Why it happens:**
Publishing is treated as a configuration event, not as a **change to a shared routing surface**. Every app's owner reasons about their own app; nobody owns the global catalogue's behaviour. The App Builder's UX-5 (publish confirmation dialog with a summary of changes) summarises *that app's* changes — the wrong scope for the risk.

**How to avoid:**
- **A publish-time routing dry run, mandatory, blocking.** Before an app goes `draft → published`, evaluate the candidate trigger set against the labelled intents of every *other* app and report: "publishing this app is expected to change routing share by app X: −7pts, app Y: −2pts, this app: +9pts." Block on a threshold (say, any existing app losing >5 points on the overlap set) unless a global admin overrides with a recorded reason.
- **Require specific triggers.** A minimum number of distinct `examples` (the schema has the field; make it mandatory and validated), a minimum description length, and a **cross-app description-collision check at publish** — the same family of check as FR-X-5's circular-share rejection. Two apps whose descriptions are near-duplicates is a publish-time error, not a routing-time mystery.
- **Canary publish using lifecycle states that already exist.** FR-F-5 already has `draft → published → deprecated → archived`. Add a `published_canary` state (or a `traffic_percentage` field) so a new app receives 10% of routing decisions for a week before full exposure. The comparison infra for this already exists as a byproduct of the Pitfall 10 regression gate.
- **Ship `routing_share{app_id}` as a first-class gauge from day one.** This is the metric the platform is missing most obviously: current share of decisions per app, and its week-over-week delta. Without it, no diagnosis of a routing regression is possible at all — you cannot tell "traffic moved" from "traffic fell" from "traffic was always low".
- **A weekly routing digest to app owners**: "your app's routing share fell 6% this week; the likely cause is app `expense-claims-v2`, published 2026-10-14." This converts an invisible regression into an actionable message and is the difference between a self-service platform and an orphan-support burden.

**Warning signs:**
- `routing_share{app_id}` week-over-week delta — **the single most useful missing metric.**
- New app's first-week share vs. its share at day 30 (does it hold, or does it decay as the model relearns?)
- `jev_confidence{app_id}` shifting on the *losing* app (the losing app's decisions get harder as the boundary blurs).
- Count of published apps with `routing_share == 0` over 14 days ⇒ dead apps, which are an adoption problem (Pitfall 12) and a routing-surface cost.

**Severity if ignored:** MEDIUM-HIGH. It degrades silently, it degrades *other people's* apps, and the App Builder is exactly the phase that starts generating new apps.

**Phase to address:** **Phase 3** — must exist before the first non-developer app is published, which is Phase 3's own success criterion.

---

### Pitfall 12: App Builder adoption dies at three specific walls, one of which is an org-chart dependency

**What goes wrong:**
The platform's self-sustaining premise (PROJECT.md: *"Department admins build and own their own apps … without engineering tickets"*) collapses if a departmental admin cannot get a working app published. Three domain-specific walls, in order of severity:

**Wall 1 — The connector dependency is an org-chart dependency, and it is invisible until publish.**
FR-C-2: connectors are managed **globally by platform admins**. FR-C-10: apps **cannot** create connectors — only reference them. So a department admin building a hybrid or external app must, before their app works, have a **platform admin** create a connector. The builder's happy path (§12.4) walks through app → RBAC → form → data routing → publish with no mention of this. The admin configures `connector_ref: hr-api-prod`, clicks publish, and hits a wall they cannot climb.

This is the highest-leverage pitfall in the App Builder class. It means the two most valuable use cases — anything writing to Redmine, HR, ERP, or procurement — are **structurally blocked** for the platform's primary non-engineering persona, while the one mode that works self-serve (internal-only MongoDB) is the one with the least business value. A department admin's realistic reaction is to go back to the spreadsheet, permanently.

*Prevention:* (a) **`internal` mode is the default and is genuinely complete** — a first app must be publishable with zero platform-admin involvement, so the admin's first win does not depend on anyone else. (b) A **"request connector" flow inside the builder** that generates a pre-provisioning request for the platform admin (with the app's required operation, the target system, and the expected field mapping pre-filled) instead of failing with an error. The admin gets an app that works in `internal` mode today and a ticket that resolves the connector later. (c) Explicit UI copy distinguishing **app roles** (this app's `owner/admin/manager/user`, FR-R-3) from **platform admins** (who own connectors, identity mappings, and the audit log) — with a glossary link on the RBAC tab. The confusion between these two layers is the root cause. (d) Connector *provisioning templates* for the common systems (Redmine, Jira-style ticketing, an HR REST endpoint) so the platform admin's work is configuration rather than engineering — §19.3's connector onboarding table lists "Implement connector interface → Developer" as a developer step, and for a self-service platform that step needs to stop being required for the top 3 systems.

**Wall 2 — The first app takes hours; the adoption cliff is ~30 minutes.**
§12.4 is nine steps including RBAC definition, form design, routing configuration, and preview. UX-1 says *"App creation MUST be completable in ≤ 5 steps"* — but UX-1 describes *creating an app*, not *publishing a working one*. A first-time departmental admin authoring a 12-field form, defining two roles, assigning users, configuring routing, and previewing takes 2–4 hours; the second takes 90 minutes. Published-tool adoption curves are brutal below ~30 minutes to first value: below the cliff, adoption is near-zero and the admin never returns. The spreadsheet they were avoiding is *already finished*.

*Prevention:* (a) **A first-run template gallery** — leave request, expense claim, IT ticket, procurement request — with the form, roles, and routing pre-configured. The first app becomes "personalise a template", which is 20 minutes. (b) Make the *wizard* (UX-1) cover **publish**, not just creation: form fields, one role, one trigger — everything else defaults and is refined later. (c) **The connector wall (Wall 1) must be resolved before the template can be published**, so templates that need a connector should ship in `internal` mode or be explicitly marked as needing a platform-admin step. (d) Instrument **time-to-first-published-app** and treat a p50 above 30 minutes as a product defect.

**Wall 3 — Permission-model comprehension by non-technical owners, and the single-admin bottleneck.**
An app has per-app roles and permissions (`leave:view_team`, `leave:approve`), a global-admin layer, and platform service accounts for connectors. Three distinct authority concepts, and the app owner must model their department's actual permission structure on top of them. Two concrete failure shapes:

- **FR-D-7's auto-injected filter is invisible.** Queries auto-inject a `real_user_id` filter unless the user holds `view_all` (§10.3's roles show `user`, `manager`, `admin` with no `view_all`). A manager who should see their team's submissions sees **nothing** — no error, zero rows — because the role they assigned lacks `view_all`. The app owner concludes "the app is broken". This is a support incident that looks like a bug and is a configuration-semantics gap.
- **The single-admin bottleneck.** One admin's app serves 500 people. When the shared connector starts failing at 09:00, the app owner cannot fix it (FR-C-10) and the platform admin cannot tell which of 200 apps is affected. §12.4 step 9 says the owner *"monitors via submission viewer and audit dashboard"* — that is watching, not triage. Meanwhile ambiguous requests come back as clarification prompts the *end user* cannot answer, so users DM the admin directly and the IM channel becomes the admin's personal help desk.

*Prevention:* (a) **A reachability check on publish and on every role change**: for each role, run the actual RBAC-filtered query as a synthetic user in that role and show the admin the resulting row count. "As `manager`, this query returns 14 rows. As `user`, 1 row. `view_all` is not granted to `manager` — do you intend that?" This is the same idea as the permission-reachability check in mature low-code platforms and it is the single highest-value App Builder feature nobody has specified. (b) **A named human escalation path in the clarification prompt** — "if none of these are right, ask @owner in #channel" — so the admin's triage queue is visible and countable rather than an invisible DM stream. (c) **Connector-failure alerts must fan out to referencing apps' owners**, using the `connector_ref` index that already exists in the app definition. The platform admin gets "connector `hr-api-prod` unhealthy — 14 apps affected, owners: …"; the app owner gets "your app's external routing is failing". (d) **App-owner delegation.** FR-R-5 requires exactly one `owner` at all times and FR-R-6 gates transfers on global admin approval — meaning a departing admin's app is stuck until a platform admin acts, and the app keeps serving 500 people with a dead owner. Add co-ownership or a platform-admin-initiated reassignment path for the departure case.

**Warning signs:**
- **Apps in `draft` for >7 days.** The clearest adoption-failure signal available, and it needs an index on `app_last_transition_at` plus an alert. A draft that never publishes is a person who tried and gave up.
- **Published apps with zero submissions in 14 days.** Same meaning, later stage.
- **Median time from app creation to first publish**, and p90. Above 30 minutes is a product defect (Wall 2).
- **Admins with exactly one published app** — the "tried once" cohort. This is the single best predictor of App Builder adoption and **it is not measurable today**, because §10.2's `Real User Profile` has no flag distinguishing an engineer from a domain admin. Add `is_platform_engineer: boolean` to the real-user profile; §21's ">10 apps built by non-developers" cannot be computed without it.
- **Admin week-4 retention** — admins who published in week 1 and edited nothing in week 4. Publishing once is not adoption.
- **Role assignments concentrated in one `real_user_id`** per app (the single-admin risk).
- **Clarification rate per app** (`jev_clarification_shown_total / jev_decision_total`) — an app with a high rate is generating user confusion that lands on its owner.
- **App owners with no responding activity** (owner deactivated per FR-I-7 while the app is still `published`).

**Severity if ignored:** HIGH for Wall 1 (it blocks the use cases that justify the product), MEDIUM-HIGH for Walls 2 and 3 (they cap adoption and convert adoption into support load).

**Phase to address:** **Phase 3**, with the `is_platform_engineer` flag and the time-to-publish instrumentation landing in **Phase 1** (identity profile) so the Phase 3 KPI is measurable from day one.

---

### Pitfall 13: Hybrid routing has an unrepresentable window, and the idempotency guarantee lives on the wrong side of the wire

**What goes wrong:**
FR-D-4 makes the internal write synchronous and mandatory; the external call is enqueued (FR-D-10, §12.1 step 16). FR-D-9 says a failed external call leaves the submission `partial` with a retry queued. FR-D-8 says store both `internal_ref` and `external_ref`. FR-D-12 says a `submission_id` *"cannot be routed twice to the same external system (idempotency)"*.

**Window A — the call succeeded, the record was not written.**
The worker calls the external API. The API creates the record (Redmine issue #4711 exists). The worker then crashes — a deploy, an OOM kill, a Redis connection loss that stops the BullMQ lock renewal. Per BullMQ's own docs, a job whose worker stops renewing its lock is **moved from active back to waiting and a `stalled` event is emitted** (default `maxStalledCount: 1`, default stalled check 30 s). The job re-runs. Second external call. **BullMQ is at-least-once and its docs are explicit that idempotency is the application's responsibility** (*"it should not make the final state of the system different if a job successfully completes on its first attempt, or if it fails initially and succeeds when retried"*). So this is a designed-in duplicate path, not a rare race.

Now the honest part: **FR-D-12 is a request, not a guarantee.** The idempotency key is `X-Submission-ID` / `submission_id` (§13.2, FR-C-5). Whether the duplicate is prevented depends entirely on the downstream honoring it — and Redmine's REST API, most ERP endpoints, and the majority of internal enterprise APIs ignore unknown headers. The PRD phrases FR-D-12 as a platform MUST while the enforcement point is on someone else's server. **Where a downstream is not idempotency-aware, "write-once semantics" is not implementable as specified, and the PRD does not say what happens instead.**

The resulting state is the worst possible one: the internal MongoDB write is correct, so the **user sees success**, and the external system now has two records, so the **downstream team sees duplicates**. Neither party can reconcile.

**Window B — the call succeeded, the response was lost, and a human "fixes" it.**
If the worker dies between the HTTP response and the `external_ref` write, the submission stays `pending_external` / `partial`. A human sees `partial` and retries (FR-C-12: DLQ items are *"manually retryable by global admins"*). **A manual retry of an item that actually succeeded is the single most likely source of production duplicates in steady state** — because `partial` cannot distinguish "never sent" from "sent, response lost". The PRD gives the admin exactly one button and no state to make that button safe.

**Window C — the field mapping silently resolves to nothing.**
`{{form.field}}` (FR-D-3). Suppose the form is version 3 and `start_date` was renamed to `startDate`. The app definition's `data.field_mapping` still says `start_date: "{{form.start_date}}"`. FR-D-10 validates the submission against the form schema — but the mapping is resolved **after** validation, against a different object. An unresolvable path yields empty/null. The external system receives a record with a missing required field and either 400s (recoverable) or **accepts a partial record** (a Redmine issue with no dates, silently created, which the user never sees). The template engine has no defined "unresolved path" behaviour and no resolution-time validation requirement anywhere in the PRD.

**Window D — the downstream is up and returning garbage.**
`getCapabilities()` exists on the connector interface (FR-C-1) and is used nowhere else in the PRD. There is no requirement to assert the shape of a successful response. A 200 with `{"status":"error"}`, a 200 with an empty body, a 200 with a nested `errors: [...]` — all recorded as success by any implementation that checks `res.ok`. `external_ref.system_id` is then `undefined`, the submission is marked `completed`, and the record may or may not exist downstream. FR-C-7 logs a *"response summary"* — logging is not asserting.

**And the reconciliation story does not exist.** §17.1 has no reconciliation test. §16.3 has **no alert on `partial` at all** — the state that means "your data is in two systems and one of them is wrong" is entirely unmonitored. §16.4's runbook has no "submission stuck in partial" scenario. Nobody owns it.

**Why it happens:**
A synchronous/async split is a distributed transaction, and the PRD treats it as a queue and a status field. The two-system commit problem is real, has no atomic solution, and must be handled by *representing* the uncertain state explicitly — which is a design decision, not an implementation detail.

**How to avoid:**
1. **Three states, not two.** Model the external leg as `not_sent | sent_unconfirmed | confirmed`:
   - Write `sent_unconfirmed` to the submission **and durably commit it before the outbound HTTP request leaves the process.** This is the whole trick: the uncertain state becomes representable.
   - On a parsed, asserted response → `confirmed` with `external_ref.system_id`.
   - On a transport failure → leave `sent_unconfirmed` (do **not** mark `not_sent`; you cannot distinguish "request never arrived" from "response never arrived").
   - `not_sent` only when the job never reached the send step (e.g. rate-limited before send).
   **Only `not_sent` is automatically retryable.** `sent_unconfirmed` goes to reconciliation.
2. **A reconciliation job on BullMQ Job Schedulers** (durable, not `@nestjs/schedule` — PROJECT.md's own argument about a rotation silently not running on one pod applies exactly here) that periodically selects submissions in `sent_unconfirmed` older than the connector timeout and either performs a **read-only lookup** by idempotency key or natural key, or marks them `partial_needs_review` and raises an alert. **Never auto-resend.** Set an age threshold: 30 s default connector timeout (FR-C-11) means anything `sent_unconfirmed` beyond 10× that is anomalous.
3. **Declare connector capabilities and act on them.** Extend `getCapabilities()` (§10.5's connector definition) with `supports_idempotency_key: boolean`, `supports_lookup_by_key: boolean`, and `response_schema` (Zod). Then:
   - If `supports_idempotency_key: false`, the connector **must** implement a natural-key pre-check (query-before-create). Publish-time UI copy must say so: *"This connector cannot guarantee write-once semantics; the platform will check for an existing record before creating."* Make the honesty visible at the point of configuration, not in a design doc.
   - §19.3's connector onboarding gains a row: **"Does this API honor `Idempotency-Key`? Provide evidence (docs link or a test request)."** That is a five-minute question that prevents a class of production duplicates.
   - A 2xx whose body fails `response_schema` is a **failure**, not a success.
4. **Template resolution is validated, not evaluated-and-hoped.** Resolve every `{{form.x}}` / `{{real_user.y}}` against a Zod schema derived from the **pinned** `form_version`. An unresolvable path is a **routing error** that fails the submission with an actionable message (UX-6), never an empty value. Add a **publish-time static check**: every `field_mapping` key resolves against the pinned form schema, and every field the connector requires is mapped. This is the same publish-time check family as FR-X-5 and Pitfall 11.
5. **Make manual DLQ retry safe.** The retry UI must show the current external state, the connector's `supports_idempotency_key`, and require explicit acknowledgement for `sent_unconfirmed` items ("this may already have been created externally — confirm before resending").

**Warning signs:** (all new; the PRD has none of these)
- `submission_status_total{status="partial"}` as a **gauge with an alert**. Its absence from §16.3 is the biggest single observability hole in the document.
- `submission_external_sync_lag_seconds{connector_id}` histogram; alert `> 300s` (10× the default connector timeout).
- `submission_reconciliation_total{result}` counter (`resolved | still_unconfirmed | escalated`).
- `connector_mapping_error_total{app_id}` counter — template resolution failures. Currently completely invisible; a spike means a form was edited and a mapping broke (Pitfall 14).
- `connector_response_assertion_failed_total{connector_id}` — 2xx with an unparseable body.
- DLQ **oldest item age**, not just depth (see Pitfall 8).
- A scheduled check: count of `completed` submissions with `external_ref == null` in `external`/`hybrid` mode. Any nonzero value is a data-integrity bug by construction.

**Severity if ignored:** HIGH — duplicate records in the system of record, invisible to the user, with no monitoring and no reconciliation path. This is the highest-consequence pitfall in the connector half of the platform.

**Phase to address:** **Phase 2** (external + hybrid modes and BullMQ are Phase 2 deliverables), with `getCapabilities()` extension and the `not_sent/sent_unconfirmed/confirmed` model designed in Phase 1 alongside the submission schema.

---

### Pitfall 14: Version drift — the pin is specified as a submission property and never carried through the link

**What goes wrong:**
The PRD versions three things: forms (FR-F-2, `form_version`), app definitions (FR-F-6, last 20 kept, rollback supported), and submissions store *both* `app_version` and `form_version` (§10.4). FR-F-12: *"Published form changes MUST NOT affect in-progress submissions (version pinning at link creation)."*

**But §12.1 step 12 — the actual link-resolution path — says only: "Server validates JWT, checks TTL, pre-fills from user profile."** The version pin appears in FR-F-2 (a submission property) and FR-F-12 (a link property) and **nowhere in the flow**. Three concrete breakages follow:

**(a) Edit link issued at version N, form re-versioned to N+1 before submit.** With the pin correctly implemented, the submission validates against N — correct. But the **renderer must also be served version N**. If link resolution fetches "the current form", the user fills a v(N+1) form whose payload is validated as v(N), or vice versa. A field renamed between the two produces a validation error the user cannot act on ("field `start_date` is required") when they are looking at a form that says `Start date`. This is a pure spec gap, not an implementation risk: the pin has to be a claim inside the link JWT (`form_id`, `form_version`, `app_version` — all opaque integers, fully consistent with NFR-SEC-2's "no PII in JWTs").

**(b) Rollback to a prior app definition while old links are live.** FR-F-6 keeps 20 versions and supports rollback. Rollback restores `triggers`, `rbac` (roles *and* assignments), `data.field_mapping`, `data.connector_ref`, and `lifecycle`. **Rollback silently restores old RBAC.** A rollback is not a permission change by definition, so `perm_version` is unchanged, so **every read link minted under the newer — correct — definition continues to resolve under the older one.** Combined with Pitfall 4's absence of revocation, rollback is a way to change what data a live link exposes without invalidating anything. Fix: **a rollback is a security event.** Bump `perm_version` for every user of the app *and* bump the read-link epoch (Pitfall 4) as part of the rollback transaction — as a property of the rollback operation, not something a developer remembers to do.

**(c) Field-mapping breakage on every form edit that renames a field.** A v3 rename breaks every mapping that still references the v2 name, silently (Window C in Pitfall 13). The mapping lives in the **app definition**, the form lives in the form document; nothing couples them at edit time.

**(d) Schema retention is unspecified and the direction of the mistake is bad.** §10.3 stores `schema_ref: forms/leave-create-v2.json`. Historical submissions reference `form_version` forever (3-year audit retention, up to 1M submissions per app). **Nobody specified a retention policy for old form schemas.** The tempting cleanup — delete schemas older than N versions to keep the app definition small — destroys the ability to render, export, or audit a historical submission. Schemas are immutable versioned documents retained under the app's retention policy and referenced by the *pinned* `form_version`, never by "latest". Add `form_version` to the compound index on every submission collection so historical export is a single indexed query rather than a scan.

**Why it happens:**
Version pinning was specified on the artifact (the submission) rather than on the *link*, which is the thing that carries identity across time. Once the pin is a submission field, nothing forces the renderer and the validator to agree.

**How to avoid:**
- Carry `app_id`, `app_version`, `form_id`, `form_version` **in every link JWT** (write and read links). The renderer requests exactly that version; the validator validates against exactly that version. One source of truth.
- **Publish-time impact preview, blocking.** Before publishing, report: "N links are currently live against forms other than the one you are publishing (12 create links, 340 edit links). M links against the previous app version. Continuing will not affect them." This is the same publish-gate pattern as Pitfalls 11 and 12, and it makes an expected consequence visible instead of surprising.
- **Renames are explicit.** The Form Builder must warn on rename/delete: *"3 field mappings reference `start_date`. Publishing this change will break them."* With a **field-reference index** (which app fields are referenced by mappings, prefill, notification templates, conditional logic, and query projections) this is a single lookup. Given the `{{form.field}}` template appears in at least four places in the app definition (§10.3: `prefill`, `data.field_mapping`, `notifications.topics[].template`, and query projections), that index is worth building early.
- **Rollback bumps the epoch and `perm_version`** (Pitfall 4).
- Never delete a form schema that any submission references; garbage-collect only schemas with no submissions AND older than the retention floor.
- **Prefer additive changes.** Warn (not block) on removing or renaming a field that has ever been submitted against; allow it with a migration note recorded in the version's metadata.

**Warning signs:**
- `submission_form_version_mismatch_total` — submission version ≠ app version at submit time. Non-zero is *expected* (that is what pinning means); the **rate** is the signal. A spike means heavy publish activity, not a bug.
- `form_schema_ref_missing_total` — a submission referencing a schema that no longer exists. Should be structurally impossible; if nonzero, a cleanup job deleted something it should not have.
- Publish-time count of live links pinned to older versions — surfaced in the confirmation dialog (UX-5).
- A per-version submission histogram — a spike at one version means the app has not been edited in a while, which for a departmental app means it has not been maintained.
- `connector_mapping_error_total{app_id}` (Pitfall 13) is the practical detector of (c).

**Severity if ignored:** MEDIUM-HIGH — user-visible validation failures with confusing messages, silent mapping breakage into external systems, and a rollback path that changes what live links expose.

**Phase to address:** **Phase 2** (edit links) and **Phase 3** (versioning UI, publish gate, rollback). The link-claim pin is a **Phase 1** decision because it fixes the link JWT payload shape.

---

### Pitfall 15: Compliance and observability collide — and the honest answer is that NFR-O-1 loses

This section names the conflicts rather than papering over them.

**Conflict 1 — `submission_id` as trace ID vs. immutable 3-year audit vs. erasure.**

NFR-O-1 requires the trace ID to **be** `submission_id`, propagated IM → API → Form → Data Router → Connector. NFR-O-5 requires `trace_id` in structured logs. §16.1 exports to Jaeger/Tempo. FR-AU-1/3/5 require an append-only, immutable, 3-year audit log whose entries (per §10.6) include `actor`, `metadata.ip`, `metadata.user_agent`, `trace_id`.

The problem: `submission_id` is a **persistent pseudonymous identifier linking a specific employee to a specific record in a specific external system.** Making it the trace ID means it lands in every span, every log line, every Prometheus exemplar, and every trace-backend index — **including the 1-year cold archive and the 3-year immutable audit store.**

That is a much larger exposure than the submission data itself, and it is a *worse-governed* one:
- Submissions live in per-app collections with **per-app RBAC** (FR-R-1) and a **purge path** (FR-LC-4/5).
- Trace and log stores have **no per-app RBAC, no purge path, and no app boundary at all.** A single operator with log access can query "all submissions by `usr_42` across all apps, all time" by searching one field. That capability does not exist anywhere else in the system.

**Named conflict — which requirement loses:**
> **NFR-O-1 loses as written.** "Trace ID = `submission_id`" is not a technical requirement; it is a naming convenience. The actual requirement is *one correlated trace per user action across five services*, which is achievable with an opaque correlation id.

The replacement:
- Use an opaque `trace_id` (W3C `traceparent`, from the OTel SDK) for the trace, propagated end to end.
- Carry `submission_id` as a **span attribute on spans that are already inside an authorised request context** — that is, on the API/worker spans, never on the inbound-webhook span where the actor is not yet resolved.
- **Exclude `submission_id` from trace/log attribute indexing** at the collector and log-pipeline level. The field is present for debugging inside a trace; it is not indexed and not searchable across submissions.
- If the business insists on `submission_id` as the trace ID (the operational convenience of grepping one identifier is real), then **the trace backend must be brought inside the compliance boundary**: same 3-year immutable retention, same no-deletion property, and erasure formally scoped to exclude it. That must be a written decision to the DPO, not an accident discovered during an audit. **State this trade-off explicitly; do not leave it implicit.**

**Conflict 2 — a 1-year cold log store makes the right-to-erasure promise unachievable.**

PROJECT.md already states the half of this: *"Erasure is broken by construction unless PII is excluded from logs before serialisation via a field allowlist — a denylist regex always misses, and a 1-year cold log retention makes the right-to-erasure promise unachievable."* The full statement:

- §15.4 promises GDPR-aligned erasure. FR-AU-3 requires 3-year audit retention. FR-AU-5 forbids deletion. NFR-O-6 keeps logs 1 year hot/cold (30 d hot + 1 y cold).
- `real_user_id`, `chat_user_id`, IP address, user agent, and `submission_id` are all personal identifiers under GDPR. They are all in the log and audit schemas.
- **Therefore: erasure cannot be delivered against the log and audit stores. Full stop.** Not "is hard", not "requires care" — it is structurally impossible while an immutable 3-year store exists, and that store is itself a FR-AU MUST.

**Named conflict — which requirement loses:**
> **FR-AU-3 / FR-AU-5 (3-year immutable append-only audit) wins. The §15.4 erasure promise must be narrowed to what can actually be delivered.**

The honest, deliverable promise, which should replace the §15.4 language:

> *Erasure removes PII from MongoDB submissions, identity records, role assignments, and cached mappings in Redis. PII does not enter logs, spans, or traces by construction — enforced by a field allowlist applied before serialisation, not by filtering afterwards. The immutable audit trail retains a pseudonymous `actor_ref`; erasure replaces the mapping from `actor_ref` to a real user with a tombstone, so the record of *that an action occurred* survives while the link to a person does not.*

That is a defensible, commonly-used design and it is achievable. "Erasure including 3 years of immutable audit logs" is **not** achievable and must not be claimed. Two sub-pieces make it real:
- **The audit actor becomes a tombstoneable `actor_ref`**, not a live `real_user_id`. Erasure breaks the pointer; the accountability record survives on a different legal basis (legitimate interest in accountability for state-changing actions) than the submission data (contractual/legal obligation).
- **The allowlist is applied in the logger's serialisation path in Phase 1**, not retrofitted. Retrofitting means auditing every call site in the codebase *and* every historical log line — and you cannot retroactively delete what a denylist missed. **This is the highest-value one-week investment in the entire roadmap** and it is Phase 1 or it is not done.

**Conflict 3 — the trace must cross the form boundary, and the form boundary is a URL.**

NFR-O-1 requires the trace to survive IM → API → Form → Router → Connector. The form renderer is a static web app authenticating via **JWT in the URL** (§13.3, FR-L-3). A JWT in a URL is a bearer credential that lands in: browser history, `Referer` headers on any navigation, corporate proxy logs, any analytics or error-reporting script on the page, and **Slack's link unfurling preview** — i.e. a link pasted into a channel gets its credential rendered to everyone in the channel. §13.3's CSP (`default-src 'self'; script-src 'self'`) prevents exfiltration *by script*, which is good and necessary, but `Referrer-Policy` is **not specified anywhere in the PRD**, and that is the specific control for this leak. Same for `Cache-Control` on link responses — a cached link response is a cached credential.

Prevention: `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on the form-renderer origin, asserted by a test; plus an explicit rule that the form-renderer origin serves **zero third-party resources** (no fonts, no analytics, no CDN, no error reporter) — PROJECT.md already rejects CDN builds of FormIO for a related reason, and the same rule applies here.

**Conflict 4 — `metadata.user_agent` in the audit log is a fingerprint.**

§10.6 stores `metadata.user_agent` (e.g. `"Slack/2026.09"`) and `metadata.ip`. Browser user agents are pseudonymous persistent identifiers. `Slack/2026.09` is low-risk; a real browser UA is not. The audit schema should classify fields by identifiability and apply the retention policy per class, rather than treating the whole `metadata` blob as one category.

**Warning signs:**
- **A CI test asserting no disallowed field name appears in any serialised log line.** Note the direction: a denylist in a *test* is acceptable as a guard **only if the runtime behaviour is allowlist-driven**. The runtime must be an allowlist; the test is the tripwire.
- **Schema-drift detection on the logger**: alert if the count of distinct field names emitted by any service exceeds the declared allowlist size. A new `req.body` or `err` serialisation into a log line is the single most likely accidental PII leak in a NestJS codebase (`err` in particular — stack traces routinely carry request context).
- A scheduled sample of the cold archive (say 0.1%) validated against the allowlist schema.
- An audit of `err`/`context`/`meta` serialisation call sites before the first production deploy — the only moment it is cheap.

**Severity if ignored:** HIGH — and uniquely, this is the one pitfall where being wrong is **not recoverable by fixing a bug**. Log content that leaked cannot be un-leaked. The Phase 1 gate is therefore non-negotiable.

**Phase to address:** **Phase 1**, for the allowlist-in-serialisation-path decision and the `Referrer-Policy`/`no-store` headers (link rendering is Phase 1). The `submission_id`-as-trace-ID amendment must be made in the first OTel wiring in Phase 2, and the audit tombstone design in Phase 2's audit log deliverable.

---

### Pitfall 16: One shared connector, N apps, no per-app budget — the blast radius is every app at once

**What goes wrong:**
AD-5 (adopted, marked ✓): *"Shared connector credentials (one service account, many projects)"* — kills credential sprawl, mirrors the Redmine model. FR-C-2: connectors are global. FR-C-4: rate limits are *"per connector instance, shared across all apps referencing it."* §10.5 shows one `hr-api-prod` with one `credential_ref` and `requests_per_minute: 60`.

**The defining property: one misconfiguration, one expired token, one rate-limit policy, or one compromise takes down every referencing app simultaneously, with no app-level error anywhere.** Four concrete mechanisms, in likelihood order:

**1. Shared rate-limit budget exhaustion (most likely).** 60 req/min across N apps. App A's legitimate burst consumes the budget and app B's submissions go to `partial`. `connector_call_total` is labelled `connector_id, status` — a 429 looks like connector health degradation and trips the §16.3 "connector failure >5%" Critical alert — **while the cause is one app's traffic, not the connector's health.** The platform admin investigates the wrong system. And the app that breaks is whichever is unlucky, which makes it look non-deterministic.

**2. Credential expiry — and a health check that cannot see it.** §10.5's connector definition has **no `expires_at`, no refresh block, and no credential lifetime field at all.** One expiry → every app referencing it fails at once, and the failure presents as "the HR API is down" rather than "our token expired on Tuesday". Worse: FR-C-9's health check runs *"every 60 seconds"* against the connector's configured `health_check.endpoint` (§10.5: `/health`). **A conventional `/health` endpoint is unauthenticated and returns 200 regardless of credential validity.** So the health check reports `healthy` while every real call 401s. This is a concrete spec gap: *a health check that does not exercise the credential cannot detect credential failure*, and the one the PRD specifies is exactly that shape.

**3. Compromise or over-broad scope.** The service account spans many projects. A leaked token grants access to all of them, and **there is no per-app boundary on the external side** — the platform cannot constrain what the token can reach, only which token it uses. Blast radius is every project the account touches, not every app.

**4. Silent repointing during maintenance.** `connector_ref` is a string inside the app definition. Changing a connector's `base_url` or `operation` silently repoints **every** app referencing it, and that change rides along in a generic app-definition update — so it inherits the permissions of *whoever can edit an app*, not of *whoever manages connectors* (FR-C-2). A department admin with app-edit rights could repoint the HR connector for the whole platform. **The permission boundary between "edit my app" and "change a shared integration" is not enforced anywhere.**

**How to avoid:**
- **Per-`(connector_id, app_id)` rate limiting with a configurable share**, or at minimum a per-app counter so the dashboard can attribute exhaustion. FR-C-4's wording should change from "shared across all apps" to "budgeted per app within a shared connector envelope". The App Builder must display: *"your app is consuming 78% of this connector's budget"* — a departmental owner needs to know they are the problem.
- **Model credential lifetime in the connector definition**: `expires_at`, `credential_type: static | oauth2_client_credentials`, and a refresh path for the latter. Add `connector_credential_expiry_days_remaining{connector_id}` as a gauge with alerts at T-30/T-7/T-1.
- **Make the health check exercise the credential.** Either a connector-declared authenticated probe (`health_check.authenticated: true`, hitting an endpoint that requires the token), or have the platform issue a real low-cost call on a slow cadence (e.g. hourly) and alert on its failure. **An unauthenticated `/health` check must not be the sole signal.** Alert text should say "credential rejected (401/403)" separately from "endpoint unreachable" — different owners, different runbooks.
- **Connectors are immutable in identity.** A change to `base_url`, `operation`, or auth type creates a **new connector version**; apps reference a version. A `connector_ref` change is a separate, permission-checked, audited mutation — not a field inside a generic app-definition edit.
- **Ship the blast-radius view.** A connector → referencing-apps → owners index, in the Connector Manager (§14.1), so "how many apps go down" is answerable in one query. Every connector-failure alert states the affected app count and the owners. This is also the fix for Pitfall 12 Wall 3.
- **Keep the AD-5 trust-domain argument honest.** AD-5 is right for credential sprawl and wrong for blast radius. The resolution is **one service account per trust domain, not one per platform**: one Redmine token for Redmine, one HR token for HR — sharing within a domain where the projects genuinely need shared access, never across domains. Record *why* a broader scope was needed, in the connector definition.
- **Rotate on a schedule with overlap**, using the same keyset mechanism as Pitfall 6 / NFR-SEC-9.

**Warning signs:**
- `connector_call_total{connector_id, status="429"}` share by app — attribution, which the current label set cannot provide. **Add `app_id` to the connector metric labels** (§16.2 currently has `connector_id, status` only).
- Per-app share of connector budget: `connector_budget_used_ratio{connector_id, app_id}`.
- `connector_credential_expiry_days_remaining` — **new metric.**
- "Connector unhealthy — N apps affected" where N comes from the reference index, in the alert text itself.
- `connector_call_total{status="401|403"}` — the credential-failure signal that a `/health`-only check structurally cannot produce.
- Alert distinction: `credential_rejected` vs `endpoint_unreachable`. Conflating them is how a token expiry becomes a 40-minute investigation.

**Severity if ignored:** HIGH — an unannounced, platform-wide, single-token failure mode, plus a genuine authorisation-boundary gap (app editors can repoint shared integrations).

**Phase to address:** **Phase 2** (connector interface and the REST connector are Phase 2 deliverables), with the `app_id` metric label and the connector-definition schema changes landing in Phase 1.

---

### Pitfall 17: Redis pub/sub invalidation is fire-and-forget, and every "immediate" cache invalidation in the PRD depends on it

**What goes wrong:**
FR-I-6: mapping changes *"MUST invalidate Redis cache immediately via pub/sub"*. FR-R-9: RBAC resolution cached 5 minutes *"with immediate invalidation on change"*. FR-X-6: share revocation *"takes effect immediately"*.

**Redis pub/sub has no delivery guarantee, no persistence, no replay, and no backpressure.** A subscriber that is mid-redeploy, on a flapping network, or briefly blocked is simply **missing the invalidation**, and it serves stale data until the TTL expires — up to **1 hour** for identity mappings (FR-I-4), 5 minutes for RBAC (FR-R-9). For a permission change, five minutes of stale authorization is a security window; for an identity deactivation (FR-I-7: user leaves the company), an hour of stale mapping means a leaver can still act through an old mapping — and the OTP lockout, the 3-attempt limit, and the 10-minute expiry (FR-I-8) offer no protection once a mapping exists.

Worse, the failure is invisible and one-directional: **duplicate invalidations are harmless** (idempotent), **dropped invalidations are silent**. A rehash of the RBAC cache key would fix it; there is no such mechanism.

**Why it happens:**
Pub/sub invalidation is the standard pattern and it is correct *most of the time* — which is exactly the problem, because the failure only appears during deploys and network events, which is when you are least able to diagnose it.

**How to avoid:**
- **Version-stamped reads instead of relying on invalidation alone.** Store a monotonic version alongside each cache entry and check it on read (a single Redis `GET` for the version key, or a version field in the cached value validated against the authoritative store's version at a coarser cadence). This is the same pattern as `perm_version` (FR-R-8) and the read-link epoch (Pitfall 4) — **apply it uniformly: every cached authorization decision carries a version, and staleness is detected by comparison rather than by the absence of a message.**
- **Key identity cache entries by the version** (`mapping:v{version}:{chat_user_id}`) so a version bump makes every stale entry unreachable by construction. Old entries expire by TTL. This is the cheapest correct implementation and it removes the pub/sub dependency from the *correctness* path — pub/sub becomes a latency optimisation (it lets you skip the version read), not the mechanism.
- **The authoritative permission check must never be served from cache without a version comparison.** FR-R-7's two enforcement points (pre-JEV filter, pre-execution re-check) both do RBAC aggregation; the pre-execution one is the security-relevant one and it must consult the version.
- **Log every invalidation publish and every subscriber receipt** with the version. A mismatch count is the detector. `invalidation_missed_total{service}` — a new metric.

**Warning signs:**
- `invalidation_missed_total{service}` (new) — non-zero means stale authorization is being served.
- `cache_version_mismatch_total{cache}` (new) — the detector for stale reads.
- Cache hit rate that steps *up* during a deploy window (a restarted subscriber warms slowly, so hit rate dips — an inversion is the tell).
- Deactivated users still resolving: FR-I-7 deactivation must immediately invalidate; if a leaver can act, that is a security incident.

**Severity if ignored:** MEDIUM-HIGH — a five-minute-to-one-hour stale-authorization window, silent, on the two hottest paths the architecture was specifically designed to keep fast.

**Phase to address:** **Phase 1** (identity mapping cache and RBAC cache are Phase 1 deliverables). The pattern must be established in Phase 1 because retrofitting versioned cache keys after the App Builder exists means invalidating every deployed app's cache semantics.

---

### Pitfall 18: Auto-injected filters leak soft-deleted rows, and the Query DSL is an authorisation surface with no test

**What goes wrong:**
Two related issues in the read path, both of which are *silent data exposure* rather than failures:

**Soft-delete leakage.** FR-LC-5: purge is *"soft-delete first (mark as deleted, exclude from queries); hard delete after 30-day grace period."* FR-D-7: queries auto-inject a `real_user_id` filter unless the user holds `view_all`. **Nothing says the auto-injected filter also excludes soft-deleted documents.** Soft-deleted rows continue to consume index space and query time for 30 days (a real operational cost at 1M submissions per app), and — if `deleted_at` is not in the filter — they **appear in read-link results and in exports** for 30 days after a user requested deletion. The export path (FR-LC-6, §14.1 Submission Viewer) is the worst case: FR-LC-9 keeps archived data *"queryable by global admins for compliance"*, so an admin export that does not filter `deleted_at` produces a file containing data the user asked to have erased, delivered to a third party. **That is a compliance failure, not a UX annoyance.**

**The Query DSL has no negative tests.** FR-D-6: a Query DSL is provided for reading internal data and *"Raw MongoDB queries MUST NOT be exposed to app builders."* That is the right call and it is the right security boundary — but the PRD has **no test requirement, no lint, and no structural guarantee** that every DSL path produces a query whose filter provably contains the user filter. The DSL will grow (filters, joins across shared collections per FR-X-*, aggregation pipelines, sort/paginate) and every growth point is an opportunity to lose the injected filter. FR-X-7 makes it worse: shared-collection access must respect **the consumer app's RBAC**, so there are now two permission contexts to compose and either can be dropped.

**Why it happens:**
The auto-injected filter is added once, in one place, in an early version. Nothing forces every subsequent DSL feature to preserve it, and no test asserts it. Soft-delete is added later (FR-LC-5) as a *new field*, and nothing prompts anyone to add it to the existing filter.

**How to avoid:**
- **`deleted_at: null` is part of the injected filter, in the same code path as `real_user_id`.** One builder function produces both. Never two places.
- **Make the invariant testable structurally:** a test that, for every DSL construct in the grammar, asserts the compiled query plan contains the injected filter. Better: the DSL compiles to an **explicit query plan object**, and the filter injection is a property of the plan builder — the DSL author *cannot* construct a plan without passing through it. Never string-concatenate a Mongo filter; build a plan and validate its shape.
- **Reject a DSL construct that cannot be expressed with the injected filter** (e.g. a cross-collection `$lookup` that bypasses the consumer app's RBAC) with an explicit error at author time, not a runtime leak.
- **Exports use the same plan builder as queries.** An export is not a privileged operation. Today §14.1's Submission Viewer has "filter, export" and FR-LC-9 says admins can query archived data — those two together are the leak path. Exports must run the same injected-filter pipeline with an explicit `include_deleted` flag that is **audited**.
- Index `deleted_at` alongside the existing indexes (FR-D-5 creates declared indexes at publish — make `deleted_at` a default index member).

**Warning signs:**
- Query results count vs. the count the admin expects — the classic signal, but nobody is watching.
- `submission_export_total{include_deleted}` counter (new) — any `include_deleted=true` export by a non-admin should alert.
- A scheduled invariant check: `count(documents where deleted_at != null AND appears in a recent read-link result)` — structurally awkward, but a periodic sample comparison against a soft-deleted-id set is cheap and catches it.
- Export row counts trending above the app's live submission count.

**Severity if ignored:** MEDIUM (read path) escalating to **HIGH compliance** for the export case specifically.

**Phase to address:** **Phase 1** for the injected-filter builder (internal storage mode and the first read paths are Phase 1/4); the export path with **Phase 3** (Submission Viewer).

---

### Pitfall 19: "Already submitted" as an error-shaped response, and submission IDs pasted into chat transcripts

**What goes wrong (two small, high-frequency UX/security items):**

**(a) The duplicate submit returns an error.** §12.1 step 14: if the token is already consumed → *"already submitted" message*. For a user who double-clicked, that is indistinguishable from data loss. The submission **succeeded** and the platform is telling them it did not. Users respond by resubmitting (blocked by the same mechanism), asking in the channel, or filing a ticket. This is a self-inflicted support burden created entirely by choosing the wrong response shape — and Pitfall 2's "make the duplicate a success" recommendation removes the class.

**(b) `submission_id` in the chat transcript.** §12.1 step 17: the confirmation includes `submission_id` *"for reference"*. That message is then retained by **Slack, Teams, Zalo, or Telegram under their own retention and export policies** — outside the platform's 3-year/1-year boundary, outside its purge workflow, outside its access control, and outside its data-residency configuration. You have just exported a per-employee activity record into a system you do not govern, on a platform whose governance posture is set by the enterprise's IT department, not by you. **No amount of log allowlisting fixes this**, because it is not in your logs — it is in someone else's.

**How to avoid:**
- Return **HTTP 200 with the original confirmation payload** when the duplicate is from the same `real_user_id` and the payload is unchanged; reserve 409 for a genuinely conflicting write. Render it as the same confirmation message.
- Put the submission reference **behind the read link** rather than in the chat text. The user clicks to see status; the identifier lives in the platform, not in the IM transcript. If a plain-text reference is genuinely needed for support workflows, use a short opaque handle, not `submission_id`.
- State the IM-transcript boundary explicitly in the compliance design and in the admin documentation: *"content delivered to the IM platform is governed by the IM platform's retention and access model."* This is a scope limitation to disclose, not a bug to fix.

**Warning signs:**
- `token_consumed_total{result="already_submitted"}` rate (same metric as Pitfall 2) — high values mean users are being told a lie about their own submissions.
- Count of confirmation messages containing a `submission_id` pattern in outbound payloads — assertable in a test.

**Severity if ignored:** MEDIUM — pure user-experience and disclosure, but the frequency is high and it is the first thing every user encounters.

**Phase to address:** **Phase 1** (confirmation message formatting is a Phase 1 deliverable).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|---|---|---|---|
| Consume the create token with `GETDEL` only, no Mongo backstop | One Redis call, ~1 ms, satisfies NFR-SEC-1 on paper | Double submissions after any Redis failover; the PRD's own runbook becomes the only defence and it is post-hoc | **Never** — the `link_consumptions` unique index is ~3 days of work (Pitfall 1) |
| Mark failed external sends as `partial` and auto-retry | Simple state machine, two states | Indistinguishable from "never sent"; manual retry of a succeeded call duplicates records downstream; no reconciliation possible | **Never** — the three-state model is ~2 days (Pitfall 13) |
| Send the full tool list to JEV and raise `timeout_ms` until p95 passes | Simple, one call, matches §11.1 as written | Prompt grows past the latency budget at 200 apps; near-duplicate tools become indistinguishable; p95 is met by *serving the regex fallback* while reporting success | **Never** — tiered routing is the only structure that meets both targets (Pitfall 9) |
| Use Redis pub/sub for cache invalidation without versioned reads | Standard pattern, simple, fast | Silent stale authorization for up to 1 h (identity) / 5 min (RBAC) during deploys and network events | **Only** as a latency optimisation on top of versioned reads (Pitfall 17) |
| Default read-link TTL to 90 days | One number, matches FR-L-3's ceiling, "best UX" | 13× wider exposure window for a link that cannot be revoked at all | **Never** as the default — 7 days, 90 as opt-in per app (Pitfall 4) |
| Let the App Builder publish without a routing impact check | Fast publish, maximal autonomy | New apps silently steal traffic from existing apps; no diagnosis possible without `routing_share` | **Never** — the check is a few hundred ms against a labelled set (Pitfall 11) |
| Build the connector's health check against the conventional `/health` endpoint | Standard, what every API documents | Reports `healthy` while every real call 401s; credential expiry presents as "the external system is down" | **Never** — the probe must exercise the credential (Pitfall 16) |
| Add `app_id` as a high-cardinality Prometheus label after launch | Easy to add early | `connector_call_total` needs `app_id` **at Phase 1** or the Phase 2 dashboards are unusable and retro-fitting labels into a live metrics pipeline is disruptive | **Never** — decide label cardinality before the first dashboard |
| Log the full request/response body for connector calls during debugging | Fast diagnosis | PII in logs, unerasable, and — per Pitfall 15 — the one class of leak that cannot be undone | **Only** in a local-only, field-scrubbed dev mode |
| Support `internal` mode only for the first App Builder release | Much smaller scope | The self-service promise is hollow for exactly the use cases (Redmine/HR/ERP) that justify the platform | Acceptable **only** if Wall 1 of Pitfall 12 is addressed simultaneously — internal-first *plus* a connector-request flow |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|---|---|---|
| **Slack** | Verifying the signature against the parsed body, or with JSON re-serialised | HMAC over the **raw** bytes, `express.raw()` or a `verify` hook registered **before** any global body parser. Test with a known raw fixture (Pitfall 6) |
| **Slack** | Verifying the signature again in the consumer | Verify **once**, at ingress; carry `{verified_at, key_id, native_event_id, raw_body_sha256}` in the enqueued envelope. A second verification fails on any backlog >5 min and turns a perf problem into an outage with a misleading error |
| **Slack** | Assuming a 200 means processed | 200 means *enqueued*. Slack retries only on non-2xx; an ack-then-lose bug is unrecoverable and unobservable without the Pitfall 5 counters |
| **Slack** | Single signing secret | Keyset with an active + previous set and an overlap ≥ the full retry horizon (≥1 h). Same mechanism as NFR-SEC-9's JWT dual-key window — build it once |
| **Microsoft Teams** | Assuming ordered delivery | Jittered retries mean activity N+1 can arrive before N. Key conversation context on `(conversation_id, turn_count)` and **drop** out-of-order turns (Pitfall 7) |
| **Microsoft Teams** | Assuming each activity arrives once | 429/502 with retry-with-jitter ⇒ at-least-once. `activity.id` is the dedupe key; dedupe at enqueue; a dedupe hit must still return 2xx |
| **Microsoft Teams** | Treating the bot as a long-lived connection | Teams pushes; there is no inbound connection. `active_im_connections{im_platform}` (§16.2) is structurally meaningless for Slack/Teams/Zalo/Telegram — redefine or delete it (Pitfall 8) |
| **Zalo OA** | Assuming the official Node SDK exists | It does not (PROJECT.md). ~200 lines over `undici`. Confirm whether the OA callback carries any signature/HMAC field at all before designing a verification path — if it does not, the webhook endpoint is **unauthenticated by design** and must be constrained by source IP allowlist + a per-app unguessable callback path, plus replay protection. **Verify this against Zalo's current docs during the Phase 4 adapter spike** — the answer changes the security model |
| **Zalo OA** | Assuming webhook verification challenges behave like Slack's | The Teams "token validation" and Slack "URL verification" patterns (§FR-IM-6) are platform-specific. Each adapter's challenge/validation flow is its own implementation — that is exactly why the four adapters drift (Pitfall 6) |
| **Telegram** | Assuming polling and webhook are interchangeable | `getUpdates` polling and webhooks are mutually exclusive per bot and switching is disruptive. Pick one; if polling, the "receiver" is a long-poll loop with its own backoff semantics and its own "IM platform unreachable" story |
| **Any inbound webhook source (Redmine, HR)** | Assuming the source sends a stable idempotency key | FR-N-2 maps `external entity ID → submission_id`, but many sources send the same event twice with different delivery ids. Key the dedupe on the source's event/delivery id, and treat the *entity ID* as the business key. Out-of-order status changes ("approved" then "cancelled") need a source-side sequence or timestamp comparison before applying, or notifications will arrive backwards |
| **Redmine / ERP / HR APIs** | Assuming `Idempotency-Key` / `X-Submission-ID` is honored | Most internal enterprise APIs ignore unknown headers, so FR-D-12's write-once guarantee is unimplementable against them. Declare `supports_idempotency_key: false` per connector, require a natural-key pre-check, and disclose it at App Builder publish time (Pitfall 13) |
| **Redmine / ERP / HR APIs** | Treating any 2xx as success | Assert the response against a per-connector Zod schema exposed via `getCapabilities()`. 200-with-`{"status":"error"}` is the classic enterprise failure (Pitfall 13, Window D) |
| **External systems (outbound)** | Verifying outbound HMAC with the same secret and no key rotation | Outbound webhook signing has the same rotation problem as inbound (Pitfall 6) but no NFR covers it. Give it the same keyset treatment when §8.9 is built |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|---|---|---|---|
| **Flat JEV tool selection over the whole catalogue** | `jev_decision_duration_ms` p95 approaches/exceeds 500 ms; the primary provider's timeout rate goes nonzero and traffic silently shifts to `rule-based`; `jev_confidence` drifts down | Two-stage routing (app → tool); publish-time description-collision checks; measure `jev_provider_used_total` | **~100+ candidate tools per user.** NFR-S-6's 200 apps × 3–5 tools hits this in normal operation, not at some future scale |
| **Session/turn context growing without bound** | `jev_decision_duration_ms` p95 climbs over weeks; token costs per decision climb | Cap `previous_turns` to a token budget, not a turn count (FR-J-7 says "last N turns" — N must be budget-derived); expire a conversation buffer after inactivity | **Weeks of continuous use by a power user.** Invisible in a load test because tests do not run for weeks |
| **Unbounded `active_im_connections` / per-connection state** | Not applicable — this is an anti-pattern | Keep the platform stateless (AD-9); all session state in Redis; no sticky sessions | N/A — prevented by the committed constraint |
| **Per-form collections in Mongo** (200 apps × 20 forms) | Collection count explodes; `collStats` and catalog operations slow; backup and restore times grow; index count per DB balloons | One collection per app (§10.3 is correct), document `form_id` and `form_version` as indexed fields; create collections and indexes at **publish** (FR-D-5), never on first write | **~200 collections × 5 indexes.** Visible well before 1M submissions — this is a design-time trap, not a runtime one |
| **Auto-created collections on the write path** (FR-D-2: *"auto-created on first write"*) | A typo or user-derived collection name creates a production collection; collection-count drift alerts | Derive the collection name from `app_id`, validate against a strict pattern at publish, and create at publish; alert on collection-count drift | Immediately — this is a correctness issue with a performance symptom |
| **Soft-delete without `deleted_at` in the index** | 30 days of deleted documents in every index; query latency degrades after any purge cycle; at 1M submissions/app this is measurable | Include `deleted_at` in the default index set; partial indexes (`deleted_at: null`) where the driver supports them; hard-delete on a schedule rather than only on read | **After the first purge cycle**, not at any particular submission count |
| **Log volume with `real_user_id` on every line** | 1-year cold store becomes a large, expensive, permanently retained map of employee activity — and a privacy exposure (Pitfall 15) | Field allowlist before serialisation: log `submission_id`, `app_id`, `real_user_id` only on state-changing and authorisation-failure events, not on every line | Immediately, and it grows linearly |
| **Long-running synchronous work inside the receiver** | p99 receiver latency creeps toward 200 ms; Slack starts retrying; duplicate volume rises | Receiver does exactly three things: verify, dedupe, enqueue. Everything else is a job | **At any scale**, whenever a dependency gets slow. This is the trap that turns a 5 ms slowdown into a duplicate storm |
| **JEV decision on the render path** | p95 for view/query link rendering (NFR-P-8, <1.5 s) is consumed by the LLM | The read path must not call JEV for rendering — JEV runs in the IM path (step 7 of §12.2) and only *selects* the tool; rendering is Mongo + FormIO | Immediately if implemented naively |
| **`prev`/full-collection reads for the Submission Viewer** | Admin viewer times out once an app has meaningful volume | The Submission Viewer must go through the same DSL with the same injected filters and indexed projections (§10.3 declares them for this reason); paginate from day one | **~100k submissions per app**, well below the 1M ceiling |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---|---|---|
| **`submission_id` as the OTel trace ID** (NFR-O-1 as written) | A pseudonymous per-employee identifier indexed across a store with **no per-app RBAC and no purge path** — a cross-app activity map for anyone with log access, retained 1–3 years, erasable by nobody | Use an opaque W3C `traceparent`; carry `submission_id` as an unindexed span attribute only inside authorised contexts; if the business insists, move the trace backend inside the compliance boundary and write the erasure exclusion down. **NFR-O-1 loses this conflict** (Pitfall 15) |
| **1-year cold logs + 3-year immutable audit vs. right-to-erasure** | The §15.4 erasure promise is unachievable as written | Narrow the promise: erasure covers MongoDB, identity records, role assignments, and Redis; logs and spans contain no PII **by construction** (allowlist before serialisation, built in Phase 1); the audit trail retains a tombstoneable `actor_ref`. **FR-AU-3/5 win** (Pitfall 15) |
| **JWT in a URL with no `Referrer-Policy`** | The link credential leaks into `Referer` headers, corporate proxy logs, browser history, and Slack link-unfurling previews | `Referrer-Policy: no-referrer` + `Cache-Control: no-store` on the form-renderer origin, asserted by a test; zero third-party resources on that origin |
| **Denylist regex over log fields** | Always misses something. `err` serialisation is the usual culprit — stack traces carry request context | Allowlist in the serialisation path; a denylist in a **test** is an acceptable tripwire, never the runtime mechanism |
| **No revocation for stateless read links** | A leaked 90-day link cannot be withdrawn. Forwarded links, browser history, proxy logs, IM unfurl previews | Per-app and per-user read-link epoch in Redis (one key each, preserving AD-11's memory property); 7-day default TTL; explicit disclosure of the unrevocable-link limit for 90-day apps (Pitfall 4) |
| **`perm_version` treated as a general authorization version** | Only role changes bump it. Lifecycle changes, grant revocations, app rollbacks, and cross-app revocation do not — and there is **no cross-app kill switch** | App-status gate + read-link epochs; bump `perm_version` and the epoch as part of every rollback and every grant revocation (Pits 4, 14) |
| **Per-IP rate limiting on shared corporate NAT** | One IP block disables an entire office across all apps. NFR-SEC-10 as written guarantees this under benign failures | Split the failure taxonomy; move the replay counter to `real_user_id` + `jti`; alert on "blocked but no attack signal"; **NFR-SEC-10 loses as written** (Pitfall 3) |
| **App-definition edits can change `connector_ref`** | Anyone who can edit an app can repoint a **globally shared** connector for the whole platform | Separate, permission-checked, audited `connector_ref` mutation; connector identity is immutable (Pitfall 16) |
| **Verifying a webhook signature with a denylisted/best-effort basis, or disabling it after a failure** | The webhook endpoint becomes unauthenticated | Raw-body HMAC as the only accepted implementation; a failure is a hard 401; an hourly synthetic signed probe is the detector (Pitfall 6) |
| **Trusting `X-Forwarded-For` without a trusted-proxy list** | Per-IP rate limiting keys on an attacker-controlled header, so it is simultaneously bypassable and mis-triggering | Explicit trusted-proxy configuration; without it, fall back to `real_user_id` + `jti` for replay control |
| **Auto-injected query filter not covering `deleted_at`** | Soft-deleted (user-erased) rows appear in read-link results **and exports** for 30 days | One plan builder emits both filters; the export path uses the same builder with an audited `include_deleted` flag (Pitfall 18) |
| **Outbound messages carrying `submission_id` into IM transcripts** | Per-employee activity exported into a system outside the platform's governance, retention, and residency control | Put the reference behind the read link; disclose the IM-transcript boundary in the compliance design (Pitfall 19) |
| **Connector credential with no modelled lifetime and an unauthenticated health probe** | Token expiry looks like an external outage; up to N apps fail simultaneously and the alert points at the wrong system | `expires_at` + refresh in the connector definition; an authenticated probe; `credential_rejected` distinguished from `endpoint_unreachable` in the alert (Pitfall 16) |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---|---|---|
| "Already submitted" after a double-click | The user is told their submission failed when it succeeded — the worst possible message | Return the original confirmation (HTTP 200) for same-user, identical-payload duplicates; reserve 409 for genuine conflicts (Pitfalls 2, 19) |
| A 20-field form rendered behind a link with no save state | Phone users lose everything to a lock screen, a call, or a battery death — and a 30-minute TTL means the reissued link is often already dead | Draft autosave keyed to the link `jti` (server-side, 24 h, independent of the link TTL), plus a visible "saved" indicator. The common gateway expectation; absent from the PRD |
| Clarification prompts with no human fallback | The end user cannot answer, so they DM the app owner directly and the IM channel becomes an invisible help desk | Name the escalation path in the prompt ("ask @owner in #channel") and count it as a queue (Pitfall 12) |
| A manager who should see team submissions sees zero rows | Silent, looks like a broken app, generates a support ticket | Publish-time and role-change-time reachability check showing row counts per role (Pitfall 12 Wall 3) |
| Form field renamed while an edit link is live | "Field `start_date` is required" on a form that says "Start date" — the user cannot fix it | Pin `form_version` in the link JWT and serve that exact version to the renderer (Pitfall 14) |
| JEV confidently picks the wrong app | The user is sent to a form for the wrong department, and the error surfaces as "this form is broken" | Two-stage routing to eliminate near-duplicate comparison; abstention output; slash commands as a documented first-class path (Pits 9, 10) |
| Confirmation lost during an IM outage | The user resubmits, hits "already submitted", and concludes the platform is broken | Delivery status as first-class state; a non-IM way to check the outcome; age-based (not depth-based) queue alerting (Pitfall 8) |
| App Builder: publish fails on a connector the admin cannot create | The admin's first app is blocked by an org-chart dependency they cannot climb, and they return to the spreadsheet | `internal` mode as the default; in-builder "request connector" flow; a first-run template gallery; time-to-first-publish as a tracked metric (Pitfall 12) |
| An expired link shows only "expired" | The user has to go back to the IM channel and start over, with no context preserved | FR-L-9's re-request flow should pre-fill the conversation context so the user restates one thing, not everything |

---

## "Looks Done But Isn't" Checklist

- [ ] **Token consumption:** atomic `GETDEL` exists — verify the `link_consumptions` unique index on `jti` **and** the `submission_id` unique index on submissions exist. `GETDEL` alone is not done.
- [ ] **`token_consumed_total`:** verify the `result` label has a documented value set (`consumed | replayed | expired | conflict_mongo | already_submitted`) and that all five are emitted. A metric with an undefined label vocabulary detects nothing.
- [ ] **Rate limiting:** verify failed link validations are split into credential-probing vs. consumption classes, and that the per-IP bucket counts **only** the former.
- [ ] **Read links:** verify the app-status gate runs *before* the RBAC check, that `archived` is allowed and `purged` returns 410, and that the TTL default is 7 days rather than 90.
- [ ] **Read-link revocation:** verify there is a `readlink_epoch` key per app **and** per user, and that an admin can bump the per-user epoch in one operation. If there is no cross-app kill switch, this is not done.
- [ ] **Webhook receiver:** verify `queue.add()` is awaited *before* the response is written, in one place, with no logic in the controller. Then verify the handler cannot respond before the enqueue resolves.
- [ ] **Webhook metrics:** verify `webhook_received_total{outcome}` and `webhook_enqueued_total` exist and their difference is monitored. Without them "no silent failures" (FR-IM-7) is an unbacked claim.
- [ ] **Signature verification:** verify it runs exactly once, on the raw body, with a keyset. Then verify a second verification does **not** exist anywhere in the consumer.
- [ ] **Form-renderer headers:** verify `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, and that the origin serves zero third-party resources.
- [ ] **Log serialisation:** verify a field allowlist is applied *before* serialisation, and that `err`/`context`/`meta` objects are not spread into log lines unfiltered. This cannot be fixed retroactively.
- [ ] **Tracing:** verify the trace ID is **not** `submission_id`, or that the decision to make it so was documented and the trace backend brought inside the compliance boundary. This is a decision, not a default.
- [ ] **External routing:** verify `sent_unconfirmed` exists as a distinct state, is committed *before* the outbound request, and that only `not_sent` auto-retries.
- [ ] **Idempotency:** verify per-connector `supports_idempotency_key` is declared and that App Builder publish warns when it is `false`.
- [ ] **Response assertions:** verify a 2xx with an unparseable body is treated as a failure, per connector.
- [ ] **Reconciliation:** verify a scheduled job scans `sent_unconfirmed` and an alert exists for `submission_status{status="partial"}`. The PRD has neither.
- [ ] **Field mappings:** verify an unresolvable `{{form.field}}` is a routing error, not an empty value, and that a publish-time static check validates mappings against the pinned form schema.
- [ ] **Version pinning:** verify `form_id` / `form_version` / `app_version` are **claims in the link JWT** and that the renderer is served exactly that version.
- [ ] **Rollback:** verify rollback bumps `perm_version` and the read-link epochs as part of the transaction.
- [ ] **Form schemas:** verify old schemas are never deleted while submissions reference them, and that `form_version` is in the submission compound index.
- [ ] **Cache invalidation:** verify cache keys are version-stamped (or version-checked on read), so correctness does not depend on pub/sub delivery.
- [ ] **Injected query filter:** verify one builder emits **both** `real_user_id` (unless `view_all`) and `deleted_at: null`, and that exports use the same builder.
- [ ] **Connectors:** verify the health probe **uses the credential**, that `401/403` alerts separately from `endpoint_unreachable`, and that `app_id` is a label on `connector_call_total`.
- [ ] **Connector blast radius:** verify the connector → referencing apps → owners view exists and appears in the failure alert text.
- [ ] **Publish gates:** verify a routing-impact dry run, a description-collision check, a field-reference impact warning, and a live-links-pinned-to-older-versions count — all four, before the first non-developer app is published.
- [ ] **App Builder adoption:** verify `is_platform_engineer` exists on the user profile (§21's ">10 apps built by non-developers" is uncomputable without it) and that time-to-first-publish is instrumented.
- [ ] **Queue alerting:** verify an **age** alert exists alongside every depth alert. Depth without age cannot detect a user-visible incident.
- [ ] **Trace continuity:** verify a trace crosses IM → API → Form → Router → Connector in a staging run. This is the PRD's headline observability requirement and it crosses a browser boundary, which is where it will break.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---|---|---|
| Duplicate submissions already in the external system | HIGH | Reconcile by `submission_id` header / natural key against the external record; deduplicate in the downstream by hand; identify which submissions were affected from `token_consumed_total{result="replayed"}` + the `link_consumptions` age distribution; add the backstop that was missing (Pitfall 1) before reopening |
| Confidently mis-routed decisions discovered in production | HIGH | Switch to slash-command routing (FR-J-11) as the advertised path; disable the failing app's `intent` trigger (keep the slash command); rebuild the labelled set from user corrections and gate the trigger on per-app accuracy |
| An app has silently stolen routing share | MEDIUM | Remove the new app's trigger or set it to `deprecated` (FR-F-5 — a trigger-only rollback that does not touch data); restore the original app's trigger; notify its owner. Then add the publish gate |
| Connector outage taking N apps down | MEDIUM | Identify referencing apps from the connector reference index; notify owners with the blast-radius message; if credential, rotate via the keyset overlap; switch affected apps to `internal` mode temporarily (AD-4's value) so internal writes keep succeeding |
| `sent_unconfirmed` backlog discovered | MEDIUM | Do **not** bulk-resend. Reconcile oldest-first with read-only lookups; for connectors without `supports_lookup_by_key`, escalate to manual review with the submission payload and the timestamp |
| Stale read links served after a purge or revocation | HIGH (already leaked) | Bump the read-link epoch for the app (and the per-user epoch for affected users) — this is what the epoch is for; treat previously served data as disclosed and follow the incident-response workflow (§15.4 notes it is out of scope for v1, **which is why the preventive control matters more here**) |
| PII found in logs | **HIGHEST — unrecoverable** | Treat as a disclosure. You cannot delete what a denylist missed from a 1-year cold archive. The only real control is the Phase 1 allowlist; after that, the recovery is: rotate nothing, purge what is reachable, document, and fix the allowlist |
| A leaked signing secret | MEDIUM | Rotate with a keyset overlap (≥1 h); requests signed with the old secret are rejected only after the overlap; expect a burst of platform retries during the window and pre-scale the receiver |
| An admin-owned app with a deactivated owner | MEDIUM | Platform admin initiates reassignment (FR-R-5 requires exactly one owner, so this must be a deliberate operation with an audit entry); in the meantime the app keeps serving its users with a dead owner — this is why co-ownership or a fast reassignment path matters |
| `partial` submissions never reconciled | MEDIUM-HIGH | Stand up the reconciliation job, run it oldest-first, and report to the affected department. Then fix the alerting so it is caught within minutes next time. If `external_ref` cannot be established, **the internal record is authoritative** and the external side must be corrected manually — say so explicitly in the communication |

---

## Pitfall-to-Phase Mapping

Phase names are PRD §20's. **"Design in"** means the decision must be taken in that phase even if the triggering feature ships later — retrofitting a JWT claim or a log allowlist after links are in circulation or after logs are written is not possible.

| Pitfall | Prevention Phase | Verification |
|---|---|---|
| 1. `GETDEL` not durable | **Phase 1** (design + build) | `link_consumptions` unique index on `jti` exists; `submission_id` unique index exists; an integration test kills Redis mid-submit and asserts exactly one submission; `token_consumed_total{result}` emits all five values |
| 2. Edit-link double submit | **Phase 2** (design in Phase 1) | Concurrent-submit test with N identical requests in parallel asserts one document and N identical 200 responses; §17.2's scenario extended to assert the response *shape*, not just the count |
| 3. NFR-SEC-10 vs legitimate retry | **Phase 1** | A test simulates 5 benign failures (expired/consumed/perm_version) from one IP and asserts **no** block; 5 signature failures **do** block; an alert exists for `block>0 ∧ signature_invalid≈0` |
| 4. Read-link staleness + no revocation | **Phase 4** feature; **Phase 1** design | Link JWT carries `form_version`/`app_version`/epoch; an app-purged link returns 410; a per-user epoch bump revokes every app's links in one write; default TTL is 7 days; `read_link_denied_total{reason}` is emitted for all seven reasons |
| 5. Ack-then-enqueue gap | **Phase 1** | `queue.add()` is awaited before the response, asserted by a test that kills the enqueue and asserts a non-2xx; `received − enqueued` is monitored with an alert |
| 6. Signature verification drift | **Phase 1** | Raw-body verification test with a known fixture; **no** second verification exists in the consumer (asserted by a code search + a test); keyset with an overlap ≥1 h; hourly synthetic probe returns 2xx |
| 7. Duplicate / out-of-order IM events | **Phase 1** | `native_event_id` is mandatory in `InboundEvent` (schema test); dedupe at enqueue with a 1 h TTL; unique index on `(im, chat_user_id)`; a duplicate-suppressed event still returns 2xx; out-of-order turns are dropped |
| 8. IM outage / no silent failures | **Phase 1** (metrics, model) | `queue_oldest_item_age_seconds` exists with an alert; delivery status is on the submission model; confirmation messages follow a 3-attempt backoff policy; a staging test kills the IM connection and asserts a non-IM path to the outcome |
| 9. JEV scale vs latency | **Phase 1** wire contract; **Phase 4** provider | The §11.1 contract has a two-stage shape; a load test with 200 apps / 800 tools and a 150-tool filtered set meets p95 <500 ms; `jev_timeout_total` and `jev_provider_used_total` are monitored and the `rule-based` share is ~0 |
| 10. Wrong vs ambiguous | **Phase 4**; contract in **Phase 1** | The wire spec has `choice.verified: boolean \| null` and `state.force_clarification`; §17.3's conformance suite tests abstention; a labelled set exists and per-app accuracy is reported with an interval; `jev_feedback_total{label}` is populated in production |
| 11. Publish steals routing traffic | **Phase 3** | Publishing runs a routing dry run against the labelled set and blocks on a >5-point drop for any existing app; description-collision check at publish; `routing_share{app_id}` is a dashboard panel with week-over-week delta |
| 12. App Builder adoption | **Phase 3**; `is_platform_engineer` in **Phase 1** | A first app is publishable in ≤30 min with zero platform-admin involvement; a connector-request flow exists; reachability checks run on publish and on role change; connector alerts fan out to referencing app owners; draft-age and time-to-publish alerts exist |
| 13. Hybrid routing window | **Phase 2** (design in Phase 1) | `sent_unconfirmed` is committed before the outbound call (asserted by a crash test); only `not_sent` auto-retries; a reconciliation job exists and is exercised; per-connector `supports_idempotency_key` is declared and surfaced at publish; response assertions reject 2xx-with-garbage |
| 14. Version drift | **Phase 2 / Phase 3**; link-claim pin in **Phase 1** | `form_id`/`form_version`/`app_version` are link claims; the renderer is served the pinned version; rollback bumps `perm_version` and the epochs; field-reference impact warnings exist for rename/delete; old schemas are never collected while referenced |
| 15. Compliance vs observability | **Phase 1** (allowlist, headers); **Phase 2** (trace ID, audit) | An allowlist is applied in the serialisation path, verified by a CI test that fails on any disallowed field in a log line; `Referrer-Policy: no-referrer` and `Cache-Control: no-store` are asserted; the trace ID is not `submission_id`, or the exclusion is documented; the erasure scope in §15.4 is rewritten to the deliverable promise |
| 16. Connector blast radius | **Phase 2** (labels and schema in Phase 1) | `connector_call_total` carries `app_id`; the health probe uses the credential; `credential_rejected` alerts separately from `endpoint_unreachable`; `connector_ref` changes are a separate audited mutation; the blast-radius view exists and appears in alerts |
| 17. Pub/sub invalidation loss | **Phase 1** | Cache keys are version-stamped or version-checked on read; a test that drops a pub/sub message asserts the next read still sees fresh state; `invalidation_missed_total` is monitored |
| 18. Soft-delete + DSL filter leaks | **Phase 1** (builder); **Phase 3** (export) | One builder emits both `real_user_id` (unless `view_all`) and `deleted_at: null`; every DSL construct has a test asserting the injected filter survives; exports use the same builder with an audited `include_deleted` |
| 19. Error-shaped duplicates; IDs in chat | **Phase 1** | A duplicate same-user submit returns 200 with the original confirmation; a test asserts outbound confirmation payloads contain no `submission_id`; the IM-transcript boundary is documented in the compliance design |

### Ordering observations for the roadmapper

Three of these are Phase 1 design commitments whose features ship later. They are listed here explicitly because they are the cases where the PRD's sequencing will bite:

1. **Pitfall 4 (read-link epoch)** — read links ship in Phase 4. Adding a JWT claim in Phase 4 breaks every outstanding link on deploy. The claim shape is fixed in Phase 1.
2. **Pitfall 9/10 (tiered routing, abstention)** — JEV ships in Phase 4, but the §11.1 wire contract is fixed in Phase 1 and §17.3's conformance suite will test against whatever contract exists by the time the suite runs.
3. **Pitfall 15 (log allowlist, trace ID)** — the allowlist is a serialisation-path change and the trace ID is an OTel wiring decision. Both are effectively irreversible once production logs exist. There is no Phase 2 version of this pitfall.

And one scope observation the PRD does not state: **FR-D-12's write-once guarantee is unimplementable against most enterprise downstreams.** This is not a pitfall to prevent so much as a promise to amend. The honest amendment is: *the platform guarantees a single *send* per submission; write-once against the downstream additionally requires either downstream idempotency-key support or a natural-key pre-check, and the connector's capability is declared per instance and surfaced to the App Builder at publish time.* That is achievable and it is what the code will actually do.

---

## Sources

**Primary sources — read directly during this research**

- `redis.io` — *Replication* docs: asynchronous replication by default; `WAIT` *"does not turn a set of Redis instances into a CP system with strong consistency: acknowledged writes can still be lost during a failover, depending on the exact configuration of the Redis persistence."* Basis for Pitfall 1. (fetched 2026-10-01)
- `docs.slack.dev` — *Verifying requests from Slack*: v0 signature over `v0:{timestamp}:{raw_body}` using the **raw** body before deserialization; *"we verify that the timestamp does not differ from local time by more than five minutes… It could be a replay attack, so let's ignore it."* Basis for Pitfall 6. (fetched 2026-10-01)
- `docs.bullmq.io` — *Stalled*: a job whose worker stops renewing its lock is moved from active back to waiting, emitting a `stalled` event; `maxStalledCount` defaults to 1; default stalled check 30 s. *Idempotent jobs* pattern: *"it should not make the final state of the system different if a job successfully completes on its first attempt, or if it fails initially and succeeds when retried."* Basis for Pitfalls 7 and 13. (fetched 2026-10-01)

**Authoritative project sources**

- `PRD.md` v2.0 (2026-09-30) — §7.3 AD-1…AD-12; §7.4 stack table; §8.1–§8.12 FRs; §9 NFR-S/P/SEC/O/A/U; §10.3 App Definition, §10.4 Submission, §10.5 Connector Definition, §10.6 Audit Log Entry; §11.1–§11.4 JEV wire spec, provider interface, fallback chain config; §12.1–§12.5 user flows; §13.1–§13.4 API principles; §14.1–§14.2 App Builder pages and UX requirements; §15.1–§15.4 security and compliance; §16.1–§16.4 tracing, metrics, alert rules, runbook; §17.1–§17.3 test pyramid, scenarios, JEV conformance; §18 deployment; §19.3 connector onboarding; §20 MVP roadmap; §21 KPIs.
- `.planning/PROJECT.md` — Core Value, Constraints, Key Decisions (AD-5 shared connectors, AD-8 atomic token consumption, AD-11 stateless read links, the PII allowlist amendment, the erasure-conflict amendment, the 26–34 week estimate).

**Domain comparison references (conceptual, not measured on this system)**

- Low-code / internal-tool platforms with per-app roles and environments (Retool, Zoho Creator, ServiceNow's request catalogue, Microsoft Copilot Studio's approval-request patterns) — used for Pitfall 12's publish-gate and reachability-check pattern. **These are structural analogies, not measured claims; App Builder adoption should be re-researched against comparable deployments before Phase 3 is planned.**
- Mature chatops platforms (PagerDuty, Shopify) — used for Pitfall 8's distinction between webhook-push and polling transports, which underlies the critique of `active_im_connections`.
- Enterprise form gateways (Jotform, Formstack, DocuSign) — used for Pitfall 19's draft-autosave expectation.

**Explicitly not verified during this pass**

- Zalo OA callback signature support. The Zalo developers site returned only a client-rendered shell. **This must be checked during the Phase 4 adapter spike** — if the OA callback carries no signature, the webhook endpoint is unauthenticated by design and the security model (source-IP allowlist, unguessable callback path, replay window) changes materially.
- Microsoft Teams activity-delivery retry semantics beyond the retry-on-429/502 behaviour stated in the prompt. The relevant Microsoft Learn pages 404'd during this pass; verify against current Bot Framework / Microsoft 365 Agents SDK docs before the Phase 4 adapter.
- Quantified accuracy degradation of LLM tool selection as a function of candidate-tool count. The relevant benchmarks were not retrievable during this pass. **Pitfalls 9 and 10 rest on mechanism (catalog size, near-duplicate descriptions, uncalibrated confidence, a 50-item conformance set that cannot cover a 600-tool catalogue) rather than on measurement. A phase-specific research pass on tool-selection accuracy at 100–800 candidates should precede Phase 4 planning.**
- Real-world adoption-rate benchmarks for self-service form builders by departmental (non-developer) admins. Pitfall 12's Wall 2 threshold (~30 minutes to first value) is a judgement from comparable-tool adoption behaviour, not a measured figure for this domain.

**Confidence by area**

| Area | Confidence | Reason |
|---|---|---|
| Link / token lifecycle (Pits 1–3) | HIGH | Two authoritative primary sources (Redis, Slack) plus explicit PRD text; the failure modes are mechanical |
| Webhook reliability (Pits 5–8) | HIGH for the ordering and verification mechanics (Slack docs); MEDIUM for platform-specific Teams/Zalo behaviour | Two sources unreachable or unverified during this pass |
| JEV routing (Pits 9–11) | MEDIUM | Mechanism is well-founded; the quantitative accuracy claim is unverified. Named as a required pre-Phase-4 research pass |
| App Builder adoption (Pit 12) | MEDIUM | The connector-dependency argument is structural and certain (FR-C-2 + FR-C-10 + §12.4); the adoption-rate claims are judgement |
| Hybrid routing (Pitfall 13) | HIGH | BullMQ's at-least-once semantics are documented; the three-state model is standard distributed-systems practice |
| Version drift (Pitfall 14) | HIGH | Follows directly from a spec gap in §12.1 vs FR-F-12 |
| Compliance (Pitfall 15) | HIGH on the conflict identification; the *legal* framing (legitimate interest for audit) should be confirmed by counsel, not by research | Two genuine requirement conflicts, named with an explicit winner |
| Connectors (Pitfall 16) | HIGH | Follows from FR-C-4, §10.5's schema, and FR-C-10 |
| Cache invalidation (Pitfall 17) | HIGH | Redis pub/sub has no delivery guarantee; the mechanism is not in dispute |

---

*Pitfalls research for: IM-driven enterprise workflow gateway (Slack/Teams/Zalo/Telegram → Redmine/HR/ERP, self-service FormIO.js App Builder, per-app RBAC, JEV-compatible decision layer, connector fan-out)*
*Researched: 2026-10-01*