---
phase: 01-foundations-platform
plan: 06
subsystem: contracts
tags: [zod, jev, jwt, claims, frozen-contract, idempotency, rate-limit, contract-package]

requires:
  - phase: 01-foundations-platform (plan 01)
    provides: npm workspaces, TS 6.0.3 pin, Zod 4.6.5, `vitest`, the `@akane/contract` package skeleton
  - phase: 01-foundations-platform (plan 03)
    provides: the boundary graph — `packages/contract/src/**` is element type `contract`, allowed edge `['kernel']` plus the broad third-party allow, so a Zod-only contract package fits the existing graph unchanged
provides:
  - "JevRequestSchema / JevResponseSchema: the frozen JEV v1 wire contract, `.strict()`, `spec_version` 1.0"
  - "choice.verified (boolean | null) plus the verified===null cross-field refinement, and a required `choice` (D-23)"
  - "state.force_clarification: the platform can force clarification, not only the provider (D-23)"
  - "toJsonSchema(): z.toJSONSchema() output stamped with a version-bearing $id — the published artifact"
  - "JevProvider / JevCapability / HealthStatus: the first-party provider seam, plus RULE_BASED_PROVIDER_NAME"
  - "ReadLinkClaimsSchema: the fifteen D-21 claims, `.strict()`, discriminated by `action`, with a 90-day TTL ceiling enforced"
  - "TOKEN_CLASSES: a `{action, ttl, consume, emittedInV1}` config table keyed by the action union; `draft` reserved, not emitted (D-22)"
  - "RateLimitKeySchema: scopes `user` and `link` only — per-IP limiting is unexpressible (AUD-10)"
  - "ConnectorDescriptorSchema with a required `supports_idempotency_key`, and the `Connector` seam (DAT-13)"
  - "InboundEventSchema / OutboundMessageSchema: the internal IM envelopes on opaque ids and log-allowlist-safe field names"
  - "D-24's mechanical freeze: four tests assert an exact sorted top-level key set against a literal version-named array"
actuals:
  tokens: 15249
  tasks: 3
  commits: 3
commits: 3
plan_head_before: 52356b1
plan_head_after: bd0cc774fa78e3b948602cd5828ec3f4b337d880

tech-stack:
  added: []
  patterns:
    - "Frozen means two assertions, not one: `.strict()` catches an ADDED key at runtime, and a test against a literal sorted key array catches a REMOVED one. `.strict()` alone cannot see a removal, so a schema that quietly lost a claim still rejects everything unknown and looks compliant."
    - "A cross-field invariant is a machine-readable token in `issue.message`, never prose. Same pattern as `REDIS_INSTANCES_NOT_DISTINCT` in `redis.schema.ts` — Zod custom issues always carry `code: 'custom'`, so a message like 'inconsistent abstention' is unusable in a log or a test."
    - "A negative rule is enforced by making the bad thing unexpressible, not by discouraging it. AUD-10's 'never per IP' is a two-member enum; D-22's 'must not emit draft' is a boolean on a config row plus an `isEmittableInV1()` gate."
    - "Config tables are keyed by the contract's own union with `satisfies`, so widening a frozen enum without adding a row is a compile error rather than an unconfigured class at runtime."

key-files:
  created:
    - packages/contract/src/jev/v1/jev-request.ts
    - packages/contract/src/jev/v1/jev-response.ts
    - packages/contract/src/jev/v1/index.ts
    - packages/contract/src/jev/jev-provider.ts
    - packages/contract/src/jev/jev-v1.frozen.spec.ts
    - packages/contract/src/jev/jev-provider.spec.ts
    - packages/contract/src/links/read-link-claims.ts
    - packages/contract/src/links/token-classes.ts
    - packages/contract/src/links/read-link-claims.frozen.spec.ts
    - packages/contract/src/links/rate-limit-key.ts
    - packages/contract/src/links/rate-limit-key.spec.ts
    - packages/contract/src/connector/connector.ts
    - packages/contract/src/connector/connector.spec.ts
    - packages/contract/src/events/inbound-event.ts
    - packages/contract/src/events/outbound-message.ts
    - packages/contract/src/events/events.spec.ts
  modified:
    - packages/contract/src/index.ts

