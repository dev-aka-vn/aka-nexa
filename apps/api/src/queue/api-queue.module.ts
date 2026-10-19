import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import {
  INBOUND_EVENTS_QUEUE,
  NOTIFICATION_SEND_QUEUE,
  queueRootOptions,
} from '@akane/platform';

/**
 * The `api` process's **producer-only** BullMQ registration (D-37, IM-10).
 *
 * ## Why this module exists at all
 *
 * `api` is the request path, and `API_BOUNDARY_MANIFEST` deliberately forbids
 * `QUEUE_PRODUCER_TOKEN` (the heartbeat queue's producer token) so that a single
 * `imports: [QueueModule]` line copied from `scheduler` cannot quietly park a
 * Redis connection — and a queue nobody consumes — inside the process whose
 * <200 ms ack budget (D-13) is the one thing it must protect.
 *
 * But the receivers *do* enqueue: the Teams receiver enqueues one `InboundEvent`
 * per activity onto `INBOUND_EVENTS_QUEUE`, and the external-webhook receiver
 * enqueues one notification onto `NOTIFICATION_SEND_QUEUE`. Before D-37 those two
 * enqueues had no queue to land on — api had no `Queue` provider at all — and
 * `TeamsController` was enqueuing to a *dead* queue name (`'im:inbound'`).
 *
 * D-37 resolves the tension by name: the two inbound/notification producer
 * queues are registered here and listed on the manifest's `allowed` exception
 * list, while the heartbeat producer token stays forbidden. A producer is
 * admitted by name, reviewed, and boot-enforced — never by loosening the
 * forbidden list.
 *
 * ## Why the two `registerQueue` modules are named `const`s
 *
 * Nest matches a `DynamicModule` in `exports` by its computed token, which
 * includes its providers. `exports: [BullModule.registerQueue(…)]` calls the
 * factory a **second** time and produces a token different from the one in
 * `imports`, so `getQueueToken(INBOUND_EVENTS_QUEUE)` is not visible to the
 * importing module and boot fails with `UnknownDependenciesException`. Building
 * each module once and using the same object in both arrays is the only form
 * that works — the same rule `packages/platform/src/queue/queue.module.ts`
 * documents for the heartbeat queue.
 *
 * ## Why the root options are not optional
 *
 * Without `forRootAsync` the registered queues would default to `localhost:6379`
 * and drop the `{akane-q}` prefix (`queueRootOptions`), which is the §4.4 / D-14
 * namespace the worker's consumer expects. The root is therefore established
 * here, once, from the validated `REDIS_QUEUE_URL` — never `REDIS_CACHE_URL`,
 * whose instance-wide `maxmemory-policy` would evict queued jobs (D-12/D-13).
 *
 * ## Why `ConfigModule` is not imported here
 *
 * It is `@Global()` and registered by every composition root, so importing it
 * again would re-run the whole Zod boot validation a second time per process.
 */
const inboundEventsQueue = BullModule.registerQueue({ name: INBOUND_EVENTS_QUEUE });
const notificationSendQueue = BullModule.registerQueue({ name: NOTIFICATION_SEND_QUEUE });

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        queueRootOptions(config.getOrThrow<string>('REDIS_QUEUE_URL')),
    }),
    inboundEventsQueue,
    notificationSendQueue,
  ],
  exports: [inboundEventsQueue, notificationSendQueue],
})
export class ApiQueueModule {}
