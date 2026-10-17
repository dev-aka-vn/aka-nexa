import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { z } from 'zod';

import {
  BUSINESS_METRICS_RECORDER,
  type BusinessMetricsRecorder,
} from '@akane/platform';
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
    @Inject(BUSINESS_METRICS_RECORDER)
    private readonly metrics: BusinessMetricsRecorder,
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

    const payload = data.payload as {
      appId?: string;
      formId?: string;
      data?: Record<string, unknown>;
    };

    // OBS-04 / CON-06: `app_id` is a first-class label on both business
    // counters. An attempt with no resolvable app records `unknown` rather than
    // dropping the series — a spike must not be able to hide by being
    // unattributable (plan 05-05's flagged assumption, resolved here).
    const appId = payload.appId ?? 'unknown';

    // The pre-call commit above is the transition into "saved internally, the
    // external leg is not confirmed yet". Recorded before the call, so the
    // series exists even when the call never returns.
    this.metrics.recordSubmissionStatus({ appId, status: 'sent' });

    const connector = this.connectorRegistry.resolve(data.connectorRef);

    // CON-05: the registry resolves first, so an unknown `connector_ref` is
    // rejected (fail-closed) before the limiter is consulted. A known connector
    // with no declared budget gets the conservative default.
    const limit = this.connectorRegistry.limiterConfig(data.connectorRef);
    const decision = await this.rateLimiter.consume(data.connectorRef, limit);
    if (!decision.allowed) {
      // No call was made, so this is not a connector outcome — emitting one
      // would attribute a failure to the connector that never ran. The
      // submission is still `partial` (saved internally, retrying), and
      // OBS-04's series is the one that makes that visible.
      this.metrics.recordSubmissionStatus({ appId, status: 'partial' });
      // Transient by construction: the next window admits the call, so BullMQ's
      // backoff must retry it rather than treating the submission as failed.
      throw new ConnectorRateLimitedError(data.connectorRef, decision.resetInMs);
    }

    const result = await connector.execute('deliver', {
      submissionId: data.submissionId,
      appId,
      formId: payload.formId ?? 'unknown',
      data: payload.data ?? data.payload,
    }, {
      idempotencyKey: null,
    });

    // CON-06 / CON-07: every attempt is attributed to its app, and a classified
    // failure carries its taxonomy code so `credential_rejected` alerts apart
    // from `endpoint_unreachable` without parsing a message.
    this.metrics.recordConnectorOutcome({
      appId,
      outcome: result.status,
      taxonomyCode: result.code ?? 'none',
    });

    if (result.status === 'succeeded') {
      await this.revisionsRepo.setConfirmed(data.submissionId, data.revision, result.externalId);
      this.metrics.recordSubmissionStatus({ appId, status: 'confirmed' });
    } else if (result.status === 'failed_transient') {
      // OBS-04's reason for existing: the internal write committed and the
      // external leg is still trying. Without this series the submission is
      // invisible to alerting while it sits in that state.
      this.metrics.recordSubmissionStatus({ appId, status: 'partial' });
      throw new Error('connector delivery failed transient');
    } else {
      // failed_permanent, credential_rejected, rejected -> terminal, do not throw
      this.metrics.recordSubmissionStatus({ appId, status: 'failed' });
      return;
    }
  }
}
