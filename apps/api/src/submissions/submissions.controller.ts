/**
 * The submissions viewer (BLD-08, D-111).
 *
 * `GET /submissions` lists one app's submissions
 * with the composed filters (status, date range,
 * form); `GET /submissions/:id` is the detail
 * view; `GET /submissions/export` is the
 * visible-column CSV export.
 *
 * ## Owner-scoping, fail-closed (D-97 discipline)
 *
 * The viewer lists only the requesting owner's
 * own apps' submissions: the session's
 * `realUserId` must own the app, and a non-owner
 * gets the same 404 as a missing app — never a
 * 403 that would leak the app's existence. The
 * check happens at the app level (the
 * definition's `createdBy`), because a
 * submission's `real_user_id` is the *submitting
 * end-user* (the read-link path's D-79 rule),
 * not the builder admin who owns the app.
 *
 * ## Error discipline (BLD-07)
 *
 * Every refusal is inline and specific: an
 * invalid filter names the offending field, a
 * foreign or missing app is `APP_NOT_FOUND`, a
 * foreign or missing submission is
 * `SUBMISSION_NOT_FOUND` — rendered by the
 * {@link BuilderExceptionFilter} as
 * `{error: {code, message}}`, never a generic
 * failure.
 *
 * ## The projection (D-111)
 *
 * The list, the detail, and the export render
 * the same projected row — the visible columns
 * and nothing else. The export projects through
 * the allowlist **before** serialization, so no
 * field outside it can appear in a CSV row.
 */

import {
  Controller,
  Get,
  HttpCode,
  Param,
  Query,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';

import type { Request, Response } from 'express';

import {
  AppDefinitionRepository,
  AppNotFoundError,
  BuilderError,
  SubmissionRepository,
  SubmissionRevisionsRepository,
} from '@akane/domain';
import {
  SubmissionsFilterSchema,
  type SubmissionsFilter,
} from '@akane/contract';

import { BuilderExceptionFilter, errorBody } from '../app-builder/app-builder.controller.js';
import {
  SubmissionExportService,
} from './submission-export.service.js';
import {
  toViewerRow,
  type SubmissionViewerRow,
} from './viewer-row.js';

/** A filter that failed contract validation, naming the offending field. */
export class SubmissionsValidationError extends BuilderError {
  constructor(message: string) {
    super('SUBMISSIONS_VALIDATION', message);
  }
}

/** A submission that does not exist (or is not this owner's to see). */
export class SubmissionNotFoundError extends BuilderError {
  constructor(submissionId: string) {
    super(
      'SUBMISSION_NOT_FOUND',
      `submission not found: ${submissionId}`,
    );
  }
}

@Controller('submissions')
@UseFilters(new BuilderExceptionFilter())
export class SubmissionsController {
  constructor(
    private readonly submissions: SubmissionRepository,
    private readonly revisions: SubmissionRevisionsRepository,
    private readonly definitions: AppDefinitionRepository,
    private readonly exportService: SubmissionExportService,
  ) {}

  /**
   * The viewer's list — the owner's app's
   * submissions, filtered, newest first.
   */
  @Get()
  async list(
    @Query() query: unknown,
    @Req() req: Request,
  ): Promise<{ submissions: SubmissionViewerRow[] }> {
    const filter = this.parseFilter(query);
    await this.assertAppOwner(filter.app_id, actorOf(req));
    return {
      submissions: await this.exportService.listRows(filter),
    };
  }

  /**
   * The visible-column CSV export — the same
   * filter, the same projection, serialized.
   * Declared before `:id` so the static
   * segment wins the route match.
   */
  @Get('export')
  @HttpCode(200)
  async export(
    @Query() query: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const filter = this.parseFilter(query);
    const actor = actorOf(req);
    await this.assertAppOwner(filter.app_id, actor);
    const { csv } = await this.exportService.exportSubmissions(
      filter,
      actor,
    );
    res.setHeader('content-type', 'text/csv');
    res.setHeader(
      'content-disposition',
      `attachment; filename="submissions-${filter.app_id}.csv"`,
    );
    res.send(csv);
  }

  /** The detail view — one submission, owner-scoped. */
  @Get(':id')
  async detail(
    @Param('id') submissionId: string,
    @Req() req: Request,
  ): Promise<SubmissionViewerRow> {
    const submission = await this.submissions.findById(
      submissionId,
    );
    if (submission === null) {
      throw new SubmissionNotFoundError(submissionId);
    }
    await this.assertAppOwner(submission.app_id, actorOf(req));
    const latest = await this.revisions.findLatest(
      submission._id,
    );
    return toViewerRow(submission, latest);
  }

  /** Parse and validate the filter set, naming the offending field. */
  private parseFilter(query: unknown): SubmissionsFilter {
    const parsed = SubmissionsFilterSchema.safeParse(
      query ?? {},
    );
    if (!parsed.success) {
      throw new SubmissionsValidationError(
        parsed.error.issues
          .map(
            (issue) =>
              `${issue.path.join('.') || '(root)'}: ${issue.message}`,
          )
          .join('; '),
      );
    }
    return {
      app_id: parsed.data.app_id,
      status: parsed.data.status,
      from: parsed.data.from === undefined ? undefined : new Date(parsed.data.from),
      to: parsed.data.to === undefined ? undefined : new Date(parsed.data.to),
      form_id: parsed.data.form,
    };
  }

  /**
   * The fail-closed ownership check: a non-owner
   * and a missing app are the same refusal.
   */
  private async assertAppOwner(
    appId: string,
    actor: string,
  ): Promise<void> {
    const definition = await this.definitions.findByAppId(
      appId,
    );
    if (definition === null || definition.createdBy !== actor) {
      throw new AppNotFoundError(appId);
    }
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
