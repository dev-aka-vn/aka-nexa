/**
 * D-104 — first-SSO-login auto-provision.
 *
 * A department admin's first builder login creates its own
 * `real_user`, keyed to the OIDC subject — no admin
 * pre-mapping step for builder access (that is what
 * separates D-104 from IDN-08's admin mapping path and
 * IDN-05's employee OTP self-onboarding).
 *
 * The OIDC subject is a **mapping key**, never an identity
 * of its own and never a claim in our own tokens (the
 * PII-in-JWT constraint, D-101): the join lives in the
 * identity-mapping table as `platform: 'oidc'` +
 * `chat_user_id: <oidcSub>`, and everything downstream
 * sees only the opaque `real_user_id`.
 */

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { IdentityMappingRepository } from './identity-mapping.repository.js';
import { ProfileRepository } from './profile.repository.js';

/** The identity-mapping platform value for OIDC subjects. */
export const OIDC_PLATFORM = 'oidc';

/** The outcome of one login's provisioning pass. */
export interface OidcProvisionOutcome {
  /** The `real_user_id` every login for this subject resolves to. */
  readonly realUserId: string;
  /** True exactly when this login created the user (first login). */
  readonly provisioned: boolean;
}

@Injectable()
export class OidcProvisionService {
  constructor(
    private readonly mappings: IdentityMappingRepository,
    private readonly profiles: ProfileRepository,
  ) {}

  /**
   * Resolve the OIDC subject to its `real_user_id`, creating
   * both on first login. The IdP's profile-scope `name`
   * claim is stored alongside the email — it is the
   * display name the directory search (ACL-02) matches
   * on; a subject with no name claim provisions with an
   * empty name, never a fabricated one.
   *
   * The subject is the identity key: two subjects sharing an
   * email address are two users, and every login for one
   * subject resolves to the same `real_user_id` for the
   * life of the mapping.
   */
  async upsertFromOidc(
    oidcSub: string,
    email?: string,
    name?: string,
  ): Promise<OidcProvisionOutcome> {
    const existing = await this.mappings.findByChat(OIDC_PLATFORM, oidcSub);
    if (existing !== null) {
      return { realUserId: existing.real_user_id, provisioned: false };
    }

    // First login: the user and its mapping are created
    // together, so a subject can never exist without a
    // resolvable real_user.
    const realUserId = randomUUID();
    await this.mappings.upsert({
      platform: OIDC_PLATFORM,
      chat_user_id: oidcSub,
      real_user_id: realUserId,
      email,
    });
    await this.profiles.upsert({
      real_user_id: realUserId,
      employee_code: `oidc-${oidcSub}`,
      department: 'unassigned',
      email: email ?? '',
      name: name ?? '',
    });

    return { realUserId, provisioned: true };
  }
}
