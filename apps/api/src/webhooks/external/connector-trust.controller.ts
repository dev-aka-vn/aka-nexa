import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseFilters,
} from '@nestjs/common';
import type { Request } from 'express';

import { BuilderExceptionFilter } from '../../app-builder/app-builder.controller.js';
import {
  AuditRepository,
  ConnectorTrustRepository,
  GlobalAdminRequiredError,
  type ConnectorTrustInput,
  type ConnectorTrustMechanism,
  type ConnectorTrustRecord,
} from '@akane/domain';

@Controller('connector-trust')
@UseFilters(new BuilderExceptionFilter())
export class ConnectorTrustController {
  constructor(
    private readonly trustRepo: ConnectorTrustRepository,
    private readonly audit: AuditRepository,
  ) {}

  private assertGlobalAdmin(req: Request): void {
    const user = (req as Request & { user?: { role?: string; realUserId?: string } }).user;
    if (user?.role !== 'global-admin') {
      throw new GlobalAdminRequiredError();
    }
  }

  private actorOf(req: Request): string {
    const user = (req as Request & { user?: { realUserId?: string } }).user;
    return user?.realUserId ?? 'anonymous';
  }

  @Get()
  @HttpCode(200)
  async list(@Req() req: Request): Promise<{ records: ConnectorTrustRecord[] }> {
    this.assertGlobalAdmin(req);
    const records = await this.trustRepo.list();
    return { records };
  }

  @Get(':connectorId')
  @HttpCode(200)
  async get(
    @Param('connectorId') connectorId: string,
    @Req() req: Request,
  ): Promise<{ record: ConnectorTrustRecord | null }> {
    this.assertGlobalAdmin(req);
    const record = await this.trustRepo.get(connectorId);
    return { record };
  }

  @Post()
  @HttpCode(200)
  async upsertBody(
    @Body() body: { connectorId?: string; mechanism?: ConnectorTrustMechanism; note?: string },
    @Req() req: Request,
  ): Promise<{ record: ConnectorTrustRecord }> {
    this.assertGlobalAdmin(req);
    const connectorId = String(body?.connectorId ?? '').trim();
    if (!connectorId) {
      throw new Error('Missing connectorId');
    }
    return this.doUpsert(connectorId, body?.mechanism, body?.note, req);
  }

  @Post(':connectorId')
  @HttpCode(200)
  async upsertParam(
    @Param('connectorId') connectorId: string,
    @Body() body: { mechanism?: ConnectorTrustMechanism; note?: string },
    @Req() req: Request,
  ): Promise<{ record: ConnectorTrustRecord }> {
    this.assertGlobalAdmin(req);
    return this.doUpsert(connectorId, body?.mechanism, body?.note, req);
  }

  private async doUpsert(
    connectorId: string,
    mechanism: ConnectorTrustMechanism | undefined,
    note: string | undefined,
    req: Request,
  ): Promise<{ record: ConnectorTrustRecord }> {
    if (!mechanism) {
      throw new Error('Missing mechanism');
    }
    const trimmedNote = String(note ?? '').trim();
    if (trimmedNote.length === 0) {
      throw new Error('note is required');
    }
    const actor = this.actorOf(req);
    const input: ConnectorTrustInput = {
      mechanism,
      note: trimmedNote,
      updatedBy: actor,
    };
    const record = await this.trustRepo.upsert(connectorId, input);
    await this.audit.append({
      timestamp: new Date(),
      actor,
      action: 'connector.trust_upserted',
      target: connectorId,
      connectorId,
      mechanism,
      updatedBy: actor,
    });
    return { record };
  }
}