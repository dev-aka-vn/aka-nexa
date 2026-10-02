/**
 * The data-access floor (FND-05).
 *
 * A separate barrel, matching `crypto/` and `logging/`, so an entrypoint can
 * import `@akane/platform/mongo` without pulling the config, redis, and queue
 * surfaces through the top-level barrel. The `exports` map in
 * `packages/platform/package.json` needs a matching `"./mongo"` entry for that
 * specifier to resolve outside this package; until one exists, only the
 * root-relative barrel reaches this surface.
 */
export { MONGO_CLIENT, MongoModule, mongoServiceProvider } from './mongo.module.js';
export {
  DEFAULT_DATABASE,
  DEFAULT_SERVER_SELECTION_TIMEOUT_MS,
  MongoService,
} from './mongo.service.js';
export type { MongoServiceOptions } from './mongo.service.js';
