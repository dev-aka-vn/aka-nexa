# Feature Landscape — v2 Platform Expansion (Zalo OA + Telegram + Two-Way Sync + Group RBAC + AI Guard)

**Domain:** Enterprise IM gateway — platform expansion and capability extension of an existing v1 chat front-door
**Project:** IM-Driven App Builder & Integration Gateway (`aka-nexa`)
**Milestone:** v2 — Phase numbering continues from v1 (starts at **Phase 10**)
**Researched:** 2026-10-21
**Confidence:** MEDIUM-HIGH (HIGH on platform mechanics — all vendor facts below were fetched from first-party docs; MEDIUM on AI-guard design, which is a design synthesis, not a vendor-documented pattern)
**Mode:** Ecosystem (feature landscape for new v2 features)

**Scope of this document.** v1 shipped Slack + Teams, plain-language JEV routing, signed links, FormIO.js renderer +
App Builder, per-app RBAC on real users, a connector layer with outbox/BullMQ/DLQ, an audit trail, OTel observability,
and production-readiness tooling. **This document covers only the four new v2 capability areas** requested by the
orchestrator: Zalo OA, Telegram, two-way inbound webhooks, group/directory RBAC, and the permission-first open-ended
AI guard. It does not re-derive v1 features; it grades the *new* surface as table stake / differentiator / anti-feature,
prices each with complexity, and names the v1 assets each one leans on.

**Confidence note.** The `research-plan` seam routed all five questions to `context7` + `websearch`.
`classify-confidence` returns **MEDIUM** for `context7` and **LOW** for `websearch`. Every vendor-mechanics claim below
was therefore re-fetched from the vendor's own documentation (developers.zalo.me, docs.zaloplatforms.com,
core.telegram.org, api.slack.dev, learn.microsoft.com) and is marked **[doc-verified]**. Claims resting on
aggregated search results alone are marked **[MEDIUM]** and are never used to justify a scope decision. Findings
that could not be verified are listed in §Gaps.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Missing any of these means the v2 milestone does not read as "the same product, on more platforms."

#### A. Zalo OA adapter

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| **Zalo OA inbound webhook receiver** — POST endpoint, verify `X-ZEvent-Signature`, normalize to `InboundEvent` | An OA that users can talk to is the entire point of the Zalo adapter. Without a receiver there is no adapter. | **M** | Signature is `sha256(appId + data + timeStamp + OAsecretKey)` over the **raw JSON body string** **[doc-verified]**. This is a *concatenation-hash*, not an HMAC — it is length-extension-prone and must be computed over the exact raw bytes, not a re-serialized object. |
| **2-second ack, then enqueue** | Zalo requires HTTP 200 for **all** webhook events within a **maximum of 2 seconds**; failure produces an "inactive webhook" notice to the app owner's Zalo account **[doc-verified]** | **S** | This is **stricter than Slack** (3 s) and **looser than the project's own `<200 ms` rule** — the v1 constraint is the binding one. Ack-then-enqueue is unchanged; only the deadline differs. |
| **Retry-tolerance (5 retries: 30 s, 5 m, 15 m, 30 m, 1 h)** | Zalo retries failed deliveries with a `num_retry` header, and *disables the webhook registration* if the retries are also missed **[doc-verified]** | **M** | `num_retry` is the only retry signal — there is no per-event retry count in the body. The same event arrives **byte-identical**, so the idempotency key must be `message.msg_id`, not a hash of the payload. |
| **Inbound event coverage — text, image, link, audio, video, sticker, location, business card, file** | Users send all of these from a Zalo chat window; dropping any means silent data loss | **M** | `event_name` values are enumerated and **fixed**: `user_send_text`, `user_send_image`, `user_send_link`, `user_send_audio`, `user_send_video`, `user_send_sticker`, `user_send_location`, `user_send_business_card`, `user_send_file` **[doc-verified]**. Note there is **no `user_send_voice`** — audio and video are separate. |
| **Text-first routing only; non-text is a typed "unsupported" acknowledgement** | The v1 product is form-driven — it needs text intent, not media understanding | **S** | Map non-text events to `InboundActionSchema`'s existing `'message'` action with an adapter-supplied text stub ("[image]") so the envelope stays `.strict()`-valid, and have the consumer reply with the supported-actions list. Do **not** extend `InboundEvent` with media fields — that is a contract change for a case the product does not serve. |
| **1:1 consultation-message reply (`Tin Tư vấn`)** | The OA's reply channel to a user who messaged the OA | **M** | **The 7-day rule:** a consultation message may only be sent to a user who has interacted with the OA within the last **7 days** and has not blocked it **[doc-verified]**. The live quota API (`POST /v3.0/oa/quota/message` with `user_id`) returns `last_interaction`, `cs_reply.remain` (free consultation sends), and `promotion.daily_remain` / `monthly_remain` **[doc-verified]**. **The notification path must consult this before sending, not discover the failure afterwards.** |
| **OA access-token lifecycle (OAuth → access token + refresh token)** | Zalo access tokens expire; a dead token means a dead adapter | **M** | OAuth authorization-code flow, `access_token` header on every `openapi.zalo.me` call, refresh-token exchange **[doc-verified]**. Token refresh must be **KMS-encrypted at rest** and refreshed with a lock so concurrent workers do not race (v1 constraint: secrets KMS-backed, AES-256-GCM). |
| **Follow / unfollow events** | Follow state gates who can be messaged and is the OA's only user-list primitive | **S** | `event_name: "follow" \| "unfollow"` with `follower.id` and `source` (`oa_profile`, `message_invite`, `social_plugin`) **[doc-verified]**. |
| **Send API with the correct message class per recipient** | Sending the wrong message class silently fails or bills the wrong quota pool | **M** | Three classes **[doc-verified]**: **Tin Tư vấn** (consultation — 7-day window), **Tin gửi vào Nhóm chat GMF** (group, needs group-management permission), **Tin Broadcast** (followers only). **Transactional template messages (ZBS) are a paid, templated product with its own quota and approval — explicitly out of scope.** |

#### B. Telegram adapter

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| **Telegram inbound webhook receiver + `secret_token` verification** | Webhook mode is the only mode compatible with the project's stateless, horizontally-scaled deployment | **M** | `setWebhook` with `secret_token` (1–256 chars, `A-Z a-z 0-9 _ -`) arrives as header `X-Telegram-Bot-Api-Secret-Token` **[doc-verified]**. `getUpdates` and a webhook are **mutually exclusive** **[doc-verified]** — polling is not a fallback, it is an either/or. |
| **Slash commands** — `/help`, `/leave`, etc., scoped to the platform | Telegram users expect `/command` and the platform menu button; v1 already has the slash-command concept | **M** | `setMyCommands` supports up to **100 commands per scope** across 7 scopes (`default`, `all_private_chats`, `all_group_chats`, `all_chat_administrators`, `chat`, `chat_administrators`, `chat_member`) **[doc-verified]**. ⚠️ **Telegram's own docs state that updates "may contain commands that don't exist at all in your bot" and carry no scope information — "your backend should always verify that received commands are valid and that the user was authorized to use them regardless of scope"** **[doc-verified]**. **Command registration is a UX affordance, never an authorization boundary.** |
| **Inline keyboards** for disambiguation choices and clarifications | A clarification that requires typing "2" is materially worse than tapping a button | **M** | `InlineKeyboardMarkup` with `callback_data` capped at **1–64 bytes** **[doc-verified]**. `answerCallbackQuery` shows a toast (text ≤ 200 chars) or `show_alert` modal **[doc-verified]**. |
| **Message editing** (`editMessageText`) for link replacement and status updates | A form link that expires should be *edited in place*, not re-sent as a second message | **S** | `text` is 1–4096 chars after entity parsing **[doc-verified]**. |
| **Privacy-mode awareness** | A Telegram bot in privacy mode receives almost nothing in groups — a silent, total failure | **S** | Privacy-enabled bots receive general commands (and only group messages if the bot was the last bot to post in that group); privacy-disabled bots receive all messages except those from other bots **[doc-verified]**. **The adapter must detect and report "bot cannot see group messages" rather than appearing broken.** |
| **Send-rate discipline** | Telegram enforces per-chat and per-group limits | **S** | **30 messages/second** broadcast-wide (raisable to 1000/s via paid broadcasts); **20 messages/minute in a group** **[doc-verified]**. `node-telegram-bot-api@2.1.0` exposes `retryDelayMs` and `conflictRetryDelayMs` for 429/409 backoff **[doc-verified]** — but the platform's own named throttler tiers (10/user/min, 100/app/min) are *stricter* and must still be enforced independently. |
| **`message_thread_id` / `reply_parameters` for reply threading** | FR-IM-8 requires responses in the same thread where supported | **S** | `message_thread_id` targets a forum topic (supergroups and bot private chats with forum mode); `reply_parameters` carries a structured reply reference **[doc-verified]**. |

