import { Controller, Get } from '@nestjs/common';

/** Skeleton — RED phase. */
export const MONGO_HEALTH_KEY = 'mongo';
export const REDIS_CACHE_HEALTH_KEY = 'redis_cache';
export const REDIS_QUEUE_HEALTH_KEY = 'redis_queue';
export const CORE_HEALTH_INDICATOR_KEYS: readonly string[] = Object.freeze([
  MONGO_HEALTH_KEY,
  REDIS_CACHE_HEALTH_KEY,
  REDIS_QUEUE_HEALTH_KEY,
]);
export const EXTRA_HEALTH_INDICATORS = Symbol('EXTRA_HEALTH_INDICATORS');

@Controller('health')
export class HealthController {
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  ready(): unknown {
    throw new Error('HealthController.ready: not implemented');
  }
}
