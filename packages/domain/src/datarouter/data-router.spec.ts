import { describe, it, expect } from 'vitest';
import { DataRouterService } from './data-router.service.js';
import { MongoService } from '../../../platform/src/mongo/mongo.service.js';

describe('data router - mode behavior', () => {
  it('hybrid: revision + outbox both committed', async () => {
    const insertedRevisions: any[] = [];
    const insertedOutbox: any[] = [];
    const mockMongoService = {
      client: {
        startSession: () => ({
          withTransaction: async (fn: any) => fn(),
          endSession: async () => {},
        }),
      },
      db: () => ({
        collection: (name: string) => ({
          insertOne: async (doc: any) => {
            if (name === 'submission_revisions') insertedRevisions.push(doc);
            if (name === 'outbox') insertedOutbox.push(doc);
          },
        }),
      }),
    } as unknown as MongoService;

    const service = new DataRouterService(mockMongoService);
    const result = await service.routeSubmission(
      {
        submissionId: 'sub-1',
        appId: 'app-1',
        formId: 'form-1',
        data: { test: true },
        connectorRef: 'conn-1',
      },
      'hybrid',
    );
    expect(result.status).toBe('accepted');
    expect(result.revision).toBeDefined();
    expect(insertedRevisions.length).toBe(1);
    expect(insertedOutbox.length).toBe(1);
  });

  it('internal: synchronous revision write only, nothing enqueued', async () => {
    const insertedRevisions: any[] = [];
    const insertedOutbox: any[] = [];
    const mockMongoService = {
      client: {
        startSession: () => ({
          withTransaction: async (fn: any) => fn(),
          endSession: async () => {},
        }),
      },
      db: () => ({
        collection: (name: string) => ({
          insertOne: async (doc: any) => {
            if (name === 'submission_revisions') insertedRevisions.push(doc);
            if (name === 'outbox') insertedOutbox.push(doc);
          },
        }),
      }),
    } as unknown as MongoService;

    const service = new DataRouterService(mockMongoService);
    const result = await service.routeSubmission(
      {
        submissionId: 'sub-2',
        appId: 'app-1',
        formId: 'form-1',
        data: { test: true },
      },
      'internal',
    );
    expect(result.status).toBe('accepted');
    expect(insertedRevisions.length).toBe(1);
    expect(insertedOutbox.length).toBe(0);
  });

  it('external: no internal write, one outbox row enqueued', async () => {
    const insertedRevisions: any[] = [];
    const insertedOutbox: any[] = [];
    const mockMongoService = {
      client: {
        startSession: () => ({
          withTransaction: async (fn: any) => fn(),
          endSession: async () => {},
        }),
      },
      db: () => ({
        collection: (name: string) => ({
          insertOne: async (doc: any) => {
            if (name === 'submission_revisions') insertedRevisions.push(doc);
            if (name === 'outbox') insertedOutbox.push(doc);
          },
        }),
      }),
    } as unknown as MongoService;

    const service = new DataRouterService(mockMongoService);
    const result = await service.routeSubmission(
      {
        submissionId: 'sub-3',
        appId: 'app-1',
        formId: 'form-1',
        data: { test: true },
        connectorRef: 'conn-1',
      },
      'external',
    );
    expect(result.status).toBe('accepted');
    expect(insertedRevisions.length).toBe(0);
    expect(insertedOutbox.length).toBe(1);
  });

  it('revision starts with outbound not_sent', async () => {
    const insertedRevisions: any[] = [];
    const mockMongoService = {
      client: {
        startSession: () => ({
          withTransaction: async (fn: any) => fn(),
          endSession: async () => {},
        }),
      },
      db: () => ({
        collection: (name: string) => ({
          insertOne: async (doc: any) => {
            if (name === 'submission_revisions') insertedRevisions.push(doc);
          },
        }),
      }),
    } as unknown as MongoService;

    const service = new DataRouterService(mockMongoService);
    const result = await service.routeSubmission(
      {
        submissionId: 'sub-4',
        appId: 'app-1',
        formId: 'form-1',
        data: { test: true },
      },
      'internal',
    );
    expect(result.status).toBe('accepted');
    expect(result.revision).toBe(0);
    expect(insertedRevisions[0].outbound).toBe('not_sent');
  });

  it('unknown/absent mode fails closed with no external send', async () => {
    const insertedRevisions: any[] = [];
    const insertedOutbox: any[] = [];
    const mockMongoService = {
      client: {
        startSession: () => ({
          withTransaction: async (fn: any) => fn(),
          endSession: async () => {},
        }),
      },
      db: () => ({
        collection: (name: string) => ({
          insertOne: async (doc: any) => {
            if (name === 'submission_revisions') insertedRevisions.push(doc);
            if (name === 'outbox') insertedOutbox.push(doc);
          },
        }),
      }),
    } as unknown as MongoService;

    const service = new DataRouterService(mockMongoService);
    const result = await service.routeSubmission(
      {
        submissionId: 'sub-5',
        appId: 'app-1',
        formId: 'form-1',
        data: { test: true },
        connectorRef: 'conn-1',
      },
      'unknown' as any,
    );
    expect(result.status).toBe('failed_permanent');
    expect(insertedOutbox.length).toBe(0);
    expect(insertedRevisions.length).toBe(0);
  });

  it('empty external payload routes to failed_permanent', async () => {
    const insertedOutbox: any[] = [];
    const mockMongoService = {
      client: {
        startSession: () => ({
          withTransaction: async (fn: any) => fn(),
          endSession: async () => {},
        }),
      },
      db: () => ({
        collection: (name: string) => ({
          insertOne: async (doc: any) => {
            if (name === 'outbox') insertedOutbox.push(doc);
          },
        }),
      }),
    } as unknown as MongoService;

    const service = new DataRouterService(mockMongoService);
    const result = await service.routeSubmission(
      {
        submissionId: 'sub-6',
        appId: 'app-1',
        formId: 'form-1',
        data: {},
        connectorRef: 'conn-1',
      },
      'external',
    );
    expect(result.status).toBe('failed_permanent');
    expect(insertedOutbox.length).toBe(0);
  });

  it('outbound state never appears on Submission.status conceptually', async () => {
    const insertedRevisions: any[] = [];
    const mockMongoService = {
      client: {
        startSession: () => ({
          withTransaction: async (fn: any) => fn(),
          endSession: async () => {},
        }),
      },
      db: () => ({
        collection: (name: string) => ({
          insertOne: async (doc: any) => {
            if (name === 'submission_revisions') insertedRevisions.push(doc);
          },
        }),
      }),
    } as unknown as MongoService;

    const service = new DataRouterService(mockMongoService);
    await service.routeSubmission(
      {
        submissionId: 'sub-7',
        appId: 'app-1',
        formId: 'form-1',
        data: { test: true },
      },
      'internal',
    );
    expect(insertedRevisions[0].outbound).toBeDefined();
    expect(insertedRevisions[0]).not.toHaveProperty('Submission');
    expect(insertedRevisions[0]).not.toHaveProperty('status');
  });
});
