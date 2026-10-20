export interface AuditEntry {
  timestamp: Date;
  actor: string;
  action: string;
  target: string;
  previous_state?: string;
  new_state?: string;
  ip?: string;
  request_id?: string;
  operator?: string;
}
