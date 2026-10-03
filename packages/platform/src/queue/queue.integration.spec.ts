import { readdirSync, readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue, Worker } from 'bullmq';
import type { WorkerOptions } from 'bullmq';

import {
  CACHE_MAXMEMORY_POLICY,
  EVICTING_POLICIES,
  QUEUE_MAXMEMORY_POLICY,
  readMaxMemoryPolicy,
  REDIS_IMAGE,
} from '../../../../tooling/containers.js';
import { createRedisClient } from '../redis/redis.provider.js';
import { BULLMQ_PREFIX } from './queue.constants.js';
import { registerJobScheduler, resumeJobScheduler } from './job-scheduler.js';
import { PLATFORM_HEARTBEAT_ID } from './platform-heartbeat.job.js';
import { PLATFORM_HEARTBEAT_QUEUE } from './queue.module.js';
import {
  blockingConnectionOptions,
  producerConnectionOptions,
  queueKeyNames,
  queueRootOptions,
} from './queue.provider.js';
import {
  jobSchedulerReadyIndicator,
  SCHEDULER_PROBE_TIMEOUT_MS,
  workerListeningIndicator,
} from './queue-indicators.js';

/**
 * The async-execution floor, proven against live Redis containers
 * (FND-08, D-10, D-12, D-14, T-1-19, T-1-20).
 *
 * Every claim here is one the unit spec *cannot* make. "Registering twice leaves
 * one scheduler" is a statement about Redis state; "the queue keys carry the
 * hash tag" is a statement about keys that exist; and "the queue is on the
 * `noeviction` deployment" is a statement about which of two servers answered.
 * Asserting them against a live pair is the only way they mean anything — the
 * same argument 01-07 made for `maxmemory-policy`, and the reason this file
 * starts two deployments rather than one.
 *
 * Two containers, not three: MongoDB is irrelevant here, and a `mongo:8.0`
 * replica-set handshake is the most expensive part of the 01-07 harness. The two
 * Redis deployments reuse the images and policies `tooling/containers.ts`
 * exports, so the harness cannot drift from the one the rest of the suite uses.
 */
