/**
 * DI tokens for the two Redis deployments (D-12). They are separate symbols so
 * a provider cannot satisfy one with the other, and a future `RedisCache`
 * wrapper has a distinct injection point from the queue connection.
 */
export const REDIS_CACHE = Symbol('REDIS_CACHE');
export const REDIS_QUEUE = Symbol('REDIS_QUEUE');
