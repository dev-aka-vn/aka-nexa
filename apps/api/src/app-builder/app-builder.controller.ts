import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseFilters,
} from '@nestjs/common';

import type { Request, Response } from 'express';

import {
  AppDefinitionService,
  AppDefinitionValidationError,
  BuilderError,
  FieldMappingService,
  TemplateSeed,
  type AppDefinitionDocument,
} from '@akane/domain';
import {
  ForkTemplateSchema,
  type ForkTemplateInput,
} from '@akane/contract';

/**
 * Renders every domain refusal inline: the `code` maps
 * to the status, the message names the rule. A generic
 * 500 would violate BLD-07's never-generic discipline,
 * so the filter catches `BuilderError` before Nest's
 * default handler turns it into an opaque failure.
 */
@Catch(BuilderError)
export class BuilderExceptionFilter implements ExceptionFilter {
  catch(exception: BuilderError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response
      .status(builderErrorStatus(exception))
      .json(errorBody(exception.code, exception.message));
  }
}

/**
 * The app-definition endpoints (BLD-02, APP-02, APP-03,
 * APP-05, APP-06).
 *
 * ## Error discipline (BLD-07)
 *
 * Every refusal is **inline and specific**: a
 * `BuilderError` from the domain carries a `code` and a
 * message that names the rule (the lowercase-hyphenated
 * `app_id` rule, `app ID already in use`, the illegal
 * transition), and the {@link BuilderExceptionFilter}
 * maps the code to a status and renders
 * `{error: {code, message}}` — never a generic
 * "something went wrong".
 *
 * ## The definition projection
 *
 * The served definition is the document minus Mongo's
 * `_id` — the field-allowlist discipline (D-43): the
 * builder's surfaces render exactly the definition
 * fields, nothing else.
 *
 * ## The actor
 *
 * The authenticated builder admin — the session
 * middleware (D-101) populates `req.user` with the
 * auto-provisioned `real_user` when the module is
 * composed beside `AuthModule`; the audit row's actor
 * is that identity, never a client-supplied value.
 */
@Controller()
@UseFilters(new BuilderExceptionFilter())
export class AppBuilderController {
  constructor(
    private readonly definitions: AppDefinitionService,
    private readonly templates: TemplateSeed,
    private readonly fieldMapping: FieldMappingService,
  ) {}

  /** Create the wizard's step-1 draft. */
  @Post('apps')
  @HttpCode(201)
  async createApp(
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const draft = await this.definitions.createDraft(
      body as never,
      actorOf(req),
    );
    return toDefinitionResponse(draft);
  }

  /** Fetch one definition by its immutable `app_id`. */
  @Get('apps/:id')
  async getApp(@Param('id') appId: string): Promise<Record<string, unknown>> {
    const definition = await this.definitions.findByAppId(appId);
    if (definition === null) {
      throw new NotFoundException(
        errorBody('APP_NOT_FOUND', `app not found: ${appId}`),
      );
    }
    return toDefinitionResponse(definition);
  }

  /** List the caller's own definitions. */
  @Get('apps')
  async listApps(
    @Req() req: Request,
  ): Promise<{ apps: Record<string, unknown>[] }> {
    const docs = await this.definitions.listByOwner(actorOf(req));
    return { apps: docs.map(toDefinitionResponse) };
  }

  /**
   * The template gallery (D-105) — the platform-owned
   * collection, read-only to builders. Every template
   * is a snapshot source: the only write path is the
   * fork below.
   */
  @Get('templates')
  async listTemplates(): Promise<{
    templates: Record<string, unknown>[];
  }> {
    return {
      templates: (await this.templates.listTemplates()).map(
        (record) => ({ ...record }),
      ),
    };
  }

  /**
   * Fork a template into a user-owned draft (D-108) —
   * a deep-copied snapshot with no origin reference,
   * editable under BLD-02/APP-03 rules from version 1.
   */
  @Post('templates/:id/fork')
  @HttpCode(201)
  async forkTemplate(
    @Param('id') templateId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const parsed = ForkTemplateSchema.safeParse(
      body ?? {},
    );
    if (!parsed.success) {
      throw new AppDefinitionValidationError(
        parsed.error.issues,
      );
    }
    const forked = await this.templates.forkTemplate(
      templateId,
      actorOf(req),
      (parsed.data as ForkTemplateInput).app_id,
    );
    return toDefinitionResponse(forked);
  }

