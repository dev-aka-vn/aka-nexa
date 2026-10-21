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
      this.ensureIndexPromise = Promise.all([
        this.collection
          .createIndex({ timestamp: 1 }, { background: true })
          .then(() => undefined)
          .catch(() => undefined),
        this.collection
          .createIndex(
            { app_id: 1, timestamp: -1 },
            { background: true },
          )
          .then(() => undefined)
          .catch(() => undefined),
        this.collection
          .createIndex(
            { actor: 1, timestamp: -1 },
            { background: true },
          )
          .then(() => undefined)
          .catch(() => undefined),
        this.collection
          .createIndex(
            { action: 1, timestamp: -1 },
            { background: true },
          )
          .then(() => undefined)
          .catch(() => undefined),
      ]).then(() => undefined);
    }
    return this.ensureIndexPromise;
  }

  async append(entry: AuditEntry): Promise<void> {
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

  async findFiltered(filter: Record<string, unknown>): Promise<AuditEntry[]> {
    if (this.mongo === undefined) {
      return this.entries.filter((e) => matchesInMemory(e, filter));
    }
    await this.ensureIndex();
    return this.collection
      .find(filter as never)
      .sort({ timestamp: -1, _id: -1 } as never)
      .toArray();
  }

  async deleteOlderThan(cutoff: Date, batchSize: number): Promise<number> {
    if (this.mongo === undefined) {
      const before = this.entries.length;
      const kept = this.entries.filter((e) => new Date(e.timestamp as never) >= cutoff);
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

function matchesInMemory(e: AuditEntry, filter: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(filter)) {
    if (v === undefined) continue;
    if (k === 'timestamp' && typeof v === 'object' && v !== null) {
      const ts = new Date(e.timestamp as never).getTime();
      const f = v as { $gte?: Date; $lte?: Date };
      if (f.$gte && ts < new Date(f.$gte).getTime()) return false;
      if (f.$lte && ts > new Date(f.$lte).getTime()) return false;
      continue;
    }
    if ((e as unknown as Record<string, unknown>)[k] !== v) return false;
  }
  return true;
}

export { AuditEntry } from './audit-entry.js';
export type { AuditEntry as AuditEntryType } from './audit-entry.js';
