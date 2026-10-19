import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

import { NOTIFICATION_SEND_QUEUE } from '@akane/platform';
import { OutboundMessageSchema, type OutboundMessage } from '@akane/contract';
import { randomUUID } from 'crypto';

/**
 * Reads a `status` field from an unknown webhook body without widening it to
 * `any`. The body arrives as untrusted JSON, so it is narrowed before indexing.
 */
function readBodyStatus(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('status' in body)) {
    return undefined;
  }

  const status = (body as { status?: unknown }).status;
  // Mirrors the original `payload.body?.['status'] || <default>` truthiness test:
  // any falsy status (absent, null, '', 0) falls through to the caller's default.
  return status ? String(status) : undefined;
}

/**
 * Service for processing inbound external webhooks.
 *
 * Handles mapping external entity IDs to submission context and
 * enqueues notification jobs to be processed by workers.
 * Actual business logic runs in consumer (ack < 200ms in controller).
 */
@Injectable()
export class ExternalWebhookService {
  constructor(@InjectQueue(NOTIFICATION_SEND_QUEUE) private readonly queue: Queue) {}

  async enqueueNotification(payload: Record<string, unknown>): Promise<string> {
    const jobId = `webhook-notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await this.queue.add(NOTIFICATION_SEND_QUEUE, payload, {
      jobId,
      // NOT-04 / D-13: backoff *with jitter*. BullMQ's built-in 'exponential'
      // type is deterministic and carries none, so the jitter lives in the
      // custom BackoffStrategy named 'notification-jitter' that the notification
      // worker registers (08-08) — equal-jitter exponential: base = this delay
      // × 2^(attemptsMade−1), capped, actual = base × uniform[0.5, 1.0].
      attempts: 3,
      backoff: {
        type: 'notification-jitter',
        delay: 1000,
      },
    });
    return jobId;
  }

  async processNotification(payload: Record<string, unknown>): Promise<void> {
    // Enforce alternative trust mechanism per connector (NOT-05)
    const connectorId = String(payload.connectorId || '');
    if (!connectorId) {
      throw new Error('Missing connectorId in notification payload');
    }
    
    // Basic trust mechanism validation - connector-specific validation
    // would be implemented based on connector configuration
    // For tracer E2E, we validate structure
    
    // Create notification message (NOT-03)
    // This is a foundation - in production, we'd look up submission→submitter
    const notification: OutboundMessage = {
      message_id: randomUUID(),
      platform: 'teams', // Default for foundation; determined from submission lookup
      channel_id: String(payload.channelId || 'general'),
      chat_user_id: String(payload.chatUserId || 'user'),
      text: readBodyStatus(payload.body) ?? 'Status update from external system',
      action: 'status',
      queue: NOTIFICATION_SEND_QUEUE,
      attempt: 0,
    };
    
    // Validate against schema
    OutboundMessageSchema.parse(notification);
  }
}
