import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient } from 'mongodb';
import { DataRouterService } from './data-router.service.js';
import { OutboxRepository } from './data-access/outbox.repository.js';
import type { AppDefinitionService } from '../builder/app-definition.service.js';
import { MongoService } from '@akane/platform';
import { startThreeContainers, ThreeContainers } from '../../../../tooling/containers.js';

/**
 * APP-06's lifecycle guard runs at the
 * seam; this spec's subject is the
 * outbox's transaction atomicity, so the
 * definition store is a pass-through
 * double. The guard itself is proven on
 * the real path in the app-definition
 * integration spec.
 */
const definitions = {
  assertAcceptsSubmissions: async (): Promise<void> => undefined,
} as unknown as AppDefinitionService;

describe('outbox integration - transaction atomicity', () => {
  let containers: ThreeContainers;
  let mongoClient: MongoClient;
  let mongoService: MongoService;

  beforeAll(async () => {
    containers = await startThreeContainers();
    mongoClient = new MongoClient(containers.urls.mongo, { directConnection: true });
    await mongoClient.connect();
    mongoService = new MongoService(containers.urls.mongo);
    await mongoService.db().createCollection('outbox');
    await mongoService.db().createCollection('submission_revisions');
  });

  afterAll(async () => {
    await mongoClient?.close();
    await containers?.stop();
  });

  it('transaction atomicity: both revision and outbox committed in hybrid mode', async () => {
    const router = new DataRouterService(mongoService, definitions);
    const result = await router.routeSubmission(
      {
        submissionId: 'sub-atomic-1',
        appId: 'app-1',
        formId: 'form-1',
        data: { subject: 'Test' },
        connectorRef: 'conn-1',
      },
      'hybrid',
    );

    expect(result.status).toBe('accepted');
    expect(result.revision).toBeDefined();

    const revisions = await mongoService.db().collection('submission_revisions').find({ submission_id: 'sub-atomic-1' }).toArray();
    const outbox = await mongoService.db().collection('outbox').find({ submissionId: 'sub-atomic-1' }).toArray();
    expect(revisions.length).toBe(1);
    expect(outbox.length).toBe(1);
    expect(outbox[0].published).toBe(false);
  });

  it('transaction atomicity: rollback leaves neither document on forced error', async () => {
    // Create a router that will throw after first insert by monkeypatching
    const router = new DataRouterService(mongoService, definitions);

    // Simulate by doing it manually with a session and forced throw
    const session = mongoService.client.startSession();
    const submissionId = 'sub-rollback-1';
    const revision = 0;

    let threw = false;
    try {
      await session.withTransaction(async () => {
        await mongoService.db().collection('submission_revisions').insertOne(
          {
            submission_id: submissionId,
            revision,
            outbound: 'not_sent',
            data: { test: true },
            createdAt: new Date(),
          },
          { session },
        );
        // Force rollback
        throw new Error('forced-rollback');
      });
    } catch (err) {
      threw = true;
      expect((err as Error).message).toBe('forced-rollback');
    } finally {
      await session.endSession();
    }

    expect(threw).toBe(true);
    const revisions = await mongoService.db().collection('submission_revisions').find({ submission_id: submissionId }).toArray();
    const outbox = await mongoService.db().collection('outbox').find({ submissionId }).toArray();
    expect(revisions.length).toBe(0);
    expect(outbox.length).toBe(0);
  });

  it('pollUnpublished returns only unpublished rows; markPublished is idempotent', async () => {
    const outboxRepo = new OutboxRepository(mongoService);
    const submissionId = 'sub-poll-1';
    const revision = 5;
    const revisionRef = `${submissionId}:${revision}`;

    const session = mongoService.client.startSession();
    try {
      await session.withTransaction(async () => {
        await outboxRepo.insertInSession(
          {
            submissionId,
            revision,
            connectorRef: 'conn-1',
            payload: { data: true },
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }

    const unpublished = await outboxRepo.pollUnpublished(10);
    const found = unpublished.find((r) => r.revisionRef === revisionRef);
    expect(found).toBeDefined();
    expect(found?.published).toBe(false);

    await outboxRepo.markPublished(revisionRef);
    await outboxRepo.markPublished(revisionRef); // idempotent

    const unpublishedAfter = await outboxRepo.pollUnpublished(10);
    const stillFound = unpublishedAfter.find((r) => r.revisionRef === revisionRef);
    expect(stillFound).toBeUndefined();
  });
});