#### C. Two-way inbound webhooks (notifications back to the submitter)

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| **Signed inbound webhook endpoint** (external system → platform) | FR-N-1/FR-N-2. Without it, "two-way sync" is one-way with extra steps | **M** | HMAC-SHA256 over the raw body, plus **timestamp + nonce replay protection** (FR-N-8). The v1 pattern already exists for IM platforms; the external-webhook variant adds a **per-connector secret** and an **entity-ID → `submission_id` mapping**. |
| **Notification delivery to the original submitter** | FR-N-3 — the whole point of two-way sync | **M** | The v1 `NotificationAssemblerService` already resolves a `real_user_id` → platform identity mapping and assembles an `OutboundMessage`; the new work is **binding the submitter's platform + conversation + thread identity onto the submission record at submit time** so the notification can be routed back to the right chat, thread, and user. |
| **Idempotency on redelivery** — dedupe by external event ID | Every IM platform retries; Slack retries **3 times** (~immediately, 1 min, 5 min) with an `x-slack-retry-num` header **[doc-verified]**, Zalo retries **5 times** (30 s/5 m/15 m/30 m/1 h) with `num_retry` **[doc-verified]**, Telegram retries on non-2xx **[doc-verified]** | **M** | **Every platform is at-least-once.** The v1 `InboundEvent` already carries `event_id` and `attempt`; v2 needs a **dedupe store keyed on the platform's native event identity** (`Slack event_id`, `Telegram update_id`, `Zalo msg_id`) so a redelivered webhook produces one notification, not three. This is v1 Pitfall 7 made concrete. |
| **Reply/thread semantics per platform** | A status update that lands as an unrelated top-level message is a support ticket | **M** | Slack: `chat.postMessage` with `thread_ts` to reply, `reply_broadcast` to also surface in the parent channel **[doc-verified]**. Telegram: `reply_parameters` / `message_thread_id` **[doc-verified]**. Zalo: `quote_msg_id` on the inbound payload marks a reply; there is no thread primitive on a 1:1 OA chat — **the notification is a new message in the OA chat window**. Teams (v1): already threaded. **The per-platform difference is the feature work; a uniform "reply" that silently degrades to a top-level message on Zalo is a defect.** |
| **Delivery failure visibility** | FR-IM-7 — "Users MUST NOT see silent failures" | **S** | The v1 notification queue already has a 3-attempt retry and a DLQ (FR-N-6). v2 needs the **dead-letter to be observable** (a metric + an admin surface), because a failed back-notification is silent to the submitter. |
| **Notification deep link back to the submission** | FR-N-3 says "with a deep link" — the signed read link already exists in v1 | **S** | Reuse the v1 signed stateless read link with `perm_version` checked fresh. **Do not invent a notification-specific link type.** |

