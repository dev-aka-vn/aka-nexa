import { Controller, Get, Post, Query, Body, Res, Logger, Inject } from '@nestjs/common';
import type { Response } from 'express';

import { ReadDenyReason } from '@akane/contract';
import {
  ReadVerifierService,
  type ReadVerifyResult,
  SubmissionRepository,
  SubmissionRevisionsRepository,
  LinkTokenStore,
  DataRouterService,
} from '@akane/domain';
import type { ReadLinkConfig } from './read.module.js';
import { projectSubmissionStatus } from './status-projection.js';

const logger = new Logger('ReadController');

/**
 * `GET /l/view/:jti` — the stateless read-link entry point (LNK-05, FRM-06).
 *
 * The browser receives this URL from a chat message. The `:jti` route segment is
 * informational (it matches the token's `jti` claim for logging); the actual
 * verification uses the `token` query parameter, which is the signed JWT.
 *
 * ## Flow
 *
 * 1. Verify the JWT with the public key alone (LNK-05) — no Redis, no session.
 * 2. Parse claims against the frozen `ReadLinkClaimsSchema` (D-21).
 * 3. Branch by `action` (D-40): `view` → fetch owned submission (D-79) +
 *    fresh `perm_version` check (LNK-06); `query` → permission check only.
 * 4. On success: `200` with the view payload (submission + form claims).
 *    On denial: `302` redirect to the renderer's dead-link page with the reason
 *    as a query parameter (D-70).
 *
 * The redirect target is the renderer origin (`RENDERER_ORIGIN`), a static web
 * app that renders the dead-link copy and offers the IM request affordance.
 */
@Controller('l')
export class ReadController {
  private readonly rendererOrigin: string;

  constructor(
    private readonly verifier: ReadVerifierService,
    private readonly submissions: SubmissionRepository,
    private readonly revisions: SubmissionRevisionsRepository,
    private readonly tokenStore: LinkTokenStore,
    private readonly dataRouter: DataRouterService,
    @Inject('READ_LINK_CONFIG') config: ReadLinkConfig,
  ) {
    this.rendererOrigin = config.rendererOrigin;
  }

  @Get('view/:jti')
  async view(
    @Query('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!token) {
      this.redirectToDead(res, ReadDenyReason.bad_signature);
      return;
    }

    const result: ReadVerifyResult = await this.verifier.verify(token);

    if (result.ok) {
      logger.log(
        `view access granted: jti=${result.claims.jti} app=${result.claims.app_id} sub=${result.claims.sub}`,
      );

      res.status(200).json({
        claims: result.claims,
        submission: result.submission ?? null,
      });
      return;
    }

    // LNK-08: record the distinct denial reason.
    logger.warn(`view access denied: reason=${result.reason}`);

    this.redirectToDead(res, result.reason);
  }

  @Get('query/:jti')
  async query(
    @Query('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!token) {
      this.redirectToDead(res, ReadDenyReason.bad_signature);
      return;
    }

    const result: ReadVerifyResult = await this.verifier.verify(token);

    if (result.ok) {
      logger.log(
        `query access granted: jti=${result.claims.jti} app=${result.claims.app_id} sub=${result.claims.sub}`,
      );

      const queryResult = await this.submissions.queryWithDsl(
        result.savedQuery?.dsl ?? {},
        {
          viewerId: result.claims.sub,
          hasViewAll: false,
          appId: result.claims.app_id,
        },
      );

      if (!queryResult.ok) {
        res.status(200).json({
          claims: result.claims,
          savedQuery: result.savedQuery ?? null,
          rows: [],
        });
        return;
      }

      const rows = await Promise.all(
        queryResult.rows.map(async (row) => {
          const submissionId =
            row.submission_id ??
            row._id ??
            row.id ??
            result.claims.sub;
          const latest = await this.revisions.findLatest(String(submissionId));
          return projectSubmissionStatus({
            queryRow: row,
            latestRevision: latest,
          });
        }),
      );

      res.status(200).json({
        claims: result.claims,
        savedQuery: result.savedQuery ?? null,
        rows,
      });
      return;
    }

    // LNK-08: record the distinct denial reason.
    logger.warn(`query access denied: reason=${result.reason}`);

    this.redirectToDead(res, result.reason);
  }

