/**
 * ACL-02 / BLD-03 — the identity directory search (D-110).
 *
 * The role-assignment autocomplete's backend: a
 * global admin types a name-or-email **prefix** and
 * gets the matching directory entries, every entry
 * resolved to its opaque `real_user_id` — the only
 * assignment target the platform supports. The
 * directory is what the D-104 auto-provisioner
 * writes on first login, so these specs seed it the
 * only way the platform itself does: a real login
 * through the stub issuer, each login carrying the
 * `stub_name` / `stub_email` claims its user needs.
 *
 * Every behavior is asserted over real HTTP against
 * real Redis and the stub issuer, with real
 * authenticated sessions — the global-admin gate
 * reads the session the middleware resolved, so a
 * mocked request would invent the very thing under
 * test.
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
const ALICE_SUBJECT = 'stub-user-0003';
const BOB_SUBJECT = 'stub-user-0004';

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

describe('users directory search (ACL-02, BLD-03, D-110)', () => {
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
   * auto-provisioned `real_user_id` included). The
   * optional `name` / `email` ride the stub issuer's
   * claims, so a login provisions the directory entry
   * the search is supposed to find.
   */
  async function completeLogin(
    subject: string,
    login: { role?: string; name?: string; email?: string } = {},
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
    if (login.name !== undefined) {
      authorizationUrl.searchParams.set('stub_name', login.name);
    }
    if (login.email !== undefined) {
      authorizationUrl.searchParams.set('stub_email', login.email);
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

  /** GET the search surface as the session behind `cookie`. */
  async function search(
    cookie: string,
    q: string | undefined,
  ): Promise<Response> {
    const url =
      q === undefined
        ? `${apiOrigin}/users/search`
        : `${apiOrigin}/users/search?q=${encodeURIComponent(q)}`;
    return fetch(url, { headers: { cookie, origin: apiOrigin } });
  }

  it('a global admin searches the directory by name or email prefix', async () => {
    // Seed the directory the only way the platform itself
    // does — first logins, each auto-provisioning its
    // profile (D-104) with the claims the stub carried.
    const admin = await completeLogin(ADMIN_SUBJECT, {
      role: 'global-admin',
      name: 'Stub Admin',
      email: 'admin@example.com',
    });
    const alice = await completeLogin(ALICE_SUBJECT, {
      name: 'Alice Smith',
      email: 'alice.smith@example.com',
    });
    const bob = await completeLogin(BOB_SUBJECT, {
      name: 'Bob Jones',
      email: 'bob.jones@example.com',
    });

    // A name prefix matches exactly one directory entry —
    // and resolves it to the same opaque `real_user_id`
    // the login itself was provisioned with.
    const byName = await search(admin.cookie, 'ali');
    expect(byName.status).toBe(200);
    const byNameBody = (await byName.json()) as {
      users: Array<{ real_user_id: string; name: string; email: string }>;
    };
    expect(byNameBody.users).toHaveLength(1);
    expect(byNameBody.users[0]).toMatchObject({
      real_user_id: alice.record.realUserId,
      name: 'Alice Smith',
      email: 'alice.smith@example.com',
    });

    // An email prefix is the same directory, the other half.
    const byEmail = await search(admin.cookie, 'bob.j');
    expect(byEmail.status).toBe(200);
    const byEmailBody = (await byEmail.json()) as {
      users: Array<{ real_user_id: string; name: string; email: string }>;
    };
    expect(byEmailBody.users).toHaveLength(1);
    expect(byEmailBody.users[0]).toMatchObject({
      real_user_id: bob.record.realUserId,
      name: 'Bob Jones',
      email: 'bob.jones@example.com',
    });

    // The prefix match is case-insensitive on both halves.
    const byUpper = await search(admin.cookie, 'ALICE.S');
    expect(byUpper.status).toBe(200);
    const byUpperBody = (await byUpper.json()) as {
      users: Array<{ real_user_id: string; name: string; email: string }>;
    };
    expect(byUpperBody.users).toHaveLength(1);
    expect(byUpperBody.users[0]).toMatchObject({
      real_user_id: alice.record.realUserId,
      name: 'Alice Smith',
    });

    // A prefix nothing starts with is an empty directory —
    // not an error.
    const none = await search(admin.cookie, 'zzz-no-such-user');
    expect(none.status).toBe(200);
    expect((await none.json()) as { users: unknown[] }).toMatchObject({
      users: [],
    });
  });

  it('a missing or blank q is a field-naming 400 (BLD-07)', async () => {
    const admin = await completeLogin(ADMIN_SUBJECT, {
      role: 'global-admin',
    });

    const missing = await search(admin.cookie, undefined);
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      error: 'QUERY_REQUIRED',
      field: 'q',
    });

    // Whitespace-only is blank, not a prefix.
    const blank = await search(admin.cookie, '   ');
    expect(blank.status).toBe(400);
    expect(await blank.json()).toMatchObject({
      error: 'QUERY_REQUIRED',
      field: 'q',
    });
  });

  it('a non-global-admin is refused with 403 GLOBAL_ADMIN_REQUIRED', async () => {
    const owner = await completeLogin(OWNER_SUBJECT, { role: 'owner' });

    const response = await search(owner.cookie, 'ali');
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: 'GLOBAL_ADMIN_REQUIRED',
    });
  });
}, 180_000);
