import type { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

/** Skeleton — RED phase. */
export interface RedisPingClient {
  ping(): Promise<string>;
}

export class RedisIndicator {
  constructor(
    readonly name: string,
    readonly client: RedisPingClient,
    readonly healthIndicator: HealthIndicatorService,
  ) {}

  async check(_key: string = this.name): Promise<HealthIndicatorResult> {
    throw new Error('RedisIndicator: not implemented');
  }
}
