# k6 load suite (OBS-08)

## Prerequisites
- Docker (for the k6 binary; k6 is not installed on the host).
- A running stack: API on `BASE_URL`, Redis on `REDIS_URL`.

## Environment variables
- `BASE_URL` — target API base URL (default `http://localhost:3000`).
- `REDIS_URL` — Redis endpoint used for `INFO commandstats` sampling.

## Run
```bash
docker run --rm -v "$PWD":/w -w /w -e BASE_URL -e REDIS_URL grafana/k6:0.53.0 \
  run load/k6/scenarios.js
```

## Measurement procedure (Redis cost of the throttler)
1. Baseline commandstats before the run: `redis-cli INFO commandstats` (or `CONFIG RESETSTAT` to zero counters).
2. Run the suite at target load.
3. Sample commandstats again.
4. Parse both snapshots with `load/k6/lib/redis-commandstats.js` (`parseCommandStats`, `deltaCommandStats`, `reportCommandStats`), dividing deltas by the throttled request count in the window.

Only deltas are meaningful — absolute `calls` include every command since server start.

## CI
The `k6-smoke` job runs a smoke-level single-VU, 5-second run using the pinned `grafana/k6:0.53.0` image. The full target-load run (1,000 VUs, 50 events/s) is on-demand because it needs resources a CI runner does not have.