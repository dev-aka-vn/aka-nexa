/**
 * Unit spec for the IDN-08 SSO mapping service.
 *
 * The service is the D-110 admin path's core: the
 * existence check, the join, and the email listing.
 * The HTTP surface (role gate, inline errors) is
 * asserted by the integration spec; this pins the
 * service contract the controller renders.
 */

import { describe, expect, it } from 'vitest';

import {
  SsoMappingService,
} from './sso-mapping.service.js';
import { IdentityMappingRepository } from './identity-mapping.repository.js';
import { ProfileRepository } from './profile.repository.js';

describe('SsoMappingService (IDN-08)', () => {
  const profiles = new ProfileRepository();
  const mappings = new IdentityMappingRepository();
  const service = new SsoMappingService(mappings, profiles);

  const REAL_USER = 'real-user-0001';

  it('maps an OIDC subject to an existing real_user, carrying the profile email', async () => {
    await profiles.upsert({
      real_user_id: REAL_USER,
      employee_code: 'E-1',
      department: 'engineering',
      email: 'user@example.com',
    });

    const result = await service.create({
      oidcSub: 'subject-77',
      realUserId: REAL_USER,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mapping).toEqual({
      platform: 'oidc',
      oidc_sub: 'subject-77',
      real_user_id: REAL_USER,
      email: 'user@example.com',
    });
  });

  it('refuses a mapping to an unknown real_user, naming the field (BLD-07)', async () => {
    const result = await service.create({
      oidcSub: 'subject-78',
      realUserId: 'no-such-user',
    });

    expect(result).toEqual({
      ok: false,
      error: 'REAL_USER_UNKNOWN',
      field: 'realUserId',
      message: 'no real_user exists for realUserId no-such-user',
    });

    // Nothing was mapped — a refused mapping leaves
    // no join behind.
    const listed = await service.listByEmail('user@example.com');
    expect(listed).toHaveLength(1);
    expect(listed[0].oidc_sub).toBe('subject-77');
  });

  it('lists every mapping carrying an email (the IDN-07 search shape)', async () => {
    await profiles.upsert({
      real_user_id: 'real-user-0002',
      employee_code: 'E-2',
      department: 'engineering',
      email: 'user@example.com',
    });
    await service.create({
      oidcSub: 'subject-79',
      realUserId: 'real-user-0002',
    });

    const listed = await service.listByEmail('user@example.com');
    expect(listed).toHaveLength(2);
    expect(listed.map((m) => m.oidc_sub).sort()).toEqual([
      'subject-77',
      'subject-79',
    ]);

    // An email with no mappings lists nothing.
    expect(await service.listByEmail('nobody@example.com')).toEqual([]);
  });
});
