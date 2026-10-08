# Phase 4: Read Path & Query DSL - Research

**Researched:** 2026-10-08
**Domain:** Authentication/Authorization for read-only stateless links, Query DSL authorization surface, MongoDB query compilation
**Confidence:** HIGH

## Summary

Phase 4 implements **stateless read access** via signed JWT view/query links and a secure **Query DSL** that compiles to MongoDB filters. The core security invariant: authorization filters (`real_user_id` + `deleted_at: null`) are injected at the AST→compiler boundary, structurally outside user control, so raw MongoDB is never exposed (DAT-10). View links are stateless (verified with public key alone, LNK-05) and re-check permissions on every access via `perm_version` (LNK-06). A view link resolves to a single submission owned by `sub` (D-79); query links run DSL queries with injected filters. The `view_all` permission bypasses `real_user_id` injection but **never** bypasses `deleted_at: null` (D-78) — this is a compliance-critical invariant (soft-deleted rows must never leak to read links).

Key risks: the Query DSL is an authorization surface with no test precedent (SUMMARY.md#7); DAT-12 mandates one test per DSL construct proving injected filters survive; the 7 denial reasons (LNK-08) must be counted distinctly with OTel counter labels; dual-key rotation (SC#4) means links signed by previous key must remain valid during window.

**Primary recommendation:** Build the read verifier + link verification that branches on `action` (D-40) and uses a single filter-builder to AND-inject authorization filters at the compiler root. Treat the DSL→AST→compiler as a security boundary: validate with strict Zod (unknown keys rejected), compile only from AST (never from raw user object), and add DAT-12 tests before/alongside each construct.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| View/query link issuance (IM worker) | API/Backend (Worker consumer) | API | D-64: action-aware routing chain resolves `(tool_id, action)`, worker issues read link. Receiver must ack <200ms and enqueue. |
| Stateless JWT verification (public key) | API/Backend (Read endpoints) | Contract | LNK-05: verify with public key alone; no Redis lookup. Branch by `action` (D-40). |
| Permission re-check + perm_version | AuthZ (domain) | API | LNK-06: fresh check on every access; compare against live `perm_version`. ACL-07 defines epoch. |
| Denial tracking (7 reasons) | Observability (OTel) | API | LNK-08: per-reason counter with `reason` label + allowlisted log. Extend `LinkErrorFilter` enum/copy. |
| View page (single submission) | Renderer (stateless SPA) | API | D-68: FormIO read-only mode; view is own-record only (D-79); no cookie. |
| Query page (server-paginated table) | Renderer | API | D-69: columns from saved query projection; server-side pagination via DSL; WCAG 2.1 AA. |
| Query DSL JSON→AST | Domain (DSL) | Contract | DAT-10: strict Zod, unknown keys rejected; stored as JSON (seeds), compiled at access time. |
| DSL compiler → Mongo filter | Domain (Data layer) | Repository | DAT-11: single filter-builder ANDs `real_user_id` (unless `view_all`) + `deleted_at: null` at root; cannot be bypassed. |
| Saved queries (seeds + loader) | Provisioning (seeds) | Domain | D-73: `{query_id,query_version,dsl,intents,app_id}`; `query_version` bumps independently. |

## Standard Stack

### Core (existing project stack - reuse)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `jose` | 6.2.12 | JWT sign/verify; JWKS + key rotation | LNK-05 requires public-key verification; SC#4 needs dual-key window (LNK-12). Replaces jsonwebtoken for JWKS/keyResolver. |
| `zod` | 4.6.5 | Schema validation (claims, DSL AST, env) | Strict validation, unknown keys rejected; shared across contract/domain. |
| `@formio/js` | 5.6.1 | Read-only form rendering | D-68: single engine for create/view; S1 spike noted (Bootstrap 5, component.errors). |
| `mongodb` (native driver) | 7.7.0 | Query execution | Runtime-defined collections; compilation emits Mongo filter only (no raw query string). |
| `@opentelemetry/api` + exporters | 0.222.0 | Per-reason denial counters | D-71: OTel counter with `reason` label; single metrics path (no prom-client). |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@casl/ability` | 7.0.1 | RBAC checks | Permission checks for `view_all`, action-scoped perms (D-66). |
| `pino`/`nestjs-pino` | 10.3.1/5.2.1 | Structured logging (allowlist) | Denial logs must use allowlisted fields only (D-43, LNK-09). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom DSL JSON schema | JSONata | JSONata is more expressive but easier to accidentally allow injection; harder to prove filter-injection survival. Custom strict AST is auditable. |
| Hand-rolled Mongo filter builder | mongo-sanitize / querystring libs | Not sufficient - need structural AND-injection at root outside user AST. Custom builder is required for the "cannot be omitted" invariant. |

## Package Legitimacy Audit

> External packages not new for this phase (all from existing stack). No new packages introduced beyond what's already approved in STACK.md. `jose`, `zod`, `mongodb`, `@formio/js` already vetted.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `jose` | npm | mature | high | github.com/panva/jose | OK | Approved (existing) |
| `zod` | npm | mature | high | github.com/colinhacks/zod | OK | Approved (existing) |
| `@formio/js` | npm | mature (v5) | 52K/wk | github.com/formio/formio.js | OK | Approved (S1 spike noted) |

**Packages removed due to [SLOP] verdict:** none  
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram (conceptual)

```
IM (Slack/Teams) --action-aware--> Worker Consumer
                                   |  (resolves (tool_id,action), checks perms)
                                   v
                              Link Issuer (jose ES256)
                                   |  issues view/query JWT (90d, consume:false)
                                   v
User Browser (no cookie) -- GET /l/view/:jti?token --> Read Verifier
                                                        |  1) Verify JWT (pubkey only, LNK-05)
                                                        |  2) Branch by action (D-40)
                                                        |  3) Fresh perm check + perm_version (LNK-06)
                                                        |  4) Track denial reason (LNK-08) or allow
                                                        v
                                              View Path                Query Path
                                              |                        |  JSON DSL→AST→Compiler
                                              |  fetch submission     |  inject real_user_id (unless view_all)
                                              |  owned by sub (D-79)  |  + deleted_at:null (always, D-78)
                                              v                        v
                                           FormIO read-only      Server-paginated table
                                              (D-68)                (D-69)