key-decisions:
  - "The JEV provider is a first-party named interface, not a vendor protocol (D-23). 'JEV' is a PRD invention with no industry standard and the PRD's 'OpenJev' implementations are unofficial reconstructions, so the contract is a type the platform owns."
  - "`choice` is REQUIRED in the response even though PRD §11.2 types it `choice?`. An optional object makes abstention expressible two ways (an absent `choice`, or a `choice` with no tool), and the PRD §17.3 conformance suite would then have two shapes to test for one signal. D-23 picks one: the object is always present, abstention is `verified === null`."
  - "The `$id` is stamped by the `toJsonSchema` wrapper, NOT by Zod's `override` hook. In `zod@4.6.5` `ctx.override(...)` is invoked for its side effect only — its return value is discarded (`node_modules/zod/v4/core/to-json-schema.js:460`) — and it runs once per SUBSCHEMA, so an unguarded `$id` would land on every property. Verified by probe before choosing."
  - "`z.toJSONSchema`'s `metadata` option is broken in `zod@4.6.5` — `ctx.metadataRegistry.get is not a function` throws. Avoid it; `.meta()` on a schema is the supported route."
  - "`alternatives` and `clarification_prompt` stay OPTIONAL, verbatim from the PRD: a confident single answer legitimately has neither a runner-up nor a prompt. The first draft of the JSON-Schema test wrongly asserted `required === V1_RESPONSE_KEYS`; the published document carries the full key set in `properties` and the required subset in `required`, and the test now asserts both separately."
  - "The 90-day ceiling on `exp` is a `.refine()`, not a comment. The plan's action text says 'exp (number of seconds, ceiling 90 days)'; as prose that is a number a future author retypes. As a refinement it is `READ_LINK_TTL_EXCEEDS_CEILING`, the same named-token pattern as the D-12 boot guard."
  - "`perm_version` is a REQUIRED claim on the frozen set even though D-21 scopes it to read links. The set is one `.strict()` schema; a write link does not need the epoch to mean anything, and making it optional would weaken exactly the read guarantee it exists for. The read-only rule lives in `READ_LINK_TARGET_RULES` and the verification sequence, not in a second schema."
  - "`TOKEN_CLASSES` is keyed by the `ReadLinkAction` union with `satisfies`, so a missing row is a compile error. D-22's whole point is that a future class is a config entry, not a code change — and a table that can silently lack a row is not that."
  - "`ttl` is an opaque configuration token (`'30m' | '4h' | '90d' | 'configurable' | 'reserved'`), not a parsed duration. Hardcoding a seconds resolver here would put a second source of truth for time in the contract package; the resolver is the link-issuing phase's."
  - "`draft` carries `ttl: 'reserved'`, not a number. D-22 defers the second token lifetime, and inventing one would be a guess dressed as a decision. `consume: true` mirrors `create` — a save token is redeemed by the save and a fresh one is issued."
  - "`notification.consume` is `false` — the PRD §6.6 default. §6.6 also allows a per-config single-use variant, but that changes whether a Redis row exists at all and §6.6 describes the class as stateless ('signed, bound to the original submitter'), so the variant is a store-level decision for Phase 2."
  - "The event envelopes' field names are drawn from the D-16 log-allowlist vocabulary (`action`, `app_id`, `form_id`, `queue`, `attempt`) on purpose: an envelope field is then never also a candidate for a serialised log record. `event_id` and `channel_id` are NOT on the log allowlist and must not be logged."
  - "`text` on the envelopes is user-authored content, not a PII attribute, and is documented as such. It is required — an event without it cannot be routed to anything — and inherits the submission's retention window. No PII-*denominated* field (email, display name, phone, avatar) is expressible, and `.strict()` makes adding one a rejected document."
  - "No boundary-rule change was needed and none was made. `packages/contract/src/**` is element type `contract` with allowed edge `['kernel']` plus the position-0 third-party allow, so `import { z } from 'zod'` and intra-package relative imports are both already legal. The rule was not weakened to make these files pass."

