# Stack Research — v2 Additions: Zalo OA, Telegram, Two-Way Sync, Group RBAC, AI Guard

**Project:** aka-nexa (working title)
**Milestone:** v2 — Platform Expansion & Advanced Capabilities
**Document type:** Additive stack research. **Supersedes the v1 STACK.md at this path**, which was an audit of the v1 spine.
**Researched:** 2026-10-21 (every version number resolved live from `registry.npmjs.org` on this date; every platform behaviour sourced from vendor docs fetched on this date)
**Scope:** **Only** what the four new capabilities need. Frozen v1 decisions are not re-litigated.

> **Preserved baseline.** The v1 stack document (Node 24 / NestJS 12.1.2 / TS 6.0.3 / Express / native `mongodb` / ioredis 6 / `jose` / `@formio/js` 5.6.1 / `@node-rs/argon2` / hand-written `ThrottlerStorage` / manual OTel / OIDC via `openid-client`) is reproduced verbatim in the managed `<!-- GSD:stack-start -->` block of `AGENTS.md`. Nothing there is reversed here.

---

## 0. How to read this document

### 0.1 What changed structurally since v1 — three headline items

| # | Finding | Why it matters | Action |
|---|---------|----------------|--------|
| **1** | **Zalo OA's webhook signature mechanism IS documented and standard.** v1's spike **S2** recorded "Zalo webhook signature verification — **Unverified**, weakest-documented of the four." It is now **closed as VERIFIED**: `X-ZEvent-Signature` header carrying `sha256(appId + data + timestamp + OAsecretKey)`, HTTPS-only, 2-second ack budget, and a documented 5-stage retry schedule with a `num_retry` header. | **S2's Webhook threat-model unknown is resolved.** Zalo gets an HMAC verification path like the other three platforms, not a network-control-only fallback. | Adopt the documented scheme verbatim (§6.2). **S2 narrows to "API stability + token lifecycle", not "unknown signature scheme".** |
| **2** | **Zalo's `sender` field exposes `admin_id`.** The `oa_send_text` event includes `sender.admin_id` (the OA admin's internal ID) *only* when the message was sent from the OA admin chat tool. Combined with `user_id_by_app` (a per-app user identifier), this is **the first IM inbound payload in this platform that carries a second, non-user identity field** — and `InboundEventSchema` is `.strict()`. | The frozen contract **rejects** these fields by construction. Adding them is a **contract change**, not an adapter detail. It is also a PII-adjacent surface (admin identity maps to a real employee). | **Contract decision required in Phase 10.** See §7.1 — do **not** silently widen `.strict()`. |
| **3** | **OpenTelemetry JS shipped SDK 3.0.0 / 0.300.0 on 2026-10-20** — one day before this research. It is a **major breaking release**: `sdk-trace-node`, `sdk-trace-base`, `exporter-jaeger`, `propagator-jaeger`, `shim-opentracing` all **removed**; deep imports now fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`; `NodeSDKConfiguration.spanProcessor`→`spanProcessors`, `metricReader`→`metricReaders`. The repo is pinned at **0.222.0 / 2.11.0**. | The repo already uses the **new** option names (`spanProcessors`, `metricReaders` — verified in `packages/platform/src/otel/otel.bootstrap.ts:133`), so the migration is small. But it is a **whole-tree** OTel bump and it must not be done casually mid-milestone. | **Do NOT bump during Phase 10–13 feature work.** Schedule as one isolated change with the §5.1 checklist. Staying on 0.222.0 is supported (2.x gets security fixes). |

### 0.2 The one non-negotiable for this milestone

> ### ⚠️ The AI guard is a **`JevProvider`**, not a new subsystem.
>
> `packages/contract/src/jev/jev-provider.ts` already publishes the provider seam as a **first-party named interface** (D-23) with `decide()` / `healthCheck()` and a `capabilities` array that already enumerates `'tool_selection' | 'clarification' | 'multi_turn'`. The permission-first guarantee lives in the **caller** (`routing-orchestrator.ts` filters `tools` *before* it calls `decide()`), not in the provider.
>
> An LLM-backed guard that is written as its own module with its own tool-calling loop **reintroduces the exact hole the architecture exists to close**: the model would see tools the user is not entitled to. **Implement the AI guard as a `JevProvider` whose input is the already-filtered tool list.** Then NG1's amendment costs one new provider class and zero new architecture — and the RBAC property "no input produces a routing decision that bypasses RBAC" remains testable where it already is.

### 0.3 What this document does *not* do

It does not re-derive the v1 spine, does not re-open Express-vs-Fastify, does not re-argue `jose`-vs-`@nestjs/jwt`, and does not reconsider `zca-js`. It answers: **what must be added, at what version, and what must explicitly not be added.**

---

## 1. Executive summary — the new-capability stack in one screen

| Capability | Verdict | Deciding reason |
|-----------|---------|-----------------|
| **Zalo OA adapter** | **Hand-rolled `undici` client** — confirm the v1 decision, now with a *documented* signature scheme | No official Node SDK exists. Every npm candidate is either deprecated, unlicensed, or an unofficial **personal-account** reverse-engineering library (`zca-js`) that breaks ToS and risks a ban. `zca-js` has 167K dl/wk — **volume is not legitimacy.** |
| **Zalo token lifecycle** | **New requirement v1 never faced:** OA access token lives **~25 hours**, refresh token **90 days** | This is a **scheduled refresh with a durable failure mode**, not a one-time credential. Belongs on BullMQ Job Schedulers (the existing durable-scheduler decision), never `@nestjs/schedule`. |
| **Telegram adapter** | **`node-telegram-bot-api@2.1.0`** — confirm, with a *sharpened* reason | Now **zero runtime dependencies** and ESM-only. grammy still pins `node-fetch@^2.7.0`, which is the un-instrumented HTTP path that breaks trace continuity. The v1 reason holds and got **stronger**. |
| **Two-way inbound webhooks** | **No new dependency.** Reuse `rawBody`, existing HMAC pattern, `crypto.timingSafeEqual` | The receiver contract already exists (`apps/api/src/webhooks/external/webhook-hmac.service.ts`). Zalo/Telegram are two more signature schemes on one shape. |
| **Group / directory sync — Slack** | **Slack Usergroups API** (`@slack/web-api@8.2.0`, already a transitive dep) | Slack's **SCIM API is inbound provisioning** (IdP pushes *into* Slack), not a group read. Reading groups means `usergroups.list` + `usergroups.users.list`, Tier 2 = 20+/min. **Not** a SCIM client. |
| **Group / directory sync — Teams** | **Microsoft Graph** via the **Agents SDK's existing auth**, `GET /groups/{id}/transitiveMembers` + `/groups/delta` | Graph is the only Teams directory source. `/groups/delta` avoids re-reading the whole tenant and **reduces throttling**; transitiveMembers is cost 5 RU, default page 100, max 999. Delta tokens expire **7 days** for directory objects — a durable-sync requirement, not an optimization. |
| **Group / directory sync — generic IdP** | **Deferred** — hand-roll the read; **do not** adopt a SCIM *server* library | We are not a SCIM *service provider*. Every npm SCIM package (`scimmy`, `@sdxc/scim`, `@maroonedsoftware/scim`, `permdock/scim`) implements the **inbound server** half. Building an inbound SCIM endpoint is a v3 question. |
| **Group RBAC enforcement** | **`@casl/ability@7.0.2`** — already frozen, now upgraded from per-app to **group-membership conditions** | AD-7 is amended, not replaced. CASL conditions are the mechanism that lets a group *derive* role assignment without a second authorization engine. |
| **AI guard** | **`ai@7.0.148` + a provider adapter package; `zod@4.6.7`** for schema-constrained output | AI SDK 7 is provider-agnostic, Zod-native, and reduces the guard to **one structured call over a pre-filtered tool list**. `Output.object()` + `stopWhen` + no `execute` on any tool = the model **cannot** call a tool, only choose one. |
| **AI guard model access** | **Provider-agnostic through `ai`** — do **not** add `openai`, `@anthropic-ai/sdk`, or `langchain` as a direct dep | The JEV registry exists precisely so the model is swappable. A direct vendor SDK re-creates the vendor lock-in the seam was built to avoid. `@anthropic-ai/sdk@1.0.0` shipped **today** (2026-10-21) — a `1.0.0` published hours ago is not a pin. |
| **New runtime dependency count** | **`ai` (1) + one `@ai-sdk/*` provider (1) + optional `@microsoft/microsoft-graph-client` (1)** = **3** | Telegram, Zalo, webhook HMAC, group storage, and RBAC all reuse existing stack. This is deliberately small. |

---

## 2. What is *not* changing (frozen — do not revisit)

These appear in the v2 scope discussion and must be **explicitly declined**, because each is a plausible-looking addition:

| Frozen decision | Why it stays frozen in v2 | If you're tempted… |
|---|---|---|
| **Express, not Fastify** | Unchanged. `@microsoft/agents-hosting-express` is the Teams host; Bolt 5 bundles Express 5; `instrumentation-fastify` is deprecated. | Adding a new adapter is not a reason to revisit the HTTP adapter. |
| **ioredis 6, not node-redis** | BullMQ ships ioredis. New adapters add **no** Redis client. | A Zalo/Telegram rate-limiter does not need a new Redis client — reuse the connection. |
| **Native `mongodb` driver, not Mongoose** | Group-membership documents are **not** a compile-time model either. `DirectoryGroup`/`GroupMembership` collections take the same thin typed-repository shape. | Adding Mongoose "just for the directory" would create the two-data-access-styles problem v1 rejected. |
| **`jose`, not `@nestjs/jwt`** | New webhook/token surfaces do **not** need JWT. Zalo tokens are opaque OAuth tokens; Telegram uses a secret header. | Do not mint a JWT where an opaque token is correct. |
| **`@formio/js` 5.x** | Untouched. | — |
| **Hand-written `ThrottlerStorage`** | New per-connector tiers (NFR-SEC-6) are **named throttlers on the existing storage**. | Do not add a package for a fourth named throttler. |
| **`undici` / global `fetch`, not axios** | **Load-bearing for v2.** Zalo's hand-rolled client and the Graph calls must use `undici` or they lose trace continuity (NFR-O-1). | `@microsoft/microsoft-graph-client` needs HTTP — see §5.3 for how to keep it instrumented. |
| **`@nestjs/schedule` only for sub-minute local ticks** | Zalo's 25h token refresh is **durable** and must survive a pod restart. | BullMQ Job Schedulers. Same reason as v1's key rotation. |

---

## 3. Zalo OA — the decision, re-verified

### 3.1 Candidates, as of 2026-10-21

| Package | Version | License | Last publish | Weekly dl | Verdict |
|---------|---------|---------|-------------|-----------|---------|
| *(hand-rolled `undici` client)* | — | ours | — | — | ✅ **Recommended** |
| `zca-js` | **2.2.0** | MIT | 2026-09-09 | **167,636** | 🔴 **Unofficial personal-account API.** README: *"This is an unofficial Zalo API for **personal account**. It work by simulating the browser to interact with Zalo Web."* + *"Using this API could get your account locked or banned."* Ships `tough-cookie`, `crypto-js`, `spark-md5` — browser-session emulation, not an API client. |
| `@zaloapi/oa` | **0.3.10** | *(none declared)* | **2024-03-15** | — | 🔴 **19 months stale**, no license field, single maintainer. The successor `zalo-oa` was deprecated *toward* this — into another unmaintained package. |
| `zalo-oa` | 0.7.0 | *(none)* | 2023-08-16 | — | 🔴 **npm-deprecated**: *"no longer maintained… consider `@zaloapi/oa`."* Peer-depends on `axios` + `ohash`. |
| `node-zalo-bot` | 0.1.6 | **none** | 2025-07-22 | — | 🔴 **No `license` field, no repository, no types.** Deps include `@cypress/request`, `@cypress/request-promise`, `axios`, `pump`, `eventemitter3`. Unlicensed + axios (un-instrumented) + `request`-lineage. |
| `zalo-bot-sdk`, `zalobot` | — | — | — | — | 🔴 **404 on the registry.** Do not reference these. |
| n8n community nodes (`n8n-nodes-zalo-oa-enterprise`) | — | — | active | — | 🔴 n8n-node shaped, not a library. |

**The trap in this space:** `zca-js` has ~168K weekly downloads — an order of magnitude more than most candidates — which *looks* like the ecosystem choice. It is not. It automates **personal Zalo accounts** via reverse-engineered browser session emulation. The vendor's own docs distinguish this sharply: the **official** surface is the *Official Account API*; `zca-js` violates ToS and carries a documented ban risk. **Download count measures convenience, not legitimacy.** Using it would put an enterprise deployment in breach of the platform's terms and expose it to losing the account entirely.

### 3.2 Recommended: hand-rolled client — and it is smaller than v1 estimated

v1 scoped "~200 lines over `undici`". The **verified** surface needed is smaller: token exchange/refresh, `sendMessage`, and that is essentially it (the webhook is inbound, driven by the platform).

| Concern | Decision |
|---------|----------|
| HTTP client | **`undici`** (already bundled; OTel auto-instrumented). Not axios. |
| Auth (OAuth) | `https://oauth.zaloapp.com/v4/oa/access_token` — app_id + app_secret + refresh_token → new access_token. **No OAuth library needed**; this is one POST. |
| Access token lifetime | **~25 hours.** Refresh token **90 days.** |
| Refresh scheduling | **BullMQ Job Scheduler**, repeat ~every 20h, with a `noeviction` queue. Refreshing on a cron that can miss a pod is how the adapter silently dies at 25h. |
| Refresh-token rotation | Persist the **new** refresh token atomically on every refresh. A 90-day refresh token that is not rotated is a hard expiry. Store via the existing KMS/AES-256-GCM envelope (`packages/platform/src/crypto/envelope.ts`) — this is a credential, not config. |
| Webhook signature | `X-ZEvent-Signature` — see §6.2. |
| Failure observability | Emit a metric on refresh age. An adapter that stops sending with no alert is the failure mode. |

> **Deployment note (region):** Zalo's own docs state that receiving complete user profile data requires a **Vietnam-region IP**, and the webhook requires a **verified domain over HTTPS**. This is an **infrastructure** constraint, not a library one — it belongs in Phase 10 discovery, because "the deployment's region" may be frozen by the data-residency constraint (PROJECT.md). Surface it before writing code, not after.

### 3.3 What must NOT be added for Zalo

| Avoid | Why | Use instead |
|-------|-----|-------------|
| `zca-js` | Unofficial, ToS-violating, ban risk, browser-session emulation | Official OA Open API over `undici` |
| `@zaloapi/oa`, `zalo-oa`, `node-zalo-bot` | Stale, unlicensed, or deprecated | Hand-rolled |
| `axios` for the OA calls | Breaks NFR-O-1 trace continuity — same reason v1 rejected it | `undici` |
| `@nestjs/schedule` for the token refresh | In-memory, per-instance — a refresh that doesn't run on one pod = adapter outage | BullMQ Job Scheduler |
| A Zalo-specific Redis client | Duplicates a connection serially | Reuse the existing ioredis 6 |

---

## 4. Telegram — confirm v1's choice, with a sharper reason

### 4.1 Re-verification (2026-10-21)

| Package | Version | Published | Deps | Weekly dl | Verdict |
|---------|---------|-----------|------|-----------|---------|
| **`node-telegram-bot-api`** | **2.1.0** | 2026-08-24 | **`{}` — zero runtime deps**; `"type": "module"`; ships `./dist/core/index.d.ts` | 125,420 | ✅ **Recommended** |
| `grammy` | 1.46.0 | 2026-08-26 | `debug`, **`node-fetch@^2.7.0`**, `@grammyjs/types@5.0.0`, `abort-controller` | 2,466,347 | 🔴 Rejected — unchanged reason |
| `telegraf` | 4.16.3 | **2024-02-29** | `node-fetch`, `mri`, `p-timeout`, `sandwich-stream` | — | 🔴 **2.5 years stale** |
| `telegram-bot-api` | 2.0.1 | 2020-08-10 | `bluebird`, **`request`**, `express`, `body-parser` | — | 🔴 `request` is deprecated; 6 years stale |
| `passport-telegram-official` | 3.0.0 | 2025-11-18 | `passport-strategy`; peer `passport@^0.7.0` | — | 🔴 Requires `passport`, which v1 rejected on staleness grounds |

### 4.2 Why the v1 reason survived re-verification — and got *stronger*

v1 rejected `grammy` because it depends on `node-fetch@^2.7.0`, which OTel does not auto-instrument (the bundle carries `instrumentation-undici`, not an `node-fetch` instrumentation). **Re-verified 2026-10-21: `grammy@1.46.0` still declares `node-fetch: "^2.7.0"`** — `node-fetch` itself last published 2023-07-25. So every GrammY HTTP call is an un-instrumented path, which is exactly where NFR-O-1's end-to-end trace breaks.

Two facts make `node-telegram-bot-api` **better** than v1 recorded:

1. **It now has zero runtime dependencies.** `2.0.0` (2026-08-16) was a ground-up TypeScript rewrite; `dependencies` is empty. It uses Node's global `fetch`, i.e. the same `undici` that OTel already patches. Trace continuity is therefore a **non-issue**, not merely a tolerable one.
2. **ESM-only** (`"type": "module"`) with a real `exports` map and bundled `.d.ts`. The repo is already ESM (`"type": "module"` in root `package.json`), so there is no interop tax.

> **Note the download asymmetry and do not be led by it.** `grammy` has ~20× the downloads. It is genuinely a good framework. It is still the wrong choice **for this platform**, because trace continuity is a stated NFR and GrammY's dependency is the one path that loses it. The decision is architecture-driven, not popularity-driven — record it that way so it is not re-litigated.

### 4.3 Telegram integration notes

| Concern | Decision |
|---------|----------|
| Webhook vs long-polling | **Webhook.** Matches the `InboundEvent` ingest contract (ack <200 ms, enqueue). Long-polling is a different operational shape and would bypass the receiver. |
| Delivery integrity | `X-Telegram-Bot-Api-Secret-Token` header, compared in constant time. Simple header compare — no HMAC. |
| Ack budget | Telegram retries on non-2xx. Same receiver discipline as Slack/Teams. |
| Rate limits | Telegram enforces per-chat send limits. **Do not add `bottleneck`** (`grammy`'s partner) — the existing per-connector named throttler covers it. |
| Outbound | Plain `sendMessage`. No native rendering — FormIO link only (AD-3 holds). |

---

## 5. Two-way inbound webhooks & directory sync

### 5.1 Two-way sync — no new dependency

The receiver pattern already exists and is the right one:

| Existing asset | Path | Reuse for |
|---|---|---|
| `rawBody: true` Nest config | `apps/api/src/main.ts:52` | Every signature scheme needs the *raw* bytes, not parsed JSON. Zalo's scheme requires `data` exactly as received. |
| `WebhookHmacService` | `apps/api/src/webhooks/external/webhook-hmac.service.ts` | Shape of a verify service: `verify(id, rawBody: Buffer, presentedSignature)` |
| `@RawBody()` decorator | used in `slack-webhook.controller.ts`, `external-webhook.controller.ts` | Zalo/Telegram controllers |
| `crypto.timingSafeEqual` | Node stdlib | Constant-time compare for both new schemes |

**No package is needed for the outbound notification leg.** It is an `OutboundMessage` with `action: 'status'` sent through the existing adapter interface. The two-way part is *routing the notification back to the original submitter*, which is a domain concern (`packages/domain/src/notifications/notification-assembler.service.ts` already exists), not a new dependency.

### 5.2 Group sync — Slack

**The critical distinction v1 never had to make:** Slack's **SCIM API is inbound provisioning** — the IdP (Okta/Entra) *pushes* users and groups *into* Slack. It is **not** a way for us to read the group structure. Reading Slack groups means the **Usergroups API**:

| Method | Purpose | Rate limit |
|--------|---------|-----------|
| `usergroups.list` | All user groups; `include_users: true` embeds members | **Tier 2: 20+/min** |
| `usergroups.users.list` | Members of one group (when not embedded) | **Tier 2: 20+/min** |
| `users.list` | Directory of users, `next_cursor` pagination, ≤200 recommended | Tier 2: 20+/min |

| Decision | Rationale |
|---|---|
| Use **`@slack/web-api@8.2.0`** (already present transitively via `@slack/bolt@5.1.0`) | Do **not** add a Slack SCIM client. `@slack/scim-sdk` **does not exist** on the registry (404 — verified). |
| Sync via **scheduled full read + diff** | No group-membership webhook exists for user groups. Poll on a BullMQ Job Scheduler; `usergroups.list` with `include_users:true` is one call per page. |
| **Never call `usergroups.users.update` with a partial list** | It **replaces the entire membership**. A partial payload silently removes everyone omitted. Read-only sync in v2; write-back is explicitly out of scope. |
| The `usergroups:read` scope | Request it alongside the existing bot scopes. **Read scope only** — no write scope in v2. |

### 5.3 Group sync — Microsoft Teams (Graph)

Teams has no group API of its own; it is **Microsoft Graph**. The Agents SDK already authenticates the bot, but **directory reads need an application permission** (`GroupMember.ReadBasic.All` at minimum, `Group.Read.All` for breadth) — a **different** consent than the bot's messaging permission. That gap is a Phase-11 discovery item, not a library choice.

| Endpoint | Use | Cost / limits |
|---|---|---|
| `GET /groups/{id}/transitiveMembers` | Flattened membership incl. nested groups | **Cost 5 RU.** Default page 100, **max 999**. `$count`/`$filter`/`$search` require `ConsistencyLevel: eventual` |
| `GET /groups/delta` | **Incremental** change tracking | Reduces throttling; delta token for directory objects valid **7 days**, then a full resync is required |
| `GET /users` | Resolve member → identity | Cost 2 RU; `$select` reduces cost by 1 |

**Throttling is the real design constraint**, and the numbers are documented: `application+tenant` pairs get 3,500–8,000 RU/10s (size-dependent), application-level 150,000 RU/20s, tenant-level **18,000 requests/5 min** for writes. `429` is expected under load *even below* the limits. Response: honour `Retry-After`, back off, and never retry tightly.

| Decision | Rationale |
|---|---|
| **`@microsoft/microsoft-graph-client@3.0.7`** — *optional* | Convenient typing/paging, but **last published 2023-09-19** and depends on `@babel/runtime`. Its HTTP layer needs care for OTel. |
| **Preferred: call Graph with `undici` + `@microsoft/microsoft-graph-types@2.43.1`** (types only) | Keeps the **one instrumented HTTP path**. `microsoft-graph-types` is types-only, zero runtime deps, MIT. This matches the v1 `undici`-only rule. |
| Token acquisition | Reuse the **existing OIDC/`openid-client` infrastructure** for the app-only token, or the Agents SDK's connection. **Do not add `@azure/msal-node@7.1.0`** — it depends on `jsonwebtoken`, which v1 rejected. |
| Sync cadence | `/groups/delta` on a BullMQ Job Scheduler, **well inside the 7-day token window**, with a **full resync fallback** on `410 Gone` or `syncStateNotFound`. |
| Retry | Reuse **BullMQ backoff** (the existing `notification-jitter` strategy). **Do not add `cockatiel`/`opossum`/`p-retry`** — v1 already made BullMQ the single retry mechanism. |

### 5.4 Group sync — generic IdP (SCIM): deliberately deferred

Every npm SCIM package implements the **inbound service-provider** half — an HTTP server that *receives* provisioning from Okta/Entra/Google:

| Package | Version | Last publish | Shape | Verdict |
|---|---|---|---|---|
| `scimmy` | 1.3.5 | **2025-03-05** | Full SCIM 2.0 toolkit (RFC 7643/7644) | 🟡 Honest, complete, but 19 months quiet, 35K dl/wk |
| `scimmy-routers` | 1.3.2 | **2025-01-22** | Express routers over `scimmy` | 🟡 Same vintage |
| `scim-patch` | 0.9.3 | 2026-09-06 | RFC 7644 PATCH only | 🟡 **Unlicense** — permissive but a `0.x`; 75K dl/wk. Fine as a *piece*, not as the plan |
| `@sdxc/scim` | 2026.10.16 | 2026-10-16 | Types/filters/PATCH for the **server** half | 🔴 Single-vendor, version-date scheme, `0.x`-equivalent maturity |
| `@maroonedsoftware/scim` | 1.1.4 | 2026-10-21 (today) | Koa router, server half | 🔴 Single-vendor, `<1.0` semantics, Koa (we are Express) |
| `@better-auth/scim` | 1.7.12 | 2026-10-20 | SCIM for **better-auth** | 🔴 Requires the `better-auth` framework — a whole auth stack we do not have and do not want |

**Decision: build nothing for SCIM in v2.** The requirement is **group-based RBAC**, satisfied by reading groups from Slack Usergroups and Teams Graph. An inbound SCIM endpoint is only needed if a customer's IdP must *push* into us — a different requirement, and a v3 question. Adopting a `<1.0` single-vendor SCIM server library now would add auth-surface area for a capability nobody asked for.

**If a generic directory read *is* required** (e.g. reading groups from Entra directly rather than via Teams), the right shape is a **hand-rolled read client over `undici`** against Graph `/groups` or an LDAP bind — **not** a SCIM server library. Note: `ldapjs@3.0.7` is **npm-deprecated** (*"This package has been decommissioned"*, last real publish 2023-12-01). If LDAP is ever needed, `ldapts@9.2.0` (MIT, 2026-09-15, `engines: >=22`) is the maintained successor — but **do not add it speculatively**.

---

## 6. Security primitives for the new surfaces

### 6.1 Signature verification — three schemes, one receiver shape

| Platform | Mechanism | Ack budget | Retry behaviour |
|---|---|---|---|
| Slack | `X-Slack-Signature`, `v0:` HMAC-SHA256 over `v0:timestamp:body` | 3 s, 3 retries | Existing |
| Teams | JWT via `authorizeJWT()` (Agents SDK) | — | 429/502 jitter | Existing |
| **Zalo** | **`X-ZEvent-Signature`**: `sha256(appId + data + timestamp + OAsecretKey)`; header form `mac = <hex>` | **2 s** | **5 stages:** +30 s, +5 min, +15 min, +30 min, +1 h; adds `num_retry` header. **Persistent failure → webhook is disabled and the app is unsubscribed** |
| **Telegram** | `X-Telegram-Bot-Api-Secret-Token` header compare | — | Retries on non-2xx |

**The Zalo 2-second budget is tighter than Slack's 3 seconds**, and the failure mode is worse: repeated misses **disable the webhook and unsubscribe the app**, requiring a manual re-enable in the OA console. This *raises* the importance of the existing receiver discipline — verify signature, enqueue, return — because there is no "quietly degraded" state on Zalo. Treat a `num_retry > 0` header as a metric, not noise.

### 6.2 Zalo signature — exact algorithm (verified from vendor docs)

The two documented forms **disagree in shape**, and the difference is load-bearing:

- **OA docs** describe: `mac = sha256(appId + data + timeStamp + OAsecretKey)`, where `data` is the JSON body string.
- **Mini-App / Open-API docs** describe: sort top-level keys A–Z, concatenate their **values** (objects `JSON.stringify`-ed), then `sha256(content + apiKey)`.

**Do not assume they are interchangeable.** Implement the **OA** form for the OA webhook, keep the raw body, and **cover it with a test built from the vendor's own example payload** before wiring the receiver. This is precisely the kind of thing that "looks obvious" and then fails against production traffic. Treat the exact concatenation order as a **spike item** on first live OA integration (§10).

### 6.3 Signature comparison

Use **`crypto.timingSafeEqual`** on equal-length buffers — Node stdlib, already the pattern in `webhook-hmac.service.ts`. **Do not add** a signature library (`hash-wasm`, `@noble/ciphers`). No new crypto dependency for HMAC-SHA256; `node:crypto` covers it.

### 6.4 Group RBAC with `@casl/ability@7.0.2`

AD-7 ("real-user-only RBAC in v1") is **amended**, not replaced. The mechanism:

| Layer | Change |
|---|---|
| `DirectoryGroup` / `GroupMembership` collections | New Mongo collections; thin typed repositories, same style as everywhere |
| Sync jobs | Slack Usergroups + Teams Graph → upsert memberships, **attributed to a source** (`slack` / `teams`) so a stale source is diagnosable |
| `RBAC` evaluation | A user's **effective permissions** = direct per-app grants **∪** grants derived from `perm_version`-stamped group memberships |
| **`perm_version` invalidation** | **A group membership change bumps `perm_version`.** This is the whole reason the v1 epoch primitive exists — it makes group changes take effect on the next request *without* cache-invalidation delivery, exactly as v1's per-user change does |
| Atomicity | Membership upsert + `perm_version` bump must be one logical operation; a synced membership that doesn't bump the epoch is a permission that never takes effect |

> **The subtle failure to design against:** group sync is *eventually consistent* and *event-driven from a remote system*. A membership row that lands without a `perm_version` bump leaves a user with permissions the cache will not re-read. Make the bump part of the sync write, not a follow-up job.

**No new authorization library.** `@casl/ability@7.0.2` (993K dl/wk, MIT) is already the enforcement engine.

---

## 7. The AI guard — permission-first, over an LLM

### 7.1 The contract question that must be answered first

`InboundEventSchema` is `.strict()`. Two Zalo fields have no home:

| Zalo field | What it is | Problem |
|---|---|---|
| `sender.admin_id` | The OA admin's ID, present **only** when sent via the OA chat tool | A **second identity** in an envelope documented as carrying exactly one (`chat_user_id`). It maps to a real employee. |
| `message.user_id_by_app` | A per-app user identifier usable with Social API | A **second user identifier** — two IDs for one person invites resolution ambiguity |
| `message.quote_msg_id` | The message this one replies to | Harmless, but `.strict()` rejects it |

**Recommendation:** **Do not widen `.strict()`.** Extend the contract *deliberately* in Phase 10:
1. Add an **optional `platform_metadata: Record<string, string>`** (or a discriminated per-platform sub-object) that adapters populate with non-PII, non-identity platform fields.
2. **Exclude `admin_id` from identity resolution** in v2. It identifies the *agent*, not the *requester*; treating it as a routing identity would let an OA admin's actions resolve to the wrong person.
3. Keep the "no PII on the envelope" property: `platform_metadata` must be documented as **non-PII only**, and the log allowlist must not admit it wholesale.

This is a **frozen-contract change** and belongs in the phase that owns the contract, with a failing-test-first shape — same discipline as v1's four frozen contracts.

### 7.2 Recommended: `ai@7.0.148` as a **JevProvider** implementation

| Concern | Decision | Rationale |
|---|---|---|
| Package | **`ai`** | `7.0.148`, Apache-2.0, `engines: >=22` (Node 24 ✓), peers `zod ^3.25.76 \|\| ^4.1.8` (we have **4.6.7** ✓). 18.3M dl/wk. |
| Role | **A `JevProvider`** implementing `decide()` / `healthCheck()` | The seam already exists (D-23). The guard is a *provider*, so the fallback chain, health probe, and conformance tests all apply unchanged. |
| Schema-constrained output | `generateText({ tools, output: Output.object({ schema }) })` | `generateObject` **was removed in AI SDK v6** — do not import it. Zod schema is validated by the SDK. |
| **Permission guarantee** | Pass **only the RBAC-filtered `tools` array** from `JevRequest`; **every tool has no `execute`** | A tool without `execute` cannot be invoked. The model can only **choose** one. This is how "permission-first" is enforced *structurally* rather than by prompt. |
| Tool count | **Keep ≤ 5–10 per call** (vendor guidance: "keep the number of tools low, e.g. to 5 or less") | A department rarely has more than this. If it does, **pre-filter by app_hints first** — which is the routing pipeline's existing job. |
| Multi-step / disambiguation | `stopWhen: isStepCount(n)` with a small bound | The `'multi_turn'` capability is already declared in the provider interface; bounded steps prevent runaway loops. |
| `temperature` | **0** | Deterministic choice; vendor-recommended for tool calls and object generation. |
| `strict: true` | Per-tool, where the provider supports it | Providers generate only schema-valid tool calls. Ignored where unsupported — safe to set. |
| Provider package | **`@ai-sdk/openai` or `@ai-sdk/anthropic`, chosen per deployment** | The registry exists to make this swappable. Add **one** provider package next to `ai`, chosen by the same provider-selection config the JEV registry already has. |
| Streaming | **No** | The guard returns one structured decision into a queue consumer. Streaming adds surface with no user-visible benefit in an async path. |
| Turn persistence | Existing `clarification-session.service.ts` + Redis | Multi-turn state already has a home. |
| Prompt-injection defence | The **tool list is the allow-list** — a user cannot talk a filtered tool back into existence | The structural property does the work; no prompt-hardening library is required. |

### 7.3 What must NOT be added for the AI guard

| Avoid | Why | Use instead |
|-------|-----|-------------|
| **`langchain` / `@langchain/core` / `@langchain/langgraph`** | Heavy abstraction over exactly one call shape (choose a tool from a fixed list). Pulls `langsmith` (telemetry to a third party — a **data-residency** and NFR-O conflict), plus `js-tiktoken`, `p-queue`, `mustache`. | `ai` + one provider |
| **`openai` / `@anthropic-ai/sdk` as direct deps** | Re-creates vendor lock-in the JEV seam exists to prevent. Also: **`@anthropic-ai/sdk@1.0.0` shipped 2026-10-21 — hours before this research.** A `1.0.0` that is one day old is not a pin. | `ai` + the `@ai-sdk/*` provider package |
| **`@modelcontextprotocol/sdk`** | Turns tools into an MCP server surface, i.e. makes tools **reachable**, which is the opposite of the permission-first design. | Keep tools as data in `JevRequest` |
| **`tiktoken` / `js-tiktoken` / `gpt-tokenizer`** | Token counting for a call with a ≤10-tool schema is not a cost problem at this scale. `@langchain/core` drags `js-tiktoken` in transitively — one more reason to skip LangChain. | Bound the tool count |
| **A new agent/loop framework** (`ToolLoopAgent`, custom ReAct loop) | A loop that can call tools is precisely the hole. The model chooses; the **platform** executes, under RBAC, in the routing path. | One `decide()` call |
| **`needsApproval` / `toolApproval` human-in-the-loop** | Designed for UI approval flows. The approval here is **RBAC**, already enforced before the call. | RBAC filtering |
| Any streaming/SSE surface | Async queue consumer path | Structured single response |

---

## 8. Recommended stack — the additions only

### 8.1 Core additions

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **`ai`** | **7.0.148** | AI SDK core for the JEV provider adapter | Provider-agnostic, Zod-native, `Output.object()`, `stopWhen`. One call shape. 18.3M dl/wk. |
| **`@ai-sdk/openai`** *or* **`@ai-sdk/anthropic`** | latest matching `ai@7` | **One** model provider, chosen per deployment | The swappable seam. Add exactly one. |
| **`node-telegram-bot-api`** | **2.1.0** | Telegram adapter | Zero runtime deps, ESM, uses global `fetch` (instrumented). |
| **`@microsoft/microsoft-graph-types`** | **2.43.1** | Graph response types | Types-only, zero runtime deps, MIT. Keeps HTTP on `undici`. |

### 8.2 Supporting / already-present (do **not** re-add)

| Library | Version | Already present as | Used for |
|---|---|---|---|
| `@slack/web-api` | 8.2.0 | transitive of `@slack/bolt@5.1.0` | `usergroups.list`, `usergroups.users.list`, `users.list` |
| `@casl/ability` | 7.0.2 (repo: `^7.0.1`) | direct dep | Group-derived permissions |
| `zod` | 4.6.7 (repo: `^4.6.5`) | direct dep | AI output schema, Zalo payload parsing |
| `undici` | 8.12.3 (Node-bundled) | bundled + instrumented | Zalo client, Graph calls |
| `node:crypto` | stdlib | — | `timingSafeEqual`, `createHash('sha256')` |
| BullMQ Job Schedulers | 6.3.11 (repo) | direct dep | Zalo token refresh, Slack/Graph sync, retry |
| KMS/AES-256-GCM envelope | repo | `packages/platform/src/crypto/` | Zalo refresh tokens, Graph app credentials |

### 8.3 Optional (only if convenience outweighs the HTTP-path concern)

| Library | Version | Note |
|---|---|---|
| `@microsoft/microsoft-graph-client` | 3.0.7 | Paging/auth helpers. **Caveat:** last real publish **2023-09-19**; depends on `@babel/runtime`; its fetch handler must be verified instrumented before use. Prefer `undici` + types-only. |

---

## 9. Installation

```bash
# ── AI guard (Phase 13) ────────────────────────────────────────────
# `ai` is provider-agnostic; add exactly ONE @ai-sdk/* provider.
npm install ai@7.0.148
npm install @ai-sdk/openai        # or: @ai-sdk/anthropic — pick one in Phase 13

# ── Telegram (Phase 11) ───────────────────────────────────────────
# Zero runtime deps, ESM, uses global fetch → OTel-instrumented path.
npm install node-telegram-bot-api@2.1.0

# ── Teams group sync (Phase 12) ───────────────────────────────────
# Types only. HTTP stays on undici so NFR-O-1 trace continuity holds.
npm install @microsoft/microsoft-graph-types@2.43.1

# ── Zalo (Phase 10) ───────────────────────────────────────────────
# NO PACKAGE. Hand-rolled client over undici + node:crypto.
#   - oauth.zaloapp.com/v4/oa/access_token  → token rotation
#   - openapi.zalo.me/v3.0/oa/message/cs    → sendMessage
#   - X-ZEvent-Signature → sha256(appId + data + timestamp + OAsecretKey)

# ── Slack group sync (Phase 12) ───────────────────────────────────
# NO PACKAGE. @slack/web-api is already a transitive dep of @slack/bolt.
# Confirm it is reachable; if not: npm install @slack/web-api@8.2.0

# ── Group RBAC / Redis / Mongo / webhooks ─────────────────────────
# NO PACKAGE. @casl/ability, ioredis, mongodb, node:crypto — all present.
```

**Net new runtime dependencies for all four capabilities: 3** (`ai`, one `@ai-sdk/*`, `node-telegram-bot-api`), plus one types-only package.

---

## 10. Version compatibility

| Package | Compatible with | Note |
|---------|-----------------|------|
| `ai@7.0.148` | `zod ^3.25.76 \|\| ^4.1.8` | Repo has **4.6.7** ✓. Project-wide peer range also expects `ai@7`'s `engines: >=22` — Node 24 ✓ |
| `node-telegram-bot-api@2.1.0` | Node `>=18`, **ESM-only** | Repo root is `"type": "module"` ✓. No CJS interop tax |
| `@microsoft/microsoft-graph-types@2.43.1` | Types only | No runtime, no peer constraints |
| `@microsoft/microsoft-graph-client@3.0.7` | Node `>=12.0.0` | Old but permissive; `@babel/runtime` + `tslib` come along |
| `@slack/web-api@8.2.0` | `engines: node >=20` | Repo on Node 24 ✓. Verify hoisting from `@slack/bolt@5.1.0` before adding explicitly |
| **OTel 3.0.0 / 0.300.0** | `engines: >=22.15.0`; **`@opentelemetry/api` must be `>=1.10.0 <1.11.0`** | Repo is on `0.222.0` / `core 2.11.0` / `api 1.9.1`. **Bumping is a whole-tree change — see checklist below.** |

### 10.1 OTel 0.222 → 0.300 upgrade checklist (do this as ONE isolated change, not during feature work)

Because it is a **major breaking release**, schedule it deliberately:

1. Bump `@opentelemetry/api` to **1.10.0** (3.0.0 requires `>=1.10.0 <1.11.0`).
2. Bump `@opentelemetry/core` to **3.0.0** (breaking), `sdk-node` + exporters + instrumentations to **0.300.0/0.82.0**.
3. **Removed packages:** `sdk-trace-node`, `sdk-trace-base`, `exporter-jaeger`, `propagator-jaeger`, `shim-opentracing`, `shim-opencensus`. Migrate trace types to **`@opentelemetry/sdk-trace`** (already a repo dependency).
4. **Renames already satisfied** in the repo: `spanProcessors` (✓ `otel.bootstrap.ts:133` region) and `metricReaders` (✓ line 133). Confirm no `spanProcessor`/`metricReader` singular remains.
5. **Deep imports now fail** with `ERR_PACKAGE_PATH_NOT_EXPORTED` — audit every `@opentelemetry/*/build/...` specifier.
6. `LoggerConfig.disabled` → `enabled`; `prom-client`-era assumptions void.
7. **Re-run the OTel bootstrap specs** (`otel.bootstrap.spec.ts`, `otel.bootstrap.node-ordering.spec.ts`, `allowlist-span-exporter.spec.ts`) — they already assert on `metricReaders`/`spanProcessors` and are the regression net.
8. **Do not combine** with a phase's feature work. A tracing regression is invisible until an incident.

---

## 11. Alternatives considered

| Category | Recommended | Alternative | When the alternative is better |
|----------|-------------|-------------|-------------------------------|
| Zalo client | **Hand-rolled `undici`** | `@zaloapi/oa` | Essentially never — 19 months stale, no license. Only if it suddenly gains a license + activity. |
| Zalo client | **Hand-rolled `undici`** | `zca-js` | **Never for this product.** Only for a throwaway personal-account prototype, on a sacrificial account. |
| Telegram | **`node-telegram-bot-api@2.1.0`** | `grammy@1.46.0` | If you are building a **chatbot product** with middleware/plugins and don't care about OTel trace continuity. GrammY is a better *framework*; it is the wrong *dependency* here. |
| Graph access | **`undici` + types-only** | `@microsoft/microsoft-graph-client` | If you want batching (`$batch`) or the auth providers and accept the 2023 vintage + `@babel/runtime`. |
| AI orchestration | **`ai@7` as a `JevProvider`** | LangChain / LangGraph | If the product becomes a **general agent platform** with arbitrary tool use and RAG. That is explicitly out of scope (PROJECT.md Out-of-Scope). |
| Model access | **`ai` + one `@ai-sdk/*`** | Vendor SDK directly | If one vendor is contractually locked in and you want its newest features first. The JEV registry argues against this. |
| Group sync (generic) | **Read from Slack/Graph** | Inbound SCIM server | When a **customer's IdP must push** into the platform. A v3 requirement, not v2. |
| Slack group read | **Usergroups API** | Slack SCIM API | Slack SCIM is **inbound provisioning** — it cannot read groups out. Not an alternative at all. |

---

## 12. What NOT to use — consolidated

| Avoid | Why | Use instead |
|-------|-----|-------------|
| 🔴 **`zca-js`** | Unofficial **personal-account** API; browser-session emulation; README states accounts **can be locked or banned**; violates ToS | Official OA Open API over `undici` |
| 🔴 **`@zaloapi/oa`** | **19 months stale** (2024-03-15), **no license field** | Hand-rolled |
| 🔴 **`zalo-oa`** | **npm-deprecated** by its own publisher | — |
| 🔴 **`node-zalo-bot`** | **No license, no repo, no types**; axios + `@cypress/request` | Hand-rolled |
| 🔴 **`zalo-bot-sdk` / `zalobot`** | **404 — do not exist on npm** | — |
| 🔴 **`telegraf@4.16.3`** | Last published **2024-02-29** — 2.5 years stale; `node-fetch` | `node-telegram-bot-api@2.1.0` |
| 🔴 **`telegram-bot-api@2.0.1`** | Depends on **`request`** (deprecated); 2020 vintage | Same |
| 🔴 **`grammy@1.46.0`** | Pins **`node-fetch@^2.7.0`** — the un-instrumented HTTP path; breaks NFR-O-1 | `node-telegram-bot-api@2.1.0` |
| 🔴 **`langchain` / `@langchain/core` / `@langchain/langgraph`** | Heavy for one call shape; pulls **`langsmith`** (third-party telemetry — data-residency + NFR-O conflict), `js-tiktoken`, `p-queue`, `mustache` | `ai@7` |
| 🔴 **`openai` / `@anthropic-ai/sdk` as direct deps** | Vendor lock-in the JEV seam prevents; `@anthropic-ai/sdk@1.0.0` published **2026-10-21** — not pinnable | `ai` + one `@ai-sdk/*` |
| 🔴 **`@modelcontextprotocol/sdk@1.32.1`** | Makes tools **reachable** — the inverse of permission-first. Also bundles `express-rate-limit`, `hono`, `cors` | Keep tools as data in `JevRequest` |
| 🔴 **`scimmy` / `scimmy-routers`** (~19 months quiet), **`@sdxc/scim`**, **`@maroonedsoftware/scim`** (`<1.0`, Koa), **`@better-auth/scim`** (needs `better-auth`) | All implement the **inbound SCIM server** half — not the v2 requirement | Read groups from Slack Usergroups + Graph |
| 🔴 **`@slack/scim-sdk`** | **404 — does not exist on npm** | `@slack/web-api` Usergroups methods |
| 🔴 **`axios` for any new call path** | Un-instrumented → NFR-O-1 break (v1's reason, load-bearing for Zalo & Graph) | `undici` |
| 🔴 **`@azure/msal-node@7.1.0`** | Depends on **`jsonwebtoken`** — rejected in v1 | Existing `openid-client` / Agents SDK auth |
| 🔴 **`passport-telegram-official@3.0.0`** | Requires `passport@^0.7.0` — v1 rejected `passport` as stale | Secret-token header compare |
| 🔴 **`ldapjs@3.0.7`** | **npm-deprecated**: *"This package has been decommissioned"* | `ldapts@9.2.0` **only if** LDAP is genuinely required |
| 🔴 **`cockatiel` / `opossum` / `p-retry` for sync retries** | BullMQ backoff is already the single retry mechanism; `opossum@10` floors at Node 22 and is untested here | BullMQ backoff |
| 🔴 **`@nestjs/schedule` for token refresh or sync** | In-memory, per-instance — a missed refresh = adapter outage | BullMQ Job Schedulers |
| 🔴 **`ua-parser-js@2.0.10`** | **AGPL-3.0-or-later** — v1's landmine; several UA helpers pull it transitively | Keep it pin-excluded in CI |
| ⚠️ **Bumping OTel to 3.0.0 mid-milestone** | Major breaking release; removed packages + broken deep imports; a tracing regression is invisible until an incident | Isolate as its own change (§10.1) |

---

## 13. Stack patterns by variant

**If the deployment's region is not Vietnam:**
- Zalo OA delivers **incomplete user profile data** (per Zalo's own docs: a VN-region IP is needed for full profile).
- Decide in Phase 10 whether identity resolution can work without it. If not, Zalo may need its **own region pin** — which collides with the data-residency constraint. **This is a customer question, like v1's SAML spike.**

**If a customer's IdP must push groups into the platform:**
- That is **inbound SCIM** — a v3 requirement. Do not solve it with a `<1.0` SCIM server library now.
- Interim: a scheduled read from the IdP's own API over `undici`.

**If the AI guard's tool list exceeds ~10 apps:**
- Do **not** raise the model's tool count. Pre-filter by `app_hints` / lexical match **before** the model call — the pipeline already computes these.
- This keeps the call schema small and the latency bounded.

**If the model provider must be swapped:**
- That is what the JEV registry is for. Swap the `@ai-sdk/*` provider package and the provider config. **No change to the guard, the router, or the RBAC filter.**

**If a group membership must be revoked immediately:**
- Bump `perm_version` at the sync write (§6.4). Do **not** add a cache-invalidation message path — v1's ruling stands: Pub/Sub is a latency optimization, never the correctness mechanism.

---

## 14. Confidence summary

| Area | Confidence | Why |
|------|-----------|-----|
| **Zalo — no SDK, hand-roll** | **HIGH** | Every npm candidate verified: deprecated, unlicensed, or unofficial-personal. The decision is forced, not chosen. |
| **Zalo — signature scheme** | **HIGH on mechanism, MEDIUM on exact concatenation** | Scheme is documented (`X-ZEvent-Signature`, `sha256(appId+data+timestamp+secret)`) — **S2's unknown is closed**. But the OA and Mini-App docs describe *different* concatenations; pin the exact form against a vendor example before Phase 10 closes. |
| **Zalo — token lifecycle** | **HIGH** | 25h access / 90d refresh are documented. The *durable scheduling* requirement follows directly from v1's existing decision. |
| **Telegram — `node-telegram-bot-api`** | **HIGH** | Zero runtime deps + ESM + global `fetch` verified from the registry tarball metadata. v1's reason re-verified as still true for grammy. |
| **Two-way webhooks** | **HIGH** | Reuses three existing assets; no new dependency. |
| **Slack group sync** | **HIGH** | Usergroups API is documented, Tier 2 limits known; the SCIM-is-inbound distinction is a documented Slack fact, not an inference. |
| **Teams group sync** | **HIGH on mechanism, MEDIUM on consent** | Endpoints, RU costs, page sizes, 7-day delta window all documented. The **application permission** needed for directory reads (vs the bot's messaging consent) is a tenant-config discovery item. |
| **Generic SCIM** | **HIGH on "defer"** | Every package is an inbound-server; the requirement is an outbound read. |
| **Group RBAC** | **HIGH** | `@casl/ability` already frozen; the only new mechanism is the `perm_version` bump, which is an application of an existing primitive. |
| **AI guard — `ai@7` + JevProvider** | **HIGH on the approach, MEDIUM on the model choice** | API shape verified from vendor docs (`Output.object`, `stopWhen`, `inputSchema`, `generateObject` removed in v6). Which provider package to add is a Phase-13 decision, not a research gap. |
| **OTel 3.0 migration** | **HIGH on contents, MEDIUM on effort** | Breaking-change list is explicit; repo already uses the new option names. Effort is bounded but must be isolated. |

---

## 15. Gaps, spikes, and what could not be verified

### 15.1 Spikes required before the phase that depends on them

| ID | Question | Blocks | Why it can't be resolved by reading | Resolution |
|----|----------|--------|--------------------------------------|------------|
| **S2′** | **Zalo OA live integration spike.** Authenticate, refresh a token, send a message, receive + **verify** a webhook against a real OA. | **Phase 10** | The docs give two *different* signature concatenations (§6.2) and no changelog discipline. Only a live OA settles which the platform actually sends. Also settles API stability. | **2-day spike on a real OA.** Budget contingency. This replaces v1's S2, which is now **partially closed** (scheme known; exact bytes unconfirmed). |
| **S4** | **Teams Graph directory consent.** Which application permission (`GroupMember.ReadBasic.All` vs `Group.Read.All`) is grantable in the target tenant, and whether admin consent is obtainable. | **Phase 12** | A tenant-policy question, not a docs question. Admin consent is a **customer** action. | **Ask in Phase 10 discovery.** A blocked consent means Teams group sync degrades to Slack-only. |
| **S5** | **Zalo region requirement.** Does the deployment region permit a Vietnam-region egress for full profile data, and does that collide with the data-residency constraint? | **Phase 10** | A deployment/customer question. | **Phase 10 discovery.** |
| **S6** | **AI provider selection.** Which provider, which model, which host — and does it satisfy data-residency? | **Phase 13** | Explicitly out of scope for stack research (v1 §15.3 already recorded this). | **Phase 13**, using the JEV registry. |

### 15.2 Unverified or deliberately deferred

| Item | Status | Note |
|------|--------|------|
| **Zalo signature exact concatenation** | ⚠️ **MEDIUM** | Two documented forms. Implement from a vendor example payload + test. **S2′.** |
| **Zalo API stability** | ⚠️ **Unknown** | No official changelog. The hand-rolled client is an **ongoing** maintenance liability — monitor for an official Node SDK. |
| **Zalo OA free-tier messaging quota** | ⚠️ **Partially verified** | Community sources report free-tier limits and a 7-day interaction window. **Verify against the vendor's current pricing page in Phase 10** — it changes. |
| **Slack usergroups write-back** | ✅ **Deliberately out of scope** | `usergroups.users.update` replaces the whole membership; read-only in v2. |
| **`@microsoft/microsoft-graph-client` OTel instrumentation** | ⚠️ **Unverified** | Assumed un-instrumented. That assumption is why `undici` + types-only is preferred. If the client is used, verify the fetch path is patched. |
| **Teams delta `410 Gone` handling** | ⚠️ **Documented, untested here** | Requires a full-resync fallback. Test in Phase 12 with a forced token invalidation. |
| **`permdock/scim`, `@sdxc/scim`, `@maroonedsoftware/scim`** | ⚠️ **Not evaluated in depth** | All are server-half; deferring the whole capability made deep evaluation unnecessary. Revisit only if inbound SCIM becomes a requirement. |

### 15.3 What this document does not cover

- **Infrastructure-as-code** for the VN-region egress and webhook domain verification (Phase 10 discovery).
- **Connector contracts** for new downstream systems — per-system, per-phase.
- **The AI model's cost/latency profile** — Phase 13.
- **Load characteristics of group sync** at tenant scale — measure in Phase 12; the Graph RU budgets are the input.

---

## 16. Sources

- **`registry.npmjs.org`** — `dist-tags.latest`, `time[version]`, `time.modified`, `license`, `deprecated`, `engines`, `dependencies`, `peerDependencies` — every version in this document resolved live on **2026-10-21**
- **`api.npmjs.org/downloads/point/last-week/*`** — download counts for `zca-js`, `node-telegram-bot-api`, `grammy`, `ai`, `@casl/ability`, `scimmy`, `scim-patch` (week of 2026-10-12)
- **`docs.zaloplatforms.com/docs/OA/webhook/tong-quan`** — OA webhook overview: HTTPS-only, verified domain, **2-second** ack, 5-stage retry (+30s/+5min/+15min/+30min/+1h) with `num_retry`, webhook-disabled consequence
- **`docs.zaloplatforms.com`** — `X-ZEvent-Signature` description; OA event payload (`sender.admin_id`, `message.user_id_by_app`, `quote_msg_id`)
- **`docs.zaloplatforms.com/docs/MA/openApis/open/webhook/verifysignature`** — the *alternative* Mini-App concatenation (sort keys A–Z, concat values, `sha256(content + apiKey)`) — recorded to explain the §6.2 discrepancy
- **Zalo OA community/operational sources** (2026) — 25h access token / 90d refresh token, free-tier messaging quota, VN-region IP for full profile data
- **`npmjs.com/package/zca-js`** — README verbatim: *"unofficial Zalo API for personal account… simulating the browser… account locked or banned"*; v2.2.0, MIT
- **`learn.microsoft.com/graph/throttling-limits`** — ResourceUnit costs: `groups/{id}/transitiveMembers` = 5, `users` = 2; app+tenant 3,500–8,000 RU/10s; tenant 18,000 req/5min writes
- **`learn.microsoft.com/graph/api/group-list-transitivemembers`** — default page 100, max 999; `ConsistencyLevel: eventual`
- **`learn.microsoft.com/graph/delta-query-overview` / `delta-query-groups`** — delta tokens valid **7 days** for directory objects; `410 Gone` → full resync; replays expected
- **`docs.slack.dev/reference/methods/usergroups.list` / `usergroups.users.list`** — Tier 2 = 20+/min; `include_users`
- **`docs.slack.dev/reference/scim-api` + `/scim-api/rate-limits`** — SCIM is **inbound provisioning**; group/user endpoint limits; full-replace semantics of group updates
- **Slack usergroup drift-audit guidance (community, 2026)** — `usergroups.users.update` **replaces the entire membership list**; compute the full target set
- **`ai-sdk.dev/v6/docs/ai-sdk-core/tools-and-tool-calling`** — `inputSchema`, no-`execute` tools, `strict`, `needsApproval`/`toolApproval`, `stopWhen`, `isStepCount`
- **`ai-sdk.dev/v6/docs/ai-sdk-core/generating-structured-data`** — `Output.object()`, structured output + tools in one call, `generateObject` removed in v6
- **`ai-sdk.dev/v6/docs/ai-sdk-core/prompt-engineering`** — keep tools ≤ ~5; `temperature: 0` for tool calls and object generation
- **`github.com/open-telemetry/opentelemetry-js` releases (v3.0.0 / experimental 0.300.0, 2026-10-20)** — removed `sdk-trace-node`/`sdk-trace-base`/`exporter-jaeger`/`propagator-jaeger`; `ERR_PACKAGE_PATH_NOT_EXPORTED` for deep imports; `spanProcessor`→`spanProcessors`; Node `>=22.15.0`; requires `api >=1.10.0 <1.11.0`
- **Repo evidence (read, not assumed):** `packages/contract/src/events/inbound-event.ts` (`.strict()`, `zalo`/`telegram` already in the platform enum), `packages/contract/src/jev/jev-provider.ts` (first-party seam, `capabilities` incl. `multi_turn`), `apps/api/src/main.ts:52` (`rawBody: true`), `apps/api/src/webhooks/external/webhook-hmac.service.ts`, `packages/platform/src/otel/otel.bootstrap.ts:133` (`metricReaders`), `packages/domain/src/authz/rbac.service.ts`, `packages/domain/src/notifications/notification-assembler.service.ts`

---

*Stack research for: aka-nexa v2 — Zalo OA, Telegram, two-way inbound sync, group/directory RBAC, permission-first AI guard*
*Researched: 2026-10-21*
