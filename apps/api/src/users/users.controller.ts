/**
 * The users endpoints (IDN-08, D-110).
 *
 * The SSO identity mapping surface the Users
 * page backs. Both endpoints are the builder's
 * **global-admin identity surface**: the role
 * assertion lives here (the @casl/ability rule
 * set lands in plan 07 and consumes the same
 * role token the session middleware resolves),
 * and every failure answers a specific,
 * field-naming inline error (BLD-07) — never
 * a generic "bad request".
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  SsoMappingCreateSchema,
  SsoMappingErrorSchema,
  SsoMappingSchema,
} from '@akane/contract';

import { ProfileRepository, SsoMappingService } from '@akane/domain';

/** The directory search's result cap — the autocomplete is a prefix list, not an export. */
const USER_SEARCH_LIMIT = 50;

@Controller('users')
export class UsersController {
  constructor(
    private readonly ssoMappings: SsoMappingService,
    private readonly profiles: ProfileRepository,
  ) {}

  /**
   * The D-110 gate: only a global-admin
   * session may touch the identity mapping
   * surface. The middleware has already
   * resolved `req.user` from the session
   * record, whose role is the ID token's
   * `role` claim.
   */
  private assertGlobalAdmin(
    req: Request,
    res: Response,
  ): boolean {
    if (req.user?.role !== 'global-admin') {
      res.status(403).json({ error: 'GLOBAL_ADMIN_REQUIRED' });
      return false;
    }
    return true;
  }

  /**
   * `POST /users/sso-mappings` — map an SSO
   * identity to an existing `real_user_id`.
   *
   * No OTP: this is the admin path IDN-08
   * defines (the admin's global-admin session
   * is the proof), deliberately separate from
   * the employee OTP self-onboarding route
   * (IDN-05). A mapping to an unknown
   * `real_user_id` is refused with the
   * offending field named.
   */
  @Post('sso-mappings')
  async createMapping(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.assertGlobalAdmin(req, res)) {
      return;
    }

    const parsed = SsoMappingCreateSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      res.status(400).json(
        SsoMappingErrorSchema.parse({
          error: 'MAPPING_PAYLOAD_INVALID',
          field: issue?.path.join('.') ?? 'body',
          message: issue?.message ?? 'invalid mapping payload',
        }),
      );
      return;
    }

    const result = await this.ssoMappings.create(parsed.data);
    if (!result.ok) {
      res.status(400).json(
        SsoMappingErrorSchema.parse({
          error: result.error,
          field: result.field,
          message: result.message,
        }),
      );
      return;
    }

    res.status(201).json(SsoMappingSchema.parse(result.mapping));
  }

  /**
   * `GET /users/sso-mappings?email=...` — the
   * Users page list: every mapping carrying
   * the email (the IDN-07 search shape).
   */
  @Get('sso-mappings')
  async listMappings(
    @Req() req: Request,
    @Query('email') email: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.assertGlobalAdmin(req, res)) {
      return;
    }

    if (email === undefined || email === '') {
      res.status(400).json(
        SsoMappingErrorSchema.parse({
          error: 'EMAIL_REQUIRED',
          field: 'email',
          message: 'email query parameter is required',
        }),
      );
      return;
    }

    const mappings = await this.ssoMappings.listByEmail(email);
    res.status(200).json(SsoMappingSchema.array().parse(mappings));
  }

  /**
   * `GET /users/search?q=<prefix>` — the
   * role-assignment autocomplete (ACL-02,
   * BLD-03): the identity directory by name or
   * email **prefix**, every entry resolved to its
   * opaque `real_user_id` — the only assignment
   * target the platform supports. The response
   * contract structurally cannot carry a group or
   * attribute target: `users` is the only
   * collection in it. Same global-admin surface
   * as the rest of the Users page (D-110).
   */
  @Get('search')
  async searchUsers(
    @Req() req: Request,
    @Query('q') q: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.assertGlobalAdmin(req, res)) {
      return;
    }

    if (q === undefined || q.trim() === '') {
      res.status(400).json({
        error: 'QUERY_REQUIRED',
        field: 'q',
        message: 'q query parameter is required',
      });
      return;
    }

    const needle = q.trim().toLowerCase();
    const users = (await this.profiles.findAll())
      .filter(
        (profile) =>
          (profile.name ?? '').toLowerCase().startsWith(needle) ||
          profile.email.toLowerCase().startsWith(needle),
      )
      .slice(0, USER_SEARCH_LIMIT)
      .map((profile) => ({
        real_user_id: profile.real_user_id,
        name: profile.name ?? '',
        email: profile.email,
      }));
    res.status(200).json({ users });
  }
}
