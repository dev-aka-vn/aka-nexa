import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ConfigModule } from '@akane/platform';
import {
  INBOUND_EVENTS_QUEUE,
  NOTIFICATION_SEND_QUEUE,
} from '@akane/platform';

import { ApiQueueModule } from './api-queue.module.js';
import { ExternalWebhookService } from '../webhooks/external/external-webhook.service.js';

import { startThreeContainers, type ThreeContainers } from '../../../../tooling/containers.js';

describe('api queue module (IM-10, NOT-04, D-37)', () => {
  let containers: ThreeContainers;
  let app: INestApplication;
  let inboundQueue: Queue;
  let notificationQueue: Queue;

  beforeAll(async () => {
    containers = await startThreeContainers();

    process.env.NODE_ENV = 'test';
    process.env.SERVICE_NAME = 'api';
    process.env.MONGO_URL = 'mongodb://127.0.0.1:27017/akane-test';
    process.env.REDIS_CACHE_URL = containers.urls.cache;
    process.env.REDIS_QUEUE_URL = containers.urls.queue;

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, ApiQueueModule],
      providers: [ExternalWebhookService],
    }).compile();

    inboundQueue = moduleRef.get<Queue>(getQueueToken(INBOUND_EVENTS_QUEUE));
    notificationQueue = moduleRef.get<Queue>(getQueueToken(NOTIFICATION_SEND_QUEUE));

    app = moduleRef.createNestApplication();
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await containers?.stop();
  });

  it('resolves both producer queues as BullMQ Queue instances', () => {
    expect(inboundQueue).toBeInstanceOf(Queue);
    expect(notificationQueue).toBeInstanceOf(Queue);
  });

  it('names both queues with the shared constants', () => {
    expect(inboundQueue.name).toBe(INBOUND_EVENTS_QUEUE);
    expect(notificationQueue.name).toBe(NOTIFICATION_SEND_QUEUE);
  });

  it('carries D-13 jittered retry options on the notification enqueue path', async () => {
    const service = app.get(ExternalWebhookService);
    const addSpy = vi
      .spyOn(notificationQueue, 'add')
      .mockResolvedValue({ id: 'job-1' } as never);

    const jobId = await service.enqueueNotification({ hello: 'world' });

    expect(jobId).toBeTruthy();
    expect(addSpy).toHaveBeenCalledTimes(1);
    const [, , options] = addSpy.mock.calls[0] as [
      string,
      unknown,
      { attempts: number; backoff: { type: string; delay: number } },
    ];
    expect(options.attempts).toBe(3);
    expect(options.backoff.type).toBe('notification-jitter');
    expect(options.backoff.delay).toBe(1000);

    addSpy.mockRestore();
  });
});
