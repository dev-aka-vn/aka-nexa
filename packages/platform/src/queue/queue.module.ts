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
    BullModule.registerQueue({ name: PLATFORM_HEARTBEAT_QUEUE }),
  ],
})
export class QueueModule {}