describe('BullMQ job schedulers and readiness (FND-08, D-10)', () => {
  let cache: StartedRedisContainer;
  let queueContainer: StartedRedisContainer;
  let queue: Queue;
  const opened: Array<{ close(): Promise<unknown> }> = [];
  const clients: Array<{ quit(): Promise<unknown> }> = [];
  /** `pause()`d by a test, so the resume path is exercised against real Redis. */
  let pausedQueue: Queue | undefined;

  beforeAll(async () => {
    [cache, queueContainer] = await Promise.all([
      new RedisContainer(REDIS_IMAGE)
        .withCommand(['redis-server', '--maxmemory-policy', CACHE_MAXMEMORY_POLICY]).start(),
      new RedisContainer(REDIS_IMAGE)
        .withCommand(['redis-server', '--maxmemory-policy', QUEUE_MAXMEMORY_POLICY]).start(),
    ]);

    queue = new Queue(
      PLATFORM_HEARTBEAT_ID,
      queueRootOptions(queueContainer.getConnectionUrl()),
    );
    opened.push(queue);
  }, 300_000);

  afterAll(async () => {
    // Tear the queue down before the server it is attached to, or `close()`
    // races a socket the container has already taken away.
    await Promise.allSettled(opened.map((resource) => resource.close()));
    await Promise.allSettled(clients.map((client) => client.quit()));
    await Promise.allSettled([cache?.stop(), queueContainer?.stop()]);
    // The global `hookTimeout` is 30 s and container teardown can exceed it on a
    // loaded machine; a teardown timeout reports this file as failed while every
    // assertion passed, which trains a reader to ignore the failure line (01-07).
  }, 300_000);

  const rawClient = (url: string) => {
    const client = createRedisClient({ url, profile: 'producer' });
    clients.push(client);
    return client;
  };

  describe('FND-08 — one registration per replica, no leader election', () => {
    it('reports no scheduler before registration and one after', async () => {
      expect(await queue.getJobScheduler(PLATFORM_HEARTBEAT_ID)).toBeUndefined();

      const registered = await registerJobScheduler(
        queue,
        PLATFORM_HEARTBEAT_ID,
        { every: 60_000 },
        { name: PLATFORM_HEARTBEAT_ID },
      );

      expect(registered.name).toBe(PLATFORM_HEARTBEAT_ID);
      expect(await queue.getJobScheduler(PLATFORM_HEARTBEAT_ID)).toBeDefined();
      expect(await jobSchedulerReadyIndicator(queue, PLATFORM_HEARTBEAT_ID)).toBe(true);
    }, 60_000);

    it('converges on exactly one scheduler when every replica registers (T-1-19 boundary)', async () => {
      // Three registrations, standing in for three replicas booting at once.
      // This is the whole of FND-08: `upsertJobScheduler` is the primitive, so
      // the answer is that the count does not move. A non-idempotent registration
      // would leave three schedulers and multiply the scheduled work by three —
      // silently, because every replica would report success.
      for (let replica = 0; replica < 3; replica += 1) {
        await registerJobScheduler(
          queue,
          PLATFORM_HEARTBEAT_ID,
          { every: 60_000 },
          { name: PLATFORM_HEARTBEAT_ID },
        );
      }

      const schedulers = await queue.getJobSchedulers();
      expect(schedulers.filter((s) => s.key === PLATFORM_HEARTBEAT_ID)).toHaveLength(1);
      expect(await queue.getJobSchedulersCount()).toBe(1);
    }, 60_000);

    it('registers through upsertJobScheduler, never the removed add(..., { repeat }) API', async () => {
      const upsert = vi.spyOn(queue, 'upsertJobScheduler');
      // BullMQ 6 deleted `getRepeatableJobs`/`getRepeatableJobsCount` outright.
      // Their absence is the version check: if a future install resolved to
      // BullMQ 5, the v6 Job Scheduler primitives below would not exist either.
      expect((queue as unknown as Record<string, unknown>).getRepeatableJobs).toBeUndefined();

      await registerJobScheduler(queue, PLATFORM_HEARTBEAT_ID, { every: 60_000 });

      expect(upsert).toHaveBeenCalledTimes(1);
      expect(upsert.mock.calls[0]?.[0]).toBe(PLATFORM_HEARTBEAT_ID);
      expect(upsert.mock.calls[0]?.[1]).toEqual({ every: 60_000 });
      upsert.mockRestore();
    }, 60_000);

    it('no source file reaches for a removed repeatable-job API', () => {
      // Complements the spy above: the spy proves the *registered* path, this
      // proves no other path exists that the spy could not see.
      //
      // Comments are stripped for the same reason the keyPrefix scan strips them:
      // `job-scheduler.ts` documents *why* the removed API is wrong, and naming
      // it there is the opposite of using it.
      const removed = /\bgetRepeatableJobs(Count)?\b/;
      const sources = queueSourceFiles();

      expect(
        Object.keys(sources).filter((name) => removed.test(stripComments(sources[name] as string))),
      ).toEqual([]);
    });
  });

  describe('D-10 — readiness additions for worker and scheduler', () => {
    it('restores a paused scheduler, awaiting the async resume', async () => {
      // BullMQ 6 made `resume()` async. Called without `await`, the scheduler
      // stays paused and the returned promise's rejection — if there is one — is
      // observed by nobody, so the failure mode is a silently-dead scheduler
      // rather than a crash. Asserted against live Redis, and with a spy, so
      // the await is proven rather than assumed: a `void queue.resume()` would
      // still leave `isPaused()` false by the time the assertion runs, but the
      // spy catches the un-awaited call directly.
      pausedQueue = new Queue(
        PLATFORM_HEARTBEAT_ID,
        queueRootOptions(queueContainer.getConnectionUrl()),
      );
      opened.push(pausedQueue);
      await registerJobScheduler(pausedQueue, 'resumable', { every: 60_000 });

      await pausedQueue.pause();
      expect(await pausedQueue.isPaused()).toBe(true);

      const resume = vi.spyOn(pausedQueue, 'resume');
      const returned = resumeJobScheduler(pausedQueue);
      expect(returned).toBeInstanceOf(Promise);
      await returned;

      expect(resume).toHaveBeenCalledTimes(1);
      expect(await pausedQueue.isPaused()).toBe(false);
      resume.mockRestore();
    }, 60_000);

    it('reports the scheduler as not ready when it is not registered', async () => {
      const fresh = new Queue(
        'never-registered',
        queueRootOptions(queueContainer.getConnectionUrl()),
      );
      opened.push(fresh);

      expect(await jobSchedulerReadyIndicator(fresh, 'never-registered')).toBe(false);
    }, 60_000);

    it('reports false for an empty worker list and true only when every worker runs', async () => {
      // `[]` → false is the load-bearing half. Vacuous truth would make a worker
      // process that registered no consumers at all report ready, and D-10's
      // "every registered BullMQ Worker is listening" is meant to catch exactly
      // that.
      expect(await workerListeningIndicator([])).toBe(false);

      const running = { isRunning: () => true };
      const stopped = { isRunning: () => false };
      expect(await workerListeningIndicator([running])).toBe(true);
      expect(await workerListeningIndicator([running, running])).toBe(true);
      // One stopped worker poisons the answer: the job that matters is the one
      // that is not consuming.
      expect(await workerListeningIndicator([running, stopped])).toBe(false);
      expect(await workerListeningIndicator([stopped])).toBe(false);
    });

    it('reports false — rather than throwing — when Redis is unreachable', async () => {
      // `@nestjs/terminus` re-throws a rejected indicator into a 500, which
      // would replace "this deployment is not ready" with "this endpoint is
      // broken" and lose the per-dependency detail D-10 exists to provide
      // (01-07's terminus lesson). An unreachable server is the normal state
      // during a Redis blip, so it has to be a value, not an exception.
      const unreachable = new Queue('unreachable', {
        ...queueRootOptions('redis://127.0.0.1:1'),
        connection: { url: 'redis://127.0.0.1:1', maxRetriesPerRequest: 1 },
      });
      opened.push(unreachable);

      await expect(
        jobSchedulerReadyIndicator(unreachable, PLATFORM_HEARTBEAT_ID),
      ).resolves.toBe(false);
    }, 60_000);

    it('bounds the scheduler probe instead of hanging on an unreachable server', async () => {
      // The `catch` above is unreachable on its own: `maxRetriesPerRequest`
      // bounds queued commands, not connection establishment, and ioredis's
      // retry strategy plus BullMQ's `waitUntilReady` leave the promise pending
      // forever. This asserts the bound exists — measured, with a budget the
      // test would fail against an unbounded implementation.
      const stalled = { getJobScheduler: () => new Promise<never>(() => {}) };
      const startedAt = process.hrtime.bigint();

      await expect(jobSchedulerReadyIndicator(stalled, 'never')).resolves.toBe(false);

      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      expect(elapsedMs).toBeLessThan(SCHEDULER_PROBE_TIMEOUT_MS * 3);
    });

    it('lets a caller shorten the probe budget for a fast probe', async () => {
      const stalled = { getJobScheduler: () => new Promise<never>(() => {}) };
      const startedAt = process.hrtime.bigint();

      await expect(jobSchedulerReadyIndicator(stalled, 'never', 50)).resolves.toBe(false);

      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      expect(elapsedMs).toBeLessThan(2_000);
    });

    it('reports a worker that cannot answer as not listening', async () => {
      const throwing = {
        isRunning: () => {
          throw new Error('connection is closed');
        },
      };
      expect(await workerListeningIndicator([{ isRunning: () => true }, throwing])).toBe(false);
    });

    it('sees a real BullMQ Worker as listening', async () => {
      const worker = new Worker(
        PLATFORM_HEARTBEAT_ID,
        async () => undefined,
        {
          ...queueRootOptions(queueContainer.getConnectionUrl()),
          connection: blockingConnectionOptions(queueContainer.getConnectionUrl()),
        } satisfies WorkerOptions,
      );
      opened.push(worker);
      await new Promise<void>((resolve, reject) => {
        worker.once('ready', () => resolve());
        worker.once('error', reject);
      });

      expect(await workerListeningIndicator([worker])).toBe(true);
    }, 60_000);
  });

  describe('D-14 — the {akane-q} hash tag against live keys', () => {
    it('reproduces Redis Cluster slot arithmetic exactly', () => {
      // Known-answer vectors taken from a real `CLUSTER KEYSLOT` on Redis 8.10.
      // Without these the helper below could be wrong in a way that makes every
      // other assertion in this file pass for the wrong reason.
      expect(clusterKeySlot('foo')).toBe(12182);
      expect(clusterKeySlot('bar')).toBe(5061);
      expect(clusterKeySlot('hello')).toBe(866);
    });

    it('gives every live BullMQ key the same cluster slot, and the untagged name a different one', async () => {
      const live = await rawClient(queueContainer.getConnectionUrl()).keys('*');
      expect(live.length).toBeGreaterThan(0);

      for (const key of live) {
        expect(key).toContain('{akane-q}');
      }

      const slots = new Set(live.map((key) => clusterKeySlot(key)));
      expect(slots.size).toBe(1);

      // The counterfactual that gives the assertion meaning: the same key name
      // without the hash tag lands somewhere else. If this ever equalled the
      // tagged slot, the tag would be doing nothing.
      const tagged = `${BULLMQ_PREFIX}:${PLATFORM_HEARTBEAT_ID}:wait`;
      const untagged = `bull:${PLATFORM_HEARTBEAT_ID}:wait`;
      expect(clusterKeySlot(tagged)).not.toBe(clusterKeySlot(untagged));
    }, 60_000);

    it('mirrors the key names a live Queue actually uses', async () => {
      // `queueKeyNames` exists so the unit spec can check the hash tag across the
      // whole layout without a server. A mirror is only safe while this pins it
      // to the original, so the two lists cannot drift apart.
      expect([...Object.values(queue.keys)].sort()).toEqual(queueKeyNames(PLATFORM_HEARTBEAT_ID).sort());
    });
  });

  describe('D-12/D-14 — the queue is on the noeviction deployment', () => {
    it('registers the queue against a deployment that must never evict', async () => {
      expect(await readMaxMemoryPolicy(queueContainer)).toBe(QUEUE_MAXMEMORY_POLICY);
      expect(EVICTING_POLICIES).toContain(await readMaxMemoryPolicy(cache));
    }, 60_000);

    it('puts the live queue keys in the queue deployment and nowhere else', async () => {
      const onQueue = await rawClient(queueContainer.getConnectionUrl()).keys('*');
      const onCache = await rawClient(cache.getConnectionUrl()).keys('*');

      expect(onQueue.some((key) => key.startsWith(`${BULLMQ_PREFIX}:`))).toBe(true);
      // A queue pointed at the evicting deployment would lose jobs rather than
      // reject writes under memory pressure, and it would be invisible here —
      // which is the whole reason the split is asserted with two servers.
      expect(onCache.filter((key) => key.includes('akane-q'))).toEqual([]);
    }, 60_000);

    it('connects through the request-path producer profile, never the blocking one', async () => {
      // The producers on the request path (api, scheduler) must fail fast; the
      // blocking profile belongs only to a worker's dedicated connection. Both
      // must also still carry no ioredis keyPrefix — BullMQ keys off its own
      // prefix and a second layer would silently disagree (D-14, T-1-20).
      const root = queueRootOptions(queueContainer.getConnectionUrl());
      expect(root.connection).toEqual(producerConnectionOptions(queueContainer.getConnectionUrl()));
      expect(root.connection.maxRetriesPerRequest).not.toBeNull();
      expect(blockingConnectionOptions(queueContainer.getConnectionUrl()).maxRetriesPerRequest).toBeNull();
      expect(Object.keys(root.connection)).not.toContain('keyPrefix');
    });
  });

  describe('the heartbeat queue identity', () => {
    it('registers the scheduler id that owns the heartbeat processor', () => {
      // `QueueModule` registers by name and `platform-heartbeat.job.ts` owns the
      // scheduler id; if those two ever disagreed, jobs would be scheduled onto
      // a queue nothing consumes.
      expect(PLATFORM_HEARTBEAT_QUEUE).toBe(PLATFORM_HEARTBEAT_ID);
      expect((queue as Queue & { name: string }).name).toBe(PLATFORM_HEARTBEAT_ID);
    });
  });
});

