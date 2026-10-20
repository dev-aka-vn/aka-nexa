import {
  Controller,
  Get,
  Query,
  Req,
  UseFilters,
  StreamableFile,
} from '@nestjs/common';

import type { Request } from 'express';
import { Readable } from 'node:stream';

import {
  AuditRepository,
  AuditQueryService,
  AuditExportService,
  AccessReviewService,
  BuilderError,
  type AuditEntry,
} from '@akane/domain';

import { BuilderExceptionFilter } from '../app-builder/app-builder.controller.js';

export class AuditForbiddenError extends BuilderError {
  constructor() {
    super('GLOBAL_ADMIN_REQUIRED', 'global-admin session required');
  }
}

export class AuditValidationError extends BuilderError {
  constructor(field: string, constraint: string) {
    super('AUDIT_VALIDATION', `invalid audit pagination field: ${field} (${constraint})`);
  }
}

export const AUDIT_DEFAULT_LIMIT = 20;
export const AUDIT_MAX_LIMIT = 100;

export interface AuditEntryView {
  readonly timestamp: string;
  readonly actor: string;
  readonly action: string;
  readonly target: string;
  readonly app_id?: string;
  readonly previous_state?: string;
  readonly new_state?: string;
  readonly ip?: string;
  readonly request_id?: string;
}

export interface AuditBrowseResponse {
  readonly entries: readonly AuditEntryView[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

@Controller('audit')
@UseFilters(new BuilderExceptionFilter())
export class AuditController {
  constructor(
    private readonly audit: AuditRepository,
    private readonly query: AuditQueryService,
    private readonly exporter: AuditExportService,
    private readonly accessReview: AccessReviewService,
  ) {}

  @Get()
  async browse(@Query() query: unknown, @Req() req: Request): Promise<AuditBrowseResponse> {
    this.assertGlobalAdmin(req);
    const { limit, offset, filters } = this.parseQuery(query);
    const result = await this.query.search(filters, { limit, offset });
    return {
      entries: result.entries.map(toAuditEntryView),
      total: result.total,
      limit,
      offset,
    };
  }

  @Get('export')
  async exportAudit(@Query() query: unknown, @Req() req: Request): Promise<StreamableFile> {
    this.assertGlobalAdmin(req);
    const { filters } = this.parseQuery(query);
    const result = await this.exporter.export(filters);
    const stream = Readable.from([result.body ?? result.content ?? '']);
    return new StreamableFile(stream, {
      type: 'application/x-ndjson',
      disposition: 'attachment; filename="audit.jsonl"',
    });
  }

  @Get('access-review')
  async accessReviewReport(@Req() req: Request): Promise<unknown> {
    this.assertGlobalAdmin(req);
    return this.accessReview.getLatest();
  }

  private assertGlobalAdmin(req: Request): void {
    const user = (req as Request & { user?: { role?: string } }).user;
    if (user?.role !== 'global-admin') throw new AuditForbiddenError();
  }

  private parseQuery(query: unknown): { limit: number; offset: number; filters: Record<string, unknown> } {
    const raw = (query ?? {}) as Record<string, unknown>;
    let limit = AUDIT_DEFAULT_LIMIT;
    if (raw.limit !== undefined) {
      const parsed = Number(raw.limit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > AUDIT_MAX_LIMIT) {
        throw new AuditValidationError('limit', `expected an integer 1..${AUDIT_MAX_LIMIT}`);
      }
      limit = parsed;
    }
    let offset = 0;
    if (raw.offset !== undefined) {
      const parsed = Number(raw.offset);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new AuditValidationError('offset', 'expected an integer >= 0');
      }
      offset = parsed;
    }
    const filters: Record<string, unknown> = {};
    if (raw.user !== undefined) filters.user = raw.user;
    if (raw.app_id !== undefined) filters.app_id = raw.app_id;
    if (raw.app !== undefined) filters.app_id = raw.app;
    if (raw.action !== undefined) filters.action = raw.action;
    if (raw.from !== undefined) filters.from = raw.from;
    if (raw.to !== undefined) filters.to = raw.to;
    return { limit, offset, filters };
  }
}


@Controller('access-review')
@UseFilters(new BuilderExceptionFilter())
export class AccessReviewController {
  constructor(private readonly accessReview: AccessReviewService) {}
  @Get()
  async get(): Promise<unknown> {
    return this.accessReview.getLatest();
  }
  @Get('export')
  async export(): Promise<StreamableFile> {
    const report = await this.accessReview.getLatest();
    const body = JSON.stringify(report ?? {}) + '\n';
    const stream = Readable.from([body]);
    return new StreamableFile(stream, { type: 'application/x-ndjson', disposition: 'attachment; filename="access-review.jsonl"' });
  }
}

function toAuditEntryView(entry: AuditEntry): AuditEntryView {
  return {
    timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : new Date(entry.timestamp as string).toISOString(),
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    ...(entry.app_id !== undefined ? { app_id: entry.app_id } : {}),
    ...(entry.previous_state !== undefined ? { previous_state: entry.previous_state } : {}),
    ...(entry.new_state !== undefined ? { new_state: entry.new_state } : {}),
    ...(entry.ip !== undefined ? { ip: entry.ip } : {}),
    ...(entry.request_id !== undefined ? { request_id: entry.request_id } : {}),
  };
}
