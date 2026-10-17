---
phase: 261015-p1h
plan: 01
subsystem: dev-tooling
tags: [dev-proxy, csrf, vite, oidc, guard-spec]
status: complete
key-files:
  created:
    - tooling/dev-proxy-shape.spec.ts
  modified:
    - apps/app-builder/vite.config.ts
    - .env.example
    - README.md
decisions:
  - "Dev-proxy Host preservation is the fix; the CSRF gate is frozen and untouched."
  - "/auth is proxied with no rewrite (it is already the API's own path) while /api keeps its key-stripping rewrite."
  - "A deterministic tooling spec reads vite.config.ts as text (boundary-safe) rather than importing it."
metrics:
  tasks: 3
  commits: 3
  files: 4
  duration: "~28m"
  plan_head_before: e82a1cb4957a399bc56133d82a451b18670056c3
  completed: 2026-10-15
---

# Phase 261015-p1h Plan 01: Fix dev-proxy CSRF (Vite changeOrigin) Summary

A Vite dev-proxy Host rewrite made the API see every SPA write as cross-origin, so a browser
at `http://127.0.0.1:5173` got `403 CSRF_ORIGIN_MISMATCH` on every POST/PUT/PATCH/DELETE while
reads still worked. Setting `changeOrigin: false` on the `/api` entry (Host preservation), adding
a `/auth` entry with no rewrite so the OIDC callback lands on the SPA origin, documenting the dev
`OIDC_REDIRECT_URI`, and adding one deterministic `tooling/` guard against a Host rewrite —
without touching the frozen CSRF gate.

## What was built

- **`apps/app-builder/vite.config.ts`** — `/api` entry now `changeOrigin: false` (was `true`); the
  header doc comment rewritten to state the Origin/Host contract, name the 403 the old rewrite
  caused, warn against reversing it, and explain why `/auth` differs from `/api`; new `/auth`
  entry (`target: API_ORIGIN`, `changeOrigin: false`, **no** `rewrite`). The `/api` key-stripping
  `rewrite` is kept (controllers are mounted unprefixed).
- **`.env.example`** — production example value kept unchanged; added a commented dev example
  (`OIDC_REDIRECT_URI=http://127.0.0.1:5173/auth/oidc/callback`) and split the "must be an `api`
  route" sentence into production-origin vs dev-SPA-origin.
- **`README.md`** — the Builder SSO `OIDC_REDIRECT_URI` row now names both origins; added the
  dev-proxy flow, the **single-spelling rule** (`localhost` vs `127.0.0.1` are different *sites*
  for the `SameSite=Strict __Host-` cookie → a mixed spelling answers `401 SESSION_MISSING`), and
  the `OIDC_ISSUER` same-spelling note.
- **`tooling/dev-proxy-shape.spec.ts`** (new) — reads `vite.config.ts` as text, strips comments,
  brace-matches `server.proxy`, slices it into top-level entries by quoted key + `: {`, then
  asserts non-vacuity first, no entry rewrites the Host, `/api` preserves it, and `/auth`
  preserves it with no rewrite.

## Task evidence

### Task 1 — Preserve the browser Host through the /api dev proxy

Commands (PowerShell has no `&&`; run separately):

| Command | Observed |
|---|---|
| `npx eslint apps/app-builder/vite.config.ts` | clean (no output) |
| `node -e "…strip comments; assert no changeOrigin:true, has changeOrigin:false, has '/api'…"` | `ASSERTION OK` |
| `git diff --name-only` | `apps/app-builder/vite.config.ts` only |

Commit **8e771a6** — `fix(261015-p1h): preserve the browser Host through the /api dev proxy`.

### Task 2 — Proxy /auth and document the dev OIDC redirect origin

`rg` is not installed on this host; used the grep tool / `Select-String` equivalents.

| Check | Observed |
|---|---|
| `npx eslint apps/app-builder/vite.config.ts` | clean |
| `changeOrigin` occurrences | 4 — header prose (×2) + `changeOrigin: false` on `/api` and `/auth` |
| `'/auth'` entry in vite.config.ts | present (line 89) |
| dev value in both files | `.env.example:162` **and** `README.md:200` |
| production value kept | `.env.example:166` `OIDC_REDIRECT_URI=https://api.example.com/auth/oidc/callback` unchanged |

Commit **b9540a6** — `fix(261015-p1h): proxy /auth and document the dev OIDC redirect origin`.

### Task 3 — Deterministic guard: the dev proxy must preserve the Host

| Command | Observed |
|---|---|
| `npx vitest run tooling/dev-proxy-shape.spec.ts` | **4 passed** |
| **Observed-red**: temporarily set `/api` `changeOrigin: true`, re-run | **2 failed / 2 passed** — failure messages name the Host rewrite *and* the 403: `a proxy entry sets changeOrigin: true — it rewrites the forwarded Host to the target's, so every state-changing request through it answers 403 CSRF_ORIGIN_MISMATCH at the API CSRF gate` and `the /api proxy entry must set changeOrigin: false — anything else rewrites the Host and reintroduces 403 CSRF_ORIGIN_MISMATCH on every write` |
| `git checkout -- apps/app-builder/vite.config.ts` then `git diff --stat` | empty (restored exactly) |
| `npx vitest run tooling/dev-proxy-shape.spec.ts` (restored) | **4 passed** |
| `npx vitest run tooling/deployment-shape.spec.ts` | **6 passed** |

Commit **d57aeca** — `test(261015-p1h): guard the dev proxy shape against a Host rewrite`.

Repo-wide / frozen-contract checks:

| Command | Observed |
|---|---|
| `npx eslint .` | clean |
| `npx tsc -b` | exit 0 |
| `npx vitest run apps/api/src/auth` (frozen CSRF regression, `auth.session.integration.spec.ts:350-399`) | **2 files, 22 passed** |

## Deviations from Plan

### 1. [Plan inaccuracy — no code impact] `tsc -b` does **not** typecheck the new spec
- **Plan said** (verification section): "`tooling/dev-proxy-shape.spec.ts` **is** in the `tsc -b`
  graph (via `tooling/tsconfig.json`)".
- **Reality:** `tooling/tsconfig.json`'s `include` is `["containers.ts", "redmine-stub.ts"]`, and
  **no** tsconfig in the repo includes `*.spec.ts` — so no spec, including this one, is in the
  `tsc -b` graph. The spec runs under vitest (esbuild), the repo's existing pattern.
- **Action:** no code change. `npx tsc -b` was run anyway (exit 0). Recorded so a future reader does
  not trust the plan's mechanism. Editing `tooling/tsconfig.json` would widen scope past the plan's
  four files, so it was left alone.

### 2. [Pre-existing, not caused by this task] Two `tooling/` suites are already red
- **Plan said** (done criteria): "`npx vitest run tooling/` stays green alongside
  `deployment-shape.spec.ts`, `entrypoint-drift.spec.ts`, `toolchain-pin.spec.ts`, and
  `onboarding.spec.ts`."
- **Observed:**
  - `tooling/entrypoint-drift.spec.ts` — **1 failing test**: "every app source file is reachable
    from its own main.ts". This is the exact failure recorded in `STATE.md`
    ("Six `apps/api` sources are unreachable from `main.ts` — the only failing test in the suite").
  - `tooling/toolchain-pin.spec.ts` — **suite-level throw**: "the install-guard job has no
    `grep -Eq` bypass assertion" (reads `.github/workflows/ci.yml`).
  - `tooling/onboarding.spec.ts` — **could not run offline**: it starts MongoDB/Redis containers and
    spawns real `api` child processes, so it timed out without Docker. Its `.env.example`/README
    assertions were reviewed by inspection and are compatible with this task's edits (see below).
- Both red suites read files **outside this task's diff** (`.github/workflows/ci.yml`,
  `apps/api/src/**`), so they are pre-existing and independent of this change. Recorded plainly
  rather than reported as green.

### 3. [Environment] `rg` unavailable; PowerShell has no `&&`
- The plan's `<verify>` commands use `rg` and `&&`. `rg` is not installed and PowerShell 5 rejects
  `&&`. Ran the assertions as separate commands using the grep tool / `Select-String`
  equivalents; results identical to the plan's intent.

## Compatibility review of `onboarding.spec.ts` (could not be executed here)

Verified by inspection against the spec's own parser/assertions:
- `parseEnvExample()` collects commented `KEY=value` lines into `documented`. The only such line
  this task added is `OIDC_REDIRECT_URI=…`, already a declared `OIDC_CONFIG_KEYS` member — so the
  "enumerates schema keys and nothing invented" assertion stays green.
- All other added `.env.example` lines are prose (no `KEY=`), and none are *active* (all `#`) — so
  the "every active line is a shell assignment" assertion is unaffected.
- The boot harness (`containerEnv`) spreads `exampleActiveEnv()` (active lines only) and overrides
  `OIDC_ISSUER` only; the active `OIDC_REDIRECT_URI` from `.env.example` is **unchanged**, so boot
  behaviour is identical to before.

## Verification not run by this executor

- **End-to-end five-way CSRF probe** (`POST /apps` direct vs via the `/api` proxy, A–E table in the
  plan): owned by the orchestrator after this returns — deliberately not a dependency of any task
  `<verify>`.
- **`npx vitest run tooling/`** as a whole: the two pre-existing red suites and the
  infra-dependent `onboarding.spec.ts` prevent a clean whole-directory run offline (deviation 2).

## Scope boundaries honoured

- **STATE.md / ROADMAP.md untouched.** This is a quick task, separate from the ROADMAP phases; per the
  orchestrator's contract the docs commit (SUMMARY / STATE / PLAN) is handled there, so this executor
  staged and committed code changes only.
- No dependency was added, and no `npm install` was run — the guard uses `node:fs` and the
  already-installed `vitest`.
- Out of scope and left alone: the read-link `RENDERER_ORIGIN` / `JWT_AUDIENCE` values at
  `README.md:161-162`, and the untracked local files `start-api.bat`, `testenv.mjs`, `pnpm-lock.yaml`,
  `pnpm-workspace.yaml` (never staged).

## Self-Check: PASSED

- Created `tooling/dev-proxy-shape.spec.ts` — exists, committed in d57aeca.
- `apps/app-builder/vite.config.ts`, `.env.example`, `README.md` modified — committed in 8e771a6 / b9540a6.
- Commits present: `8e771a6`, `b9540a6`, `d57aeca` (all on `gsd/phase-06-self-service-app-builder`).
- `git diff --name-only e82a1cb..HEAD` = exactly the four plan-named files; none of
  `start-api.bat`, `testenv.mjs`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` was staged (still untracked).
- `apps/api/src/auth/session.middleware.ts` untouched; `npx vitest run apps/api/src/auth` green (22 passed).
- Guard observed failing on a reintroduced Host rewrite, then green once restored.
- Docs artifacts (this SUMMARY, STATE.md, PLAN.md) intentionally **not** committed — the orchestrator owns that commit.
