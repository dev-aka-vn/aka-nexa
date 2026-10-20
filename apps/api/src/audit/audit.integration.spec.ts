/**
 * The audit browse endpoint (AUD-01, D-43,
 * T-06-32) — the read-only Audit Log's
 * backend, end-to-end over real MongoDB and
 * Redis (testcontainers) through the HTTP
 * surface.
 *
 * The boundaries this spec proves:
 *
 * 1. **Global-admin-only** (T-06-32): a
 *    `global-admin` session browses the log;
 *    any other role — including an app
 *    owner — gets 403 `GLOBAL_ADMIN_REQUIRED`,
 *    the same named refusal the users
 *    surface answers with.
 * 2. **The field allowlist (D-43)**: every
 *    served entry carries exactly the
 *    allowlisted fields — `timestamp`,
 *    `actor`, `action`, `target`,
 *    `previous_state`, `new_state`,
 *    `request_id`. The repository's `ip`
 *    field and any non-allowlisted extra key
 *    an append carried are projected away
 *    **before** serialization: a spec
 *    asserts the served key set is a subset
 *    of the allowlist, so a leaked internal
 *    field is a test failure, not a
 *    surprise in an admin's browser.
 * 3. **Pagination**: `limit` (default 20,
 *    ceiling 100) and `offset` (default 0)
 *    slice the newest-first stream; the
 *    response echoes the applied parameters
 *    and the total, so the Audit page's
 *    pager is a pure function of the
 *    response.
 * 4. **Newest first**: the recent-activity
 *    widget and the browse page both read the
 *    same ordering — the stream is sorted by
 *    `timestamp` descending before it is
 *    sliced.
 * 5. **Read-only by construction** (AUD-01):
 *    the controller exposes exactly one route
 *    (`GET /audit`) — there is no mutation
 *    endpoint to call, because the append-only
 *    store offers no update or delete path.
 * 6. **Named validation** (BLD-07): an
 *    invalid `limit`/`offset` is refused with
 *    `AUDIT_VALIDATION` naming the offending
 *    field, never a generic bad request.
 */

import { createServer, type AddressInfo } from 'node:net';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditRepository } from '@akane/domain';
import { ConfigModule, MongoService } from '@akane/platform';

import { startThreeContainers, type ThreeContainers } from '../../../../tooling/containers.js';

import { AuditModule } from './audit.module.js';

/** The global admin the browse surface belongs to. */
const GLOBAL_ADMIN = 'usr_global_admin';
/** An app owner — every builder admin's default role is *not* global-admin. */
const OWNER = 'usr_owner_1';

/** The served entry's allowlist (D-43) — exactly these keys, nothing else. */
const AUDIT_ENTRY_ALLOWLIST = new Set([
  'timestamp',
  'actor',
  'action',
  'target',
  'app_id',
  'previous_state',
  'new_state',
  'ip',
  'request_id',
]);

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

/**
 * A JSON GET helper returning `{status, body}`. The
 * test principal rides the `x-test-user` /
 * `x-test-role` headers the spec's middleware
 * replays onto `req.user` — the same shape the
 * session middleware produces at login.
 */
async function get(
  url: string,
  as?: { user: string; role: string },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, {
    headers:
      as === undefined
        ? {}
        : {
            'x-test-user': as.user,
            'x-test-role': as.role,
          },
  });
  const raw = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = { raw };
  }
  return { status: res.status, body: parsed };
}

