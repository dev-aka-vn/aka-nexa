/**
 * BLD-02 / APP-02 / APP-05 / D-86 — the app-definition
 * lifecycle, end-to-end over real MongoDB (testcontainers)
 * through the API endpoints.
 *
 * Every behavior here is a plan invariant, and each is
 * asserted through the HTTP surface a builder admin drives:
 *
 * 1. `POST /apps` with `{name, app_id, description}` creates a
 *    **draft** — and a draft is unreachable by any link,
 *    trigger, or route (APP-02): the JEV routing path only ever
 *    exposes `published` apps, so a draft in the catalog
 *    authorizes nothing. A non-conforming `app_id` is rejected
 *    inline, naming the lowercase-hyphenated rule.
 * 2. `PATCH /apps/:id` with a general-settings section update
 *    creates version 2 and appends the AUD-01 entry
 *    `{actor, action: 'app.definition_updated', target, previous_state,
 *    new_state}` (D-86 — the audit log is the process's real one,
 *    not a double).
 * 3. `POST /apps/:id/deprecate` sets lifecycle `deprecated` with
 *    the owner-supplied notice, appends the transition, and the
 *    trigger-registration seam refuses the app
 *    (`TRIGGER_REGISTER_REFUSED_DEPRECATED`, APP-05).
 * 4. A duplicate `app_id` is rejected with the specific inline
 *    `app ID already in use` error — the unique index on the
 *    `apps` collection is the guard.
 *
 * ## What this spec deliberately does not cover
 *
 * Version retention and rollback (APP-03's 20-version window)
 * and the archive/submission gate (APP-06) are task 2's
 * behaviors and live in `app-definition.versions.spec.ts` and
 * the task-2 extension of this file.
 */

import { createServer, type AddressInfo } from 'node:net';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AppDefinitionService,
  AuditRepository,
  PublishedAppLoader,
  type PublishedApp,
} from '@akane/domain';
import { ConfigModule, MongoService } from '@akane/platform';

import { startThreeContainers, type ThreeContainers } from '../../../../tooling/containers.js';

import { AppBuilderModule } from './app-builder.module.js';

const OWNER = 'user-0001';

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

/** A JSON POST/PUT/PATCH helper returning `{status, body}`. */
async function call(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
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

describe('app-definition lifecycle (BLD-02, APP-02, APP-05, D-86)', () => {
  let containers: ThreeContainers;
  let mongo: MongoService;
  let app: INestApplication;
  let baseUrl: string;
  let service: AppDefinitionService;
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

    service = moduleRef.get(AppDefinitionService);
    audit = moduleRef.get(AuditRepository);

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(port, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${port}`;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.client.close();
    await containers?.stop();
  });

  it('POST /apps creates a draft that no link, trigger, or route reaches (APP-02)', async () => {
    const created = await call('POST', `${baseUrl}/apps`, {
      name: 'Leave Request',
      app_id: 'leave-request',
      description: 'Request time off',
    });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      app_id: 'leave-request',
      name: 'Leave Request',
      description: 'Request time off',
      lifecycle: 'draft',
      version: 1,
    });

    // The draft is fetchable by its owner...
    const fetched = await call('GET', `${baseUrl}/apps/leave-request`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toMatchObject({ lifecycle: 'draft' });

    // ...but unreachable by any link, trigger, or route: the JEV
    // routing path only ever exposes published apps, so a draft in
    // the catalog authorizes nothing for any user.
    const catalog: PublishedApp[] = [
      {
        id: 'leave-request',
        description: 'Request time off',
        parameters: [],
        intents: ['request leave'],
        aliases: [],
        threshold: 0.5,
        status: (fetched.body as { lifecycle: string }).lifecycle as
          | 'published'
          | 'draft'
          | 'deprecated',
      },
    ];
    const loader = new PublishedAppLoader(catalog, async () => true);
    const authorized = await loader.listAuthorized(OWNER);
    expect(authorized).toHaveLength(0);
  });

  it('rejects a non-conforming app_id inline, naming the rule', async () => {
    const rejected = await call('POST', `${baseUrl}/apps`, {
      name: 'Bad',
      app_id: 'Bad_Id',
      description: 'nope',
    });

    expect(rejected.status).toBe(400);
    expect(JSON.stringify(rejected.body)).toMatch(/lowercase-hyphenated/);
  });

  it('rejects a duplicate app_id with the specific inline error', async () => {
    await call('POST', `${baseUrl}/apps`, {
      name: 'Leave Request',
      app_id: 'leave-request',
      description: 'Request time off',
    });

    const duplicate = await call('POST', `${baseUrl}/apps`, {
      name: 'Leave Request',
      app_id: 'leave-request',
      description: 'Request time off',
    });

    expect(duplicate.status).toBe(409);
    expect(JSON.stringify(duplicate.body)).toMatch(/app ID already in use/);
  });

  it('PATCH /apps/:id creates version 2 and appends the audited transition (D-86)', async () => {
    const before = await audit.findAll();

    const patched = await call('PATCH', `${baseUrl}/apps/leave-request`, {
      section: 'general',
      patch: { name: 'Leave Request v2' },
    });

    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({
      app_id: 'leave-request',
      name: 'Leave Request v2',
      version: 2,
    });

    // Exactly one new AUD-01 entry with the frozen transition shape.
    const after = await audit.findAll();
    expect(after.length).toBe(before.length + 1);
    const entry = after[after.length - 1]!;
    expect(entry.action).toBe('app.definition_updated');
    expect(entry.target).toBe('leave-request');
    expect(entry.previous_state).toBe('draft');
    expect(entry.new_state).toBe('draft');
    expect(entry.section).toBe('general');
  });

  it('PATCH /apps/:id refuses an unknown section inline', async () => {
    const rejected = await call('PATCH', `${baseUrl}/apps/leave-request`, {
      section: 'not-a-section',
      patch: { x: 1 },
    });

    expect(rejected.status).toBe(400);
    expect(JSON.stringify(rejected.body)).toMatch(/section/);
  });

  it('deprecate sets the owner-supplied notice and the trigger path refuses the app (APP-05)', async () => {
    // Publish first: deprecation is a published → deprecated transition.
    const published = await call('POST', `${baseUrl}/apps/leave-request/publish`);
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({ lifecycle: 'published', version: 3 });

    const deprecated = await call('POST', `${baseUrl}/apps/leave-request/deprecate`, {
      notice: 'Being replaced by the new HR portal',
    });

    expect(deprecated.status).toBe(200);
    expect(deprecated.body).toMatchObject({
      lifecycle: 'deprecated',
      deprecation_notice: 'Being replaced by the new HR portal',
    });

    const entries = await audit.findAll();
    expect(
      entries.find((e) => e.action === 'app.deprecated'),
    ).toMatchObject({
      target: 'leave-request',
      previous_state: 'published',
      new_state: 'deprecated',
    });

    // The trigger-registration seam refuses deprecated apps.
    await expect(service.assertRegistersTriggers('leave-request')).rejects.toThrow(
      /TRIGGER_REGISTER_REFUSED_DEPRECATED/,
    );
  });

  it('archive sets the terminal state and refuses submissions (APP-06 seam)', async () => {
    const archived = await call('POST', `${baseUrl}/apps/leave-request/archive`);

    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({ lifecycle: 'archived' });

    // The submission-creation seam calls this guard — an archived
    // app accepts no new submissions.
    await expect(service.assertAcceptsSubmissions('leave-request')).rejects.toThrow(
      /SUBMISSION_REFUSED_ARCHIVED/,
    );
  });
});
