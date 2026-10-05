import type { RepeatOptions } from 'bullmq';

/**
 * The narrow slice of a BullMQ queue that scheduling needs.
 *
 * Declared structurally so this module never imports `Queue` as a value — which
 * matters beyond tidiness: `packages/platform/src/queue/` is reachable from all
 * three entrypoints, and R1 forbids the request path from constructing a
 * `Worker`. Importing only the shape keeps the scheduler usable from `api` and
 * `scheduler` without a `Worker` ever entering their module graphs.
 */
/**
 * The identity a registered job carries back.
 *
 * Only the three fields every caller uses, and only the ones that are on
 * `Job` itself. A wider structural type would have to restate `Job`'s generics
 * to be assignable, and a structural type that restates a class's generics is
 * one signature edit away from silently rejecting the real `Queue`.
 */
export interface RegisteredJob {
  /**
   * Optional because BullMQ's `Job` declares them optional, and a narrower type
   * here would reject the real `Queue` — the structural seam has to match the
   * class, not an idealised version of it.
   */
  readonly id?: string;
  readonly name?: string;
}

export interface JobSchedulerTarget<DataType = unknown> {
  upsertJobScheduler(
    jobSchedulerId: string,
    repeatOpts: Omit<RepeatOptions, 'key'>,
    jobTemplate?: {
      name?: string;
      data?: DataType;
      opts?: Record<string, unknown>;
    },
  ): Promise<RegisteredJob>;
}

/**
 * Register a Job Scheduler idempotently (FND-08).
 *
 * ## `upsert` *is* the answer to FND-08
 *
 * The requirement is that a task registered once runs on **every** replica. The
 * naive designs are all wrong in ways that only show up under real
 * concurrency: a leader-election flag needs a lock the scheduler itself can
 * deadlock on; "only the first replica registers" turns a rolling deploy into
 * a window where nothing schedules the task at all.
 *
 * `upsertJobScheduler` converges instead. Every replica calls this once at boot
 * with the same id and the same repeat options, and Redis holds exactly one
 * Job Scheduler under that id — the first call creates it, the rest update it.
 * The registration is therefore safe to run on every replica, on every boot,
 * concurrently, with no coordination at all.
 *
 * ## The API that was removed
 *
 * BullMQ 6 deleted `Queue.add(name, data, { repeat })`, `getRepeatableJobs()`
 * and `getRepeatableJobsCount()`; `job-options.d.ts` says verbatim, *"use
 * `Queue.upsertJobScheduler` to schedule repeating jobs."* A repeatable job
 * created through the removed API is invisible to `getJobScheduler`, so a
 * readiness probe would report the queue as having no scheduler while jobs
 * were still firing — the worst kind of wrong. `queue.integration.spec.ts`
 * asserts the removed API is absent and that this function reaches
 * `upsertJobScheduler`.
 *
 * @param jobSchedulerId stable across every replica and every deploy. Changing
 *   it does not move the schedule — it creates a *second* scheduler, which is
 *   why it is a named constant and not a per-pod string.
 * @param repeatOpts the repeat options, e.g. `{ every: 60000 }`.
 * @param jobTemplate the job every produced job is created from. Carries no
 *   per-replica data: the scheduler is shared, so a `data` value baked in from
 *   the replica that happened to win the race would be the wrong value for
 *   every other execution.
 */
export async function registerJobScheduler<DataType = unknown>(
  queue: JobSchedulerTarget<DataType>,
  jobSchedulerId: string,
  repeatOpts: Omit<RepeatOptions, 'key'>,
  jobTemplate?: {
    name?: string;
    data?: DataType;
    opts?: Record<string, unknown>;
  },
): Promise<RegisteredJob> {
  const job = await queue.upsertJobScheduler(jobSchedulerId, repeatOpts, jobTemplate);

  return { id: job.id, name: job.name };
}

/**
 * The scheduler id a Job Scheduler is stored under, read back from Redis.
 *
 * Exposed because "did my registration survive?" and "is the heartbeat
 * registered?" are the same question asked at boot and by a readiness probe
 * respectively, and answering them with two different lookups is how the two
 * disagree.
 */
export type JobSchedulerProbe = { getJobScheduler(id: string): Promise<unknown> };

/**
 * Restore the scheduler `registerJobScheduler` created.
 *
 * `upsertJobScheduler` leaves a paused scheduler paused across a `pause()`, so
 * "registered" is not the same as "running". This un-pauses it. **`resume()` is
 * async in BullMQ 6** and must be awaited — calling it without `await` leaves
 * the scheduler paused and returns a promise whose rejection nothing observes,
 * which is a silently-dead scheduler rather than a loud one.
 *
 * Not called by `registerJobScheduler` itself: a boot-time registration should
 * not override an operator's deliberate `pause()`, and a readiness probe must
 * never mutate the queue it is probing.
 */
export async function resumeJobScheduler(
  queue: { resume(): Promise<void> },
): Promise<void> {
  await queue.resume();
}