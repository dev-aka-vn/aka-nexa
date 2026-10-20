import {
  JobSchedulerTarget,
  type RegisteredJob,
  registerJobScheduler,
  resumeJobScheduler,
} from '@akane/platform';

export const PURGE_SWEEP_ID = 'purge-sweep';
export const PURGE_SWEEP_INTERVAL_MS = 86_400_000; // daily

export async function registerPurgeSweep(
  queue: JobSchedulerTarget & { resume(): Promise<void> },
): Promise<RegisteredJob> {
  const result = await registerJobScheduler(
    queue,
    PURGE_SWEEP_ID,
    { every: PURGE_SWEEP_INTERVAL_MS },
    { name: PURGE_SWEEP_ID },
  );
  await resumeJobScheduler(queue);
  return result;
}
