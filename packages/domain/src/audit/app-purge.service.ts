import type { ConfigService } from '@nestjs/config';

import { MongoService } from '@akane/platform';
import { AuditRepository, type AuditEntry } from './audit.repository.js';

export class AppPurgeService {
  private readonly graceDays: number;
  private readonly now: () => number;

  constructor(
    private readonly mongo: MongoService,
    private readonly audit: AuditRepository,
    graceDaysOrConfig: number | ConfigService = 30,
    now: () => number = () => Date.now(),
  ) {
    this.graceDays =
      typeof graceDaysOrConfig === 'number'
        ? graceDaysOrConfig
        : Number(graceDaysOrConfig.get<number>('PURGE_GRACE_DAYS') ?? 30);
    this.now = now;
  }

  async softDelete(appId: string, operatorId: string): Promise<void> {
    const nowMs = this.now();
    const requestedAt = new Date(nowMs);
    const executeAfter = new Date(nowMs + this.graceDays * 86_400_000);
    await this.mongo
      .db()
      .collection('apps')
      .updateOne(
        { app_id: appId },
        {
          $set: {
            lifecycle: 'purged',
            requested_at: requestedAt,
            operator_id: operatorId,
            execute_after: executeAfter,
            executed_at: null,
            updatedAt: new Date(nowMs),
          },
        },
      );
  }

  async executeDue(now?: number | Date): Promise<{ deleted: number }> {
    const nowMs =
      now === undefined
        ? this.now()
        : now instanceof Date
          ? now.getTime()
          : now;
    const nowDate = new Date(nowMs);
    const collection = this.mongo.db().collection('apps');
    const due = await collection
      .find({
        lifecycle: 'purged',
        executed_at: null,
        execute_after: { $lte: nowDate },
      })
      .toArray();
    let deleted = 0;
    for (const app of due) {
      const appId = (app as unknown as { app_id: string }).app_id;
      const operatorId = (app as unknown as { operator_id?: string }).operator_id ?? 'system';
      await collection.updateOne(
        { app_id: appId },
        { $set: { executed_at: nowDate } },
      );
      const entry: AuditEntry & { [k: string]: unknown } = {
        timestamp: nowDate,
        actor: operatorId,
        action: 'purge.executed',
        target: appId,
        operator: operatorId,
      };
      await this.audit.append(entry);
      deleted += 1;
    }
    return { deleted };
  }
}
