/**
 * The ownership-transfer request endpoint
 * (ACL-05, ACL-10).
 *
 * `POST /apps/:id/transfer-requests` is
 * the owner's self-service step: the
 * target owner is the **only** input, the
 * record is created `pending` with the
 * 7-day TTL, and the request is audited
 * (D-86). The owner requests, never
 * executes — the approval is a
 * global-admin action on the sibling
 * {@link TransferApprovalController}.
 *
 * ## Owner-scoped, fail-closed
 *
 * The session's `realUserId` must own the
 * app; a non-owner gets the same 404 as a
 * missing app — never a 403 that would
 * leak the app's existence (D-97's
 * discipline, applied to ownership).
 *
 * ## Error discipline (BLD-07)
 *
 * The {@link BuilderExceptionFilter}
 * renders every domain refusal inline as
 * `{error: {code, message}}` — a second
 * pending transfer for the app is a 409
 * naming the pending `transfer_id` it
 * protects, an invalid target is a 400
 * naming the offending field.
 *
 * ## The projection (D-43)
 *
 * The served transfer is the document
 * minus Mongo's `_id`, dates in their ISO
 * wire form — exactly the response
 * contract's fields, nothing else.
 */

import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UseFilters,
} from '@nestjs/common';

import type { Request } from 'express';

import {
  TransferRequestService,
  type TransferRequestDocument,
} from '@akane/domain';

import { BuilderExceptionFilter } from './app-builder.controller.js';

@Controller('apps/:id/transfer-requests')
@UseFilters(new BuilderExceptionFilter())
export class TransferRequestController {
  constructor(private readonly transfers: TransferRequestService) {}

  /**
   * Request a transfer of the app's
   * ownership — the target owner, a
   * `pending` record with the 7-day TTL,
   * and an AUD-01 append (ACL-10, D-86).
   */
  @Post()
  @HttpCode(201)
  async create(
    @Param('id') appId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const created = await this.transfers.requestTransfer(
      appId,
      actorOf(req),
      newOwnerUserIdOf(body),
    );
    return toTransferResponse(created);
  }
}

/**
 * The authenticated builder admin's
 * identity — the `real_user` the session
 * middleware attached to the request, with
 * the role the transfer rules branch on.
 */
function actorOf(req: Request): {
  realUserId: string;
  role: string;
} {
  const user = (
    req as Request & {
      user?: { realUserId?: string; role?: string };
    }
  ).user;
  return {
    realUserId: user?.realUserId ?? 'anonymous',
    role: user?.role ?? 'anonymous',
  };
}

/**
 * The target owner from the request body.
 * A non-string (or missing) value reaches
 * the service as the empty string, so the
 * contract's `min(1)` rule refuses it
 * inline with the field named (BLD-07) —
 * never a crash on an unshaped payload.
 */
function newOwnerUserIdOf(body: unknown): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'new_owner_user_id' in body
  ) {
    const value = (
      body as { new_owner_user_id?: unknown }
    ).new_owner_user_id;
    return typeof value === 'string' ? value : '';
  }
  return '';
}

/** The served projection: the transfer minus Mongo's `_id`, dates in ISO form. */
export function toTransferResponse(
  document: TransferRequestDocument,
): Record<string, unknown> {
  const { _id, ...transfer } = document;
  return {
    ...transfer,
    requestedAt: transfer.requestedAt.toISOString(),
    expiresAt: transfer.expiresAt.toISOString(),
    ...(transfer.resolvedAt === undefined
      ? {}
      : { resolvedAt: transfer.resolvedAt.toISOString() }),
  };
}
