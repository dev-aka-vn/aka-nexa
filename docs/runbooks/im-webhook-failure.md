# IM webhook failure

## Symptom
No inbound events processed; `im_active_connections` drops; webhook retries from platform.

## Alerts
- `AkaneTokenConsumeFailure` (if link-related)
- Platform webhook 4xx/5xx (infra)

## Triage
- Verify receiver acks in <200 ms and only enqueues.
- Check adapter signature verification and queue enqueue path.
- Inspect `im_active_connections{provider}`.

## Root cause
- Receiver doing work instead of ack-and-enqueue.
- Invalid webhook signature or secret token.
- Queue Redis unavailable, enqueue fails.

## Mitigation
- Restore ack-and-enqueue contract in receiver.
- Rotate webhook secret if compromised.
- Fail fast on queue outage; do not hold connections.

## Escalation
- Changing webhook contract or provider credentials requires engineering decision.