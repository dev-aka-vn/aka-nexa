# Deferred items — 06-02

Out-of-scope discoveries from executing 06-02. Logged, not fixed
(the deviation rules scope auto-fixes to issues the current task's
changes caused).

## Pre-existing entrypoint-drift orphans (out of scope)

`tooling/entrypoint-drift.spec.ts` fails on the committed tree **before**
06-02's first commit (verified by stashing the working tree and re-running):

- `apps/api/src/adapters/slack/slack-commands.controller.ts`
- `apps/api/src/adapters/slack/slack-webhook.controller.ts`
- `apps/api/src/adapters/slack/slack.module.ts`
- `apps/api/src/common/filters/link-error.filter.ts`
- `apps/api/src/common/guards/permission.guard.ts`
- `apps/api/src/submissions/submissions.controller.ts`

All six are future-phase work (the Slack adapter is Phase 5; the
submissions controller and the error filter / permission guard land with
later surfaces). They are not reachable from any `main.ts`, so the drift
guard flags them. Fix belongs to the phase that wires each surface into
`AppModule`.

06-02's own contribution to this list (`apps/api/src/auth/oidc-issuer.stub.ts`,
a test-only fixture) was resolved by teaching the walk that `*.stub.ts`
files are test artifacts, not process code — see the 06-02 SUMMARY
deviations. The production-code orphan guard is unchanged.
