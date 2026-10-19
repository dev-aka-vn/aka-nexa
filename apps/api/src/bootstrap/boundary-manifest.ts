import { getQueueToken } from '@nestjs/bullmq';

import {
  INBOUND_EVENTS_QUEUE,
  INBOUND_ADAPTER_REGISTRATIONS,
  JOB_SCHEDULER_REGISTRATIONS,
  NOTIFICATION_SEND_QUEUE,
  QUEUE_PRODUCER_TOKEN,
  WORKER_CONSUMERS,
  type BoundaryManifest,
} from '@akane/platform';

/**
 * What `api` must never resolve (D-03, T-1-23).
 *
 * ## Data only — no Nest internals
 *
 * `ProviderBoundaryGuard` (plan 03) is the only file in the repository allowed to
 * reach into `app.container`; the cast it needs moves with a Nest minor bump and
 * must be a one-file fix. So this file holds a value, not logic, and importing it
 * pulls in no Nest surface beyond the `InjectionToken` type. A manifest that
 * reached for `ModuleRef` itself would put the version coupling back into every
 * composition root, which is the exact failure the split exists to prevent.
 *
 * ## The two forbidden capabilities
 *
 * **`QUEUE_PRODUCER_TOKEN`** — the one that is *currently violable*. A single
 * `imports: [QueueModule]` line, copied from `scheduler`, puts a live BullMQ
 * `Queue` in the request path: a Redis connection, its Lua scripts, and a
 * producer that has no reason to exist on a process that never enqueues. Lint
 * cannot see it because the import is legal; only the process assignment is
 * wrong. That is the "boundary violation → boot crash" the D-03 boot assertion
 * exists for, and 01-08's hand-off is explicit that a `Worker` in `api` "can be
 * imported and the 200 ms ack budget dies silently".
 *
 * **`WORKER_CONSUMERS`** and **`JOB_SCHEDULER_REGISTRATIONS`** — the other two
 * processes' capability records. `api` may never hold either: it neither consumes
 * nor schedules, and a composition root that starts doing so has stopped being
 * the request path (FND-03).
 *
 * ## What is deliberately absent
 *
 * No HTTP-controller token, because the health and metrics controllers are the
 * *shared* surface all three processes mount (D-09) — forbidding them here would
 * forbid the very endpoint FND-05 requires. And no inbound-adapter token here:
 * `api` is the one process allowed to have it.
 */
export const API_BOUNDARY_MANIFEST: BoundaryManifest = Object.freeze({
  app: 'api',
  forbidden: Object.freeze([
    QUEUE_PRODUCER_TOKEN,
    WORKER_CONSUMERS,
    JOB_SCHEDULER_REGISTRATIONS,
  ]),
  // D-37: the api process is the request path and must never hold the heartbeat
  // producer token, a worker, or a scheduler. It DOES legitimately enqueue onto
  // the two inbound/notification queues (IM-10, NOT-04) and it IS the inbound
  // adapter surface, so those three tokens are named exceptions here rather than
  // silent edits to `forbidden`. The heartbeat producer token stays forbidden.
  allowed: Object.freeze([
    getQueueToken(INBOUND_EVENTS_QUEUE),
    getQueueToken(NOTIFICATION_SEND_QUEUE),
    INBOUND_ADAPTER_REGISTRATIONS,
  ]),
});
