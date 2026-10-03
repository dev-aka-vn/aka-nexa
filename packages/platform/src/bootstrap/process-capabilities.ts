import { getQueueToken } from '@nestjs/bullmq';

import { PLATFORM_HEARTBEAT_QUEUE } from '../queue/queue.module.js';

/**
 * Process-scoped capability tokens (D-03, T-1-23, FND-03).
 *
 * ## What this file is for
 *
 * D-03's boot assertion needs each composition root to name the providers that
 * must **never** resolve in its process. The lint rule (`boundaries/dependencies`
 * + `no-restricted-imports`) already refuses the imports; the manifest refuses the
 * *registration*. But a provider token can only be named in a manifest if it
 * exists somewhere both processes can reach — and in Phase 1 the three genuinely
 * process-specific surfaces (`Worker` consumption, Job Scheduler registration,
 * inbound-adapter mounting) live behind app-local or not-yet-written modules, so
 * without this vocabulary the manifests would have nothing expressible to forbid
 * and `api`'s would be the only non-empty one.
 *
 * A guard whose forbidden list is empty is the failure mode D-03 warns about by
 * name: it looks like enforcement and enforces nothing. So each capability is a
 * **platform-owned symbol** that exactly one process provides and the other two
 * forbid. The value each one holds is real data — a consumer list, a registration
 * record — not a marker that exists only so the manifest has something to name.
 *
 * ## Why symbols, and why a dedicated vocabulary rather than class names
 *
 * A symbol cannot collide with a provider class, and it is reachable from
 * `@akane/platform` by every composition root — which a class defined in
 * `apps/worker/src` is not, and must not be (`apps/api` importing
 * `apps/worker/src/...` is a boundary violation that lint already rejects, so a
 * manifest that named the app-local class could never be written).
 *
 * ## The one non-symbol token, and why
 *
 * `QUEUE_PRODUCER_TOKEN` is BullMQ's own queue token, obtained from
 * `@nestjs/bullmq`'s factory rather than restated as a string. `api` forbids it,
 * which is a check with teeth: importing `QueueModule` into `api` — a single
 * line, and one a developer might well copy from `scheduler` — puts a live
 * BullMQ `Queue` (a Redis connection plus its Lua scripts) inside the request
 * path, and the <200 ms webhook-ack budget (D-13, STACK §13.1) dies silently.
 * Static lint cannot see it: the import is legal, only the *process* is wrong.
 */

/**
 * The registered BullMQ `Queue` for the platform heartbeat, as a DI token.
 *
 * `getQueueToken` is called rather than the token string written out, so the
 * manifest stays correct if `@nestjs/bullmq` changes its token shape — the same
 * reason every other place in the repo that names a queue uses this factory.
 */
export const QUEUE_PRODUCER_TOKEN = getQueueToken(PLATFORM_HEARTBEAT_QUEUE);

/**
 * BullMQ consumers registered by **this** process.
 *
 * Holds `readonly WorkerRunningStatus[]`. Provided by `apps/worker` alone;
 * forbidden by `api` and `scheduler`. A `Worker` parks a blocking Redis command
 * on `BRPOPLPUSH`, so one appearing in the request path spends the ack budget on
 * nothing (D-03, R1).
 */
export const WORKER_CONSUMERS = Symbol('WORKER_CONSUMERS');

/**
 * Job Schedulers registered by **this** process.
 *
 * Holds `readonly string[]` of scheduler ids. Provided by `apps/scheduler` alone;
 * forbidden by `api` and `worker`. Scheduling is idempotent (`upsertJobScheduler`),
 * so a scheduler in the wrong process would not corrupt state — it would make
 * "which process schedules" answerable only by reading Redis, which is the
 * convergence D-09's three-process model exists to prevent.
 */
export const JOB_SCHEDULER_REGISTRATIONS = Symbol('JOB_SCHEDULER_REGISTRATIONS');

/**
 * Inbound IM adapters mounted by **this** process.
 *
 * Holds `readonly string[]` of adapter names. Provided by `api` alone once Phase
 * 2 lands (IM-02/IM-03 put the receiver there); forbidden by `worker` and
 * `scheduler`. It resolves to nothing in Phase 1 — the adapters do not exist yet
 * — and that is the point of declaring it here rather than in Phase 2: the
 * manifest is the artifact that has to already be right when the first receiver
 * is wired, and a token introduced alongside the thing it guards guards nothing.
 */
export const INBOUND_ADAPTER_REGISTRATIONS = Symbol('INBOUND_ADAPTER_REGISTRATIONS');
