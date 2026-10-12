/**
 * IDN-08 — the SSO identity mapping service (D-110).
 *
 * The admin path for joining an SSO identity to an
 * existing `real_user_id`: a global admin maps an
 * OIDC subject to a user **with no OTP** — the
 * employee self-onboarding route (IDN-05) verifies
 * an OTP because the employee proves their own
 * identity; the admin path is gated on the admin's
 * global-admin session instead (the role assertion
 * lives in the controller, and the @casl/ability
 * rule set consumes the same role token from
 * plan 07).
 *
 * The mapping is the same join the D-104
 * auto-provisioner writes on first login — this
 * service writes it by hand for a user the
 * enterprise already knows.
 */

import { Injectable } from '@nestjs/common';

import { IdentityMappingRepository } from './identity-mapping.repository.js';
import { ProfileRepository } from './profile.repository.js';

/** The admin mapping payload (the Zod contract lives in @akane/contract). */
export interface SsoMappingInput {
  readonly oidcSub: string;
  readonly realUserId: string;
}

/** One SSO identity mapping as the Users page lists it. */
export interface SsoMappingRecord {
  readonly platform: 'oidc';
  readonly oidc_sub: string;
  readonly real_user_id: string;
  readonly email?: string;
}

/**
 * The outcome of one mapping attempt: either the
 * created mapping, or the BLD-07 field-naming
 * failure — specific and actionable, never a
 * generic "bad request".
 */
export type SsoMappingResult =
  | {
      readonly ok: true;
      readonly mapping: SsoMappingRecord;
    }
  | {
      readonly ok: false;
      readonly error: 'REAL_USER_UNKNOWN';
      readonly field: 'realUserId';
      readonly message: string;
    };

@Injectable()
export class SsoMappingService {
  constructor(
    private readonly mappings: IdentityMappingRepository,
    private readonly profiles: ProfileRepository,
  ) {}

  /**
   * Map an OIDC subject to an existing `real_user_id`.
   *
   * The target user must already exist — the mapping
   * is a join, not a provisioning step (D-104 owns
   * provisioning). A mapping to an unknown user is
   * refused with the offending field named, so the
   * admin's form can highlight it.
   */
  async create(input: SsoMappingInput): Promise<SsoMappingResult> {
    const profile = await this.profiles.findByRealUserId(
      input.realUserId,
    );
    if (profile === null) {
      return {
        ok: false,
        error: 'REAL_USER_UNKNOWN',
        field: 'realUserId',
        message: `no real_user exists for realUserId ${input.realUserId}`,
      };
    }

    // The mapping carries the user's profile email so
    // the Users page can list by it (the IDN-07
    // search shape).
    await this.mappings.upsert({
      platform: 'oidc',
      chat_user_id: input.oidcSub,
      real_user_id: input.realUserId,
      email: profile.email,
    });

    return {
      ok: true,
      mapping: {
        platform: 'oidc',
        oidc_sub: input.oidcSub,
        real_user_id: input.realUserId,
        email: profile.email,
      },
    };
  }

  /** Every mapping carrying an email — the Users page list. */
  async listByEmail(email: string): Promise<SsoMappingRecord[]> {
    const found = await this.mappings.findAllByEmail(email);
    return found.map((mapping) => ({
      platform: 'oidc' as const,
      oidc_sub: mapping.chat_user_id,
      real_user_id: mapping.real_user_id,
      email: mapping.email,
    }));
  }
}
