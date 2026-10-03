import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';

import {
  blockingConnectionOptions,
  BULLMQ_PREFIX,
  PLATFORM_HEARTBEAT_ID,
  processPlatformHeartbeat,
  WORKER_CONSUMERS,
} from '@akane/platform';

/**
 * The one BullMQ `Worker` in this repository (FND-08, D-03, R1, T-1-19).
 *
 * ## Why this file is the only place that may construct one
 *
 * A `Worker` opens a **blocking** Redis connection and parks on `BRPOPLPUSH`.
 * That is a request-path anti-pattern: a blocking command held open in the same
 * event loop that must answer a webhook in under 200 ms spends the latency
 * budget on nothing. `Worker` construction is therefore confined to
 * `apps/worker` by three independent controls — `no-restricted-imports` in
 * `eslint.config.mjs` (a build failure in `api` and `scheduler`),
 * `API_BOUNDARY_MANIFEST` / `SCHEDULER_BOUNDARY_MANIFEST` (a boot failure on
 * `WORKER_CONSUMERS`), and `tooling/entrypoint-drift.spec.ts` (a CI failure on
 * the import closure). One would be a convention; three are enforcement.
 *
 * ## Why the blocking connection profile, and why the prefix
 *
 * `blockingConnectionOptions`, never the shared producer profile. BullMQ's
 * `RedisConnection.checkBlockingOptions` throws on a truthy
 * `maxRetriesPerRequest` for a blocking connection, and a finite value would make
 * BullMQ fail the connection rather than wait out a long block (D-14, T-1-19).
 *
 * The `prefix` is load-bearing in exactly the same way and is equally invisible —
 * see {@link platformHeartbeatWorkerOptions}.
 */

/**
 * The exact options this process builds its `Worker` with.
 *
 * ## Why this is a function and not an inline object literal
 *
 * Because **`prefix` was silently missing**, and the symptom it produced is the
 * worst shape a queue bug can have. `BullModule.forRootAsync` puts
 * `prefix: BULLMQ_PREFIX` on the producer `Queue` (D-14's `{akane-q}`), and
 * `new Worker(name, fn, { connection })` with no `prefix` option listens on
 * BullMQ's **default** namespace instead. So the consumer sat parked on
 * `bull:platform-heartbeat`, a queue no producer and no scheduler ever names,
 * while `/health/ready` cheerfully reported `bullmq_workers: { status: "up" }`
 * — because `Worker.isRunning()` only asks whether the blocking loop is alive,
 * not whether it is watching the right queue.
 *
 * Found by booting the process, not by reading it: the queue's Redis keys were
 * right, the readiness probe was green, and the heartbeat counter stayed at zero
 * for as long as anyone cared to wait. An isolated spec asserting only "a Worker
 * was constructed with a blocking connection" would have passed throughout,
 * because the connection profile really was right.
 *
 * Extracting the object makes the whole option set one assertable value, and
 * `platform-heartbeat.processor.spec.ts` pins both halves of the contract: this
 * returns the platform's prefix, and it is the same prefix `queueRootOptions`
 * hands the producer.
 */
export function platformHeartbeatWorkerOptions(queueUrl: string): {
  connection: ReturnType<typeof blockingConnectionOptions>;
  prefix: string;
} {
  return {
    connection: blockingConnectionOptions(queueUrl),
    prefix: BULLMQ_PREFIX,
  };
}

@Injectable()
export class PlatformHeartbeatProcessor
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  readonly #queueUrl: string;
  #worker: Worker | undefined;
  #lastError: Error | undefined;

  constructor(config: ConfigService) {
    // Resolved in the constructor, worker built at bootstrap — see
    // `onApplicationBootstrap` for why the two are not the same moment.
    this.#queueUrl = config.getOrThrow<string>('REDIS_QUEUE_URL');
  }

  /**
   * Build the worker here rather than in the constructor.
   *
   * `NestFactory.create()` instantiates providers, and a `Worker` constructed
   * there starts consuming **before** the process listens and before the
   * boundary guard has run. Building at bootstrap means the consumer exists only
   * in a process that finished booting, and readiness — which is read after
   * `listen()` — can never describe a worker that has not been created yet.
   */
  async onApplicationBootstrap(): Promise<void> {
    this.#worker = new Worker(
      PLATFORM_HEARTBEAT_ID,
      async () => processPlatformHeartbeat(),
      platformHeartbeatWorkerOptions(this.#queueUrl),
    );

    // `Worker` is an `EventEmitter` and emits `error` on a connection or
    // script failure. An `error` event with no listener is thrown by Node, so a
    // Redis blip would take the whole process down — and this process has no
    // other failure mode, so it would come back, fail again, and restart-loop.
    // Recording the error and letting readiness report "not listening" is the
    // honest signal: the process stays up, stops claiming to consume, and the
    // orchestrator's probe says why.
    this.#worker.on('error', (error: Error) => {
      this.#lastError = error;
    });
  }

  async onApplicationShutdown(): Promise<void> {
    // D-09: without this, SIGTERM kills the process with the blocking
    // connection still parked and a job possibly half-claimed. `close()` waits
    // for the in-flight job to finish, which is what makes a rolling deploy
    // drain rather than drop. Verified by SIGTERM-ing a booted worker: the
    // process exits 0 after closing, not on the signal's default.
    await this.#worker?.close();
    this.#worker = undefined;
  }

  /**
   * The slice D-10's readiness check reads — and nothing more.
   *
   * A worker that has thrown is not listening, so `#lastError` short-circuits to
   * `false` even in the window before BullMQ marks the worker stopped. Readiness
   * that says "running" while the last thing the worker did was throw is the one
   * answer an operator cannot act on.
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
 * The consumer list as a DI value, so readiness and the boundary guard have one
 * handle.
 *
 * A factory rather than `useValue` so the array is built from the resolved
 * provider instance — a hand-written `[new PlatformHeartbeatProcessor(...)]`
 * would be a second worker, which is the bug this indirection exists to make
 * impossible to write.
 *
 * Provided under the platform-owned `WORKER_CONSUMERS` token rather than an
 * app-local symbol: `api` and `scheduler` forbid that token by name in their
 * manifests, and an app-local symbol is unreachable from another app by
 * construction (importing it would be the boundary violation the manifest exists
 * to catch). Adding a second consumer in a later phase means appending one line
 * here, and D-10's "every registered worker is listening" check gets stricter
 * automatically.
 */
export const platformHeartbeatWorkersProvider = {
  provide: WORKER_CONSUMERS,
  inject: [PlatformHeartbeatProcessor],
  useFactory: (processor: PlatformHeartbeatProcessor): PlatformHeartbeatProcessor[] => [
    processor,
  ],
};
