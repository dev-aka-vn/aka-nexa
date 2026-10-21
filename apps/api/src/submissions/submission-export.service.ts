/**
 * The visible-column CSV export (BLD-08, D-111).
 *
 * The export is a **projection of the view**, never a
 * raw submission-payload dump (Pitfall 10): the rows
 * are projected through the viewer's field allowlist
 * — {@link toViewerRow} — **before** serialization,
 * so a field outside the allowlist (a PII key in the
 * submission payload) is unreachable in any row by
 * construction. The writer is `csv-stringify`
 * (Pitfall 11 — the writer sibling of `csv-parse` in
 * the adaltas/node-csv family, MIT), which owns the
 * quoting of embedded commas, quotes, and newlines.
 *
 * ## The audit trail
 *
 * Every export is an **audited event** (AUD-01)
 * naming the exporting owner and the filter set —
 * the same D-86 discipline every mutation here
 * rides.
 */

import { stringify } from 'csv-stringify';

import {
  AuditRepository,
  type SubmissionRepository,
  type SubmissionRevisionDocument,
  type SubmissionListFilter,
} from '@akane/domain';

import {
  toViewerRow,
  type SubmissionViewerRow,
} from './viewer-row.js';

/**
 * The visible columns — the export allowlist. The
 * header is exactly this list, and a row carries
 * exactly these fields, in this order.
 */
export const SUBMISSION_EXPORT_COLUMNS = [
  'submission_id',
  'app_id',
  'form_id',
  'status',
  'submitted_at',
  'downstream_reference',
  'reason',
] as const;

/** The revisions store's read surface the export composes with. */
export interface SubmissionRevisionLookup {
  findLatest(
    submissionId: string,
  ): Promise<SubmissionRevisionDocument | null>;
}

/** The export result: the CSV text and its row count. */
export interface SubmissionExportResult {
  readonly csv: string;
  readonly rowCount: number;
  readonly columns: readonly string[];
}

/** Serialize rows to CSV through `csv-stringify` (the writer, Pitfall 11). */
function stringifyCsv(
  rows: SubmissionViewerRow[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    stringify(
      rows,
      { header: true, columns: [...SUBMISSION_EXPORT_COLUMNS] },
      (error, output) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve(output);
      },
    );
  });
}

export class SubmissionExportService {
  constructor(
    private readonly submissions: SubmissionRepository,
    private readonly revisions: SubmissionRevisionLookup,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * The viewer's rows — the same filter the
   * controller's list endpoint applies, so the
   * export's row count equals the view count by
   * construction (D-111).
   */
  async listRows(
    filter: SubmissionListFilter,
    connectorName?: string,
  ): Promise<SubmissionViewerRow[]> {
    const submissions = await this.submissions.listByApp(
      filter,
    );
    const rows: SubmissionViewerRow[] = [];
    for (const submission of submissions) {
      const latest = await this.revisions.findLatest(
        submission._id,
      );
      rows.push(toViewerRow(submission, latest, connectorName));
    }
    return rows;
  }

  /**
   * The export: project the filtered rows through
   * the allowlist, serialize with `csv-stringify`,
   * and append the `submissions.exported` AUD-01
   * entry naming the owner and the filter set.
   */
  async exportSubmissions(
    filter: SubmissionListFilter,
    actor: string,
    connectorName?: string,
  ): Promise<SubmissionExportResult> {
    const rows = await this.listRows(filter, connectorName);
    const csv = await stringifyCsv(rows);

    await this.audit.append({
      timestamp: new Date(),
      actor,
      action: 'submissions.exported',
      target: filter.app_id,
      filters: {
        status: filter.status ?? null,
        from: filter.from?.toISOString() ?? null,
        to: filter.to?.toISOString() ?? null,
        form: filter.form_id ?? null,
      },
      row_count: rows.length,
    });

    return {
      csv,
      rowCount: rows.length,
      columns: SUBMISSION_EXPORT_COLUMNS,
    };
  }
}
