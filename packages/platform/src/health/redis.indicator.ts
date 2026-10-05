import type { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

/**
 * The narrow slice of an ioredis client this indicator needs.
 *
 * Declared structurally rather than importing the concrete `Redis` class so the
 * indicator is testable without a socket, and so the DI token's type is not
 * widened into a promise to support every ioredis feature.
 */
export interface RedisPingClient {
  ping(): Promise<string>;
}

/** The only reply a Redis server gives to `PING` that means it is healthy. */
const PONG = 'PONG';

/**
 * Readiness for ONE Redis deployment (FND-05, D-10, D-12, T-1-18).
 *
 * ## One class, two deployments
 *
 * The constructor takes the deployment's *name*, and that name is the readiness
 * key. This is what makes the cache/queue split diagnosable: an operator sees
 * `redis_queue: down`, not a single collapsed `redis: down` that leaves them
 * guessing which deployment to page about. Collapsing the two is precisely the
 * anti-pattern D-10 rules out.
 *
 * The same reasoning applies to the error: an ioredis `ReplyError` carries the
 * host and port it failed against, and a `RedisClosedError` can carry the
 * options object. Both are dropped — see `MongoIndicator` for the full
 * argument.
 */
export class RedisIndicator {
  constructor(
    readonly name: string,
    private readonly client: RedisPingClient,
    private readonly healthIndicator: HealthIndicatorService,
  ) {}

  /**
   * @param key defaults to the deployment name. The parameter exists so a
   *   caller can disambiguate a second entry backed by the same client, which
   *   is a monitoring question, not a topology one.
   */
  async check(key: string = this.name): Promise<HealthIndicatorResult> {
    const session = this.healthIndicator.check(key);
    try {
      // A reply that is not `PONG` means something is answering on the socket
      // but is not a healthy Redis — a proxy, a stale connection reused across
      // a failover. Treating any reply as success would report a wrong
      // deployment as healthy.
      const reply = await this.client.ping();
      return reply === PONG ? session.up() : session.down();
    } catch {
      return session.down();
    }
  }
}
