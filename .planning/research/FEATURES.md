# Feature Landscape — IM-Driven App Builder & Integration Gateway

**Domain:** Enterprise chat-front-door / integration gateway (B2B internal tooling)
**Researched:** 2026-10-01
**Confidence:** MEDIUM
**Mode:** Ecosystem (feature landscape), researched *against* the PRD — not derived from it

**Confidence note:** the research-plan seam routed all 12 questions to `websearch`, whose
`classify-confidence` tier is **LOW**. Every finding below that is load-bearing for a scope
decision was re-verified by fetching the vendor's own documentation directly (Slack, TypeSafe
AI, Form.io, Microsoft Learn, n8n, PagerDuty). Those are marked **[doc-verified]**. Findings
that rest on search snippets alone are marked **[MEDIUM]** and are never used to justify a
scope cut.

**Scope of this document.** The PRD (v2.0, §8, ~130 FRs) is the authoritative requirement set.
This file does **not** re-derive it. It does four things the PRD cannot do for itself:

1. Grades every PRD FR cluster for **complexity** (S/M/L/XL) — the PRD assigns priority, not cost.
2. Classifies each cluster as **table stake / differentiator / anti-feature**, including
   flagging P0 requirements that are realistically deferrable.
3. Surfaces features real precedents ship that **the PRD omits** (the expensive kind of omission —
   the ones you only learn about in production).
4. Names the **sequencing hazards** that make the PRD's 19–28 week estimate unreachable.

---

## Feature Landscape

### Table Stakes (Users Expect These)

#### Tier 1 — in the PRD, and non-negotiable

| Feature (FRs) | Why Expected | Complexity | Notes |
|---|---|---|---|
| Per-platform identity resolution → internal user UUID (`FR-I-1..10`) | Nothing works without knowing *who* is asking. Every downstream permission decision is keyed on it. | **S** | Cheap if done as one adapter-interface method per platform. Expensive if each adapter invents its own user shape. |
| Permission-filtered tool list **before** any model call (`FR-R-1..3`, AD-1) | A router that can see tools the user cannot use is a security incident, not a UX annoyance. | **M** | The permission re-read is one of the two hottest paths; must be a Redis-cached read, never inline in the webhook receiver. |
| One-time signed link → rendered form (`FR-L-1..3`) | The entire product promise: "complete a task via chat + one form". Without it there is no product. | **M** | Sign with asymmetric keys so the Form Renderer can verify without holding the signing key (AD-11). |
| Atomic single-use token consumption (`FR-L-3`, NFR-SEC-1) | Double-submission is the first bug users find. `GETDEL` gives atomicity for free on Redis ≥6.2. | **S** | Do **not** hand-roll get-then-delete. One command, no race. |
| Form Renderer SPA served from a signed claim (`FR-F-1`) | The link must resolve to something that looks like a form, not a JSON blob. | **M** | Plain `@formio/js`, bundled from npm. No CDN (see Anti-Feature NG13 / licensing notes). |
| Submission persisted to a per-app dynamic collection (`FR-D-1..3`) | The data is the product. Losing a submission is unrecoverable from the user's point of view. | **M** | Runtime-defined schemas are the reason Mongoose was rejected — see STACK.md. |
| At least **one external connector** with retry + DLQ (`FR-C-1..12`) | Routing modes are `internal` / `hybrid` / `external`. Shipping only `internal` ships a form tool, not a *gateway*. The stated problem is cross-system. | **M** | One well-built connector (Redmine, per the PRD) beats four half-built ones. |
| Chat notification on completion **and** failure (`FR-N-1..8`) | A silent gateway is indistinguishable from a dropped message. Users re-ask; that becomes bot noise. | **S** | Success and failure are two different code paths with two different message shapes. |
| Audit trail keyed by `submission_id` (`FR-AU-1..6`, NFR-O-1) | Enterprise buyers ask for this in procurement, not in usability testing. It is a table stake because it is a *precondition of sale*. | **M** | The trace/audit correlation must be designed in, not retrofitted. |
| Webhook ack <200 ms, all logic in the consumer (`FR-IM-*`) | Slack's 3-second ack and Teams' 429/502 retry-with-jitter make the receiver a pure ingest contract. | **M** | Non-negotiable for correctness, not just latency: a slow permission lookup inside the receiver is how submissions get lost. |

#### Tier 2 — **absent from the PRD**, but users of this class of product assume they exist

These are the expensive omissions. Each is a *baseline expectation* in the precedent set, and
each would be discovered in production rather than in design review.

| Feature | Why Expected | Complexity | Precedent | Notes |
|---|---|---|---|---|
| **Draft save & resume on long forms** | Any form long enough to need a gateway is long enough that people get interrupted. "Save and Continue Later" is a shipping-default in the form-vendor class. | **M** | Jotform "Save and Continue Later" + Autofill **[MEDIUM]** | **The PRD has no draft FR at all.** The Form Renderer is a stateless SPA behind a one-time token — a one-time token and a resumable draft are *mutually exclusive as designed*. This needs a real decision, not an omission. |
| **Per-submission status/history view** | "Did my thing go through?" is the #1 support question in any async integration tool. | **M** | Slack Workflow Builder: view workflow activity logs, in-progress/completed + errors **[doc-verified]** | The PRD has an audit log (for admins) but no end-user-readable submission status. Admins and requesters are different audiences. |
| **Visible failure + retry affordance for the requester** | Silent failure is the #1 trust killer. | **S** | Slack workflow activity logs surface errors to the builder **[doc-verified]** | `FR-N-*` covers notification; confirm it carries *actionable failure state*, not just "something went wrong". |
| **Dead-letter / failed-submission queue an admin can inspect** | Without it, connector failures are discovered by users, not by the platform. | **M** | BullMQ DLQ (FR-C-*, partial) + n8n "Save failed executions" **[doc-verified]** | `FR-C-8/11/12` (dry_run, timeout, DLQ UI) are all P1 — but a DLQ with no UI is a support ticket generator. |
| **Categories / tags on apps and forms** | 200 apps with no taxonomy is a folder of noise. | **S** | Slack Workflow Builder templates + gallery + search; n8n tags **[doc-verified]** | Pure metadata, low cost, high day-90 usability. PRD has none. |
| **A starting template gallery** | Department admins need a worked example; a blank FormIO builder is a blank page. | **M** | Slack templates/gallery, n8n templates, ServiceNow Service Catalog **[doc-verified for Slack/n8n]** | Ten seed templates (expense claim, leave request, asset request, access request) carry more adoption value than ten new features. |
| **Storage/quota + orphaned-upload cleanup** | Form.io uploads land in storage **immediately, regardless of submit**, and "the file will remain in storage even if the user removes the attached file" **[doc-verified]**. | **S** | Form.io help docs **[doc-verified]** | A direct, documented consequence of the chosen form engine. PRD has no storage lifecycle requirement. |

