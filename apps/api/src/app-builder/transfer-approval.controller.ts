/**
 * The ownership-transfer approval surface
 * (ACL-05).
 *
 * `GET /transfer-approvals` is the global
 * admin's queue of pending transfers;
 * `POST /transfer-approvals/:id/approve`
 * moves ownership and resolves the record;
 * `POST /transfer-approvals/:id/reject`
 * resolves it rejected. All three are
 * **global-admin only** — the route guard
 * here and the service-level guard behind
 * it (the approval is a platform action,
 * not the owner's; the owner requests,
 * never executes, ACL-10).
 *
 * ## Error discipline (BLD-07)
 *
 * The {@link BuilderExceptionFilter}
 * renders every domain refusal inline as
 * `{error: {code, message}}` — a non-admin
 * actor is a 403 naming
 * `GLOBAL_ADMIN_REQUIRED`, an approval
 * after the record resolved (an
 * auto-cancelled one included, T-06-31) is
 * a 409 naming the illegal transition.
 */

import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseFilters,
} from '@nestjs/common';

import type { Request } from 'express';

import {
  GlobalAdminRequiredError,
  TransferRequestService,
} from '@akane/domain';

import {
  BuilderExceptionFilter,
} from './app-builder.controller.js';
import { toTransferResponse } from './transfer-request.controller.js';

@Controller('transfer-approvals')
@UseFilters(new BuilderExceptionFilter())
export class TransferApprovalController {
  constructor(private readonly transfers: TransferRequestService) {}

  /**
   * The global admin's approval queue —
   * every pending transfer across every
   * app, newest first.
   */
  @Get()
  async queue(
    @Req() req: Request,
  ): Promise<{ transfers: Record<string, unknown>[] }> {
    assertGlobalAdmin(req);
    const pending = await this.transfers.listPending();
    return {
      transfers: pending.map(toTransferResponse),
    };
  }

  /**
   * The global admin's approval (ACL-05):
   * ownership moves to the requested
   * target, the record resolves
   * `approved`, and the transition is
   * audited (D-86).
   */
  @Post(':transferId/approve')
  @HttpCode(200)
  async approve(
    @Param('transferId') transferId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    assertGlobalAdmin(req);
    const approved = await this.transfers.approve(
      transferId,
      actorOf(req),
    );
    return toTransferResponse(approved);
  }

  /**
   * The global admin's rejection (ACL-05):
   * the record resolves `rejected`,
   * audited. Ownership does not move.
   */
  @Post(':transferId/reject')
  @HttpCode(200)
  async reject(
    @Param('transferId') transferId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    assertGlobalAdmin(req);
    const rejected = await this.transfers.reject(
      transferId,
      actorOf(req),
    );
    return toTransferResponse(rejected);
  }
}

/**
 * The route-level half of the global-admin
 * gate: refuse before the service is
 * reached. The service guards again — the
 * role check is defense in depth, not a
 * single point.
 */
function assertGlobalAdmin(req: Request): void {
  const user = (
    req as Request & { user?: { role?: string } }
  ).user;
  if (user?.role !== 'global-admin') {
    throw new GlobalAdminRequiredError();
  }
}

/** The authenticated actor, with the role the transfer rules branch on. */
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
