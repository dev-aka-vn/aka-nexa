/**
 * IDN-08 — the SSO identity mapping surface (D-110).
 *
 * The Users page's identity backend: a global admin
 * maps an SSO identity (an OIDC subject) to an
 * existing `real_user_id` with **no OTP** — the admin
 * path IDN-08 defines, deliberately separate from the
 * employee OTP self-onboarding route (IDN-05). The
 * mapping is the join the D-104 auto-provisioner
 * writes on first login; this surface is how an admin
 * writes the same join by hand for an already-known
 * user.
 *
 * Every behavior is asserted over real HTTP against
 * real Redis and the stub issuer, with a real
 * authenticated session — the role gate reads the
 * session the middleware resolved, so a mocked
 * request would invent the very thing under test.
 */

import { createServer, type AddressInfo } from 'node:net';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigModule } from '@akane/platform';
import { startThreeContainers, type ThreeContainers } from '../../../../tooling/containers.js';

import { AuthModule } from '../auth/auth.module.js';
import { SESSION_COOKIE_NAME, SESSION_KEY_PREFIX } from '../auth/oidc.service.js';
import { StubOidcIssuer } from '../auth/oidc-issuer.stub.js';
import { UsersModule } from './users.module.js';

/** The builder client the specs configure against the stub issuer. */
const CLIENT_ID = 'akane-builder';
const CLIENT_SECRET = 'akane-builder-secret';

const ADMIN_SUBJECT = 'stub-admin-0001';
const OWNER_SUBJECT = 'stub-owner-0002';
const EMAIL = 'admin@example.com';

/**
 * Reserve an ephemeral loopback port. The API must listen on a
 * port the `OIDC_REDIRECT_URI` already names, and the redirect URI
 * is part of the OIDC config the module reads at boot — so the port
 * is reserved before the testing module is compiled.
 */
function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** The `name=value` pair of a Set-Cookie header, forwarded as a Cookie. */
function cookiePair(setCookie: string): string {
  return setCookie.split(';')[0] ?? '';
}

/** The opaque session id inside a `__Host-akane_sid` Set-Cookie header. */
function sessionId(setCookie: string): string {
  const pair = cookiePair(setCookie);
  const value = pair.slice(SESSION_COOKIE_NAME.length + 1);
  expect(value).toMatch(/^[0-9a-f-]{36}$/);
  return value;
}

