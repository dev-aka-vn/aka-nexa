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
