# Phase 3: Natural-Language Routing - Research

**Researched:** 2026-10-07
**Domain:** Bounded local intent-classification routing over a frozen JEV v1 provider seam (NestJS 12 worker, offline `RuleBasedProvider` baseline)
**Confidence:** HIGH

## Summary

Phase 3 upgrades Phase 2's Slack `/leave request` deterministic routing so a plain-language English/Vietnamese request reaches the same signed form link. The implementation surface is already frozen: `JevProvider`, `JevRequestSchema`/`JevResponseSchema`, `RULE_BASED_PROVIDER_NAME`, the inbound `InboundEvent` envelope, and the `packages/domain/src/decision/` boundary element type (`'decision'` in `DOMAIN_ELEMENT_TYPES`, `tooling/boundaries.config.mjs`) all exist. The `decision` package is empty except `.gitkeep`; the worker's `InboundEventProcessor` is still the Plan 02-01 placeholder, so Phase 3 wires against the Phase 2 surfaces that land before/around it.

The mandatory baseline is a fully local, deterministic `RuleBasedProvider` in `packages/domain/src/decision/`, plus the routing orchestrator around it: fresh per-app RBAC filtering **before** any provider/cache, Zod validation at both boundaries, a config-ordered provider chain with a shared absolute 2-second deadline from IM receipt, per-60s provider health, RTE-09's canonical cache key, bounded two-round clarification state in Redis, and the 50-intent labelled conformance suite with per-app Wilson intervals. No new npm packages are needed — Zod, ioredis, BullMQ, OTel, vitest, testcontainers, fast-check is NOT installed (do not add).

**Primary recommendation:** Implement `RuleBasedProvider` + `RoutingOrchestrator` + clarification session store + conformance fixture harness inside `packages/domain/src/decision/`, keep every frozen JEV field untouched, reconcile the D-23 `verified:false` prose discrepancy with a negative test only, and never call a hosted provider in the baseline build (no hosted adapter code path is active by default).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-48:** For competing plausible authorized apps, show up to three app names as short choices; never issue a form link until the user chooses. Never expose an unauthorized candidate, including in the wording of alternatives.
- **D-49:** The employee chooses by replying with an app name or number in the **same Slack thread**. Do not require Slack-specific buttons or a new interactive control.
- **D-50:** If the reply adds details rather than selecting a choice, re-evaluate with the original request and that reply as conversation context, after filtering the currently authorized tools again. A typed clarification is not a new, context-free request.
- **D-51:** Allow at most **two clarification replies**; if still unclear, offer examples or slash commands and invite a fresh request. Do not keep questioning indefinitely. The chat-facing path remains inside the phase's routing budget; exact expiry and storage mechanics are left to planning.
- **D-52:** The offline matcher draws phrases from **published apps' declared intents and descriptions**, rather than a separate central phrase catalogue. App owners' declarations are the source of truth; a deprecated app does not gain new triggers merely because it remains functional.
- **D-53:** Recognize distinctive keywords and explicitly declared aliases, tolerating case and simple wording variation. Do not guess through broad fuzzy similarity. Both offline and hosted choices remain subject to each app's configured confidence threshold.
- **D-54:** For no clear authorized match, say that none was found and offer a few **authorized** app examples or slash commands; do not surface the global catalogue or an infrastructure error.
- **D-55:** If the offline provider finds one clear authorized match above the app's threshold, issue the same signed form link directly. A hosted-provider outage is not a reason to require confirmation; weak or competing matches still clarify.
- **D-56:** A hosted provider may be enabled only if approved for the deployment's **locked data region**. Otherwise routing remains local; swapping providers through configuration cannot waive regional approval.
- **D-57:** Before a hosted call, redact obvious email addresses, phone numbers and employee IDs in the current message **and recent turns** while preserving the intent. Do not add profile fields, form submissions or raw chat histories to the frozen JEV request. `context.real_user_id` remains an opaque ID. Best-effort, not a guarantee; researcher should identify how to fail safely when redaction is uncertain. Never log unredacted text or provider payloads.
- **D-58:** Enabling a hosted provider requires a verified **no-training, no-retention-beyond-processing** commitment. If a provider cannot meet it, leave it unconfigured.
- **D-59:** A deployment with **no approved hosted provider** is a fully supported local-only mode, not a boot failure. The rule-based provider is still the mandatory terminal link in every configuration.
- **D-60:** Equal core coverage for **English and Vietnamese** on seeded app intents and offline matching. For a single-language request, reply in that language.
- **D-61:** For a mixed English/Vietnamese request, match authorized intents in **either** language; conflicting matches clarify instead of picking a dominant language.
- **D-62:** For a language outside English/Vietnamese, use the contract's `state.force_clarification` rather than silently selecting an app. Reply with concise bilingual guidance plus authorized slash-command examples. Slash commands retain their deterministic Phase 2 path.
- **D-63:** For mixed-language ambiguity, the clarification prompt is concise **English and Vietnamese**; display app names as published.

