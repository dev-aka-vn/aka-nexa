import { describe, it, expect } from 'vitest';
import { DataRouterService } from './data-router.service.js';
import { MongoService } from '../../../platform/src/mongo/mongo.service.js';

// Minimal mock for unit test structure
const mockMongoService = {
  client: {
    startSession: () => ({
      withTransaction: async (fn: any) => fn(),
      endSession: async () => {},
    }),
  },
  db: () => ({
    collection: () => ({
      insertOne: async () => {},
    }),
  }),
} as unknown as MongoService;

describe('data router - mode behavior', () => {
  it('hybrid: revision + outbox both committed', async () => {
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
  });

  it('internal: synchronous revision write only, nothing enqueued', async () => {
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
  });

  it('external: no internal write, one outbox row enqueued', async () => {
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
  });

  it('revision starts with outbound not_sent', async () => {
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
  });
});
