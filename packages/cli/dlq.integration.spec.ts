import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue } from 'bullmq';

import {
  MONGO_IMAGE,
  mongoUrl,
  REDIS_IMAGE,
  QUEUE_MAXMEMORY_POLICY,
} from '../../tooling/containers.js';
import { producerConnectionOptions, BULLMQ_PREFIX, IM_OUTBOUND_QUEUE } from '@akane/platform';
import { MongoService } from '@akane/platform';
import { SubmissionRevisionsRepository } from '@akane/domain';
import { dlqList, dlqRetry, INSPECTABLE_QUEUES } from './dlq.js';

const DELIVERY_QUEUE_NAME = 'connector-delivery';
const OUTBOUND_QUEUE_NAME = IM_OUTBOUND_QUEUE;

describe('dlq CLI', () => {
  let mongo: StartedMongoDBContainer;
  let queueContainer: StartedRedisContainer;
  let mongoService: MongoService;
  let revisionsRepo: SubmissionRevisionsRepository;
  const opened: Array<{ close(): Promise<unknown> }> = [];

  beforeAll(async () => {
    mongo = await new MongoDBContainer(MONGO_IMAGE).start();
    queueContainer = await new RedisContainer(REDIS_IMAGE)
      .withCommand(['redis-server', '--maxmemory-policy', QUEUE_MAXMEMORY_POLICY])
      .start();

    mongoService = new MongoService(mongoUrl(mongo), { defaultDb: 'akane-test' });
    // MongoService connects lazily
    revisionsRepo = new SubmissionRevisionsRepository(mongoService);
  }, 300_000);

  afterAll(async () => {
    await Promise.allSettled(opened.map((r) => r.close()));
    await mongoService?.onModuleDestroy();
    await Promise.allSettled([mongo?.stop(), queueContainer?.stop()]);
  }, 300_000);

  it('retry path re-enqueues once', async () => {
    const queue = new Queue(DELIVERY_QUEUE_NAME, {
      connection: producerConnectionOptions(queueContainer.getConnectionUrl()),
      prefix: BULLMQ_PREFIX,
      defaultJobOptions: { attempts: 3, backoff: { type: 'fixed', delay: 10 } },
    });
    const { Worker } = await import('bullmq');
    const worker = new Worker(
      DELIVERY_QUEUE_NAME,
      async () => {
        throw new Error('test failure');
      },
      {
        connection: producerConnectionOptions(queueContainer.getConnectionUrl()),
        prefix: BULLMQ_PREFIX,
      },
    );
    opened.push(queue, worker);

    await queue.add(
      'deliver',
      {
        submissionId: 'sub-1',
        revision: 0,
        connectorRef: 'redmine-dev',
        payload: { test: 'data' },
      },
      { jobId: 'job-1' },
    );

    // Wait for job to fail
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const failedBefore = await queue.getFailed();
    expect(failedBefore.length).toBe(1);

    // Stop the consumer before retrying. The processor above always throws, so a
    // live worker would pick the re-enqueued job up and fail it again within
    // milliseconds — before this test could observe it leave the failed set.
    // Closing first makes the re-enqueue (the behaviour under test) observable
    // and deterministic: the job must land back in `waiting`.
    await worker.close();

    await dlqRetry('job-1', queueContainer.getConnectionUrl(), revisionsRepo);

    const failedAfter = await queue.getFailed();
    expect(failedAfter.length).toBe(0);

    const waiting = await queue.getJobs(['waiting', 'delayed', 'active', 'failed']);
    expect(waiting.length).toBe(1);
  }, 120_000);

  it('sent_unconfirmed is refused without --force', async () => {
    const queue = new Queue(DELIVERY_QUEUE_NAME, {
      connection: producerConnectionOptions(queueContainer.getConnectionUrl()),
      prefix: BULLMQ_PREFIX,
      defaultJobOptions: { attempts: 1 },
    });
    const { Worker } = await import('bullmq');
    const worker = new Worker(
      DELIVERY_QUEUE_NAME,
      async () => {
        throw new Error('test failure');
      },
      {
        connection: producerConnectionOptions(queueContainer.getConnectionUrl()),
        prefix: BULLMQ_PREFIX,
      },
    );
    opened.push(queue, worker);

    await queue.add(
      'deliver',
      {
        submissionId: 'sub-2',
        revision: 1,
        connectorRef: 'redmine-dev',
        payload: { test: 'data2' },
      },
      { jobId: 'job-2' },
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Insert revision as sent_unconfirmed
    const col = mongoService.db().collection('submission_revisions');
    await col.insertOne({
      submission_id: 'sub-2',
      revision: 1,
      outbound: 'sent_unconfirmed',
      data: {},
      createdAt: new Date(),
    });

    await expect(
      dlqRetry('job-2', queueContainer.getConnectionUrl(), revisionsRepo),
    ).rejects.toThrow(/sent_unconfirmed/);
    await worker.close();
  }, 120_000);

  it('surfaces an undelivered outbound message with its platform event (OUT-14)', async () => {
    const queue = new Queue(OUTBOUND_QUEUE_NAME, {
      connection: producerConnectionOptions(queueContainer.getConnectionUrl()),
      prefix: BULLMQ_PREFIX,
      defaultJobOptions: { attempts: 1 },
    });
    const { Worker } = await import('bullmq');
    const worker = new Worker(
      OUTBOUND_QUEUE_NAME,
      async () => {
        throw new Error('teams 503');
      },
      {
        connection: producerConnectionOptions(queueContainer.getConnectionUrl()),
        prefix: BULLMQ_PREFIX,
      },
    );
    opened.push(queue, worker);

    await queue.add(
      'deliver',
      {
        message_id: 'msg-1',
        platform: 'teams',
        channel_id: 'C-1',
        chat_user_id: 'U-1',
        text: 'Here is your form',
        action: 'form_link',
        queue: 'im-outbound',
        attempt: 0,
        native_event_id: 'Ev123',
      },
      { jobId: 'out-job-1' },
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const failed = await queue.getFailed();
    expect(failed.length).toBe(1);
    // The join key an operator needs: which inbound event produced this reply.
    expect(failed[0]!.data.native_event_id).toBe('Ev123');
    expect(failed[0]!.failedReason).toContain('teams 503');

    // The list path is exercised for real output, not just rendering.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await dlqList(queueContainer.getConnectionUrl(), revisionsRepo, {
        queue: OUTBOUND_QUEUE_NAME,
      });
      const output = log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Ev123');
      expect(output).toContain('teams 503');
    } finally {
      log.mockRestore();
    }

    await worker.close();
  }, 120_000);

  it('rejects an unknown queue rather than listing nothing', async () => {
    await expect(
      dlqList(queueContainer.getConnectionUrl(), revisionsRepo, {
        queue: 'no-such-queue',
      }),
    ).rejects.toThrow(/Unknown queue/);
    // The known queue set is exported, not implied.
    expect(INSPECTABLE_QUEUES).toContain(OUTBOUND_QUEUE_NAME);
    expect(INSPECTABLE_QUEUES).toContain('connector-delivery');
  }, 60_000);
});