```

### Recommended Project Structure

```
packages/
├── contract/src/links/
│   ├── read-link-claims.ts     # frozen (D-21) - existing
│   ├── token-classes.ts        # config table - existing
│   └── read-deny-reasons.ts    # NEW: 7 denial reasons (LNK-08)
├── domain/src/
│   ├── links/
│   │   ├── link-issuer.service.ts  # extend for read links
│   │   ├── read-verifier.service.ts # NEW: JWT verify + perm check + reason
│   │   └── read-deny.service.ts   # NEW: reason mapping + OTel counters
│   ├── dsl/
│   │   ├── ast.ts                # NEW: AST node types
│   │   ├── dsl.schema.ts         # NEW: strict Zod (unknown keys rejected)
│   │   ├── compiler.ts           # NEW: AST→Mongo filter + injections
│   │   ├── filter-builder.ts     # NEW: single builder for injections
│   │   └── dsl.service.ts        # NEW: orchestrate JSON→AST→filter
│   ├── submissions/
│   │   └── submission.repository.ts # extend: findByIdOwned, queryWithDsl
│   └── decision/
│       └── published-app-loader.ts # extend for action-scoped (D-66)
apps/
├── api/src/read/                # NEW: read endpoints (/l/view, /l/query)
├── renderer/src/read/           # NEW: view page, query page, dead-link page
└── worker/src/consumer/         # extend: issue read links on action match
```

### Pattern 1: Read Link Verification (action-branching)
**What:** Stateless verification that never hits Redis; branches on `action` (D-40); re-checks perms on every access (LNK-06).  
**When to use:** Any GET to a read link endpoint.  
**Example:**
```typescript
// Source: D-40, LNK-05, LNK-06
async verify(token: string) {
  const payload = await jose.jwtVerify(token, publicKey, { issuer, audience });
  const claims = ReadLinkClaimsSchema.parse(payload); // frozen schema
  if (claims.action === 'view') {
    // must belong to sub (D-79)
    const sub = await submissions.findByIdOwned(claims.target_id!, claims.sub);
    if (!sub) return deny('not_found_or_not_owned');
    // fresh perm check
    const ok = await permissionCheck.check(claims.app_id, claims.sub, 'submission:view', claims.perm_version);
    if (!ok) return deny('denied');
    return { ok: true, action: 'view', submission: sub };
  }
  if (claims.action === 'query') {
    const q = await savedQuery.get(claims.query_id!, claims.app_id);
    if (!q || q.query_version !== claims.query_version) return deny('wrong_version');
    const ok = await permissionCheck.check(claims.app_id, claims.sub, 'query:run', claims.perm_version);
    if (!ok) return deny('denied');
    return { ok: true, action: 'query', savedQuery: q, viewer: claims.sub, appId: claims.app_id };
  }
  return deny('invalid_action');
}
```
*Note:* The 7 denial reasons are mapped to `LinkErrorCode`/copy (D-70) and counted via OTel.

### Pattern 2: Query DSL Security Boundary (filter injection)
**What:** Single filter-builder that ANDs authorization filters at compiler root, outside user AST. `view_all` bypasses `real_user_id` only; `deleted_at:null` is always injected (D-78).  
**When to use:** Every query execution from read links.  
**Example:**
```typescript
// Source: DAT-10, DAT-11, D-74, D-78
function buildAuthFilter(viewerId: string, hasViewAll: boolean, appId: string) {
  const filters: any[] = [{ deleted_at: null }]; // ALWAYS injected
  if (!hasViewAll) {
    filters.push({ real_user_id: viewerId }); // bypassed only if view_all
  }
  // app scoping implied by collection/query; D-76 is per-app
  return filters.length === 1 ? filters[0] : { $and: filters };
}

