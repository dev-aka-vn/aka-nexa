import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';

import {
  blockingConnectionOptions,
  BULLMQ_PREFIX,
} from '@akane/platform';
import { AppPurgeService } from '@akane/domain';

export const PURGE_SWEEP_ID = 'purge-sweep';

export function purgeSweepWorkerOptions(queueUrl: string): {
  connection: ReturnType<typeof blockingConnectionOptions>;
  prefix: string;
} {
  return {
    connection: blockingConnectionOptions(queueUrl),
    prefix: BULLMQ_PREFIX,
  };
}

export async function processPurgeSweep(
  service: AppPurgeService,
): Promise<void> {
  await service.executeDue();
}

@Injectable()
export class PurgeSweepProcessor
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  readonly #queueUrl: string;
  #worker: Worker | undefined;
  #lastError: Error | undefined;

  constructor(
    config: ConfigService,
    private readonly service: AppPurgeService,
  ) {
    this.#queueUrl = config.getOrThrow<string>('REDIS_QUEUE_URL');
  }

  async onApplicationBootstrap(): Promise<void> {
    this.#worker = new Worker(
      PURGE_SWEEP_ID,
      async () => processPurgeSweep(this.service),
      purgeSweepWorkerOptions(this.#queueUrl),
    );
    this.#worker.on('error', (error: Error) => {
      this.#lastError = error;
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.#worker?.close();
    this.#worker = undefined;
  }

  isRunning(): boolean {
    if (this.#lastError !== undefined) return false;
    return this.#worker?.isRunning() ?? false;
  }

  get lastError(): Error | undefined {
    return this.#lastError;
  }
}
