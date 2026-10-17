/**
 * "My submissions" status list (Surface A) and the shared submission-status
 * mapping used by the read-only detail (Surface B).
 *
 * Contract: `05-UI-SPEC.md` §A/§B, `05-CONTEXT.md` D-80/D-81/D-82, `DAT-14`.
 *
 * This module is deliberately DOM-free at import time so it is testable in a
 * Node environment: the pure mapping/copy/pagination helpers are exported and
 * the browser entry (called from `status.html`) is a guarded function.
 */

/** The `Submission.status` union (D-82 / submission.repository.ts). */
export type SubmissionStatus =
  | 'completed'
  | 'partial'
  | 'pending_external'
  | 'failed';

/** One projected row from `GET /l/query/:jti` (the frozen `query` action). */
export interface StatusRow {
  app_id?: string;
  form_id?: string;
  /** Human label of the form; falls back to `form_id`. */
  form_label?: string;
  form_version?: number;
  submittedAt?: string | Date;
  submitted_at?: string | Date;
  status: SubmissionStatus;
  /** Server-projected destination phrase (used as a fallback). */
  destination?: string;
  downstreamRef?: string | null;
  reason?: string;
  /** Connector display name; the projection defaults to "Connector". */
  connector?: string;
  /** Whether the row belongs to the link's `sub` (D-79/D-80). */
  owned?: boolean;
  submission_id?: string;
}

export interface SavedQueryInfo {
  query_id?: string;
  query_version?: number;
  limit?: number;
  offset?: number;
  total?: number;
  dsl?: unknown;
}

export interface StatusPayload {
  claims?: Record<string, unknown>;
  savedQuery?: SavedQueryInfo | null;
  rows?: StatusRow[];
}

export interface StatusBadge {
  className: string;
  label: string;
}

/** Surface A status → badge class/label map (05-UI-SPEC §A). */
const STATUS_BADGES: Record<SubmissionStatus, StatusBadge> = {
  completed: { className: 'badge-completed', label: 'Completed' },
  partial: { className: 'badge-partial', label: 'Partial' },
  pending_external: { className: 'badge-pending', label: 'Pending external' },
  failed: { className: 'badge-failed', label: 'Failed' },
};

export function statusToBadge(status: SubmissionStatus): StatusBadge {
  return STATUS_BADGES[status] ?? STATUS_BADGES.failed;
}

export const DEFAULT_CONNECTOR = 'Connector';

/** The safe, connector-generic failure sentence (D-82 / D-43 / W-22). */
export function safeFailureReason(connector: string): string {
  return `This submission couldn't be delivered to ${connector}. Our team has been notified.`;
}

/** Surface A destination phrase (05-UI-SPEC §A, D-81/D-82). */
export function destinationPhrase(row: StatusRow): string {
  const connector = row.connector ?? DEFAULT_CONNECTOR;
  switch (row.status) {
    case 'partial':
      return `Internal saved · ${connector}: retrying`;
    case 'pending_external':
      return `${connector}: sending`;
    case 'completed':
      return row.downstreamRef ? `${connector} · ${row.downstreamRef}` : 'Internal saved';
    case 'failed':
      return row.reason ?? row.destination ?? safeFailureReason(connector);
    default:
      return row.destination ?? safeFailureReason(connector);
  }
}

/** The empty-state contract (05-UI-SPEC Copywriting Contract). */
export const EMPTY_STATE = {
  heading: 'No submissions yet',
  body: 'Nothing has been submitted for this app yet. Start one from chat and it will appear here.',
} as const;

/** The list-load failure copy (05-UI-SPEC Copywriting Contract). */
export const LIST_LOAD_ERROR =
  "Couldn't load your submissions. Request a new status link in chat and try again.";

export interface PageWindow {
  start: number;
  end: number;
  total: number;
  hasMore: boolean;
  label: string;
}

/**
 * The server-side pagination window. `hasMore` drives the accent "Load more"
 * button; `label` is the "Showing {start}–{end} of {total}" footer.
 */
export function computePageWindow(offset: number, limit: number, total: number): PageWindow {
  const safeTotal = Math.max(0, Math.trunc(total) || 0);
  const safeOffset = Math.max(0, Math.trunc(offset) || 0);
  const safeLimit = Math.max(1, Math.trunc(limit) || 1);
  const start = safeTotal === 0 ? 0 : Math.min(safeOffset + 1, safeTotal);
  const end = Math.min(safeOffset + safeLimit, safeTotal);
  const hasMore = safeOffset + safeLimit < safeTotal;
  const label = safeTotal === 0 ? '' : `Showing ${start}–${end} of ${safeTotal}`;
  return { start, end, total: safeTotal, hasMore, label };
}

