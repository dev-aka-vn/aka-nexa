# Runbooks

| Alert | Runbook |
|-------|---------|
| AkaneConnectorFailureRate | connector-timeout-spike.md |
| AkaneTokenConsumeFailure | double-submission-reports.md / im-webhook-failure.md |
| AkaneDecisionConfidenceLow | decision-provider-outage.md |
| AkaneDlqDepthHigh | connector-timeout-spike.md |
| AkaneRedisMemoryHigh | redis-oom.md |
| AkaneMongoReplicationLag | (external exporter; no app runbook) |
| AkaneDecisionProvidersAllDown | decision-provider-outage.md |
| AkanePartialSubmissions | double-submission-reports.md |

## Operator procedures (not alert-triggered)

| Procedure | Runbook | Why not alert-triggered |
|-----------|---------|------------------------|
| Key rotation | key-rotation.md | Triggered by policy, not by an alert. Rotation is a planned operator action. |

External exporter limitation: `AkaneRedisMemoryHigh` and `AkaneMongoReplicationLag` depend on
Redis/MongoDB exporters not emitted by this app. Ensure exporters are deployed and scraped.