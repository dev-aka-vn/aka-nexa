# Double submission reports

## Symptom
Users report duplicate submissions; `read_link_token_consume_total{result="replayed"}` rises.

## Alerts
- `AkaneTokenConsumeFailure`

## Triage
- Check `read_link_token_consume_total` by `result`.
- Inspect edit POST path and `tokenStore.readOutcome`.
- Verify `GETDEL` consume atomicity.

## Root cause
- Replay handling returns prior outcome; expected for retries.
- Missing idempotency or race in consume path.
- Token reused across concurrent submits.

## Mitigation
- Ensure `replayed` results are idempotent responses.
- Fix consume atomicity; use `GETDEL`.
- Add request deduplication where needed.

## Escalation
- Changing token lifecycle requires engineering decision.