/**
 * ACL-05 — the transfer auto-cancel worker.
 *
 * The consumer of the hourly Job Scheduler the
 * `scheduler` process registers: the durable,
 * idempotent 7-day auto-cancel of pending
 * ownership-transfer requests.
 *
 * ## The option contract (FND-08, D-14, T-1-19)
 *
 * The worker listens on the **same prefix the
 * producer queue is registered under** (`BULLMQ_PREFIX`
 * — the regression the platform-heartbeat spec
 * exists for: a prefix-less worker parks on
 * BullMQ's default namespace and consumes
 * nothing while readiness reports "up"), with
 * the **blocking connection profile** (a finite
 * `maxRetriesPerRequest` makes BullMQ fail the
 * connection rather than wait out a long block).
 *
 * ## The consumer contract
 *
 * `processTransferAutoCancel` is the job's whole
 * body: one call to `TransferRequestService.
 * autoCancelExpired` — the same method the
 * integration spec drives over real Mongo, so the
 * worker cannot drift into a second
 * implementation of the expiry rule.
 */

import { describe, expect, it } from 'vitest';

import {
  blockingConnectionOptions,
  BULLMQ_PREFIX,
  producerConnectionOptions,
  queueRootOptions,
} from '@akane/platform';

import type { TransferRequestService } from '@akane/domain';

import {
  TRANSFER_AUTO_CANCEL_ID,
  processTransferAutoCancel,
  transferAutoCancelWorkerOptions,
  TransferAutoCancelProcessor,
} from './transfer-auto-cancel.processor.js';

const QUEUE_URL = 'redis://queue.internal:6379';

describe('transferAutoCancelWorkerOptions — the one Worker (FND-08, D-14)', () => {
  it('listens on the same prefix the producer queue is registered under', () => {
    const options = transferAutoCancelWorkerOptions(QUEUE_URL);
    expect(options.prefix).toBe(BULLMQ_PREFIX);
    expect(options.prefix).toBe(queueRootOptions(QUEUE_URL).prefix);
    expect(options.prefix).toBe('{akane-q}');
  });

  it('uses the blocking connection profile, and never the producer one (T-1-19)', () => {
    const options = transferAutoCancelWorkerOptions(QUEUE_URL);
    expect(options.connection).toEqual(blockingConnectionOptions(QUEUE_URL));
    expect(options.connection.maxRetriesPerRequest).toBeNull();
    expect(options.connection.maxRetriesPerRequest).not.toBe(
      producerConnectionOptions(QUEUE_URL).maxRetriesPerRequest,
    );
  });

  it('carries the queue URL through untouched, including credentials and TLS', () => {
    const url = 'rediss://user:pass@queue.internal:6380/3';
    expect(transferAutoCancelWorkerOptions(url).connection.url).toBe(url);
  });

  it('is registered under the hourly scheduler id', () => {
    // The id the scheduler's Job Scheduler registration
    // names — the producer and the consumer must agree
    // on it or the job schedules but nothing consumes.
    expect(TRANSFER_AUTO_CANCEL_ID).toBe('transfer-auto-cancel');
  });
});

describe('processTransferAutoCancel — the job body (ACL-05)', () => {
  it('calls the service-level auto-cancel — the same method the integration spec drives', async () => {
    const calls: Array<{ now: Date }> = [];
    const service = {
      autoCancelExpired: async (now: Date) => {
        calls.push({ now });
        return [];
      },
    } as unknown as TransferRequestService;

    await processTransferAutoCancel(service);

    expect(calls).toHaveLength(1);
    // The job runs with the clock it was invoked
    // under — the expiry comparison's "now".
    expect(calls[0].now).toBeInstanceOf(Date);
  });

  it('propagates the service refusal — the job fails, it does not swallow', async () => {
    const service = {
      autoCancelExpired: async () => {
        throw new Error('mongo unreachable');
      },
    } as unknown as TransferRequestService;

    await expect(processTransferAutoCancel(service)).rejects.toThrow(
      'mongo unreachable',
    );
  });
});

describe('TransferAutoCancelProcessor.isRunning — the readiness slice (D-10)', () => {
  it('reports false before bootstrap — never vacuously true', () => {
    const processor = new TransferAutoCancelProcessor(
      { getOrThrow: () => QUEUE_URL } as never,
      {} as TransferRequestService,
    );
    expect(processor.isRunning()).toBe(false);
  });
});