---

### Differentiators (Competitive Advantage)

The differentiating claim in `PROJECT.md` is: *an employee can complete a cross-system task
entirely through chat plus a single rendered form, without ever logging into — or learning — the
downstream system.* These are the features that make that claim true and defensible. Pick a
few; do not try to differentiate on everything.

| Feature (FRs) | Value Proposition | Complexity | Notes |
|---|---|---|---|
| **Permission-first routing — filter tools by RBAC, *then* ask the model** (`FR-R-1..3`, `FR-J-1..11`, AD-1) | The model never sees a tool the user cannot invoke. This collapses the decision space to a single, legal Choice question and is the reason the JEV path is cheap enough to run on every message. | **M** | **No precedent does this.** Slack Workflow Builder filters at *connector-step* level (per-user third-party auth), not at the routing layer. n8n/Power Automate have no user-level tool visibility at all. This is the sharpest edge in the design. |
| **Confidence-gated handoff with an explicit no-model fallback** (`FR-J-*`) | When the decision model is unsure, the product degrades to a deterministic picker instead of guessing. Predictability in an enterprise gateway is worth more than fluency. | **M** | TypeSafe's own design guidance: all questions evaluated **in parallel and in isolation**; "adding questions barely changes the response time"; and queries must be **atomic, composed in code** — "if the question would require extended reasoning or weighs multiple independent factors, decompose it" **[doc-verified]**. AD-1 shrinking the prompt to one Choice question is exactly the sanctioned pattern. |
| **Chat is the entry point, the form is the interface** — one message in, one rendered form out | Positions the product against "conversational everything" on evidence, not taste. | **S** | Slack's own Block Kit guidance says modals are for "collect structured data… **cut out the conversation** and send all necessary inputs to an LLM" **[doc-verified]**. The industry has already decided structured capture happens outside the chat surface. |
| **Self-service App Builder for department admins** (`FR-F-2..14`, §14 UI) | Removes the engineering ticket from the loop. Retool and Zoho Creator still require someone technical; ServiceNow's catalog still requires a catalog admin. | **XL** | This is the largest single build in the roadmap and the largest single differentiator. It is also the item the PRD sequences *after* things that depend on it — see Dependency Hazard DH-1. |
| **Stateless signed read links, verifiable without the signing key** (`FR-L-*`, AD-11, `perm_version`) | A 90-day-lived read link that a static web app can verify with a *public* key. No shared secret in the browser, no session, horizontally scalable. | **M** | Requires asymmetric signing (`jose`, EdDSA/ES256) — HS256 is the wrong primitive here. Also the natural home for the read path the PRD defers to Phase 4. |
| **Swappable decision-model provider seam** (AD-1) | The decision model is a hosted vendor product; the protocol is a PRD-invented interface. The seam is what keeps that from being a hard dependency. | **S** | Keep it thin (interface + one adapter + one fake). Every extra abstraction here is cost without benefit. |
| **Delegated ownership — app owner transfer, workflow-manager role** (`FR-R-5/6`, `FR-LC-7`) | Department turnover must not orphan an app or lose its admin. | **S** | Precedent: Slack's delegated **workflow managers** **[doc-verified]**. Small FRs, disproportionate operational value. |
| **Zero-downtime 90-day dual-key rotation** (NFR-SEC-9) | Signing-key rotation without downtime is a procurement checkbox most small vendors cannot tick. | **M** | Requires `kid` → keyring resolution. This is precisely why `jose` beats `@nestjs/jwt` (no JWKS, no keyring). |
| **GDPR-aligned erasure + export, PII excluded from logs pre-serialisation** (NFR-SEC-*, PROJECT.md constraints) | Right-to-erasure is a promise that is **broken by construction** if PII reaches the log stream — a field denylist regex always misses. A field allowlist before serialisation is the only version that holds. | **M** | A genuine enterprise differentiator *if* implemented as an allowlist at the logger boundary. If implemented as a scrubber downstream, it is theatre. |

---

### Anti-Features (Commonly Requested, Often Problematic)

This is the most valuable section of this document. Each entry was evaluated against a real
product's shipped behaviour, not against intuition. "Why problematic" cites the precedent.

