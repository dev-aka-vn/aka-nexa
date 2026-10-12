/**
 * ACL-05 — the transfer-request service.
 *
 * Every method an **audited transition** (the D-86
 * discipline): the mutation and its AUD-01 entry are
 * the method's two halves.
 *
 * ## The rules the spec proves
 *
 * 1. **The owner requests, never executes** (ACL-10):
 *    `requestTransfer` is owner-scoped, fail-closed —
 *    a non-owner and a missing app are the same
 *    refusal — and the created record carries a
 *    7-day `expiresAt` (the TTL the auto-cancel job
 *    enforces).
 * 2. **The approval is a global-admin action**
 *    (ACL-05): the role check is a **service-level
 *    guard**, not just a route guard — a non-admin
 *    actor is refused with the named
 *    `GLOBAL_ADMIN_REQUIRED` error even when the
 *    call reaches the service directly.
 * 3. **Approval after auto-cancel is refused**
 *    (T-06-31): an auto-cancelled request is not
 *    `pending`, so the approval transition refuses
 *    it with the named illegal-transition error.
 * 4. **The auto-cancel is idempotent**: running it
 *    twice cancels each expired request exactly
 *    once — the second run finds nothing to cancel.
 *
 * The repository is a recording double; the audit
 * log is the real in-memory `AuditRepository` (the
 * process-wide AUD-01 store's own shape).
 */

import { describe, expect, it } from 'vitest';

import { AuditRepository, type AuditEntry } from '../audit/audit.repository.js';
import { AppNotFoundError } from '../data-access/app-definition.repository.js';
import type { AppDefinitionDocument } from '../data-access/app-definition.repository.js';
import type { AppDefinitionRepository } from '../data-access/app-definition.repository.js';

import type { TransferRequestDocument } from './transfer-request.document.js';
import { TransferRequestRepository } from './transfer-request.repository.js';
import {
  TransferRequestService,
  TransferValidationError,
  type TransferActor,
} from './transfer-request.service.js';

/** The global-admin actor (the approval queue's role). */
const ADMIN: TransferActor = {
  realUserId: 'user-admin',
  role: 'global-admin',
};

/** A plain app owner (the requester's role). */
const OWNER: TransferActor = {
  realUserId: 'user-0001',
  role: 'owner',
};

/** A second owner — the transfer target. */
const NEW_OWNER = 'user-0002';

/** A pending transfer fixture. */
function pendingTransfer(
  overrides: Partial<TransferRequestDocument> = {},
): TransferRequestDocument {
  const requestedAt = new Date('2026-10-01T10:00:00.000Z');
  return {
    transfer_id: 'tr_0001',
    app_id: 'leave-request',
    from_user_id: OWNER.realUserId,
    to_user_id: NEW_OWNER,
    state: 'pending',
    requestedAt,
    expiresAt: new Date(
      requestedAt.getTime() + 7 * 24 * 60 * 60 * 1000,
    ),
    ...overrides,
  } as TransferRequestDocument;
}

/** The owner's draft definition. */
function definition(
  createdBy: string,
): AppDefinitionDocument {
  return {
    app_id: 'leave-request',
    name: 'Leave Request',
    description: 'Request time off',
    data_mode: 'external',
    lifecycle: 'draft',
    version: 1,
    tags: ['time-off'],
    form_schema: null,
    triggers: [],
    roles: {},
    routing_config: null,
    field_mapping: null,
    retention_policy: null,
    deprecation_notice: null,
    lifecycle_prefs: null,
    jev_behavior: null,
    role_assignments: null,
    roles_permissions: null,
    versioning_policy: null,
    metadata: null,
    createdBy,
    createdAt: new Date('2026-10-01T09:00:00.000Z'),
  } as unknown as AppDefinitionDocument;
}

/** The recording definition-repository double. */
class FakeDefinitions
  implements Pick<AppDefinitionRepository, 'findByAppId'>
{
  transfers: Array<{ appId: string; toUserId: string }> = [];

  constructor(
    private readonly docs: AppDefinitionDocument[] = [
      definition(OWNER.realUserId),
    ],
  ) {}

  async findByAppId(
    appId: string,
  ): Promise<AppDefinitionDocument | null> {
    return (
      this.docs.find((doc) => doc.app_id === appId) ??
      null
    );
  }

  async transferOwnership(
    appId: string,
    newOwnerUserId: string,
  ): Promise<AppDefinitionDocument | null> {
    const doc = this.docs.find(
      (candidate) => candidate.app_id === appId,
    );
    if (doc === undefined) {
      return null;
    }
    this.transfers.push({ appId, toUserId: newOwnerUserId });
    return { ...doc, createdBy: newOwnerUserId };
  }
}

