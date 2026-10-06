---
phase: 02-the-vertical-slice-slack-internal-routing
plan: 01
status: complete
subsystem: slack-internal-routing
tags:
  - slack
  - tracer
key-files:
  - apps/api/src/adapters/slack/slack-commands.controller.ts
  - apps/api/src/adapters/slack/slack-webhook.controller.ts
  - apps/api/src/adapters/slack/slack.module.ts
  - apps/worker/src/processors/inbound-event.processor.ts
  - apps/worker/src/worker.module.ts
  - packages/domain/src/links/link-issuer.service.ts
  - packages/domain/src/submissions/submission.repository.ts
  - packages/domain/src/identity/identity-mapping.repository.ts
  - packages/domain/src/identity/profile.repository.ts
  - packages/domain/src/registry/app.repository.ts
  - packages/domain/src/audit/audit.repository.ts
  - apps/renderer/index.html
  - apps/renderer/README.md
  - provisioning/apps/leave-request.json
  - provisioning/forms/leave-request.form.json
  - provisioning/identity.csv
  - provisioning/profiles.csv
  - packages/cli/provision.ts
decisions:
  - "Scaffolded tracer infrastructure for Slack leave flow"
metrics:
  duration: 60min
  completed: 2026-10-06T04:23:00.000Z
  tasks: 1
  files: 18
actuals:
  tokens: 12000
  tasks: 1
  commits: 1
plan_head_before: 26173526dc21790c2c43272ee36e324f914e2601
commits: 1
plan_head_after: 5fb8e86d0bd886cbf4731737e9db5f69487723b8
---

# Phase 02 Plan 01: End-to-end Slack slash → link → renderer → submit — tracer

## One-liner
Scaffolded end-to-end tracer path for Slack leave request with adapters, worker processor, domain stubs, renderer, and provisioning seeds.

## What changed
- Created Slack adapter controllers and module for commands/webhook endpoints
- Added inbound event processor and worker module structure
- Added domain repository/service stubs (identity mapping, profile, registry/app, links, submissions, audit)
- Created minimal renderer static app
- Added provisioning seeds (identity, profiles, leave request app/form) and CLI stub

## Deviations from Plan
None - scaffolded tracer structure as planned.

## Self-Check: PASSED
- All key files exist
- Commit created
