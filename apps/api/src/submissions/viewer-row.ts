/**
 * The viewer's projected row (BLD-08) — the
 * single projection both the view and the
 * export render.
 *
 * The projection is the read path's own
 * {@link projectSubmissionStatus}: the view
 * and the export cannot disagree, because
 * they share this function. The export's row
 * count therefore equals the view count by
 * construction (D-111), and the "safe
 * reason" is the curated delivery message —
 * never raw submission content (the D-43/W-22
 * discipline).
 */

import type {
  Submission,
  SubmissionRevisionDocument,
} from '@akane/domain';

import {
  projectSubmissionStatus,
  type StatusRow,
} from '../read/status-projection.js';

/** One viewer row: the visible columns, and nothing else. */
export interface SubmissionViewerRow {
  readonly submission_id: string;
  readonly app_id: string;
  readonly form_id: string;
  readonly status:
    | 'completed'
    | 'partial'
    | 'failed'
    | 'pending_external';
  /** The ISO wire form of the submission's timestamp. */
  readonly submitted_at: string;
  readonly downstream_reference: string | null;
  /** The curated, PII-free delivery message. */
  readonly reason: string | null;
}

/** The connector display name the safe reason interpolates. */
const DEFAULT_CONNECTOR_NAME = 'Connector';

export function toViewerRow(
  submission: Submission,
  latestRevision: SubmissionRevisionDocument | null,
  connectorName?: string,
): SubmissionViewerRow {
  const projected: StatusRow = projectSubmissionStatus({
    submission,
    latestRevision,
    connectorName: connectorName ?? DEFAULT_CONNECTOR_NAME,
  });
  return {
    submission_id: submission._id,
    app_id: projected.app_id,
    form_id: projected.form_id,
    status: projected.status,
    submitted_at: toIso(projected.submittedAt),
    downstream_reference: projected.downstreamRef ?? null,
    reason: projected.reason ?? null,
  };
}

/** The wire form of the projection's `Date | string` timestamp. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
