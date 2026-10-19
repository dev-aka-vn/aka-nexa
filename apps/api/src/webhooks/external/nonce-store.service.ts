import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Redis } from 'ioredis';

import { REDIS_CACHE } from '@akane/platform';

const NONCE_KEY_PREFIX = 'webhook:nonce:';
const DEFAULT_SKEW_SECONDS = 300; // ±5 minutes as per A3 in research

/**
 * Nonce store for replay protection of inbound external webhooks.
 *
 * Uses Redis SET NX EX for atomic check-and-store with TTL matching
 * timestamp skew window (prevents replay attacks per NOT-02).
 *
 * The cache connection is injected through the `REDIS_CACHE` token — the same
 * DI symbol the platform's cache provider registers (D-12) — rather than a
 * bespoke cache wrapper, so this store shares the one cache deployment the
 * process already opens.
 */
@Injectable()
export class NonceStoreService {
  constructor(@Inject(REDIS_CACHE) private readonly redis: Redis) {}

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
    
    // Atomic check and store: SET NX EX. `'OK'` is the only successful reply —
    // a `null` reply means the key already existed, i.e. the nonce was replayed.
    const stored = await this.redis.set(key, '1', 'EX', windowSeconds, 'NX');
    if (stored !== 'OK') {
      throw new UnauthorizedException('Nonce already used (replay detected)');
    }
  }
}