#### Anti-features that must be explicitly ruled OUT of v1

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **NG1 — Open-ended conversational AI** ("just ask the assistant to do it") | Highest surface appeal in the entire feature space. It is what every demo of this product category shows. | The decision model is a **structured** model: it returns `choice`, `probabilities`, `confidence` from discrete, atomic questions **[doc-verified]**. Open-ended generation is a different product with a different failure surface — hallucinated tool names, unverified side effects, and no confidence signal to gate on. TypeSafe's own guidance is to decompose multi-factor questions into atomic ones precisely because extended reasoning degrades **[doc-verified]**. | Keep the conversational *surface* (natural-language intent → structured Choice), and make every ambiguous case fall through to a deterministic picker. Ship a confidence gate, not a chat loop. |
| **NG2 — Group / channel-level RBAC** | "Grant everyone in #it-help the same apps." Sounds like a one-line role. | Role membership in an IM platform is a **second identity system** with its own lifecycle, sync, and revocation semantics. Every hot-path permission check now has two sources of truth that can disagree. The 200-app / 1,000-user scale does not need it. | Single-user RBAC (`FR-R-*`). If a department genuinely needs shared access, model it as a **department claim on the user record**, resolved at read time — not as a parallel role-membership graph. |
| **NG3 — Native IM forms** (Slack modals / Adaptive Cards as the data-capture surface) | Zero context switch. The user never leaves the chat client. This is the single most requested item in this category. | Slack's own platform limits are severe and hard: an **Input block holds exactly one element** (label max 2000 chars); a modal view stack holds **max 3 views at any one time**; `trigger_id` expires in **3 seconds**; `view_submission` must be acked within 3 s; optimistic concurrency needs the `hash` from `views.update` **[doc-verified]**. A real business form does not fit in one input block, and a 3-view modal cannot express a conditional multi-section form. | **The signed outbound link + web form.** This is what the PRD already does — and it is what Slack itself recommends: modals are for "collect structured data… **cut out the conversation**" **[doc-verified]**. Also what Slack ships for its own long-form case: "if a workflow starts with a link, you need to find and click that link" **[doc-verified]**. |
| **NG4 — Multi-step approval engine** | "Add an approver before it submits." Universally requested; feels like one more field. | Even a **single-approver** action spans four separate documented areas in Power Automate: manage sequential approvals, create parallel approval workflows, cancel an approval request, create long-running approvals **[doc-verified]**. Approvals exceeding 30 days "store your approvals in Microsoft Dataverse" and require **two flows** **[doc-verified]**. The surface area is already large at step one, before any branching. | Ship **one-time, single-step approval** if anything, and put it post-MVP. Where approval is genuinely required (procurement, access grants), the destination system's approval flow is the right place for it — route there, don't reimplement it. |
| **NG5 — Real-time collaborative form editing** | Two admins editing the same form is the intuitive expectation once forms are a shared artifact. | Adds CRDT/OT or a lock protocol, presence, conflict resolution, and a merge story for JSON Schema that the form engine owns anyway. `@formio/js` is not designed as a collaborative document model. Zero precedent in this product class treats it as table stakes. | Optimistic concurrency with **version snapshots + explicit rollback** (`FR-F-6`). Publish/change-history over a single-writer model. |
| **NG6 — Cross-app data sharing in v1** (`FR-X-1..7`, all P1) | It is the literal words "integration **gateway**". Without it, apps are islands. | All seven FRs are marked **P1**, which places a data-governance surface (what may app A read from app B, with whose consent, audited how?) at the same priority as core routing. This is the feature most likely to produce a silent authorization bug, because every cross-app read is a place where the *source* app's RBAC can be forgotten. | Ship internal + external routing first. Cross-app sharing is a **v2 differentiator** with an explicit rule: a cross-app read re-evaluates the *requesting* user's permissions against the *source* app, never the calling app's grant. |
| **NG7 — Native mobile client** | "Employees are on their phones." | Two apps (Form Renderer, App Builder) already at React 19 + Vite 8 scale. A third surface multiplies QA, review, and release. And the premise is weak: the IM client is already on the phone — the form is a link opened in the same mobile browser session. | Responsive Form Renderer. Nothing else. The IM client is the mobile app; do not compete with it. |
| **NG8 — Multi-organisation / cross-org collaboration** (Slack Connect analogue) | Enterprise buyers always ask. | PROJECT.md is explicit: **single enterprise deployment in v1, no cross-org isolation work**. Cross-org adds tenant-boundary enforcement to every hot path, which is precisely the class of bug that is unrecoverable once shipped. | Say no explicitly and write it into the Out-of-Scope list. Re-open only if a named customer requirement arrives. |

