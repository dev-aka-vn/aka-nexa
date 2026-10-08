import { Controller, Get, Query, Res, Logger, Inject } from '@nestjs/common';
import type { Response } from 'express';

import { ReadDenyReason } from '@akane/contract';
import {
  ReadVerifierService,
  type ReadVerifyResult,
} from '@akane/domain';
import type { ReadLinkConfig } from './read.module.js';

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

  /**
   * Issue a 302 to the renderer's dead-link page with the reason as a query
   * parameter. The renderer reads `reason` and displays the D-70 copy.
   */
  private redirectToDead(res: Response, reason: ReadDenyReason): void {
    const url = `${this.rendererOrigin}/read/dead.html?reason=${encodeURIComponent(reason)}`;
    res.redirect(302, url);
  }
}
