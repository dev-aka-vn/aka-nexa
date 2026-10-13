/**
 * The transfer-request service (ACL-05,
 * ACL-10, T-06-31).
 *
 * Every method an **audited transition** (the
 * D-86 discipline): the mutation and its
 * AUD-01 entry are the method's two halves —
 * a repository write without an accompanying
 * append is a defect, and every transition
 * here does exactly one of each.
 *
 * ## The rules
 *
 * 1. **The owner requests, never executes**
 *    (ACL-10): `requestTransfer` is
 *    owner-scoped, fail-closed — a non-owner
 *    and a missing app are the same
 *    `APP_NOT_FOUND` refusal — and the
 *    created record carries a 7-day
 *    `expiresAt`, the TTL the hourly
 *    auto-cancel job enforces.
 * 2. **The approval is a global-admin
 *    action** (ACL-05): the role check is a
 *    **service-level guard**, not just a
 *    route guard — a non-admin actor is
 *    refused with the named
 *    `GLOBAL_ADMIN_REQUIRED` error even when
 *    the call reaches the service directly.
 * 3. **Approval moves ownership**: the app
 *    definition's `createdBy` becomes the
 *    target user in the same transition that
 *    resolves the record — the two writes
 *    are one method, never two surfaces.
 * 4. **Approval after auto-cancel is
 *    refused** (T-06-31): an auto-cancelled
 *    request is not `pending`, so the
 *    approval transition refuses it with the
 *    named illegal-transition error.
 * 5. **The auto-cancel is idempotent**: each
 *    run cancels every expired pending
 *    request exactly once — the second run
 *    finds nothing to cancel.
 */

import { randomUUID } from 'node:crypto';

import {
  TransferRequestCreateSchema,
} from '@akane/contract';

import { AppNotFoundError } from '../builder/data-access/app-definition.repository.js';
import type { AppDefinitionRepository } from '../builder/data-access/app-definition.repository.js';
import { AuditRepository } from '../audit/audit.repository.js';

import {
  GlobalAdminRequiredError,
  TransferNotFoundError,
  TransferPendingExistsError,
  TransferTransitionError,
  TransferValidationError,
} from './transfer-request.errors.js';
import { TransferRequestRepository } from './transfer-request.repository.js';
import type { TransferRequestDocument } from './transfer-request.document.js';

/** The authenticated actor, with the role the transfer rules branch on. */
export interface TransferActor {
  readonly realUserId: string;
  readonly role: string;
}

/** The 7-day TTL every pending transfer carries (ACL-05). */
const TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The actor the hourly auto-cancel job appends as (a system transition, not a user). */
const SYSTEM_ACTOR = 'system';

