import type { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import type { MongoService } from '../mongo/mongo.service.js';

/** Skeleton — RED phase. */
export const MONGO_HEALTH_KEY = 'mongo';

export class MongoIndicator {
  constructor(
    readonly mongo: MongoService,
    readonly healthIndicator: HealthIndicatorService,
  ) {}

  async check(_key: string = MONGO_HEALTH_KEY): Promise<HealthIndicatorResult> {
    throw new Error('MongoIndicator: not implemented');
  }
}
