/**
 * The platform barrel (D-01, FND-03).
 *
 * ## The one import a composition root needs
 *
 * Each `apps/<app>/src/app.module.ts` and each `apps/<app>/src/main.ts` imports
 * from here and from nowhere else. That is what makes "the three entrypoints
 * cannot drift" a structural property rather than a review item: there is one
 * surface to read, and a difference between two apps has to be written down
 * somewhere to exist at all.
 *
 * Every subfolder carries its own `index.ts`, and those are what the lines below
 * re-export. The subfolder barrels are not redundant — they are what lets
 * `packages/platform/package.json` add a single deep entry (`./otel`, see
 * below) without this file becoming the only way to reach anything.
 *
 * ## The one deliberate exception: `./otel`
 *
 * `apps/<app>/otel.mjs` and `apps/<app>/src/main.ts` import `@akane/platform/otel`
 * rather than this barrel. Not tidiness — D-20. OpenTelemetry's instrumentations
 * patch their targets at load time, so the SDK has to start before the modules
 * it instruments are loaded. This barrel transitively loads `ioredis`,
 * `mongodb`, `bullmq` and `@nestjs/terminus`; importing it from a loader entry
 * would load all four *before* `startOtel()` runs and silently cost every
 * database and queue span in the process. `otel/index.ts` reaches none of them.
 *
 * The `exports` map therefore needs exactly one subpath — the one that must
 * load before anything instrumented — and this barrel needs no consumer that
 * predates it. That is the deliberate resolution of the five-times-repeated
 * hand-off in WINDOWS.md entry 11: add what is needed, not what might be.
 *
 * ## Two symbols are re-exported from *different* folders on purpose
 *
 * `PRODUCER_MAX_RETRIES_PER_REQUEST` is defined once in `redis.provider.ts` and
 * once in `queue/queue.provider.ts` (D-14: the two profiles are separate
 * because BullMQ requires `null` for a blocking connection). `export *` from both
 * would be an ambiguous re-export, which TypeScript rejects — so the Redis one
 * is named explicitly here and the queue barrel keeps its own copy.
 */
export * from './bootstrap/boundary-manifest.js';
export * from './bootstrap/process-capabilities.js';
export * from './bootstrap/provider-boundary.guard.js';
export * from './bootstrap/provider-boundary.runner.js';
export * from './config/config.schema.js';
export * from './config/config.module.js';
export * from './config/redis.schema.js';
export * from './crypto/index.js';
export * from './health/index.js';
export * from './logging/index.js';
export * from './metrics/index.js';
export * from './mongo/index.js';
export * from './otel/index.js';
export * from './queue/index.js';
export * from './redis/redis.constants.js';

// Explicit rather than `export *`: `queue/index.js` re-exports
// `PRODUCER_MAX_RETRIES_PER_REQUEST` from `queue.provider.ts`, and two
// `export *`s providing the same name is TS2308. See the module docblock.
export {
  buildRedisOptions,
  createRedisClient,
  PRODUCER_MAX_RETRIES_PER_REQUEST as REDIS_PRODUCER_MAX_RETRIES_PER_REQUEST,
  redisCacheProvider,
  redisQueueProvider,
  type RedisClientConfig,
  type RedisProfile,
} from './redis/redis.provider.js';