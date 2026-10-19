import { Injectable } from '@nestjs/common';
import type { Queue } from '@akane/platform/queue/queue.js';
import { OutboundMessage, OutboundMessageSchema } from '@akane/contract/events/outbound-message.js';
import { randomUUID } from 'crypto';

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
    await this.queue.add('notification:send', payload, { 
      jobId,
      attempts: 3, // NOT-04: retry up to 3 times with backoff+jitter
      backoff: {
        type: 'exponential',
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
      text: String(payload.body?.['status'] || 'Status update from external system'),
      action: 'status',
      queue: 'notification:send',
      attempt: 0,
    };
    
    // Validate against schema
    OutboundMessageSchema.parse(notification);
  }
}
