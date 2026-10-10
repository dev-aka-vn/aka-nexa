import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue } from 'bullmq';

import {
  MONGO_IMAGE,
  mongoUrl,
  REDIS_IMAGE,
  QUEUE_MAXMEMORY_POLICY,
} from '../../tooling/containers.js';
import { producerConnectionOptions, BULLMQ_PREFIX } from '@akane/platform';
import { MongoService } from '../platform/src/mongo/mongo.service.js';
import { SubmissionRevisionsRepository } from '../domain/src/submissions/data-access/submission-revisions.repository.js';
import { dlqList, dlqRetry } from './dlq.js';

const DELIVERY_QUEUE_NAME = 'connector-delivery';

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

    await dlqRetry('job-1', queueContainer.getConnectionUrl(), revisionsRepo);

    const failedAfter = await queue.getFailed();
    expect(failedAfter.length).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 500));
    const waiting = await queue.getJobs(['waiting', 'delayed', 'active', 'failed']);
    const allJobs = await queue.getJobs(['waiting', 'delayed', 'active', 'failed', 'completed']);
    console.log('waiting/delayed/active/failed:', waiting.length, 'all:', allJobs.length);
    expect(waiting.length).toBe(1);
    await worker.close();
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
});