### the agent's Discretion
- Exact Slack copy, display order of equally relevant authorized alternatives, expiry and interruption behavior of a clarification thread, and conservative keyword/alias scoring; these must preserve D-48…D-63, fresh authorization, and the 2-second chat-to-link budget.
- Vendor/model, provider hosting arrangement, cost profile, conformance cases, calibration methodology, and safe multi-turn cache behavior via `AI-SPEC.md` and research. Do not revise the frozen JEV v1 fields or the required RTE-09 cache-key shape to make multi-turn easier; never serve a cached single-turn choice for a different conversation context.
- The PRD's example timeout and confidence numbers are **examples**, not measured guarantees. Preserve app-specific thresholds, propagated deadlines and 60-second health checks; substantiate numerical defaults in research and tests.

### Deferred Ideas (OUT OF SCOPE)
- None in CONTEXT.md — deferred list is empty; provider/model selection is a required Phase 3 AI-SPEC/research task, not a deferred feature.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RTE-01 | Plain-language message selects the correct app | RuleBasedProvider over published app intents/aliases + conformance suite |
| RTE-02 | Slash command routes deterministically, bypassing decision model | Keep Phase 2 slash path independent of JEV pipeline |
| RTE-03 | Decision model receives only authorized tools | Orchestrator filters `tools` and `app_hints` by fresh per-app RBAC before any provider/cache |
| RTE-04 | Providers pluggable via config-driven registry | DI-registered ordered provider registry; `JevProvider` seam |
| RTE-05 | Rule-based provider works offline, terminal in chain | `RuleBasedProvider` with no network deps, always last in chain, startup-asserted present |
| RTE-06 | Config-ordered fallback chain; deadline propagates, not fixed per-attempt timeouts | Absolute `deadlineEpochMs` threaded through queue→worker→providers |
| RTE-07 | Provider health checked every 60s; unhealthy skipped | Health-probe loop sampling `healthCheck()` at 60s cadence |
| RTE-08 | Below app's configured confidence threshold → clarification | Per-app threshold gate before link issuance |
| RTE-09 | Cache key `hash(text + sorted(tool_ids) + locale)`, configurable TTL | Canonical same-thread text + scope/version namespacing; no semantic cache |
| RTE-11 | Every provider passes 50 labelled intents; degrades on empty/unknown/malformed | RTE-11 conformance spec run against each registered provider incl. local |
| OBS-02 | Trace spans IM receive → identity → RBAC → decision → link → form → submit → route → respond | Fixed stage span names through the existing allowlisted OTel path |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Authorized candidate filtering | `packages/domain/src/authz` | `registry` | RBAC epoch/cache already live there; Phase 3 needs the authorized list, not a per-app bool only |
| Intent matching / decision | `packages/domain/src/decision` | `contract` (frozen JEV schemas) | Decision logic is domain; the wire shape stays frozen in contract |
| Provider chain, deadline, health, cache | `packages/domain/src/decision` (orchestrator) | `platform/redis` (queue side) | Orchestrator is caller-owned; Redis session/cache lives on cache Redis deployment |
| Clarification session state | Redis session (cache Redis) | worker consumer | Stateless workers, no sticky sessions (AD-9) |
| Throttled, ack-first webhook ingest | `apps/api` Slack controllers | worker | Receivers never call a provider; IM-03 |
| Inbound routing execution | `apps/worker` `InboundEventProcessor` | BullMQ `inbound-events` queue | All logic runs in the consumer (13.1) |
| Link issuance | existing Phase 2 link issuer | contract links schemas | Phase 3 reuses, never re-implements |
| Telemetry | `packages/platform/src/otel` | decision module spans | One OTel path, allowlisted attributes only |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | ^4.6.5 | Validate JEV request/response at both boundaries, cache/session state | Repo standard; frozen schemas are Zod |
| `@akane/contract` | workspace | `JevProvider`, `JevRequestSchema`, `JevResponseSchema`, `RULE_BASED_PROVIDER_NAME`, `ToolDescriptor` | Frozen seam; do not fork |
| `ioredis` | 6.0.0 | Cache-key lookups, clarification session state, provider health | One Redis client across app + BullMQ |
| BullMQ | 6.3.11 | Inbound event queue with `{akane-q}` prefix | Existing consumer pipeline |
| `@opentelemetry/api` | 1.9.1 | Stage spans `receive→identity→rbac→decision→link→form→submit→route→respond` | OBS-02 |
| Node 24 `crypto` | stdlib | SHA-256 cache-key hash | No dependency for `crypto.createHash` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^5.0.3 | Conformance suite, negative contract tests | `npm test` |
| testcontainers | 12.2.0 | Real Redis/Mongo for cache/revocation/RBAC integration specs | Integration specs |
| pino/nestjs-pino | 10.3.1 / 5.2.1 | PII-allowlisted structured logs | Routing events without free text |
| `node-telegram-bot-api` n/a | — | Slack adapter from Phase 2 is reused | No new IM SDK in Phase 3 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Rule-based keyword/alias matcher | Hosted LLM provider | Local-only baseline required; no approved vendor/region/no-training proof. Hosted is optional config-gated extension, never default |
| Hand-rolled scorer | `fast-check` properties now | Only 5 labelled intent fixtures exist as AI-SPEC demo; fast-check is NOT installed; add only with strong case |
| Redis session store | Process-local conversation memory | AD-9: services stateless; in-memory memory breaks multi-replica workers |
| Mongo session store | Redis | Redis is the designated session/cache store; Mongo unique index is for idempotency keys |

