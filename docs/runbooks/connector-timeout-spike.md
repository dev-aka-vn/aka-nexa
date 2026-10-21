# Connector timeout spike

## Symptom
Submissions stall in `partial`; `AkaneConnectorFailureRate` or `AkaneDlqDepthHigh` fires.

## Alerts
- `AkaneConnectorFailureRate`
- `AkaneDlqDepthHigh`

## Triage
- Check `connector.outcome` series by `taxonomy_code`.
- Inspect DLQ depth and retry counts in worker.
- Review connector endpoint latency and credentials.

## Root cause
- Downstream endpoint unreachable or slow.
- Credential rejection or mapping error.
- Retry exhaustion pushing jobs to DLQ.

## Mitigation
- Pause affected connector traffic if credentials are invalid.
- Increase retry/backoff within configured limits.
- Drain or replay DLQ after root cause fixed.

## Escalation
- Operator may pause a connector.
- Schema or connector contract changes require engineering decision.