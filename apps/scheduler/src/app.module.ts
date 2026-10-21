import { getQueueToken, InjectQueue } from '@nestjs/bullmq';
import { Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { HealthIndicatorService, TerminusModule } from '@nestjs/terminus';
import type { Queue } from 'bullmq';

import {
  BOUNDARY_MANIFEST,
  ConfigModule,
  CryptoModule,
  EXTRA_HEALTH_INDICATORS,
  HealthController,
  JOB_SCHEDULER_REGISTRATIONS,
  jobSchedulerReadyIndicator,
  type JobSchedulerLookup,
  MetricsModule,
  MongoModule,
  PLATFORM_HEARTBEAT_ID,
  PLATFORM_HEARTBEAT_QUEUE,
  ProviderBoundaryGuardRunner,
  QueueModule,
  redisCacheProvider,
  redisQueueProvider,
  redisShutdownProvider,
  registerPlatformHeartbeat,
  shutdownOtel,
} from '@akane/platform';

import { SCHEDULER_BOUNDARY_MANIFEST } from './bootstrap/boundary-manifest.js';
import { RECONCILE_OUTBOUND_ID, registerReconciliation } from './reconciliation.registration.js';
import { AUDIT_RETENTION_ID, registerAuditRetention } from './audit-retention.registration.js';
import { PURGE_SWEEP_ID, registerPurgeSweep } from './purge-sweep.registration.js';
import {
  TRANSFER_AUTO_CANCEL_ID,
  registerTransferAutoCancel,
} from './transfer-auto-cancel.registration.js';

/** The readiness key this process contributes. Named so a dashboard can find it. */
const SCHEDULER_READINESS_KEY = 'job_schedulers';

/**
 * The `scheduler` composition root (FND-03, FND-05, FND-08, OBS-01).
 *
 * ## Registration happens here, on every replica, with no leader election
 *
 * `onApplicationBootstrap` calls `registerPlatformHeartbeat(queue)`, which is an
 * idempotent `upsertJobScheduler`. FND-08 asks that a task registered once runs on
 * **every** replica; the alternatives (a leader-election flag, "only the first
 * replica registers") all turn a rolling deploy into a window where nothing
 * schedules at all. `upsertJobScheduler` converges instead — Redis holds exactly
 * one scheduler under a stable id, the first call creates it and the rest update
 * it. So this method is safe to run concurrently on every boot of every replica.
 *
 * ## Why this process constructs no `Worker`
 *
 * It schedules; `apps/worker` consumes. A `Worker` here would park a blocking
 * Redis command in a process whose whole job is to register a timer. R1's
 * `no-restricted-imports` bans the `Worker` binding here at build time,
 * `SCHEDULER_BOUNDARY_MANIFEST` refuses `WORKER_CONSUMERS` at boot, and
 * `tooling/entrypoint-drift.spec.ts` fails CI if the `bullmq` `Worker` binding
 * enters this app's import closure.
 *
 * ## Why `CryptoModule` is here with no consumer of it
 *
 * Nothing here injects `CRYPTO_KEY_PROVIDER` yet (Phase 1 stores no secret), but
 * the module is what runs the FND-10 production guard: it is composed so that a
 * `NODE_ENV=production` process refuses to boot on a local key at all, rather
 * than at some later point when a consumer first asks for a provider. See the
 * same paragraph in `apps/api/src/app.module.ts`; it is identical in all three
 * roots on purpose.
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
    { provide: BOUNDARY_MANIFEST, useValue: SCHEDULER_BOUNDARY_MANIFEST },
    ProviderBoundaryGuardRunner,
    {
      provide: JOB_SCHEDULER_REGISTRATIONS,
      useValue: Object.freeze([
        PLATFORM_HEARTBEAT_ID,
        RECONCILE_OUTBOUND_ID,
        TRANSFER_AUTO_CANCEL_ID,
        AUDIT_RETENTION_ID,
        PURGE_SWEEP_ID,
      ]),
    },
    {
      provide: EXTRA_HEALTH_INDICATORS,
      inject: [HealthIndicatorService, getQueueToken(PLATFORM_HEARTBEAT_QUEUE)],
      useFactory: (health: HealthIndicatorService, queue: JobSchedulerLookup) => [
        // Wrapped, not thrown: `@nestjs/terminus` re-throws a rejected
        // indicator, which would answer 500 where an operator's probe expects
        // 503. `jobSchedulerReadyIndicator` already never rejects; this wrapper
        // keeps that guarantee true for the whole entry (01-07's rule, 01-08's
        // inheritance).
        async () => {
          const session = health.check(SCHEDULER_READINESS_KEY);
          const heartbeatRegistered = await jobSchedulerReadyIndicator(
            queue,
            PLATFORM_HEARTBEAT_ID,
          );
          const reconcileRegistered = await jobSchedulerReadyIndicator(
            queue,
            RECONCILE_OUTBOUND_ID,
          );
          const transferAutoCancelRegistered = await jobSchedulerReadyIndicator(
            queue,
            TRANSFER_AUTO_CANCEL_ID,
          );
          const auditRetentionRegistered = await jobSchedulerReadyIndicator(
            queue,
            AUDIT_RETENTION_ID,
          );
          const purgeSweepRegistered = await jobSchedulerReadyIndicator(
            queue,
            PURGE_SWEEP_ID,
          );
          const registered =
            heartbeatRegistered &&
            reconcileRegistered &&
            transferAutoCancelRegistered &&
            auditRetentionRegistered &&
            purgeSweepRegistered;
          return registered
            ? session.up({
                schedulers: [
                  PLATFORM_HEARTBEAT_ID,
                  RECONCILE_OUTBOUND_ID,
                  TRANSFER_AUTO_CANCEL_ID,
                  AUDIT_RETENTION_ID,
                  PURGE_SWEEP_ID,
                ],
              })
            : session.down({
                schedulers: [
                  PLATFORM_HEARTBEAT_ID,
                  RECONCILE_OUTBOUND_ID,
                  TRANSFER_AUTO_CANCEL_ID,
                  AUDIT_RETENTION_ID,
                  PURGE_SWEEP_ID,
                ],
              });
        },
      ],
    },
  ],
})
export class AppModule implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @InjectQueue(PLATFORM_HEARTBEAT_QUEUE) private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await registerPlatformHeartbeat(this.queue);
    await registerReconciliation(this.queue);
    await registerTransferAutoCancel(this.queue);
    await registerAuditRetention(this.queue);
    await registerPurgeSweep(this.queue);
  }

  async onApplicationShutdown(): Promise<void> {
    // T-1-24: flush the OTel SDK on SIGTERM. The queue itself is closed by
    // `@nestjs/bullmq`'s own shutdown hook, which Nest awaits before this runs.
    await shutdownOtel();
  }
}
