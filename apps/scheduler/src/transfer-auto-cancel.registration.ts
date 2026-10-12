import {
  JobSchedulerTarget,
  type RegisteredJob,
  registerJobScheduler,
  resumeJobScheduler,
} from '@akane/platform';

/**
 * The hourly transfer auto-cancel Job
 * Scheduler (ACL-05, T-06-31).
 *
 * Registration is the producer's half of
 * the contract: the id the scheduler names
 * here is the id the `worker` process's
 * `TransferAutoCancelProcessor` listens
 * under — the producer and the consumer
 * must agree on it or the job schedules
 * but nothing consumes it.
 */
export const TRANSFER_AUTO_CANCEL_ID = 'transfer-auto-cancel';
export const TRANSFER_AUTO_CANCEL_INTERVAL_MS = 3_600_000; // 1 hour

export async function registerTransferAutoCancel(
  queue: JobSchedulerTarget & { resume(): Promise<void> },
): Promise<RegisteredJob> {
  const result = await registerJobScheduler(
    queue,
    TRANSFER_AUTO_CANCEL_ID,
    { every: TRANSFER_AUTO_CANCEL_INTERVAL_MS },
    { name: TRANSFER_AUTO_CANCEL_ID },
  );
  await resumeJobScheduler(queue);
  return result;
}
