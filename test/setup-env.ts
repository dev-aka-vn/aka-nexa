/**
 * Vitest global setup: seed the required boot configuration.
 *
 * `ConfigModule.forRoot()` validates `process.env` eagerly when the module is
 * imported. The boot contract (FND-09) requires SERVICE_NAME, MONGO_URL and
 * both Redis URLs, so every spec that compiles an app module needs a complete
 * environment. Failure paths are asserted directly against
 * `validateConfig()` / `RedisConfigSchema`, which take explicit input and never
 * read `process.env` — these values only satisfy the boot path.
 *
 * Existing values are never overwritten, so a developer can run the suite
 * against a local stack by exporting the real variables first.
 */
const REQUIRED_TEST_ENV: Record<string, string> = {
  SERVICE_NAME: 'api',
  MONGO_URL: 'mongodb://127.0.0.1:27017/akane-test',
  REDIS_CACHE_URL: 'redis://127.0.0.1:6379',
  REDIS_QUEUE_URL: 'redis://127.0.0.1:6380',
  CRYPTO_KEY_PROVIDER: 'local',
};

for (const [key, value] of Object.entries(REQUIRED_TEST_ENV)) {
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = value;
  }
}
