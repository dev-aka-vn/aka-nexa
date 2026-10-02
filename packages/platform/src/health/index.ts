/**
 * The health surface (FND-05, D-10).
 *
 * A separate barrel, matching `crypto/`, `logging/` and `mongo/`, so wiring
 * health into a composition root does not require editing the platform
 * package's public barrel. `packages/platform/package.json` declares only `"."`
 * and `"./crypto"` in its `exports` map, so `@akane/platform/health` does not
 * resolve cross-package until a plan adds that entry — the same hand-off 01-04
 * (`./logging`) and 01-05 (`./crypto`) recorded. Plan 10 imports the root
 * barrel and does not need it.
 */
export { MONGO_HEALTH_KEY, MongoIndicator } from './mongo.indicator.js';
export { RedisIndicator } from './redis.indicator.js';
export type { RedisPingClient } from './redis.indicator.js';
export {
  CORE_HEALTH_INDICATOR_KEYS,
  EXTRA_HEALTH_INDICATORS,
  HealthController,
  REDIS_CACHE_HEALTH_KEY,
  REDIS_QUEUE_HEALTH_KEY,
} from './health.controller.js';
