export interface ThrottlerStorage {
  increment(key: string, ttl: number): Promise<{ totalHits: number; timeToExpire: number }>;
}

export class ThrottlerStorageRedis implements ThrottlerStorage {
  private storage = new Map<string, { count: number; expires: number }>();

  async increment(key: string, ttl: number): Promise<{ totalHits: number; timeToExpire: number }> {
    const now = Date.now();
    const entry = this.storage.get(key);

    if (!entry || entry.expires <= now) {
      const expires = now + ttl * 1000;
      this.storage.set(key, { count: 1, expires });
      return { totalHits: 1, timeToExpire: Math.ceil((expires - now) / 1000) };
    }

    entry.count += 1;
    const timeToExpire = Math.ceil((entry.expires - now) / 1000);
    return { totalHits: entry.count, timeToExpire };
  }
}
