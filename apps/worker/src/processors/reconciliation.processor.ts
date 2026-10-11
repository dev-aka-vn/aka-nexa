import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';

import {
  blockingConnectionOptions,
  BULLMQ_PREFIX,
  WORKER_CONSUMERS,
} from '@akane/platform';
import { OutboxRepository, SubmissionRevisionsRepository } from '@akane/domain';

export const RECONCILE_OUTBOUND_ID = 'reconcile-outbound';

export function reconciliationWorkerOptions(queueUrl: string) {
  return {
    connection: blockingConnectionOptions(queueUrl),
    prefix: BULLMQ_PREFIX,
  };
}

@Injectable()
export class ReconciliationProcessor
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  readonly #queueUrl: string;
  #worker: Worker | undefined;
  #lastError: Error | undefined;

  constructor(
    config: ConfigService,
    private readonly revisionsRepo: SubmissionRevisionsRepository,
    private readonly outboxRepo: OutboxRepository,
  ) {
    this.#queueUrl = config.getOrThrow<string>('REDIS_QUEUE_URL');
  }

  async onApplicationBootstrap(): Promise<void> {
    this.#worker = new Worker(
      RECONCILE_OUTBOUND_ID,
      async (job: Job) => {
        await this.process(job);
      },
      reconciliationWorkerOptions(this.#queueUrl),
    );

    this.#worker.on('error', (error: Error) => {
      this.#lastError = error;
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.#worker?.close();
    this.#worker = undefined;
  }

  async process(_job: Job): Promise<void> {
    // Query for revisions where outbound is 'not_sent' only (DAT-07)
    const notSentRevisions = await this.revisionsRepo.findByOutboundStatus('not_sent');
    
    for (const revision of notSentRevisions) {
      if (revision.outbound !== 'not_sent') {
        continue;
      }
      // Re-drive through the same outbox path automatic retry uses (SC#3 "same path")
      // Mark outbox entry as unpublished so outbox relay will pick it up again
      const revisionRef = `${revision.submission_id}:${revision.revision}`;
      await this.outboxRepo.markUnpublished(revisionRef);
    }
  }

  isRunning(): boolean {
    if (this.#lastError !== undefined) {
      return false;
    }
    return this.#worker?.isRunning() ?? false;
  }

  get lastError(): Error | undefined {
    return this.#lastError;
  }
}

export const reconciliationWorkersProvider = {
  provide: WORKER_CONSUMERS,
  inject: [ReconciliationProcessor],
  useFactory: (processor: ReconciliationProcessor) => [processor],
};