**Installation:** No new packages. `npm ci` with committed lockfile is sufficient (verified: `package.json` already pins everything above).

**Version verification:**
```bash
npm ls zod ioredis bullmq vitest testcontainers @opentelemetry/api
# zod@4.6.5, ioredis@6.0.0, bullmq@6.3.11, vitest@5.0.3, testcontainers@12.2.0, @opentelemetry/api@1.9.1
```

## Package Legitimacy Audit

No external packages are installed by this phase. Nothing to audit. If a future approved hosted adapter needs an HTTP client, use Node 24 native `fetch` — never axios (breaks OTel continuity, per STACK.md §12).

## Architecture Patterns

### System Architecture Diagram

```text
Slack webhook/slash command
      │ (apps/api: verify signature, ack <200ms, enqueue, nothing else)
      ▼
BullMQ inbound-events ({akane-q} prefix, Redis_Queue)
      │
      ▼  apps/worker InboundEventProcessor (consumer; trace starts here)
identity resolution ── InboundEvent.kind
      │  (slash_command → Phase 2 deterministic path; bypass JEV entirely)
      ▼
RBAC: build authorized PublishedApp[]  ──► Redis_Cache (perm_version epoch)
      │  filter tools[] + app_hints[] to permitted IDs only
      ▼
JevRequestSchema.safeParse(request)   ── invalid → clarify/deny, never log text
      │
      ├── state.force_clarification (non-en/vi locale, <N chars, changed toolset)
      ▼
RoutingOrchestrator
      │  absolute deadline = IM_receipt + 2000ms (propagate, no per-provider reset)
      │  capability gate per conversation shape (multi_turn for follow-ups)
      ▼
provider chain (config order) ── future approved hosted adapter(s), skip when unhealthy
      │                         │ adapter owns AbortSignal.timeout(remainingBudget),
      │                         │ redact current + prior turns, validate region/no-train
      ▼ (always) RuleBasedProvider (terminal)
      │  score published intents/aliases per app, EN+VI, negation guard
      ▼
JevResponseSchema.safeParse(decision) ── spec_version/request_id match, fresh
      │                                          deadline check
      ▼
gate: verified===true, clarification_needed===false, id ∈ permitted, tool_id present,
      confidence ∈ [0,1] ≥ app.threshold, no competing permitted alternative,
      await canOpenNow(id), deadline remains
      │
      ├─ pass ──► Phase 2 link issuer → Slack reply in same thread
      └─ fail ──► safeParse alternatives → ≤3 authorized names (D-48) →
                  Redis clarification session (≤2 replies, same thread) →
                  chosen name/number re-runs RBAC + canOpenNow → link
                  added detail → re-evaluate original+reply as one context (D-50)
                  after 2 rounds → authorized examples/slash commands (D-51)
```