patterns-established:
  - "Version-frozen contract: `.strict()` schema + a test asserting `Object.keys(schema.shape).sort()` against a literal array named after the version. Applies to the JEV request, the JEV response, and the read-link claims. Deliberately does NOT apply to `connector/` and `events/` — those are ordinary versioned contracts, and a descriptor gaining a field invalidates nothing already deployed."
  - "Named issue tokens: every custom Zod issue carries a SCREAMING_SNAKE token in `issue.message` (custom issues always carry `code: 'custom'`), and a test asserts the token rather than prose."
  - "Refusal is a value, not an absence: `verified: null` is how a provider abstains, `emittedInV1: false` is how a token class stays unissued, `consume: false` is how a read link stays re-openable. A property that is merely missing is a property the next author will add back."
  - "Opaque IDs everywhere: `real_user_id`, `chat_user_id`, `channel_id`, `sub`, `target_id` are all opaque. The identity mapping is a service, not a field format."

requirements-completed: [RTE-10, LNK-07]
# AUD-10 and DAT-13 are delivered at their CONTRACT half only — this plan's
# `files_modified` scope — and are deliberately left Pending in REQUIREMENTS.md
# rather than ticked on half a sentence:
#   AUD-10  delivered: the user/link scope union and the key schema. Not yet:
#            "blocks only on signature failure", which is the link-verification
#            path (Phase 3/4).
#   DAT-13  delivered: ConnectorDescriptorSchema's required
#            supports_idempotency_key, and idempotencyKey on the execute input.
#            Not yet: "surfaced in the App Builder at publish time" (Phase 6).

