/**
 * The connector-request service (BLD-10, D-97..D-100).
 *
 * Every method an **audited transition** (the D-86
 * discipline): the mutation and its AUD-01 entry are
 * the method's two halves — a repository write
 * without an accompanying append is a defect, and
 * every transition here does exactly one of each.
 *
 * ## The rules
 *
 * 1. **Owner-scoped, fail-closed** (D-97): an actor
 *    who does not own the app gets the same
 *    `APP_NOT_FOUND` refusal as a missing app —
 *    never a 403 that would leak the app's
 *    existence to a non-owner.
 * 2. **One pending request per `(app_id,
 *    connector_id)`** (T-06-24): the service-level
 *    check reads the pending pair and refuses with
 *    the named error that names the existing
 *    `request_id`; the repository's partial unique
 *    index is the structural backstop that makes
 *    the check race-free.
 * 3. **The definition is the full connector
 *    definition minus the secret** (D-99): validated
 *    against the Zod contract, whose `.strict()`
 *    shape means a smuggled credential field is
 *    rejected inline with the field named.
 * 4. **No builder read path can carry a
 *    credential** (T-06-23): the document carries
 *    no credential value by construction, and the
 *    served projection is the response contract's
 *    key set — nothing else.
 */

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  ConnectorRequestDefinitionSchema,
} from '@akane/contract';
import type { ConnectorRequestDefinition } from '@akane/contract';

import { AppNotFoundError } from '../data-access/app-definition.repository.js';
import type { AppDefinitionRepository } from '../data-access/app-definition.repository.js';
import { AuditRepository, type AuditEntry } from '../../audit/audit.repository.js';

import {
  ConnectorRequestNotFoundError,
  ConnectorRequestPendingExistsError,
  ConnectorRequestTransitionError,
} from './connector-request.errors.js';
import { ConnectorRequestRepository } from './connector-request.repository.js';
import type { ConnectorRequestDocument } from './connector-request.document.js';

/** A Zod validation failure, carried inline with the offending fields (BLD-07). */
export class ConnectorRequestValidationError extends Error {
  constructor(
    public readonly issues: readonly z.core.$ZodIssue[],
  ) {
    super(
      issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; '),
    );
    this.name = 'ConnectorRequestValidationError';
  }
}

