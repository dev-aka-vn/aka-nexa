import {
  JobSchedulerTarget,
  type RegisteredJob,
  registerJobScheduler,
  resumeJobScheduler,
} from '@akane/platform';

export const ACCESS_REVIEW_ID = 'access-review';
export const ACCESS_REVIEW_INTERVAL_MS = 90 * 86_400_000; // quarterly

export async function registerAccessReview(
  queue: JobSchedulerTarget & { resume(): Promise<void> },
): Promise<RegisteredJob> {
  const result = await registerJobScheduler(
    queue,
    ACCESS_REVIEW_ID,
    { every: ACCESS_REVIEW_INTERVAL_MS },
    { name: ACCESS_REVIEW_ID },
  );
  await resumeJobScheduler(queue);
  return result;
}