### Recommended Project Structure
```text
packages/contract/src/jev/          # FROZEN — do not edit; jev-provider.ts, v1/*
packages/domain/src/decision/       # Phase 3 implementation
├── rule-based.provider.ts          # RuleBasedProvider implements JevProvider
├── routing-orchestrator.ts         # chain order, deadline, health skip, Zod gates
├── decision-cache.service.ts       # RTE-09 key hash + TTL + epoch/version scope
├── clarification-session.service.ts# ≤2-reply Redis state in same thread
├── published-app-loader.ts         # app.repository: intents/descriptions for AUTHORIZED apps only
├── redaction.ts                    # best-effort email/phone/employee-ID strip (future hosted use)
├── *.spec.ts / *.integration.spec.ts
apps/worker/src/processors/inbound-event.processor.ts  # wire identity→RBAC→decision→issuer
```

### Pattern 1: Local-only route gate (RTE-03, RTE-05, RTE-08)
**What:** Every routing decision passes RBAC filter → Zod input → provider → Zod output → per-app threshold → fresh `canOpenNow` → link or clarify.
**When to use:** Every plain-language message and every clarification reply.
**Example:** AI-SPEC §4 `routeLocal(...)` — caller supplies `authorizedTools`, `local`, `threshold(toolId)`, `canOpenNow(toolId)`, `deadlineEpochMs`; invalid schema → clarify, never a link; `verified !== true` → no link.

### Pattern 2: Deadline as absolute epoch, not per-attempt timeout
**What:** `deadlineEpochMs = IM_receipt_ms + 2000` computed once and threaded through queue wait, identity, RBAC, provider, recheck, link, reply. Providers get remaining budget; local provider gets what remains after upstream stages.
**When to use:** Always. `AbortSignal.timeout(2000)` inside one provider silently eats the whole budget.

### Pattern 3: RTE-09 cache with canonical multi-turn text
**What:** `key = sha256(canonicalSameThreadText + '|' + sorted(tool_ids).join(',') + '|' + locale)`, scoped by `real_user_id`, `conversation_id`, `perm_version`, app-publication/threshold version. TTL configurable. Never log the plaintext or the raw hash.
**When to use:** Only to short-circuit an identical complete same-thread context. A single-turn cache hit must never satisfy a multi-turn follow-up.

### Pattern 4: RTE-07 health probe
**What:** A 60-second `setInterval` (or BullMQ Job Scheduler at 60s) samples `provider.healthCheck()`; a provider whose probe fails is skipped in the chain until a later probe succeeds. Local provider must still report healthy or boot fails loudly (it is the only guarantee).
**When to use:** Any provider configured in the chain, including the local one (its absence is a boot assertion).

### Anti-Patterns to Avoid
- **Trusting a provider/cache to enforce permissions** — `tools` is RBAC-filtered before the provider; check the chosen ID and every displayed alternative against fresh permission before issuing a link.
- **Returning a cached single-turn choice for a different thread/user/epoch** — re-filter and re-authorize on every cache hit.
- **Treating `confidence: 1` as calibrated certainty** — local exact match is a deterministic score, not a probability.
- **Relaying provider-generated `clarification_prompt` raw** — worker-owned localized templates only; never expose an unauthorized app name in copy.
- **Starting a third clarification loop** — cap at two replies, then offer authorized examples + slash commands.
- **Fuzzy similarity over the global catalogue** — offline scoring uses declared aliases/intents only (D-52/D-53); never guess via broad fuzzy match.
- **Logging raw question text, provider payloads, or unredacted recent turns** — FND-06 allowlist enforced pre-serialization; use fixed stage names, enum reasons, opaque IDs only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT/key rotation for links | custom signer | Phase 2 link issuer + `jose` | Already frozen/implemented |
| Session storage | in-process map | Redis on cache deployment | AD-9 statelessness, multi-replica workers |
| Retry/backoff for providers | custom loop | Config-ordered chain + absolute deadline + terminal local provider | Bounded failure mode, no vendor SDK |
| Conformance judge | LLM judge | Vitest + deterministic fixtures + Wilson intervals | Local-only baseline; labels are owner-reviewed |
| Rate limiting | ad-hoc counters | Existing hand-written `ThrottlerStorage` over ioredis (IM-06) | Reused, not rebuilt |
| PII redaction guarantee | regex "guarantee" | Best-effort strip + fail-safe skip of hosted call when uncertain | Free text cannot be guaranteed sanitized (D-57) |

