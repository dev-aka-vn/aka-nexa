/**
 * BLD-08 / D-111 — the submissions viewer and the
 * visible-column CSV export, end-to-end over real
 * MongoDB and Redis (testcontainers) through the
 * HTTP surface.
 *
 * The boundaries this spec proves:
 *
 * 1. **Owner-scoped, fail-closed**: the viewer
 *    lists only the requesting owner's own apps'
 *    submissions — an `app_id` belonging to
 *    another owner returns 404, never a 403 that
 *    would leak the app's existence.
 * 2. **The filters compose** — status, date range,
 *    and form narrow the view.
 * 3. **The export is a projection of the view**
 *    (D-111, Pitfall 10): its row count equals the
 *    filtered view count, its header is exactly the
 *    visible columns, and no field outside the
 *    allowlist appears in any row — a PII key in
 *    the submission payload exports nothing for it.
 * 4. **Every export is an audited event** (AUD-01)
 *    naming the exporting owner and the filter set.
 */

import { randomBytes } from 'node:crypto';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Request } from 'express';

import {
  AuditRepository,
  SubmissionRepository,
  SubmissionRevisionsRepository,
  type AuditEntry,
} from '@akane/domain';
import { ConfigModule, MongoService } from '@akane/platform';

import { startThreeContainers, type ThreeContainers } from '../../../../tooling/containers.js';

import { SubmissionsModule } from './submissions.module.js';
import { AppBuilderModule } from '../app-builder/app-builder.module.js';

const OWNER = 'user-0001';
const OTHER = 'user-0002';

/**
 * The read-link verification environment the api
 * requires at boot (LNK-05) — `ReadModule` (which
 * `SubmissionsModule` composes) reads these straight
 * from `process.env` and refuses to start without
 * them. `JWT_READ_PUBLIC_KEY` is generated per run:
 * the verifier's algorithm allowlist is ES256.
 */
const READ_LINK_ENV: Record<string, string> = {
  JWT_ISSUER: 'akane-local',
  JWT_AUDIENCE: 'http://localhost:5173',
  JWT_READ_PUBLIC_KEY: generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  })
    .publicKey.export({ type: 'spki', format: 'pem' })
    .toString(),
  RENDERER_ORIGIN: 'http://localhost:5173',
};

/** Reserve an ephemeral loopback port for the listening app. */
function reservePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolvePort(port));
    });
  });
}

/** A JSON request helper returning `{status, body}`. */
async function call(
  method: string,
  url: string,
  body?: unknown,
  as?: string,
): Promise<{ status: number; body: Record<string, unknown>; raw: string }> {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(as === undefined ? {} : { 'x-test-user': as }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = { raw };
  }
  return { status: res.status, body: parsed, raw };
}

