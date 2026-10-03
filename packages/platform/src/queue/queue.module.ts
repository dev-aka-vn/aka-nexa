import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { PLATFORM_HEARTBEAT_ID } from './platform-heartbeat.job.js';
import { queueRootOptions } from './queue.provider.js';

/**
 * The queue name the heartbeat is registered under.
 *
 * Re-exported from `PLATFORM_HEARTBEAT_ID` rather than restated: the scheduler
 * id *is* the queue name, and two literals for one string is how a queue ends
 * up with jobs scheduled onto it that nothing consumes.
 */
export const PLATFORM_HEARTBEAT_QUEUE = PLATFORM_HEARTBEAT_ID;

/**
 * The heartbeat queue as its own dynamic module, so `QueueModule` can both
 * import it and re-export it.
 *
 * ## Why this is a named `const` rather than an inline `BullModule.registerQueue(...)`
 *
 * Nest's `exports` array accepts a `DynamicModule`, and a `DynamicModule` is
 * matched by its computed token — which includes its `providers`. Nest does not
 * re-run the static call for you, so `exports: [BullModule]` re-exports the
 * *class*, not the queue providers, and `exports: [BullModule.registerQueue(…)]`
 * calls the factory a **second** time and produces a different token from the one
 * in `imports`. Either way `getQueueToken(PLATFORM_HEARTBEAT_QUEUE)` is not
 * visible to the importing module and the boot fails with
 *
 *     UnknownDependenciesException: … "BullQueue_platform-heartbeat" …
 *
 * Building it once and using the same object in both arrays is the only form
 * that works. Found by booting `apps/scheduler` against real Redis rather than
 * by reading this module — plan 10's first defect, and the reason the walking
 * skeleton is a boot test and not a composition test.
 */
const platformHeartbeatQueueModule = BullModule.registerQueue({
  name: PLATFORM_HEARTBEAT_QUEUE,
});

/**
 * The BullMQ wiring every entrypoint shares (FND-08, D-14).
 *
 * One `forRootAsync` establishes the `{akane-q}` prefix and the queue deployment
 * connection for every registered queue, so no composition root can register a
 * queue under a different namespace by forgetting an option — the prefix is not
 * a parameter any call site supplies, it is a constant in `queue.constants.ts`
 * reached through `queueRootOptions`.
 *
 * `REDIS_QUEUE_URL`, never `REDIS_CACHE_URL`: the cache deployment runs an
 * evicting `maxmemory-policy` and `maxmemory-policy` is instance-wide, so a
 * queue pointed at it loses jobs rather than rejecting writes (D-12/D-13).
 *
 * `ConfigModule` is not imported here because it is registered globally by each
 * composition root (`isGlobal: true`), and importing it again would re-run the
 * whole Zod boot validation a second time per process.
 *
 * This module registers queues only. Constructing a `Worker` is
 * `apps/worker`'s job alone and is blocked by R1's `no-restricted-imports` in
 * `api` and `scheduler`; the blocking connection profile that a worker needs is
 * exported as `blockingConnectionOptions` and is used at that call site.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        queueRootOptions(config.getOrThrow<string>('REDIS_QUEUE_URL')),
    }),
    platformHeartbeatQueueModule,
  ],
  /**
   * Re-exported so a composition root can `@InjectQueue(PLATFORM_HEARTBEAT_QUEUE)`.
   * `apps/scheduler` needs the `Queue` to register the Job Scheduler on, and it
   * must not have to re-declare `registerQueue` — two registrations of one queue
   * name would be two connection profiles against one deployment (D-14).
   */
  exports: [platformHeartbeatQueueModule],
})
export class QueueModule {}