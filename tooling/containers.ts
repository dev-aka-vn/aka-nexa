/**
 * The three-container integration harness (D-07).
 *
 * ## Why three containers and not one
 *
 * `maxmemory-policy` is **instance-wide**. A single Redis deployment cannot be
 * both evicting (the cache side, D-13) and `noeviction` (the queue side, where
 * BullMQ requires that a full memory limit surfaces as a write error rather than
 * a silent eviction of a queued job). A logical-database suffix does not help:
 * `/0` and `/1` on one instance share one policy. The split is therefore only
 * expressible as two deployments, which is exactly what the boot schema in
 * `packages/platform/src/config/redis.schema.ts` refuses to let us collapse.
 *
 * That makes this harness a **correctness** fixture rather than a convenience:
 * a suite that could run against one Redis could not tell the difference
 * between the two-deployment split working and the split silently regressing.
 *
 * ## Why real containers and not mocks
 *
 * The two highest-risk behaviours in the system are `GETDEL` atomicity
 * (NFR-SEC-1) and BullMQ retry/DLQ semantics. Both are Redis- *semantics*
 * dependent, and a mock asserts the shape of the call rather than the outcome.
 * The same argument applies to the replica-set handshake `MongoDBContainer`
 * performs: a fake Mongo driver would prove nothing about whether `ping()`
 * works against a real server.
 *
 * Images are pinned to the STACK.md §14 ledger: MongoDB 8.0.x (never 8.2 —
 * EOL 2026-07-31) and Redis 8.10.x, the train STACK.md §4.4 names as the
 * develop-against line.
 */
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';

/** MongoDB 8.0.x — 8.2 is EOL 2026-07-31 and must never be pinned. */
export const MONGO_IMAGE = 'mongo:8.0';

/** Redis 8.10.x — STACK.md §4.4's develop-against train (floor is 8.2). */
export const REDIS_IMAGE = 'redis:8.10-alpine';

/** Cache deployment: evicting, because a lost cache entry is re-derivable. */
export const CACHE_MAXMEMORY_POLICY = 'allkeys-lru';

/** Queue deployment: never evict, because a lost job is lost work. */
export const QUEUE_MAXMEMORY_POLICY = 'noeviction';

export interface ThreeContainerUrls {
  readonly mongo: string;
  readonly cache: string;
  readonly queue: string;
}

/**
 * Build a client-usable MongoDB URL from the container's connection string.
 *
 * ## Why `directConnection=true` is not optional here
 *
 * `MongoDBContainer` starts MongoDB with `--replSet rs0`, so the server
 * advertises itself as a replica-set member using its **container hostname**
 * (`911148e5986d:27017`, for example). The driver performs topology discovery,
 * believes that advertisement, and then tries to reach that address from the
 * host — where it is an unresolvable name, and every `ping()` fails with
 * `getaddrinfo EAI_AGAIN` while the server is perfectly healthy.
 *
 * `directConnection=true` tells the driver to talk to the seed address and
 * ignore the advertised member list. That is the correct mode for a single
 * node reached through a published port, and it is what `getConnectionString()`
 * omits.
 */
export function mongoUrl(container: StartedMongoDBContainer): string {
  const url = new URL(container.getConnectionString());
  url.searchParams.set('directConnection', 'true');
  return url.toString();
}

export interface ThreeContainers {
  readonly mongo: StartedMongoDBContainer;
  readonly cache: StartedRedisContainer;
  readonly queue: StartedRedisContainer;
  readonly urls: ThreeContainerUrls;
  /** Idempotent: calling it twice is a no-op, so a failed spec can still clean up. */
  stop(): Promise<void>;
}

function redisContainer(policy: string): RedisContainer {
  return new RedisContainer(REDIS_IMAGE).withCommand([
    'redis-server',
    '--maxmemory-policy',
    policy,
  ]);
}

/**
 * Start MongoDB + the two Redis deployments, concurrently.
 *
 * The three are independent, so `Promise.all` roughly triples nothing and cuts
 * the suite's wall clock by the cost of a replica-set initialisation.
 *
 * Partial-failure cleanup is not optional here: `Promise.all` rejects on the
 * first failure and the containers that *did* start would otherwise keep running
 * until the reaper noticed, turning one flaky pull into a pile of orphaned
 * containers across repeated local runs.
 */
export async function startThreeContainers(): Promise<ThreeContainers> {
  // Started containers are recorded as each start resolves, so a failure part
  // way through stops what *did* come up instead of leaking it. Ryuk eventually
  // reaps them, but "eventually" is after the next test run has already queued
  // three more, which is how one flaky image pull becomes a machine full of
  // orphaned Redis containers.
  const started: Array<{ stop(): Promise<unknown> }> = [];

  const record = async <T extends { stop(): Promise<unknown> }>(promise: Promise<T>): Promise<T> => {
    const container = await promise;
    started.push(container);
    return container;
  };

  let mongo: StartedMongoDBContainer;
  let cache: StartedRedisContainer;
  let queue: StartedRedisContainer;

  try {
    [mongo, cache, queue] = await Promise.all([
      record(new MongoDBContainer(MONGO_IMAGE).start()),
      record(redisContainer(CACHE_MAXMEMORY_POLICY).start()),
      record(redisContainer(QUEUE_MAXMEMORY_POLICY).start()),
    ]);
  } catch (error) {
    await Promise.allSettled(started.map((container) => container.stop()));
    throw error;
  }

  let stopped = false;

  return {
    mongo,
    cache,
    queue,
    urls: {
      mongo: mongoUrl(mongo),
      cache: cache.getConnectionUrl(),
      queue: queue.getConnectionUrl(),
    },
    async stop(): Promise<void> {
      if (stopped) {
        return;
      }
      stopped = true;
      await Promise.allSettled([mongo.stop(), cache.stop(), queue.stop()]);
    },
  };
}

/**
 * Read one instance's `maxmemory-policy` back through `redis-cli`.
 *
 * The command and its arguments go in as separate argv entries.
 * `executeCliCmd('CONFIG GET maxmemory-policy')` builds one argument —
 * `redis-cli "CONFIG GET maxmemory-policy"` — which the server reads as a
 * single command name and answers with `ERR unknown command`, while redis-cli
 * still exits 0. Without checking the output, that is an integration test that
 * reports a healthy instance as unreadable.
 *
 * `CONFIG GET` prints the key and the value on separate lines, so the value is
 * extracted by matching the known policy vocabulary rather than by positional
 * indexing. A positional parse silently reads the *key* as the value if Redis
 * ever changes its output shape, and a test that asserts "the value is
 * `noeviction`" would then pass for the wrong reason.
 */
export const EVICTING_POLICIES: readonly string[] = Object.freeze([
  'allkeys-lru',
  'allkeys-lfu',
  'allkeys-random',
  'volatile-lru',
  'volatile-lfu',
  'volatile-random',
]);

export async function readMaxMemoryPolicy(
  container: StartedRedisContainer,
): Promise<string> {
  const output = await container.executeCliCmd('CONFIG', ['GET', 'maxmemory-policy']);
  const found = output
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^"|"$/g, ''))
    .find((line) => line === 'noeviction' || EVICTING_POLICIES.includes(line));

  if (found === undefined) {
    throw new Error(
      `CONFIG GET maxmemory-policy returned no known policy: ${JSON.stringify(output)}`,
    );
  }
  return found;
}