/** The recording transfer-repository double. */
class FakeTransfers
  implements
    Pick<
      TransferRequestRepository,
      | 'create'
      | 'findByTransferId'
      | 'listPending'
      | 'listExpired'
      | 'transition'
    >
{
  docs: TransferRequestDocument[] = [];

  async create(
    document: TransferRequestDocument,
  ): Promise<TransferRequestDocument> {
    const pending = this.docs.find(
      (candidate) =>
        candidate.app_id === document.app_id &&
        candidate.state === 'pending',
    );
    if (pending !== undefined) {
      throw new Error('TRANSFER_PENDING_EXISTS');
    }
    this.docs.push(document);
    return document;
  }

  async findByTransferId(
    transferId: string,
  ): Promise<TransferRequestDocument | null> {
    return (
      this.docs.find(
        (candidate) => candidate.transfer_id === transferId,
      ) ?? null
    );
  }

  async listPending(): Promise<TransferRequestDocument[]> {
    return this.docs
      .filter((candidate) => candidate.state === 'pending')
      .sort(
        (left, right) =>
          right.requestedAt.getTime() -
          left.requestedAt.getTime(),
      );
  }

  async listExpired(
    now: Date,
  ): Promise<TransferRequestDocument[]> {
    return this.docs.filter(
      (candidate) =>
        candidate.state === 'pending' &&
        candidate.expiresAt.getTime() <= now.getTime(),
    );
  }

  async transition(
    transferId: string,
    to: TransferRequestDocument['state'],
    options: { resolvedAt?: Date } = {},
  ): Promise<TransferRequestDocument | null> {
    const doc = this.docs.find(
      (candidate) => candidate.transfer_id === transferId,
    );
    if (doc === undefined) {
      return null;
    }
    const updated: TransferRequestDocument = {
      ...doc,
      state: to,
      resolvedAt: options.resolvedAt ?? new Date(),
    };
    this.docs[this.docs.indexOf(doc)] = updated;
    return updated;
  }
}

/** The composed service under test. */
function compose(): {
  service: TransferRequestService;
  transfers: FakeTransfers;
  definitions: FakeDefinitions;
  audit: AuditRepository;
} {
  const transfers = new FakeTransfers();
  const definitions = new FakeDefinitions();
  const audit = new AuditRepository();
  const service = new TransferRequestService(
    transfers as never,
    definitions as never,
    audit,
  );
  return { service, transfers, definitions, audit };
}

