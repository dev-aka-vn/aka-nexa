# Phase 3: Natural-Language Routing - Context

**Gathered:** 2026-10-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Upgrade Phase 2's Slack `/leave request` flow so an employee can describe the task in English or Vietnamese and receive the same signed form link when one authorized app clearly matches. Filter the candidate tools by per-app RBAC **before** any decision provider, validate decisions against those candidates, retain deterministic slash routing, and use a deadline-aware, config-ordered provider chain ending in an offline rule-based provider. Ambiguous, low-confidence, unknown, or malformed input must produce a useful clarification, not an unauthorized suggestion or an incorrect form. Deliver RTE-01…RTE-09, RTE-11 and OBS-02, including provider health, safe caching, and the 50-intent conformance suite with per-app confidence intervals.

**Not this phase:** changes to the frozen JEV v1 wire contract (RTE-10 was Phase 1); read/query links (Phase 4); external connectors (Phase 5); App Builder authoring UI (Phase 6); additional IM adapters (Phase 7). Phase 2's signed link, identity, RBAC and Slack reply path are reused, not rebuilt.

**Prerequisites:** Phase 2 remains in verification in `.planning/STATE.md`. The roadmap explicitly requires `/gsd-ai-integration-phase 3` to produce `AI-SPEC.md`, and `/gsd-plan-phase 3 --research-phase`; provider/model choice and measured accuracy/latency belong there rather than being guessed here.

</domain>

<decisions>
## Implementation Decisions

Decision numbering continues Phase 1's D-01…D-30 and Phase 2's D-31…D-47.

### Clarification in Slack

- **D-48:** For competing plausible authorized apps, show up to three app names as short choices; never issue a form link until the user chooses. Never expose an unauthorized candidate, including in the wording of alternatives.
- **D-49:** The employee chooses by replying with an app name or number in the **same Slack thread**. Do not require Slack-specific buttons or a new interactive control.
- **D-50:** If the reply adds details rather than selecting a choice, re-evaluate with the original request and that reply as conversation context, after filtering the currently authorized tools again. A typed clarification is not a new, context-free request.
- **D-51:** Allow at most **two clarification replies**; if still unclear, offer examples or slash commands and invite a fresh request. Do not keep questioning indefinitely. The chat-facing path remains inside the phase's routing budget; exact expiry and storage mechanics are left to planning.

### Offline routing and unknown intents

- **D-52:** The offline matcher draws phrases from **published apps' declared intents and descriptions**, rather than a separate central phrase catalogue. App owners' declarations are the source of truth; a deprecated app does not gain new triggers merely because it remains functional.
- **D-53:** Recognize distinctive keywords and explicitly declared aliases, tolerating case and simple wording variation. Do not guess through broad fuzzy similarity. Both offline and hosted choices remain subject to each app's configured confidence threshold.
- **D-54:** For no clear authorized match, say that none was found and offer a few **authorized** app examples or slash commands; do not surface the global catalogue or an infrastructure error.
- **D-55:** If the offline provider finds one clear authorized match above the app's threshold, issue the same signed form link directly. A hosted-provider outage is not a reason to require confirmation; weak or competing matches still clarify.

### Hosted-provider data boundary

- **D-56:** A hosted provider may be enabled only if approved for the deployment's **locked data region**. Otherwise routing remains local; swapping providers through configuration cannot waive regional approval. — **Reversibility:** one-way — a request already exported to another region cannot be recalled.
- **D-57:** Before a hosted call, redact obvious email addresses, phone numbers and employee IDs in the current message **and recent turns** while preserving the intent. Do not add profile fields, form submissions or raw chat histories to the frozen JEV request. The required `context.real_user_id` remains an opaque ID under the frozen contract, not a name or email. This is best-effort identifier removal, not a guarantee that arbitrary free text contains no sensitive information; researcher should identify how to fail safely when redaction is uncertain. Never log unredacted text or provider payloads. — **Reversibility:** one-way — a sensitive string sent to a provider cannot be unsent.
- **D-58:** Enabling a hosted provider requires a verified **no-training, no-retention-beyond-processing** commitment. If a provider cannot meet it, leave it unconfigured and use the offline provider; do not treat regional hosting alone as sufficient. — **Reversibility:** one-way — provider-side retained/training data cannot be removed by a later code change.
- **D-59:** A deployment with **no approved hosted provider** is a fully supported local-only mode, not a boot failure or emergency-only exception. The rule-based provider is still the mandatory terminal link in every configuration.

### Language and replies

- **D-60:** Deliver equal core coverage for **English and Vietnamese** on seeded app intents and offline matching. For a single-language request, reply in that language.
- **D-61:** For a mixed English/Vietnamese request, match authorized intents in **either** language; conflicting matches clarify instead of picking a dominant language and risking a wrong app.
- **D-62:** For a language outside English/Vietnamese, use the contract's `state.force_clarification` rather than silently selecting an app. Reply with concise bilingual guidance to use English or Vietnamese, plus a few authorized slash-command examples. Slash commands retain their deterministic Phase 2 path.
- **D-63:** For mixed-language ambiguity, the clarification prompt is concise **English and Vietnamese**; display app names as published.

### The agent's Discretion

