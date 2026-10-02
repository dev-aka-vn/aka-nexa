import { z } from 'zod';

/**
 * Issue code for the D-12 cross-field rule. It is a custom Zod issue, so the
 * machine-readable token travels in the issue `message` and the boot hook
 * surfaces it verbatim (`formatConfigError`).
 */
export const REDIS_INSTANCES_NOT_DISTINCT = 'REDIS_INSTANCES_NOT_DISTINCT';

/**
 * The two separately-required Redis deployments (D-12). Never one URL with a
 * logical-database suffix: `maxmemory-policy` is instance-wide, so logical DBs
 * cannot express the cache/queue durability split.
 */
export const REDIS_URL_FIELDS = {
  REDIS_CACHE_URL: z.string().url(),
  REDIS_QUEUE_URL: z.string().url(),
} as const;

export interface RedisConfig {
  REDIS_CACHE_URL: string;
  REDIS_QUEUE_URL: string;
}

/**
 * D-12 distinct-instance refinement.
 *
 * `URL.host` includes the port and is a pure syntactic parse — no DNS lookup,
 * no connection. Comparing host:port keeps two deployments on one host with
 * different ports valid (the local-dev and single-node-cluster case, D-12/A3)
 * while rejecting a single instance, which is the split silently regressing.
 *
 * The logical-database index in the URL path is deliberately ignored: a `/0`
 * vs `/1` suffix does not make two URLs distinct instances.
 */
export function refineRedisInstancesDistinct(
  config: RedisConfig,
  ctx: z.RefinementCtx,
): void {
  const cacheHost = new URL(config.REDIS_CACHE_URL).host;
  const queueHost = new URL(config.REDIS_QUEUE_URL).host;

  if (cacheHost === queueHost) {
    ctx.addIssue({
      code: 'custom',
      message: REDIS_INSTANCES_NOT_DISTINCT,
    });
  }
}

/**
 * Standalone form of the two-URL contract, usable on its own (tests, tooling)
 * and merged field-wise into `AppConfigSchema` so the boot hook reports the
 * same named failure.
 */
export const RedisConfigSchema = z
  .object(REDIS_URL_FIELDS)
  .superRefine(refineRedisInstancesDistinct);