describe('TransferRequestService (ACL-05, ACL-10)', () => {
  it('the owner requests a transfer — a pending record with a 7-day TTL and an AUD-01 append', async () => {
    const { service, transfers, audit } = compose();

    const created = await service.requestTransfer(
      'leave-request',
      OWNER,
      NEW_OWNER,
    );

    expect(created).toMatchObject({
      app_id: 'leave-request',
      from_user_id: OWNER.realUserId,
      to_user_id: NEW_OWNER,
      state: 'pending',
    });
    // The 7-day TTL: expiresAt is exactly requestedAt
    // + 7 days.
    expect(
      created.expiresAt.getTime() -
        created.requestedAt.getTime(),
    ).toBe(7 * 24 * 60 * 60 * 1000);
    expect(transfers.docs).toHaveLength(1);

    // The AUD-01 entry.
    const entries = await audit.findAll();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: OWNER.realUserId,
      action: 'transfer.requested',
      target: 'leave-request',
      new_state: 'pending',
      from_user_id: OWNER.realUserId,
      to_user_id: NEW_OWNER,
      transfer_id: created.transfer_id,
    });
  });

  it('a non-owner cannot request a transfer — fail-closed, the same refusal as a missing app', async () => {
    const { service } = compose();

    const stranger: TransferActor = {
      ...OWNER,
      realUserId: 'user-0009',
    };
    await expect(
      service.requestTransfer('leave-request', stranger, NEW_OWNER),
    ).rejects.toThrow(AppNotFoundError);
    await expect(
      service.requestTransfer('missing-app', OWNER, NEW_OWNER),
    ).rejects.toThrow(AppNotFoundError);
  });

  it('an invalid request payload is refused inline, naming the field (BLD-07)', async () => {
    const { service } = compose();

    await expect(
      service.requestTransfer('leave-request', OWNER, ''),
    ).rejects.toThrow(TransferValidationError);
  });

  it('a second pending request for the same app is refused with the named error', async () => {
    const { service } = compose();

    await service.requestTransfer('leave-request', OWNER, NEW_OWNER);
    await expect(
      service.requestTransfer('leave-request', OWNER, 'user-0003'),
    ).rejects.toThrow(/TRANSFER_PENDING_EXISTS/);
  });

  it('the global admin approves — ownership moves, the record resolves, AUD-01 appended', async () => {
    const { service, transfers, definitions, audit } = compose();

    const created = await service.requestTransfer(
      'leave-request',
      OWNER,
      NEW_OWNER,
    );

    const approved = await service.approve(
      created.transfer_id,
      ADMIN,
    );

    expect(approved).toMatchObject({
      transfer_id: created.transfer_id,
      state: 'approved',
    });
    expect(approved.resolvedAt).toBeInstanceOf(Date);
    // Ownership moved to the target user.
    expect(definitions.transfers).toEqual([
      { appId: 'leave-request', toUserId: NEW_OWNER },
    ]);

    // Two AUD-01 entries: the request and the approval.
    const entries = (await audit.findAll()) as AuditEntry[];
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      actor: ADMIN.realUserId,
      action: 'transfer.approved',
      target: 'leave-request',
      previous_state: 'pending',
      new_state: 'approved',
      transfer_id: created.transfer_id,
    });
  });

  it('a non-admin actor is refused by the service-level guard — not just the route guard (ACL-05)', async () => {
    const { service, transfers } = compose();

    const created = await service.requestTransfer(
      'leave-request',
      OWNER,
      NEW_OWNER,
    );

    // The owner cannot approve their own transfer —
    // the role check lives in the service.
    await expect(
      service.approve(created.transfer_id, OWNER),
    ).rejects.toThrow(/GLOBAL_ADMIN_REQUIRED/);
    // The refusal changed nothing.
    expect(transfers.docs[0].state).toBe('pending');
  });

  it('approval after auto-cancel is refused (T-06-31)', async () => {
    const { service, transfers } = compose();

    const created = await service.requestTransfer(
      'leave-request',
      OWNER,
      NEW_OWNER,
    );
    // The auto-cancel job resolves the expired record.
    await transfers.transition(created.transfer_id, 'auto-cancelled');

    await expect(
      service.approve(created.transfer_id, ADMIN),
    ).rejects.toThrow(/TRANSFER_ILLEGAL_TRANSITION/);
  });

  it('the global admin rejects — the record resolves rejected, AUD-01 appended', async () => {
    const { service, audit } = compose();

    const created = await service.requestTransfer(
      'leave-request',
      OWNER,
      NEW_OWNER,
    );
    const rejected = await service.reject(
      created.transfer_id,
      ADMIN,
    );

    expect(rejected).toMatchObject({
      state: 'rejected',
    });
    const entries = (await audit.findAll()) as AuditEntry[];
    expect(entries[1]).toMatchObject({
      action: 'transfer.rejected',
      new_state: 'rejected',
      transfer_id: created.transfer_id,
    });

    // The reject guard is the same service-level role
    // check as the approve guard.
    const second = await service.requestTransfer(
      'leave-request',
      OWNER,
      'user-0003',
    );
    await expect(
      service.reject(second.transfer_id, OWNER),
    ).rejects.toThrow(/GLOBAL_ADMIN_REQUIRED/);
  });

  it('autoCancelExpired cancels every expired pending record, audited — and is idempotent', async () => {
    const { service, transfers, audit } = compose();

    const live = await service.requestTransfer(
      'leave-request',
      OWNER,
      NEW_OWNER,
    );
    // A second app with an expired pending transfer.
    const expired = pendingTransfer({
      transfer_id: 'tr_expired',
      app_id: 'expense-claim',
      from_user_id: 'user-0003',
      to_user_id: 'user-0004',
      // Requested 2026-10-01, expired 2026-10-08.
      expiresAt: new Date('2026-10-08T10:00:00.000Z'),
    });
    transfers.docs.push(expired);

    const now = new Date('2026-10-10T10:00:00.000Z');
    const cancelled = await service.autoCancelExpired(now);

    // Only the expired record was cancelled.
    expect(cancelled.map((request) => request.transfer_id)).toEqual([
      'tr_expired',
    ]);
    expect(transfers.docs.find((r) => r.transfer_id === 'tr_expired')?.state).toBe(
      'auto-cancelled',
    );
    // The live record is untouched.
    expect(
      transfers.docs.find((r) => r.transfer_id === live.transfer_id)?.state,
    ).toBe('pending');

    // One AUD-01 entry per cancellation — the request,
    // and the auto-cancel.
    const entries = (await audit.findAll()) as AuditEntry[];
    const autoCancelEntry = entries.find(
      (entry) => entry.action === 'transfer.auto-cancelled',
    );
    expect(autoCancelEntry).toMatchObject({
      target: 'expense-claim',
      previous_state: 'pending',
      new_state: 'auto-cancelled',
      transfer_id: 'tr_expired',
    });

    // Idempotent: the second run finds nothing.
    const again = await service.autoCancelExpired(now);
    expect(again).toEqual([]);
  });

  it('the pending queue lists the app\'s pending transfers for the approval surface', async () => {
    const { service } = compose();

    await service.requestTransfer('leave-request', OWNER, NEW_OWNER);

    const queue = await service.listPending();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      app_id: 'leave-request',
      state: 'pending',
    });
  });
});
