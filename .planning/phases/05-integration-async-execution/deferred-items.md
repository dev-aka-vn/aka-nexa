# Deferred Items — Phase 05

Out-of-scope discoveries logged during plan execution. Not fixed here (scope boundary):
each entry names the owner plan/phase that should resolve it.

## From 05-09 (renderer surfaces A–D + self-hosted FormIO)

### D-1 — `apps/api/src/read/status-surface.integration.spec.ts` fails with a Nest DI error (pre-existing, owner: 05-08)

- **Discovered during:** 05-09 final verification (full-suite attempt).
- **Symptom:** `Nest can't resolve dependencies of the ReadController (..., ?, ...)` —
  `LinkTokenStore` at constructor index `[3]` is not provided in the spec's `RootTestModule`.
- **Cause:** plan 05-08 (`0e671435`) added `LinkTokenStore` to `ReadController`'s constructor,
  but `status-surface.integration.spec.ts` (last touched by 05-07, `12a901b8`) was not updated
  to provide it. The same applies to `edit-link.integration.spec.ts`.
- **Impact:** the two read-surface integration specs are red; the full suite is therefore not green.
- **Not caused by 05-09** — 05-09 touches only `apps/renderer/**`, `package.json`, `package-lock.json`.
- **Fix owner:** plan 05-08 (add the `LinkTokenStore` provider to the affected test modules).

### D-2 — full suite exceeds a 10-minute run budget

- 83 spec files, including Docker-backed `*.integration.spec.ts` (testcontainers).
- Docker is available on this host, but a complete `npx vitest run` exceeded a 10-minute timeout.
- The plan-scoped renderer suite (`npx vitest run apps/renderer`) is green: **3 files, 97 tests**.
