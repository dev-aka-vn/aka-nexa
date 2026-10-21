---
phase: 09
plan: 04
status: complete
subsystem: observability
tags: [prometheus, grafana, alerting, log-retention]
requires:
  - phase: 09-03
    provides: metric registry and runbooks
provides:
  - eight alert rules
  - two dashboards
  - log retention deploy value
affects: []
tech-stack:
  added: []
  patterns: [promtool test rules, dashboard-as-code]
key-files:
  created:
    - observability/prometheus/rules/connector.rules.yml
    - observability/prometheus/rules/tokens.rules.yml
    - observability/prometheus/rules/decision.rules.yml
    - observability/prometheus/rules/queue.rules.yml
    - observability/prometheus/rules/infrastructure.rules.yml
    - observability/prometheus/rules/submissions.rules.yml
    - observability/prometheus/tests/rules.test.yml
    - observability/prometheus/tests/rule-names.spec.ts
    - observability/grafana/dashboards/platform-health.json
    - observability/grafana/dashboards/decision-and-connectors.json
    - observability/grafana/dashboards/dashboard-queries.spec.ts
    - observability/deploy/log-retention.yml
    - observability/deploy/log-retention.spec.ts
  modified:
    - .github/workflows/ci.yml
    - vitest.config.mts
decisions:
  - "Pinned prom/prometheus:v3.7.0 for the promtool CI gate."
  - "WINDOW 5 left open; msg removal not attempted."
  - "Confidence distribution stands in for decision accuracy (Q3)."
metrics:
  duration: 45
  completed: 2026-10-20
actuals:
  tokens: 98000
  tasks: 3
  commits: 4
---

# Phase 09 Plan 04: Production Readiness — Alerts, Dashboards, Log Retention Summary

**Eight alert rules proven by promtool, two dashboards validated against the metric registry, and a guarded log-retention deploy value.**

## Performance

- **Tasks:** 3
- **Files created:** 13

## Accomplishments

- Six rule files declaring the eight OBS-06 alert names (D-15 union of seven plus `partial`).
- `rules.test.yml` with a firing and `exp_alerts: []` case per rule, plus an overlapping-rules case.
- `promtool check rules` and `promtool test rules` both pass in the pinned image.
- `rule-names.spec.ts` validates every expr identifier against `SCRAPED_NAMES ∪ EXTERNAL_SCRAPED` with a non-vacuity prefix, and resolves all eight `runbook_url` annotations.
- Two committed Grafana dashboards (`platform-health.json`, `decision-and-connectors.json`) validated by `dashboard-queries.spec.ts`.
- `log-retention.yml` (hot 30 / cold 365) with a guard test reading the same file.
- `.github/workflows/ci.yml` gains a `promtool` job.
- `vitest.config.mts` extended to discover `observability/**/*.spec.ts`.

## Pinned Prometheus image tag

`prom/prometheus:v3.7.0` (promtool 3.7.0). Pinned to an exact tag so the alert
suite's pass/fail cannot depend on a moving `latest` base — required for a
compliance gate.

## Q6 WINDOW 5 probe outcome

Removal of `msg` from `LOG_FIELD_ALLOWLIST` was **not attempted**. The drift test
(`log-allowlist.formatter.spec.ts`) asserts the allowlist is exactly the 24 named
fields including `msg`, and `pino.config.spec.ts` builds records carrying `msg`,
so dropping it would break the gate. WINDOW 5 remains open: `msg` is emitted
verbatim by pino after `formatters.log` runs and no automated test can catch an
interpolation into a log message.

## Q3 disposition (decision accuracy on dashboards)

There is no accuracy instrument. The dashboards use the emitted confidence
distribution (`jev_decision_confidence`) in place of a true accuracy measure, and
the `Decision and Connectors` dashboard panel description names the limitation:
true accuracy requires a labeled outcome join that does not exist in v1.

## Eight alert names and runbook paths

| Alert | Runbook |
|-------|---------|
| AkaneConnectorFailureRate | docs/runbooks/connector-timeout-spike.md |
| AkaneTokenConsumeFailure | docs/runbooks/double-submission-reports.md |
| AkaneDecisionConfidenceLow | docs/runbooks/decision-provider-outage.md |
| AkaneDecisionProvidersAllDown | docs/runbooks/decision-provider-outage.md |
| AkaneDlqDepthHigh | docs/runbooks/connector-timeout-spike.md |
| AkaneRedisMemoryHigh | docs/runbooks/redis-oom.md |
| AkaneMongoReplicationLag | docs/runbooks/README.md |
| AkanePartialSubmissions | docs/runbooks/double-submission-reports.md |

## Deviations from Plan

None - plan executed as written, aside from using `--entrypoint promtool` in CI
because the image's default entrypoint is `/bin/prometheus`.

## Self-Check: PASSED

- All observability vitest specs pass (10 tests).
- `npm run build` passes.
- `promtool check rules` and `promtool test rules` pass.
