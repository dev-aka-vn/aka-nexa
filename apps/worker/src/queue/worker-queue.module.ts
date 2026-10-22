import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { IM_OUTBOUND_QUEUE } from '@akane/platform';

/**
 * The `worker` process's own queue registration for the outbound delivery
 * seam (OUT-01).
 *
 * ## Why the worker needs a producer registration at all
 *
 * `InboundEventProcessor` both consumes `INBOUND_EVENTS_QUEUE` and produces
 * onto `IM_OUTBOUND_QUEUE`. Its `@Processor` decorator registers the inbound
 * side, but Nest does not infer the outbound side from a sibling processor in
 * another module — and an unregistered `@InjectQueue(IM_OUTBOUND_QUEUE)`
 * fails boot with `UnknownDependenciesException`, after the routing has
 * already happened, so the reply is lost.
 *
 * `packages/platform`'s `QueueModule` deliberately registers only the
 * heartbeat queue, and registering this one there would park a queue in
 * `api` and `scheduler` too — the exact thing `ApiQueueModule`'s docs explain
 * it refuses to do. So the registration is local to the process that uses it.
 *
 * ## Why this is a named `const`
 *
 * Same rule as `ApiQueueModule` and `packages/platform/src/queue/queue.module.ts`:
 * `exports: [BullModule.registerQueue(…)]` calls the factory a second time and
 * produces a different token from the one in `imports`, so
 * `getQueueToken(IM_OUTBOUND_QUEUE)` is not visible to the importing module.
 * Built once, used in both arrays.
 */
const imOutboundQueue = BullModule.registerQueue({ name: IM_OUTBOUND_QUEUE });

@Module({
  imports: [imOutboundQueue],
  exports: [imOutboundQueue],
})
export class WorkerQueueModule {}
