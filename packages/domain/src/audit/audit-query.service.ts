import { AuditRepository, type AuditEntry } from './audit.repository.js';

export interface AuditQueryFilters {
  user?: string;
  app_id?: string;
  action?: string;
  from?: Date | string;
  to?: Date | string;
  actor?: string;
  target?: string;
}

export interface AuditQueryPaging {
  limit?: number;
  offset?: number;
}

export interface AuditQueryResult {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

export class AuditQueryService {
  private readonly audit: AuditRepository;
  private readonly now: () => number;

  constructor(audit: AuditRepository, now: () => number = () => Date.now()) {
    this.audit = audit;
    this.now = now;
  }

  private normalizeString(v: unknown): string | undefined {
    if (typeof v !== 'string') return v === undefined ? undefined : (v as string);
    const t = v.trim();
    return t.length === 0 ? undefined : t;
  }

  private toDate(v: unknown, endOfDay: boolean): Date | undefined {
    if (v === undefined || v === null || v === '') return undefined;
    if (v instanceof Date) {
      if (endOfDay && v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0 && v.getUTCMilliseconds() === 0) {
        const d = new Date(v.getTime());
        d.setUTCHours(23, 59, 59, 999);
        return d;
      }
      return v;
    }
    const s = String(v);
    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return new Date(s + 'T23:59:59.999Z');
    }
    return new Date(s);
  }

  normalize(filters: AuditQueryFilters): AuditQueryFilters {
    const f: AuditQueryFilters = { ...filters };
    f.user = this.normalizeString(f.user) as string | undefined;
    f.action = this.normalizeString(f.action) as string | undefined;
    if (f.user !== undefined) f.actor = f.user;
    return f;
  }

  buildMongoFilter(filters: AuditQueryFilters): Record<string, unknown> {
    const n = this.normalize(filters);
    const filter: Record<string, unknown> = {};
    const actor = n.user ?? n.actor;
    if (actor !== undefined) filter.actor = actor;
    if (n.app_id !== undefined && String(n.app_id).trim() !== '') filter.app_id = n.app_id;
    if (n.action !== undefined) filter.action = n.action;
    const from = this.toDate(n.from, false);
    const to = this.toDate(n.to, true);
    if (from !== undefined || to !== undefined) {
      const ts: Record<string, unknown> = {};
      if (from !== undefined) ts.$gte = from;
      if (to !== undefined) ts.$lte = to;
      filter.timestamp = ts;
    }
    if (n.target !== undefined) filter.target = n.target;
    return filter;
  }

  async search(filters: AuditQueryFilters = {}, paging: AuditQueryPaging = {}): Promise<AuditQueryResult> {
    const limit = paging.limit ?? 20;
    const offset = paging.offset ?? 0;
    const mongoFilter = this.buildMongoFilter(filters);
    const all = await this.audit.findFiltered(mongoFilter);
    all.sort((left, right) => {
      const dt = new Date(right.timestamp as never).getTime() - new Date(left.timestamp as never).getTime();
      if (dt !== 0) return dt;
      return String((right as { _id?: unknown })._id ?? '').localeCompare(String((left as { _id?: unknown })._id ?? ''));
    });
    const total = all.length;
    const entries = all.slice(offset, offset + limit);
    return { entries, total, limit, offset };
  }

  // aliases
  async query(filters: AuditQueryFilters = {}, paging: AuditQueryPaging = {}): Promise<AuditQueryResult> {
    return this.search(filters, paging);
  }
  async find(filters: AuditQueryFilters = {}, paging: AuditQueryPaging = {}): Promise<AuditQueryResult> {
    return this.search(filters, paging);
  }
}

export default AuditQueryService;
