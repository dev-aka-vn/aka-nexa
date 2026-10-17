/**
 * The submissions viewer's projected rows
 * (BLD-08) — the SPA-side structural schema
 * for the served projection.
 *
 * The API projects every submission through
 * its own `toViewerRow` (the single
 * projection both the view and the export
 * render, so the two cannot disagree —
 * D-111). This module validates that served
 * shape at the SPA boundary: an
 * unvalidated payload never reaches a
 * component (BLD-07's discipline, the same
 * shape `api/definition.ts` enforces for the
 * definition projection).
 *
 * The schema is structural (not a Zod
 * import) for the same reason the definition
 * schema is: the served shape is the
 * projection's own, and the SPA compiles
 * against it without a second frozen copy.
 */

/** The projected submission statuses (the read path's own vocabulary). */
export const SUBMISSION_STATUSES = [
  'completed',
  'partial',
  'failed',
  'pending_external',
] as const;

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/**
 * One viewer row: the visible columns, and
 * nothing else. `downstream_reference` and
 * `reason` are null until the delivery
 * attempt; `reason` is the curated,
 * PII-free delivery message — never raw
 * submission content (the D-43/W-22
 * discipline the API enforces).
 */
export interface SubmissionViewerRow {
  readonly submission_id: string;
  readonly app_id: string;
  readonly form_id: string;
  readonly status: SubmissionStatus;
  /** The ISO wire form of the submission's timestamp. */
  readonly submitted_at: string;
  readonly downstream_reference: string | null;
  readonly reason: string | null;
}

/** The list response (`GET /submissions`). */
export interface SubmissionsListResponse {
  readonly submissions: readonly SubmissionViewerRow[];
}

/**
 * The structural row schema. A malformed row
 * throws at the boundary; a status outside
 * the projection's vocabulary is refused
 * rather than silently re-labelled.
 */
export const SubmissionViewerRowSchema = {
  parse: (data: unknown): SubmissionViewerRow => {
    const row = data as Partial<SubmissionViewerRow> | null;
    if (
      typeof row !== 'object' ||
      row === null ||
      typeof row.submission_id !== 'string' ||
      typeof row.app_id !== 'string' ||
      typeof row.form_id !== 'string' ||
      typeof row.submitted_at !== 'string' ||
      !(SUBMISSION_STATUSES as readonly string[]).includes(
        row.status as string,
      )
    ) {
      throw new Error('malformed submission viewer row');
    }
    return {
      submission_id: row.submission_id,
      app_id: row.app_id,
      form_id: row.form_id,
      status: row.status,
      submitted_at: row.submitted_at,
      downstream_reference:
        typeof row.downstream_reference === 'string'
          ? row.downstream_reference
          : null,
      reason: typeof row.reason === 'string' ? row.reason : null,
    };
  },
};

/**
 * The list response's structural schema —
 * every row is validated, so a single
 * malformed row fails the read rather than
 * reaching the table.
 */
export const SubmissionsListSchema = {
  parse: (data: unknown): SubmissionsListResponse => {
    const payload = data as { submissions?: unknown };
    if (!Array.isArray(payload.submissions)) {
      throw new Error('malformed submissions list');
    }
    return {
      submissions: payload.submissions.map((row) =>
        SubmissionViewerRowSchema.parse(row),
      ),
    };
  },
};
