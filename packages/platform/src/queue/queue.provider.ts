import type { RedisOptions } from 'bullmq';

import { BULLMQ_PREFIX } from './queue.constants.js';

/**
 * The two BullMQ connection profiles (D-14, T-1-19).
 *
 * They exist because BullMQ issues two different kinds of Redis command:
 * ordinary ones from the request path, and `BRPOPLPUSH`-class **blocking** ones
 * from a worker's dedicated connection. A blocking command legitimately parks
 * for longer than any retry budget, so a finite `maxRetriesPerRequest` would
 * make BullMQ fail the connection instead of waiting. A request-path producer
 * has the opposite requirement: when Redis is down it must fail *fast* so the
 * HTTP handler 5xx's, rather than hang until the orchestrator calls the pod
 * unresponsive.
 *
 * This is the one place in the system where "share the Redis connection
 * everywhere" is deliberately abandoned, and the reason is that the two profiles
 * differ in a value that cannot be changed after the first command is issued.
 */

/** Within the 1..3 band D-14 requires for request-path connections (T-1-19). */
export const PRODUCER_MAX_RETRIES_PER_REQUEST = 2;

/**
 * The BullMQ `connection` object for a queue profile.
 *
 * `url` is passed through rather than decomposed into `host`/`port`/`db`/
 * credentials here: BullMQ destructures `url` itself and hands it to ioredis as
 * the first constructor argument (`new Redis(url, rest)`), so the query string,
 * any `rediss://` TLS upgrade and the credentials in the URL all survive without
 * this module re-implementing URL parsing.
 *
 * `keyPrefix` is **never** set, on either profile (D-14, T-1-20). BullMQ computes
 * its key names from its own `prefix` and reads them back with Lua scripts that
 * embed those literal strings, while ioredis applies `keyPrefix` at the command
 * layer — so the two layers would disagree about where keys live and about which
 * keys a script addresses. One prefixing layer, expressed only through BullMQ.
 */
export type QueueConnectionOptions = RedisOptions;

/**
 * Request-path connection: finite retries so a Redis outage surfaces as a failed
 * request instead of a hung one (T-1-19).
 */
export function producerConnectionOptions(queueUrl: string): QueueConnectionOptions {
  return {
    url: queueUrl,
    maxRetriesPerRequest: PRODUCER_MAX_RETRIES_PER_REQUEST,
  };
}

/**
 * Worker blocking connection: `null`, which is what BullMQ requires.
 *
 * Not an oversight and not a copy of the producer profile — BullMQ's
 * `RedisConnection.checkBlockingOptions` throws on a truthy
 * `maxRetriesPerRequest` for a blocking connection, and its own
 * `blockingRedisOptions` path resets the value to `null`. Passing `null`
 * explicitly is what keeps that override silent instead of a `console.error` on
 * every worker boot.
 */
export function blockingConnectionOptions(queueUrl: string): QueueConnectionOptions {
  return {
    url: queueUrl,
    maxRetriesPerRequest: null,
  };
}

/**
 * The shared configuration handed to `BullModule.forRootAsync` (and, equivalently,
 * to `new Queue(...)`).
 *
 * The queue Redis URL is an argument rather than read from configuration so this
 * module has no `ConfigService` dependency: the same builder serves the Nest
 * factory (which injects config) and a spec (which passes a container URL)
 * without a Nest container. `REDIS_QUEUE_URL` and **not** `REDIS_CACHE_URL` is
 * load-bearing — `maxmemory-policy` is instance-wide, so pointing the queue at
 * the evicting cache deployment silently loses jobs under memory pressure
 * (D-12/D-13).
 */
export function queueRootOptions(queueUrl: string): {
  connection: QueueConnectionOptions;
  prefix: string;
} {
  return {
    connection: producerConnectionOptions(queueUrl),
    prefix: BULLMQ_PREFIX,
  };
}

/**
 * BullMQ's per-queue key suffixes, mirroring `QueueKeys.getKeys`.
 *
 * This exists so the `{akane-q}` hash tag can be asserted over the *whole* key
 * layout without standing up Redis, per RESEARCH A7. It is deliberately a
 * literal list rather than an import of BullMQ's internal `QueueKeys`: that class
 * is not part of `bullmq`'s public export surface, and the package ships its
 * `dist/esm` tree under a CommonJS `package.json`, so a deep import into it
 * depends on Node's module-syntax detection to load at all.
 *
 * A mirror is only safe while something pins it to the original, so
 * `queue.integration.spec.ts` asserts that every name produced here equals the
 * corresponding key of a live `Queue`. The two lists cannot drift.
 */
export const QUEUE_KEY_SUFFIXES: readonly string[] = Object.freeze([
  '',
  'active',
  'wait',
  'waiting-children',
  'paused',
  'id',
  'delayed',
  'prioritized',
  'stalled-check',
  'completed',
  'failed',
  'stalled',
  'repeat',
  'limiter',
  'meta',
  'events',
  'pc',
  'marker',
  'de',
]);

/**
 * Every key name BullMQ will derive for `queueName` under `prefix`.
 *
 * D-14's hash tag is load-bearing exactly here: Redis Cluster computes a key's
 * slot from `CRC16(...)` over the substring between the first `{` and the first
 * `}` when one exists, so `{akane-q}:platform-heartbeat:wait` and
 * `{akane-q}:platform-heartbeat:delayed` are guaranteed to land on the same node
 * and the multi-key Lua scripts BullMQ ships stay single-node. Drop the tag and
 * every one of these scatters across the cluster, at which point the scripts
 * either fail with `CROSSSLOT` or — worse, once someone adds a `keyPrefix` on
 * top — address keys that no longer exist.
 */
export function queueKeyNames(queueName: string, prefix: string = BULLMQ_PREFIX): string[] {
  const qualified = `${prefix}:${queueName}`;
  return QUEUE_KEY_SUFFIXES.map((suffix) => `${qualified}:${suffix}`);
}