import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { z } from 'zod';

import { ConnectorRegistry, ConnectorRateLimiter, ConnectorRateLimitedError, SubmissionRevisionsRepository } from '@akane/domain';

const DeliveryJobSchema = z.object({
  submissionId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  connectorRef: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export type DeliveryJobData = z.infer<typeof DeliveryJobSchema>;

@Injectable()
@Processor('connector-delivery')
export class ConnectorDeliveryProcessor extends WorkerHost {
  constructor(
    private readonly revisionsRepo: SubmissionRevisionsRepository,
    private readonly connectorRegistry: ConnectorRegistry,
    private readonly rateLimiter: ConnectorRateLimiter,
  ) {
    super();
  }

  async process(job: Job<DeliveryJobData>): Promise<void> {
    const data = DeliveryJobSchema.parse(job.data);
    const revision = await this.revisionsRepo.findBySubmissionAndRevision(data.submissionId, data.revision);

    if (!revision) {
      return;
    }

    if (revision.outbound === 'confirmed') {
      return;
    }

    if (revision.outbound === 'not_sent') {
      await this.revisionsRepo.setSentUnconfirmed(data.submissionId, data.revision);
    } else if (revision.outbound === 'sent_unconfirmed') {
      // Only retry if this is a BullMQ retry (not a redelivery)
      // If attemptsMade > 0, it means this is a retry
      if (!job.attemptsMade || job.attemptsMade === 0) {
        return;
      }
    } else {
      return;
    }

    const connector = this.connectorRegistry.resolve(data.connectorRef);

    // CON-05: the registry resolves first, so an unknown `connector_ref` is
    // rejected (fail-closed) before the limiter is consulted. A known connector
    // with no declared budget gets the conservative default.
    const limit = this.connectorRegistry.limiterConfig(data.connectorRef);
    const decision = await this.rateLimiter.consume(data.connectorRef, limit);
    if (!decision.allowed) {
      // Transient by construction: the next window admits the call, so BullMQ's
      // backoff must retry it rather than treating the submission as failed.
      throw new ConnectorRateLimitedError(data.connectorRef, decision.resetInMs);
    }

    const payload = data.payload as {
      appId?: string;
      formId?: string;
      data?: Record<string, unknown>;
    };
    const result = await connector.execute('deliver', {
      submissionId: data.submissionId,
      appId: payload.appId ?? 'unknown',
      formId: payload.formId ?? 'unknown',
      data: payload.data ?? data.payload,
    }, {
      idempotencyKey: null,
    });

    if (result.status === 'succeeded') {
      await this.revisionsRepo.setConfirmed(data.submissionId, data.revision, result.externalId);
    } else if (result.status === 'failed_transient') {
      throw new Error('connector delivery failed transient');
    } else {
      // failed_permanent, credential_rejected, rejected -> terminal, do not throw
      return;
    }
  }
}
