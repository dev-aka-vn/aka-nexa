# Pitfalls Research

**Domain:** Enterprise IM-driven app builder — adding Zalo OA + Telegram adapters, two-way inbound/outbound synchronisation, group/directory RBAC sync, and a permission-first open-ended AI guard to a shipped v1 (NestJS modular monolith, MongoDB + Redis + BullMQ, FormIO.js).
**Researched:** 2026-10-21
**Confidence:** MEDIUM overall (provider-tier). HIGH for the first-party-documentation claims (Zalo Developer docs, Telegram Bot API docs, Slack API docs, Microsoft Graph docs) — each cross-checked against a second independent source. MEDIUM for the codebase-grounded claims (read directly from this repo at commit `215f96e6`). LOW for anything about *this deployment's* real-world Zalo/Telegram behaviour (see §11 "Gaps").

> **Scope note.** This document is scoped to **v2 additions on top of shipped v1**. It assumes the v1 constraints in `PROJECT.md` still hold: one NestJS codebase, three process entrypoints, modular-monolith boundary lint, `mongodb` native driver, ioredis 6 + BullMQ, `jose` for link signing, D-16 log-field allowlist, D-18 span-attribute allowlist, D-21 frozen read-link claim set, D-23 frozen JEV wire contract.
>
> **Phase-number note.** The v1 roadmap ran Phases 1–9; `PROJECT.md` states v2 numbering starts at **Phase 10**. The v2 roadmap does not exist yet, so every phase reference below is a **proposal** for the roadmapper to reconcile against `FEATURES.md` / `ARCHITECTURE.md`. The *ordering constraints* are the load-bearing content; the numbers are not.

---

## Critical Pitfalls

### Pitfall 1: Zalo OA webhook signature — a plain hash used as a MAC, over a body that must stay byte-identical

**What goes wrong:**

Three separate failures live in one line of code, and the symptoms are indistinguishable from each other:

1. **You implement HMAC-SHA256 because a tutorial said so.** The documented Zalo algorithm is `mac = sha256(app_id + data + timeStamp + OAsecretKey)` — a **plain SHA-256 digest**, not an HMAC. Third-party guides (including several popular Vietnamese-language walkthroughs) misstate this as HMAC. If you copy them, every Zalo event is rejected with 401 and the OA admin sees "the app stopped working."
2. **You parse the body before hashing.** `data` is the **raw JSON body, byte-for-byte**. NestJS's `@Body()` gives you a parsed object; re-serialising it with `JSON.stringify` produces different bytes (key order, whitespace, unicode escaping of Vietnamese diacritics) and the digest never matches. The failure looks exactly like a wrong secret.
3. **You use the wrong key.** The digest uses the **OA Secret Key**, not the **App Secret Key**. These are two different values in the Zalo developer portal and confusing them produces the same 401.

**Why it happens:**

There is no official Node SDK for Zalo OA, no changelog discipline on the OpenAPI, and the primary documentation is Vietnamese-only prose describing a formula rather than a protocol. Every implementation reference in the ecosystem is community-authored and at least some of them are wrong. The NestJS default (`bodyParser: true` + `@Body()`) actively destroys the one input the algorithm needs, so the *convenient* path is the broken one.

**How to avoid:**

- **One implementation, one module.** `ZaloWebhookVerifier` lives in `packages/domain/src/adapters/zalo/inbound/` (the `inbound-adapter` file category — R1 permits only `apps/api` to import it) and is the *only* place in the codebase that knows the algorithm. Nothing else hashes a Zalo body.
- **Capture the raw bytes.** Use NestJS's `rawBody: true` / `@RawBody()` (the same mechanism the Slack controller must use) and hash `rawBody` as a `Buffer`, never a string.
- **Exact formula, documented inline:**
  ```
  expected = sha256( utf8(app_id) ‖ rawBodyBytes ‖ utf8(timeStamp) ‖ utf8(oaSecretKey) )
  presented = header 'X-ZEvent-Signature'
  ```
  The header value is the hex digest (the Mini App / Open API variant is a different formula: `sha256(sortedFieldsConcat ‖ API Key)` — keep them in separate functions, never one function with a boolean flag).
- **Use `crypto.timingSafeEqual`**, never `===`, and validate the presented digest's length/shape first so a malformed header cannot throw inside the compare (same shape as the v1 `WebhookHmacService.verify`).
- **Handle the length-extension question honestly.** Zalo's documented order is `H(app_id ‖ data ‖ timeStamp ‖ secret)` — the secret is a **suffix**. The canonical length-extension attack requires the key to be a **prefix** (`H(K ‖ M)`), so it does **not** directly apply to this ordering, and any write-up claiming "Zalo is length-extension vulnerable because the secret is at the end" is wrong in its reasoning even though it reaches a correct conclusion ("do not treat this as a safe MAC"). The residual hazards are real and are what you must engineer against:
  - it is a **raw hash, not a keyed MAC** — no key derivation, no domain separation, no algorithm agility, no standard to lean on;
  - the `data`/`timeStamp` boundary is **unseparated** (no delimiter between the concatenated fields), so any change to how Zalo orders or pads those fields silently breaks verification;
  - the **Mini App variant** (`H(sortedFieldsConcat ‖ API Key)`) puts attacker-influenced field values in the hashed prefix, and the same secret is reused across purposes — a digest minted for one Zalo surface must never be accepted on another.
  - **Consequence:** pin the algorithm as a frozen constant, freeze it with a **recorded test vector** (a real captured request + its expected digest) in the adapter's test suite, and treat a change in that test vector as a breaking event, not a test to update.
- **Freeze a captured-request test vector during the spike.** This is the single highest-value artefact Phase 11 can produce.

**Warning signs:**

- Zalo events reach the controller and are all rejected; the app works in the Zalo simulator but not in production.
- A "signature mismatch" error rate that is **exactly 100%** (wrong formula/key) versus **sporadic** (body not byte-identical, or a proxy re-serialising).
- Any log line containing the computed digest or the secret.
- The test suite passes against a **synthesised** body (generated by the test) but fails against a **captured** one — the synthesised body is always byte-perfect by construction.

**Phase to address:** Phase 11 (Zalo OA Adapter) — but the raw-body capture plumbing and the frozen test vector are Phase 10 work.

---

### Pitfall 2: Zalo OA's 2-second ack budget and its 5-stage retry ladder end in *silent* webhook death

**What goes wrong:**

Zalo requires HTTP 200 within **2 seconds** (Slack allows 3, Teams is looser). If the callback fails, Zalo retries at **+30 s, +5 m, +15 m, +30 m, +1 h** — five stages, each carrying a `num_retry` header. If all five fail, **Zalo disables the webhook and cancels the app's OA event registration.** The platform does not get an error; it stops getting events. Re-enrolment is a **manual action in the Zalo OA portal** — there is no API to re-enable it.

The failure mode is therefore not "an error appears in the logs." It is **"everything looks fine and the product is dead for that OA."** A single slow dependency (a KMS decrypt, a Redis round-trip, a cold NestJS provider, an unindexed Mongo query) on one unlucky request can permanently stop a customer's inbound flow.

**Why it happens:**

Because 2 seconds *feels* generous. Teams/Slack budgets allow a slow path; teams will retry and eventually disable you with an email to the app owner. Zalo disables you with **nothing** — no email, no API, no webhook. The blast radius is per-OA and invisible from the platform side.

**How to avoid:**

- **The receiver is a pure ingest contract.** Verify signature → validate envelope shape → enqueue to BullMQ → return 200. **No** permission lookup, **no** Mongo read, **no** KMS decrypt (cache the OA Secret Key in-process with a bounded TTL, or resolve it from a pre-warmed credential cache), **no** outbound HTTP, **no** LLM call. This mirrors the v1 rule and is now a hard requirement with a tighter budget.
- **Measure the ack path, not the whole request.** Emit a histogram of *time-to-200* (already allowlisted as `duration_ms`) and alert at p99 > 1.2 s, not at the 2 s cliff. The cliff is where the outage is.
- **Health check must measure ingestion freshness, not process liveness.** A `/health/live` that only proves the process is up will stay green through a disabled webhook. Add a **per-OA event-freshness probe** (last successfully received event age) to the readiness surface, and a scheduled probe that detects "OA registered but zero events for N hours" — this is the only way to learn about the disable.
- **Never let the receiver return non-200 for a business reason.** A malformed event must still 200 (after logging) — a 4xx tells Zalo to retry something that will never succeed, and a 5xx burns a retry stage.
- **Make re-enrolment a documented admin runbook** with the exact portal steps, and surface "this OA's webhook is disabled" as an admin-console alert, not a log line.

**Warning signs:**

- Event volume per OA flatlines to zero with **no error rate change** anywhere in the platform.
- The ack-duration histogram has a long right tail even though the p50 is 3 ms.
- Support tickets of the form "the bot worked yesterday and today it ignores everything," with no platform-side error.
- A support engineer has already re-enabled the webhook once and did not write it down — this is the single most likely precursor to a repeat.

**Phase to address:** Phase 11 (Zalo OA Adapter), with the freshness probe landing in Phase 16 (Operations).

---

### Pitfall 3: Zalo's Vietnam-IP rule silently empties user data and breaks the platform's data-residency contract

**What goes wrong:**

Since **2024-02-29**, Zalo OpenAPI returns user-related data (name, avatar, phone, address) **only to app servers and webhook URLs whose source IP is a Vietnam IP address.** Called from outside Vietnam, the API returns **HTTP 200 with the user fields silently omitted** — no error code, no warning. The platform looks like it is working; the identity-resolution step just has nothing to match on.

Separately, Zalo enforces an **IP-whitelist policy** on production API hosts: requests from unregistered source IPs are rejected with **error `-7`**; the dev endpoint is permissive.

This collides head-on with the `PROJECT.md` constraint *"data residency: configurable and region-locked per deployment."* Zalo is not merely *hosted* in Vietnam — **it constrains where your egress must be.** A "region: ap-southeast" deployment that happens to use a Singapore egress will silently lose Zalo identity resolution.

**Why it happens:**

The rule is documented in a policy notice, not in the API reference, so it is invisible to anyone reading endpoint docs. The silent-omission behaviour is the worst kind: it fails the *assertion*, not the *call*.

**How to avoid:**

- **Make Zalo egress an explicit deployment topology requirement, not an application config.** The Zalo adapter must egress from a Vietnam-region runner (VN NAT egress / VN-hosted worker). Encode this as a startup precondition: the Zalo adapter refuses to enable itself unless `ZALO_EGRESS_REGION === 'vn'` is asserted, and a boot-time self-check hits a user-profile endpoint and fails loudly if the response has no user fields.
- **Do not silently degrade identity resolution.** If the profile lookup returns no user fields, the pipeline must raise an explicit, typed error (`ZALO_PROFILE_EMPTY_OUTSIDE_VN`) rather than treating it as "unknown user" and continuing. The difference between "this user is not in the directory" and "we are not allowed to see users from here" is a 3 a.m. page difference.
- **Register every production egress IP in the Zalo portal** before go-live, and keep that list in the deployment runbook (it changes whenever you scale).
- **Reconcile with the residency story.** If the platform's residency config allows regions where Zalo cannot operate, the honest answer is that Zalo support is **VN-egress-only** and this must be stated in the deployment matrix — not papered over with a "configurable region" claim that has an asterisk.

**Warning signs:**

- Zalo identity resolution succeeds for exactly the users who interacted with the OA via an OA-initiated channel (where Zalo supplies the fields inline) and fails for everyone else.
- A support ticket reading "the bot doesn't know who I am" from VN users only, while Slack/Teams users are fine.
- Any `Zalo` adapter health check that only asserts "HTTP 200" — that assertion is worthless here.

**Phase to address:** Phase 11 (Zalo OA Adapter) for the client; Phase 16 (Operations) for the egress topology and the residency-matrix reconciliation.

---

### Pitfall 4: Zalo's 25-hour access token / 90-day rotating refresh token is a single-writer state machine, and the refresh *kills the previous access token*

**What goes wrong:**

Zalo OA OAuth (v4, PKCE-based) issues:

- an **access token valid 25 hours**;
- a **refresh token valid ~90 days (3 months)** that **rotates on every use** — the old refresh token is invalidated, a new one is returned, **and the previous access token dies immediately when the new one is issued**.

Consequences, all of them real:

1. **Two workers refreshing at once.** Both read the current refresh token, both exchange it. One wins; the other's exchange fails — or worse, both succeed against a lenient server and one of them holds a **dead access token** it will keep using until the next 401, and the stored refresh token is now the *older* of two rotations, so the **newest** refresh token is lost and the chain breaks at the next rotation.
2. **Refresh token lost = 90 days of dead OA.** There is no recovery short of re-running the OA authorisation flow, which requires **an OA admin in the Zalo portal**. A lost refresh token is an outage with a human, not an automated fix.
3. **Clock skew.** A 25-hour token with a client that trusts its own clock will start failing with a confusing 401 near expiry.

**Why it happens:**

The mental model people carry is "OAuth tokens are interchangeable and refreshing is idempotent." Zalo's refresh is **neither** — it is a single-use rotating credential. Every other OAuth implementation in the wild tolerates a double-refresh, so a design that works against Google/Okta silently breaks here.

**How to avoid:**

- **Single-flight refresh.** One Redis lock per OA (`SET NX EX` on `zalo:refresh:<oa_id>`) around the exchange, and the loser re-reads the newly stored access token instead of exchanging again. Redis `GETDEL`-class semantics (available in the Redis ≥8.2 floor the stack already requires) make the handoff atomic.
- **Persist the refresh token encrypted** in the KMS-backed credential store (`packages/domain/src/connectors/data-access/connector-credentials.repository.ts` — the v1 AES-256-GCM envelope) with the OA id in the reference key, and persist the access token **with its expiry and its "generation"**.
- **Refresh early but not eagerly.** Refresh on a *scheduled* job at ~80% of the 25-hour lifetime, plus an on-demand refresh on a 401 that carries a Zalo auth error — but never on a bare 401 (a 401 can be a scope problem).
- **Treat the access token as disposable and the refresh token as a crown jewel.** Only the refresh path touches persistent storage; the access token lives in a Redis cache with a TTL **shorter** than its own lifetime (e.g. 20 h for a 25 h token) so a stale-token bug self-heals within the day instead of persisting.
- **Alert on refresh failure immediately** — a failed refresh is a **90-day countdown**, not a transient error. It belongs in the admin console, not in a log tail.
- **Re-authorisation must be a one-click admin flow** (deep-link to the Zalo authorisation URL, PKCE, callback → store the new refresh token). If that flow is not in v2, a single lost token ends the OA.