**Key insight:** Phase 3 does not add infrastructure; it composes existing seams. Every new behavior (cache, clarification, health, deadline) is a thin service over Redis/Zod/OTel that already exists. Anything that feels like "add a dependency or a second HTTP stack" is a sign the design drifted.

## Common Pitfalls

### Pitfall 1: Cache poisoning across contexts
**What goes wrong:** A follow-up "yes, the IT one" in thread B returns thread A's cached leave-app link.
**Why it happens:** Cache keyed only on the latest reply, not on the canonical same-thread context plus user/conversation/epoch/publication version.
**How to avoid:** Build the key from the full bounded same-thread text + `sorted(tool_ids)` + `locale`, namespaced by opaque user/conversation and the permission epoch; invalidate on publication or threshold change.
**Warning signs:** Integration spec replaying the same reply in a new thread returns a link.

### Pitfall 2: Deadline reset per provider
**What goes wrong:** Total latency exceeds 2s because each provider got its own 2000ms.
**Why it happens:** `AbortSignal.timeout(2000)` inside each provider attempt.
**How to avoid:** One absolute `deadlineEpochMs` from IM receipt; each hop computes `remaining = deadline - now`; if `remaining <= 0` → safe clarification/help, never a link.
**Warning signs:** p95 chat-to-link > 2s under a simulated slow provider.

### Pitfall 3: Unauthorized leakage through alternatives or prompt text
**What goes wrong:** A clarification offers an app the user cannot open, or the provider returns a name the platform echoes raw.
**Why it happens:** Alternatives not re-checked against fresh RBAC, or relaying provider `clarification_prompt`.
**How to avoid:** Every displayed ID passes the current permitted set + `canOpenNow`; templates are worker-owned and localized (D-48/D-63).
**Warning signs:** Fixture case with a published-but-unauthorized app appears in reply text.

### Pitfall 4: Mixed-language negation flips the route
**What goes wrong:** "không xin nghỉ, cần laptop support" routes to leave.
**Why it happens:** English keyword match wins over a Vietnamese negation.
**How to avoid:** Negation guard in the rule provider; conflicting en/vi matches always clarify (D-61); force clarification for unsupported locales (D-62).
**Warning signs:** Conformance en/vi parity report shows mismatch on paired fixtures.

### Pitfall 5: Phase 2 surfaces assumed, not verified
**What goes wrong:** Phase 3 plan references a Phase 2 RBAC list API that does not yet exist (current `RbacService` is a stub granting everything; `InboundEventProcessor` is a placeholder).
**Why it happens:** Phase 2 is still in verification while Phase 3 context was gathered.
**How to avoid:** Phase 3 planning must name the exact Phase 2 artifact (authorized-candidate list, link issuer, Slack reply) as an explicit dependency and add an integration spec that exercises it; stubs are replaced, not wired over.
**Warning signs:** `npm test` green while the worker still returns `{ ok: true }`.

### Pitfall 6: `verified:false` silently treated as routeable
**What goes wrong:** A provider returns `verified:false` with a tool_id and the platform issues a link.
**Why it happens:** D-23 prose (AI-SPEC §2) says `false` = confident choice, but the delivered schema treats only `true` as routable; the spec follows the tested implementation.
**How to avoid:** Gate on `verified === true` only; add a negative test proving `false` never yields a link. Do not change the frozen v1 wire shape.
**Warning signs:** Test `choice.verified=false` passes through the link issuer.

## Code Examples

Verified patterns from repo + AI-SPEC:

