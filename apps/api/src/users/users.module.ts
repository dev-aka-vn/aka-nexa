/**
 * The users module (D-110) — the Users page's
 * backend.
 *
 * Owns the IDN-08 SSO identity mapping surface:
 * the global-admin endpoints that join an OIDC
 * subject to an existing `real_user_id` (no OTP —
 * the admin's global-admin session is the proof)
 * and list the mappings by email (the IDN-07
 * search shape).
 *
 * Composes the shared `IdentityModule` stores —
 * the same directory the D-104 auto-provisioner
 * writes at login — and `SsoMappingService`
 * from the domain. The @casl/ability rule set
 * lands in plan 07; the endpoints carry their
 * own global-admin role assertion now, and the
 * ability rules consume the same role token
 * then.
 */

import { Module } from '@nestjs/common';

import { SsoMappingService } from '@akane/domain';

import { IdentityModule } from '../identity/identity.module.js';
import { UsersController } from './users.controller.js';

@Module({
  imports: [IdentityModule],
  controllers: [UsersController],
  providers: [SsoMappingService],
})
export class UsersModule {}
