import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient } from 'mongodb';
import { ReconciliationProcessor } from './reconciliation.processor.js';
import { OutboxRepository, SubmissionRevisionsRepository } from '@akane/domain';
import { MongoService } from '@akane/platform';
import { startThreeContainers, ThreeContainers } from '../../../../tooling/containers.js';
import { ConfigService } from '@nestjs/config';

describe('reconciliation - not_sent only', () => {
  let containers: ThreeContainers;
  let mongoClient: MongoClient;
  let mongoService: MongoService;

  beforeAll(async () => {
    containers = await startThreeContainers();
    mongoClient = new MongoClient(containers.urls.mongo, { directConnection: true });
    await mongoClient.connect();
    mongoService = new MongoService(containers.urls.mongo);
    await mongoService.db().createCollection('submission_revisions');
    await mongoService.db().createCollection('outbox');
  });

  afterAll(async () => {
    await mongoClient?.close();
    await containers?.stop();
  });

  it('not_sent only - sweep never selects sent_unconfirmed', async () => {
    const revisionsRepo = new SubmissionRevisionsRepository(mongoService);
    const outboxRepo = new OutboxRepository(mongoService);
    const configService = new ConfigService({ REDIS_QUEUE_URL: containers.urls.queue });
    const processor = new ReconciliationProcessor(configService, revisionsRepo, outboxRepo);

    // Create revisions with different outbound states
    const session = mongoService.client.startSession();
    try {
      await session.withTransaction(async () => {
        // not_sent revision
        await revisionsRepo.insertInSession('sub-not-sent-1', 0, { data: 'test1' }, session);
        // sent_unconfirmed revision
        await mongoService.db().collection('submission_revisions').insertOne(
          {
            submission_id: 'sub-sent-1',
            revision: 0,
            outbound: 'sent_unconfirmed',
            data: { data: 'test2' },
            createdAt: new Date(),
          },
          { session },
        );
        // confirmed revision
        await mongoService.db().collection('submission_revisions').insertOne(
          {
            submission_id: 'sub-confirmed-1',
            revision: 0,
            outbound: 'confirmed',
            data: { data: 'test3' },
            createdAt: new Date(),
          },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    // Create outbox entries for the revisions
    await outboxRepo.insertInSession(
      { submissionId: 'sub-not-sent-1', revision: 0, connectorRef: 'conn-1', payload: {} },
      mongoService.client.startSession(),
    );
    // Simpler - just insert directly
    await mongoService.db().collection('outbox').insertOne({
      published: true,
      revisionRef: 'sub-not-sent-1:0',
      connectorRef: 'conn-1',
      submissionId: 'sub-not-sent-1',
      revision: 0,
      payload: {},
      createdAt: new Date(),
    });
    await mongoService.db().collection('outbox').insertOne({
      published: true,
      revisionRef: 'sub-sent-1:0',
      connectorRef: 'conn-1',
      submissionId: 'sub-sent-1',
      revision: 0,
      payload: {},
      createdAt: new Date(),
    });

    // Run reconciliation
    await processor.process({} as any);

    // Check that sent_unconfirmed's outbox was NOT marked unpublished
    const sentOutbox = await mongoService.db().collection('outbox').findOne({ revisionRef: 'sub-sent-1:0' });
    expect(sentOutbox?.published).toBe(true); // should remain published

    // Check that not_sent's outbox WAS marked unpublished
    const notSentOutbox = await mongoService.db().collection('outbox').findOne({ revisionRef: 'sub-not-sent-1:0' });
    expect(notSentOutbox?.published).toBe(false);
  });
});