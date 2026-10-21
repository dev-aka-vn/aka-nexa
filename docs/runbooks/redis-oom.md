# Redis OOM

## Symptom
`AkaneRedisMemoryHigh` fires; cache evictions or queue write failures.

## Alerts
- `AkaneRedisMemoryHigh`

## Triage
- Identify which instance: cache Redis (`maxmemory-policy` evictable) vs queue Redis (`noeviction`).
- Check `redis_memory_used_bytes` and `redis_memory_max_bytes`.
- Inspect `INFO memory` on the affected instance.

## Root cause
- Cache instance: normal eviction under load; policy working as designed.
- Queue instance: memory pressure threatens job durability; `noeviction` rejects writes.

## Mitigation
- Cache instance: scale memory or reduce TTLs; evictions are acceptable.
- Queue instance: scale memory immediately; do not enable eviction on queue instance.

## Escalation
- Queue instance OOM requires capacity decision.
- Changing `maxmemory-policy` requires engineering review.