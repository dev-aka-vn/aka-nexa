import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { z } from 'zod';

import { ConnectorRegistry } from '../../../../packages/domain/src/connectors/connector.registry.js';
import { SubmissionRevisionsRepository } from '../../../../packages/domain/src/submissions/data-access/submission-revisions.repository.js';

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
    const result = await connector.execute('deliver', {
      submissionId: data.submissionId,
      appId: (data.payload as any).appId ?? 'unknown',
      formId: (data.payload as any).formId ?? 'unknown',
      data: (data.payload as any).data ?? data.payload,
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
