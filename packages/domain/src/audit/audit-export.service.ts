import { AuditRepository, type AuditEntry } from './audit.repository.js';
import { AuditQueryService, type AuditQueryFilters } from './audit-query.service.js';

export interface AuditExportResult {
  body: string;
  content: string;
  text: string;
  data: string;
  jsonl: string;
  rowCount: number;
  count: number;
  rows: AuditEntry[];
}

export class AuditExportService {
  private readonly audit: AuditRepository;
  private readonly query: AuditQueryService;

  constructor(auditOrQuery: AuditRepository | AuditQueryService, maybeQuery?: AuditQueryService) {
    if (auditOrQuery instanceof AuditQueryService) {
      this.query = auditOrQuery;
      this.audit = (auditOrQuery as unknown as { audit: AuditRepository }).audit ?? new AuditRepository();
    } else {
      this.audit = auditOrQuery as AuditRepository;
      this.query = maybeQuery ?? new AuditQueryService(this.audit);
    }
  }

  async export(filters: AuditQueryFilters = {}): Promise<AuditExportResult> {
    return this.exportJsonl(filters);
  }

  async exportJsonl(filters: AuditQueryFilters = {}): Promise<AuditExportResult> {
    const mongoFilter = this.query.buildMongoFilter(filters);
    const rows = await this.audit.findFiltered(mongoFilter);
    rows.sort((left, right) => new Date(right.timestamp as never).getTime() - new Date(left.timestamp as never).getTime());
    const lines = rows.map((entry) => JSON.stringify(stripUndefined(entry)));
    const body = lines.length === 0 ? '' : lines.join('\n') + '\n';
    return {
      body,
      content: body,
      text: body,
      data: body,
      jsonl: body,
      rowCount: rows.length,
      count: rows.length,
      rows,
    };
  }

  async exportAudit(filters: AuditQueryFilters = {}): Promise<AuditExportResult> {
    return this.exportJsonl(filters);
  }
}

function stripUndefined(entry: AuditEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) {
    if (v === undefined) continue;
    if (v instanceof Date) out[k] = v.toISOString();
    else out[k] = v;
  }
  return out;
}

export default AuditExportService;