describe('submissions viewer + export (BLD-08, D-111)', () => {
  let containers: ThreeContainers;
  let mongo: MongoService;
  let app: INestApplication;
  let baseUrl: string;
  let audit: AuditRepository;
  let submissions: SubmissionRepository;
  let keyDir: string | undefined;

  beforeAll(async () => {
    containers = await startThreeContainers();
    mongo = new MongoService(containers.urls.mongo);

    process.env.NODE_ENV = 'test';
    process.env.SERVICE_NAME = 'api';
    process.env.MONGO_URL = containers.urls.mongo;
    process.env.REDIS_CACHE_URL = containers.urls.cache;
    process.env.REDIS_QUEUE_URL = containers.urls.queue;
    Object.assign(process.env, READ_LINK_ENV);

    const port = await reservePort();
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AppBuilderModule, SubmissionsModule],
    }).compile();

    audit = moduleRef.get(AuditRepository);
    submissions = moduleRef.get(SubmissionRepository);

    app = moduleRef.createNestApplication();
    // The session middleware's principal, replayed from a test
    // header so owner-scoping is exercised over real HTTP.
    app.use((req: Request, _res: unknown, next: () => void) => {
      const realUserId = req.headers['x-test-user'];
      if (typeof realUserId === 'string') {
        (req as Request & { user?: { realUserId: string } }).user = {
          realUserId,
        } as never;
      }
      next();
    });
    await app.init();
    await app.listen(port, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${port}`;

    // The app under test: an owner's app.
    const created = await call('POST', `${baseUrl}/apps`, {
      name: 'Leave Request',
      app_id: 'leave-request',
      description: 'Request time off',
    }, OWNER);
    expect(created.status).toBe(201);

    // Submission fixtures: three live rows, one soft-deleted
    // (invisible to every viewer), one on another owner's app.
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    submissions.upsert({
      _id: 'sub-0001',
      real_user_id: 'emp-0001',
      app_id: 'leave-request',
      form_id: 'leave-form',
      form_version: 1,
      form_schema: {},
      data: { 'national-id': '123-45-6789', name: 'Jane Doe' },
      created_at: new Date(now - 2 * day),
      status: 'completed',
    });
    submissions.upsert({
      _id: 'sub-0002',
      real_user_id: 'emp-0002',
      app_id: 'leave-request',
      form_id: 'leave-form',
      form_version: 1,
      form_schema: {},
      data: {},
      created_at: new Date(now - day),
      status: 'failed',
    });
    submissions.upsert({
      _id: 'sub-0003',
      real_user_id: 'emp-0003',
      app_id: 'leave-request',
      form_id: 'other-form',
      form_version: 1,
      form_schema: {},
      data: {},
      created_at: new Date(now),
      status: 'completed',
    });
    submissions.upsert({
      _id: 'sub-deleted',
      real_user_id: 'emp-0004',
      app_id: 'leave-request',
      form_id: 'leave-form',
      form_version: 1,
      form_schema: {},
      data: {},
      created_at: new Date(now),
      status: 'completed',
      deleted_at: new Date(now),
    });
    // Another owner's app — the fail-closed boundary.
    const foreign = await call('POST', `${baseUrl}/apps`, {
      name: 'Expenses',
      app_id: 'expenses',
      description: 'Expense claims',
    }, OTHER);
    expect(foreign.status).toBe(201);
    submissions.upsert({
      _id: 'sub-foreign',
      real_user_id: 'emp-0005',
      app_id: 'expenses',
      form_id: 'expense-form',
      form_version: 1,
      form_schema: {},
      data: {},
      created_at: new Date(now),
      status: 'completed',
    });

    // A confirmed revision with a downstream reference for sub-0001.
    await mongo
      .db()
      .collection('submission_revisions')
      .insertOne({
        submission_id: 'sub-0001',
        revision: 1,
        outbound: 'confirmed',
        data: {},
        createdAt: new Date(now - 2 * day),
        downstreamReference: 'TKT-2026-00042',
      });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.client.close();
    if (keyDir !== undefined) {
      rmSync(keyDir, { recursive: true, force: true });
    }
    await containers?.stop();
  });

  it('GET /submissions lists the owner\'s app submissions, newest first', async () => {
    const listed = await call(
      'GET',
      `${baseUrl}/submissions?app_id=leave-request`,
      undefined,
      OWNER,
    );

    expect(listed.status).toBe(200);
    const rows = (listed.body as { submissions: Record<string, unknown>[] })
      .submissions;
    // The soft-deleted row is invisible (D-78); the other
    // owner's row is not in this app.
    expect(rows.map((row) => row['submission_id'])).toEqual([
      'sub-0003',
      'sub-0002',
      'sub-0001',
    ]);
    // The projected view shape: exactly the visible columns.
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        'app_id',
        'downstream_reference',
        'form_id',
        'reason',
        'status',
        'submission_id',
        'submitted_at',
      ]);
    }
  });

  it('the filters compose — status, date range, and form', async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // Status.
    const failed = await call(
      'GET',
      `${baseUrl}/submissions?app_id=leave-request&status=failed`,
      undefined,
      OWNER,
    );
    expect(
      (failed.body as { submissions: Record<string, unknown>[] }).submissions
        .map((row) => row['submission_id']),
    ).toEqual(['sub-0002']);

    // Form.
    const otherForm = await call(
      'GET',
      `${baseUrl}/submissions?app_id=leave-request&form=other-form`,
      undefined,
      OWNER,
    );
    expect(
      (otherForm.body as { submissions: Record<string, unknown>[] }).submissions
        .map((row) => row['submission_id']),
    ).toEqual(['sub-0003']);

    // Date range: the last 36 hours covers only the two newest.
    const ranged = await call(
      'GET',
      `${baseUrl}/submissions?app_id=leave-request&from=${encodeURIComponent(
        new Date(now - 36 * 60 * 60 * 1000).toISOString(),
      )}&to=${encodeURIComponent(new Date(now + day).toISOString())}`,
      undefined,
      OWNER,
    );
    expect(
      (ranged.body as { submissions: Record<string, unknown>[] }).submissions
        .map((row) => row['submission_id']),
    ).toEqual(['sub-0003', 'sub-0002']);
  });

  it('a non-owner is refused with 404 on the list (fail-closed owner-scoping)', async () => {
    const refused = await call(
      'GET',
      `${baseUrl}/submissions?app_id=leave-request`,
      undefined,
      OTHER,
    );
    expect(refused.status).toBe(404);
    expect(JSON.stringify(refused.body)).toMatch(/app not found/);

    // An unknown app is indistinguishable from a foreign one.
    const missing = await call(
      'GET',
      `${baseUrl}/submissions?app_id=no-such-app`,
      undefined,
      OWNER,
    );
    expect(missing.status).toBe(404);
  });

  it('GET /submissions/:id returns the single submission, owner-scoped, with the projected view', async () => {
    const detail = await call(
      'GET',
      `${baseUrl}/submissions/sub-0001`,
      undefined,
      OWNER,
    );
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      submission_id: 'sub-0001',
      app_id: 'leave-request',
      form_id: 'leave-form',
      status: 'completed',
      downstream_reference: 'TKT-2026-00042',
    });

    // A non-owner gets the fail-closed 404...
    const refused = await call(
      'GET',
      `${baseUrl}/submissions/sub-0001`,
      undefined,
      OTHER,
    );
    expect(refused.status).toBe(404);

    // ...and an unknown submission_id is the same refusal.
    const missing = await call(
      'GET',
      `${baseUrl}/submissions/sub-missing`,
      undefined,
      OWNER,
    );
    expect(missing.status).toBe(404);
  });

  it('GET /submissions/export returns the visible-column CSV — row count equals the view count, no PII, audited', async () => {
    const before = await audit.findAll();

    // The view and the export use the same filter.
    const view = await call(
      'GET',
      `${baseUrl}/submissions?app_id=leave-request&form=leave-form`,
      undefined,
      OWNER,
    );
    expect(view.status).toBe(200);
    const viewCount = (
      view.body as { submissions: Record<string, unknown>[] }
    ).submissions.length;

    const res = await fetch(
      `${baseUrl}/submissions/export?app_id=leave-request&form=leave-form`,
      { headers: { 'x-test-user': OWNER } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const csv = await res.text();
    const lines = csv.split('\n').filter((line) => line.length > 0);

    // The header is exactly the visible columns.
    expect(lines[0]).toBe(
      'submission_id,app_id,form_id,status,submitted_at,downstream_reference,reason',
    );
    // The row count equals the filtered view count.
    expect(lines.length).toBe(viewCount + 1);
    // The soft-deleted row is absent; the other form is absent.
    expect(csv).toContain('sub-0002');
    expect(csv).not.toContain('sub-deleted');
    expect(csv).not.toContain('sub-0003');
    expect(csv).not.toContain('sub-foreign');

    // The PII in the payload exports nothing for it (D-111).
    expect(csv).not.toContain('national-id');
    expect(csv).not.toContain('123-45-6789');
    expect(csv).not.toContain('Jane Doe');

    // The downstream reference round-trips.
    expect(csv).toContain('TKT-2026-00042');

    // The export is an audited event (AUD-01) naming the
    // exporting owner and the filter set.
    const after = await audit.findAll();
    expect(after.length).toBe(before.length + 1);
    const entry = after[after.length - 1] as AuditEntry;
    expect(entry).toMatchObject({
      actor: OWNER,
      action: 'submissions.exported',
      target: 'leave-request',
      row_count: viewCount,
    });
    expect(((entry as any).filters as Record<string, unknown>)).toEqual({
      status: null,
      from: null,
      to: null,
      form: 'leave-form',
    });
  });

  it('a non-owner export is refused with 404 before any audit entry', async () => {
    const before = await audit.findAll();
    const refused = await fetch(
      `${baseUrl}/submissions/export?app_id=leave-request`,
      { headers: { 'x-test-user': OTHER } },
    );
    expect(refused.status).toBe(404);
    expect(await refused.text()).toMatch(/app not found/);
    expect(await audit.findAll()).toHaveLength(before.length);
  });

  it('rejects an invalid filter inline, naming the offending field', async () => {
    const refused = await call(
      'GET',
      `${baseUrl}/submissions?app_id=leave-request&status=bogus`,
      undefined,
      OWNER,
    );
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toMatch(/status/);
  });

  it('the revisions repository is the real store — the fixture revision is readable through it', async () => {
    // Proves the export's downstream reference came from the
    // real `submission_revisions` collection, not a mock.
    const revisions = new SubmissionRevisionsRepository(mongo);
    const latest = await revisions.findLatest('sub-0001');
    expect(latest).toMatchObject({
      submission_id: 'sub-0001',
      outbound: 'confirmed',
      downstreamReference: 'TKT-2026-00042',
    });
  });

  it('form removal keeps submissions listable/exportable with their form_id intact (T-07-14)', async () => {
    // A two-form app: a submit form and a list form.
    const created = await call('POST', `${baseUrl}/apps`, {
      name: 'Survival App',
      app_id: 'survival-app',
      description: 'removal survival',
    }, OWNER);
    expect(created.status).toBe(201);

    await call('PATCH', `${baseUrl}/apps/survival-app`, {
      section: 'forms',
      patch: {
        forms: [
          {
            form_id: 'submit-form',
            kind: 'submit',
            schema: {},
            form_version: 1,
            triggers: null,
            config: {},
          },
          {
            form_id: 'list-form',
            kind: 'list',
            schema: null,
            form_version: 1,
            triggers: null,
            config: { query_id: 'q-1', columns: ['a'] },
          },
        ],
      },
    }, OWNER);

    // Submissions through both forms (same collection — FRM-14).
    submissions.upsert({
      _id: 'sub-survive-1',
      real_user_id: 'emp-1',
      app_id: 'survival-app',
      form_id: 'submit-form',
      form_version: 1,
      form_schema: {},
      data: {},
      created_at: new Date(),
      status: 'completed',
    });
    submissions.upsert({
      _id: 'sub-survive-2',
      real_user_id: 'emp-2',
      app_id: 'survival-app',
      form_id: 'list-form',
      form_version: 1,
      form_schema: {},
      data: {},
      created_at: new Date(),
      status: 'completed',
    });

    // Remove the list form (definition mutation only).
    const removed = await call('PATCH', `${baseUrl}/apps/survival-app`, {
      section: 'forms',
      patch: {
        forms: [
          {
            form_id: 'submit-form',
            kind: 'submit',
            schema: {},
            form_version: 1,
            triggers: null,
            config: {},
          },
        ],
      },
    }, OWNER);
    expect(removed.status).toBe(200);

    // Submissions still list with recorded form_id intact.
    const listed = await call(
      'GET',
      `${baseUrl}/submissions?app_id=survival-app`,
      undefined,
      OWNER,
    );
    expect(listed.status).toBe(200);
    const rows = (listed.body as { submissions: Record<string, unknown>[] })
      .submissions;
    const byId = new Map(rows.map((r) => [r['submission_id'], r['form_id']]));
    expect(byId.get('sub-survive-1')).toBe('submit-form');
    expect(byId.get('sub-survive-2')).toBe('list-form');

    // CSV export still contains every row with form_id intact.
    const res = await fetch(
      `${baseUrl}/submissions/export?app_id=survival-app`,
      { headers: { 'x-test-user': OWNER } },
    );
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain('sub-survive-1');
    expect(csv).toContain('sub-survive-2');
    expect(csv).toContain('submit-form');
    expect(csv).toContain('list-form');
  });
});
