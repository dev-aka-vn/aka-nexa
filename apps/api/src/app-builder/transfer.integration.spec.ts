/**
 * ACL-05 / T-06-31 — the ownership-transfer
 * flow, end-to-end over real MongoDB and Redis
 * (testcontainers) through the HTTP surface.
 *
 * The four edges this spec proves:
 *
 * 1. **The owner requests** — `POST
 *    /apps/:id/transfer-requests` carries the
 *    target owner and creates a `pending`
 *    record with a 7-day `expiresAt` and an
 *    AUD-01 append. The owner requests, never
 *    executes (ACL-10).
 * 2. **Only the global admin approves** — a
 *    non-admin actor's approve is refused with
 *    the named 403 `GLOBAL_ADMIN_REQUIRED`
 *    (ACL-05), and the refusal is a
 *    service-level guard, not just a route
 *    guard (the integration reaches the guard
 *    over real HTTP).
 * 3. **The approval moves ownership** — the
 *    app definition's `createdBy` is the
 *    target user after the admin approves, and
 *    the transition is audited.
 * 4. **The 7-day TTL is enforced and
 *    idempotent** — a pending record past its
 *    `expiresAt` is auto-cancelled with an
 *    AUD-01 append, a second run cancels
 *    nothing, and **an approval after the
 *    auto-cancel is refused** (T-06-31).
 */

import { createServer, type AddressInfo } from 'node:net';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Request } from 'express';

import {
  AuditRepository,
  AppDefinitionRepository,
  TransferRequestRepository,
  TransferRequestService,
  type AuditEntry,
} from '@akane/domain';
import { ConfigModule, MongoService } from '@akane/platform';

import { startThreeContainers, type ThreeContainers } from '../../../../tooling/containers.js';

import { AppBuilderModule } from './app-builder.module.js';

const OWNER = 'user-0001';
const NEW_OWNER = 'user-0002';
const ADMIN = 'user-admin';

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
  role?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(as === undefined ? {} : { 'x-test-user': as }),
      ...(role === undefined ? {} : { 'x-test-role': role }),
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
  return { status: res.status, body: parsed };
}