#### Anti-features to guard against during execution (not in the PRD, likely to be requested mid-build)

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **NG9 — A general workflow engine** (loops, branching DSL, sub-workflows, canvas groups) | The App Builder starts to look like a workflow tool, and the first request is always "add a condition." | This is n8n's entire product. The documented surface at maturity includes sub-workflows, canvas groups, conditional branching, per-execution error workflows, execution-data retention and redaction, and **workflow reviews with version pinning and visual diffs** **[doc-verified]**. Each is weeks of work and none is in the PRD's value proposition. | Routing destinations stay a fixed small enum (`internal` / `external` + connector id). Conditional *display* inside forms is a FormIO concern and stays there. If branching becomes real demand, it is a separate product. |
| **NG10 — A publish-review gate on the App Builder** *(request is reasonable; the PRD's omission is not)* | Department admins author **production** workflows that write to real downstream systems. Someone should approve before publish. | This is **not** a reason to build it in v1 — it is a reason to acknowledge the PRD has no answer. n8n ships exactly this (submit a *pinned version* for review; statuses Waiting / Changes requested / Approved / Closed; review blocks publishing from editor, API **and MCP server**; publish is attributed to the requester, not the approver) **[doc-verified]**. | v1 mitigation: **named app owner + audit log of every schema change** (`FR-AU-*`). Record the gap in §22–§25 and revisit when non-technical admin authoring actually reaches production use. |
| **NG11 — Conversational status polling** ("what's happening with my request?") | Users will ask, repeatedly. | PagerDuty publishes "**Too frequent status updates**" as a named incident-response anti-pattern, with 5-minute cadence rejected in favour of 20–30 minutes **[doc-verified]**. Bots that answer every "any update?" create a feedback loop that buries real signal. | Push **one** terminal-state notification per submission (`FR-N-*`). Do not implement an update-query command in v1. If asked for, give a deep link to the status view rather than a chat answer. |
| **NG12 — Polling the destination system for status** | "Did Redmine accept it?" feels important. | Adds per-connector polling state machines, rate-limit budgeting against third-party APIs, and a class of failure that is invisible when it goes wrong. | Fire-and-confirm at the connector boundary: the submission record carries the connector response. Status *of our own* submission is local state and is free. |
| **NG13 — Form.io premium components, starting with File upload** (`FR-F-10`, P1) | File upload is a baseline expectation on any real business form. | Licensing, not capability. `formio.js` (the renderer) is **MIT**; the `formio` core engine is **OSL 3.0**; and **Premium** components require a Library License key plus `@formio/premium` — the list includes **File**, Data Source, CAPTCHA, Nested Form, Tagpad, Sketchpad, Review Page, Custom, Data Table **[doc-verified]**. Shipping `FR-F-10` on the premium File component puts the AD-3 "open source" claim at risk. | Either (a) spike whether `@formio/js` alone renders a `file` component unlicensed — **unresolved, needs a spike** — or (b) drop file upload from v1 and route attachments through the destination connector's own API. Option (b) is safer and cheaper. |
| **NG14 — CDN-hosted Form.io builds** (`cdn.form.io/js/formio.full.min.js`) | Faster to wire up; no build step. | Third-party CDN under SRI pinning is an external availability dependency on the **one component the entire product renders through**, and an SRI-pinning break takes the product down. | Bundle `@formio/js` from npm via Vite. It is already in the stack. |

---

## Feature Dependencies

```
                            ┌──────────────────────────┐
                            │ Identity resolution      │  FR-I-*
                            │  (per-platform user)     │
                            └────────────┬─────────────┘
                                         │ requires
                            ┌────────────▼─────────────┐
                            │ RBAC engine + perm_      │  FR-R-*
                            │ version cache            │
                            └────────────┬─────────────┘
                                         │ requires
        ┌────────────────────────────────┴─────────────────────────────┐
        │                                                               │
┌───────▼────────┐   requires    ┌───────────────────┐            ┌─────▼──────┐
│ Tool filter    │──────────────▶│ Decision routing  │            │ Audit log │
│ (pre-model)    │               │ (JEV + fallback)  │            │ FR-AU-*   │
└────────────────┘               └─────┬─────────┬───┘            └─────┬──────┘
                                       │         │                       │
                         requires      │         │      requires        │
                                       │         │                       │
                              ┌────────▼──┐  ┌───▼────────────┐          │
                              │ One-time  │  │ App Builder    │          │
                              │ signed    │  │ (form schema)  │          │
                              │ link      │  │ FR-F-2..14     │          │
                              │ FR-L-*    │  └───┬────────┬───┘          │
                              └────┬──────┘      │        │              │
                                   │             │        │              │
                    ┌──────────────┴──┐   ┌──────▼───┐ ┌──▼──────────┐  │
                    │ Form Renderer   │   │ Version  │ │ Submissions │◀─┘
                    │ (stateless SPA) │   │ rollback │ │  + status   │
                    └────────┬────────┘   │ FR-F-6   │ │  view       │
                             │            └──────────┘ └─────────────┘
                             │ requires
                    ┌────────▼─────────┐
                    │ Object storage  │────▶ [ GAP: no storage/quota
                    │ (S3 + token EP) │       or orphan-cleanup FR ]
                    └──────────────────┘

  ┌─────────────────────────── CONFLICTS ────────────────────────────┐
  │  NG3 native IM forms  ──conflicts──▶  Form Renderer (above)     │
  │  NG1 open-ended AI     ──conflicts──▶  permission-first filter  │
  │  NG6 cross-app sharing ──conflicts──▶  single-app RBAC isolation │
  │  NG4 approval engine   ──conflicts──▶  fire-and-confirm routing  │
  └──────────────────────────────────────────────────────────────────┘
```

### Dependency Notes

- **Identity requires RBAC.** Every permission decision is keyed on a resolved internal user
  UUID (`map_uuid`). RBAC cannot be evaluated for a platform-native ID that has not been mapped.
  This is why identity is not parallelisable with the rest of Phase 1.

- **The tool filter requires RBAC, and the decision model requires the tool filter.** This is the
  spine of the product. AD-1 (permission-first) is not an optimisation on top of the routing
  pipeline — it is a **precondition**. TypeSafe's guidance on atomic questions evaluated in
  parallel and in isolation **[doc-verified]** means the cost of the decision call is roughly
  independent of question count; the cost that matters is *legal* question count. Filtering
  first turns a broad routing decision into a single constrained Choice.

- **The one-time link requires identity *and* RBAC** — the token claim carries the resolved user,
  and consumption re-checks `perm_version` so a permission revoked between issue and click is
  caught. This is why one-time links cannot ship ahead of the permission cache.

- **The App Builder requires nothing, and everything requires the App Builder.** It is the only
  large component with no upstream dependency. It is also the reason Phases 3 and 4 are load-bearing.

- **The Form Renderer requires the App Builder's output** — a schema to render. In the PRD's
  sequence it ships in Phase 1, before the builder that authors the schemas. Seeded/fixture
  schemas are a legitimate Phase 1 workaround but they are not a substitute: the form-rendering
  path cannot be exercised against real builder output until Phase 3.

- **Object storage is required by file upload but has no FR.** Form.io issues a temporary
  server-generated PUT URL and the file "will remain in storage even if the user removes the
  attached file" **[doc-verified]**. So object storage provisioning, a token endpoint, a quota
  policy, and a cleanup job are all *implied* by `FR-F-10` without being specified anywhere.

- **NG3 (native IM forms) conflicts with the Form Renderer.** They are two different
  implementations of the same product promise, with different data models (Slack `view` state vs
  signed stateless claim). Building both means maintaining two rendering paths, two validation
  paths, and two audit paths for one feature.

- **NG1 (open-ended AI) conflicts with the permission-first filter.** An open-ended generator
  decides at generation time; the permission filter decides before. There is no way to have both
  without re-introducing the "model suggested a tool the user cannot use" failure.

### Sequencing Hazards (why 19–28 weeks is not achievable as sequenced)

These are ordering defects in the PRD §20 roadmap, not estimation disagreements. The 26–34 week
figure in PROJECT.md is a consequence of them.

**DH-1 — The read path is deferred past its dependents.**
Phase 4 introduces View/Query links and `perm_version`. But Phase 1 ships an App Registry with
per-app RBAC, and Phase 3 ships a Submission viewer. A submission viewer with no read path is a
viewer that cannot open anything. Either the read path moves earlier, or the viewer is explicitly
scoped as "list of submissions, details in Mongo" until Ph4.

**DH-2 — The App Builder is deferred past the value proposition.**
The Core Value in PROJECT.md is "complete a cross-system task through chat plus a single rendered
form". Phases 1–2 build the *plumbing* for that. The thing that makes it usable — a department
admin authoring the form — arrives in Phase 3. Phases 1–2 without Ph3 ship a gateway with no
forms except hand-written fixtures, which validates nothing about the actual proposition.

**DH-3 — Phase 1 has no decision model, yet ships the link infrastructure.**
The PRD places JEV in Phase 4. Phase 1 nevertheless ships one-time create links and the Form
Renderer. Until Ph4 the create flow is slash-command-only with manual app selection. That is a
reasonable *interim*, but it means Phase 1's link and renderer work is validated against a flow
nobody will use in production. Either stub the routing decision deterministically in Phase 1, or
move JEV earlier — it is the smallest high-value item in the roadmap, and AD-1 makes it cheap.

**DH-4 — Phase 4 bundles four independent risks.**
Teams adapter + Zalo hand-rolled client + read links + webhooks all land in one 4–6 week phase.
These share no code and no failure mode. Bundling them means a slip in any one consumes the whole
phase's slack.

---

## MVP Definition — scope calibration: 4 platforms × 3 routing modes

The PRD matrix is 4 IM platforms (Slack, Teams, Zalo, Telegram) × 3 routing modes (internal,
hybrid, external). Shipping the full matrix is 12 combinations. This is the opinionated answer.

### Recommendation

**v1 = one IM platform (Slack) × two routing modes (internal + one external connector).**
Then add Teams as the first post-validation adapter. Defer Zalo and Telegram indefinitely.

| Dimension | Slack-only (recommended) | Full 4×3 matrix |
|---|---|---|
| Delivers "task via chat + one form" | **Yes** | Yes |
| Delivers "integration **gateway**" | **Yes** (internal + ≥1 external connector) | Yes |
| IM adapter surface to build & QA | 1 | 4 |
| Webhook verification variants (signature schemes) | 1 | 4 distinct, each with its own failure mode |
| Rate-limit / retry semantics to handle | 1 (Slack's 3s ack, 3 retries) | 4 (Teams 429/502 retry-with-jitter; Zalo and Telegram undocumented/unofficial) |
| Threading + message-format variants | 1 | 4 |
| Realistic weeks | see PROJECT.md total | +8–12 weeks, high variance |

**Why Slack first:** it is the only adapter with an actively-published official SDK
(`@slack/bolt@5`), a documented, stable Block Kit contract, and a documented precedent for the
product's exact model (outbound link for structured capture). Building the formatter and the
adapter-interface contract against one platform produces a *general* abstraction; building it
against four from day one produces four special cases with no generalisation.

**Why at least one external connector is mandatory:** routing mode `internal` alone makes this a
form-forwarder. The stated problem is cross-system access (Redmine, HR, ERP, ticketing,
procurement, asset management). Shipping only `internal` means the central claim is untested.
Ship exactly one — Redmine, per the PRD — and prove the connector contract generalises before
building the second.

**Teams is the first expansion, not a co-launch partner.** Required if the target enterprise is
Microsoft-based, and the M365 Agents SDK is the correct (actively maintained) package — but
each additional adapter multiplies webhook-verification, rate-limit, threading, and error-handling
surface against a single message-formatter contract. Prove the contract with one.

**Zalo and Telegram: defer past v1.** Zalo has no official Node SDK — Zalo's own SDK docs are
PHP-only and every npm wrapper self-describes as unofficial, so it is a hand-rolled ~200-line
client over `undici` with an unofficial, undocumented contract. That is a Phase-4 risk item, not
an MVP item. Telegram is straightforward but has no role in validating the core value proposition.

### Launch With (v1)

- [ ] **Identity resolution + RBAC + `perm_version` cache** (`FR-I-*`, `FR-R-1..3`) — nothing else is safe without it
- [ ] **Deterministic routing decision** (permission-filtered picker), *then* JEV behind the provider seam — decision routing without a model is shippable and testable; JEV is an upgrade, not a prerequisite
- [ ] **One-time signed link → Form Renderer** (`FR-L-1..3`, `FR-F-1`) — the product promise
- [ ] **Submission persistence + internal routing mode** (`FR-D-1..3`) — proves the data path
- [ ] **One external connector (Redmine) with retry + DLQ** (`FR-C-1..7`) — proves it is a gateway
- [ ] **Audit log with `submission_id` correlation** (`FR-AU-*`) — procurement precondition
- [ ] **Terminal-state chat notifications, success and failure** (`FR-N-*`) — trust
- [ ] **Submission status view** (end-user-readable, not just admin audit) — *from Tier 2 above, absent from PRD*
- [ ] **Draft save & resume on long forms** — *from Tier 2 above, absent from PRD*
- [ ] **App tags/categories + ~10 seed templates** — *from Tier 2 above, absent from PRD; cheap day-90 usability*

### Add After Validation (v1.x)

- [ ] **Microsoft Teams adapter** (M365 Agents SDK) — first expansion, once the adapter contract holds
- [ ] **Self-service App Builder UI** (`FR-F-2..14`, §14) — the real differentiator; Phase 3
- [ ] **Stateless signed read links + `perm_version`** (`FR-L-4/5`) — resolves DH-1
- [ ] **App definition versioning + rollback** (`FR-F-6`) — needs real builder-authored schemas to be meaningful
- [ ] **Disambiguation and explicit no-JEV fallback mode** (`FR-J-9/11`)
- [ ] **DLQ UI + connector health checks + dry-run** (`FR-C-8/9/11/12`)
- [ ] **Custom roles + owner transfer** (`FR-R-4/6`, `FR-LC-7`) — triggered by real department turnover
- [ ] **Object storage, quota, and orphaned-upload cleanup** — *if* `FR-F-10` file upload is retained
- [ ] **Retention policy + purge automation** (`FR-LC-4/5`)

### Future Consideration (v2+)

- [ ] **Cross-app data sharing** (`FR-X-1..7`) — the literal "gateway" claim; needs an explicit authorization rule before code
- [ ] **Zalo OA adapter** (hand-rolled client, unofficial contract)
- [ ] **Telegram adapter**
- [ ] **Approval workflow, single-step** (`FR-J-*`/Phase 5) — see NG4; cheap-sounding, large surface
- [ ] **Publish-review gate for admin-authored apps** — see NG10
- [ ] **Workflow-manager delegation as a general model** — beyond apps to forms and connectors
- [ ] **Tenant / multi-org** — only on a named customer requirement (NG8)

---

## Feature Prioritization Matrix

Complexity uses S/M/L/XL (S ≈ ≤3 days, M ≈ 1 week, L ≈ 2–3 weeks, XL ≈ 4+ weeks, for a
developer already inside this codebase).

### PRD clusters

| Feature cluster (FRs) | User Value | Implementation Cost | Priority | Complexity |
|---|---|---|---|---|
| Identity resolution (`FR-I-*`) | HIGH | MEDIUM | **P0** | S |
| RBAC + permission-first filter (`FR-R-1..3`) | HIGH | HIGH | **P0** | M |
| One-time signed links (`FR-L-1..3`) | HIGH | MEDIUM | **P0** | M |
| Form Renderer (`FR-F-1`) | HIGH | MEDIUM | **P0** | M |
| Submission persistence (`FR-D-1..3`) | HIGH | MEDIUM | **P0** | M |
| Internal routing mode | HIGH | LOW | **P0** | S |
| Audit log (`FR-AU-*`) | HIGH (procurement) | MEDIUM | **P0** | M |
| Terminal notifications (`FR-N-1..8`) | HIGH | LOW | **P0** | S |
| Deterministic routing fallback | HIGH | LOW | **P0** | S |
| Webhook ack <200 ms + enqueue | HIGH (correctness) | MEDIUM | **P0** | M |
| JEV decision model (`FR-J-*`) | HIGH | MEDIUM | **P0** (move earlier — DH-3) | M |
| One external connector (`FR-C-1..7`) | HIGH | MEDIUM | **P0** | M |
| Submission status view | HIGH | LOW | **P0** (absent from PRD) | M |
| Draft save & resume | MEDIUM-HIGH | MEDIUM | **P1** (absent from PRD) | M |
| Retry / DLQ core (`FR-C-*`) | HIGH | MEDIUM | **P0** | M |
| App Builder UI (`FR-F-2..14`) | HIGH (differentiator) | HIGH | **P0, but see DH-2** | **XL** |
| Custom roles (`FR-R-4`) | MEDIUM | MEDIUM | **P2** (P0 in PRD) | M |
| Owner transfer (`FR-R-6`, `FR-LC-7`) | MEDIUM | LOW | **P2** (P0 in PRD) | S |
| Read links + `perm_version` (`FR-L-4/5`) | HIGH | MEDIUM | **P1 in PRD — move to P0 or scope the viewer** | M |
| Retention + purge (`FR-LC-4/5`) | MEDIUM (compliance) | MEDIUM | **P1** | M |
| Connector health checks (`FR-C-9`) | MEDIUM | LOW | **P2** (P0 in PRD) | S |
| `dry_run` (`FR-C-8`) | MEDIUM | LOW | **P2** | S |
| Connector timeout config (`FR-C-11`) | MEDIUM | LOW | **P2** | S |
| DLQ UI (`FR-C-12`) | MEDIUM | MEDIUM | **P2** | M |
| Field transformations (`FR-D-11`) | MEDIUM | MEDIUM | **P2** | M |
| Disambiguation (`FR-J-9`) | MEDIUM | MEDIUM | **P2** | M |
| No-JEV fallback mode (`FR-J-11`) | MEDIUM | LOW | **P2** | S |
| App version rollback (`FR-F-6`) | MEDIUM | MEDIUM | **P2** | M |
| File upload (`FR-F-10`) | MEDIUM | MEDIUM + **licensing risk** | **P2 — spike NG13 first** | M |
| Teams adapter | MEDIUM | MEDIUM | **P1** | M |
| Zalo adapter | LOW | MEDIUM + **unofficial contract risk** | **P3** | M |
| Telegram adapter | LOW | LOW | **P3** | S |
| Cross-app sharing (`FR-X-*`) | HIGH | HIGH | **P2 (all P1 in PRD)** | L |
| Approval workflow (Ph5) | MEDIUM | HIGH | **P3** | L |

### Gaps (absent from PRD) — recommended priority

| Gap | User Value | Implementation Cost | Priority | Complexity |
|---|---|---|---|---|
| Draft save & resume | MEDIUM-HIGH | MEDIUM | **P1** | M |
| Submission status view (user-facing) | HIGH | LOW | **P0** | M |
| Object storage + quota + orphan cleanup | MEDIUM | LOW-MED | **P1** (conditional on `FR-F-10`) | M |
| App tags/categories | MEDIUM | LOW | **P1** | S |
| Seed template gallery (~10) | MEDIUM | LOW | **P1** | M |
| Notification cadence policy | MEDIUM | LOW | **P2** (policy, not code) | S |
| Publish-review gate | MEDIUM | MEDIUM | **P3** | M |
| App definition rollback in v1 | MEDIUM | MEDIUM | **P3** (covered by `FR-F-6` in P1) | M |

**Priority key:**
- P0: must have for launch
- P1: should have — high value for low cost, or required to avoid a production failure mode
- P2: add when possible; P0 in the PRD that is realistically deferrable
- P3: future consideration

**P0-but-deferrable in the PRD** (called out explicitly because the PRD marks these P0 and the
cost column disagrees): `FR-R-4`, `FR-R-6`, `FR-LC-4`, `FR-LC-5`, `FR-LC-7`, `FR-C-8`,
`FR-C-9`, `FR-C-11`, `FR-C-12`, `FR-D-11`, `FR-J-9`, `FR-J-11`, `FR-F-6`, `FR-F-10`.

---

## Competitor Feature Analysis

| Feature | Slack Workflow Builder | Power Automate / Copilot Studio | n8n | ServiceNow | Retool / Zoho Creator | Our Approach |
|---|---|---|---|---|---|---|
| **Structured data capture** | Modal views, ≤3 views, 1 input element/block **[doc-verified]**; recommended for "cut out the conversation" **[doc-verified]** | Adaptive Cards / forms | Node config, not user-facing forms | Service Catalog request items + forms | Native form builder | **Outbound signed link → web form.** Chosen because real business forms do not fit a 3-view modal. |
| **Natural-language intent → tool** | Limited / none | Copilot Studio conversational paths | AI Agent / tool nodes | Agent Workspace assist | Limited | **Permission-filtered atomic Choice with `confidence` + deterministic fallback.** No precedent filters by RBAC *before* the model. |
| **Routing / destination** | Connector steps, per-user third-party auth **[doc-verified]** | Flows + connectors | Any HTTP node | Assignments + integrations | DB / API actions | **Fixed small destination enum + connector contract.** Explicitly not a workflow engine (NG9). |
| **Self-service authoring** | Anyone can build; admins restrict which steps/triggers members may use **[doc-verified]** | Yes, per-licence | Yes | Catalog admin required | Yes, some technical skill | **Department-admin App Builder without engineering tickets.** Note the precedent that *admins still restrict what others may use* — worth adopting for v2. |
| **Delegated ownership** | Workflow managers **[doc-verified]** | Ownership + sharing | Project roles | Delegation rules | Workspace roles | `FR-R-5/6` owner transfer + workflow-manager role. |
| **Publish review / change control** | Activity logs; draft/publish | Solution checker | **Workflow reviews: pinned version, status workflow, visual diff, blocks publish from editor/API/MCP, attributed to requester** **[doc-verified]** | Approval workflows | Version history | **v1: owner + audit log only.** Gap recorded (NG10, §22–§25). |
| **Error visibility** | Activity logs show in-progress/completed + errors **[doc-verified]** | Run history | Global error workflow + "Save failed executions" **[doc-verified]** | SLA + work notes | Run logs | BullMQ DLQ + DLQ UI (`FR-C-*`). DLQ without UI is a support-ticket generator. |
| **Execution data retention / redaction** | Limited | Run history retention | **Manage + redact execution data, "to protect sensitive information and meet compliance requirements"** **[doc-verified]** | System logs | Logs | **PII field allowlist before log serialisation** (not a downstream scrubber). Precedent that redaction is a named compliance feature. |
| **Credential / key rotation** | Per-connection auth | Connection references | **Rotate encryption keys** **[doc-verified]** | Credential store | Secrets | 90-day dual-key rotation, zero downtime (NFR-SEC-9). |
| **Tags / templates / search** | Templates + gallery + search **[doc-verified]** | Solution catalogue | Tags + templates **[doc-verified]** | Categories | Templates | **Adopt in v1** — cheap, high day-90 usability. Currently absent from the PRD. |
| **Long-form / draft handling** | Outbound link for long forms **[doc-verified]** | Resubmit / run again | Execution persistence toggles | — | — | **Draft save & resume.** Currently absent from the PRD. |
| **File upload** | Native attachment | Native | — | Attachment | Native | **Risk:** Form.io File is a premium component **[doc-verified]** → spike or drop from v1 (NG13). |
| **Approval workflows** | Workflow Builder steps | **Large: sequential, parallel, cancel, long-running (>30d → Dataverse + 2 flows)** **[doc-verified]** | Human-in-the-loop for tools **[doc-verified]** | Deep, native | Approval steps | **Defer past v1** (NG4). Route to the destination system's approval flow where one exists. |
| **Cross-org / multi-tenant** | Slack Connect + admin controls | Per-tenant environments | n8n Cloud tenancy | Enterprise instances | Workspaces | **Explicitly out of scope v1** (NG8). |
| **Notification discipline** | Channel/user notifications | Approval notifications | Execution webhooks | Subscriptions + watchers | — | **One terminal-state notification per submission. No conversational status polling** — PagerDuty names "too frequent status updates" an anti-pattern, rejects 5-min cadence for 20–30 min **[doc-verified]**. |

---

## Gaps that belong in the missing PRD §22–§25

The PRD's table of contents lists sections 22–25 but the body ends at §21 (§21 = KPIs). These
gaps have no home in the current document and were surfaced by the precedent research above.
They should be written as new sections, not folded into §8.

| # | Gap | Why it matters | Suggested new section |
|---|---|---|---|
| 1 | **No end-user submission status view** | Admin audit log ≠ requester-visible status. Highest-value gap in this list — "did my thing go through?" is the #1 support question in any async integration tool, and Slack ships workflow activity logs for exactly this **[doc-verified]**. | §23 Product Requirements Gaps |
| 2 | **No draft-save / resume FR** | Baseline expectation of the form-vendor class (Jotform "Save and Continue Later" **[MEDIUM]**). Also structurally incompatible with a stateless one-time-token SPA as currently designed — a resumable draft needs a second, longer-lived token. Requires an explicit decision. | §23 |
| 3 | **Form.io premium-component licensing risk for `FR-F-10`** | `formio.js` renderer is MIT; the `formio` engine is OSL 3.0; **File** is a premium component requiring a Library License key + `@formio/premium` **[doc-verified]**. This directly threatens AD-3 / the §7.4 "open source" claim. **Needs a spike**: can `@formio/js` alone render a `file` component unlicensed? Currently unresolved. | §22 Licensing & Third-Party Constraints |
| 4 | **Object storage provisioning implied but never stated** | Form.io's temporary server-generated PUT URL requires S3-class storage + a token endpoint that the PRD never specifies **[doc-verified]**. | §22 |
| 5 | **No storage-quota or orphaned-upload cleanup requirement** | Form.io uploads persist **regardless of submit**, and "the file will remain in storage even if the user removes the attached file" **[doc-verified]**. A documented, guaranteed storage leak with no owner in the PRD. | §23 |
| 6 | **No app template gallery or tag/category taxonomy** | Both Slack and n8n ship tags + templates **[doc-verified]**; 200 apps with no taxonomy is unusable at day 90. | §23 |
| 7 | **No publish-review gate for admin-authored apps** | Department admins author production workflows that write to real downstream systems. n8n ships exactly this control (pinned version, status workflow, visual diff, blocks publish from editor/API/MCP) **[doc-verified]**. v1 mitigates with named owner + audit log, but the gap should be acknowledged rather than left silent. | §23 |
| 8 | **No notification-cadence / rate policy** | PagerDuty publishes "too frequent status updates" as a named incident-response anti-pattern, rejecting 5-minute cadence for 20–30 minutes **[doc-verified]**. Cadence is a designed decision, not a "send immediately" default. | §23 |
| 9 | **"JEV-compatible" is a PRD-invented protocol** | Jev is TypeSafe AI's hosted flagship model **[doc-verified]**; there is no published JEV wire protocol industry standard. The spec should be named and published as a first-party interface, and the provider seam kept thin. The roadmap's Phase 4 reference to "OpenJev" points at an unofficial reconstruction — **[MEDIUM, unverified]**; treat as a risk, not a dependency. | §24 Integration Contracts |

---

## Sources

**Vendor documentation fetched directly (HIGH confidence):**
- `docs.slack.dev` — Block Kit Input block (one element, 2000-char label), modal view stack
  (max 3 views), `trigger_id` (3 s), `view_submission` (3 s ack), `views.update` hash
  concurrency, and the guidance to "cut out the conversation" for structured data
- `slack.com/help/articles/360035692513` — Slack Workflow Builder: open authoring, admin
  restriction of steps/triggers, workflow managers, activity logs, downloadable form responses,
  templates/gallery/search, per-user connector auth, outbound links for long forms
- `docs.typesafe.ai/introduction` + `/confidence` — Jev model (Choice/Score/Noul), parallel
  isolated question evaluation, atomic-question composition guidance
- `form.io/open-source` + `help.form.io/form-building/premium-components` — MIT renderer,
  OSL 3.0 engine, premium component list, immediate-upload/cleanup-on-submit semantics
- `learn.microsoft.com` — Power Automate modern approvals: sequential, parallel, cancel,
  long-running (>30 days → Dataverse, two flows), multi-surface approver response
- `docs.n8n.io` (sitemap + workflow reviews) — save/publish, change history, workflow reviews
  (pinned version, status workflow, visual diff, blocks publish from editor/API/MCP, attributed
  to requester), tags, templates, sub-workflows, error workflows, execution-data
  manage/redact, encryption-key rotation, security audits, AI evaluation, human-in-the-loop
- `response.pagerduty.com/resources/anti_patterns/` — "too frequent status updates" (5-min
  cadence rejected; 20–30 min working), assuming silence, hesitancy to escalate, failure to
  disseminate policy changes

**Located but not fetched (MEDIUM confidence — not used to justify any scope cut):**
- Jotform Workflows + "Save and Continue Later" / Autofill as a form-class baseline
- ServiceNow Service Catalog (request items, categories, approval, SLA, Agent Workspace)
- Retool and Zoho Creator as form-driven internal-tool builders
- n8n community guidance on "Save failed executions" vs disabling "Save Execution Progress"
  in production (execution-data bloat)
- n8n workflow reviews are **Enterprise-only, Preview** — treated as *pattern* precedent, not a
  hard requirement

**Primary project sources:**
- `PRD.md` v2.0 — §8 FRs, §12 flows, §14 App Builder UI, §20 roadmap, §21 KPIs, TOC/body gap
  at §22–§25
- `.planning/PROJECT.md` — Core Value, Active/Out-of-Scope split, 26–34 week estimate,
  stack amendments

**Method notes:**
- All 12 research questions were planned through the GSD `research-plan` seam, which routed
  every item to `websearch` (`classify-confidence` → LOW). No exa/tavily/firecrawl/context7
  provider was available in this runtime.
- Because the routed tier was LOW, every finding that drives a scope decision was independently
  re-verified against the vendor's own documentation before being treated as authoritative.
  Claims above are marked `[doc-verified]` where that applies and `[MEDIUM]` where it does not.

---
*Feature research for: IM-driven app builder & integration gateway*
*Researched: 2026-10-01*