- Choose exact Slack copy, display order of equally relevant authorized alternatives, expiry and interruption behavior of a clarification thread, and conservative keyword/alias scoring; these must preserve D-48…D-63, fresh authorization, and the 2-second chat-to-link budget.
- Choose vendor/model, provider hosting arrangement, cost profile, conformance cases, calibration methodology, and safe multi-turn cache behavior via `AI-SPEC.md` and research. Do not revise the frozen JEV v1 fields or the required RTE-09 cache-key shape to make multi-turn easier; never serve a cached single-turn choice for a different conversation context.
- The PRD's example timeout and confidence numbers are **examples**, not measured guarantees. Preserve app-specific thresholds, propagated deadlines and 60-second health checks; substantiate numerical defaults in research and tests.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and earlier decisions
- `.planning/ROADMAP.md` §"Phase 3: Natural-Language Routing" — exact goal, 11 mapped requirements, success criteria, AI-SPEC prerequisite and explicit research need. **Roadmap text mistakenly calls the read path Phase 3 elsewhere; Phase 4 owns it.**
- `.planning/REQUIREMENTS.md` §"Routing Decision" (RTE-01…RTE-11) and §"Observability & Operations" (OBS-02) — binding requirement wording; §"Resolved Requirement Conflicts" for availability and data protection.
- `.planning/PROJECT.md` §"Key Decisions" — AD-1 permission-first routing, AD-2 swappable seam, region-locked data and availability constraints.
- `.planning/STATE.md` — current Phase 2 verification state and outstanding handoffs.
- `.planning/phases/01-foundations-platform/01-CONTEXT.md` D-15…D-24 — logging and trace field controls; D-23's **frozen** JEV request/response and total-abstention refinement.
- `.planning/phases/02-the-vertical-slice-slack-internal-routing/02-CONTEXT.md` D-31…D-47 — Phase 2 Slack/identity/RBAC/issuance decisions; deterministic slash commands do not call JEV.

### Routing contract and design constraints
- `PRD.md` §8.3 (FR-J-1…FR-J-11), §11.1–§11.4 (JEV request, provider interface, example chain), §12.1 (permission-first create flow) — baseline intent, superseded where the frozen v1 contract or requirements differ. The PRD's example provider names are **not** approved selections.
- `.planning/research/ARCHITECTURE.md` §§"Provider Registry", "State & Cache Topology" — existing guidance on the decision module, permission-first filter and cache; research guidance cannot override frozen contracts or phase decisions.
- `.planning/research/STACK.md` §§5, 6, 13.1 — language/runtime and observability constraints; provider/model/host choice was explicitly left open.
- `packages/contract/src/jev/jev-provider.ts` — delivered `JevProvider`, `HealthStatus`, capability gate and `RULE_BASED_PROVIDER_NAME`.
- `packages/contract/src/jev/v1/jev-request.ts` — frozen request with `question`, filtered `tools`, opaque `real_user_id`, locale, prior turns and `force_clarification`.
- `packages/contract/src/jev/v1/jev-response.ts` — frozen required `choice`, abstention and clarification rules.
- `packages/contract/src/jev/jev-v1.frozen.spec.ts` — exact-key-set and abstention conformance guard; do not add/remove fields in Phase 3.
- `packages/contract/src/events/inbound-event.ts` — the single inbound message envelope (including `message` vs `slash_command`, thread/channel identifiers).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/contract/src/jev/` already contains the strict v1 request/response schemas, `JevProvider` interface, rule-based provider name, capabilities and frozen-field tests; build providers against these rather than inventing a second wire format.
- `packages/contract/src/events/inbound-event.ts` has the normalized `message` and `slash_command` action variants.
- `packages/domain/src/authz/permission-check.service.ts` exposes a per-app authorization check, but Phase 3 needs the **authorized candidate list** before constructing JEV tools; verify the Phase 2 RBAC implementation before reusing it.

### Established Patterns
- Four shared packages with strict linted module boundaries, three separate process entrypoints and `worker`-side message processing; HTTP webhook ack must not call a provider.
- The Phase 1 JEV fields and no-PII log/trace field controls are frozen. The only allowed provider payload is the filtered frozen request, subject to D-56…D-58; do not log its free text.
- Redis cache and BullMQ queue live on separate deployments. Rule-based routing must not depend on a hosted service.

### Integration Points
- Connect after identity resolution and the Phase 2 authorization filter in the inbound **worker** consumer, before link issuance and the execution-boundary permission re-check. Keep slash-command routing independent.
- `packages/domain/src/decision/` currently contains no implementation; `packages/domain/src/registry/app.repository.ts` is currently only a placeholder, and `apps/worker/src/app.module.ts` currently registers the platform heartbeat worker. Phase 2's runtime surfaces must be checked once its verification completes rather than assumed from plans.
- The issued create link and Slack reply should use the Phase 2 path, so plain-language `/leave request` parity is observable end-to-end.

</code_context>

<specifics>
## Specific Ideas

- The employee's "I want to request leave" should lead to the **same** signed form link as `/leave request`, without exposing hosted-provider or fallback transitions in chat.
- In a clarification, "1" or the displayed app name in the same Slack thread picks the app; additional detail is understood against the original request, and a third unsuccessful round is not started.
- Offline mode is useful in its own right, not merely a recovery demo: clear published app intents in English or Vietnamese route directly, while unknown/ambiguous requests get helpful **authorized** suggestions.
- The original PRD's ">90% accuracy" / "p95 <500 ms" claims are not validated for 100–800 candidate tools. Conformance must report results per app with confidence intervals and distinguish provider behavior from the end-to-end deadline, not repeat headline figures as facts.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within Phase 3 scope. Provider/model selection is a required **Phase 3 AI-SPEC/research task**, not a deferred feature.

</deferred>

---

*Phase: 3-Natural-Language Routing*
*Context gathered: 2026-10-07*
