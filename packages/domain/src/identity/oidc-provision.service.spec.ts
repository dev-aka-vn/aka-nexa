/**
 * D-104 — first-SSO-login auto-provision.
 *
 * A department admin's first builder login must create a usable
 * `real_user` keyed to the OIDC subject, with no admin
 * pre-mapping step (that is what separates builder access from
 * IDN-05's employee OTP self-onboarding). The identity mapping
 * (oidcSub → real_user_id) is the join the callback flow and
 * the SSO-mapping surface both build on, so the two invariants
 * that matter are asserted here: the first login provisions, and
 * every later login for the same subject resolves to the *same*
 * `real_user_id` — a second, different user must never silently
 * appear behind one subject.
 *
 * The assertions read through the real repositories the service
 * is composed with, not through any test double: the mapping row
 * and the user record are the observable outcome of provisioning.
 */

import { describe, expect, it } from 'vitest';

import { IdentityMappingRepository } from './identity-mapping.repository.js';
import { OidcProvisionService } from './oidc-provision.service.js';
import { ProfileRepository } from './profile.repository.js';

const SUBJECT = 'stub-admin-0001';
const EMAIL = 'admin@example.com';

describe('OidcProvisionService (D-104)', () => {
  it('creates a real_user keyed to the OIDC subject on first login', async () => {
    const mappings = new IdentityMappingRepository();
    const profiles = new ProfileRepository();
    const service = new OidcProvisionService(mappings, profiles);

    const first = await service.upsertFromOidc(SUBJECT, EMAIL);

    expect(first.provisioned).toBe(true);
    expect(first.realUserId).toBeTruthy();

    // The mapping is keyed on the OIDC platform + subject, and
    // resolves to the provisioned real_user_id.
    const mapping = await mappings.findByChat('oidc', SUBJECT);
    expect(mapping).not.toBeNull();
    expect(mapping?.platform).toBe('oidc');
    expect(mapping?.chat_user_id).toBe(SUBJECT);
    expect(mapping?.real_user_id).toBe(first.realUserId);
    expect(mapping?.email).toBe(EMAIL);

    // The real_user record itself exists and carries the subject's email.
    const profile = await profiles.findByRealUserId(first.realUserId);
    expect(profile).not.toBeNull();
    expect(profile?.real_user_id).toBe(first.realUserId);
    expect(profile?.email).toBe(EMAIL);
  });

  it('resolves a second login to the same real_user_id', async () => {
    const mappings = new IdentityMappingRepository();
    const profiles = new ProfileRepository();
    const service = new OidcProvisionService(mappings, profiles);

    const first = await service.upsertFromOidc(SUBJECT, EMAIL);
    const second = await service.upsertFromOidc(SUBJECT, EMAIL);

    expect(second.provisioned).toBe(false);
    expect(second.realUserId).toBe(first.realUserId);

    // One subject, one user: the mapping still resolves to the
    // first login's real_user_id.
    const mapping = await mappings.findByChat('oidc', SUBJECT);
    expect(mapping?.real_user_id).toBe(first.realUserId);
  });

  it('keys the mapping on the subject, not the email', async () => {
    const mappings = new IdentityMappingRepository();
    const profiles = new ProfileRepository();
    const service = new OidcProvisionService(mappings, profiles);

    // Two distinct subjects that happen to share an email address
    // are two distinct users: the OIDC subject is the identity key.
    const first = await service.upsertFromOidc('subject-one', EMAIL);
    const second = await service.upsertFromOidc('subject-two', EMAIL);

    expect(first.realUserId).not.toBe(second.realUserId);
  });

  it('provisions without an email when the IdP issues none', async () => {
    const mappings = new IdentityMappingRepository();
    const profiles = new ProfileRepository();
    const service = new OidcProvisionService(mappings, profiles);

    const result = await service.upsertFromOidc(SUBJECT);

    expect(result.provisioned).toBe(true);
    const mapping = await mappings.findByChat('oidc', SUBJECT);
    expect(mapping?.email).toBeUndefined();
  });
});
