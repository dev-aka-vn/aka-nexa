import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { RedisCache } from '@akane/platform/cache/redis-cache.js';

const NONCE_KEY_PREFIX = 'webhook:nonce:';
const DEFAULT_SKEW_SECONDS = 300; // ±5 minutes as per A3 in research

/**
 * Nonce store for replay protection of inbound external webhooks.
 *
 * Uses Redis SET NX EX for atomic check-and-store with TTL matching
 * timestamp skew window (prevents replay attacks per NOT-02).
 */
@Injectable()
export class NonceStoreService {
  constructor(private readonly cache: RedisCache) {}

  async checkAndStoreNonce(nonce: string, timestamp: string): Promise<void> {
    if (!nonce || !timestamp) {
      throw new UnauthorizedException('Missing nonce or timestamp');
    }

    const windowSeconds = DEFAULT_SKEW_SECONDS;
    const key = `${NONCE_KEY_PREFIX}${nonce}`;
    
    // Check timestamp skew
    const now = Date.now();
    const eventTime = Date.parse(timestamp);
    if (Number.isNaN(eventTime) || Math.abs(now - eventTime) > windowSeconds * 1000) {
      throw new UnauthorizedException('Timestamp skew too large');
    }
    
    // Atomic check and store: SET NX EX
    const stored = await this.cache.set(key, '1', windowSeconds, 'NX');
    if (stored !== true && stored !== 'OK') {
      throw new UnauthorizedException('Nonce already used (replay detected)');
    }
  }
}