coverage:
  - id: D1
    description: "The JEV v1 request top-level key set is frozen as exactly [context, question, request_id, spec_version, state, tools] and a test names the version 1.0"
    requirement: RTE-10
    verification:
      - kind: unit
        ref: "packages/contract/src/jev/jev-v1.frozen.spec.ts#freezes the request top-level key set"
        status: pass
      - kind: unit
        ref: "packages/contract/src/jev/jev-v1.frozen.spec.ts#names spec version 1.0"
        status: pass
    human_judgment: false
  - id: D2
    description: "The JEV v1 response top-level key set is frozen as exactly [alternatives, choice, clarification_needed, clarification_prompt, latency_ms, provider, request_id, spec_version]"
    requirement: RTE-10
    verification:
      - kind: unit
        ref: "packages/contract/src/jev/jev-v1.frozen.spec.ts#freezes the response top-level key set"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-23 addition 1: choice.verified is a boolean|null tri-state, choice is required, and verified===null forces tool_id===null and clarification_needed===true"
    requirement: RTE-10
    verification:
      - kind: unit
        ref: "packages/contract/src/jev/jev-v1.frozen.spec.ts#rejects a response that pairs an abstention with a chosen tool"
        status: pass
      - kind: unit
        ref: "packages/contract/src/jev/jev-provider.spec.ts#reports the D-23 abstention refusal as named codes, not prose"
        status: pass
    human_judgment: false
  - id: D4
    description: "D-23 addition 2: state.force_clarification lets the platform force clarification, and omitting it is rejected"
    requirement: RTE-10
    verification:
      - kind: unit
        ref: "packages/contract/src/jev/jev-v1.frozen.spec.ts#carries the request-side D-23 addition, state.force_clarification"
        status: pass
    human_judgment: false
  - id: D5
    description: "The published artifact is z.toJSONSchema() output stamped with a version-bearing $id, not a second hand-written schema"
    requirement: RTE-10
    verification:
      - kind: unit
        ref: "packages/contract/src/jev/jev-v1.frozen.spec.ts#publishes the response as z.toJSONSchema() output stamped with $id v1.0"
        status: pass
    human_judgment: false
  - id: D6
    description: "JevProvider is a satisfiable first-party interface and the terminal fallback is a named contract constant (RULE_BASED_PROVIDER_NAME === 'rule-based')"
    requirement: RTE-10
    verification:
      - kind: unit
        ref: "packages/contract/src/jev/jev-provider.spec.ts#is satisfiable by a provider that validates against the frozen schemas"
        status: pass
      - kind: unit
        ref: "packages/contract/src/jev/jev-provider.spec.ts#names the terminal fallback so its absence is a startup assertion, not a runtime surprise"
        status: pass
    human_judgment: false
  - id: D7
    description: "The read-link claim set is frozen as exactly the fifteen D-21 claims and the test names the version 1.0"
    requirement: LNK-07
    verification:
      - kind: unit
        ref: "packages/contract/src/links/read-link-claims.frozen.spec.ts#freezes the top-level key set"
        status: pass
      - kind: unit
        ref: "packages/contract/src/links/read-link-claims.frozen.spec.ts#names the claim version 1.0"
        status: pass
    human_judgment: false
  - id: D8
    description: "A read-link claim object carrying an unlisted key is REJECTED by .strict() rather than stripped, and no version claim of its own is expressible"
    requirement: LNK-07
    verification:
      - kind: unit
        ref: "packages/contract/src/links/read-link-claims.frozen.spec.ts#rejects a claim object carrying an unlisted key rather than stripping it"
        status: pass
      - kind: unit
        ref: "packages/contract/src/links/read-link-claims.frozen.spec.ts#carries no version claim of its own"
        status: pass
    human_judgment: false
  - id: D9
    description: "perm_version is the ACL-07 integer epoch; target_id is optional; query_version is present; a link past the 90-day ceiling is refused"
    requirement: LNK-07
    verification:
      - kind: unit
        ref: "packages/contract/src/links/read-link-claims.frozen.spec.ts#carries perm_version as the ACL-07 integer epoch"
        status: pass
      - kind: unit
        ref: "packages/contract/src/links/read-link-claims.frozen.spec.ts#makes target_id optional and requires query_version"
        status: pass
      - kind: unit
        ref: "packages/contract/src/links/read-link-claims.frozen.spec.ts#refuses a link that outlives the 90-day ceiling"
        status: pass
    human_judgment: false
  - id: D10
    description: "TOKEN_CLASSES has one row per action with ttl and consume, and `draft` is present but marked not emittable in v1 (D-22) — no draft machinery is built"
    requirement: LNK-07
    verification:
      - kind: unit
        ref: "packages/contract/src/links/read-link-claims.frozen.spec.ts#has exactly one row per action, each with ttl and consume"
        status: pass
      - kind: unit
        ref: "packages/contract/src/links/read-link-claims.frozen.spec.ts#marks draft present but not emittable in v1"
        status: pass
    human_judgment: false
  - id: D11
    description: "RateLimitKeySchema admits only the scopes user and link; an address-shaped scope is not expressible (AUD-10)"
    requirement: AUD-10
    verification:
      - kind: unit
        ref: "packages/contract/src/links/rate-limit-key.spec.ts#rejects a third scope — the union has exactly two members"
        status: pass
    human_judgment: false
  - id: D12
    description: "ConnectorDescriptorSchema requires supports_idempotency_key and rejects a descriptor that omits it (DAT-13)"
    requirement: DAT-13
    verification:
      - kind: unit
        ref: "packages/contract/src/connector/connector.spec.ts#rejects a descriptor that omits supports_idempotency_key"
        status: pass
    human_judgment: false
  - id: D13
    description: "InboundEventSchema and OutboundMessageSchema parse their documented envelopes on opaque ids, and reject any unlisted field"
    requirement: DAT-13
    verification:
      - kind: unit
        ref: "packages/contract/src/events/events.spec.ts#parses the documented envelope"
        status: pass
    human_judgment: false
  - id: D14
    description: "The whole contract surface is re-exported from packages/contract/src/index.ts and the package builds under the boundary lint gate"
    requirement: DAT-13
    verification:
      - kind: automated_ui
        ref: "npm run build  (eslint . && tsc -b) — exit 0"
        status: pass
    human_judgment: false

