export interface AuditEntry {
  timestamp: Date | string;
  actor: string;
  action: string;
  target: string;
  app_id?: string;
  previous_state?: string;
  new_state?: string;
  ip?: string;
  user_agent?: string;
  request_id?: string;
  operator?: string;
  // Formerly ad-hoc keys, now typed (D-06 closed shape).
  attempts?: number;
  changeSummary?: unknown;
  connector_id?: string;
  credential_ref?: string;
  failureReason?: string;
  field_count?: number;
  filters?: unknown;
  form?: string;
  from?: string;
  from_user_id?: string;
  mechanism?: string;
  noticeError?: string;
  noticeFailed?: boolean;
  previous_request_id?: string;
  realUserId?: string;
  reference?: string;
  row_count?: number;
  section?: string;
  source_version?: string | number;
  status?: string;
  to?: string;
  to_user_id?: string;
  transfer_id?: string;
  updatedBy?: string;
  zero_change?: boolean;
  // Erasure (D-07/D-08).
  ticket_ref?: string;
  ticket?: string;
  ticket_reference?: string;
  actor_ref?: string | null;
  unlisted_extra?: unknown;
  reason?: string;
  connectorId?: string;
  from_user_ref?: string | null;
  to_user_ref?: string | null;
  updated_by_ref?: string | null;
  // Access review.
  count?: number;
}