describe('users sso mappings (IDN-08, D-110)', () => {
  let containers: ThreeContainers;
  let issuer: StubOidcIssuer;
  let app: INestApplication;
  let apiOrigin: string;
  let redis: Redis;

  beforeAll(async () => {
    containers = await startThreeContainers();
    issuer = await StubOidcIssuer.start();

    const port = await reservePort();
    process.env.REDIS_CACHE_URL = containers.urls.cache;
    process.env.OIDC_ISSUER = issuer.origin;
    process.env.OIDC_CLIENT_ID = CLIENT_ID;
    process.env.OIDC_CLIENT_SECRET = CLIENT_SECRET;
    process.env.OIDC_REDIRECT_URI = `http://127.0.0.1:${port}/auth/oidc/callback`;

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthModule, UsersModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(port, '127.0.0.1');
    apiOrigin = `http://127.0.0.1:${port}`;

    redis = new Redis(containers.urls.cache);
    await redis.flushall();
  }, 180_000);

  afterAll(async () => {
    await redis?.quit();
    await app?.close();
    await issuer?.stop();
    await containers?.stop();
  });

  /**
   * Drive a full OIDC login and return the authenticated
   * session's cookie and its Redis record (the D-104
   * auto-provisioned `real_user_id` included).
   */
  async function completeLogin(
    subject: string,
    login: { role?: string } = {},
  ): Promise<{ cookie: string; record: { realUserId: string } }> {
    const begin = await fetch(`${apiOrigin}/auth/oidc/begin`, {
      redirect: 'manual',
    });
    expect(begin.status).toBe(302);
    const preLoginCookie = cookiePair(begin.headers.get('set-cookie') ?? '');
    const authorizationUrl = new URL(begin.headers.get('location') ?? '');
    if (login.role !== undefined) {
      authorizationUrl.searchParams.set('stub_role', login.role);
    }
    authorizationUrl.searchParams.set('stub_subject', subject);

    const authorized = await fetch(authorizationUrl.toString(), {
      redirect: 'manual',
    });
    expect(authorized.status).toBe(302);
    const callbackUrl = authorized.headers.get('location') ?? '';

    const callback = await fetch(callbackUrl, {
      redirect: 'manual',
      headers: { cookie: preLoginCookie },
    });
    expect(callback.status).toBe(302);
    const cookie = cookiePair(callback.headers.get('set-cookie') ?? '');
    const record = JSON.parse(
      (await redis.get(`${SESSION_KEY_PREFIX}${sessionId(callback.headers.get('set-cookie') ?? '')}`)) as string,
    );
    return { cookie, record };
  }

  /** POST a mapping as the session behind `cookie`. */
  async function postMapping(
    cookie: string,
    body: { oidcSub: string; realUserId: string },
  ): Promise<Response> {
    return fetch(`${apiOrigin}/users/sso-mappings`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie,
        origin: apiOrigin,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  it('a global admin maps an SSO identity to a real_user with no OTP (IDN-08)', async () => {
    const admin = await completeLogin(ADMIN_SUBJECT, { role: 'global-admin' });

    // The D-104 auto-provisioner created the admin's own
    // real_user on login; the mapping targets it directly —
    // no OTP step, no verification code, anywhere.
    const response = await postMapping(admin.cookie, {
      oidcSub: 'employee-77',
      realUserId: admin.record.realUserId,
    });
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.platform).toBe('oidc');
    expect(created.oidc_sub).toBe('employee-77');
    expect(created.real_user_id).toBe(admin.record.realUserId);
    // The mapping carries the user's profile email, so the
    // Users page can list by it.
    expect(created.email).toBe(EMAIL);

    // The mapping is immediately listable by email — the
    // IDN-07 search shape the Users page uses.
    const list = await fetch(
      `${apiOrigin}/users/sso-mappings?email=${encodeURIComponent(EMAIL)}`,
      { headers: { cookie: admin.cookie, origin: apiOrigin } },
    );
    expect(list.status).toBe(200);
    const mappings = await list.json();
    expect(mappings).toHaveLength(1);
    expect(mappings[0].oidc_sub).toBe('employee-77');
    expect(mappings[0].real_user_id).toBe(admin.record.realUserId);
  });

  it('a non-global-admin is refused with 403 GLOBAL_ADMIN_REQUIRED', async () => {
    const owner = await completeLogin(OWNER_SUBJECT, { role: 'owner' });

    const response = await postMapping(owner.cookie, {
      oidcSub: 'employee-78',
      realUserId: owner.record.realUserId,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: 'GLOBAL_ADMIN_REQUIRED',
    });

    // The list surface is the same admin identity surface:
    // an owner cannot read the mapping list either.
    const list = await fetch(
      `${apiOrigin}/users/sso-mappings?email=${encodeURIComponent(EMAIL)}`,
      { headers: { cookie: owner.cookie, origin: apiOrigin } },
    );
    expect(list.status).toBe(403);
    expect(await list.json()).toMatchObject({
      error: 'GLOBAL_ADMIN_REQUIRED',
    });
  });

  it('a mapping to an unknown realUserId is rejected with a field-naming error (BLD-07)', async () => {
    const admin = await completeLogin(ADMIN_SUBJECT, { role: 'global-admin' });

    const response = await postMapping(admin.cookie, {
      oidcSub: 'employee-79',
      realUserId: 'no-such-real-user',
    });
    expect(response.status).toBe(400);
    const error = await response.json();
    // Specific, actionable, never generic: the response
    // names the offending field.
    expect(error.field).toBe('realUserId');
    expect(error.error).toBe('REAL_USER_UNKNOWN');
    expect(error.message).toContain('no-such-real-user');

    // And nothing was mapped: the list still holds only
    // the mapping the first test created.
    const list = await fetch(
      `${apiOrigin}/users/sso-mappings?email=${encodeURIComponent(EMAIL)}`,
      { headers: { cookie: admin.cookie, origin: apiOrigin } },
    );
    const mappings = await list.json();
    expect(mappings).toHaveLength(1);
    expect(mappings.some((m: { oidc_sub: string }) => m.oidc_sub === 'employee-79')).toBe(false);
  });
});
