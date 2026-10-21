import {
  JobSchedulerTarget,
  type RegisteredJob,
  registerJobScheduler,
  resumeJobScheduler,
} from '@akane/platform';

export const AUDIT_RETENTION_ID = 'audit-retention';
export const AUDIT_RETENTION_INTERVAL_MS = 86_400_000; // daily

export async function registerAuditRetention(
  queue: JobSchedulerTarget & { resume(): Promise<void> },
): Promise<RegisteredJob> {
  const result = await registerJobScheduler(
    queue,
    AUDIT_RETENTION_ID,
    { every: AUDIT_RETENTION_INTERVAL_MS },
    { name: AUDIT_RETENTION_ID },
  );
  await resumeJobScheduler(queue);
  return result;
}
