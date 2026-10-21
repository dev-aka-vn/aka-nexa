import { MongoService } from '@akane/platform';
import { AuditRepository, type AuditEntry } from './audit.repository.js';

export interface AccessReviewRole {
  role: string;
  members: string[];
}

export interface AccessReviewApp {
  app_id: string;
  name?: string;
  roles: AccessReviewRole[];
}

export interface AccessReviewReport {
  quarter: string;
  generated_at: string;
  apps: AccessReviewApp[];
  role_count: number;
  member_count: number;
}

export class AccessReviewService {
  private readonly mongo?: MongoService;
  private readonly audit?: AuditRepository;
  private readonly now: () => number;

  constructor(...args: unknown[]) {
    let now: (() => number) | undefined;
    for (const a of args) {
      if (a && typeof (a as { db?: unknown }).db === 'function') this.mongo = a as MongoService;
      else if (a && typeof (a as { append?: unknown }).append === 'function') this.audit = a as AuditRepository;
      else if (typeof a === 'function') now = a as () => number;
    }
    this.now = now ?? (() => Date.now());
  }

  private get db() {
    if (!this.mongo) throw new Error('AccessReviewService: no MongoService');
    return this.mongo.db();
  }

  quarterFor(date: Date): string {
    const y = date.getUTCFullYear();
    const q = Math.floor(date.getUTCMonth() / 3) + 1;
    return `${y}-Q${q}`;
  }

  async computeReport(now?: Date): Promise<AccessReviewReport> {
    const d = now ?? new Date(this.now());
    const quarter = this.quarterFor(d);
    const apps: AccessReviewApp[] = [];
    let roleCount = 0;
    let memberCount = 0;
    try {
      const docs = await this.db.collection('apps').find({}).toArray();
      for (const doc of docs as Record<string, unknown>[]) {
        const appId = String(doc.app_id ?? doc._id ?? '');
        const name = typeof doc.name === 'string' ? doc.name : undefined;
        const ra = (doc.role_assignments as Record<string, string> | null) ?? {};
        const byRole: Record<string, string[]> = {};
        for (const [user, role] of Object.entries(ra ?? {})) {
          if (!byRole[role]) byRole[role] = [];
          byRole[role].push(user);
        }
        const roles: AccessReviewRole[] = Object.entries(byRole).map(([role, members]) => {
          roleCount += 1;
          memberCount += members.length;
          return { role, members };
        });
        apps.push({ app_id: appId, name, roles });
      }
    } catch {
      // ignore
    }
    return {
      quarter,
      generated_at: d.toISOString(),
      apps,
      role_count: roleCount,
      member_count: memberCount,
    };
  }

  async generate(quarterOrNow?: string | Date, now?: Date): Promise<AccessReviewReport> {
    let when = now;
    let quarter: string | undefined;
    if (quarterOrNow instanceof Date) when = quarterOrNow;
    else if (typeof quarterOrNow === 'string') quarter = quarterOrNow;
    const d = when ?? new Date(this.now());
    const report = await this.computeReport(d);
    if (quarter) report.quarter = quarter;
    // store
    await this.db.collection('access_reviews').updateOne(
      { quarter: report.quarter },
      { $set: { quarter: report.quarter, report, generated_at: report.generated_at } },
      { upsert: true },
    );
    // audit entry
    if (this.audit) {
      await this.audit.append({
        timestamp: d,
        actor: 'system',
        action: 'access_review.generated',
        target: 'access_reviews',
        count: report.role_count,
      } as AuditEntry);
    }
    return report;
  }

  async run(now?: Date): Promise<AccessReviewReport> {
    return this.generate(now);
  }

  async generateQuarterly(now?: Date): Promise<AccessReviewReport> {
    return this.generate(now);
  }

  async getReport(quarter?: string): Promise<AccessReviewReport | null> {
    try {
      const q = quarter ?? this.quarterFor(new Date(this.now()));
      const doc = await this.db.collection('access_reviews').findOne({ quarter: q });
      if (!doc) return null;
      return (doc as { report?: AccessReviewReport }).report ?? (doc as unknown as AccessReviewReport);
    } catch {
      return null;
    }
  }

  async getLatest(): Promise<AccessReviewReport | null> {
    try {
      const docs = await this.db.collection('access_reviews').find({}).sort({ generated_at: -1 }).limit(1).toArray();
      if (docs.length === 0) return null;
      const doc = docs[0] as { report?: AccessReviewReport };
      return doc.report ?? (doc as unknown as AccessReviewReport);
    } catch {
      return null;
    }
  }

  async listReports(): Promise<AccessReviewReport[]> {
    try {
      const docs = await this.db.collection('access_reviews').find({}).toArray();
      return docs.map((d) => (d as { report?: AccessReviewReport }).report ?? (d as unknown as AccessReviewReport));
    } catch {
      return [];
    }
  }
}

export default AccessReviewService;