# Metrics
duration: 38min
started: "2026-10-02T15:18:00Z"
completed: "2026-10-02T15:56:00Z"
status: complete
---

# Phase 01 Plan 06: Frozen Contracts Summary

**Two irreversible Phase 1 contracts — the JEV v1 wire shape and the read-link claim set — frozen as `.strict()` Zod schemas with machine-checked exact key sets, so a later claim or field fails CI instead of invalidating every outstanding link or the provider conformance suite.**

## Performance

- **Duration:** 38min
- **Tasks:** 3
- **Files created:** 16
- **Files modified:** 1
- **Commits:** 3 task commits + 1 plan-metadata commit
- **Suite:** 16 files / 109 tests green (was 10 files / 72 tests); `npm run build` green

## Accomplishments

- **The JEV wire contract is frozen with exactly the two D-23 additions and nothing else.** `choice.verified: boolean | null` with a cross-field refinement that makes abstention *total* — `verified === null` forces `tool_id === null` **and** `clarification_needed === true`, reported as two named tokens — and `state.force_clarification: boolean` on the request. `choice` became required so abstention has one shape rather than two (D-23 overriding PRD §11.2's `choice?`).
- **The read-link claim set is frozen at fifteen claims, discriminated by `action`.** `.strict()` rejects an unlisted claim, and a test against a literal version-named array catches a *removed* one — the failure mode `.strict()` is blind to. The 90-day ceiling on `exp` is a refinement, not prose, and no version claim of its own is expressible.
- **D-22's blocker is closed at the cost of one enum value and one table row.** `TOKEN_CLASSES` is keyed by the action union with `satisfies`, so a missing row is a compile error; `draft` is present with `emittedInV1: false` and an `isEmittableInV1()` gate. No draft state machine, no resumable store, no invented lifetime.
- **AUD-10's "never per IP" is now a type, not a convention.** `RateLimitKeySchema` has exactly two scopes; `ip`, `address` and `cidr` are unexpressible. DAT-13's `supports_idempotency_key` is a **required** boolean, so an absent flag cannot be read as `false` and silently select the weaker strategy.
- **The boundary gate held without a single config change.** Every new import is either intra-package or the already-allowed `zod`; no policy was relaxed, and `package.json` / `package-lock.json` / `tooling/boundaries.config.mjs` are byte-identical (T-1-SC: no new package).

## Task Commits

1. **Task 1: JEV v1 request/response schemas, `JevProvider`, frozen key-set test** — `8dd8305` (feat)
2. **Task 2: Read-link claim schema, token-class table, frozen key-set test** — `20959c8` (feat)
3. **Task 3: Rate-limit key, connector idempotency declaration, remaining contract skeletons** — `bd0cc77` (feat)

Each task ran RED first (spec written before implementation, `Cannot find module` / failing assertions) then GREEN, and was committed only after `npm run build` exited 0.

## Files Created/Modified

- `packages/contract/src/jev/v1/jev-request.ts` — `TurnSchema`, `ToolDescriptorSchema`, `JevStateSchema`, `JevContextSchema`, `JevRequestSchema` (`.strict()`), `JEV_SPEC_VERSION`
- `packages/contract/src/jev/v1/jev-response.ts` — `JevChoiceSchema` (with `verified`), `JevAlternativeSchema`, `JevResponseSchema` (`.strict()` + `refineAbstentionIsTotal`), the two named issue tokens
- `packages/contract/src/jev/v1/index.ts` — the version barrel and `toJsonSchema()`, the published-artifact wrapper
- `packages/contract/src/jev/jev-provider.ts` — `JevProvider`, `JevCapability`, `HealthStatus`, `RULE_BASED_PROVIDER_NAME`, `SUPPORTED_JEV_SPEC_VERSION`
- `packages/contract/src/jev/jev-v1.frozen.spec.ts` — 8 tests: the two key-set literals, both D-23 additions, `.strict()` on the response, the published JSON Schema
- `packages/contract/src/jev/jev-provider.spec.ts` — 3 tests: interface satisfiability, the named fallback, the named abstention codes
- `packages/contract/src/links/read-link-claims.ts` — `ReadLinkActionSchema`, `ReadLinkClaimsSchema` (`.strict()` + 90-day `.refine`), `MAX_READ_LINK_TTL_SECONDS`, `READ_LINK_TARGET_RULES`
- `packages/contract/src/links/token-classes.ts` — `TOKEN_CLASSES` (6 rows, `satisfies`), `DRAFT_TOKEN_KEY_PREFIX`, `isEmittableInV1`
- `packages/contract/src/links/read-link-claims.frozen.spec.ts` — 11 tests covering both the claim freeze and the token table
- `packages/contract/src/links/rate-limit-key.ts` — `RateLimitScopeSchema`, `RateLimitKeySchema`
- `packages/contract/src/links/rate-limit-key.spec.ts` — 5 tests, including the two-member-union proof
- `packages/contract/src/connector/connector.ts` — `ConnectorDescriptorSchema` (required idempotency flag), `Connector`, `ConnectorExecuteInput`, `ConnectorExecuteOutcome`
- `packages/contract/src/connector/connector.spec.ts` — 4 tests
- `packages/contract/src/events/inbound-event.ts` — `ImPlatformSchema`, `InboundActionSchema`, `InboundEventSchema`
- `packages/contract/src/events/outbound-message.ts` — `OutboundActionSchema`, `OutboundMessageSchema`
- `packages/contract/src/events/events.spec.ts` — 6 tests (**deviation 1** — see below)
- `packages/contract/src/index.ts` — **modified**: was `export {}`; now re-exports the whole surface

## Deviations from Plan

### Files added outside `files_modified`

**1. [Rule 2 — auto-add missing critical functionality] `packages/contract/src/events/events.spec.ts`**
- **Found during:** Task 3, planning
- **Issue:** Task 3's `<behavior>` list has four items. Items 1–3 map onto `rate-limit-key.spec.ts` and `connector.spec.ts`; item 4 ("`InboundEventSchema` and `OutboundMessageSchema` parse their documented envelopes") has no declared spec file, and the plan's `<files>` for the task lists no `events/*.spec.ts`.
- **Fix:** Added `events/events.spec.ts` with the four declared event behaviours (both envelopes parse; unlisted fields rejected; negative `attempt` rejected; empty outbound `text` rejected). It is 6 tests, no production code.
- **Alternative rejected:** folding the event assertions into `connector.spec.ts`. A file named for one contract silently asserting another is the kind of thing that gets deleted as "stray tests" during a later refactor, which would silently drop the only coverage of the IM envelopes.
- **Note:** No new behaviour was invented — only the missing test home for a behaviour the plan already declared.

**2. [Deviation — additive exports] Symbols published beyond the plan's `artifacts` list**
- **Found during:** Tasks 1–3
- **Issue:** The plan's `artifacts` list names the required exports, not an exhaustive one. Several named behaviours could not be written without additional named symbols.
- **Fix (all additive, none replacing a planned export):** `JevStateSchema` / `JevContextSchema` (so `state.force_clarification` has a named, independently testable schema and the top-level `shape` is not the only way to reach it); `JevAlternativeSchema`; `JEV_V1_DOCUMENTS`; `SUPPORTED_JEV_SPEC_VERSION`; `HealthStatus` (required by `JevProvider.healthCheck` per PRD §11.2); `READ_LINK_TARGET_RULES` (carries D-21's "what `target_id` means per action" rule as data rather than a comment); `DRAFT_TOKEN_KEY_PREFIX` (D-22's reserved `ak:tok:draft:` namespace, which the plan named but assigned no symbol to); `isEmittableInV1`; `RateLimitScopeSchema`; `ImPlatformSchema` / `InboundActionSchema` / `OutboundActionSchema`; `ConnectorExecuteInput` / `ConnectorExecuteOutcome`.
- **Not a deviation in the risky direction:** nothing in the frozen key sets, the two D-23 additions, the fifteen claims, or the required-field set was widened.

### Implementation choices the plan left open

**3. [Rule 1 — auto-fix bug] The published `$id` is stamped by the wrapper, not by Zod's `override`**
- **Found during:** Task 1, before writing `toJsonSchema`
- **Issue:** The obvious implementation is `z.toJSONSchema(schema, { override: (ctx) => ({ ...ctx.jsonSchema, $id }) })`. In the installed `zod@4.6.5`, `ctx.override(...)` is called for its side effect only — its return value is discarded (`node_modules/zod/v4/core/to-json-schema.js:460`) — so the `$id` silently vanishes. It also runs once per *subschema*, so a mutation-based `$id` would land on every property unless guarded by `path.length === 0`.
- **Fix:** `toJsonSchema` spreads the generated document and appends `$id`. One line, no per-node hazard, no dependency on undocumented mutation semantics. Probed both behaviours before choosing.
- **Also recorded:** `z.toJSONSchema`'s `metadata` option throws `ctx.metadataRegistry.get is not a function` in this version. Avoid it.

**4. [Deviation — mechanism] The 90-day `exp` ceiling is a `.refine()`, not a comment**
- **Found during:** Task 2
- **Issue:** The plan's action text says "`exp` (number of seconds, ceiling 90 days)". As prose that is a number a future author retypes.
- **Fix:** `MAX_READ_LINK_TTL_SECONDS` plus a `.refine` emitting `READ_LINK_TTL_EXCEEDS_CEILING`, with a test. Same statement, mechanically enforced — in the spirit of D-24, and consistent with the named-token pattern `redis.schema.ts` established in 01-02.

**5. [Correction to a test assertion] The published JSON Schema carries the full key set in `properties`, not in `required`**
- **Found during:** Task 1, GREEN run
- **Issue:** My first draft asserted `toJsonSchema(...).required === V1_RESPONSE_KEYS`. It failed, correctly: `alternatives` and `clarification_prompt` are optional in PRD §11.1, so they are absent from `required` while present in `properties`.
- **Fix:** The test now asserts `Object.keys(properties).sort() === V1_RESPONSE_KEYS` **and** the exact required subset separately. Stronger than the original assertion, since it pins both halves.
- **Note:** the schema was never wrong; the assertion was. Recorded because the first draft is in the RED history.

**6. [Deviation — judgment] `Connector.execute`'s input and outcome types are invented**
- **Found during:** Task 3
- **Issue:** The plan says "the `Connector` interface" without specifying it. A `Connector` with no `execute` is not a seam, and inventing a large connector contract now would be the second source of truth the integration phase has to reconcile.
- **Fix:** The minimum that is actually a seam: `descriptor`, `execute(input)`, and a four-state closed `status` enumeration the platform can map to an `ErrorCode` and a retry decision. `ConnectorExecuteInput` carries `idempotencyKey: string | null` so the DAT-13 flag has a consequence at the call boundary.
- **Carried forward:** the connector payload/response mapping (jsonata, PRD field mapping) is **not** defined here and belongs to the integration phase.

### Deliberately NOT done

- **No boundary-rule change.** `tooling/boundaries.config.mjs` and `eslint.config.mjs` are byte-identical. The `contract` element type's allowed edge is `['kernel']` plus the position-0 third-party allow, so `zod` and intra-package relative imports were already legal. No policy was weakened to make these files pass.
- **No `jose` import.** R2 confines `jose` to `crypto-owner` / `connector-owner`, and this plan owns no signing. The claim schema is deliberately decoupled from the signer so the crypto owner can be Phase 1 plan 07/08's without this file moving.
- **No `zod-to-json-schema`.** T-1-SC: `z.toJSONSchema()` is native in Zod 4.
- **No draft state machine, no resumable-form store, no second token lifetime** (D-22). The reservation is the deliverable.
- **No JSON Schema artifacts written to disk.** `toJsonSchema()` is the published-artifact function; whether the routing phase writes the documents out at build time is that phase's call.

## Threat Model — disposition

| Threat | Component | Disposition | How it is satisfied |
|--------|-----------|-------------|---------------------|
| T-1-14 | `read-link-claims.ts` | mitigate | `.strict()` rejects any unlisted claim (test passes a `user_email`); the frozen key-set test catches a removed claim; `perm_version` is integer-validated and no PII claim is expressible. The 90-day ceiling is enforced, not documented. |
| T-1-15 | `jev-response.ts` | mitigate | `.strict()` plus `verified === null ⇒ tool_id === null && clarification_needed === true`, so a provider cannot smuggle a silent confident choice alongside an abstention. Both halves are asserted independently with named issue tokens. |
| T-1-16 | `rate-limit-key.ts`, `token-classes.ts` | mitigate | The scope union has exactly two members, so an address is unexpressible; `draft` carries `emittedInV1: false` and `isEmittableInV1()` is the gate a Phase 2 issuer must pass. |
| T-1-SC | npm installs | mitigate | No new package. `package.json` and `package-lock.json` are byte-identical. |

## Known Stubs

None. Every export in this plan is a schema, a type, a frozen constant, or a two-line pure function with a test. Nothing returns a hardcoded empty value, no placeholder text, no component without a data source. `grep -rn 'TODO|FIXME|coming soon|placeholder|not available yet' packages/contract/src` → no matches.

## Notes for the next plan

- **`TokenClass.ttl` is a token, not a duration.** Whoever builds the link-issuing service owns `'30m' | '4h' | '90d' | 'configurable' | 'reserved'` → seconds, and owns the D-12 key namespace for the one-time classes. Do not add a parser to the contract package.
- **`isEmittableInV1` is the only gate on D-22.** A Phase 2 issuer that constructs a token class without calling it will silently resurrect a v2 feature. The route through `TOKEN_CLASSES[action]` + `isEmittableInV1(action)` is the intended one.
- **`READ_LINK_TARGET_RULES` is documentation as data.** The read-link verification sequence still has to *enforce* "no `target_id` on a `create` link"; nothing here checks it, because a cross-action conditional would have added a refinement the plan did not ask for. The natural home is the verification service, which also knows whether the action permits a target at all.
- **`perm_version` is a required claim but a read-link-only meaning.** A write-link issuer will have no value to put in it. Either mint the current epoch for write links too (harmless, and keeps the claim set single-shaped) or revisit the D-21 ruling. The frozen key set forbids the second option without a version bump.
- **`Connector.execute` is the minimum seam.** Payload/response mapping (jsonata), auth, and retry policy are all still undefined and belong to the integration phase.

## Self-Check: PASSED

- All 16 planned files exist (plus the one recorded deviation); `packages/contract/src/index.ts` re-exports the whole surface.
- All 3 task commits exist in history: `8dd8305`, `20959c8`, `bd0cc77`. Measured `git rev-list --count 52356b1..HEAD` = **3**, matching the frontmatter.
- `npm run build` (eslint + tsc -b) exit 0 — the boundary gate passed with no config change.
- `npm test` exit 0 — 16 files / 109 tests, up from 10 files / 72 tests.
- Every plan `<verify>` command was run as written and returned 0 with a non-zero test count.
- `package.json`, `package-lock.json`, `tooling/boundaries.config.mjs`, `eslint.config.mjs` unchanged.

**Uncommitted pre-existing state, not this plan's:** `.planning/config.json` carries a `workflow.use_worktrees: false` addition from the orchestrator's sequential-mode setup, and `.gsd/`, `.planning/milestone.lock`, `.planning/state.json` are untracked orchestrator artifacts. None were touched by this plan.
