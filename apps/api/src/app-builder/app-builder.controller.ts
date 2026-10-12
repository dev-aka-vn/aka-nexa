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
  Req,
  Request,
  UseFilters,
} from '@nestjs/common';

import {
  AppDefinitionService,
  BuilderError,
  type AppDefinitionDocument,
} from '@akane/domain';

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
  constructor(private readonly definitions: AppDefinitionService) {}

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

  /** The plan-05 gate's seam: commit the publish transition. */
  @Post('apps/:id/publish')
  @HttpCode(200)
  async publish(
    @Param('id') appId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const published = await this.definitions.commitPublish(
      appId,
      actorOf(req),
    );
    return toDefinitionResponse(published);
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
}

/**
 * The authenticated builder admin's identity — the
 * `real_user` the D-104 auto-provisioner created and
 * the session middleware attached to the request.
 */
function actorOf(req: Request): string {
  const user = (req as Request & { user?: { real_user_id?: string } }).user;
  return user?.real_user_id ?? 'anonymous';
}

/** Map a domain refusal to its HTTP status. The code is the contract. */
function builderErrorStatus(error: BuilderError): HttpStatus {
  switch (error.code) {
    case 'APP_NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'APP_ID_IN_USE':
    case 'LIFECYCLE_ILLEGAL_TRANSITION':
    case 'VERSION_CONFLICT':
    case 'VERSION_NOT_RETAINED':
      return HttpStatus.CONFLICT;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

function errorBody(code: string, message: string): {
  error: { code: string; message: string };
} {
  return { error: { code, message } };
}

/** The served projection: the definition minus Mongo's `_id`. */
function toDefinitionResponse(doc: AppDefinitionDocument): Record<string, unknown> {
  const { _id, ...definition } = doc;
  return definition;
}
