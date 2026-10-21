import type { Redis } from 'ioredis';
import type { ConfigService } from '@nestjs/config';

import { AuditRepository, type AuditEntry } from './audit.repository.js';

export const AUDIT_RETENTION_LOCK_KEY = 'audit:retention:lock';
export const AUDIT_RETENTION_LOCK_TTL_MS = 60_000;
export const AUDIT_RETENTION_BATCH_SIZE = 1000;

export interface AuditRetentionResult {
  readonly skipped?: boolean;
  readonly reason?: string;
  readonly deleted?: number;
  readonly cutoff?: Date;
}

export class AuditRetentionService {
  private readonly retentionDays: number;
  private readonly now: () => number;

  constructor(
    private readonly audit: AuditRepository,
    private readonly redis: Redis,
    retentionDaysOrConfig: number | ConfigService = 1095,
    now: () => number = () => Date.now(),
  ) {
    this.retentionDays =
      typeof retentionDaysOrConfig === 'number'
        ? retentionDaysOrConfig
        : Number(
            retentionDaysOrConfig.get<number>('AUDIT_RETENTION_DAYS') ?? 1095,
          );
    this.now = now;
  }

  async run(now?: number | Date): Promise<AuditRetentionResult> {
    const nowMs =
      now === undefined
        ? this.now()
        : now instanceof Date
          ? now.getTime()
          : now;
    const lockValue = String(nowMs);
    const acquired = await this.redis.set(
      AUDIT_RETENTION_LOCK_KEY,
      lockValue,
      'PX',
      AUDIT_RETENTION_LOCK_TTL_MS,
      'NX',
    );
    if (acquired !== 'OK') {
      return { skipped: true, reason: 'lock-held' };
    }
    try {
      const cutoff = new Date(nowMs - this.retentionDays * 86_400_000);
      const deleted = await this.audit.deleteOlderThan(
        cutoff,
        AUDIT_RETENTION_BATCH_SIZE,
      );
      if (deleted > 0) {
        const entry: AuditEntry & { [k: string]: unknown } = {
          timestamp: new Date(nowMs),
          actor: 'system',
          action: 'audit.retention.swept',
          target: 'audit_entries',
          previous_state: cutoff.toISOString(),
          new_state: String(deleted),
          operator: 'system',
        };
        await this.audit.append(entry);
      }
      return { deleted, cutoff };
    } finally {
      await this.redis.del(AUDIT_RETENTION_LOCK_KEY);
    }
  }
}
