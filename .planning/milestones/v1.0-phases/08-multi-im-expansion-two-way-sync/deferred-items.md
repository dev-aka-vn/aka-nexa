# Deferred Items — Phase 08 (multi-im-expansion-two-way-sync)

Out-of-scope discoveries logged during execution. Per executor scope-boundary rules
these are **pre-existing** defects in files this phase's plans do not own; they are
recorded here, not fixed.

## Discoved during 08-05 (build-gate fix)

### D-08-05-1 — `tooling/entrypoint-drift.spec.ts` orphan test fails on pre-existing unimported files

- **Test:** `every app source file is reachable from its own main.ts — no orphan escapes the walk`
  (`tooling/entrypoint-drift.spec.ts:464`), run as `npx vitest run tooling/entrypoint-drift.spec.ts --maxWorkers=1`.
- **Failing assertion (api app):** source files its `main.ts` never loads:
  - `apps/api/src/adapters/slack/slack-commands.controller.ts`
  - `apps/api/src/adapters/slack/slack-webhook.controller.ts`
  - `apps/api/src/adapters/slack/slack.module.ts`
  - `apps/api/src/common/filters/link-error.filter.ts`
  - `apps/api/src/common/guards/permission.guard.ts`
- **Root cause:** `apps/api/src/app.module.ts` imports `TeamsModule` and `ExternalWebhookModule`
  but never `SlackModule`; nothing in the api closure imports the two `common/` files either
  (only `link-error.filter.spec.ts` does). `SlackModule` was introduced in phase 2 (`4dc31ae1`) /
  phase 4 (`b8476c45`) / `78debe6c` and never wired into the composition root.
- **Proven pre-existing:** at `HEAD` (`467344c2`) this spec reports **2 failed | 16 passed**
  (the orphan test plus a `Cannot find package '@akane/contract/events/inbound-event.js'`
  resolution error introduced by the phase-8 bad-subpath imports). With the 08-05 fixes applied
  it reports **1 failed | 17 passed** — i.e. 08-05 removed one failure and did not create this one.
- **Why not fixed here:** 08-05's `files_modified` is exactly 6 files under
  `apps/api/src/adapters/teams/` and `apps/api/src/webhooks/external/`. The orphaned files are
  outside that set, and wiring `SlackModule` into `app.module.ts` is a composition-root change
  (Rule 4 — architectural), not a build-gate type fix.
- **Suggested owner:** the plan that owns Slack adapter wiring / `app.module.ts` composition
  (not 08-06/07/08/09 — each of those also scopes away from `app.module.ts`).
- **Impact:** `npm run build` is unaffected (eslint + tsc are green). The drift gate test remains
  red until the orphans are wired or deleted.
