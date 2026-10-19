import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

import { NOTIFICATION_SEND_QUEUE } from '@akane/platform';

/**
 * Service for processing inbound external webhooks.
 *
 * Handles enqueueing notification jobs to be processed by workers.
 * Actual business logic runs in the worker consumer (ack < 200ms in controller).
 */
@Injectable()
export class ExternalWebhookService {
  constructor(@InjectQueue(NOTIFICATION_SEND_QUEUE) private readonly queue: Queue) {}

  async enqueueNotification(payload: Record<string, unknown>): Promise<string> {
    const jobId = `webhook-notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await this.queue.add(NOTIFICATION_SEND_QUEUE, payload, {
      jobId,
      attempts: 3,
      backoff: {
        type: 'notification-jitter',
        delay: 1000,
      },
    });
    return jobId;
  }
}