**Warning signs:**

- Occasional `ZALO_AUTH_401` in the logs — especially *after* a deploy or a scale-out (two pods starting together and both refreshing).
- A `zalo:refresh:*` Redis lock that never expires (a crashed holder).
- The stored access token's `expires_at` is already in the past, but requests still "work" — that means something else is caching it.
- Two `refresh_token` values in the credential store for one OA — this is the rotation race, already lost.

**Phase to address:** Phase 11 (Zalo OA Adapter).

---

### Pitfall 5: Zalo IDs exceed `Number.MAX_SAFE_INTEGER`, and `JSON.parse` corrupts them silently

**What goes wrong:**

Zalo identifiers are 19-digit integers: `app_id: 360846524894903967`, `user_id: 8756287263669629130`. `Number.MAX_SAFE_INTEGER` is 9,007,199,254,740,991 (16 digits). Every Zalo id in the examples is **19 digits** and therefore **not representable as a JS number**.

`JSON.parse` on such a value produces a **rounded** double — `8756287263669629130` becomes `8756287263669629000` — with **no error, no warning**. Zalo's own PHP guidance uses `JSON_BIGINT_AS_STRING` for exactly this reason.

The consequence is a **silent identity collision**: two distinct Zalo users can map to the same stored `chat_user_id`, and the identity layer will treat them as one person. With `IdentityMappingRepository` upserting on `(platform, chat_user_id)`, a collision **overwrites the first user's mapping** — the second user inherits the first user's `real_user_id` and the first user's permissions.

That is a cross-user authorisation defect, not a display bug.

**Why it happens:**

TypeScript's `number` is the default for JSON, and nothing in the type system distinguishes "id" from "count". Zalo's docs show ids as strings in examples (`user_id` in the member-list response is a string), so the string form is right there in the response — and a `z.number()` schema will *reject* it, pushing the developer toward `z.coerce.number()`, which is where the corruption lives.

**How to avoid:**

- **Ids are strings, everywhere.** Parse Zalo ids as `z.string()` (or `z.union([z.string(), z.number()]).transform(String)`) and **never** coerce them to `number`. If a source genuinely returns a number, convert with `BigInt(v).toString()`, not `String(v)`.
- **A parse-level guard:** a Zalo id validator that rejects any value whose `String()` differs from the source text — or, for numeric sources, one that asserts `BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER)` before converting.
- **Assert the id shape at the adapter boundary**, not deep in the domain. The adapter is the only place that knows Zalo's id format.
- **Never store a Zalo id in a numeric Mongo field.** `chat_user_id` is `string` in the v1 `IdentityMapping` interface — keep it that way.
- **Test with the real 19-digit values.** A fixture with `user_id: '12345'` will not catch this. Include `8756287263669629130` and `360846524894903967` in the adapter fixtures, and assert round-trip equality.

**Warning signs:**

- A Zalo user's `chat_user_id` ends in a round number (`…629000`, `…6290000`) — the signature of float rounding.
- Two Zalo users intermittently share a `real_user_id`.
- `z.coerce.number()` anywhere in the Zalo adapter — grep for it; the presence of the call is the finding.
- A JSON parse helper using `json-bigint`, `lossless-json`, or a `BigInt`-aware reviver — a sign someone already hit this and patched it locally, in one place, instead of fixing the type.

**Phase to address:** Phase 11 (Zalo OA Adapter).

---

### Pitfall 6: Telegram `callback_data` is capped at 64 **bytes**, and the whole message fails to send

**What goes wrong:**

Inline-keyboard `callback_data` must be **1–64 bytes** (UTF-8, so Vietnamese text consumes the budget faster than a character count suggests — a 30-character Vietnamese string is 45–60 bytes). Exceeding the cap makes the **entire `sendMessage` fail** with `Bad Request: BUTTON_DATA_INVALID`. The message is not sent at all; nothing is truncated, no partial message appears. The user sees nothing and the platform sees an API error.

The second half of the trap: **`answerCallbackQuery` is mandatory.** If you do not call it, Telegram shows the button spinner for 10–30 seconds and eventually displays "took too long" to the user. On a slow or failed send path, this is the most visible symptom of the whole subsystem — a spinning button for half a minute.

**Why it happens:**

