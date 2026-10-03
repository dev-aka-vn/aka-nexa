import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { HealthIndicatorService, TerminusModule } from '@nestjs/terminus';

import {
  BOUNDARY_MANIFEST,
  ConfigModule,
  EXTRA_HEALTH_INDICATORS,
  HealthController,
  MetricsModule,
  MongoModule,
  ProviderBoundaryGuardRunner,
  QueueModule,
  redisCacheProvider,
  redisQueueProvider,
  redisShutdownProvider,
  shutdownOtel,
  WORKER_CONSUMERS,
  workerListeningIndicator,
} from '@akane/platform';

import { WORKER_BOUNDARY_MANIFEST } from './bootstrap/boundary-manifest.js';
import {
  PlatformHeartbeatProcessor,
  platformHeartbeatWorkersProvider,
} from './processors/platform-heartbeat.processor.js';

/** The readiness key this process contributes. Named so a dashboard can find it. */
const WORKER_READINESS_KEY = 'bullmq_workers';

/**
 * The `worker` composition root (FND-03, FND-05, FND-08, OBS-01).
 *
 * Identical to `api`'s wiring plus two things: the one BullMQ `Worker`, and the
 * extra readiness indicator that proves it is listening.
 *
 * `QueueModule` is imported so this process holds the *same registered queue name*
 * the producer side registered — a consumer whose queue name has drifted away from
 * the one anything enqueues to would sit at 100% "idle" forever, which is the one
 * queue failure a dashboard cannot show. The queue `Queue` instance itself is not
 * injected here; the worker builds its own blocking connection (D-14).
 *
 * ## Why the extra indicator must not throw
 *
 * `@nestjs/terminus` re-throws anything an indicator rejects, which turns a
 * downed consumer into a **500** instead of the 503 an operator's probe expects.
 * So the wrapper below resolves `up`/`down` and never rejects — the same rule
 * 01-07's core indicators and 01-08's `workerListeningIndicator` were built to.
 * An empty worker list is `false`, not vacuously `true`: a worker that registered
 * no consumer must not report itself ready while consuming nothing.
 */
@Module({
  imports: [
    ConfigModule,
    MongoModule,
    QueueModule,
    TerminusModule.forRoot(),
    MetricsModule,
  ],
  controllers: [HealthController],
  providers: [
    redisCacheProvider,
    redisQueueProvider,
    redisShutdownProvider,
    PlatformHeartbeatProcessor,
    platformHeartbeatWorkersProvider,
    { provide: BOUNDARY_MANIFEST, useValue: WORKER_BOUNDARY_MANIFEST },
    ProviderBoundaryGuardRunner,
    {
      provide: EXTRA_HEALTH_INDICATORS,
      inject: [HealthIndicatorService, WORKER_CONSUMERS],
      useFactory: (
        health: HealthIndicatorService,
        workers: PlatformHeartbeatProcessor[],
      ) => [
        async () => {
          const session = health.check(WORKER_READINESS_KEY);
          const listening = await workerListeningIndicator(workers);
          return listening
            ? session.up({ workers: workers.length })
            : session.down({ workers: workers.length });
        },
      ],
    },
  ],
})
export class AppModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    // T-1-24: flush the OTel SDK on SIGTERM. The `Worker` closes itself from its
    // own `onApplicationShutdown`, which Nest awaits before this runs, so the
    // blocking connection is drained before the exporter is shut down.
    await shutdownOtel();
  }
}
