import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { z } from 'zod';

import { NOTIFICATION_SEND_QUEUE } from '@akane/platform';
import { AuditRepository } from '@akane/domain';
import { NotificationAssemblerService } from '@akane/domain';
import { TeamsDeliveryService, isRetryableDeliveryError } from '../adapters/teams/teams-delivery.service.js';
import type { OutboundMessage } from '@akane/contract';

const NotificationJobSchema = z.object({
  connectorId: z.string().min(1),
  body: z.unknown().optional(),
  receivedAt: z.string().optional(),
});

export type NotificationJobData = z.infer<typeof NotificationJobSchema>;

export function notificationJitterBackoff(
  attemptsMade: number,
  _type?: string,
  _err?: Error,
  job?: unknown,
): number {
  const backoff = (job as { opts?: { backoff?: unknown } } | undefined)?.opts?.backoff;
  const delay =
    typeof backoff === 'number'
      ? backoff
      : ((backoff as { delay?: number } | undefined)?.delay ?? 1000);
  const base = Math.min(delay * Math.pow(2, attemptsMade - 1), 30000);
  return Math.round(base * (0.5 + Math.random() * 0.5));
}

function extractEntityReference(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    return '';
  }
  const b = body as Record<string, unknown>;
  const candidates = [
    'entity_reference',
    'entityReference',
    'reference',
    'external_reference',
    'externalReference',
    'entity_id',
    'entityId',
    'external_id',
    'externalId',
    'downstream_reference',
    'downstreamReference',
    'id',
  ];
  for (const key of candidates) {
    const value = b[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return '';
}

function extractStatusText(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    return 'Status update';
  }
  const b = body as Record<string, unknown>;
  const value =
    b.status ?? b.statusText ?? b.status_text ?? b.state ?? b.message ?? b.text;
  if (value === null || value === undefined) {
    return 'Status update';
  }
  const str = String(value).trim();
  return str.length > 0 ? str : 'Status update';
}

@Injectable()
@Processor(NOTIFICATION_SEND_QUEUE, {
  settings: { backoffStrategy: notificationJitterBackoff },
})
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly assembler: NotificationAssemblerService,
    private readonly delivery: TeamsDeliveryService,
    private readonly audit: AuditRepository,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const data = NotificationJobSchema.parse(job.data ?? {});

    const connectorId = data.connectorId;
    const entityReference = extractEntityReference(data.body);
    const statusText = extractStatusText(data.body);

    const outcome = await this.assembler.assemble(connectorId, entityReference, statusText);

    if (outcome.kind === 'unresolved') {
      await this.audit.append({
        timestamp: new Date(),
        actor: 'system',
        action: 'notification.unresolved',
        target: outcome.reference,
        connectorId,
        reference: outcome.reference,
      });
      return;
    }

    if (outcome.kind === 'unmapped') {
      await this.audit.append({
        timestamp: new Date(),
        actor: 'system',
        action: 'notification.unmapped',
        target: outcome.realUserId,
        connectorId,
        reference: entityReference,
        realUserId: outcome.realUserId,
      });
      return;
    }

    const message = outcome.message;

    try {
      await this.delivery.send(message);
    } catch (error: unknown) {
      const attempts = job.opts?.attempts ?? 1;
      const attemptsMade = job.attemptsMade ?? 0;
      const isLastAttempt = attemptsMade + 1 >= attempts;

      // Retryable and not the last attempt: rethrow so BullMQ retries.
      if (isRetryableDeliveryError(error) && !isLastAttempt) {
        throw error;
      }

      // Terminal path: audit first, then attempt a user-visible failure notice.
      await this.audit.append({
        timestamp: new Date(),
        actor: 'system',
        action: 'notification.delivery_failed',
        target: entityReference,
        connectorId,
        reference: entityReference,
        attempts: attemptsMade + 1,
        failureReason: String(error),
      });

      const noticeMessage: OutboundMessage = {
        ...message,
        message_id: randomUUID(),
        text: 'Your external status update could not be delivered and will not be retried.',
        attempt: (message.attempt ?? 0) + 1,
      };

      try {
        await this.delivery.send(noticeMessage);
      } catch (noticeError: unknown) {
        await this.audit.append({
          timestamp: new Date(),
          actor: 'system',
          action: 'notification.failure_notice_failed',
          target: entityReference,
          connectorId,
          reference: entityReference,
          attempts: attemptsMade + 1,
          failureReason: String(error),
          noticeError: String(noticeError),
          noticeFailed: true,
        });
      }
    }
  }
}