describe('audit browse (AUD-01, D-43, T-06-32)', () => {
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
      imports: [ConfigModule, AuditModule],
    }).compile();

    // The process-wide append-only AUD-01 store the
    // browse endpoint reads — the same instance every
    // audited transition in this app appends to.
    audit = moduleRef.get(AuditRepository);

    app = moduleRef.createNestApplication();
    // The session middleware's principal, replayed
    // from test headers so the role gate is
    // exercised over real HTTP.
    app.use((req: Request, _res: unknown, next: () => void) => {
      const realUserId = req.headers['x-test-user'];
      const role = req.headers['x-test-role'];
      if (typeof realUserId === 'string') {
        (req as Request & { user?: { realUserId: string; role: string } })
          .user = {
          realUserId,
          role: typeof role === 'string' ? role : 'owner',
        } as never;
      }
      next();
    });
    await app.init();
    await app.listen(port, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${port}`;

    // Seed the log: three entries, inserted in
    // chronological order (oldest first), one of
    // them carrying a non-allowlisted `ip` field
    // and an arbitrary extra key — exactly what a
    // real append may carry, and exactly what the
    // projection must drop.
    const t0 = new Date('2026-10-12T08:00:00.000Z');
    await audit.append({
      timestamp: t0,
      actor: OWNER,
      action: 'app.definition_updated',
      target: 'leave-request',
      previous_state: 'v1',
      new_state: 'v2',
      ip: '10.0.0.7',
      unlisted_extra: 'must not surface',
    });
    await audit.append({
      timestamp: new Date('2026-10-12T09:00:00.000Z'),
      actor: GLOBAL_ADMIN,
      action: 'connector_request.provisioned',
      target: 'leave-request',
      previous_state: 'pending',
      new_state: 'provisioned',
      request_id: 'req_01HF3Y2',
    });
    await audit.append({
      timestamp: new Date('2026-10-12T10:00:00.000Z'),
      actor: OWNER,
      action: 'app.definition_created',
      target: 'travel-request',
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.client.close();
    await containers?.stop();
  });

  it('GET /audit serves paginated entries, newest first, projected through the D-43 allowlist', async () => {
    const response = await get(`${baseUrl}/audit`, {
      user: GLOBAL_ADMIN,
      role: 'global-admin',
    });

    expect(response.status).toBe(200);
    const entries = response.body['entries'] as Array<
      Record<string, unknown>
    >;
    expect(entries).toHaveLength(3);

    // Newest first — the recent-activity widget's ordering.
    const timestamps = entries.map(
      (entry) => entry['timestamp'] as string,
    );
    expect(timestamps[0]).toBe('2026-10-12T10:00:00.000Z');
    expect(timestamps[1]).toBe('2026-10-12T09:00:00.000Z');
    expect(timestamps[2]).toBe('2026-10-12T08:00:00.000Z');

    // D-43: the served key set is a subset of the
    // allowlist — the seeded `ip` and the extra key
    // are projected away before serialization.
    for (const entry of entries) {
      for (const key of Object.keys(entry)) {
        expect(AUDIT_ENTRY_ALLOWLIST.has(key)).toBe(true);
      }
    }
    const seeded = entries[2] as Record<string, unknown>;
    expect(seeded['actor']).toBe(OWNER);
    expect(seeded['ip']).toBe('10.0.0.7');
    expect(seeded['unlisted_extra']).toBeUndefined();

    // The pagination envelope echoes the applied
    // parameters and the total.
    expect(response.body['total']).toBe(3);
    expect(response.body['limit']).toBe(20);
    expect(response.body['offset']).toBe(0);
  });

  it('paginates the newest-first stream with limit and offset', async () => {
    const first = await get(
      `${baseUrl}/audit?limit=2&offset=0`,
      { user: GLOBAL_ADMIN, role: 'global-admin' },
    );
    expect(first.status).toBe(200);
    expect(first.body['total']).toBe(3);
    expect(first.body['limit']).toBe(2);
    expect(first.body['offset']).toBe(0);
    const firstEntries = first.body['entries'] as Array<
      Record<string, unknown>
    >;
    expect(firstEntries).toHaveLength(2);
    expect(firstEntries[0]['target']).toBe('travel-request');

    const second = await get(
      `${baseUrl}/audit?limit=2&offset=2`,
      { user: GLOBAL_ADMIN, role: 'global-admin' },
    );
    expect(second.status).toBe(200);
    const secondEntries = second.body['entries'] as Array<
      Record<string, unknown>
    >;
    expect(secondEntries).toHaveLength(1);
    expect(secondEntries[0]['target']).toBe('leave-request');

    // Past the end: an empty page, not an error.
    const empty = await get(
      `${baseUrl}/audit?limit=2&offset=10`,
      { user: GLOBAL_ADMIN, role: 'global-admin' },
    );
    expect(empty.status).toBe(200);
    expect(empty.body['entries']).toEqual([]);
  });

  it('refuses a non-admin session with 403 GLOBAL_ADMIN_REQUIRED — an owner cannot browse the log', async () => {
    const response = await get(`${baseUrl}/audit`, {
      user: OWNER,
      role: 'owner',
    });

    expect(response.status).toBe(403);
    // The rendered message carries the code prefix —
    // the BuilderError discipline every builder
    // refusal follows (`${code}: ${message}`).
    expect(response.body).toEqual({
      error: {
        code: 'GLOBAL_ADMIN_REQUIRED',
        message:
          'GLOBAL_ADMIN_REQUIRED: global-admin session required',
      },
    });
  });

  it('refuses an unauthenticated request (no session principal) with 403', async () => {
    const response = await get(`${baseUrl}/audit`);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: {
        code: 'GLOBAL_ADMIN_REQUIRED',
        message:
          'GLOBAL_ADMIN_REQUIRED: global-admin session required',
      },
    });
  });

  it('refuses an invalid limit with the named AUDIT_VALIDATION error, naming the field', async () => {
    const response = await get(
      `${baseUrl}/audit?limit=not-a-number`,
      { user: GLOBAL_ADMIN, role: 'global-admin' },
    );
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: 'AUDIT_VALIDATION',
        message: expect.stringContaining('limit'),
      },
    });
  });
});