### Rule provider skeleton (from AI-SPEC §3, adapted to repo)
```ts
// Source: .planning/phases/03-natural-language-routing/03-AI-SPEC.md §3
import {
  JEV_SPEC_VERSION, JevRequestSchema, JevResponseSchema,
  RULE_BASED_PROVIDER_NAME,
  type JevCapability, type JevProvider, type JevRequest, type JevResponse,
} from '@akane/contract';

export class RuleBasedProvider implements JevProvider {
  readonly name = RULE_BASED_PROVIDER_NAME;
  readonly spec_version = JEV_SPEC_VERSION;
  readonly capabilities: JevCapability[] = ['tool_selection', 'clarification', 'multi_turn'];

  constructor(private readonly publishedAliases: ReadonlyMap<string, readonly string[]>) {}

  async decide(input: JevRequest): Promise<JevResponse> {
    const started = performance.now();
    const req = JevRequestSchema.parse(input);
    // req.tools is ALREADY RBAC-filtered by the caller.
    const negated = /(?:^|[^\p{L}])(?:not|don't|không|đừng)(?=$|[^\p{L}])/iu.test(req.question);
    const matches = req.state.force_clarification || negated || !['en', 'vi'].includes(req.state.locale)
      ? []
      : req.tools.filter((t) => (this.publishedAliases.get(t.id) ?? []).some((a) =>
          req.question.toLowerCase().includes(a.toLowerCase())));
    const sole = matches.length === 1 ? matches[0] : undefined;
    const res: JevResponse = {
      spec_version: JEV_SPEC_VERSION,
      request_id: req.request_id,
      choice: sole
        ? { tool_id: sole.id, confidence: 1, verified: true }
        : { tool_id: null, confidence: 0, verified: null },
      ...(matches.length > 1 ? { alternatives: matches.slice(0, 3).map((t) => ({ tool_id: t.id, confidence: 1 })) } : {}),
      clarification_needed: !sole,
      ...(!sole ? { clarification_prompt: 'Which authorized app did you mean?' } : {}),
      provider: this.name,
      latency_ms: performance.now() - started,
    };
    return JevResponseSchema.parse(res);
  }

  async healthCheck() {
    return { status: 'healthy' as const, model_version: 'rules-v1', spec_version: this.spec_version,
             capabilities: this.capabilities, uptime_seconds: process.uptime() };
  }
}
```

### Orchestrator gate (from AI-SPEC §4)
```ts
// Source: .planning/phases/03-natural-language-routing/03-AI-SPEC.md §4
const permitted = new Set(authorizedTools.map((t) => t.id));
const parsedReq = JevRequestSchema.safeParse({
  ...draft,
  context: { ...draft.context, app_hints: draft.context.app_hints.filter((id) => permitted.has(id)) },
  tools: authorizedTools,
});
if (!parsedReq.success) return clarify();
const decision = await provider.decide(parsedReq.data);
const parsedRes = JevResponseSchema.safeParse(decision);
if (!parsedRes.success || parsedRes.data.spec_version !== parsedReq.data.spec_version ||
    parsedRes.data.request_id !== parsedReq.data.request_id || Date.now() >= deadlineEpochMs) return clarify();
const r = parsedRes.data;
const id = r.choice.tool_id;
const canIssue = r.choice.verified === true && !r.clarification_needed && id !== null &&
  permitted.has(id) && Number.isFinite(r.choice.confidence) && r.choice.confidence >= 0 && r.choice.confidence <= 1 &&
  r.choice.confidence >= threshold(id) &&
  !(r.alternatives ?? []).some((a) => permitted.has(a.tool_id)) &&
  (await canOpenNow(id)) && Date.now() < deadlineEpochMs;
```

