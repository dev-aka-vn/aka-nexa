# Decision provider outage

## Symptom
Chat requests fall back to clarification or return no link; `AkaneDecisionConfidenceLow` or `AkaneDecisionProvidersAllDown` fires.

## Alerts
- `AkaneDecisionConfidenceLow`
- `AkaneDecisionProvidersAllDown`

## Triage
- Check `jev_decision_duration_ms` and provider health series.
- Inspect worker logs for provider errors and budget exhaustion.
- Verify `ProviderRegistry` admitted at least the rule-based terminal link.

## Root cause
- Hosted provider unreachable, timed out, or dropped for missing attestation.
- All providers unhealthy; local rule-based provider failed its health check.

## Mitigation
- Confirm rule-based provider is healthy; restart worker if needed.
- Remove or fix hosted provider attestation in config.
- Increase per-provider attempt caps only if provider is merely slow.

## Escalation
- Operator may toggle hosted providers off.
- Changing provider chain or attestation policy requires engineering decision.