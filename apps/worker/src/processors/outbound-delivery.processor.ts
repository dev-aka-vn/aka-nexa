import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';

import { IM_OUTBOUND_QUEUE, runWithJobTraceContext } from '@akane/platform';
import {
  AuditRepository,
  PlatformEventRepository,
} from '@akane/domain';
import {
  OutboundMessageSchema,
  type ImPlatform,
  type OutboundMessage,
} from '@akane/contract';

import { isRetryableDeliveryError } from '../adapters/teams/outbound/teams-delivery.adapter.js';
import { OUTBOUND_DELIVERY_REGISTRY } from './outbound-delivery.registry.js';

/** Base delay for the exponential, jittered backoff. */
const BACKOFF_DELAY_MS = 2000;

/**
 * The outbound IM delivery consumer (OUT-01, OUT-02, OUT-14).
 *
 * ## The seam this processor closes
 *
 * `InboundEventProcessor` computed the right answer and then threw it away:
 * BullMQ drops a processor's return value, so every `link` / `clarify` /
 * OTP reply the pipeline produced died with the job. This processor is the
 * other end of the pipe that makes those answers reach the conversation they
 * belong to.
 *
 * ## What it does per job
 *
 * 1. Parse the job payload against `OutboundMessageSchema` — a job that does
 *    not parse is dropped, not retried forever.
 * 2. Resolve the per-platform delivery port through `OUTBOUND_DELIVERY_REGISTRY`
 *    — a platform with no registered port is a configuration defect and is
 *    reported as such.
 * 3. Deliver. A retryable transport failure (429 / 5xx / reset) rethrows so
 *    BullMQ's jittered backoff applies; anything terminal audits and lands
 *    the job in the DLQ (OUT-14).
 * 4. On success, mark the originating ledger row `dispatched` so the
 *    reconciler (OUT-09) does not re-deliver it.
 *
 * ## Why `message_id` is never regenerated here
 *
 * The id is producer-generated and stable across delivery retries (10-01).
 * Regenerating it on retry would turn one user-visible reply into five
 * distinct messages, and the failure notice below is the *only* place a new
 * id is minted — because it is a different message.
 */
export function outboundJitterBackoff(
  attemptsMade: number,
  _type?: string,
  _err?: unknown,
  job?: unknown,
): number {
  const backoff = (job as { opts?: { backoff?: unknown } } | undefined)?.opts?.backoff;
  const delay =
    typeof backoff === 'number'
      ? backoff
      : ((backoff as { delay?: number } | undefined)?.delay ?? BACKOFF_DELAY_MS);
  const base = Math.min(delay * Math.pow(2, attemptsMade - 1), 60000);
  return Math.round(base * (0.5 + Math.random() * 0.5));
}

/** The port interface this processor depends on. */
interface OutboundDeliveryPortLike {
  send(message: OutboundMessage): Promise<void>;
}

interface OutboundDeliveryRegistryLike {
  get(platform: ImPlatform): OutboundDeliveryPortLike | undefined;
}

@Injectable()
@Processor(IM_OUTBOUND_QUEUE, {
  settings: { backoffStrategy: outboundJitterBackoff },
})
export class OutboundDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboundDeliveryProcessor.name);

  constructor(
    @Inject(OUTBOUND_DELIVERY_REGISTRY)
    private readonly registry: OutboundDeliveryRegistryLike,
    private readonly platformEvents: PlatformEventRepository,
    private readonly audit: AuditRepository,
  ) {
    super();
  }

  /**
   * Consume one outbound delivery job (OUT-01).
   *
   * ## OUT-13: the trace context is restored before anything is delivered
   *
   * The producer wrote the inbound span's W3C `traceparent` into the job's
   * options (see `InboundEventProcessor.deliver`). Without restoring it the
   * delivery attempt, the audit write and the `markDispatched` call are all
   * orphan spans — present, but with no path back to the message that caused
   * them, which is precisely what NFR-O-1's "a reply is traceable to the
   * message that caused it" rules out.
   *
   * Restoring means making the remote span the *active* one, so every span the
   * delivery path starts becomes its child and appears in the same waterfall
   * as the inbound event. The batch is the whole job, not just the `send()`
   * call, because the failure-notice path and the audit rows belong to the
   * same causal chain.
   */
  async process(job: Job): Promise<void> {
    return runWithJobTraceContext(job.opts, () => this.deliver(job));
  }

  private async deliver(job: Job): Promise<void> {
    const parsed = OutboundMessageSchema.safeParse(job.data);
    if (!parsed.success) {
      // A malformed job is a producer bug, not a transient failure. Retrying
      // it would burn the retry budget and then bury it in the DLQ anyway.
      await this.audit.append({
        timestamp: new Date(),
        actor: 'system',
        action: 'im.outbound.malformed',
        target: 'unknown',
        failureReason: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    const message = parsed.data;
    const port = this.registry.get(message.platform);

    if (!port) {
      await this.audit.append({
        timestamp: new Date(),
        actor: 'system',
        action: 'im.outbound.no_port',
        target: message.platform,
        failureReason: `no outbound delivery port registered for ${message.platform}`,
      });
      return;
    }

    try {
      await port.send(message);
    } catch (error: unknown) {
      const attempts = job.opts?.attempts ?? 1;
      const attemptsMade = job.attemptsMade ?? 0;
      const isLastAttempt = attemptsMade + 1 >= attempts;

      if (isRetryableDeliveryError(error) && !isLastAttempt) {
        // Let BullMQ retry with the jittered backoff above.
        throw error;
      }

      await this.audit.append({
        timestamp: new Date(),
        actor: 'system',
        action: 'im.outbound.failed',
        target: message.platform,
        attempts: attemptsMade + 1,
        failureReason: String(error),
      });

      // One user-visible failure notice, with a NEW id because it is a
      // different message than the one that failed (10-04).
      const notice: OutboundMessage = {
        ...message,
        message_id: randomUUID(),
        action: 'error',
        text: 'Your message could not be delivered and will not be retried.',
        attempt: message.attempt + 1,
      };
      try {
        await port.send(notice);
      } catch (noticeError: unknown) {
        await this.audit.append({
          timestamp: new Date(),
          actor: 'system',
          action: 'im.outbound.failure_notice_failed',
          target: message.platform,
          attempts: attemptsMade + 1,
          failureReason: String(error),
          noticeError: String(noticeError),
        });
      }
      return;
    }

    // The sent reply is durably recorded. A failure here is logged and
    // swallowed: the message is already delivered, and rethrowing would
    // duplicate a user-visible reply.
    if (message.native_event_id) {
      try {
        await this.platformEvents.markDispatched(
          message.native_event_id,
          message.platform,
        );
      } catch (error: unknown) {
        this.logger.error(
          `markDispatched failed for ${message.platform}/${message.native_event_id}: ${String(error)}`,
        );
      }
    }
  }
}