export class TransferRequestService {
  constructor(
    private readonly repository: TransferRequestRepository,
    private readonly definitions: AppDefinitionRepository,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * The owner's self-service step (ACL-10):
   * request a transfer of the app's
   * ownership to `newOwnerUserId`. Validates
   * the target inline (BLD-07), enforces
   * ownership fail-closed, persists the
   * `pending` record with the 7-day TTL, and
   * appends the `transfer.requested` AUD-01
   * entry. The one-pending invariant's
   * structural half (the repository's partial
   * unique index) refuses a second pending
   * request for the app with the named error.
   */
  async requestTransfer(
    appId: string,
    actor: TransferActor,
    newOwnerUserId: string,
  ): Promise<TransferRequestDocument> {
    const parsed = TransferRequestCreateSchema.safeParse({
      new_owner_user_id: newOwnerUserId,
    });
    if (!parsed.success) {
      throw new TransferValidationError(parsed.error.issues);
    }

    // Fail-closed owner-scoping: a non-owner
    // and a missing app are the same refusal.
    await this.assertOwner(appId, actor.realUserId);

    const requestedAt = new Date();
    const created = await this.repository.create({
      transfer_id: randomUUID(),
      app_id: appId,
      from_user_id: actor.realUserId,
      to_user_id: parsed.data.new_owner_user_id,
      state: 'pending',
      requestedAt,
      expiresAt: new Date(
        requestedAt.getTime() + TRANSFER_TTL_MS,
      ),
    });

    await this.audit.append({
      timestamp: new Date(),
      actor: actor.realUserId,
      action: 'transfer.requested',
      target: appId,
      new_state: 'pending',
      from_user_id: actor.realUserId,
      to_user_id: created.to_user_id,
      transfer_id: created.transfer_id,
    });

    return created;
  }

  /**
   * The global admin's approval (ACL-05):
   * ownership moves to the requested target,
   * the record resolves `approved`, and the
   * transition is audited. The role check is
   * a service-level guard — it fires before
   * any read or write, so a non-admin actor
   * changes nothing even when the call
   * reaches the service directly.
   */
  async approve(
    transferId: string,
    actor: TransferActor,
  ): Promise<TransferRequestDocument> {
    this.assertGlobalAdmin(actor);

    const current = await this.assertPending(transferId);

    // Resolve the request record FIRST: the
    // guarded transition is the atomic gate — a
    // concurrent second approval fails here (the
    // record is no longer `pending`) and changes
    // nothing, so ownership can never move for an
    // approval that did not land. Ownership then
    // moves inside the same transition that
    // resolves the request: the definition's owner
    // is the target user once this method returns.
    const approved = await this.repository.transition(
      transferId,
      'approved',
    );
    if (approved === null) {
      throw new TransferNotFoundError(transferId);
    }

    await this.definitions.transferOwnership(
      current.app_id,
      current.to_user_id,
    );

    await this.audit.append({
      timestamp: new Date(),
      actor: actor.realUserId,
      action: 'transfer.approved',
      target: current.app_id,
      previous_state: 'pending',
      new_state: 'approved',
      transfer_id: transferId,
    });

    return approved;
  }

  /**
   * The global admin's rejection (ACL-05):
   * the record resolves `rejected`, audited.
   * The same service-level role guard as the
   * approval.
   */
  async reject(
    transferId: string,
    actor: TransferActor,
  ): Promise<TransferRequestDocument> {
    this.assertGlobalAdmin(actor);

    const current = await this.assertPending(transferId);

    const rejected = await this.repository.transition(
      transferId,
      'rejected',
    );
    if (rejected === null) {
      throw new TransferNotFoundError(transferId);
    }

    await this.audit.append({
      timestamp: new Date(),
      actor: actor.realUserId,
      action: 'transfer.rejected',
      target: current.app_id,
      previous_state: 'pending',
      new_state: 'rejected',
      transfer_id: transferId,
    });

    return rejected;
  }

  /**
   * The hourly job's body (T-06-31): cancel
   * every pending transfer whose 7-day TTL
   * lapsed at `now`, each with its own
   * `transfer.auto-cancelled` AUD-01 entry.
   * Idempotent by construction — the second
   * run's `listExpired` read finds nothing,
   * because the first resolved every expired
   * record out of `pending`.
   */
  async autoCancelExpired(
    now: Date = new Date(),
  ): Promise<TransferRequestDocument[]> {
    const expired = await this.repository.listExpired(now);
    const cancelled: TransferRequestDocument[] = [];
    for (const request of expired) {
      const autoCancelled = await this.repository.transition(
        request.transfer_id,
        'auto-cancelled',
      );
      if (autoCancelled === null) {
        continue;
      }
      await this.audit.append({
        timestamp: new Date(),
        actor: SYSTEM_ACTOR,
        action: 'transfer.auto-cancelled',
        target: request.app_id,
        previous_state: 'pending',
        new_state: 'auto-cancelled',
        transfer_id: request.transfer_id,
      });
      cancelled.push(autoCancelled);
    }
    return cancelled;
  }

  /** The global admin's approval queue — every pending transfer, newest first. */
  async listPending(): Promise<TransferRequestDocument[]> {
    return this.repository.listPending();
  }

  /** Refuse an actor who is not a global admin — before any read or write. */
  private assertGlobalAdmin(actor: TransferActor): void {
    if (actor.role !== 'global-admin') {
      throw new GlobalAdminRequiredError();
    }
  }

  /** Refuse an actor who does not own the app — the same as a missing app. */
  private async assertOwner(
    appId: string,
    realUserId: string,
  ): Promise<void> {
    const definition = await this.definitions.findByAppId(appId);
    if (definition === null || definition.createdBy !== realUserId) {
      throw new AppNotFoundError(appId);
    }
  }

  /** The transfer, if it exists and is still `pending` — the transition's precondition. */
  private async assertPending(
    transferId: string,
  ): Promise<TransferRequestDocument> {
    const current = await this.repository.findByTransferId(transferId);
    if (current === null) {
      throw new TransferNotFoundError(transferId);
    }
    if (current.state !== 'pending') {
      throw new TransferTransitionError(
        transferId,
        current.state,
        'the transition operates on a pending request',
      );
    }
    return current;
  }
}

/** Re-exported for callers that branch on the named refusal. */
export {
  GlobalAdminRequiredError,
  TransferNotFoundError,
  TransferPendingExistsError,
  TransferTransitionError,
  TransferValidationError,
};
export type { TransferRequestDocument };