  /** Edit one BLD-02 tab section — a version-bumped, audited transition. */
  @Patch('apps/:id')
  async updateSection(
    @Param('id') appId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const { section, patch } = body as {
      section: string;
      patch: Record<string, unknown>;
    };
    const updated = await this.definitions.updateSection(
      appId,
      actorOf(req),
      section as never,
      patch ?? {},
    );
    return toDefinitionResponse(updated);
  }

  /** Deprecate (APP-05) — functional, notice served, no new triggers. */
  @Post('apps/:id/deprecate')
  @HttpCode(200)
  async deprecate(
    @Param('id') appId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const { notice } = body as { notice: string };
    const deprecated = await this.definitions.deprecate(
      appId,
      actorOf(req),
      notice ?? '',
    );
    return toDefinitionResponse(deprecated);
  }

  /** Archive (APP-06) — terminal; submissions refused, links still resolve. */
  @Post('apps/:id/archive')
  @HttpCode(200)
  async archive(
    @Param('id') appId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const archived = await this.definitions.archive(appId, actorOf(req));
    return toDefinitionResponse(archived);
  }

  /**
   * The BLD-05 field mapping — the visual
   * mapping's data contract. The stored
   * form-field → connector-field mapping
   * (an empty record until the routing tab
   * saves one), served with the definition
   * version it landed on. Owner-scoped,
   * fail-closed: a non-owner gets the same
   * 404 as a missing app.
   */
  @Get('apps/:id/routing/mapping')
  async getMapping(
    @Param('id') appId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    return this.fieldMapping.getMapping(
      appId,
      actorOf(req),
    );
  }

  /**
   * The BLD-05 field mapping write — the
   * routing tab's save. Validated against
   * the contract (a string→string record),
   * stored on the definition's
   * `field-mapping` section (version-bumped,
   * APP-03), and audited (D-86).
   */
  @Put('apps/:id/routing/mapping')
  @HttpCode(200)
  async putMapping(
    @Param('id') appId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    return this.fieldMapping.storeMapping(
      appId,
      actorOf(req),
      body,
    );
  }
}

/**
 * The authenticated builder admin's identity — the
 * `real_user` the D-104 auto-provisioner created and
 * the session middleware attached to the request.
 */
function actorOf(req: Request): string {
  const user = (req as Request & { user?: { realUserId?: string } }).user;
  return user?.realUserId ?? 'anonymous';
}

/** Map a domain refusal to its HTTP status. The code is the contract. */
export function builderErrorStatus(error: BuilderError): HttpStatus {
  switch (error.code) {
    case 'APP_NOT_FOUND':
    case 'TEMPLATE_NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'APP_ID_IN_USE':
    case 'LIFECYCLE_ILLEGAL_TRANSITION':
    case 'VERSION_CONFLICT':
    case 'VERSION_NOT_RETAINED':
    case 'PUBLISH_REFUSED':
    case 'CONNECTOR_REQUEST_PENDING_EXISTS':
    case 'CONNECTOR_REQUEST_ILLEGAL_TRANSITION':
    case 'TRANSFER_PENDING_EXISTS':
    case 'TRANSFER_ILLEGAL_TRANSITION':
      return HttpStatus.CONFLICT;
    case 'CONNECTOR_REQUEST_NOT_FOUND':
    case 'SUBMISSION_NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'TRANSFER_NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'GLOBAL_ADMIN_REQUIRED':
      // The global-admin surfaces (the audit
      // browse, T-06-32; the transfer
      // approvals, ACL-05) refuse a
      // non-admin with the named 403 — the
      // same posture the users surface
      // answers with (D-110).
      return HttpStatus.FORBIDDEN;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

export function errorBody(code: string, message: string): {
  error: { code: string; message: string };
} {
  return { error: { code, message } };
}

/** The served projection: the definition minus Mongo's `_id`. */
function toDefinitionResponse(doc: AppDefinitionDocument): Record<string, unknown> {
  const { _id, ...definition } = doc;
  return definition;
}
