/**
 * The one BullMQ `Worker` in this repository — option and readiness contracts
 * (FND-08, D-03, D-14).
 *
 * ## Why the prefix needs its own test
 *
 * `prefix` was absent from this `Worker` for the whole of plan 10's first draft,
 * and **every other assertion passed while the worker consumed nothing at all**.
 * The producer `Queue` carried `{akane-q}`; the consumer listened on BullMQ's
 * default `bull` namespace; `/health/ready` reported
 * `bullmq_workers: { workers: 1, status: "up" }` because `Worker.isRunning()`
 * answers "is my blocking loop alive", not "am I watching the queue anyone
 * produces to". Redis held the scheduler's keys and no completed jobs, and the
 * heartbeat counter on the OTel meter stayed at zero.
 *
 * So this file pins the option set as a *value*, and pins it against the
 * producer's own prefix rather than against a literal — a literal would have
 * passed with two different literals. `platform-heartbeat.processor.spec.ts`
 * in `queue.integration.spec.ts`'s shadow has no Redis dependency: no
 * `Worker` is constructed here, only the options that would construct one.
 */
import { describe, expect, it } from 'vitest';

import {
  blockingConnectionOptions,
  BULLMQ_PREFIX,
  PLATFORM_HEARTBEAT_ID,
  producerConnectionOptions,
  queueRootOptions,
} from '@akane/platform';

import {
  platformHeartbeatWorkerOptions,
  PlatformHeartbeatProcessor,
} from './platform-heartbeat.processor.js';

const QUEUE_URL = 'redis://queue.internal:6379';

describe('platformHeartbeatWorkerOptions — the one Worker (FND-08, D-14)', () => {
  /**
   * The regression this file exists for.
   *
   * Without `prefix`, BullMQ defaults to `bull` and the worker parks on a queue
   * the rest of the system never names. Both halves are asserted against the
   * producer's prefix — the single source of truth is `BULLMQ_PREFIX`, and
   * `queueRootOptions` is what hands it to the `Queue`.
   */
  it('listens on the same prefix the producer queue is registered under', () => {
    const options = platformHeartbeatWorkerOptions(QUEUE_URL);
    expect(options.prefix).toBe(BULLMQ_PREFIX);
    expect(options.prefix).toBe(queueRootOptions(QUEUE_URL).prefix);
    expect(options.prefix).toBe('{akane-q}');
  });

  it('uses the blocking connection profile, and never the producer one (T-1-19)', () => {
    const options = platformHeartbeatWorkerOptions(QUEUE_URL);
    expect(options.connection).toEqual(blockingConnectionOptions(QUEUE_URL));
    // BullMQ's `checkBlockingOptions` throws on a truthy value here, so the
    // distinction is a boot failure rather than a degraded mode.
    expect(options.connection.maxRetriesPerRequest).toBeNull();
    expect(options.connection.maxRetriesPerRequest).not.toBe(
      producerConnectionOptions(QUEUE_URL).maxRetriesPerRequest,
    );
  });

  it('never sets an ioredis keyPrefix — one prefixing layer only (D-14)', () => {
    // BullMQ's Lua scripts embed literal key names that `keyPrefix` does not
    // rewrite, so a second layer silently addresses keys that do not exist.
    expect(platformHeartbeatWorkerOptions(QUEUE_URL)).not.toHaveProperty('connection.keyPrefix');
  });

  it('carries the queue URL through untouched, including credentials and TLS', () => {
    const url = 'rediss://user:pass@queue.internal:6380/3';
    expect(platformHeartbeatWorkerOptions(url).connection.url).toBe(url);
  });
});

describe('PlatformHeartbeatProcessor.isRunning — the readiness slice (D-10)', () => {
  /**
   * `isRunning()` is `Worker`'s own answer and is what readiness reads. The
   * processor's contract over it is the `#lastError` short-circuit: a worker that
   * has thrown is not listening, whatever BullMQ's flag still says.
   */
  it('reports false before bootstrap and after shutdown — never vacuously true', () => {
    const processor = new PlatformHeartbeatProcessor({
      getOrThrow: () => QUEUE_URL,
    } as never);

    // No Worker exists yet, so `worker?.isRunning() ?? false` is the only answer
    // that is honest. D-10's "every registered worker is listening" is vacuously
    // true for an empty list, which is the failure the extra indicator exists to
    // catch — a process that registered no consumer must not report itself ready.
    expect(processor.isRunning()).toBe(false);
    expect(processor.lastError).toBeUndefined();
  });

  it('reads REDIS_QUEUE_URL, never the cache URL — the queue deployment is noeviction (D-13)', () => {
    const requested: string[] = [];
    const processor = new PlatformHeartbeatProcessor({
      getOrThrow: (key: string) => {
        requested.push(key);
        return QUEUE_URL;
      },
    } as never);

    expect(requested).toEqual(['REDIS_QUEUE_URL']);
    expect(processor.isRunning()).toBe(false);
  });

  it('consumes the same queue name the scheduler registers under', () => {
    // The name is a frozen constant shared with `registerPlatformHeartbeat`, so a
    // rename cannot desynchronise producer and consumer inside one build — but a
    // *prefix* desync (the bug above) is invisible to this and is why the options
    // are asserted separately.
    expect(PLATFORM_HEARTBEAT_ID).toBe('platform-heartbeat');
  });
});