export class ConnectorRequestService {
  constructor(
    private readonly repository: ConnectorRequestRepository,
    private readonly definitions: AppDefinitionRepository,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * The admin's self-service step: request a connector
   * for an app. Validates the definition, enforces
   * ownership and the one-pending invariant, persists
   * the definition minus the secret, and appends the
   * `connector_request.requested` AUD-01 entry.
   */
  async request(
    appId: string,
    actor: string,
    definition: ConnectorRequestDefinition | unknown,
  ): Promise<ConnectorRequestDocument> {
    const parsed = ConnectorRequestDefinitionSchema.safeParse(
      definition,
    );
    if (!parsed.success) {
      throw new ConnectorRequestValidationError(parsed.error.issues);
    }

    // Fail-closed owner-scoping: a non-owner and a
    // missing app are the same refusal.
    await this.assertOwner(appId, actor);

    // The one-pending invariant's service-level half
    // (T-06-24) — the named refusal names the pending
    // request it protects.
    const existing = await this.repository.findPending(
      appId,
      parsed.data.connector_id,
    );
    if (existing !== null) {
      throw new ConnectorRequestPendingExistsError(
        appId,
        parsed.data.connector_id,
        existing.request_id,
      );
    }

    const created = await this.repository.create({
      request_id: randomUUID(),
      app_id: appId,
      requested_by: actor,
      connector_id: parsed.data.connector_id,
      name: parsed.data.name,
      base_url: parsed.data.base_url,
      timeout_ms: parsed.data.timeout_ms,
      retries: parsed.data.retries,
      rate_limit: parsed.data.rate_limit,
      mapping: parsed.data.mapping,
      taxonomy: parsed.data.taxonomy,
      state: 'pending',
      requestedAt: new Date(),
    });

    await this.audit.append({
      timestamp: new Date(),
      actor,
      action: 'connector_request.requested',
      target: appId,
      new_state: 'pending',
      connector_id: parsed.data.connector_id,
      request_id: created.request_id,
    });

    return created;
  }

  /**
   * The Connectors page's status list for one app —
   * owner-scoped, fail-closed.
   */
  async listForApp(
    appId: string,
    actor: string,
  ): Promise<ConnectorRequestDocument[]> {
    await this.assertOwner(appId, actor);
    return this.repository.listByApp(appId);
  }

  /**
   * The operator's read: every pending request across
   * every app (the CLI provision step's queue).
   */
  async listPending(): Promise<ConnectorRequestDocument[]> {
    return this.repository.listPending();
  }

  /**
   * The single-request read — owner-scoped,
   * fail-closed: a request that belongs to another
   * owner's app is the same refusal as a missing
   * one (D-97).
   */
  async getForApp(
    appId: string,
    requestId: string,
    actor: string,
  ): Promise<ConnectorRequestDocument> {
    await this.assertOwner(appId, actor);
    const request = await this.repository.findByRequestId(
      requestId,
    );
    if (request === null || request.app_id !== appId) {
      throw new ConnectorRequestNotFoundError(requestId);
    }
    return request;
  }

  /**
   * The owner's cancel (D-98): `pending → rejected`
   * with the cancel reason, audited. Pending only —
   * a request the operator already resolved cannot
   * be cancelled.
   */
  async cancel(
    appId: string,
    requestId: string,
    actor: string,
    reason = 'cancelled by owner',
  ): Promise<ConnectorRequestDocument> {
    await this.assertOwner(appId, actor);
    const current = await this.assertPending(appId, requestId);

    const cancelled = await this.repository.transition(
      requestId,
      'rejected',
      { reason },
    );
    if (cancelled === null) {
      throw new ConnectorRequestNotFoundError(requestId);
    }

    await this.audit.append({
      timestamp: new Date(),
      actor,
      action: 'connector_request.cancelled',
      target: appId,
      previous_state: 'pending',
      new_state: 'rejected',
      connector_id: current.connector_id,
      request_id: requestId,
      reason,
    });

    return cancelled;
  }

  /**
   * The owner's retry (D-98): a **fresh request_id**
   * carrying the same definition, issued only after
   * the previous request for the pair reached a
   * terminal state — the one-pending invariant
   * (T-06-24) is checked both ways: the previous
   * record must be terminal, and no other pending
   * request may exist for the pair. The terminal
   * request's resolution (reason, `resolvedAt`,
   * `credential_ref`) never travels to the fresh
   * request.
   */
  async retry(
    appId: string,
    requestId: string,
    actor: string,
  ): Promise<ConnectorRequestDocument> {
    await this.assertOwner(appId, actor);

    const previous = await this.repository.findByRequestId(
      requestId,
    );
    if (previous === null || previous.app_id !== appId) {
      throw new ConnectorRequestNotFoundError(requestId);
    }
    // The previous pair's record must be terminal
    // first — retrying a pending request would
    // create a second pending row for the pair.
    if (previous.state === 'pending') {
      throw new ConnectorRequestTransitionError(
        requestId,
        'pending',
        'retry requires the previous request for the pair to be terminal (provisioned or rejected) first',
      );
    }
    const pending = await this.repository.findPending(
      appId,
      previous.connector_id,
    );
    if (pending !== null) {
      throw new ConnectorRequestPendingExistsError(
        appId,
        previous.connector_id,
        pending.request_id,
      );
    }

    // The definition travels; the resolution does not.
    const {
      request_id: _previousRequestId,
      state: _previousState,
      reason: _previousReason,
      credential_ref: _previousCredentialRef,
      resolvedAt: _previousResolvedAt,
      ...definition
    } = previous;
    const created = await this.repository.create({
      ...definition,
      request_id: randomUUID(),
      state: 'pending',
      requestedAt: new Date(),
    });

    await this.audit.append({
      timestamp: new Date(),
      actor,
      action: 'connector_request.retried',
      target: appId,
      previous_state: previous.state,
      new_state: 'pending',
      connector_id: previous.connector_id,
      request_id: created.request_id,
      previous_request_id: requestId,
    });

    return created;
  }

  /**
   * The operator's rejection (D-98): `pending →
   * rejected` with the operator's reason, which the
   * admin sees on the status badge. The operator is
   * the platform role, not the app's owner — no
   * owner check here (the operator's seam is the
   * audited CLI, D-97).
   */
  async reject(
    requestId: string,
    reason: string,
    actor = 'operator',
  ): Promise<ConnectorRequestDocument> {
    const current = await this.repository.findByRequestId(
      requestId,
    );
    if (current === null) {
      throw new ConnectorRequestNotFoundError(requestId);
    }
    if (current.state !== 'pending') {
      throw new ConnectorRequestTransitionError(
        requestId,
        current.state,
        'reject operates on a pending request',
      );
    }

    const rejected = await this.repository.transition(
      requestId,
      'rejected',
      { reason },
    );
    if (rejected === null) {
      throw new ConnectorRequestNotFoundError(requestId);
    }

    await this.audit.append({
      timestamp: new Date(),
      actor,
      action: 'connector_request.rejected',
      target: current.app_id,
      previous_state: 'pending',
      new_state: 'rejected',
      connector_id: current.connector_id,
      request_id: requestId,
      reason,
    });

    return rejected;
  }

  /** Refuse an actor who does not own the app — the same as a missing app. */
  private async assertOwner(
    appId: string,
    actor: string,
  ): Promise<void> {
    const definition = await this.definitions.findByAppId(appId);
    if (definition === null || definition.createdBy !== actor) {
      throw new AppNotFoundError(appId);
    }
  }

  /** The request, if it is this app's pending request. */
  private async assertPending(
    appId: string,
    requestId: string,
  ): Promise<ConnectorRequestDocument> {
    const current = await this.repository.findByRequestId(
      requestId,
    );
    if (current === null || current.app_id !== appId) {
      throw new ConnectorRequestNotFoundError(requestId);
    }
    if (current.state !== 'pending') {
      throw new ConnectorRequestTransitionError(
        requestId,
        current.state,
        'cancel operates on a pending request',
      );
    }
    return current;
  }
}

/** Re-exported for callers that branch on the named refusal. */
export {
  ConnectorRequestNotFoundError,
  ConnectorRequestPendingExistsError,
  ConnectorRequestTransitionError,
};
export type { AuditEntry, ConnectorRequestDocument };
