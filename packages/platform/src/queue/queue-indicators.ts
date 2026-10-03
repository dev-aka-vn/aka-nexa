/**
 * Per-process readiness additions for `worker` and `scheduler` (D-10).
 *
 * These are the two checks that only one process can answer. The core three
 * indicators that every process runs — Mongo, cache Redis, queue Redis — are
 * frozen and shared; neither of these can be shared, because only the worker
 * knows which consumers it registered and only the scheduler knows which Job
 * Schedulers exist.
 *
 * Both return a plain `boolean` and **never reject**. That is not a style
 * choice: `@nestjs/terminus`'s executor re-throws anything an indicator
 * rejects, turning it into a 500 rather than a 503. A Redis blip would then
 * report "this endpoint is broken" instead of "these dependencies are not
 * ready", and the per-dependency detail the rest of the health surface works to
 * provide would be replaced by an uninformative failure. 01-07 hit exactly this
 * with the core indicators; these two inherit the lesson.
 */

/**
 * The slice of a BullMQ `Worker` that readiness needs.
 *
 * Structural, so the indicator is testable with a one-method stub and so this
 * module never imports `Worker` as a value — R1 keeps `Worker` construction
 * out of `api` and `scheduler`, and a value import here would put the class in
 * the module graph of every process that imports the barrel.
 */
export interface WorkerRunningStatus {
  isRunning(): boolean;
}

/** The slice of a BullMQ `Queue` that the scheduler check needs. */
export interface JobSchedulerLookup {
  getJobScheduler(id: string): Promise<unknown>;
}

/**
 * True only when **every** registered worker is listening.
 *
 * The empty case resolves `false`, and that is the load-bearing half of the
 * contract. The mathematical reading of "every worker in the list is running" is
 * vacuously true for an empty list, so a worker process that registered no
 * consumers at all — a broken DI graph, a queue name typo, a processor that
 * failed to construct — would report itself ready while consuming nothing. That
 * is precisely the failure D-10's worker check exists to catch, and it is
 * invisible on a dashboard until work starts piling up.
 */
export async function workerListeningIndicator(
  workers: readonly WorkerRunningStatus[],
): Promise<boolean> {
  if (workers.length === 0) {
    return false;
  }

  for (const worker of workers) {
    let running: boolean;
    try {
      running = worker.isRunning();
    } catch {
      // A worker that cannot report its state is not listening. `isRunning()`
      // touches the connection, so a closed or half-open client throws rather
      // than answering.
      return false;
    }
    if (!running) {
      return false;
    }
  }
  return true;
}

/**
 * How long the scheduler probe will wait before declaring "not ready".
 *
 * Same reasoning as `MongoService`'s 3 s bound (01-07, deviation 9):
 * `maxRetriesPerRequest` bounds *queued commands*, not connection establishment.
 * ioredis's default `retryStrategy` keeps retrying with backoff, and BullMQ's
 * `RedisConnection.init()` awaits a `ready` event that never arrives — so an
 * unreachable queue Redis leaves `getJobScheduler()` pending indefinitely rather
 * than rejecting. The orchestrator's own probe timeout would expire first and
 * report the pod *unresponsive* instead of *not ready*, discarding exactly the
 * per-dependency detail D-10 exists to provide.
 *
 * Without this bound the `catch` below is unreachable in the one case it was
 * written for, which is the definition of an untested error path.
 */
export const SCHEDULER_PROBE_TIMEOUT_MS = 3_000;

/**
 * True only when `Queue.getJobScheduler(id)` returns a scheduler (D-10).
 *
 * Reading the scheduler **back out of Redis** rather than caching "I registered
 * it" is the point. A cached flag says the registration call succeeded at some
 * point in this process's life; it says nothing about whether Redis still holds
 * the scheduler, whether a later deploy's repeat options changed, or whether a
 * replica wiped the key. The probe and the registration agree only when both
 * talk to the same Redis.
 *
 * Resolves `false` on rejection, and on exceeding `timeoutMs` — a readiness
 * probe that hangs is a strictly worse answer than one that says "not ready",
 * because the orchestrator cannot distinguish the two.
 */
export async function jobSchedulerReadyIndicator(
  queue: JobSchedulerLookup,
  id: string,
  timeoutMs: number = SCHEDULER_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
    // Never hold the event loop open for a probe: in a shutting-down process an
    // armed three-second timer is three seconds of refused shutdown.
    timer.unref?.();
  });

  try {
    return (await Promise.race([queue.getJobScheduler(id), expiry])) !== undefined;
  } catch {
    return false;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}