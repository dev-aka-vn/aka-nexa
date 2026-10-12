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
  WORKER_CONSUMERS,
} from '@akane/platform';
import type { TransferRequestService } from '@akane/domain';

/** The id the scheduler's Job Scheduler registration names — the producer and the consumer must agree on it. */
export const TRANSFER_AUTO_CANCEL_ID = 'transfer-auto-cancel';

/**
 * The hourly transfer auto-cancel worker
 * (ACL-05, T-06-31).
 *
 * The consumer of the Job Scheduler the
 * `scheduler` process registers: the
 * durable, idempotent 7-day auto-cancel
 * of pending ownership-transfer requests.
 *
 * ## Why this file lives here
 *
 * A `Worker` opens a **blocking** Redis
 * connection and parks on `BRPOPLPUSH` —
 * a request-path anti-pattern in any
 * process that must answer a webhook in
 * under 200 ms. `Worker` construction is
 * confined to `apps/worker` by three
 * independent controls (the
 * `no-restricted-imports` lint rule, the
 * API/scheduler boundary manifests, and
 * `tooling/entrypoint-drift.spec.ts`), so
 * the processor — and only the processor —
 * builds one.
 */

/**
 * The exact options this process builds its
 * `Worker` with.
 *
 * ## Why the prefix is load-bearing
 *
 * `BullModule.forRootAsync` puts
 * `prefix: BULLMQ_PREFIX` on the producer
 * `Queue` (D-14's `{akane-q}`), and
 * `new Worker(name, fn, { connection })`
 * with no `prefix` option listens on
 * BullMQ's **default** namespace instead —
 * the regression the platform-heartbeat
 * spec exists for: a prefix-less worker
 * parks on a queue no producer ever names
 * while readiness reports "up". The
 * processor spec pins both halves of the
 * contract: this returns the platform's
 * prefix, and it is the same prefix
 * `queueRootOptions` hands the producer.
 */
export function transferAutoCancelWorkerOptions(queueUrl: string): {
  connection: ReturnType<typeof blockingConnectionOptions>;
  prefix: string;
} {
  return {
    connection: blockingConnectionOptions(queueUrl),
    prefix: BULLMQ_PREFIX,
  };
}

/**
 * The job's whole body: one call to
 * `TransferRequestService.autoCancelExpired`
 * — the same method the integration spec
 * drives over real Mongo, so the worker
 * cannot drift into a second
 * implementation of the expiry rule. The
 * method is idempotent, so a redelivered
 * job cancels nothing the first run
 * already resolved.
 */
export async function processTransferAutoCancel(
  transfers: TransferRequestService,
): Promise<void> {
  await transfers.autoCancelExpired(new Date());
}

@Injectable()
export class TransferAutoCancelProcessor
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  readonly #queueUrl: string;
  #worker: Worker | undefined;
  #lastError: Error | undefined;

  constructor(
    config: ConfigService,
    private readonly transfers: TransferRequestService,
  ) {
    this.#queueUrl = config.getOrThrow<string>('REDIS_QUEUE_URL');
  }

  /**
   * Build the worker here rather than in
   * the constructor: `NestFactory.create()`
   * instantiates providers, and a `Worker`
   * constructed there starts consuming
   * **before** the process listens and
   * before the boundary guard has run.
   * Building at bootstrap means the
   * consumer exists only in a process that
   * finished booting.
   */
  async onApplicationBootstrap(): Promise<void> {
    this.#worker = new Worker(
      TRANSFER_AUTO_CANCEL_ID,
      async () => processTransferAutoCancel(this.transfers),
      transferAutoCancelWorkerOptions(this.#queueUrl),
    );

    // `Worker` is an `EventEmitter` and emits
    // `error` on a connection or script
    // failure. An `error` event with no
    // listener is thrown by Node, so a Redis
    // blip would take the whole process down.
    // Recording the error and letting
    // readiness report "not listening" is the
    // honest signal: the process stays up,
    // stops claiming to consume, and the
    // orchestrator's probe says why.
    this.#worker.on('error', (error: Error) => {
      this.#lastError = error;
    });
  }

  async onApplicationShutdown(): Promise<void> {
    // D-09: without this, SIGTERM kills the
    // process with the blocking connection
    // still parked and a job possibly
    // half-claimed. `close()` waits for the
    // in-flight job to finish, which is what
    // makes a rolling deploy drain rather
    // than drop.
    await this.#worker?.close();
    this.#worker = undefined;
  }

  /**
   * The slice D-10's readiness check reads —
   * and nothing more. A worker that has
   * thrown is not listening, so `#lastError`
   * short-circuits to `false` even in the
   * window before BullMQ marks the worker
   * stopped.
   */
  isRunning(): boolean {
    if (this.#lastError !== undefined) {
      return false;
    }
    return this.#worker?.isRunning() ?? false;
  }

  /** Exposed for the `EXTRA_HEALTH_INDICATORS` details payload. */
  get lastError(): Error | undefined {
    return this.#lastError;
  }
}

/**
 * The consumer list as a DI value, so
 * readiness and the boundary guard have one
 * handle. Provided under the platform-owned
 * `WORKER_CONSUMERS` token rather than an
 * app-local symbol: `api` and `scheduler`
 * forbid that token by name in their
 * manifests, and an app-local symbol is
 * unreachable from another app by
 * construction.
 */
export const transferAutoCancelWorkersProvider = {
  provide: WORKER_CONSUMERS,
  inject: [TransferAutoCancelProcessor],
  useFactory: (
    processor: TransferAutoCancelProcessor,
  ): TransferAutoCancelProcessor[] => [processor],
};
