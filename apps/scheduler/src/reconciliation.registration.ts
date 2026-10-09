import {
  JobSchedulerTarget,
  type RegisteredJob,
  registerJobScheduler,
  resumeJobScheduler,
} from '@akane/platform';

export const RECONCILE_OUTBOUND_ID = 'reconcile-outbound';
export const RECONCILE_INTERVAL_MS = 300_000; // 5 minutes

export async function registerReconciliation(
  queue: JobSchedulerTarget,
): Promise<RegisteredJob> {
  const result = await registerJobScheduler(
    queue,
    RECONCILE_OUTBOUND_ID,
    { every: RECONCILE_INTERVAL_MS },
    { name: RECONCILE_OUTBOUND_ID },
  );
  await resumeJobScheduler(queue as any);
  return result;
}