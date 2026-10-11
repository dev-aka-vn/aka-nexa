import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoClient } from 'mongodb';
import { Queue, Worker } from 'bullmq';
import { ConnectorDeliveryProcessor } from './connector-delivery.processor.js';
import { ConnectorRegistry, SubmissionRevisionsRepository } from '@akane/domain';
import {
  blockingConnectionOptions,
  BULLMQ_PREFIX,
  MongoService,
} from '@akane/platform';
import { startThreeContainers, ThreeContainers } from '../../../../tooling/containers.js';
import { RedmineStubConnector } from '../../../../tooling/redmine-stub.js';

describe('connector delivery integration', () => {
  let containers: ThreeContainers;
  let mongoClient: MongoClient;
  let mongoService: MongoService;

  beforeAll(async () => {
    containers = await startThreeContainers();
    mongoClient = new MongoClient(containers.urls.mongo, { directConnection: true });
    await mongoClient.connect();
    mongoService = new MongoService(containers.urls.mongo);
    await mongoService.db().createCollection('submission_revisions');
  });

  afterAll(async () => {
    await mongoClient?.close();
    await containers?.stop();
  });

  it('pre-call commit - sent_unconfirmed written before transport call', async () => {
    const callOrder: string[] = [];
    const revisionsRepo = new SubmissionRevisionsRepository(mongoService);
    const stubConnector = new RedmineStubConnector({
      execute: async () => {
        callOrder.push('execute');
        return { status: 'succeeded' as const, externalId: 'ext-1' };
      },
    });
    const registry = new ConnectorRegistry();
    (registry as any).resolve = () => stubConnector;

    const session = mongoService.client.startSession();
    try {
      await session.withTransaction(async () => {
        await revisionsRepo.insertInSession('sub-precommit-1', 0, { data: {} }, session);
      });
    } finally {
      await session.endSession();
    }

    // Spy on setSentUnconfirmed
    const originalSetSent = revisionsRepo.setSentUnconfirmed.bind(revisionsRepo);
    revisionsRepo.setSentUnconfirmed = vi.fn().mockImplementation(async (...args: [string, number]) => {
      callOrder.push('setSentUnconfirmed');
      return originalSetSent(...args);
    });

    const processor = new ConnectorDeliveryProcessor(revisionsRepo, registry);
    await processor.process({
      data: {
        submissionId: 'sub-precommit-1',
        revision: 0,
        connectorRef: 'conn-1',
        payload: { data: {} },
      },
    } as any);

    const revision = await revisionsRepo.findBySubmissionAndRevision('sub-precommit-1', 0);
    expect(revision?.outbound).toBe('confirmed');
    expect(callOrder[0]).toBe('setSentUnconfirmed');
    expect(callOrder[1]).toBe('execute');
  });

  it('backoff dlq - 5 attempts then terminal failed set', async () => {
    const revisionsRepo = new SubmissionRevisionsRepository(mongoService);
    let executeCount = 0;
    const stubConnector = new RedmineStubConnector({
      execute: async () => {
        executeCount++;
        throw new Error('transient failure');
      },
    });
    const registry = new ConnectorRegistry();
    (registry as any).resolve = () => stubConnector;

    const submissionId = 'sub-backoff-1';
    const session = mongoService.client.startSession();
    try {
      await session.withTransaction(async () => {
        await revisionsRepo.insertInSession(submissionId, 0, { data: {} }, session);
      });
    } finally {
      await session.endSession();
    }

    // Create queue and worker
    const queue = new Queue('connector-delivery', {
      connection: blockingConnectionOptions(containers.urls.queue),
      prefix: BULLMQ_PREFIX,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnFail: false,
      },
    });

    const processor = new ConnectorDeliveryProcessor(revisionsRepo, registry);
    const worker = new Worker('connector-delivery', async (job) => processor.process(job), {
      connection: blockingConnectionOptions(containers.urls.queue),
      prefix: BULLMQ_PREFIX,
    });

    // Wait for worker to be ready
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Add job
    await queue.add('deliver', {
      submissionId,
      revision: 0,
      connectorRef: 'conn-1',
      payload: { data: {} },
    }, {
      jobId: `${submissionId}_0`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnFail: false,
    });

    // Wait for job to complete all retries (exponential backoff: 2+4+8+16+32 = 62s for attempts 2-6)
    await new Promise((resolve) => setTimeout(resolve, 80000));

    const failed = await queue.getFailed();
    const completed = await queue.getCompleted();
    const delayed = await queue.getDelayed();
    const waiting = await queue.getWaiting();
    const active = await queue.getActive();
    
    // Debug info
    if (failed.length === 0) {
      console.log('Debug:', { failed: failed.length, completed: completed.length, delayed: delayed.length, waiting: waiting.length, active: active.length, executeCount });
    }
    
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0].attemptsMade).toBe(5);

    await worker.close();
    await queue.close();
  });
});