### Cache key (RTE-09)
```ts
// Source: requirements RTE-09 + AI-SPEC §4b.5
const keyMaterial = `${canonicalSameThreadText}|${[...permittedToolIds].sort().join(',')}|${locale}`;
const cacheKey = `jev:decision:${real_user_id}:${conversation_id}:${perm_epoch}:${pub_threshold_version}:${sha256(keyMaterial)}`;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PRD "OpenJev" / vendor wire | Frozen `@akane/contract` JEV v1 (D-23, RTE-10) | Phase 1 | Provider swap = config, not code |
| class-validator DTOs | Zod Standard Schema (NestJS 12) | Phase 1 | One validation dialect |
| Per-attempt fixed timeouts | Absolute propagated deadline | Phase 3 design | 2s chat-to-link holds across chain |
| Process-memory conversation state | Redis thread-keyed session, ≤2 replies | Phase 3 design | Stateless workers |

**Deprecated/outdated:** PRD §11.4 example provider names are NOT approved selections. `formiojs` 4.x maintenance mode — already handled in shipped renderer.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Phase 2 will land a real authorized-candidate list API and worker routing before Phase 3 executes | Architecture / Pitfall 5 | Phase 3 blocks on stub replacement; plan must name the dependency |
| A2 | `verified:false` is never routable; only `true` issues a link | Code Examples / Pitfall 6 | Wrong gate silently routes unverified answers |
| A3 | No hosted provider is enabled in the baseline; local-only is a supported production mode | Constraints D-56…D-59 | Accidental outbound calls or boot failure on missing hosted config |
| A4 | Cache/session stored on the cache Redis deployment, not the BullMQ queue deployment | Standard Stack | Wrong Redis = lost sessions or eviction of queue state |
| A5 | Conformance fixtures are synthetic, non-employee text | Evaluation Strategy | Privacy breach if raw chat is used |

## Open Questions

1. **Exact Phase 2 worker surfaces** — what does the delivered `InboundEventProcessor`/link issuer expose once Phase 2 verification completes? What we know: current tree is placeholder/stubs. What's unclear: the final method signatures for the authorized-candidate list and the Phase 2 reply path. Recommendation: Phase 3 planning gates on a Phase 2 verification handoff; stub them behind the same seam until then.
2. **Redaction fail-safe** — when current + prior-turn redaction is uncertain, skip the hosted provider entirely (use local). Confirm the heuristic (e.g., any unmatched `@`, phone pattern, or employee-ID pattern blocks hosted routing) in the plan's deny-by-default gate. Recommendation: treat uncertainty as "not approved for outbound".
3. **Clarification-session expiry** — two replies inside the same Slack thread; TTL left to planning. Recommendation: bound by the longer of (2× the 2s routing budget) and the platform's natural thread-interaction window (e.g., 15 minutes), stored in Redis with a per-message cap.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 24 | runtime | ✓ | 24.x | — |
| MongoDB 8.0.x | persistence | ✓ (compose) | 8.0.x | testcontainers |
| Redis cache (`allkeys-lru`) | session/cache/health | ✓ (compose) | ≥8.2 (8.10 dev) | testcontainers |
| Redis queue (`noeviction`) | BullMQ | ✓ (compose) | ≥8.2 | testcontainers |
| Hosted JEV provider | optional chain link | ✗ none approved | — | local-only mode (supported) |
| Docker | integration tests | ✓ | — | — |

**Missing dependencies with no fallback:** none blocking — local-only routing is the supported baseline.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.3 |
| Config file | `vitest.config.mts` |
| Quick run command | `npm test -- packages/domain/src/decision` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RTE-01 | EN/VI "request leave" → same link as slash | integration | `npm test -- packages/domain/src/decision/decision-routing.integration.spec.ts` | ❌ Wave 0 |
| RTE-02 | Slash bypasses JEV | unit | `npm test -- apps/worker/src/processors/inbound-event.processor.spec.ts` | ❌ Wave 0 |
| RTE-03 | Provider payload contains only authorized tools | unit (spy) | decision-routing.integration.spec.ts (provider spy) | ❌ Wave 0 |
| RTE-04 | Swap provider by config | unit | decision-routing.integration.spec.ts | ❌ Wave 0 |
| RTE-05 | Local provider answers with no network | unit | rule-based.provider.spec.ts | ❌ Wave 0 |
| RTE-06 | Deadline propagates; local fallback inside budget | unit (clock) | routing-orchestrator.spec.ts | ❌ Wave 0 |
| RTE-07 | Unhealthy provider skipped; 60s probe | unit (fake timers) | provider-health.spec.ts | ❌ Wave 0 |
| RTE-08 | Below threshold → clarification, no link | unit | decision-routing.integration.spec.ts | ❌ Wave 0 |
| RTE-09 | Cache key hash(text+sorted ids+locale), TTL, no cross-context reuse | integration (Redis) | decision-cache.integration.spec.ts | ❌ Wave 0 |
| RTE-11 | 50 labelled intents pass for every provider incl. local; graceful on empty/unknown/malformed | conformance | `npm test -- packages/domain/src/decision/decision.conformance.spec.ts` | ❌ Wave 0 |
| OBS-02 | Stage-span continuity IM→…→respond | integration | otel stage-span spec (fixed names) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- packages/domain/src/decision`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/domain/src/decision/decision.conformance.spec.ts` — RTE-11, 50 labelled cases per provider
- [ ] `packages/domain/src/decision/decision-routing.integration.spec.ts` — RTE-01/03/04/08, link/slash parity, revocation
- [ ] `packages/domain/src/decision/decision-cache.integration.spec.ts` — RTE-09 cache TTL + cross-context isolation (testcontainers Redis)
- [ ] `packages/domain/src/decision/routing-orchestrator.spec.ts` — RTE-06 deadline propagation, fallback ordering
- [ ] `apps/worker/src/processors/inbound-event.processor.spec.ts` — RTE-02 slash bypass, worker wiring
- [ ] Synthetic labelled fixture set (≥50 intents, en/vi/mixed/ambiguous, negations, unsupported language, malformed, empty tools) versioned under `packages/domain/src/decision/fixtures/`

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Worker consumes already-authenticated inbound events |
| V3 Session Management | yes | Clarification session keyed by opaque user+thread, expiry, ≤2 replies, re-authz on every reply |
| V4 Access Control | yes | Fresh per-app RBAC filter before provider, on every reply, and at link issuance (ACL-06/07); no superuser bypass |
| V5 Input Validation | yes | Frozen Zod `JevRequestSchema`/`JevResponseSchema` at both boundaries; never trust casts; bounds on length and turns |
| V6 Cryptography | yes | SHA-256 cache-key hash via Node stdlib; no custom crypto; no secrets in logs/config |
| V7 Error Handling | yes | Safe clarification/help on any provider/cache/schema failure; never infrastructure error to user |
| V8 Data Protection | yes | PII-free allowlisted logs/traces before serialization; redaction + region/no-training gate before any future hosted egress; opaque IDs only |
| V10 Malicious Code | yes | No new dependencies; rules-based offline matcher, no dynamic code eval of model output |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthorized app in provider payload/choice/link | Elevation of Privilege / Information Disclosure | RBAC filter `tools`+`app_hints` before any provider/cache; re-check chosen + displayed IDs before link |
| Stale cache/session reuse across thread/user/epoch | Elevation of Privilege | Canonical multi-turn cache key scoped by user/conversation/perm epoch/publication version; fresh re-authz on hit |
| Sensitive text (email/phone/ID) exported to hosted provider | Information Disclosure | Redact current + prior turns; deny-by-default skip when redaction uncertain; never log payloads/text |
| Deadline overrun → late link or error | Denial of Service | Absolute epoch deadline; adapter owns remaining-budget abort; local fallback inside reserve |
| Provider returns malformed/extra fields | Tampering | Strict Zod gate on every response; version/request_id match; `verified:true` + threshold + no competing alternative gate |
| Mixed-language negation flips route | Tampering (integrity of intent) | Negation guard + conflict→clarify; never pick "dominant language" |
| Fuzzy/broad matching leaks unapproved apps | Information Disclosure | Offline matcher uses only published declared intents/aliases; threshold gate per app |
| Third-party CDN/formio in renderer | — | Already out of scope; renderer CSP/self-hosted from Phase 2 |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/03-natural-language-routing/03-CONTEXT.md` — D-48…D-63 decisions
- `.planning/phases/03-natural-language-routing/03-AI-SPEC.md` — framework decision, implementation guidance, eval strategy, guardrails
- `.planning/REQUIREMENTS.md` — RTE-01…RTE-11, OBS-02 wording, resolved conflicts
- `.planning/ROADMAP.md` §Phase 3 — goal, SC, wave notes
- `.planning/STATE.md` — Phase 1 decisions, phase 2 verification state
- `packages/contract/src/jev/jev-provider.ts`, `packages/contract/src/jev/v1/*`, `packages/contract/src/index.ts`
- `tooling/boundaries.config.mjs` — `decision` element type, boundary rules
- `packages/domain/src/authz/*`, `packages/domain/src/registry/app.repository.ts`, `apps/worker/src/processors/inbound-event.processor.ts` — current Phase 2 surfaces (stubs/placeholders verified this session)
- `AGENTS.md` / `.planning/research/STACK.md` — stack pins, no-new-package posture

### Secondary (MEDIUM confidence)
- AI-SPEC citations: Qian et al. EMNLP 2022, den Hengst et al. NAACL 2024, arXiv:2109.14350 — domain failure modes, not performance guarantees for EN/VI

### Tertiary (LOW confidence)
- None — hosted model/vendor/cost profile deliberately unselected pending approval

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already pinned in repo; no new installs
- Architecture: HIGH — frozen contract + AI-SPEC + existing Phase 1/2 seams verified in tree
- Pitfalls: HIGH — grounded in frozen-schema behavior, Phase 1 lessons in STATE.md, and stub surfaces verified this session

**Research date:** 2026-10-07
**Valid until:** 2026-11-06 (stable contracts; re-verify after Phase 2 verification lands)
