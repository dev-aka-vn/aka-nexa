import {
  INBOUND_ADAPTER_REGISTRATIONS,
  WORKER_CONSUMERS,
  type BoundaryManifest,
} from '@akane/platform';

/**
 * What `scheduler` must never resolve (D-03, T-1-23).
 *
 * ## Data only — no Nest internals
 *
 * `ProviderBoundaryGuard` (plan 03) is the only file in the repository allowed to
 * reach into `app.container`; the cast it needs moves with a Nest minor bump and
 * must be a one-file fix. So this file holds a value, not logic, and importing it
 * pulls in no Nest surface beyond the `InjectionToken` type.
 *
 * ## The two forbidden capabilities
 *
 * **`WORKER_CONSUMERS`** — `scheduler` registers timers and must consume nothing.
 * A `Worker` parks a blocking Redis command (`BRPOPLPUSH`) in a process whose whole
 * job is to call `upsertJobScheduler` once at boot and then answer probes. It would
 * not be *wrong*, exactly: it would consume the heartbeat the worker is supposed to
 * consume, split the counter 01-08 measures in half, and make "who runs the job"
 * depend on which replicas happen to be up. R1's `no-restricted-imports` already
 * blocks the `Worker` import in this directory; this refuses the registration.
 *
 * **`INBOUND_ADAPTER_REGISTRATIONS`** — same reasoning as in `worker`: the webhook
 * receiver belongs to `api`, so that the <200 ms acknowledgement is answered by a
 * process with no consumer parked in its event loop.
 *
 * ## What is deliberately absent
 *
 * **`QUEUE_PRODUCER_TOKEN` is NOT forbidden here.** `scheduler` injects the
 * heartbeat `Queue` to register the Job Scheduler against it — that is FND-08's
 * requirement, and forbidding the token would forbid the requirement.
 */
export const SCHEDULER_BOUNDARY_MANIFEST: BoundaryManifest = Object.freeze({
  app: 'scheduler',
  forbidden: Object.freeze([WORKER_CONSUMERS, INBOUND_ADAPTER_REGISTRATIONS]),
});