#### D. Group-based RBAC (directory / group sync)

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| **Group → role binding per app** | The v1 model is one-role-per-user per app (FR-R-2). Group binding is what makes an app usable by a department without 50 admin clicks. | **M** | The binding is **app-scoped**: `app_id` + group identity → role. v1's `builder-ability.ts` already models `role-assignments` and `roles-permissions` sections; this adds a **principal-kind** (`user` \| `group`) to the assignment shape, not a new permission model. |
| **Membership read per platform** | A group binding is worthless without knowing who is in the group | **M** | Slack: `usergroups.list` (scope `usergroups:read`, Tier 2 rate limit) + `conversations.members` (cursor-paginated) **[doc-verified]**. Teams: Graph `GET /teams/{team-id}/members` and `GET /teams/{team-id}/channels/{channel-id}/allMembers` **[doc-verified]**. Telegram: `getChatMember` / `getChatMemberCount` — **only guaranteed to work for other users if the bot is an administrator in the chat** **[doc-verified]**. Zalo: `GET /v3.0/oa/group/conversation` returns messages, and the group-message send API requires the app to hold group-management permission **[doc-verified]**. ⚠️ **Zalo exposes no documented "list all members of a group" API** — this is a real gap (see §Gaps). |
| **Join / leave event handling** | Event-driven sync is cheaper and fresher than polling | **M** | Slack: `member_joined_channel` / `member_left_channel` / `group_join` / `group_leave` / `user_change` **[doc-verified]**. Telegram: `chat_member` updates carry `old_chat_member` → `new_chat_member` with `member`/`left`/`kicked`/`restricted`/`administrator` states — **but only if the bot is an administrator AND `"chat_member"` is explicitly in `allowed_updates`** (an empty `allowed_updates` list excludes `chat_member`) **[doc-verified]**. Zalo: `user_join_group` / `user_out_group` / `accept_request_join_group` events carry `oa_id`, `group_id`, and a `users[]` array **[doc-verified]**. |
| **Stale-membership handling** | Every IM platform's membership is eventually-consistent, never authoritative. A user who left the group 3 days ago must not still hold the role. | **M** | Three mechanisms, all required: (1) **event-driven invalidation** on leave/remove; (2) **periodic full reconciliation** per bound group (a BullMQ Job Scheduler, not `@nestjs/schedule` — v1 constraint); (3) **a bounded-staleness rule** — membership older than a configurable window is treated as *unverified* and either re-fetched or dropped. v1 Pitfall 4 (`perm_version` covers 1 of 7 revocation events) already identifies "group membership revoked" as a **missing revocation event** — group RBAC is where that gap is closed. |
| **Directory sync (SCIM / Entra ID) as an optional upstream** | Group membership sourced from an IM platform is a proxy; the HR directory is the truth | **L** | Slack SCIM v2 exposes `/Users` and `/Groups` with `PATCH`/`DELETE` **[doc-verified]**. Entra ID → Slack provisioning via SCIM is the mainstream pattern **[MEDIUM — corroborated by Slack Help + Entra tutorials, not from a single first-party spec]**. **Scope this as an optional upstream, not a v2 requirement** — it is the largest single cost in this group and the least differentiating. |
| **Effective-permission resolution with a precedence rule** | A user in two groups mapped to different roles needs one answer | **M** | Define precedence explicitly: **union of group-derived permissions** (a user is granted the union of all their groups' roles for that app), with explicit **user-level assignment taking precedence for conflicts** if any deny model exists. v1's `RbacService` is currently a stub with hardcoded grants; v2 needs the real resolver. |
| **Audit trail for group-driven grants and revocations** | FR-AU-1/2 — every state-changing action is audited; a group grant *is* a state-changing action | **S** | The v1 append-only audit store records the actor as `real_user_id`. **Group-derived grants need an actor of "system"** (the sync job) plus the group identity — otherwise every synced grant looks like an unauthorized self-grant. |

#### E. Permission-first open-ended AI guard

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| **The guard never sees an unauthorized tool** | This is the amendment to PRD **NG1**, and it is the *entire* safety story. The model must not even be able to see that an unauthorized app exists. | **M** | The mechanism already exists in v1: `RoutingOrchestrator` filters `app_hints` against `authorizedTools` and refuses to build a request from the global catalogue (`T-03-01`) **[code-verified in `packages/domain/src/decision/routing-orchestrator.ts`]**. **The v2 AI guard plugs into this same seam — it does not build a parallel path.** |
| **The guard never invokes anything** | The model *chooses*; the platform *executes* | **S** | The v1 boundary is already correct: `RoutingOrchestrator` returns `{kind:'link', toolId}` or `{kind:'clarify', toolIds}` — a **selection**, and `canOpenNow(toolId)` re-checks permission at the execution boundary **[code-verified]**. A v2 guard that emits a tool *call* would be a regression, not a feature. |
| **Clarification prompts with bounded multi-turn** | "Which do you mean?" is the difference between a working assistant and a dead end | **M** | **The v1 groundwork is already built**: `ClarificationSessionService` caps at **2 replies** and **3 displayed choices**, keys state on `realUserId:channelId:threadTs` in Redis with a **15-minute TTL**, re-filters displayed choices on every reply so a revoked app disappears mid-conversation, and escalates to authorized examples + slash commands after 2 replies **[code-verified in `packages/domain/src/decision/clarification-session.service.ts`]**. **v2 adds the AI-generated clarification *text* on top of this session machinery — it does not replace it.** |
| **Disambiguation between high-confidence alternatives** | Two apps scoring 0.91 and 0.89 need a tie-break, not a coin flip | **M** | FR-J-9 already requires presenting disambiguation options when alternatives fall within 10% of the top. **The v2 addition is the *interaction surface***: Telegram inline keyboard, Slack buttons, Zalo numbered list. **Telegram `callback_data` is capped at 1–64 bytes** — a candidate list must be encoded as a short token resolved server-side, never as inline JSON. |
| **Multi-turn context carried across turns** | "Actually, make it two days" only works if the prior turn survives | **M** | `JevContextSchema.previous_turns` already exists as `Turn[]` with `role: 'user' \| 'assistant'` — **note the closed role set: there is no system turn** **[code-verified in `packages/contract/src/jev/v1/jev-request.ts`]**. `JevState.turn_count` exists and `force_clarification` is the platform's own clarification hook. **The gap is ordering, not schema**: v1 Pitfall 7 establishes that IM platforms deliver out of order, so `previous_turns` can be silently wrong. |
| **Confidence-gated abstention with a deterministic fallback** | A gateway that guesses is worse than one that asks | **S** | The v1 gate is already correct: `verified !== true` → clarify, below-threshold confidence → clarify, a competing permitted alternative → clarify, `tools.length === 0` → clarify, expired deadline → clarify **[code-verified]**. The `JevResponse.choice.verified` tri-state (`true` / `false` / `null`) separates *abstention* from *low confidence* — **`null` is not "low confidence", it is "the model declined"** **[code-verified]**. |
| **Every displayed choice is re-authorized at display time** | A revoked app must not stay visible in an open clarification session | **S** | Already enforced by v1's D-48/D-50 rules **[code-verified]**. **v2 must preserve this under group RBAC**, where revocation now has a second trigger (group membership loss) — see the dependency note below. |

---

### Differentiators (Competitive Advantage)

Features that set the product apart. Not expected by users, but valued — and, in this milestone, the reason the
work is worth doing rather than merely defensible.

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| **One normalized contract across four platforms with genuinely different delivery semantics** | Slack has threads and buttons, Telegram has inline keyboards and callback queries, Zalo has *neither* — it has a 7-day consultation window, a quota model, and quote-replies. Most gateway products pick one platform's semantics and bolt on the rest. Doing the *translation honestly* — including degrading gracefully where a platform cannot thread — is the differentiator. | **L** | This is only credible because v1 froze `InboundEvent`/`OutboundMessage` as `.strict()` Zod envelopes with an `ImPlatformSchema` that already includes `'zalo'` and `'telegram'` **[code-verified]**. The differentiator is not the adapter code; it is that the **same** product behaves correctly on a platform with no threads and a 2-second ack budget. |
| **Permission-first AI guard — the model chooses, it never invokes** | Most conversational-AI gateways give the model a tool-calling API and let it decide what to run. That reverses the v1 architecture's central claim (AD-1) and makes "which tools does this user see" a model-discretion question instead of a platform-enforced invariant. A guard where **the platform pre-filters, the model selects from the filtered set, and the platform executes** is a genuinely different posture — and it is one an enterprise security reviewer will recognise as correct. | **M** | **The v1 architecture already earned this claim.** The v2 work is to extend it to open-ended phrasing *without weakening it*. The headline claim is unchanged; only the input space widens from "app names" to "free-text intent". |
| **Two-way sync that lands in the right thread, with the right submitter's identity** | The failure mode of naive two-way sync is a status update appearing as an orphan top-level message in a channel, sent to a *different* person than the one who filed the request. Getting `thread_ts` / `reply_parameters` / Zalo quote-reply right, and binding submitter identity at submit time, is invisible when it works and infuriating when it doesn't. | **M** | The v1 `NotificationAssemblerService` already resolves identity mappings and assembles `OutboundMessage`s; v2's job is to **bind the conversation context at submit time**, not to rebuild the assembler. |
| **Group RBAC with revocation that actually revokes** | The tempting version of group RBAC is "map group → role, done". The real version handles **stale membership** (a user who left the group three days ago must lose the role), **group-scoped role precedence**, and **audit attribution that doesn't blame the user for a sync job's grant**. Shipping the naive version means a **security hole that looks like a feature**. | **M** | This is where v1 Pitfall 4 (`perm_version` covers 1 of 7 revocation events) is finally paid off. The differentiator is the *revocation* half, not the *grant* half. |
| **A Zalo adapter built to Zalo's actual rules rather than a Slack-shaped clone** | Zalo's 7-day consultation window and per-user quota are *the* constraint that determines whether a notification ever lands. A naive adapter sends, fails silently, and ships a product that appears broken in exactly the market it was built for. | **M** | Requires reading the quota API before sending (`POST /v3.0/oa/quota/message` → `last_interaction`, `cs_reply.remain`, `promotion.daily_remain`) **[doc-verified]** and encoding "user outside the 7-day window" as a distinct, *visible* outcome rather than a generic send failure. |
| **Graceful degradation on Telegram privacy mode** | A bot in a Telegram group with privacy mode on receives almost nothing, and the failure is silent. Detecting it and saying so ("the bot can't see messages in this group — ask an admin to disable privacy mode") is a small feature that prevents a category of "it's broken" support tickets. | **S** | Cheapest differentiator in the set. |

---

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good in a feature brainstorm and create real problems. Listed here so the roadmap does not
accidentally absorb them.

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Open-ended free-form chat / a general assistant** | NG1 was the PRD's explicit non-goal; "add AI" is the easiest thing to put on a roadmap | It contradicts PRD **NG1** and v1's core value ("the form-plus-integration pair is the product"). Free generation produces claims with no verifiable source, which in an enterprise HR/ERP context is a liability. | **The v2 amendment**: a *guard* — the model classifies intent against a **pre-filtered, permission-bounded** tool set and either selects a tool, asks a bounded clarification, or abstains. **No free generation. Ever.** |
| **Giving the model a tool-calling / function-calling API** | It is the standard pattern every LLM framework advertises; it looks more "powerful" | It **reverses AD-1**. The model becomes the thing that decides which tools are reachable, so "does this user see the HR app" becomes a model-discretion question. It also makes the permission boundary untestable by a unit test. | Model output is a **selection** (`toolId` + `confidence`), validated against the authorized set by the platform. The platform — not the model — issues the link. This is already v1's `RoutingOrchestrator` shape; keep it. |
| **Auto-executing a form submission from the AI guard** | "Just file it for me" is what users want from an assistant | It bypasses the one-time-link, form-render, and consent model entirely (AD-3, AD-11). It also means a hallucinated field value writes real data into a downstream ERP. | The guard **always** ends in a signed link → the FormIO.js form → the user submits. **The form is the consent surface.** Do not shorten it. |
| **Native IM form rendering (Block Kit, inline keyboards as forms, Zalo Mini App forms)** | Users hate leaving the chat window; every platform is pushing native form UI | Contradicts **NG3** and AD-3 ("FormIO.js everywhere, one engine"). A second renderer is a second set of validation rules, a second accessibility story, and a second set of bugs. | One renderer, one engine, one set of validation semantics. **Inline keyboards are for *disambiguation choices* (2–3 options), not for form fields.** That distinction is the line. |
| **Real-time group membership sync with zero staleness** | "The permission should be exactly right at every instant" | IM platforms expose membership **eventually**, not instantaneously, and all four deliver events at-least-once and out of order. Zero staleness is not implementable against Slack/Teams/Telegram/Zalo event streams. | **Bounded staleness** with three mechanisms: event-driven invalidation + periodic full reconciliation + a max-staleness window that triggers a re-fetch. Document the bound; make it observable. |
| **Broadcasting notifications to an entire IM group** | "The whole team should see this" | Leaks one person's submission status to everyone, breaks FR-N-3's "the original submitter" model, and — on Zalo — burns the OA's per-user quota. | Notify the **submitter**. For group visibility, add an explicit **opt-in per-app subscription** (FR-N-5) that is a separate, audited grant — not an implicit side effect of a group role. |
| **Using `passport` / `@nestjs/passport` for the new adapters' auth** | It is the NestJS default and appears in most tutorials | v1 already rejected it: `passport@0.7.0` first published 2023-11-27 and it wraps the `jsonwebtoken` that v1 rejected in favour of `jose`. Re-introducing it in v2 would fork the auth story across adapters. | **One auth seam.** Zalo uses OAuth access tokens (KMS-encrypted, refreshed under a lock); Telegram uses the `secret_token` header; Slack/Teams keep what v1 built. All four converge on the same `InboundEvent`/`OutboundMessage` boundary. |
| **A second `InboundEvent` schema variant per platform** | "Slack events don't fit the Telegram shape" | It destroys the adapter contract that is v1's biggest structural asset, and it means every downstream consumer (RBAC filter, JEV, audit, notification assembler) grows platform branches. | One envelope. Platform-specific payloads are **translated at the adapter boundary** and never leak past it. The v1 `InboundEvent` `.strict()` schema is the enforcement mechanism. |
| **Long-polling as a Telegram fallback** | "Webhook might fail; polling is more robust" | Telegram's `getUpdates` and a webhook are **mutually exclusive** **[doc-verified]** — setting one disables the other. A polling fallback therefore *breaks* the primary path. | Webhook-only, with the platform's own retry handling (Telegram retries on non-2xx). If the webhook is down, Telegram's retries cover a 5-minute window; beyond that, the deployment is genuinely down and the v1 alerting path fires. |
| **Long-running work inside the Zalo webhook receiver** | The 2-second window looks generous | It is a *deadline*, not an allowance. Zalo **disables the webhook registration** if the retry window is missed **[doc-verified]** — a single slow handler can deregister the OA entirely. | Ack-then-enqueue, exactly as v1 does for Slack and Teams. The receiver verifies the signature, enqueues, returns 200. **All logic in the consumer.** |
| **A "Zalo Mini App" as an alternative entry point** | Zalo pushes Mini Apps; it looks like the modern path | A Mini App is a **web app embedded in Zalo** — it is a *second* form surface and a second identity surface, which is exactly what NG3 and AD-3 forbid. It also requires the OA to be linked to the Mini App for notifications to work **[doc-verified]**. | The **OA** is the adapter. The existing FormIO.js renderer stays the single form surface; the OA hands out a signed link to it, exactly as Slack does. |
| **Free-text AI answering questions about downstream data** | "The assistant could just tell me my leave balance" | The platform is **not** the system of record (NG2). It routes and links; it does not own downstream data. Any answer it gives is either a stale cache or a live read of a system whose schema we do not control. | A link. The AI guard selects the app; the form or read link retrieves the real data from the source of truth. |

---
## Feature Dependencies

```
                    ┌─────────────────────────────────────────────┐
                    │  PREREQUISITE: v1 seams already in place     │
                    │  • InboundEvent / OutboundMessage (.strict)  │
                    │  • RoutingOrchestrator (filter → select)     │
                    │  • ClarificationSessionService (2 replies)   │
                    │  • NotificationAssemblerService              │
                    │  • perm_version epoch + RBAC cache           │
                    └─────────────────────────────────────────────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
   [Zalo OA adapter]            [Telegram adapter]          [AI guard]
        │                             │                             │
        │  requires                    │  requires                   │  requires
        │  • webhook ingest            │  • webhook ingest           │  • RBAC filter (v1)
        │    (verify → enqueue → ack)  │    (secret_token → enqueue)  │  • ClarificationSessionService
        │  • Zalo access-token         │  • command registry          │  • JEV provider chain
        │    lifecycle (KMS)           │  • callback_query →         │  • tool-filter seam
        │  • quota-aware send          │    InboundAction=interaction│  • JevRequest/Response
        │                             │                             │    (.strict() — D-23)
        │                             │                             │
        └──────────┬──────────────────┘                             │
                   │                                                │
                   │  both produce                                  │
                   ▼                                                │
        [Normalized InboundEvent]                                  │
                   │                                                │
                   │  feeds                                         │
                   ▼                                                │
        [Identity resolution → RBAC filter] ◄──────────────────────┘
                   │
        ┌──────────┴──────────────────────────────┐
        │                                         │
   [Two-way sync]                          [Group RBAC]
        │                                         │
        │  requires                              │  requires
        │  • submit-time identity binding        │  • RBAC resolver (real, not stub)
        │    (platform + conversation + thread)   │  • perm_version epoch
        │  • HMAC-SHA256 verification            │  • per-platform membership read
        │  • dedupe by external event ID         │  • reconciliation scheduler
        │  • thread-aware delivery per platform  │  • audit actor = "system"
        │                                         │
        └──────────┬──────────────────────────────┘
                   │
                   │  both need
                   ▼
        [Submission record carries: submitter real_user_id,
         platform, conversation_id, thread_id, app_id]
```

### Dependency Notes

- **Every new adapter requires the v1 webhook-ingest seam.** The ack-then-enqueue discipline is not per-adapter; it is
  a shared `WebhookIngestService.ingest(rawBody, headers)` that verifies, dedupes, enqueues, and returns — with the
  HTTP controller doing nothing but `res.status(200)`. v1 Pitfall 5 identified the unawaited-`queue.add()` bug as
  invisible in code review; four more adapters multiply that exposure.
- **Zalo and Telegram both require the identity-resolution seam to be platform-keyed.** `IdentityMapping` is already
  keyed `(platform, chat_user_id)` **[code-verified]** — but the v1 `IdentityMappingRepository` and `ProfileRepository`
  are **in-memory stubs, not MongoDB-backed**. Two more platforms arriving before the persistence layer is real
  would multiply data loss across four platforms instead of one.
- **Two-way sync requires the submission record to carry submitter conversation identity.** This is the hard
  dependency in this milestone. The notification can only go "back to the original submitter" if, at submit time, the
  platform, conversation, and thread were recorded alongside the submission. **Retrofitting this after the fact is
  impossible for historical submissions** — so it must land *with* the two-way sync work, and it constrains the
  submission schema.
- **Two-way sync depends on the notification assembler, which exists but has not been exercised against a
  thread-aware, multi-platform target.** v1's `NotificationAssemblerService` resolves a `real_user_id` → platform
  mapping and produces an `OutboundMessage` — but `OutboundMessage` **has no `thread_id` / `reply_to` field**
  **[code-verified in `packages/contract/src/events/outbound-message.ts`]**. Threading therefore requires a
  **contract extension to `OutboundMessage`** (a `reply_to` / `thread_id` field), not just new adapter code.
  **This is a frozen-contract change and must be an explicit, versioned amendment — D-23-style — not an ad-hoc field.**
- **Group RBAC depends on the real RBAC resolver, and the v1 resolver is a stub.** `RbacService.hasPermission` today
  returns `true` for `leave:request` unconditionally and `getRoles` returns a hardcoded `['employee']`
  **[code-verified in `packages/domain/src/authz/rbac.service.ts`]**. Group RBAC is meaningless on top of a stub.
  **Building the group sync before the resolver means shipping a security feature that does not compute permissions.**
- **Group RBAC and the AI guard interact in exactly one place — and it is load-bearing.** The AI guard's candidate set
  is produced by the RBAC filter. When group membership changes, the candidate set changes **mid-conversation**. v1's
  `ClarificationSessionService` already re-filters displayed choices on every reply (D-48/D-50) so revoked apps
  disappear **[code-verified]**. **v2 must preserve this invariant under group-derived revocation**: a user removed
  from a group must see that app vanish from an open clarification session, not keep a stale button that fails on click.
- **The AI guard depends on the JEV wire contract staying frozen.** `JevRequestSchema` / `JevResponseSchema` are
  `.strict()` and versioned by `JEV_SPEC_VERSION = '1.0'`, with a frozen-key-set test **[code-verified]**. Extending
  the guard must therefore happen through **the existing `state.force_clarification` boolean, `context.previous_turns`,
  and `response.alternatives` / `response.clarification_prompt`** — not by adding fields to the request.
  **If a new field is genuinely required, that is a `JEV_SPEC_VERSION` bump and a conformance-suite update, and it
  should be treated as a deliberate milestone-sized decision, not a v2 side-effect.**
- **AI guard and multi-turn context depend on ordered delivery.** `JevContextSchema.previous_turns` assumes the
  previous turn is actually the previous turn. v1 Pitfall 7 establishes that IM platforms deliver **at-least-once and
  out of order**. **The AI guard's multi-turn feature is only correct if the v2 ingestion layer orders turns per
  (conversation, user) before building the context.** This is a shared prerequisite with the two-way sync work —
  both need the same ordering/dedupe machinery.
- **Zalo depends on a real OA account and a real OA approval.** No amount of code reading substitutes for it. v1's
  own stack research flagged spike **S2** (Zalo OA client: authenticate, send a message, receive + verify a webhook,
  against a real OA) as a **two-day spike on a real OA account**. **That spike is a hard prerequisite for the Zalo
  phase**, and its most important open question is whether Zalo offers a request-signing mechanism strong enough for
  the platform leg — if it does not, the threat model for that adapter changes (network control + replay window
  instead of HMAC).
- **Telegram's inline keyboards depend on the AI guard's disambiguation design — and vice versa.** The 1–64-byte
  `callback_data` limit **[doc-verified]** means the disambiguation payload must be an **opaque server-side token**,
  not an inline encoding of the candidate list. **That constraint pushes the disambiguation feature *behind* the
  AI guard's clarification-session work**, because the session is where the candidate set lives.
- **Two-way sync's threading behaviour depends on the same `OutboundMessage` contract extension as the AI guard's
  inline-keyboard replies.** Both are "reply to a specific prior message in a specific conversation". One contract
  field, one adapter capability matrix, one place to get it right.

### Ordering Consequences for the Roadmap

1. **Contract amendment first.** The `OutboundMessage` thread field, the ordering/dedupe layer, and (if needed) the
   identity persistence are **shared prerequisites** for Zalo, Telegram, two-way sync, group RBAC, and the AI guard.
   Doing them inside the first adapter phase means every later phase inherits them; doing them per-adapter means four
   incompatible shapes.
2. **Telegram before Zalo.** Telegram has first-party docs, a real Node SDK, and no approval gate. Zalo has no
   official SDK, no published Node docs for the OA Open API, an undocumented-ish changelog discipline, and an
   **approval + real-account dependency**. Telegram is the low-risk adapter that proves the shared seam; Zalo is the
   high-risk one that should not be first.
3. **Group RBAC needs the real RBAC resolver, which needs the identity layer to be persistent.** Both are
   preconditions, and both are more work than the group sync itself.
4. **The AI guard is last among the four.** It depends on the RBAC filter being real (so the candidate set is
   meaningful), on the clarification session (v1 has it), and on the ordered-turn machinery (needed by two-way sync).
   It also carries the PRD-interpretation risk (NG1 amendment) and should not be the thing that is cut when the
   milestone runs long — but it also should not be the thing that is built first and then retrofitted.

---

## MVP Definition — v2 Scope

### Launch With (v2 must-have)

- [ ] **Telegram adapter** — webhook receiver, signature/secret verification, commands, inline keyboards, thread-aware
      replies, normalized to `InboundEvent`/`OutboundMessage`. *Proves the shared multi-platform seam with the
      lowest-risk platform.*
- [ ] **Zalo OA adapter** — signature-verified receiver, 2-second ack, retry-tolerant ingest, OA access-token
      lifecycle, quota-aware consultation-message send, correct message class per recipient. *The milestone's headline
      capability and its highest-risk item; requires spike S2 against a real OA first.*
- [ ] **Two-way inbound webhooks** — signed endpoint, external-entity → submission mapping, submitter-bound
      notification, per-platform thread semantics, idempotent on redelivery. *This is FR-N-1..3 and the feature that
      turns the gateway into a two-way integration surface.*
- [ ] **Group-based RBAC** — group→role binding per app, platform membership reads, join/leave handling, stale-
      membership bound, real RBAC resolver underneath. *Closes AD-7's "Pending" state and v1 Pitfall 4's missing
      revocation event.*
- [ ] **Permission-first AI guard** — model selects from the pre-filtered tool set, never invokes; bounded
      clarification with re-authorization at display time; disambiguation between high-confidence alternatives;
      multi-turn context. *Amends NG1 without reversing it; must keep the v1 invariant that the model never sees an
      unauthorized tool.*

### Add After Validation (v2.x)

- [ ] **Notification topic subscriptions** (FR-N-5) — per-app opt-in topic subscriptions. *Trigger: two-way sync ships
      and users start asking to be notified about other people's records.*
- [ ] **Zalo group chat (GMF) targeting** — send into a GMF group the OA manages. *Trigger: a customer actually asks
      for team-visible notifications on Zalo; requires the group-management permission grant.*
- [ ] **Per-app notification muting** (FR-N-7). *Trigger: notification volume complaints after two-way sync lands.*
- [ ] **Directory sync via SCIM / Entra ID as an optional upstream.** *Trigger: a customer declares the HR directory —
      not the IM platform — as the authoritative membership source. This is the largest cost in the group-RBAC area
      and the least differentiating; it should never be a v2 launch item.*
- [ ] **Telegram forum-topic-aware threads** (`message_thread_id` for supergroups). *Trigger: a customer runs a
      Telegram supergroup with forum mode enabled.*

### Future Consideration (v3+)

- [ ] **Native IM form rendering** (Block Kit / Zalo Mini App forms). *Deferred by NG3/AD-3 — one engine, one renderer.
      Only revisit if a specific platform's users refuse to leave the chat window.*
- [ ] **Cross-app collection sharing** (PRD Phase 5). *Deferred to a later milestone; it is a data-model change, not
      an IM-platform change, and v2 is already large.*
- [ ] **29 additional IM platforms.** *Deferred past v2; each is a full adapter with its own ack budget, retry
      schedule, threading semantics, and verification scheme. Four platforms is the defensible set.*
- [ ] **Multi-step approval workflows** (PRD NG5). *Deferred; out of scope for v1 and v2 alike.*

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---|---|---|---|
| Telegram adapter (webhook, commands, inline keyboards, threading) | HIGH | MEDIUM | **P1** |
| Zalo OA adapter (receiver, ack, quota-aware send, token lifecycle) | HIGH | MEDIUM–HIGH | **P1** |
| `OutboundMessage` thread/reply contract extension | HIGH (enabler) | LOW | **P1** |
| Per-platform ordering + dedupe layer (event_id / update_id / msg_id) | HIGH (enabler) | MEDIUM | **P1** |
| Submitter conversation identity bound at submit time | HIGH (enabler) | MEDIUM | **P1** |
| Two-way inbound webhooks (signed endpoint → notification to submitter) | HIGH | MEDIUM | **P1** |
| Real RBAC resolver (replacing the v1 stub) | HIGH (enabler) | MEDIUM | **P1** |
| Group RBAC: group→role binding + membership reads + join/leave | HIGH | MEDIUM | **P1** |
| Group RBAC: stale-membership bound + reconciliation job | MEDIUM (but correctness-critical) | MEDIUM | **P1** |
| Permission-first AI guard (select-only, never invokes) | HIGH | MEDIUM | **P1** |
| AI guard: disambiguation interaction surface (inline keyboards / numbered lists) | MEDIUM–HIGH | MEDIUM | **P2** (needs the guard's candidate design) |
| AI guard: multi-turn context over ordered delivery | MEDIUM | MEDIUM | **P2** (depends on the ordering layer) |
| Zalo follow/unfollow event handling | MEDIUM | LOW | **P2** |
| Zalo GMF group targeting | LOW–MEDIUM | MEDIUM | **P3** |
| Telegram privacy-mode detection & user-facing diagnosis | LOW (but high support-value) | LOW | **P2** |
| Notification topic subscriptions (FR-N-5) | MEDIUM | MEDIUM | **P3** |
| Per-app notification muting (FR-N-7) | LOW | LOW | **P3** |
| Directory sync via SCIM / Entra ID | MEDIUM | HIGH | **P3** |
| Native IM form rendering | LOW (contradicts NG3) | HIGH | **P4 — out of scope** |
| Open-ended free-form chat | LOW (contradicts NG1) | HIGH | **P4 — out of scope** |
| Model tool-calling / auto-execution | LOW (contradicts AD-1) | HIGH | **P4 — out of scope** |
| Broadcast notifications to IM groups | LOW (contradicts FR-N-3) | LOW | **P4 — out of scope** |

**Priority key:**
- **P1**: Must have for the v2 launch — either a user-facing capability or a hard enabler of one.
- **P2**: Should have; add once the P1 path is stable.
- **P3**: Nice to have; explicit v2.x trigger.
- **P4**: Out of scope; listed to prevent accidental absorption.

---

## Competitor Feature Analysis

The comparison set is *gateway and bot platforms that connect enterprise IM to downstream systems* — not
general-purpose assistants, because those already win on conversation and lose on the thing this product is for.

| Feature | Microsoft Power Automate + Teams | n8n + Slack/Telegram nodes | Zapier + Slack | **Our approach** |
|---|---|---|---|---|
| Multi-platform coverage | Teams-first; Slack via connector | Slack + Telegram via community nodes | Slack only (plus app-specific channels) | **Four platforms on one frozen `InboundEvent`/`OutboundMessage` contract** — Slack, Teams, Zalo OA, Telegram, with platform quirks (2 s ack, no threads, quotas) handled honestly rather than flattened |
| Permission model at the routing layer | Per-connector user auth; no pre-model tool filtering | Workflow-level credentials; no per-user tool visibility | Connection-level credentials | **RBAC filter runs *before* the model** — the model never receives an unauthorized tool. No competitor gates the *tool set* by the requesting user's role. |
| Who chooses the workflow | User picks a pre-built flow | User picks a pre-built workflow | User picks a pre-built zap | **Model picks from the user's authorized apps**, with confidence gating and bounded clarification — the model selects, the platform executes |
| Form capture surface | Adaptive Cards / native forms | Arbitrary | Arbitrary | **One renderer (FormIO.js), one validation semantics, one link-issuance path.** Forms are reached by a signed link, not embedded |
| Two-way notification back to the submitter | Supported, but as a configured action per flow | Supported, but routed to a channel, not to the submitting user | Supported, email-first | **Notifications return to the submitter's original conversation and thread, per platform semantics, idempotently** — including on Zalo, where there is no thread primitive and the reply is a fresh message in the OA chat |
| Group / directory-driven access | M365 group membership via Graph | None | None | **Group→role binding per app, with a bounded-staleness rule and audit attribution** — and revocation that actually revokes outstanding links via `perm_version` |
| Zalo (Vietnam market) | Not supported | Community node, unofficial | Not supported | **A first-class adapter built to Zalo's actual rules** — 7-day consultation window, per-user quota read before send, 2-second ack, `num_retry` redelivery. Most competitors simply cannot target this market. |
| Open-ended AI assistant | Copilot in Teams | AI Agent nodes | Zapier Central / Agents | **Explicitly bounded**: a permission-first *guard* over a pre-filtered tool set. Free generation is out of scope by PRD NG1 and stays out of scope in v2 |

**The honest competitive read:** the incumbents win on breadth of workflow templates and on raw conversational
fluency. They lose on three axes this product deliberately optimizes — **who can see which tool** (permission-first
routing), **where data capture happens** (one renderer, always), and **whether the notification comes back to the
person who filed the request** (submitter-bound, threaded). Zalo support is the one axis where the gap is not merely
architectural but **absolute**: most of this category cannot reach the Vietnamese market at all.

---

## Complexity Legend

| Rating | Meaning | Rough shape in this milestone |
|---|---|---|
| **S** | Single-file or single-service change; no new contract, no new dependency, no new failure mode | Follow/unfollow event handler; `editMessageText` helper; privacy-mode diagnosis |
| **M** | Multi-file, touches a contract or a shared service, introduces a new failure mode or a new external dependency | Zalo/Telegram adapters; two-way webhook endpoint; group→role binding; the AI guard itself |
| **L** | Multi-service, new persistence model, new external system, or a change to a frozen contract with wide blast radius | `OutboundMessage` thread-field amendment; directory (SCIM) sync |
| **XL** | Should not be attempted in v2 | Native IM form rendering; open-ended assistant; 29 more platforms |

---

## Gaps — What This Research Could Not Verify

These are load-bearing unknowns, listed with the consequence of being wrong.

| # | Gap | Why it matters | Suggested resolution |
|---|---|---|---|
| **G1** | **Zalo group member enumeration.** No documented "list all members of a Zalo GMF group" API was found. Join/leave **events** exist (`user_join_group`, `user_out_group`, `accept_request_join_group`) and group **message** history exists (`GET /v3.0/oa/group/conversation`), but a member list was not located. | **Group RBAC on Zalo may be event-driven-only** — which means a missed event leaves a stale grant with no reconciliation source. | Spike S2 against a real OA. If no member list exists, Zalo group bindings must be **event-driven with a bounded staleness rule**, and the group-role feature may need to be **Slack/Teams-only in v2** with Zalo groups deferred. **Decide before the group-RBAC phase, not during it.** |
| **G2** | **Zalo webhook signing strength.** The documented scheme is `sha256(appId + data + timeStamp + OAsecretKey)` **[doc-verified]** — a concatenation hash, not an HMAC. Whether Zalo also exposes a per-request nonce or a timestamp-validity rule is undocumented. | Determines the **replay-protection** story for the Zalo leg. If there is no nonce, FR-N-8's replay protection must be implemented platform-side (timestamp window + a platform-side idempotency key). | Spike S2. Assume the worst (timestamp-window only) and design the ingest seam to accept a platform-supplied idempotency key independently of the signature scheme. |
| **G3** | **Zalo OA bot vs OA distinction.** Zalo exposes a separate "Zalo Bot" surface (`bot-api.zaloplatforms.com`, `X-Bot-Api-Secret-Token`, Telegram-shaped `{ok, result:{event_name: "message.text.received"}}` payloads) alongside the OA Open API (`X-ZEvent-Signature`, `user_send_*` events) **[both doc-verified]**. Which surface the target customers actually use is a **commercial question, not a technical one**. | The two surfaces have **different payload shapes, different verification schemes, different capability sets** (the Bot surface is Telegram-shaped and has inline-style interactivity; the OA surface has the quota model and the template product). | Ask in discovery: "Which Zalo surface do your users already use?" **Build against the OA** (the PRD names "Zalo OA API", it has the follower model the product needs, and the Bot surface's shape is closer to Telegram than to what v1 already supports) — but **confirm before the spike**. |
| **G4** | **Zalo OA approval and access-token provisioning lead time.** OAuth app registration, OA creation, and permission grants are real-world queues, not code. | **The Zalo phase can be blocked on someone else's calendar.** A phase plan that assumes same-week provisioning is a plan that slips. | Start the approval request in the **pre-phase**, in parallel with the Telegram work — not in the phase itself. |
| **G5** | **Zalo quota exhaustion behaviour.** The quota API returns `remain` counts but the behaviour on exhaustion (silent drop, error code, delayed send) is undocumented. | Determines whether a quota-exhausted send is a **retryable** or a **terminal** failure — which changes the DLQ semantics for the Zalo leg. | Spike S2: exhaust a test quota deliberately and observe. |
| **G6** | **Telegram `node-telegram-bot-api` v2 webhook-mode ergonomics.** The library exposes `webhookCallback` / `createWebhookServer` **[doc-verified]**, but v1 uses `@slack/bolt`'s `ExpressReceiver` and the Microsoft Agents SDK for Teams — **two different hosting idioms**. | A third idiom may be needed, or the Telegram adapter may need to bypass the library's HTTP layer entirely and use it only as a typed API client. | Decide at implementation time: **most likely, use the library for its typed API client only and host the webhook in the existing Express app** — this keeps one HTTP stack, one OTel path, and one auth seam. |
| **G7** | **Telegram bot-token revocation and rotation.** Bot tokens are single secrets; Telegram offers no dual-key rotation, unlike the project's own `jose` keyring for link signing. | A token rotation is a **hard cutover**, not a zero-downtime dual-key window. | Accept the cutover and plan a runbook. Do **not** invent a rotation scheme the platform does not offer. |
| **G8** | **Exact Slack `x-slack-retry-num` / `x-slack-no-retry` semantics for the *Events API* vs the *HTTP API*.** The 3-times/1 min/5 min schedule is confirmed from `api.slack.com/events-api` **[doc-verified]**; the header names appear in the same source. Whether `x-slack-no-retry` is honoured on Events API deliveries is less certain. | Affects the **dedupe key design**: if a delivery can be retried with no distinguishing header beyond `x-slack-retry-num`, the dedupe key must be `event_id` (stable across retries), not `event_id + retry_num`. | **Design the dedupe key on the stable `event_id` regardless** — that is correct under either semantics and costs nothing. |
| **G9** | **Whether the AI guard's disambiguation UI needs a new `InboundAction` value.** `InboundActionSchema` is `message \| slash_command \| interaction \| event` **[code-verified]** — `interaction` exists and fits a Telegram `callback_query` or a Slack button press. | If `interaction` does not carry enough structure (e.g. which choice was selected), the contract needs an extension — and `InboundEvent` is a **frozen `.strict()` contract**. | **Decide before the AI-guard phase.** Prefer reusing `interaction` + `text` over extending a frozen contract; if the choice identity must be structured, model it as `app_id`/`form_id` (which already exist and are optional) rather than adding a field. |
| **G10** | **Whether group-derived roles require a new `perm_version` fan-out.** Revoking one user from a group bumps `perm_version` per user-per-app (fine). But **revoking a whole group** must bump it for **every member × every app that group is bound to** — a fan-out whose size is unbounded by anything the v1 design has seen. | A naive synchronous fan-out in the sync job could take down the sync worker on a 500-person group × 20 apps. | Design the revocation fan-out as a **queued, batched, idempotent job** with its own rate limit. **Do not do it inline.** |
| **G11** | **The v1 identity and RBAC repositories are in-memory stubs, not MongoDB-backed.** `IdentityMappingRepository` and `ProfileRepository` hold arrays in process memory **[code-verified]**; `RbacService` returns hardcoded grants **[code-verified]**. | Group RBAC and the AI guard both depend on **persistent, real** identity and permission state. Shipping them on top of stubs would make the features **non-functional across multiple API/worker replicas** — and v1's AD-9 constraint is explicitly *stateless application services with state in Redis/Mongo*. | **Resolve before the group-RBAC phase.** This is a genuine prerequisite, not a cleanup task. |
| **G12** | **How much of the AI guard's value survives the PRD's "no free generation" constraint.** The research could not verify that a *selector-only* guard is what users actually want — the literature on permission-bounded assistants is thin, and the closest product precedents (Copilot, n8n AI nodes, Zapier Agents) are all generation-capable. | Risk that v2's headline AI feature under-delivers against user expectation, or that a stakeholder reads "permission-first guard" as "we watered down the AI". | **Frame the amendment explicitly** in the roadmap and in user-facing copy: NG1 is **amended, not reversed** — the model gains a wider *input* space (free-text intent) while keeping a *narrower* *action* space (select a pre-authorized app). **The guard's correctness is testable; a chatbot's is not.** |

---

## Sources

**Zalo — first-party documentation (all doc-verified)**
- `developers.zalo.me/docs/official-account/webhook/tong-quan` — 2-second response requirement, HTTP 200 for all
  events, retry schedule (30 s / 5 m / 15 m / 30 m / 1 h), `num_retry` header, webhook deregistration on repeated failure
- `developers.zalo.me/docs/official-account/webhook/tin-nhan/su-kien-nguoi-dung-gui-tin-nhan` — inbound webhook payload,
  `X-ZEvent-Signature` formula, `event_name` enumeration, `quote_msg_id` on replies
- `developers.zalo.me/docs/official-account/webhook/tin-nhan/su-kien-official-account-gui-tin-nhan-cho-nguoi-dung` —
  OA-sent events (`oa_send_*`), `sender.admin_id` for admin-window sends
- `developers.zalo.me/docs/official-account/webhook/nhom-chat-gmf/user_join_group` and `.../user_leave_group` —
  group join/leave event payloads (`oa_id`, `group_id`, `users[]`)
- `developers.zalo.me/docs/official-account/tin-nhan/tong-quan` — the three message classes (Tin Tư vấn / GMF group /
  Broadcast), the 7-day interaction condition, ZBS template messages as a separate paid product
- `developers.zalo.me/docs/official-account/quan-ly/quan-ly-thong-tin-oa/kiem-tra-han-muc-tin-nhan-oa` — quota API,
  `cs_reply` / `promotion` quota structure, `last_interaction`
- `developers.zalo.me/docs/official-account/bat-dau/xac-thuc-va-uy-quyen-cho-ung-dung` — OAuth permission groups and
  the authorization-code flow
- `docs.zaloplatforms.com/docs/OA/nhom-chat-gmf/...` — group message send (`POST /v3.0/oa/group/message`), group
  conversation read, group-management permission requirement
- `docs.zaloplatforms.com/docs/BOT/webhook` and `.../BOT/apis/setWebhook` — the **separate** Zalo Bot surface
  (`X-Bot-Api-Secret-Token`, Telegram-shaped payloads) — the OA/Bot distinction behind G3
- `docs.zaloplatforms.com/docs/MA/api/widgets/showOAWidget` — Mini App → OA follow relationship (NG3 rationale)

**Telegram — first-party documentation (all doc-verified)**
- `core.telegram.org/bots/api` — `setWebhook` / `secret_token` / `max_connections` / `allowed_updates`; `sendMessage`
  and `reply_parameters` / `message_thread_id`; `editMessageText`; `InlineKeyboardMarkup` / `callback_data` (1–64 bytes);
  `answerCallbackQuery` (200 chars, `show_alert`); `setMyCommands` / `deleteMyCommands` / `getMyCommands` and the 7
  `BotCommandScope` variants; `ChatMemberUpdated` / `ChatMember` statuses; `getChatMember` (bot must be administrator);
  `getChatMemberCount`; `sendChatAction`
- `core.telegram.org/bots/features` — commands, custom reply keyboards, inline keyboards, command scopes, the
  "backend must always verify that received commands are valid and that the user was authorized … regardless of scope"
- `core.telegram.org/bots/faq` — webhook vs long polling mutual exclusion, supported webhook ports (443/80/88/8443),
  self-signed certificates, privacy-mode behaviour, **20 messages/minute in a group**, 30 messages/second broadcast
- `core.telegram.org/bots/api-changelog` — Bot API 5.1 `chat_member` updates and the administrator requirement
- `github.com/yagop/node-telegram-bot-api` — v2 API surface: `startPolling` / `LongPollOptions` (`offset`, `timeout`,
  `retry`, `retryDelayMs`, `conflictRetryDelayMs`, `maxConflictRetries`), `webhookCallback` / `createWebhookServer`,
  non-re-entrant polling

**Slack — first-party documentation (all doc-verified)**
- `api.slack.com/events-api` — **3 retries, exponential backoff (~immediately, 1 min, 5 min)** with `x-slack-retry-num`;
  `x-slack-no-retry`; `event_id` as the stable delivery identifier; the event envelope shape
- `docs.slack.dev/reference/methods/chat.postMessage` — `thread_ts` (reply to parent), `reply_broadcast`
- `docs.slack.dev/reference/methods/conversations.members` — cursor-paginated channel membership
- `docs.slack.dev/reference/methods/conversations.replies` — thread read
- `docs.slack.dev/reference/methods/usergroups.list` — user-group enumeration, `usergroups:read` scope, Tier 2 rate limit
- `docs.slack.dev/reference/scim-api/` — SCIM v2 `/Users` and `/Groups` resource schemas (the optional directory upstream)
- `docs.slack.dev/reference/events/member_joined_channel` and `/user_change` — membership and profile-change events

**Microsoft — first-party documentation (doc-verified)**
- `learn.microsoft.com/en-us/graph/api/resources/aaduserconversationmember` — `GET /teams/{team-id}/members`
- `learn.microsoft.com/en-us/graph/api/channel-list-allmembers` — `GET /teams/{team-id}/channels/{channel-id}/allMembers`,
  opaque membership IDs, shared-channel indirect members

**This codebase — read directly (code-verified)**
- `packages/contract/src/events/inbound-event.ts` — `ImPlatformSchema` already contains `'zalo'` and `'telegram'`;
  `InboundActionSchema` = `message | slash_command | interaction | event`; `.strict()` envelope with no thread field
- `packages/contract/src/events/outbound-message.ts` — `OutboundMessage` has **no** `thread_id`/`reply_to` field; the
  thread-field amendment this milestone requires
- `packages/contract/src/jev/v1/jev-request.ts` / `jev-response.ts` — `JEV_SPEC_VERSION = '1.0'`, `ToolDescriptor`
  (id/description/parameters, no permission surface), `state.force_clarification`, `context.previous_turns`
  (`role: 'user' | 'assistant'` — **no system turn**), `choice.verified` tri-state
- `packages/domain/src/decision/routing-orchestrator.ts` — `authorizedTools` (never the global catalogue, `T-03-01`),
  `app_hints` re-filtered against the permitted set, `canOpenNow` re-check at the execution boundary, `verified !== true`
  → clarify, empty tool set → clarify, deadline → clarify
- `packages/domain/src/decision/clarification-session.service.ts` — max 2 replies, max 3 displayed choices,
  Redis key `jev:clarify:{realUserId}:{channelId}:{threadTs}`, 15-minute TTL, re-filter on every reply, escalation path
- `packages/domain/src/authz/rbac.service.ts` — **currently a stub** (hardcoded grants) — the prerequisite behind G11
- `packages/domain/src/identity/identity-mapping.repository.ts` / `profile.repository.ts` — **in-memory stubs**, keyed
  `(platform, chat_user_id)`
- `packages/domain/src/notifications/notification-assembler.service.ts` — the v1 assembler that two-way sync extends
- `apps/worker/src/processors/notification.processor.ts` — the v1 notification queue, jittered backoff, DLQ path

**Prior project research (this repository)**
- `.planning/research/PITFALLS.md` — Pitfall 4 (`perm_version` covers 1 of 7 revocation events — group membership
  revocation is the missing one), Pitfall 5 (ack-then-enqueue has an unobservable gap; missing webhook counters),
  Pitfall 7 (IM platforms deliver at-least-once and out of order; `previous_turns` can be silently wrong)
- `.planning/research/STACK.md` — Zalo hand-rolled-client decision (~200 lines over `undici`), Telegram
  `node-telegram-bot-api@2.1.0` (rejected `grammy` for its un-instrumented `node-fetch@^2` dependency), spike **S2**
  (two-day Zalo spike on a real OA account) and its open question on Zalo webhook signature verification
- `.planning/PROJECT.md` — AD-1 (permission-first routing), AD-7 (real-user-only RBAC — the "Pending" item v2 closes),
  AD-11 (signed stateless read links), NG1 (the non-goal v2 amends), the `<200 ms` ack constraint, the modular-monolith
  and stateless-service constraints
- `PRD.md` — FR-IM-1..8, FR-N-1..8, FR-R-1..12, FR-J-1..11, §11.1 JEV wire spec, §4.2 NG1/NG3/NG8, §20 Phase 4–5
  placement of the Zalo adapter and inbound webhooks

---
*Feature research for: IM-driven enterprise gateway — v2 platform expansion*
*Researched: 2026-10-21*

