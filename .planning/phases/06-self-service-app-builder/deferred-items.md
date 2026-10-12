# Phase 06 — Deferred items

## Out-of-scope discovery (06-03, 2026-10-12)

**16 pre-existing TypeScript errors in `apps/api` (from plan 06-02)**

Discovered when 06-03's domain/contract changes invalidated the api
package's incremental build cache (`tsc -b` had not run since 06-02 —
that plan's verify commands were vitest-only, which does not typecheck).

The errors are in 06-02's committed code, untouched by 06-03:

- `apps/api/src/auth/auth.session.integration.spec.ts` (4 errors:
  `Response.json()` returns `unknown` in the TS 6 lib; `realUserId`
  not on the parsed body type)
- `apps/api/src/auth/oidc-issuer.stub.ts` (1 error: `string | null`
  not assignable to `string` at line 400)
- `apps/api/src/auth/session.middleware.ts` (1 error: `string | null`
  not assignable to `string` at line 136)
- `apps/api/src/users/sso-mapping.integration.spec.ts` (10 errors:
  `unknown` response bodies)

Verified pre-existing by reverting all 06-03 changes and clearing every
`*.tsbuildinfo`: the same 16 errors reproduce at the base commit
`e04f7def`.

**Why not fixed here:** the deviation rules scope auto-fixes to issues
directly caused by the current task's changes; these are pre-existing
failures in unrelated files. They need a small 06-02 follow-up: type
the response bodies (`as`-narrow or a typed wrapper on `Response.json()`)
and the two `string | null` sites in the auth middleware/stub.

**Impact:** `npm run build` (`tsc -b`) fails at the api project until
fixed. Vitest runs are unaffected (vitest transpiles without
typechecking). 06-03's own files compile clean — `tsc -b` reports zero
errors in `packages/**` and `apps/worker/**`.

## Resolved (2026-10-12, follow-up commit on the 06-02 scope)

**The 16 TypeScript errors are fixed.** `npx tsc -p apps/api/tsconfig.json
--noEmit` exits 0 and `npm run build` (lint + `tsc -b`) exits 0.

- `session.middleware.ts`: `readSessionId`'s `string | null` is now
  narrowed by an early return before `sessions.get(sessionId)`.
- `oidc-issuer.stub.ts`: `form.get('refresh_token')`'s `string | null`
  is narrowed by an early `invalid_grant` return.
- `auth.session.integration.spec.ts`: the `/auth/me` body is cast to
  `{ real_user_id: string; mfa_at: number }`; the D-104 same-subject
  assertion now reads `second.record.realUserId` — it previously
  compared two `undefined`s (the helper returns `{ cookie, record }`),
  so the test passed vacuously; it now genuinely asserts D-104.
- `sso-mapping.integration.spec.ts`: the four `Response.json()` sites
  are cast to their wire shapes.

**R2 secret-containment on the OIDC stub — resolved by exclusion, not
by weakening.** `eslint .` (part of `npm run build`) flagged
`oidc-issuer.stub.ts`'s `jose` import: R2 reserves the signing surface
for `packages/platform/src/crypto/**` and `packages/domain/src/connectors/**`.
The stub is a test fixture — a minimal *real* issuer that signs test
tokens with an ephemeral in-memory key (no secret, no env, no KMS) —
so `**/*.stub.ts` joins the boundaries rule's `ignores` alongside
`**/*.spec.ts`, the same classification the entrypoint-drift walk
already gives stubs (test artifacts, not process code). The fixture
smoke test (`boundaries.fixture.spec.ts`, 9/9) still proves every
policy fires against `tooling/boundaries-fixtures/**`, which are not
`.stub.ts` files.

**Still open (pre-existing, out of Phase 6 scope):** the entrypoint-drift
spec's six api orphans (slack adapter ×3, link-error filter, permission
guard, submissions controller) — unreachable from any `main.ts`. Their
fix belongs to the phase that wires each surface into `AppModule`; see
`06-02-deferred-items.md`.
