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

---

### D-3 — the read path has no production link issuer (G-13) — **blocked on FND-10 / B-3 / D-27**

- **Discovered during:** the 2026-10-11 verification pass (`05-VERIFICATION.md`, gap #1 traced to
  its root). Recorded in `05-GAPS.md` as **G-13**.
- **Symptom:** every `/l/*` route (`GET /l/view/:jti`, `GET /l/query/:jti`, `GET`+`POST
  /l/edit/:jti`) is reachable **only by a hand-crafted token**. Nothing in the running system
  mints a signed read link, so the whole read path is a set of correct subsystems behind a
  missing door — and DAT-14 (the status page) fails for this reason, not for the lookup reason
  G-11 recorded (that half is now fixed).
- **Cause, precisely:** `packages/domain/src/links/link-issuer.service.ts` is the **only**
  `*issuer*` in the repo. Its body returns an **unsigned path fragment**
  (`/l/<appId>?u=<realUserId>`) and its own header says so: *"Trace stand-in for the Phase 2
  signed-link issuer (01-CONTEXT D-21 frozen claim set, jose ES256) … Real KMS-backed signing
  replaces this body without changing the seam."* Corroborating evidence: the frozen claim set is
  never **constructed** anywhere outside tests — a search for `target_id:` matches only the Zod
  schema that *parses* it (`packages/contract/src/links/read-link-claims.ts:117`).
- **Why it was not fixed here:** the signature must be **asymmetric** (the read link is a
  stateless, 90-day-lived, non-consuming token that a *static* renderer may need to reason
  about). The real signer is therefore KMS-backed with a `kid` keyring — precisely the machinery
  **FND-10** holds pending, because no KMS vendor has been named (`B-3` / `D-27`, `WINDOWS.md`
  #17). A local test-key signer wired into the production path would put an unrotated signing key
  on the critical path of a 90-day token: a security regression, not a fix.
- **Owner:** a phase that lands **after** FND-10's vendor is chosen — the read path is a
  phase-4/5 deliverable, so this is a prerequisite to calling those phases "reachable", not new
  scope invented here.

#### What the issuer must be (acceptance criteria for whoever picks this up)

| # | Requirement | Why |
|---|-------------|-----|
| 1 | Upgrade `LinkIssuerService.issue` **in place** — same seam, real body | the stand-in's header names this; the worker's `inbound-event.processor.ts` already calls it |
| 2 | Build the claim set from the frozen D-21 schema: `real_user_id`, `app_id`, `jti`, `action`, `perm_version`, `form_version`, and `target_id`/`query_version` where the class requires them | `ReadLinkClaimsSchema` is the single shape the verifier accepts; **no PII** beyond these opaque ids |
| 3 | Per-class TTL/consume semantics from `packages/contract/src/links/token-classes.ts` (`view` 90d no-consume, `query` 90d no-consume, `edit` 4h consume-on-submit) | those classes are frozen and `emittedInV1: true`; the issuer must not invent new ones |
| 4 | Emit `/l/<action>/<jti>?token=…` (the URL shape `ReadController` routes on), with `RENDERER_ORIGIN` for any redirect leg | the routes already exist; the issuer's output must match them |
| 5 | Asymmetric only — **EdDSA/ES256**, never HS256 | a symmetric link token means anyone holding the verify key can *mint* one, and the renderer must verify without holding a signing key |
| 6 | `kid` in the protected header, and a **keyring** resolver on verify | NFR-SEC-9: 90-day dual-key rotation, zero downtime |
| 7 | A boot-time guard that **fails closed** if the read signing key is not KMS-backed in production | mirrors the existing Phase-1 production guard; FND-10's own requirement text |
| 8 | Never a plaintext env var or config-file secret | FND-10; AES-256-GCM envelope via the existing `KeyProvider` |

#### Testable acceptance

- A `view` link minted by the issuer verifies through the real `ReadVerifierService` and renders
  the submission.
- A `query` link minted by the issuer resolves a seeded saved query end-to-end (G-11's store is
  already wired), then executes the DSL and scopes rows to the caller.
- A token signed with the **previous** `kid` still verifies during the rotation overlap window.
- A production boot with a non-KMS key provider fails closed with a named error.
- No spec mints tokens by hand any more — the hand-crafting in the current phase-4/5 suites is
  the smell this removes.

#### Interim position (unchanged by this note)

Local/test signing stays confined to specs. **Do not** wire a test-key signer into
`ReadModule`/`WorkerModule` "temporarily": that is the shape of change that becomes permanent,
and it is the one thing that makes NFR-SEC-9 unachievable later.
