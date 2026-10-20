/**
 * BLD-08 / D-111 — the visible-column CSV export.
 *
 * The export is a **projection of the view**, never a
 * raw submission-payload dump (Pitfall 10): exactly the
 * viewer's visible columns — projected status, app/form,
 * timestamps, downstream ref, safe reason — are
 * projected through the field allowlist **before**
 * serialization, then written with `csv-stringify`
 * (Pitfall 11 — the writer sibling of `csv-parse` in
 * the adaltas/node-csv family).
 *
 * ## The rules this spec proves
 *
 * 1. The header is **exactly** the visible columns —
 *    the allowlist, nothing else.
 * 2. The export's row count equals the filtered view
 *    count — the same filter produces the same rows.
 * 3. **No field outside the allowlist appears in any
 *    row**: a PII key in the submission payload exports
 *    nothing for it (D-111, the D-43/W-22 discipline).
 * 4. Embedded commas, quotes, and newlines in field
 *    values are quoted — a reason carrying them
 *    round-trips as one logical row.
 * 5. The downstream reference comes from the latest
 *    revision — the external system's opaque handle.
 * 6. Every export is an **audited event** (AUD-01)
 *    naming the exporting owner and the filter set.
 */

import { describe, expect, it } from 'vitest';

import {
  AuditRepository,
  DslService,
  SubmissionRepository,
  type Submission,
  type SubmissionRevisionDocument,
} from '@akane/domain';

import { projectSubmissionStatus } from '../read/status-projection.js';
import {
  SUBMISSION_EXPORT_COLUMNS,
  SubmissionExportService,
  type SubmissionRevisionLookup,
} from './submission-export.service.js';

// ─── Doubles ──────────────────────────────────────────────

/** The revisions store's read surface the export composes with. */
class FakeRevisions implements SubmissionRevisionLookup {
  private readonly latest = new Map<string, SubmissionRevisionDocument>();

  /**
   * Accepts an out-of-band `outbound` value: the "weird"
   * case deliberately drives the projection's fallback
   * branch with a state outside the domain's `OutboundState`
   * union — a bounced delivery that still reached the store.
   */
  setLatest(
    submissionId: string,
    revision: Omit<SubmissionRevisionDocument, 'outbound'> & {
      outbound: string;
    },
  ): void {
    this.latest.set(submissionId, revision as SubmissionRevisionDocument);
  }

  async findLatest(
    submissionId: string,
  ): Promise<SubmissionRevisionDocument | null> {
    return this.latest.get(submissionId) ?? null;
  }
}

/** A submission fixture. */
function submission(
  overrides: Partial<Submission> = {},
): Submission {
  return {
    _id: 'sub-0001',
    real_user_id: 'emp-0001',
    app_id: 'leave-request',
    form_id: 'leave-form',
    form_version: 1,
    form_schema: {},
    data: {},
    created_at: new Date('2026-10-12T10:00:00.000Z'),
    status: 'completed',
    ...overrides,
  };
}

/**
 * Split CSV text into logical records, honouring
 * quoted fields — the round-trip half of the quoting
 * assertion. A naive `split('\n')` over-quotes the
 * property: a quoted embedded newline must NOT start a
 * new record.
 */
function csvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

// ─── The spec ─────────────────────────────────────────────

