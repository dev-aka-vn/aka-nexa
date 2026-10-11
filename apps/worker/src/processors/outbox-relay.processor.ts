import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';

import {
  blockingConnectionOptions,
  BULLMQ_PREFIX,
  WORKER_CONSUMERS,
} from '@akane/platform';
import { OutboxRepository } from '@akane/domain';

const OUTBOX_RELAY_QUEUE = 'outbox-relay';
const CONNECTOR_DELIVERY_QUEUE = 'connector-delivery';

export function outboxRelayWorkerOptions(queueUrl: string) {
  return {
    connection: blockingConnectionOptions(queueUrl),
    prefix: BULLMQ_PREFIX,
  };
}

@Injectable()
export class OutboxRelayProcessor
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  readonly #queueUrl: string;
  #worker: Worker | undefined;
  #deliveryQueue: Queue | undefined;
  #lastError: Error | undefined;

  constructor(
    config: ConfigService,
    private readonly outboxRepo: OutboxRepository,
  ) {
    this.#queueUrl = config.getOrThrow<string>('REDIS_QUEUE_URL');
  }

  async onApplicationBootstrap(): Promise<void> {
    this.#deliveryQueue = new Queue(CONNECTOR_DELIVERY_QUEUE, {
      connection: blockingConnectionOptions(this.#queueUrl),
      prefix: BULLMQ_PREFIX,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnFail: false,
      },
    });

    this.#worker = new Worker(
      OUTBOX_RELAY_QUEUE,
      async () => {
        const unpublished = await this.outboxRepo.pollUnpublished(10);
        for (const row of unpublished) {
          await this.#deliveryQueue?.add(
            'deliver',
            {
              submissionId: row.submissionId,
              revision: row.revision,
              connectorRef: row.connectorRef,
              payload: row.payload,
            },
            {
              jobId: `${row.submissionId}:${row.revision}`,
              attempts: 5,
              backoff: { type: 'exponential', delay: 2000 },
              removeOnFail: false,
            },
          );
          await this.outboxRepo.markPublished(row.revisionRef);
        }
      },
      outboxRelayWorkerOptions(this.#queueUrl),
    );

    this.#worker.on('error', (error: Error) => {
      this.#lastError = error;
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.#worker?.close();
    await this.#deliveryQueue?.close();
    this.#worker = undefined;
    this.#deliveryQueue = undefined;
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

export const outboxRelayWorkersProvider = {
  provide: WORKER_CONSUMERS,
  inject: [OutboxRelayProcessor],
  useFactory: (processor: OutboxRelayProcessor) => [processor],
};
