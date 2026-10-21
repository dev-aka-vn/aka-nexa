import { metrics, type ObservableGauge } from '@opentelemetry/api';

import { METER_NAME, QUEUE_OLDEST_ITEM_AGE_METRIC } from './business-metrics.js';

export const QUEUE_DEPTH_METRIC = 'queue.depth';

export interface QueueLike {
  getJobCounts?: () =>
    | Promise<Record<string, number> | number>
    | Record<string, number>
    | number;
  getJobs?: (state: string, start: number, end: number) => Promise<Array<{ timestamp?: number }>>;
  getWaiting?: (start?: number, end?: number) => Promise<Array<{ timestamp?: number }>>;
  getWaitingJobs?: () => Promise<Array<{ timestamp?: number }>>;
}

let cachedDepth: ObservableGauge | undefined;
let cachedAge: ObservableGauge | undefined;

function resolve(source: QueueLike | (() => QueueLike | null | undefined)): QueueLike | null {
  const value = typeof source === 'function' ? source() : source;
  return value ?? null;
}

async function readCounts(q: QueueLike): Promise<number> {
  if (!q.getJobCounts) return 0;
  const raw = await q.getJobCounts();
  if (typeof raw === 'number') return raw;
  if (raw && typeof raw === 'object') {
    return Object.values(raw).reduce((sum, n) => sum + (typeof n === 'number' ? n : 0), 0);
  }
  return 0;
}

async function readOldestTimestamp(q: QueueLike): Promise<number | undefined> {
  if (q.getJobs) {
    const jobs = await q.getJobs('waiting', 0, 0);
    return jobs?.[0]?.timestamp;
  }
  if (q.getWaiting) {
    const jobs = await q.getWaiting(0, 0);
    return jobs?.[0]?.timestamp;
  }
  if (q.getWaitingJobs) {
    const jobs = await q.getWaitingJobs();
    return jobs?.[0]?.timestamp;
  }
  return undefined;
}

export function registerQueueMetrics(
  source: QueueLike | (() => QueueLike | null | undefined),
): { depth: ObservableGauge; oldestAge: ObservableGauge } {
  if (!cachedDepth) {
    const meter = metrics.getMeter(METER_NAME);
    cachedDepth = meter.createObservableGauge(QUEUE_DEPTH_METRIC, {
      description: 'Current queue depth from BullMQ job counts.',
    });
    cachedAge = meter.createObservableGauge(QUEUE_OLDEST_ITEM_AGE_METRIC, {
      description: 'Age in seconds of the oldest waiting job.',
    });

    cachedDepth.addCallback(async (result) => {
      const q = resolve(source);
      if (!q) return;
      const depth = await readCounts(q);
      result.observe(depth, { queue: 'default' });
    });
    cachedAge.addCallback(async (result) => {
      const q = resolve(source);
      if (!q) return;
      const ts = await readOldestTimestamp(q);
      const age = ts === undefined ? 0 : Math.max(0, (Date.now() - ts) / 1000);
      result.observe(age, { queue: 'default' });
    });
  }
  return { depth: cachedDepth, oldestAge: cachedAge! };
}