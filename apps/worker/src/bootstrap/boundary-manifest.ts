import {
  INBOUND_ADAPTER_REGISTRATIONS,
  JOB_SCHEDULER_REGISTRATIONS,
  type BoundaryManifest,
} from '@akane/platform';

/**
 * What `worker` must never resolve (D-03, T-1-23).
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
 * **`INBOUND_ADAPTER_REGISTRATIONS`** — the webhook receiver's home. IM-02/IM-03
 * make the receiver a pure ingest contract that acknowledges in under 200 ms and
 * does nothing else. Mounting one in `worker` would mean either the worker answers
 * webhooks (so its blocking Redis connection sits in the ack path — the 200 ms
 * budget is gone) or the receiver stays on `api` while its "ownership" claim sits
 * somewhere nobody looks. The token resolves to nothing in Phase 1, and it is
 * declared now so the manifest is already correct when Phase 2 wires the first
 * receiver.
 *
 * **`JOB_SCHEDULER_REGISTRATIONS`** — `worker` consumes; `scheduler` schedules.
 * Registering a Job Scheduler here is harmless in isolation (`upsertJobScheduler`
 * converges), which is exactly why it needs a boot-time refusal: "harmless but
 * wrong" is the failure that survives code review.
 *
 * ## What is deliberately absent
 *
 * **`QUEUE_PRODUCER_TOKEN` is NOT forbidden here.** `worker` imports `QueueModule`,
 * so the heartbeat queue resolves in this process on purpose — that is how the
 * consumer's queue name is kept from drifting away from a registered producer
 * (D-14). Forbidding it would forbid the consistency check itself.
 */
export const WORKER_BOUNDARY_MANIFEST: BoundaryManifest = Object.freeze({
  app: 'worker',
  forbidden: Object.freeze([
    INBOUND_ADAPTER_REGISTRATIONS,
    JOB_SCHEDULER_REGISTRATIONS,
  ]),
});
