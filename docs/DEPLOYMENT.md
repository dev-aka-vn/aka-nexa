# Deployment — aka-nexa

## Deployment Model

**Single enterprise deployment in v1** — no cross-org isolation work (PRD NG8). One process type runs per Docker container, three process types run across the deployment (api, worker, scheduler). Horizontal scaling is achieved by running multiple replicas of each process, with all session state in Redis (no sticky sessions, PRD AD-9).

### Process types and their roles

| Process | Default Port | Role | Key Dependencies |
|---------|-------------|------|-----------------|
| `api` | 3000 | HTTP entrypoint, webhook receiver, health endpoints | MongoDB, two Redis deployments (cache + queue), OTel |
| `worker` | 3001 | BullMQ consumer, async connector execution | MongoDB, two Redis deployments, BullMQ queue |
| `scheduler` | 3002 | Job schedulers, platform heartbeat | Redis queue (for job scheduler registration), BullMQ |

### Docker compose (local development)

`compose.dev.yml` defines three services:

- **MongoDB 8.0.x** replica set `rs0` — primary + two secondaries
- **Redis Cache** on port `6379` — `maxmemory-policy: noeviction`
- **Redis Queue** on port `6380` — `maxmemory-policy: noeviction`

Start:

```bash
docker compose -f compose.dev.yml up -d
```

Stop:

```bash
docker compose -f compose.dev.yml down -v
```

### Production deployment

In production, the three process types are deployed as independent services (e.g., Kubernetes, ECS, or bare-metal). Each process reads its configuration from environment variables only — no mounted config files, no plaintext secrets.

#### Per-process environment

Each process must have these environment variables set:

- `NODE_ENV` — `development`, `test`, or `production`
- `MONGO_URL` — production MongoDB connection string
- `REDIS_CACHE_URL` — production Redis cache instance
- `REDIS_QUEUE_URL` — production Redis queue instance
- `CRYPTO_KEY_PROVIDER` — `local` (development/test) or `kms` (production, after D-27)
- `CRYPTO_LOCAL_KEY_FILE` — path to 32-byte key file (required when `local`)
- `OTEL_EXPORTER_OTLP_ENDPOINT` — production OTel collector endpoint
- `SERVICE_NAME` — `api`, `worker`, or `scheduler`
- `PORT` — optional, overrides default per process

#### Horizontal scaling

- **No sticky sessions**: all session state is in Redis; any replica can serve any request
- **Process autoscaling**: each process type can be autoscaled independently based on its own metrics (e.g., API request rate, BullMQ queue depth, scheduler job backlog)
- **Redis horizontal scaling**: Redis 8.2+ cluster mode is supported; `ioredis` Cluster is the mature path; OTel bundles `instrumentation-ioredis`

### Zero-downtime rolling deploys

NFR-O-3 requires zero-downtime rolling deploys. The Express adapter now drains in-flight requests on shutdown, which is what makes a rolling deploy actually work.

#### Rolling deploy strategy for api process

1. Start new api replicas with the new version
2. Wait for new replicas to pass `/health/ready` (all dependencies up)
3. Drain old replicas: stop receiving new requests, finish in-flight requests
4. Terminate old replicas

The key enabler: **Express adapter drains in-flight requests on shutdown**. Without this, a rolling deploy would cut off in-flight requests.

#### Rolling deploy strategy for worker process

1. Start new worker replicas
2. Wait for `getJobSchedulersCount() === 1` (idempotent `upsertJobScheduler` converges on a single registered scheduler)
3. Gradually terminate old replicas

#### Rolling deploy strategy for scheduler process

1. Start new scheduler replicas
2. Platform heartbeat (`registerPlatformHeartbeat`) is registered on every boot — converges on a single registered scheduler via live Redis proof
3. Gradually terminate old replicas

### Health checks

Each process exposes two health endpoints, used by orchestrators (K8s, ECS, etc.):

- `GET /health/live` — liveness: reads no dependency. A blip in a dependency must never restart an otherwise healthy process.
- `GET /health/ready` — readiness: names each dependency (MongoDB, cache Redis, queue Redis separately). A degraded dependency is identified rather than collapsed into one boolean.

