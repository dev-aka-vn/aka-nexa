import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { HealthIndicatorService, TerminusModule } from '@nestjs/terminus';

import {
  BOUNDARY_MANIFEST,
  BUSINESS_METRICS_RECORDER,
  ConfigModule,
  createBusinessMetricsRecorder,
  CryptoModule,
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
  type WorkerRunningStatus,
} from '@akane/platform';
import {
  ConnectorRateLimiter,
  ConnectorRegistry,
  OutboxRepository,
  SubmissionRevisionsRepository,
} from '@akane/domain';

import { WORKER_BOUNDARY_MANIFEST } from './bootstrap/boundary-manifest.js';
import {
  PlatformHeartbeatProcessor,
  platformHeartbeatWorkersProvider,
} from './processors/platform-heartbeat.processor.js';
import {
  OutboxRelayProcessor,
} from './processors/outbox-relay.processor.js';
import {
  ConnectorDeliveryProcessor,
} from './processors/connector-delivery.processor.js';
import {
  ReconciliationProcessor,
  reconciliationWorkersProvider,
} from './processors/reconciliation.processor.js';

/** The readiness key this process contributes. Named so a dashboard can find it. */
const WORKER_READINESS_KEY = 'bullmq_workers';

/**
 * The `worker` composition root (FND-03, FND-05, FND-08, OBS-01).
 *
 * Identical to `api`'s wiring plus two things: the one BullMQ `Worker`, and the
 * extra readiness indicator that proves it is listening.
 */
@Module({
  imports: [
    ConfigModule,
    CryptoModule,
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
    OutboxRelayProcessor,
    ConnectorDeliveryProcessor,
    ReconciliationProcessor,
    reconciliationWorkersProvider,
    OutboxRepository,
    SubmissionRevisionsRepository,
    ConnectorRegistry,
    ConnectorRateLimiter,
    {
      // OBS-04 / CON-06: the delivery processor writes the two business
      // counters through this seam rather than importing the OTel API itself.
      provide: BUSINESS_METRICS_RECORDER,
      useFactory: () => createBusinessMetricsRecorder(),
    },
    {
      provide: WORKER_CONSUMERS,
      inject: [PlatformHeartbeatProcessor, OutboxRelayProcessor, ConnectorDeliveryProcessor, ReconciliationProcessor],
      useFactory: (
        platform: PlatformHeartbeatProcessor,
        relay: OutboxRelayProcessor,
        delivery: ConnectorDeliveryProcessor,
        reconciliation: ReconciliationProcessor,
      ) => [platform, relay, delivery, reconciliation],
    },
    { provide: BOUNDARY_MANIFEST, useValue: WORKER_BOUNDARY_MANIFEST },
    ProviderBoundaryGuardRunner,
    {
      provide: EXTRA_HEALTH_INDICATORS,
      inject: [HealthIndicatorService, WORKER_CONSUMERS],
      useFactory: (
        health: HealthIndicatorService,
        workers: readonly WorkerRunningStatus[],
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
    await shutdownOtel();
  }
}