function compile(ast: QueryAst, ctx: QueryCtx): MongoQuery {
  const userFilter = compileAst(ast); // compile only from AST
  const auth = buildAuthFilter(ctx.viewerId, ctx.hasViewAll, ctx.appId);
  const combined = userFilter ? { $and: [auth, userFilter] } : auth;
  return combined;
}
```
**Anti-pattern:** Concatenate raw user filter into query without structural AND at root. Never accept Mongo operators from builder UI; only allow DSL constructs (D-72).

### Pattern 3: Strict DSL Validation
**What:** JSON→Zod→AST with `strict()`/`passthrough(false)`; reject unknown keys. Each construct has DAT-12 test.  
**When to use:** Loading saved queries (seeds) and any runtime parsing.  
**Example:**
```typescript
// Source: D-74, DAT-12
const FilterExprSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('eq'), field: z.string().min(1), value: z.any() }).strict(),
  z.object({ op: z.literal('in'), field: z.string().min(1), values: z.array(z.any()).min(1) }).strict(),
  // ... others per D-72
]).strict();

const QueryDslSchema = z.object({
  filters: FilterExprSchema.optional(),
  sort: z.array(z.object({ field: z.string(), dir: z.enum(['asc','desc']) }).strict()).optional(),
  limit: z.number().int().positive().max(100).optional(), // server-enforced
  offset: z.number().int().nonnegative().optional(),
  projection: z.record(z.string(), z.literal(1)).optional(),
}).strict(); // unknown keys rejected
```

### Anti-Patterns to Avoid
- **Exposing MongoDB syntax:** DAT-10 forbids raw MongoDB; only DSL constructs (D-72). Reject `$where`, `mapReduce`, aggregation pipeline stages.
- **Injecting filters after user OR:** If user AST can produce `{ $or: [...] }` at top level and we OR auth in, user can bypass. Must AND auth at root outside user structure. Compiler must wrap user filter in `$and` with auth.
- **Bypassing deleted_at:** D-78 says `deleted_at: null` is **always** injected, even with `view_all`. Never make it conditional on role.
- **View link consumption:** D-42 says reads never consume; TOKEN_CLASSES has `consume:false` for view/query. Do not add Redis GETDEL for read links.
- **Counting reasons as aggregate:** LNK-08 requires distinct counts; don't log a single "denied" metric without `reason` label.
- **Using view_all to see deleted rows:** Compliance critical (PITFALLS.md §18). Enforce structural invariant in filter-builder (unit test this specifically).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT sign/verify with rotation | Custom HMAC+claims | `jose` (JWKS, keyResolver, ES256) | SC#4 dual-key window; handles `kid`, `nbf/exp`, algorithm allowlists correctly. |
| Mongo filter composition | String concatenation | Native Mongo query objects from AST compiler | Type-safe, testable; prevents operator injection; easy to AND auth at root. |
| Form read-only rendering | Custom HTML | `@formio/js` read-only mode | D-68 keeps single engine; handles conditions/validation display consistently. |
| RBAC + perm_version | Ad-hoc checks | `PermissionCheckService` + cache (existing) | ACL-06/ACL-07 already define pattern; reuse cache key with `perm_version`. |
| Denial metrics | Custom in-process counter | OTel counter with `reason` label | D-71 requires single metrics path; labels enable per-reason analysis. |

## Runtime State Inventory

> Include for rename/refactor/migration? This is a new feature phase (not rename/refactor). Omit runtime state inventory - no string renames/migrations identified. New collections/tables: `saved_queries` (seeds) — creation only, no migration of existing runtime state.

**Nothing found in category:** N/A - greenfield feature additions within existing systems.

## Common Pitfalls

### Pitfall 1: $or allows bypassing injected filters
**What goes wrong:** User query is `{ $or: [{ owner: x }, { status: y }] }` and compiler does `userFilter` OR `authFilter` → auth bypassed.  
**Why it happens:** Naive composition.  
**How to avoid:** Always AND auth at root: `{ $and: [authFilter, userFilter] }`. If user wants OR, it must be inside userFilter and both branches still under authFilter's scope? No - auth is global constraint (viewer scope + not deleted). Auth must wrap everything.  
**Warning signs:** Tests pass for simple eq but fail for OR groups (DAT-12 must cover groups).

### Pitfall 2: view_all bypasses deleted_at
**What goes wrong:** With `view_all`, filter becomes `{ real_user_id: ... }` missing `deleted_at:null` → deleted rows leak.  
**Why it happens:** Misreading D-78 as "bypass both" or "bypass real_user_id only" incorrectly. D-78 is explicit: bypass real_user_id only; deleted_at is always injected.  
**How to avoid:** Enforce in `buildAuthFilter` - push `deleted_at:null` unconditionally before role check. Add unit test: `view_all=true` yields both constraints present? No wait - D-78 says "view_all bypasses real_user_id only; deleted_at: null is always injected." So result is `{ $and: [{ deleted_at: null }] }` (no real_user_id). Add test asserting this.  
**Warning signs:** PITFALLS.md §18 calls this out explicitly.

### Pitfall 3: "consumed" reason for read links
**What goes wrong:** LNK-08 lists 7 reasons including "consumed" - but D-42 says reads never consume (TOKEN_CLASSES consume:false for view/query). This could confuse implementation.  
**Why it happens:** The 7 reasons likely span the shared link-error surface (write paths consume; read paths don't). "consumed" is unreachable for view/query actions.  
**How to avoid:** Define the 7 reasons explicitly in `read-deny-reasons.ts` (new) and document which apply to read vs write. For view/query, "consumed" should never be returned; but keep enum for compatibility with shared error model (D-70 extends LinkErrorFilter). Count it only if it ever occurs (but we should not produce it).  
**Warning signs:** Code tries to call Redis GETDEL on view links.

### Pitfall 4: Query version bump kills unrelated links
**What goes wrong:** D-75 says query_version bump invalidates outstanding query links with `wrong_version`. View links (by submission_id) must NOT be affected. Correct - view links don't carry query_version in a way that causes wrong_version; they carry their own claims. Verify verifier only checks query_version when action===query.  
**How to avoid:** Branch by action in verifier; only enforce query_version for query action.

### Pitfall 5: Dual-key rotation breaks existing links
**What goes wrong:** SC#4 requires links signed by previous key work through dual-key window; adding new key must not invalidate live links.  
**Why it happens:** Verifier configured with single public key.  
**How to avoid:** Use jose JWKS or keyResolver that accepts both current and previous public keys (kid-based). The frozen claims don't include kid - but jose header does. Ensure issuer embeds `kid` in header when signing; verifier resolves by kid. Plan for key rotation infrastructure (LNK-12 is a separate requirement; Phase 4 must be compatible with it).  
**Warning signs:** Rotation test fails - old token rejected immediately after adding new key.

### Pitfall 6: FormIO 5.x read-only mode differences
**What goes wrong:** Bootstrap 5 default, `component.errors` array vs object (from S1 spike). Read-only view may not render conditions correctly or show errors.  
**How to avoid:** Follow S1 spike recommendation before implementing view page (D-68). Test with representative form schema.  
**Warning signs:** View page looks broken vs create page styling.

## Code Examples

Verified patterns from project/contracts:

### Read link JWT claims (frozen)
```typescript
// Source: packages/contract/src/links/read-link-claims.ts
// action view/query carry perm_version, query_version; target_id rules per action
const claims = {
  iss, aud, sub: real_user_id, jti,
  iat, nbf, exp, // NumericDate
  action: 'view' | 'query',
  app_id, form_id, form_version, app_version,
  perm_version, query_version,
  target_id: submission_id | query_id | undefined,
};
```

### Denial reason enum (proposed)
```typescript
// NEW: packages/contract/src/links/read-deny-reasons.ts
export enum ReadDenyReason {
  expired = 'expired',
  consumed = 'consumed',        // unlikely for read links (D-42) - document
  revoked = 'revoked',
  wrong_app = 'wrong_app',
  wrong_version = 'wrong_version',
  deactivated_user = 'deactivated_user',
  bad_signature = 'bad_signature',
  not_found = 'not_found',
  not_owned = 'not_owned',
  denied = 'denied',           // permission denied
}
```
*Map to LNK-08's seven reasons as specified; may extend for internal cases but count by the canonical 7 where applicable.*

### DSL filter injection test pattern (DAT-12)
```typescript
// Source: DAT-12 - one test per construct
describe('DSL filter injection (DAT-12)', () => {
  it('eq construct preserves auth filters', () => {
    const ast = { filters: { op: 'eq', field: 'status', value: 'open' } };
    const q = compile(ast, { viewerId: 'u1', hasViewAll: false });
    expect(q).toEqual({
      $and: [
        { $and: [{ deleted_at: null }, { real_user_id: 'u1' }] }, // or simplified
        { status: 'open' }
      ]
    });
    // assert no way to remove deleted_at or real_user_id
  });
  it('view_all skips real_user_id but keeps deleted_at', () => {
    const ast = { filters: { op: 'eq', field: 'status', value: 'open' } };
    const q = compile(ast, { viewerId: 'u1', hasViewAll: true });
    const auth = q.$and[0];
    expect(auth).toEqual({ deleted_at: null }); // no real_user_id
    expect(auth.real_user_id).toBeUndefined();
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Stateful read links (store token in Redis) | Stateless JWT (public key verify) | LNK-05/06 design | Scales horizontally; verify is O(1) crypto; but requires fresh perm check (perm_version). |
| Expose MongoDB in UI/query builder | Strict JSON DSL→AST→compiler | DAT-10 | Eliminates injection class; auditable authorization boundary. |
| Denylist for auth filters | Structural AND injection at root | D-74, DAT-11 | Cannot be omitted by user query structure (OR groups, etc.). |

**Deprecated/outdated:**
- Raw Mongo query strings from client - forbidden (DAT-10). Use only DSL constructs.

## Assumptions Log

> Claims tagged [ASSUMED] needing confirmation.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The 7 denial reasons in LNK-08 are exactly: expired, consumed, revoked, wrong_app, wrong_version, deactivated_user, bad_signature (as stated in SC#2). "consumed" applies to read links? Or only write? | Pitfall 3, Common Pitfalls | If "consumed" is not applicable to stateless read links, we must still track it but never emit for view/query - or clarify scope. Low risk if we follow shared enum. |
| A2 | Dual-key rotation window duration (SC#4 says "zero-downtime dual-key window") - 90 days matches signing key rotation (LNK-12 states "Signing keys rotate every 90 days with zero-downtime dual-key window"). | Pitfall 5 | If window shorter, old links could be rejected prematurely. But LNK-12 gives 90d; consistent. |
| A3 | `view_all` is per-app (D-76) and granted via seeded role binding (D-77). No runtime grant in v1. | Architecture | Semantics baked into seeds; changing later needs group model. Correct per CONTEXT. |
| A4 | FormIO 5.x read-only mode works for view page without major CSS issues (Bootstrap 5). | Pitfall 6 | S1 spike required per D-68. If spike fails, fallback to formiojs 4.x (maintenance mode) as noted. |
| A5 | Saved queries store DSL as JSON; seeds use idempotent loader (D-31, D-73). No builder UI in Phase 4. | Structure | Record shape fixed now for Phase 6 inheritance. Correct. |

**If this table is empty:** No - A1-A5 are assumptions that need awareness. All other claims are from frozen contracts/CONTEXT (verified).

## Open Questions

1. **Seven denial reasons scope**
   - What we know: LNK-08 requires per-reason counts across 7 reasons; SC#2 lists them.
   - What's unclear: Does "consumed" occur for stateless read links? TOKEN_CLASSES say consume:false for view/query. 
   - Recommendation: Define reasons enum including all 7; for view/query, only emit reasons that can actually happen (bad_signature, expired, wrong_version, wrong_app, revoked, deactivated_user, denied/not_owned). Document "consumed" as reserved for write paths; still count if ever seen (defensive). Get clarification if needed, but implement safely.

2. **OTel metric naming for denial reasons**
   - What we know: D-71 says counter with `reason` label on single metrics path.
   - What's unclear: Exact metric name (e.g., `read_link_denials_total` with label `reason`, `action`?) and whether also log structured events.
   - Recommendation: Follow OTel naming conventions; include `reason` and `action` (view/query) labels. Keep labels low-cardinality (7 reasons fixed). Also emit structured log per denial with allowlisted fields (LNK-09).

3. **Key rotation mechanism details (LNK-12 deferred but SC#4 must hold)**
   - What we know: SC#4 requires dual-key window; LNK-12 says rotate every 90d.
   - What's unclear: Where are keys stored (KMS), how kid is assigned, JWKS endpoint?
   - Recommendation: Design verifier to accept multiple public keys (kid→key map). Issuer must set `kid` in JOSE header. This is compatible with jose's `jwtVerify` using `KeyLike` or `Uint8Array` array + `alg`. Don't block Phase 4 on full LNK-12 implementation, but ensure API is extensible.

## Environment Availability

> Phase has no new external runtime dependencies beyond existing stack. All services (MongoDB, Redis) expected per project setup.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| MongoDB | DSL query execution, submissions | ✓ (expected) | 8.0.x | — |
| Redis | RBAC cache (existing), link state (write paths only) | ✓ (expected) | ≥8.2 | — |
| Node.js | Runtime | ✓ | 24.x LTS | — |

**Missing dependencies with no fallback:** none  
**Missing dependencies with fallback:** none

## Validation Architecture

> workflow.nyquist_validation assumed enabled (absent). Include validation architecture.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 5.0.3 |
| Config file | vitest.config.ts (expected) |
| Quick run command | `npx vitest run --maxWorkers=2` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LNK-05 | Stateless JWT verify with public key | unit + integration | `vitest run packages/domain --grep "read.*verify\|LNK-05"` | ❌ Wave 0 |
| LNK-06 | Fresh perm check + perm_version on every access | unit + integration | `vitest run packages/domain --grep "perm_version"` | ❌ Wave 0 |
| LNK-08 | Per-reason denial counts (7 reasons) | unit | `vitest run packages/domain --grep "deny.*reason\|LNK-08"` | ❌ Wave 0 |
| DAT-10 | DSL → AST → Mongo; raw Mongo never exposed | unit | `vitest run packages/domain/dsl --grep "DAT-10"` | ❌ Wave 0 |
| DAT-11 | Inject real_user_id (unless view_all) + deleted_at:null always | unit | `vitest run packages/domain/dsl --grep "DAT-11\|filter.*inject"` | ❌ Wave 0 |
| DAT-12 | One test per DSL construct asserting filters survive | unit | `vitest run packages/domain/dsl --grep "DAT-12"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --maxWorkers=2 packages/domain` (quick)
- **Per wave merge:** `npx vitest run` (full suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/domain/src/dsl/__tests__/compiler.spec.ts` — covers DAT-10/DAT-11/DAT-12 core cases
- [ ] `packages/domain/src/links/__tests__/read-verifier.spec.ts` — LNK-05/LNK-06 cases
- [ ] `packages/domain/src/links/__tests__/read-deny.spec.ts` — LNK-08 per-reason counts
- [ ] `packages/contract/src/links/read-deny-reasons.ts` — new enum/type (exported)
- [ ] Seed fixture for saved queries (D-73) if needed for integration tests

*(If no gaps: none - all need creation)*

## Security Domain

> security_enforcement assumed enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | JWT ES256 with jose; public key verify only; no shared secret for read links. |
| V3 Session Management | no | Stateless links - no server session; fresh perm check each time. |
| V4 Access Control | yes | RBAC + perm_version (ACL-07); filter injection enforces row-level scope; view_all scoped per-app (D-76). |
| V5 Input Validation | yes | Strict Zod on claims (frozen), strict Zod on DSL (unknown keys rejected); Mongo filter objects only (no string eval). |
| V6 Cryptography | yes | ES256 for signing; AES-256-GCM for secrets (existing); kid-based rotation support. |

### Known Threat Patterns for Node/MongoDB + JWT read links
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Horizontal privilege escalation (see others' submissions) | Elevation of Privilege | Structural AND of real_user_id or view_all bypass only real_user_id; deleted_at always injected (DAT-11, D-78); unit tests per construct (DAT-12). |
| DSL injection / operator abuse | Tampering | JSON→strict AST only; reject $where, raw ops; compile from AST; unknown keys rejected. |
| Stolen read link reuse after permission change | Elevation of Privilege | perm_version re-check on every access (LNK-06); ACL-07 bumps epoch on permission change. |
| Old key acceptance after rotation window closed | Spoofing | Dual-key window with kid; remove old key after window expires (LNK-12). |
| Link brute force / info leak via error | Information Disclosure | Return generic "invalid link" for bad signature where appropriate; but per-reason for UX (D-70); don't leak existence details beyond necessary. Count reasons separately. |
| Deleted data leak via view_all | Information Disclosure | deleted_at:null always injected even with view_all (D-78); PITFALLS §18 compliance rule. |

## Sources

### Primary (HIGH confidence)
- **CONTEXT.md (Phase 4)** - Locked decisions D-64–D-79, SC#1–SC#4, requirement mapping
- **REQUIREMENTS.md** - LNK-05/06/08, DAT-10/11/12, AUD-08 context
- **packages/contract/src/links/read-link-claims.ts** - Frozen claim set (D-21), MAX_READ_LINK_TTL_SECONDS, action rules
- **packages/contract/src/links/token-classes.ts** - view/query consume:false, 90d TTL
- **.planning/research/PITFALLS.md §18** - Soft-delete/DSL leak; view_all bypasses real_user_id only; deleted_at always injected
- **.planning/research/SUMMARY.md #7** - Auto-injected filters are authorization surface with no test precedent

### Secondary (MEDIUM confidence)
- **apps/api/src/common/filters/link-error.filter.ts** - Existing error model to extend (D-70)
- **packages/domain/src/authz/permission-check.service.ts** - perm_version pattern (ACL-06/07)
- **packages/domain/src/decision/published-app-loader.ts** - Action/authorization seam (D-64/D-66)
- **03-VERIFICATION.md** - Phase 3 patterns (traces, conformance)

### Tertiary (LOW confidence)
- **FORMIO 5.x migration notes (STACK.md §9.3)** - component.errors, Bootstrap 5; needs S1 spike confirmation
- **LNK-12 dual-key rotation** - Referenced but not fully specified in codebase yet

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Reuses existing vetted libraries (jose, zod, mongodb, FormIO)
- Architecture: HIGH - Decisions are explicit in CONTEXT; frozen contracts guide shape
- Pitfalls: HIGH - PITFALLS.md §18 is explicit about deleted_at/view_all; SUMMARY.md flags DSL as high-risk

**Research date:** 2026-10-08  
**Valid until:** 2026-11-07 (30 days - security/authorization surface is stable once locked)