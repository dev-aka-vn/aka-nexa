import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import {
  BOUNDARY_MANIFEST,
  ConfigModule,
  HealthController,
  MetricsModule,
  MongoModule,
  ProviderBoundaryGuardRunner,
  redisCacheProvider,
  redisQueueProvider,
  redisShutdownProvider,
  shutdownOtel,
} from '@akane/platform';

import { API_BOUNDARY_MANIFEST } from './bootstrap/boundary-manifest.js';

/**
 * The `api` composition root (FND-03, FND-05, FND-08, OBS-01).
 *
 * ## What this module deliberately does **not** have
 *
 * No BullMQ `Worker`, no `QueueModule`, and no Job Scheduler registration. `api`
 * is the request path, and the <200 ms webhook-ack budget (D-13) is why: a
 * consumer polling a queue inside this process parks a blocking Redis command in
 * the very event loop that has to answer the ack. R1 enforces the `Worker` import
 * statically (`no-restricted-imports` on `apps/api/src/**`), and
 * `API_BOUNDARY_MANIFEST` refuses `QUEUE_PRODUCER_TOKEN` at boot — which is the
 * half lint cannot see, because `imports: [QueueModule]` is a *legal* import that
 * is only wrong for this process.
 *
 * ## The wiring is identical in all three apps on purpose
 *
 * `ConfigModule`, `MongoModule`, the two Redis providers, `TerminusModule`,
 * `MetricsModule`, `HealthController`, the boundary guard runner. The only
 * per-process differences are the two extra readiness indicators `worker` and
 * `scheduler` contribute. A difference that is not a readiness check is the drift
 * FND-03 exists to prevent, so it should show up as a diff here rather than as a
 * production surprise.
 */
@Module({
  imports: [
    ConfigModule,
    MongoModule,
    TerminusModule.forRoot(),
    MetricsModule,
  ],
  controllers: [HealthController],
  providers: [
    redisCacheProvider,
    redisQueueProvider,
    redisShutdownProvider,
    { provide: BOUNDARY_MANIFEST, useValue: API_BOUNDARY_MANIFEST },
    ProviderBoundaryGuardRunner,
  ],
})
export class AppModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    // T-1-24: buffered spans die with the process otherwise, and a rolling
    // deploy is exactly when telemetry is most likely to be short.
    await shutdownOtel();
  }
}
