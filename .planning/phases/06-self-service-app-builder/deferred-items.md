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

## Out-of-scope discovery (06 UAT, 2026-10-15)

**The FormIO builder loads its Ace editor from `cdn.form.io` at runtime.**

Found while diagnosing G-06-3. Running the App Builder's designer against a
local vite dev server logs, on every builder mount:

```
Error: Uncaught NetworkError: Failed to execute 'importScripts' on
'WorkerGlobalScope': The script at 'https://cdn.form.io/ace/1.4.12/worker-json.js'
failed to load.
```

`@formio/js` does not bundle Ace. On first render of a component edit form it
calls `Formio.requireLibrary('ace', 'ace', <Formio.cdn.ace>/ace.js)`, and Ace
then pulls `worker-json.js`, modes and themes from the same origin. `ace-builds`
is absent from `node_modules`, so there is no local copy to fall back to.

**Why this matters:**

- It is a **new external network dependency on a third-party CDN** from a
  first-party admin surface. That contradicts `06-01-SUMMARY.md:275` ("`@formio/js`
  is loaded from the bundled npm package, not a CDN") — the *package* is bundled;
  the Ace *asset* is not.
- NFR-SEC-3 (no third-party CDN / SRI requirement) and the data-residency
  ("configurable and region-locked") constraint both assume the app has no
  runtime CDN dependency. A region-locked or air-gapped deployment would render
  the builder with a broken Ace editor and a console error on every mount.
- Blast radius is currently contained: Ace is only reached by TextArea components
  with `editor: 'ace'` and the builder's own JSON / Custom-CSS tabs. The phase's
  own seated schemas (textfield / number / button) never trigger it, and the
  signer-facing Form Renderer does not use it — so this is an **admin-console**
  concern, not a signer-path one.

**Explicitly not the cause of G-06-3.** A/B runs that aborted `cdn.form.io` did
not improve mount times (26.9 / 29.6 / 40.6 s with the CDN blocked vs. 6.3 / 15.5 s
without); the failing wait was dominated by vite cold-transforming
`@formio/js`, not by the CDN fetch.

**Not fixed here:** eliminating it is a design decision with a cost, not a
one-line change. Options are (a) vendor `ace-builds` and point
`Formio.cdn.setOverrideUrl('ace', <same-origin path>)` at it — new dependency
plus bundle weight; (b) register a bundled `window.ace` and override Ace's
worker/module URLs so `requireLibrary` short-circuits; or (c) disable the Ace
editor and drop the JSON / Custom-CSS editing tabs. This needs a small spike and
a product call on whether in-builder JSON editing is required. Recommended
owner: the phase that hardens the App Builder for a region-locked deployment (or
the Phase 3 Form Renderer hardening pass, since it shares the `@formio/js`
dependency).

## Resolved (2026-10-15, 06 UAT gap closure)

**The stray vitest stub at `tests/e2e/slack-leave.e2e.spec.ts` no longer breaks
the Playwright suite.** The file (a 7-line vitest stub, committed in Phase 02 as
`4dc31ae`) matched `playwright.config.ts`'s root-wide
`testMatch: '**/e2e/**/*.spec.ts'`, so a bare `npx playwright test` — the command
`06-VERIFICATION.md` names for UAT test 3 — aborted at collection with
`TypeError: Cannot read properties of undefined (reading 'config')`, running zero
specs. `vitest.config.mts` already excludes `**/e2e/**`, so nothing was running
the file at all.

Fixed by scoping `playwright.config.ts` `testDir` to `./apps/app-builder/e2e`
(the directory the config's own doc comment describes) with `testMatch:
'**/*.spec.ts'`. This keeps every documented invocation working (bare → 66 tests;
directory + project → 33; file + project → 4) and means a future non-SPA
Playwright suite in `tests/` gets its own config instead of being silently
absorbed by this one.

**Left in place deliberately:** the stub file itself was not deleted — it is a
prior-phase artifact and deleting another phase's file is not this workflow's
call. Recommendation: delete it, or rewrite it as a real Playwright spec under
its own config.

**Second independent E2E flake found the same session, and fixed: the roles
page's loading skeleton.**

While extracting screenshots with `--trace on`, the full suite failed 2 of 66 —
the *same* test on both projects: `roles.spec.ts:372`, "the roles page skeletons
while loading and renders a specific inline error with retry (BLD-09, BLD-07)",
with

    expect(locator).toBeVisible() failed
    Locator: getByTestId('skeleton')
    Timeout: 5000ms
    Error: element(s) not found

and the DOM snapshot already showing the resolved failure state ("Failed to load
the app's roles APP_READ_FAILED").

**Cause:** the assertion races its own stub. `stubRolesApi` fulfils the app GET
immediately, and a stubbed route resolves in about a millisecond — shorter than
Playwright's poll interval. The skeleton can therefore mount and unmount between
polls, so `toBeVisible` legitimately never observes it and reports
"element(s) not found" after 5 s. The roles page is not at fault: the skeleton
does render. It is also unrelated to G-06-3 — a different spec, which passed in
all three untraced runs (66/66, 66/66, 45/45). The extra overhead of `--trace on`
is what tipped the race.

**Fix:** added an optional `appGetDelayMs` hook to `RolesApiHooks`, set to 500 ms
in that one test, so the stub holds the read open and the loading state is
observable. Delaying the *response* is the supported way to assert a transient
loading state; the assertion itself is unchanged and no other test passes the
hook, so no other test's timing moves.

**Evidence:** `npx playwright test apps/app-builder/e2e/roles.spec.ts --trace on
--repeat-each=2` → 24 passed (1.4 m); then the full `npx playwright test --trace
on` → 66 passed (2.8 m), exit 0 — the exact condition that had failed.

**Why fixed rather than merely noted:** CI sets `trace: 'on-first-retry'` with
`retries: 2`. A machine slow enough to trip the race on the first attempt would
turn tracing on for the retry, changing the timing again rather than reliably
recovering.
