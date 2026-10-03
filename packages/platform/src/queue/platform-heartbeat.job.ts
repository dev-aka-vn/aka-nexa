import { registerBusinessMetrics } from '../metrics/business-metrics.js';
import type { JobSchedulerTarget, RegisteredJob } from './job-scheduler.js';
import { registerJobScheduler } from './job-scheduler.js';

/**
 * The platform heartbeat: the one scheduled job in Phase 1.
 *
 * It exists to prove the whole scheduled-execution path end to end — a Job
 * Scheduler registered idempotently, a worker consuming what it produces, and a
 * metric instrument moving on the OTel meter (OBS-01). A heartbeat that nothing
 * observes would prove only that a queue round-trips; incrementing a counter is
 * what makes "it ran" visible from outside the process.
 */

/**
 * Stable across every replica and every deploy.
 *
 * Changing it does not move the schedule, it creates a second one. Two
 * heartbeats means two schedulers, and the probe that reports
 * `getJobSchedulersCount() === 1` is what would catch it — which is why this is
 * a constant with a cross-module test rather than a literal at each use site.
 */
export const PLATFORM_HEARTBEAT_ID = 'platform-heartbeat';

/** One tick per minute: fast enough to notice a dead scheduler, slow enough to be free. */
export const PLATFORM_HEARTBEAT_EVERY_MS = 60_000;

/**
 * The heartbeat job body.
 *
 * Takes the job so it matches BullMQ's processor contract even though it uses
 * none of it. `add(1)` on a counter is idempotent in the sense that matters
 * here — two ticks produce two, and a duplicated scheduler produces twice the
 * rate, which is exactly the signal the counter is meant to carry.
 */
export async function processPlatformHeartbeat(): Promise<void> {
  registerBusinessMetrics().platformHeartbeat.add(1);
}

/**
 * Register the heartbeat on `queue`.
 *
 * Called by every replica at boot; converges on one scheduler (FND-08). Kept
 * separate from the processor so the scheduler process owns registration and
 * the worker process owns consumption — two processes, one schedule, no shared
 * state and no leader election.
 */
export async function registerPlatformHeartbeat(
  queue: JobSchedulerTarget,
): Promise<RegisteredJob> {
  return registerJobScheduler(
    queue,
    PLATFORM_HEARTBEAT_ID,
    { every: PLATFORM_HEARTBEAT_EVERY_MS },
    { name: PLATFORM_HEARTBEAT_ID },
  );
}