describe('ownership transfer (ACL-05, ACL-10, T-06-31)', () => {
  let containers: ThreeContainers;
  let mongo: MongoService;
  let app: INestApplication;
  let baseUrl: string;
  let audit: AuditRepository;
  let transfers: TransferRequestRepository;
  let definitions: AppDefinitionRepository;
  let transferService: TransferRequestService;

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
    transfers = moduleRef.get(TransferRequestRepository);
    definitions = moduleRef.get(AppDefinitionRepository);
    transferService = moduleRef.get(TransferRequestService);

    app = moduleRef.createNestApplication();
    // The session middleware's principal, replayed
    // from test headers so owner-scoping and the
    // global-admin role are exercised over real
    // HTTP.
    app.use((req: Request, _res: unknown, next: () => void) => {
      const realUserId = req.headers['x-test-user'];
      if (typeof realUserId === 'string') {
        const role =
          req.headers['x-test-role'] === 'global-admin'
            ? 'global-admin'
            : 'owner';
        (req as Request & { user?: { realUserId: string; role: string } })
          .user = { realUserId, role } as never;
      }
      next();
    });
    await app.init();
    await app.listen(port, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${port}`;

    // The app under test: an owner's draft.
    const created = await call(
      'POST',
      `${baseUrl}/apps`,
      {
        name: 'Leave Request',
        app_id: 'leave-request',
        description: 'Request time off',
      },
      OWNER,
    );
    expect(created.status).toBe(201);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.client.close();
    await containers?.stop();
  });

  it('the owner requests a transfer — pending, 7-day TTL, audited (ACL-10)', async () => {
    const before = await audit.findAll();

    const created = await call(
      'POST',
      `${baseUrl}/apps/leave-request/transfer-requests`,
      { new_owner_user_id: NEW_OWNER },
      OWNER,
    );

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      app_id: 'leave-request',
      from_user_id: OWNER,
      to_user_id: NEW_OWNER,
      state: 'pending',
    });
    const transferId = created.body['transfer_id'] as string;
    expect(transferId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // The 7-day TTL: expiresAt is exactly
    // requestedAt + 7 days.
    const requestedAt = new Date(
      created.body['requestedAt'] as string,
    );
    const expiresAt = new Date(
      created.body['expiresAt'] as string,
    );
    expect(
      expiresAt.getTime() - requestedAt.getTime(),
    ).toBe(7 * 24 * 60 * 60 * 1000);
    expect(created.body['resolvedAt']).toBeUndefined();

    // The persisted record matches.
    expect(
      await transfers.findByTransferId(transferId),
    ).toMatchObject({ transfer_id: transferId, state: 'pending' });

    // The AUD-01 entry.
    const after = await audit.findAll();
    expect(after.length).toBe(before.length + 1);
    const entry = after[after.length - 1] as AuditEntry;
    expect(entry).toMatchObject({
      actor: OWNER,
      action: 'transfer.requested',
      target: 'leave-request',
      new_state: 'pending',
      from_user_id: OWNER,
      to_user_id: NEW_OWNER,
      transfer_id: transferId,
    });
  });

  it('a non-admin actor cannot approve — the named 403 (ACL-05)', async () => {
    const created = await call(
      'POST',
      `${baseUrl}/apps/leave-request/transfer-requests`,
      { new_owner_user_id: NEW_OWNER },
      OWNER,
    );
    expect(created.status).toBe(201);
    const transferId = created.body['transfer_id'] as string;

    // The owner cannot approve their own transfer.
    const refused = await call(
      'POST',
      `${baseUrl}/transfer-approvals/${transferId}/approve`,
      undefined,
      OWNER,
    );
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({
      error: { code: 'GLOBAL_ADMIN_REQUIRED' },
    });

    // The record is untouched — still pending.
    expect(
      await transfers.findByTransferId(transferId),
    ).toMatchObject({ state: 'pending' });
  });

  it('the global admin approves — ownership moves, audited (ACL-05)', async () => {
    const created = await call(
      'POST',
      `${baseUrl}/apps/leave-request/transfer-requests`,
      { new_owner_user_id: NEW_OWNER },
      OWNER,
    );
    expect(created.status).toBe(201);
    const transferId = created.body['transfer_id'] as string;

    const before = await audit.findAll();

    const approved = await call(
      'POST',
      `${baseUrl}/transfer-approvals/${transferId}/approve`,
      undefined,
      ADMIN,
      'global-admin',
    );

    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      transfer_id: transferId,
      state: 'approved',
    });
    expect(approved.body['resolvedAt']).toBeTypeOf('string');

    // Ownership moved: the definition's owner is
    // the target user now.
    const definition = await definitions.findByAppId(
      'leave-request',
    );
    expect(definition?.createdBy).toBe(NEW_OWNER);

    // The AUD-01 approval entry.
    const after = await audit.findAll();
    expect(after.length).toBe(before.length + 1);
    const entry = after[after.length - 1] as AuditEntry;
    expect(entry).toMatchObject({
      actor: ADMIN,
      action: 'transfer.approved',
      target: 'leave-request',
      previous_state: 'pending',
      new_state: 'approved',
      transfer_id: transferId,
    });

    // An approval after the resolution is refused —
    // the record is not pending anymore.
    const twice = await call(
      'POST',
      `${baseUrl}/transfer-approvals/${transferId}/approve`,
      undefined,
      ADMIN,
      'global-admin',
    );
    expect(twice.status).toBe(409);
    expect(twice.body).toMatchObject({
      error: { code: 'TRANSFER_ILLEGAL_TRANSITION' },
    });
  });

  it('the global admin rejects — the record resolves rejected, audited (ACL-05)', async () => {
    const created = await call(
      'POST',
      `${baseUrl}/apps/leave-request/transfer-requests`,
      { new_owner_user_id: NEW_OWNER },
      OWNER,
    );
    expect(created.status).toBe(201);
    const transferId = created.body['transfer_id'] as string;

    const rejected = await call(
      'POST',
      `${baseUrl}/transfer-approvals/${transferId}/reject`,
      undefined,
      ADMIN,
      'global-admin',
    );

    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({
      transfer_id: transferId,
      state: 'rejected',
    });

    const entries = await audit.findAll();
    const entry = entries[entries.length - 1] as AuditEntry;
    expect(entry).toMatchObject({
      action: 'transfer.rejected',
      new_state: 'rejected',
      transfer_id: transferId,
    });
  });

  it('the approval queue lists pending requests for the global admin only (ACL-05)', async () => {
    const created = await call(
      'POST',
      `${baseUrl}/apps/leave-request/transfer-requests`,
      { new_owner_user_id: NEW_OWNER },
      OWNER,
    );
    expect(created.status).toBe(201);

    const queue = await call(
      'GET',
      `${baseUrl}/transfer-approvals`,
      undefined,
      ADMIN,
      'global-admin',
    );
    expect(queue.status).toBe(200);
    const queueRows = queue.body['transfers'] as Array<
      Record<string, unknown>
    >;
    expect(
      queueRows.filter(
        (request) => request['state'] === 'pending',
      ).length,
    ).toBeGreaterThan(0);

    // A non-admin cannot read the queue.
    const refused = await call(
      'GET',
      `${baseUrl}/transfer-approvals`,
      undefined,
      OWNER,
    );
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({
      error: { code: 'GLOBAL_ADMIN_REQUIRED' },
    });
  });

  it('a pending request past its 7-day TTL is auto-cancelled — and approval after cancel is refused (T-06-31)', async () => {
    // A pending transfer whose TTL has already
    // expired — inserted directly through the
    // repository (the auto-cancel job's own
    // read path), exactly as an expired record
    // looks after 7 days.
    const requestedAt = new Date(
      '2026-10-01T10:00:00.000Z',
    );
    const transferId = '00000000-0000-0000-0000-0000000000e1';
    await transfers.create({
      transfer_id: transferId,
      app_id: 'leave-request',
      from_user_id: OWNER,
      to_user_id: NEW_OWNER,
      state: 'pending',
      requestedAt,
      expiresAt: new Date(
        requestedAt.getTime() + 7 * 24 * 60 * 60 * 1000,
      ),
    } as never);

    // The auto-cancel the hourly job runs — the
    // same service method the worker processor
    // calls.
    const now = new Date('2026-10-10T10:00:00.000Z');
    const cancelled = await transferService.autoCancelExpired(now);
    expect(
      cancelled.map((request) => request.transfer_id),
    ).toContain(transferId);
    expect(
      await transfers.findByTransferId(transferId),
    ).toMatchObject({ state: 'auto-cancelled' });

    // The AUD-01 auto-cancel entry.
    const entries = (await audit.findAll()) as AuditEntry[];
    const autoCancelEntry = entries.find(
      (entry) => entry.transfer_id === transferId,
    );
    expect(autoCancelEntry).toMatchObject({
      action: 'transfer.auto-cancelled',
      target: 'leave-request',
      previous_state: 'pending',
      new_state: 'auto-cancelled',
      transfer_id: transferId,
    });

    // Approval after the auto-cancel is refused
    // (T-06-31) — the record is not pending.
    const refused = await call(
      'POST',
      `${baseUrl}/transfer-approvals/${transferId}/approve`,
      undefined,
      ADMIN,
      'global-admin',
    );
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      error: { code: 'TRANSFER_ILLEGAL_TRANSITION' },
    });

    // Idempotent: the second run cancels nothing.
    const again = await transferService.autoCancelExpired(now);
    expect(
      again.map((request) => request.transfer_id),
    ).not.toContain(transferId);
  });
});