Orchestrator behavior:

- `/health/live` → if not `200`, restart the container/instance immediately (liveness)
- `/health/ready` → if not `200`, stop routing new traffic to the instance (readiness), but do NOT restart immediately

### Resource limits

Typical production resource requirements (per replica):

| Process | CPU | Memory |
|---------|-----|--------|
| `api` | 0.5–1.0 vCPU | 256–512 MB |
| `worker` | 0.5–1.0 vCPU | 256–512 MB (plus connector latency overhead) |
| `scheduler` | 0.25–0.5 vCPU | 128–256 MB |

These are indicative; actual requirements depend on connector workloads and submission volume.

### Observability deployment

OTel export goes to a production collector (Tempo/Jaeger for traces, Prometheus for metrics, pino for logs). The OTel SDK node entry point is `@opentelemetry/sdk-node@0.222.0`, initialised via `--import` flag on process start.

#### Per-process OTel configuration

Each process initializes OTel independently via its `otel.mjs` entry point. The `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable determines the collector endpoint. If absent, telemetry failing to export must never be the reason a process refuses to start.

### Resource orchestration examples

#### Kubernetes deployment (example)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: aka-nexa
      service: api
  template:
    metadata:
      labels:
        app: aka-nexa
        service: api
    spec:
      containers:
        - name: api
          image: registry.example.com/aka-nexa/api:tag
          ports:
            - containerPort: 3000
          env:
            - name: SERVICE_NAME
              value: api
            - name: NODE_ENV
              value: production
            - name: MONGO_URL
              valueFrom:
                secretKeyRef:
                  name: mongo-url
                  key: url
            - name: REDIS_CACHE_URL
              valueFrom:
                secretKeyRef:
                  name: redis-cache-url
                  key: url
            - name: REDIS_QUEUE_URL
              valueFrom:
                secretKeyRef:
                  name: redis-queue-url
                  key: url
            - name: CRYPTO_KEY_PROVIDER
              value: kms
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: http://otel-collector.example:4318
          startupProbe:
            httpGet:
              path: /health/live
              port: 3000
            initialDelaySeconds: 5
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3000
            initialDelaySeconds: 5
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3000
            initialDelaySeconds: 5
          resources:
            limits:
              cpu: 1000m
              memory: 512Mi
            requests:
              cpu: 500m
              memory: 256Mi
```

### Deploy-time validation

Before a new deployment is released, validate:

1. `npm ci` succeeds (lockfile guaranteed reproducible)
2. `npm run build` succeeds (tsc -b + lint)
3. All three processes boot: `SERVICE_NAME=api npm run start:api` and health checks pass
4. Test suite passes: `npm test`
5. Boundary lint passes: `npm run lint`
6. OTel initialization succeeds (process starts without `CONFIG_INVALID: OTEL_EXPORTER_OTLP_ENDPOINT` if absent is legal)

### Feature flagging and feature switches

No feature flags in v1. Configuration is entirely env-driven. If a deployment needs to toggle a feature, it's done by setting/unseting the appropriate env var and re-deploying.

### Backup and recovery

- **MongoDB**: use MongoDB native backup (dump/restore or Ops Manager) — daily snapshots, point-in-time recovery
- **Redis**: two separate deployments; cache tier is evicting (short TTL keys), queue tier never evicts (BullMQ home). Queue data is the critical data — ensure Redis Redis snapshots or RDB/AOF persistence is enabled for the queue instance.
- **Secrets**: key files (`CRYPTO_LOCAL_KEY_FILE`) are provisioned per-checkout and gitignored; they are not backed up by the platform. KMS-backed keys are managed by the cloud provider.

### Post-deployment checks

After deploying a new version:

1. Verify all processes boot: `curl -s http://<host>/health/live` and `curl -s http://<host>/health/ready`
2. Check OTel is exporting: verify traces appear in the collector
3. Run smoke tests against the API
4. Monitor Redis connections and memory usage
5. Verify BullMQ job schedulers are registered (worker: `getJobSchedulersCount() === 1`)