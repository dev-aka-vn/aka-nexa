import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { otelBootstrapConfigFromEnv, startOtel } from '@akane/platform/otel';

/**
 * The `scheduler` bootstrap — one shape, copied verbatim by `api` and `worker`
 * (FND-03, D-09, D-20).
 *
 * ## The order here is the contract, not a style preference
 *
 * 1. `startOtel()` — before anything instrumented is loaded.
 * 2. `await import("./app.module.js")` — **dynamic**, because a static import of
 *    `AppModule` would evaluate the whole application module graph at load time,
 *    and `express`, `ioredis`, `mongodb` and `bullmq` all sit behind it. Doing
 *    that in step 1's place costs every request, database and queue span in the
 *    process, with no error anywhere: `instrumentation-express` installs a
 *    `Module._load` hook, and a target loaded before the hook never gets patched.
 *    01-09 measured this pair — SDK first, 4 spans including `http.route`; module
 *    first, 1 span, and it is not a server span.
 * 3. `enableShutdownHooks()` (D-09) — without it, SIGTERM is Node's default:
 *    the process dies on the spot and `onApplicationShutdown` never runs. That is
 *    what turns a rolling deploy into a killed submission mid-transaction, and
 *    it is invisible until the deploy that triggers it.
 * 4. `listen(port)` with the port read from validated config. Not a literal:
 *    `DEFAULT_PORT_BY_SERVICE` in the boot schema gives `api` 3000 and lets one
 *    env var move it, so three processes can run side by side and a deployment
 *    can override without a rebuild.
 *
 * `enableShutdownHooks()` must precede `listen()`: the hook subscribes to the
 * signal listeners that the listen call installs.
 *
 * ## Shutdown
 *
 * `AppModule.onApplicationShutdown` calls `shutdownOtel()`, so a SIGTERM flushes
 * buffered spans before the process exits (T-1-24).
 */
async function bootstrap(): Promise<void> {
  await startOtel(otelBootstrapConfigFromEnv());

  const { AppModule } = await import("./app.module.js");

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  await app.listen(app.get(ConfigService).getOrThrow<number>('PORT'));
}

void bootstrap();