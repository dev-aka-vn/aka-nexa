/**
 * The publish endpoint (APP-07, APP-08, BLD-06, OBS-05).
 *
 * End-to-end over real Mongo and Redis (testcontainers): the
 * gated `POST /apps/:id/publish` runs the publish gate — the
 * dry-run through the real routing machinery, read-only — before
 * any state change, commits the transition only when allowed, and
 * returns the BLD-06 change summary the AUD-01 entry retains.
 *
 * Owner-scoped via the session's realUserId (plan 02): a
 * non-owner's publish is a 404, never a refusal that would
 * leak the app's existence.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Request } from 'express';

import { ConfigModule } from '@akane/platform';
import { MongoService } from '@akane/platform';
import { AuditRepository, type AuditEntry } from '@akane/domain';
import type { ThreeContainers } from '../../../../tooling/containers.js';
import { startThreeContainers } from '../../../../tooling/containers.js';

import { AppBuilderModule } from './app-builder.module.js';

const OWNER = 'user-0001';
const OTHER = 'user-0002';

/** Reserve an ephemeral loopback port for the listening app. */
function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** A JSON request helper returning `{status, body}`. */
async function call(
  method: string,
  url: string,
  body?: unknown,
  as?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(as === undefined ? {} : { 'x-test-user': as }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
}

/** The candidate the publish-modal sections build out. */
const TRIGGERS_SECTION = {
  section: 'triggers',
  patch: {
    triggers: [
      {
        id: 'expense',
        type: 'slash',
        command: '/expense',
        intents: ['expense report'],
        aliases: ['expense'],
      },
    ],
  },
};

const FORMS_SECTION = {
  section: 'forms',
  patch: { form_schema: { components: [{ type: 'text', key: 'vendor' }] } },
};

const DATA_ROUTING_SECTION = {
  section: 'data-routing',
  patch: { routing_config: { collections: ['expenses'] } },
};

describe('POST /apps/:id/publish (APP-07, APP-08, BLD-06)', () => {
  let containers: ThreeContainers;
  let mongo: MongoService;
  let app: INestApplication;
  let baseUrl: string;
  let audit: AuditRepository;

  beforeAll(async () => {
    containers = await startThreeContainers();
    mongo = new MongoService(containers.urls.mongo);

    process.env.NODE_ENV = 'test';
    process.env.SERVICE_NAME = 'api';
    process.env.MONGO_URL = containers.urls.mongo;
    process.env.REDIS_CACHE_URL = containers.urls.cache;
    process.env.REDIS_QUEUE_URL = containers.urls.queue;

    const port = await reservePort();
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AppBuilderModule],
    }).compile();

    audit = moduleRef.get(AuditRepository);

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
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.client.close();
    await containers?.stop();
  });

  it('publishes a clean draft: 200, draft→published, the change summary, and the audited entry', async () => {
    const created = await call(
      'POST',
      `${baseUrl}/apps`,
      {
        name: 'Expense Report',
        app_id: 'expense-report',
        description: 'Submit an expense report',
      },
      OWNER,
    );
    expect(created.status).toBe(201);

    // The audited history the publish delta is measured
    // against: the creation plus the wizard's three
    // section edits land before the publish entry.
    const before = await audit.findAll();

    // The wizard's sections: triggers, forms, data-routing.
    for (const section of [
      TRIGGERS_SECTION,
      FORMS_SECTION,
      DATA_ROUTING_SECTION,
    ]) {
      const patched = await call(
        'PATCH',
        `${baseUrl}/apps/expense-report`,
        section,
        OWNER,
      );
      expect(patched.status).toBe(200);
    }

    const published = await call(
      'POST',
      `${baseUrl}/apps/expense-report/publish`,
      undefined,
      OWNER,
    );

    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({
      app_id: 'expense-report',
      lifecycle: 'published',
      version: 5,
    });
    // BLD-06: the confirmation payload carries every changed row.
    const changeSummary = published.body['changeSummary'];
    expect(changeSummary).toEqual([
      { field: 'status', from: 'draft', to: 'published' },
      { field: 'version', from: 'v4', to: 'v5' },
      { field: 'form versions', from: 'current', to: 'pinned at link creation' },
      { field: 'indexes', from: '—', to: 'creation on expenses' },
      { field: 'triggers', from: 'none', to: '1 active' },
    ]);
    expect(published.body['zero_change']).toBe(false);

    // BLD-06 auditability: exactly one AUD-01 publish entry, and it
    // retains the summary the admin saw.
    const entries = (await audit.findAll()) as AuditEntry[];
    const publishEntries = entries.filter(
      (entry) =>
        entry.action === 'app.published' && entry.target === 'expense-report',
    );
    expect(publishEntries).toHaveLength(1);
    expect(publishEntries[0]).toMatchObject({
      actor: OWNER,
      previous_state: 'draft',
      new_state: 'published',
      changeSummary,
    });
    expect(entries.length).toBe(before.length + 4); // 3 section edits + 1 publish
  });

  it("a non-owner's publish is a 404 that leaks nothing", async () => {
    const draft = await call(
      'POST',
      `${baseUrl}/apps`,
      {
        name: 'Private App',
        app_id: 'private-app',
        description: 'A private app',
      },
      OWNER,
    );
    expect(draft.status).toBe(201);

    const refusal = await call(
      'POST',
      `${baseUrl}/apps/private-app/publish`,
      undefined,
      OTHER,
    );
    expect(refusal.status).toBe(404);
    expect(JSON.stringify(refusal.body)).toMatch(/app not found/);

    // The owner can still publish it.
    const published = await call(
      'POST',
      `${baseUrl}/apps/private-app/publish`,
      undefined,
      OWNER,
    );
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({ lifecycle: 'published' });
  });

  it('a zero-change publish names its zero-change state inline and still audits', async () => {
    // Already published above — re-publishing is a no-op.
    const before = await audit.findAll();
    const republish = await call(
      'POST',
      `${baseUrl}/apps/expense-report/publish`,
      undefined,
      OWNER,
    );

    expect(republish.status).toBe(200);
    expect(republish.body).toMatchObject({
      lifecycle: 'published',
      version: 5,
    });
    expect(republish.body['changeSummary']).toEqual([]);
    expect(republish.body['zero_change']).toBe(true);

    // The no-op publish is an audited event, and the version did not move.
    const entries = await audit.findAll();
    const publishEntries = entries.filter(
      (entry) =>
        entry.action === 'app.published' && entry.target === 'expense-report',
    );
    expect(publishEntries).toHaveLength(2);
    expect(publishEntries[1]).toMatchObject({
      changeSummary: [],
      zero_change: true,
    });
    expect(entries.length).toBe(before.length + 1);
  });

  it("a publish that drops a competitor's share past 5 points is refused, inline and side-effect-free", async () => {
    // The competitor: published, declaring the same two
    // labels the candidate will declare.
    const competitorCreated = await call(
      'POST',
      `${baseUrl}/apps`,
      {
        name: 'Competitor',
        app_id: 'competitor-app',
        description: 'A competing expense app',
      },
      OWNER,
    );
    expect(competitorCreated.status).toBe(201);
    const competitorTriggers = await call(
      'PATCH',
      `${baseUrl}/apps/competitor-app`,
      {
        section: 'triggers',
        patch: {
          triggers: [
            {
              id: 'comp',
              type: 'slash',
              command: '/comp',
              intents: ['expense report', 'expense'],
              aliases: ['expense report', 'expense'],
            },
          ],
        },
      },
      OWNER,
    );
    expect(competitorTriggers.status).toBe(200);
    const competitorPublished = await call(
      'POST',
      `${baseUrl}/apps/competitor-app/publish`,
      undefined,
      OWNER,
    );
    expect(competitorPublished.status).toBe(200);

    // The candidate, declaring the same labels.
    const candidateCreated = await call(
      'POST',
      `${baseUrl}/apps`,
      {
        name: 'Gate Candidate',
        app_id: 'gate-candidate',
        description: 'Submit a gate candidate',
      },
      OWNER,
    );
    expect(candidateCreated.status).toBe(201);
    const candidateTriggers = await call(
      'PATCH',
      `${baseUrl}/apps/gate-candidate`,
      TRIGGERS_SECTION,
      OWNER,
    );
    expect(candidateTriggers.status).toBe(200);

    // The live 24h window the gate's baseline reads: 10 of
    // the 19 shared-label routings to the competitor. The
    // candidate's two labels dilute the competitor's share
    // 10/19 → 10/21 = 5.01 points — one hundredth past
    // the line the rule draws.
    await mongo
      .db()
      .collection('routing_outcomes')
      .insertMany([
        ...Array.from({ length: 10 }, (_, i) => ({
          routing_id: `comp_${i}`,
          intent_label: 'expense report',
          app_id: 'competitor-app',
          decidedAt: new Date(),
        })),
        ...Array.from({ length: 9 }, (_, i) => ({
          routing_id: `other_${i}`,
          intent_label: 'expense',
          app_id: 'another-app',
          decidedAt: new Date(),
        })),
      ]);

    const before = await audit.findAll();
    const refusal = await call(
      'POST',
      `${baseUrl}/apps/gate-candidate/publish`,
      undefined,
      OWNER,
    );

    // The refusal is inline and specific: the affected
    // app and the delta, not a generic confirmation.
    expect(refusal.status).toBe(409);
    expect(refusal.body).toMatchObject({
      error: {
        code: 'PUBLISH_REFUSED',
        message: expect.stringContaining('competitor-app'),
      },
    });
    expect(
      (refusal.body.error as { message: string }).message,
    ).toContain('5.01');

    // Side-effect-free: the candidate is still a draft and
    // the audit log gained no publish entry.
    const stored = await mongo
      .db()
      .collection('apps')
      .findOne({ app_id: 'gate-candidate' });
    expect(stored?.lifecycle).toBe('draft');
    const entries = await audit.findAll();
    expect(
      entries.filter(
        (entry) =>
          entry.action === 'app.published' &&
          entry.target === 'gate-candidate',
      ),
    ).toHaveLength(0);
    expect(entries.length).toBe(before.length);
  });
});
