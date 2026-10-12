/**
 * The connector-request endpoints (BLD-10, D-97..D-100).
 *
 * `POST /apps/:id/connector-requests` is the admin's
 * self-service step — the **full connector definition
 * minus the secret** (D-99) — and
 * `GET /apps/:id/connector-requests` is the Connectors
 * page's status list. Both are **owner-scoped,
 * fail-closed**: the session's `realUserId` must own
 * the app, and a non-owner gets the same 404 as a
 * missing app — never a 403 that would leak the
 * app's existence (D-97).
 *
 * ## Error discipline (BLD-07)
 *
 * The {@link BuilderExceptionFilter} renders every
 * domain refusal inline as `{error: {code, message}}`
 * — a second pending request for the pair is a 409
 * naming the pending `request_id` it protects
 * (T-06-24), an invalid definition is a 400 naming
 * the offending field.
 *
 * ## The projection (T-06-23)
 *
 * The served request is the document minus Mongo's
 * `_id` — the field-allowlist discipline (D-43):
 * exactly the response contract's fields, nothing
 * else. No field can carry a credential; the
 * operator-set `credential_ref` is an opaque handle.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseFilters,
} from '@nestjs/common';

import type { Request } from 'express';

import {
  ConnectorRequestService,
  type ConnectorRequestDocument,
} from '@akane/domain';

import {
  BuilderExceptionFilter,
  errorBody,
} from './app-builder.controller.js';

@Controller('apps/:id/connector-requests')
@UseFilters(new BuilderExceptionFilter())
export class ConnectorRequestController {
  constructor(private readonly requests: ConnectorRequestService) {}

  /**
   * Request a connector for the app — the
   * definition minus the secret, persisted as
   * `pending` and audited (D-99, D-86).
   */
  @Post()
  @HttpCode(201)
  async create(
    @Param('id') appId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const created = await this.requests.request(
      appId,
      actorOf(req),
      body,
    );
    return toConnectorRequestResponse(created);
  }

  /** The Connectors page's status list for the app. */
  @Get()
  async list(
    @Param('id') appId: string,
    @Req() req: Request,
  ): Promise<{ requests: Record<string, unknown>[] }> {
    const requests = await this.requests.listForApp(
      appId,
      actorOf(req),
    );
    return {
      requests: requests.map(toConnectorRequestResponse),
    };
  }
}

/**
 * The authenticated builder admin's identity — the
 * `real_user` the D-104 auto-provisioner created and
 * the session middleware attached to the request.
 */
function actorOf(req: Request): string {
  const user = (req as Request & { user?: { realUserId?: string } })
    .user;
  return user?.realUserId ?? 'anonymous';
}

/** The served projection: the request minus Mongo's `_id`. */
function toConnectorRequestResponse(
  document: ConnectorRequestDocument,
): Record<string, unknown> {
  const { _id, ...request } = document;
  return request;
}
