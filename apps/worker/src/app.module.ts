import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  MongoService,
  REDIS_QUEUE,
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
  AppDefinitionRepository,
  AuditRepository,
  AuditRetentionService,
  AppPurgeService,
  ConnectorRateLimiter,
  ConnectorRegistry,
  NotificationsModule,
  OutboxRepository,
  PlatformEventRepository,
  SubmissionRevisionsRepository,
  TransferRequestRepository,
  TransferRequestService,
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
import {
  TransferAutoCancelProcessor,
  transferAutoCancelWorkersProvider,
} from './processors/transfer-auto-cancel.processor.js';
import { AuditRetentionProcessor } from './processors/audit-retention.processor.js';
import { PurgeSweepProcessor } from './processors/purge-sweep.processor.js';
import {
  NotificationProcessor,
} from './processors/notification.processor.js';
import { OutboundDeliveryProcessor } from './processors/outbound-delivery.processor.js';
import {
  OUTBOUND_DELIVERY_REGISTRY,
  OutboundDeliveryRegistry,
} from './processors/outbound-delivery.registry.js';
import { WorkerQueueModule } from './queue/worker-queue.module.js';
import { WorkerModule } from './worker.module.js';
import { InboundEventProcessor } from './processors/inbound-event.processor.js';
import {
  TeamsDeliveryAdapter,
  TEAMS_CLOUD_ADAPTER,
  TeamsCloudAdapterHolder,
} from './adapters/teams/outbound/teams-delivery.adapter.js';

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
    // The outbound delivery seam's queue. Registered here (not in
    // `packages/platform`) because only this process produces onto it.
    WorkerQueueModule,
    // The inbound routing path. Previously an orphan: `WorkerModule` was
    // imported for its decorators only, so `InboundEventProcessor` was never
    // instantiated and nothing consumed `INBOUND_EVENTS_QUEUE`.
    WorkerModule,
    NotificationsModule,
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
    TransferAutoCancelProcessor,
    transferAutoCancelWorkersProvider,
    AuditRetentionProcessor,
    PurgeSweepProcessor,
    NotificationProcessor,
    TeamsDeliveryAdapter,
    {
      provide: TEAMS_CLOUD_ADAPTER,
      useFactory: () => new TeamsCloudAdapterHolder(),
    },
    // OUT-12's registry: platform → delivery port. Teams is the only one
    // with an implementation today; Zalo (Phase 12) and Telegram (Phase 13)
    // each add a port and one `register` line, not a new processor branch.
    {
      provide: OUTBOUND_DELIVERY_REGISTRY,
      useFactory: (teams: TeamsDeliveryAdapter): OutboundDeliveryRegistry => {
        const registry = new OutboundDeliveryRegistry();
        registry.register('teams', teams);
        return registry;
      },
      inject: [TeamsDeliveryAdapter],
    },
    {
      provide: PlatformEventRepository,
      useFactory: (config: ConfigService): PlatformEventRepository =>
        new PlatformEventRepository(config),
      inject: [ConfigService],
    },
    OutboundDeliveryProcessor,
    OutboxRepository,
    SubmissionRevisionsRepository,
    ConnectorRegistry,
    ConnectorRateLimiter,
    {
      // ACL-05/T-06-31: the transfer
      // auto-cancel's domain chain — the
      // worker's own instances of the
      // definition store, the transfer
      // store, the audit log, and the
      // transfer service over them.
      provide: AppDefinitionRepository,
      useFactory: (mongo: MongoService): AppDefinitionRepository =>
        new AppDefinitionRepository(mongo),
      inject: [MongoService],
    },
    {
      provide: AuditRepository,
      useFactory: (mongo: MongoService): AuditRepository =>
        new AuditRepository(mongo),
      inject: [MongoService],
    },
    {
      provide: AuditRetentionService,
      useFactory: (
        audit: AuditRepository,
        redis: import('ioredis').Redis,
        config: import('@nestjs/config').ConfigService,
      ): AuditRetentionService => new AuditRetentionService(audit, redis, config),
      inject: [AuditRepository, REDIS_QUEUE, ConfigService],
    },
    {
      provide: AppPurgeService,
      useFactory: (
        mongo: MongoService,
        audit: AuditRepository,
        config: import('@nestjs/config').ConfigService,
      ): AppPurgeService => new AppPurgeService(mongo, audit, config),
      inject: [MongoService, AuditRepository, ConfigService],
    },
    {
      provide: TransferRequestRepository,
      useFactory: (mongo: MongoService): TransferRequestRepository =>
        new TransferRequestRepository(mongo),
      inject: [MongoService],
    },
    {
      provide: TransferRequestService,
      useFactory: (
        transfers: TransferRequestRepository,
        definitions: AppDefinitionRepository,
        audit: AuditRepository,
      ): TransferRequestService =>
        new TransferRequestService(transfers, definitions, audit),
      inject: [
        TransferRequestRepository,
        AppDefinitionRepository,
        AuditRepository,
      ],
    },
    {
      // OBS-04 / CON-06: the delivery processor writes the two business
      // counters through this seam rather than importing the OTel API itself.
      provide: BUSINESS_METRICS_RECORDER,
      useFactory: () => createBusinessMetricsRecorder(),
    },
    {
      provide: WORKER_CONSUMERS,
      inject: [PlatformHeartbeatProcessor, OutboxRelayProcessor, ConnectorDeliveryProcessor, ReconciliationProcessor, TransferAutoCancelProcessor, NotificationProcessor, AuditRetentionProcessor, PurgeSweepProcessor, OutboundDeliveryProcessor, InboundEventProcessor],
      useFactory: (
        platform: PlatformHeartbeatProcessor,
        relay: OutboxRelayProcessor,
        delivery: ConnectorDeliveryProcessor,
        reconciliation: ReconciliationProcessor,
        transferAutoCancel: TransferAutoCancelProcessor,
        notification: NotificationProcessor,
        auditRetention: AuditRetentionProcessor,
        purgeSweep: PurgeSweepProcessor,
        outbound: OutboundDeliveryProcessor,
        inbound: InboundEventProcessor,
      ) => [platform, relay, delivery, reconciliation, transferAutoCancel, notification, auditRetention, purgeSweep, outbound, inbound],
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
import './worker.module.js';
