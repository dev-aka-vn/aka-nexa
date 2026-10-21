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
import { AuditRetentionService } from '@akane/domain';

export const AUDIT_RETENTION_ID = 'audit-retention';

export function auditRetentionWorkerOptions(queueUrl: string): {
  connection: ReturnType<typeof blockingConnectionOptions>;
  prefix: string;
} {
  return {
    connection: blockingConnectionOptions(queueUrl),
    prefix: BULLMQ_PREFIX,
  };
}

export async function processAuditRetention(
  service: AuditRetentionService,
): Promise<void> {
  await service.run();
}

@Injectable()
export class AuditRetentionProcessor
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  readonly #queueUrl: string;
  #worker: Worker | undefined;
  #lastError: Error | undefined;

  constructor(
    config: ConfigService,
    private readonly service: AuditRetentionService,
  ) {
    this.#queueUrl = config.getOrThrow<string>('REDIS_QUEUE_URL');
  }

  async onApplicationBootstrap(): Promise<void> {
    this.#worker = new Worker(
      AUDIT_RETENTION_ID,
      async () => processAuditRetention(this.service),
      auditRetentionWorkerOptions(this.#queueUrl),
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
