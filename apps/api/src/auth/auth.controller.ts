/**
 * The builder's auth endpoints (BLD-12).
 *
 * `begin` and `callback` are the OIDC authorization-code
 * + PKCE pair (D-101) — the browser never sees anything
 * but redirects and the session cookie. `me` is the only
 * surface that reveals the session's owner, and it
 * reveals exactly the opaque `real_user_id` and the
 * MFA timestamp — never a token, never the OIDC
 * subject, never PII.
 */

import { Controller, Get, Res, Req } from '@nestjs/common';
import type { Request, Response } from 'express';

import { SessionMeResponseSchema } from '@akane/contract';

import { OidcService } from './oidc.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly oidc: OidcService) {}

  /**
   * `GET /auth/oidc/begin` — 302 to the corporate IdP's
   * authorization endpoint with a PKCE S256 challenge.
   * The `code_verifier` and `state` are stashed in the
   * pre-login Redis session, not the browser.
   */
  @Get('oidc/begin')
  async begin(@Res() res: Response): Promise<void> {
    await this.oidc.begin(res);
  }

  /**
   * `GET /auth/oidc/callback` — complete the login:
   * exchange the code, gate on the ID token's
   * `acr`/`amr` claims (D-102), auto-provision the
   * `real_user` (D-104), promote the session (D-101),
   * and 302 to the builder root.
   */
  @Get('oidc/callback')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.oidc.callback(req, res);
  }

  /**
   * `GET /auth/me` — the session's own view of its
   * owner. No cookie, no session: 401.
   */
  @Get('me')
  async me(@Req() req: Request, @Res() res: Response): Promise<void> {
    const session = await this.oidc.readSession(req);
    if (session === null) {
      res.status(401).json({ error: 'SESSION_MISSING' });
      return;
    }
    res.status(200).json(
      SessionMeResponseSchema.parse({
        real_user_id: session.realUserId,
        mfa_at: session.mfaAt,
      }),
    );
  }
}
