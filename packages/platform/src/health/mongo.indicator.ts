import type { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import type { MongoService } from '../mongo/mongo.service.js';

/** The readiness key for the MongoDB dependency. */
export const MONGO_HEALTH_KEY = 'mongo';

/**
 * MongoDB readiness (FND-05, T-1-18).
 *
 * ## The catch is the security control, not error handling
 *
 * `@nestjs/terminus`'s executor re-throws anything an indicator function
 * rejects, which turns a downed MongoDB into a **500** instead of the 503 an
 * operator's probe is looking for. Catching here is therefore required for
 * correctness.
 *
 * Catching here is *also* what keeps T-1-18 true. A
 * `MongoServerSelectionError` embeds the seed address, the resolved member
 * list, and — when the URL carries credentials — the whole connection string.
 * The readiness body is served to whoever can reach the port, and no probe
 * endpoint is authenticated. So the failure is reduced to a bare `down` flag
 * and the message is dropped. The detail an operator actually needs ("which
 * dependency") is the *key*, which is in the body; the part that leaks
 * ("where it is") is not.
 */
export class MongoIndicator {
  constructor(
    private readonly mongo: MongoService,
    private readonly healthIndicator: HealthIndicatorService,
  ) {}

  /**
   * @param key defaults to `mongo`; a caller may pass another key when the
   *   same service backs more than one readiness entry.
   */
  async check(key: string = MONGO_HEALTH_KEY): Promise<HealthIndicatorResult> {
    const session = this.healthIndicator.check(key);
    try {
      await this.mongo.ping();
      return session.up();
    } catch {
      return session.down();
    }
  }
}