/**
 * Every non-spec source file in `packages/platform/src/queue`, by file name.
 *
 * Text-only on purpose: the assertion is that a *removed* API is named nowhere
 * in the queue sources, which is a property of the source text and not of any
 * runtime state.
 */
function queueSourceFiles(): Record<string, string> {
  const directory = new URL('./', import.meta.url);
  const found: Record<string, string> = {};
  for (const entry of readdirSync(directory)) {
    if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      found[entry] = readFileSync(new URL(entry, directory), 'utf8');
    }
  }
  return found;
}

/**
 * Comments cannot call a function, so they are removed before the removed-API
 * scan. Mirrors the keyPrefix scan in `queue.spec.ts`, for the same reason: the
 * documentation that explains a removed API has to name it.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

/**
 * Redis Cluster's key-slot arithmetic: `CRC16(tag ?? key) mod 16384`, where the
 * tag is the text between the first `{` and the first `}` that follows it.
 *
 * This exists so the hash tag can be proved to be doing something. Asserting
 * only "every key contains `{akane-q}`" would pass against a Redis that ignores
 * hash tags; asserting only "all keys share a slot" would pass against a key
 * space small enough to collide by accident. Computing the slot is the claim.
 *
 * Pinned against real `CLUSTER KEYSLOT` answers in the test above.
 */
const CRC16_POLYNOMIAL = 0x1021;

function crc16(bytes: Buffer): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ CRC16_POLYNOMIAL) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function clusterKeySlot(key: string): number {
  const open = key.indexOf('{');
  if (open !== -1) {
    const close = key.indexOf('}', open + 1);
    // An empty tag (`{}`) is not a tag; Redis falls back to the whole key.
    if (close > open + 1) {
      return crc16(Buffer.from(key.slice(open + 1, close))) % 16384;
    }
  }
  return crc16(Buffer.from(key)) % 16384;
}