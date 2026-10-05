import {
  Controller,
  Get,
  Inject,
  Optional,
} from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  type HealthCheckResult,
  type HealthIndicatorFunction,
  type HealthIndicatorResult,
} from '@nestjs/terminus';

import { MONGO_CLIENT } from '../mongo/mongo.module.js';
import type { MongoService } from '../mongo/mongo.service.js';
import { REDIS_CACHE, REDIS_QUEUE } from '../redis/redis.constants.js';
import { MongoIndicator, MONGO_HEALTH_KEY } from './mongo.indicator.js';
import { RedisIndicator, type RedisPingClient } from './redis.indicator.js';

export const REDIS_CACHE_HEALTH_KEY = 'redis_cache';
export const REDIS_QUEUE_HEALTH_KEY = 'redis_queue';

/**
 * The three dependencies every process checks, always all three (D-10).
 *
 * Frozen and exported so the invariant is a value a test can assert rather than
 * a list a reader has to trust. "Always" is the load-bearing word: an operator
 * seeing `redis_queue: down` can only act on it if the other two were checked
 * in the same response, otherwise they are inferring.
 */
export const CORE_HEALTH_INDICATOR_KEYS = Object.freeze([
  MONGO_HEALTH_KEY,
  REDIS_CACHE_HEALTH_KEY,
  REDIS_QUEUE_HEALTH_KEY,
] as const);

/**
 * Extension point for per-process readiness (D-10).
 *
 * `worker` contributes "every registered BullMQ Worker is listening" and
 * `scheduler` contributes "at least one Job Scheduler is registered and
 * running". Both are supplied as a provider of this token, so neither plan has
 * to edit the three core indicators to be added — the alternative is a
 * conditional in this controller keyed on which process is booting, which is
 * how three entrypoints drift into looking the same (FND-03).
 *
 * `@Optional()` because no process is obliged to provide it.
 */
export const EXTRA_HEALTH_INDICATORS = Symbol('EXTRA_HEALTH_INDICATORS');

/**
 * The shared liveness/readiness surface (FND-05).
 *
 * All three entrypoints mount this controller (D-09). `worker` and `scheduler`
 * mount *only* this and the metrics controller; FND-05 requires each of the
 * three to expose both endpoints, which is why they mount HTTP at all rather
 * than using `createApplicationContext()`.
 */
@Controller('health')
export class HealthController {
  readonly #mongo: MongoIndicator;
  readonly #cache: RedisIndicator;
  readonly #queue: RedisIndicator;
  readonly #extra: readonly HealthIndicatorFunction[];

  constructor(
    private readonly health: HealthCheckService,
    healthIndicator: HealthIndicatorService,
    @Inject(MONGO_CLIENT) mongo: MongoService,
    @Inject(REDIS_CACHE) cache: RedisPingClient,
    @Inject(REDIS_QUEUE) queue: RedisPingClient,
    @Optional()
    @Inject(EXTRA_HEALTH_INDICATORS)
    extra?: readonly HealthIndicatorFunction[],
  ) {
    this.#mongo = new MongoIndicator(mongo, healthIndicator);
    this.#cache = new RedisIndicator(REDIS_CACHE_HEALTH_KEY, cache, healthIndicator);
    this.#queue = new RedisIndicator(REDIS_QUEUE_HEALTH_KEY, queue, healthIndicator);
    this.#extra = extra ?? [];
  }

  /**
   * Liveness reads **nothing** (D-10, T-1-17).
   *
   * This is the load-bearing asymmetry of the whole design. If liveness touched
   * a dependency, a 90-second Redis blip would fail liveness, the orchestrator
   * would restart a process that was perfectly healthy and had in-flight work,
   * and the blip would become a restart loop that outlives its own cause. The
   * blip fails *readiness* — traffic is withdrawn — and the pod keeps running.
   *
   * The body is a fixed literal, so it cannot leak anything by construction.
   */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness: MongoDB plus **both** Redis deployments, always (D-10, D-12).
   *
   * The indicators are constructed here rather than injected so the two Redis
   * deployments are bound to their names in exactly one place and cannot be
   * swapped at a call site. `HealthCheckService.check` throws
   * `ServiceUnavailableException` when any indicator is down, which is the 503
   * an operator's probe expects; the body carries the per-key flags and nothing
   * else (T-1-18).
   *
   * Each entry is a **function**, not the promise it returns. The executor
   * calls every entry (`h instanceof HealthCheckAttempt ? h : h()`), so handing
   * it a bare promise is a `TypeError` at request time — and it fails on the
   * all-dependencies-up path too, which is why a first attempt at this looked
   * like "500 everywhere" rather than "500 only when something is down".
   */
  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.#mongo.check(MONGO_HEALTH_KEY),
      () => this.#cache.check(REDIS_CACHE_HEALTH_KEY),
      () => this.#queue.check(REDIS_QUEUE_HEALTH_KEY),
      ...this.#extra,
    ]);
  }
}

export type { HealthIndicatorResult };
