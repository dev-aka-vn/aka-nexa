import { MongoService } from '@akane/platform';

import { AuditEntry } from './audit-entry.js';

export class AuditRepository {
  private readonly mongo?: MongoService;
  private readonly entries: AuditEntry[] = [];

  private ensureIndexPromise: Promise<void> | null = null;

  constructor(mongo?: MongoService) {
    this.mongo = mongo;
  }

  private get collection() {
    if (this.mongo === undefined) {
      throw new Error('AuditRepository: no MongoService available');
    }
    return this.mongo.db().collection<AuditEntry>('audit_entries');
  }

  private ensureIndex(): Promise<void> {
    if (this.mongo === undefined) {
      return Promise.resolve();
    }
    if (this.ensureIndexPromise === null) {
      this.ensureIndexPromise = this.collection
        .createIndex({ timestamp: 1 }, { background: true })
        .then(() => undefined)
        .catch(() => undefined);
    }
    return this.ensureIndexPromise;
  }

  async append(entry: AuditEntry & { [k: string]: unknown }): Promise<void> {
    const copy: AuditEntry = {
      ...entry,
      timestamp:
        entry.timestamp instanceof Date
          ? entry.timestamp
          : new Date(entry.timestamp as unknown as string),
    };
    if (this.mongo === undefined) {
      this.entries.push(copy);
      return;
    }
    await this.ensureIndex();
    await this.collection.insertOne(copy as never);
  }

  async findAll(): Promise<AuditEntry[]> {
    if (this.mongo === undefined) {
      return [...this.entries];
    }
    await this.ensureIndex();
    return this.collection.find({}).toArray();
  }

  async count(): Promise<number> {
    if (this.mongo === undefined) {
      return this.entries.length;
    }
    await this.ensureIndex();
    return this.collection.countDocuments({});
  }

  async deleteOlderThan(cutoff: Date, batchSize: number): Promise<number> {
    if (this.mongo === undefined) {
      const before = this.entries.length;
      const kept = this.entries.filter((e) => e.timestamp >= cutoff);
      const deleted = before - kept.length;
      this.entries.length = 0;
      this.entries.push(...kept);
      return deleted;
    }
    await this.ensureIndex();
    let total = 0;
    while (true) {
      const docs = await this.collection
        .find({ timestamp: { $lt: cutoff } })
        .sort({ _id: 1 })
        .limit(batchSize)
        .project({ _id: 1 })
        .toArray();
      if (docs.length === 0) break;
      const ids = docs.map((d) => d._id);
      const result = await this.collection.deleteMany({ _id: { $in: ids } });
      total += result.deletedCount ?? 0;
    }
    return total;
  }
}

export { AuditEntry } from './audit-entry.js';
export type { AuditEntry as AuditEntryType } from './audit-entry.js';