  @Get('edit/:jti')
  async editGet(
    @Query('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!token) {
      this.redirectToDead(res, ReadDenyReason.bad_signature);
      return;
    }

    const result: ReadVerifyResult = await this.verifier.verify(token);

    if (result.ok) {
      logger.log(
        `edit access granted: jti=${result.claims.jti} app=${result.claims.app_id} sub=${result.claims.sub}`,
      );

      res.status(200).json({
        claims: result.claims,
        submission: result.submission ?? null,
        latestRevision: result.latestRevision ?? null,
        editOutcome: result.editOutcome ?? null,
      });
      return;
    }

    logger.warn(`edit access denied: reason=${result.reason}`);
    this.redirectToDead(res, result.reason);
  }

  @Post('edit/:jti')
  async editPost(
    @Query('token') token: string,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    if (!token) {
      this.redirectToDead(res, ReadDenyReason.bad_signature);
      return;
    }

    const result: ReadVerifyResult = await this.verifier.verify(token);

    if (!result.ok) {
      logger.warn(`edit submit denied: reason=${result.reason}`);
      this.redirectToDead(res, result.reason);
      return;
    }

    const jti = result.claims.jti;

    // 2. Check for existing outcome (replay)
    const existingOutcome = await this.tokenStore.readOutcome(jti);
    if (existingOutcome) {
      res.status(200).json({
        status: 'replayed',
        submission_id: existingOutcome.submission_id,
        revision: existingOutcome.revision,
        downstreamRef: existingOutcome.downstreamRef ?? null,
      });
      return;
    }

    try {
      // 3. Route edit with editJti in transaction
      const routeResult = await this.dataRouter.routeEdit({
        submissionId: result.claims.target_id ?? '',
        appId: result.claims.app_id,
        formId: result.claims.form_id,
        data: body,
        connectorRef: body?.connectorRef as string | undefined,
        revision: body?.revision as number | undefined,
        editJti: jti,
      });

      // 4. Record outcome
      const outcome = {
        submission_id: result.claims.target_id ?? '',
        revision: routeResult.revision,
        downstreamRef: null,
      };
      await this.tokenStore.recordOutcome(jti, outcome, 14400); // 4 hours default

      res.status(200).json({
        status: 'accepted',
        submission_id: outcome.submission_id,
        revision: outcome.revision,
        downstreamRef: outcome.downstreamRef,
      });
    } catch (error: unknown) {
      const err = error as { code?: number; message?: string } | null | undefined;
      // Check for duplicate key error (concurrent submit)
      if (err?.code === 11000 || err?.message?.includes('duplicate')) {
        // Try to find existing by edit_jti and return replay
        const existing = await this.revisions.findByEditJti(jti);
        if (existing) {
          const outcomeReplay = await this.tokenStore.readOutcome(jti);
          if (outcomeReplay) {
            res.status(200).json({
              status: 'replayed',
              submission_id: outcomeReplay.submission_id,
              revision: outcomeReplay.revision,
              downstreamRef: outcomeReplay.downstreamRef ?? null,
            });
            return;
          }
          res.status(200).json({
            status: 'replayed',
            submission_id: existing.submission_id,
            revision: existing.revision,
            downstreamRef: existing.downstreamReference ?? null,
          });
          return;
        }
      }
      // Re-throw other errors (transaction failed - should not consume token)
      throw error;
    }
  }

  /**
   * Issue a 302 to the renderer's dead-link page with the reason as a query
   * parameter. The renderer reads `reason` and displays the D-70 copy.
   */
  private redirectToDead(res: Response, reason: ReadDenyReason): void {
    const url = `${this.rendererOrigin}/read/dead.html?reason=${encodeURIComponent(reason)}`;
    res.redirect(302, url);
  }
}
