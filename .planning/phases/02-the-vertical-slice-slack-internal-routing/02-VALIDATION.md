---
phase: "02"
slug: "02-the-vertical-slice-slack-internal-routing"
status: validated
nyquist_compliant: true
wave_0_complete: false
created: "2026-10-06"
---
# Phase 02 — Validation Strategy
> Per-phase validation contract for feedback sampling during execution.
---
## Test Infrastructure
| Property | Value |
|---|---|
| Framework | vitest 5.0.x |
| Config file | vitest.config.mts |
| Quick run command | npm test -- --run |
| Full suite command | npm test -- --run |
| Estimated runtime | ~10 seconds |
---
## Sampling Rate
- After every task commit: Run npm test -- --run
- After every plan wave: Run npm test -- --run
- Before /gsd-verify-work: Full suite must be green
- Max feedback latency: 5 seconds
---
## Per-Task Verification Map
| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---|---|---|---|---|---|---|---|---|---|
| 02-01 | 01 | 1 | E2E | T-02-01..T-02-06 | End-to-end flow | e2e | npm test -- --run tests/e2e/slack-leave.e2e.spec.ts | ❌ | red |
| 02-01b | 01 | 1 | PROV | — | Provisioning loader | unit | npm test -- --run tests/unit/provisioning.loader.spec.ts | ❌ | red |
| 02-01c | 01 | 1 | THR/AUD | T-02-05, T-02-03 | Throttling & audit | unit | npm test -- --run tests/unit/throttler.spec.ts | ❌ | red |
| 02-01d | 01 | 1 | AUD | T-02-03 | Audit base | unit | npm test -- --run tests/unit/audit.spec.ts | ❌ | red |
| 02-02a | 02 | 2 | IDN-06,07 | T-02-07 | Identity resolution | unit | npm test -- --run tests/unit/identity.resolution.spec.ts | ❌ | red |
| 02-02b | 02 | 2 | ACL-01..09,11 | T-02-08 | RBAC | unit | npm test -- --run tests/unit/rbac.spec.ts | ❌ | red |
| 02-02c | 02 | 2 | ACL-06,09 | T-02-08 | Permission guard | unit | npm test -- --run tests/unit/permission.guard.spec.ts | ❌ | red |
| 02-03a | 03 | 3 | AUD-01,02 | T-02-10 | Audit append-only | unit | npm test -- --run tests/unit/audit.appendonly.spec.ts | ❌ | red |
| 02-03b | 03 | 3 | IM-06 | T-02-11 | Throttling storage | unit | npm test -- --run tests/unit/throttler.spec.ts | ❌ | red |
| 02-03c | 03 | 3 | LNK-11, IM-08 | T-02-10 | Link errors | unit | npm test -- --run tests/unit/link-error.filter.spec.ts | ❌ | red |
| 02-03d | 03 | 3 | FRM-04,07,08 | T-02-12 | Prefill | unit | npm test -- --run tests/unit/prefill.spec.ts | ❌ | red |
*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
---
## Wave 0 Requirements
- [ ] tests/e2e/slack-leave.e2e.spec.ts — stubs for E2E tracer
- [ ] tests/unit/provisioning.loader.spec.ts
- [ ] tests/unit/throttler.spec.ts
- [ ] tests/unit/audit.spec.ts
- [ ] tests/unit/identity.resolution.spec.ts
- [ ] tests/unit/rbac.spec.ts
- [ ] tests/unit/permission.guard.spec.ts
- [ ] tests/unit/audit.appendonly.spec.ts
- [ ] tests/unit/link-error.filter.spec.ts
- [ ] tests/unit/prefill.spec.ts
---
## Manual-Only Verifications
| Behavior | Requirement | Why Manual | Test Instructions |
|---|---|---|---|
| Slack signature validation (exact raw body) | IM-02 | Requires live Slack signing secret context | Verify signature on raw body against test fixtures in integration context |
| Threaded Slack response posting | IM-11 | Requires mocked Slack API | Post response_url with tokenized link; verify thread_id handling |
| GETDEL token consumption atomicity | LNK-03 | Needs concurrency test | Run parallel submits against same token; expect exactly one success |
| IP truncation (/24 IPv4 /48 IPv6) | AUD-02 | Log formatting detail | Verify truncation logic in audit formatting |
*If none: "All phase behaviors have automated verification." — see manual items above
---
## Validation Sign-Off
- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] nyquist_compliant: true set in frontmatter (pending test creation)
**Approval:** pending
---
## Validation Audit 2026-10-06
| Metric | Count |
|---|---|
| Gaps found | 10 |
| Resolved | 0 |
| Escalated | 0 |
