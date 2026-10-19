import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import { ExternalWebhookService } from './external-webhook.service.js';

/**
 * Consumer for external webhook notification jobs.
 *
 * Processes webhook notifications asynchronously (business logic in consumer
 * per D-14). Implements retry semantics via BullMQ - 3 attempts with
 * backoff+jitter configured at queue level (NOT-04).
 */
@Injectable()
export class ExternalWebhookConsumer {
  constructor(private readonly webhookService: ExternalWebhookService) {}

  async handle(job: Job): Promise<void> {
    const payload: Record<string, unknown> = job.data ?? {};
    await this.webhookService.processNotification(payload);
  }
}
