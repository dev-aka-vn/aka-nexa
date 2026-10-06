export interface AuditEntry {
  timestamp: Date;
  actor: string;
  action: string;
  target: string;
  previous_state?: string;
  new_state?: string;
  ip?: string;
  request_id?: string;
  [key: string]: any;
}

export class AuditRepository {
  private entries: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    const copy: AuditEntry = {
      ...entry,
      timestamp: entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp),
    };
    this.entries.push(copy);
  }

  async findAll(): Promise<AuditEntry[]> {
    return [...this.entries];
  }

  async count(): Promise<number> {
    return this.entries.length;
  }

  // AUD-01: append-only - no update or delete operations
  // This is enforced structurally by not providing update/delete methods
}
