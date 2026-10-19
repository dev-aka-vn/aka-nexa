import { Injectable } from '@nestjs/common';
import type { Queue } from '@akane/platform/queue/queue.js';

/**
 * Service for processing inbound external webhooks.
 *
 * Handles mapping external entity IDs to submission context and
 * enqueues notification jobs to be processed by workers.
 * Actual business logic runs in consumer (ack < 200ms in controller).
 */
@Injectable()
export class ExternalWebhookService {
  constructor(private readonly queue: Queue) {}

  async enqueueNotification(payload: Record<string, unknown>): Promise<string> {
    const jobId = `webhook-notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await this.queue.add('notification:send', payload, { jobId });
    return jobId;
  }
}