/** Optional status-filter rail (05-UI-SPEC §A "Filtering by status"). */
export const STATUS_FILTERS = [
  { status: 'all', label: 'All' },
  { status: 'completed', label: 'Completed' },
  { status: 'partial', label: 'Partial' },
  { status: 'pending_external', label: 'Pending external' },
  { status: 'failed', label: 'Failed' },
] as const;

export type StatusFilter = (typeof STATUS_FILTERS)[number]['status'];

export function filterRowsByStatus(
  rows: readonly StatusRow[],
  filter: StatusFilter,
): StatusRow[] {
  if (filter === 'all') {
    return [...rows];
  }
  return rows.filter((row) => row.status === filter);
}

export function isOwned(row: StatusRow): boolean {
  return row.owned !== false;
}

/** The owner-only "Edit submission" affordance (D-93, 05-UI-SPEC §A). */
export function canEdit(row: StatusRow): boolean {
  return isOwned(row);
}

export function isEmpty(rows: readonly StatusRow[] | null | undefined): boolean {
  return !rows || rows.length === 0;
}

/** D-81: no user-facing retry control exists on any Phase 5 user surface. */
export function hasRetryControl(): boolean {
  return false;
}

/** `YYYY-MM-DD` (UTC) for the Submitted column; '' when absent. */
export function formatSubmittedAt(value: string | Date | undefined): string {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString().slice(0, 10);
}

export interface DetailSummaryInput {
  status?: SubmissionStatus;
  destination?: string;
  downstreamRef?: string | null;
  reason?: string;
  connector?: string;
  submittedAt?: string | Date;
}

export interface DetailCallout {
  kind: 'warn' | 'danger';
  text: string;
  detail?: string;
}

export interface DetailSummary {
  badge: StatusBadge;
  destination: string;
  submittedLabel: string;
  callout: DetailCallout | null;
}

/**
 * Detail-page status summary (Surface B). `partial` → a read-only warn callout;
 * `failed` → a danger callout with the user-safe reason. Neither carries a
 * retry control (D-81).
 */
export function buildDetailSummary(input: DetailSummaryInput): DetailSummary {
  const status = input.status ?? 'completed';
  const connector = input.connector ?? DEFAULT_CONNECTOR;
  const row: StatusRow = {
    status,
    connector,
    downstreamRef: input.downstreamRef ?? null,
    reason: input.reason,
    destination: input.destination,
  };
  const destination = destinationPhrase(row);
  const submittedLabel = formatSubmittedAt(input.submittedAt);

  let callout: DetailCallout | null = null;
  if (status === 'partial') {
    callout = {
      kind: 'warn',
      text: destination,
      detail: `The internal record is saved; the ${connector} copy is still being delivered.`,
    };
  } else if (status === 'failed') {
    callout = {
      kind: 'danger',
      text: destination,
      detail: 'Request a new link in chat if you need to submit again.',
    };
  }

  return { badge: statusToBadge(status), destination, submittedLabel, callout };
}

// ---------------------------------------------------------------------------
// Browser entry (Surface A). Called from status.html; never at import time.
// ---------------------------------------------------------------------------

interface BrowserDeps {
  apiOrigin?: string;
  token?: string;
  jti?: string;
  fetchImpl?: typeof fetch;
}

/** Resolve the API origin the same way view.browser.ts does. */
export function resolveApiOrigin(origin: string): string {
  return origin.replace('renderer', 'api') || origin;
}

export interface StatusQueryResult {
  kind: 'rows' | 'empty' | 'denied' | 'error';
  payload?: StatusPayload;
  reason?: string;
}

/** Pure classifier for the status fetch (keeps the fetch handler thin). */
export function classifyStatusResponse(
  httpStatus: number,
  payload: StatusPayload | null,
): StatusQueryResult {
  if (httpStatus >= 400) {
    return { kind: 'error' };
  }
  if (!payload) {
    return { kind: 'error' };
  }
  const rows = payload.rows ?? [];
  return { kind: rows.length === 0 ? 'empty' : 'rows', payload };
}

/**
 * Browser-only loader. Serves the page from the frozen `query` read-link
 * action. Kept guarded so importing this module in Node is safe.
 */
export async function loadStatus(deps: BrowserDeps): Promise<StatusQueryResult> {
  const fetchImpl = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!fetchImpl || !deps.token) {
    return { kind: 'error' };
  }
  try {
    const res = await fetchImpl(
      `${deps.apiOrigin}/l/query/${deps.jti ?? ''}?token=${encodeURIComponent(deps.token)}`,
      { credentials: 'same-origin' },
    );
    if (res.status === 302) {
      const location = res.headers.get('location') ?? '';
      const reason = new URL(location, deps.apiOrigin ?? 'https://render.example').searchParams.get(
        'reason',
      );
      return { kind: 'denied', reason: reason ?? undefined };
    }
    const payload = res.ok ? ((await res.json()) as StatusPayload) : null;
    return classifyStatusResponse(res.status, payload);
  } catch {
    return { kind: 'error' };
  }
}