describe('submission export (BLD-08, D-111)', () => {
  it('exports exactly the visible columns — the header is the allowlist, nothing else', async () => {
    const repository = new SubmissionRepository(new DslService());
    repository.upsert(submission());
    const service = new SubmissionExportService(
      repository,
      new FakeRevisions(),
      new AuditRepository(),
    );

    const result = await service.exportSubmissions(
      { app_id: 'leave-request' },
      'user-0001',
    );

    expect([...result.columns]).toEqual([
      'submission_id',
      'app_id',
      'form_id',
      'status',
      'submitted_at',
      'downstream_reference',
      'reason',
    ]);
    expect(SUBMISSION_EXPORT_COLUMNS).toEqual(result.columns);

    const records = csvRecords(result.csv);
    expect(records[0]).toEqual([...SUBMISSION_EXPORT_COLUMNS]);
    expect(records).toHaveLength(2); // header + one row
  });

  it('the export row count equals the filtered view count — the same filter produces both', async () => {
    const repository = new SubmissionRepository(new DslService());
    repository.upsert(submission({ _id: 'sub-1', status: 'completed' }));
    repository.upsert(
      submission({
        _id: 'sub-2',
        status: 'failed',
        created_at: new Date('2026-10-13T10:00:00.000Z'),
      }),
    );
    repository.upsert(
      submission({
        _id: 'sub-3',
        app_id: 'expenses',
        form_id: 'expense-form',
      }),
    );
    const service = new SubmissionExportService(
      repository,
      new FakeRevisions(),
      new AuditRepository(),
    );

    const filter = {
      app_id: 'leave-request',
      status: 'failed' as const,
    };
    const exported = await service.exportSubmissions(filter, 'user-0001');
    const view = await service.listRows(filter);

    expect(exported.rowCount).toBe(1);
    expect(exported.rowCount).toBe(view.length);

    // The status filter composes: only the failed row exports.
    const records = csvRecords(exported.csv);
    expect(records[1]![0]).toBe('sub-2');
  });

  it('composes the date-range and form filters', async () => {
    const repository = new SubmissionRepository(new DslService());
    repository.upsert(
      submission({
        _id: 'early',
        form_id: 'leave-form',
        created_at: new Date('2026-10-01T10:00:00.000Z'),
      }),
    );
    repository.upsert(
      submission({
        _id: 'late',
        form_id: 'leave-form',
        created_at: new Date('2026-10-15T10:00:00.000Z'),
      }),
    );
    repository.upsert(
      submission({
        _id: 'other-form',
        form_id: 'other-form',
        created_at: new Date('2026-10-15T10:00:00.000Z'),
      }),
    );
    const service = new SubmissionExportService(
      repository,
      new FakeRevisions(),
      new AuditRepository(),
    );

    const rows = await service.listRows({
      app_id: 'leave-request',
      from: new Date('2026-10-10T00:00:00.000Z'),
      to: new Date('2026-10-20T00:00:00.000Z'),
      form_id: 'leave-form',
    });

    expect(rows.map((row) => row.submission_id)).toEqual(['late']);
  });

  it('never exports a field outside the allowlist — a PII key in the payload exports nothing for it', async () => {
    const repository = new SubmissionRepository(new DslService());
    repository.upsert(
      submission({
        _id: 'sub-pii',
        data: {
          'national-id': '123-45-6789',
          name: 'Jane Doe',
          salary: 99999,
        },
      }),
    );
    const service = new SubmissionExportService(
      repository,
      new FakeRevisions(),
      new AuditRepository(),
    );

    const result = await service.exportSubmissions(
      { app_id: 'leave-request' },
      'user-0001',
    );

    // The PII is nowhere in the export — not the key, not the value.
    expect(result.csv).not.toContain('national-id');
    expect(result.csv).not.toContain('123-45-6789');
    expect(result.csv).not.toContain('Jane Doe');
    expect(result.csv).not.toContain('salary');
    // And the row itself is still exactly the visible columns.
    const records = csvRecords(result.csv);
    expect(records[1]).toHaveLength(SUBMISSION_EXPORT_COLUMNS.length);
  });

  it('quotes embedded commas, quotes, and newlines — a reason carrying them round-trips as one logical row', async () => {
    const repository = new SubmissionRepository(new DslService());
    repository.upsert(
      submission({
        _id: 'sub-weird',
        status: 'failed',
        created_at: new Date('2026-10-12T10:00:00.000Z'),
      }),
    );
    const revisions = new FakeRevisions();
    // An out-of-band outbound state drives the projection's
    // fallback branch: a failed row with a safe reason.
    revisions.setLatest('sub-weird', {
      submission_id: 'sub-weird',
      revision: 1,
      outbound: 'bounced',
      data: {},
      createdAt: new Date('2026-10-12T10:00:00.000Z'),
    });
    const service = new SubmissionExportService(
      repository,
      revisions,
      new AuditRepository(),
    );

    // A connector name is admin-authored free text — a
    // comma, a quote, and a newline in it are legitimate.
    const connectorName = 'Acme, "HR"\nConnector';
    const result = await service.exportSubmissions(
      { app_id: 'leave-request' },
      'user-0001',
      connectorName,
    );

    const records = csvRecords(result.csv);
    expect(records).toHaveLength(2);
    const row = records[1]!;
    expect(row).toHaveLength(SUBMISSION_EXPORT_COLUMNS.length);
    expect(row[0]).toBe('sub-weird');
    expect(row[3]).toBe('failed');
    // The safe reason interpolated the connector name —
    // comma, quote, and newline preserved inside one
    // quoted field.
    const reasonIndex = SUBMISSION_EXPORT_COLUMNS.indexOf('reason');
    expect(row[reasonIndex]).toContain('Acme, "HR"\nConnector');
    expect(row[reasonIndex]).toMatch(/couldn't be delivered/);
  });

  it('carries the downstream reference from the latest revision', async () => {
    const repository = new SubmissionRepository(new DslService());
    repository.upsert(submission({ _id: 'sub-confirmed' }));
    const revisions = new FakeRevisions();
    revisions.setLatest('sub-confirmed', {
      submission_id: 'sub-confirmed',
      revision: 1,
      outbound: 'confirmed',
      data: {},
      createdAt: new Date('2026-10-12T10:00:00.000Z'),
      downstreamReference: 'TKT-2026-00042',
    });
    const service = new SubmissionExportService(
      repository,
      revisions,
      new AuditRepository(),
    );

    const rows = await service.listRows({ app_id: 'leave-request' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      submission_id: 'sub-confirmed',
      status: 'completed',
      downstream_reference: 'TKT-2026-00042',
    });
    // The projection the read path uses is the projection the
    // export uses — same source, same answer.
    expect(
      projectSubmissionStatus({
        submission: submission({ _id: 'sub-confirmed' }),
        latestRevision: {
          submission_id: 'sub-confirmed',
          revision: 1,
          outbound: 'confirmed',
          data: {},
          createdAt: new Date('2026-10-12T10:00:00.000Z'),
          downstreamReference: 'TKT-2026-00042',
        } as never,
      }).downstreamRef,
    ).toBe('TKT-2026-00042');
  });

  it('appends an audited submissions.exported AUD-01 entry naming the owner and the filter set', async () => {
    const repository = new SubmissionRepository(new DslService());
    repository.upsert(submission());
    const audit = new AuditRepository();
    const service = new SubmissionExportService(
      repository,
      new FakeRevisions(),
      audit,
    );

    await service.exportSubmissions(
      {
        app_id: 'leave-request',
        status: 'completed',
        from: new Date('2026-10-01T00:00:00.000Z'),
        form_id: 'leave-form',
      },
      'user-0001',
    );

    const entries = await audit.findAll();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: 'user-0001',
      action: 'submissions.exported',
      target: 'leave-request',
      row_count: 1,
    });
    const filters = (entries[0] as any).filters as Record<string, unknown>;
    expect(filters).toEqual({
      status: 'completed',
      from: '2026-10-01T00:00:00.000Z',
      to: null,
      form: 'leave-form',
    });
  });
});