The limit is on **bytes**, not characters, and the docs state it as a byte count. Teams and Slack have no equivalent constraint (Slack's `block_id` limit is 255 chars), so a cross-platform "button payload" abstraction that is generous on Slack and Teams will blow up only on Telegram — and only when the payload contains non-ASCII, which in a Vietnamese product it always will.

**How to avoid:**

- **`callback_data` carries an opaque handle, never data.** Use a Redis-backed one-time handle (`cb:<random>`) or a short signed id — ideally a `jti` you can look up. Never put a form field name, a role list, a permission name, a `chat_user_id`, an app name, or a tenant id in it.
- **Enforce the limit in one helper.** A `TelegramCallbackData` builder that measures `Buffer.byteLength(value, 'utf8')` and **throws** if > 64 (or truncates to a safe handle) — with the byte count, not the character count. This is a one-line guard that prevents an entire class of production-only failures.
- **Always `answerCallbackQuery`** — including on the error path. Make it a `finally` block in the callback handler, and fire it *before* any slow work (permission check, link issuance). The spinner timeout is user-visible; the work behind it is not.
- **Never let the callback payload be the only copy of state.** Telegram callbacks can be replayed by the user tapping twice; the handle must be single-use.

**Warning signs:**

- `BUTTON_DATA_INVALID` in the error log, correlated with Vietnamese-language flows only (ASCII payloads work).
- Users reporting "the button spins forever."
- A callback payload that visibly contains a form id or a permission name.
- A `callback_data` value longer than 64 characters — the check is *bytes*, so 40 Vietnamese characters is already over.

**Phase to address:** Phase 12 (Telegram Adapter).

---

### Pitfall 7: Telegram commands carry no scope — Telegram says so explicitly — and group privacy mode hides most of what you think you receive

**What goes wrong:**

Telegram's own documentation states it plainly: *"Bot API updates will not contain any information about the scope of a command sent by the user… Your backend should always verify that received commands are valid and that the user was authorized to use them regardless of scope."*

There is no per-command scope, no permission object, no "who is allowed to run this command" metadata anywhere in the update. A command handler that trusts "the user typed the command" as authorisation is trusting a client-supplied string.

The second half: **privacy mode is on by default.** A bot receives only:

- explicit `/cmd@bot` commands;
- general commands when the bot was the **last bot** to speak in the group;
- replies to the bot's own messages;
- **all** private-chat, service and channel-post messages.

**Bot administrators always see everything**, regardless of privacy mode. And **disabling privacy requires removing and re-adding the bot to the group** — it cannot be toggled per group at runtime by the bot.

Consequence: a group-scoped command surface is **invisible until the bot is re-added**, and it stays invisible until then. If the product assumes "the bot listens in the group," that assumption is false on day one.

**Why it happens:**

The mental model is that Telegram delivers messages to bots like Slack delivers channel events to apps. It does not, and the privacy-mode behaviour is only discoverable by reading the docs carefully or by deploying into a real group and being confused.

**How to avoid:**

- **Re-validate permission on every command, always.** The v1 `PermissionCheckService.check` is the correct place: it already takes `(app_id, real_user_id, permission, perm_version)`. Telegram commands are just another trigger for the same check — **never** a source of authority.
- **Never derive a role from the command text.** `/leave` does not mean "this user may request leave." The command is a *selector*; permission comes from the RBAC layer, with the `perm_version` epoch checked at execution.
- **Treat privacy mode as a deployment variable.** Document the re-add procedure; if a group-scoped surface is a requirement, the onboarding flow must include "remove and re-add the bot to the group."
- **Make the fallback graceful.** When the bot cannot see the message, the user sees nothing — so the bot must post an onboarding hint on first contact that names the exact re-add step.
- **Group membership is not authorisation.** Being in the group grants nothing; group-scoped roles come from the directory sync (Pitfalls 11–13), not from presence.

**Warning signs:**

- A Telegram command "works for admins" and "silently does nothing for everyone else" — that is privacy mode plus the fact that admins see everything.
- A handler that reads a permission out of the command payload (e.g. `/grant role=admin`).
- Support conversations about "the bot doesn't hear me in the group" with no platform error.

**Phase to address:** Phase 12 (Telegram Adapter), with the RBAC re-check enforced in Phase 14.

---

### Pitfall 8: Telegram `allowed_updates` must name `chat_member` explicitly, and `update_id` is not monotonic

**What goes wrong:**

Two independent traps in the polling/webhook configuration:

1. **`allowed_updates` defaults to excluding `chat_member`, `message_reaction` and `message_reaction_count`.** If the platform's group-membership sync relies on Telegram's `chat_member` update, it receives **nothing** until `allowed_updates` explicitly names it — and the bot must be an **administrator** of the group for that update to arrive at all. A bot that is not an admin gets no membership events, silently.
2. **`update_id` is not reliably monotonic.** Telegram documents it as increasing sequentially, **but**: *"if there are no new updates for at least a week, then identifier of the next update will be chosen randomly instead of sequentially."* A cursor that assumes strict monotonicity can therefore **regress** — and a regressed cursor causes Telegram to **re-deliver** a window of updates.

There is a third: **`allowed_updates` does not affect updates created before the `setWebhook` call.** Switching the allowed set is not retroactive — the platform will not see membership events that happened during the changeover. And `getUpdates` and webhook mode are **mutually exclusive**.

**Why it happens:**

`allowed_updates` is an argument most people omit because the default "works" for message handling. The `update_id` randomisation after a week of inactivity is a genuinely surprising documented behaviour, and the platform *will* have quiet weeks (a deployment with no traffic, a single-tenant OA in holiday season).

**How to avoid:**

- **Set `allowed_updates` explicitly and centrally** — one constant listing `['message', 'callback_query', 'chat_member', 'my_chat_member']` — and assert it at boot by reading back `getWebhookInfo` and comparing. Assert it in a test too; a config regression here is invisible until a group-leave event fails to arrive.
- **Never use `update_id` as a strict monotonic cursor.** Use it as an **opaque dedupe key** and treat the offset as *advisory*. The dedupe set is what actually protects you.
- **Poll `getWebhookInfo` for `pending_update_count`** as a health signal: a growing backlog means the consumer is behind or wedged.
- **Plan for the changeover gap**: after changing `allowed_updates`, do a **full resync** of group membership rather than relying on events that happened during the window.
- **Assert admin status** in the group's onboarding checklist. If the bot is not an admin, `chat_member` updates do not arrive — and the platform will believe it is synced.

**Warning signs:**

- Group membership sync that works in Slack and Teams but is completely inert on Telegram.
- A `pending_update_count` that grows without bound.
- Duplicate processing bursts that cluster around quiet periods — the `update_id` randomisation after a week of inactivity.
- A support claim "the bot left the group" that no event ever reported.

**Phase to address:** Phase 12 (Telegram Adapter) for the configuration; Phase 14 (Directory & Group RBAC Sync) for the consequences.

---

### Pitfall 9: At-least-once delivery, and Slack's dedupe key is **not** what you think it is

**What goes wrong:**

All four platforms deliver inbound webhooks **at-least-once**. The v1 `InboundEventSchema` is `.strict()` and has **`event_id`** ("Adapter-assigned, unique per delivery attempt chain") but **no `native_event_id`** — the platform's own identifier for the event. Without a native id, dedupe has to be done on a hash of the payload, which is fragile.

The Slack-specific trap is the important one:

- Slack retries a failed delivery up to **3 times** (nearly immediately, **+1 minute**, **+5 minutes**), marking each attempt with `x-slack-retry-num` (`1|2|3`) and `x-slack-retry-reason` (`http_timeout`, `too_many_redirects`, `connection_failed`, `ssl_error`, `http_error`, `unknown_error`). A response carrying `x-slack-no-retry: 1` suppresses further attempts.
- If more than **95% of delivery attempts fail within a 60-minute window**, **Slack disables the event subscriptions** and emails the app owner.
- **Critically: Slack can also deliver the *same message* multiple times with *different* `event_id`s.** This is documented in the `node-slack-sdk` issue tracker (up to 11 deliveries for one message, with **no** `X-Slack-Retry-Num` header present). So `event_id` — the field the v1 contract already has — is **not** a sufficient dedupe key for message events. The stable identity is the **platform message timestamp** (`event_ts` / `ts`).

Telegram redelivers the same update with the same `update_id`, so `update_id` is the natural dedupe key there. Zalo's redelivery carries `num_retry` but the v1 contract has no Zalo-native id either.

**Why it happens:**

Because "the webhook handler is idempotent" is usually solved by keying on the platform event id — and Slack's event id is per **delivery attempt chain**, not per **message**. The two coincide in the retry case (the same event is re-sent) but **not** in the duplicate-send case. The bug only appears in production, under Slack's own load-shedding behaviour, and looks like "the bot replied three times."

**How to avoid:**

- **Extend the contract with `native_event_id`** — the platform's own idempotency key — plus `delivery_attempt` semantics. The v1 `attempt` field is the *platform's* attempt counter; it is **not** a dedupe key and must not be used as one. This is a **D-21-adjacent contract change** and must be landed in Phase 10 with the frozen-key-set discipline applied (see Pitfall 14).
- **Dedupe with a unique index, not an in-memory set.** The consumer inserts `(platform, native_event_id)` with a unique constraint inside the same transaction as the side effect. A `SET NX` in Redis is *not* sufficient on its own: it can expire, and it does not make the side effect atomic with the dedupe record.
- **Slack: key on the message `ts`/`event_ts`, not `event_id`.** Map `event_id` → `native_event_id` for the retry case, and derive a **second** key — `platform:slack:<channel_id>:<ts>` — for the duplicate-send case. Both must be unique-constrained. Retries additionally carry `x-slack-retry-num`; log it (as the allowlisted `attempt`) but do **not** branch on it — a duplicate without the header must be handled identically.
- **Zalo: use the OA's own event identifier** where the payload carries one, and combine it with `num_retry` only as a diagnostic, never as the dedupe key.
- **At-least-once is the default assumption, not an edge case.** Every consumer must be written so that re-running it is safe, and every side effect must be idempotent by construction (upsert, not insert; state-machine transitions keyed on a version, not on "did I see this").

**Warning signs:**

- Duplicate bot replies in Slack with **no** `x-slack-retry-num` header in the access log — the duplicate-send case, not the retry case.
- A dedupe store implemented as a `Set` in memory, or as a Redis key with no TTL rationale.
- `event_id` used as the uniqueness key in a Mongo unique index.
- Idempotency implemented as "check then insert" (a TOCTOU race) rather than "insert and catch the duplicate key."

**Phase to address:** Phase 10 (Contract extensions) for `native_event_id`; Phase 13 (Two-Way Synchronisation) for the dedupe machinery.

---

### Pitfall 10: Two-way sync needs a conversation/thread identity that the v1 model cannot express

**What goes wrong:**

The v1 outbound envelope `OutboundMessageSchema` is `.strict()` and carries `platform`, `channel_id`, `chat_user_id`, `action`, `text`, `queue`, `attempt`, `scheduled_for`. It has **no thread, conversation, reply-to, or tenant field**.

The v1 `ConversationReferenceRepository` is **Teams-shaped**: `{ serviceUrl, conversationId, tenantId, chatUserId, channelId, reference }`, keyed by `static key(channelId, chatUserId) => \`${channelId}::${chatUserId}\``.

Three things break as soon as a second platform arrives:

1. **One binding per (channel, user).** A user talking to the bot in **two different threads** of the same channel has **one** reference — the second overwrites the first, and the bot's reply lands in the wrong thread. The same user in **two DMs** from two channel ids is fine, but the key cannot represent "which thread did this message come from."
2. **A `ConversationReference` is a Teams concept.** Slack uses `channel_id` + `thread_ts` (a string timestamp); Telegram uses `chat_id` + `message_id`; Zalo uses `conversation_id` + a group id. `serviceUrl` / `tenantId` / `conversationId` are Teams vocabulary forced onto three platforms that do not share it.
3. **The `reference` blob is `unknown`.** It holds "the full continuation payload (Teams ConversationReference)". It is **unserialisable in a stable cross-platform sense**, unvalidated, and un-loggable. For the **notification link** flow — where the platform must send a message *to a conversation it did not just receive in* — there is no way to reconstruct the destination.

The end-to-end notification flow (FR-L-5) is exactly the case that breaks: a link is minted, then delivered back to a conversation. Today the only binding is "last channel this user spoke in."

**Why it happens:**

Because the v1 product only needed **Slack → user → form**, one reference per user per channel was sufficient. The two-way requirement (and the notification link bound to `real_user_id` — not to a chat) turns a *convenience* key into a *correctness* key.

**How to avoid:**

- **Make the conversation reference a first-class, platform-neutral record** with a discriminated shape:
  ```
  key          = ${platform}::${conversation_scope_id}::${scope_kind}::${chat_user_id}
  scope_kind   = 'direct' | 'group' | 'thread'
  scope_id     = channel/chat id (+ thread id when scope_kind = 'thread')
  platform_ref = { slack: { channel_id, thread_ts }, teams: { service_url, conversation_id, tenant_id },
                   telegram: { chat_id, message_id }, zalo: { conversation_id, group_id } }
  ```
  The key must be **platform-prefixed** — the v1 key is not, so a Slack channel id and a Telegram chat id that happen to collide would share a record today.
- **Never store an unvalidated `unknown` as a continuation payload.** Validate it per platform with a Zod discriminated union in `packages/contract/`. It is a **contract** concern (the adapter owns the platform vocabulary), not a domain concern.
- **Scope `ConversationReference` to the `notifications` element type** (it already lives there) and extend `ALLOWED_EDGES` only as far as needed. Note that `notifications` currently may import `platform, kernel, contract, submissions, identity, links, dsl` — the new platform-ref shapes belong in **`contract`**, so no new edge is required.
- **The notification link is bound to `real_user_id`, not to a chat.** The D-21 `action: 'notification'` claim has **`target_id` absent** — "the link is bound to the original submitter instead". That means the *delivery destination* must be resolved at send time from `real_user_id` → conversation reference. This makes the reference repository a **required** dependency of the notification path, and its current shape is insufficient (see the three breaks above).
- **Notification link TTL must be bounded independently of the 90-day read-link ceiling.** D-21's `MAX_READ_LINK_TTL_SECONDS` is 90 days, and the claim set is **frozen**. A notification link that lives 90 days in a chat notification list is a stale-link surface. If v2 needs a shorter TTL, that is a **claim-semantics** change on a frozen set — a Phase 10 decision that must be made deliberately, not discovered in Phase 13. See Pitfall 14.

**Warning signs:**

- The bot replies into the wrong Slack thread for one user.
- A notification link that opens the form but the "return to chat" link does nothing.
- `ConversationReferenceRecord.reference` containing a payload that no test asserts against.
- A Slack channel id and a Telegram chat id in the same collection with no platform discriminator.

**Phase to address:** Phase 10 (contract + reference model), consumed by Phase 13 (Two-Way Synchronisation).

---

### Pitfall 11: Group RBAC revocation is a **fan-out** problem, and the v1 cache makes it worse

**What goes wrong:**

The v1 `RbacCacheService` is an **in-process `Map`** keyed `ak:rbac:${app_id}:${real_user_id}:${perm_version}` with a **60-second TTL**. `PermissionCheckService.check(app_id, real_user_id, permission, perm_version = 0)` — the `perm_version` **defaults to 0**.

Three problems compound:

1. **`perm_version` defaults to 0.** Any call path that forgets the epoch is reading the *epoch-zero* cache entry — the one from before any revocation. A new group-scoped permission check that forgets to pass the epoch will silently read a stale-or-empty entry.
2. **The epoch is currently a stub.** `RbacService.hasPermission` returns **`true` for every permission, unconditionally**, and `getRoles` returns `['employee']`. The `perm_version` plumbing is *shape without substance* — the epoch value that keys the cache is not yet derived from anything real.
3. **The cache is per-process.** Under horizontal scaling (AD-9: "application services stateless, all session state in Redis, no sticky sessions"), **each pod has its own cache**. A revocation that bumps the epoch on pod A does **not** evict pod B's cached grant. Revocation is therefore **eventually consistent only if every pod happens to receive the bump** — and with an in-process cache and a 60-second TTL, the window is "up to 60 seconds **per pod, independently, and only for pods that get the bump at all**."

The scale of the fan-out is the real cost: revoking one person's access to one app in one group must invalidate **every app × every group × every pod** cache entry for that user, or the user retains a live grant for up to a minute. Revoking a **group's** access (e.g. the whole team loses leave-request rights) invalidates **every member × every app** entry — potentially thousands of cache keys, times the number of pods, times every app the group touches.

**Why it happens:**

Because "RBAC with a cache" is normally a per-user lookup and the fan-out is invisible until the *group* axis is added. A group role introduces a **second dimension of invalidation** that a `(app, user, epoch)` key does not model.

**How to avoid:**

- **The epoch must be real and authoritative before group roles ship.** `perm_version` must be derived from a persisted, monotonic per-(user, app) — or per-(user, app, group) — permission epoch, not a default. The `= 0` default must be **removed**, not merely bypassed: a required parameter makes the omission a compile error.
- **The cache must be in Redis, not in-process.** v1's AD-9 says all session state is in Redis; the RBAC cache violates that today. Move it to Redis with the epoch in the key, so a bump is visible to every pod immediately.
- **Bump the epoch; don't scan-and-delete.** The epoch-in-key design exists exactly so revocation is a single write. The cache entries become unreachable by construction rather than by deletion. This is the right shape and it is already there — it just needs a real epoch and a real store.
- **Define the fan-out unit explicitly.** Two candidate semantics, and the choice must be made before implementation:
  - *per-user epoch* — bumping invalidates that user's entries across all apps; simple, and the blast radius is one user.
  - *per-(user, app) epoch* — finer, but a group-scoped revocation must bump **N** epochs (one per member), which is a **write amplification** problem: revoking a 500-person group's rights is 500 writes (batched, but still).
  - Prefer **per-user epoch with a group-membership epoch folded in**: the user's epoch is a composite of their identity epoch and the max epoch of the groups they are in. One write invalidates everything for that user, and a group revocation bumps **one** group epoch that **all members' composite epochs inherit**.
- **Never rely on cache expiry for revocation.** The 60-second TTL is a *performance* bound, not a *security* bound. A revocation that only takes effect when a TTL expires is a finding, not a rollout.
- **Never cache a "granted" answer across a revocation without an epoch.** If the epoch is missing or stale, deny.

**Warning signs:**

- A user who was removed from a group still has access for "a little while" — the tell is that the window varies by pod.
- `PermissionCheckService.check` called without a `perm_version` argument anywhere in the new code (grep for `check(` with 3 args).
- `RbacCacheService` still holding a `Map` after group roles ship.
- A revocation that required "restarting the pods" to take effect — always a bug, never a deployment note.

**Phase to address:** Phase 14 (Directory & Group RBAC Sync) — but the **real epoch and the Redis move are Phase 10/13 prerequisites**, because group RBAC cannot be correct on top of the current stub.

---

### Pitfall 12: Directory sync has three different failure vocabularies, and one platform has no member source at all

**What goes wrong:**

Each directory source fails in its own way, and a single sync engine that assumes one shape will corrupt data on all three.

**Slack — read-only, and it is a mirror, not a control surface.**
`usergroups.list` needs the `usergroups:read` scope (**Tier 2, ~20 requests/min**) and `include_users=true` to expand members. `usergroups:write` exists, but Slack only permits a bot token to use it when the workspace setting is `"everyone"`, and **`usergroups.users.update` replaces the entire member list** and **cannot remove all members** (an empty list is rejected). Creating a usergroup needs `admin.usergroups.create`, which is **Enterprise Grid only**. Usergroups also require a **Standard-or-above plan** (otherwise `plan_upgrade`). The usable incremental events are read-scope: `subteam_created`, `subteam_members_changed`, `subteam_self_added`, `subteam_self_removed`, `subteam_updated`.
→ **Slack group membership is an inbound source of truth. Never write it back.** Attempting to write is both mostly impossible and, where possible, destructive (full-list replace).

**Microsoft Graph — delta tokens expire in 7 days, and two different errors mean "resync from scratch."**
Directory delta tokens are valid for **7 days** (reduced from 30 in 2020). When one expires the next request fails with **HTTP 400 and error code `syncStateNotFound`** ("The delta token is expired and data must be synchronized again"). Separately, **HTTP 410 Gone** whose `Location` header carries an **empty `$deltatoken`** signals a tenant reset/maintenance — also a full resync. Neither is a transient error; both are "your cursor is gone."
On top of that: **`members@delta` does not detect members removed by the deletion of the member object**, so stale membership accumulates silently. A narrow **`$select` silently suppresses changes to unselected properties**. `$expand`, `$top` and `$orderby` are unsupported on delta queries. Scoping filters accept at most **50 ids**. The required role is `microsoft.directory/groups/members/read` (Directory Readers, Group Administrator).
→ **Treat `syncStateNotFound` and `410 + empty $deltatoken` as one terminal state: discard the cursor and do a full resync.** They are not retryable.

**Zalo — the permission scope is the gate, and the page size is 5.**
`GET https://openapi.zalo.me/v3.0/oa/group/listmember?group_id=…&offset=0&count=5` (header `access_token`) **does** exist and returns `data.{offset,count,total,member_count}` and `members[]` with `oa_id`, `name`, `avatar`, `user_id`. Three constraints: (a) the app must be granted the **"quản lý thông tin nhóm"** (group-management) permission scope, which an OA admin applies in the Zalo portal — **not granted by default**; (b) the **default `count` is 5**, so full enumeration requires explicit paging; (c) the OA can only enumerate groups **it manages**. A sibling endpoint (`listpendingmember`) returns members **still pending approval** — the two lists must not be conflated, or pending members silently become active members.
→ Zalo group RBAC is possible but **permission-gated and pagination-heavy**, and it is not a general "enumerate any group" API.

**Why it happens:**

Because all three are usually assumed to be "a list of members" and each is something else: a **mirror** (Slack), a **cursor-based delta with two terminal states and a blind spot** (Graph), and a **scoped, paged, permission-gated enumeration** (Zalo). A unified abstraction that flattens these differences will hide the one behaviour that matters per platform.

**How to avoid:**

- **Model the three sources explicitly** in one `DirectorySource` interface with per-platform semantics visible in the type:
  ```
  interface DirectorySource {
    readMembers(scope): AsyncIterable<MemberPage>          // paged, resumable
    pollCursor?(): Cursor | null                            // Graph only
    writeMembers?(...): never                              // Slack: absent by construction
    capabilities: { canWrite, eventDriven, cursorExpiryDays }
  }
  ```
  Make "this source cannot be written to" a **type-level fact**, not a runtime check.
- **A `syncStateNotFound` / `410`-with-empty-`$deltatoken` handler that discards the cursor and restarts a full resync**, with a bounded rate, and a *distinguishing* log reason. Retrying the expired token is an infinite loop; treating it as transient will hammer Graph.
- **Never `$select` narrowly on a delta query** unless you are certain the unselected properties are irrelevant — the suppression is **silent**, and you will discover it as "the sync says nothing changed" months later. Prefer `$select` on the *initial* resync only.
- **Compensate for the `members@delta` blind spot**: periodically (not only on delta) reconcile group membership with a full member read for groups that are security-relevant, or accept and document the stale-membership window.
- **Respect Graph throttling**: the app+tenant limit is **3,500 / 5,000 / 8,000 ResourceUnits per 10 s** by tenant size, and the app limit is **150,000 per 20 s**; responses are **429 with `Retry-After`**. Group list page size defaults to **100**, caps at **999**; `transitiveMembers` and `members@delta` can require multi-page merge, and **groups can reappear anywhere in the `@odata.nextLink` sequence** — so the merge must be order-independent.
- **Slack: enumerate `usergroups.list` with `include_users=true`, and reconcile with the `subteam_*` events.** Do not write. Handle `plan_upgrade` and `missing_scope` as *configuration* errors surfaced to the admin, not as silent empty results — an empty usergroup list and an unauthorised one look identical otherwise.
- **Zalo: page with an explicit `count` well above 5**, request the group-management scope during onboarding, and keep pending-member and active-member lists separate.**
- **Every source must be able to say "I could not read this" distinctly from "there is nothing here."** A failed read that yields an empty set is the most dangerous possible outcome in an RBAC system: it revokes everyone, or, if merged rather than replaced, grants everyone.

**Warning signs:**

- A sync that "succeeds" with zero members after a Graph token expiry.
- Slack usergroups that the platform can read but not write to, with a `plan_upgrade` error swallowed.
- Zalo group member lists that always contain exactly 5 members.
- A pending Zalo member who suddenly has production access.
- Graph 429s handled by a fixed sleep rather than `Retry-After`.

**Phase to address:** Phase 14 (Directory & Group RBAC Sync).

---

### Pitfall 13: An open-ended AI guard that can *act* — the model must never be able to invoke a tool

**What goes wrong:**

"Permission-first open-ended AI" is the most dangerous feature in the v2 scope, because it replaces a **closed** decision (pick one of N enumerated, permission-filtered tools) with an **open** one. The failure mode is not "the model picks the wrong tool." It is **"the model calls something it was never granted."**

The v1 `RoutingOrchestrator` is *structurally* safe: the provider receives `tools: ToolDescriptor[]` (D-23) and returns a `choice`; the orchestrator then checks the choice against the **platform-side** `permitted` set. The model cannot widen that set — it can only propose, and a proposal outside `permitted` is rejected.

An open-ended guard breaks that if it is implemented as "let the model decide and call the tool." Then:

- the model can propose a **tool the user is not permitted to use**, and if the guard trusts the proposal, the action happens;
- the model can be **prompt-injected** through user text, a form submission, a document fetched by a connector, or a chat message — every one of which is attacker-influenced content;
- the model can **loop** (call a tool, read the result, call another tool) and burn budget unboundedly;
- the model can **exfiltrate** — a connector tool that writes to an external system becomes an exfiltration channel if the model can choose its arguments.

**Second trap — LLM "confidence" is a soft number and it is already load-bearing.**

The v1 orchestrator's gate is:
```
result.choice.verified === true
  && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
  && Number.isFinite(gate) && gate >= 0 && gate <= 1
  && confidence >= gate
  && !alternatives.some(alt => permitted.has(alt.tool_id))
  && await canOpenNow(id)
  && Date.now() < deadlineEpochMs
```
The `confidence` field comes from the **model**. It is a **self-reported**, uncalibrated number with no units — the same `0.9` from two different providers, or from the same provider before and after a prompt change, means nothing comparable. **Using it as a security threshold is a category error**: it is a *ranking* signal, not a *permission* signal.

The v1 code gets this right by construction: the confidence gate is a **quality** gate layered *under* an authoritative permission check. An open-ended guard that reuses "confidence" as the *permission* signal inherits the category error at a much higher stakes.

**Third trap — the fallback chain is a permission surface.** If the primary provider times out and the guard falls back to a **weaker** provider (or to a heuristic, or to "guess the most likely tool"), the fallback must not be *more permissive* than the primary. A fallback that returns a tool without the `verified === true` check is a bypass.

**Fourth trap — tool-count bounds.** D-23's `tools: ToolDescriptor[]` is a **list the platform sends to the model**. As the tool catalogue grows (more apps, more connectors, more group-scoped actions), the prompt grows, the latency grows, the cost grows, and the model's selection accuracy **degrades**. There is no bound on `tools.length` in the contract today.

**Why it happens:**

Because "open-ended" and "permission-first" are in tension, and the natural implementation resolves the tension in the model's favour. The v1 architecture already contains the correct pattern (a **closed** enumeration plus a **platform-side** gate); extending it to an open-ended surface tempts a redesign that loses the gate.

**How to avoid:**

- **The model proposes; the platform disposes.** Keep the v1 shape exactly: the guard returns a **proposal** (`tool_id`, `arguments`, `confidence`), and a **platform-side** gate decides whether it may proceed. The gate is code, not prompt, and it is not negotiable by the model.
- **The permitted set is computed before the model is called** and is intersected with the model's proposal — exactly as the v1 orchestrator does with `permitted`. Never let the model's output *define* the candidate set.
- **Structural, not instructional, tool prohibition.** If the open-ended guard must be able to call tools at all, the tool invocation must go through the **same** `canOpenNow` / `PermissionCheckService.check` path, with the `perm_version` epoch evaluated **at execution time**, not at proposal time. A model that proposes a tool and a user whose permission was revoked 200 ms ago must be denied.
- **Treat all model-visible content as untrusted.** User chat text, form field values, connector responses, and document contents are inputs to be escaped and schema-validated, never concatenated into a system instruction. Structured outputs (a strict JSON schema for the proposal) rather than free text.
- **`temperature = 0`** and a **fixed seed** where the provider supports one — for reproducibility of a decision that will be audited, not for determinism of the prose. Note that temperature 0 does **not** make a provider deterministic; the audit story must not rest on it.
- **Bound the tool count.** Cap `tools.length` in the D-23 request (a concrete number, chosen after measuring accuracy-vs-catalogue-size on the v1 fixture set) and **rank/filter** the catalogue to the permitted set before sending. If the permitted set exceeds the cap, the guard must **narrow** it by relevance, not truncate arbitrarily — a truncated catalogue silently removes capabilities.
- **Bound the loop.** A hard cap on tool-call rounds per request (the v1 orchestrator already has an **absolute deadline epoch** — `deadlineEpochMs` — and a per-attempt budget derived from it: `min(remaining, providerCap)`). Extend that, don't replace it: one absolute epoch for the whole request, per-provider caps inside it.
- **The fallback chain must be monotonically *less* capable and identically *constrained*.** Every fallback goes through the same gate, with the same permitted set, and must require `verified === true` or it must return "clarify". A fallback that answers directly on a timeout is a bypass.
- **Cost is a security property.** Per-provider budget, per-request budget, and a global daily budget — plus a **circuit breaker** that opens to "clarify" rather than to "guess".
- **Reuse the existing clarification outcome.** `state.force_clarification` and the `clarify` result already exist in the v1 orchestrator. An open-ended guard that is unsure should **return `clarify`**, not pick the top-ranked tool. Every "we were not sure" path in v1 is already shaped; reuse it.
- **Audit what the guard decided, not what the model said.** Log the proposal, the permitted set size, the gate outcome (closed enum), and the confidence **as a number** — all within the D-16 allowlist (`action`, `status`, `reason`, `decision`, `provider`, `duration_ms` are allowlisted; `confidence` is **not**, and adding it needs the D-16 written justification).

**Warning signs:**

- Any code path where a tool is invoked with arguments that came straight from a model response, without a platform-side check.
- A "confidence" value compared against a threshold that is described in a prompt or a config as a *security* control.
- A fallback provider that does not implement the same `verified` semantics as the primary.
- `tools.length` in a request exceeding a few dozen, and no ranking step.
- A guard that, on provider error, returns *something* rather than `clarify`.
- A retry loop around the provider with no absolute deadline.

**Phase to address:** Phase 15 (Permission-First Open-Ended AI Guard).

---

### Pitfall 14: The v2 features collide with two **frozen** contracts (D-21 read-link claims, D-23 JEV request) and with the D-16/D-18 allowlists

**What goes wrong:**

Four frozen or closed surfaces sit exactly where v2 needs to change, and each change has a blast radius that is invisible until deploy.

| Frozen surface | What it is | What v2 wants | Blast radius of a careless edit |
|---|---|---|---|
| **D-21 `ReadLinkClaimsSchema`** | The read-link JWT claim set. `.strict()`. `READ_LINK_CLAIMS_VERSION = '1.0'`. `MAX_READ_LINK_TTL_SECONDS = 90 days`. Actions: `create, edit, view, query, notification, draft` (`draft` reserved, never emitted). `notification` has **`target_id` absent**. | A notification link with a **shorter TTL**; possibly a claim identifying the destination conversation. | **Every read link already in a user's clipboard breaks silently** — a `400` on links issued months earlier, with no error at issuance time. A `notification`-bound-to-conversation claim would also change what `notification` means, which changes D-21's semantics. |
| **D-23 JEV request** | `tools: ToolDescriptor[]`, `state.force_clarification`, `spec_version: '1.0'`. | An **open-ended** guard; a **bounded** tool catalogue; possibly a new request field. | Changing `spec_version` **invalidates every provider** that was built against `1.0`. A provider that returns a decision for a request shape it does not recognise may route to an unintended tool. |
| **D-16 `LOG_FIELD_ALLOWLIST`** | The closed field set of every structured log line. `chat_user_id`, `group_id`, `chat_id`, `telegram_user_id`, `zalo_user_id`, `group_name`, `channel_title` are **not** on it. | Group and member identifiers in logs and audit. | **Silently dropped.** A log line that "should" have `group_id` has no `group_id` — with no error. Diagnosing a group RBAC incident becomes impossible. |
| **D-18 `SPAN_ATTRIBUTE_ALLOWLIST` + `FORBIDDEN_SPAN_ATTRIBUTES`** | The closed attribute surface of every exported span. `submission_id`, `actor_ref`, `user_email`, `email` are **forbidden**. | Trace continuity across the new hops. | Adding a forbidden attribute is a **spec failure**, not a lint warning — the fixture test asserts the forbidden list. |

**Why it happens:**

Because each of these was frozen **specifically to make later changes loud**, and v2 is exactly the "later" they were frozen for. The friction is the control (both files say so explicitly): *"Adding a field requires a written justification in the same commit; that friction is the control."* The failure mode is a developer hitting the friction, feeling it as an obstacle, and routing around it — by logging the field under a name already on the allowlist, by hashing it, or by putting it in a `reason` string.

**How to avoid:**

- **Decide the D-21 and D-23 questions in Phase 10, in writing, before any adapter ships.** They are *design decisions*, not implementation details:
  - **D-21 notification TTL.** The `MAX_READ_LINK_TTL_SECONDS` ceiling is a **maximum**, enforced by `.refine()` on `exp - iat`. A **shorter** notification TTL is **already expressible** — it is a per-link issuance decision, not a schema change. **Use that.** Do not add a claim, do not change the schema, do not touch `READ_LINK_CLAIMS_VERSION`. If a *hard* cap on notification TTL is wanted, it belongs in the **issuer**, not in the contract.
  - **D-21 notification destination.** `target_id` is absent for `notification` **by design** — "the link is bound to the original submitter instead." That is exactly the right model for a chat notification: the link identifies the **recipient**, and the **destination conversation** is resolved at delivery time from the conversation reference. **Do not add a claim.** Add a `conversation` lookup to the delivery path (Pitfall 10) instead.
  - **D-23 tool catalogue bound.** If a bound is needed, add it as a **provider-side or platform-side precondition** (reject a request whose `tools.length` exceeds the cap, with a typed error) rather than as a schema change. `spec_version` stays `1.0` unless the **wire format** actually changes.
- **For D-16/D-18, the correct move is to widen the allowlist — with the written justification, in the same commit.** The allowlist is the control; bypassing it destroys the control. Concretely: propose `group_id` and a *platform-scoped* member identifier as new allowlisted fields, with the justification "the group id is an opaque platform-scoped identifier, not a name, an email, or a handle" — mirroring the existing reasoning for `app_id`/`form_id`. **Never** put a group id in `reason` (a free-text field) to dodge the allowlist — that is worse than no logging, because it looks like logging.
- **Do not put group/member identifiers in spans unless they are opaque and platform-scoped.** The D-18 file's own reasoning (traces have no erasure path) applies with full force to group membership: a trace attribute that names a group **and** a user is a correlatable activity map. Prefer `group_id` (opaque) with **no** user identifier in the same span.
- **Add the frozen-set assertions to the new features' test suites.** The v1 discipline (a mechanical key-set assertion, because "a comment cannot stop a schema edit") must be extended to every new consumer of the claim set.

**Warning signs:**

- A commit that adds a field to `LOG_FIELD_ALLOWLIST` with the message "needed for debugging" and no justification.
- A log line where `group_id` is expected and absent — no error, just a gap.
- A span attribute named `telegram_user_id` or `zalo_user_id`.
- `READ_LINK_CLAIMS_VERSION` bumped to `'1.1'` in a feature commit.
- `spec_version` bumped as part of an adapter change.
- A `reason` field containing something that looks like an identifier.

**Phase to address:** Phase 10 (v2 Foundations) — this is the **highest-leverage phase in the whole roadmap**, because every later phase inherits its decisions.

---

### Pitfall 15: The boundary lint will fail the build on any new package, and the failure mode is "looks fine, is inert"

**What goes wrong:**

`tooling/boundaries.config.mjs` is the single source of truth for the modular-monolith boundary graph, and it has **four** properties that bite new v2 code:

1. **`default: 'disallow'`.** An edge not listed is a **build failure**, not a convention. A new package — a Zalo client, a directory-sync module, a Telegram adapter — has **no** element type until one is declared.
2. **The `domain` root is deliberately NOT an element type.** `DOMAIN_ELEMENT_TYPES` enumerates 15 subdirectories explicitly. A new `packages/domain/src/directory/` is an **explicit config change**, not an automatic inheritance.
3. **Policies are last-match-wins, and `checkAllOrigins: true` is required.** Without `checkAllOrigins`, R2 and R3 evaluate **nothing** for `jose`/`mongodb` imports (they resolve to `node_modules`, so `isLocalDependency` is false) — the tree looks byte-identical to a compliant one while the rules are dead. The config file documents this in detail; **do not remove the flag**.
4. **`partialMatch: false` on every element descriptor.** With the default `true`, a pattern like `packages/platform/src/**` also suffix-matches `apps/api/src/platform/**`, silently promoting an app-local directory to the `platform` element type.

And the file-category rules that v2 will hit:

- **R1 entrypoint exclusivity** — only `apps/api` may import `inbound-adapter` or `http` categories; only `apps/worker` may import `outbound-adapter` or `bullmq-worker`; only `apps/scheduler` may import `scheduler-job`. **A Worker or a controller in the wrong process breaks the <200 ms ack budget** (the rule's own message).
- **R2 secret containment** — only `packages/platform/src/crypto/**` and `packages/domain/src/connectors/**` may reach `jose` / `@aws-sdk/client-kms` / `@google-cloud/kms`. **Per-tenant IM credentials (Zalo OA Secret Key, Telegram bot token, Graph client secret) are exactly what R2 exists to contain.**
- **R3 no direct Mongo** — only `packages/platform/src/mongo/**` and `packages/domain/src/**/data-access/**` may import `mongodb`.

The category patterns are also fixed: `inbound-adapter` is `packages/domain/src/adapters/**/inbound/**` and `outbound-adapter` is `packages/domain/src/adapters/**/outbound/**`. **A new adapter that does not live under `packages/domain/src/adapters/<platform>/{inbound,outbound}/` is not categorised at all** — so R1 will not fire for it, and it may quietly end up in the wrong process.

**Why it happens:**

Because v2 adds **two whole adapters plus a directory-sync module**, and the boundary model is deliberately explicit — every new placement is a decision the config file must record. The natural mistake is to create `packages/domain/src/adapters/zalo/` (one directory, mixed inbound/outbound) because that is what the existing Slack adapter looks like, and to discover that R1's `inbound-adapter` / `outbound-adapter` categories no longer match.

**How to avoid:**

- **Place every new adapter as `packages/domain/src/adapters/<platform>/inbound/**` and `.../outbound/**`** from the first commit. Check the *existing* Slack/Teams layout before copying it — if v1's Slack adapter does not follow the category pattern, that is a v1 inconsistency to fix, not a precedent to follow.
- **Declare every new domain subdirectory in `DOMAIN_ELEMENT_TYPES`** (e.g. `directory`) **and** add its edges to `ALLOWED_EDGES` in the same commit. The `domain` root is not an element type, so omitting this is a **build failure**, not a silent inheritance.
- **Put per-tenant IM secrets behind R2's owners.** The IM credentials must live in the `connectors` element (which is a `connector-owner` category) or in `packages/platform/src/crypto/**`. A Zalo client that reads its OA Secret Key from a plain config map violates R2 **and** NFR-SEC-3.
- **Keep the `app-worker` out of the inbound path.** Inbound adapters are `apps/api`-only (R1). The receiver enqueues; the **worker** consumes. The Slack controller being a placeholder (`return { ok: true }`) is fine *as a placeholder* — it becomes a violation the moment a Zalo/Telegram receiver is written into the worker.
- **Do not weaken `checkAllOrigins: true`, do not relax `default: 'disallow'`, do not remove `partialMatch: false`.** Each is load-bearing and each has a documented failure mode that is **silent** (the rules simply stop firing).
- **Run the boundary fixture test** (`boundaries.fixture.spec.ts`) in the same commit as any boundaries-config change. The config file says the fixture re-uses the frozen objects verbatim, so a mutation makes the lint gate and the test disagree.

**Warning signs:**

- A new package created without a corresponding `DOMAIN_ELEMENT_TYPES` entry — the build fails at the lint step with a generic default-deny message that says nothing about the missing declaration.
- A Zalo/Telegram client placed at `packages/domain/src/adapters/zalo/client.ts` (not under `inbound/` or `outbound/`) — **uncategorised, so R1 does not apply**.
- A `default: 'allow'` or a `checkAllOrigins` removal in a diff — review must reject it.
- A secret read from `process.env` inside an adapter — R2's owners are the only ones allowed to touch the KMS surface, and NFR-SEC-3 forbids plaintext env secrets.

**Phase to address:** Phase 10 (v2 Foundations) — the boundary graph must be extended **before** the adapters land, or Phase 11 starts by fighting the linter.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems. The "v1 reality" column is what is in the repo **today**; the v2 feature that forces the issue is named.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|---|---|---|---|
| **Keep `RbacService.hasPermission` returning `true`** and add group logic elsewhere | No migration; the v1 flow keeps working | Group RBAC is unenforceable — the authoriser is a no-op and every downstream check is theatre. The stub is exactly where a reviewer will look and will be blamed for every incident. | **Never** for group-scoped permissions. It must be replaced with a real implementation before Phase 14 ships. |
| **Keep the RBAC cache as an in-process `Map`** | Fast; no network hop | Breaks horizontal scaling (AD-9) and makes revocation per-pod and non-deterministic. Phase 14's fan-out becomes un-diagnosable. | **Only** while there is exactly one replica and no group roles. |
| **Keep `perm_version = 0` as a default parameter** | Existing call sites keep compiling | A missing epoch silently reads epoch-zero state. The default is the mechanism by which a revocation is bypassed. | **Never.** Make it required; the compile error is the point. |
| **Dedupe with an in-memory `Set` or a `SET NX` with a TTL** | No schema change; fast to ship | A `Set` dies with the pod. A Redis key expires and lets a duplicate through. Neither makes the side effect atomic with the dedupe record. | **Never** for anything with a side effect. Use a unique index. |
| **Key Slack dedupe on `event_id`** | The field already exists in `InboundEventSchema` | Slack delivers the same message with **different** `event_id`s. Duplicate bot replies in production. | **Never** for Slack message events. |
| **Hash the payload to derive a dedupe key** instead of a native id | No contract change | Brittle: any field reorder, timestamp drift, or vendor-added field changes the hash. | Only as a **secondary** guard, never as the primary key. |
| **Keep `ConversationReferenceRecord.reference` as `unknown`** | No schema to maintain | Unvalidated, un-loggable, un-portable. It is the payload that decides *where a reply goes*. | **Never** once two-way sync ships. |
| **Keep the conversation-reference key un-prefixed** (`${channelId}::${chatUserId}`) | Backwards-compatible with v1 records | A Slack channel id and a Telegram chat id can collide into one record. | **Never** with two platforms. Migrate the v1 records. |
| **Log a new identifier under an existing allowlisted name** (e.g. pack `group_id` into `reason`) | No allowlist change, no D-16 justification | The data is unstructured, unqueryable, and the *bypass* is invisible — the audit trail looks compliant and is not. It also puts an identifier into a free-text field, which is the exact thing the allowlist exists to prevent. | **Never.** Widen the allowlist with the written justification. |
| **Hand-roll the Zalo OA client over `undici` and keep it in an adapter directory** | No unmaintainable third-party dependency | Undocumented API surface with no changelog; the hand-rolled client is an *ongoing* maintenance liability, not a one-time cost. | **Acceptable** — it is the best available option — but it must live in **one** module with a recorded test vector, not spread across call sites. |
| **Use the `formiojs` 4.x / `@formio/js` 5.x renderer as-is for a Telegram inline keyboard** | Fast | FormIO is a **web** renderer. A Telegram inline keyboard is not a form. Do not try to render a FormIO form in a chat message; the constraint is a UX decision, not an engineering one. | **Never.** The chat surface is a link, by design. |
| **Fan out a group revocation by deleting cache keys per member** | "Explicit" | Write amplification (N members × M apps), a race with in-flight reads, and partial failure leaves a **partial revocation**. | **Never.** Bump a group epoch; let members inherit it. |
| **Treat a Graph `syncStateNotFound` as a transient 4xx and retry** | Simple retry loop | Retries forever against a dead cursor, hammering Graph and burning the throttle budget. | **Never.** It is a terminal state: discard the cursor, full resync. |
| **Read Zalo group members with the default `count=5`** | One request | Silently truncates membership to the first 5 — **and looks successful**. | **Never.** Page explicitly. |
| **Use the model-reported `confidence` as a permission signal** | One number, easy to threshold | Uncalibrated self-report used as a security control. A prompt-injected or merely unlucky response flips a gate. | **Never.** Confidence is a *ranking* signal; permission comes from the platform-side gate. |
| **Let the open-ended guard fall back to "guess the most likely tool" on provider failure** | Better UX than an error | A bypass: the fallback path is less constrained than the primary path. | **Never.** Fall back to `clarify`. |
| **Add a new `packages/domain/src/<thing>/` without touching `DOMAIN_ELEMENT_TYPES`** | Fast | The lint gate fails with a generic message (annoying) or, worse, a `partialMatch` accident promotes it to the wrong element type (silent). | **Never.** Declare it in the same commit. |
| **Put the Slack/Telegram/Zalo receiver in `apps/worker`** | The worker already has the queue | Breaks the **<200 ms ack** contract — R1 says so. | **Never.** Receivers are `apps/api`-only. |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|---|---|---|
| **Zalo OA webhook** | Implementing HMAC-SHA256 because a tutorial said so | `sha256(app_id ‖ rawBody ‖ timeStamp ‖ oaSecretKey)`, hex, `timingSafeEqual`. One module. Frozen test vector. |
| **Zalo OA webhook** | Hashing `JSON.stringify(parsedBody)` | Hash the **raw bytes**. NestJS `rawBody: true` / `@RawBody()`. Any re-serialisation breaks the digest. |
| **Zalo OA webhook** | Using the **App** Secret Key | The **OA Secret Key**. Two different portal values. |
| **Zalo OA webhook** | Doing a DB read or a KMS decrypt before responding | Ack in <2 s. Verify → validate shape → enqueue → 200. Warm the credential cache. |
| **Zalo OA webhook** | Returning 4xx/5xx for a business-level rejection | Always 200 after logging. A non-200 burns one of five retry stages. |
| **Zalo OA webhook** | Assuming a failed delivery is visible somewhere | It is not. Zalo disables the webhook silently; re-enrolment is a **manual portal action**. Ship an event-freshness probe. |
| **Zalo OA OAuth** | Refreshing from more than one worker | Single-flight under a Redis lock. Rotation is **single-use**; the loser re-reads the stored token. |
| **Zalo OA OAuth** | Treating the refresh token like a renewable credential | It is a **crown jewel**: 90 days, single-use, and losing it needs a **human** in the Zalo portal. Persist it encrypted, alert on refresh failure. |
| **Zalo OA API** | Calling from a non-Vietnam egress and treating an empty user profile as "unknown user" | A VN egress is a **deployment requirement**. Detect the empty profile and raise a typed error (`ZALO_PROFILE_EMPTY_OUTSIDE_VN`). |
| **Zalo OA API** | Registering production egress IPs ad hoc | Register every egress IP in the Zalo portal; keep the list in the deployment runbook. Error `-7` = unregistered IP. |
| **Zalo ids** | `z.coerce.number()` on `user_id` / `app_id` | Ids are **19-digit** — beyond `Number.MAX_SAFE_INTEGER`. Keep them as `z.string()`; `BigInt(v).toString()` if a number arrives. `JSON.parse` rounds them **silently**. |
| **Zalo group members** | Calling `listmember` without the group-management scope | The scope is an admin grant in the Zalo portal. Missing it returns an error that must be surfaced, not swallowed. |
| **Zalo group members** | Using the default `count=5` | Page explicitly with a larger `count`; the default silently truncates. |
| **Zalo group members** | Merging `listmember` with `listpendingmember` | Pending members are **not** active members. Two lists, two roles. |
| **Telegram** | Packing a form id / role name into `callback_data` | An opaque handle only. `callback_data` is **1–64 bytes** (UTF-8); exceeding it fails the whole `sendMessage` with `BUTTON_DATA_INVALID`. |
| **Telegram** | Forgetting `answerCallbackQuery` | The spinner hangs 10–30 s, then "took too long". Call it **first**, in a `finally`, before any slow work. |
| **Telegram** | Treating the command as authorisation | Telegram states the scope is not in the update. **Re-validate permission on every command**, with `perm_version`, at execution time. |
| **Telegram** | Assuming the bot sees group messages | Privacy mode is on by default. Disabling it requires **removing and re-adding** the bot. Admins always see everything — which makes the gap easy to miss in testing. |
| **Telegram** | Omitting `allowed_updates` | The default excludes `chat_member` (and reactions). Set it explicitly and **assert it at boot** via `getWebhookInfo`. |
| **Telegram** | Using `update_id` as a strict monotonic cursor | It is **randomised** after a week of inactivity. Use it as an opaque dedupe key only. |
| **Telegram** | Running `getUpdates` alongside a webhook | Mutually exclusive. One mode. |
| **Telegram** | Expecting `chat_member` without being a group admin | The bot must be an **administrator**. Assert it in onboarding. |
| **Slack** | Writing back to `usergroups` | Read-only in practice: `usergroups:write` needs workspace permission, the call **replaces** the whole member list and **cannot empty it**, and creation needs Enterprise Grid. Slack membership is a **mirror**. |
| **Slack** | Treating an empty usergroup list as "no members" | `plan_upgrade` and `missing_scope` look identical to empty. Distinguish "could not read" from "nothing there". |
| **Slack** | Dedupe on `event_id` | Slack can re-send the same message with **different** `event_id`s. Key on the message `ts` as well. |
| **Slack** | Assuming Slack always retries | Retries are 3 attempts (~immediately, +1 m, +5 m) with `x-slack-retry-num`/`x-slack-retry-reason`; **duplicate sends without those headers also occur**. Handle both identically. |
| **Slack** | Ignoring the 95% failure window | >95% failed deliveries in 60 minutes **disables the event subscriptions** and emails the app owner. Monitor the delivery success ratio, not just uptime. |
| **Microsoft Graph** | Retrying a `syncStateNotFound` delta token | It is expired. **Discard the cursor, full resync** (HTTP 400 + `syncStateNotFound`). |
| **Microsoft Graph** | Treating `410 Gone` as transient | A `410` whose `Location` carries an **empty `$deltatoken`** means tenant reset — **full resync**. |
| **Microsoft Graph** | Using a narrow `$select` on a delta query | Changes to unselected properties are **silently suppressed**. Use `$select` on the initial resync only. |
| **Microsoft Graph** | Relying on `members@delta` to detect removals | It **does not** detect members removed by deletion of the member object. Stale membership accumulates. Reconcile periodically. |
| **Microsoft Graph** | Sleeping a fixed amount on 429 | Honour **`Retry-After`**. Limits: 3,500/5,000/8,000 ResourceUnits per 10 s (by tenant size) and 150,000 per 20 s per app. |
| **Microsoft Graph** | Merging pages in sequence order | Groups can reappear **anywhere** in the `@odata.nextLink` sequence. The merge must be **order-independent**. |
| **All platforms** | Assuming the webhook fires once | **At-least-once** everywhere. Unique-index dedupe; idempotent side effects by construction. |
| **All platforms** | Doing real work in the receiver | The ack budget is 2 s (Zalo) / 3 s (Slack). Receiver = verify → validate → enqueue → 200. Everything else is in the consumer. |
| **All platforms** | Trusting `process.env` for per-tenant IM credentials | R2 confines the KMS/signing surface to `crypto/**` and `connectors/**`. Plaintext env secrets violate R2 and NFR-SEC-3. |
| **All platforms** | Widening the log/span allowlists informally | D-16/D-18 friction **is** the control. Widen it deliberately, with the written justification, in the same commit. |

---

## Performance Traps

Scale anchors: the v1 NFR target is **1,000 concurrent users** and the v2 target is **group-scoped** access for organisations of tens to low hundreds of people (up to ~200 apps × ~20 forms per NFR-S-6/S-7). Nothing below requires over-engineering — each trap is about a *specific* threshold.

| Trap | Symptoms | Prevention | When It Breaks |
|---|---|---|---|
| **The Slack webhook controller is still a placeholder** (`return { ok: true }`) | Any "Slack works in staging" claim is unfounded — nothing is verified, nothing is enqueued | Implement the real receiver (raw body → HMAC verify → envelope → enqueue) as the first task of Phase 10/11, not as a follow-up | Immediately. This is the **highest-value** defect to fix, because every later Slack-phase verification depends on it. |
| **In-process RBAC cache + group fan-out** | Revocation takes effect per pod, at a random moment within the TTL | Redis-backed cache, epoch in the key, composite (user + group) epoch | As soon as the deployment has **2+ replicas** — which AD-9 requires |
| **Redis round-trips per request** (throttler tiers + session + cache) | p99 latency climbs linearly with the number of Redis hops | Pipeline where possible; keep the number of per-request hops constant and **measured** | Around **100 req/s** sustained per pod, once throttler tiers are stacked |
| **3 named throttlers = 3 Redis calls per request** | Latency triples; the rate limiter becomes the bottleneck | One `ThrottlerStorage` implementation that **pipelines** the three keys in one round-trip; or one composite key | Measurable from the first load test — the v1 stack already flagged this as unmeasured |
| **Graph `transitiveMembers` expansion per group** | Sync takes hours; the 429 budget is exhausted | Cache membership; use `members@delta`; **never** expand transitively for every group on every cycle | **~50 groups** in one tenant, with a naive per-group transitive expansion |
| **Graph delta resync every 7 days (token expiry)** | A periodic load spike every week that competes with interactive traffic | Make the full resync **incremental and resumable**; throttle it below the interactive budget; run it in the scheduler, not the API | The **first** expiry — ~7 days after go-live |
| **Zalo `listmember` with `count=5`** | A 500-member group takes 100 sequential requests; the sync never completes | Explicit paging with a larger `count`, concurrent within the rate budget | Any group over ~50 members |
| **Slack `usergroups.list` at Tier 2 (~20 req/min)** | A 200-usergroup workspace takes 10 minutes to enumerate | Cache with a long TTL; **incremental via `subteam_*` events** rather than full enumeration; request a higher rate tier for a production app | **~20 usergroups** per full enumeration |
| **A full directory resync overlapping the interactive path** | Users see permission errors during the resync window | Resync into a **shadow set**, then swap; interactive reads never hit a half-built index | Any resync larger than ~1,000 memberships |
| **Webhook receivers doing work synchronously** | Ack p99 climbs; the Zalo 2 s / Slack 3 s cliff is crossed | Enqueue-only receivers; measure **time-to-200**, alert at p99 > 1.2 s | The **first** traffic spike |
| **Unbounded tool catalogue in the JEV request** | Prompt size, latency, cost, and **selection accuracy** all degrade | Cap `tools.length`; rank the permitted set before sending; never truncate arbitrarily | Measurable past **~30–50 tools** in one request |
| **An LLM retry loop with no absolute deadline** | A hung provider burns the request budget and the daily quota | One absolute `deadlineEpochMs` per request (v1 already has this); per-provider caps derived from it (`min(remaining, providerCap)`) | The first provider timeout |
| **Per-member cache invalidation on a group revocation** | A 500-person revocation issues 500×M writes and takes seconds | One group epoch; members inherit it | Any group over **~50 members** |
| **Zalo access-token refresh storm on deploy** | All pods refresh at once; the rotation race (Pitfall 4) fires | Jitter the refresh schedule; single-flight the exchange | Every deploy that scales out from zero |
| **Group membership cached without an epoch** | Permission checks read a pre-revocation grant | Epoch in the key, always | Any revocation |

---

## Security Mistakes

Domain-specific security issues, beyond general web-security hygiene. Risk: **Critical** / **High** / **Medium**.

| Mistake | Risk | Prevention |
|---|---|---|
| **Implementing the Zalo digest as HMAC-SHA256** (per third-party guides) | **Critical** — every inbound Zalo event rejected; a silent availability outage with a misleading "signature mismatch" error | Implement the documented plain hash exactly, in one module, with a frozen test vector. Add a **guard test** that asserts the algorithm shape (a digest of a known body against a recorded expected value). |
| **Hashing a re-serialised body** | **High** — 100% rejection, or an intermittent 1–5% rejection rate that is dismissed as "flaky network" | Raw-body capture only; a test using a **captured** request, not a synthesised one. |
| **Using the App Secret Key instead of the OA Secret Key** | **High** — total rejection, with a security-adjacent misconfiguration that invites "let's just try the other key" debugging habits | One named constant per credential type; the credential store records **which** key it holds. |
| **Trusting the model-reported `confidence` as a permission signal** | **Critical** — a prompt-injected or unlucky model response can flip an authorisation gate; the gate becomes non-deterministic | The model **proposes**; the platform-side gate **decides**. `confidence` is a quality signal only. `verified === true` and the authoritative permission check are non-negotiable. |
| **Letting the model define the candidate tool set** | **Critical** — the model can propose a tool the user is not permitted to use | Compute the permitted set **before** the call; intersect. The model's output never widens the candidate set. |
| **A provider fallback that answers on timeout** | **Critical** — a bypass path with weaker constraints than the primary | Every fallback goes through the same gate and returns `clarify` on uncertainty. |
| **Executing a model-proposed tool without a fresh permission check** | **Critical** — a permission revoked between proposal and execution still executes | Re-check permission **at execution**, with the current `perm_version`. |
| **Trusting a Telegram command as a scope/authorisation signal** | **High** — any user can invoke any command; Telegram documents that the scope is not in the update | Re-validate on every command via `PermissionCheckService.check` with the epoch. |
| **Granting group membership = granting permission** | **High** — presence in a chat becomes authority | Group membership is an **input to** RBAC, never a substitute for it. |
| **Caching a granted permission without an epoch** | **High** — revocation is ineffective for the TTL window, per pod | Epoch in the cache key; Redis-backed; revocation = epoch bump. |
| **Storing Zalo ids as JS numbers** | **High** — silent float rounding can **merge two users into one identity**, and the identity layer upserts on `(platform, chat_user_id)`, so one user inherits the other's permissions | Ids are strings end-to-end; a big-int-safe parse path; a fixture with the real 19-digit values. |
| **Not verifying the Zalo signature, or verifying it after enqueueing** | **Critical** — anyone who learns the endpoint URL can inject events as any user | Verify **before** enqueue, against the raw body; the receiver is the only place a request becomes trusted. |
| **Replaying a captured Zalo request** | **Medium** — the digest is over `app_id ‖ data ‖ timeStamp ‖ secret`; if the timestamp check is weak, a captured request replays | Enforce a **timestamp window** (mirror the v1 `NonceStoreService` ±300 s skew rule) **and** a `GETDEL`-class one-time nonce. |
| **Replaying a captured Slack/Telegram request** | **High** — duplicate side effects; on Slack, duplicate bot replies | The v1 `NonceStoreService` pattern (`SET NX EX`) plus the native-id dedupe index. |
| **Putting a Telegram `secret_token` in a log or a span** | **Medium** — it authenticates your webhook | Never log it; it is a credential, not an identifier. |
| **Putting a Slack bot token or a Zalo OA secret in a `reason` field** | **High** — a free-text field is not an allowlist | Credentials are in the KMS-backed credential store (R2's owners only). |
| **Widening the log allowlist without the written justification** | **Medium** — the D-16 control is bypassed; group identifiers start appearing in logs that were reviewed against a narrower surface | Widen deliberately, in the same commit, with the justification. The friction is the control. |
| **Adding a group id and a user id to the same span** | **Medium** — a correlatable activity map in a store with **no erasure path** (D-18's own reasoning) | Group id only, opaque, no user identifier in the same span. `submission_id` stays forbidden. |
| **Leaving per-tenant IM credentials in env vars or config files** | **High** — violates NFR-SEC-3 and R2 | KMS-backed credential store; only `crypto/**` and `connectors/**` may touch the KMS surface. |
| **Trusting `allowed_updates` implicitly on Telegram** | **Medium** — membership events never arrive; the platform believes it is synced | Set it explicitly; assert it at boot via `getWebhookInfo`; assert admin status in onboarding. |
| **Treating a failed directory read as "no members"** | **High** — either revokes everyone or (if merged) grants everyone | Distinguish "could not read" from "nothing there"; merge only complete reads. |
| **Silently degrading Zalo identity resolution outside VN** | **Medium** — the platform proceeds with no identity, or with the wrong one | A typed error (`ZALO_PROFILE_EMPTY_OUTSIDE_VN`) and a boot-time egress self-check. |
| **Exposing the webhook endpoint without rate limiting** | **Medium** — an unauthenticated flood; a Zalo flood burns retry stages against **your** endpoint | The v1 per-user / per-app / per-connector throttlers apply to the receivers too, plus an IP-level guard at the edge. |
| **Leaking raw user text into logs** | **High** — user-authored content inherits the submission retention window | The D-16 allowlist excludes free text; `reason` is a closed enum-ish token, never prose. |
| **Leaving the Slack webhook controller as a placeholder in production** | **High** — the app "works" and does nothing | Implement it; add a test asserting the receiver enqueues. |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---|---|---|
| **A Telegram button that spins for 30 seconds** | The user believes the bot is broken and taps again — producing duplicate side effects | `answerCallbackQuery` **first**, in a `finally`, before any slow work |
| **A Telegram button that silently does nothing** (over-long `callback_data`) | The message was never sent; the user sees no button at all and no explanation | Enforce the 64-**byte** limit in one helper; use opaque handles; alert on `BUTTON_DATA_INVALID` |
| **A bot that cannot see the group** | The user types `/cmd` and nothing happens — no error, no reply, ever | Detect "bot was addressed but produced no output" and post a one-time hint naming the exact **remove-and-re-add** step |
| **Group membership changes that take effect "in a minute"** | A removed member can still act for up to a minute; a joined member waits up to a minute | Revocation by **epoch bump** (immediate), not by cache expiry. Communicate the propagation window honestly in the admin console. |
| **A user removed from a group still sees a stale permission** | They attempt a request and get a confusing permission error *after* they believe they were removed | Make the epoch bump visible: "access revoked at HH:MM" in the audit log, and the denial message says "your access to <app> changed" rather than "you are not allowed." |
| **A notification link that opens the form but cannot return you to the chat** | The user completes the task in a browser and has no path back to the conversation | Resolve the destination from `real_user_id` → conversation reference at send time (Pitfall 10); make the notification message carry the destination explicitly. |
| **A notification link that lives 90 days in a chat list** | Stale links accumulate in users' chat history; clicking one produces a confusing error | Issue notification links with a **shorter TTL** — the D-21 ceiling is a maximum, so this needs no schema change. Do not edit the frozen claim set. |
| **A provider timeout that produces "I don't know" instead of a helpful question** | The user gives up | The `clarify` outcome must be **useful**: name what was ambiguous and what the user can try. A clarification is a product surface, not an error path. |
| **The AI guard answering confidently when it is unsure** | The user acts on a wrong tool and discovers the error downstream — possibly after a real-world consequence | Gate on the **permitted** set and the platform checks, not on model confidence. When in doubt, **ask**. |
| **A Zalo identity that resolves differently inside and outside Vietnam** | Some users are recognised and others are not, with no visible reason | Detect the empty profile and surface a clear, non-technical message ("we could not verify your account — please contact support"), never a generic error. |
| **A directory sync that revokes access because a read failed** | A transient Graph 429 wipes everyone's access for a moment | A failed read must **never** replace a good membership set. Quarantine the source and keep the last good state, with an admin alert. |
| **A Slack workspace on a plan without usergroups** | The admin configures a group that will never sync, with no feedback | Surface `plan_upgrade` / `missing_scope` as an **admin-console configuration error**, not an empty list. |
| **Duplicate bot replies** | The user sees the bot answer twice and loses trust in the whole system | Dedupe on the message `ts`, not `event_id`; make every side effect idempotent by construction. |
| **The app builder offering a Telegram-only form** | A form designed for a web renderer presented as a chat form | The chat surface is a **link**, by design. FormIO is a web renderer; do not try to render a form inside a chat message. |

---

## "Looks Done But Isn't" Checklist

Run this before declaring any v2 phase complete. Each line names a concrete artefact in this repo.

- [ ] **Zalo signature verification:** Is there a test using a **captured** Zalo request body (with a recorded expected digest), rather than a body synthesised in the test? — *verify:* the fixture's expected digest is a literal in the test file and was produced by Zalo, not by the implementation.
- [ ] **Zalo signature:** Does the verifier hash the **raw bytes** from `@RawBody()`, not `JSON.stringify(req.body)`? — *verify:* grep the adapter for `JSON.stringify` in the verification path.
- [ ] **Zalo signature:** Is the algorithm `sha256(app_id ‖ rawBody ‖ timeStamp ‖ oaSecretKey)` with the **OA** Secret Key, in **one** module? — *verify:* exactly one file in the repo contains `sha256` over a Zalo body.
- [ ] **Zalo ack:** Does the receiver return 200 in **< 2 s** with no DB read, no KMS decrypt, and no outbound call? — *verify:* a test asserts the receiver's dependency set, or a load test reports the ack-duration p99.
- [ ] **Zalo ack:** Is there a **per-OA event-freshness** health signal, distinct from process liveness? — *verify:* `/health/ready` (or an equivalent) exposes a last-event-age metric per OA.
- [ ] **Zalo tokens:** Is the refresh **single-flight** under a Redis lock, with the rotation race tested? — *verify:* a test fires two concurrent refreshes and asserts exactly one exchange occurred.
- [ ] **Zalo tokens:** Is the refresh token stored in the **KMS-backed credential store**, and is a refresh failure surfaced to an admin (not just logged)? — *verify:* grep for `zalo` in the credential repository's reference keys; check the admin surface.
- [ ] **Zalo ids:** Do the fixtures use the real 19-digit ids (`8756287263669629130`, `360846524894903967`) and assert round-trip equality? — *verify:* grep the adapter fixtures.
- [ ] **Zalo ids:** Is there **no** `z.coerce.number()` and no `Number(...)` on any Zalo identifier? — *verify:* grep the adapter for `coerce` and `Number(`.
- [ ] **Zalo egress:** Does a boot-time self-check detect that the adapter is running outside Vietnam? — *verify:* a typed error `ZALO_PROFILE_EMPTY_OUTSIDE_VN` exists and is raised on an empty profile.
- [ ] **Zalo group members:** Is the group-management scope checked at onboarding and surfaced as a configuration error? — *verify:* the admin console shows the scope status.
- [ ] **Zalo group members:** Does pagination use an explicit `count` well above the default 5, and keep pending members separate? — *verify:* grep for `count=` in the Zalo client and for the pending-member endpoint.
- [ ] **Telegram `callback_data`:** Is there a single builder that enforces the **64-byte** limit and throws on violation? — *verify:* grep for `Buffer.byteLength` in the Telegram adapter; a test asserts a >64-byte payload throws.
- [ ] **Telegram `callback_data`:** Do payloads contain **only** opaque handles? — *verify:* no payload contains a form id, a permission name, or a user id.
- [ ] **Telegram:** Is `answerCallbackQuery` called in a `finally`, **before** slow work? — *verify:* read the handler.
- [ ] **Telegram:** Is `allowed_updates` set explicitly **and asserted at boot** via `getWebhookInfo`? — *verify:* a boot check compares the live value to the constant; a test covers it.
- [ ] **Telegram:** Is `chat_member` in `allowed_updates`, and is bot-admin status checked in group onboarding? — *verify:* the constant lists it; the onboarding checklist names it.
- [ ] **Telegram:** Is `update_id` used as a **dedupe key only**, never as a monotonic cursor? — *verify:* grep for `update_id` — it appears in the dedupe path, not in an offset comparison.
- [ ] **Telegram commands:** Does every command handler call `PermissionCheckService.check` with an explicit `perm_version`? — *verify:* grep the command handlers.
- [ ] **Slack:** Is the webhook controller still a placeholder? If so, the phase is **not** done — implement raw-body capture, HMAC verification, envelope construction, and enqueue. — *verify:* `apps/api/src/adapters/slack/slack-webhook.controller.ts` no longer returns `{ ok: true }`.
- [ ] **Slack:** Does the receiver handle the **duplicate-without-retry-header** case? — *verify:* a test replays the same `event_id` with a different `ts` and asserts one side effect.
- [ ] **Dedupe:** Is there a **unique index** on `(platform, native_event_id)` (and a second on the message `ts` for Slack)? — *verify:* the Mongo index exists in the repository's `createIndexes`.
- [ ] **Dedupe:** Does `InboundEventSchema` carry `native_event_id`, and is the frozen key-set assertion extended to it? — *verify:* the claim/envelope key-set test includes the new field.
- [ ] **At-least-once:** Is every consumer's side effect idempotent by construction (upsert / versioned transition), not by a "have I seen this?" check? — *verify:* re-running the consumer twice produces the same state.
- [ ] **Two-way sync:** Is the conversation-reference key **platform-prefixed** and does it encode a scope kind (`direct` / `group` / `thread`)? — *verify:* `ConversationReferenceRepository.key` and a migration for the v1 records.
- [ ] **Two-way sync:** Is the platform-specific continuation payload a **validated discriminated union**, not `unknown`? — *verify:* the `reference` field has a Zod schema per platform.
- [ ] **Two-way sync:** Does the notification delivery path resolve the destination from `real_user_id` → conversation reference? — *verify:* the notification assembler resolves a destination before enqueue.
- [ ] **Notification links:** Is the notification link's TTL **shorter** than the 90-day ceiling, issued by the issuer, with **no** change to `ReadLinkClaimsSchema`? — *verify:* `git diff` on `read-link-claims.ts` is empty for the notification feature.
- [ ] **Frozen contracts:** Are `READ_LINK_CLAIMS_VERSION` and the JEV `spec_version` **unchanged** by v2 feature work? — *verify:* `git diff` shows no change to either constant.
- [ ] **RBAC:** Does `RbacService.hasPermission` still return `true` unconditionally? If so, **group RBAC is not implemented**, regardless of what the phase reports. — *verify:* read the method.
- [ ] **RBAC:** Is `perm_version` a **required** parameter (no `= 0` default)? — *verify:* the signature has no default.
- [ ] **RBAC:** Is the RBAC cache **Redis-backed**, not an in-process `Map`? — *verify:* `RbacCacheService` has no `Map`.
- [ ] **RBAC:** Does a group revocation take effect **immediately** (epoch bump) rather than by TTL expiry? — *verify:* a test revokes and asserts the very next check is denied.
- [ ] **Directory sync:** Are Graph `syncStateNotFound` and `410 + empty $deltatoken` handled as **one terminal state** (discard cursor, full resync), not retried? — *verify:* the error handler has a distinct branch, and a test drives both.
- [ ] **Directory sync:** Does a failed read **never** replace a good membership set? — *verify:* a test simulates a 429 mid-read and asserts the prior set survives.
- [ ] **Directory sync:** Is the Slack path **read-only by construction** (no `writeMembers` on the Slack source)? — *verify:* the Slack source has no write method; the interface's `writeMembers` is `never`.
- [ ] **AI guard:** Can the model **widen** the permitted tool set? If yes, this is a Critical defect. — *verify:* the permitted set is computed before the call and only intersected afterwards.
- [ ] **AI guard:** Is the tool invocation path the **same** permission check with the same epoch, evaluated at execution time? — *verify:* the executor calls `PermissionCheckService.check`, not a model-supplied permission.
- [ ] **AI guard:** Is the tool count **bounded**, with the bound enforced as a precondition rather than a truncation? — *verify:* a request exceeding the cap is rejected with a typed error.
- [ ] **AI guard:** Does every provider fallback return `clarify` on uncertainty and pass the same gate? — *verify:* the fallback's code path is the same gate.
- [ ] **AI guard:** Is `temperature = 0` set, and is the **audit** story not resting on determinism? — *verify:* the provider config sets it; the audit record captures the proposal and the gate outcome.
- [ ] **Allowlists:** Were `LOG_FIELD_ALLOWLIST` / `SPAN_ATTRIBUTE_ALLOWLIST` widened **with a written justification in the same commit**, and are no identifiers smuggled through `reason`? — *verify:* the diff shows the justification; grep for identifiers in `reason` values.
- [ ] **Boundaries:** Is every new package declared in `DOMAIN_ELEMENT_TYPES` **and** `ALLOWED_EDGES` in the same commit? — *verify:* the lint gate passes with `default: 'disallow'` still in place.
- [ ] **Boundaries:** Are `checkAllOrigins: true`, `default: 'disallow'`, and `partialMatch: false` all still in place? — *verify:* `git diff` on `boundaries.config.mjs` shows no removal.
- [ ] **Boundaries:** Do the new adapters live under `packages/domain/src/adapters/<platform>/{inbound,outbound}/` so R1 actually applies? — *verify:* the path matches the category pattern.
- [ ] **Credentials:** Are all per-tenant IM secrets in the KMS-backed store, with no `process.env` secret in an adapter? — *verify:* grep the adapters for `process.env`.
- [ ] **Observability:** Is trace context propagated across **every** new hop (IM → queue → worker → connector → IM), with no gap at the queue boundary? — *verify:* an end-to-end trace from a received event to a delivered message is one trace.

---

## Recovery Strategies

What to do when a pitfall has already fired.

| Pitfall | Recovery Cost | Recovery Steps |
|---|---|---|
| **Zalo signature rejected in production** | LOW–MEDIUM | 1. Compare the computed digest against the **captured** request fixture. 2. Check the raw bytes are byte-identical (add a temporary length + hash log of the raw body — never the body itself). 3. Confirm the **OA** Secret Key. 4. If the formula is right but digests still differ, compare against Zalo's own sample from the docs — the field **order** may differ from your reading. 5. Roll back the receiver to ack-without-verify **only** as a measured, time-boxed stopgap, and fix forward. |
| **Zalo webhook disabled by Zalo** | **MEDIUM–HIGH** (needs a human) | 1. Confirm via event-freshness probe, not via logs. 2. Re-enable the webhook **manually in the Zalo OA portal** — there is no API. 3. Check whether the disable was preceded by a burst of non-200s or an ack-latency spike. 4. Backfill from Zalo's message APIs if the gap matters. 5. Fix the ack path **before** re-enabling, or it will be disabled again. |
| **Zalo refresh-token race** | MEDIUM | 1. Stop all refreshers (single-flight lock + a kill switch). 2. Read the credential store; if **two** refresh tokens exist, keep the **newest** (highest issue time) and discard the other. 3. Force one refresh, verify the access token works, then re-enable. 4. If the newest is unusable, re-run the OA authorisation flow (admin in the portal). |
| **Zalo identity resolution empty (non-VN egress)** | MEDIUM | 1. Verify egress IP (must be VN). 2. Register the IP in the Zalo portal if production. 3. Re-run the affected user's profile fetch. 4. If identities were merged during the outage, audit `IdentityMapping` for affected `chat_user_id`s and re-resolve — **assume user-identity contamination until proven otherwise**. |
| **Slack usergroups out of sync / plan error** | LOW | 1. Read the API error: `plan_upgrade` → the workspace plan is the blocker (raise to the admin). 2. `missing_scope` → add `usergroups:read` and reinstall the app. 3. Otherwise run a full `usergroups.list?include_users=true` reconciliation. 4. Confirm **read-only** — never write back. |
| **Graph delta token expired / 410** | LOW (expensive, not complex) | 1. Discard the cursor. 2. Run a **full resync** into a shadow set. 3. Swap atomically. 4. Resume delta from the new `deltaLink`. 5. **Do not** retry the expired token. |
| **Graph `members@delta` stale membership** | MEDIUM | Detect by reconciling a full member read for security-relevant groups on a schedule; remove memberships that the full read does not confirm. Treat `members@delta` as an *accelerator*, not the source of truth. |
| **Telegram membership events never arriving** | LOW | 1. `getWebhookInfo` → confirm `allowed_updates` contains `chat_member`. 2. Confirm the bot is an **administrator** of the group. 3. If `allowed_updates` was changed recently, run a **full group resync** — the change is not retroactive. 4. Re-add the bot if privacy mode needs changing. |
| **Telegram `BUTTON_DATA_INVALID`** | LOW | 1. Find the offending payload via the error log (never log the payload if it contains user data). 2. Replace it with an opaque handle. 3. Add the 64-byte guard so it cannot recur. |
| **Duplicate bot replies (Slack)** | MEDIUM | 1. Identify the class: retry (`x-slack-retry-num` present) vs duplicate send (absent). 2. Add the `ts`-based unique index. 3. Replay the captured duplicates in a test. 4. Audit what the duplicates *did* — if the side effect was a submission, duplicates may have created duplicate records. |
| **Duplicate side effects already caused** | **HIGH** | 1. Identify the affected records. 2. Decide per side effect class: submissions (dedupe by natural key / human review), outbound messages (acceptable), permission grants (audit). 3. Fix the dedupe **first**, then clean up — cleaning up first just re-accumulates. |
| **Notification links 400 because the claim set changed** | **HIGH** | 1. Revert the claim-set change **immediately** — the blast radius is every outstanding link, not just new ones. 2. Re-issue only the affected links if the TTL still allows. 3. If the change is genuinely required, it is a **new claim-set version**: ship it as a *new* action or a new `READ_LINK_CLAIMS_VERSION`, accept that old links break, and communicate it. **Never** mutate the frozen set in place. |
| **Group revocation did not take effect** | MEDIUM | 1. Determine whether the epoch was bumped (audit log) or the cache merely expired. 2. If expired: the epoch is not real — fix it before shipping more group roles. 3. Purge the affected users' cache entries explicitly as a stopgap. 4. Verify across **all** pods, not one. |
| **Stale permission after removal (Graph)** | MEDIUM | 1. Run a targeted full read for the affected group. 2. Reconcile membership. 3. Confirm the delta blind spot is the cause and schedule periodic full reconciliation. 4. Audit the window — a security incident is a reportable event if the exposure crossed a policy threshold. |
| **AI guard routed a forbidden tool** | **CRITICAL — treat as a security incident** | 1. **Disable the open-ended path** (feature flag) and fall back to the closed v1 router. 2. Preserve the prompt, the proposal, the permitted set, and the gate outcome — these are the audit record. 3. Determine whether the model widened the set or the gate was bypassed. 4. Fix the **gate**, not the prompt. 5. Add the failing case as a regression test before re-enabling. |
| **AI guard stuck in a tool-call loop** | MEDIUM | 1. Confirm the absolute deadline fired (it should have). 2. If it did not, the deadline was not enforced — fix that first. 3. Add a round cap. 4. Review the daily budget consumption. |
| **Boundary lint failure after adding a package** | LOW | 1. Read the error — it names the disallowed edge. 2. Decide: does the edge belong? If yes, add it to `ALLOWED_EDGES` **in the same commit**. If no, move the import. 3. If the edge is legitimate but crosses a *category* boundary (e.g. an inbound adapter imported by the worker), the placement is wrong — fix the placement, **not** the rule. 4. **Never** relax `default: 'disallow'` or remove `checkAllOrigins`. |
| **PII leaked into logs/spans** | **MEDIUM–HIGH** | 1. Identify the field and the commit that introduced it. 2. Remove it from the allowlist if it was added; if it was smuggled through `reason`, fix that. 3. **Purge the affected sink** if the retention window allows (hot logs) — cold logs and **traces** may not be purgeable, in which case escalate to the compliance path (D-18's reasoning). 4. Record it in the erasure register. |

---

## Pitfall-to-Phase Mapping

> **Proposed v2 phase structure.** These phase numbers are a **proposal** for the roadmapper to reconcile against `FEATURES.md` / `ARCHITECTURE.md`. The **ordering constraints** below are the load-bearing part.

**Proposed phases**

| Phase | Name | Purpose |
|---|---|---|
| **10** | v2 Foundations — Contract, Identity & Observability Extensions | Extend the frozen/closed surfaces **before** any adapter depends on them: `native_event_id` on the inbound envelope, the platform-neutral conversation-reference model, the real `perm_version` epoch and the Redis RBAC cache, the boundary-graph extension, the D-16/D-18 widening with justifications, the Slack placeholder replacement, and the notification-TTL policy. |
| **11** | Zalo OA Adapter | Inbound receiver (raw-body digest, 2 s ack), token lifecycle (single-flight rotation, KMS storage), outbound send, big-int-safe ids, VN egress precondition, group-member enumeration with explicit paging. |
| **12** | Telegram Adapter | Inbound receiver (`secret_token`, `allowed_updates` asserted at boot), command surface with mandatory re-validation, inline-keyboard handle discipline, `answerCallbackQuery`, admin-status onboarding. |
| **13** | Two-Way Synchronisation & Delivery Semantics | At-least-once dedupe (unique indexes), idempotent consumers, conversation/thread identity binding, outbound notification delivery resolved from `real_user_id`, notification-link TTL. |
| **14** | Directory & Group RBAC Sync | Slack usergroups (read-only mirror), Graph delta with terminal-state handling and throttling, Zalo group members with the permission scope, group-aware epoch fan-out, permission-first group resolution. |
| **15** | Permission-First Open-Ended AI Guard | Model-proposes / platform-disposes, the closed permitted set, execution-time permission re-check, bounded tool catalogue, monotonic fallback chain, cost/timeout budgets, `clarify` as the safe default. |
| **16** | Security, Compliance & Operations | Per-tenant credential operations, event-freshness probes and the re-enrolment runbook, egress/region matrix, allowlist governance, erasure/audit coverage, load verification. |

**Mapping**

| Pitfall | Prevention Phase | Verification |
|---|---|---|
| **P1** Zalo plain-hash signature, raw body, OA-vs-App key | **11** (verifier + frozen test vector); raw-body plumbing in **10** | A test uses a **captured** request with a literal expected digest; exactly one module hashes a Zalo body |
| **P2** Zalo 2 s ack, 5-stage retry, silent webhook death | **11** (enqueue-only receiver); **16** (freshness probe + runbook) | Ack p99 < 1.2 s in load test; per-OA last-event-age alert exists; the runbook has the portal re-enable steps |
| **P3** VN egress rule vs. data residency | **11** (typed error + self-check); **16** (egress/region matrix) | A boot check fails outside VN; the residency matrix states Zalo is VN-egress-only |
| **P4** 25 h token / 90 d rotating refresh | **11** | A concurrency test shows exactly one refresh exchange; a refresh failure raises an admin alert |
| **P5** 19-digit id corruption | **11** | Fixtures use the real 19-digit ids and assert round-trip equality; no `coerce.number()` in the adapter |
| **P6** Telegram `callback_data` 64 bytes + `answerCallbackQuery` | **12** | A builder throws over 64 bytes; a test asserts `answerCallbackQuery` is called before slow work |
| **P7** Telegram command carries no scope; privacy mode | **12** (re-validation + onboarding copy); **14** (RBAC) | Every command handler calls `PermissionCheckService.check` with an explicit epoch; the onboarding copy names the remove-and-re-add step |
| **P8** `allowed_updates` / non-monotonic `update_id` | **12** | Boot asserts `getWebhookInfo.allowed_updates`; `update_id` appears only in the dedupe path |
| **P9** At-least-once delivery; Slack's dedupe key | **10** (`native_event_id`); **13** (unique indexes) | Unique index on `(platform, native_event_id)` **and** on the Slack message `ts`; a replay test produces one side effect |
| **P10** Conversation/thread identity not expressible | **10** (model + migration); **13** (delivery) | The reference key is platform-prefixed with a scope kind; the continuation payload is a validated union; the notification path resolves a destination |
| **P11** RBAC revocation fan-out; stub authoriser; in-process cache | **10** (real epoch + Redis cache); **14** (group fan-out) | `hasPermission` is no longer a stub; `perm_version` has no default; a revocation test denies on the **next** check, across all pods |
| **P12** Three directory failure vocabularies; Zalo scope/page size | **14** | `syncStateNotFound` and `410+empty-$deltatoken` hit one resync branch; a failed read never replaces a good set; Zalo pages with an explicit `count` |
| **P13** AI guard must never invoke a tool | **15** | A regression test proves the model cannot widen the permitted set; the executor re-checks permission at execution; every fallback returns `clarify` |
| **P14** Frozen D-21 / D-23 / D-16 / D-18 collisions | **10** | `git diff` shows no change to the frozen constants; the allowlist widening carries its written justification in the same commit |
| **P15** Boundary lint; mis-categorised adapters | **10** (graph extension); **11/12** (placement) | The lint gate passes with `default: 'disallow'` and `checkAllOrigins: true` intact; new adapters match the `inbound`/`outbound` category patterns |

**Ordering constraints (the parts that are not negotiable)**

1. **Phase 10 must precede Phases 11, 12, 13 and 14.** It carries the frozen-contract decisions (P14), the boundary-graph extension (P15), the `native_event_id` contract change (P9), the conversation-reference model (P10), and the real RBAC epoch (P11). Every one of those is a dependency of an adapter, and changing them later invalidates links and adapters already shipped.
2. **Phase 11 and Phase 12 may run in parallel** once Phase 10 lands — they touch different adapters. They share the receiver contract, the dedupe machinery, and the credential store, so Phase 10 must have frozen those.
3. **Phase 13 must land before Phase 14's revocation semantics are meaningful** — the two-way delivery path is what makes group-scoped notifications possible, and the notification path is where the conversation-reference model is exercised.
4. **Phase 15 must land after Phase 14** — the open-ended guard's permitted set is the union of app-scoped and group-scoped permissions. Building it before the group axis exists means building it against the stub authoriser.
5. **Phase 16 is not optional cleanup.** The Zalo re-enrolment runbook (P2), the egress/region matrix (P3), and the credential operations (P4) are the difference between a recoverable incident and a 90-day outage.

---

## Sources

**First-party documentation (HIGH confidence; cross-checked against a second source where noted)**

- Zalo for Developers — Official Account webhook signature, OA Access Token V4 (PKCE), token lifetimes and rotation, IP whitelist / VN-region policy: `developers.zalo.me`, `docs.zaloplatforms.com`, `oauth.zaloapp.com/v4/oa/access_token`
- Zalo for Developers — Group management: `GET https://openapi.zalo.me/v3.0/oa/group/listmember` (`group_id`, `offset`, `count` default 5), `listpendingmember`, `getgroup`, and the "quản lý thông tin nhóm" permission requirement
- Zalo for Developers — GMF group management guide (`oa.zalo.me/home/documents/.../quan-ly-nhom-gmf`)
- Telegram Bot API — `callback_data` limits, `answerCallbackQuery`, privacy mode, `allowed_updates`, `chat_member`, `update_id` semantics, `setWebhook` `secret_token`, `getUpdates` retention and mutual exclusion
- Slack Events API — 3-second ack, retry schedule and `x-slack-retry-num` / `x-slack-retry-reason`, `x-slack-no-retry`, the 95%-failure disable threshold, Delayed Events
- Slack API — `usergroups.list` / `usergroups.write` / `usergroups.users.update`, scopes and plan requirements, `subteam_*` events
- Microsoft Graph — delta query behaviour, 7-day delta token, `syncStateNotFound`, `410 Gone` with an empty `$deltatoken`, `members@delta` limitations, `$select` suppression, throttling limits and `Retry-After`, group pagination
- Slack / Microsoft Learn — Bot Framework retirement (support ended 2025-12-31) and the Agents SDK successor, which the v2 adapters inherit from v1

**Community / issue-tracker evidence (MEDIUM confidence; used to corroborate the docs, not to replace them)**

- `slackapi/node-slack-sdk` issue #2141 — the same Slack message delivered multiple times with **different** `event_id`s and no retry header (the basis for Pitfall 9's second dedupe key)
- `slackapi/bolt-python` issues #678 / #693 — `x-slack-retry-num` in practice, and the "fast-ack + lazy" pattern
- `slackapi/bolt-js` `src/receivers/HTTPModuleFunctions.ts` — the reference implementation of raw-body buffering, signature verification, and `ssl_check` handling
- `rune-kit/rune` and Vietnamese-language Zalo guides — **used as an example of the error to avoid** (they misstate the digest as HMAC-SHA256)
- `Duonghn257/zalo_mcp` — corroborates the Zalo OA OAuth v4 PKCE exchange shape and the GMF endpoint set

**This codebase (HIGH confidence — read directly at commit `215f96e6`)**

- `packages/contract/src/events/inbound-event.ts` — `.strict()` envelope; `ImPlatformSchema` already lists `zalo` and `telegram`; `event_id` documented as "unique per delivery attempt chain"; **no `native_event_id`**
- `packages/contract/src/events/outbound-message.ts` — `.strict()`; **no thread / conversation / tenant field**
- `packages/contract/src/links/read-link-claims.ts` — D-21 frozen claim set; `notification` → `target_id` absent; `MAX_READ_LINK_TTL_SECONDS` = 90 days; `READ_LINK_CLAIMS_VERSION = '1.0'`
- `packages/contract/src/jev/v1/jev-request.ts` — D-23 frozen wire contract; `tools: ToolDescriptor[]`; `state.force_clarification`; `spec_version: '1.0'`
- `packages/platform/src/logging/log-allowlist.ts` — D-16 `LOG_FIELD_ALLOWLIST`; no `chat_user_id` / `group_id` / `chat_id` / `telegram_user_id` / `zalo_user_id`
- `packages/platform/src/otel/span-attribute-allowlist.ts` — D-18 `SPAN_ATTRIBUTE_ALLOWLIST` and `FORBIDDEN_SPAN_ATTRIBUTES` (`submission_id`, `actor_ref`, `user_email`, `email`)
- `packages/domain/src/authz/rbac.service.ts` — `hasPermission` returns `true` unconditionally; `getRoles` → `['employee']`
- `packages/domain/src/authz/rbac-cache.service.ts` — in-process `Map`, key `ak:rbac:${app_id}:${real_user_id}:${perm_version}`, 60 s TTL
- `packages/domain/src/authz/permission-check.service.ts` — `perm_version = 0` default
- `packages/domain/src/identity/identity-mapping.repository.ts` — in-memory array; upsert keyed on `(platform, chat_user_id)`; `chat_user_id: string`
- `packages/domain/src/notifications/data-access/conversation-reference.repository.ts` — Teams-shaped record; key `${channelId}::${chatUserId}`; `reference: unknown`
- `packages/domain/src/decision/routing-orchestrator.ts` — the v1 gate: `verified === true`, finite confidence, `confidence >= gate`, no permitted alternative, `canOpenNow`, absolute `deadlineEpochMs`; per-attempt budget `min(remaining, providerCap)`
- `apps/api/src/webhooks/external/webhook-hmac.service.ts` — raw-body HMAC-SHA256 with `timingSafeEqual` and a fast-fail envelope check
- `apps/api/src/webhooks/external/nonce-store.service.ts` — Redis `SET NX EX` replay guard, ±300 s skew window
- `apps/api/src/adapters/slack/slack-webhook.controller.ts` — **still a placeholder** returning `{ ok: true }`
- `packages/domain/src/connectors/data-access/connector-credentials.repository.ts` — the KMS-backed AES-256-GCM credential envelope (the R2-owning path for per-tenant IM secrets)
- `tooling/boundaries.config.mjs` — `DOMAIN_ELEMENT_TYPES` (15, `domain` root deliberately not one), `APP_ELEMENT_TYPES`, `ALLOWED_EDGES`, `BOUNDARY_FILE_CATEGORIES`, `default: 'disallow'`, `checkAllOrigins: true`, `partialMatch: false`, last-match-wins, and R1/R2/R3

**Gaps and unverified items (LOW confidence — treat as open)**

| Item | Status | Why it matters / suggested resolution |
|---|---|---|
| **Zalo OA webhook signature in the wild** | ⚠️ **Unverified against a live OA** | The formula is from official documentation, but the **exact field order** and whether `timeStamp` is a header or a body field has not been confirmed against a captured production request. **Resolve in Phase 11** with a captured request + expected digest, and freeze it as a test vector. |
| **Zalo webhook disable: notification and detection** | ⚠️ **Unverified** | No evidence was found that Zalo notifies the app owner before disabling. The freshness probe (P2) is designed for exactly this uncertainty. |
| **Zalo `X-ZEvent-Signature` hex vs. base64** | ⚠️ **Unverified** | Official docs read as hex. The implementation must accept the documented encoding and fail closed on anything else. |
| **Zalo `listmember` vs. `listpendingmember` overlap** | ⚠️ **Unverified** | The `members[].user_id` field description mentions members "waiting in the group," which suggests overlap with the pending list. Confirm on a real OA before relying on either as the authoritative set. |
| **Zalo OA rate limits** | ⚠️ **Not documented** | No published rate limit for OpenAPI or group endpoints. The Phase 11 client must be conservative and must not assume a specific quota. |
| **Slack usergroups `include_users` page size and cost** | ⚠️ **Unverified** | The Tier 2 rate (~20 req/min) is documented; the page shape is not. Measure during the Phase 14 spike. |
| **Graph `members@delta` removal behaviour in a live tenant** | ⚠️ **Documented as a limitation; not empirically re-tested here** | The blind spot is documented. Confirm the mitigation (periodic full reconciliation) is affordable at the target tenant size. |
| **Telegram `update_id` randomisation, observed** | ⚠️ **Documented; not observed here** | The behaviour is in the official docs. A regression test should exercise the "gap > 7 days" path rather than assume it. |
| **The AI guard's tool-catalogue accuracy-vs-size curve** | ⚠️ **Not measured** | The cap for `tools.length` (Pitfall 13) must be chosen from measurement on the v1 fixture set, not guessed. |
| **Real per-tenant IM credential volume** | ⚠️ **Not modelled** | KMS-backed credential reads per request × tenant count × 3 platforms determines whether a credential cache is needed and what its TTL should be. Measure in Phase 16. |

---

*Pitfalls research for: IM-driven enterprise app builder — v2 platform expansion (Zalo OA, Telegram, two-way sync, group/directory RBAC, permission-first open-ended AI guard)*
*Researched: 2026-10-21*
